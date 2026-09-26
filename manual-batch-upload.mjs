import { createBatchUploadPlan } from "./batch-upload.mjs";
import { listingControl } from "./listing-groups.mjs";
import { updatePreparedCopyAfterUpload } from "./listing-transfer-state.mjs";
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

export function reconcileCompletedManualBatchTransferInState(state, input = {}) {
  const projectId = text(input.projectId);
  const listingId = text(input.listingId);
  const jobId = text(input.jobId);
  const transferredAt = text(input.transferredAt) || new Date().toISOString();
  if (text(input.ledgerStatus) !== WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT) {
    throw new Error("Der manuelle Transfer darf nur mit abgeschlossenem Uploadnachweis in den Katalog übernommen werden.");
  }
  const project = (state.projects || []).find((candidate) => candidate.id === projectId);
  const listing = project?.listings.find((candidate) => candidate.id === listingId);
  if (!project || !listing) throw new Error("Der abgeschlossene Upload-Job passt zu keinem gespeicherten Inserat.");
  const expectedJobPrefix = [
    "upload",
    project.id,
    listing.id,
    listing.externalId || "",
    listing.version || 1,
    "",
  ].join(":");
  if (!jobId.startsWith(expectedJobPrefix) || jobId.length <= expectedJobPrefix.length) {
    throw new Error("Der abgeschlossene Upload-Job passt nicht zur gespeicherten Inseratsversion.");
  }
  const source = listing.rotationSourceListingId
    ? project.listings.find((candidate) => candidate.id === listing.rotationSourceListingId)
    : null;
  if (listing.rotationSourceListingId && !source) {
    throw new Error("Die Quelle der übertragenen Rotationskopie ist nicht mehr vorhanden.");
  }
  const sourceStatus = source ? text(source.status) : "";
  const sourceControlBefore = source ? listingControl(project.listingGroup, source) : null;
  if (source && sourceControlBefore?.status !== WORKFLOW_STATUS.PUBLISHED) {
    throw new Error("Die Quelle der übertragenen Rotationskopie ist nicht mehr veröffentlicht.");
  }
  const status = text(listing.status);
  if (status === WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT) {
    const existingLog = (state.uploadHistory || []).find((entry) => entry.jobId === jobId);
    const sourceControl = source ? listingControl(project.listingGroup, source) : null;
    if (existingLog && (!source || (
      sourceControl?.pendingRotationListingId === listing.id
      && sourceControl?.pendingRotationJobId === jobId
    ))) return state;
  }
  if (![WORKFLOW_STATUS.DRAFT, WORKFLOW_STATUS.PREPARED, WORKFLOW_STATUS.FAILED, WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT].includes(status)) {
    throw new Error("Der abgeschlossene Upload-Job darf den aktuellen Inseratsstatus nicht überschreiben.");
  }
  const nextState = updatePreparedCopyAfterUpload(state, project.id, listing.id, {
    ok: true,
    jobId,
    runId: text(input.runId) || "manual-batch",
  }, transferredAt);
  const nextProject = nextState.projects.find((candidate) => candidate.id === project.id);
  const nextListing = nextProject?.listings.find((candidate) => candidate.id === listing.id);
  const nextSource = source
    ? nextProject?.listings.find((candidate) => candidate.id === source.id)
    : null;
  const nextSourceControl = nextSource ? listingControl(nextProject.listingGroup, nextSource) : null;
  if (nextListing?.status !== WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT) {
    throw new Error("Der abgeschlossene Upload-Job konnte nicht fail-closed persistiert werden.");
  }
  if (nextSource && (
    text(nextSource.status) !== sourceStatus
    || text(nextSource.rotationArchivedAt) !== text(source.rotationArchivedAt)
    || nextSourceControl?.status !== WORKFLOW_STATUS.PUBLISHED
  )) {
    throw new Error("Die veröffentlichte Quelle würde vor der Importbestätigung verändert.");
  }
  return nextState;
}
