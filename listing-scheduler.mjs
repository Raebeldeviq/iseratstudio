import {
  listingControl,
  normalizeListingGroup,
  updateListingControl,
} from "./listing-groups.mjs";
import { LISTING_RULES, MAX_SCHEDULER_LOGS } from "./listing-rules.mjs";
import {
  listingRotationBlockReasons,
  listingRotationPoolBlockReasons,
  planListingRotation,
} from "./rotation-service.mjs";
import { normalizeHouseDistribution, validateHousePool } from "./house-distribution.mjs";
import {
  isSuccessfulWorkflowStatus,
  normalizeWorkflowStatus,
  workflowStatusMessage,
  WORKFLOW_STATUS,
} from "./workflow-status.mjs";

export const SCHEDULER_LOG_LIMIT = MAX_SCHEDULER_LOGS;

export const LISTING_SCHEDULER_DEFAULTS = Object.freeze({
  enabled: false,
  paused: true,
  mode: "prepare-only",
  maxUpdatesPerDay: 8,
  maxUpdatesPerAddressPerDay: LISTING_RULES.maxUpdatesPerAddressPerDay,
  minimumSpacingHours: 2,
  initialWaitDays: 12,
  updateIntervalDays: 12,
  allowedWeekdays: Object.freeze([1, 2, 3, 4, 5]),
  startTime: "08:00",
  endTime: "18:00",
});

const HEALTH_RULES = Object.freeze([
  {
    id: "age",
    score: ({ daysSinceSuccess }) => Math.min(120, daysSinceSuccess) * 2,
  },
  {
    id: "overdue",
    score: ({ overdueDays }) => Math.max(0, overdueDays) * 5,
  },
  {
    id: "last-error",
    score: ({ control }) => control.lastError ? 15 : 0,
  },
  {
    id: "user-priority",
    score: ({ control }) => Number(control.userPriority || 0) * 10,
  },
]);

function uid() {
  return globalThis.crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

function positiveInteger(value, fallback) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function validTime(value, fallback) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || "")) ? String(value) : fallback;
}

function validMode(value) {
  return ["full-auto", "copy-without-delete", "prepare-only", "blocked"].includes(value)
    ? value
    : LISTING_SCHEDULER_DEFAULTS.mode;
}

export function createListingScheduler(options = {}) {
  const timestamp = options.now || nowIso();
  return {
    settings: { ...LISTING_SCHEDULER_DEFAULTS, allowedWeekdays: [...LISTING_SCHEDULER_DEFAULTS.allowedWeekdays] },
    runs: [],
    lastRunAt: "",
    nextRunAt: "",
    lastStatus: WORKFLOW_STATUS.DRAFT,
    lastStatusMessage: "Noch nicht ausgeführt",
    lastError: "",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function normalizeListingScheduler(value, options = {}) {
  const timestamp = options.now || nowIso();
  const source = value && typeof value === "object" ? value : {};
  const rawSettings = source.settings && typeof source.settings === "object" ? source.settings : {};
  const allowedWeekdays = Array.isArray(rawSettings.allowedWeekdays)
    ? [...new Set(rawSettings.allowedWeekdays.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
    : [...LISTING_SCHEDULER_DEFAULTS.allowedWeekdays];
  return {
    ...source,
    settings: {
      ...LISTING_SCHEDULER_DEFAULTS,
      ...rawSettings,
      enabled: rawSettings.enabled === true,
      paused: rawSettings.paused !== false,
      mode: validMode(rawSettings.mode),
      maxUpdatesPerDay: positiveInteger(rawSettings.maxUpdatesPerDay, LISTING_SCHEDULER_DEFAULTS.maxUpdatesPerDay),
      maxUpdatesPerAddressPerDay: positiveInteger(rawSettings.maxUpdatesPerAddressPerDay, LISTING_SCHEDULER_DEFAULTS.maxUpdatesPerAddressPerDay),
      minimumSpacingHours: positiveInteger(rawSettings.minimumSpacingHours, LISTING_SCHEDULER_DEFAULTS.minimumSpacingHours),
      initialWaitDays: positiveInteger(rawSettings.initialWaitDays, LISTING_SCHEDULER_DEFAULTS.initialWaitDays),
      updateIntervalDays: positiveInteger(rawSettings.updateIntervalDays, LISTING_SCHEDULER_DEFAULTS.updateIntervalDays),
      allowedWeekdays: allowedWeekdays.length ? allowedWeekdays : [...LISTING_SCHEDULER_DEFAULTS.allowedWeekdays],
      startTime: validTime(rawSettings.startTime, LISTING_SCHEDULER_DEFAULTS.startTime),
      endTime: validTime(rawSettings.endTime, LISTING_SCHEDULER_DEFAULTS.endTime),
    },
    runs: Array.isArray(source.runs) ? source.runs.slice(-SCHEDULER_LOG_LIMIT).map((run) => ({
      ...run,
      status: normalizeWorkflowStatus(run?.status, WORKFLOW_STATUS.DRAFT),
      statusMessage: workflowStatusMessage(run?.status, run?.statusMessage),
    })) : [],
    lastRunAt: String(source.lastRunAt || ""),
    nextRunAt: String(source.nextRunAt || ""),
    lastStatus: normalizeWorkflowStatus(source.lastStatus, WORKFLOW_STATUS.DRAFT),
    lastStatusMessage: workflowStatusMessage(source.lastStatus, source.lastStatusMessage),
    lastError: String(source.lastError || ""),
    createdAt: String(source.createdAt || timestamp),
    updatedAt: timestamp,
  };
}

export function updateListingSchedulerSettings(value, patch, options = {}) {
  const scheduler = normalizeListingScheduler(value, options);
  return normalizeListingScheduler({
    ...scheduler,
    settings: { ...scheduler.settings, ...patch },
  }, options);
}

function localDayKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function minuteOfDay(value) {
  const date = new Date(value);
  return date.getHours() * 60 + date.getMinutes();
}

function settingMinute(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function schedulerWindowBlockReasons(schedulerValue, at = nowIso()) {
  const scheduler = normalizeListingScheduler(schedulerValue, { now: at });
  const { settings } = scheduler;
  const reasons = [];
  const timestamp = Date.parse(at);
  if (!settings.enabled) reasons.push("Die Automatik ist nicht aktiviert.");
  if (settings.paused) reasons.push("Die Automatik ist pausiert.");
  if (settings.mode === "blocked") reasons.push("Der Scheduler-Modus ist gesperrt.");
  if (!Number.isFinite(timestamp)) reasons.push("Der Ausführungszeitpunkt ist ungültig.");
  const date = new Date(at);
  if (!settings.allowedWeekdays.includes(date.getDay())) reasons.push("Der heutige Wochentag ist nicht freigegeben.");
  const minute = minuteOfDay(at);
  const start = settingMinute(settings.startTime);
  const end = settingMinute(settings.endTime);
  if (minute < start || minute > end) reasons.push("Der aktuelle Zeitpunkt liegt außerhalb des Zeitfensters.");
  if (scheduler.lastRunAt) {
    const spacingMs = settings.minimumSpacingHours * 60 * 60 * 1000;
    if (timestamp - Date.parse(scheduler.lastRunAt) < spacingMs) reasons.push("Der globale Mindestabstand seit dem letzten Lauf ist noch nicht erreicht.");
  }
  return reasons;
}

function daysBetween(later, earlier) {
  const difference = Date.parse(later) - Date.parse(earlier);
  return Number.isFinite(difference) ? Math.max(0, difference / 86400000) : 0;
}

export function listingHealthScore(groupValue, listing, settingsValue, at = nowIso()) {
  const settings = { ...LISTING_SCHEDULER_DEFAULTS, ...(settingsValue || {}) };
  const control = listingControl(groupValue, listing);
  const baseline = control.lastSuccessAt || control.lastUpdatedAt || listing.createdAt || groupValue.createdAt || at;
  const daysSinceSuccess = daysBetween(at, baseline);
  const overdueDays = daysSinceSuccess - settings.updateIntervalDays;
  const context = { control, listing, daysSinceSuccess, overdueDays, settings, at };
  const contributions = HEALTH_RULES.map((rule) => ({ id: rule.id, value: rule.score(context) }));
  return {
    score: Math.round(contributions.reduce((sum, contribution) => sum + contribution.value, 0)),
    daysSinceSuccess,
    overdueDays,
    contributions,
  };
}

export function listingSchedulerBlockReasons(groupValue, listing, schedulerValue, at = nowIso(), options = {}) {
  const scheduler = normalizeListingScheduler(schedulerValue, { now: at });
  const control = listingControl(groupValue, listing);
  const reasons = listingRotationBlockReasons(groupValue, listing, at, { normalized: true });
  if (options.distribution && options.distributionValidation && options.project) {
    reasons.push(...listingRotationPoolBlockReasons(
      options.distribution,
      options.distributionValidation,
      options.project,
      groupValue,
      listing,
    ));
  }
  const createdAt = listing.createdAt || groupValue.createdAt;
  if (createdAt && daysBetween(at, createdAt) < scheduler.settings.initialWaitDays) reasons.push("Wartezeit bis zur ersten Aktualisierung ist noch nicht abgelaufen.");
  const baseline = control.lastSuccessAt || control.lastUpdatedAt;
  if (baseline && daysBetween(at, baseline) < scheduler.settings.updateIntervalDays) reasons.push("Das inseratsbezogene Aktualisierungsintervall ist noch nicht erreicht.");
  if (control.schedulerSelectionId && localDayKey(control.schedulerSelectedAt || at) === localDayKey(at)) reasons.push("Das Inserat ist für den heutigen Lauf bereits reserviert.");
  return [...new Set(reasons)];
}

function successfulUpdatesToday(project, at) {
  const logs = project.listingGroup?.logs || [];
  return logs.filter((log) =>
    localDayKey(log.timestamp) === localDayKey(at)
    && log.mode !== "dry-run"
    && !log.error
    && isSuccessfulWorkflowStatus(log.processStatus));
}

export function selectSchedulerListings(state, at = nowIso(), options = {}) {
  const scheduler = normalizeListingScheduler(state.scheduler, { now: at });
  const windowIssues = options.ignoreWindow ? [] : schedulerWindowBlockReasons(scheduler, at);
  const activeProjects = state.projects.filter((project) => project.isActive !== false);
  const completedToday = activeProjects.flatMap((project) => successfulUpdatesToday(project, at));
  const remainingGlobal = Math.max(0, scheduler.settings.maxUpdatesPerDay - completedToday.length);
  if (windowIssues.length || remainingGlobal === 0) {
    return { scheduler, selections: [], skipped: [], issues: windowIssues.length ? windowIssues : ["Das Tageslimit ist bereits erreicht."] };
  }

  const projectQueues = [];
  const skipped = [];
  const distribution = normalizeHouseDistribution(state.houseDistribution, state.houses || [], activeProjects);
  const distributionValidation = validateHousePool(distribution, state.houses || [], {
    projects: activeProjects,
    normalized: true,
  });
  for (const project of activeProjects) {
    const group = normalizeListingGroup(project.listingGroup, project.id, { now: at });
    const usedForAddress = successfulUpdatesToday(project, at).length;
    const reservedForAddress = group.listingControls.filter((control) =>
      control.schedulerSelectionId
      && localDayKey(control.schedulerSelectedAt || at) === localDayKey(at)).length;
    const addressCapacity = Math.max(
      0,
      scheduler.settings.maxUpdatesPerAddressPerDay - usedForAddress - reservedForAddress,
    );
    if (!addressCapacity) continue;
    const candidates = [];
    for (const listing of project.listings || []) {
      const reasons = listingSchedulerBlockReasons(group, listing, scheduler, at, {
        state,
        projectId: project.id,
        project,
        distribution,
        distributionValidation,
      });
      if (reasons.length) {
        skipped.push({ projectId: project.id, listingId: listing.id, reasons });
        continue;
      }
      const health = listingHealthScore(group, listing, scheduler.settings, at);
      candidates.push({ project, group, listing, control: listingControl(group, listing), health });
    }
    candidates.sort((left, right) =>
      right.health.score - left.health.score
      || Date.parse(left.control.lastSuccessAt || left.listing.createdAt || "1970-01-01")
        - Date.parse(right.control.lastSuccessAt || right.listing.createdAt || "1970-01-01")
      || left.listing.id.localeCompare(right.listing.id));
    if (candidates.length) projectQueues.push({ projectId: project.id, capacity: addressCapacity, candidates });
  }

  projectQueues.sort((left, right) =>
    right.candidates[0].health.score - left.candidates[0].health.score
    || left.projectId.localeCompare(right.projectId));
  const selections = [];
  let addedInRound = true;
  while (selections.length < remainingGlobal && addedInRound) {
    addedInRound = false;
    for (const queue of projectQueues) {
      if (selections.length >= remainingGlobal) break;
      const addressSelected = selections.filter((item) => item.project.id === queue.projectId).length;
      if (addressSelected >= queue.capacity || !queue.candidates.length) continue;
      const candidate = queue.candidates.shift();
      if (candidate) {
        selections.push(candidate);
        addedInRound = true;
      }
    }
  }
  return { scheduler, selections, skipped, issues: [] };
}

export function reserveSchedulerSelection(state, selectionResult, options = {}) {
  const timestamp = options.now || nowIso();
  const runId = options.runId || (options.idFactory || uid)();
  const selectedIds = new Set(selectionResult.selections.map((selection) => selection.listing.id));
  const projects = options.reserveControls === false ? state.projects : state.projects.map((project) => {
    if (!selectionResult.selections.some((selection) => selection.project.id === project.id)) return project;
    let group = normalizeListingGroup(project.listingGroup, project.id, { now: timestamp });
    for (const listing of project.listings) {
      if (!selectedIds.has(listing.id)) continue;
      group = updateListingControl(group, listing, {
        schedulerSelectionId: runId,
        schedulerSelectedAt: timestamp,
        status: WORKFLOW_STATUS.SCHEDULED,
        statusMessage: "Für Tageslauf ausgewählt",
      }, { now: timestamp });
    }
    return { ...project, listingGroup: group };
  });
  const scheduler = normalizeListingScheduler(state.scheduler, { now: timestamp });
  const log = {
    id: runId,
    timestamp,
    mode: options.mode || "dry-run",
    selectedListingIds: [...selectedIds],
    completedListingIds: Array.isArray(options.completedListingIds) ? options.completedListingIds : [],
    failedListingIds: Array.isArray(options.failedListingIds) ? options.failedListingIds : [],
    status: options.mode === "dry-run"
      ? WORKFLOW_STATUS.PREPARED
      : Array.isArray(options.failedListingIds) && options.failedListingIds.length
        ? WORKFLOW_STATUS.FAILED
        : WORKFLOW_STATUS.PUBLISHED,
    statusMessage: options.mode === "dry-run"
      ? "Dry Run ausgewählt"
      : `${Array.isArray(options.completedListingIds) ? options.completedListingIds.length : 0} von ${selectedIds.size} Inseraten verarbeitet`,
    error: Array.isArray(options.failedListingIds) && options.failedListingIds.length
      ? `${options.failedListingIds.length} Inserate wurden isoliert übersprungen.`
      : "",
  };
  return {
    state: {
      ...state,
      projects,
      scheduler: {
        ...scheduler,
        runs: [...scheduler.runs, log].slice(-SCHEDULER_LOG_LIMIT),
        lastRunAt: options.mode === "dry-run" ? scheduler.lastRunAt : timestamp,
        nextRunAt: options.mode === "dry-run"
          ? scheduler.nextRunAt
          : new Date(Date.parse(timestamp) + scheduler.settings.minimumSpacingHours * 3600000).toISOString(),
        lastStatus: log.status,
        lastStatusMessage: log.statusMessage,
        lastError: log.error,
        updatedAt: timestamp,
      },
    },
    runId,
    log,
  };
}

export function runSchedulerDryRun(state, _houses, priceForProjectHouse, options = {}) {
  const timestamp = options.now || nowIso();
  const selection = selectSchedulerListings(state, timestamp, { ignoreWindow: options.ignoreWindow === true });
  const results = selection.selections.map((item) => {
    try {
      const plan = planListingRotation(state, item.project.id, item.listing.id, { now: timestamp });
      const issues = [...plan.issues];
      if (plan.house && !(Number(priceForProjectHouse(item.project, plan.house)) > 0)) {
        issues.push("Der Angebotspreis der geplanten Hausvariante ist ungültig.");
      }
      return {
        projectId: item.project.id,
        listingId: item.listing.id,
        ok: plan.ok && issues.length === 0,
        issues,
        variant: plan.house ? { templateId: plan.house.id, templateName: plan.house.name } : null,
      };
    } catch (error) {
      return { projectId: item.project.id, listingId: item.listing.id, ok: false, issues: [error instanceof Error ? error.message : "Unbekannter Prüffehler"], variant: null };
    }
  });
  return { ...selection, results, ok: !selection.issues.length && results.length > 0 && results.every((result) => result.ok) };
}
