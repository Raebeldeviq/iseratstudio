#!/usr/bin/env node

import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createCatalogStateStore } from "./catalog-state-store.mjs";
import {
  inspectProductionRotationLifecycle,
  reconcileCompletedProductionLifecycleInState,
  ROTATION_LIFECYCLE_VERIFIED_STAGE,
} from "./listing-rotation-lifecycle-coordinator.mjs";
import { createListingRotationOperatingModeStore } from "./listing-rotation-operating-mode.mjs";
import {
  createProductionDeleteLedger,
  createProductionDeleteModeStore,
  PRODUCTION_DELETE_STATUS,
} from "./listing-rotation-production-delete.mjs";
import { APPLICATION_DATA_DIRECTORY } from "./platform-paths.mjs";
import { createProductionBatchOverrideStore } from "./production-batch-override.mjs";
import { createStructuredFileLogger } from "./structured-log.mjs";
import { createUploadJobLedger } from "./upload-job-ledger.mjs";
import { WORKFLOW_STATUS } from "./workflow-status.mjs";

export const AUTHORIZED_LIFECYCLE_RECONCILIATION = Object.freeze({
  projectId: "1564403a-5508-4bae-8a4a-41217a91a6ea",
  sourceListingId: "93fbe7f4-dee7-461f-8db2-0991d69efd29",
  sourceExternalObjectNumber: "30460-379797",
  replacementListingId: "rotation-3017faee-2a854fd5-96cb3c93-copy",
  replacementExternalObjectNumber: "30460-590537",
  reason: "monotonic_external_completion_reconciliation",
});

const ROTATION_MODE_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-mode.json");
const PRODUCTION_DELETE_MODE_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-production-delete-mode.json");
const UPLOAD_LEDGER_PATH = join(APPLICATION_DATA_DIRECTORY, "upload-jobs.json");
const DELETE_LEDGER_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-production-delete-jobs.json");
const BATCH_OVERRIDE_PATH = join(APPLICATION_DATA_DIRECTORY, "production-batch-override.json");
const RECONCILIATION_LOG_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-lifecycle-reconciliation.log");

function reconciliationError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function parseArguments(argv) {
  const [command = "status", ...rest] = argv;
  const parsed = { command, sourceExternalObjectNumber: "", replacementExternalObjectNumber: "", reason: "" };
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === "--source-external-id") parsed.sourceExternalObjectNumber = String(rest[++index] || "").trim();
    else if (argument === "--replacement-external-id") parsed.replacementExternalObjectNumber = String(rest[++index] || "").trim();
    else if (argument === "--reason") parsed.reason = String(rest[++index] || "").trim();
    else throw new Error(`Unbekanntes Argument: ${argument}`);
  }
  return parsed;
}

function assertExactAuthorizedPair(parsed) {
  const expected = AUTHORIZED_LIFECYCLE_RECONCILIATION;
  if (
    parsed.sourceExternalObjectNumber !== expected.sourceExternalObjectNumber
    || parsed.replacementExternalObjectNumber !== expected.replacementExternalObjectNumber
    || parsed.reason !== expected.reason
  ) {
    throw reconciliationError(
      "LIFECYCLE_RECONCILIATION_PAIR_NOT_AUTHORIZED",
      "Die Mutation ist ausschließlich für das ausdrücklich freigegebene Source-/Replacement-Paar und den festgelegten Reconciliation-Grund zulässig.",
    );
  }
}

function exactInput(state) {
  const expected = AUTHORIZED_LIFECYCLE_RECONCILIATION;
  const project = (state.projects || []).find((candidate) => candidate.id === expected.projectId);
  const sourceMatches = (project?.listings || []).filter((listing) =>
    listing.id === expected.sourceListingId
    && listing.externalId === expected.sourceExternalObjectNumber);
  const replacementMatches = (project?.listings || []).filter((listing) =>
    listing.id === expected.replacementListingId
    && listing.externalId === expected.replacementExternalObjectNumber);
  if (sourceMatches.length !== 1 || replacementMatches.length !== 1) {
    throw reconciliationError(
      "LIFECYCLE_RECONCILIATION_PAIR_NOT_UNIQUE",
      "Das ausdrücklich freigegebene Source-/Replacement-Paar ist im Katalog nicht mehr exakt vorhanden.",
    );
  }
  const replacement = replacementMatches[0];
  if (replacement.rotationSourceListingId !== sourceMatches[0].id) {
    throw reconciliationError("LIFECYCLE_RECONCILIATION_RELATION_MISMATCH", "Die Source-/Replacement-Beziehung hat sich verändert.");
  }
  return {
    schedulerRunId: replacement.productionLifecycle?.schedulerRunId || "",
    productionSchedulerRunId: replacement.productionLifecycle?.schedulerRunId || "",
    projectId: project.id,
    sourceListingId: sourceMatches[0].id,
    replacementListingId: replacement.id,
  };
}

function assertModesOff(rotationMode, deleteMode) {
  if (
    rotationMode.valid !== true
    || rotationMode.mode !== "off"
    || rotationMode.canaryListingIds?.length
    || deleteMode.valid !== true
    || deleteMode.mode !== "off"
  ) {
    throw reconciliationError(
      "LIFECYCLE_RECONCILIATION_MODES_NOT_OFF",
      "Rotation, Canary und Production-DELETE müssen für die rein interne Reconciliation gültig auf off stehen.",
    );
  }
}

function assertNoConcurrentWork(state, uploadLedger, deleteLedger) {
  const activeUploadJobs = (uploadLedger.jobs || []).filter((job) => job.status === WORKFLOW_STATUS.PROCESSING);
  const openDeleteJobs = (deleteLedger.jobs || []).filter((job) => new Set([
    PRODUCTION_DELETE_STATUS.PREPARED,
    PRODUCTION_DELETE_STATUS.PROCESSING,
    PRODUCTION_DELETE_STATUS.PENDING_CONFIRMATION,
    PRODUCTION_DELETE_STATUS.TRANSFER_UNCERTAIN,
  ]).has(job.status));
  const activeControls = (state.projects || []).flatMap((project) => (project.listingGroup?.listingControls || []))
    .filter((control) => control.processLease || control.schedulerSelectionId);
  if (activeUploadJobs.length || openDeleteJobs.length || activeControls.length) {
    throw reconciliationError(
      "LIFECYCLE_RECONCILIATION_CONCURRENT_WORK",
      "Offene Upload-/DELETE-Jobs, Scheduler-Auswahlen oder Process-Leases blockieren die Reconciliation.",
      {
        activeUploadJobCount: activeUploadJobs.length,
        openDeleteJobCount: openDeleteJobs.length,
        activeControlCount: activeControls.length,
      },
    );
  }
}

function publicStatus(assessment, modes, batchOverride) {
  return {
    authorizedPair: AUTHORIZED_LIFECYCLE_RECONCILIATION,
    modes,
    oneShot: {
      state: batchOverride.state || "",
      overrideId: batchOverride.overrideId || "",
      valid: batchOverride.valid === true,
    },
    evidence: {
      consistent: assessment.consistent,
      reasons: assessment.reasons,
      highestVerifiedStage: assessment.highestVerifiedStage,
      sourceStatus: assessment.source.status,
      replacementStatus: assessment.replacement.status,
      uploadJobId: assessment.uploadJob?.jobId || "",
      importReportId: assessment.importReport?.reportId || "",
      deleteJobId: assessment.deleteJob?.deleteJobId || "",
      deleteReportId: assessment.deleteReport?.reportId || "",
      deleteAttempt: Number(assessment.deleteJob?.attempt) || 0,
      lifecycleStage: assessment.lifecycle?.lifecycleStage || "",
    },
  };
}

export async function runLifecycleReconciliationCli(argv, options = {}) {
  const parsed = parseArguments(argv);
  const store = options.store || createCatalogStateStore();
  const uploadLedgerStore = options.uploadLedger || createUploadJobLedger(UPLOAD_LEDGER_PATH);
  const deleteLedgerStore = options.deleteLedger || createProductionDeleteLedger(DELETE_LEDGER_PATH);
  const rotationModeStore = options.rotationModeStore || createListingRotationOperatingModeStore(ROTATION_MODE_PATH);
  const deleteModeStore = options.deleteModeStore || createProductionDeleteModeStore(PRODUCTION_DELETE_MODE_PATH);
  const batchOverrideStore = options.batchOverrideStore || createProductionBatchOverrideStore(BATCH_OVERRIDE_PATH);
  const writeLog = options.writeLog || createStructuredFileLogger(RECONCILIATION_LOG_PATH, {
    jobType: "production-lifecycle-reconciliation",
  });
  const now = options.now || (() => new Date().toISOString());

  if (!new Set(["status", "preflight", "reconcile"]).has(parsed.command)) {
    throw new Error("Erlaubte Befehle: status, preflight, reconcile.");
  }
  if (parsed.command !== "status") assertExactAuthorizedPair(parsed);
  const [snapshot, uploadLedger, deleteLedger, rotationMode, deleteMode, batchOverride] = await Promise.all([
    store.load(),
    uploadLedgerStore.read(),
    deleteLedgerStore.read(),
    rotationModeStore.load(),
    deleteModeStore.load(),
    batchOverrideStore.load(),
  ]);
  const input = exactInput(snapshot.state);
  const assessment = inspectProductionRotationLifecycle(snapshot.state, input, uploadLedger, deleteLedger);
  const status = publicStatus(assessment, { rotation: rotationMode, deletion: deleteMode }, batchOverride);
  if (parsed.command === "status") return status;
  assertModesOff(rotationMode, deleteMode);
  assertNoConcurrentWork(snapshot.state, uploadLedger, deleteLedger);
  if (!assessment.consistent || !new Set([
    ROTATION_LIFECYCLE_VERIFIED_STAGE.SOURCE_DELETED,
    ROTATION_LIFECYCLE_VERIFIED_STAGE.COMPLETED,
  ]).has(assessment.highestVerifiedStage)) {
    throw reconciliationError(
      "LIFECYCLE_RECONCILIATION_REQUIRED",
      "Die vorhandene Evidenz reicht nicht für die exakt freigegebene interne Finalisierung aus.",
      { reasons: assessment.reasons, highestVerifiedStage: assessment.highestVerifiedStage },
    );
  }
  if (parsed.command === "preflight") return { ...status, preflight: "eligible", externalMutations: 0 };

  const reconciledAt = now();
  const updated = await store.update((state) => reconcileCompletedProductionLifecycleInState(
    state,
    exactInput(state),
    uploadLedger,
    deleteLedger,
    { now: reconciledAt },
  ), { now: reconciledAt });
  await writeLog(updated.result?.status === "idempotent" ? "deduplicated" : "reconciled", {
    sourceListingId: AUTHORIZED_LIFECYCLE_RECONCILIATION.sourceListingId,
    replacementListingId: AUTHORIZED_LIFECYCLE_RECONCILIATION.replacementListingId,
    sourceExternalObjectNumber: AUTHORIZED_LIFECYCLE_RECONCILIATION.sourceExternalObjectNumber,
    replacementExternalObjectNumber: AUTHORIZED_LIFECYCLE_RECONCILIATION.replacementExternalObjectNumber,
    reason: AUTHORIZED_LIFECYCLE_RECONCILIATION.reason,
    highestVerifiedStage: updated.result?.highestVerifiedStage,
    externalMutations: 0,
    reconciledAt,
  });
  return updated.result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLifecycleReconciliationCli(process.argv.slice(2)).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error?.code ? `${error.code}: ` : ""}${error instanceof Error ? error.message : "Lifecycle-Reconciliation fehlgeschlagen."}\n`);
    process.exitCode = 1;
  });
}
