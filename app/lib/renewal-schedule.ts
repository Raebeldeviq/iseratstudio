import type {
  ProjectInput,
  TotalSyncScope,
} from "../types";

export const RENEWAL_INTERVAL_DAYS = 7;
export const RENEWAL_LISTINGS_PER_ADDRESS = 4;

export type RenewalStatus = "today" | "upcoming" | "overdue";
export type RenewalAnchorSource =
  | "renewal"
  | "total-sync"
  | "complete-listing-upload"
  | "unknown";

export type RenewalScheduleEntry = {
  project: ProjectInput;
  status: RenewalStatus;
  anchorSource: RenewalAnchorSource;
  lastRenewedAt?: string;
  dueDate?: string;
  daysUntilDue: number;
  untracked: boolean;
};

const BERLIN_DATE_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function validTimestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function berlinDayNumber(value: Date | string): number {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = BERLIN_DATE_PARTS.formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function dayNumberToDateKey(dayNumber: number): string {
  return new Date(dayNumber * 86_400_000).toISOString().slice(0, 10);
}

export function renewalAnchor(project: ProjectInput): {
  at?: string;
  source: RenewalAnchorSource;
} {
  const explicit = validTimestamp(project.lastRenewedAt);
  if (explicit !== undefined) {
    return { at: new Date(explicit).toISOString(), source: "renewal" };
  }

  const totalSync = validTimestamp(project.lastTotalSyncAt);
  if (totalSync !== undefined) {
    return { at: new Date(totalSync).toISOString(), source: "total-sync" };
  }

  if (project.listings.length === RENEWAL_LISTINGS_PER_ADDRESS) {
    const uploads = project.listings.map((listing) => validTimestamp(listing.uploadedAt));
    if (uploads.every((timestamp): timestamp is number => timestamp !== undefined)) {
      const earliestUpload = Math.min(...uploads);
      return {
        at: new Date(earliestUpload).toISOString(),
        source: "complete-listing-upload",
      };
    }
  }

  return { source: "unknown" };
}

export function classifyRenewal(
  project: ProjectInput,
  now = new Date(),
): RenewalScheduleEntry {
  const anchor = renewalAnchor(project);
  if (!anchor.at) {
    return {
      project,
      status: "today",
      anchorSource: "unknown",
      daysUntilDue: 0,
      untracked: true,
    };
  }

  const today = berlinDayNumber(now);
  const dueDay = berlinDayNumber(anchor.at) + RENEWAL_INTERVAL_DAYS;
  const daysUntilDue = dueDay - today;
  return {
    project,
    status: daysUntilDue < 0 ? "overdue" : daysUntilDue === 0 ? "today" : "upcoming",
    anchorSource: anchor.source,
    lastRenewedAt: anchor.at,
    dueDate: dayNumberToDateKey(dueDay),
    daysUntilDue,
    untracked: false,
  };
}

export function buildRenewalSchedule(
  projects: ProjectInput[],
  now = new Date(),
  scope: TotalSyncScope = "all",
): RenewalScheduleEntry[] {
  const entries = projects
    .filter((project) => (
      scope === "all" || (project.owner === "pascal" ? "pascal" : "fabian") === scope
    ))
    .map((project) => classifyRenewal(project, now));

  return entries.sort((left, right) => {
    if (left.untracked !== right.untracked) return left.untracked ? -1 : 1;
    if (left.daysUntilDue !== right.daysUntilDue) {
      return left.daysUntilDue - right.daysUntilDue;
    }
    return left.project.city.localeCompare(right.project.city, "de");
  });
}

export function formatRenewalDate(dateKeyOrIso: string | undefined): string {
  if (!dateKeyOrIso) return "Datum unbekannt";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateKeyOrIso)
    ? new Date(`${dateKeyOrIso}T12:00:00.000Z`)
    : new Date(dateKeyOrIso);
  if (!Number.isFinite(date.getTime())) return "Datum unbekannt";
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}
