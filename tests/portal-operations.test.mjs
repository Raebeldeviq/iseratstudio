import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_AUTOMATIC_PORTAL_ATTEMPTS,
  duePortalOperations,
  portalOperationFailed,
  portalOperationSucceeded,
  portalReportConfirmed,
  portalSyncHealth,
  schedulePortalDesiredState,
  schedulePortalUpdate,
} from "../app/lib/portal-operations.ts";

function stateWithPortal(portal, options = {}) {
  return {
    projects: [{
      id: "project-1",
      listings: [{
        id: "listing-1",
        uploadedAt: options.uploadedAt,
        management: {
          released: options.released ?? true,
          details: { transferOnSave: options.transferOnSave ?? true },
          portals: [portal],
        },
      }],
    }],
  };
}

test("schedules publication and updates only when they become due", () => {
  const scheduled = schedulePortalDesiredState({
    portalId: "immoscout24",
    enabled: false,
    status: "not-transferred",
  }, true, "2026-07-29T10:00:00.000Z");

  assert.deepEqual(
    duePortalOperations(
      stateWithPortal(scheduled),
      new Date("2026-07-29T10:00:00.000Z"),
    ),
    [{ listingId: "listing-1", kind: "publish" }],
  );

  const delayed = schedulePortalUpdate(
    { ...scheduled, status: "online", nextRetryAt: undefined },
    "2026-07-29T10:00:00.000Z",
  );
  assert.deepEqual(
    duePortalOperations(
      stateWithPortal(delayed, { uploadedAt: "2026-07-28T10:00:00.000Z" }),
      new Date("2026-07-29T10:00:59.000Z"),
    ),
    [],
  );
  assert.deepEqual(
    duePortalOperations(
      stateWithPortal(delayed, { uploadedAt: "2026-07-28T10:00:00.000Z" }),
      new Date("2026-07-29T10:01:00.000Z"),
    ),
    [{ listingId: "listing-1", kind: "update" }],
  );
});

test("tracks desired and actual portal states through transfer and report confirmation", () => {
  const scheduled = schedulePortalDesiredState({
    portalId: "immoscout24",
    enabled: false,
    status: "not-transferred",
  }, true, "2026-07-29T10:00:00.000Z");
  const transferred = portalOperationSucceeded(
    scheduled,
    "publish",
    "2026-07-29T10:00:10.000Z",
    "Paket übertragen.",
  );
  assert.equal(transferred.status, "transferred");
  assert.equal(portalSyncHealth(transferred), "pending");
  assert.equal(transferred.operationLog[0].status, "succeeded");

  const confirmed = portalReportConfirmed(
    { ...transferred, status: "online" },
    "2026-07-29T10:02:00.000Z",
    "Portal meldet online.",
  );
  assert.equal(portalSyncHealth(confirmed), "synchronized");
  assert.equal(confirmed.retryCount, 0);
  assert.equal(confirmed.operationLog[0].kind, "status-report");
  assert.equal(confirmed.operationLog[0].status, "confirmed");
});

test("uses staggered retries and stops automatic retry after the configured limit", () => {
  let portal = schedulePortalDesiredState({
    portalId: "immowelt",
    enabled: false,
    status: "not-transferred",
  }, true, "2026-07-29T10:00:00.000Z");
  const expectedRetryTimes = [
    "2026-07-29T10:01:00.000Z",
    "2026-07-29T10:06:00.000Z",
    "2026-07-29T10:21:00.000Z",
    undefined,
  ];

  for (let index = 0; index < MAX_AUTOMATIC_PORTAL_ATTEMPTS; index += 1) {
    const at = index === 0
      ? "2026-07-29T10:00:00.000Z"
      : expectedRetryTimes[index - 1];
    portal = portalOperationFailed(portal, "publish", at, `Fehler ${index + 1}`);
    assert.equal(portal.retryCount, index + 1);
    assert.equal(portal.nextRetryAt, expectedRetryTimes[index]);
  }

  assert.deepEqual(
    duePortalOperations(
      stateWithPortal(portal),
      new Date("2026-07-29T12:00:00.000Z"),
    ),
    [],
  );
  assert.equal(portal.operationLog.filter((entry) => entry.status === "failed").length, 4);
});

test("queues a deletion for an already transferred portal", () => {
  const portal = schedulePortalDesiredState({
    portalId: "kleinanzeigen",
    enabled: true,
    status: "online",
  }, false, "2026-07-29T11:00:00.000Z");

  assert.deepEqual(
    duePortalOperations(
      stateWithPortal(portal, { uploadedAt: "2026-07-28T10:00:00.000Z" }),
      new Date("2026-07-29T11:00:00.000Z"),
    ),
    [{ listingId: "listing-1", kind: "delete" }],
  );
});
