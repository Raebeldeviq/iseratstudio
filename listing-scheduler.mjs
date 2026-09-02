import {
  listingControl,
  normalizeListingGroup,
  updateListingControl,
} from "./listing-groups.mjs";
import {
  LISTING_ROTATION_DAILY_CAP,
  LISTING_ROTATION_INTERVAL_DAYS,
  LISTING_RULES,
  MAX_SCHEDULER_LOGS,
} from "./listing-rules.mjs";
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
import { addLocalCalendarDaysToIso, localDateKey } from "./plot-sync-schedule.mjs";

export const SCHEDULER_LOG_LIMIT = MAX_SCHEDULER_LOGS;
export const LISTING_SCHEDULER_TIME_ZONE = "Europe/Berlin";
export const LISTING_SCHEDULER_LEGACY_END_TIME = "18:00";
export const LISTING_SCHEDULER_PRODUCTION_END_TIME = "21:00";
export { LISTING_ROTATION_INTERVAL_DAYS };
export const LISTING_SCHEDULER_DAILY_ROTATION_CAP = LISTING_ROTATION_DAILY_CAP;

export const LISTING_SCHEDULER_DEFAULTS = Object.freeze({
  enabled: false,
  paused: true,
  mode: "prepare-only",
  maxUpdatesPerDay: LISTING_SCHEDULER_DAILY_ROTATION_CAP,
  maxUpdatesPerAddressPerDay: LISTING_RULES.maxUpdatesPerAddressPerDay,
  minimumSpacingHours: 2,
  initialWaitDays: LISTING_ROTATION_INTERVAL_DAYS,
  updateIntervalDays: LISTING_ROTATION_INTERVAL_DAYS,
  allowedWeekdays: Object.freeze([1, 2, 3, 4, 5]),
  startTime: "08:00",
  endTime: LISTING_SCHEDULER_PRODUCTION_END_TIME,
});

const BERLIN_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: LISTING_SCHEDULER_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
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

function normalizedSchedulerEndTime(value) {
  const endTime = validTime(value, LISTING_SCHEDULER_DEFAULTS.endTime);
  return endTime === LISTING_SCHEDULER_LEGACY_END_TIME
    ? LISTING_SCHEDULER_PRODUCTION_END_TIME
    : endTime;
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
    dailyRotationStarts: [],
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
      maxUpdatesPerDay: LISTING_SCHEDULER_DAILY_ROTATION_CAP,
      maxUpdatesPerAddressPerDay: positiveInteger(rawSettings.maxUpdatesPerAddressPerDay, LISTING_SCHEDULER_DEFAULTS.maxUpdatesPerAddressPerDay),
      minimumSpacingHours: positiveInteger(rawSettings.minimumSpacingHours, LISTING_SCHEDULER_DEFAULTS.minimumSpacingHours),
      initialWaitDays: LISTING_ROTATION_INTERVAL_DAYS,
      updateIntervalDays: LISTING_ROTATION_INTERVAL_DAYS,
      allowedWeekdays: allowedWeekdays.length ? allowedWeekdays : [...LISTING_SCHEDULER_DEFAULTS.allowedWeekdays],
      startTime: validTime(rawSettings.startTime, LISTING_SCHEDULER_DEFAULTS.startTime),
      endTime: normalizedSchedulerEndTime(rawSettings.endTime),
    },
    runs: Array.isArray(source.runs) ? source.runs.slice(-SCHEDULER_LOG_LIMIT).map((run) => ({
      ...run,
      status: normalizeWorkflowStatus(run?.status, WORKFLOW_STATUS.DRAFT),
      statusMessage: workflowStatusMessage(run?.status, run?.statusMessage),
    })) : [],
    dailyRotationStarts: Array.isArray(source.dailyRotationStarts)
      ? source.dailyRotationStarts.slice(-4000).map((claim) => ({
          id: String(claim?.id || ""),
          dayKey: String(claim?.dayKey || ""),
          startedAt: String(claim?.startedAt || ""),
          schedulerRunId: String(claim?.schedulerRunId || ""),
          projectId: String(claim?.projectId || ""),
          sourceListingId: String(claim?.sourceListingId || ""),
        })).filter((claim) => claim.id && claim.dayKey && claim.startedAt && claim.sourceListingId)
      : [],
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

function berlinDateTimeParts(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return Object.fromEntries(BERLIN_DATE_TIME_FORMATTER.formatToParts(date)
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, Number(part.value)]));
}

function localDayKey(value) {
  try {
    return localDateKey(value, LISTING_SCHEDULER_TIME_ZONE);
  } catch {
    return "";
  }
}

function berlinWeekday(parts) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

function minuteOfDay(parts) {
  return parts.hour * 60 + parts.minute;
}

function settingMinute(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function schedulerWindowBlockReasons(schedulerValue, at = nowIso(), options = {}) {
  const scheduler = normalizeListingScheduler(schedulerValue, { now: at });
  const { settings } = scheduler;
  const reasons = [];
  const timestamp = Date.parse(at);
  if (!settings.enabled) reasons.push("Die Automatik ist nicht aktiviert.");
  if (settings.paused) reasons.push("Die Automatik ist pausiert.");
  if (settings.mode === "blocked") reasons.push("Der Scheduler-Modus ist gesperrt.");
  if (!Number.isFinite(timestamp)) reasons.push("Der Ausführungszeitpunkt ist ungültig.");
  const parts = berlinDateTimeParts(at);
  if (parts && !options.ignoreTimeWindow && !settings.allowedWeekdays.includes(berlinWeekday(parts))) reasons.push("Der heutige Wochentag ist in Europe/Berlin nicht freigegeben.");
  if (parts) {
    const minute = minuteOfDay(parts);
    const start = settingMinute(settings.startTime);
    const end = settingMinute(settings.endTime);
    if (!options.ignoreTimeWindow && (minute < start || minute > end)) reasons.push("Der aktuelle Zeitpunkt liegt außerhalb des Europe/Berlin-Zeitfensters.");
  }
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

export function listingDueAt(groupValue, listing) {
  const control = listingControl(groupValue, listing);
  const schedulerDate = control.schedulerDate;
  if (!schedulerDate || !Number.isFinite(Date.parse(schedulerDate))) return "";
  return addLocalCalendarDaysToIso(
    schedulerDate,
    LISTING_ROTATION_INTERVAL_DAYS,
    LISTING_SCHEDULER_TIME_ZONE,
  );
}

export function listingSchedulerDate(groupValue, listing) {
  const value = listingControl(groupValue, listing).schedulerDate;
  return value && Number.isFinite(Date.parse(value)) ? value : "";
}

export function isListingDue(groupValue, listing, settingsValue, at = nowIso()) {
  const dueAt = listingDueAt(groupValue, listing, settingsValue);
  return Boolean(dueAt) && Date.parse(dueAt) <= Date.parse(at);
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
  if (control.status !== WORKFLOW_STATUS.PUBLISHED) {
    reasons.push("Nur ein bestätigtes veröffentlichtes Inserat darf automatisch rotiert werden.");
  }
  const pendingRotation = (options.project?.listings || []).find((candidate) =>
    candidate?.rotationSourceListingId === listing.id
    && !candidate.rotationArchivedAt
    && [
      WORKFLOW_STATUS.SCHEDULED,
      WORKFLOW_STATUS.PROCESSING,
      WORKFLOW_STATUS.PREPARED,
      WORKFLOW_STATUS.FAILED,
      WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT,
    ].includes(normalizeWorkflowStatus(candidate.status, WORKFLOW_STATUS.PREPARED)));
  if (pendingRotation) {
    reasons.push(`Die Rotationskopie ${pendingRotation.externalId || pendingRotation.id} wartet noch auf Übertragung oder Importbestätigung.`);
  }
  if (options.distribution && options.distributionValidation && options.project) {
    reasons.push(...listingRotationPoolBlockReasons(
      options.distribution,
      options.distributionValidation,
      options.project,
      groupValue,
      listing,
    ));
  }
  const dueAt = listingDueAt(groupValue, listing, scheduler.settings);
  if (!dueAt) reasons.push("Für das Inserat fehlt ein belastbarer Veröffentlichungs- oder Erstellungszeitpunkt.");
  else if (Date.parse(dueAt) > Date.parse(at)) reasons.push(`Das Inserat wird erst am ${dueAt} fällig.`);
  if (control.schedulerSelectionId && localDayKey(control.schedulerSelectedAt || at) === localDayKey(at)) reasons.push("Das Inserat ist für den heutigen Lauf bereits reserviert.");
  return [...new Set(reasons)];
}

export function schedulerDueListings(state, at = nowIso()) {
  const scheduler = normalizeListingScheduler(state.scheduler, { now: at });
  const due = [];
  for (const project of state.projects || []) {
    if (project.isActive === false) continue;
    const group = normalizeListingGroup(project.listingGroup, project.id, { now: at });
    if (group.automation.rotationEnabled === false) continue;
    for (const listing of project.listings || []) {
      if (!listing) continue;
      const control = listingControl(group, listing);
      if (!control.automaticUpdateEnabled || control.status !== WORKFLOW_STATUS.PUBLISHED) continue;
      const dueAt = listingDueAt(group, listing, scheduler.settings);
      if (dueAt && Date.parse(dueAt) <= Date.parse(at)) {
        due.push({
          projectId: project.id,
          listingId: listing.id,
          schedulerDate: listingSchedulerDate(group, listing),
          dueAt,
        });
      }
    }
  }
  return due.sort((left, right) =>
    Date.parse(left.schedulerDate) - Date.parse(right.schedulerDate)
    || left.projectId.localeCompare(right.projectId)
    || left.listingId.localeCompare(right.listingId));
}

function successfulUpdatesToday(project, at, options = {}) {
  const logs = project.listingGroup?.logs || [];
  return logs.filter((log) =>
    localDayKey(log.timestamp) === localDayKey(at)
    && (!options.beforeAt || Date.parse(log.timestamp) < Date.parse(options.beforeAt))
    && log.mode !== "dry-run"
    && !log.error
    && isSuccessfulWorkflowStatus(log.processStatus));
}

function legacyRotationStartsToday(scheduler, projects, at, beforeAt = "") {
  const legacyIds = new Set();
  for (const run of scheduler.runs || []) {
    const runAt = run.startedAt || run.timestamp;
    if (run.dailyBudgetVersion === 1
      || localDayKey(runAt) !== localDayKey(at)
      || (beforeAt && Date.parse(runAt) >= Date.parse(beforeAt))) continue;
    for (const listingId of run.completedListingIds || []) legacyIds.add(String(listingId));
  }
  const loggedStarts = projects.flatMap((project) => successfulUpdatesToday(project, at, { beforeAt })).length;
  return Math.max(legacyIds.size, loggedStarts);
}

export function schedulerDailyRotationBudget(schedulerValue, at = nowIso(), projects = []) {
  const scheduler = normalizeListingScheduler(schedulerValue, { now: at });
  const dayKey = localDayKey(at);
  const claims = scheduler.dailyRotationStarts.filter((claim) => claim.dayKey === dayKey);
  const firstClaimAt = claims.map((claim) => claim.startedAt).sort()[0] || "";
  const legacyCount = legacyRotationStartsToday(scheduler, projects, at, firstClaimAt);
  const used = claims.length + legacyCount;
  const limit = Math.min(LISTING_SCHEDULER_DAILY_ROTATION_CAP, scheduler.settings.maxUpdatesPerDay);
  return { dayKey, limit, used, remaining: Math.max(0, limit - used), claims, legacyCount };
}

export function claimSchedulerDailyRotationStart(state, input, options = {}) {
  const startedAt = String(options.now || input?.startedAt || nowIso());
  const scheduler = normalizeListingScheduler(state.scheduler, { now: startedAt });
  const schedulerRunId = String(input?.schedulerRunId || "");
  const sourceListingId = String(input?.sourceListingId || "");
  const projectId = String(input?.projectId || "");
  const id = String(input?.id || `${schedulerRunId}:${projectId}:${sourceListingId}`);
  if (!schedulerRunId || !sourceListingId || !projectId) {
    return { state, result: { claimed: false, idempotent: false, reason: "daily_rotation_claim_invalid" } };
  }
  const existing = scheduler.dailyRotationStarts.find((claim) => claim.id === id);
  if (existing) {
    const budget = schedulerDailyRotationBudget(scheduler, startedAt, state.projects || []);
    return { state, result: { claimed: false, idempotent: true, claim: existing, ...budget } };
  }
  const budget = schedulerDailyRotationBudget(scheduler, startedAt, state.projects || []);
  if (budget.remaining < 1) {
    return { state, result: { claimed: false, idempotent: false, reason: "daily_rotation_cap_reached", ...budget } };
  }
  const claim = { id, dayKey: budget.dayKey, startedAt, schedulerRunId, projectId, sourceListingId };
  const oldestRetained = Date.parse(startedAt) - 45 * 86400000;
  const dailyRotationStarts = [...scheduler.dailyRotationStarts.filter((item) => {
    const timestamp = Date.parse(item.startedAt);
    return Number.isFinite(timestamp) && timestamp >= oldestRetained;
  }), claim].slice(-4000);
  const nextScheduler = { ...scheduler, dailyRotationStarts, updatedAt: startedAt };
  return {
    state: { ...state, scheduler: nextScheduler },
    result: {
      claimed: true,
      idempotent: false,
      claim,
      ...schedulerDailyRotationBudget(nextScheduler, startedAt, state.projects || []),
    },
  };
}

export function selectSchedulerListings(state, at = nowIso(), options = {}) {
  const scheduler = normalizeListingScheduler(state.scheduler, { now: at });
  const windowIssues = options.ignoreWindow
    ? []
    : schedulerWindowBlockReasons(scheduler, at, { ignoreTimeWindow: options.ignoreTimeWindow === true });
  const activeProjects = state.projects.filter((project) => project.isActive !== false);
  const dailyBudget = schedulerDailyRotationBudget(scheduler, at, activeProjects);
  const requestedMaximum = Number.isFinite(Number(options.maximumSelections))
    ? Math.max(0, Math.trunc(Number(options.maximumSelections)))
    : Number.POSITIVE_INFINITY;
  const remainingGlobal = Math.min(
    requestedMaximum,
    dailyBudget.remaining,
  );
  if (windowIssues.length || remainingGlobal === 0) {
    return {
      scheduler,
      selections: [],
      skipped: [],
      issues: windowIssues.length ? windowIssues : ["Das Tageslimit ist bereits erreicht."],
      dailyBudget,
    };
  }

  const candidates = [];
  const addressCapacities = new Map();
  const skipped = [];
  const distribution = normalizeHouseDistribution(state.houseDistribution, state.houses || [], activeProjects);
  const distributionValidation = validateHousePool(distribution, state.houses || [], {
    projects: activeProjects,
    normalized: true,
  });
  for (const project of activeProjects) {
    const group = normalizeListingGroup(project.listingGroup, project.id, { now: at });
    const claimedForAddress = dailyBudget.claims.filter((claim) => claim.projectId === project.id).length;
    const usedForAddress = Math.max(successfulUpdatesToday(project, at).length, claimedForAddress);
    const reservedForAddress = group.listingControls.filter((control) =>
      control.schedulerSelectionId
      && localDayKey(control.schedulerSelectedAt || at) === localDayKey(at)).length;
    const addressCapacity = Math.max(
      0,
      scheduler.settings.maxUpdatesPerAddressPerDay - usedForAddress - reservedForAddress,
    );
    if (!addressCapacity) continue;
    addressCapacities.set(project.id, addressCapacity);
    for (const listing of project.listings || []) {
      if (!listing) continue;
      if (options.allowedListingIds instanceof Set
        && !options.allowedListingIds.has(String(listing.id || ""))
        && !options.allowedListingIds.has(String(listing.externalId || ""))) {
        skipped.push({
          projectId: project.id,
          listingId: listing.id,
          reasons: ["Das Inserat ist im globalen Canary-Betriebsmodus nicht freigegeben."],
        });
        continue;
      }
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
      candidates.push({
        project,
        group,
        listing,
        control: listingControl(group, listing),
        schedulerDate: listingSchedulerDate(group, listing),
        dueAt: listingDueAt(group, listing, scheduler.settings),
        health,
      });
    }
  }

  candidates.sort((left, right) =>
    Date.parse(left.schedulerDate) - Date.parse(right.schedulerDate)
    || left.project.id.localeCompare(right.project.id)
    || left.listing.id.localeCompare(right.listing.id));
  const selections = [];
  const selectedPerAddress = new Map();
  for (const candidate of candidates) {
    if (selections.length >= remainingGlobal) break;
    const selected = selectedPerAddress.get(candidate.project.id) || 0;
    if (selected >= (addressCapacities.get(candidate.project.id) || 0)) continue;
    selections.push(candidate);
    selectedPerAddress.set(candidate.project.id, selected + 1);
  }
  return { scheduler, selections, skipped, issues: [], dailyBudget };
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
        : WORKFLOW_STATUS.PREPARED,
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
