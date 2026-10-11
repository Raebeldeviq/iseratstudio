import { isInventoryHistorical, isManagerRemoved } from "./inventory-correction.mjs";
import { normalizeWorkflowStatus } from "./workflow-status.mjs";

export const managerEntryKey = entry => JSON.stringify([entry.project.id, entry.archiveId || "", entry.listing.id]);
const matches = (item, entry) => item.listingId === entry.listing.id && (!item.projectId || item.projectId === entry.project.id);
const controlFor = entry => (entry.group?.listingControls || []).find(item => item.listingId === entry.listing.id);
const uploadEvidence = (state, entry) => (state.uploadHistory || []).filter(item => matches(item, entry));
const batchEvidence = (state, entry) => (state.deleteBatches || []).flatMap(batch => batch.entries || [])
  .filter(item => matches(item, entry) && item.externalId === entry.listing.externalId);

export function managerCleanupEligibility(state, entry) {
  const listing = entry.listing, control = controlFor(entry);
  const blocked = reason => ({ allowed: false, reason });
  if (isManagerRemoved(listing)) return blocked("Bereits aus dem Manager entfernt.");
  const status = normalizeWorkflowStatus(listing.status, "blocked");
  if (["scheduled", "processing", "uploading", "queued"].includes(listing.status)
    || ["scheduled", "processing"].includes(status) || control?.processLease || control?.pendingRotationJobId
    || ["scheduled", "processing"].includes(normalizeWorkflowStatus(control?.status, "blocked"))) return blocked("Laufender oder eingeplanter Vorgang.");
  if (control?.premiumPlacement) return blocked("Premium-geschütztes Inserat.");
  if (isInventoryHistorical(listing)) return { allowed: true, reason: "Bestandskorrektur: nicht im Portal vorhanden / Duplikat" };
  if (status === "deleted" && listing.deletedAt && !listing.externalDeletionPending) return { allowed: true, reason: "Löschung bereits bestätigt" };
  if (control?.manualLock) return blocked("Inserat manuell geschützt.");
  if (listing.transferredAt || listing.lastUploadedAt || listing.importConfirmedAt || listing.externalDeletionPending
    || listing.importReportId || listing.legacyProviderVerifiedAt || listing.lastUploadJobId
    || ["published", "transferred_pending_import"].includes(status)
    || ["published", "transferred_pending_import"].includes(normalizeWorkflowStatus(control?.status, "blocked"))
    || uploadEvidence(state, entry).length || batchEvidence(state, entry).some(item => item.status === "active" || (item.status === "paused" && item.pausedFrom === "active"))) return blocked("Portalbestand oder Übertragungsstand noch ungeklärt. Zuerst Bestand prüfen.");
  if (["failed", "archived"].includes(status) || (entry.archiveId && ["draft", "prepared"].includes(status))) {
    return { allowed: true, reason: status === "failed" ? "Fehlgeschlagener Entwurf ohne Übertragungsbeleg" : "Inaktiver Eintrag ohne Übertragungsbeleg" };
  }
  return blocked("Aktives oder vorbereitetes Inserat.");
}

export function managerCleanupRevision(state, entry) {
  const control = controlFor(entry);
  // The browser normalizes stored controls; compare operational fields with the same defaults.
  const controlEvidence = { premiumPlacement: Boolean(control?.premiumPlacement), manualLock: Boolean(control?.manualLock),
    processLease: control?.processLease || null, pendingRotationJobId: control?.pendingRotationJobId || "",
    status: normalizeWorkflowStatus(control?.status, "draft") };
  return JSON.stringify([entry.listing.status, entry.listing.externalId, entry.listing.transferredAt, entry.listing.lastUploadedAt,
    entry.listing.importConfirmedAt, entry.listing.deletedAt, entry.listing.externalDeletionPending,
    entry.listing.inventoryCorrection, entry.listing.managerCleanup, controlEvidence, uploadEvidence(state, entry), batchEvidence(state, entry)]);
}

export function removeManagerListings(state, input, at = new Date().toISOString()) {
  if (!Array.isArray(input?.entries) || !input.entries.length || input.entries.length > 1000) throw new Error("Bitte 1 bis 1000 historische Inserate auswählen.");
  const seen = new Set(), pending = [];
  for (const request of input.entries) {
    const owner = request.archiveId ? state.listingResetHistory?.find(item => item.id === request.archiveId && item.projectId === request.projectId)
      : state.projects?.find(item => item.id === request.projectId);
    const found = owner?.listings?.filter(item => item.id === request.listingId && item.externalId === request.externalId) || [];
    if (found.length !== 1) throw new Error("Inserats-ID, Archiv und Objektnummer sind nicht mehr eindeutig. Bitte neu laden.");
    const entry = { project: { id: request.projectId }, archiveId: request.archiveId || "", listing: found[0], group: owner.listingGroup };
    const key = managerEntryKey(entry);
    if (seen.has(key)) throw new Error("Ein Inserat wurde mehrfach ausgewählt.");
    seen.add(key);
    if (isManagerRemoved(entry.listing)) continue;
    const eligibility = managerCleanupEligibility(state, entry);
    if (!eligibility.allowed) throw new Error(`Objekt ${entry.listing.externalId}: ${eligibility.reason} Keine Einträge entfernt.`);
    if (request.expectedRevision !== managerCleanupRevision(state, entry)) throw new Error(`Objekt ${entry.listing.externalId} wurde inzwischen geändert. Bitte neu laden. Keine Einträge entfernt.`);
    pending.push({ ...entry, reason: eligibility.reason });
  }
  if (!pending.length) return state;
  const operationId = globalThis.crypto.randomUUID();
  const patches = new Map(pending.map(entry => [managerEntryKey(entry), { removedAt: at, operationId, reason: entry.reason,
    externalId: entry.listing.externalId, source: "manual-manager-bulk-cleanup" }]));
  const updateOwner = (owner, projectId, archiveId = "") => {
    const patchListing = listing => {
      const managerCleanup = patches.get(managerEntryKey({ project: { id: projectId }, archiveId, listing }));
      return managerCleanup ? { ...listing, managerCleanup } : listing;
    };
    if (!pending.some(entry => entry.project.id === projectId && entry.archiveId === archiveId)) return owner;
    return { ...owner, listings: owner.listings.map(patchListing), ...(owner.listingGroup ? { listingGroup: { ...owner.listingGroup,
      variants: (owner.listingGroup.variants || []).map(variant => variant.listing ? { ...variant, listing: patchListing(variant.listing) } : variant) } } : {}) };
  };
  return { ...state, projects: state.projects.map(project => updateOwner(project, project.id)),
    ...(state.listingResetHistory ? { listingResetHistory: state.listingResetHistory.map(archive => updateOwner(archive, archive.projectId, archive.id)) } : {}) };
}
