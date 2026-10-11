export const INVENTORY_HISTORICAL_LABEL = "HISTORISCH / NICHT IM PORTAL";
export const isInventoryHistorical = listing => listing?.inventoryCorrection?.active === true;

export function isInventoryEntryHistorical(state, entry) {
  return isInventoryHistorical(state.projects?.find(project => project.id === entry.projectId)?.listings
    ?.find(listing => listing.id === entry.listingId && listing.externalId === entry.externalId));
}

export function assertInventoryUploadAllowed(listing) {
  if (isInventoryHistorical(listing)) throw new Error("Historischer Bestand: Korrektur vor einer erneuten Verwendung ausdrücklich rückgängig machen.");
}

// Only the dedicated helper action may write this audit trail. No portal/FTPS calls.
export function correctListingInventory(state, input, at = new Date().toISOString()) {
  if (!["exclude", "restore"].includes(input.action)) throw new Error("Unbekannte Bestandskorrektur.");
  const project = state.projects?.find(item => item.id === input.projectId);
  const matches = project?.listings?.filter(item => item.id === input.listingId && item.externalId === input.externalId) || [];
  if (matches.length !== 1) throw new Error("Inserats-ID und Objektnummer stimmen nicht eindeutig überein.");
  const listing = matches[0];
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
  return { ...state, projects: state.projects.map(item => item.id !== project.id ? item : { ...item,
    listings: item.listings.map(old => old.id === listing.id ? updated : old),
    ...(item.listingGroup ? { listingGroup: { ...item.listingGroup,
      variants: (item.listingGroup.variants || []).map(variant => variant.listing?.id === listing.id ? { ...variant, listing: updated } : variant) } } : {}),
  }) };
}

export function assertInventoryCorrectionTransition(current, next) {
  const all = state => [...(state?.projects || []).flatMap(project => (project.listings || []).map(listing => ({ projectId: project.id, listing }))),
    ...(state?.listingResetHistory || []).flatMap(archive => (archive.listings || []).map(listing => ({ projectId: archive.projectId, listing })))];
  const key = item => JSON.stringify([item.projectId, item.listing.id]);
  const before = new Map(all(current).map(item => [key(item), item.listing.inventoryCorrection]));
  const after = new Map(all(next).map(item => [key(item), item.listing.inventoryCorrection]));
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    if (JSON.stringify(before.get(id)) !== JSON.stringify(after.get(id))) throw new Error("Bestandskorrekturen dürfen nur über die ausdrückliche Korrekturaktion geändert werden.");
  }
}
