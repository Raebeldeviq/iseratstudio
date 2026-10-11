export const INVENTORY_HISTORICAL_LABEL = "HISTORISCH / NICHT IM PORTAL";
export const isManagerRemoved = listing => Boolean(listing?.managerCleanup?.removedAt);
export const isInventoryHistorical = listing => listing?.inventoryCorrection?.active === true;

export function isInventoryEntryHistorical(state, entry) {
  const listings = [
    ...(state.projects?.find(project => project.id === entry.projectId)?.listings || []),
    ...(state.listingResetHistory || []).filter(archive => archive.projectId === entry.projectId).flatMap(archive => archive.listings || []),
  ];
  return listings.some(listing => listing.id === entry.listingId && listing.externalId === entry.externalId && (isInventoryHistorical(listing) || isManagerRemoved(listing)));
}

export function assertInventoryUploadAllowed(listing) {
  if (isInventoryHistorical(listing) || isManagerRemoved(listing)) throw new Error("Historischer Bestand: Korrektur vor einer erneuten Verwendung ausdrücklich rückgängig machen.");
}

// Only the dedicated helper action may write this audit trail. No portal/FTPS calls.
export function correctListingInventory(state, input, at = new Date().toISOString()) {
  if (!["exclude", "restore"].includes(input.action)) throw new Error("Unbekannte Bestandskorrektur.");
  const project = state.projects?.find(item => item.id === input.projectId);
  const archive = input.archiveId ? state.listingResetHistory?.find(item => item.id === input.archiveId && item.projectId === input.projectId) : null;
  const owner = input.archiveId ? archive : project;
  const matches = owner?.listings?.filter(item => item.id === input.listingId && item.externalId === input.externalId) || [];
  if (matches.length !== 1) throw new Error("Inserats-ID und Objektnummer stimmen nicht eindeutig überein.");
  const listing = matches[0];
  if (isManagerRemoved(listing)) throw new Error("Aus dem Manager entfernte Einträge dürfen nicht reaktiviert werden.");
  const previous = listing.inventoryCorrection;
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== (previous?.history?.length || 0)) throw new Error("Die Bestandskorrektur wurde inzwischen geändert. Bitte neu laden.");
  const active = input.action === "exclude";
  if (isInventoryHistorical(listing) === active) return state;
  if (["processing", "uploading", "scheduled"].includes(listing.status)) throw new Error("Ein laufender Vorgang muss vor der Bestandskorrektur abgeschlossen sein.");
  const reason = active ? String(input.reason || "Nicht im Portal vorhanden / Duplikat").trim().slice(0, 500) : "Korrektur rückgängig gemacht";
  if (!reason) throw new Error("Ein Korrekturgrund ist erforderlich.");
  const inventoryCorrection = { active, reason: active ? reason : previous.reason,
    correctedAt: active ? at : previous.correctedAt, reversedAt: active ? "" : at,
    history: [...(previous?.history || []), { action: input.action, at, reason, externalId: listing.externalId }] };
  const updated = { ...listing, inventoryCorrection };
  const updateOwner = item => ({ ...item,
    listings: item.listings.map(old => old.id === listing.id ? updated : old),
    ...(item.listingGroup ? { listingGroup: { ...item.listingGroup,
      variants: (item.listingGroup.variants || []).map(variant => variant.listing?.id === listing.id ? { ...variant, listing: { ...variant.listing, inventoryCorrection } } : variant) } } : {}),
  });
  return archive ? { ...state, listingResetHistory: state.listingResetHistory.map(item => item === archive ? updateOwner(item) : item) }
    : { ...state, projects: state.projects.map(item => item === project ? updateOwner(item) : item) };
}

export function assertInventoryCorrectionTransition(current, next) {
  const all = state => [...(state?.projects || []).flatMap(project => (project.listings || []).map(listing => ({ projectId: project.id, listing }))),
    ...(state?.listingResetHistory || []).flatMap(archive => (archive.listings || []).map(listing => ({ projectId: archive.projectId, listing })))];
  const key = item => JSON.stringify([item.projectId, item.listing.id]);
  const audit = listing => listing.inventoryCorrection || listing.managerCleanup ? [listing.inventoryCorrection, listing.managerCleanup] : undefined;
  const before = new Map(all(current).map(item => [key(item), audit(item.listing)]));
  const after = new Map(all(next).map(item => [key(item), audit(item.listing)]));
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    if (JSON.stringify(before.get(id)) !== JSON.stringify(after.get(id))) throw new Error("Bestandskorrekturen und Manager-Bereinigungen dürfen nur über die ausdrückliche Korrekturaktion geändert werden.");
  }
}
