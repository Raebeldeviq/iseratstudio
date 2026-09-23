import {
  ACTIVE_HOUSES_PER_PROJECT,
  MAX_LISTING_GROUP_LOGS,
  MAX_PROMOTION_USAGE,
  MAX_SCHEDULER_LOGS,
  MAX_UPLOAD_LOGS,
  PROCESS_LEASE_MS,
} from "./listing-rules.mjs";
import {
  normalizeWorkflowStatus,
  workflowStatusMessage,
  WORKFLOW_STATUS,
} from "./workflow-status.mjs";
import { enforceSinglePromotionAssignment } from "./promotion-images.mjs";
import { deletePlotRecordCascade, normalizePlotState } from "./plot-records.mjs";

export const STUDIO_DATA_SCHEMA_VERSION = 4;

function normalizedText(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("de-DE")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9]+/gu, "");
}

function exactKey(value) {
  // Image binaries are kept in the device catalog and represented in the UI
  // as data URLs. They are immutable payloads for integrity purposes: no
  // cleanup rule changes their bytes. Excluding them avoids constructing a
  // multi-hundred-megabyte comparison string when one shared image card is
  // intentionally referenced by every house template.
  return JSON.stringify(value, (key, candidate) => (
    key === "dataUrl" && typeof candidate === "string" ? "[image-data]" : candidate
  ));
}

function duplicateGroups(values, keyFor) {
  const groups = new Map();
  for (const value of values) {
    const key = keyFor(value);
    if (!key) continue;
    const group = groups.get(key) || [];
    group.push(value);
    groups.set(key, group);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

function dedupeExact(values, identityFor) {
  const seen = new Set();
  const output = [];
  let removed = 0;
  for (const value of Array.isArray(values) ? values : []) {
    const key = `${identityFor(value)}:${exactKey(value)}`;
    if (seen.has(key)) {
      removed += 1;
      continue;
    }
    seen.add(key);
    output.push(value);
  }
  return { values: output, removed };
}

function statusRecord(value, field, fallback) {
  const rawStatus = value?.[field];
  const messageField = field === "processStatus" ? "message" : `${field}Message`;
  return {
    ...value,
    [field]: normalizeWorkflowStatus(rawStatus, fallback),
    [messageField]: workflowStatusMessage(rawStatus, value?.[messageField]),
  };
}

function cleanListing(listing) {
  const { uploadStatus, ...source } = listing && typeof listing === "object" ? listing : {};
  const status = source.rotationArchivedAt
    ? WORKFLOW_STATUS.ARCHIVED
    : normalizeWorkflowStatus(source.status ?? uploadStatus, WORKFLOW_STATUS.DRAFT);
  return {
    ...source,
    status,
    statusMessage: workflowStatusMessage(source.status ?? uploadStatus, source.statusMessage),
  };
}

function cleanProject(project, now, counters) {
  const projectWithoutNotes = project && typeof project === "object" ? { ...project } : {};
  delete projectWithoutNotes.notes;
  if (Object.hasOwn(project || {}, "notes")) counters.removedLegacyNotes += 1;
  const listingResult = dedupeExact((projectWithoutNotes.listings || []).map(cleanListing), (listing) => listing.id || listing.externalId || "");
  counters.removedExactListings += listingResult.removed;

  const sourceGroup = projectWithoutNotes.listingGroup && typeof projectWithoutNotes.listingGroup === "object"
    ? projectWithoutNotes.listingGroup
    : null;
  if (!sourceGroup) {
    const baseProject = { ...projectWithoutNotes, listings: listingResult.values };
    const activeAssignments = listingResult.values
      .filter((listing) => listing.promotionImageId && !listing.rotationArchivedAt)
      .sort((left, right) => Date.parse(right.promotionAssignedAt || "") - Date.parse(left.promotionAssignedAt || ""));
    if (activeAssignments.length <= 1) return baseProject;
    counters.clearedExtraPromotionAssignments += activeAssignments.length - 1;
    return enforceSinglePromotionAssignment(baseProject, activeAssignments[0].id, activeAssignments[0].promotionImageId, { now: activeAssignments[0].promotionAssignedAt || now });
  }

  const referencedListingIds = new Set([
    ...listingResult.values.map((listing) => listing.id),
    ...(sourceGroup.variants || []).map((variant) => variant?.listing?.id),
  ].filter(Boolean));
  const retainedControls = (sourceGroup.listingControls || []).filter((control) => {
    const retained = control?.listingId && referencedListingIds.has(control.listingId);
    if (!retained) counters.removedStaleControls += 1;
    return retained;
  });
  const controlResult = dedupeExact(retainedControls.map((control) => {
    const leaseStartedAt = Date.parse(control?.processLease?.startedAt || "");
    const expiredLease = control?.processLease?.token
      && Number.isFinite(leaseStartedAt)
      && Date.parse(now) - leaseStartedAt >= PROCESS_LEASE_MS;
    if (expiredLease) counters.clearedExpiredLeases += 1;
    const normalized = statusRecord(control, "status", WORKFLOW_STATUS.DRAFT);
    const cleanedControl = { ...normalized, processLease: expiredLease ? null : normalized.processLease };
    delete cleanedControl.lastUsedVariantId;
    delete cleanedControl.nextVariantId;
    return cleanedControl;
  }), (control) => control.listingId || "");
  counters.removedExactControls += controlResult.removed;

  const logResult = dedupeExact((sourceGroup.logs || []).map((log) => statusRecord(log, "processStatus", WORKFLOW_STATUS.DRAFT)), (log) => log.id || "");
  counters.removedExactGroupLogs += logResult.removed;
  const normalizedGroup = statusRecord(sourceGroup, "lastStatus", WORKFLOW_STATUS.DRAFT);
  if (Object.hasOwn(normalizedGroup, "processLease")) counters.removedLegacyGroupLeases += 1;
  delete normalizedGroup.processLease;
  const automation = { ...(normalizedGroup.automation || {}) };
  delete automation.lastUsedVariantId;
  delete automation.nextVariantId;
  const seenActiveHouseIds = new Set();
  let activeHouseCount = 0;
  const variants = (normalizedGroup.variants || []).map((variant) => {
    if (!variant?.active || !variant?.templateId) return variant;
    const canRemainActive = activeHouseCount < ACTIVE_HOUSES_PER_PROJECT
      && !seenActiveHouseIds.has(variant.templateId);
    if (canRemainActive) {
      activeHouseCount += 1;
      seenActiveHouseIds.add(variant.templateId);
      return variant;
    }
    counters.deactivatedExtraHouseAssignments += 1;
    return { ...variant, active: false, updatedAt: now };
  });
  const selectedHouseIds = variants
    .filter((variant) => variant?.active && variant?.templateId)
    .map((variant) => variant.templateId)
    .slice(0, ACTIVE_HOUSES_PER_PROJECT);
  const cleanedProject = {
    ...projectWithoutNotes,
    selectedHouseIds: selectedHouseIds.length
      ? selectedHouseIds
      : [...new Set(projectWithoutNotes.selectedHouseIds || [])].slice(0, ACTIVE_HOUSES_PER_PROJECT),
    listings: listingResult.values,
    listingGroup: {
      ...normalizedGroup,
      automation,
      variants,
      listingControls: controlResult.values,
      logs: logResult.values.slice(-MAX_LISTING_GROUP_LOGS),
    },
  };
  const activeAssignments = cleanedProject.listings
    .filter((listing) => listing.promotionImageId && !listing.rotationArchivedAt)
    .sort((left, right) => Date.parse(right.promotionAssignedAt || "") - Date.parse(left.promotionAssignedAt || ""));
  if (activeAssignments.length <= 1) return cleanedProject;
  counters.clearedExtraPromotionAssignments += activeAssignments.length - 1;
  return enforceSinglePromotionAssignment(cleanedProject, activeAssignments[0].id, activeAssignments[0].promotionImageId, { now: activeAssignments[0].promotionAssignedAt || now });
}

function projectAddressFingerprint(project) {
  const key = [project?.street, project?.houseNumber, project?.postalCode ?? project?.zip, project?.city].map(normalizedText).join("|");
  return key === "|||" ? "" : key;
}

function houseFingerprint(house) {
  return [house?.name, house?.houseType, house?.livingArea, house?.rooms, house?.housePrice]
    .map(normalizedText)
    .join("|");
}

export function auditStudioState(state, options = {}) {
  const now = String(options.now || new Date().toISOString());
  const houses = Array.isArray(state?.houses) ? state.houses : [];
  const plots = Array.isArray(state?.plots) ? state.plots : [];
  const projects = Array.isArray(state?.projects) ? state.projects : [];
  const listings = projects.flatMap((project) => Array.isArray(project.listings) ? project.listings : []);
  const controlRecords = projects.flatMap((project) => {
    const projectListingIds = new Set((project.listings || []).map((listing) => listing.id));
    const variantListingIds = new Set((project.listingGroup?.variants || []).map((variant) => variant?.listing?.id).filter(Boolean));
    return (project.listingGroup?.listingControls || []).map((control) => ({
      control,
      inProjectListings: projectListingIds.has(control.listingId),
      inVariantListings: variantListingIds.has(control.listingId),
    }));
  });
  const controls = controlRecords.map((record) => record.control);
  const promotionImages = Array.isArray(state?.promotionImages) ? state.promotionImages : [];
  const promotionUsage = Array.isArray(state?.promotionUsage) ? state.promotionUsage : [];
  const uploadHistory = Array.isArray(state?.uploadHistory) ? state.uploadHistory : [];
  const houseIds = new Set(houses.map((house) => house.id));
  const findings = [];
  const add = (code, severity, count, action) => {
    if (count > 0) findings.push({ code, severity, count, action });
  };

  add("legacy-project-notes", "safe", projects.filter((project) => Object.hasOwn(project, "notes")).length, "remove");
  add("duplicate-plot-id", "manual", duplicateGroups(plots, (plot) => plot.id).length, "review");
  add("duplicate-plot-address", "manual", duplicateGroups(plots.filter((plot) => plot.isActive !== false), projectAddressFingerprint).length, "review");
  add("duplicate-project-id", "manual", duplicateGroups(projects, (project) => project.id).length, "review");
  add("duplicate-project-address", "manual", duplicateGroups(projects, projectAddressFingerprint).length, "review");
  add("duplicate-house-id", "manual", duplicateGroups(houses, (house) => house.id).length, "review");
  add("duplicate-house-signature", "manual", duplicateGroups(houses, houseFingerprint).length, "review");
  add("duplicate-listing-id", "manual", duplicateGroups(listings, (listing) => listing.id).length, "review");
  add("duplicate-external-id", "manual", duplicateGroups(listings.filter((listing) => listing.externalId), (listing) => listing.externalId).length, "review");
  add("orphan-listing-house", "manual", listings.filter((listing) => !houseIds.has(listing.templateId)).length, "review");
  add("variant-only-control-listing", "manual", controlRecords.filter((record) => !record.inProjectListings && record.inVariantListings).length, "preserve-and-review");
  add("stale-control-listing", "safe", controlRecords.filter((record) => !record.inProjectListings && !record.inVariantListings).length, "remove");
  add("duplicate-listing-control", "manual", duplicateGroups(controls, (control) => control.listingId).length, "review");
  add("duplicate-promotion-id", "manual", duplicateGroups(promotionImages, (image) => image.id).length, "review");
  add("duplicate-promotion-name", "manual", duplicateGroups(promotionImages, (image) => normalizedText(image.name)).length, "review");
  add("duplicate-promotion-assignment", "safe", duplicateGroups(promotionUsage, (usage) => [usage.projectId, usage.listingId, usage.imageId, usage.mode, usage.usedAt].join("|")).length, "deduplicate-exact");
  add("duplicate-upload-event", "safe", duplicateGroups(uploadHistory, (log) => log.id).length, "deduplicate-exact");
  add("multiple-active-promotion-listings", "safe", projects.filter((project) => (project.listings || []).filter((listing) => listing.promotionImageId && !listing.rotationArchivedAt).length > 1).length, "keep-newest-assignment");
  add("more-than-four-active-houses", "safe", projects.filter((project) => {
    const active = (project.listingGroup?.variants || []).filter((variant) => variant?.active && variant?.templateId);
    return active.length > ACTIVE_HOUSES_PER_PROJECT;
  }).length, "deactivate-after-first-four");
  add("duplicate-active-house", "manual", projects.filter((project) => {
    const activeVariants = (project.listingGroup?.variants || []).filter((variant) => variant?.active && variant?.templateId);
    const active = (activeVariants.length ? activeVariants.map((variant) => variant.templateId) : project.selectedHouseIds || []).filter(Boolean);
    return new Set(active).size !== active.length;
  }).length, "review");
  add("expired-process-lease", "safe", controls.filter((control) => {
    const startedAt = Date.parse(control.processLease?.startedAt || "");
    return control.processLease?.token && Number.isFinite(startedAt) && Date.parse(now) - startedAt >= PROCESS_LEASE_MS;
  }).length, "clear");

  return {
    schemaVersion: STUDIO_DATA_SCHEMA_VERSION,
    generatedAt: now,
    summary: {
      houses: houses.length,
      plots: plots.length,
      projects: projects.length,
      listings: listings.length,
      controls: controls.length,
      promotionImages: promotionImages.length,
      promotionUsage: promotionUsage.length,
      uploadLogs: uploadHistory.length,
      findings: findings.reduce((sum, finding) => sum + finding.count, 0),
    },
    findings,
  };
}

export function cleanupStudioState(state, options = {}) {
  const apply = options.apply === true;
  const now = String(options.now || new Date().toISOString());
  const previousSchemaVersion = Math.max(0, Number(state?.dataSchemaVersion) || 0);
  const before = auditStudioState(state, { now });
  if (!apply) return { state, changed: false, report: { mode: "dry-run", before, actions: {} } };

  const counters = {
    removedLegacyNotes: 0,
    removedExactListings: 0,
    removedExactControls: 0,
    removedExactGroupLogs: 0,
    removedExactPromotionImages: 0,
    removedExactPromotionUsage: 0,
    removedExactUploadLogs: 0,
    removedExactSchedulerRuns: 0,
    clearedExpiredLeases: 0,
    clearedExtraPromotionAssignments: 0,
    removedStaleControls: 0,
    deactivatedExtraHouseAssignments: 0,
    removedLegacyGroupLeases: 0,
    removedLegacyArchivedPlots: 0,
    removedLegacyArchivedProjects: 0,
  };
  const projects = (state.projects || []).map((project) => cleanProject(project, now, counters));
  const promotionImages = dedupeExact(state.promotionImages || [], (image) => image.id || "");
  counters.removedExactPromotionImages += promotionImages.removed;
  const promotionUsage = dedupeExact(state.promotionUsage || [], (usage) => [usage.projectId, usage.listingId, usage.imageId, usage.mode, usage.usedAt].join("|"));
  counters.removedExactPromotionUsage += promotionUsage.removed;
  const uploadHistory = dedupeExact((state.uploadHistory || []).map((log) => statusRecord(log, "status", WORKFLOW_STATUS.DRAFT)), (log) => log.id || "");
  counters.removedExactUploadLogs += uploadHistory.removed;
  const schedulerRuns = dedupeExact((state.scheduler?.runs || []).map((run) => statusRecord(run, "status", WORKFLOW_STATUS.DRAFT)), (run) => run.id || "");
  counters.removedExactSchedulerRuns += schedulerRuns.removed;
  const scheduler = state.scheduler ? statusRecord(state.scheduler, "lastStatus", WORKFLOW_STATUS.DRAFT) : state.scheduler;
  const cleanedBase = {
    ...state,
    dataSchemaVersion: STUDIO_DATA_SCHEMA_VERSION,
    projects,
    promotionImages: promotionImages.values,
    promotionUsage: promotionUsage.values.slice(-MAX_PROMOTION_USAGE),
    uploadHistory: uploadHistory.values.slice(-MAX_UPLOAD_LOGS),
    ...(scheduler ? { scheduler: { ...scheduler, runs: schedulerRuns.values.slice(-MAX_SCHEDULER_LOGS) } } : {}),
  };
  let cleaned = normalizePlotState(cleanedBase, { now });
  if (previousSchemaVersion < 4) {
    const legacyArchivedPlotIds = (cleaned.plots || [])
      .filter((plot) => plot.isActive === false && !plot.sourceStatus && !plot.sourceInternalId && !plot.listingUrl)
      .map((plot) => plot.id);
    for (const plotId of legacyArchivedPlotIds) {
      const deletion = deletePlotRecordCascade(cleaned, plotId);
      counters.removedLegacyArchivedPlots += 1;
      counters.removedLegacyArchivedProjects += deletion.deletedProjectIds.length;
      cleaned = deletion.state;
    }
  }
  const after = auditStudioState(cleaned, { now });
  return {
    state: cleaned,
    changed: exactKey(cleaned) !== exactKey(state),
    report: { mode: "apply", before, after, actions: counters },
  };
}
