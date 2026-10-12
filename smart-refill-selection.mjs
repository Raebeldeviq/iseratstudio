import { isInventoryHistorical, isManagerRemoved } from './inventory-correction.mjs';

export function preparedRefillRows(state, plan) {
  const pending = new Set(plan.preparedListingIds);
  return plan.cycles.flatMap(cycle => cycle.listingIds.filter(id => pending.has(id)).flatMap(id => {
    const project = state.projects.find(item => item.id === cycle.projectId);
    const listing = project?.listings.find(item => item.id === id);
    if (!listing) return [];
    const archiveCount = (state.listingResetHistory || []).filter(archive => archive.plotId === cycle.plotId)
      .flatMap(archive => archive.listings || []).filter(old => !isInventoryHistorical(old) && !isManagerRemoved(old)
        && !(old.status === 'deleted' && !old.externalDeletionPending)
        && Boolean(old.transferredAt || old.lastUploadedAt || old.importConfirmedAt
          || ['published', 'transferred_pending_import', 'uploading', 'processing', 'queued'].includes(old.status))).length;
    const address = listing.addressSnapshot?.address;
    const addressLabel = address ? `${address.street} ${address.houseNumber}, ${address.postalCode} ${address.city}` : project.name;
    return [{ listing, cycle, addressLabel, archiveCount }];
  }));
}

export function filterPreparedRefillRows(rows, query = '') {
  const search = String(query).trim().toLocaleLowerCase('de-DE');
  return rows.filter(row => !search || `${row.listing.externalId} ${row.addressLabel}`.toLocaleLowerCase('de-DE').includes(search));
}

// Bulk selection skips unresolved archives; choosing such an item individually is explicit.
export function selectFilteredRefillIds(selectedIds, rows) {
  return [...new Set([...selectedIds, ...rows.filter(row => !row.archiveCount).map(row => row.listing.id)])];
}

export function requireRefillUploadSelection(pendingIds, selectedIds) {
  if (!Array.isArray(selectedIds) || !selectedIds.length) throw new Error('Bitte mindestens ein vorbereitetes Inserat auswählen.');
  if (selectedIds.some(id => typeof id !== 'string' || !id) || new Set(selectedIds).size !== selectedIds.length)
    throw new Error('Die Inseratsauswahl enthält ungültige oder doppelte IDs.');
  const pending = new Set(pendingIds);
  if (selectedIds.some(id => !pending.has(id))) throw new Error('Ein ausgewähltes Inserat ist nicht mehr vorbereitet oder wurde bereits übertragen. Bitte die Auswahl prüfen.');
  return [...selectedIds];
}
