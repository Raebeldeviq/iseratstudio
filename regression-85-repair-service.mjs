import { createUploadJobId } from "./batch-upload.mjs";
import { recordHouseRotation } from "./house-distribution.mjs";
import { inspectProductionRotationLifecycle, ROTATION_LIFECYCLE_STAGE } from "./listing-rotation-lifecycle-coordinator.mjs";
import {
  assertRegressionRepairPayloadSource,
  prepareRegressionRepairRotationInState,
} from "./listing-regression-repair.mjs";
import { updatePreparedCopyAfterUpload } from "./listing-rotation-scheduler-service.mjs";
import {
  assertRegression85Campaign,
  REGRESSION_85_EXPECTED_COUNT,
  REGRESSION_85_REPAIR_STAGES,
} from "./regression-85-repair-scope.mjs";
import { collectPlotUploadEvidence } from "./plot-daily-upload-guard.mjs";
import { PRODUCTION_DELETE_STATUS } from "./listing-rotation-production-delete.mjs";
import { WORKFLOW_STATUS } from "./workflow-status.mjs";

export const REGRESSION_85_CHECKPOINTS = Object.freeze([5, 10, 20, 40, 60, 80]);

const STAGE_ORDER = Object.freeze([
  REGRESSION_85_REPAIR_STAGES.IDENTIFIED,
  REGRESSION_85_REPAIR_STAGES.WAITING_DAILY_PLOT_WINDOW,
  REGRESSION_85_REPAIR_STAGES.CREATIVE_SELECTED,
  REGRESSION_85_REPAIR_STAGES.REPLACEMENT_CREATED,
  REGRESSION_85_REPAIR_STAGES.TRANSFERRED_PENDING_IMPORT,
  REGRESSION_85_REPAIR_STAGES.REPLACEMENT_PUBLISHED,
  REGRESSION_85_REPAIR_STAGES.OLD_DELETE_PENDING,
  REGRESSION_85_REPAIR_STAGES.OLD_DELETED,
  REGRESSION_85_REPAIR_STAGES.REPAIR_COMPLETED,
]);

function clean(value, maximum = 500) {
  return String(value ?? "").trim().slice(0, maximum);
}

function serviceError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function rank(stage) {
  return STAGE_ORDER.indexOf(stage);
}

function monotonicStage(current, requested) {
  return rank(current) > rank(requested) ? current : requested;
}

function projectAndSource(state, scopeItem) {
  const project = (state.projects || []).find((candidate) => candidate.id === scopeItem.projectId);
  const source = project?.listings.find((candidate) => candidate.id === scopeItem.regressionListingId);
  if (!project || !source || source.externalId !== scopeItem.regressionExternalId || String(project.plotId || "") !== scopeItem.plotId) {
    throw serviceError("REGRESSION_85_SCOPE_ITEM_MISMATCH", "Das aktive Regression-Objekt stimmt nicht mehr mit seiner harten Allowlist überein.");
  }
  return { project, source };
}

function replacementFor(project, progress) {
  if (!progress.replacementListingId) return null;
  return project.listings.find((listing) => listing.id === progress.replacementListingId) || null;
}

function creativeSummary(items) {
  const houses = Object.entries(Object.groupBy(items, (item) => item.proposedHouseName || ""))
    .map(([houseName, values]) => ({ houseName, count: values.length }))
    .sort((left, right) => right.count - left.count || left.houseName.localeCompare(right.houseName));
  let longestIdenticalSeries = 0;
  let currentSeries = 0;
  let previous = "";
  for (const item of items) {
    if (item.proposedHouseName === previous) currentSeries += 1;
    else currentSeries = 1;
    previous = item.proposedHouseName;
    longestIdenticalSeries = Math.max(longestIdenticalSeries, currentSeries);
  }
  return {
    candidateCount: items.length,
    distinctHouseCount: houses.length,
    mostFrequentHouse: houses[0] || null,
    longestIdenticalSeries,
    houseHeroCount: items.filter((item) => item.heroType === "house").length,
    actionHeroCount: items.filter((item) => item.heroType === "action").length,
    fallbackCount: items.filter((item) => item.diagnostics.includes("CREATIVE_VARIATION_EXHAUSTED")).length,
    houses,
  };
}

/** Vollständig read-only: State und Kampagne werden geklont. */
export function previewRegression85Repair(stateValue, campaignValue, options = {}) {
  const campaign = assertRegression85Campaign(campaignValue);
  let state = structuredClone(stateValue);
  const baseTime = Date.parse(options.now || new Date().toISOString());
  if (!Number.isFinite(baseTime)) throw serviceError("REGRESSION_85_PREVIEW_TIME_INVALID", "Der Preview-Zeitpunkt ist ungültig.");
  const items = [];
  for (let index = 0; index < campaign.scope.items.length; index += 1) {
    const scopeItem = campaign.scope.items[index];
    const at = new Date(baseTime + index).toISOString();
    const schedulerRunId = `preview:${campaign.campaignId}:${scopeItem.scopeItemId}`;
    const result = prepareRegressionRepairRotationInState(state, scopeItem, {
      campaignId: campaign.campaignId,
      scopeHash: campaign.scopeHash,
      schedulerRunId,
      now: at,
    });
    const copy = result.copy;
    const { project, source } = projectAndSource(state, scopeItem);
    items.push({
      scopeItemId: scopeItem.scopeItemId,
      regressionListingId: scopeItem.regressionListingId,
      regressionExternalId: scopeItem.regressionExternalId,
      plotId: scopeItem.plotId,
      projectId: scopeItem.projectId,
      currentHouseId: source.templateId,
      currentHouseName: source.templateName,
      replacementListingId: copy.id,
      replacementExternalId: copy.externalId,
      proposedHouseId: copy.templateId,
      proposedHouseName: copy.templateName,
      heroType: copy.creativeSelection.heroType,
      heroImageId: copy.creativeSelection.heroImageId,
      action: copy.creativeSelection.heroType === "action",
      houseReason: copy.creativeSelection.houseReason,
      heroReason: copy.creativeSelection.heroReason,
      diagnostics: copy.creativeSelection.diagnostics || [],
    });
    state = result.state;
    state = {
      ...state,
      houseDistribution: recordHouseRotation(
        state.houseDistribution,
        state.houses || [],
        state.projects || [],
        project.id,
        source.templateId,
        copy.templateId,
        { now: at },
      ),
    };
  }
  if (items.length !== REGRESSION_85_EXPECTED_COUNT) {
    throw serviceError("REGRESSION_85_SCOPE_MISMATCH", "Die Reparaturvorschau enthält nicht exakt 85 Objekte.");
  }
  return {
    generatedAt: new Date(baseTime).toISOString(),
    campaignId: campaign.campaignId,
    scopeHash: campaign.scopeHash,
    readOnly: true,
    items,
    summary: creativeSummary(items),
  };
}

function progressSummary(campaign) {
  const counts = Object.fromEntries(STAGE_ORDER.map((stage) => [stage, 0]));
  for (const item of campaign.progress) counts[item.stage] += 1;
  return {
    total: campaign.progress.length,
    completed: counts[REGRESSION_85_REPAIR_STAGES.REPAIR_COMPLETED],
    waitingDailyPlotWindow: counts[REGRESSION_85_REPAIR_STAGES.WAITING_DAILY_PLOT_WINDOW],
    pending: campaign.progress.length - counts[REGRESSION_85_REPAIR_STAGES.REPAIR_COMPLETED],
    counts,
  };
}

function currentProgress(campaign) {
  if (campaign.activeScopeItemId) {
    const active = campaign.progress.find((item) => item.scopeItemId === campaign.activeScopeItemId);
    if (!active || active.stage === REGRESSION_85_REPAIR_STAGES.REPAIR_COMPLETED) {
      throw serviceError("REGRESSION_85_ACTIVE_ITEM_INVALID", "Der persistierte aktive Reparaturdatensatz ist nicht mehr konsistent.");
    }
    return active;
  }
  return campaign.progress.find((item) => item.stage !== REGRESSION_85_REPAIR_STAGES.REPAIR_COMPLETED) || null;
}

function scopeItemFor(campaign, progress) {
  const item = campaign.scope.items.find((candidate) => candidate.scopeItemId === progress.scopeItemId);
  if (!item) throw serviceError("REGRESSION_85_SCOPE_ITEM_MISMATCH", "Der Reparaturfortschritt gehört nicht zur harten Allowlist.");
  return item;
}

function nextBerlinDayStart(at) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(at)).map((part) => [part.type, part.value]));
  const approximate = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + 1, 0, 0, 0));
  for (let offsetMinutes = -180; offsetMinutes <= 180; offsetMinutes += 30) {
    const candidate = new Date(approximate.getTime() + offsetMinutes * 60_000);
    const rendered = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Berlin",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(candidate);
    const values = Object.fromEntries(rendered.map((part) => [part.type, part.value]));
    const expectedDate = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + 1));
    if (
      Number(values.year) === expectedDate.getUTCFullYear()
      && Number(values.month) === expectedDate.getUTCMonth() + 1
      && Number(values.day) === expectedDate.getUTCDate()
      && values.hour === "00"
      && values.minute === "00"
    ) return candidate.toISOString();
  }
  throw serviceError("REGRESSION_85_BERLIN_DAY_CALCULATION_FAILED", "Der nächste Europe/Berlin-Kalendertag konnte nicht sicher bestimmt werden.");
}

function completedCheckpoint(campaign, completed) {
  return REGRESSION_85_CHECKPOINTS.includes(completed)
    && !(campaign.checkpointHistory || []).some((item) => item.completed === completed);
}

export function createRegression85RepairService(options) {
  const required = [
    [options?.campaignStore?.load, "Kampagnenspeicher"],
    [options?.campaignStore?.update, "Kampagnenmutation"],
    [options?.catalogStore?.load, "Katalogspeicher"],
    [options?.catalogStore?.update, "Katalogmutation"],
    [options?.lease?.acquire, "persistenter Claim"],
    [options?.uploadJobLedger?.read, "Uploadledger"],
    [options?.productionDeleteLedger?.read, "Deleteledger"],
    [options?.plotDailyUploadGuard?.inspect, "Grundstücks-Tagesguard"],
    [options?.upload, "bestehender Uploadpfad"],
    [options?.importReportService?.runOnce, "Importberichtdienst"],
    [options?.productionDeleteService?.runOnce, "Production-DELETE-Dienst"],
  ];
  const missing = required.find(([value]) => typeof value !== "function");
  if (missing) throw new Error(`Der 85er-Reparatur fehlt: ${missing[1]}.`);
  const now = options.now || (() => new Date().toISOString());
  const writeLog = options.writeLog || (async () => undefined);

  async function assertMutationGuards(campaign) {
    assertRegression85Campaign(campaign);
    if (campaign.scope.items.length !== REGRESSION_85_EXPECTED_COUNT) {
      throw serviceError("REGRESSION_85_SCOPE_MISMATCH", "Vor jeder Mutation müssen exakt 85 Allowlist-Objekte vorliegen.");
    }
    const [rotationMode, portalMode, deleteMode, productionPolicy] = await Promise.all([
      options.rotationModeStore.load(),
      options.portalModeStore.load(),
      options.productionDeleteModeStore.load(),
      options.productionPolicyStore.load(),
    ]);
    if (rotationMode.mode !== "off") throw serviceError("REGRESSION_85_NORMAL_ROTATION_NOT_OFF", "Die normale Inseratrotation muss während der Reparatur off bleiben.");
    if (portalMode.mode !== "off") throw serviceError("REGRESSION_85_PORTAL_EXPORT_NOT_OFF", "Der Portalexport muss während der Reparatur off bleiben.");
    if (deleteMode.valid !== true || deleteMode.mode !== "active") throw serviceError("REGRESSION_85_DELETE_MODE_NOT_ACTIVE", "Production-DELETE muss für den seriellen Repair-Lifecycle eindeutig aktiv sein.");
    if (productionPolicy.valid !== true) throw serviceError("REGRESSION_85_PRODUCTION_POLICY_INVALID", "Die Produktionspolicy ist nicht eindeutig gültig.");
    const ownership = await options.runtimeOwnershipGuard.assert(productionPolicy);
    return { rotationMode, portalMode, deleteMode, productionPolicy, ownership };
  }

  async function updateProgress(scopeItemId, patch, input = {}) {
    return options.campaignStore.update((campaign) => {
      const progress = campaign.progress.find((item) => item.scopeItemId === scopeItemId);
      if (!progress) throw serviceError("REGRESSION_85_SCOPE_ITEM_MISMATCH", "Der Fortschrittsdatensatz gehört nicht zur Allowlist.");
      const requestedStage = patch.stage || progress.stage;
      const updated = {
        ...progress,
        ...patch,
        stage: monotonicStage(progress.stage, requestedStage),
        updatedAt: input.now || now(),
      };
      return {
        ...campaign,
        activeScopeItemId: updated.stage === REGRESSION_85_REPAIR_STAGES.REPAIR_COMPLETED ? "" : scopeItemId,
        progress: campaign.progress.map((item) => item.scopeItemId === scopeItemId ? updated : item),
        lastErrorCode: "",
        lastError: "",
      };
    }, { now: input.now || now() });
  }

  async function pause(error, scopeItemId = "") {
    const at = now();
    const result = await options.campaignStore.update((campaign) => ({
      ...campaign,
      mode: "paused",
      pausedAt: at,
      lastErrorCode: clean(error?.code || "REGRESSION_85_REPAIR_FAILED", 120),
      lastError: clean(error?.message || "Die 85er-Reparatur wurde fail-closed pausiert."),
      progress: campaign.progress.map((item) => item.scopeItemId === scopeItemId
        ? {
            ...item,
            lastErrorCode: clean(error?.code || "REGRESSION_85_REPAIR_FAILED", 120),
            lastError: clean(error?.message || "Die 85er-Reparatur wurde fail-closed pausiert."),
            updatedAt: at,
          }
        : item),
    }), { now: at });
    await writeLog("paused", {
      campaignId: result.campaignId,
      scopeHash: result.scopeHash,
      scopeItemId: scopeItemId || null,
      errorCode: result.lastErrorCode,
      message: result.lastError,
    });
    return result;
  }

  function observedStage(state, campaign, scopeItem, progress, uploadLedger, deleteLedger) {
    const { project, source } = projectAndSource(state, scopeItem);
    const replacement = replacementFor(project, progress);
    if (!replacement) return { stage: progress.stage, project, source, replacement: null, assessment: null };
    assertRegressionRepairPayloadSource(state, scopeItem, replacement);
    let stage = REGRESSION_85_REPAIR_STAGES.REPLACEMENT_CREATED;
    if (replacement.status === WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT) stage = REGRESSION_85_REPAIR_STAGES.TRANSFERRED_PENDING_IMPORT;
    if (replacement.status === WORKFLOW_STATUS.PUBLISHED) stage = REGRESSION_85_REPAIR_STAGES.REPLACEMENT_PUBLISHED;
    let assessment = null;
    if ([WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT, WORKFLOW_STATUS.PUBLISHED].includes(replacement.status)) {
      assessment = inspectProductionRotationLifecycle(state, {
        projectId: project.id,
        sourceListingId: source.id,
        replacementListingId: replacement.id,
        productionSchedulerRunId: replacement.productionLifecycle.schedulerRunId,
      }, uploadLedger, deleteLedger);
      if (!assessment.consistent) {
        throw serviceError("REGRESSION_85_LIFECYCLE_EVIDENCE_CONFLICT", `Die Repair-Lifecycle-Evidenz ist widersprüchlich: ${assessment.reasons.join(", ")}.`);
      }
      if (assessment.evidence.deleteTransferred) stage = REGRESSION_85_REPAIR_STAGES.OLD_DELETE_PENDING;
      if (assessment.evidence.sourceDeleted) stage = REGRESSION_85_REPAIR_STAGES.OLD_DELETED;
      if (assessment.evidence.sourceDeleted && replacement.productionLifecycle.lifecycleStage === ROTATION_LIFECYCLE_STAGE.COMPLETED) {
        stage = REGRESSION_85_REPAIR_STAGES.REPAIR_COMPLETED;
      }
    }
    return { stage: monotonicStage(progress.stage, stage), project, source, replacement, assessment };
  }

  async function verifyNoForeignOpenDelete(deleteLedger, activeScopeItemId = "") {
    const open = (deleteLedger.jobs || []).filter((job) => [
      PRODUCTION_DELETE_STATUS.PREPARED,
      PRODUCTION_DELETE_STATUS.PROCESSING,
      PRODUCTION_DELETE_STATUS.PENDING_CONFIRMATION,
      PRODUCTION_DELETE_STATUS.TRANSFER_UNCERTAIN,
    ].includes(job.status));
    if (!open.length) return;
    const campaign = await options.campaignStore.load();
    const progress = campaign.progress.find((item) => item.scopeItemId === activeScopeItemId);
    const allowedSource = campaign.scope.items.find((item) => item.scopeItemId === activeScopeItemId)?.regressionListingId;
    const allowedReplacement = progress?.replacementListingId;
    const foreign = open.filter((job) => job.sourceListingId !== allowedSource || job.replacementListingId !== allowedReplacement);
    if (foreign.length) {
      throw serviceError(
        "REGRESSION_85_FOREIGN_DELETE_OPEN",
        "Eine bereits begonnene fremde DELETE-Kette muss vor der 85er-Reparatur eindeutig reconciliert werden.",
        { deleteJobIds: foreign.map((job) => job.deleteJobId) },
      );
    }
  }

  async function checkpointIfDue(campaign) {
    const summary = progressSummary(campaign);
    if (!completedCheckpoint(campaign, summary.completed)) return campaign;
    const snapshot = await options.catalogStore.load();
    const completedItems = campaign.progress
      .filter((item) => item.stage === REGRESSION_85_REPAIR_STAGES.REPAIR_COMPLETED)
      .map((progress) => {
        const scopeItem = scopeItemFor(campaign, progress);
        const { project } = projectAndSource(snapshot.state, scopeItem);
        const replacement = replacementFor(project, progress);
        return {
          proposedHouseName: replacement?.templateName || "",
          heroType: replacement?.creativeSelection?.heroType || "",
          diagnostics: replacement?.creativeSelection?.diagnostics || [],
        };
      });
    const diagnostics = creativeSummary(completedItems);
    const at = now();
    const updated = await options.campaignStore.update((current) => ({
      ...current,
      checkpointHistory: [...(current.checkpointHistory || []), {
        completed: summary.completed,
        recordedAt: at,
        diagnostics,
      }],
    }), { now: at });
    await writeLog("checkpoint", { campaignId: campaign.campaignId, scopeHash: campaign.scopeHash, completed: summary.completed, ...diagnostics });
    return updated;
  }

  async function runOnce(input = {}) {
    const initial = await options.campaignStore.load();
    if (initial.valid !== true || initial.mode !== "active") {
      return { ran: false, reason: initial.fallbackReason || `repair-mode-${initial.mode || "off"}`, mode: initial.mode || "off" };
    }
    const runAt = now();
    const runId = clean(input.runId, 200) || `regression-85:${initial.campaignId}:${runAt}`;
    let lease;
    let activeScopeItemId = initial.activeScopeItemId;
    try {
      await assertMutationGuards(initial);
      lease = await options.lease.acquire({
        schedulerRunId: runId,
        ownerId: `regression-85-repair:${process.pid}`,
        runtimeIdentity: clean(options.runtimeIdentity || `process:${process.pid}`, 500),
        now: runAt,
      });
      let campaign = await options.campaignStore.load();
      assertRegression85Campaign(campaign);
      let progress = currentProgress(campaign);
      if (!progress) {
        campaign = await options.campaignStore.update((current) => ({ ...current, mode: "completed", completedAt: runAt, activeScopeItemId: "" }), { now: runAt });
        return { ran: true, ok: true, completed: true, summary: progressSummary(campaign) };
      }
      activeScopeItemId = progress.scopeItemId;
      if (!campaign.activeScopeItemId) {
        campaign = await options.campaignStore.update((current) => ({ ...current, activeScopeItemId }), { now: runAt });
        progress = campaign.progress.find((item) => item.scopeItemId === activeScopeItemId);
      }
      const scopeItem = scopeItemFor(campaign, progress);
      const [snapshot, uploadLedger, deleteLedger] = await Promise.all([
        options.catalogStore.load(),
        options.uploadJobLedger.read(),
        options.productionDeleteLedger.read(),
      ]);
      await verifyNoForeignOpenDelete(deleteLedger, activeScopeItemId);
      const observed = observedStage(snapshot.state, campaign, scopeItem, progress, uploadLedger, deleteLedger);
      if (rank(observed.stage) > rank(progress.stage)) {
        campaign = await updateProgress(activeScopeItemId, {
          stage: observed.stage,
          replacementListingId: observed.replacement?.id || progress.replacementListingId,
          replacementExternalId: observed.replacement?.externalId || progress.replacementExternalId,
          importReportId: observed.replacement?.importReportId || progress.importReportId,
          deleteJobId: observed.source.productionDeleteJobId || observed.source.deleteJobId || progress.deleteJobId,
          deleteReportId: observed.assessment?.deleteReport?.reportId || progress.deleteReportId,
        }, { now: runAt });
        progress = campaign.progress.find((item) => item.scopeItemId === activeScopeItemId);
      }

      if ([REGRESSION_85_REPAIR_STAGES.IDENTIFIED, REGRESSION_85_REPAIR_STAGES.WAITING_DAILY_PLOT_WINDOW].includes(progress.stage)) {
        const evidence = collectPlotUploadEvidence(snapshot.state, uploadLedger, runAt);
        const daily = await options.plotDailyUploadGuard.inspect({ plotId: scopeItem.plotId }, { now: runAt, evidence });
        if (daily.consumed) {
          const earliestEligibleAt = nextBerlinDayStart(runAt);
          campaign = await updateProgress(activeScopeItemId, {
            stage: REGRESSION_85_REPAIR_STAGES.WAITING_DAILY_PLOT_WINDOW,
            earliestEligibleAt,
          }, { now: runAt });
          await writeLog("waiting-daily-plot-window", { campaignId: campaign.campaignId, scopeHash: campaign.scopeHash, scopeItemId: activeScopeItemId, plotId: scopeItem.plotId, earliestEligibleAt });
          return { ran: true, ok: true, waiting: true, reason: "waiting_daily_plot_window", scopeItemId: activeScopeItemId, earliestEligibleAt, summary: progressSummary(campaign) };
        }
        const prepared = await options.catalogStore.update((state) => {
          const result = prepareRegressionRepairRotationInState(state, scopeItem, {
            campaignId: campaign.campaignId,
            scopeHash: campaign.scopeHash,
            schedulerRunId: runId,
            now: runAt,
          });
          return { state: result.state, result: { copy: result.copy, idempotent: result.idempotent } };
        }, { now: runAt });
        const copy = prepared.result.copy;
        campaign = await updateProgress(activeScopeItemId, {
          stage: REGRESSION_85_REPAIR_STAGES.REPLACEMENT_CREATED,
          earliestEligibleAt: "",
          replacementListingId: copy.id,
          replacementExternalId: copy.externalId,
          uploadJobId: createUploadJobId(observed.project, copy),
        }, { now: runAt });
        await writeLog("replacement-created", { campaignId: campaign.campaignId, scopeHash: campaign.scopeHash, scopeItemId: activeScopeItemId, regressionExternalId: scopeItem.regressionExternalId, replacementExternalId: copy.externalId, houseId: copy.templateId, houseName: copy.templateName, heroType: copy.creativeSelection.heroType, heroImageId: copy.creativeSelection.heroImageId, idempotent: prepared.result.idempotent });
        return { ran: true, ok: true, stage: REGRESSION_85_REPAIR_STAGES.REPLACEMENT_CREATED, scopeItemId: activeScopeItemId, replacementExternalId: copy.externalId, summary: progressSummary(campaign) };
      }

      if (progress.stage === REGRESSION_85_REPAIR_STAGES.REPLACEMENT_CREATED) {
        await assertMutationGuards(campaign);
        const current = await options.catalogStore.load();
        const { project } = projectAndSource(current.state, scopeItem);
        const copy = replacementFor(project, progress);
        assertRegressionRepairPayloadSource(current.state, scopeItem, copy);
        const result = await options.upload({
          state: current.state,
          project,
          listing: copy,
          runId,
          trigger: "regression-85-repair",
          effectiveMaxRunItems: 1,
        });
        const transferredAt = now();
        await options.catalogStore.update((state) => ({
          state: updatePreparedCopyAfterUpload(state, project.id, copy.id, {
            ok: true,
            jobId: result.jobId || createUploadJobId(project, copy),
            runId,
          }, transferredAt),
        }), { now: transferredAt });
        campaign = await updateProgress(activeScopeItemId, {
          stage: REGRESSION_85_REPAIR_STAGES.TRANSFERRED_PENDING_IMPORT,
          uploadJobId: result.jobId || createUploadJobId(project, copy),
        }, { now: transferredAt });
        await writeLog("transferred-pending-import", { campaignId: campaign.campaignId, scopeHash: campaign.scopeHash, scopeItemId: activeScopeItemId, regressionExternalId: scopeItem.regressionExternalId, replacementExternalId: copy.externalId, uploadJobId: result.jobId || createUploadJobId(project, copy) });
        return { ran: true, ok: true, stage: REGRESSION_85_REPAIR_STAGES.TRANSFERRED_PENDING_IMPORT, scopeItemId: activeScopeItemId, summary: progressSummary(campaign) };
      }

      if (progress.stage === REGRESSION_85_REPAIR_STAGES.TRANSFERRED_PENDING_IMPORT) {
        const importResult = await options.importReportService.runOnce({
          trigger: "regression-85-repair",
          allowedExternalObjectNumbers: [progress.replacementExternalId],
        });
        if (importResult?.errorCode) {
          throw serviceError(
            clean(importResult.errorCode, 120),
            clean(importResult.reason || "Der Importberichtdienst meldete einen technischen Fehler."),
          );
        }
        const current = await options.catalogStore.load();
        const { project } = projectAndSource(current.state, scopeItem);
        const copy = replacementFor(project, progress);
        if (copy?.status !== WORKFLOW_STATUS.PUBLISHED || !copy.importReportId) {
          return { ran: true, ok: true, waiting: true, reason: "awaiting_import_confirmation", scopeItemId: activeScopeItemId, summary: progressSummary(campaign) };
        }
        campaign = await updateProgress(activeScopeItemId, {
          stage: REGRESSION_85_REPAIR_STAGES.REPLACEMENT_PUBLISHED,
          importReportId: copy.importReportId,
        }, { now: now() });
        await writeLog("replacement-published", { campaignId: campaign.campaignId, scopeHash: campaign.scopeHash, scopeItemId: activeScopeItemId, replacementExternalId: copy.externalId, importReportId: copy.importReportId });
        return { ran: true, ok: true, stage: REGRESSION_85_REPAIR_STAGES.REPLACEMENT_PUBLISHED, scopeItemId: activeScopeItemId, summary: progressSummary(campaign) };
      }

      if (progress.stage === REGRESSION_85_REPAIR_STAGES.REPLACEMENT_PUBLISHED) {
        await assertMutationGuards(campaign);
        const result = await options.productionDeleteService.runOnce({
          trigger: "scheduler-lifecycle",
          targetExternalObjectNumber: scopeItem.regressionExternalId,
        });
        if (result?.errors?.length) throw serviceError("REGRESSION_85_DELETE_TRANSFER_FAILED", result.errors[0].message || "Der exakte Regression-DELETE ist fehlgeschlagen.");
        const current = await options.catalogStore.load();
        const { source } = projectAndSource(current.state, scopeItem);
        if (source.status === WORKFLOW_STATUS.DELETED) {
          campaign = await updateProgress(activeScopeItemId, { stage: REGRESSION_85_REPAIR_STAGES.OLD_DELETED, deleteJobId: source.deleteJobId || source.productionDeleteJobId }, { now: now() });
        } else if (source.productionDeleteState === "pending_confirmation") {
          campaign = await updateProgress(activeScopeItemId, { stage: REGRESSION_85_REPAIR_STAGES.OLD_DELETE_PENDING, deleteJobId: source.productionDeleteJobId }, { now: now() });
        } else {
          return { ran: true, ok: true, waiting: true, reason: "delete_not_yet_transferred", scopeItemId: activeScopeItemId, summary: progressSummary(campaign) };
        }
        return { ran: true, ok: true, stage: campaign.progress.find((item) => item.scopeItemId === activeScopeItemId).stage, scopeItemId: activeScopeItemId, summary: progressSummary(campaign) };
      }

      if ([REGRESSION_85_REPAIR_STAGES.OLD_DELETE_PENDING, REGRESSION_85_REPAIR_STAGES.OLD_DELETED].includes(progress.stage)) {
        if (progress.stage === REGRESSION_85_REPAIR_STAGES.OLD_DELETE_PENDING) {
          await options.productionDeleteService.runOnce({
            trigger: "scheduler-lifecycle",
            targetExternalObjectNumber: scopeItem.regressionExternalId,
          });
        }
        const current = await options.catalogStore.load();
        const { project, source } = projectAndSource(current.state, scopeItem);
        const replacement = replacementFor(project, progress);
        if (source.status !== WORKFLOW_STATUS.DELETED || replacement?.status !== WORKFLOW_STATUS.PUBLISHED) {
          return { ran: true, ok: true, waiting: true, reason: "awaiting_delete_confirmation", scopeItemId: activeScopeItemId, summary: progressSummary(campaign) };
        }
        const completedAt = now();
        await options.catalogStore.update((state) => {
          const currentProject = state.projects.find((candidate) => candidate.id === project.id);
          const currentReplacement = currentProject?.listings.find((listing) => listing.id === replacement.id);
          const updatedReplacement = {
            ...currentReplacement,
            productionLifecycle: {
              ...currentReplacement.productionLifecycle,
              lifecycleStage: ROTATION_LIFECYCLE_STAGE.COMPLETED,
              completedAt,
              finalResult: "success",
            },
          };
          return {
            state: {
              ...state,
              projects: state.projects.map((candidate) => candidate.id === project.id
                ? { ...currentProject, listings: currentProject.listings.map((listing) => listing.id === replacement.id ? updatedReplacement : listing) }
                : candidate),
            },
          };
        }, { now: completedAt });
        campaign = await updateProgress(activeScopeItemId, {
          stage: REGRESSION_85_REPAIR_STAGES.REPAIR_COMPLETED,
          deleteJobId: source.deleteJobId,
          deleteReportId: `delete-report-${clean(source.deleteReportHash, 64).slice(0, 32)}`,
          completedAt,
        }, { now: completedAt });
        campaign = await checkpointIfDue(campaign);
        const summary = progressSummary(campaign);
        if (summary.completed === REGRESSION_85_EXPECTED_COUNT) {
          campaign = await options.campaignStore.update((currentCampaign) => ({ ...currentCampaign, mode: "completed", completedAt, activeScopeItemId: "" }), { now: completedAt });
        }
        await writeLog("repair-completed", { campaignId: campaign.campaignId, scopeHash: campaign.scopeHash, scopeItemId: activeScopeItemId, regressionExternalId: scopeItem.regressionExternalId, replacementExternalId: replacement.externalId, completed: progressSummary(campaign).completed });
        return { ran: true, ok: true, stage: REGRESSION_85_REPAIR_STAGES.REPAIR_COMPLETED, scopeItemId: activeScopeItemId, summary: progressSummary(campaign) };
      }

      throw serviceError("REGRESSION_85_STAGE_UNSUPPORTED", `Der Reparaturstatus ${progress.stage} kann nicht sicher fortgesetzt werden.`);
    } catch (error) {
      if (error?.code !== "LISTING_SCHEDULER_LOCKED") await pause(error, activeScopeItemId).catch(() => undefined);
      throw error;
    } finally {
      await lease?.release().catch(() => undefined);
    }
  }

  return {
    runOnce,
    async inspect() {
      const campaign = await options.campaignStore.load();
      return { ...campaign, summary: campaign.valid === true ? progressSummary(campaign) : null };
    },
  };
}

/**
 * Zusätzliche enge Schranke vor einem bestehenden Production-DELETE-Transfer.
 * Ohne initialisierte Kampagne bleibt der normale Vertrag unverändert. Sobald
 * die 85er-Allowlist existiert, kann ein darin enthaltenes B ausschließlich
 * als aktuell seriell aktives Scope-Objekt gelöscht werden.
 */
export function createRegression85DeleteMutationGuard(campaignStore) {
  return Object.freeze({
    async assert(input = {}) {
      const campaign = await campaignStore.load();
      if (campaign.valid !== true) return { guarded: false };
      assertRegression85Campaign(campaign);
      const sourceListingId = clean(input.sourceListingId, 200);
      const replacementListingId = clean(input.replacementListingId, 200);
      const scopeItem = campaign.scope.items.find((item) => item.regressionListingId === sourceListingId);
      const campaignOpen = new Set(["active", "paused"]).has(campaign.mode);
      if (!scopeItem) {
        if (campaignOpen) {
          throw serviceError("REGRESSION_85_FOREIGN_DELETE_BLOCKED", "Während der 85er-Reparatur ist ein DELETE außerhalb der Allowlist gesperrt.");
        }
        return { guarded: false };
      }
      const progress = campaign.progress.find((item) => item.scopeItemId === scopeItem.scopeItemId);
      if (
        !campaignOpen
        || campaign.activeScopeItemId !== scopeItem.scopeItemId
        || progress?.replacementListingId !== replacementListingId
        || rank(progress?.stage) < rank(REGRESSION_85_REPAIR_STAGES.REPLACEMENT_PUBLISHED)
        || rank(progress?.stage) >= rank(REGRESSION_85_REPAIR_STAGES.REPAIR_COMPLETED)
      ) {
        throw serviceError("REGRESSION_85_DELETE_SCOPE_BLOCKED", "Das Regression-DELETE gehört nicht zum aktuell seriell freigegebenen Repair-Lifecycle.");
      }
      return { guarded: true, campaignId: campaign.campaignId, scopeHash: campaign.scopeHash, scopeItemId: scopeItem.scopeItemId };
    },
  });
}
