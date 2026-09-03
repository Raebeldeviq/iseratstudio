import { listingControl, normalizeListingGroup, updateListingControl } from "./listing-groups.mjs";
import {
  REGRESSION_85_CLASSIFICATIONS,
  REGRESSION_85_REPAIR_STAGES,
  REGRESSION_85_REPAIR_STRATEGIES,
  assertRegression85Campaign,
} from "./regression-85-repair-scope.mjs";
import {
  REGRESSION_85_NON_EXPORTED_CONFIRMATION_CONTRACT,
  regression85ClassificationFingerprint,
} from "./regression-85-non-exported-delete-confirmation.mjs";
import { WORKFLOW_STATUS } from "./workflow-status.mjs";

export const REGRESSION_85_MANUAL_CLOSURE_STATUS = "REGRESSION_85_CLOSED_MANUAL_RECONCILIATION";
export const REGRESSION_85_SCHEDULER_RECONCILIATION_CONTRACT = Object.freeze({
  ...REGRESSION_85_NON_EXPORTED_CONFIRMATION_CONTRACT,
  finalStatus: REGRESSION_85_MANUAL_CLOSURE_STATUS,
});

function reconciliationError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function assertClosedCampaign(campaignValue, contract = REGRESSION_85_SCHEDULER_RECONCILIATION_CONTRACT) {
  const campaign = assertRegression85Campaign(campaignValue);
  const closure = campaign.manualReconciliationClosure;
  const fingerprint = regression85ClassificationFingerprint(campaign);
  const reasons = [];
  if (campaign.mode !== "completed") reasons.push("campaign_not_completed");
  if (campaign.scopeHash !== contract.scopeHash) reasons.push("scope_hash_mismatch");
  if (campaign.scopeEvidenceHash !== contract.scopeEvidenceHash) reasons.push("scope_evidence_hash_mismatch");
  if (fingerprint !== contract.classificationFingerprint) reasons.push("classification_fingerprint_mismatch");
  if (closure?.finalStatus !== contract.finalStatus) reasons.push("manual_closure_missing");
  if (closure?.originalAPresent !== 85) reasons.push("original_a_presence_incomplete");
  if (closure?.rogueBAbsent !== 84 || closure?.rogueBPresent !== 1) reasons.push("rogue_b_inventory_mismatch");
  if (closure?.historicalHashesPreserved !== true) reasons.push("historical_hashes_not_preserved");
  const documentedExceptionId = String(closure?.exception?.scopeItemId || "");
  const validCompletedStates = new Set(["repair_completed", "manual_external_cleanup_reconciled"]);
  if (!documentedExceptionId) reasons.push("documented_present_exception_missing");
  if (campaign.progress.some((item) => {
    const validClassification = item.classification === REGRESSION_85_CLASSIFICATIONS.ROLLBACK_ELIGIBLE
      && item.repairStrategy === REGRESSION_85_REPAIR_STRATEGIES.ROLLBACK;
    if (item.scopeItemId === documentedExceptionId) {
      return !validClassification
        || item.stage !== REGRESSION_85_REPAIR_STAGES.IDENTIFIED
        || item.repairState !== "manual_reconciliation_exception_present";
    }
    return !validClassification
      || item.stage !== REGRESSION_85_REPAIR_STAGES.REPAIR_COMPLETED
      || !validCompletedStates.has(item.repairState);
  })) {
    reasons.push("campaign_progress_not_fully_completed");
  }
  if (reasons.length) {
    throw reconciliationError(
      "REGRESSION_85_SCHEDULER_RECONCILIATION_BLOCKED",
      `Die abgeschlossene 85er-Evidenz ist für die Scheduler-Reconciliation nicht exakt gültig: ${reasons.join(", ")}.`,
      { reasons, fingerprint },
    );
  }
  return { campaign, closure, fingerprint };
}

function activeSchedulerOwners(project, group, ignoredListingId) {
  return (project.listings || []).filter((listing) => {
    if (!listing || listing.id === ignoredListingId) return false;
    const control = listingControl(group, listing);
    const variant = group.variants.find((item) => item.id === listing.listingGroupVariantId);
    return Boolean(
      variant?.active === true
      && variant?.listing?.id === listing.id
      && control.automaticUpdateEnabled
      && control.status === WORKFLOW_STATUS.PUBLISHED,
    );
  });
}

function classifyScopeItem(state, scopeItem, progress) {
  const project = (state.projects || []).find((item) => item.id === scopeItem.projectId);
  const listing = project?.listings?.find((item) => item.id === scopeItem.originalSourceListingId);
  if (!project || !listing) {
    return { scopeItemId: scopeItem.scopeItemId, eligible: false, reason: "original_a_missing" };
  }
  const group = normalizeListingGroup(project.listingGroup, project.id);
  const control = listingControl(group, listing);
  const variant = group.variants.find((item) => item.id === listing.listingGroupVariantId);
  const regression = project.listings.find((item) => item.id === scopeItem.regressionListingId);
  const alternativeOwners = activeSchedulerOwners(project, group, listing.id);
  const reasons = [];
  if (
    progress?.stage !== REGRESSION_85_REPAIR_STAGES.REPAIR_COMPLETED
    || !new Set(["repair_completed", "manual_external_cleanup_reconciled"]).has(progress?.repairState)
  ) reasons.push("repair_not_completed");
  if (control.status !== WORKFLOW_STATUS.PUBLISHED || listing.status !== WORKFLOW_STATUS.PUBLISHED) reasons.push("original_a_not_published");
  if (listing.externalDeletionPending === true) reasons.push("original_a_delete_pending");
  if (!control.automaticUpdateEnabled) reasons.push("not_current_scheduler_owner");
  if (!variant || !new Set([listing.id, scopeItem.regressionListingId]).has(variant.listing?.id)) reasons.push("slot_relation_mismatch");
  else if (variant.active !== false) reasons.push("slot_not_inactive");
  if (!regression || regression.externalId !== scopeItem.regressionExternalId) reasons.push("regression_scope_relation_mismatch");
  if (variant?.listing?.id === scopeItem.regressionListingId && regression?.status !== WORKFLOW_STATUS.DELETED) {
    reasons.push("regression_slot_target_not_deleted");
  }
  if (control.pendingRotationListingId || control.pendingRotationJobId || control.processLease) reasons.push("open_rotation_state");
  if (!alternativeOwners.length) reasons.push("no_active_alternative_owner");
  return {
    scopeItemId: scopeItem.scopeItemId,
    projectId: project.id,
    plotId: project.plotId || "",
    plot: project.name || "",
    listingId: listing.id,
    externalId: listing.externalId,
    regressionListingId: scopeItem.regressionListingId,
    regressionExternalId: regression?.externalId || scopeItem.regressionExternalId || "",
    schedulerOwner: control.automaticUpdateEnabled && control.status === WORKFLOW_STATUS.PUBLISHED,
    variantId: variant?.id || listing.listingGroupVariantId || "",
    variantTemplateId: variant?.templateId || "",
    listingTemplateId: listing.templateId || "",
    slotActive: variant?.active === true,
    variantActive: variant?.active === true,
    alternativeOwnerIds: alternativeOwners.map((item) => item.id),
    eligible: reasons.length === 0,
    reason: reasons.join(",") || "closed_regression_85_inactive_scheduler_owner",
  };
}

export function previewRegression85SchedulerOwnerReconciliation(stateValue, campaignValue, options = {}) {
  const validated = assertClosedCampaign(campaignValue, options.contract);
  const progressByScopeItem = new Map(validated.campaign.progress.map((item) => [item.scopeItemId, item]));
  const rows = validated.campaign.scope.items.map((scopeItem) => classifyScopeItem(
    stateValue,
    scopeItem,
    progressByScopeItem.get(scopeItem.scopeItemId),
  ));
  return {
    status: "REGRESSION_85_SCHEDULER_OWNER_RECONCILIATION_PREVIEW",
    scopeHash: validated.campaign.scopeHash,
    scopeEvidenceHash: validated.campaign.scopeEvidenceHash,
    classificationFingerprint: validated.fingerprint,
    campaignFinalStatus: validated.closure.finalStatus,
    eligible: rows.filter((row) => row.eligible),
    excluded: rows.filter((row) => !row.eligible),
  };
}

export function reconcileRegression85SchedulerOwnersInState(stateValue, campaignValue, options = {}) {
  const at = String(options.now || new Date().toISOString());
  const preview = previewRegression85SchedulerOwnerReconciliation(stateValue, campaignValue, options);
  if (!preview.eligible.length) {
    return { state: stateValue, result: { ...preview, changed: false, reconciledCount: 0 } };
  }
  const eligibleByProject = new Map();
  for (const row of preview.eligible) {
    if (!eligibleByProject.has(row.projectId)) eligibleByProject.set(row.projectId, []);
    eligibleByProject.get(row.projectId).push(row);
  }
  const projects = (stateValue.projects || []).map((project) => {
    const rows = eligibleByProject.get(project.id);
    if (!rows?.length) return project;
    let group = project.listingGroup;
    for (const row of rows) {
      const listing = project.listings.find((item) => item.id === row.listingId);
      group = updateListingControl(group, listing, {
        automaticUpdateEnabled: false,
        schedulerSelectionId: "",
        schedulerSelectedAt: "",
        pendingRotationListingId: "",
        pendingRotationJobId: "",
        processLease: null,
      }, { now: at });
    }
    return { ...project, listingGroup: group };
  });
  const existingAudit = Array.isArray(stateValue.schedulerOwnerReconciliations)
    ? stateValue.schedulerOwnerReconciliations
    : [];
  const existingKeys = new Set(existingAudit.map((entry) => `${entry?.contract}:${entry?.listingId}`));
  const additions = preview.eligible
    .filter((row) => !existingKeys.has(`closed-regression-85-inactive-owner-v1:${row.listingId}`))
    .map((row) => ({
      format: 1,
      contract: "closed-regression-85-inactive-owner-v1",
      reconciledAt: at,
      projectId: row.projectId,
      plotId: row.plotId,
      listingId: row.listingId,
      externalId: row.externalId,
      variantId: row.variantId,
      action: "automatic_update_disabled_historical_owner",
      scopeItemId: row.scopeItemId,
      scopeHash: preview.scopeHash,
      scopeEvidenceHash: preview.scopeEvidenceHash,
      classificationFingerprint: preview.classificationFingerprint,
      campaignFinalStatus: preview.campaignFinalStatus,
    }));
  const state = {
    ...stateValue,
    projects,
    schedulerOwnerReconciliations: [...existingAudit, ...additions],
  };
  return {
    state,
    result: {
      ...preview,
      changed: true,
      reconciledCount: preview.eligible.length,
      auditEntriesAdded: additions.length,
    },
  };
}
