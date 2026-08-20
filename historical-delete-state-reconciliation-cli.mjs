#!/usr/bin/env node

import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createCatalogStateStore } from "./catalog-state-store.mjs";
import { createDeleteCanaryLedger } from "./immoprofessional-delete-canary.mjs";
import {
  HISTORICAL_DELETE_RECONCILIATION,
  reconcileHistoricalDeleteStateInState,
  resolveHistoricalDeleteStateReconciliation,
} from "./historical-delete-state-reconciliation.mjs";
import { createListingRotationOperatingModeStore } from "./listing-rotation-operating-mode.mjs";
import {
  createProductionDeleteLedger,
  createProductionDeleteModeStore,
} from "./listing-rotation-production-delete.mjs";
import { APPLICATION_DATA_DIRECTORY } from "./platform-paths.mjs";
import { createStructuredFileLogger } from "./structured-log.mjs";
import { createUploadJobLedger } from "./upload-job-ledger.mjs";

const ROTATION_MODE_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-mode.json");
const PRODUCTION_DELETE_MODE_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-production-delete-mode.json");
const PRODUCTION_DELETE_LEDGER_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-production-delete-jobs.json");
const DELETE_CANARY_LEDGER_PATH = join(APPLICATION_DATA_DIRECTORY, "immoprofessional-delete-canary-jobs.json");
const UPLOAD_LEDGER_PATH = join(APPLICATION_DATA_DIRECTORY, "upload-jobs.json");
const SCHEDULER_LOCK_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-scheduler.lock");
const RECONCILIATION_LOG_PATH = join(APPLICATION_DATA_DIRECTORY, "historical-delete-state-reconciliation.log");

function cliError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseArguments(argv) {
  const [command = "status", ...rest] = argv;
  const parsed = { command, externalObjectNumber: "", reconciliationMode: "" };
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === "--external-id") parsed.externalObjectNumber = String(rest[++index] || "").trim();
    else if (rest[index] === "--reconciliation-mode") parsed.reconciliationMode = String(rest[++index] || "").trim();
    else throw new Error(`Unbekanntes Argument: ${rest[index]}`);
  }
  return parsed;
}

async function defaultSchedulerLockExists() {
  try {
    await access(SCHEDULER_LOCK_PATH, constants.F_OK);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function publicResult(result) {
  return {
    externalObjectNumber: result.eligibility.contract.externalObjectNumber,
    projectId: result.eligibility.contract.projectId,
    listingId: result.eligibility.contract.listingId,
    status: result.source?.status || result.eligibility.listing.status,
    automaticUpdateEnabled: result.source ? false : result.eligibility.control.automaticUpdateEnabled,
    deleteJobId: result.eligibility.canaryDeleteJob.deleteJobId,
    deleteReportHash: result.eligibility.canaryDeleteJob.providerReportHash,
    providerProcessedAt: result.eligibility.canaryDeleteJob.providerProcessedAt,
    idempotent: result.idempotent === true,
    changed: result.changed === true,
    externalMutation: false,
  };
}

export async function runHistoricalDeleteStateReconciliationCli(argv, options = {}) {
  const parsed = parseArguments(argv);
  const externalObjectNumber = parsed.externalObjectNumber || HISTORICAL_DELETE_RECONCILIATION.externalObjectNumber;
  const store = options.store || createCatalogStateStore();
  const rotationModeStore = options.rotationModeStore || createListingRotationOperatingModeStore(ROTATION_MODE_PATH);
  const productionDeleteModeStore = options.productionDeleteModeStore || createProductionDeleteModeStore(PRODUCTION_DELETE_MODE_PATH);
  const uploadLedger = options.uploadLedger || createUploadJobLedger(UPLOAD_LEDGER_PATH);
  const productionDeleteLedger = options.productionDeleteLedger || createProductionDeleteLedger(PRODUCTION_DELETE_LEDGER_PATH);
  const canaryDeleteLedger = options.canaryDeleteLedger || createDeleteCanaryLedger(DELETE_CANARY_LEDGER_PATH);
  const schedulerLockExists = options.schedulerLockExists || defaultSchedulerLockExists;
  const now = options.now || (() => new Date().toISOString());
  const writeLog = options.writeLog || createStructuredFileLogger(RECONCILIATION_LOG_PATH, {
    jobType: "historical-delete-state-reconciliation",
  });
  const [rotationMode, productionDeleteMode] = await Promise.all([
    rotationModeStore.load(),
    productionDeleteModeStore.load(),
  ]);
  if (
    rotationMode.valid !== true || rotationMode.mode !== "off"
    || productionDeleteMode.valid !== true || productionDeleteMode.mode !== "off"
  ) {
    throw cliError(
      "HISTORICAL_DELETE_MODES_NOT_OFF",
      "Rotation und Production-DELETE müssen für die interne Reconciliation gültig auf off stehen.",
    );
  }
  if (await schedulerLockExists()) {
    throw cliError(
      "HISTORICAL_DELETE_SCHEDULER_LOCKED",
      "Während eines aktiven Scheduler-Claims darf die historische Reconciliation nicht laufen.",
    );
  }
  const [snapshot, uploads, productionDeletes, canaryDeletes] = await Promise.all([
    store.load(),
    uploadLedger.read(),
    productionDeleteLedger.read(),
    canaryDeleteLedger.read(),
  ]);
  const ledgers = {
    uploadLedger: uploads,
    productionDeleteLedger: productionDeletes,
    canaryDeleteLedger: canaryDeletes,
  };
  if (parsed.command === "status") {
    const eligibility = resolveHistoricalDeleteStateReconciliation(snapshot.state, ledgers, {
      externalObjectNumber,
      now: now(),
    });
    return publicResult({ eligibility, idempotent: eligibility.idempotent, changed: false });
  }
  if (parsed.command !== "reconcile") throw new Error("Erlaubte Befehle: status, reconcile.");
  if (parsed.reconciliationMode !== "one-time") {
    throw cliError(
      "HISTORICAL_DELETE_RECONCILIATION_MODE_REQUIRED",
      "Die Mutation verlangt ausdrücklich --reconciliation-mode one-time.",
    );
  }
  if (externalObjectNumber !== HISTORICAL_DELETE_RECONCILIATION.externalObjectNumber) {
    throw cliError(
      "HISTORICAL_DELETE_TARGET_NOT_AUTHORIZED",
      "Die einmalige Reconciliation ist ausschließlich für 30460-287191 freigegeben.",
    );
  }
  const at = now();
  const updated = await store.update((state) => {
    const result = reconcileHistoricalDeleteStateInState(state, ledgers, {
      externalObjectNumber,
      now: at,
      schedulerCheckAt: at,
    });
    return { state: result.state, result };
  }, { now: at });
  const result = updated.result;
  await writeLog(result.idempotent ? "already-reconciled" : "reconciled", {
    externalObjectNumber,
    projectId: HISTORICAL_DELETE_RECONCILIATION.projectId,
    listingId: HISTORICAL_DELETE_RECONCILIATION.listingId,
    deleteJobId: result.eligibility.canaryDeleteJob.deleteJobId,
    deleteReportHash: result.eligibility.canaryDeleteJob.providerReportHash,
    providerProcessedAt: result.eligibility.canaryDeleteJob.providerProcessedAt,
    catalogSavedAt: updated.savedAt,
    status: result.source?.status || result.eligibility.listing.status,
    automaticUpdateEnabled: false,
    externalMutation: false,
  });
  return publicResult(result);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runHistoricalDeleteStateReconciliationCli(process.argv.slice(2)).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error?.code ? `${error.code}: ` : ""}${error instanceof Error ? error.message : "Historische Reconciliation fehlgeschlagen."}\n`);
    process.exitCode = 1;
  });
}
