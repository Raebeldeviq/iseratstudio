import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { readSheet } from "read-excel-file/node";
import {
  commitCatalogSnapshot,
  loadCatalogManifest,
  startCatalogSnapshot,
} from "./catalog-store.mjs";
import { applyPlotSyncRows, parsePlotSyncRows } from "./plot-excel-sync.mjs";
import { PLOT_SYNC_CONFIG } from "./plot-sync-config.mjs";
import { loadPlotTerritory } from "./plot-territory-source.mjs";
import { localDateKey, nextPlotSyncAt } from "./plot-sync-schedule.mjs";
import { createStructuredFileLogger } from "./structured-log.mjs";

const LOCK_STALE_MS = 30 * 60 * 1000;
const HISTORY_LIMIT = 20;

function isMissing(error) {
  return error && typeof error === "object" && error.code === "ENOENT";
}

async function sha256File(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (isMissing(error)) return fallback;
    throw error;
  }
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

function publicConfig(config) {
  return {
    sourcePath: config.sourcePath,
    worksheet: config.worksheet,
    intervalDays: config.intervalDays,
    hour: config.hour,
    minute: config.minute,
    timeZone: config.timeZone,
  };
}

function emptyStatus(config) {
  return {
    config: publicConfig(config),
    sourceFound: false,
    running: false,
    lastRun: null,
    lastSuccessfulRun: null,
    nextScheduledRunAt: "",
    scheduleAnchorLocalDate: "",
    history: [],
    catalogSavedAt: "",
  };
}

function errorCode(error) {
  if (isMissing(error)) return "SOURCE_NOT_FOUND";
  return String(error?.code || "PLOT_SYNC_FAILED").slice(0, 100);
}

function errorMessage(error) {
  if (isMissing(error)) return "Die konfigurierte Excel-Quelldatei wurde nicht gefunden.";
  return error instanceof Error ? error.message : "Der Grundstücksabgleich ist fehlgeschlagen.";
}

export function createPlotSyncService(options = {}) {
  const config = { ...PLOT_SYNC_CONFIG, ...(options.config || {}) };
  const dependencies = {
    readWorkbook: options.readWorkbook || ((path) => readSheet(path, { sheet: config.worksheet })),
    loadCatalog: options.loadCatalog || (() => loadCatalogManifest()),
    startCatalog: options.startCatalog || ((input) => startCatalogSnapshot(input)),
    commitCatalog: options.commitCatalog || ((sessionId) => commitCatalogSnapshot(sessionId)),
    fileHash: options.fileHash || sha256File,
    fileStat: options.fileStat || stat,
    loadTerritory: options.loadTerritory || (() => loadPlotTerritory(config.sourcePath)),
    now: options.now || (() => new Date().toISOString()),
  };
  const writeLog = options.writeLog || createStructuredFileLogger(config.logPath, { jobType: "plot-excel-sync" });
  let currentRun = null;

  async function loadStatus() {
    const saved = await readJson(config.statePath, emptyStatus(config));
    let scheduleEnabled = false;
    try { scheduleEnabled = (await readJson(`${config.statePath}.schedule.json`, null))?.enabled === true; } catch { /* Invalid schedule configuration is paused. */ }
    let sourceFound = false;
    try {
      const info = await dependencies.fileStat(config.sourcePath);
      sourceFound = info.isFile();
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    const territory = await dependencies.loadTerritory();
    return { ...emptyStatus(config), ...saved, config: publicConfig(config), sourceFound, running: Boolean(currentRun), scheduleEnabled, territory };
  }

  async function acquireLock() {
    await mkdir(dirname(config.lockPath), { recursive: true });
    try {
      const handle = await open(config.lockPath, "wx", 0o600);
      await handle.writeFile(JSON.stringify({ processId: process.pid, startedAt: dependencies.now() }));
      await handle.close();
      return async () => rm(config.lockPath, { force: true });
    } catch (error) {
      if (!error || typeof error !== "object" || error.code !== "EEXIST") throw error;
      const info = await dependencies.fileStat(config.lockPath).catch(() => null);
      if (info && Date.now() - info.mtimeMs > LOCK_STALE_MS) {
        await rm(config.lockPath, { force: true });
        return acquireLock();
      }
      const locked = new Error("Ein Grundstücksabgleich läuft bereits.");
      locked.code = "PLOT_SYNC_LOCKED";
      locked.httpStatus = 409;
      throw locked;
    }
  }

  async function perform({ dryRun = false, trigger = "manual" } = {}) {
    const release = await acquireLock();
    const startedAt = dependencies.now();
    const startMs = Date.now();
    let status = await loadStatus();
    let report;
    try {
      const sourceBefore = await dependencies.fileStat(config.sourcePath);
      if (!sourceBefore.isFile()) throw new Error("Der konfigurierte Quellpfad ist keine Datei.");
      const hashBefore = await dependencies.fileHash(config.sourcePath);
      const workbookRows = await dependencies.readWorkbook(config.sourcePath);
      const rows = parsePlotSyncRows(workbookRows);
      const manifest = await dependencies.loadCatalog();
      if (!manifest.stored || !manifest.state) throw new Error("Der lokale App-Katalog wurde nicht gefunden.");
      const result = applyPlotSyncRows(manifest.state, rows, { now: startedAt });
      const hashAfterRead = await dependencies.fileHash(config.sourcePath);
      if (hashAfterRead !== hashBefore) {
        const changed = new Error("Die Excel-Quelldatei wurde während des Lesens verändert; der Lauf wurde ohne Datenänderung abgebrochen.");
        changed.code = "SOURCE_CHANGED_DURING_READ";
        throw changed;
      }

      let catalogSavedAt = manifest.savedAt || "";
      if (!dryRun) {
        const sessionId = `plot_sync_${randomUUID().replaceAll("-", "_")}`;
        catalogSavedAt = startedAt;
        const snapshot = await dependencies.startCatalog({
          sessionId,
          savedAt: catalogSavedAt,
          expectedSavedAt: manifest.savedAt || "",
          state: result.state,
        });
        if (snapshot.missingImageIds?.length) {
          const missing = new Error(`Der Katalog enthält ${snapshot.missingImageIds.length} nicht verfügbare Bilddateien; der Abgleich wurde nicht gespeichert.`);
          missing.code = "CATALOG_IMAGES_MISSING";
          throw missing;
        }
        await dependencies.commitCatalog(sessionId);
      }
      const hashAfter = await dependencies.fileHash(config.sourcePath);
      if (hashAfter !== hashBefore) {
        const changed = new Error("Die Excel-Quelldatei hat sich während des Laufs geändert.");
        changed.code = "SOURCE_CHANGED_DURING_RUN";
        throw changed;
      }

      report = {
        id: randomUUID(),
        startedAt,
        finishedAt: dependencies.now(),
        trigger,
        dryRun,
        sourcePath: config.sourcePath,
        sourceFound: true,
        sourceUnchanged: true,
        sourceBytes: sourceBefore.size,
        ...result.stats,
        errors: result.errors,
        warnings: result.warnings,
        durationMs: Date.now() - startMs,
        status: result.status,
        message: dryRun ? "Dry-Run abgeschlossen; der Katalog blieb unverändert." : "Grundstücksabgleich abgeschlossen.",
        catalogSavedAt,
      };
      if (!dryRun) {
        const initializesSchedule = !status.scheduleAnchorLocalDate;
        const scheduledRun = trigger === "scheduled";
        if (initializesSchedule || scheduledRun) {
          status.scheduleAnchorLocalDate = localDateKey(startedAt, config.timeZone);
          status.nextScheduledRunAt = nextPlotSyncAt(status.scheduleAnchorLocalDate, config);
        }
        status.catalogSavedAt = catalogSavedAt;
      }
      if (!dryRun && (result.status === "success" || result.status === "partial")) status.lastSuccessfulRun = report;
    } catch (error) {
      report = {
        id: randomUUID(),
        startedAt,
        finishedAt: dependencies.now(),
        trigger,
        dryRun,
        sourcePath: config.sourcePath,
        sourceFound: !isMissing(error),
        sourceUnchanged: true,
        rowsRead: 0,
        created: 0,
        updated: 0,
        deactivated: 0,
        skipped: 0,
        duplicatesPrevented: 0,
        failed: 1,
        errors: [{ excelRow: 0, sourceInternalId: "", listingUrl: "", reason: errorMessage(error) }],
        warnings: [],
        durationMs: Date.now() - startMs,
        status: "failed",
        errorCode: errorCode(error),
        message: errorMessage(error),
        catalogSavedAt: status.catalogSavedAt || "",
      };
    } finally {
      await release();
    }

    if (!dryRun && !status.scheduleAnchorLocalDate && (trigger === "startup" || trigger === "scheduled")) {
      status.scheduleAnchorLocalDate = localDateKey(startedAt, config.timeZone);
      status.nextScheduledRunAt = nextPlotSyncAt(status.scheduleAnchorLocalDate, config);
    }

    status = {
      ...status,
      config: publicConfig(config),
      sourceFound: report.sourceFound,
      running: false,
      lastRun: report,
      history: [...(status.history || []), report].slice(-HISTORY_LIMIT),
    };
    await atomicJson(config.statePath, status);
    await writeLog("completed", report);
    return { ...status, running: false };
  }

  async function run(optionsValue = {}) {
    if (currentRun) {
      const locked = new Error("Ein Grundstücksabgleich läuft bereits.");
      locked.code = "PLOT_SYNC_LOCKED";
      locked.httpStatus = 409;
      throw locked;
    }
    currentRun = perform(optionsValue);
    try {
      return await currentRun;
    } finally {
      currentRun = null;
    }
  }

  async function runIfDue() {
    const status = await loadStatus();
    if (!status.scheduleEnabled) return { ...status, pauseReason: 'Automatischer Excel-Abgleich pausiert; manuelle Vorschau bleibt verfügbar.' };
    if (!status.lastRun && !status.lastSuccessfulRun) return run({ dryRun: false, trigger: "startup" });
    if (status.nextScheduledRunAt && Date.parse(status.nextScheduledRunAt) <= Date.parse(dependencies.now())) {
      return run({ dryRun: false, trigger: "scheduled" });
    }
    return status;
  }

  async function lastLog() {
    const status = await loadStatus();
    return status.lastRun;
  }

  async function setScheduleEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Zeitplan benötigt eine eindeutige Freigabe.');
    if (currentRun) throw new Error('Bitte den laufenden Abgleich zuerst abschließen lassen.');
    await atomicJson(`${config.statePath}.schedule.json`, { format: 1, enabled, updatedAt: dependencies.now() });
    return loadStatus();
  }

  return { config, loadStatus, run, runIfDue, lastLog, setScheduleEnabled };
}
