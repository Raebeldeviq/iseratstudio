import { createUploadJobId } from "./batch-upload.mjs";
import { assertCatalogProductionReady } from './listing-catalog-view.mjs';
import {
  listingControl,
  normalizeListingGroup,
  updateListingControl,
} from "./listing-groups.mjs";
import { MAX_SCHEDULER_LOGS, PROCESS_LEASE_MS } from "./listing-rules.mjs";
import { prepareListingRotationInState } from "./listing-rotation-engine.mjs";
import {
  claimSchedulerDailyRotationStart,
  normalizeListingScheduler,
  schedulerDueListings,
  schedulerWindowBlockReasons,
  selectSchedulerListings,
} from "./listing-scheduler.mjs";
import { LISTING_ROTATION_PRODUCTION_MAX_RUN_ITEMS } from "./listing-rotation-production-policy.mjs";
import { normalizeWorkflowStatus, WORKFLOW_STATUS } from "./workflow-status.mjs";
import { normalizeListingRotationOperatingMode } from "./listing-rotation-operating-mode.mjs";
import { verifyProductionRuntime } from "./helper-runtime-provenance.mjs";
import { updatePreparedCopyAfterUpload } from "./listing-transfer-state.mjs";

export { updatePreparedCopyAfterUpload } from "./listing-transfer-state.mjs";

const BATCH_OVERRIDE_MUTATING_TRIGGERS = new Set(["periodic", "manual-production-batch"]);

function uid() {
  return globalThis.crypto.randomUUID();
}

function stableHash(value) {
  let hash = 2_166_136_261;
  for (const character of String(value || "")) {
    hash ^= character.codePointAt(0) || 0;
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function automaticRotationCopyId(project, listing, groupValue, operationToken = "") {
  const control = listingControl(groupValue, listing);
  const cycle = String(operationToken || control.schedulerSelectionId || "")
    || control.lastSuccessAt
    || control.lastUpdatedAt
    || listing.lastUploadedAt
    || listing.createdAt
    || project.createdAt
    || "initial";
  return `rotation-${stableHash(project.id)}-${stableHash(listing.id)}-${stableHash(cycle)}-copy`;
}

export function reusableAutomaticRotationCopy(copy, source, schedulerRunId) {
  const resumableStatuses = new Set([
    WORKFLOW_STATUS.SCHEDULED,
    WORKFLOW_STATUS.PROCESSING,
    WORKFLOW_STATUS.PREPARED,
    WORKFLOW_STATUS.FAILED,
  ]);
  return Boolean(
    copy
    && source
    && copy.listingOrigin === "rotation-copy"
    && copy.rotationSourceListingId === source.id
    && copy.productionLifecycle?.schedulerRunId === schedulerRunId
    && resumableStatuses.has(normalizeWorkflowStatus(copy.status, WORKFLOW_STATUS.PREPARED)),
  );
}

function pendingRotationCopies(state) {
  const pendingStatuses = new Set([
    WORKFLOW_STATUS.SCHEDULED,
    WORKFLOW_STATUS.PROCESSING,
    WORKFLOW_STATUS.PREPARED,
    WORKFLOW_STATUS.FAILED,
  ]);
  return (state.projects || []).flatMap((project) => (project.listings || []).flatMap((listing) => {
    if (listing.listingOrigin !== "rotation-copy" || !listing.rotationSourceListingId || listing.rotationArchivedAt) return [];
    const status = normalizeWorkflowStatus(listing.status, WORKFLOW_STATUS.PREPARED);
    return pendingStatuses.has(status) ? [{ projectId: project.id, listingId: listing.id, sourceListingId: listing.rotationSourceListingId }] : [];
  }));
}

function canaryMatches(listing, allowedListingIds) {
  return allowedListingIds.has(String(listing?.id || ""))
    || allowedListingIds.has(String(listing?.externalId || ""));
}

function pendingAllowedByCanary(state, pending, allowedListingIds) {
  const project = state.projects.find((candidate) => candidate.id === pending.projectId);
  const copy = project?.listings.find((candidate) => candidate.id === pending.listingId);
  const source = project?.listings.find((candidate) => candidate.id === pending.sourceListingId);
  return canaryMatches(copy, allowedListingIds) || canaryMatches(source, allowedListingIds);
}

function skipRecord(state, projectId, listingId, reason) {
  const project = state.projects.find((candidate) => candidate.id === projectId);
  const listing = project?.listings.find((candidate) => candidate.id === listingId);
  return {
    projectId: String(projectId || ""),
    listingId: String(listingId || ""),
    externalId: String(listing?.externalId || ""),
    reason: String(reason || "Inserat wurde übersprungen."),
  };
}

function uniqueSkipRecords(records) {
  const seen = new Set();
  return records.filter((record) => {
    const key = `${record.projectId}:${record.listingId}:${record.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function loadOperatingMode(store) {
  if (!store?.load) return normalizeListingRotationOperatingMode(null);
  try {
    const loaded = await store.load();
    if (loaded?.valid === false && loaded?.mode === "off") return loaded;
    return normalizeListingRotationOperatingMode(loaded);
  } catch {
    return normalizeListingRotationOperatingMode(null, {
      fallbackReason: "Betriebsmodus-Konfiguration konnte nicht gelesen werden; fail-closed auf off.",
    });
  }
}

async function loadProductionPolicy(store) {
  if (!store?.load) {
    return {
      valid: false,
      maxRunItems: 0,
      startupCatchupMode: "detect-only",
      expectedRuntimeCommit: "",
      fallbackReason: "Produktions-Rollout-Policy fehlt; active ist fail-closed gesperrt.",
    };
  }
  try {
    return await store.load();
  } catch {
    return {
      valid: false,
      maxRunItems: 0,
      startupCatchupMode: "detect-only",
      expectedRuntimeCommit: "",
      fallbackReason: "Produktions-Rollout-Policy konnte nicht gelesen werden; active ist fail-closed gesperrt.",
    };
  }
}

function replaceProject(state, updatedProject) {
  return {
    ...state,
    projects: state.projects.map((project) => project.id === updatedProject.id ? updatedProject : project),
  };
}

function markProductionRotationCopy(
  state,
  projectId,
  copyId,
  sourceListingId,
  runId,
  at,
  effectiveMaxRunItems,
  batchOverride = null,
) {
  const project = state.projects.find((candidate) => candidate.id === projectId);
  const copy = project?.listings.find((candidate) => candidate.id === copyId);
  if (!project || !copy) throw new Error("Die Produktions-Rotationskopie ist nicht eindeutig vorhanden.");
  const markedCopy = {
    ...copy,
    productionLifecycle: {
      format: 1,
      schedulerRunId: runId,
      sourceListingId,
      automaticDeleteAuthorized: true,
      preparedAt: at,
      effectiveMaxRunItems,
      ...(batchOverride ? {
        batchOverrideId: batchOverride.overrideId,
        batchOverrideMaxRunItems: batchOverride.maxRunItems,
        runtimeCommit: batchOverride.expectedRuntimeCommit,
      } : {}),
    },
  };
  const group = normalizeListingGroup(project.listingGroup, project.id, { now: at });
  return replaceProject(state, {
    ...project,
    listings: project.listings.map((listing) => listing.id === copyId ? markedCopy : listing),
    listingGroup: {
      ...group,
      variants: group.variants.map((variant) => variant.listing?.id === copyId
        ? { ...variant, listing: markedCopy, updatedAt: at }
        : variant),
    },
  });
}

function recoverInterruptedState(state, at) {
  let changed = false;
  const projects = (state.projects || []).map((project) => {
    if (!project.listingGroup) return project;
    let group = normalizeListingGroup(project.listingGroup, project.id, { now: at });
    let groupChanged = false;
    for (const listing of project.listings || []) {
      const control = listingControl(group, listing);
      const status = normalizeWorkflowStatus(control.status, WORKFLOW_STATUS.DRAFT);
      if (![WORKFLOW_STATUS.SCHEDULED, WORKFLOW_STATUS.PROCESSING].includes(status)) continue;
      const startedAt = Date.parse(control.processLease?.startedAt || control.schedulerSelectedAt || "");
      if (Number.isFinite(startedAt) && Date.parse(at) - startedAt < PROCESS_LEASE_MS) continue;
      group = updateListingControl(group, listing, {
        status: listing.listingOrigin === "rotation-copy" ? WORKFLOW_STATUS.PREPARED : WORKFLOW_STATUS.PUBLISHED,
        statusMessage: listing.listingOrigin === "rotation-copy"
          ? "Nach Helper-Unterbrechung für erneuten Upload bereit"
          : "Veröffentlicht · unterbrochene Rotation wird erneut eingeplant",
        schedulerSelectionId: "",
        schedulerSelectedAt: "",
        processLease: null,
      }, { now: at });
      groupChanged = true;
    }
    if (!groupChanged) return project;
    changed = true;
    return {
      ...project,
      listings: project.listings.map((listing) => {
        const status = normalizeWorkflowStatus(listing.status, WORKFLOW_STATUS.DRAFT);
        if (listing.listingOrigin === "rotation-copy" && [WORKFLOW_STATUS.SCHEDULED, WORKFLOW_STATUS.PROCESSING].includes(status)) {
          return { ...listing, status: WORKFLOW_STATUS.PREPARED, statusMessage: "Nach Helper-Unterbrechung für erneuten Upload bereit" };
        }
        return listing;
      }),
      listingGroup: group,
    };
  });
  let scheduler = normalizeListingScheduler(state.scheduler, { now: at });
  const runs = scheduler.runs.map((run) => {
    if (normalizeWorkflowStatus(run.status) !== WORKFLOW_STATUS.PROCESSING || run.endedAt) return run;
    changed = true;
    return {
      ...run,
      endedAt: at,
      status: WORKFLOW_STATUS.FAILED,
      statusMessage: "Helper-Lauf wurde unterbrochen und beim Neustart wiederhergestellt",
      abortReason: "Helper-Unterbrechung vor Abschluss",
      error: run.error || "Der vorherige Helper-Prozess wurde vor Abschluss beendet.",
      errorCount: Math.max(1, Number(run.errorCount) || 0),
    };
  });
  if (runs.some((run, index) => run !== scheduler.runs[index])) scheduler = { ...scheduler, runs };
  return changed ? { ...state, projects, scheduler } : state;
}

function updateSourceControl(state, projectId, listingId, patch, at) {
  const project = state.projects.find((candidate) => candidate.id === projectId);
  const listing = project?.listings.find((candidate) => candidate.id === listingId);
  if (!project || !listing) return state;
  const group = updateListingControl(
    normalizeListingGroup(project.listingGroup, project.id, { now: at }),
    listing,
    patch,
    { now: at },
  );
  return replaceProject(state, { ...project, listingGroup: group });
}

function finalRunStatus(completed, failed, abortReason, operatingMode) {
  if (failed.length) return WORKFLOW_STATUS.FAILED;
  if (completed.length) {
    return operatingMode === "active"
      ? WORKFLOW_STATUS.PUBLISHED
      : WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT;
  }
  return abortReason ? WORKFLOW_STATUS.BLOCKED : WORKFLOW_STATUS.PREPARED;
}

function hardSchedulerIssues(issues) {
  return issues.filter((issue) =>
    /nicht aktiviert|pausiert|modus ist gesperrt|zeitpunkt ist ungültig/iu.test(String(issue)));
}

export function createListingRotationSchedulerService(options) {
  if (!options?.store?.load || !options?.store?.update) throw new Error("Dem Inserat-Scheduler fehlt der persistente Katalogspeicher.");
  if (!options?.lease?.acquire) throw new Error("Dem Inserat-Scheduler fehlt der persistente Lauf-Claim.");
  if (typeof options.upload !== "function") throw new Error("Dem Inserat-Scheduler fehlt die Upload-Jobübergabe.");
  const idFactory = options.idFactory || uid;
  const writeRunLog = options.writeRunLog || (async () => undefined);

  async function inspectRuntimeOwnership(productionPolicy) {
    if (!options.runtimeOwnershipGuard?.inspect) {
      return {
        valid: false,
        fallbackReason: "Der produktiven Inseratrotation fehlt der verpflichtende Runtime-Ownership-Guard.",
      };
    }
    try {
      return await options.runtimeOwnershipGuard.inspect(productionPolicy);
    } catch (error) {
      return {
        valid: false,
        fallbackReason: error instanceof Error
          ? error.message
          : "Der Runtime-Ownership-Guard konnte nicht sicher geprüft werden.",
      };
    }
  }

  async function finalizeRun(runId, details, at) {
    return options.store.update((state) => {
      const scheduler = normalizeListingScheduler(state.scheduler, { now: at });
      const runs = scheduler.runs.map((run) => run.id === runId ? { ...run, ...details } : run);
      const finalRun = runs.find((run) => run.id === runId);
      return {
        ...state,
        scheduler: {
          ...scheduler,
          runs: runs.slice(-MAX_SCHEDULER_LOGS),
          lastRunAt: at,
          nextRunAt: new Date(Date.parse(at) + scheduler.settings.minimumSpacingHours * 3600000).toISOString(),
          lastStatus: finalRun?.status || WORKFLOW_STATUS.FAILED,
          lastStatusMessage: finalRun?.statusMessage || "Scheduler-Lauf beendet",
          lastError: finalRun?.error || "",
          updatedAt: at,
        },
      };
    }, { now: at });
  }

  async function run(input = {}) {
    const startedAt = String(input.startedAt || input.now || new Date().toISOString());
    const stepTimestamp = () => String(input.stepNow?.() || input.now || new Date().toISOString());
    const runId = String(input.runId || idFactory());
    const trigger = String(input.trigger || "periodic");
    const operatingPolicy = await loadOperatingMode(options.operatingModeStore);
    if (operatingPolicy.mode !== 'off') {
      try { assertCatalogProductionReady((await options.store.load()).state); }
      catch (error) {
        await writeRunLog('aborted', { runId, trigger, startedAt, endedAt: startedAt, abortReason: error.message, errorCode: error.code, errorCount: 1 });
        return { ok:false, claimed:false, runId, abortReason:error.message, completedListingIds:[], failedListingIds:[] };
      }
    }
    let lease;
    try {
      lease = await options.lease.acquire({
        now: startedAt,
        token: runId,
        schedulerRunId: runId,
        ownerId: `listing-scheduler:${process.pid}`,
        ownerPid: process.pid,
        runtimeIdentity: String(options.helperIdentity
          || `${options.runtimeProvenance?.runtimeRelease || "runtime-unknown"}:${process.pid}`),
        assessStaleOwner: async (current) => {
          const snapshot = await options.store.load();
          if (!snapshot?.stored || !snapshot.state) {
            return {
              recoverable: false,
              reason: "Der persistente Katalogzustand des bisherigen Scheduler-Runs ist nicht lesbar.",
            };
          }
          const scheduler = normalizeListingScheduler(snapshot.state.scheduler, { now: startedAt });
          const previousRunId = String(current?.schedulerRunId || current?.token || "");
          const previousRun = scheduler.runs.find((candidate) => candidate.id === previousRunId);
          if (!previousRun) {
            return {
              recoverable: true,
              reason: "Owner-Prozess inaktiv, Lease abgelaufen und kein persistierter mutierender Scheduler-Run vorhanden.",
            };
          }
          const previousStatus = normalizeWorkflowStatus(previousRun.status, WORKFLOW_STATUS.FAILED);
          const interrupted = previousStatus === WORKFLOW_STATUS.PROCESSING && !previousRun.endedAt;
          const terminal = previousStatus !== WORKFLOW_STATUS.PROCESSING && Boolean(previousRun.endedAt);
          return {
            recoverable: interrupted || terminal,
            reason: interrupted
              ? "Owner-Prozess inaktiv und Lease abgelaufen; der persistierte unterbrochene Run wird nach dem neuen Claim idempotent recovered."
              : terminal
                ? "Owner-Prozess inaktiv, Lease abgelaufen und persistierter Scheduler-Run bereits terminal."
                : "Owner-Prozess inaktiv und Lease abgelaufen, aber der persistierte Scheduler-Run ist nicht eindeutig terminal oder unterbrochen.",
            persistentRunStatus: previousStatus,
            persistentRunEndedAt: String(previousRun.endedAt || ""),
          };
        },
      });
    } catch (error) {
      const abortReason = error instanceof Error ? error.message : "Scheduler-Claim fehlgeschlagen.";
      await writeRunLog("aborted", { runId, trigger, startedAt, endedAt: startedAt, abortReason, errorCount: 1 });
      return { ok: false, claimed: false, runId, abortReason, completedListingIds: [], failedListingIds: [] };
    }

    const operatingMode = operatingPolicy.mode;
    const operatingModeFallbackReason = operatingPolicy.fallbackReason || "";
    const productionPolicy = await loadProductionPolicy(options.productionPolicyStore);
    const runtimeGuard = verifyProductionRuntime(options.runtimeProvenance, productionPolicy);
    const productiveMode = operatingMode === "active" || operatingMode === "canary";
    const runtimeOwnership = productiveMode
      ? await inspectRuntimeOwnership(productionPolicy)
      : { valid: false, fallbackReason: "Betriebsmodus off; keine produktive Ownership-Prüfung erforderlich." };
    const productionPolicyBlocked = productiveMode && (
      productionPolicy.valid !== true
      || !Number.isInteger(productionPolicy.maxRunItems)
      || productionPolicy.maxRunItems < 1
      || productionPolicy.maxRunItems > LISTING_ROTATION_PRODUCTION_MAX_RUN_ITEMS
    );
    const runtimeGuardBlocked = productiveMode && runtimeGuard.valid !== true;
    const runtimeOwnershipBlocked = productiveMode && runtimeOwnership.valid !== true;
    const lifecycleCoordinatorBlocked = operatingMode === "active" && (
      typeof options.lifecycleCoordinator?.preflight !== "function"
      || typeof options.lifecycleCoordinator?.complete !== "function"
    );
    let lifecyclePreflightAbortReason = "";
    let lifecyclePreflightCode = "";
    if (operatingMode === "active" && !lifecycleCoordinatorBlocked && !productionPolicyBlocked && !runtimeGuardBlocked && !runtimeOwnershipBlocked) {
      try {
        const lifecyclePreflight = await options.lifecycleCoordinator.preflight({
          schedulerRunId: runId,
          trigger,
          now: startedAt,
        });
        if (lifecyclePreflight?.ok !== true) {
          lifecyclePreflightCode = String(lifecyclePreflight?.code || "ROTATION_LIFECYCLE_PREFLIGHT_BLOCKED");
          lifecyclePreflightAbortReason = String(
            lifecyclePreflight?.reason
            || "Die serielle Produktions-Lifecycle-Barriere ist fail-closed gesperrt.",
          );
        }
      } catch (error) {
        lifecyclePreflightCode = String(error?.code || "ROTATION_LIFECYCLE_PREFLIGHT_FAILED");
        lifecyclePreflightAbortReason = error instanceof Error
          ? error.message
          : "Die serielle Produktions-Lifecycle-Barriere konnte nicht sicher vorgeprüft werden.";
      }
    } else if (lifecycleCoordinatorBlocked) {
      lifecyclePreflightCode = "ROTATION_LIFECYCLE_COORDINATOR_MISSING";
      lifecyclePreflightAbortReason = "Der produktiven Inseratrotation fehlt die verpflichtende serielle End-to-End-Lifecycle-Barriere.";
    }
    let activeRunLimit = operatingMode === "active" && productionPolicy.valid === true
      ? Math.max(0, Math.trunc(Number(productionPolicy.maxRunItems)))
      : Number.POSITIVE_INFINITY;
    let batchOverride = null;
    let batchOverrideAbortReason = "";

    if (
      operatingMode === "active"
      && !productionPolicyBlocked
      && !runtimeGuardBlocked
      && !runtimeOwnershipBlocked
      && !lifecyclePreflightAbortReason
      && options.batchOverrideStore?.load
      && options.batchOverrideStore?.claim
      && BATCH_OVERRIDE_MUTATING_TRIGGERS.has(trigger)
    ) {
      try {
        const overrideStatus = await options.batchOverrideStore.load({ now: startedAt });
        if (overrideStatus.valid !== true) {
          batchOverrideAbortReason = overrideStatus.fallbackReason
            || "One-Shot-Produktionsoverride ist nicht sicher lesbar.";
        } else if (overrideStatus.state === "armed") {
          const snapshot = await options.store.load();
          if (snapshot?.stored && snapshot.state) {
            const scheduler = normalizeListingScheduler(snapshot.state.scheduler, { now: startedAt });
            const windowIssues = schedulerWindowBlockReasons(scheduler, startedAt, {
              ignoreTimeWindow: false,
            });
            const pending = pendingRotationCopies(snapshot.state);
            const selection = windowIssues.length
              ? { selections: [] }
              : selectSchedulerListings({ ...snapshot.state, scheduler }, startedAt, {
                  ignoreTimeWindow: false,
                  maximumSelections: Math.max(0, overrideStatus.maxRunItems - pending.length),
                });
            if (!windowIssues.length && selection.selections.length) {
              const claim = await options.batchOverrideStore.claim({
                schedulerRunId: runId,
                runningRuntimeCommit: runtimeGuard.runtimeCommit,
                now: startedAt,
              });
              if (claim.blocking) {
                batchOverrideAbortReason = claim.reason === "runtime_mismatch"
                  ? "One-Shot-Produktionsoverride gesperrt: Runtime-Commit stimmt nicht mit der Freigabe überein."
                  : String(claim.reason || "One-Shot-Produktionsoverride ist gesperrt.");
              } else if (claim.claimed && claim.record) {
                batchOverride = claim.record;
                activeRunLimit = claim.record.maxRunItems;
              }
            }
          }
        }
      } catch (error) {
        batchOverrideAbortReason = error instanceof Error
          ? error.message
          : "Der One-Shot-Produktionsoverride konnte nicht sicher vorgeprüft oder atomar beansprucht werden.";
      }
    }

    const effectiveIgnoreTimeWindow = batchOverride || trigger === "manual-production-batch"
      ? false
      : input.ignoreTimeWindow === true;

    const completedListingIds = [];
    const failedListingIds = [];
    const errors = [];
    let selectedListingIds = [];
    let resumedListingIds = [];
    let dueCount = 0;
    let skippedCount = 0;
    let skippedListings = [];
    let abortReason = "";
    let startedRotationCount = 0;
    let failedLifecycleIndex = null;
    let batchEndState = "claimed";
    try {
      await writeRunLog("started", {
        runId,
        trigger,
        startedAt,
        operatingMode,
        operatingModeFallbackReason,
        productionPolicyValid: productionPolicy.valid === true,
        productionPolicyFallbackReason: productionPolicy.fallbackReason || "",
        maxRunItems: Number.isFinite(activeRunLimit) ? activeRunLimit : null,
        effectiveMaxRunItems: Number.isFinite(activeRunLimit) ? activeRunLimit : null,
        overrideId: batchOverride?.overrideId || null,
        overrideClaimedAt: batchOverride?.claimedAt || "",
        startupCatchupMode: productionPolicy.startupCatchupMode || "detect-only",
        lifecycleContract: operatingMode === "active" ? "serial-end-to-end-v1" : "not-required",
        lifecyclePreflightCode,
        lifecyclePreflightAbortReason,
        canaryListingIds: operatingMode === "canary" ? operatingPolicy.canaryListingIds : [],
        ...runtimeGuard,
        runtimeOwnershipValid: runtimeOwnership.valid,
        runtimeOwnershipFallbackReason: runtimeOwnership.fallbackReason || "",
        runtimePortOwnerPids: runtimeOwnership.portOwnerPids || [],
        runtimeHelperProcessPids: runtimeOwnership.helperProcessPids || [],
      });
      await lease.refresh?.({ now: startedAt });
      const initialized = await options.store.update((rawState) => {
        const state = recoverInterruptedState(rawState, startedAt);
        const scheduler = normalizeListingScheduler(state.scheduler, { now: startedAt });
        const windowIssues = schedulerWindowBlockReasons(scheduler, startedAt, {
          ignoreTimeWindow: effectiveIgnoreTimeWindow,
        });
        const due = schedulerDueListings({ ...state, scheduler }, startedAt);
        const allPending = pendingRotationCopies(state);
        const allowedListingIds = new Set(operatingPolicy.canaryListingIds || []);
        const pending = operatingMode === "active"
          ? allPending
          : operatingMode === "canary"
            ? allPending.filter((item) => pendingAllowedByCanary(state, item, allowedListingIds))
            : [];
        const policySkipped = [];
        if (operatingMode === "off") {
          const reason = operatingModeFallbackReason
            || "Globaler Betriebsmodus off: Erkennung und Protokollierung erlaubt, Rotation und FTPS gesperrt.";
          policySkipped.push(...due.map((item) => skipRecord(state, item.projectId, item.listingId, reason)));
          policySkipped.push(...allPending.map((item) => skipRecord(state, item.projectId, item.listingId, reason)));
        } else if (operatingMode === "canary") {
          const reason = "Globaler Betriebsmodus canary: Dieses Inserat ist nicht explizit freigegeben.";
          policySkipped.push(...due
            .filter((item) => {
              const project = state.projects.find((candidate) => candidate.id === item.projectId);
              const listing = project?.listings.find((candidate) => candidate.id === item.listingId);
              return !canaryMatches(listing, allowedListingIds);
            })
            .map((item) => skipRecord(state, item.projectId, item.listingId, reason)));
          policySkipped.push(...allPending
            .filter((item) => !pendingAllowedByCanary(state, item, allowedListingIds))
            .map((item) => skipRecord(state, item.projectId, item.listingId, reason)));
        }
        const pendingLimitExceeded = operatingMode === "active" && pending.length > activeRunLimit;
        const blockingIssues = pending.length ? hardSchedulerIssues(windowIssues) : windowIssues;
        const selection = operatingMode === "off" || productionPolicyBlocked || runtimeGuardBlocked || runtimeOwnershipBlocked || lifecyclePreflightAbortReason || batchOverrideAbortReason || pendingLimitExceeded || blockingIssues.length || windowIssues.length
          ? { selections: [], skipped: [], issues: windowIssues, scheduler }
          : selectSchedulerListings({ ...state, scheduler }, startedAt, {
              ignoreTimeWindow: effectiveIgnoreTimeWindow,
              ...(operatingMode === "canary" ? { allowedListingIds } : {}),
              ...(operatingMode === "active" ? { maximumSelections: Math.max(0, activeRunLimit - pending.length) } : {}),
            });
        dueCount = due.length;
        const dueListingKeys = new Set(due.map((item) => `${item.projectId}:${item.listingId}`));
        const selectionSkipRecords = selection.skipped
          .filter((item) => {
            if (operatingMode !== "canary") return true;
            if (!dueListingKeys.has(`${item.projectId}:${item.listingId}`)) return false;
            const project = state.projects.find((candidate) => candidate.id === item.projectId);
            const listing = project?.listings.find((candidate) => candidate.id === item.listingId);
            return canaryMatches(listing, allowedListingIds);
          })
          .map((item) => skipRecord(state, item.projectId, item.listingId, item.reasons.join(" · ")));
        const selectedKeys = new Set(selection.selections.map((item) => `${item.project.id}:${item.listing.id}`));
        const productionLimitReached = operatingMode === "active"
          && Number.isFinite(activeRunLimit)
          && !productionPolicyBlocked
          && !pendingLimitExceeded
          && !blockingIssues.length
          && !windowIssues.length
          && selection.selections.length + pending.length >= activeRunLimit;
        const productionLimitSkips = productionLimitReached
          ? due
              .filter((item) => !selectedKeys.has(`${item.projectId}:${item.listingId}`))
              .map((item) => skipRecord(
                state,
                item.projectId,
                item.listingId,
                `Produktionslimit maxRunItems=${activeRunLimit}: in diesem Schedulerlauf nicht ausgewählt.`,
              ))
          : [];
        skippedListings = uniqueSkipRecords([...policySkipped, ...selectionSkipRecords, ...productionLimitSkips]);
        skippedCount = skippedListings.length;
        selectedListingIds = selection.selections.map((item) => item.listing.id);
        resumedListingIds = pending.map((item) => item.listingId);
        if (operatingMode === "off") {
          abortReason = operatingModeFallbackReason
            || "Globaler Betriebsmodus off: keine Rotationskopie und kein FTPS-Auftrag zulässig.";
        } else if (productionPolicyBlocked) {
          abortReason = productionPolicy.fallbackReason || "Produktions-Rollout-Policy ist ungültig; active ist fail-closed gesperrt.";
        } else if (runtimeGuardBlocked) {
          abortReason = runtimeGuard.fallbackReason;
        } else if (runtimeOwnershipBlocked) {
          abortReason = runtimeOwnership.fallbackReason;
        } else if (lifecyclePreflightAbortReason) {
          abortReason = lifecyclePreflightAbortReason;
        } else if (batchOverrideAbortReason) {
          abortReason = batchOverrideAbortReason;
        } else if (pendingLimitExceeded) {
          abortReason = `Es existieren ${pending.length} fortzusetzende Rotationen; das Produktionslimit maxRunItems=${activeRunLimit} wird fail-closed nicht überschritten.`;
        } else if (blockingIssues.length) abortReason = blockingIssues.join(" · ");
        else if (!selectedListingIds.length && !resumedListingIds.length) {
          abortReason = operatingMode === "canary" && dueCount
            ? "Canary-Modus: Kein explizit freigegebenes fälliges Inserat verfügbar."
            : dueCount
            ? "Alle fälligen Inserate sind fachlich blockiert oder bereits in Bearbeitung."
            : "Keine fälligen oder fortzusetzenden Inserate vorhanden.";
        }

        let nextState = { ...state, scheduler };
        for (const selectionItem of selection.selections) {
          nextState = updateSourceControl(nextState, selectionItem.project.id, selectionItem.listing.id, {
            status: WORKFLOW_STATUS.SCHEDULED,
            statusMessage: "Vom Background-Helper für Rotation eingeplant",
            schedulerSelectionId: runId,
            schedulerSelectedAt: startedAt,
            processLease: null,
          }, startedAt);
        }
        const log = {
          id: runId,
          timestamp: startedAt,
          startedAt,
          endedAt: "",
          trigger,
          operatingMode,
          operatingModeFallbackReason,
          productionPolicyValid: productionPolicy.valid === true,
          productionPolicyFallbackReason: productionPolicy.fallbackReason || "",
          runtimeCommit: runtimeGuard.runtimeCommit,
          expectedProductionCommit: runtimeGuard.expectedProductionCommit,
          runtimeRelease: runtimeGuard.runtimeRelease,
          runtimeGuardValid: runtimeGuard.valid,
          lifecycleContract: operatingMode === "active" ? "serial-end-to-end-v1" : "not-required",
          lifecyclePreflightCode,
          dailyBudgetVersion: 1,
          maxRunItems: Number.isFinite(activeRunLimit) ? activeRunLimit : null,
          effectiveMaxRunItems: Number.isFinite(activeRunLimit) ? activeRunLimit : null,
          overrideId: batchOverride?.overrideId || null,
          overrideClaimedAt: batchOverride?.claimedAt || "",
          startupCatchupMode: productionPolicy.startupCatchupMode || "detect-only",
          mode: scheduler.settings.mode,
          selectedListingIds,
          resumedListingIds,
          completedListingIds: [],
          failedListingIds: [],
          dueCount,
          selectedCount: selectedListingIds.length,
          skippedCount,
          skippedListings,
          errorCount: 0,
          abortReason,
          status: WORKFLOW_STATUS.PROCESSING,
          statusMessage: "Background-Helper verarbeitet den Scheduler-Lauf",
          error: "",
        };
        nextState = {
          ...nextState,
          scheduler: {
            ...normalizeListingScheduler(nextState.scheduler, { now: startedAt }),
            runs: [...normalizeListingScheduler(nextState.scheduler, { now: startedAt }).runs, log].slice(-MAX_SCHEDULER_LOGS),
            lastStatus: WORKFLOW_STATUS.PROCESSING,
            lastStatusMessage: log.statusMessage,
            lastError: "",
            updatedAt: startedAt,
          },
        };
        return { state: nextState, result: { pending, selection } };
      }, { now: startedAt });

      if (abortReason) {
        const endedAt = String(input.endNow || new Date().toISOString());
        const status = WORKFLOW_STATUS.BLOCKED;
        await finalizeRun(runId, {
          endedAt,
          status,
          statusMessage: abortReason,
          error: "",
          abortReason,
        }, endedAt);
        await writeRunLog("finished", {
          runId,
          trigger,
          startedAt,
          endedAt,
          operatingMode,
          operatingModeFallbackReason,
          dueCount,
          selectedCount: 0,
          skippedCount,
          skippedListings,
          errorCount: 0,
          abortReason,
          status,
          effectiveMaxRunItems: Number.isFinite(activeRunLimit) ? activeRunLimit : null,
          overrideId: batchOverride?.overrideId || null,
        });
        batchEndState = "blocked";
        return { ok: true, claimed: true, runId, operatingMode, operatingModeFallbackReason, effectiveMaxRunItems: Number.isFinite(activeRunLimit) ? activeRunLimit : null, overrideId: batchOverride?.overrideId || null, dueCount, selectedListingIds, resumedListingIds, completedListingIds, failedListingIds, skippedCount, skippedListings, abortReason };
      }

      const workItems = [
        ...initialized.result.pending.map((item) => ({ ...item, resume: true })),
        ...initialized.result.selection.selections.map((item) => ({
          projectId: item.project.id,
          listingId: item.listing.id,
          sourceListingId: item.listing.id,
          resume: false,
        })),
      ];

      for (let itemIndex = 0; itemIndex < workItems.length; itemIndex += 1) {
        const item = workItems[itemIndex];
        const itemCheckAt = stepTimestamp();
        await lease.refresh?.({ now: itemCheckAt });
        if (!item.resume) {
          const boundarySnapshot = await options.store.load();
          assertCatalogProductionReady(boundarySnapshot?.state);
          if (!boundarySnapshot?.stored || !boundarySnapshot.state) {
            throw new Error("Der Katalog konnte vor dem Start der nächsten Rotation nicht sicher gelesen werden.");
          }
          const currentScheduler = normalizeListingScheduler(boundarySnapshot.state.scheduler, { now: itemCheckAt });
          const startIssues = schedulerWindowBlockReasons(currentScheduler, itemCheckAt, {
            ignoreTimeWindow: effectiveIgnoreTimeWindow,
          });
          if (startIssues.length) {
            const unstartedItems = workItems.slice(itemIndex).filter((candidate) => !candidate.resume);
            const stopReason = `Keine neue Rotation gestartet: ${startIssues.join(" · ")}`;
            skippedListings = uniqueSkipRecords([
              ...skippedListings,
              ...unstartedItems.map((candidate) => skipRecord(
                boundarySnapshot.state,
                candidate.projectId,
                candidate.sourceListingId,
                stopReason,
              )),
            ]);
            skippedCount = skippedListings.length;
            abortReason = stopReason;
            await options.store.update((state) => {
              let nextState = state;
              for (const candidate of unstartedItems) {
                nextState = updateSourceControl(nextState, candidate.projectId, candidate.sourceListingId, {
                  status: WORKFLOW_STATUS.PUBLISHED,
                  statusMessage: "Veröffentlicht · Rotation wegen geschlossenem Startfenster nicht begonnen",
                  schedulerSelectionId: "",
                  schedulerSelectedAt: "",
                  processLease: null,
                }, itemCheckAt);
              }
              return { state: nextState };
            }, { now: itemCheckAt });
            break;
          }
        }
        let copyId = item.resume ? item.listingId : "";
        let sourceListingId = item.sourceListingId;
        let uploadPersisted = false;
        const lifecycleIndex = startedRotationCount + 1;
        try {
          if (operatingMode === "active") {
            const itemPreflight = await options.lifecycleCoordinator.preflight({
              schedulerRunId: runId,
              trigger: `${trigger}:before-lifecycle-${lifecycleIndex}`,
              now: itemCheckAt,
            });
            if (itemPreflight?.ok !== true) {
              const preflightError = new Error(
                itemPreflight?.reason
                || "Die serielle Produktions-Lifecycle-Barriere wurde vor der nächsten Rotation gesperrt.",
              );
              preflightError.code = itemPreflight?.code || "ROTATION_LIFECYCLE_PREFLIGHT_BLOCKED";
              throw preflightError;
            }
          }
          if (!item.resume) {
            const budgetAt = stepTimestamp();
            const budgetClaim = await options.store.update((state) => claimSchedulerDailyRotationStart(state, {
              schedulerRunId: runId,
              projectId: item.projectId,
              sourceListingId,
              startedAt: budgetAt,
            }, { now: budgetAt }), { now: budgetAt });
            if (budgetClaim.result?.claimed !== true && budgetClaim.result?.idempotent !== true) {
              const budgetError = new Error("Das persistente Europe/Berlin-Tageslimit von 40 neuen Rotationen ist erreicht.");
              budgetError.code = "LISTING_ROTATION_DAILY_CAP_REACHED";
              throw budgetError;
            }
            await writeRunLog("daily-budget-claimed", {
              runId,
              trigger,
              projectId: item.projectId,
              sourceListingId,
              dayKey: budgetClaim.result.dayKey,
              used: budgetClaim.result.used,
              remaining: budgetClaim.result.remaining,
              idempotent: budgetClaim.result.idempotent === true,
            });
          }
          startedRotationCount += 1;
          if (!item.resume) {
            const processingAt = stepTimestamp();
            await options.store.update((state) => ({
              state: updateSourceControl(state, item.projectId, sourceListingId, {
                status: WORKFLOW_STATUS.PROCESSING,
                statusMessage: "Background-Helper erstellt die Rotationskopie",
                processLease: { token: runId, startedAt: processingAt },
              }, processingAt),
            }), { now: processingAt });

            const preparedAt = stepTimestamp();
            const prepared = await options.store.update((state) => {
              const project = state.projects.find((candidate) => candidate.id === item.projectId);
              const source = project?.listings.find((candidate) => candidate.id === sourceListingId);
              if (!project || !source) throw new Error("Das eingeplante Quellinserat ist nicht mehr vorhanden.");
              const group = normalizeListingGroup(project.listingGroup, project.id, { now: preparedAt });
              const deterministicCopyId = automaticRotationCopyId(project, source, group, runId);
              const existing = project.listings.find((listing) => listing.id === deterministicCopyId);
              if (existing) {
                if (reusableAutomaticRotationCopy(existing, source, runId)) {
                  return { state, result: { copy: existing } };
                }
                const collisionError = new Error("Eine vorhandene Rotationskopie besitzt keine fortsetzbare Provenienz für diesen Schedulerlauf.");
                collisionError.code = "AUTOMATIC_ROTATION_COPY_COLLISION";
                throw collisionError;
              }
              const result = prepareListingRotationInState(state, project.id, source.id, {
                now: preparedAt,
                mode: normalizeListingScheduler(state.scheduler, { now: preparedAt }).settings.mode,
                copyId: deterministicCopyId,
                operationToken: runId,
                uploadJobIdFor: createUploadJobId,
                seed: `${project.id}:${source.id}:${deterministicCopyId}`,
              });
              if (!result.ok || !result.copy) throw new Error(result.message || "Rotationskopie konnte nicht vorbereitet werden.");
              const nextState = operatingMode === "active"
                ? markProductionRotationCopy(
                    result.state,
                    project.id,
                    result.copy.id,
                    source.id,
                    runId,
                    preparedAt,
                    activeRunLimit,
                    batchOverride,
                  )
                : result.state;
              const nextProject = nextState.projects.find((candidate) => candidate.id === project.id);
              const nextCopy = nextProject?.listings.find((candidate) => candidate.id === result.copy.id);
              return { state: nextState, result: { copy: nextCopy || result.copy } };
            }, { now: preparedAt });
            copyId = prepared.result.copy.id;
          }

          const snapshot = await options.store.load();
          const project = snapshot.state?.projects.find((candidate) => candidate.id === item.projectId);
          const copy = project?.listings.find((candidate) => candidate.id === copyId);
          if (!project || !copy) throw new Error("Die vorbereitete Rotationskopie ist nicht mehr im Katalog vorhanden.");
          sourceListingId = copy.rotationSourceListingId || sourceListingId;
          const copyBatchOverrideId = String(copy.productionLifecycle?.batchOverrideId || "");
          const copyBatchSchedulerRunId = String(copy.productionLifecycle?.schedulerRunId || "");
          const copyBatchMaxRunItems = Math.max(0, Math.trunc(Number(copy.productionLifecycle?.batchOverrideMaxRunItems) || 0));
          const uploadResult = await options.upload({
            state: snapshot.state,
            project,
            listing: copy,
            runId,
            trigger,
            batchOverrideId: copyBatchOverrideId,
            batchSchedulerRunId: copyBatchOverrideId ? copyBatchSchedulerRunId : "",
            effectiveMaxRunItems: copyBatchOverrideId
              ? copyBatchMaxRunItems
              : productionPolicy.valid === true ? productionPolicy.maxRunItems : null,
          });
          const completedAt = stepTimestamp();
          await lease.refresh?.({ now: completedAt });
          await options.store.update((state) => ({
            state: updatePreparedCopyAfterUpload(state, project.id, copy.id, {
              ok: true,
              jobId: uploadResult.jobId || createUploadJobId(project, copy),
              runId,
            }, completedAt),
          }), { now: completedAt });
          uploadPersisted = true;
          if (operatingMode === "active") {
            const lifecycleResult = await options.lifecycleCoordinator.complete({
              schedulerRunId: runId,
              productionSchedulerRunId: copy.productionLifecycle?.schedulerRunId || runId,
              projectId: project.id,
              sourceListingId,
              replacementListingId: copy.id,
              lifecycleIndex,
              lifecycleStartedAt: itemCheckAt,
              ftpsCompletedAt: completedAt,
              effectiveMaxRunItems: copy.productionLifecycle?.effectiveMaxRunItems
                || copy.productionLifecycle?.batchOverrideMaxRunItems
                || activeRunLimit,
              overrideId: copy.productionLifecycle?.batchOverrideId || "",
              heartbeat: (details) => lease.refresh?.(details),
            });
            if (lifecycleResult?.ok !== true) {
              const lifecycleError = new Error("Die serielle Produktions-Lifecycle-Barriere lieferte keinen bestätigten Abschluss.");
              lifecycleError.code = "ROTATION_LIFECYCLE_NOT_COMPLETED";
              throw lifecycleError;
            }
          }
          completedListingIds.push(sourceListingId);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unbekannter Rotations- oder Uploadfehler";
          errors.push({ projectId: item.projectId, listingId: sourceListingId, copyId, message });
          failedListingIds.push(sourceListingId);
          failedLifecycleIndex = lifecycleIndex;
          abortReason = message;
          if (copyId && !uploadPersisted) {
            const failedAt = stepTimestamp();
            await options.store.update((state) => ({
              state: updatePreparedCopyAfterUpload(state, item.projectId, copyId, {
                ok: false,
                jobId: "",
                runId,
                error: message,
              }, failedAt),
            }), { now: failedAt }).catch(() => undefined);
          } else if (!copyId) {
            const failedAt = stepTimestamp();
            await options.store.update((state) => ({
              state: updateSourceControl(state, item.projectId, sourceListingId, {
                status: WORKFLOW_STATUS.PUBLISHED,
                statusMessage: "Veröffentlicht · Rotation fehlgeschlagen",
                schedulerSelectionId: "",
                schedulerSelectedAt: "",
                processLease: null,
                lastError: message,
              }, failedAt),
            }), { now: failedAt }).catch(() => undefined);
          }
          const unstartedSelections = workItems.slice(itemIndex + 1).filter((candidate) => !candidate.resume);
          if (unstartedSelections.length) {
            const releasedAt = stepTimestamp();
            await options.store.update((state) => {
              let nextState = state;
              for (const candidate of unstartedSelections) {
                nextState = updateSourceControl(nextState, candidate.projectId, candidate.sourceListingId, {
                  status: WORKFLOW_STATUS.PUBLISHED,
                  statusMessage: "Veröffentlicht · vorheriger Produktions-Lifecycle hat den Lauf gestoppt",
                  schedulerSelectionId: "",
                  schedulerSelectedAt: "",
                  processLease: null,
                }, releasedAt);
              }
              return { state: nextState };
            }, { now: releasedAt }).catch(() => undefined);
          }
          break;
        }
      }

      const endedAt = String(input.endNow || new Date().toISOString());
      const totalDuration = Math.max(0, Date.parse(endedAt) - Date.parse(startedAt));
      const status = finalRunStatus(completedListingIds, failedListingIds, abortReason, operatingMode);
      const statusMessage = failedListingIds.length
        ? `${completedListingIds.length} Lifecycle-Ketten vollständig bestätigt, Lifecycle ${failedLifecycleIndex || "?"} fehlgeschlagen`
        : abortReason
          ? `${completedListingIds.length} Lifecycle-Ketten vollständig bestätigt · ${abortReason}`
          : operatingMode === "active"
            ? `${completedListingIds.length} serielle Lifecycle-Ketten vollständig bestätigt`
            : `${completedListingIds.length} Rotationskopien übertragen · Importbestätigung ausstehend`;
      await finalizeRun(runId, {
        endedAt,
        completedListingIds,
        failedListingIds,
        errorCount: errors.length,
        status,
        statusMessage,
        error: errors.map((item) => item.message).join(" · "),
        errors,
        startedLifecycles: startedRotationCount,
        completedLifecycles: completedListingIds.length,
        failedLifecycleIndex,
        totalDuration,
      }, endedAt);
      await writeRunLog("finished", {
        runId,
        trigger,
        operatingMode,
        operatingModeFallbackReason,
        startedAt,
        endedAt,
        dueCount,
        selectedCount: selectedListingIds.length,
        resumedCount: resumedListingIds.length,
        skippedCount,
        skippedListings,
        completedCount: completedListingIds.length,
        startedLifecycles: startedRotationCount,
        completedLifecycles: completedListingIds.length,
        failedLifecycleIndex,
        totalDuration,
        errorCount: errors.length,
        abortReason,
        status,
        effectiveMaxRunItems: Number.isFinite(activeRunLimit) ? activeRunLimit : null,
        overrideId: batchOverride?.overrideId || null,
        errors,
      });
      batchEndState = status;
      return {
        ok: failedListingIds.length === 0,
        claimed: true,
        runId,
        operatingMode,
        operatingModeFallbackReason,
        effectiveMaxRunItems: Number.isFinite(activeRunLimit) ? activeRunLimit : null,
        overrideId: batchOverride?.overrideId || null,
        dueCount,
        selectedListingIds,
        resumedListingIds,
        completedListingIds,
        failedListingIds,
        skippedCount,
        skippedListings,
        errors,
        abortReason,
        startedLifecycles: startedRotationCount,
        completedLifecycles: completedListingIds.length,
        failedLifecycleIndex,
      };
    } catch (error) {
      const endedAt = String(input.endNow || new Date().toISOString());
      const message = error instanceof Error ? error.message : "Scheduler-Lauf ist unerwartet fehlgeschlagen.";
      abortReason = message;
      errors.push({ projectId: "", listingId: "", copyId: "", message });
      await finalizeRun(runId, {
        endedAt,
        completedListingIds,
        failedListingIds,
        errorCount: errors.length,
        status: WORKFLOW_STATUS.FAILED,
        statusMessage: "Scheduler-Lauf fehlgeschlagen",
        error: errors.map((item) => item.message).join(" · "),
        errors,
      }, endedAt).catch(() => undefined);
      await writeRunLog("failed", {
        runId,
        trigger,
        startedAt,
        endedAt,
        operatingMode,
        operatingModeFallbackReason,
        dueCount,
        selectedCount: selectedListingIds.length,
        skippedCount,
        skippedListings,
        errorCount: errors.length,
        errors,
        effectiveMaxRunItems: Number.isFinite(activeRunLimit) ? activeRunLimit : null,
        overrideId: batchOverride?.overrideId || null,
      });
      batchEndState = "failed";
      return { ok: false, claimed: true, runId, operatingMode, operatingModeFallbackReason, effectiveMaxRunItems: Number.isFinite(activeRunLimit) ? activeRunLimit : null, overrideId: batchOverride?.overrideId || null, dueCount, selectedListingIds, resumedListingIds, completedListingIds, failedListingIds, skippedCount, skippedListings, errors, abortReason: message };
    } finally {
      try {
        if (batchOverride && options.batchOverrideStore?.consume) {
          const finishedAt = stepTimestamp();
          try {
            const record = await options.batchOverrideStore.consume({
              overrideId: batchOverride.overrideId,
              schedulerRunId: runId,
              finishedAt,
              endState: batchEndState,
              selectedCount: selectedListingIds.length + resumedListingIds.length,
              startedCount: startedRotationCount,
              completedCount: completedListingIds.length,
              failedCount: failedListingIds.length,
              abortReason,
            });
            await writeRunLog("override-consumed", {
              overrideId: record.overrideId,
              schedulerRunId: runId,
              maxRunItems: record.maxRunItems,
              claimedAt: record.claimedAt,
              consumedAt: record.consumedAt,
              selectedCount: record.selectedCount,
              startedCount: record.startedCount,
              completedCount: record.completedCount,
              failedCount: record.failedCount,
              endState: record.endState,
            }).catch(() => undefined);
          } catch (error) {
            await writeRunLog("override-consume-failed", {
              overrideId: batchOverride.overrideId,
              schedulerRunId: runId,
              errorCode: String(error?.code || "PRODUCTION_BATCH_OVERRIDE_CONSUME_FAILED"),
              message: error instanceof Error ? error.message : "One-Shot-Produktionsoverride blieb sicher claimed.",
            }).catch(() => undefined);
          }
        }
      } finally {
        await lease.release();
      }
    }
  }

  async function runIfDue(input = {}) {
    const at = String(input.now || new Date().toISOString());
    const snapshot = await options.store.load();
    if (!snapshot?.stored || !snapshot.state) return { ran: false, reason: "catalog-not-stored" };
    const operatingPolicy = await loadOperatingMode(options.operatingModeStore);
    if (operatingPolicy.mode === "off") {
      return {
        ran: false,
        reason: operatingPolicy.fallbackReason || "operating-mode-off",
        ...(await inspect({ ...input, now: at, trigger: input.trigger || "periodic-off", writeLog: false })),
      };
    }
    if (operatingPolicy.mode === "active" || operatingPolicy.mode === "canary") {
      const productionPolicy = await loadProductionPolicy(options.productionPolicyStore);
      if (productionPolicy.valid !== true) {
        return {
          ran: false,
          reason: productionPolicy.fallbackReason || "production-policy-invalid",
          ...(await inspect({ ...input, now: at, trigger: input.trigger || "periodic-policy-blocked", writeLog: false })),
        };
      }
      const runtimeGuard = verifyProductionRuntime(options.runtimeProvenance, productionPolicy);
      if (!runtimeGuard.valid) {
        return {
          ran: false,
          reason: runtimeGuard.fallbackReason,
          ...(await inspect({ ...input, now: at, trigger: input.trigger || "periodic-runtime-blocked", writeLog: false })),
        };
      }
      const runtimeOwnership = await inspectRuntimeOwnership(productionPolicy);
      if (!runtimeOwnership.valid) {
        return {
          ran: false,
          reason: runtimeOwnership.fallbackReason,
          ...(await inspect({ ...input, now: at, trigger: input.trigger || "periodic-runtime-owner-blocked", writeLog: false })),
        };
      }
    }
    const scheduler = normalizeListingScheduler(snapshot.state.scheduler, { now: at });
    const windowIssues = schedulerWindowBlockReasons(scheduler, at);
    const due = schedulerDueListings({ ...snapshot.state, scheduler }, at);
    const pending = pendingRotationCopies(snapshot.state);
    const blockingIssues = pending.length ? hardSchedulerIssues(windowIssues) : windowIssues;
    if (blockingIssues.length) return { ran: false, reason: blockingIssues.join(" · ") };
    if (!due.length && !pending.length) return { ran: false, reason: "nothing-due" };
    return {
      ran: true,
      ...(await run({
        ...input,
        now: undefined,
        startedAt: at,
        trigger: input.trigger || "periodic",
      })),
    };
  }

  async function inspect(input = {}) {
    const at = String(input.now || new Date().toISOString());
    const snapshot = await options.store.load();
    if (!snapshot?.stored || !snapshot.state) return { inspected: false, reason: "catalog-not-stored" };
    const operatingPolicy = await loadOperatingMode(options.operatingModeStore);
    const productionPolicy = await loadProductionPolicy(options.productionPolicyStore);
    const runtimeGuard = verifyProductionRuntime(options.runtimeProvenance, productionPolicy);
    const productiveMode = operatingPolicy.mode === "active" || operatingPolicy.mode === "canary";
    const runtimeOwnership = productiveMode
      ? await inspectRuntimeOwnership(productionPolicy)
      : { valid: false, fallbackReason: "Betriebsmodus off; keine produktive Ownership-Prüfung erforderlich." };
    const scheduler = normalizeListingScheduler(snapshot.state.scheduler, { now: at });
    const due = schedulerDueListings({ ...snapshot.state, scheduler }, at);
    const pending = pendingRotationCopies(snapshot.state);
    const result = {
      inspected: true,
      trigger: String(input.trigger || "read-only-inspection"),
      at,
      operatingMode: operatingPolicy.mode,
      operatingModeValid: operatingPolicy.valid === true,
      productionPolicyValid: productionPolicy.valid === true,
      maxRunItems: productionPolicy.valid === true ? productionPolicy.maxRunItems : 0,
      effectiveMaxRunItems: productionPolicy.valid === true ? productionPolicy.maxRunItems : 0,
      overrideId: null,
      startupCatchupMode: productionPolicy.startupCatchupMode || "detect-only",
      runtimeCommit: runtimeGuard.runtimeCommit,
      expectedProductionCommit: runtimeGuard.expectedProductionCommit,
      runtimeRelease: runtimeGuard.runtimeRelease,
      runtimeGuardValid: runtimeGuard.valid,
      runtimeOwnershipValid: runtimeOwnership.valid,
      runtimeOwnershipFallbackReason: runtimeOwnership.fallbackReason || "",
      runtimePortOwnerPids: runtimeOwnership.portOwnerPids || [],
      runtimeHelperProcessPids: runtimeOwnership.helperProcessPids || [],
      dueCount: due.length,
      pendingCount: pending.length,
      schedulerIssues: schedulerWindowBlockReasons(scheduler, at),
    };
    if (input.writeLog !== false) await writeRunLog("inspected", result);
    return result;
  }

  return { inspect, run, runIfDue };
}
