import type { ProjectInput } from "../types";
import { legacyUserId, projectResponsibleUserId } from "./responsibility.ts";

export type AddressOwnerFilter = string;
export type AddressCompletenessFilter = "all" | "complete" | "incomplete";
export type AddressUploadFilter = "all" | "recent" | "older" | "never";
export type AddressCatalogSort = "city" | "zip" | "upload-newest" | "upload-oldest";

export type AddressCatalogFilters = {
  query: string;
  city: string;
  zip: string;
  owner: AddressOwnerFilter;
  completeness: AddressCompletenessFilter;
  upload: AddressUploadFilter;
  sort: AddressCatalogSort;
  responsibilityLabels?: Record<string, string>;
};

const GERMAN_COLLATOR = new Intl.Collator("de", {
  numeric: true,
  sensitivity: "base",
});
const BERLIN_DATE_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function timestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalized(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .toLocaleLowerCase("de-DE")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

function berlinDayNumber(value: Date | number): number {
  const date = typeof value === "number" ? new Date(value) : value;
  const parts = BERLIN_DATE_PARTS.formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

export function addressProjectIsComplete(project: ProjectInput): boolean {
  return Boolean(
    project.street.trim()
    && project.houseNumber.trim()
    && project.zip.trim()
    && project.city.trim()
    && Number(project.plotArea) > 0
    && Number(project.plotPrice) > 0,
  );
}

export function missingAddressFields(project: ProjectInput): string[] {
  const missing: string[] = [];
  if (!project.street.trim()) missing.push("Straße");
  if (!project.houseNumber.trim()) missing.push("Hausnummer");
  if (!project.zip.trim()) missing.push("PLZ");
  if (!project.city.trim()) missing.push("Ort");
  if (!(Number(project.plotArea) > 0)) missing.push("Grundstücksfläche");
  if (!(Number(project.plotPrice) > 0)) missing.push("Grundstückspreis");
  return missing;
}

export function projectLastUploadAt(project: ProjectInput): string | undefined {
  const candidates = [
    project.lastRenewedAt,
    project.lastTotalSyncAt,
    ...project.listings.map((listing) => listing.uploadedAt),
    ...(project.renewalHistory ?? []).map((entry) => entry.completedAt),
  ]
    .map(timestamp)
    .filter((value): value is number => value !== undefined);

  if (!candidates.length) return undefined;
  return new Date(Math.max(...candidates)).toISOString();
}

export function addressCatalogCities(projects: ProjectInput[]): string[] {
  return Array.from(new Set(
    projects
      .map((project) => project.city.trim())
      .filter(Boolean),
  )).sort((left, right) => GERMAN_COLLATOR.compare(left, right));
}

function germanDateSearchValue(value: string | undefined): string {
  const parsed = timestamp(value);
  if (parsed === undefined) return "";
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(parsed));
}

function uploadFilterMatches(
  project: ProjectInput,
  filter: AddressUploadFilter,
  now: Date,
): boolean {
  if (filter === "all") return true;
  const lastUploadAt = projectLastUploadAt(project);
  const uploadedAt = timestamp(lastUploadAt);
  if (filter === "never") return uploadedAt === undefined;
  if (uploadedAt === undefined) return false;
  const ageInBerlinCalendarDays = berlinDayNumber(now) - berlinDayNumber(uploadedAt);
  if (filter === "recent") return ageInBerlinCalendarDays <= 7;
  return ageInBerlinCalendarDays > 7;
}

function compareCatalogText(left: string, right: string): number {
  const leftValue = left.trim();
  const rightValue = right.trim();
  if (!leftValue && rightValue) return 1;
  if (leftValue && !rightValue) return -1;
  return GERMAN_COLLATOR.compare(leftValue, rightValue);
}

function compareAddressProjects(
  left: ProjectInput,
  right: ProjectInput,
  sort: AddressCatalogSort,
): number {
  if (sort === "upload-newest" || sort === "upload-oldest") {
    const leftUpload = timestamp(projectLastUploadAt(left));
    const rightUpload = timestamp(projectLastUploadAt(right));
    if (leftUpload === undefined && rightUpload !== undefined) return 1;
    if (leftUpload !== undefined && rightUpload === undefined) return -1;
    if (leftUpload !== undefined && rightUpload !== undefined && leftUpload !== rightUpload) {
      return sort === "upload-newest"
        ? rightUpload - leftUpload
        : leftUpload - rightUpload;
    }
  }

  const leftValues = sort === "zip"
    ? [left.zip, left.city, left.street, left.houseNumber, left.name]
    : [left.city, left.zip, left.street, left.houseNumber, left.name];
  const rightValues = sort === "zip"
    ? [right.zip, right.city, right.street, right.houseNumber, right.name]
    : [right.city, right.zip, right.street, right.houseNumber, right.name];

  for (let index = 0; index < leftValues.length; index += 1) {
    const compared = compareCatalogText(leftValues[index], rightValues[index]);
    if (compared !== 0) return compared;
  }
  return GERMAN_COLLATOR.compare(left.id, right.id);
}

export function filterAddressProjects(
  projects: ProjectInput[],
  filters: AddressCatalogFilters,
  now = new Date(),
): ProjectInput[] {
  const query = normalized(filters.query);
  const city = normalized(filters.city);
  const zip = normalized(filters.zip);
  const ownerFilter = filters.owner === "all"
    ? "all"
    : legacyUserId(filters.owner) ?? filters.owner;

  return projects
    .filter((project) => {
      const complete = addressProjectIsComplete(project);
      const owner = projectResponsibleUserId(project) ?? "";
      const lastUploadAt = projectLastUploadAt(project);
      const searchValue = normalized([
        project.name,
        project.street,
        project.houseNumber,
        project.zip,
        project.city,
        project.district,
        owner,
        filters.responsibilityLabels?.[owner],
        complete ? "vollständig" : "unvollständig",
        lastUploadAt?.slice(0, 10),
        germanDateSearchValue(lastUploadAt),
      ].filter(Boolean).join(" "));

      const queryMatches = !query || query
        .split(/\s+/)
        .filter(Boolean)
        .every((token) => searchValue.includes(token));

      return queryMatches
        && (!city || normalized(project.city) === city)
        && (!zip || normalized(project.zip).includes(zip))
        && (ownerFilter === "all" || owner === ownerFilter)
        && (
          filters.completeness === "all"
          || (filters.completeness === "complete" ? complete : !complete)
        )
        && uploadFilterMatches(project, filters.upload, now);
    })
    .sort((left, right) => compareAddressProjects(left, right, filters.sort));
}

export function paginateAddressProjects(
  projects: ProjectInput[],
  requestedPage: number,
  requestedPageSize: number,
): {
  items: ProjectInput[];
  page: number;
  pageCount: number;
  total: number;
} {
  const pageSize = Math.max(1, Math.floor(requestedPageSize) || 1);
  const pageCount = Math.max(1, Math.ceil(projects.length / pageSize));
  const page = Math.min(pageCount, Math.max(1, Math.floor(requestedPage) || 1));
  const start = (page - 1) * pageSize;
  return {
    items: projects.slice(start, start + pageSize),
    page,
    pageCount,
    total: projects.length,
  };
}
