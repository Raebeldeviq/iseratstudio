import { removeManagerListings } from "./manager-cleanup.mjs";
import { confirmDeleteBatch, deleteBatchTrafficLight, linkDeleteBatchListings } from "./delete-batches.mjs";
import { recordRefillDeletions } from "./smart-refill.mjs";

// Shared by the authenticated helper and isolated HTTP integration tests.
// These actions only mutate the local catalog; no portal/FTPS dependencies.
export async function runCatalogManagementAction(store, pathname, body) {
  if (pathname === "/manager/cleanup") {
    const result = await store.update(state => removeManagerListings(state, body));
    return { ok: true, savedAt: result.savedAt, changed: result.changed };
  }
  if (pathname !== "/delete-batches/confirm") throw new Error("Unbekannte Katalogaktion.");
  const batchId = String(body.batchId || "");
  const expectedCount = Number(body.expectedCount);
  if (!batchId || !Number.isInteger(expectedCount) || expectedCount < 1) throw new Error("Ungültige Batchbestätigung.");
  const result = await store.update(state => {
    const batch = deleteBatchTrafficLight(state).find(item => item.id === batchId);
    if (!batch || batch.active.length !== expectedCount) throw new Error("Der Batch hat sich seit der Anzeige geändert. Bitte die Lösch-Ampel neu laden.");
    const confirmed = confirmDeleteBatch(state, batchId);
    return { state: recordRefillDeletions(linkDeleteBatchListings(state), confirmed.state), result: { deletedCount: confirmed.deletedCount } };
  });
  return { ok: true, savedAt: result.savedAt, deletedCount: result.result.deletedCount };
}
