import {
  commitCatalogSnapshot,
  discardCatalogSnapshot,
  loadCatalogManifest,
  startCatalogSnapshot,
} from "./catalog-store.mjs";

function nextSavedAt(currentSavedAt, requestedAt) {
  const current = Date.parse(currentSavedAt || "");
  const requested = Date.parse(requestedAt || "");
  const value = Math.max(
    Number.isFinite(current) ? current + 1 : 0,
    Number.isFinite(requested) ? requested : Date.now(),
  );
  return new Date(value).toISOString();
}

export function createCatalogStateStore(options = {}) {
  const load = options.loadCatalogManifest || loadCatalogManifest;
  const start = options.startCatalogSnapshot || startCatalogSnapshot;
  const commit = options.commitCatalogSnapshot || commitCatalogSnapshot;
  const discard = options.discardCatalogSnapshot || discardCatalogSnapshot;
  const idFactory = options.idFactory || (() => globalThis.crypto.randomUUID());
  const maximumAttempts = Math.max(1, Number(options.maximumAttempts) || 5);

  return {
    async load() {
      return load();
    },
    async update(mutator, input = {}) {
      let lastConflict;
      for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
        const current = await load();
        if (!current?.stored || !current.state) {
          const error = new Error("Für den Inserat-Scheduler ist noch kein persistenter Katalog gespeichert.");
          error.code = "CATALOG_NOT_STORED";
          throw error;
        }
        const mutation = await mutator(current.state, {
          savedAt: current.savedAt,
          attempt,
        });
        const nextState = mutation?.state || mutation;
        const result = mutation?.state ? mutation.result : undefined;
        if (!nextState || nextState === current.state) {
          return { stored: true, savedAt: current.savedAt, state: current.state, result, changed: false };
        }
        const sessionId = `scheduler-${idFactory()}`;
        const savedAt = nextSavedAt(current.savedAt, input.now);
        try {
          await start({
            state: nextState,
            sessionId,
            savedAt,
            expectedSavedAt: current.savedAt,
          });
          await commit(sessionId);
          return { stored: true, savedAt, state: nextState, result, changed: true };
        } catch (error) {
          await discard(sessionId).catch(() => undefined);
          if (error?.code !== "CATALOG_CONFLICT") throw error;
          lastConflict = error;
        }
      }
      throw lastConflict || new Error("Der Katalog konnte nach mehreren Konfliktversuchen nicht aktualisiert werden.");
    },
  };
}
