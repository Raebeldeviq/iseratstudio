import { createUploadJobId } from "./batch-upload.mjs";
import { listingControl, normalizeListingGroup } from "./listing-groups.mjs";
import { PRODUCTION_DELETE_STATUS } from "./listing-rotation-production-delete.mjs";
import { normalizeWorkflowStatus, WORKFLOW_STATUS } from "./workflow-status.mjs";

export const ROTATION_LIFECYCLE_STAGE = Object.freeze({
  AWAITING_IMPORT_CONFIRMATION: "awaiting_import_confirmation",
  POST_IMPORT_PRE_DELETE: "post_import_pre_delete",
  AWAITING_DELETE_CONFIRMATION: "awaiting_delete_confirmation",
  COMPLETED: "completed",
});

export const DEFAULT_ROTATION_LIFECYCLE_POLL_INTERVAL_MS = 5 * 60 * 1000;
export const DEFAULT_IMPORT_CONFIRMATION_TIMEOUT_MS = 30 * 60 * 1000;
export const DEFAULT_DELETE_CONFIRMATION_TIMEOUT_MS = 30 * 60 * 1000;

const ACTIVE_UPLOAD_STATUSES = new Set([WORKFLOW_STATUS.PROCESSING]);
const OPEN_DELETE_STATUSES = new Set([
  PRODUCTION_DELETE_STATUS.PREPARED,
  PRODUCTION_DELETE_STATUS.PROCESSING,
  PRODUCTION_DELETE_STATUS.PENDING_CONFIRMATION,
  PRODUCTION_DELETE_STATUS.TRANSFER_UNCERTAIN,
]);

function lifecycleError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function boundedMilliseconds(value, fallback, minimum = 1) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= minimum ? Math.trunc(numeric) : fallback;
}

function defaultSleep(milliseconds) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref?.();
  });
}

function clean(value, maximum = 500) {
  return String(value ?? "").trim().slice(0, maximum);
}

function pairFor(state, input) {
  const project = (state.projects || []).find((candidate) => candidate.id === input.projectId);
  const source = project?.listings?.find((candidate) => candidate.id === input.sourceListingId);
  const replacement = project?.listings?.find((candidate) => candidate.id === input.replacementListingId);
  if (
    !project
    || !source
    || !replacement
    || replacement.rotationSourceListingId !== source.id
    || replacement.listingOrigin !== "rotation-copy"
  ) {
    throw lifecycleError(
      "ROTATION_LIFECYCLE_RELATION_MISMATCH",
      "Die serielle Lifecycle-Barriere besitzt keine eindeutige Source-/Replacement-Beziehung.",
    );
  }
  return { project, source, replacement };
}

function exactPositiveImportReport(state, project, source, replacement) {
  return (state.importReports || []).find((report) =>
    report.reportId === replacement.importReportId
    && report.processingStatus === "confirmed"
    && report.importResult === "success"
    && report.projectId === project.id
    && report.sourceListingId === source.id
    && report.matchedListingId === replacement.id
    && report.externalObjectNumber === replacement.externalId);
}

function exactPositiveDeleteReport(state, source, replacement) {
  return (state.deleteReports || []).find((report) =>
    report.deleteJobId === source.deleteJobId
    && report.sourceListingId === source.id
    && report.replacementListingId === replacement.id
    && report.externalObjectNumber === source.externalId
    && report.result === "success");
}

function importConfirmed(state, input) {
  const { project, source, replacement } = pairFor(state, input);
  const lifecycle = replacement.productionLifecycle;
  const report = exactPositiveImportReport(state, project, source, replacement);
  const confirmed = Boolean(
    normalizeWorkflowStatus(replacement.status) === WORKFLOW_STATUS.PUBLISHED
    && replacement.importConfirmedAt
    && replacement.importReportId
    && report
    && source.supersededByListingId === replacement.id
    && source.externalDeletionPending === true
    && source.productionDeleteState === "authorized"
    && lifecycle?.format === 1
    && lifecycle.automaticDeleteAuthorized === true
    && lifecycle.sourceListingId === source.id
    && lifecycle.schedulerRunId === source.productionRotationRunId
  );
  return { confirmed, project, source, replacement, report };
}

function deletionConfirmed(state, input) {
  const { project, source, replacement } = pairFor(state, input);
  const report = exactPositiveDeleteReport(state, source, replacement);
  const confirmed = Boolean(
    normalizeWorkflowStatus(replacement.status) === WORKFLOW_STATUS.PUBLISHED
    && replacement.importConfirmedAt
    && normalizeWorkflowStatus(source.status) === WORKFLOW_STATUS.DELETED
    && source.externalDeletionPending === false
    && source.productionDeleteState === "confirmed"
    && source.deleteConfirmedAt
    && source.deleteReportHash
    && report
  );
  return { confirmed, project, source, replacement, report };
}

function lifecycleIsOpen(project, replacement) {
  if (replacement.listingOrigin !== "rotation-copy" || replacement.productionLifecycle?.format !== 1) return false;
  const source = project.listings.find((candidate) => candidate.id === replacement.rotationSourceListingId);
  if (!source) return false;
  if (normalizeWorkflowStatus(source.status) === WORKFLOW_STATUS.DELETED) {
    return replacement.productionLifecycle?.lifecycleStage !== ROTATION_LIFECYCLE_STAGE.COMPLETED;
  }
  const replacementStatus = normalizeWorkflowStatus(replacement.status, WORKFLOW_STATUS.PREPARED);
  return replacementStatus === WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT
    || Boolean(replacement.importConfirmedAt)
    || source.externalDeletionPending === true
    || new Set(["authorized", "pending_confirmation", "transfer_uncertain"]).has(source.productionDeleteState);
}

export function openProductionRotationLifecycles(state) {
  return (state.projects || []).flatMap((project) => (project.listings || [])
    .filter((replacement) => lifecycleIsOpen(project, replacement))
    .map((replacement) => {
      const source = project.listings.find((candidate) => candidate.id === replacement.rotationSourceListingId);
      return {
        projectId: project.id,
        sourceListingId: source?.id || "",
        sourceExternalId: source?.externalId || "",
        replacementListingId: replacement.id,
        replacementExternalId: replacement.externalId || "",
        lifecycleStage: replacement.productionLifecycle?.lifecycleStage || "",
      };
    }));
}

function updateReplacementLifecycle(state, input, patch, now) {
  const { project, replacement } = pairFor(state, input);
  const updatedReplacement = {
    ...replacement,
    productionLifecycle: {
      ...replacement.productionLifecycle,
      lifecycleIndex: input.lifecycleIndex,
      lifecycleStage: patch.lifecycleStage || replacement.productionLifecycle?.lifecycleStage || "",
      lifecycleStartedAt: replacement.productionLifecycle?.lifecycleStartedAt || input.lifecycleStartedAt || now,
      lifecycleUpdatedAt: now,
      ...patch,
    },
  };
  const group = normalizeListingGroup(project.listingGroup, project.id, { now });
  const updatedGroup = {
    ...group,
    variants: group.variants.map((variant) => variant.listing?.id === replacement.id
      ? { ...variant, listing: updatedReplacement, updatedAt: now }
      : variant),
  };
  return {
    ...state,
    projects: state.projects.map((candidate) => candidate.id === project.id
      ? {
          ...project,
          listings: project.listings.map((listing) => listing.id === replacement.id ? updatedReplacement : listing),
          listingGroup: updatedGroup,
        }
      : candidate),
  };
}

function fatalImportResult(result, externalObjectNumber) {
  if (result?.errorCode) {
    return lifecycleError(
      result.errorCode,
      result.reason || "Die Importberichtprüfung ist fehlgeschlagen.",
      { externalObjectNumber },
    );
  }
  const rejected = (result?.processed || []).find((entry) =>
    entry.externalObjectNumber === externalObjectNumber
    && !new Set(["confirmed", "idempotent", "not-canary-authorized"]).has(entry.status));
  return rejected
    ? lifecycleError(
        rejected.errorCode || "ROTATION_IMPORT_REPORT_REJECTED",
        rejected.reason || "Der konkrete Importbericht wurde nicht eindeutig bestätigt.",
        { externalObjectNumber, status: rejected.status },
      )
    : null;
}

function fatalDeleteResult(result, sourceExternalId) {
  if ((result?.errors || []).length) {
    const first = result.errors[0];
    return lifecycleError(
      "ROTATION_DELETE_TRANSFER_FAILED",
      first.message || "Der Production-DELETE ist fehlgeschlagen.",
      { sourceExternalId },
    );
  }
  if (result?.ran === false && !new Set(["production-delete-run-in-progress"]).has(result.reason)) {
    return lifecycleError(
      "ROTATION_DELETE_SERVICE_BLOCKED",
      result.reason || "Der Production-DELETE-Dienst ist fail-closed gesperrt.",
      { sourceExternalId },
    );
  }
  return null;
}

export function createProductionRotationLifecycleCoordinator(options) {
  if (!options?.store?.load || !options?.store?.update) throw new Error("Der Lifecycle-Barriere fehlt der persistente Katalogspeicher.");
  if (!options?.importReportService?.runOnce) throw new Error("Der Lifecycle-Barriere fehlt der bestehende Importberichtdienst.");
  if (!options?.productionDeleteService?.runOnce) throw new Error("Der Lifecycle-Barriere fehlt der bestehende Production-DELETE-Dienst.");
  if (!options?.productionDeleteModeStore?.load) throw new Error("Der Lifecycle-Barriere fehlt der persistente Production-DELETE-Modus.");
  if (!options?.uploadJobLedger?.read || !options?.productionDeleteLedger?.read) throw new Error("Der Lifecycle-Barriere fehlen die bestehenden Upload-/DELETE-Ledger.");

  const pollIntervalMs = boundedMilliseconds(
    options.pollIntervalMs,
    DEFAULT_ROTATION_LIFECYCLE_POLL_INTERVAL_MS,
  );
  const importTimeoutMs = boundedMilliseconds(
    options.importTimeoutMs,
    DEFAULT_IMPORT_CONFIRMATION_TIMEOUT_MS,
  );
  const deleteTimeoutMs = boundedMilliseconds(
    options.deleteTimeoutMs,
    DEFAULT_DELETE_CONFIRMATION_TIMEOUT_MS,
  );
  const clock = options.clock || (() => Date.now());
  const now = options.now || (() => new Date(clock()).toISOString());
  const sleep = options.sleep || defaultSleep;
  const writeLog = options.writeLog || (async () => undefined);

  async function markStage(input, lifecycleStage, patch = {}) {
    const at = now();
    await options.store.update((state) => ({
      state: updateReplacementLifecycle(state, input, {
        lifecycleStage,
        lifecycleLastError: "",
        effectiveMaxRunItems: input.effectiveMaxRunItems,
        overrideId: input.overrideId || "",
        ...patch,
      }, at),
    }), { now: at });
    await writeLog("lifecycle-stage", {
      schedulerRunId: input.schedulerRunId,
      productionSchedulerRunId: input.productionSchedulerRunId,
      rotationId: input.replacementListingId,
      lifecycleIndex: input.lifecycleIndex,
      lifecycleStage,
      startedAt: input.lifecycleStartedAt,
      effectiveMaxRunItems: input.effectiveMaxRunItems,
      overrideId: input.overrideId || null,
      ...patch,
    });
    return at;
  }

  async function markFailure(input, error, lifecycleStage) {
    const at = now();
    await options.store.update((state) => ({
      state: updateReplacementLifecycle(state, input, {
        lifecycleStage,
        lifecycleLastError: clean(error?.message || "Lifecycle fehlgeschlagen."),
        lifecycleErrorCode: clean(error?.code || "ROTATION_LIFECYCLE_FAILED", 120),
        lifecycleFailedAt: at,
      }, at),
    }), { now: at }).catch(() => undefined);
    await writeLog("lifecycle-failed", {
      schedulerRunId: input.schedulerRunId,
      productionSchedulerRunId: input.productionSchedulerRunId,
      rotationId: input.replacementListingId,
      lifecycleIndex: input.lifecycleIndex,
      lifecycleStage,
      effectiveMaxRunItems: input.effectiveMaxRunItems,
      overrideId: input.overrideId || null,
      errorCode: clean(error?.code || "ROTATION_LIFECYCLE_FAILED", 120),
      message: clean(error?.message || "Lifecycle fehlgeschlagen."),
      failedAt: at,
      durationMs: Math.max(0, clock() - input.lifecycleStartedAtMs),
      finalResult: "failed",
    }).catch(() => undefined);
  }

  async function heartbeat(input) {
    await input.heartbeat?.({ now: now() });
  }

  async function waitForImport(input) {
    const deadline = clock() + importTimeoutMs;
    while (true) {
      await heartbeat(input);
      const snapshot = await options.store.load();
      const current = importConfirmed(snapshot.state, input);
      if (current.confirmed) return current;
      const result = await options.importReportService.runOnce({
        trigger: "scheduler-lifecycle",
        allowedExternalObjectNumbers: [current.replacement.externalId],
      });
      const failure = fatalImportResult(result, current.replacement.externalId);
      if (failure) throw failure;
      const refreshed = await options.store.load();
      const confirmed = importConfirmed(refreshed.state, input);
      if (confirmed.confirmed) return confirmed;
      const remaining = deadline - clock();
      if (remaining <= 0) {
        throw lifecycleError(
          "ROTATION_IMPORT_CONFIRMATION_TIMEOUT",
          `Für ${confirmed.replacement.externalId} wurde innerhalb des sicheren Zeitlimits kein eindeutiger positiver Importbericht bestätigt.`,
          { timeoutMs: importTimeoutMs, externalObjectNumber: confirmed.replacement.externalId },
        );
      }
      await sleep(Math.min(pollIntervalMs, remaining));
    }
  }

  async function waitForDelete(input) {
    const deadline = clock() + deleteTimeoutMs;
    while (true) {
      await heartbeat(input);
      const snapshot = await options.store.load();
      const current = deletionConfirmed(snapshot.state, input);
      if (current.confirmed) return current;
      const result = await options.productionDeleteService.runOnce({
        trigger: "scheduler-lifecycle",
        targetExternalObjectNumber: current.source.externalId,
      });
      const failure = fatalDeleteResult(result, current.source.externalId);
      if (failure) throw failure;
      const refreshed = await options.store.load();
      const confirmed = deletionConfirmed(refreshed.state, input);
      if (confirmed.confirmed) return confirmed;
      const remaining = deadline - clock();
      if (remaining <= 0) {
        throw lifecycleError(
          "ROTATION_DELETE_CONFIRMATION_TIMEOUT",
          `Für ${confirmed.source.externalId} wurde innerhalb des sicheren Zeitlimits kein eindeutiger positiver Löschbericht bestätigt.`,
          { timeoutMs: deleteTimeoutMs, externalObjectNumber: confirmed.source.externalId },
        );
      }
      await sleep(Math.min(pollIntervalMs, remaining));
    }
  }

  async function verifyFinalCompletion(input) {
    const [snapshot, uploadLedger, deleteLedger] = await Promise.all([
      options.store.load(),
      options.uploadJobLedger.read(),
      options.productionDeleteLedger.read(),
    ]);
    const completion = deletionConfirmed(snapshot.state, input);
    if (!completion.confirmed) {
      throw lifecycleError("ROTATION_LIFECYCLE_FINAL_STATE_INVALID", "Die Rotation besitzt noch keinen final bestätigten Katalogzustand.");
    }
    const importReport = exactPositiveImportReport(
      snapshot.state,
      completion.project,
      completion.source,
      completion.replacement,
    );
    const uploadJobId = createUploadJobId(completion.project, completion.replacement);
    const uploadJobs = (uploadLedger.jobs || []).filter((job) => job.jobId === uploadJobId);
    const deleteJobs = (deleteLedger.jobs || []).filter((job) =>
      job.deleteJobId === completion.source.deleteJobId
      && job.sourceListingId === completion.source.id
      && job.replacementListingId === completion.replacement.id);
    const group = normalizeListingGroup(completion.project.listingGroup, completion.project.id);
    const sourceControl = listingControl(group, completion.source);
    const replacementControl = listingControl(group, completion.replacement);
    const reasons = [];
    if (!importReport) reasons.push("positive_import_report_missing");
    if (uploadJobs.length !== 1 || ACTIVE_UPLOAD_STATUSES.has(uploadJobs[0]?.status)) reasons.push("upload_job_not_terminal");
    if (deleteJobs.length !== 1 || deleteJobs[0]?.status !== PRODUCTION_DELETE_STATUS.CONFIRMED) reasons.push("delete_job_not_confirmed");
    if ((deleteLedger.jobs || []).some((job) =>
      (job.sourceListingId === completion.source.id || job.replacementListingId === completion.replacement.id)
      && OPEN_DELETE_STATUSES.has(job.status))) reasons.push("open_delete_job_present");
    if (sourceControl.processLease || replacementControl.processLease) reasons.push("catalog_process_lease_present");
    if (reasons.length) {
      throw lifecycleError(
        "ROTATION_LIFECYCLE_FINAL_PROOF_INCOMPLETE",
        `Die finale Lifecycle-Evidenz ist unvollständig: ${reasons.join(", ")}.`,
        { reasons },
      );
    }
    return { ...completion, importReport, uploadJob: uploadJobs[0], deleteJob: deleteJobs[0] };
  }

  async function recoverFinalizedLifecycles(state, inputValue = {}) {
    const recoveredAt = now();
    const candidates = (state.projects || []).flatMap((project) => (project.listings || [])
      .filter((replacement) => {
        if (
          replacement.listingOrigin !== "rotation-copy"
          || replacement.productionLifecycle?.format !== 1
          || replacement.productionLifecycle?.lifecycleStage === ROTATION_LIFECYCLE_STAGE.COMPLETED
        ) return false;
        const source = project.listings.find((candidate) => candidate.id === replacement.rotationSourceListingId);
        return normalizeWorkflowStatus(source?.status) === WORKFLOW_STATUS.DELETED;
      })
      .map((replacement) => ({
        schedulerRunId: clean(inputValue.schedulerRunId || `recovery:${replacement.id}`, 200),
        productionSchedulerRunId: clean(replacement.productionLifecycle.schedulerRunId, 200),
        projectId: project.id,
        sourceListingId: replacement.rotationSourceListingId,
        replacementListingId: replacement.id,
        lifecycleIndex: Math.max(1, Math.trunc(Number(replacement.productionLifecycle.lifecycleIndex) || 1)),
        lifecycleStartedAt: clean(
          replacement.productionLifecycle.lifecycleStartedAt
          || replacement.productionLifecycle.preparedAt
          || replacement.createdAt
          || recoveredAt,
          50,
        ),
        effectiveMaxRunItems: Math.max(
          1,
          Math.trunc(Number(
            replacement.productionLifecycle.effectiveMaxRunItems
            || replacement.productionLifecycle.batchOverrideMaxRunItems
            || 3,
          ) || 3),
        ),
        overrideId: clean(replacement.productionLifecycle.batchOverrideId, 200),
      })));
    for (const candidate of candidates) {
      let final;
      try {
        final = await verifyFinalCompletion(candidate);
      } catch (error) {
        await writeLog("lifecycle-recovery-blocked", {
          schedulerRunId: candidate.schedulerRunId,
          productionSchedulerRunId: candidate.productionSchedulerRunId,
          rotationId: candidate.replacementListingId,
          lifecycleIndex: candidate.lifecycleIndex,
          errorCode: clean(error?.code || "ROTATION_LIFECYCLE_RECOVERY_PROOF_INCOMPLETE", 120),
          message: clean(error?.message || "Die Recovery-Evidenz ist unvollständig."),
          recoveredAt,
        }).catch(() => undefined);
        throw lifecycleError(
          "ROTATION_LIFECYCLE_RECOVERY_PROOF_INCOMPLETE",
          "Eine final wirkende frühere Rotation besitzt keine vollständig verifizierbare Import-/DELETE-Evidenz; neue Rotationen bleiben gesperrt.",
          { replacementListingId: candidate.replacementListingId, causeCode: error?.code || "" },
        );
      }
      const startedMs = Date.parse(candidate.lifecycleStartedAt);
      const completedAt = clean(final.deleteJob.confirmedAt || recoveredAt, 50);
      const completedMs = Date.parse(completedAt);
      const durationMs = Number.isFinite(startedMs) && Number.isFinite(completedMs)
        ? Math.max(0, completedMs - startedMs)
        : 0;
      await markStage(candidate, ROTATION_LIFECYCLE_STAGE.COMPLETED, {
        importConfirmedAt: final.replacement.importConfirmedAt,
        publishedAt: final.replacement.importConfirmedAt,
        deleteTransferredAt: final.deleteJob.transferCompletedAt,
        deleteConfirmedAt: final.deleteJob.confirmedAt,
        completedAt,
        recoveredAt,
        durationMs,
        finalResult: "success",
      });
      await writeLog("lifecycle-recovered", {
        schedulerRunId: candidate.schedulerRunId,
        productionSchedulerRunId: candidate.productionSchedulerRunId,
        rotationId: candidate.replacementListingId,
        lifecycleIndex: candidate.lifecycleIndex,
        lifecycleStage: ROTATION_LIFECYCLE_STAGE.COMPLETED,
        completedAt,
        recoveredAt,
        durationMs,
        finalResult: "success",
      });
    }
    return candidates.length;
  }

  async function preflight(inputValue = {}) {
    const [mode, snapshot] = await Promise.all([
      options.productionDeleteModeStore.load(),
      options.store.load(),
    ]);
    if (mode.valid !== true || mode.mode !== "active") {
      return {
        ok: false,
        code: "ROTATION_LIFECYCLE_DELETE_MODE_OFF",
        reason: mode.fallbackReason || "Production-DELETE ist nicht aktiv; eine vollständig serielle Produktionsrotation darf nicht starten.",
      };
    }
    if (!snapshot?.stored || !snapshot.state) {
      return { ok: false, code: "ROTATION_LIFECYCLE_CATALOG_UNAVAILABLE", reason: "Der persistente Katalog ist nicht sicher lesbar." };
    }
    let currentState = snapshot.state;
    const recoveredCount = await recoverFinalizedLifecycles(currentState, inputValue);
    if (recoveredCount) currentState = (await options.store.load()).state;
    const open = openProductionRotationLifecycles(currentState);
    if (open.length) {
      return {
        ok: false,
        code: "ROTATION_LIFECYCLE_RECOVERY_PENDING",
        reason: `${open.length} frühere Produktions-Lifecycle-Kette(n) sind noch nicht final bestätigt; neue Rotationen bleiben gesperrt.`,
        open,
      };
    }
    return { ok: true, open: [], recoveredCount };
  }

  async function complete(inputValue = {}) {
    const lifecycleStartedAtMs = clock();
    const lifecycleStartedAt = clean(inputValue.lifecycleStartedAt || now(), 50);
    const input = {
      ...inputValue,
      schedulerRunId: clean(inputValue.schedulerRunId, 200),
      productionSchedulerRunId: clean(inputValue.productionSchedulerRunId || inputValue.schedulerRunId, 200),
      projectId: clean(inputValue.projectId, 200),
      sourceListingId: clean(inputValue.sourceListingId, 200),
      replacementListingId: clean(inputValue.replacementListingId, 200),
      lifecycleIndex: Math.max(1, Math.trunc(Number(inputValue.lifecycleIndex) || 1)),
      lifecycleStartedAt,
      lifecycleStartedAtMs,
      effectiveMaxRunItems: Math.max(1, Math.trunc(Number(inputValue.effectiveMaxRunItems) || 1)),
      overrideId: clean(inputValue.overrideId, 200),
    };
    if (!input.schedulerRunId || !input.projectId || !input.sourceListingId || !input.replacementListingId) {
      throw lifecycleError("ROTATION_LIFECYCLE_INPUT_INVALID", "Die Lifecycle-Barriere benötigt Schedulerlauf und eindeutige Listing-IDs.");
    }
    let stage = ROTATION_LIFECYCLE_STAGE.AWAITING_IMPORT_CONFIRMATION;
    try {
      const initial = await options.store.load();
      const pair = pairFor(initial.state, input);
      if (normalizeWorkflowStatus(pair.replacement.status) !== WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT) {
        throw lifecycleError("ROTATION_LIFECYCLE_TRANSFER_NOT_PERSISTED", "Die Lifecycle-Barriere startet erst nach persistiertem erfolgreichem FTPS-Transfer.");
      }
      if (pair.replacement.productionLifecycle?.schedulerRunId !== input.productionSchedulerRunId) {
        throw lifecycleError("ROTATION_LIFECYCLE_PROVENANCE_MISMATCH", "Die persistierte Produktionsprovenienz stimmt nicht mit der Lifecycle-Kette überein.");
      }
      const ftpsCompletedAt = clean(input.ftpsCompletedAt || pair.replacement.transferredAt || now(), 50);
      await markStage(input, stage, { ftpsCompletedAt });

      const imported = await waitForImport(input);
      stage = ROTATION_LIFECYCLE_STAGE.POST_IMPORT_PRE_DELETE;
      await markStage(input, stage, {
        importConfirmedAt: imported.replacement.importConfirmedAt,
        publishedAt: imported.replacement.importConfirmedAt,
      });

      stage = ROTATION_LIFECYCLE_STAGE.AWAITING_DELETE_CONFIRMATION;
      await markStage(input, stage);
      const deleted = await waitForDelete(input);
      const final = await verifyFinalCompletion(input);
      stage = ROTATION_LIFECYCLE_STAGE.COMPLETED;
      const completedAt = now();
      const durationMs = Math.max(0, clock() - lifecycleStartedAtMs);
      await markStage(input, stage, {
        deleteTransferredAt: final.deleteJob.transferCompletedAt,
        deleteConfirmedAt: final.deleteJob.confirmedAt,
        completedAt,
        durationMs,
        finalResult: "success",
      });
      return {
        ok: true,
        schedulerRunId: input.schedulerRunId,
        productionSchedulerRunId: input.productionSchedulerRunId,
        rotationId: input.replacementListingId,
        lifecycleIndex: input.lifecycleIndex,
        lifecycleStage: stage,
        startedAt: lifecycleStartedAt,
        ftpsCompletedAt,
        importConfirmedAt: imported.replacement.importConfirmedAt,
        publishedAt: imported.replacement.importConfirmedAt,
        deleteTransferredAt: final.deleteJob.transferCompletedAt,
        deleteConfirmedAt: final.deleteJob.confirmedAt,
        completedAt,
        durationMs,
        finalResult: "success",
        effectiveMaxRunItems: input.effectiveMaxRunItems,
        overrideId: input.overrideId || null,
        sourceExternalId: deleted.source.externalId,
        replacementExternalId: deleted.replacement.externalId,
      };
    } catch (error) {
      await markFailure(input, error, stage);
      throw error;
    }
  }

  return { preflight, complete };
}
