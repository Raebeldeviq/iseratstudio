import { isInventoryHistorical, isManagerRemoved } from "./inventory-correction.mjs";
import { normalizeWorkflowStatus } from "./workflow-status.mjs";
export function filterManagedListingsByObjectNumber(entries, query) {
  const needle = String(query || "").trim().toLocaleLowerCase("de-DE");
  if (!needle) return entries;
  return entries.filter(({ listing }) =>
    String(listing.externalId || "").toLocaleLowerCase("de-DE").includes(needle));
}

export const MANAGER_STATUS_FILTERS = [
  ["all", "Alle"], ["active", "Aktive Inserate"], ["reset", "Reset-Archiv"], ["failed", "Fehlgeschlagen"], ["corrected", "Bestandskorrekturen"],
];
export function filterManagedListings(entries, query, status = "all") {
  return filterManagedListingsByObjectNumber(entries, query).filter(entry => {
    if (isManagerRemoved(entry.listing)) return false;
    const lifecycle = normalizeWorkflowStatus(entry.listing.status, "blocked");
    if (status === "reset") return Boolean(entry.archiveId);
    if (status === "failed") return lifecycle === "failed";
    if (status === "corrected") return isInventoryHistorical(entry.listing);
    if (status === "active") return !entry.archiveId && !isInventoryHistorical(entry.listing) && !["archived", "deleted", "failed"].includes(lifecycle);
    return true;
  });
}
