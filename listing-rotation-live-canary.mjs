import { createUploadJobId } from "./batch-upload.mjs";
import { listingControl, normalizeListingGroup } from "./listing-groups.mjs";
import { prepareListingRotationInState } from "./listing-rotation-engine.mjs";
import { automaticRotationCopyId } from "./listing-rotation-scheduler-service.mjs";
import {
  isListingDue,
  listingDueAt,
  listingSchedulerBlockReasons,
  normalizeListingScheduler,
  schedulerDueListings,
} from "./listing-scheduler.mjs";
import { WORKFLOW_STATUS } from "./workflow-status.mjs";

export const LIVE_CANARY_REQUIRED_CANDIDATES = 3;
export const LIVE_CANARY_INSUFFICIENT_ELIGIBLE_PLOTS = "LIVE_CANARY_INSUFFICIENT_ELIGIBLE_PLOTS";

function clean(value, maximum = 500) {
  return String(value ?? "").trim().slice(0, maximum);
}

function validIso(value) {
  const text = clean(value, 50);
  return Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : "";
}

export function effectivePublishedAt(project, listing, groupValue) {
  const control = listingControl(groupValue, listing);
  return validIso(listing.lastUploadedAt)
    || validIso(control.lastSuccessAt)
    || validIso(control.lastUpdatedAt)
    || validIso(listing.createdAt)
    || validIso(project.createdAt);
}

function projectDataIssues(project) {
  const issues = [];
  if (!clean(project?.plotId, 200)) issues.push("stable_plot_id_missing");
  if (!clean(project?.street, 200)) issues.push("plot_street_missing");
  if (!/^\d{5}$/u.test(clean(project?.zip, 20))) issues.push("plot_postal_code_invalid");
  if (!clean(project?.city, 200)) issues.push("plot_city_missing");
  if (!(Number(project?.plotArea) > 0)) issues.push("plot_area_invalid");
  return issues;
}

function listingDataIssues(listing) {
  const issues = [];
  if (!clean(listing?.externalId, 100)) issues.push("source_external_id_missing");
  if (!clean(listing?.templateId, 200)) issues.push("source_house_missing");
  if (!listing?.texts || Object.values(listing.texts).some((value) => !clean(value, 10000))) issues.push("source_texts_incomplete");
  if (listing?.externalDeletionPending) issues.push("source_external_deletion_pending");
  if (listing?.supersededByListingId) issues.push("source_already_superseded");
  if (listing?.replacementPending || listing?.replacementConfirmedAt) issues.push("source_replacement_relation_present");
  return issues;
}

function openUploadIssue(uploadLedger, project, listing) {
  const openStatuses = new Set([WORKFLOW_STATUS.PROCESSING, WORKFLOW_STATUS.FAILED]);
  return (uploadLedger?.jobs || []).some((job) =>
    openStatuses.has(String(job?.status || ""))
    && job.projectId === project.id
    && job.listingId === listing.id)
    ? ["source_upload_job_open"]
    : [];
}

function openDeleteIssue(deleteJobs, listing) {
  return (deleteJobs || []).some((job) =>
    job.externalObjectNumber === listing.externalId
    && !["delete_confirmed", "delete_observed_removed", "delete_transfer_failed"].includes(String(job.status || "")))
    ? ["source_delete_job_open"]
    : [];
}

function readableAddress(project) {
  return [project.street, project.houseNumber, project.zip, project.city].map((value) => clean(value, 200)).filter(Boolean).join(" ");
}

function publicCandidate(row) {
  const value = { ...row };
  delete value._plan;
  delete value._project;
  delete value._listing;
  return value;
}

export async function evaluateLiveCanaryCandidates(state, options = {}) {
  const at = validIso(options.at || new Date().toISOString());
  if (!at) throw new Error("Der Canary-Preflight-Zeitpunkt ist ungültig.");
  const scheduler = normalizeListingScheduler(state.scheduler, { now: at });
  const dailyGuard = options.dailyGuard;
  if (!dailyGuard?.inspect) throw new Error("Der Canary-Preflight benötigt den persistenten Daily-Plot-Guard.");
  const evidence = Array.isArray(options.uploadEvidence) ? options.uploadEvidence : [];
  const additionalBlockedPlotIds = new Set((options.additionalBlockedPlotIds || []).map(String));
  const rows = [];

  for (const project of state.projects || []) {
    const group = normalizeListingGroup(project.listingGroup, project.id, { now: at });
    for (const listing of project.listings || []) {
      const effectiveAt = effectivePublishedAt(project, listing, group);
      const dueAt = listingDueAt(group, listing, scheduler.settings);
      const due = isListingDue(group, listing, scheduler.settings, at);
      const schedulerReasons = listingSchedulerBlockReasons(group, listing, scheduler, at, { project, state });
      const reasons = [
        ...(project.isActive === false ? ["project_inactive"] : []),
        ...projectDataIssues(project),
        ...listingDataIssues(listing),
        ...openUploadIssue(options.uploadLedger, project, listing),
        ...openDeleteIssue(options.deleteJobs, listing),
        ...schedulerReasons.map((reason) => `scheduler:${reason}`),
      ];
      let plan = null;
      let expected = null;
      if (!reasons.length) {
        const copyId = automaticRotationCopyId(project, listing, group);
        const prepared = prepareListingRotationInState(state, project.id, listing.id, {
          now: at,
          mode: scheduler.settings.mode,
          copyId,
          operationToken: `read-only-live-canary-preflight:${listing.id}`,
          uploadJobIdFor: createUploadJobId,
          seed: `${project.id}:${listing.id}:${copyId}`,
        });
        if (!prepared.ok || !prepared.copy) reasons.push(...(prepared.issues || [prepared.message || "rotation_preflight_failed"]));
        else {
          plan = prepared;
          expected = {
            listingId: prepared.copy.id,
            externalId: prepared.copy.externalId,
            templateId: prepared.copy.templateId,
            templateName: prepared.copy.templateName,
            version: prepared.copy.version,
            imageCount: Number(options.houseImageCounts?.get?.(prepared.copy.templateId) || 0),
          };
        }
      }
      const daily = project.plotId
        ? await dailyGuard.inspect({ plotId: project.plotId }, { now: at, evidence })
        : { consumed: true, key: "", evidence: null, record: null };
      if (additionalBlockedPlotIds.has(String(project.plotId || ""))) daily.consumed = true;
      if (daily.consumed) reasons.push("PLOT_DAILY_UPLOAD_LIMIT_REACHED");
      rows.push({
        projectId: project.id,
        plotId: clean(project.plotId, 200),
        address: readableAddress(project),
        listingId: listing.id,
        externalId: listing.externalId,
        house: listing.templateName,
        version: Number(listing.version) || 1,
        status: listing.status,
        effectivePublishedAt: effectiveAt,
        dueAt,
        due,
        eligible: reasons.length === 0,
        plotUploadedToday: daily.consumed,
        dailyEvidence: daily.evidence || daily.record || null,
        expected,
        reasons: [...new Set(reasons)],
        _plan: plan,
        _project: project,
        _listing: listing,
      });
    }
  }

  rows.sort((left, right) =>
    Date.parse(left.effectivePublishedAt || "9999-12-31") - Date.parse(right.effectivePublishedAt || "9999-12-31")
    || left.externalId.localeCompare(right.externalId));
  rows.forEach((row, index) => { row.rank = index + 1; });
  const candidates = [];
  const chosenPlots = new Set();
  for (const row of rows) {
    if (!row.eligible || chosenPlots.has(row.plotId)) continue;
    if (typeof options.validatePrepared === "function") {
      const validationIssues = await options.validatePrepared({
        state: row._plan.state,
        project: row._project,
        source: row._listing,
        copy: row._plan.copy,
      });
      if (validationIssues?.length) {
        row.reasons = [...new Set([...row.reasons, ...validationIssues.map((issue) => `package:${issue}`)])];
        row.eligible = false;
        continue;
      }
    }
    candidates.push(row);
    chosenPlots.add(row.plotId);
    if (candidates.length === LIVE_CANARY_REQUIRED_CANDIDATES) break;
  }
  const dueListings = schedulerDueListings({ ...state, scheduler }, at);
  const distinctDuePlots = new Set(dueListings.map((item) => state.projects.find((project) => project.id === item.projectId)?.plotId).filter(Boolean));
  return {
    ok: candidates.length === LIVE_CANARY_REQUIRED_CANDIDATES,
    code: candidates.length === LIVE_CANARY_REQUIRED_CANDIDATES ? "LIVE_CANARY_3_PRE_FLIGHT_OK" : LIVE_CANARY_INSUFFICIENT_ELIGIBLE_PLOTS,
    at,
    dueCount: dueListings.length,
    distinctDuePlotCount: distinctDuePlots.size,
    candidates: candidates.map(publicCandidate),
    considered: rows.map(publicCandidate),
  };
}
