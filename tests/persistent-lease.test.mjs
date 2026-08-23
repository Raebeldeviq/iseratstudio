import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createPersistentLease } from "../persistent-lease.mjs";

function timestamp(minutes) {
  return new Date(Date.parse("2026-08-22T14:34:52.091Z") + minutes * 60_000).toISOString();
}

async function fixture(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "fpi-persistent-lease-"));
  const path = join(directory, "listing-scheduler.lock");
  return {
    directory,
    path,
    lease: createPersistentLease(path, options),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

test("persistent lease acquire, monotonic renew and idempotent owner release", async (context) => {
  const runtime = await fixture({ leaseMs: 30 * 60_000, heartbeatMs: 30 * 60_000 });
  context.after(runtime.cleanup);
  const held = await runtime.lease.acquire({
    now: timestamp(0),
    token: "scheduler-run-a",
    schedulerRunId: "scheduler-run-a",
    ownerId: "listing-scheduler:41001",
    ownerPid: 41001,
    runtimeIdentity: "release-a:helper-a",
  });

  const forward = await held.refresh({ now: timestamp(25) });
  const backdated = await held.refresh({ now: timestamp(0) });
  assert.equal(forward.expiresAt, timestamp(55));
  assert.equal(backdated.expiresAt, timestamp(55));
  assert.equal(backdated.updatedAt, timestamp(25));
  assert.equal(backdated.revision, 2);
  assert.deepEqual(JSON.parse(await readFile(runtime.path, "utf8")), backdated);

  assert.deepEqual(await held.release(), { released: true, alreadyReleased: false });
  assert.deepEqual(await held.release(), { released: false, alreadyReleased: true });
  assert.equal(await runtime.lease.read(), null);
});

test("an expired lease cannot be stolen while its bound owner process is active", async (context) => {
  const options = {
    leaseMs: 60_000,
    heartbeatMs: 60_000,
    isOwnerActive: async (record) => record.ownerPid === 41002,
    assessStaleOwner: async () => ({ recoverable: true, reason: "test-only stale assessment" }),
  };
  const runtime = await fixture(options);
  context.after(runtime.cleanup);
  const contender = createPersistentLease(runtime.path, options);
  const held = await runtime.lease.acquire({
    now: timestamp(0),
    token: "scheduler-run-a",
    ownerId: "listing-scheduler:41002",
    ownerPid: 41002,
    runtimeIdentity: "release-a:helper-a",
  });

  await assert.rejects(
    contender.acquire({
      now: timestamp(2),
      token: "scheduler-run-b",
      ownerId: "listing-scheduler:41003",
      ownerPid: 41003,
      runtimeIdentity: "release-a:helper-a",
    }),
    (error) => error.code === "LISTING_SCHEDULER_LOCKED" && /aktiven Helper-Prozess/iu.test(error.message),
  );
  assert.equal((await runtime.lease.read()).schedulerRunId, "scheduler-run-a");
  await held.release();
});

test("a truly expired inactive lease is recovered once and the foreign owner loses renew and release", async (context) => {
  let firstOwnerActive = true;
  const events = [];
  const options = {
    leaseMs: 60_000,
    heartbeatMs: 60_000,
    isOwnerActive: async (record) => record.schedulerRunId === "scheduler-run-a" ? firstOwnerActive : true,
    assessStaleOwner: async (record) => ({
      recoverable: record.schedulerRunId === "scheduler-run-a",
      reason: "Owner inaktiv, Lease abgelaufen, persistenter Run unterbrochen.",
    }),
    writeEvent: async (event, details) => events.push({ event, details }),
  };
  const runtime = await fixture(options);
  context.after(runtime.cleanup);
  const contender = createPersistentLease(runtime.path, options);
  const held = await runtime.lease.acquire({
    now: timestamp(0),
    token: "scheduler-run-a",
    ownerId: "listing-scheduler:41004",
    ownerPid: 41004,
    runtimeIdentity: "release-a:helper-a",
  });
  firstOwnerActive = false;
  const recovered = await contender.acquire({
    now: timestamp(2),
    token: "scheduler-run-b",
    ownerId: "listing-scheduler:41005",
    ownerPid: 41005,
    runtimeIdentity: "release-b:helper-b",
  });

  assert.equal(recovered.record.schedulerRunId, "scheduler-run-b");
  assert.deepEqual(events.map((entry) => entry.event), ["stale-recovery-authorized", "stale-recovered"]);
  await assert.rejects(held.refresh({ now: timestamp(3) }), (error) => error.code === "LISTING_SCHEDULER_LOCK_LOST");
  await assert.rejects(held.release(), (error) => error.code === "LISTING_SCHEDULER_LOCK_LOST");
  assert.equal((await contender.read()).schedulerRunId, "scheduler-run-b");
  await recovered.release();
});

test("two parallel stale contenders cannot both acquire across the recovery boundary", async (context) => {
  const events = [];
  const options = {
    leaseMs: 60_000,
    heartbeatMs: 60_000,
    isOwnerActive: async (record) => record.schedulerRunId !== "scheduler-run-a",
    assessStaleOwner: async (record) => ({
      recoverable: record.schedulerRunId === "scheduler-run-a",
      reason: "synthetic inactive owner",
    }),
    writeEvent: async (event, details) => events.push({ event, details }),
  };
  const runtime = await fixture(options);
  context.after(runtime.cleanup);
  const original = await runtime.lease.acquire({
    now: timestamp(0),
    token: "scheduler-run-a",
    schedulerRunId: "scheduler-run-a",
    ownerId: "listing-scheduler:41020",
    ownerPid: 41020,
    runtimeIdentity: "release-a:helper-a",
  });
  const contenderA = createPersistentLease(runtime.path, options);
  const contenderB = createPersistentLease(runtime.path, options);
  const attempts = await Promise.allSettled([
    contenderA.acquire({
      now: timestamp(2),
      token: "scheduler-run-b",
      schedulerRunId: "scheduler-run-b",
      ownerId: "listing-scheduler:41021",
      ownerPid: 41021,
      runtimeIdentity: "release-b:helper-b",
    }),
    contenderB.acquire({
      now: timestamp(2),
      token: "scheduler-run-c",
      schedulerRunId: "scheduler-run-c",
      ownerId: "listing-scheduler:41022",
      ownerPid: 41022,
      runtimeIdentity: "release-c:helper-c",
    }),
  ]);
  const fulfilled = attempts.filter((entry) => entry.status === "fulfilled");
  const rejected = attempts.filter((entry) => entry.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, "LISTING_SCHEDULER_LOCKED");
  assert.equal((await runtime.lease.read()).schedulerRunId, fulfilled[0].value.record.schedulerRunId);
  assert.equal(events.filter((entry) => entry.event === "stale-recovered").length, 1);
  await fulfilled[0].value.release();
  await assert.rejects(original.release(), (error) => error.code === "LISTING_SCHEDULER_LOCK_LOST");
});

test("missing authoritative lock is critical during ownership but harmless after a completed release", async (context) => {
  const runtime = await fixture({ leaseMs: 60_000, heartbeatMs: 60_000 });
  context.after(runtime.cleanup);
  const held = await runtime.lease.acquire({
    now: timestamp(0),
    token: "scheduler-run-a",
    ownerId: "listing-scheduler:41006",
    ownerPid: 41006,
    runtimeIdentity: "release-a:helper-a",
  });
  await rm(runtime.path);
  await assert.rejects(held.refresh({ now: timestamp(1) }), (error) => error.code === "LISTING_SCHEDULER_LOCK_LOST");
  await assert.rejects(held.release(), (error) => error.code === "LISTING_SCHEDULER_LOCK_LOST");

  const next = await runtime.lease.acquire({
    now: timestamp(2),
    token: "scheduler-run-b",
    ownerId: "listing-scheduler:41007",
    ownerPid: 41007,
    runtimeIdentity: "release-a:helper-b",
  });
  await next.release();
  await next.release();
});

test("concurrent owner renewals are serialized and leave valid CAS state", async (context) => {
  const runtime = await fixture({ leaseMs: 60_000, heartbeatMs: 60_000 });
  context.after(runtime.cleanup);
  const held = await runtime.lease.acquire({
    now: timestamp(0),
    token: "scheduler-run-a",
    ownerId: "listing-scheduler:41008",
    ownerPid: 41008,
    runtimeIdentity: "release-a:helper-a",
  });
  await Promise.all(Array.from({ length: 50 }, (_, index) => held.refresh({ now: timestamp(index + 1) })));
  const current = JSON.parse(await readFile(runtime.path, "utf8"));
  assert.equal(current.revision, 50);
  assert.equal(current.updatedAt, timestamp(50));
  assert.equal(current.expiresAt, timestamp(51));
  await held.release();
});

test("a simulated long-running 25-item lifecycle never regresses its lease or permits the timer race", async (context) => {
  let ownerActive = true;
  const options = {
    leaseMs: 30 * 60_000,
    heartbeatMs: 30 * 60_000,
    isOwnerActive: async (record) => record.schedulerRunId === "one-shot-25" ? ownerActive : true,
    assessStaleOwner: async () => ({ recoverable: true, reason: "test-only stale assessment" }),
  };
  const runtime = await fixture(options);
  context.after(runtime.cleanup);
  const timerLease = createPersistentLease(runtime.path, options);
  const held = await runtime.lease.acquire({
    now: timestamp(0),
    token: "one-shot-25",
    ownerId: "listing-scheduler:41009",
    ownerPid: 41009,
    runtimeIdentity: "release-a:helper-a",
  });

  for (let index = 1; index <= 25; index += 1) {
    await held.refresh({ now: timestamp(index * 10) });
    await held.refresh({ now: timestamp(0) });
    await assert.rejects(
      timerLease.acquire({
        now: timestamp(index * 10 + 1),
        token: `periodic-${index}`,
        ownerId: "listing-scheduler:41009",
        ownerPid: 41009,
        runtimeIdentity: "release-a:helper-a",
      }),
      (error) => error.code === "LISTING_SCHEDULER_LOCKED",
    );
  }
  assert.equal((await runtime.lease.read()).expiresAt, timestamp(280));
  ownerActive = false;
  await held.release();
});

test("stale cleanup remains fail-closed when owner activity or persistent state is unknown", async (context) => {
  const runtime = await fixture({
    leaseMs: 60_000,
    heartbeatMs: 60_000,
    isOwnerActive: async () => null,
    assessStaleOwner: async () => ({ recoverable: true }),
  });
  context.after(runtime.cleanup);
  const held = await runtime.lease.acquire({
    now: timestamp(0),
    token: "scheduler-run-a",
    ownerId: "legacy-owner",
    ownerPid: 0,
    runtimeIdentity: "legacy-runtime",
  });
  await assert.rejects(
    createPersistentLease(runtime.path, {
      leaseMs: 60_000,
      heartbeatMs: 60_000,
      isOwnerActive: async () => null,
      assessStaleOwner: async () => ({ recoverable: true }),
    }).acquire({ now: timestamp(2), token: "scheduler-run-b" }),
    (error) => error.code === "LISTING_SCHEDULER_LOCKED" && /unklar/iu.test(error.message),
  );
  await held.release();
});

test("controlled stale reconciliation requires exact owner, inactive process, expiry and persistent proof", async (context) => {
  let ownerActive = true;
  const events = [];
  const runtime = await fixture({
    leaseMs: 60_000,
    heartbeatMs: 60_000,
    isOwnerActive: async () => ownerActive,
    writeEvent: async (event, details) => events.push({ event, details }),
  });
  context.after(runtime.cleanup);
  const held = await runtime.lease.acquire({
    now: timestamp(0),
    token: "interrupted-run",
    schedulerRunId: "interrupted-run",
    ownerId: "listing-scheduler:41010",
    ownerPid: 41010,
    runtimeIdentity: "release-a:helper-a",
  });
  const contract = {
    now: timestamp(2),
    expectedSchedulerRunId: "interrupted-run",
    expectedOwnerId: "listing-scheduler:41010",
    reconciliationId: "test-reconciliation",
    assessStaleOwner: async () => ({ recoverable: true, reason: "persisted run interrupted" }),
  };
  await assert.rejects(runtime.lease.reconcileStale(contract), (error) => error.code === "LISTING_SCHEDULER_LOCKED");
  ownerActive = false;
  await assert.rejects(
    runtime.lease.reconcileStale({ ...contract, expectedSchedulerRunId: "foreign-run" }),
    (error) => error.code === "LISTING_SCHEDULER_LOCKED",
  );
  const reconciled = await runtime.lease.reconcileStale(contract);
  assert.equal(reconciled.reconciled, true);
  assert.equal(reconciled.schedulerRunId, "interrupted-run");
  assert.equal(await runtime.lease.read(), null);
  assert.deepEqual(events.map((entry) => entry.event), ["stale-removal-authorized", "stale-removed"]);
  await assert.rejects(held.release(), (error) => error.code === "LISTING_SCHEDULER_LOCK_LOST");
});
