import {
  createDeleteCanaryJobIdentity,
  DELETE_CANARY_STATUS,
  DELETE_CANARY_TARGET,
} from "./immoprofessional-delete-canary.mjs";
import {
  listingControl,
  normalizeListingGroup,
  updateListingControl,
} from "./listing-groups.mjs";
import { schedulerDueListings } from "./listing-scheduler.mjs";
import { WORKFLOW_STATUS } from "./workflow-status.mjs";

export const HISTORICAL_DELETE_RECONCILIATION = Object.freeze({
  externalObjectNumber: DELETE_CANARY_TARGET,
  projectId: "1f62a4f1-42f2-4787-9fcb-1c5af864a5a8",
  listingId: "9baa0d5f-f8f6-4950-b63a-c771278a50d5",
  confirmationSource: "confirmed_delete_canary_ledger_reconciliation",
});

function reconciliationError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function clean(value, maximum = 500) {
  return String(value ?? "").trim().slice(0, maximum);
}

function matchingUploadJobs(uploadLedger, contract) {
  return (uploadLedger?.jobs || []).filter((job) =>
    clean(job.listingId, 200) === contract.listingId
    || clean(job.externalObjectNumber, 40) === contract.externalObjectNumber);
}

function matchingProductionDeleteJobs(productionDeleteLedger, contract) {
  return (productionDeleteLedger?.jobs || []).filter((job) =>
    clean(job.sourceListingId, 200) === contract.listingId
    || clean(job.externalObjectNumber, 40) === contract.externalObjectNumber);
}

function matchingCanaryDeleteJobs(canaryDeleteLedger, contract) {
  return (canaryDeleteLedger?.jobs || []).filter((job) =>
    clean(job.sourceListingId, 200) === contract.listingId
    || clean(job.externalObjectNumber, 40) === contract.externalObjectNumber);
}

function findExactCatalogTarget(state, contract) {
  const matches = (state?.projects || []).flatMap((project) =>
    (project.listings || [])
      .filter((listing) => clean(listing.externalId, 40) === contract.externalObjectNumber)
      .map((listing) => ({ project, listing })));
  if (matches.length !== 1) {
    throw reconciliationError(
      matches.length ? "HISTORICAL_DELETE_TARGET_AMBIGUOUS" : "HISTORICAL_DELETE_TARGET_MISSING",
      "Der historische Löschdatensatz ist im Katalog nicht eindeutig vorhanden.",
    );
  }
  const match = matches[0];
  if (match.project.id !== contract.projectId || match.listing.id !== contract.listingId) {
    throw reconciliationError(
      "HISTORICAL_DELETE_TARGET_IDENTITY_MISMATCH",
      "Projekt- oder Listing-ID des historischen Löschdatensatzes stimmt nicht mit dem fest kompilierten Vertrag überein.",
    );
  }
  return match;
}

function validateConfirmedCanaryProof(canaryDeleteLedger, contract) {
  const jobs = matchingCanaryDeleteJobs(canaryDeleteLedger, contract);
  const expectedIdentity = createDeleteCanaryJobIdentity(contract.externalObjectNumber);
  if (jobs.length !== 1) {
    throw reconciliationError(
      "HISTORICAL_DELETE_PROOF_NOT_UNIQUE",
      "Der bestätigte historische Delete-Canary-Beleg ist nicht eindeutig.",
    );
  }
  const job = jobs[0];
  if (
    job.deleteJobId !== expectedIdentity.deleteJobId
    || job.idempotencyKey !== expectedIdentity.idempotencyKey
    || job.externalObjectNumber !== contract.externalObjectNumber
    || job.sourceListingId !== contract.listingId
    || job.status !== DELETE_CANARY_STATUS.CONFIRMED
    || job.providerResult !== "success"
    || job.attempt !== 1
    || !clean(job.providerReportMessageId, 500)
    || !/^[a-f0-9]{64}$/u.test(clean(job.providerReportHash, 128))
    || !clean(job.providerProcessedAt, 50)
    || !clean(job.confirmationReceivedAt, 50)
  ) {
    throw reconciliationError(
      "HISTORICAL_DELETE_PROOF_INVALID",
      "Der historische Delete-Canary-Beleg ist unvollständig oder nicht positiv bestätigt.",
    );
  }
  return job;
}

export function resolveHistoricalDeleteStateReconciliation(state, ledgers, options = {}) {
  const contract = HISTORICAL_DELETE_RECONCILIATION;
  const requestedTarget = clean(options.externalObjectNumber || contract.externalObjectNumber, 40);
  if (requestedTarget !== contract.externalObjectNumber) {
    throw reconciliationError(
      "HISTORICAL_DELETE_TARGET_NOT_AUTHORIZED",
      "Die einmalige Reconciliation ist ausschließlich für 30460-287191 freigegeben.",
    );
  }
  const { project, listing } = findExactCatalogTarget(state, contract);
  const group = normalizeListingGroup(project.listingGroup, project.id, {
    now: options.now || new Date().toISOString(),
  });
  const control = listingControl(group, listing);
  const canaryDeleteJob = validateConfirmedCanaryProof(ledgers?.canaryDeleteLedger, contract);
  const uploadJobs = matchingUploadJobs(ledgers?.uploadLedger, contract);
  const productionDeleteJobs = matchingProductionDeleteJobs(ledgers?.productionDeleteLedger, contract);
  const rotationCopies = (project.listings || []).filter((candidate) =>
    clean(candidate.rotationSourceListingId, 200) === listing.id);

  const reasons = [];
  if (![WORKFLOW_STATUS.PUBLISHED, WORKFLOW_STATUS.DELETED].includes(listing.status)) reasons.push("catalog_status_not_reconcilable");
  if (clean(listing.supersededByListingId, 200)) reasons.push("replacement_relation_present");
  if (rotationCopies.length) reasons.push("rotation_copy_present");
  if (control.processLease) reasons.push("process_lease_active");
  if (control.schedulerSelectionId || control.schedulerSelectedAt) reasons.push("scheduler_reservation_active");
  if (control.pendingRotationListingId || control.pendingRotationJobId) reasons.push("pending_rotation_present");
  if (uploadJobs.length !== 1 || uploadJobs[0]?.status !== WORKFLOW_STATUS.PUBLISHED) reasons.push("upload_history_not_terminal_published");
  if (productionDeleteJobs.length) reasons.push("production_delete_job_present");
  if (reasons.length) {
    throw reconciliationError(
      "HISTORICAL_DELETE_RECONCILIATION_BLOCKED",
      `Der historische Katalogfall ist nicht sicher reconciliierbar: ${reasons.join(", ")}.`,
      { reasons },
    );
  }

  const reportId = `delete-report-${canaryDeleteJob.providerReportHash.slice(0, 32)}`;
  const storedReport = (state.deleteReports || []).find((report) => report.reportId === reportId);
  const idempotent = listing.status === WORKFLOW_STATUS.DELETED
    && control.status === WORKFLOW_STATUS.DELETED
    && control.automaticUpdateEnabled === false
    && listing.externalDeletionPending === false
    && listing.deleteJobId === canaryDeleteJob.deleteJobId
    && listing.deleteReportHash === canaryDeleteJob.providerReportHash
    && storedReport?.externalObjectNumber === contract.externalObjectNumber;
  if (listing.status === WORKFLOW_STATUS.DELETED && !idempotent) {
    throw reconciliationError(
      "HISTORICAL_DELETE_ALREADY_DELETED_CONFLICT",
      "Der Katalogdatensatz ist bereits gelöscht, stimmt aber nicht vollständig mit dem bestätigten Canary-Beleg überein.",
    );
  }
  return {
    contract,
    project,
    listing,
    group,
    control,
    canaryDeleteJob,
    uploadJob: uploadJobs[0],
    reportId,
    idempotent,
  };
}

export function reconcileHistoricalDeleteStateInState(state, ledgers, options = {}) {
  const now = clean(options.now || new Date().toISOString(), 50);
  const eligibility = resolveHistoricalDeleteStateReconciliation(state, ledgers, {
    ...options,
    now,
  });
  if (eligibility.idempotent) {
    return { state, changed: false, idempotent: true, eligibility };
  }
  const { project, listing, canaryDeleteJob, reportId, contract } = eligibility;
  const deletedListing = {
    ...listing,
    status: WORKFLOW_STATUS.DELETED,
    statusMessage: `Extern gelöscht · ${contract.externalObjectNumber}`,
    externalDeletionPending: false,
    externalDeletionConfirmedAt: canaryDeleteJob.providerProcessedAt,
    deleteConfirmedAt: canaryDeleteJob.confirmationReceivedAt,
    deleteReportMessageId: canaryDeleteJob.providerReportMessageId,
    deleteReportHash: canaryDeleteJob.providerReportHash,
    deleteJobId: canaryDeleteJob.deleteJobId,
  };
  let group = normalizeListingGroup(project.listingGroup, project.id, { now });
  group = updateListingControl(group, deletedListing, {
    automaticUpdateEnabled: false,
    automaticDeletionEnabled: false,
    status: WORKFLOW_STATUS.DELETED,
    statusMessage: deletedListing.statusMessage,
    schedulerSelectionId: "",
    schedulerSelectedAt: "",
    pendingRotationListingId: "",
    pendingRotationJobId: "",
    processLease: null,
  }, { now });
  const nextProject = {
    ...project,
    listings: project.listings.map((candidate) => candidate.id === listing.id ? deletedListing : candidate),
    listingGroup: group,
  };
  const deleteReport = {
    reportId,
    deleteJobId: canaryDeleteJob.deleteJobId,
    sourceListingId: listing.id,
    replacementListingId: "",
    externalObjectNumber: contract.externalObjectNumber,
    messageId: canaryDeleteJob.providerReportMessageId,
    rawHash: canaryDeleteJob.providerReportHash,
    providerProcessedAt: canaryDeleteJob.providerProcessedAt,
    processedAt: now,
    result: "success",
    channel: "email",
    confirmationSource: contract.confirmationSource,
  };
  const nextState = {
    ...state,
    projects: state.projects.map((candidate) => candidate.id === project.id ? nextProject : candidate),
    deleteReports: [
      ...(state.deleteReports || []).filter((report) => report.reportId !== reportId),
      deleteReport,
    ].slice(-1000),
  };
  const stillDue = schedulerDueListings(nextState, options.schedulerCheckAt || now)
    .some((candidate) => candidate.listingId === listing.id);
  if (stillDue) {
    throw reconciliationError(
      "HISTORICAL_DELETE_STILL_SCHEDULER_ELIGIBLE",
      "Der reconciliierte Datensatz wäre weiterhin schedulerfähig; die Katalogmutation wurde verworfen.",
    );
  }
  return {
    state: nextState,
    changed: true,
    idempotent: false,
    eligibility,
    source: deletedListing,
    deleteReport,
  };
}
