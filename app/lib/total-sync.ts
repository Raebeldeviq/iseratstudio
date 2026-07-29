import type {
  AiModelId,
  HouseTemplate,
  ProtectedProjectLocation,
  ProjectInput,
  TotalSyncRun,
  TotalSyncRunKind,
  TotalSyncScope,
} from "../types";
import {
  allocateProviderExternalIds,
  normalizeProviderNumber,
} from "./external-ids.ts";

export const TOTAL_SYNC_LISTINGS_PER_ADDRESS = 4;
export const REQUIRED_TOTAL_SYNC_HOUSE_TYPES = [
  "Einfamilienhaus",
  "Bungalow",
  "Zweifamilienhaus",
] as const;

export type RequiredTotalSyncHouseType =
  (typeof REQUIRED_TOTAL_SYNC_HOUSE_TYPES)[number];

type TotalSyncHouseCandidate = Pick<HouseTemplate, "id" | "houseType">;

function identifierPart(value: string, length: number): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "").slice(0, length).toUpperCase();
}

export function totalSyncExternalId(
  runId: string,
  projectId: string,
  slot: number,
): string {
  return `FPI-T-${identifierPart(runId, 16)}-${identifierPart(projectId, 12)}-${slot}`;
}

export function projectIsReadyForTotalSync(project: ProjectInput): boolean {
  return Boolean(
    project.street.trim()
    && project.houseNumber.trim()
    && project.zip.trim()
    && project.city.trim()
    && Number(project.plotArea) > 0
    && Number(project.plotPrice) > 0,
  );
}

export function snapshotProtectedProjectLocation(
  project: ProjectInput,
): ProtectedProjectLocation {
  return {
    id: project.id,
    owner: project.owner === "pascal" ? "pascal" : "fabian",
    name: project.name,
    street: project.street,
    houseNumber: project.houseNumber,
    zip: project.zip,
    city: project.city,
    district: project.district,
    plotArea: project.plotArea,
    plotPrice: project.plotPrice,
    additionalCosts: project.additionalCosts,
    locationFacts: project.locationFacts,
    transportFacts: project.transportFacts,
    familyFacts: project.familyFacts,
    natureFacts: project.natureFacts,
    notes: project.notes,
    createdAt: project.createdAt,
  };
}

export function protectedProjectLocationMatches(
  project: ProjectInput,
  snapshot: ProtectedProjectLocation | undefined,
): boolean {
  if (!snapshot) return true;
  const current = snapshotProtectedProjectLocation(project);
  return (Object.keys(current) as Array<keyof ProtectedProjectLocation>).every(
    (key) => current[key] === snapshot[key],
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

export function requiredTotalSyncHouseType(
  houseType: string,
): RequiredTotalSyncHouseType | undefined {
  const normalized = houseType.trim().toLocaleLowerCase("de-DE");
  if (normalized.includes("zweifamilien")) return "Zweifamilienhaus";
  if (normalized.includes("bungalow")) return "Bungalow";
  if (normalized.includes("einfamilien")) return "Einfamilienhaus";
  return undefined;
}

function uniqueHouseCandidates(
  houses: TotalSyncHouseCandidate[],
): TotalSyncHouseCandidate[] {
  return [...new Map(houses.map((house) => [house.id, house])).values()];
}

export function missingRequiredTotalSyncHouseTypes(
  houses: TotalSyncHouseCandidate[],
): RequiredTotalSyncHouseType[] {
  const available = new Set(
    uniqueHouseCandidates(houses)
      .map((house) => requiredTotalSyncHouseType(house.houseType))
      .filter((houseType): houseType is RequiredTotalSyncHouseType => Boolean(houseType)),
  );
  return REQUIRED_TOTAL_SYNC_HOUSE_TYPES.filter(
    (houseType) => !available.has(houseType),
  );
}

export function pickBalancedTotalSyncHouseIds(
  houses: TotalSyncHouseCandidate[],
  count = TOTAL_SYNC_LISTINGS_PER_ADDRESS,
  random: () => number = Math.random,
): string[] {
  const candidates = uniqueHouseCandidates(houses);
  if (count < REQUIRED_TOTAL_SYNC_HOUSE_TYPES.length) {
    throw new Error(
      "Der Totalabgleich benötigt mindestens einen Platz für Einfamilienhaus, Bungalow und Zweifamilienhaus.",
    );
  }
  if (candidates.length < count) {
    throw new Error(
      `Für den Totalabgleich werden mindestens ${count} geeignete Haustypen benötigt.`,
    );
  }

  const missingHouseTypes = missingRequiredTotalSyncHouseTypes(candidates);
  if (missingHouseTypes.length) {
    throw new Error(
      `Für den Totalabgleich fehlt mindestens ein uploadfähiger Haustyp: ${missingHouseTypes.join(", ")}.`,
    );
  }

  const selectedIds = REQUIRED_TOTAL_SYNC_HOUSE_TYPES.map((requiredType) => {
    const matching = candidates.filter(
      (house) => requiredTotalSyncHouseType(house.houseType) === requiredType,
    );
    const selectedIndex = Math.floor(
      Math.min(0.999999999, Math.max(0, random())) * matching.length,
    );
    return matching[selectedIndex].id;
  });
  const selected = new Set(selectedIds);
  const remainingIds = candidates
    .map((house) => house.id)
    .filter((houseId) => !selected.has(houseId));
  selectedIds.push(
    ...pickRandomHouseIds(remainingIds, count - selectedIds.length, random),
  );
  return pickRandomHouseIds(selectedIds, count, random);
}

export function createTotalSyncRun(input: {
  projects: ProjectInput[];
  eligibleHouses: TotalSyncHouseCandidate[];
  scope: TotalSyncScope;
  providerNumber?: string;
  existingExternalIds?: string[];
  projectIds?: string[];
  kind?: TotalSyncRunKind;
  promotionImageCount?: number;
  portalPublicationEnabled?: boolean;
  aiModel?: AiModelId;
  runId: string;
  createdAt: string;
  random?: () => number;
}): TotalSyncRun {
  const selectedProjectIds = input.projectIds
    ? new Set(input.projectIds)
    : undefined;
  const scopedProjects = projectsInTotalSyncScope(input.projects, input.scope)
    .filter((project) => !selectedProjectIds || selectedProjectIds.has(project.id));
  const readyProjects = scopedProjects.filter(projectIsReadyForTotalSync);
  if (!readyProjects.length) {
    throw new Error("Für den Totalabgleich wurde keine vollständige Grundstücksadresse gefunden.");
  }
  const normalizedProviderNumber = normalizeProviderNumber(input.providerNumber ?? "");
  const allocatedExternalIds = normalizedProviderNumber
    ? allocateProviderExternalIds(
        normalizedProviderNumber,
        input.existingExternalIds ?? [],
        readyProjects.length * TOTAL_SYNC_LISTINGS_PER_ADDRESS,
      )
    : [];
  let nextExternalIdIndex = 0;
  return {
    id: input.runId,
    kind: input.kind ?? "total-sync",
    scope: input.scope,
    providerNumber: normalizedProviderNumber || undefined,
    promotionImageCount: Math.min(
      TOTAL_SYNC_LISTINGS_PER_ADDRESS,
      Math.max(0, Math.floor(Number(input.promotionImageCount) || 0)),
    ),
    portalPublicationEnabled: input.portalPublicationEnabled === true,
    aiModel: input.aiModel,
    createdAt: input.createdAt,
    status: "ready",
    skippedProjectCount: scopedProjects.length - readyProjects.length,
    updatedAt: input.createdAt,
    attempts: [],
    tasks: readyProjects.map((project) => {
      const previousHouseIds = new Set([
        ...project.selectedHouseIds,
        ...project.listings.map((listing) => listing.templateId),
      ]);
      const eligibleHouses = uniqueHouseCandidates(input.eligibleHouses);
      const unusedHouses = eligibleHouses.filter(
        (house) => !previousHouseIds.has(house.id),
      );
      if (
        input.kind === "seven-day"
        && unusedHouses.length < TOTAL_SYNC_LISTINGS_PER_ADDRESS
      ) {
        throw new Error(
          `Für „${project.name}“ stehen nicht vier neue Haustypen zur Verfügung. Bitte weitere geeignete Haustypen mit Bildern anlegen.`,
        );
      }
      const houseIds = input.kind === "seven-day"
        ? pickRandomHouseIds(
            unusedHouses.map((house) => house.id),
            TOTAL_SYNC_LISTINGS_PER_ADDRESS,
            input.random,
          )
        : pickBalancedTotalSyncHouseIds(
            eligibleHouses,
            TOTAL_SYNC_LISTINGS_PER_ADDRESS,
            input.random,
          );
      return {
        projectId: project.id,
        houseIds,
        generated: false,
        uploadedExternalIds: [],
        listingJobs: houseIds.map((houseId, index) => ({
          id: `${project.id}:${index + 1}`,
          externalId: normalizedProviderNumber
            ? allocatedExternalIds[nextExternalIdIndex++]
            : totalSyncExternalId(input.runId, project.id, index + 1),
          houseId,
          slot: index + 1,
          status: "pending" as const,
          attempts: [],
        })),
        previousExternalIds: project.listings.map((listing) => listing.externalId),
        protectedLocation: snapshotProtectedProjectLocation(project),
      };
    }),
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
    (sum, task) => {
      const jobIds = task.listingJobs
        ?.filter((job) => job.status === "uploaded")
        .map((job) => job.externalId) ?? [];
      return sum + new Set([...task.uploadedExternalIds, ...jobIds]).size;
    },
    0,
  );
  const completedProjects = run.tasks.filter(
    (task) => {
      const uploadedIds = new Set([
        ...task.uploadedExternalIds,
        ...(task.listingJobs
          ?.filter((job) => job.status === "uploaded")
          .map((job) => job.externalId) ?? []),
      ]);
      return uploadedIds.size === task.houseIds.length;
    },
  ).length;
  return { total, generated, uploaded, completedProjects };
}

export function totalSyncCanResume(run: TotalSyncRun | undefined): boolean {
  if (!run || run.status === "completed") return false;
  return run.tasks.length > 0;
}
