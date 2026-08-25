#!/usr/bin/env node

import { Client } from "basic-ftp";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";

import { createAppleMailDeleteReportAdapter } from "./apple-mail-live-canary-delete-report-adapter.mjs";
import { createCatalogStateStore } from "./catalog-state-store.mjs";
import { loadCredentialVault } from "./credential-vault.mjs";
import { loadHelperRuntimeProvenance } from "./helper-runtime-provenance.mjs";
import { createListingRotationOperatingModeStore } from "./listing-rotation-operating-mode.mjs";
import { createListingRotationProductionPolicyStore } from "./listing-rotation-production-policy.mjs";
import {
  assertExactDeleteEligible30460918100,
  inspectOpenLifecycle30460918100,
  OPEN_LIFECYCLE_30460_918100,
  reconcileCompletedOpenLifecycle30460918100,
} from "./open-lifecycle-reconciliation-30460-918100.mjs";
import {
  createProductionDeleteLedger,
  createProductionDeleteModeStore,
  createProductionDeleteService,
  PRODUCTION_DELETE_STATUS,
} from "./listing-rotation-production-delete.mjs";
import { createProductionBatchOverrideStore } from "./production-batch-override.mjs";
import { APPLICATION_DATA_DIRECTORY } from "./platform-paths.mjs";
import { createStructuredFileLogger } from "./structured-log.mjs";
import { createUploadJobLedger } from "./upload-job-ledger.mjs";

const ROTATION_MODE_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-mode.json");
const DELETE_MODE_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-production-delete-mode.json");
const DELETE_LEDGER_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-production-delete-jobs.json");
const DELETE_LOG_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-production-delete.log");
const POLICY_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-production-policy.json");
const BATCH_OVERRIDE_PATH = join(APPLICATION_DATA_DIRECTORY, "production-batch-override.json");
const UPLOAD_LEDGER_PATH = join(APPLICATION_DATA_DIRECTORY, "upload-jobs.json");
const UPLOAD_LOG_PATH = join(APPLICATION_DATA_DIRECTORY, "upload.log");
const SCHEDULER_LOCK_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-scheduler.lock");
const HELPER_RUNTIME_ROOT = join(APPLICATION_DATA_DIRECTORY, "helper-runtime");

function parseArguments(argv) {
  const [command = "status", ...rest] = argv;
  if (rest.length) throw new Error(`Unbekanntes Argument: ${rest[0]}`);
  if (!new Set(["status", "preflight-delete", "delete", "confirm-delete", "finalize"]).has(command)) {
    throw new Error("Erlaubte Befehle: status, preflight-delete, delete, confirm-delete, finalize.");
  }
  return { command };
}

function ftpAccessOptions(ftp) {
  return {
    host: String(ftp.ftpHost),
    user: String(ftp.ftpUser),
    password: String(ftp.ftpPassword),
    secure: ftp.ftpSecure === "implicit" ? "implicit" : ftp.ftpSecure === "explicit",
    secureOptions: { rejectUnauthorized: true },
  };
}

async function readUploadTransferEvents(path = UPLOAD_LOG_PATH) {
  try {
    return (await readFile(path, "utf8")).split(/\r?\n/gu).filter(Boolean).flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function exactRuntimeProvenance(options = {}) {
  if (options.runtimeProvenance) return options.runtimeProvenance;
  const entries = await readdir(options.helperRuntimeRoot || HELPER_RUNTIME_ROOT, { withFileTypes: true });
  const matches = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("release-")) continue;
    const runtime = await loadHelperRuntimeProvenance({ runtimePath: join(options.helperRuntimeRoot || HELPER_RUNTIME_ROOT, entry.name) });
    if (runtime.valid === true && runtime.runtimeCommit === OPEN_LIFECYCLE_30460_918100.runtimeCommit) matches.push(runtime);
  }
  if (matches.length !== 1) throw new Error("Die bestätigte Produktionsruntime des offenen Lifecycles ist nicht genau einmal installiert.");
  return matches[0];
}

function publicDeleteJob(job) {
  if (!job) return null;
  const value = { ...job };
  delete value.claimToken;
  return value;
}

export async function runOpenLifecycle30460918100Cli(argv, options = {}) {
  const { command } = parseArguments(argv);
  const now = options.now || (() => new Date().toISOString());
  const store = options.store || createCatalogStateStore();
  const uploadLedger = options.uploadLedger || createUploadJobLedger(UPLOAD_LEDGER_PATH);
  const deleteLedger = options.deleteLedger || createProductionDeleteLedger(DELETE_LEDGER_PATH);
  const rotationModeStore = options.rotationModeStore || createListingRotationOperatingModeStore(ROTATION_MODE_PATH);
  const persistedDeleteModeStore = options.persistedDeleteModeStore || createProductionDeleteModeStore(DELETE_MODE_PATH);
  const productionPolicyStore = options.productionPolicyStore || createListingRotationProductionPolicyStore(POLICY_PATH);
  const batchOverrideStore = options.batchOverrideStore || createProductionBatchOverrideStore(BATCH_OVERRIDE_PATH);
  const writeLog = options.writeLog || createStructuredFileLogger(DELETE_LOG_PATH, { jobType: "listing-rotation-production-delete" });
  const [snapshot, uploads, deletes, transferEvents, rotationMode, deleteMode] = await Promise.all([
    store.load(),
    uploadLedger.read(),
    deleteLedger.read(),
    options.readUploadTransferEvents ? options.readUploadTransferEvents() : readUploadTransferEvents(),
    rotationModeStore.load(),
    persistedDeleteModeStore.load(),
  ]);
  const assessment = inspectOpenLifecycle30460918100(snapshot.state, uploads, deletes, transferEvents);
  const status = {
    ...assessment,
    rotationMode: rotationMode.mode,
    productionDeleteMode: deleteMode.mode,
  };
  if (command === "status") return status;
  if (rotationMode.valid !== true || rotationMode.mode !== "off" || deleteMode.valid !== true || deleteMode.mode !== "off") {
    throw new Error("Die einmalige Open-Lifecycle-Reconciliation verlangt global Rotation off und Production-DELETE off.");
  }
  try {
    await readFile(options.schedulerLockPath || SCHEDULER_LOCK_PATH, "utf8");
    throw new Error("Vor der einmaligen Reconciliation muss der Scheduler-Lock kontrolliert bereinigt sein.");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (command === "preflight-delete") {
    const eligibility = assertExactDeleteEligible30460918100(snapshot.state, deletes);
    return {
      eligible: true,
      sourceExternalObjectNumber: eligibility.source.externalId,
      replacementExternalObjectNumber: eligibility.replacement.externalId,
      existingDeleteJob: publicDeleteJob(eligibility.existingJob),
      confirmedUploadTransferCount: assessment.upload.confirmedTransferCount,
    };
  }
  if (command === "finalize") {
    const persisted = await store.update((state) => reconcileCompletedOpenLifecycle30460918100(
      state,
      uploads,
      deletes,
      { now: now() },
    ), { now: now() });
    return persisted.result;
  }

  const runtimeProvenance = await exactRuntimeProvenance(options);
  const mailAdapter = options.mailAdapter || createAppleMailDeleteReportAdapter();
  const upload = command === "delete"
    ? options.upload || (async ({ archive, filename }) => {
        const vault = await loadCredentialVault();
        const ftp = vault.credentials;
        if (!ftp.ftpHost || !ftp.ftpUser || !ftp.ftpPassword) throw new Error("Der Immoprofessional-FTPS-Zugang ist unvollständig.");
        const remotePath = String(ftp.ftpPath || "/").trim() || "/";
        const client = new Client(300_000);
        client.ftp.verbose = false;
        try {
          await client.access(ftpAccessOptions(ftp));
          if (remotePath !== "/") await client.cd(remotePath);
          await client.uploadFrom(Readable.from(archive), filename);
        } finally {
          client.close();
        }
      })
    : async () => {
        const error = new Error("Der Bestätigungslauf darf keinen zweiten DELETE-Transfer auslösen.");
        error.code = "OPEN_LIFECYCLE_SECOND_DELETE_BLOCKED";
        throw error;
      };
  const service = options.service || createProductionDeleteService({
    store,
    modeStore: { load: async () => ({ format: 1, mode: "active", valid: true, fallbackReason: "" }) },
    ledger: deleteLedger,
    productionPolicyStore,
    batchOverrideStore,
    runtimeProvenance,
    runtimeOwnershipGuard: options.runtimeOwnershipGuard || {
      async assert() {
        const error = new Error("Direkte produktive DELETE-Transfers außerhalb des alleinigen Release-Helpers sind gesperrt.");
        error.code = "PRODUCTION_RUNTIME_PORT_OWNER_MISMATCH";
        throw error;
      },
    },
    mailAdapter,
    upload,
    writeLog,
    now,
  });

  if (command === "delete") {
    assertExactDeleteEligible30460918100(snapshot.state, deletes);
    if (assessment.delete && assessment.delete.status !== PRODUCTION_DELETE_STATUS.PREPARED) {
      throw new Error("Für die exakte Source existiert bereits ein versuchter Deletejob; ein zweiter Transfer ist gesperrt.");
    }
  }
  const result = await service.runOnce({
    trigger: "scheduler-lifecycle",
    targetExternalObjectNumber: OPEN_LIFECYCLE_30460_918100.sourceExternalObjectNumber,
  });
  if (result.ran !== true || result.ok !== true) {
    throw new Error(result.reason || result.errors?.[0]?.message || "Die exakt begrenzte Production-DELETE-Reconciliation wurde gesperrt.");
  }
  if (command === "delete" && (
    result.transferred.length !== 1
    || result.transferred[0] !== OPEN_LIFECYCLE_30460_918100.sourceExternalObjectNumber
  )) {
    throw new Error("Der Production-DELETE hat nicht exakt die freigegebene Source einmal übertragen.");
  }
  if (command === "confirm-delete" && result.transferred.length) {
    throw new Error("Der reine Bestätigungslauf hat unerwartet einen DELETE-Transfer ausgelöst.");
  }
  if (command === "confirm-delete" && result.confirmed.includes(OPEN_LIFECYCLE_30460_918100.sourceExternalObjectNumber)) {
    const currentUploads = await uploadLedger.read();
    const currentDeletes = await deleteLedger.read();
    const persisted = await store.update((state) => reconcileCompletedOpenLifecycle30460918100(
      state,
      currentUploads,
      currentDeletes,
      { now: now() },
    ), { now: now() });
    return { ...result, lifecycleReconciliation: persisted.result };
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runOpenLifecycle30460918100Cli(process.argv.slice(2)).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error?.code ? `${error.code}: ` : ""}${error instanceof Error ? error.message : "Open-Lifecycle-Reconciliation fehlgeschlagen."}\n`);
    process.exitCode = 1;
  });
}
