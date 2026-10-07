import { createHash, randomUUID } from "node:crypto";
import { loadCatalogManifest, startCatalogSnapshot, commitCatalogSnapshot, discardCatalogSnapshot } from "./catalog-store.mjs";
import { loadActivePlotCatalogSource } from "./plot-active-catalog-source.mjs";
import { approveActivePlotCatalog, catalogCleanupPreview } from "./plot-active-catalog.mjs";

export function createActivePlotCatalogService(options = {}) {
  const source = options.loadSource || loadActivePlotCatalogSource;
  const loadCatalog = options.loadCatalog || loadCatalogManifest;
  const start = options.start || startCatalogSnapshot;
  const commit = options.commit || commitCatalogSnapshot;
  const discard = options.discard || discardCatalogSnapshot;
  const now = options.now || (() => new Date().toISOString());
  let applying = false;
  async function preview() {
    const [data, manifest] = await Promise.all([source(), loadCatalog()]);
    if (!manifest.state) throw new Error("Der lokale Katalog fehlt.");
    const result = catalogCleanupPreview(manifest.state, data);
    const token = createHash("sha256").update(JSON.stringify([manifest.savedAt, manifest.state.plots, manifest.state.activePlotCatalog, data])).digest("hex");
    return { token, confirmed: Boolean(manifest.state.activePlotCatalog?.approvedAt), source: data,
      counts: { inside: result.inside.length, insideReview: result.review.filter(plot => result.inside.includes(plot)).length,
        outside: result.outside.length, removed: result.removed.length },
      removed: result.removed.map(plot => ({ id: plot.id, street: plot.street, houseNumber: plot.houseNumber, postalCode: plot.postalCode, city: plot.city })),
      state: manifest.state, savedAt: manifest.savedAt };
  }
  async function apply(input = {}) {
    if (applying) throw Object.assign(new Error("Eine Bereinigung läuft bereits."), { httpStatus: 409 });
    applying = true;
    const sessionId = `active_plots_${randomUUID().replaceAll("-", "_")}`;
    try {
      const data = await preview();
      if (input.confirmed !== true || !input.token || input.token !== data.token) throw Object.assign(new Error("Bitte die aktuelle Vorschau ausdrücklich bestätigen. Der Katalog oder die Quelldaten könnten sich geändert haben."), { httpStatus: 409 });
      const state = approveActivePlotCatalog(data.state, data.source, now());
      const staged = await start({ sessionId, state, savedAt: now(), expectedSavedAt: data.savedAt || "", protectLifecycle: true });
      if (staged.missingImageIds?.length) throw new Error("Katalogbilder fehlen; die Bereinigung wurde nicht gespeichert.");
      await commit(sessionId);
      return { applied: true };
    } finally {
      await discard(sessionId).catch(() => undefined);
      applying = false;
    }
  }
  return { source, preview: async () => { const data = await preview(); return { token: data.token, confirmed: data.confirmed, source: data.source, counts: data.counts, removed: data.removed }; }, apply };
}
