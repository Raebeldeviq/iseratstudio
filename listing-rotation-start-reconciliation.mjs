import { listingControl, normalizeListingGroup, updateListingControl } from "./listing-groups.mjs";
import {
  REGRESSION_85_CLASSIFICATIONS,
  REGRESSION_85_REPAIR_STAGES,
  REGRESSION_85_REPAIR_STRATEGIES,
  assertRegression85Campaign,
} from "./regression-85-repair-scope.mjs";
import {
  REGRESSION_85_NON_EXPORTED_CONFIRMATION_CONTRACT,
  REGRESSION_85_NON_EXPORTED_CONFIRMATION_TYPE,
  regression85ClassificationFingerprint,
} from "./regression-85-non-exported-delete-confirmation.mjs";
import { PRODUCTION_DELETE_STATUS } from "./listing-rotation-production-delete.mjs";
import { WORKFLOW_STATUS } from "./workflow-status.mjs";

export const NINE_DAY_ROTATION_START_RECONCILIATION_CONFIRMATION = "RECONCILE_30460_108038_30460_674991";
export const NINE_DAY_ROTATION_START_RECONCILIATION_CONTRACT = Object.freeze({
  format: 1,
  contract: "nine-day-rotation-start-reconciliation-v1",
  projectId: "c9854ef3-dc88-48e8-8b62-b7aec2769d9f",
  sourceListingId: "df8d0d64-37ae-4092-a477-eb7b5e3acfe7",
  sourceExternalId: "30460-108038",
  historicalCopyListingId: "rotation-ddaed765-80469006-5c3085b4-copy",
  historicalCopyExternalId: "30460-674991",
  scopeHash: REGRESSION_85_NON_EXPORTED_CONFIRMATION_CONTRACT.scopeHash,
  scopeEvidenceHash: REGRESSION_85_NON_EXPORTED_CONFIRMATION_CONTRACT.scopeEvidenceHash,
  classificationFingerprint: REGRESSION_85_NON_EXPORTED_CONFIRMATION_CONTRACT.classificationFingerprint,
  confirmationType: REGRESSION_85_NON_EXPORTED_CONFIRMATION_TYPE,
});

const EXPECTED_UPLOAD_GUARD_ERROR = "Ein erhöhtes Uploadlimit ohne gültige One-Shot-Provenienz ist nicht zulässig.";

function reconciliationError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function exactRows(state, contract) {
  const project = (state.projects || []).find((candidate) => candidate.id === contract.projectId);
  const sourceMatches = (project?.listings || []).filter((listing) =>
    listing.id === contract.sourceListingId && listing.externalId === contract.sourceExternalId);
  const copyMatches = (project?.listings || []).filter((listing) =>
    listing.id === contract.historicalCopyListingId && listing.externalId === contract.historicalCopyExternalId);
  if (!project || sourceMatches.length !== 1 || copyMatches.length !== 1) {
    throw reconciliationError(
      "NINE_DAY_START_PAIR_NOT_UNIQUE",
      "Das freigegebene A/B-Paar ist im Katalog nicht mehr exakt und eindeutig vorhanden.",
    );
  }
  const source = sourceMatches[0];
  const historicalCopy = copyMatches[0];
  if (historicalCopy.rotationSourceListingId !== source.id) {
    throw reconciliationError("NINE_DAY_START_PAIR_RELATION_MISMATCH", "Die persistente A→B-Beziehung hat sich verändert.");
  }
  return { project, source, historicalCopy };
}

function exactCampaignEvidence(campaignValue, contract) {
  const campaign = assertRegression85Campaign(campaignValue);
  const fingerprint = regression85ClassificationFingerprint(campaign);
  const scopeItem = campaign.scope.items.find((item) => item.regressionListingId === contract.historicalCopyListingId);
  const progress = campaign.progress.find((item) => item.scopeItemId === scopeItem?.scopeItemId);
  const reasons = [];
  if (campaign.mode !== "completed") reasons.push("campaign_not_completed");
  if (campaign.scopeHash !== contract.scopeHash) reasons.push("scope_hash_mismatch");
  if (campaign.scopeEvidenceHash !== contract.scopeEvidenceHash) reasons.push("scope_evidence_hash_mismatch");
  if (fingerprint !== contract.classificationFingerprint) reasons.push("classification_fingerprint_mismatch");
  if (!scopeItem) reasons.push("scope_item_missing");
  if (scopeItem?.projectId !== contract.projectId) reasons.push("scope_project_mismatch");
  if (scopeItem?.originalSourceListingId !== contract.sourceListingId) reasons.push("scope_source_mismatch");
  if (scopeItem?.regressionExternalId !== contract.historicalCopyExternalId) reasons.push("scope_external_id_mismatch");
  if (progress?.stage !== REGRESSION_85_REPAIR_STAGES.REPAIR_COMPLETED) reasons.push("repair_not_completed");
  if (progress?.repairState !== "repair_completed") reasons.push("repair_state_not_completed");
  if (progress?.classification !== REGRESSION_85_CLASSIFICATIONS.ROLLBACK_ELIGIBLE) reasons.push("classification_mismatch");
  if (progress?.repairStrategy !== REGRESSION_85_REPAIR_STRATEGIES.ROLLBACK) reasons.push("repair_strategy_mismatch");
  if (!progress?.deleteJobId || !progress?.deleteReportId) reasons.push("completion_delete_evidence_missing");
  if (reasons.length) {
    throw reconciliationError(
      "NINE_DAY_START_CAMPAIGN_EVIDENCE_INVALID",
      `Die abgeschlossene 85er-Evidenz ist für das freigegebene Paar nicht exakt gültig: ${reasons.join(", ")}.`,
      { reasons },
    );
  }
  return { campaign, fingerprint, scopeItem, progress };
}

function exactDeleteEvidence(state, deleteLedgerValue, rows, campaignEvidence, contract) {
  const { source, historicalCopy } = rows;
  const { progress } = campaignEvidence;
  const report = (state.deleteReports || []).find((candidate) =>
    candidate?.reportId === progress.deleteReportId
    && candidate?.deleteJobId === progress.deleteJobId
    && candidate?.sourceListingId === historicalCopy.id
    && candidate?.replacementListingId === source.id
    && candidate?.externalObjectNumber === historicalCopy.externalId
    && candidate?.result === "success"
    && candidate?.confirmationType === contract.confirmationType);
  const job = (deleteLedgerValue?.jobs || []).find((candidate) =>
    candidate?.deleteJobId === progress.deleteJobId
    && candidate?.projectId === rows.project.id
    && candidate?.sourceListingId === historicalCopy.id
    && candidate?.replacementListingId === source.id
    && candidate?.externalObjectNumber === historicalCopy.externalId
    && candidate?.status === PRODUCTION_DELETE_STATUS.CONFIRMED);
  const reasons = [];
  if (!report) reasons.push("positive_catalog_delete_report_missing");
  if (!job) reasons.push("confirmed_delete_job_missing");
  if (report && job && job.reportHash !== report.rawHash) reasons.push("delete_report_hash_mismatch");
  if (historicalCopy.productionDeleteState !== "confirmed") reasons.push("copy_delete_state_not_confirmed");
  if (historicalCopy.externalDeletionPending === true) reasons.push("copy_delete_still_pending");
  if (!historicalCopy.deleteConfirmedAt || historicalCopy.deleteJobId !== progress.deleteJobId) reasons.push("copy_delete_provenance_missing");
  if (report && historicalCopy.deleteReportHash !== report.rawHash) reasons.push("copy_catalog_report_hash_mismatch");
  if (reasons.length) {
    throw reconciliationError(
      "NINE_DAY_START_DELETE_EVIDENCE_INVALID",
      `Die positive objektbezogene Provider-Löschprovenienz ist unvollständig: ${reasons.join(", ")}.`,
      { reasons },
    );
  }
  return { report, job };
}

function assertSourceOwnership(rows) {
  const { project, source, historicalCopy } = rows;
  const group = normalizeListingGroup(project.listingGroup, project.id);
  const sourceControl = listingControl(group, source);
  const copyControl = listingControl(group, historicalCopy);
  const sourceVariant = group.variants.find((variant) => variant.listing?.id === source.id);
  const reasons = [];
  if (source.status !== WORKFLOW_STATUS.PUBLISHED || sourceControl.status !== WORKFLOW_STATUS.PUBLISHED) reasons.push("source_not_published");
  if (source.externalDeletionPending === true) reasons.push("source_delete_pending");
  if (sourceControl.automaticUpdateEnabled !== true) reasons.push("source_not_scheduler_owner");
  if (!sourceVariant || sourceVariant.active !== true) reasons.push("source_active_slot_missing");
  if (sourceControl.processLease || sourceControl.schedulerSelectionId) reasons.push("source_concurrent_work");
  if (copyControl.processLease || copyControl.schedulerSelectionId) reasons.push("copy_concurrent_work");
  if (reasons.length) {
    throw reconciliationError(
      "NINE_DAY_START_SOURCE_OWNERSHIP_INVALID",
      `Das veröffentlichte Quellinserat besitzt keine konsistente Scheduler-Ownership: ${reasons.join(", ")}.`,
      { reasons },
    );
  }
  return { group, sourceControl, copyControl };
}

export function previewNineDayRotationStartReconciliation(state, campaign, deleteLedger, options = {}) {
  const contract = options.contract || NINE_DAY_ROTATION_START_RECONCILIATION_CONTRACT;
  const rows = exactRows(state, contract);
  const campaignEvidence = exactCampaignEvidence(campaign, contract);
  const deleteEvidence = exactDeleteEvidence(state, deleteLedger, rows, campaignEvidence, contract);
  const ownership = assertSourceOwnership(rows);
  const alreadyReconciled = rows.historicalCopy.status === WORKFLOW_STATUS.DELETED
    && ownership.copyControl.status === WORKFLOW_STATUS.DELETED
    && !ownership.sourceControl.pendingRotationListingId
    && !ownership.sourceControl.pendingRotationJobId;
  if (!alreadyReconciled) {
    const reasons = [];
    if (rows.historicalCopy.status !== WORKFLOW_STATUS.PREPARED) reasons.push("unexpected_copy_status");
    if (rows.historicalCopy.uploadError !== EXPECTED_UPLOAD_GUARD_ERROR) reasons.push("unexpected_copy_error");
    if (ownership.copyControl.status !== WORKFLOW_STATUS.FAILED) reasons.push("unexpected_copy_control_status");
    if (ownership.copyControl.lastError !== EXPECTED_UPLOAD_GUARD_ERROR) reasons.push("unexpected_copy_control_error");
    if (ownership.sourceControl.pendingRotationListingId !== rows.historicalCopy.id) reasons.push("source_pending_copy_mismatch");
    if (ownership.sourceControl.pendingRotationJobId) reasons.push("unexpected_pending_upload_job");
    if (reasons.length) {
      throw reconciliationError(
        "NINE_DAY_START_DAMAGE_SIGNATURE_MISMATCH",
        `Der aktuelle interne Schaden entspricht nicht exakt dem freigegebenen Fehlerbild: ${reasons.join(", ")}.`,
        { reasons },
      );
    }
  }
  return {
    status: alreadyReconciled ? "NINE_DAY_ROTATION_START_RECONCILED" : "NINE_DAY_ROTATION_START_RECONCILIATION_REQUIRED",
    contract: contract.contract,
    sourceExternalId: rows.source.externalId,
    sourceStatus: rows.source.status,
    historicalCopyExternalId: rows.historicalCopy.externalId,
    historicalCopyStatus: rows.historicalCopy.status,
    deleteJobId: deleteEvidence.job.deleteJobId,
    deleteReportId: deleteEvidence.report.reportId,
    scopeHash: campaignEvidence.campaign.scopeHash,
    scopeEvidenceHash: campaignEvidence.campaign.scopeEvidenceHash,
    classificationFingerprint: campaignEvidence.fingerprint,
    repairCompleted: true,
    alreadyReconciled,
  };
}

export function reconcileNineDayRotationStartInState(state, campaign, deleteLedger, options = {}) {
  const at = String(options.now || new Date().toISOString());
  const contract = options.contract || NINE_DAY_ROTATION_START_RECONCILIATION_CONTRACT;
  const preview = previewNineDayRotationStartReconciliation(state, campaign, deleteLedger, { contract });
  if (preview.alreadyReconciled) return { state, result: { ...preview, changed: false } };
  const { project, source, historicalCopy } = exactRows(state, contract);
  const restoredCopy = {
    ...historicalCopy,
    status: WORKFLOW_STATUS.DELETED,
    statusMessage: `Extern gelöscht · ${historicalCopy.externalId}`,
    uploadError: "",
  };
  let group = normalizeListingGroup(project.listingGroup, project.id, { now: at });
  group = updateListingControl(group, source, {
    automaticUpdateEnabled: true,
    automaticDeletionEnabled: false,
    status: WORKFLOW_STATUS.PUBLISHED,
    statusMessage: source.statusMessage,
    schedulerSelectionId: "",
    schedulerSelectedAt: "",
    pendingRotationListingId: "",
    pendingRotationJobId: "",
    processLease: null,
    lastError: "",
  }, { now: at });
  group = updateListingControl(group, restoredCopy, {
    automaticUpdateEnabled: false,
    automaticDeletionEnabled: false,
    status: WORKFLOW_STATUS.DELETED,
    statusMessage: restoredCopy.statusMessage,
    schedulerSelectionId: "",
    schedulerSelectedAt: "",
    pendingRotationListingId: "",
    pendingRotationJobId: "",
    processLease: null,
    lastAttemptAt: restoredCopy.transferredAt || restoredCopy.importConfirmedAt || restoredCopy.deleteConfirmedAt,
    lastError: "",
  }, { now: at });
  const nextProject = {
    ...project,
    listings: project.listings.map((listing) => listing.id === restoredCopy.id ? restoredCopy : listing),
    listingGroup: group,
  };
  const nextState = {
    ...state,
    projects: state.projects.map((candidate) => candidate.id === project.id ? nextProject : candidate),
  };
  const verified = previewNineDayRotationStartReconciliation(nextState, campaign, deleteLedger, { contract });
  return {
    state: nextState,
    result: {
      ...verified,
      changed: true,
      reconciledAt: at,
      externalTransfers: 0,
    },
  };
}
