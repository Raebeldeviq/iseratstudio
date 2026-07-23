import type {
  ProjectInput,
  TotalSyncRun,
  TotalSyncScope,
} from "../types";

export const TOTAL_SYNC_LISTINGS_PER_ADDRESS = 4;

function identifierPart(value: string, length: number): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "").slice(0, length).toUpperCase();
}

export function totalSyncExternalId(
  runId: string,
  projectId: string,
  slot: number,
): string {
  return `FPI-T-${identifierPart(runId, 8)}-${identifierPart(projectId, 8)}-${slot}`;
}

export function projectIsReadyForTotalSync(project: ProjectInput): boolean {
  return Boolean(
    project.street.trim()
    && project.zip.trim()
    && project.city.trim()
    && Number(project.plotArea) > 0,
  );
}

export function projectsInTotalSyncScope(
  projects: ProjectInput[],
  scope: TotalSyncScope,
): ProjectInput[] {
  return scope === "all"
    ? projects
    : projects.filter((project) => (
      (project.owner === "pascal" ? "pascal" : "fabian") === scope
    ));
}

export function pickRandomHouseIds(
  houseIds: string[],
  count = TOTAL_SYNC_LISTINGS_PER_ADDRESS,
  random: () => number = Math.random,
): string[] {
  const uniqueIds = Array.from(new Set(houseIds));
  if (uniqueIds.length < count) {
    throw new Error(`Für den Totalabgleich werden mindestens ${count} geeignete Haustypen benötigt.`);
  }
  const shuffled = [...uniqueIds];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.min(0.999999999, Math.max(0, random())) * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }
  return shuffled.slice(0, count);
}

export function createTotalSyncRun(input: {
  projects: ProjectInput[];
  eligibleHouseIds: string[];
  scope: TotalSyncScope;
  runId: string;
  createdAt: string;
  random?: () => number;
}): TotalSyncRun {
  const scopedProjects = projectsInTotalSyncScope(input.projects, input.scope);
  const readyProjects = scopedProjects.filter(projectIsReadyForTotalSync);
  if (!readyProjects.length) {
    throw new Error("Für den Totalabgleich wurde keine vollständige Grundstücksadresse gefunden.");
  }
  return {
    id: input.runId,
    scope: input.scope,
    createdAt: input.createdAt,
    status: "ready",
    skippedProjectCount: scopedProjects.length - readyProjects.length,
    tasks: readyProjects.map((project) => ({
      projectId: project.id,
      houseIds: pickRandomHouseIds(
        input.eligibleHouseIds,
        TOTAL_SYNC_LISTINGS_PER_ADDRESS,
        input.random,
      ),
      generated: false,
      uploadedExternalIds: [],
    })),
  };
}

export function totalSyncProgress(run: TotalSyncRun | undefined): {
  total: number;
  generated: number;
  uploaded: number;
  completedProjects: number;
} {
  if (!run) return { total: 0, generated: 0, uploaded: 0, completedProjects: 0 };
  const total = run.tasks.length * TOTAL_SYNC_LISTINGS_PER_ADDRESS;
  const generated = run.tasks.reduce(
    (sum, task) => sum + (task.generated ? task.houseIds.length : 0),
    0,
  );
  const uploaded = run.tasks.reduce(
    (sum, task) => sum + task.uploadedExternalIds.length,
    0,
  );
  const completedProjects = run.tasks.filter(
    (task) => task.uploadedExternalIds.length === task.houseIds.length,
  ).length;
  return { total, generated, uploaded, completedProjects };
}

export function totalSyncCanResume(run: TotalSyncRun | undefined): boolean {
  if (!run || run.status === "completed") return false;
  return totalSyncProgress(run).uploaded < totalSyncProgress(run).total;
}
