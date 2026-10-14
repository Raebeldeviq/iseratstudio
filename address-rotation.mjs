import { isInventoryHistorical, isManagerRemoved } from "./inventory-correction.mjs";
const text = (value) => String(value ?? "").trim();

function poolIssue(rotation, pool) {
  const address = pool === "A" ? rotation?.poolA : rotation?.poolB;
  if (!address) return `Pool ${pool} fehlt. Bitte vollständige, fachlich geprüfte Grundstücksdaten hinterlegen.`;
  for (const [field, label] of [["street", "Straße"], ["houseNumber", "Hausnummer"], ["postalCode", "PLZ"], ["city", "Ort"]]) {
    if (!text(address[field])) return `Pool ${pool} unvollständig: ${label} fehlt.`;
  }
  if (!/^\d{5}$/u.test(text(address.postalCode))) return `Pool ${pool} unvollständig: PLZ ist ungültig.`;
  if (pool === "B" && rotation.poolBDetails?.status === "POOL_B_PRÜFEN") return "Pool B besitzt einen offenen Prüffall. Grundstücksdaten fachlich prüfen.";
  return "";
}

// Identity comes from plot/project IDs, never from similar street or house numbers.
function plotListingRecords(state, plotId) {
  const projects = (state.projects || []).filter(project => project.plotId === plotId);
  const projectIds = new Set(projects.map(project => project.id));
  const records = new Map();
  const add = (owner, projectId, listing) => {
    if (!listing?.id) return;
    const key = JSON.stringify([projectId, listing.id]);
    if (!records.has(key)) records.set(key, { owner, projectId, listing,
      identityMismatch: Boolean(listing.addressSnapshot?.plotId && listing.addressSnapshot.plotId !== plotId) });
  };
  for (const project of projects) {
    for (const listing of project.listings || []) add(project, project.id, listing);
    for (const variant of project.listingGroup?.variants || []) add(project, project.id, variant.listing);
  }
  for (const archive of state.listingResetHistory || []) {
    if (archive.plotId === plotId || (!archive.plotId && projectIds.has(archive.projectId))) {
      for (const listing of archive.listings || []) add(archive, archive.projectId, listing);
    }
  }
  return [...records.values()];
}

function confirmedClosed(state, record, plotId) {
  const { listing, projectId } = record;
  if (!["deleted", "archived"].includes(listing.status) || listing.externalDeletionPending
    || !Number.isFinite(Date.parse(listing.deletedAt))) return false;
  const entries = (state.deleteBatches || []).flatMap(batch => batch.entries || []).filter(entry =>
    entry.projectId === projectId && entry.listingId === listing.id && entry.externalId === listing.externalId && entry.status !== "void");
  if (entries.length) return entries.length === 1 && entries[0].status === "deleted" && entries[0].deletedAt === listing.deletedAt;
  const receipts = (state.deleteReports || []).filter(receipt => receipt.projectId === projectId && receipt.sourceListingId === listing.id);
  return receipts.length === 1 && receipts[0].externalObjectNumber === listing.externalId && receipts[0].plotId === plotId
    && receipts[0].result === "success" && receipts[0].processedAt === listing.deletedAt && listing.deleteConfirmedAt === listing.deletedAt;
}

function productiveListing(state, record, plotId) {
  const listing = record.listing;
  if (isInventoryHistorical(listing) || confirmedClosed(state, record, plotId)) return false;
  const transferred = listing.transferredAt || listing.lastUploadedAt || listing.importConfirmedAt
    || ["published", "transferred_pending_import"].includes(listing.status)
    || (state.deleteBatches || []).flatMap(batch => batch.entries || []).some(entry => entry.projectId === record.projectId
      && entry.listingId === listing.id && entry.externalId === listing.externalId
      && (entry.status === "active" || (entry.status === "paused" && entry.pausedFrom === "active")));
  if (listing.externalDeletionPending || transferred) return true;
  if (isManagerRemoved(listing) || listing.refillDiscard) return false;
  return ["draft", "prepared", "scheduled", "processing", "uploading", "queued"].includes(listing.status);
}

export function addressRotationPreparationIssue(state, plotId, options = {}) {
  const status = addressRotationStatus(state, plotId, options);
  if (status.state === "unconfigured") return "";
  const plot = state.plots.find(item => item.id === plotId), rotation = plot.addressRotation;
  const label = `${text(plot.street)} ${text(plot.houseNumber)}, ${text(plot.postalCode)} ${text(plot.city)}`.trim();
  const blocked = reason => `${label}: ${reason}`;
  const issue = poolIssue(rotation, "A") || (!(options.initialPoolAOnly && !rotation.currentPool) && poolIssue(rotation, "B"));
  if (issue) return blocked(issue);
  const records = plotListingRecords(state, plotId);
  for (const record of records) {
    const listing = record.listing, control = record.owner.listingGroup?.listingControls?.find(item => item.listingId === listing.id);
    if (record.identityMismatch && !isInventoryHistorical(listing)) return blocked(`Grundstückszuordnung für ${listing.externalId} ist uneindeutig. Bitte prüfen.`);
    if (listing.status === "deleted" && !isInventoryHistorical(listing) && !confirmedClosed(state, record, plotId)) {
      return blocked(`Löschbestätigung für ${listing.externalId} fehlt oder ist widersprüchlich. Bestand prüfen.`);
    }
    if (["scheduled", "processing", "uploading", "queued"].includes(listing.status)
      || ["scheduled", "processing", "uploading", "queued"].includes(control?.status) || control?.processLease
      || control?.pendingRotationJobId || control?.pendingRotationListingId) return blocked(`Neuer Zyklus gesperrt: aktiver Vorgang oder Reservierung für ${listing.externalId}.`);
    const closureLock = control?.status === "deleted" && listing.status === "deleted" && control.updateMode === "blocked"
      && control.automaticUpdateEnabled === false && !control.lockReason && !control.lockedUntil && confirmedClosed(state, record, plotId);
    if (control?.premiumPlacement) return blocked(`Neuer Zyklus gesperrt: Premium-Schutz für ${listing.externalId}.`);
    if ((control?.manualLock && !closureLock) || (control?.lockedUntil && Date.parse(control.lockedUntil) > Date.parse(options.now || new Date()))) {
      return blocked(`Neuer Zyklus gesperrt: Löschschutz für ${listing.externalId}.`);
    }
  }
  const reservations = (state.smartRefill?.cycles || []).filter(cycle => cycle.plotId === plotId
    && !(state.smartRefill?.cancellations || []).some(item => item.cycleId === cycle.id)
    && (cycle.listingIds || []).some(id => {
      const record = records.find(item => item.listing.id === id);
      return !record || (!confirmedClosed(state, record, plotId)
        && !record.listing.transferredAt && !record.listing.lastUploadedAt && !record.listing.importConfirmedAt);
    }));
  if (reservations.length) return blocked("Rotationszyklus wartet auf Abschluss einer aktiven Nachschubreservierung.");
  const productive = records.filter(record => productiveListing(state, record, plotId));
  if (productive.length) return blocked(`Neuer Zyklus gesperrt: ${productive.length} aktive oder vorbereitete Inserate vorhanden (${productive.map(item => item.listing.externalId).join(", ")}).`);
  if (status.state !== "ready") {
    const ids = rotation.listingIds || [];
    if (ids.length !== 4) return blocked(`Rotationszyklus unvollständig: ${ids.length}/4 Inseratsreferenzen zugeordnet.`);
    if (ids.some(id => records.filter(record => record.listing.id === id).length !== 1)) {
      return blocked("Rotationszyklus enthält fehlende oder mehrfach zugeordnete Inseratsreferenzen. Bestand prüfen.");
    }
    return blocked(`Rotationszyklus wartet auf ${status.remaining} bestätigte Abschlüsse. Bestands- und Löschbelege prüfen.`);
  }
  return "";
}

export function parseAddressPoolRows(rows, pool) {
  if (pool !== "A" && pool !== "B") throw new Error("Unbekannter Adresspool.");
  if (!Array.isArray(rows) || !rows.length) throw new Error(`Pool_${pool} ist leer.`);
  const normalize = (value) => text(value).toLocaleLowerCase("de-DE").normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "").replace(/ß/gu, "ss").replace(/[^a-z0-9]/gu, "");
  const columns = new Map(rows[0].map((value, index) => [normalize(value), index]));
  const column = (...names) => names.map(normalize).map((name) => columns.get(name)).find((index) => index !== undefined);
  const indexes = {
    plotId: column("plotId", "Grundstücks-ID"), street: column("Straße", "Strasse"),
    houseNumber: column("Hausnummer", "Hausnr"), postalCode: column("PLZ", "Postleitzahl"),
    city: column("Ort", "Stadt"), plotSizeSqm: column("Größe (m²)", "Grundstücksfläche m²"),
    purchasePrice: column("Preis (€)", "Grundstückspreis €"),
  };
  for (const field of ["plotId", "street", "houseNumber", "postalCode", "city"]) {
    if (indexes[field] === undefined) throw new Error(`Pool_${pool}: Pflichtspalte ${field} fehlt.`);
  }
  const parsed = [];
  const seen = new Set();
  for (const [index, row] of rows.entries()) {
    if (!index || row.every((value) => !text(value))) continue;
    const get = (field) => text(row[indexes[field]]);
    const plotId = get("plotId");
    const address = {
      street: get("street"), houseNumber: get("houseNumber"),
      postalCode: get("postalCode").padStart(5, "0"), city: get("city"),
    };
    if (!plotId || !address.street || !address.houseNumber || !/^\d{5}$/u.test(address.postalCode) || !address.city) {
      throw new Error(`Pool_${pool}, Zeile ${index + 1}: plotId oder vollständige Adresse fehlt.`);
    }
    if (seen.has(plotId)) throw new Error(`Pool_${pool}: plotId ${plotId} kommt mehrfach vor.`);
    seen.add(plotId);
    parsed.push({ plotId, pool, address,
      plotSizeSqm: Number(row[indexes.plotSizeSqm]) || 0,
      purchasePrice: Number(row[indexes.purchasePrice]) || 0 });
  }
  return parsed;
}

export function mergeAddressPools(plots, poolA, poolB) {
  const byId = new Map(plots.map((plot) => [plot.id, plot]));
  const result = new Map();
  for (const row of [...poolA, ...poolB]) {
    const entry = result.get(row.plotId) || { A: null, B: null };
    entry[row.pool] = row;
    result.set(row.plotId, entry);
  }
  const unknown = [...result.keys()].filter((id) => !byId.has(id));
  if (unknown.length) throw new Error(`${unknown.length} plotId(s) sind im Grundstückskatalog unbekannt: ${unknown.slice(0, 5).join(", ")}.`);
  return plots.map((plot) => {
    const rows = result.get(plot.id);
    if (!rows) return plot;
    const current = plot.addressRotation || {};
    return { ...plot, addressRotation: {
      poolA: rows.A?.address || null, poolB: rows.B?.address || null,
      currentPool: current.currentPool || "",
      cycle: Number(current.cycle) || 0,
      listingIds: Array.isArray(current.listingIds) ? current.listingIds : [],
      lastUsedA: current.lastUsedA || "", lastUsedB: current.lastUsedB || "",
    } };
  });
}

export function addressRotationStatus(state, plotId, options = {}) {
  const plot = (state.plots || []).find((item) => item.id === plotId);
  const rotation = plot?.addressRotation;
  if (!rotation) return { state: "unconfigured", currentPool: "", nextPool: "", remaining: 0, cycle: 0 };
  const currentPool = rotation.currentPool || "";
  const nextPool = currentPool === "A" ? "B" : "A";
  const nextAddress = nextPool === "A" ? rotation.poolA : rotation.poolB;
  const readyPair = !poolIssue(rotation, "A") && !poolIssue(rotation, "B");
  if (!currentPool) return { state: readyPair || (options.initialPoolAOnly === true && !poolIssue(rotation, "A")) ? "ready" : "incomplete", currentPool, nextPool, remaining: 0, cycle: 0 };
  const ids = rotation.listingIds || [];
  const records = plotListingRecords(state, plotId);
  const entries = (state.deleteBatches || []).flatMap((batch) => batch.entries || []);
  const remaining = ids.filter((id) => {
    const matches = records.filter(record => record.listing.id === id);
    if (matches.length !== 1) return true;
    const record = matches[0], listing = record.listing;
    const entry = entries.find(item => item.projectId === record.projectId && item.listingId === id
      && item.externalId === listing.externalId && item.status !== "void");
    const control = record.owner.listingGroup?.listingControls?.find(item => item.listingId === id);
    const closed = confirmedClosed(state, record, plotId);
    return (isInventoryHistorical(listing) && !closed) || (!closed && (!entry || entry.status !== "deleted"))
      || control?.premiumPlacement || (control?.manualLock && listing.status !== "deleted");
  }).length;
  return { state: ids.length === 4 && remaining === 0 && nextAddress && readyPair ? "ready" : "active",
    currentPool, nextPool, remaining, cycle: Number(rotation.cycle) || 0 };
}

export function snapshotAddressRotation(state, plotId, listings, at = new Date().toISOString(), options = {}) {
  const status = addressRotationStatus(state, plotId, options);
  if (status.state !== "ready" || listings.length !== 4) throw new Error("Für den nächsten Adresszyklus fehlen die Freigabe oder vier Hausinserate.");
  if (new Set(listings.map((listing) => listing.id)).size !== 4
    || listings.some((listing) => (state.plots.find((plot) => plot.id === plotId)?.addressRotation?.listingIds || []).includes(listing.id))) {
    throw new Error("Der neue Zyklus benötigt vier neue, eindeutige Inserate.");
  }
  const pool = status.nextPool;
  const cycle = status.cycle + 1;
  const plot = state.plots.find((item) => item.id === plotId);
  const address = structuredClone(pool === "A" ? plot.addressRotation.poolA : plot.addressRotation.poolB);
  const entries = (state.deleteBatches || []).flatMap((batch) => batch.entries || []);
  const nextListings = listings.map((listing, index) => {
    const entry = entries.find((item) => item.listingId === listing.id && item.externalId === listing.externalId);
    if (!entry || entry.status !== "planned") throw new Error(`Für Haus ${index + 1} fehlt ein neuer geplanter Lösch-Batch.`);
    return { ...listing, addressSnapshot: { plotId, pool, cycle, housePosition: index + 1,
      address, batchId: entry.batchId, plannedDeletionDate: entry.plannedDeletionDate } };
  });
  return { pool, cycle, address, listings: nextListings, rotation: {
    ...plot.addressRotation, currentPool: pool, cycle, listingIds: nextListings.map((item) => item.id),
    [pool === "A" ? "lastUsedA" : "lastUsedB"]: at,
  } };
}
