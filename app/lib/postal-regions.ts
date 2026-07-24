import type { ProjectInput } from "../types";

export type PostalRegion = {
  federalState: string;
  county: string;
};

export type PostalRegionEntry = readonly [
  normalizedPlace: string,
  federalState: string,
  county: string,
];

export type PostalRegionIndex = Record<string, readonly PostalRegionEntry[]>;

type PostalRegionFile = {
  regions: PostalRegionIndex;
};

let postalRegionIndexPromise: Promise<PostalRegionIndex> | null = null;

function normalizePlace(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("de-DE")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");
}

function uniqueRegion(entries: readonly PostalRegionEntry[]): PostalRegion | null {
  const regions = new Map<string, PostalRegion>();
  entries.forEach(([, federalState, county]) => {
    const key = `${federalState}\u0000${county}`;
    regions.set(key, { federalState, county });
  });
  return regions.size === 1 ? [...regions.values()][0] : null;
}

export function resolvePostalRegion(
  index: PostalRegionIndex,
  zip: string,
  city: string,
): PostalRegion | null {
  if (!/^\d{5}$/.test(zip)) return null;
  const entries = index[zip] ?? [];
  if (!entries.length) return null;

  const normalizedCity = normalizePlace(city);
  if (normalizedCity) {
    const exactMatches = entries.filter(([place]) => place === normalizedCity);
    const exactRegion = uniqueRegion(exactMatches);
    if (exactRegion) return exactRegion;
  }

  return uniqueRegion(entries);
}

export function enrichProjectWithPostalRegion(
  project: ProjectInput,
  index: PostalRegionIndex,
): ProjectInput {
  const region = resolvePostalRegion(index, project.zip, project.city);
  return {
    ...project,
    federalState: region?.federalState ?? "",
    county: region?.county ?? "",
  };
}

export function compareProjectsByRegion(left: ProjectInput, right: ProjectInput): number {
  const collator = new Intl.Collator("de-DE", { numeric: true, sensitivity: "base" });
  const leftRegion = [left.federalState || "\uffff", left.county || "\uffff", left.zip, left.city, left.street];
  const rightRegion = [right.federalState || "\uffff", right.county || "\uffff", right.zip, right.city, right.street];
  for (let index = 0; index < leftRegion.length; index += 1) {
    const compared = collator.compare(leftRegion[index], rightRegion[index]);
    if (compared !== 0) return compared;
  }
  return 0;
}

export function projectRegionLabel(project: ProjectInput): string {
  if (!project.federalState && !project.county) return "Ohne PLZ-Zuordnung";
  return [project.federalState, project.county].filter(Boolean).join(" · ");
}

export type ProjectRegionGroup = {
  label: string;
  projects: ProjectInput[];
};

export function groupProjectsByRegion(projects: readonly ProjectInput[]): ProjectRegionGroup[] {
  const groups = new Map<string, ProjectInput[]>();
  [...projects].sort(compareProjectsByRegion).forEach((project) => {
    const label = projectRegionLabel(project);
    groups.set(label, [...(groups.get(label) ?? []), project]);
  });
  return [...groups.entries()].map(([label, groupedProjects]) => ({
    label,
    projects: groupedProjects,
  }));
}

export async function loadPostalRegionIndex(): Promise<PostalRegionIndex> {
  if (!postalRegionIndexPromise) {
    postalRegionIndexPromise = fetch("/data/de-postal-regions.json", { cache: "force-cache" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`PLZ-Datensatz konnte nicht geladen werden (${response.status}).`);
        const data = await response.json() as PostalRegionFile;
        if (!data?.regions || typeof data.regions !== "object") {
          throw new Error("Der lokale PLZ-Datensatz ist ungültig.");
        }
        return data.regions;
      })
      .catch((error) => {
        postalRegionIndexPromise = null;
        throw error;
      });
  }
  return postalRegionIndexPromise;
}
