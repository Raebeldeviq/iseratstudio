import type {
  GeneratedListing,
  ImportReportEvent,
  ImportReportRecord,
  ListingPortalState,
  ListingPortalStatus,
  PortalConfiguration,
  StudioState,
} from "../types";
import {
  appendAuditLog,
  deriveListingLifecycle,
  mapListing,
} from "./management.ts";

const EXTERNAL_ID_PATTERN = /\b[A-Z0-9]{2,}(?:[-_/][A-Z0-9]+)*-\d{3,}\b/gi;

function uid(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function decodeEntities(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function portalFromText(
  value: string,
  portals: PortalConfiguration[],
): string | undefined {
  const normalized = value.toLocaleLowerCase("de-DE");
  const aliases: Record<string, string[]> = {
    immoscout24: ["immoscout", "immo scout", "is24", "scout24"],
    immowelt: ["immowelt", "immonet"],
    kleinanzeigen: ["kleinanzeigen", "ebay"],
    livinghaus: ["livinghaus", "living haus"],
  };
  for (const portal of portals) {
    const candidates = [
      portal.id,
      portal.name,
      ...(aliases[portal.id] ?? []),
    ].map((item) => item.toLocaleLowerCase("de-DE"));
    if (candidates.some((candidate) => normalized.includes(candidate))) return portal.id;
  }
  return undefined;
}

function statusFromText(value: string): ListingPortalStatus {
  const normalized = value.toLocaleLowerCase("de-DE");
  if (/(gelösch|geloesch|deleted|delete erfolgreich|entfernt)/.test(normalized)) {
    return "deleted";
  }
  if (/(löschauftrag|loeschauftrag|delete.request|zur löschung|zur loeschung)/.test(normalized)) {
    return "delete-requested";
  }
  if (/(fehler|error|failed|abgelehnt|ungültig|ungueltig|nicht erfolgreich)/.test(normalized)) {
    return "error";
  }
  if (/(online|veröffentlicht|veroeffentlicht|published|live)/.test(normalized)) {
    return "online";
  }
  if (/(warteschlange|queued|vorgemerkt)/.test(normalized)) return "queued";
  return "transferred";
}

function compactMessage(value: string): string {
  return decodeEntities(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

export function parseImportReport(
  content: string,
  portals: PortalConfiguration[],
): ImportReportEvent[] {
  const normalizedContent = content.replace(/\r\n?/g, "\n");
  const lines = normalizedContent
    .split(/\n|(?<=})\s*(?={)|(?<=;)\s*/g)
    .map((line) => line.trim())
    .filter(Boolean);
  const events = new Map<string, ImportReportEvent>();

  const addMatches = (text: string, context: string) => {
    const ids = text.match(EXTERNAL_ID_PATTERN) ?? [];
    for (const externalId of ids) {
      const portalId = portalFromText(context, portals);
      const status = statusFromText(context);
      const key = `${externalId.toUpperCase()}:${portalId ?? "all"}`;
      events.set(key, {
        externalId,
        portalId,
        status,
        message: compactMessage(context) || `Importstatus: ${status}`,
      });
    }
  };

  lines.forEach((line, index) => {
    const context = [lines[index - 1], line, lines[index + 1]]
      .filter(Boolean)
      .join(" ");
    addMatches(line, context);
  });

  if (!events.size) {
    let match: RegExpExecArray | null;
    EXTERNAL_ID_PATTERN.lastIndex = 0;
    while ((match = EXTERNAL_ID_PATTERN.exec(normalizedContent)) !== null) {
      const start = Math.max(0, match.index - 220);
      const end = Math.min(normalizedContent.length, match.index + match[0].length + 220);
      addMatches(match[0], normalizedContent.slice(start, end));
    }
  }

  return [...events.values()];
}

function updatePortal(
  portal: ListingPortalState,
  event: ImportReportEvent,
  importedAt: string,
): ListingPortalState {
  return {
    ...portal,
    status: event.status,
    lastReportAt: importedAt,
    lastTransferAt: event.status === "transferred" || event.status === "online"
      ? portal.lastTransferAt ?? importedAt
      : portal.lastTransferAt,
    message: event.message,
  };
}

function applyEventToListing(
  listing: GeneratedListing,
  event: ImportReportEvent,
  importedAt: string,
): GeneratedListing {
  if (!listing.management) return listing;
  const portals = listing.management.portals.map((portal) => (
    !event.portalId || portal.portalId === event.portalId
      ? updatePortal(portal, event, importedAt)
      : portal
  ));
  const management = {
    ...listing.management,
    portals,
    updatedAt: importedAt,
  };
  return {
    ...listing,
    management: {
      ...management,
      lifecycle: deriveListingLifecycle(management, listing.uploadedAt),
    },
  };
}

export function applyImportReport(
  state: StudioState,
  filename: string,
  events: ImportReportEvent[],
  importedAt = new Date().toISOString(),
): {
  state: StudioState;
  record: ImportReportRecord;
  matchedCount: number;
} {
  let next = state;
  let matchedCount = 0;
  for (const event of events) {
    const match = state.projects
      .flatMap((project) => project.listings)
      .find((listing) => (
        listing.externalId.trim().toUpperCase() === event.externalId.trim().toUpperCase()
      ));
    if (!match) continue;
    matchedCount += 1;
    next = mapListing(next, match.id, (listing) => (
      applyEventToListing(listing, event, importedAt)
    ));
  }

  const record: ImportReportRecord = {
    id: `report-${uid()}`,
    filename,
    importedAt,
    eventCount: events.length,
    matchedCount,
    events,
  };
  if (next.management) {
    next = {
      ...next,
      management: {
        ...next.management,
        importReports: [record, ...next.management.importReports].slice(0, 100),
        portals: next.management.portals.map((portal) => {
          const online = next.projects
            .flatMap((project) => project.listings)
            .filter((listing) => (
              listing.management?.portals.some((item) => (
                item.portalId === portal.id && item.status === "online"
              ))
            )).length;
          return {
            ...portal,
            currentOnline: online,
            lastSyncAt: importedAt,
          };
        }),
      },
    };
  }
  next = appendAuditLog(next, {
    action: "Importbericht eingelesen",
    targetType: "report",
    targetId: record.id,
    description: `${filename}: ${matchedCount} von ${events.length} Ereignissen zugeordnet`,
  }, importedAt);
  return { state: next, record, matchedCount };
}
