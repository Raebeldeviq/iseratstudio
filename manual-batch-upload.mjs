import { createBatchUploadPlan } from "./batch-upload.mjs";
import { WORKFLOW_STATUS } from "./workflow-status.mjs";

export const UPLOAD_ORIGIN = Object.freeze({
  AUTOMATIC_ROTATION: "automatic-rotation",
  MANUAL_BATCH: "manual-batch",
  LEGACY_MANUAL: "legacy-manual",
});

function text(value) {
  return String(value ?? "").trim();
}

function isCompletedTransfer(status) {
  return [WORKFLOW_STATUS.PUBLISHED, WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT].includes(text(status));
}

export function requiresPlotDailyUploadClaim(uploadOrigin) {
  // Only the dedicated local manual batch endpoint is exempt. Unknown and legacy
  // origins remain fail-closed behind the regular plot/day guard.
  return text(uploadOrigin) !== UPLOAD_ORIGIN.MANUAL_BATCH;
}

export function completedManualBatchListingIds(uploadLedger, projectIds = []) {
  const selectedProjectIds = new Set((Array.isArray(projectIds) ? projectIds : []).map(text).filter(Boolean));
  return [...new Set((uploadLedger?.jobs || [])
    .filter((job) => selectedProjectIds.has(text(job.projectId)) && isCompletedTransfer(job.status))
    .map((job) => text(job.listingId))
    .filter(Boolean))];
}

export function createManualBatchResumptionPlan(state, projectIds, uploadLedger, options = {}) {
  const protectedListingIds = completedManualBatchListingIds(uploadLedger, projectIds);
  const excludedListingIds = [...new Set([
    ...(options.excludedListingIds || []),
    ...protectedListingIds,
  ])];
  return {
    protectedListingIds,
    plan: createBatchUploadPlan(state, projectIds, { ...options, excludedListingIds }),
  };
}
