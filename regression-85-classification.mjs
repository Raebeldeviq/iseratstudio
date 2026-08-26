import { createHash } from "node:crypto";

import { listingControl, normalizeListingGroup } from "./listing-groups.mjs";
import { PRODUCTION_DELETE_STATUS } from "./listing-rotation-production-delete.mjs";
import {
  assertRegression85Campaign,
  canonicalRegression85Json,
  REGRESSION_85_CLASSIFICATIONS,
  REGRESSION_85_EXPECTED_COUNT,
  REGRESSION_85_REPAIR_STAGES,
  REGRESSION_85_REPAIR_STRATEGIES,
} from "./regression-85-repair-scope.mjs";
import { WORKFLOW_STATUS } from "./workflow-status.mjs";

export const REGRESSION_85_CLASSIFICATION_SNAPSHOT_FORMAT = 1;

const OPEN_DELETE_STATUSES = new Set([
  PRODUCTION_DELETE_STATUS.PREPARED,
  PRODUCTION_DELETE_STATUS.PROCESSING,
  PRODUCTION_DELETE_STATUS.PENDING_CONFIRMATION,
  PRODUCTION_DELETE_STATUS.TRANSFER_UNCERTAIN,
]);

function clean(value, maximum = 500) {
  return String(value ?? "").trim().slice(0, maximum);
}

function iso(value) {
  const parsed = Date.parse(clean(value, 50));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function classificationError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function portalStatuses(value) {
  const source = value && typeof value === "object" ? value : {};
  return Object.freeze({
    immowelt: clean(source.immowelt || source.Immowelt || "unknown", 100),
    kleinanzeigen: clean(source.kleinanzeigen || source.Kleinanzeigen || "unknown", 100),
    immoscout24: clean(source.immoscout24 || source.ImmoScout24 || source.immoscout || "unknown", 100),
  });
}

function normalizeEvidenceSnapshot(value, scope) {
  if (value?.format !== REGRESSION_85_CLASSIFICATION_SNAPSHOT_FORMAT) {
    throw classificationError("REGRESSION_85_CLASSIFICATION_SNAPSHOT_INVALID", "Der read-only Klassifikationssnapshot besitzt ein unbekanntes Format.");
  }
  const observedAt = iso(value.observedAt);
  if (!observedAt) throw classificationError("REGRESSION_85_CLASSIFICATION_SNAPSHOT_INVALID", "Dem read-only Klassifikationssnapshot fehlt ein gültiger Beobachtungszeitpunkt.");
  const records = Array.isArray(value.items) ? value.items : [];
  if (records.length !== REGRESSION_85_EXPECTED_COUNT) {
    throw classificationError("REGRESSION_85_CLASSIFICATION_SNAPSHOT_INCOMPLETE", "Der read-only Klassifikationssnapshot muss exakt 85 Einträge enthalten.");
  }
  const byScopeItemId = new Map();
  for (const record of records) {
    const scopeItemId = clean(record?.scopeItemId, 200);
    if (!scopeItemId || byScopeItemId.has(scopeItemId)) {
      throw classificationError("REGRESSION_85_CLASSIFICATION_SNAPSHOT_INCOMPLETE", "Der read-only Klassifikationssnapshot enthält fehlende oder doppelte Scope-IDs.");
    }
    if (!new Set(["present", "absent", "unknown"]).has(record?.sourcePresence)) {
      throw classificationError("REGRESSION_85_CLASSIFICATION_SNAPSHOT_INVALID", `Die externe Source-Präsenz für ${scopeItemId} ist ungültig.`);
    }
    byScopeItemId.set(scopeItemId, {
      scopeItemId,
      sourceExternalId: clean(record.sourceExternalId, 40),
      regressionExternalId: clean(record.regressionExternalId, 40),
      sourcePresence: record.sourcePresence,
      sourcePresenceChannel: clean(record.sourcePresenceChannel || value.channel || "immoprofessional-read-only", 100),
      observedAt: iso(record.observedAt || observedAt),
      portalStatuses: portalStatuses(record.portalStatuses),
    });
  }
  const missing = scope.items.filter((item) => !byScopeItemId.has(item.scopeItemId));
  const foreign = [...byScopeItemId.keys()].filter((scopeItemId) => !scope.items.some((item) => item.scopeItemId === scopeItemId));
  if (missing.length || foreign.length) {
    throw classificationError("REGRESSION_85_CLASSIFICATION_SNAPSHOT_SCOPE_MISMATCH", "Der read-only Klassifikationssnapshot stimmt nicht exakt mit der 85er-Allowlist überein.", {
      missing: missing.map((item) => item.scopeItemId),
      foreign,
    });
  }
  return { format: REGRESSION_85_CLASSIFICATION_SNAPSHOT_FORMAT, observedAt, byScopeItemId };
}

function catalogIndex(state) {
  const byId = new Map();
  for (const project of state?.projects || []) {
    for (const listing of project.listings || []) {
      if (byId.has(listing.id)) {
        throw classificationError("REGRESSION_85_CATALOG_ID_AMBIGUOUS", `Die Listing-ID ${listing.id} ist im Katalog nicht eindeutig.`);
      }
      byId.set(listing.id, { project, listing });
    }
  }
  return byId;
}

function exactPositiveImportEvidence(state, source, regression, uploadLedger, scopeItem) {
  const reports = (state.importReports || []).filter((report) =>
    report?.importResult === "success"
    && report?.sourceListingId === source.id
    && report?.matchedListingId === regression.id
    && report?.externalObjectNumber === regression.externalId);
  const jobs = (uploadLedger?.jobs || []).filter((job) =>
    job?.jobId === scopeItem.uploadJobId
    || job?.listingId === regression.id
    || job?.externalId === regression.externalId);
  const exactJob = jobs.find((job) =>
    job?.jobId === scopeItem.uploadJobId
    && job?.projectId === scopeItem.projectId
    && job?.listingId === regression.id);
  const report = reports.length === 1 && regression.importReportId === reports[0].reportId ? reports[0] : null;
  return {
    report,
    exactJob: exactJob || null,
    reportCount: reports.length,
    relatedJobCount: jobs.length,
    valid: Boolean(
      report
      && exactJob
      && regression.status === WORKFLOW_STATUS.PUBLISHED
      && regression.importConfirmedAt
      && regression.rotationSourceListingId === source.id
    ),
  };
}

function exactPositiveDeleteEvidence(state, source, deleteLedger) {
  const reports = (state.deleteReports || []).filter((report) =>
    report?.result === "success"
    && report?.sourceListingId === source.id
    && report?.externalObjectNumber === source.externalId);
  const jobs = (deleteLedger?.jobs || []).filter((job) =>
    job?.sourceListingId === source.id
    || job?.externalObjectNumber === source.externalId);
  const confirmedJobs = jobs.filter((job) => job?.status === PRODUCTION_DELETE_STATUS.CONFIRMED);
  const report = reports.length === 1 ? reports[0] : null;
  const job = confirmedJobs.length === 1 ? confirmedJobs[0] : null;
  const valid = Boolean(
    report
    && job
    && source.status === WORKFLOW_STATUS.DELETED
    && source.productionDeleteState === "confirmed"
    && source.deleteReportHash === report.rawHash
    && source.deleteJobId === job.deleteJobId
    && job.reportHash === report.rawHash
  );
  return {
    report,
    job,
    reportCount: reports.length,
    relatedJobCount: jobs.length,
    openJobs: jobs.filter((candidate) => OPEN_DELETE_STATUSES.has(candidate.status)),
    valid,
  };
}

function classifyOne(state, index, scopeItem, uploadLedger, deleteLedger, observation, classifiedAt) {
  const regressionRow = index.get(scopeItem.regressionListingId);
  const sourceRow = index.get(scopeItem.originalSourceListingId);
  const relationReasons = [];
  if (!regressionRow || regressionRow.project.id !== scopeItem.projectId) relationReasons.push("regression_catalog_relation_missing");
  if (!sourceRow || sourceRow.project.id !== scopeItem.projectId) relationReasons.push("original_source_catalog_relation_missing");
  const regression = regressionRow?.listing;
  const source = sourceRow?.listing;
  if (regression?.rotationSourceListingId !== source?.id) relationReasons.push("a_to_b_relation_mismatch");
  if (regression?.externalId !== scopeItem.regressionExternalId) relationReasons.push("regression_external_id_mismatch");
  if (observation.sourceExternalId !== source?.externalId) relationReasons.push("snapshot_source_external_id_mismatch");
  if (observation.regressionExternalId !== regression?.externalId) relationReasons.push("snapshot_regression_external_id_mismatch");
  if (regression?.listingOrigin !== "rotation-copy") relationReasons.push("regression_origin_mismatch");

  const importEvidence = source && regression
    ? exactPositiveImportEvidence(state, source, regression, uploadLedger, scopeItem)
    : { valid: false, reportCount: 0, relatedJobCount: 0, report: null, exactJob: null };
  if (!importEvidence.valid) relationReasons.push("regression_positive_import_provenance_incomplete");
  const deleteEvidence = source
    ? exactPositiveDeleteEvidence(state, source, deleteLedger)
    : { valid: false, reportCount: 0, relatedJobCount: 0, openJobs: [], report: null, job: null };

  let classification = REGRESSION_85_CLASSIFICATIONS.AMBIGUOUS;
  let classificationReason = relationReasons[0] || "source_state_or_external_evidence_ambiguous";
  let repairStrategy = REGRESSION_85_REPAIR_STRATEGIES.NONE;
  if (!relationReasons.length) {
    const sourceGroup = normalizeListingGroup(sourceRow.project.listingGroup, sourceRow.project.id);
    const regressionGroup = normalizeListingGroup(regressionRow.project.listingGroup, regressionRow.project.id);
    const sourceControl = listingControl(sourceGroup, source);
    const regressionControl = listingControl(regressionGroup, regression);
    const rollbackEligible = source.status === WORKFLOW_STATUS.PUBLISHED
      && source.externalDeletionPending === true
      && new Set(["", "authorized"]).has(clean(source.productionDeleteState, 100))
      && !deleteEvidence.report
      && !deleteEvidence.job
      && deleteEvidence.openJobs.length === 0
      && observation.sourcePresence === "present";
    const replacementRequired = deleteEvidence.valid
      && observation.sourcePresence === "absent";
    if (rollbackEligible) {
      classification = REGRESSION_85_CLASSIFICATIONS.ROLLBACK_ELIGIBLE;
      classificationReason = "original_source_published_present_without_delete_transfer";
      repairStrategy = REGRESSION_85_REPAIR_STRATEGIES.ROLLBACK;
    } else if (replacementRequired) {
      classification = REGRESSION_85_CLASSIFICATIONS.REPLACEMENT_REQUIRED;
      classificationReason = "original_source_deleted_with_exact_positive_delete_confirmation";
      repairStrategy = REGRESSION_85_REPAIR_STRATEGIES.REPLACEMENT;
    } else if (deleteEvidence.openJobs.length) {
      classificationReason = "original_source_delete_job_still_open";
    } else if (observation.sourcePresence === "absent" && !deleteEvidence.valid) {
      classificationReason = "original_source_absent_without_exact_positive_delete_confirmation";
    } else if (observation.sourcePresence === "unknown") {
      classificationReason = "original_source_external_presence_unknown";
    } else if (deleteEvidence.reportCount > 1 || deleteEvidence.relatedJobCount > 1) {
      classificationReason = "original_source_delete_provenance_ambiguous";
    } else if (source.status === WORKFLOW_STATUS.DELETED && !deleteEvidence.valid) {
      classificationReason = "original_source_deleted_without_complete_delete_provenance";
    } else if (source.status === WORKFLOW_STATUS.PUBLISHED && !new Set(["", "authorized"]).has(clean(source.productionDeleteState, 100))) {
      classificationReason = "original_source_delete_state_not_rollback_safe";
    }
    const evidence = {
      format: 1,
      scopeItemId: scopeItem.scopeItemId,
      projectId: scopeItem.projectId,
      plotId: scopeItem.plotId,
      rotationId: scopeItem.rotationId,
      schedulerRunId: scopeItem.schedulerRunId,
      uploadJobId: scopeItem.uploadJobId,
      source: {
        listingId: source.id,
        externalId: source.externalId,
        status: source.status,
        externalDeletionPending: source.externalDeletionPending === true,
        productionDeleteState: clean(source.productionDeleteState, 100),
        controlStatus: sourceControl.status,
        automaticUpdateEnabled: sourceControl.automaticUpdateEnabled,
        positiveDeleteReportId: deleteEvidence.report?.reportId || "",
        deleteJobId: deleteEvidence.job?.deleteJobId || "",
        externalPresence: observation.sourcePresence,
        externalPresenceChannel: observation.sourcePresenceChannel,
      },
      regression: {
        listingId: regression.id,
        externalId: regression.externalId,
        status: regression.status,
        controlStatus: regressionControl.status,
        automaticUpdateEnabled: regressionControl.automaticUpdateEnabled,
        positiveImportReportId: importEvidence.report?.reportId || "",
        uploadJobId: importEvidence.exactJob?.jobId || "",
        houseId: regression.templateId,
        houseName: regression.templateName,
        heroType: clean(regression.creativeSelection?.heroType || regression.heroCreativeType || (regression.promotionImageId ? "action" : "house"), 40),
        heroImageId: clean(regression.creativeSelection?.heroImageId || regression.heroImageId || regression.promotionImageId, 200),
        runtimeCommit: scopeItem.runtimeCommit,
        runtimeRelease: scopeItem.runtimeRelease,
        rootProcessId: scopeItem.rootProcessId,
        portalStatuses: observation.portalStatuses,
      },
      observedAt: observation.observedAt,
      classifiedAt,
    };
    return {
      scopeItemId: scopeItem.scopeItemId,
      classification,
      classificationReason,
      evidenceHash: sha256(canonicalRegression85Json(evidence)),
      classifiedAt,
      repairStrategy,
      repairState: classification === REGRESSION_85_CLASSIFICATIONS.AMBIGUOUS ? "blocked_ambiguous" : "classified",
      evidence,
    };
  }

  const evidence = {
    format: 1,
    scopeItemId: scopeItem.scopeItemId,
    relationReasons,
    observation,
    classifiedAt,
  };
  return {
    scopeItemId: scopeItem.scopeItemId,
    classification,
    classificationReason,
    evidenceHash: sha256(canonicalRegression85Json(evidence)),
    classifiedAt,
    repairStrategy,
    repairState: "blocked_ambiguous",
    evidence,
  };
}

export function classifyRegression85Scope(state, scope, uploadLedger, deleteLedger, evidenceSnapshot, options = {}) {
  if (!Array.isArray(scope?.items) || scope.items.length !== REGRESSION_85_EXPECTED_COUNT) {
    throw classificationError("REGRESSION_85_SCOPE_MISMATCH", "Die Klassifikation benötigt die exakte 85er-Allowlist.");
  }
  const classifiedAt = iso(options.now || new Date().toISOString());
  if (!classifiedAt) throw classificationError("REGRESSION_85_CLASSIFICATION_TIME_INVALID", "Der Klassifikationszeitpunkt ist ungültig.");
  const normalizedSnapshot = normalizeEvidenceSnapshot(evidenceSnapshot, scope);
  const index = catalogIndex(state);
  const items = scope.items.map((scopeItem) => classifyOne(
    state,
    index,
    scopeItem,
    uploadLedger,
    deleteLedger,
    normalizedSnapshot.byScopeItemId.get(scopeItem.scopeItemId),
    classifiedAt,
  ));
  const counts = Object.fromEntries(Object.values(REGRESSION_85_CLASSIFICATIONS).map((classification) => [
    classification,
    items.filter((item) => item.classification === classification).length,
  ]));
  if (Object.values(counts).reduce((sum, count) => sum + count, 0) !== REGRESSION_85_EXPECTED_COUNT) {
    throw classificationError("REGRESSION_85_CLASSIFICATION_COUNT_MISMATCH", "Die Klassifikation ergibt nicht exakt 85 Vorgänge.");
  }
  return {
    format: REGRESSION_85_CLASSIFICATION_SNAPSHOT_FORMAT,
    readOnly: true,
    classifiedAt,
    snapshotObservedAt: normalizedSnapshot.observedAt,
    items,
    counts,
    total: items.length,
  };
}

export function applyRegression85Classifications(campaignValue, classificationValue) {
  const campaign = assertRegression85Campaign(campaignValue);
  const items = Array.isArray(classificationValue?.items) ? classificationValue.items : [];
  if (items.length !== REGRESSION_85_EXPECTED_COUNT || classificationValue.total !== REGRESSION_85_EXPECTED_COUNT) {
    throw classificationError("REGRESSION_85_CLASSIFICATION_COUNT_MISMATCH", "Es dürfen nur exakt 85 Klassifikationsergebnisse persistiert werden.");
  }
  const byScopeItemId = new Map(items.map((item) => [item.scopeItemId, item]));
  if (byScopeItemId.size !== REGRESSION_85_EXPECTED_COUNT || campaign.scope.items.some((item) => !byScopeItemId.has(item.scopeItemId))) {
    throw classificationError("REGRESSION_85_CLASSIFICATION_SCOPE_MISMATCH", "Die Klassifikation stimmt nicht exakt mit der persistierten Allowlist überein.");
  }
  return {
    ...campaign,
    classificationSummary: {
      classifiedAt: classificationValue.classifiedAt,
      snapshotObservedAt: classificationValue.snapshotObservedAt,
      counts: classificationValue.counts,
      total: classificationValue.total,
    },
    progress: campaign.progress.map((progress) => {
      const classification = byScopeItemId.get(progress.scopeItemId);
      if (progress.classification && progress.evidenceHash !== classification.evidenceHash) {
        throw classificationError("REGRESSION_85_CLASSIFICATION_IMMUTABLE", "Eine persistierte Klassifikation darf nicht still durch veränderte UI-Evidenz ersetzt werden.", { scopeItemId: progress.scopeItemId });
      }
      return {
        ...progress,
        classification: classification.classification,
        classificationReason: classification.classificationReason,
        evidenceHash: classification.evidenceHash,
        classifiedAt: classification.classifiedAt,
        repairStrategy: classification.repairStrategy,
        repairState: classification.repairState,
        stage: classification.classification === REGRESSION_85_CLASSIFICATIONS.AMBIGUOUS
          ? REGRESSION_85_REPAIR_STAGES.AMBIGUOUS_BLOCKED
          : progress.stage,
      };
    }),
  };
}

export function inspectRegression85OperationalGate(state, scope, options = {}) {
  if (!Array.isArray(scope?.items) || scope.items.length !== REGRESSION_85_EXPECTED_COUNT) {
    return { allowed: false, reasons: ["scope_not_exactly_85"], scopeMarkerCount: 0, foreignMarkerCount: 0 };
  }
  const originalIds = new Set(scope.items.map((item) => item.originalSourceListingId));
  const rows = (state?.projects || []).flatMap((project) => (project.listings || []).map((listing) => ({ project, listing })));
  const markers = rows.filter(({ listing }) => listing.externalDeletionPending === true);
  const scopeMarkers = markers.filter(({ listing }) => originalIds.has(listing.id));
  const foreignMarkers = markers.filter(({ listing }) => !originalIds.has(listing.id));
  const missingSourceIds = [...originalIds].filter((listingId) => !rows.some(({ listing }) => listing.id === listingId));
  const missingMarkers = [...originalIds].filter((listingId) => !scopeMarkers.some(({ listing }) => listing.id === listingId));
  const classifications = Array.isArray(options.classifications) ? options.classifications : [];
  const classificationByScopeItemId = new Map(classifications.map((item) => [item.scopeItemId, item]));
  const confirmedDeletedWithoutMarker = scope.items.filter((scopeItem) => {
    const row = rows.find(({ listing }) => listing.id === scopeItem.originalSourceListingId);
    const classification = classificationByScopeItemId.get(scopeItem.scopeItemId);
    return !row?.listing.externalDeletionPending
      && row?.listing.status === WORKFLOW_STATUS.DELETED
      && row?.listing.productionDeleteState === "confirmed"
      && classification?.classification === REGRESSION_85_CLASSIFICATIONS.REPLACEMENT_REQUIRED;
  });
  const openDeleteJobs = (options.deleteLedger?.jobs || []).filter((job) => OPEN_DELETE_STATUSES.has(job.status));
  const foreignOpenDeleteJobs = openDeleteJobs.filter((job) => !originalIds.has(job.sourceListingId));
  const reasons = [];
  if (scopeMarkers.length + confirmedDeletedWithoutMarker.length !== REGRESSION_85_EXPECTED_COUNT) reasons.push("scope_marker_or_confirmed_deleted_source_count_not_85");
  if (foreignMarkers.length) reasons.push("foreign_external_deletion_markers_present");
  if (missingSourceIds.length) reasons.push("scope_sources_missing");
  if (foreignOpenDeleteJobs.length) reasons.push("foreign_open_delete_jobs_present");
  return {
    allowed: reasons.length === 0,
    reasons,
    scopeMarkerCount: scopeMarkers.length,
    foreignMarkerCount: foreignMarkers.length,
    missingMarkerCount: missingMarkers.length,
    confirmedDeletedSourceCount: confirmedDeletedWithoutMarker.length,
    openDeleteJobCount: openDeleteJobs.length,
    foreignOpenDeleteJobCount: foreignOpenDeleteJobs.length,
    scopeListingIds: [...originalIds],
    foreignMarkerListingIds: foreignMarkers.map(({ listing }) => listing.id),
    missingSourceListingIds: missingSourceIds,
  };
}

export function assertRegression85OperationalGate(state, scope, options = {}) {
  const result = inspectRegression85OperationalGate(state, scope, options);
  if (!result.allowed) {
    throw classificationError("REGRESSION_85_OPERATIONAL_GATE_BLOCKED", `Das 85er-Operational-Gate ist blockiert: ${result.reasons.join(", ")}.`, result);
  }
  return result;
}
