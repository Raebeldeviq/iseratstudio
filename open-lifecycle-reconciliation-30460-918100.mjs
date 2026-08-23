import {
  inspectProductionRotationLifecycle,
  reconcileCompletedProductionLifecycleInState,
} from "./listing-rotation-lifecycle-coordinator.mjs";
import { resolveProductionDeleteEligibility } from "./listing-rotation-production-delete.mjs";
import { WORKFLOW_STATUS } from "./workflow-status.mjs";

export const OPEN_LIFECYCLE_30460_918100 = Object.freeze({
  projectId: "270e5aff-7253-4cfe-8d59-46269d303edd",
  plotId: "a9e6e0b1-60c3-4752-a957-3cc0c6e5e0eb",
  sourceListingId: "93281cd6-34a0-4088-a381-9ed4d33cce6d",
  sourceExternalObjectNumber: "30460-261429",
  replacementListingId: "rotation-068e29ee-862043b5-3457e6ce-copy",
  replacementExternalObjectNumber: "30460-918100",
  rotationId: "rotation-068e29ee-862043b5-3457e6ce-copy",
  schedulerRunId: "f216cec7-b57f-4d01-817f-475e730eae03",
  interruptedRecoveryRunId: "47307007-f4e4-489e-a05a-58244e59f37f",
  uploadJobId: "upload:270e5aff-7253-4cfe-8d59-46269d303edd:rotation-068e29ee-862043b5-3457e6ce-copy:30460-918100:2:normal",
  batchOverrideId: "production-batch-override:03244a2d-1299-44cd-ba42-84400cb43b4c",
  runtimeCommit: "b6d4c5eee7ac48913ca7e806c9b082de831fb3c5",
});

function contractError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function exactPair(state) {
  const contract = OPEN_LIFECYCLE_30460_918100;
  const project = (state.projects || []).find((candidate) => candidate.id === contract.projectId);
  const source = project?.listings?.find((candidate) => candidate.id === contract.sourceListingId);
  const replacement = project?.listings?.find((candidate) => candidate.id === contract.replacementListingId);
  if (
    !project
    || project.plotId !== contract.plotId
    || !source
    || source.externalId !== contract.sourceExternalObjectNumber
    || !replacement
    || replacement.externalId !== contract.replacementExternalObjectNumber
    || replacement.rotationSourceListingId !== source.id
    || replacement.listingOrigin !== "rotation-copy"
  ) {
    throw contractError("OPEN_LIFECYCLE_EXACT_RELATION_MISMATCH", "Die hart begrenzte Source-/Replacement-/Plot-Beziehung stimmt nicht mehr mit dem Katalog überein.");
  }
  const lifecycle = replacement.productionLifecycle;
  if (
    lifecycle?.format !== 1
    || lifecycle.schedulerRunId !== contract.schedulerRunId
    || lifecycle.sourceListingId !== contract.sourceListingId
    || lifecycle.batchOverrideId !== contract.batchOverrideId
    || lifecycle.runtimeCommit !== contract.runtimeCommit
    || lifecycle.automaticDeleteAuthorized !== true
  ) {
    throw contractError("OPEN_LIFECYCLE_PROVENANCE_MISMATCH", "Die hart begrenzte Rotations-/Scheduler-/Runtime-Provenienz stimmt nicht mehr überein.");
  }
  return { project, source, replacement };
}

export function inspectOpenLifecycle30460918100(state, uploadLedger, deleteLedger, uploadTransferEvents = []) {
  const contract = OPEN_LIFECYCLE_30460_918100;
  const { project, source, replacement } = exactPair(state);
  const uploadJobs = (uploadLedger.jobs || []).filter((job) =>
    job.jobId === contract.uploadJobId
    || job.listingId === contract.replacementListingId
    || job.externalObjectNumber === contract.replacementExternalObjectNumber);
  if (uploadJobs.length !== 1 || uploadJobs[0].jobId !== contract.uploadJobId) {
    throw contractError("OPEN_LIFECYCLE_UPLOAD_JOB_MISMATCH", "Der offene Lifecycle besitzt nicht exakt den erwarteten Uploadjob.");
  }
  const transferEvents = uploadTransferEvents.filter((event) =>
    event.event === "transferred"
    && event.jobId === contract.uploadJobId
    && event.externalId === contract.replacementExternalObjectNumber);
  if (transferEvents.length > 1) {
    throw contractError("OPEN_LIFECYCLE_DUPLICATE_UPLOAD_EVIDENCE", "Für das Replacement existiert mehr als ein bestätigtes FTPS-Transferereignis.");
  }
  const deleteJobs = (deleteLedger.jobs || []).filter((job) =>
    job.sourceListingId === contract.sourceListingId
    || job.externalObjectNumber === contract.sourceExternalObjectNumber);
  if (deleteJobs.length > 1) {
    throw contractError("OPEN_LIFECYCLE_MULTIPLE_DELETE_JOBS", "Für die hart begrenzte Source existiert mehr als ein Deletejob.");
  }
  const lifecycle = inspectProductionRotationLifecycle(
    state,
    {
      projectId: contract.projectId,
      sourceListingId: contract.sourceListingId,
      replacementListingId: contract.replacementListingId,
    },
    uploadLedger,
    deleteLedger,
  );
  return {
    contract,
    projectId: project.id,
    plotId: project.plotId,
    source: {
      id: source.id,
      externalObjectNumber: source.externalId,
      status: source.status,
      externalDeletionPending: source.externalDeletionPending === true,
      productionDeleteState: source.productionDeleteState || "",
      deleteJobId: source.productionDeleteJobId || source.deleteJobId || "",
    },
    replacement: {
      id: replacement.id,
      externalObjectNumber: replacement.externalId,
      status: replacement.status,
      importConfirmedAt: replacement.importConfirmedAt || "",
      importReportId: replacement.importReportId || "",
      lastUploadedAt: replacement.lastUploadedAt || "",
      nextUpdateAt: replacement.nextUpdateAt || "",
      lifecycleStage: replacement.productionLifecycle?.lifecycleStage || "",
    },
    upload: {
      jobId: uploadJobs[0].jobId,
      status: uploadJobs[0].status,
      transferredAt: uploadJobs[0].transferredAt || "",
      confirmedTransferCount: transferEvents.length,
    },
    delete: deleteJobs[0] ? {
      jobId: deleteJobs[0].deleteJobId,
      status: deleteJobs[0].status,
      attempt: deleteJobs[0].attempt,
      transferCompletedAt: deleteJobs[0].transferCompletedAt || "",
      confirmedAt: deleteJobs[0].confirmedAt || "",
    } : null,
    lifecycleEvidence: {
      consistent: lifecycle.consistent,
      reasons: lifecycle.reasons,
      highestVerifiedStage: lifecycle.highestVerifiedStage,
      observedStage: lifecycle.observedStage,
    },
  };
}

export function assertExactDeleteEligible30460918100(state, deleteLedger) {
  const { project, source, replacement } = exactPair(state);
  if (replacement.status !== WORKFLOW_STATUS.PUBLISHED || !replacement.importConfirmedAt || !replacement.importReportId) {
    throw contractError("OPEN_LIFECYCLE_IMPORT_NOT_CONFIRMED", "Das Replacement besitzt noch keine eindeutige positive Importbestätigung.");
  }
  if (source.status !== WORKFLOW_STATUS.PUBLISHED) {
    throw contractError("OPEN_LIFECYCLE_SOURCE_NOT_PUBLISHED", "Nur die noch veröffentlichte exakte Source darf in den Production-DELETE-Pfad übergeben werden.");
  }
  return resolveProductionDeleteEligibility(state, project.id, source.id, deleteLedger);
}

export function reconcileCompletedOpenLifecycle30460918100(state, uploadLedger, deleteLedger, options = {}) {
  exactPair(state);
  return reconcileCompletedProductionLifecycleInState(
    state,
    {
      projectId: OPEN_LIFECYCLE_30460_918100.projectId,
      sourceListingId: OPEN_LIFECYCLE_30460_918100.sourceListingId,
      replacementListingId: OPEN_LIFECYCLE_30460_918100.replacementListingId,
    },
    uploadLedger,
    deleteLedger,
    options,
  );
}
