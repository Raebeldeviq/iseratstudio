import type {
  ListingPortalState,
  PortalOperationKind,
  PortalOperationLog,
  StudioState,
} from "../types";

export const MAX_AUTOMATIC_PORTAL_ATTEMPTS = 4;
const RETRY_DELAYS_MINUTES = [1, 5, 15, 60];

function uid(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function appendOperation(
  portal: ListingPortalState,
  input: Omit<PortalOperationLog, "id">,
): PortalOperationLog[] {
  return [
    { id: `portal-operation-${uid()}`, ...input },
    ...(portal.operationLog ?? []),
  ].slice(0, 25);
}

export function portalDesiredStatus(
  portal: ListingPortalState,
): "online" | "deleted" {
  return portal.desiredStatus ?? (portal.enabled ? "online" : "deleted");
}

export function portalSyncHealth(
  portal: ListingPortalState,
): "synchronized" | "pending" | "error" {
  const desired = portalDesiredStatus(portal);
  if (portal.status === "error") return "error";
  if (
    (desired === "online" && portal.status === "online")
    || (
      desired === "deleted"
      && (portal.status === "deleted" || portal.status === "not-transferred")
    )
  ) return "synchronized";
  return "pending";
}

export function schedulePortalDesiredState(
  portal: ListingPortalState,
  enabled: boolean,
  at = new Date().toISOString(),
): ListingPortalState {
  return {
    ...portal,
    enabled,
    desiredStatus: enabled ? "online" : "deleted",
    retryCount: 0,
    nextRetryAt: at,
    message: enabled
      ? "Zur automatischen Portalübertragung vorgemerkt."
      : "Zur automatischen Portallöschung vorgemerkt.",
  };
}

export function schedulePortalUpdate(
  portal: ListingPortalState,
  at = new Date().toISOString(),
  delayMs = 60_000,
): ListingPortalState {
  if (!portal.enabled || portalDesiredStatus(portal) !== "online") return portal;
  return {
    ...portal,
    retryCount: 0,
    nextRetryAt: new Date(new Date(at).getTime() + delayMs).toISOString(),
    message: "Objektänderung wird nach der Bearbeitung automatisch übertragen.",
  };
}

export function portalOperationStarted(
  portal: ListingPortalState,
  kind: Exclude<PortalOperationKind, "status-report">,
  at: string,
): ListingPortalState {
  const attempt = (portal.retryCount ?? 0) + 1;
  return {
    ...portal,
    status: "queued",
    lastAttemptAt: at,
    nextRetryAt: undefined,
    message: kind === "delete"
      ? "Löschauftrag wird übertragen."
      : "OpenImmo-Übertragung wird ausgeführt.",
    operationLog: appendOperation(portal, {
      kind,
      status: "running",
      at,
      attempt,
      message: kind === "delete"
        ? "Automatischer Löschauftrag gestartet."
        : "Automatische Portalübertragung gestartet.",
    }),
  };
}

export function portalOperationSucceeded(
  portal: ListingPortalState,
  kind: Exclude<PortalOperationKind, "status-report">,
  at: string,
  message: string,
): ListingPortalState {
  const attempt = (portal.retryCount ?? 0) + 1;
  return {
    ...portal,
    status: kind === "delete" ? "delete-requested" : "transferred",
    retryCount: 0,
    nextRetryAt: undefined,
    lastAttemptAt: at,
    lastSuccessAt: at,
    lastTransferAt: at,
    message,
    operationLog: appendOperation(portal, {
      kind,
      status: "succeeded",
      at,
      attempt,
      message,
    }),
  };
}

export function portalOperationFailed(
  portal: ListingPortalState,
  kind: Exclude<PortalOperationKind, "status-report">,
  at: string,
  message: string,
): ListingPortalState {
  const retryCount = Math.min(
    MAX_AUTOMATIC_PORTAL_ATTEMPTS,
    (portal.retryCount ?? 0) + 1,
  );
  const delayMinutes = RETRY_DELAYS_MINUTES[Math.min(
    retryCount - 1,
    RETRY_DELAYS_MINUTES.length - 1,
  )];
  const nextRetryAt = retryCount < MAX_AUTOMATIC_PORTAL_ATTEMPTS
    ? new Date(new Date(at).getTime() + delayMinutes * 60_000).toISOString()
    : undefined;
  return {
    ...portal,
    status: "error",
    retryCount,
    nextRetryAt,
    lastAttemptAt: at,
    message,
    operationLog: appendOperation(portal, {
      kind,
      status: "failed",
      at,
      attempt: retryCount,
      message,
    }),
  };
}

export function portalReportConfirmed(
  portal: ListingPortalState,
  at: string,
  message: string,
): ListingPortalState {
  const failed = portal.status === "error";
  const next = failed
    ? portalOperationFailed(portal, portalDesiredStatus(portal) === "deleted"
        ? "delete"
        : "update", at, message)
    : {
        ...portal,
        retryCount: 0,
        nextRetryAt: undefined,
        lastSuccessAt: at,
      };
  return {
    ...next,
    operationLog: appendOperation(next, {
      kind: "status-report",
      status: failed ? "failed" : "confirmed",
      at,
      attempt: next.retryCount ?? 0,
      message,
    }),
  };
}

export type DuePortalOperation = {
  listingId: string;
  kind: "publish" | "update" | "delete";
};

export function duePortalOperations(
  state: StudioState,
  now = new Date(),
): DuePortalOperation[] {
  const nowMs = now.getTime();
  const operations = new Map<string, DuePortalOperation>();
  for (const project of state.projects) {
    for (const listing of project.listings) {
      if (!listing.management || listing.management.archivedAt) continue;
      for (const portal of listing.management.portals) {
        const desired = portalDesiredStatus(portal);
        const retryDue = !portal.nextRetryAt
          || new Date(portal.nextRetryAt).getTime() <= nowMs;
        if (!retryDue || (portal.retryCount ?? 0) >= MAX_AUTOMATIC_PORTAL_ATTEMPTS) {
          continue;
        }
        const explicitlyScheduled = Boolean(portal.nextRetryAt);
        if (
          desired === "online"
          && listing.management.released
          && listing.management.details.transferOnSave
          && portal.status !== "queued"
          && (
            portal.status === "error"
            || (explicitlyScheduled && portal.status !== "delete-requested")
          )
        ) {
          operations.set(listing.id, {
            listingId: listing.id,
            kind: listing.uploadedAt ? "update" : "publish",
          });
        }
        if (
          desired === "deleted"
          && portal.status !== "deleted"
          && portal.status !== "not-transferred"
          && portal.status !== "delete-requested"
          && explicitlyScheduled
        ) {
          operations.set(listing.id, { listingId: listing.id, kind: "delete" });
        }
      }
    }
  }
  return [...operations.values()];
}
