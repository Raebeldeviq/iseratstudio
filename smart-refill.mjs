import { addressRotationStatus } from "./address-rotation.mjs";
import { operationalCatalogPlots } from "./plot-active-catalog.mjs";
import { plotAddressSelection } from "./plot-selection.mjs";
import { createProjectFromPlot, plotAddressKey } from "./plot-records.mjs";
import { generateWeightedDistribution } from "./house-distribution.mjs";
import { createBatchUploadPlan } from "./batch-upload.mjs";

const ledger = state => state?.smartRefill || { version: 1, credits: [], cycles: [], poolApprovals: [] };
const entries = state => (state.deleteBatches || []).flatMap(batch => batch.entries || []);
const listings = state => (state.projects || []).flatMap(project => (project.listings || []).map(listing => ({ project, listing })));
const creditKey = entry => JSON.stringify([entry.batchId, entry.projectId, entry.listingId, entry.externalId]);
const transferred = listing => Boolean(listing?.transferredAt || listing?.lastUploadedAt || listing?.importConfirmedAt
  || ["published", "transferred_pending_import", "uploading", "queued"].includes(listing?.status));
const finished = listing => listing?.status === "deleted" && !listing.externalDeletionPending;
const now = () => new Date().toISOString();

// Called only inside the existing manual batch-confirmation transaction.
export function recordRefillDeletions(before, after) {
  const previous = new Map(entries(before).map(entry => [creditKey(entry), entry]));
  const stored = ledger(before);
  const known = new Set(stored.credits.map(credit => credit.id));
  const added = [];
  for (const entry of entries(after)) {
    const id = creditKey(entry);
    if (entry.status !== "deleted" || !entry.deletedAt || previous.get(id)?.status !== "active" || known.has(id)) continue;
    known.add(id);
    added.push({ id, batchId: entry.batchId, projectId: entry.projectId,
      listingId: entry.listingId, externalId: entry.externalId, deletedAt: entry.deletedAt });
  }
  return added.length ? { ...after, smartRefill: { ...stored, credits: [...stored.credits, ...added] } } : after;
}

export function refillPoolFacts(plot, pool) {
  const address = pool === "B" ? plot?.addressRotation?.poolB : plot?.addressRotation?.poolA || plot;
  const details = pool === "B" ? plot?.addressRotation?.poolBDetails : plot;
  return { street: String(address?.street || ""), houseNumber: String(address?.houseNumber || ""),
    postalCode: String(address?.postalCode || ""), city: String(address?.city || ""),
    plotSizeSqm: Number(details?.plotSizeSqm) || 0, purchasePrice: Number(details?.purchasePrice) || 0 };
}

export function refillPoolFingerprint(plot, pool) {
  return JSON.stringify([plot.id, pool, refillPoolFacts(plot, pool)]);
}

function poolIssue(state, plot, pool) {
  const facts = refillPoolFacts(plot, pool);
  const address = plotAddressSelection(facts);
  if (!address.selectable || address.houseNumberUnconfirmed || facts.plotSizeSqm <= 0 || facts.purchasePrice <= 0) return "Adresse, Fläche oder Preis unvollständig – Grundstück bearbeiten.";
  if (pool === "B" && plot.addressRotation?.poolBDetails?.status === "POOL_B_PRÜFEN") return "Pool B besitzt einen offenen Prüffall – Grundstück bearbeiten.";
  const needsApproval = pool === "B" || plotAddressKey(facts) !== plotAddressKey(plot);
  if (needsApproval && !ledger(state).poolApprovals.some(approval => approval.plotId === plot.id
    && approval.pool === pool && approval.fingerprint === refillPoolFingerprint(plot, pool))) return "Pooldaten fachlich freigeben";
  return "";
}

export function approveRefillPool(state, plotId, pool, fingerprint, at = now()) {
  const plot = state.plots?.find(item => item.id === plotId);
  if (!plot || !["A", "B"].includes(pool) || fingerprint !== refillPoolFingerprint(plot, pool)) throw new Error("Die Pooldaten haben sich geändert. Bitte erneut prüfen.");
  const issue = poolIssue(state, plot, pool);
  if (issue && issue !== "Pooldaten fachlich freigeben") throw new Error(issue);
  const stored = ledger(state);
  const approval = { plotId, pool, fingerprint, approvedAt: at };
  return { ...state, smartRefill: { ...stored, poolApprovals: [...stored.poolApprovals.filter(item => item.plotId !== plotId || item.pool !== pool), approval] } };
}

function initialRotation(plot) {
  return plot.addressRotation || { poolA: refillPoolFacts(plot, "A"), poolB: null, currentPool: "", cycle: 0, listingIds: [], lastUsedA: "", lastUsedB: "" };
}

function reviewIssue(state, plotId, projects) {
  const projectIds = new Set(projects.map(project => project.id));
  const listingIds = new Set(projects.flatMap(project => project.listings || []).map(listing => listing.id));
  const reviews = [...(state.catalogRepairReview?.unresolved || []), ...(state.importReportReviews || [])];
  return reviews.some(review => review.plotId === plotId || projectIds.has(review.projectId) || listingIds.has(review.listingId));
}

function candidateForPlot(state, plot) {
  const projects = state.projects.filter(project => project.plotId === plot.id);
  const rotation = initialRotation(plot);
  const pool = rotation.currentPool === "A" ? "B" : "A";
  const facts = refillPoolFacts(plot, pool);
  const blocked = reason => ({ plotId: plot.id, label: `${plot.street} ${plot.houseNumber}, ${plot.city}`, pool, facts, reason });
  if (projects.length > 1) return blocked("Mehrere Projekte für dieselbe plotId – Zuordnung prüfen.");
  if (plot.isActive === false || projects.some(project => project.isActive === false)) return blocked("Grundstück ist inaktiv.");
  if (reviewIssue(state, plot.id, projects)) return blocked("Offener relevanter Prüffall.");
  if (projects.some(project => (project.listingGroup?.listingControls || []).some(control => control.premiumPlacement
    || (control.manualLock && !finished(project.listings?.find(listing => listing.id === control.listingId)))))) return blocked("Premium oder Löschschutz aktiv.");
  const history = [...projects.flatMap(project => project.listings || []), ...(state.listingResetHistory || [])
    .filter(archive => archive.plotId === plot.id || projects.some(project => project.id === archive.projectId)).flatMap(archive => archive.listings || [])];
  if (history.some(listing => !finished(listing) && (listing.status !== "archived" || transferred(listing) || listing.externalDeletionPending))) return blocked("Inserate des Grundstücks sind noch aktiv, vorbereitet oder ungeklärt.");
  const status = addressRotationStatus({ ...state, plots: state.plots.map(item => item.id === plot.id ? { ...item, addressRotation: rotation } : item) }, plot.id, { initialPoolAOnly: true });
  if (status.state !== "ready") return blocked(`${status.remaining}/4 Inserate noch offen oder nächster Pool unvollständig.`);
  if (history.length && !rotation.currentPool) return blocked("Historischer Zyklus ohne eindeutige Poolzuordnung – zuerst prüfen.");
  const issue = poolIssue(state, plot, pool);
  if (issue) return blocked(issue);
  const project = projects[0] || createProjectFromPlot(plot, { createId: () => `refill-${plot.id}`, owner: plot.owner, now: plot.createdAt || "1970-01-01T00:00:00.000Z" });
  if (!projects.length && state.projects.some(item => item.id === project.id)) return blocked("Projekt-ID bereits belegt.");
  return { plotId: plot.id, projectId: project.id, label: `${plot.street} ${plot.houseNumber}, ${plot.city}`, pool, cycle: status.cycle + 1,
    facts, fingerprint: refillPoolFingerprint(plot, pool), project, priority: status.cycle > 0 ? 0 : 1,
    lastUsedAt: rotation.lastUsedA || rotation.lastUsedB || "", reason: "" };
}

export function planSmartRefill(state, options = {}) {
  const stored = ledger(state);
  const consumed = new Set(stored.cycles.flatMap(cycle => cycle.creditIds));
  const availableCredits = stored.credits.filter(credit => !consumed.has(credit.id));
  const context = options.catalogContext || (state.activePlotCatalog ? { source: state.activePlotCatalog.lastValidSource, policy: state.activePlotCatalog } : undefined);
  const available = operationalCatalogPlots(state.plots || [], context);
  const blocked = [], eligible = [];
  for (const plot of available) {
    const candidate = candidateForPlot(state, plot);
    (candidate.reason ? blocked : eligible).push(candidate);
  }
  eligible.sort((a, b) => a.priority - b.priority || a.lastUsedAt.localeCompare(b.lastUsedAt) || a.plotId.localeCompare(b.plotId));
  let distribution = state.houseDistribution;
  const projects = [...state.projects];
  const suitable = [];
  for (const candidate of eligible) {
    if (!projects.some(project => project.id === candidate.projectId)) projects.push(candidate.project);
    const preview = generateWeightedDistribution(distribution, state.houses, [candidate.projectId], { projects, seed: `refill:${candidate.plotId}:${candidate.cycle}`, now: options.now || now() });
    if (!preview.ok) { blocked.push({ ...candidate, reason: preview.diagnostics.join(" · ") || "Keine vier freigegebenen unterschiedlichen Häuser verfügbar." }); continue; }
    distribution = preview.distribution;
    suitable.push({ ...candidate, houseIds: preview.assignments[candidate.projectId] });
  }
  const candidates = suitable.slice(0, Math.floor(availableCredits.length / 4));
  const recordedListings = new Map(listings(state).map(item => [item.listing.id, item.listing]));
  const preparedListingIds = stored.cycles.flatMap(cycle => cycle.listingIds).filter(id => {
    const listing = recordedListings.get(id);
    return listing && ["draft", "prepared"].includes(listing.status) && !transferred(listing) && !listing.listingResetAt && !listing.rotationArchivedAt;
  });
  const occupied = listings(state).filter(({ listing }) => !finished(listing) && transferred(listing));
  return { released: stored.credits.length, free: availableCredits.length, reserved: consumed.size,
    activeCount: new Set(occupied.map(item => item.listing.id)).size,
    readyCount: candidates.length * 4, remaining: availableCredits.length - candidates.length * 4,
    availablePlotCount: suitable.length, candidates, blocked, availableCredits, distribution, preparedListingIds,
    cycles: stored.cycles };
}

export function prepareSmartRefill(state, generate, options = {}) {
  const plan = planSmartRefill(state, options);
  if (!plan.candidates.length) throw new Error("Derzeit ist keine vollständige zulässige Vierergruppe für die freien Plätze verfügbar.");
  const candidateByPlot = new Map(plan.candidates.map(candidate => [candidate.plotId, candidate]));
  let next = { ...state, plots: state.plots.map(plot => candidateByPlot.has(plot.id) ? { ...plot, addressRotation: initialRotation(plot) } : plot), projects: [...state.projects] };
  for (const candidate of plan.candidates) {
    const facts = candidate.facts;
    const project = { ...candidate.project, street: facts.street, houseNumber: facts.houseNumber, zip: facts.postalCode, city: facts.city,
      plotArea: facts.plotSizeSqm, plotPrice: facts.purchasePrice };
    next.projects = next.projects.some(item => item.id === project.id) ? next.projects.map(item => item.id === project.id ? project : item) : [...next.projects, project];
  }
  next = generate(next, plan.candidates.map(candidate => candidate.projectId), plan.distribution);
  const at = options.now || now();
  const cycles = plan.candidates.map((candidate, index) => {
    const plot = next.plots.find(item => item.id === candidate.plotId);
    const ids = plot.addressRotation.listingIds;
    if (ids.length !== 4 || new Set(ids).size !== 4 || ids.some(id => listings(state).some(item => item.listing.id === id))) throw new Error("Die Vorbereitung hat keine vier neuen Inserate erzeugt.");
    return { id: `refill:${candidate.plotId}:${candidate.cycle}`, plotId: candidate.plotId, projectId: candidate.projectId,
      pool: candidate.pool, cycle: candidate.cycle, fingerprint: candidate.fingerprint,
      listingIds: ids, creditIds: plan.availableCredits.slice(index * 4, index * 4 + 4).map(credit => credit.id), preparedAt: at };
  });
  next = { ...next, smartRefill: { ...ledger(state), cycles: [...ledger(state).cycles, ...cycles] } };
  assertSmartRefillTransition(state, next);
  return next;
}

// Called by the existing optimistic catalog save at start AND commit.
export function assertSmartRefillTransition(current, next) {
  const before = ledger(current), after = ledger(next);
  if (JSON.stringify(before.credits) !== JSON.stringify(after.credits)) throw new Error("Freie Plätze dürfen nur durch die manuelle Batchbestätigung entstehen.");
  for (const cycle of before.cycles) if (!after.cycles.some(item => JSON.stringify(item) === JSON.stringify(cycle))) throw new Error("Eine gespeicherte Nachschub-Zuordnung darf nicht entfernt oder verändert werden.");
  const used = new Set(), cycleIds = new Set(), listingIds = new Set();
  for (const cycle of after.cycles) {
    if (cycleIds.has(cycle.id) || cycle.creditIds.length !== 4 || cycle.listingIds.length !== 4) throw new Error("Ungültige oder doppelte Nachschubgruppe.");
    cycleIds.add(cycle.id);
    for (const id of cycle.creditIds) {
      if (used.has(id) || !before.credits.some(credit => credit.id === id)) throw new Error("Freier Platz wurde mehrfach belegt.");
      used.add(id);
    }
    for (const id of cycle.listingIds) { if (listingIds.has(id)) throw new Error("Inserat mehrfach reserviert."); listingIds.add(id); }
  }
  const added = after.cycles.filter(cycle => !before.cycles.some(item => item.id === cycle.id));
  if (!added.length) return;
  const plan = planSmartRefill(current);
  for (const cycle of added) {
    const candidate = plan.candidates.find(item => item.plotId === cycle.plotId && item.projectId === cycle.projectId && item.pool === cycle.pool && item.cycle === cycle.cycle && item.fingerprint === cycle.fingerprint);
    if (!candidate) throw new Error("Nachschubkandidat ist nicht mehr freigegeben. Bitte erneut prüfen.");
    const project = next.projects.find(item => item.id === cycle.projectId);
    const group = cycle.listingIds.map(id => project?.listings.find(listing => listing.id === id));
    if (group.some(listing => !listing || !["draft", "prepared"].includes(listing.status) || transferred(listing))
      || new Set(group.map(listing => listing.templateId)).size !== 4) throw new Error("Nachschub benötigt vier neue unterschiedliche Hausinserate.");
    for (const listing of group) {
      if (listings(current).some(item => item.listing.id === listing.id || item.listing.externalId === listing.externalId)) throw new Error("Nachschub verwendet eine bestehende Inserats- oder Objektnummer.");
      if (!/^30460-\d{6}$/u.test(listing.externalId)) throw new Error("Ungültige neue Objektnummer.");
      const snapshot = listing.addressSnapshot;
      if (!snapshot || snapshot.pool !== cycle.pool || snapshot.cycle !== cycle.cycle || snapshot.plotId !== cycle.plotId) throw new Error("Pool-Snapshot fehlt.");
      if (!entries(next).some(entry => entry.listingId === listing.id && entry.externalId === listing.externalId && entry.batchId === snapshot.batchId && entry.status === "planned")) throw new Error("Neuer Lösch-Batch fehlt.");
    }
    assertSmartRefillUploadReady(next, group[0]);
  }
}

export function assertSmartRefillUploadReady(state, listing) {
  const cycle = ledger(state).cycles.find(item => item.listingIds.includes(listing?.id));
  if (!cycle) return;
  const plot = state.plots?.find(item => item.id === cycle.plotId);
  const project = state.projects.find(item => item.id === cycle.projectId);
  if (!plot || !project || !["draft", "prepared"].includes(listing.status) || transferred(listing)) throw new Error("Nachschubinserat ist nicht mehr für einen neuen Upload verfügbar.");
  const context = state.activePlotCatalog ? { source: state.activePlotCatalog.lastValidSource, policy: state.activePlotCatalog } : undefined;
  if (!operationalCatalogPlots([plot], context).length || plot.isActive === false || project.isActive === false) throw new Error("Nachschubgrundstück ist nicht mehr verfügbar.");
  if (cycle.fingerprint !== refillPoolFingerprint(plot, cycle.pool) || poolIssue(state, plot, cycle.pool)) throw new Error("Die freigegebenen Pooldaten haben sich geändert. Bitte vor Upload prüfen.");
  if (reviewIssue(state, plot.id, [project])) throw new Error("Offener Prüffall verhindert den Nachschubupload.");
  if ((project.listingGroup?.listingControls || []).some(control => control.premiumPlacement || (control.manualLock && !finished(project.listings.find(item => item.id === control.listingId))))) throw new Error("Premium oder Löschschutz verhindert den Nachschubupload.");
  if (plot.addressRotation?.currentPool !== cycle.pool || plot.addressRotation?.cycle !== cycle.cycle
    || JSON.stringify(plot.addressRotation?.listingIds) !== JSON.stringify(cycle.listingIds)) throw new Error("Der reservierte Grundstückszyklus stimmt nicht mehr.");
  const facts = refillPoolFacts(plot, cycle.pool);
  if (plotAddressKey(project) !== plotAddressKey(facts) || project.plotArea !== facts.plotSizeSqm || project.plotPrice !== facts.purchasePrice
    || plotAddressKey(listing.addressSnapshot?.address) !== plotAddressKey(facts)) throw new Error("Inserat und freigegebene Grundstücksdaten stimmen nicht überein.");
  if (project.listings.some(item => !cycle.listingIds.includes(item.id) && !finished(item) && (item.status !== "archived" || transferred(item)))) throw new Error("Ein anderer Grundstückszyklus ist noch offen.");
}

export function createSmartRefillUploadPlan(state, options = {}) {
  const pending = new Set(planSmartRefill(state).preparedListingIds);
  const projectIds = [...new Set(ledger(state).cycles.filter(cycle => cycle.listingIds.some(id => pending.has(id))).map(cycle => cycle.projectId))];
  for (const { listing } of listings(state)) if (pending.has(listing.id)) assertSmartRefillUploadReady(state, listing);
  const excludedListingIds = listings(state).filter(item => !pending.has(item.listing.id)).map(item => item.listing.id);
  return { projectIds, excludedListingIds, plan: createBatchUploadPlan(state, projectIds, { ...options, excludedListingIds }) };
}
