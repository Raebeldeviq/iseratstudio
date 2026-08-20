#!/usr/bin/env node

import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createAppleMailDeleteReportAdapter } from "./apple-mail-live-canary-delete-report-adapter.mjs";
import { createCatalogStateStore } from "./catalog-state-store.mjs";
import {
  PRE_FTPS_DELETE_RECONCILIATION,
  reconcilePreFtpsDeleteCatalogInState,
  reconcilePreFtpsDeleteLedgerFile,
  resolvePreFtpsDeleteReconciliation,
} from "./delete-pre-ftps-reconciliation-30460-462061.mjs";
import { parseImmoprofessionalDeleteReport } from "./immoprofessional-delete-report-parser.mjs";
import { createListingRotationOperatingModeStore } from "./listing-rotation-operating-mode.mjs";
import {
  createProductionDeleteLedger,
  createProductionDeleteModeStore,
} from "./listing-rotation-production-delete.mjs";
import { APPLICATION_DATA_DIRECTORY } from "./platform-paths.mjs";
import { createStructuredFileLogger } from "./structured-log.mjs";

const ROTATION_MODE_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-mode.json");
const PRODUCTION_DELETE_MODE_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-production-delete-mode.json");
const PRODUCTION_DELETE_LEDGER_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-production-delete-jobs.json");
const PRODUCTION_DELETE_LOG_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-production-delete.log");
const SCHEDULER_LOCK_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-scheduler.lock");
const RECONCILIATION_LOG_PATH = join(APPLICATION_DATA_DIRECTORY, "delete-pre-ftps-reconciliation-30460-462061.log");

function cliError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseArguments(argv) {
  const [command = "status", ...rest] = argv;
  const parsed = {
    command,
    externalObjectNumber: "",
    replacementExternalObjectNumber: "",
    deleteJobId: "",
    reconciliationMode: "",
  };
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === "--external-id") parsed.externalObjectNumber = String(rest[++index] || "").trim();
    else if (argument === "--replacement-external-id") parsed.replacementExternalObjectNumber = String(rest[++index] || "").trim();
    else if (argument === "--delete-job-id") parsed.deleteJobId = String(rest[++index] || "").trim();
    else if (argument === "--reconciliation-mode") parsed.reconciliationMode = String(rest[++index] || "").trim();
    else throw new Error(`Unbekanntes Argument: ${argument}`);
  }
  return parsed;
}

async function pathExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function defaultRuntimeEvidence() {
  const runtimeDirectory = PRE_FTPS_DELETE_RECONCILIATION.oldRuntimeDirectory;
  const uploadServerPath = join(runtimeDirectory, "local-upload-server.mjs");
  const credentialVaultPath = join(runtimeDirectory, "credential-vault.mjs");
  const sidecarPath = join(runtimeDirectory, "macos-keychain.swift");
  const [uploadServerSource, credentialVaultSource, sidecarPresent] = await Promise.all([
    readFile(uploadServerPath, "utf8"),
    readFile(credentialVaultPath, "utf8"),
    pathExists(sidecarPath),
  ]);
  const start = uploadServerSource.indexOf("async function automaticProductionDeleteUpload");
  const end = uploadServerSource.indexOf("\n}\n\nconst productionDeleteService", start);
  const functionSource = start >= 0 && end > start ? uploadServerSource.slice(start, end) : "";
  const credentialIndex = functionSource.indexOf("await credentialVault()");
  const clientIndex = functionSource.indexOf("new Client(300_000)");
  const accessIndex = functionSource.indexOf("await client.access");
  const uploadIndex = functionSource.indexOf("await client.uploadFrom");
  return {
    oldRuntimeDirectory: runtimeDirectory,
    sidecarPresent,
    credentialVaultBeforeClient: credentialIndex >= 0 && clientIndex > credentialIndex,
    clientBeforeAccess: clientIndex >= 0 && accessIndex > clientIndex,
    accessBeforeUpload: accessIndex >= 0 && uploadIndex > accessIndex,
    sidecarReferenceVerified: credentialVaultSource.includes('new URL("./macos-keychain.swift", import.meta.url)'),
  };
}

function parseStructuredLog(raw) {
  return String(raw || "").split(/\r?\n/gu).filter(Boolean).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      throw cliError(
        "PRE_FTPS_RECONCILIATION_LOG_CORRUPT",
        "Das Production-Delete-Auditlog enthält eine beschädigte Zeile.",
      );
    }
  });
}

async function defaultLogEvidence() {
  const events = parseStructuredLog(await readFile(PRODUCTION_DELETE_LOG_PATH, "utf8"));
  const contract = PRE_FTPS_DELETE_RECONCILIATION;
  const jobEvents = events.filter((event) => event.deleteJobId === contract.deleteJobId);
  const localFailures = events.filter((event) =>
    event.event === "failed"
    && event.sourceListingId === contract.sourceListingId
    && String(event.message || "").includes(`${contract.oldRuntimeDirectory}/macos-keychain.swift`));
  return {
    transferStartedMarkers: jobEvents.filter((event) => event.event === "transfer-started").length,
    transferredMarkers: jobEvents.filter((event) => event.event === "transferred").length,
    confirmedMarkers: jobEvents.filter((event) => event.event === "confirmed").length,
    matchingLocalFailures: localFailures.length,
    failureMentionsExpectedSidecar: localFailures.length === 1,
    failureSourceListingId: localFailures.length === 1 ? localFailures[0].sourceListingId : "",
  };
}

async function defaultMailEvidence() {
  const adapter = createAppleMailDeleteReportAdapter();
  const candidates = await adapter.findCandidates({ lookbackHours: 48 });
  const matches = [];
  for (const candidate of candidates) {
    try {
      const mail = await adapter.readRawMessage(candidate);
      const report = parseImmoprofessionalDeleteReport(mail.rawSource, {
        expectedTarget: PRE_FTPS_DELETE_RECONCILIATION.externalObjectNumber,
      });
      matches.push(report);
    } catch {
      // Eine nicht passende Mail ist keine Löschbestätigung und bleibt unverändert.
    }
  }
  return {
    checked: true,
    readOnly: adapter.readOnly === true,
    mailboxNames: adapter.mailboxNames,
    candidateCount: candidates.length,
    matchCount: matches.length,
    mailMutations: 0,
  };
}

async function defaultSchedulerLockExists() {
  return pathExists(SCHEDULER_LOCK_PATH);
}

function targetOptions(parsed) {
  return {
    externalObjectNumber: parsed.externalObjectNumber || PRE_FTPS_DELETE_RECONCILIATION.externalObjectNumber,
    replacementExternalObjectNumber: parsed.replacementExternalObjectNumber
      || PRE_FTPS_DELETE_RECONCILIATION.replacementExternalObjectNumber,
    deleteJobId: parsed.deleteJobId || PRE_FTPS_DELETE_RECONCILIATION.deleteJobId,
  };
}

function publicResult(resolution, details = {}) {
  return {
    externalObjectNumber: resolution.contract.externalObjectNumber,
    replacementExternalObjectNumber: resolution.contract.replacementExternalObjectNumber,
    deleteJobId: resolution.contract.deleteJobId,
    provenance: resolution.contract.provenance,
    oldStatus: details.oldStatus || resolution.job.status,
    status: details.status || resolution.job.status,
    confirmedTransferCount: 0,
    transferCompletedAt: resolution.job.transferCompletedAt || "",
    deleteReportMatchCount: details.evidence?.mail?.matchCount ?? 0,
    catalogState: details.catalogState || resolution.pair.source.productionDeleteState,
    changed: details.changed === true,
    idempotent: details.idempotent === true || resolution.idempotent,
    externalMutation: false,
    mailMutations: 0,
  };
}

export async function runPreFtpsDeleteReconciliationCli(argv, options = {}) {
  const parsed = parseArguments(argv);
  const store = options.store || createCatalogStateStore();
  const rotationModeStore = options.rotationModeStore || createListingRotationOperatingModeStore(ROTATION_MODE_PATH);
  const productionDeleteModeStore = options.productionDeleteModeStore
    || createProductionDeleteModeStore(PRODUCTION_DELETE_MODE_PATH);
  const productionDeleteLedger = options.productionDeleteLedger
    || createProductionDeleteLedger(PRODUCTION_DELETE_LEDGER_PATH);
  const reconcileLedgerFile = options.reconcileLedgerFile
    || ((input) => reconcilePreFtpsDeleteLedgerFile(PRODUCTION_DELETE_LEDGER_PATH, input));
  const runtimeEvidence = options.runtimeEvidence || defaultRuntimeEvidence;
  const logEvidence = options.logEvidence || defaultLogEvidence;
  const mailEvidence = options.mailEvidence || defaultMailEvidence;
  const schedulerLockExists = options.schedulerLockExists || defaultSchedulerLockExists;
  const now = options.now || (() => new Date().toISOString());
  const writeLog = options.writeLog || createStructuredFileLogger(RECONCILIATION_LOG_PATH, {
    jobType: "delete-pre-ftps-reconciliation-30460-462061",
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
      "PRE_FTPS_RECONCILIATION_MODES_NOT_OFF",
      "Rotation und Production-DELETE müssen für die Reconciliation gültig auf off stehen.",
    );
  }
  if (await schedulerLockExists()) {
    throw cliError(
      "PRE_FTPS_RECONCILIATION_SCHEDULER_LOCKED",
      "Während eines aktiven Scheduler-Claims darf die Reconciliation nicht laufen.",
    );
  }
  const evidence = {
    runtime: await runtimeEvidence(),
    logs: await logEvidence(),
    mail: await mailEvidence(),
  };
  const [snapshot, ledger] = await Promise.all([store.load(), productionDeleteLedger.read()]);
  const resolution = resolvePreFtpsDeleteReconciliation(
    snapshot.state,
    ledger,
    evidence,
    targetOptions(parsed),
  );
  if (parsed.command === "status") return publicResult(resolution, { evidence });
  if (parsed.command !== "reconcile") throw new Error("Erlaubte Befehle: status, reconcile.");
  if (parsed.reconciliationMode !== "one-time-pre-ftps") {
    throw cliError(
      "PRE_FTPS_RECONCILIATION_MODE_REQUIRED",
      "Die Mutation verlangt ausdrücklich --reconciliation-mode one-time-pre-ftps.",
    );
  }
  const at = now();
  const ledgerResult = await reconcileLedgerFile({ now: at });
  const reconciledLedger = ledgerResult.ledger || await productionDeleteLedger.read();
  const updated = await store.update((state) => {
    const result = reconcilePreFtpsDeleteCatalogInState(state, reconciledLedger, evidence, { now: at });
    return { state: result.state, result };
  }, { now: at });
  const finalResolution = resolvePreFtpsDeleteReconciliation(
    updated.state,
    reconciledLedger,
    evidence,
    targetOptions(parsed),
  );
  const changed = ledgerResult.changed || updated.changed;
  await writeLog(changed ? "reconciled" : "already-reconciled", {
    externalObjectNumber: finalResolution.contract.externalObjectNumber,
    replacementExternalObjectNumber: finalResolution.contract.replacementExternalObjectNumber,
    deleteJobId: finalResolution.contract.deleteJobId,
    provenance: finalResolution.contract.provenance,
    previousStatus: resolution.job.status,
    status: finalResolution.job.status,
    confirmedTransferCount: 0,
    deleteReportMatchCount: evidence.mail.matchCount,
    catalogState: finalResolution.pair.source.productionDeleteState,
    catalogSavedAt: updated.savedAt,
    externalMutation: false,
    mailMutations: 0,
  });
  return publicResult(finalResolution, {
    oldStatus: resolution.job.status,
    status: finalResolution.job.status,
    evidence,
    catalogState: finalResolution.pair.source.productionDeleteState,
    changed,
    idempotent: finalResolution.idempotent,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPreFtpsDeleteReconciliationCli(process.argv.slice(2)).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error?.code ? `${error.code}: ` : ""}${error instanceof Error ? error.message : "Pre-FTPS-Reconciliation fehlgeschlagen."}\n`);
    process.exitCode = 1;
  });
}
