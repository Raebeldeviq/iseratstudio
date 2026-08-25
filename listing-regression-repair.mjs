import { createHash } from "node:crypto";

import { createUploadJobId } from "./batch-upload.mjs";
import { HOUSES_PER_PROJECT } from "./house-distribution.mjs";
import {
  assignListingGroupVariant,
  listingControl,
  normalizeListingGroup,
  updateListingControl,
} from "./listing-groups.mjs";
import { prepareListingRotationInState } from "./listing-rotation-engine.mjs";
import { WORKFLOW_STATUS } from "./workflow-status.mjs";

export const REGRESSION_REPAIR_PROVENANCE_FORMAT = 1;
export const REGRESSION_REPAIR_SOURCE_STATUS = WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT;

function clean(value, maximum = 500) {
  return String(value ?? "").trim().slice(0, maximum);
}

function repairError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function replaceProject(state, updatedProject) {
  return {
    ...state,
    projects: state.projects.map((project) => project.id === updatedProject.id ? updatedProject : project),
  };
}

function patchProjectListing(state, projectId, listingId, patch, at) {
  const project = state.projects.find((candidate) => candidate.id === projectId);
  const listing = project?.listings.find((candidate) => candidate.id === listingId);
  if (!project || !listing) throw repairError("REGRESSION_85_LISTING_MISSING", "Das Regression-Inserat ist im Katalog nicht mehr eindeutig vorhanden.");
  const updatedListing = { ...listing, ...patch };
  const group = normalizeListingGroup(project.listingGroup, project.id, { now: at });
  const updatedGroup = {
    ...group,
    variants: group.variants.map((variant) => variant.listing?.id === listingId
      ? { ...variant, listing: updatedListing, updatedAt: at }
      : variant),
  };
  return replaceProject(state, {
    ...project,
    listings: project.listings.map((candidate) => candidate.id === listingId ? updatedListing : candidate),
    listingGroup: updatedGroup,
  });
}

export function isRegressionRepairLifecycle(lifecycle) {
  const repair = lifecycle?.regressionRepair;
  return Boolean(
    lifecycle?.format === 1
    && repair?.format === REGRESSION_REPAIR_PROVENANCE_FORMAT
    && clean(repair.campaignId, 200)
    && /^[a-f0-9]{64}$/u.test(clean(repair.scopeHash, 64).toLowerCase())
    && clean(repair.scopeItemId, 200)
    && repair.sourceOriginalStatus === REGRESSION_REPAIR_SOURCE_STATUS,
  );
}

export function regressionRepairIdentity(lifecycle) {
  if (!isRegressionRepairLifecycle(lifecycle)) {
    throw repairError(
      "REGRESSION_85_REPAIR_PROVENANCE_INVALID",
      "Die Reparaturkopie besitzt keine vollständige persistente 85er-Provenienz.",
    );
  }
  return lifecycle.regressionRepair;
}

export function deterministicRegressionRepairCopyId(scopeHash, regressionListingId) {
  const digest = createHash("sha256")
    .update(`regression-85-repair-v1\n${clean(scopeHash, 64)}\n${clean(regressionListingId, 200)}`)
    .digest("hex")
    .slice(0, 24);
  return `regression-85-repair-${digest}`;
}

function assertScopeItem(scopeItem, project, source) {
  const reasons = [];
  if (!scopeItem || typeof scopeItem !== "object") reasons.push("scope_item_missing");
  if (clean(scopeItem?.projectId, 200) !== project?.id) reasons.push("project_id_mismatch");
  if (clean(scopeItem?.plotId, 200) !== clean(project?.plotId, 200)) reasons.push("plot_id_mismatch");
  if (clean(scopeItem?.regressionListingId, 200) !== source?.id) reasons.push("regression_listing_id_mismatch");
  if (clean(scopeItem?.regressionExternalId, 40) !== source?.externalId) reasons.push("regression_external_id_mismatch");
  if (clean(scopeItem?.originalSourceListingId, 200) !== clean(source?.rotationSourceListingId, 200)) reasons.push("original_source_id_mismatch");
  if (clean(scopeItem?.houseId, 200) !== clean(source?.templateId, 200)) reasons.push("house_id_mismatch");
  if (clean(scopeItem?.houseName, 200) !== clean(source?.templateName, 200)) reasons.push("house_name_mismatch");
  if (clean(scopeItem?.distributionRemovedHouseId, 200) !== clean(source?.rotationRemovedHouseId, 200)) reasons.push("distribution_removed_house_mismatch");
  if (reasons.length) {
    throw repairError(
      "REGRESSION_85_SCOPE_ITEM_MISMATCH",
      `Der persistierte 85er-Scope stimmt nicht mehr mit dem Katalog überein: ${reasons.join(", ")}.`,
      { reasons, scopeItemId: clean(scopeItem?.scopeItemId, 200) },
    );
  }
}

function assertRepairSourceVariantCanActivate(group, source, distributionSourceHouse) {
  const sourceVariant = group.variants.find((variant) => variant.id === source.listingGroupVariantId);
  if (!sourceVariant) {
    throw repairError("REGRESSION_85_SOURCE_VARIANT_MISSING", "Der Variantenplatz der Regression-Quelle ist nicht mehr vorhanden.");
  }
  const activeVariants = group.variants.filter((variant) => variant.active && variant.id !== sourceVariant.id);
  const duplicateActiveHouse = activeVariants.find((variant) => variant.templateId === distributionSourceHouse.id);
  if (duplicateActiveHouse) {
    throw repairError(
      "REGRESSION_85_SOURCE_VARIANT_REANCHOR_UNSAFE",
      "Der ursprüngliche Hausplatz der Regression-Quelle ist bereits durch eine andere aktive Variante belegt.",
      { blockingListingId: duplicateActiveHouse.listing?.id || "" },
    );
  }
  if (activeVariants.length >= HOUSES_PER_PROJECT) {
    throw repairError(
      "REGRESSION_85_SOURCE_VARIANT_REANCHOR_UNSAFE",
      "Der inaktive Regression-Platz kann nicht ohne Überschreitung des Vier-Häuser-Vertrags reaktiviert werden.",
    );
  }
  return sourceVariant;
}

function existingRepairCopies(project, source, campaignId, scopeHash, scopeItemId) {
  return (project.listings || []).filter((listing) => {
    const repair = listing.productionLifecycle?.regressionRepair;
    return listing.rotationSourceListingId === source.id
      && repair?.campaignId === campaignId
      && repair?.scopeHash === scopeHash
      && repair?.scopeItemId === scopeItemId;
  });
}

/**
 * Bereitet B -> C über die bestehende Rotations-/Creative-Engine vor. B wird
 * nur in einer In-Memory-Arbeitskopie als rotationsfähig markiert; im
 * zurückgegebenen Katalog bleibt sein belegter Zustand
 * transferred_pending_import vollständig erhalten.
 */
export function prepareRegressionRepairRotationInState(stateValue, scopeItem, options = {}) {
  const at = clean(options.now || new Date().toISOString(), 50);
  const campaignId = clean(options.campaignId, 200);
  const scopeHash = clean(options.scopeHash, 64).toLowerCase();
  const scopeItemId = clean(scopeItem?.scopeItemId, 200);
  const schedulerRunId = clean(options.schedulerRunId, 200);
  if (!campaignId || !/^[a-f0-9]{64}$/u.test(scopeHash) || !scopeItemId || !schedulerRunId) {
    throw repairError("REGRESSION_85_REPAIR_INPUT_INVALID", "Der Reparaturvorbereitung fehlt Campaign-, Scope- oder Laufprovenienz.");
  }
  const project = (stateValue.projects || []).find((candidate) => candidate.id === scopeItem.projectId);
  const source = project?.listings.find((candidate) => candidate.id === scopeItem.regressionListingId);
  if (!project || !source) throw repairError("REGRESSION_85_LISTING_MISSING", "Das Regression-Inserat ist im Katalog nicht mehr eindeutig vorhanden.");
  assertScopeItem(scopeItem, project, source);
  if (
    source.status !== REGRESSION_REPAIR_SOURCE_STATUS
    || source.listingOrigin !== "rotation-copy"
    || source.creativeSelection?.format === 1
  ) {
    throw repairError(
      "REGRESSION_85_SOURCE_NOT_REPAIRABLE",
      "Nur die unveränderte, nicht bestätigte Regression-Rotationskopie darf als Reparaturquelle verwendet werden.",
      { status: source.status, listingOrigin: source.listingOrigin },
    );
  }
  const existing = existingRepairCopies(project, source, campaignId, scopeHash, scopeItemId);
  if (existing.length > 1) {
    throw repairError("REGRESSION_85_DUPLICATE_REPLACEMENT", "Für dieses Scope-Objekt existieren mehrere Reparaturkopien.");
  }
  if (existing.length === 1) return { state: stateValue, ok: true, idempotent: true, copy: existing[0], issues: [] };

  const sourceGroup = normalizeListingGroup(project.listingGroup, project.id, { now: at });
  const sourceControl = listingControl(sourceGroup, source);
  if (sourceControl.processLease || sourceControl.manualLock || sourceControl.premiumPlacement || sourceControl.updateMode === "blocked") {
    throw repairError("REGRESSION_85_SOURCE_LOCKED", "Das Regression-Inserat besitzt eine aktive fachliche oder technische Sperre.");
  }

  let simulatedState = structuredClone(stateValue);
  const distributionSourceHouse = simulatedState.houses?.find((house) => house.id === scopeItem.distributionRemovedHouseId);
  if (!distributionSourceHouse) {
    throw repairError("REGRESSION_85_DISTRIBUTION_SOURCE_HOUSE_MISSING", "Das vor der Regression belegte Haus ist im freigegebenen Hauspool nicht mehr vorhanden.");
  }
  simulatedState = patchProjectListing(simulatedState, project.id, source.id, {
    status: WORKFLOW_STATUS.PUBLISHED,
    statusMessage: "Temporärer In-Memory-Reparaturplan",
    templateId: distributionSourceHouse.id,
    templateName: distributionSourceHouse.name,
  }, at);
  const simulatedProject = simulatedState.projects.find((candidate) => candidate.id === project.id);
  const simulatedSource = simulatedProject.listings.find((candidate) => candidate.id === source.id);
  let simulatedGroup = normalizeListingGroup(simulatedProject.listingGroup, simulatedProject.id, { now: at });
  const simulatedSourceVariant = assertRepairSourceVariantCanActivate(simulatedGroup, simulatedSource, distributionSourceHouse);
  simulatedGroup = assignListingGroupVariant(
    simulatedGroup,
    simulatedSourceVariant.id,
    distributionSourceHouse,
    simulatedSource,
    { now: at },
  );
  simulatedGroup = updateListingControl(simulatedGroup, simulatedSource, {
    automaticUpdateEnabled: true,
    updateMode: sourceControl.updateMode === "blocked" ? "prepare-only" : sourceControl.updateMode,
    status: WORKFLOW_STATUS.PUBLISHED,
    statusMessage: "Temporärer In-Memory-Reparaturplan",
    pendingRotationListingId: "",
    pendingRotationJobId: "",
    processLease: null,
  }, { now: at });
  simulatedState = replaceProject(simulatedState, { ...simulatedProject, listingGroup: simulatedGroup });

  const copyId = clean(options.copyId, 200) || deterministicRegressionRepairCopyId(scopeHash, source.id);
  const prepared = prepareListingRotationInState(simulatedState, project.id, source.id, {
    now: at,
    mode: "prepare-only",
    copyId,
    operationToken: schedulerRunId,
    uploadJobIdFor: createUploadJobId,
    seed: `${campaignId}:${scopeHash}:${scopeItemId}:${copyId}`,
  });
  if (!prepared.ok || !prepared.copy) {
    throw repairError(
      "REGRESSION_85_REPLACEMENT_PREPARE_FAILED",
      prepared.message || "Die korrekte Reparaturkopie konnte nicht vorbereitet werden.",
      { issues: prepared.issues || [] },
    );
  }

  const regressionRepair = {
    format: REGRESSION_REPAIR_PROVENANCE_FORMAT,
    campaignId,
    scopeHash,
    scopeItemId,
    regressionListingId: source.id,
    regressionExternalId: source.externalId,
    sourceOriginalStatus: REGRESSION_REPAIR_SOURCE_STATUS,
    rootProcessId: Math.max(0, Math.trunc(Number(scopeItem.rootProcessId) || 0)),
    originalUploadJobId: clean(scopeItem.uploadJobId, 500),
    distributionRemovedHouseId: clean(scopeItem.distributionRemovedHouseId, 200),
    preparedAt: at,
  };
  let nextState = patchProjectListing(prepared.state, project.id, prepared.copy.id, {
    rotationRemovedHouseId: clean(scopeItem.distributionRemovedHouseId, 200),
    rotationAddedHouseId: prepared.copy.templateId,
    productionLifecycle: {
      format: 1,
      schedulerRunId,
      sourceListingId: source.id,
      automaticDeleteAuthorized: true,
      preparedAt: at,
      effectiveMaxRunItems: 1,
      regressionRepair,
    },
  }, at);
  nextState = patchProjectListing(nextState, project.id, source.id, {
    status: REGRESSION_REPAIR_SOURCE_STATUS,
    statusMessage: "Regression-Replacement bleibt bis zum bestätigten Ersatzimport unverändert",
    regressionRepairCampaignId: campaignId,
    regressionRepairScopeHash: scopeHash,
    regressionRepairScopeItemId: scopeItemId,
  }, at);
  const nextProject = nextState.projects.find((candidate) => candidate.id === project.id);
  const nextSource = nextProject.listings.find((candidate) => candidate.id === source.id);
  const nextCopy = nextProject.listings.find((candidate) => candidate.id === prepared.copy.id);
  let nextGroup = normalizeListingGroup(nextProject.listingGroup, nextProject.id, { now: at });
  nextGroup = updateListingControl(nextGroup, nextSource, {
    automaticUpdateEnabled: false,
    automaticDeletionEnabled: false,
    status: REGRESSION_REPAIR_SOURCE_STATUS,
    statusMessage: nextSource.statusMessage,
    pendingRotationListingId: nextCopy.id,
    pendingRotationJobId: createUploadJobId(nextProject, nextCopy),
    schedulerSelectionId: "",
    schedulerSelectedAt: "",
    processLease: null,
  }, { now: at });
  nextGroup = updateListingControl(nextGroup, nextCopy, {
    automaticUpdateEnabled: false,
    automaticDeletionEnabled: false,
    status: WORKFLOW_STATUS.PREPARED,
    statusMessage: "Korrekte Regression-Reparaturkopie wartet auf FTPS",
    processLease: null,
  }, { now: at });
  nextState = replaceProject(nextState, { ...nextProject, listingGroup: nextGroup });
  return {
    state: nextState,
    ok: true,
    idempotent: false,
    copy: nextCopy,
    issues: [],
  };
}

export function assertRegressionRepairPayloadSource(state, scopeItem, copy) {
  const project = (state.projects || []).find((candidate) => candidate.id === scopeItem.projectId);
  const source = project?.listings.find((candidate) => candidate.id === scopeItem.regressionListingId);
  if (!project || !source || !copy || copy.rotationSourceListingId !== source.id) {
    throw repairError("REGRESSION_85_REPAIR_RELATION_MISMATCH", "Die Reparaturkopie gehört nicht eindeutig zur Allowlist-Quelle.");
  }
  assertScopeItem(scopeItem, project, source);
  const repair = regressionRepairIdentity(copy.productionLifecycle);
  if (repair.scopeItemId !== scopeItem.scopeItemId || repair.regressionListingId !== source.id) {
    throw repairError("REGRESSION_85_REPAIR_PROVENANCE_INVALID", "Die Reparaturkopie besitzt eine abweichende Scope-Provenienz.");
  }
  if (copy.creativeSelection?.format !== 1) {
    throw repairError("PRODUCTION_CREATIVE_SELECTION_MISSING", "Der Reparaturkopie fehlt die persistierte CreativeSelection.");
  }
  return { project, source, copy, repair };
}
