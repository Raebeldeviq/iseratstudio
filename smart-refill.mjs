import { isInventoryHistorical, isInventoryEntryHistorical, isManagerRemoved } from "./inventory-correction.mjs";
import { operationalCatalogPlots } from "./plot-active-catalog.mjs";
import { plotAddressSelection } from "./plot-selection.mjs";
import { plotAddressKey } from "./plot-records.mjs";
import { rowFromPlot, rowFromPlotB } from "./plot-master-sync.mjs";
import { planSingleHouseReplacement } from "./house-distribution.mjs";
import { createBatchUploadPlan } from "./batch-upload.mjs";
import { requireRefillUploadSelection } from './smart-refill-selection.mjs';

const ledger = state => ({ version: 2, credits: [], cycles: [], poolApprovals: [], cancellations: [], ...state?.smartRefill });
const entries = state => (state.deleteBatches || []).flatMap(batch => batch.entries || []);
const listings = state => (state.projects || []).flatMap(project => (project.listings || []).map(listing => ({ project, listing })));
const allListings = state => [...listings(state), ...(state.listingResetHistory || []).flatMap(archive =>
  (archive.listings || []).map(listing => ({ project: state.projects?.find(project => project.id === archive.projectId), archive, listing })))];
const creditKey = entry => JSON.stringify([entry.batchId, entry.projectId, entry.listingId, entry.externalId]);
const sourceKey = entry => JSON.stringify([entry.projectId, entry.listingId]);
const transferred = listing => Boolean(listing?.transferredAt || listing?.lastUploadedAt || listing?.importConfirmedAt
  || ["published", "transferred_pending_import", "uploading", "queued", "processing"].includes(listing?.status));
const historical = listing => isInventoryHistorical(listing) || isManagerRemoved(listing) || Boolean(listing?.refillDiscard);
const finished = listing => listing?.status === "deleted" && !listing.externalDeletionPending;
const occupied = listing => !historical(listing) && !finished(listing)
  && (listing.status !== "archived" || transferred(listing) || listing.externalDeletionPending);
const activeCycles = state => ledger(state).cycles.filter(cycle => !ledger(state).cancellations.some(item => item.cycleId === cycle.id));
const now = () => new Date().toISOString();
const context = state => state.activePlotCatalog ? { source: state.activePlotCatalog.lastValidSource, policy: state.activePlotCatalog } : undefined;

// Only the existing manual deletion-confirmation transaction may create credits.
export function recordRefillDeletions(before, after) {
  const previous = new Map(entries(before).map(entry => [creditKey(entry), entry]));
  const stored = ledger(before);
  const known = new Set(stored.credits.map(sourceKey));
  const added = [];
  for (const entry of entries(after)) {
    if (isInventoryEntryHistorical(before, entry) || isInventoryEntryHistorical(after, entry)
      || entry.status !== "deleted" || !entry.deletedAt || previous.get(creditKey(entry))?.status !== "active" || known.has(sourceKey(entry))) continue;
    known.add(sourceKey(entry));
    const resolved = resolveSource(before, entry);
    added.push({ id: creditKey(entry), batchId: entry.batchId, projectId: entry.projectId,
      listingId: entry.listingId, externalId: entry.externalId, deletedAt: entry.deletedAt,
      ...(resolved ? { plotId: resolved.plot.id, sourcePool: resolved.sourcePool, housePosition: resolved.housePosition,
        sourceHouseId: resolved.listing.templateId } : {}) });
  }
  return added.length ? { ...after, smartRefill: { ...stored, credits: [...stored.credits, ...added] } } : after;
}

// Use the existing pool representation displayed in the plot catalogue. Saved master
// facts fill legacy plots that have not yet received their addressRotation metadata.
function effectivePoolPlot(plot, state) {
  if (plot?.addressRotation?.poolB) return plot;
  const saved = state?.activePlotCatalog?.lastValidSource?.masterPlots?.find(item => item.id === plot?.id);
  return saved?.addressRotation?.poolB ? { ...plot, addressRotation: {
    ...plot.addressRotation, poolA: plot.addressRotation?.poolA || rowFromPlot(plot),
    poolB: saved.addressRotation.poolB, poolBDetails: saved.addressRotation.poolBDetails,
  } } : plot;
}
export function refillPoolFacts(plot, pool, state) {
  const effective = effectivePoolPlot(plot, state);
  const row = pool === "B" ? rowFromPlotB(effective) : rowFromPlot(effective);
  const address = pool === "A" ? effective.addressRotation?.poolA || row : row;
  return { street: String(address.street || ""), houseNumber: String(address.houseNumber || ""),
    postalCode: String(address.postalCode || ""), city: String(address.city || ""),
    plotSizeSqm: Number(row.plotSizeSqm) || 0, purchasePrice: Number(row.purchasePrice) || 0 };
}
export function refillPoolFingerprint(plot, pool, state) {
  return JSON.stringify([plot.id, pool, refillPoolFacts(plot, pool, state)]);
}
function poolIssue(state, plot, pool) {
  const facts = refillPoolFacts(plot, pool, state);
  const address = plotAddressSelection(facts);
  if (!facts.houseNumber.trim()) return `Pool ${pool}: Hausnummer fehlt – Grundstück bearbeiten.`;
  if (!address.selectable || address.houseNumberUnconfirmed || facts.plotSizeSqm <= 0 || facts.purchasePrice <= 0)
    return "Adresse, Fläche oder Preis unvollständig – Grundstück bearbeiten.";
  if (pool === "B" && rowFromPlotB(effectivePoolPlot(plot, state)).status === "POOL_B_PRÜFEN")
    return "Pool B besitzt einen offenen Prüffall – Grundstück bearbeiten.";
  if (!ledger(state).poolApprovals.some(approval => approval.plotId === plot.id
    && approval.pool === pool && approval.fingerprint === refillPoolFingerprint(plot, pool, state))) return "Pooldaten fachlich freigeben";
  return "";
}
export function approveRefillPool(state, plotId, pool, fingerprint, at = now()) {
  const plot = state.plots?.find(item => item.id === plotId);
  if (!plot || !["A", "B"].includes(pool) || fingerprint !== refillPoolFingerprint(plot, pool, state))
    throw new Error("Die Pooldaten haben sich geändert. Bitte erneut prüfen.");
  const issue = poolIssue(state, plot, pool);
  if (issue && issue !== "Pooldaten fachlich freigeben") throw new Error(issue);
  const stored = ledger(state);
  return { ...state, smartRefill: { ...stored, poolApprovals: [...stored.poolApprovals.filter(item => item.plotId !== plotId || item.pool !== pool),
    { plotId, pool, fingerprint, approvedAt: at }] } };
}
// Explicit one-time adoption of Pascal's approval. Future changes do not inherit it.
export function adoptApprovedRefillPools(state, at = now()) {
  let next = state;
  for (const plot of state.plots || []) for (const pool of ["A", "B"]) {
    const issue = poolIssue(next, plot, pool);
    if (!issue || issue === "Pooldaten fachlich freigeben")
      next = approveRefillPool(next, plot.id, pool, refillPoolFingerprint(plot, pool, next), at);
  }
  return next;
}

function resolveSource(state, credit, reservation) {
  const matches = allListings(state).filter(({ project, archive, listing }) => (project?.id || archive?.projectId) === credit.projectId
    && listing.id === credit.listingId && listing.externalId === credit.externalId);
  if (!matches.length || (reservation && matches.length !== 1)) return null;
  const source = matches.find(item => !item.archive) || matches[0];
  const { project, listing, archive } = source;
  const plotId = listing.addressSnapshot?.plotId || archive?.plotId || project?.plotId;
  const plot = state.plots?.find(item => item.id === plotId);
  if (!plot || !project || project.plotId !== plotId || matches.some(item => JSON.stringify(item.listing) !== JSON.stringify(listing))) return null;
  let sourcePool = listing.addressSnapshot?.pool || credit.sourcePool;
  if (sourcePool && !["A", "B"].includes(sourcePool)) return null;
  if (!sourcePool) {
    const history = (state.uploadHistory || []).filter(item => item.projectId === project.id && item.listingId === listing.id && item.externalId === listing.externalId);
    const address = history.at(-1)?.address;
    const projectFacts = { ...project, postalCode: project.zip };
    const pools = ["A", "B"].filter(pool => {
      const facts = refillPoolFacts(plot, pool, state);
      const matchingAddress = address ? address === `${facts.street} ${facts.houseNumber} ${facts.postalCode} ${facts.city}`
        : plotAddressKey(projectFacts) === plotAddressKey(facts);
      return matchingAddress;
    });
    if (pools.length === 1) sourcePool = pools[0];
    else if (pools.length === 2) {
      const matchingFacts = pools.filter(pool => { const facts = refillPoolFacts(plot, pool, state);
        return project.plotArea === facts.plotSizeSqm && project.plotPrice === facts.purchasePrice; });
      if (matchingFacts.length === 1) sourcePool = matchingFacts[0];
    }
  }
  if (!sourcePool) sourcePool = reservation?.sourcePool;
  const entry = entries(state).find(item => item.batchId === credit.batchId && item.projectId === credit.projectId
    && item.listingId === credit.listingId && item.externalId === credit.externalId);
  const variantIndex = project.listingGroup?.variants?.findIndex(item => item.listing?.id === listing.id);
  const housePosition = listing.addressSnapshot?.housePosition || credit.housePosition || entry?.housePosition
    || (variantIndex >= 0 && variantIndex < 4 ? variantIndex + 1 : 0) || reservation?.housePosition;
  if (!sourcePool || !Number.isInteger(housePosition) || housePosition < 1 || housePosition > 4 || !listing.templateId) return null;
  return { project, listing, archive, plot, sourcePool, housePosition };
}

// Manager removal is a visibility change. Planning and reserved uploads can use a
// deleted source only when its independent receipt and exact identities agree.
function validDeletionSource(state, source, credit, cycle) {
  const listing = source.listing;
  if (isInventoryHistorical(listing) || listing.refillDiscard || listing.externalDeletionPending) return false;
  const deletedAt = Date.parse(credit.deletedAt);
  if (!Number.isFinite(deletedAt) || listing.deletedAt !== credit.deletedAt) return false;
  if (cycle && !isManagerRemoved(listing) && finished(listing)) return true;
  if (!['deleted', 'archived'].includes(listing.status)) return false;
  const preparedAt = Date.parse(cycle?.preparedAt);
  if (cycle && (!Number.isFinite(preparedAt) || preparedAt < deletedAt || cycle.sourceListingId !== credit.listingId
    || cycle.sourceExternalId !== credit.externalId || cycle.projectId !== credit.projectId
    || cycle.sourceHouseId !== listing.templateId)) return false;
  if (isManagerRemoved(listing)) {
    const cleanup = listing.managerCleanup;
    if (cleanup.source !== 'manual-manager-bulk-cleanup' || !cleanup.operationId || cleanup.externalId !== credit.externalId
      || !Number.isFinite(Date.parse(cleanup.removedAt)) || Date.parse(cleanup.removedAt) < deletedAt) return false;
  }
  const batchMatches = entries(state).filter(entry => entry.batchId === credit.batchId && entry.projectId === credit.projectId
    && entry.listingId === credit.listingId && entry.externalId === credit.externalId);
  if (batchMatches.length) return batchMatches.length === 1 && batchMatches[0].status === 'deleted'
    && batchMatches[0].deletedAt === credit.deletedAt && credit.id === creditKey(batchMatches[0]);
  const evidence = listing.externalDeletionEvidence;
  const receipts = (state.deleteReports || []).filter(receipt => receipt.projectId === credit.projectId
    && receipt.sourceListingId === credit.listingId);
  return credit.source === 'user-supplied-export-report' && /^[a-f0-9]{64}$/u.test(credit.reportHash || '')
    && credit.batchId === `external-report:${credit.reportHash}` && credit.id === creditKey(credit)
    && listing.deleteConfirmedAt === credit.deletedAt && evidence?.source === credit.source
    && evidence.reportHash === credit.reportHash && evidence.confirmedAt === credit.deletedAt
    && receipts.length === 1 && receipts[0].reportId === evidence.reportId && receipts[0].rawHash === credit.reportHash
    && receipts[0].externalObjectNumber === credit.externalId && receipts[0].plotId === source.plot.id
    && receipts[0].processedAt === credit.deletedAt && receipts[0].result === 'success'
    && receipts[0].confirmationSource === credit.source;
}
function protectedSource(project, listingId, provenDeletion = false) {
  return (project.listingGroup?.listingControls || []).some(control => control.listingId === listingId
    && (control.premiumPlacement || (control.manualLock && !((control.status === "deleted" || (provenDeletion && control.status === "archived"))
      && control.updateMode === "blocked" && control.automaticUpdateEnabled === false
      && !control.lockReason && !control.lockedUntil))));
}
function reviewIssue(state, plotId, project) {
  return [...(state.catalogRepairReview?.unresolved || []), ...(state.importReportReviews || [])]
    .some(review => review.plotId === plotId || review.projectId === project.id
      || (project.listings || []).some(listing => listing.id === review.listingId));
}
function candidateForCredit(state, credit) {
  const source = resolveSource(state, credit, {});
  const base = { creditId: credit.id, sourceListingId: credit.listingId, sourceExternalId: credit.externalId,
    plotId: source?.plot.id || "", projectId: credit.projectId, label: source ? `${source.plot.street} ${source.plot.houseNumber}, ${source.plot.city}` : credit.externalId,
    sourcePool: source?.sourcePool || "", sourceHouseId: source?.listing.templateId || "", sourceHouseName: source?.listing.templateName || "",
    pool: source?.sourcePool === "A" ? "B" : "A", housePosition: source?.housePosition || 0,
    facts: source ? refillPoolFacts(source.plot, source.sourcePool === "A" ? "B" : "A", state) : {}, reason: "" };
  const blocked = reason => ({ ...base, reason });
  if (!source) return blocked("Ursprüngliches Inserat, Pool oder Hausposition nicht eindeutig zugeordnet.");
  if (!validDeletionSource(state, source, credit)) return blocked("Keine bestätigte tatsächliche Portallöschung.");
  const batchEntry = entries(state).find(entry => creditKey(entry) === credit.id);
  if (batchEntry && batchEntry.status !== "deleted") return blocked("Löschbestätigung stimmt nicht mehr mit dem freien Platz überein.");
  if (source.plot.isActive === false || source.project.isActive === false
    || !operationalCatalogPlots([source.plot], context(state)).length) return blocked("Ursprüngliches Grundstück ist nicht verfügbar.");
  if (protectedSource(source.project, source.listing.id, true) || (source.archive && protectedSource(source.archive, source.listing.id, true))) return blocked("Premium oder Löschschutz aktiv.");
  if (reviewIssue(state, source.plot.id, source.project)) return blocked("Offener relevanter Prüffall.");
  const issue = poolIssue(state, source.plot, base.pool);
  if (issue) return blocked(issue);
  return { ...base, project: source.project, fingerprint: refillPoolFingerprint(source.plot, base.pool, state),
    cycle: (source.listing.addressSnapshot?.cycle || 0) + 1 };
}

export function planSmartRefill(state, options = {}) {
  const stored = ledger(state), cycles = activeCycles(state);
  const consumed = new Set(cycles.flatMap(cycle => cycle.creditIds));
  const availableCredits = stored.credits.filter(credit => !consumed.has(credit.id));
  const selected = options.creditIds ? new Set(options.creditIds) : null;
  const blocked = [], candidates = [];
  const occupiedByPlot = new Map();
  for (const { project, archive, listing } of allListings(state)) if (occupied(listing)) {
    const plotId = listing.addressSnapshot?.plotId || archive?.plotId || project?.plotId;
    const set = occupiedByPlot.get(plotId) || new Set(); set.add(listing.templateId); occupiedByPlot.set(plotId, set);
  }
  let distribution = state.houseDistribution;
  for (const credit of availableCredits) {
    if (selected && !selected.has(credit.id)) continue;
    const candidate = candidateForCredit(state, credit);
    if (candidate.reason) { blocked.push(candidate); continue; }
    const used = occupiedByPlot.get(candidate.plotId) || new Set();
    const preview = planSingleHouseReplacement(distribution, state.houses, state.projects, candidate.projectId,
      { excludedHouseIds: [...used, candidate.sourceHouseId], activeHouseIds: [...used], seed: credit.id, now: options.now || now() });
    if (!preview.houseId) { blocked.push({ ...candidate, reason: "Kein anderer freigegebener Haustyp ohne Doppelung verfügbar." }); continue; }
    distribution = preview.distribution;
    used.add(preview.houseId); occupiedByPlot.set(candidate.plotId, used);
    candidates.push({ ...candidate, houseIds: [preview.houseId], houseName: state.houses.find(house => house.id === preview.houseId)?.name || preview.houseId });
  }
  const recorded = new Map(listings(state).map(item => [item.listing.id, item.listing]));
  const preparedListingIds = cycles.filter(cycle => cycle.kind === "listing-replacement").flatMap(cycle => cycle.listingIds).filter(id => {
    const listing = recorded.get(id);
    return listing && !historical(listing) && ["draft", "prepared"].includes(listing.status) && !transferred(listing) && !listing.listingResetAt && !listing.rotationArchivedAt;
  });
  return { released: stored.credits.length, free: availableCredits.length, reserved: consumed.size,
    activeCount: new Set(listings(state).filter(({ listing }) => occupied(listing) && transferred(listing)).map(item => item.listing.id)).size,
    readyCount: candidates.length, remaining: availableCredits.length - candidates.length,
    availablePlotCount: new Set(candidates.map(candidate => candidate.plotId)).size, candidates, blocked, availableCredits,
    distribution, preparedListingIds, cycles };
}
export function prepareSmartRefill(state, generate, options = {}) {
  const at = options.now || now();
  const plan = planSmartRefill(state, { ...options, now: at });
  if (!plan.candidates.length) throw new Error("Derzeit ist kein eindeutig zugeordneter Nachfolger für die freien Plätze vorbereitbar.");
  if (options.creditIds && plan.candidates.length !== new Set(options.creditIds).size) throw new Error("Mindestens ein angeforderter Nachfolger ist nicht vorbereitbar.");
  let next = generate(state, [...new Set(plan.candidates.map(candidate => candidate.projectId))], plan.distribution, plan.candidates);
  const oldIds = new Set(allListings(state).map(item => item.listing.id));
  const added = listings(next).filter(item => !oldIds.has(item.listing.id));
  if (added.length !== plan.candidates.length) throw new Error("Die Vorbereitung muss genau ein neues Inserat je Löschung erzeugen.");
  const cycles = plan.candidates.map(candidate => {
    const matching = added.filter(({ project, listing }) => project.id === candidate.projectId && listing.refillSourceCreditId === candidate.creditId);
    if (matching.length !== 1) throw new Error("Nachfolger ist nicht eindeutig mit seinem freien Platz verbunden.");
    return { id: `refill-single:${candidate.sourceListingId}:${1 + ledger(state).cycles.filter(cycle => cycle.sourceListingId === candidate.sourceListingId).length}`, kind: "listing-replacement", plotId: candidate.plotId, projectId: candidate.projectId,
      pool: candidate.pool, sourcePool: candidate.sourcePool, sourceListingId: candidate.sourceListingId, sourceExternalId: candidate.sourceExternalId,
      sourceHouseId: candidate.sourceHouseId, sourceHouseName: candidate.sourceHouseName, housePosition: candidate.housePosition,
      cycle: candidate.cycle, fingerprint: candidate.fingerprint, listingIds: [matching[0].listing.id], creditIds: [candidate.creditId], preparedAt: at };
  });
  next = { ...next, smartRefill: { ...ledger(state), version: 2, cycles: [...ledger(state).cycles, ...cycles] } };
  assertSmartRefillTransition(state, next);
  return next;
}

// Dedicated administrative transaction; never accepted through a browser catalogue save.
// Upload jobs are required so a stale draft cannot hide a completed/in-flight transfer.
export function discardUntransferredRefill(state, cycleId, expectedExternalIds, uploadJobs, at = now()) {
  const stored = ledger(state);
  if (stored.cancellations.some(item => item.cycleId === cycleId)) return state;
  const cycle = stored.cycles.find(item => item.id === cycleId);
  if (!cycle || !Array.isArray(uploadJobs) || !expectedExternalIds?.length) throw new Error("Vorbereitung oder Uploadnachweis fehlt.");
  const targets = cycle.listingIds.map(id => listings(state).find(item => item.listing.id === id));
  const exact = values => [...values].sort().join("|");
  if (targets.some(item => !item) || exact(targets.map(item => item.listing.externalId)) !== exact(expectedExternalIds)) throw new Error("Die verworfene Vorbereitung stimmt nicht exakt mit dem Auftrag überein.");
  const ids = new Set(cycle.listingIds), numbers = new Set(expectedExternalIds);
  if (targets.some(({ listing, project }) => !["draft", "prepared"].includes(listing.status) || transferred(listing) || protectedSource(project, listing.id))
    || uploadJobs.some(job => ids.has(job.listingId) || [...numbers].some(number => String(job.jobId || "").includes(number)))
    || (state.uploadHistory || []).some(item => ids.has(item.listingId) || numbers.has(item.externalId))
    || entries(state).some(entry => ids.has(entry.listingId) && entry.status !== "planned")) throw new Error("Mindestens ein Inserat ist übertragen, geschützt oder besitzt einen Uploadvorgang. Verwerfen gesperrt.");
  const reason = "Falsche grundstücksfremde Vierer-Nachbefüllung verworfen; ursprüngliche Löschplätze freigegeben.";
  const discard = listing => !ids.has(listing.id) ? listing : { ...listing, status: "archived", statusMessage: "Verworfene Nachschubvorbereitung",
    refillDiscard: { cycleId, at, reason }, managerCleanup: { removedAt: at, operationId: `discard:${cycleId}`, reason,
      externalId: listing.externalId, source: "discarded-refill" } };
  // A never-uploaded first legacy cycle did not actually use either pool.
  // Retain its factual pool data, but remove the cancelled preparation's occupancy.
  const plots = (state.plots || []).map(plot => {
    const rotation = plot.addressRotation;
    if (plot.id !== cycle.plotId || cycle.kind === "listing-replacement" || cycle.cycle !== 1
      || rotation?.cycle !== 1 || exact(rotation.listingIds || []) !== exact(cycle.listingIds)) return plot;
    if (allListings(state).some(item => (item.listing.addressSnapshot?.plotId || item.archive?.plotId || item.project?.plotId) === plot.id
      && !ids.has(item.listing.id) && transferred(item.listing))) return plot;
    return { ...plot, addressRotation: { ...rotation, currentPool: "", cycle: 0, listingIds: [], lastUsedA: "", lastUsedB: "" } };
  });
  return { ...state, smartRefill: { ...stored, version: 2, cancellations: [...stored.cancellations,
    { cycleId, at, reason, listingIds: [...ids], externalIds: [...numbers] }] },
    plots,
    projects: state.projects.map(project => !(project.listings || []).some(listing => ids.has(listing.id)) ? project : {
      ...project, listings: project.listings.map(discard), listingGroup: project.listingGroup ? { ...project.listingGroup,
        variants: project.listingGroup.variants.map(variant => !ids.has(variant.listing?.id) ? variant : { ...variant, active: false, listing: discard(variant.listing) }) } : project.listingGroup }),
    deleteBatches: (state.deleteBatches || []).map(batch => ({ ...batch, entries: batch.entries.map(entry => ids.has(entry.listingId) ? { ...entry, status: "void" } : entry) })) };
}

export function assertSmartRefillTransition(current, next) {
  const before = ledger(current), after = ledger(next);
  if (JSON.stringify(before.credits) !== JSON.stringify(after.credits)) throw new Error("Freie Plätze dürfen nur durch die manuelle Batchbestätigung entstehen.");
  if (JSON.stringify(before.cancellations) !== JSON.stringify(after.cancellations)) throw new Error("Nachschubvorbereitungen dürfen nur in einer geprüften Verwaltungstransaktion verworfen werden.");
  for (const cycle of before.cycles) if (!after.cycles.some(item => JSON.stringify(item) === JSON.stringify(cycle))) throw new Error("Eine gespeicherte Nachschub-Zuordnung darf nicht entfernt oder verändert werden.");
  const cycleIds = new Set(), listingIds = new Set(), used = new Set();
  for (const cycle of after.cycles) {
    const size = cycle.kind === "listing-replacement" ? 1 : 4;
    if (cycleIds.has(cycle.id) || cycle.creditIds.length !== size || cycle.listingIds.length !== size) throw new Error("Ungültige oder doppelte Nachschubzuordnung.");
    cycleIds.add(cycle.id);
    if (!after.cancellations.some(item => item.cycleId === cycle.id)) for (const id of cycle.creditIds) {
      if (used.has(id) || !before.credits.some(credit => credit.id === id)) throw new Error("Freier Platz wurde mehrfach belegt."); used.add(id);
    }
    for (const id of cycle.listingIds) { if (listingIds.has(id)) throw new Error("Inserat mehrfach reserviert."); listingIds.add(id); }
  }
  const added = after.cycles.filter(cycle => !before.cycles.some(item => item.id === cycle.id));
  if (!added.length) return;
  const plan = planSmartRefill(current, { creditIds: added.flatMap(cycle => cycle.creditIds), now: added[0].preparedAt });
  const oldListings = allListings(current);
  const newIds = new Set(added.flatMap(cycle => cycle.listingIds));
  if (listings(next).filter(item => !oldListings.some(old => old.listing.id === item.listing.id)).length !== newIds.size) throw new Error("Zusätzliche grundstücksfremde Inserate sind nicht zulässig.");
  for (const { project, listing } of listings(current)) {
    const retained = next.projects.find(item => item.id === project.id)?.listings.find(item => item.id === listing.id);
    if (JSON.stringify(retained) !== JSON.stringify(listing)) throw new Error("Bestehende Inserate dürfen durch Nachschub nicht verändert werden.");
  }
  for (const cycle of added) {
    const candidate = plan.candidates.find(item => item.creditId === cycle.creditIds[0]);
    if (cycle.kind !== "listing-replacement" || !candidate || ["plotId", "projectId", "pool", "sourcePool", "sourceListingId", "sourceExternalId", "sourceHouseId", "housePosition", "cycle", "fingerprint"].some(key => cycle[key] !== candidate[key])) throw new Error("Nachschubkandidat ist nicht mehr eindeutig freigegeben. Bitte erneut prüfen.");
    const project = next.projects.find(item => item.id === cycle.projectId);
    const listing = project?.listings.find(item => item.id === cycle.listingIds[0]);
    if (!listing || listing.templateId !== candidate.houseIds[0] || listing.refillSourceCreditId !== candidate.creditId || listing.rotationSourceListingId !== candidate.sourceListingId
      || oldListings.some(item => item.listing.id === listing.id || item.listing.externalId === listing.externalId)
      || entries(current).some(entry => entry.externalId === listing.externalId) || !/^30460-\d{6}$/u.test(listing.externalId)) throw new Error("Ungültiger Nachfolger, Haustyp oder wiederverwendete Objektnummer.");
    const snapshot = listing.addressSnapshot;
    if (!snapshot || snapshot.pool !== cycle.pool || snapshot.cycle !== cycle.cycle || snapshot.plotId !== cycle.plotId || snapshot.housePosition !== cycle.housePosition
      || !entries(next).some(entry => entry.listingId === listing.id && entry.externalId === listing.externalId && entry.batchId === snapshot.batchId
        && entry.housePosition === cycle.housePosition && entry.status === "planned")) throw new Error("Pool-Snapshot oder neuer Lösch-Batch fehlt.");
    assertSmartRefillUploadReady(next, listing);
  }
}
export function assertSmartRefillUploadReady(state, listing) {
  const cycle = ledger(state).cycles.find(item => item.listingIds.includes(listing?.id));
  if (!cycle) return;
  const plot = state.plots?.find(item => item.id === cycle.plotId), project = state.projects.find(item => item.id === cycle.projectId);
  if (cycle.kind !== "listing-replacement" || !activeCycles(state).some(item => item.id === cycle.id) || historical(listing)
    || !plot || !project || !["draft", "prepared"].includes(listing.status) || transferred(listing)) throw new Error("Nachschubinserat ist nicht mehr für einen neuen Upload verfügbar.");
  if (!operationalCatalogPlots([plot], context(state)).length || plot.isActive === false || project.isActive === false) throw new Error("Nachschubgrundstück ist nicht mehr verfügbar.");
  if (cycle.fingerprint !== refillPoolFingerprint(plot, cycle.pool, state) || poolIssue(state, plot, cycle.pool)) throw new Error("Die freigegebenen Pooldaten haben sich geändert. Bitte vor Upload prüfen.");
  const credit = ledger(state).credits.find(item => item.id === cycle.creditIds[0]);
  const source = credit && resolveSource(state, credit, cycle);
  if (!source || !validDeletionSource(state, source, credit, cycle) || source.sourcePool !== cycle.sourcePool
    || source.plot.id !== cycle.plotId || source.housePosition !== cycle.housePosition || source.listing.templateId === listing.templateId
    || protectedSource(source.project, source.listing.id, true) || (source.archive && protectedSource(source.archive, source.listing.id, true))
    || protectedSource(project, listing.id)) throw new Error("Die ursprüngliche Löschung oder der Löschschutz verhindert den Nachschubupload.");
  if (reviewIssue(state, plot.id, project)) throw new Error("Offener Prüffall verhindert den Nachschubupload.");
  const facts = refillPoolFacts(plot, cycle.pool, state), snapshot = listing.addressSnapshot;
  if (project.plotId !== cycle.plotId || snapshot?.plotId !== cycle.plotId || snapshot.pool !== cycle.pool || snapshot.cycle !== cycle.cycle
    || snapshot.housePosition !== cycle.housePosition || JSON.stringify(snapshot.address) !== JSON.stringify(facts)
    || listing.refillSourceCreditId !== credit.id || listing.rotationSourceListingId !== source.listing.id) throw new Error("Inserat und freigegebene Grundstücksdaten stimmen nicht überein.");
  if (allListings(state).some(item => item.listing.id !== listing.id && (item.listing.addressSnapshot?.plotId || item.archive?.plotId || item.project?.plotId) === cycle.plotId
    && occupied(item.listing) && item.listing.templateId === listing.templateId)) throw new Error("Ein anderer aktiver oder reservierter Nachfolger verwendet denselben Haustyp.");
}
export function createSmartRefillUploadPlan(state, options = {}) {
  const selectedListingIds = requireRefillUploadSelection(planSmartRefill(state).preparedListingIds, options.selectedListingIds);
  const pending = new Set(selectedListingIds);
  const projectIds = [...new Set(activeCycles(state).filter(cycle => cycle.listingIds.some(id => pending.has(id))).map(cycle => cycle.projectId))];
  for (const { listing } of listings(state)) if (pending.has(listing.id)) assertSmartRefillUploadReady(state, listing);
  const excludedListingIds = listings(state).filter(item => !pending.has(item.listing.id)).map(item => item.listing.id);
  return { selectedListingIds, projectIds, excludedListingIds, plan: createBatchUploadPlan(state, projectIds, { ...options, excludedListingIds }) };
}
