import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PLOT_MASTER_PATH } from "./plot-active-catalog-source.mjs";
import { commitCatalogSnapshot, discardCatalogSnapshot, loadCatalogManifest, startCatalogSnapshot } from "./catalog-store.mjs";
import { reconcileMaster } from "./plot-master-sync.mjs";
import { createMasterWorkbook, readMasterWorkbook } from "./plot-master-workbook.mjs";

const hash = (value) => createHash("sha256").update(value || Buffer.alloc(0)).digest("hex");
const conflict = (message) => Object.assign(new Error(message), { httpStatus: 409, code: "MASTER_CHANGED" });
const unavailable = () => Object.assign(new Error("Excel momentan nicht erreichbar oder ohne gültige Grundstücke. Bitte erneut prüfen."), { httpStatus: 503, code: "MASTER_UNAVAILABLE" });
const key = (savedAt, bytes) => hash(`${savedAt || ""}:${hash(bytes)}`);

export function createPlotMasterService(options = {}) {
  const path = options.path || PLOT_MASTER_PATH;
  const readWorkbook = options.readWorkbook || readMasterWorkbook;
  const loadCatalog = options.loadCatalog || loadCatalogManifest;
  const stageCatalog = options.stageCatalog || startCatalogSnapshot;
  const commitCatalog = options.commitCatalog || commitCatalogSnapshot;
  const discardCatalog = options.discardCatalog || discardCatalogSnapshot;
  const now = options.now || (() => new Date().toISOString());
  const lockPath = `${path}.sync.lock`;

  async function load() {
    const [workbook, manifest] = await Promise.all([readAvailableWorkbook(), loadCatalog()]);
    if (!manifest.stored || !manifest.state) throw new Error("Der lokale Grundstückskatalog fehlt.");
    const result = reconcileMaster(manifest.state, workbook.poolA, workbook.poolB, {}, now());
    return { workbook, manifest, result, token: key(manifest.savedAt, workbook.bytes) };
  }

  async function readAvailableWorkbook() {
    let workbook;
    try { workbook = await readWorkbook(path); } catch { throw unavailable(); }
    if (!workbook?.bytes?.length || !workbook.poolA?.length || !Array.isArray(workbook.poolB)) throw unavailable();
    return workbook;
  }

  function publicPreview(data) {
    const counts = { import: 0, export: 0, update: 0, "missing-excel": 0, conflict: 0, "delete-excel": 0 };
    for (const item of data.result.items) counts[item.action] += 1;
    return { token: data.token, sourcePath: path, sourceFound: Boolean(data.workbook.bytes),
      counts, items: data.result.items };
  }

  async function acquire() {
    await mkdir(dirname(lockPath), { recursive: true });
    try {
      const handle = await open(lockPath, "wx", 0o600);
      await handle.close();
      return () => rm(lockPath, { force: true });
    } catch (error) {
      if (error?.code === "EEXIST") {
        const lock = await stat(lockPath).catch(() => null);
        if (lock && Date.now() - lock.mtimeMs > 30 * 60 * 1000) {
          await rm(lockPath, { force: true });
          return acquire();
        }
        throw conflict("Ein Master-Abgleich läuft bereits. Bitte erneut versuchen.");
      }
      throw error;
    }
  }

  async function preview() { return publicPreview(await load()); }

  async function apply(input = {}) {
    // Reject unreadable/empty Excel before creating a lock or staging any catalog.
    await load();
    const release = await acquire();
    let sessionId;
    let temporaryPath;
    let replaced = false;
    let originalBytes;
    try {
      const data = await load();
      if (!input.token || input.token !== data.token) throw conflict("Katalog oder Excel wurden seit der Vorschau geändert. Bitte die Vorschau neu öffnen.");
      const decisions = input.decisions && typeof input.decisions === "object" ? input.decisions : {};
      for (const [id, decision] of Object.entries(decisions)) {
        const action = data.result.items.find((item) => item.plotId === id)?.action;
        if (!((action === "conflict" && ["app", "excel", "keep"].includes(decision))
          || (action === "missing-excel" && ["keep", "remove-app"].includes(decision)))) {
          throw new Error(`Ungültige Entscheidung für plotId ${id}.`);
        }
      }
      const result = reconcileMaster(data.manifest.state, data.workbook.poolA, data.workbook.poolB, decisions, now());
      const workbookChanged = JSON.stringify(result.poolA) !== JSON.stringify(data.workbook.poolA)
        || JSON.stringify(result.poolB) !== JSON.stringify(data.workbook.poolB) || !data.workbook.bytes;
      const catalogChanged = JSON.stringify(result.state.plots) !== JSON.stringify(data.manifest.state.plots)
        || JSON.stringify(result.state.projects) !== JSON.stringify(data.manifest.state.projects);
      if (!workbookChanged && !catalogChanged) return { ...publicPreview(data), applied: false, catalogSavedAt: data.manifest.savedAt };
      sessionId = `master_sync_${randomUUID().replaceAll("-", "_")}`;
      const savedAt = now();
      if (catalogChanged) {
        const staged = await stageCatalog({ sessionId, savedAt, expectedSavedAt: data.manifest.savedAt || "",
          state: result.state, protectLifecycle: true });
        if (staged.missingImageIds?.length) throw new Error("Katalogbilder fehlen; der Abgleich wurde nicht gespeichert.");
      }
      if (workbookChanged) {
        const bytes = await createMasterWorkbook(result.poolA, result.poolB,
          data.workbook.rawA, data.workbook.rawB, data.workbook.bytes);
        temporaryPath = `${path}.${sessionId}.tmp`;
        await mkdir(dirname(path), { recursive: true });
        await writeFile(temporaryPath, bytes, { mode: 0o600 });
        const actual = await readAvailableWorkbook();
        if (hash(actual.bytes) !== hash(data.workbook.bytes)) throw conflict("Die Excel-Datei wurde während des Abgleichs geändert. Bitte neu prüfen.");
        originalBytes = data.workbook.bytes;
        await rename(temporaryPath, path);
        replaced = true;
      }
      if (catalogChanged) await commitCatalog(sessionId);
      return { ...publicPreview(data), applied: true, catalogSavedAt: catalogChanged ? savedAt : data.manifest.savedAt,
        workbookUpdated: workbookChanged };
    } catch (error) {
      if (replaced) {
        if (originalBytes) {
          const restorePath = `${path}.${sessionId}.restore`;
          await writeFile(restorePath, originalBytes, { mode: 0o600 });
          await rename(restorePath, path);
        }
        else await rm(path, { force: true });
      }
      throw error;
    } finally {
      if (temporaryPath) await rm(temporaryPath, { force: true });
      if (sessionId) await discardCatalog(sessionId).catch(() => undefined);
      await release();
    }
  }

  return { preview, apply };
}
