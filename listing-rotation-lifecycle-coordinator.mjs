import { createUploadJobId } from "./batch-upload.mjs";
import { listingControl, normalizeListingGroup } from "./listing-groups.mjs";
import {
  productionDeleteIdentity,
  PRODUCTION_DELETE_STATUS,
} from "./listing-rotation-production-delete.mjs";
import { normalizeWorkflowStatus, WORKFLOW_STATUS } from "./workflow-status.mjs";
import {
  isRegressionRepairLifecycle,
  regressionRepairSourceStatus,
} from "./listing-regression-repair.mjs";

export const ROTATION_LIFECYCLE_STAGE = Object.freeze({
  AWAITING_IMPORT_CONFIRMATION: "awaiting_import_confirmation",
  POST_IMPORT_PRE_DELETE: "post_import_pre_delete",
  AWAITING_DELETE_CONFIRMATION: "awaiting_delete_confirmation",
  COMPLETED: "completed",
});

export const ROTATION_LIFECYCLE_VERIFIED_STAGE = Object.freeze({
  NONE: "none",
  TRANSFERRED_PENDING_IMPORT: "transferred_pending_import",
  IMPORT_CONFIRMED: "import_confirmed",
  DELETE_AUTHORIZED: "delete_authorized",
  DELETE_TRANSFERRED: "delete_transferred",
  DELETE_CONFIRMED: "delete_confirmed",
  SOURCE_DELETED: "source_deleted",
  COMPLETED: "completed",
});

const VERIFIED_STAGE_ORDER = Object.freeze([
  ROTATION_LIFECYCLE_VERIFIED_STAGE.NONE,
  ROTATION_LIFECYCLE_VERIFIED_STAGE.TRANSFERRED_PENDING_IMPORT,
  ROTATION_LIFECYCLE_VERIFIED_STAGE.IMPORT_CONFIRMED,
  ROTATION_LIFECYCLE_VERIFIED_STAGE.DELETE_AUTHORIZED,
  ROTATION_LIFECYCLE_VERIFIED_STAGE.DELETE_TRANSFERRED,
  ROTATION_LIFECYCLE_VERIFIED_STAGE.DELETE_CONFIRMED,
  ROTATION_LIFECYCLE_VERIFIED_STAGE.SOURCE_DELETED,
  ROTATION_LIFECYCLE_VERIFIED_STAGE.COMPLETED,
]);

const PERSISTED_STAGE_ORDER = Object.freeze([
  ROTATION_LIFECYCLE_STAGE.AWAITING_IMPORT_CONFIRMATION,
  ROTATION_LIFECYCLE_STAGE.POST_IMPORT_PRE_DELETE,
  ROTATION_LIFECYCLE_STAGE.AWAITING_DELETE_CONFIRMATION,
  ROTATION_LIFECYCLE_STAGE.COMPLETED,
]);

export const DEFAULT_ROTATION_LIFECYCLE_POLL_INTERVAL_MS = 5 * 60 * 1000;
export const DEFAULT_IMPORT_CONFIRMATION_TIMEOUT_MS = 30 * 60 * 1000;
export const DEFAULT_DELETE_CONFIRMATION_TIMEOUT_MS = 30 * 60 * 1000;

const ACTIVE_UPLOAD_STATUSES = new Set([WORKFLOW_STATUS.PROCESSING]);
const OPEN_DELETE_STATUSES = new Set([
  PRODUCTION_DELETE_STATUS.PREPARED,
  PRODUCTION_DELETE_STATUS.PROCESSING,
  PRODUCTION_DELETE_STATUS.PENDING_CONFIRMATION,
  PRODUCTION_DELETE_STATUS.TRANSFER_UNCERTAIN,
]);

function lifecycleError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function boundedMilliseconds(value, fallback, minimum = 1) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= minimum ? Math.trunc(numeric) : fallback;
}

function defaultSleep(milliseconds) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref?.();
  });
}

function clean(value, maximum = 500) {
  return String(value ?? "").trim().slice(0, maximum);
}

function stageRank(stage) {
  return Math.max(0, VERIFIED_STAGE_ORDER.indexOf(stage));
}

function hasReached(stage, expectedStage) {
  return stageRank(stage) >= stageRank(expectedStage);
}

function monotonicPersistedStage(currentStage, requestedStage) {
  const currentRank = PERSISTED_STAGE_ORDER.indexOf(currentStage);
  const requestedRank = PERSISTED_STAGE_ORDER.indexOf(requestedStage);
  if (requestedRank < 0) return currentRank >= 0 ? currentStage : ROTATION_LIFECYCLE_STAGE.AWAITING_IMPORT_CONFIRMATION;
  return currentRank > requestedRank ? currentStage : requestedStage;
}

function persistedStageForVerifiedStage(stage) {
  if (stage === ROTATION_LIFECYCLE_VERIFIED_STAGE.COMPLETED) return ROTATION_LIFECYCLE_STAGE.COMPLETED;
  if (hasReached(stage, ROTATION_LIFECYCLE_VERIFIED_STAGE.SOURCE_DELETED)) return ROTATION_LIFECYCLE_STAGE.AWAITING_DELETE_CONFIRMATION;
  if (hasReached(stage, ROTATION_LIFECYCLE_VERIFIED_STAGE.DELETE_TRANSFERRED)) return ROTATION_LIFECYCLE_STAGE.AWAITING_DELETE_CONFIRMATION;
  if (hasReached(stage, ROTATION_LIFECYCLE_VERIFIED_STAGE.IMPORT_CONFIRMED)) return ROTATION_LIFECYCLE_STAGE.POST_IMPORT_PRE_DELETE;
  return ROTATION_LIFECYCLE_STAGE.AWAITING_IMPORT_CONFIRMATION;
}

function pairFor(state, input) {
  const project = (state.projects || []).find((candidate) => candidate.id === input.projectId);
  const source = project?.listings?.find((candidate) => candidate.id === input.sourceListingId);
  const replacement = project?.listings?.find((candidate) => candidate.id === input.replacementListingId);
  if (
    !project
    || !source
    || !replacement
    || replacement.rotationSourceListingId !== source.id
    || replacement.listingOrigin !== "rotation-copy"
  ) {
    throw lifecycleError(
      "ROTATION_LIFECYCLE_RELATION_MISMATCH",
      "Die serielle Lifecycle-Barriere besitzt keine eindeutige Source-/Replacement-Beziehung.",
    );
  }
  return { project, source, replacement };
}

function exactPositiveImportReport(state, project, source, replacement) {
  return (state.importReports || []).find((report) =>
    report.reportId === replacement.importReportId
    && report.processingStatus === "confirmed"
    && report.importResult === "success"
    && report.projectId === project.id
    && report.sourceListingId === source.id
    && report.matchedListingId === replacement.id
    && report.externalObjectNumber === replacement.externalId);
}

function exactPositiveDeleteReport(state, source, replacement) {
  const deleteJobId = source.deleteJobId || source.productionDeleteJobId;
  return (state.deleteReports || []).find((report) =>
    report.deleteJobId === deleteJobId
    && report.sourceListingId === source.id
    && report.replacementListingId === replacement.id
    && report.externalObjectNumber === source.externalId
    && report.result === "success");
}

export function inspectProductionRotationLifecycle(state, input, uploadLedger = { jobs: [] }, deleteLedger = { jobs: [] }) {
  const { project, source, replacement } = pairFor(state, input);
  const lifecycle = replacement.productionLifecycle;
  const reasons = [];
  const expectedSchedulerRunId = clean(input.productionSchedulerRunId || lifecycle?.schedulerRunId, 200);
  if (
    lifecycle?.format !== 1
    || lifecycle.sourceListingId !== source.id
    || !lifecycle.schedulerRunId
    || lifecycle.schedulerRunId !== expectedSchedulerRunId
    || (source.productionRotationRunId && source.productionRotationRunId !== lifecycle.schedulerRunId)
  ) reasons.push("production_lifecycle_provenance_mismatch");

  const expectedUploadJobId = createUploadJobId(project, replacement);
  const uploadJobs = (uploadLedger.jobs || []).filter((job) => job.jobId === expectedUploadJobId);
  const relatedUploadJobs = (uploadLedger.jobs || []).filter((job) =>
    job.listingId === replacement.id
    || job.jobId === expectedUploadJobId);
  const uploadHistory = (state.uploadHistory || []).filter((entry) =>
    entry.jobId === expectedUploadJobId
    && entry.projectId === project.id
    && entry.listingId === replacement.id
    && entry.status === WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT
    && !clean(entry.error));
  const uploadJob = uploadJobs[0] || null;
  const uploadTransferred = Boolean(
    uploadJobs.length === 1
    && relatedUploadJobs.length === 1
    && uploadHistory.length === 1
    && uploadJob.projectId === project.id
    && uploadJob.listingId === replacement.id
    && uploadJob.status === WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT
    && uploadJob.transferredAt
    && replacement.transferredAt
  );
  if (uploadJobs.length > 1 || relatedUploadJobs.length > 1 || uploadHistory.length > 1) {
    reasons.push("upload_transfer_evidence_ambiguous");
  }
  if (ACTIVE_UPLOAD_STATUSES.has(uploadJob?.status)) reasons.push("upload_job_still_active");

  const importReports = (state.importReports || []).filter((report) =>
    report.reportId === replacement.importReportId
    || report.matchedListingId === replacement.id
    || report.externalObjectNumber === replacement.externalId);
  const importReport = exactPositiveImportReport(state, project, source, replacement);
  const importConfirmed = Boolean(
    uploadTransferred
    && normalizeWorkflowStatus(replacement.status) === WORKFLOW_STATUS.PUBLISHED
    && replacement.importConfirmedAt
    && replacement.importReportId
    && importReports.length === 1
    && importReport
    && source.supersededByListingId === replacement.id
    && source.productionRotationRunId === lifecycle?.schedulerRunId
    && lifecycle?.automaticDeleteAuthorized === true
    && lifecycle?.importReportId === importReport.reportId
  );
  if (normalizeWorkflowStatus(replacement.status) === WORKFLOW_STATUS.PUBLISHED && !importConfirmed) {
    reasons.push("replacement_published_without_exact_import_provenance");
  }
  if (importReports.length > 1) reasons.push("import_report_evidence_ambiguous");

  const sourceDeleteStatusAllowed = normalizeWorkflowStatus(source.status) === WORKFLOW_STATUS.PUBLISHED
    || (
      isRegressionRepairLifecycle(lifecycle)
      && normalizeWorkflowStatus(source.status) === regressionRepairSourceStatus(lifecycle)
    );
  const deleteAuthorized = Boolean(
    importConfirmed
    && sourceDeleteStatusAllowed
    && source.externalDeletionPending === true
    && source.productionDeleteState === "authorized"
    && source.productionDeleteAuthorizedAt
  );

  const relatedDeleteJobs = (deleteLedger.jobs || []).filter((job) =>
    job.sourceListingId === source.id
    || job.replacementListingId === replacement.id
    || job.externalObjectNumber === source.externalId);
  const deleteJob = relatedDeleteJobs[0] || null;
  let expectedDeleteIdentity = null;
  if (importConfirmed) {
    try {
      expectedDeleteIdentity = productionDeleteIdentity(source, replacement);
    } catch {
      reasons.push("delete_identity_invalid");
    }
  }
  if (relatedDeleteJobs.length > 1) reasons.push("multiple_delete_jobs");
  if (deleteJob?.status === PRODUCTION_DELETE_STATUS.TRANSFER_UNCERTAIN) reasons.push("delete_transfer_uncertain");
  const deleteJobMatches = Boolean(
    relatedDeleteJobs.length === 1
    && expectedDeleteIdentity
    && deleteJob.deleteJobId === expectedDeleteIdentity.deleteJobId
    && deleteJob.schedulerRunId === lifecycle?.schedulerRunId
    && deleteJob.projectId === project.id
    && deleteJob.sourceListingId === source.id
    && deleteJob.replacementListingId === replacement.id
    && deleteJob.externalObjectNumber === source.externalId
    && deleteJob.replacementExternalObjectNumber === replacement.externalId
    && (source.productionDeleteJobId || source.deleteJobId) === deleteJob.deleteJobId
  );
  const deleteTransferred = Boolean(
    importConfirmed
    && deleteJobMatches
    && new Set([PRODUCTION_DELETE_STATUS.PENDING_CONFIRMATION, PRODUCTION_DELETE_STATUS.CONFIRMED]).has(deleteJob.status)
    && deleteJob.attempt === 1
    && deleteJob.transferStartedAt
    && deleteJob.transferCompletedAt
  );
  const deleteReport = exactPositiveDeleteReport(state, source, replacement);
  const relatedDeleteReports = (state.deleteReports || []).filter((report) =>
    report.sourceListingId === source.id
    || report.replacementListingId === replacement.id
    || report.externalObjectNumber === source.externalId);
  const deleteConfirmed = Boolean(
    deleteTransferred
    && deleteJob.status === PRODUCTION_DELETE_STATUS.CONFIRMED
    && deleteJob.confirmedAt
    && deleteReport
    && relatedDeleteReports.length === 1
    && deleteJob.reportHash === deleteReport.rawHash
    && deleteJob.reportMessageId === deleteReport.messageId
  );
  if (relatedDeleteReports.length > 1) reasons.push("delete_report_evidence_ambiguous");

  const group = normalizeListingGroup(project.listingGroup, project.id);
  const sourceControl = listingControl(group, source);
  const replacementControl = listingControl(group, replacement);
  const sourceDeleted = Boolean(
    deleteConfirmed
    && normalizeWorkflowStatus(source.status) === WORKFLOW_STATUS.DELETED
    && sourceControl.status === WORKFLOW_STATUS.DELETED
    && source.externalDeletionPending === false
    && source.productionDeleteState === "confirmed"
    && source.deleteConfirmedAt
    && source.deleteReportHash === deleteReport.rawHash
    && source.deleteJobId === deleteJob.deleteJobId
    && normalizeWorkflowStatus(replacement.status) === WORKFLOW_STATUS.PUBLISHED
    && replacementControl.status === WORKFLOW_STATUS.PUBLISHED
  );
  if (normalizeWorkflowStatus(source.status) === WORKFLOW_STATUS.DELETED && !sourceDeleted) {
    reasons.push("source_deleted_without_complete_delete_provenance");
  }
  if (lifecycle?.lifecycleStage === ROTATION_LIFECYCLE_STAGE.COMPLETED && !sourceDeleted) {
    reasons.push("lifecycle_completed_without_final_proof");
  }

  let highestVerifiedStage = ROTATION_LIFECYCLE_VERIFIED_STAGE.NONE;
  if (uploadTransferred) highestVerifiedStage = ROTATION_LIFECYCLE_VERIFIED_STAGE.TRANSFERRED_PENDING_IMPORT;
  if (importConfirmed) highestVerifiedStage = ROTATION_LIFECYCLE_VERIFIED_STAGE.IMPORT_CONFIRMED;
  if (deleteAuthorized) highestVerifiedStage = ROTATION_LIFECYCLE_VERIFIED_STAGE.DELETE_AUTHORIZED;
  if (deleteTransferred) highestVerifiedStage = ROTATION_LIFECYCLE_VERIFIED_STAGE.DELETE_TRANSFERRED;
  if (deleteConfirmed) highestVerifiedStage = ROTATION_LIFECYCLE_VERIFIED_STAGE.DELETE_CONFIRMED;
  if (sourceDeleted) highestVerifiedStage = ROTATION_LIFECYCLE_VERIFIED_STAGE.SOURCE_DELETED;
  if (sourceDeleted && lifecycle?.lifecycleStage === ROTATION_LIFECYCLE_STAGE.COMPLETED) {
    highestVerifiedStage = ROTATION_LIFECYCLE_VERIFIED_STAGE.COMPLETED;
  }
  return {
    consistent: reasons.length === 0,
    reasons,
    highestVerifiedStage,
    observedStage: highestVerifiedStage,
    project,
    source,
    replacement,
    lifecycle,
    sourceControl,
    replacementControl,
    uploadJob,
    uploadHistory: uploadHistory[0] || null,
    uploadJobId: expectedUploadJobId,
    importReport,
    deleteJob,
    deleteReport,
    evidence: {
      uploadTransferred,
      importConfirmed,
      deleteAuthorized,
      deleteJobMatches,
      deleteTransferred,
      deleteConfirmed,
      sourceDeleted,
      expectedDeleteJobId: expectedDeleteIdentity?.deleteJobId || "",
      observedDeleteJobId: deleteJob?.deleteJobId || "",
      sourceDeleteJobId: source.productionDeleteJobId || source.deleteJobId || "",
    },
  };
}

function assertConsistentLifecycleEvidence(assessment) {
  if (assessment.consistent) return assessment;
  throw lifecycleError(
    "LIFECYCLE_RECONCILIATION_REQUIRED",
    `Die Lifecycle-Evidenz ist widersprüchlich: ${assessment.reasons.join(", ")}.`,
    {
      reasons: assessment.reasons,
      sourceListingId: assessment.source.id,
      replacementListingId: assessment.replacement.id,
      highestVerifiedStage: assessment.highestVerifiedStage,
    },
  );
}

function lifecycleIsOpen(project, replacement) {
  if (replacement.listingOrigin !== "rotation-copy" || replacement.productionLifecycle?.format !== 1) return false;
  const source = project.listings.find((candidate) => candidate.id === replacement.rotationSourceListingId);
  if (!source) return false;
  if (normalizeWorkflowStatus(source.status) === WORKFLOW_STATUS.DELETED) {
    return replacement.productionLifecycle?.lifecycleStage !== ROTATION_LIFECYCLE_STAGE.COMPLETED;
  }
  const replacementStatus = normalizeWorkflowStatus(replacement.status, WORKFLOW_STATUS.PREPARED);
  return replacementStatus === WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT
    || Boolean(replacement.importConfirmedAt)
    || source.externalDeletionPending === true
    || new Set(["authorized", "pending_confirmation", "transfer_uncertain"]).has(source.productionDeleteState);
}

export function openProductionRotationLifecycles(state) {
  return (state.projects || []).flatMap((project) => (project.listings || [])
    .filter((replacement) => lifecycleIsOpen(project, replacement))
    .map((replacement) => {
      const source = project.listings.find((candidate) => candidate.id === replacement.rotationSourceListingId);
      return {
        projectId: project.id,
        sourceListingId: source?.id || "",
        sourceExternalId: source?.externalId || "",
        replacementListingId: replacement.id,
        replacementExternalId: replacement.externalId || "",
        lifecycleStage: replacement.productionLifecycle?.lifecycleStage || "",
      };
    }));
}

function updateReplacementLifecycle(state, input, patch, now) {
  const { project, replacement } = pairFor(state, input);
  const lifecycleStage = monotonicPersistedStage(
    replacement.productionLifecycle?.lifecycleStage,
    patch.lifecycleStage || replacement.productionLifecycle?.lifecycleStage,
  );
  const updatedReplacement = {
    ...replacement,
    productionLifecycle: {
      ...replacement.productionLifecycle,
      lifecycleIndex: input.lifecycleIndex,
      lifecycleStartedAt: replacement.productionLifecycle?.lifecycleStartedAt || input.lifecycleStartedAt || now,
      lifecycleUpdatedAt: now,
      ...patch,
      lifecycleStage,
    },
  };
  const group = normalizeListingGroup(project.listingGroup, project.id, { now });
  const updatedGroup = {
    ...group,
    variants: group.variants.map((variant) => variant.listing?.id === replacement.id
      ? { ...variant, listing: updatedReplacement, updatedAt: now }
      : variant),
  };
  return {
    ...state,
    projects: state.projects.map((candidate) => candidate.id === project.id
      ? {
          ...project,
          listings: project.listings.map((listing) => listing.id === replacement.id ? updatedReplacement : listing),
          listingGroup: updatedGroup,
        }
      : candidate),
  };
}

export function reconcileCompletedProductionLifecycleInState(
  state,
  input,
  uploadLedger,
  deleteLedger,
  options = {},
) {
  const reconciledAt = clean(options.now || new Date().toISOString(), 50);
  const assessment = assertConsistentLifecycleEvidence(
    inspectProductionRotationLifecycle(state, input, uploadLedger, deleteLedger),
  );
  if (!hasReached(assessment.highestVerifiedStage, ROTATION_LIFECYCLE_VERIFIED_STAGE.SOURCE_DELETED)) {
    throw lifecycleError(
      "LIFECYCLE_RECONCILIATION_REQUIRED",
      "Die konkrete Lifecycle-Kette besitzt noch keine vollständig belegte externe Import-/DELETE-Finalisierung.",
      { highestVerifiedStage: assessment.highestVerifiedStage },
    );
  }
  const lifecycle = assessment.replacement.productionLifecycle;
  if (lifecycle?.lifecycleStage === ROTATION_LIFECYCLE_STAGE.COMPLETED) {
    return {
      state,
      result: {
        status: "idempotent",
        sourceListingId: assessment.source.id,
        replacementListingId: assessment.replacement.id,
        highestVerifiedStage: assessment.highestVerifiedStage,
        completedAt: lifecycle.completedAt,
      },
    };
  }
  const startedAt = clean(lifecycle.lifecycleStartedAt || lifecycle.preparedAt || assessment.replacement.createdAt, 50);
  const completedAt = clean(assessment.deleteJob.confirmedAt || assessment.source.deleteConfirmedAt || reconciledAt, 50);
  const startedMs = Date.parse(startedAt);
  const completedMs = Date.parse(completedAt);
  const durationMs = Number.isFinite(startedMs) && Number.isFinite(completedMs)
    ? Math.max(0, completedMs - startedMs)
    : 0;
  const normalizedInput = {
    ...input,
    lifecycleIndex: Math.max(1, Math.trunc(Number(lifecycle.lifecycleIndex) || 1)),
    lifecycleStartedAt: startedAt,
    effectiveMaxRunItems: Math.max(1, Math.trunc(Number(
      lifecycle.effectiveMaxRunItems
      || lifecycle.batchOverrideMaxRunItems
      || 3,
    ) || 3)),
    overrideId: clean(lifecycle.batchOverrideId || lifecycle.overrideId, 200),
  };
  const nextState = updateReplacementLifecycle(state, normalizedInput, {
    lifecycleStage: ROTATION_LIFECYCLE_STAGE.COMPLETED,
    lifecycleLastError: "",
    lifecycleErrorCode: "",
    lifecycleFailedAt: "",
    observedStage: assessment.highestVerifiedStage,
    expectedStage: ROTATION_LIFECYCLE_VERIFIED_STAGE.SOURCE_DELETED,
    highestVerifiedStage: ROTATION_LIFECYCLE_VERIFIED_STAGE.SOURCE_DELETED,
    reconciledForward: true,
    reconciliationReason: "monotonic_external_completion_reconciliation",
    importConfirmedAt: assessment.replacement.importConfirmedAt,
    publishedAt: assessment.replacement.importConfirmedAt,
    deleteTransferredAt: assessment.deleteJob.transferCompletedAt,
    deleteConfirmedAt: assessment.deleteJob.confirmedAt,
    completedAt,
    reconciledAt,
    durationMs,
    finalResult: "success",
    reconciliationProvenance: {
      format: 1,
      reason: "monotonic_external_completion_reconciliation",
      reconciledAt,
      sourceListingId: assessment.source.id,
      replacementListingId: assessment.replacement.id,
      sourceExternalObjectNumber: assessment.source.externalId,
      replacementExternalObjectNumber: assessment.replacement.externalId,
      uploadJobId: assessment.uploadJob.jobId,
      importReportId: assessment.importReport.reportId,
      deleteJobId: assessment.deleteJob.deleteJobId,
      deleteReportId: assessment.deleteReport.reportId,
      externalMutations: 0,
    },
  }, reconciledAt);
  return {
    state: nextState,
    result: {
      status: "reconciled",
      sourceListingId: assessment.source.id,
      replacementListingId: assessment.replacement.id,
      highestVerifiedStage: ROTATION_LIFECYCLE_VERIFIED_STAGE.SOURCE_DELETED,
      completedAt,
      reconciledAt,
      externalMutations: 0,
    },
  };
}

function fatalImportResult(result, externalObjectNumber) {
  if (result?.errorCode) {
    return lifecycleError(
      result.errorCode,
      result.reason || "Die Importberichtprüfung ist fehlgeschlagen.",
      { externalObjectNumber },
    );
  }
  const rejected = (result?.processed || []).find((entry) =>
    entry.externalObjectNumber === externalObjectNumber
    && !new Set(["confirmed", "idempotent", "not-canary-authorized"]).has(entry.status));
  return rejected
    ? lifecycleError(
        rejected.errorCode || "ROTATION_IMPORT_REPORT_REJECTED",
        rejected.reason || "Der konkrete Importbericht wurde nicht eindeutig bestätigt.",
        { externalObjectNumber, status: rejected.status },
      )
    : null;
}

function fatalDeleteResult(result, sourceExternalId) {
  if ((result?.errors || []).length) {
    const first = result.errors[0];
    return lifecycleError(
      "ROTATION_DELETE_TRANSFER_FAILED",
      first.message || "Der Production-DELETE ist fehlgeschlagen.",
      { sourceExternalId },
    );
  }
  if (result?.ran === false && !new Set(["production-delete-run-in-progress"]).has(result.reason)) {
    return lifecycleError(
      "ROTATION_DELETE_SERVICE_BLOCKED",
      result.reason || "Der Production-DELETE-Dienst ist fail-closed gesperrt.",
      { sourceExternalId },
    );
  }
  return null;
}

export function createProductionRotationLifecycleCoordinator(options) {
  if (!options?.store?.load || !options?.store?.update) throw new Error("Der Lifecycle-Barriere fehlt der persistente Katalogspeicher.");
  if (!options?.importReportService?.runOnce) throw new Error("Der Lifecycle-Barriere fehlt der bestehende Importberichtdienst.");
  if (!options?.productionDeleteService?.runOnce) throw new Error("Der Lifecycle-Barriere fehlt der bestehende Production-DELETE-Dienst.");
  if (!options?.productionDeleteModeStore?.load) throw new Error("Der Lifecycle-Barriere fehlt der persistente Production-DELETE-Modus.");
  if (!options?.uploadJobLedger?.read || !options?.productionDeleteLedger?.read) throw new Error("Der Lifecycle-Barriere fehlen die bestehenden Upload-/DELETE-Ledger.");

  const pollIntervalMs = boundedMilliseconds(
    options.pollIntervalMs,
    DEFAULT_ROTATION_LIFECYCLE_POLL_INTERVAL_MS,
  );
  const importTimeoutMs = boundedMilliseconds(
    options.importTimeoutMs,
    DEFAULT_IMPORT_CONFIRMATION_TIMEOUT_MS,
  );
  const deleteTimeoutMs = boundedMilliseconds(
    options.deleteTimeoutMs,
    DEFAULT_DELETE_CONFIRMATION_TIMEOUT_MS,
  );
  const clock = options.clock || (() => Date.now());
  const now = options.now || (() => new Date(clock()).toISOString());
  const sleep = options.sleep || defaultSleep;
  const writeLog = options.writeLog || (async () => undefined);

  async function readAssessment(input) {
    const [snapshot, uploadLedger, deleteLedger] = await Promise.all([
      options.store.load(),
      options.uploadJobLedger.read(),
      options.productionDeleteLedger.read(),
    ]);
    return assertConsistentLifecycleEvidence(
      inspectProductionRotationLifecycle(snapshot.state, input, uploadLedger, deleteLedger),
    );
  }

  async function markStage(input, lifecycleStage, patch = {}) {
    const at = now();
    const updated = await options.store.update((state) => {
      const current = pairFor(state, input).replacement.productionLifecycle?.lifecycleStage;
      const persistedStage = monotonicPersistedStage(current, lifecycleStage);
      return {
        state: updateReplacementLifecycle(state, input, {
          lifecycleStage,
          lifecycleLastError: "",
          lifecycleErrorCode: "",
          lifecycleFailedAt: "",
          effectiveMaxRunItems: input.effectiveMaxRunItems,
          overrideId: input.overrideId || "",
          ...patch,
        }, at),
        result: { lifecycleStage: persistedStage },
      };
    }, { now: at });
    const persistedStage = updated.result?.lifecycleStage || lifecycleStage;
    await writeLog("lifecycle-stage", {
      schedulerRunId: input.schedulerRunId,
      productionSchedulerRunId: input.productionSchedulerRunId,
      rotationId: input.replacementListingId,
      lifecycleIndex: input.lifecycleIndex,
      lifecycleStage: persistedStage,
      requestedStage: lifecycleStage,
      startedAt: input.lifecycleStartedAt,
      effectiveMaxRunItems: input.effectiveMaxRunItems,
      overrideId: input.overrideId || null,
      ...patch,
    });
    return at;
  }

  async function observeProgress(input, expectedStage, assessment) {
    const observedStage = assessment.highestVerifiedStage;
    const currentStage = assessment.lifecycle?.lifecycleStage || ROTATION_LIFECYCLE_STAGE.AWAITING_IMPORT_CONFIRMATION;
    const inferredStage = persistedStageForVerifiedStage(observedStage);
    const reconciledForward = stageRank(observedStage) > stageRank(expectedStage)
      || PERSISTED_STAGE_ORDER.indexOf(inferredStage) > PERSISTED_STAGE_ORDER.indexOf(currentStage);
    const reconciliationReason = reconciledForward ? "background_recovery_progress_ahead" : "";
    if (reconciledForward) {
      await markStage(input, inferredStage, {
        observedStage,
        expectedStage,
        highestVerifiedStage: observedStage,
        reconciledForward: true,
        reconciliationReason,
      });
    }
    await writeLog("lifecycle-observed", {
      schedulerRunId: input.schedulerRunId,
      productionSchedulerRunId: input.productionSchedulerRunId,
      rotationId: input.replacementListingId,
      lifecycleIndex: input.lifecycleIndex,
      lifecycleStage: currentStage,
      observedStage,
      expectedStage,
      highestVerifiedStage: observedStage,
      reconciledForward,
      reconciliationReason: reconciliationReason || null,
    });
    return assessment;
  }

  async function markFailure(input, error, lifecycleStage) {
    const at = now();
    await options.store.update((state) => ({
      state: updateReplacementLifecycle(state, input, {
        lifecycleStage,
        lifecycleLastError: clean(error?.message || "Lifecycle fehlgeschlagen."),
        lifecycleErrorCode: clean(error?.code || "ROTATION_LIFECYCLE_FAILED", 120),
        lifecycleFailedAt: at,
      }, at),
    }), { now: at }).catch(() => undefined);
    await writeLog("lifecycle-failed", {
      schedulerRunId: input.schedulerRunId,
      productionSchedulerRunId: input.productionSchedulerRunId,
      rotationId: input.replacementListingId,
      lifecycleIndex: input.lifecycleIndex,
      lifecycleStage,
      effectiveMaxRunItems: input.effectiveMaxRunItems,
      overrideId: input.overrideId || null,
      errorCode: clean(error?.code || "ROTATION_LIFECYCLE_FAILED", 120),
      message: clean(error?.message || "Lifecycle fehlgeschlagen."),
      failedAt: at,
      durationMs: Math.max(0, clock() - input.lifecycleStartedAtMs),
      finalResult: "failed",
    }).catch(() => undefined);
  }

  async function heartbeat(input) {
    await input.heartbeat?.({ now: now() });
  }

  async function waitForImport(input) {
    const deadline = clock() + importTimeoutMs;
    while (true) {
      await heartbeat(input);
      const current = await readAssessment(input);
      await observeProgress(input, ROTATION_LIFECYCLE_VERIFIED_STAGE.IMPORT_CONFIRMED, current);
      if (hasReached(current.highestVerifiedStage, ROTATION_LIFECYCLE_VERIFIED_STAGE.IMPORT_CONFIRMED)) return current;
      const result = await options.importReportService.runOnce({
        trigger: "scheduler-lifecycle",
        allowedExternalObjectNumbers: [current.replacement.externalId],
      });
      const failure = fatalImportResult(result, current.replacement.externalId);
      if (failure) throw failure;
      const confirmed = await readAssessment(input);
      await observeProgress(input, ROTATION_LIFECYCLE_VERIFIED_STAGE.IMPORT_CONFIRMED, confirmed);
      if (hasReached(confirmed.highestVerifiedStage, ROTATION_LIFECYCLE_VERIFIED_STAGE.IMPORT_CONFIRMED)) return confirmed;
      const remaining = deadline - clock();
      if (remaining <= 0) {
        throw lifecycleError(
          "ROTATION_IMPORT_CONFIRMATION_TIMEOUT",
          `Für ${confirmed.replacement.externalId} wurde innerhalb des sicheren Zeitlimits kein eindeutiger positiver Importbericht bestätigt.`,
          { timeoutMs: importTimeoutMs, externalObjectNumber: confirmed.replacement.externalId },
        );
      }
      await sleep(Math.min(pollIntervalMs, remaining));
    }
  }

  async function waitForDelete(input) {
    const deadline = clock() + deleteTimeoutMs;
    while (true) {
      await heartbeat(input);
      const current = await readAssessment(input);
      await observeProgress(input, ROTATION_LIFECYCLE_VERIFIED_STAGE.SOURCE_DELETED, current);
      if (hasReached(current.highestVerifiedStage, ROTATION_LIFECYCLE_VERIFIED_STAGE.SOURCE_DELETED)) return current;
      const result = await options.productionDeleteService.runOnce({
        trigger: "scheduler-lifecycle",
        targetExternalObjectNumber: current.source.externalId,
      });
      const failure = fatalDeleteResult(result, current.source.externalId);
      if (failure) throw failure;
      const confirmed = await readAssessment(input);
      await observeProgress(input, ROTATION_LIFECYCLE_VERIFIED_STAGE.SOURCE_DELETED, confirmed);
      if (hasReached(confirmed.highestVerifiedStage, ROTATION_LIFECYCLE_VERIFIED_STAGE.SOURCE_DELETED)) return confirmed;
      const remaining = deadline - clock();
      if (remaining <= 0) {
        throw lifecycleError(
          "ROTATION_DELETE_CONFIRMATION_TIMEOUT",
          `Für ${confirmed.source.externalId} wurde innerhalb des sicheren Zeitlimits kein eindeutiger positiver Löschbericht bestätigt.`,
          { timeoutMs: deleteTimeoutMs, externalObjectNumber: confirmed.source.externalId },
        );
      }
      await sleep(Math.min(pollIntervalMs, remaining));
    }
  }

  async function verifyFinalCompletion(input) {
    const [snapshot, uploadLedger, deleteLedger] = await Promise.all([
      options.store.load(),
      options.uploadJobLedger.read(),
      options.productionDeleteLedger.read(),
    ]);
    const completion = assertConsistentLifecycleEvidence(
      inspectProductionRotationLifecycle(snapshot.state, input, uploadLedger, deleteLedger),
    );
    if (!hasReached(completion.highestVerifiedStage, ROTATION_LIFECYCLE_VERIFIED_STAGE.SOURCE_DELETED)) {
      throw lifecycleError("ROTATION_LIFECYCLE_FINAL_STATE_INVALID", "Die Rotation besitzt noch keinen final bestätigten Katalogzustand.");
    }
    const reasons = [];
    if (!completion.importReport) reasons.push("positive_import_report_missing");
    if (!completion.uploadJob || ACTIVE_UPLOAD_STATUSES.has(completion.uploadJob.status)) reasons.push("upload_job_not_terminal");
    if (!completion.deleteJob || completion.deleteJob.status !== PRODUCTION_DELETE_STATUS.CONFIRMED) reasons.push("delete_job_not_confirmed");
    if ((deleteLedger.jobs || []).some((job) =>
      (job.sourceListingId === completion.source.id || job.replacementListingId === completion.replacement.id)
      && OPEN_DELETE_STATUSES.has(job.status))) reasons.push("open_delete_job_present");
    if (completion.sourceControl.processLease || completion.replacementControl.processLease) reasons.push("catalog_process_lease_present");
    if (reasons.length) {
      throw lifecycleError(
        "ROTATION_LIFECYCLE_FINAL_PROOF_INCOMPLETE",
        `Die finale Lifecycle-Evidenz ist unvollständig: ${reasons.join(", ")}.`,
        { reasons },
      );
    }
    return completion;
  }

  async function recoverFinalizedLifecycles(state, inputValue = {}) {
    const recoveredAt = now();
    const candidates = (state.projects || []).flatMap((project) => (project.listings || [])
      .filter((replacement) => {
        if (
          replacement.listingOrigin !== "rotation-copy"
          || replacement.productionLifecycle?.format !== 1
          || replacement.productionLifecycle?.lifecycleStage === ROTATION_LIFECYCLE_STAGE.COMPLETED
        ) return false;
        const source = project.listings.find((candidate) => candidate.id === replacement.rotationSourceListingId);
        return normalizeWorkflowStatus(source?.status) === WORKFLOW_STATUS.DELETED;
      })
      .map((replacement) => ({
        schedulerRunId: clean(inputValue.schedulerRunId || `recovery:${replacement.id}`, 200),
        productionSchedulerRunId: clean(replacement.productionLifecycle.schedulerRunId, 200),
        projectId: project.id,
        sourceListingId: replacement.rotationSourceListingId,
        replacementListingId: replacement.id,
        lifecycleIndex: Math.max(1, Math.trunc(Number(replacement.productionLifecycle.lifecycleIndex) || 1)),
        lifecycleStartedAt: clean(
          replacement.productionLifecycle.lifecycleStartedAt
          || replacement.productionLifecycle.preparedAt
          || replacement.createdAt
          || recoveredAt,
          50,
        ),
        effectiveMaxRunItems: Math.max(
          1,
          Math.trunc(Number(
            replacement.productionLifecycle.effectiveMaxRunItems
            || replacement.productionLifecycle.batchOverrideMaxRunItems
            || 3,
          ) || 3),
        ),
        overrideId: clean(replacement.productionLifecycle.batchOverrideId, 200),
      })));
    for (const candidate of candidates) {
      let final;
      try {
        final = await verifyFinalCompletion(candidate);
      } catch (error) {
        await writeLog("lifecycle-recovery-blocked", {
          schedulerRunId: candidate.schedulerRunId,
          productionSchedulerRunId: candidate.productionSchedulerRunId,
          rotationId: candidate.replacementListingId,
          lifecycleIndex: candidate.lifecycleIndex,
          errorCode: clean(error?.code || "ROTATION_LIFECYCLE_RECOVERY_PROOF_INCOMPLETE", 120),
          message: clean(error?.message || "Die Recovery-Evidenz ist unvollständig."),
          recoveredAt,
        }).catch(() => undefined);
        throw lifecycleError(
          "ROTATION_LIFECYCLE_RECOVERY_PROOF_INCOMPLETE",
          "Eine final wirkende frühere Rotation besitzt keine vollständig verifizierbare Import-/DELETE-Evidenz; neue Rotationen bleiben gesperrt.",
          { replacementListingId: candidate.replacementListingId, causeCode: error?.code || "" },
        );
      }
      const startedMs = Date.parse(candidate.lifecycleStartedAt);
      const completedAt = clean(final.deleteJob.confirmedAt || recoveredAt, 50);
      const completedMs = Date.parse(completedAt);
      const durationMs = Number.isFinite(startedMs) && Number.isFinite(completedMs)
        ? Math.max(0, completedMs - startedMs)
        : 0;
      await markStage(candidate, ROTATION_LIFECYCLE_STAGE.COMPLETED, {
        importConfirmedAt: final.replacement.importConfirmedAt,
        publishedAt: final.replacement.importConfirmedAt,
        deleteTransferredAt: final.deleteJob.transferCompletedAt,
        deleteConfirmedAt: final.deleteJob.confirmedAt,
        completedAt,
        recoveredAt,
        durationMs,
        finalResult: "success",
        observedStage: final.highestVerifiedStage,
        expectedStage: ROTATION_LIFECYCLE_VERIFIED_STAGE.SOURCE_DELETED,
        highestVerifiedStage: ROTATION_LIFECYCLE_VERIFIED_STAGE.SOURCE_DELETED,
        reconciledForward: true,
        reconciliationReason: "restart_recovery_external_completion",
      });
      await writeLog("lifecycle-recovered", {
        schedulerRunId: candidate.schedulerRunId,
        productionSchedulerRunId: candidate.productionSchedulerRunId,
        rotationId: candidate.replacementListingId,
        lifecycleIndex: candidate.lifecycleIndex,
        lifecycleStage: ROTATION_LIFECYCLE_STAGE.COMPLETED,
        completedAt,
        recoveredAt,
        durationMs,
        finalResult: "success",
      });
    }
    return candidates.length;
  }

  async function preflight(inputValue = {}) {
    const [mode, snapshot] = await Promise.all([
      options.productionDeleteModeStore.load(),
      options.store.load(),
    ]);
    if (mode.valid !== true || mode.mode !== "active") {
      return {
        ok: false,
        code: "ROTATION_LIFECYCLE_DELETE_MODE_OFF",
        reason: mode.fallbackReason || "Production-DELETE ist nicht aktiv; eine vollständig serielle Produktionsrotation darf nicht starten.",
      };
    }
    if (!snapshot?.stored || !snapshot.state) {
      return { ok: false, code: "ROTATION_LIFECYCLE_CATALOG_UNAVAILABLE", reason: "Der persistente Katalog ist nicht sicher lesbar." };
    }
    let currentState = snapshot.state;
    const recoveredCount = await recoverFinalizedLifecycles(currentState, inputValue);
    if (recoveredCount) currentState = (await options.store.load()).state;
    const open = openProductionRotationLifecycles(currentState);
    if (open.length) {
      return {
        ok: false,
        code: "ROTATION_LIFECYCLE_RECOVERY_PENDING",
        reason: `${open.length} frühere Produktions-Lifecycle-Kette(n) sind noch nicht final bestätigt; neue Rotationen bleiben gesperrt.`,
        open,
      };
    }
    return { ok: true, open: [], recoveredCount };
  }

  async function complete(inputValue = {}) {
    const lifecycleStartedAtMs = clock();
    const lifecycleStartedAt = clean(inputValue.lifecycleStartedAt || now(), 50);
    const input = {
      ...inputValue,
      schedulerRunId: clean(inputValue.schedulerRunId, 200),
      productionSchedulerRunId: clean(inputValue.productionSchedulerRunId || inputValue.schedulerRunId, 200),
      projectId: clean(inputValue.projectId, 200),
      sourceListingId: clean(inputValue.sourceListingId, 200),
      replacementListingId: clean(inputValue.replacementListingId, 200),
      lifecycleIndex: Math.max(1, Math.trunc(Number(inputValue.lifecycleIndex) || 1)),
      lifecycleStartedAt,
      lifecycleStartedAtMs,
      effectiveMaxRunItems: Math.max(1, Math.trunc(Number(inputValue.effectiveMaxRunItems) || 1)),
      overrideId: clean(inputValue.overrideId, 200),
    };
    if (!input.schedulerRunId || !input.projectId || !input.sourceListingId || !input.replacementListingId) {
      throw lifecycleError("ROTATION_LIFECYCLE_INPUT_INVALID", "Die Lifecycle-Barriere benötigt Schedulerlauf und eindeutige Listing-IDs.");
    }
    let stage = ROTATION_LIFECYCLE_STAGE.AWAITING_IMPORT_CONFIRMATION;
    try {
      const initial = await readAssessment(input);
      if (!hasReached(initial.highestVerifiedStage, ROTATION_LIFECYCLE_VERIFIED_STAGE.TRANSFERRED_PENDING_IMPORT)) {
        throw lifecycleError("ROTATION_LIFECYCLE_TRANSFER_NOT_PERSISTED", "Die Lifecycle-Barriere startet erst nach persistiertem erfolgreichem FTPS-Transfer.");
      }
      if (initial.replacement.productionLifecycle?.schedulerRunId !== input.productionSchedulerRunId) {
        throw lifecycleError("ROTATION_LIFECYCLE_PROVENANCE_MISMATCH", "Die persistierte Produktionsprovenienz stimmt nicht mit der Lifecycle-Kette überein.");
      }
      const ftpsCompletedAt = clean(input.ftpsCompletedAt || initial.uploadJob.transferredAt || initial.replacement.transferredAt || now(), 50);
      await observeProgress(input, ROTATION_LIFECYCLE_VERIFIED_STAGE.TRANSFERRED_PENDING_IMPORT, initial);
      await markStage(input, stage, {
        ftpsCompletedAt,
        observedStage: initial.highestVerifiedStage,
        expectedStage: ROTATION_LIFECYCLE_VERIFIED_STAGE.TRANSFERRED_PENDING_IMPORT,
        highestVerifiedStage: initial.highestVerifiedStage,
        reconciledForward: stageRank(initial.highestVerifiedStage) > stageRank(ROTATION_LIFECYCLE_VERIFIED_STAGE.TRANSFERRED_PENDING_IMPORT),
        reconciliationReason: stageRank(initial.highestVerifiedStage) > stageRank(ROTATION_LIFECYCLE_VERIFIED_STAGE.TRANSFERRED_PENDING_IMPORT)
          ? "background_recovery_progress_ahead"
          : "",
      });

      const imported = await waitForImport(input);
      stage = ROTATION_LIFECYCLE_STAGE.POST_IMPORT_PRE_DELETE;
      await markStage(input, stage, {
        importConfirmedAt: imported.replacement.importConfirmedAt,
        publishedAt: imported.replacement.importConfirmedAt,
        observedStage: imported.highestVerifiedStage,
        expectedStage: ROTATION_LIFECYCLE_VERIFIED_STAGE.IMPORT_CONFIRMED,
        highestVerifiedStage: imported.highestVerifiedStage,
        reconciledForward: stageRank(imported.highestVerifiedStage) > stageRank(ROTATION_LIFECYCLE_VERIFIED_STAGE.IMPORT_CONFIRMED),
        reconciliationReason: stageRank(imported.highestVerifiedStage) > stageRank(ROTATION_LIFECYCLE_VERIFIED_STAGE.IMPORT_CONFIRMED)
          ? "background_recovery_progress_ahead"
          : "",
      });

      stage = ROTATION_LIFECYCLE_STAGE.AWAITING_DELETE_CONFIRMATION;
      await markStage(input, stage);
      const deleted = await waitForDelete(input);
      const final = await verifyFinalCompletion(input);
      stage = ROTATION_LIFECYCLE_STAGE.COMPLETED;
      const completedAt = now();
      const durationMs = Math.max(0, clock() - lifecycleStartedAtMs);
      await markStage(input, stage, {
        deleteTransferredAt: final.deleteJob.transferCompletedAt,
        deleteConfirmedAt: final.deleteJob.confirmedAt,
        completedAt,
        durationMs,
        finalResult: "success",
        observedStage: final.highestVerifiedStage,
        expectedStage: ROTATION_LIFECYCLE_VERIFIED_STAGE.SOURCE_DELETED,
        highestVerifiedStage: ROTATION_LIFECYCLE_VERIFIED_STAGE.SOURCE_DELETED,
      });
      return {
        ok: true,
        schedulerRunId: input.schedulerRunId,
        productionSchedulerRunId: input.productionSchedulerRunId,
        rotationId: input.replacementListingId,
        lifecycleIndex: input.lifecycleIndex,
        lifecycleStage: stage,
        startedAt: lifecycleStartedAt,
        ftpsCompletedAt,
        importConfirmedAt: imported.replacement.importConfirmedAt,
        publishedAt: imported.replacement.importConfirmedAt,
        deleteTransferredAt: final.deleteJob.transferCompletedAt,
        deleteConfirmedAt: final.deleteJob.confirmedAt,
        completedAt,
        durationMs,
        finalResult: "success",
        effectiveMaxRunItems: input.effectiveMaxRunItems,
        overrideId: input.overrideId || null,
        sourceExternalId: deleted.source.externalId,
        replacementExternalId: deleted.replacement.externalId,
      };
    } catch (error) {
      await markFailure(input, error, stage);
      throw error;
    }
  }

  return { preflight, complete };
}
