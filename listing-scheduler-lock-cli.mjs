#!/usr/bin/env node

import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createCatalogStateStore } from "./catalog-state-store.mjs";
import { createListingRotationOperatingModeStore } from "./listing-rotation-operating-mode.mjs";
import { createProductionDeleteModeStore } from "./listing-rotation-production-delete.mjs";
import { normalizeListingScheduler } from "./listing-scheduler.mjs";
import { APPLICATION_DATA_DIRECTORY } from "./platform-paths.mjs";
import { createPersistentLease } from "./persistent-lease.mjs";
import { createStructuredFileLogger } from "./structured-log.mjs";
import { WORKFLOW_STATUS } from "./workflow-status.mjs";

export const LISTING_SCHEDULER_LOCK_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-scheduler.lock");
const ROTATION_MODE_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-mode.json");
const DELETE_MODE_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-production-delete-mode.json");
const SCHEDULER_LOG_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-scheduler.log");

function parseArguments(argv) {
  const [command = "status", ...rest] = argv;
  const parsed = { command, expectedSchedulerRunId: "", expectedOwnerId: "" };
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === "--expected-run-id") parsed.expectedSchedulerRunId = String(rest[++index] || "").trim();
    else if (rest[index] === "--expected-owner-id") parsed.expectedOwnerId = String(rest[++index] || "").trim();
    else throw new Error(`Unbekanntes Argument: ${rest[index]}`);
  }
  if (!new Set(["status", "reconcile-stale"]).has(command)) {
    throw new Error("Erlaubte Befehle: status, reconcile-stale.");
  }
  if (command === "reconcile-stale" && (!parsed.expectedSchedulerRunId || !parsed.expectedOwnerId)) {
    throw new Error("Die kontrollierte Stale-Reconciliation verlangt --expected-run-id und --expected-owner-id.");
  }
  return parsed;
}

function publicLock(record) {
  if (!record) return null;
  return {
    format: Number(record.format) || 0,
    leaseVersion: Number(record.leaseVersion) || 0,
    revision: Number(record.revision) || 0,
    schedulerRunId: String(record.schedulerRunId || record.token || ""),
    ownerId: String(record.ownerId || ""),
    ownerPid: Number(record.ownerPid) || Number(String(record.ownerId || "").match(/:(\d+)$/u)?.[1]) || null,
    runtimeIdentity: String(record.runtimeIdentity || ""),
    startedAt: String(record.startedAt || ""),
    updatedAt: String(record.updatedAt || ""),
    expiresAt: String(record.expiresAt || ""),
  };
}

function schedulerRun(state, runId, now) {
  return normalizeListingScheduler(state.scheduler, { now }).runs.find((run) => run.id === runId) || null;
}

export async function runListingSchedulerLockCli(argv, options = {}) {
  const parsed = parseArguments(argv);
  const now = String(options.now?.() || new Date().toISOString());
  const store = options.store || createCatalogStateStore();
  const rotationModeStore = options.rotationModeStore || createListingRotationOperatingModeStore(ROTATION_MODE_PATH);
  const deleteModeStore = options.deleteModeStore || createProductionDeleteModeStore(DELETE_MODE_PATH);
  const writeLog = options.writeLog || createStructuredFileLogger(SCHEDULER_LOG_PATH, { jobType: "listing-rotation-scheduler" });
  const lease = options.lease || createPersistentLease(options.lockPath || LISTING_SCHEDULER_LOCK_PATH, {
    isOwnerActive: options.isOwnerActive,
    writeEvent: (event, details) => writeLog(`lease-${event}`, details),
  });
  const [lock, snapshot, rotationMode, deleteMode] = await Promise.all([
    lease.read(),
    store.load(),
    rotationModeStore.load(),
    deleteModeStore.load(),
  ]);
  const lockRunId = String(lock?.schedulerRunId || lock?.token || "");
  const run = snapshot?.stored && snapshot.state && lockRunId
    ? schedulerRun(snapshot.state, lockRunId, now)
    : null;
  const status = {
    lock: publicLock(lock),
    persistentRun: run ? {
      id: run.id,
      status: run.status,
      startedAt: run.startedAt,
      endedAt: run.endedAt || "",
      trigger: run.trigger || "",
      abortReason: run.abortReason || "",
    } : null,
    rotationMode: rotationMode.mode,
    productionDeleteMode: deleteMode.mode,
  };
  if (parsed.command === "status") return status;
  if (rotationMode.valid !== true || rotationMode.mode !== "off" || deleteMode.valid !== true || deleteMode.mode !== "off") {
    throw new Error("Rotation und Production-DELETE müssen für die Stale-Reconciliation gültig auf off stehen.");
  }
  if (!snapshot?.stored || !snapshot.state) throw new Error("Der persistente Katalogzustand ist nicht lesbar.");
  if (lockRunId !== parsed.expectedSchedulerRunId || String(lock?.ownerId || "") !== parsed.expectedOwnerId) {
    throw new Error("Der vorhandene Lock stimmt nicht mit dem exakten Reconciliation-Vertrag überein.");
  }

  const reconciled = await lease.reconcileStale({
    now,
    expectedSchedulerRunId: parsed.expectedSchedulerRunId,
    expectedOwnerId: parsed.expectedOwnerId,
    reconciliationId: `scheduler-run-${parsed.expectedSchedulerRunId}`,
    assessStaleOwner: async () => {
      const current = await store.load();
      if (!current?.stored || !current.state) return { recoverable: false, reason: "Katalogzustand nicht lesbar." };
      const previousRun = schedulerRun(current.state, parsed.expectedSchedulerRunId, now);
      if (!previousRun) {
        return { recoverable: true, reason: "Owner inaktiv, Lease abgelaufen und kein persistierter mutierender Scheduler-Run vorhanden." };
      }
      const interrupted = previousRun.status === WORKFLOW_STATUS.PROCESSING && !previousRun.endedAt;
      const terminal = previousRun.status !== WORKFLOW_STATUS.PROCESSING && Boolean(previousRun.endedAt);
      return {
        recoverable: interrupted || terminal,
        reason: interrupted
          ? "Owner inaktiv und Lease abgelaufen; persistierter Scheduler-Run ist nach Helper-Ende eindeutig unterbrochen."
          : terminal
            ? "Owner inaktiv, Lease abgelaufen und persistierter Scheduler-Run terminal."
            : "Persistierter Scheduler-Run ist nicht eindeutig stale.",
      };
    },
  });

  if (reconciled.reconciled) {
    await store.update((state) => {
      const scheduler = normalizeListingScheduler(state.scheduler, { now });
      const runs = scheduler.runs.map((entry) => entry.id === parsed.expectedSchedulerRunId
        ? {
            ...entry,
            status: WORKFLOW_STATUS.FAILED,
            statusMessage: "Verwaister Scheduler-Claim kontrolliert reconciliert",
            endedAt: entry.endedAt || now,
            abortReason: entry.abortReason || "Helper-Prozess beendet; abgelaufener Lock nach Owner-/Run-Prüfung entfernt.",
            error: entry.error || "Persistenter Scheduler-Claim nach Helper-Ende kontrolliert reconciliert.",
            errorCount: Math.max(1, Number(entry.errorCount) || 0),
          }
        : entry);
      return {
        ...state,
        scheduler: {
          ...scheduler,
          runs,
          lastStatus: WORKFLOW_STATUS.FAILED,
          lastStatusMessage: "Verwaister Scheduler-Claim kontrolliert reconciliert",
          lastError: "",
          updatedAt: now,
        },
      };
    }, { now });
  }
  return { ...status, reconciliation: reconciled, lockAfter: publicLock(await lease.read()) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runListingSchedulerLockCli(process.argv.slice(2)).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error?.code ? `${error.code}: ` : ""}${error instanceof Error ? error.message : "Scheduler-Lock-Prüfung fehlgeschlagen."}\n`);
    process.exitCode = 1;
  });
}
