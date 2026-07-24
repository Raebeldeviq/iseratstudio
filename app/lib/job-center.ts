import type {
  AiModelId,
  AiTokenUsage,
  HouseTemplate,
  ProjectInput,
  StudioState,
  TotalSyncAttemptMode,
  TotalSyncFailureStage,
  TotalSyncListingAttempt,
  TotalSyncListingJob,
  TotalSyncListingStatus,
  TotalSyncProjectTask,
  TotalSyncRun,
  UploadRunHistoryEntry,
} from "../types";
import { totalSyncExternalId } from "./total-sync";

export const UPLOAD_RUN_HISTORY_LIMIT = 30;

const JOB_STATUSES = new Set<TotalSyncListingStatus>([
  "pending",
  "generating",
  "ready",
  "uploading",
  "uploaded",
  "failed",
  "unknown",
]);

const AI_MODELS = new Set<AiModelId>([
  "gpt-5.6-luna",
  "gpt-5.6-terra",
  "gpt-5.6-sol",
]);

function normalizeAiModel(value: unknown): AiModelId | undefined {
  return typeof value === "string" && AI_MODELS.has(value as AiModelId)
    ? value as AiModelId
    : undefined;
}

function normalizeAiUsage(
  value: unknown,
  fallbackModel?: AiModelId,
): AiTokenUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const usage = value as Partial<AiTokenUsage>;
  const model = normalizeAiModel(usage.model) ?? fallbackModel;
  const inputTokens = Number(usage.inputTokens);
  const outputTokens = Number(usage.outputTokens);
  const requestCount = Number(usage.requestCount);
  if (
    !model
    || !Number.isFinite(inputTokens)
    || !Number.isFinite(outputTokens)
    || inputTokens < 0
    || outputTokens < 0
  ) return undefined;
  return {
    model,
    inputTokens: Math.floor(inputTokens),
    outputTokens: Math.floor(outputTokens),
    requestCount: Number.isFinite(requestCount) && requestCount >= 0
      ? Math.floor(requestCount)
      : 1,
  };
}

function listingForTaskSlot(
  run: TotalSyncRun,
  task: TotalSyncProjectTask,
  project: ProjectInput | undefined,
  houseId: string,
  slot: number,
) {
  const runListings = project?.listings.filter(
    (listing) => listing.totalSyncRunId === run.id,
  ) ?? [];
  return runListings.find((listing) => (
    listing.externalId === totalSyncExternalId(run.id, task.projectId, slot)
  )) ?? runListings.find((listing) => listing.templateId === houseId);
}

function normalizeAttempts(value: unknown): TotalSyncListingAttempt[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const attempt = entry as Partial<TotalSyncListingAttempt>;
    if (
      (attempt.stage !== "generation"
        && attempt.stage !== "upload"
        && attempt.stage !== "validation")
      || typeof attempt.startedAt !== "string"
    ) return [];
    return [{
      stage: attempt.stage,
      startedAt: attempt.startedAt,
      completedAt: typeof attempt.completedAt === "string"
        ? attempt.completedAt
        : undefined,
      succeeded: typeof attempt.succeeded === "boolean"
        ? attempt.succeeded
        : undefined,
      message: typeof attempt.message === "string"
        ? attempt.message
        : undefined,
    }];
  }).slice(-20);
}

function normalizeTaskJobs(
  run: TotalSyncRun,
  task: TotalSyncProjectTask,
  project: ProjectInput | undefined,
): TotalSyncListingJob[] {
  const existingJobs = Array.isArray(task.listingJobs) ? task.listingJobs : [];
  const jobs = task.houseIds.map((houseId, index) => {
    const slot = index + 1;
    const existing = existingJobs.find((job) => (
      job.houseId === houseId || job.slot === slot
    ));
    const listing = listingForTaskSlot(run, task, project, houseId, slot);
    const externalId = existing?.externalId
      || listing?.externalId
      || totalSyncExternalId(run.id, task.projectId, slot);
    const uploaded = existing?.status === "uploaded"
      || task.uploadedExternalIds.includes(externalId)
      || Boolean(listing?.uploadedAt)
      || run.status === "completed";
    let status: TotalSyncListingStatus = existing
      && JOB_STATUSES.has(existing.status)
      ? existing.status
      : listing ? "ready" : "pending";
    if (uploaded) status = "uploaded";
    if (status === "uploading") status = "unknown";
    if (status === "generating") status = listing ? "ready" : "pending";

    return {
      id: existing?.id || `${task.projectId}:${slot}`,
      externalId,
      houseId,
      slot,
      status,
      attempts: normalizeAttempts(existing?.attempts),
      lastStage: existing?.lastStage,
      lastAttemptAt: existing?.lastAttemptAt,
      uploadedAt: existing?.uploadedAt || listing?.uploadedAt,
      lastError: existing?.lastError,
      aiUsage: normalizeAiUsage(existing?.aiUsage, run.aiModel),
    };
  });

  if (
    task.lastError
    && !jobs.some((job) => (
      job.status === "failed" || job.status === "unknown"
    ))
  ) {
    const firstOpen = jobs.find((job) => job.status !== "uploaded");
    if (firstOpen) {
      firstOpen.status = "failed";
      firstOpen.lastStage = task.generated ? "upload" : "generation";
      firstOpen.lastError = task.lastError;
    }
  }
  return jobs;
}

export function normalizeTotalSyncRun(
  run: TotalSyncRun | undefined,
  projects: ProjectInput[],
): TotalSyncRun | undefined {
  if (!run) return undefined;
  const aiModel = normalizeAiModel(run.aiModel);
  const tasks = run.tasks.map((task) => {
    const project = projects.find((item) => item.id === task.projectId);
    const listingJobs = normalizeTaskJobs(run, task, project);
    const uploadedExternalIds = Array.from(new Set([
      ...task.uploadedExternalIds,
      ...listingJobs
        .filter((job) => job.status === "uploaded")
        .map((job) => job.externalId),
    ]));
    const failedJob = listingJobs.find((job) => (
      job.status === "failed" || job.status === "unknown"
    ));
    return {
      ...task,
      listingJobs,
      uploadedExternalIds,
      generated: task.generated || listingJobs.every((job) => (
        job.status !== "pending" && job.status !== "generating"
      )),
      lastError: failedJob?.lastError,
    };
  });
  return {
    ...run,
    aiModel,
    kind: run.kind ?? "total-sync",
    status: run.status === "running" ? "paused" : run.status,
    updatedAt: run.updatedAt ?? run.completedAt ?? run.createdAt,
    attempts: Array.isArray(run.attempts) ? run.attempts : [],
    tasks,
  };
}

export function normalizeJobCenterState(state: StudioState): StudioState {
  const totalSyncRun = normalizeTotalSyncRun(state.totalSyncRun, state.projects);
  return {
    ...state,
    totalSyncRun,
    uploadRunHistory: Array.isArray(state.uploadRunHistory)
      ? state.uploadRunHistory.slice(0, UPLOAD_RUN_HISTORY_LIMIT)
      : [],
  };
}

export function totalSyncListingJobs(run: TotalSyncRun | undefined): Array<{
  projectId: string;
  job: TotalSyncListingJob;
}> {
  if (!run) return [];
  return run.tasks.flatMap((task) => (
    (task.listingJobs ?? []).map((job) => ({ projectId: task.projectId, job }))
  ));
}

export function replaceTotalSyncListingJob(
  run: TotalSyncRun,
  projectId: string,
  externalId: string,
  patch: Partial<TotalSyncListingJob>,
): TotalSyncRun {
  return {
    ...run,
    tasks: run.tasks.map((task) => (
      task.projectId === projectId
        ? {
            ...task,
            listingJobs: (task.listingJobs ?? []).map((job) => (
              job.externalId === externalId ? { ...job, ...patch } : job
            )),
          }
        : task
    )),
  };
}

export function runJobProgress(run: TotalSyncRun | undefined): {
  total: number;
  handled: number;
  pending: number;
  active: number;
  ready: number;
  uploaded: number;
  failed: number;
  unknown: number;
  completedProjects: number;
} {
  if (!run) {
    return {
      total: 0,
      handled: 0,
      pending: 0,
      active: 0,
      ready: 0,
      uploaded: 0,
      failed: 0,
      unknown: 0,
      completedProjects: 0,
    };
  }
  const jobs = totalSyncListingJobs(run).map(({ job }) => job);
  const count = (status: TotalSyncListingStatus) => (
    jobs.filter((job) => job.status === status).length
  );
  const uploaded = count("uploaded");
  const failed = count("failed");
  const unknown = count("unknown");
  return {
    total: jobs.length,
    handled: uploaded + failed + unknown,
    pending: count("pending"),
    active: count("generating") + count("uploading"),
    ready: count("ready"),
    uploaded,
    failed,
    unknown,
    completedProjects: run.tasks.filter((task) => (
      (task.listingJobs?.length ?? 0) > 0
      && task.listingJobs!.every((job) => job.status === "uploaded")
    )).length,
  };
}

export function runCompletionStatus(
  run: TotalSyncRun,
): "paused" | "completed-with-errors" | "completed" {
  const progress = runJobProgress(run);
  if (progress.pending + progress.ready + progress.active > 0) return "paused";
  if (run.tasks.some((task) => (
    !task.completedAt
    && (task.listingJobs?.length ?? 0) > 0
    && task.listingJobs!.every((job) => job.status === "uploaded")
  ))) return "paused";
  if (
    progress.failed
    || progress.unknown
    || run.tasks.some((task) => Boolean(task.lastError))
  ) {
    return "completed-with-errors";
  }
  return "completed";
}

export function jobShouldRun(
  job: TotalSyncListingJob,
  mode: TotalSyncAttemptMode,
): boolean {
  if (mode === "failed-only") return job.status === "failed";
  return job.status === "pending"
    || job.status === "ready"
    || job.status === "failed";
}

export function interruptedRun(run: TotalSyncRun): TotalSyncRun {
  return {
    ...run,
    tasks: run.tasks.map((task) => ({
      ...task,
      listingJobs: (task.listingJobs ?? []).map((job) => {
        if (job.status === "uploading") {
          return {
            ...job,
            status: "unknown" as const,
            lastStage: "upload" as const,
            lastError: "Der Upload wurde unterbrochen. Bitte zuerst in Immoprofessional prüfen, ob dieses Objekt angekommen ist.",
          };
        }
        if (job.status === "generating") {
          return { ...job, status: "pending" as const };
        }
        return job;
      }),
    })),
  };
}

export function appendJobAttempt(
  job: TotalSyncListingJob,
  input: {
    stage: TotalSyncFailureStage;
    startedAt: string;
    completedAt?: string;
    succeeded?: boolean;
    message?: string;
  },
): TotalSyncListingAttempt[] {
  const attempts = [...job.attempts];
  const openAttemptIndex = attempts.findLastIndex((attempt) => (
    attempt.stage === input.stage
    && attempt.startedAt === input.startedAt
    && !attempt.completedAt
  ));
  if (openAttemptIndex >= 0) {
    attempts[openAttemptIndex] = {
      ...attempts[openAttemptIndex],
      ...input,
    };
    return attempts.slice(-20);
  }
  return [...attempts, input].slice(-20);
}

export function buildUploadRunHistoryEntry(
  run: TotalSyncRun,
  projects: ProjectInput[],
  houses: HouseTemplate[],
  status: UploadRunHistoryEntry["status"],
  updatedAt: string,
): UploadRunHistoryEntry {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const houseById = new Map(houses.map((house) => [house.id, house]));
  return {
    id: run.id,
    kind: run.kind ?? "total-sync",
    scope: run.scope,
    status,
    portalPublicationEnabled: run.portalPublicationEnabled === true,
    aiModel: run.aiModel,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    updatedAt,
    completedAt: run.completedAt,
    skippedProjectCount: run.skippedProjectCount,
    attempts: run.attempts ?? [],
    listings: totalSyncListingJobs(run).map(({ projectId, job }) => {
      const project = projectById.get(projectId);
      const house = houseById.get(job.houseId);
      return {
        id: job.id,
        projectId,
        projectName: project?.name
          || run.tasks.find((task) => task.projectId === projectId)?.protectedLocation?.name
          || projectId,
        owner: project?.owner
          || run.tasks.find((task) => task.projectId === projectId)?.protectedLocation?.owner
          || "fabian",
        city: project?.city
          || run.tasks.find((task) => task.projectId === projectId)?.protectedLocation?.city
          || "",
        externalId: job.externalId,
        houseId: job.houseId,
        houseName: house?.name
          || project?.listings.find((listing) => listing.externalId === job.externalId)?.templateName
          || job.houseId,
        status: job.status,
        attemptCount: job.attempts.length,
        lastStage: job.lastStage,
        lastAttemptAt: job.lastAttemptAt,
        uploadedAt: job.uploadedAt,
        lastError: job.lastError,
        aiUsage: job.aiUsage,
      };
    }),
  };
}

export function upsertUploadRunHistory(
  history: UploadRunHistoryEntry[] | undefined,
  entry: UploadRunHistoryEntry,
  limit = UPLOAD_RUN_HISTORY_LIMIT,
): UploadRunHistoryEntry[] {
  return [
    entry,
    ...(history ?? []).filter((item) => item.id !== entry.id),
  ]
    .sort((left, right) => (
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    ))
    .slice(0, Math.max(1, limit));
}
