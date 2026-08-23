import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runListingSchedulerLockCli } from "../listing-scheduler-lock-cli.mjs";
import { createPersistentLease } from "../persistent-lease.mjs";
import { createListingScheduler } from "../listing-scheduler.mjs";
import { WORKFLOW_STATUS } from "../workflow-status.mjs";

const START = "2026-08-22T14:34:52.091Z";
const RECONCILE_AT = "2026-08-22T16:34:52.091Z";

function memoryStore(initialState) {
  let state = structuredClone(initialState);
  return {
    async load() { return { stored: true, state: structuredClone(state) }; },
    async update(mutator) {
      const mutation = await mutator(structuredClone(state));
      state = structuredClone(mutation?.state || mutation);
      return { stored: true, state: structuredClone(state), result: mutation?.result };
    },
  };
}

function fixedOffMode() {
  return { async load() { return { format: 1, mode: "off", valid: true, fallbackReason: "" }; } };
}

function interruptedState(runId) {
  const scheduler = createListingScheduler({ now: START });
  scheduler.runs = [{
    id: runId,
    trigger: "periodic",
    status: WORKFLOW_STATUS.PROCESSING,
    statusMessage: "In Verarbeitung",
    startedAt: START,
    endedAt: "",
  }];
  return { version: 1, projects: [], scheduler };
}

test("lock CLI removes only the exact expired inactive interrupted scheduler claim", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "fpi-lock-cli-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const lockPath = join(directory, "listing-scheduler.lock");
  const runId = "interrupted-run";
  const ownerId = "listing-scheduler:41010";
  const store = memoryStore(interruptedState(runId));
  const lease = createPersistentLease(lockPath, {
    leaseMs: 60_000,
    heartbeatMs: 60_000,
    isOwnerActive: async () => false,
  });
  await lease.acquire({
    now: START,
    token: runId,
    schedulerRunId: runId,
    ownerId,
    ownerPid: 41010,
    runtimeIdentity: "release-a:helper-a",
  });

  const result = await runListingSchedulerLockCli([
    "reconcile-stale",
    "--expected-run-id", runId,
    "--expected-owner-id", ownerId,
  ], {
    now: () => RECONCILE_AT,
    store,
    lease,
    rotationModeStore: fixedOffMode(),
    deleteModeStore: fixedOffMode(),
    writeLog: async () => undefined,
  });

  assert.equal(result.reconciliation.reconciled, true);
  assert.equal(result.lockAfter, null);
  const run = (await store.load()).state.scheduler.runs.find((entry) => entry.id === runId);
  assert.equal(run.status, WORKFLOW_STATUS.FAILED);
  assert.equal(run.endedAt, RECONCILE_AT);
  assert.match(run.abortReason, /Helper-Prozess beendet/u);
});

test("lock CLI fails closed for a foreign reconciliation contract", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "fpi-lock-cli-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const lockPath = join(directory, "listing-scheduler.lock");
  const lease = createPersistentLease(lockPath, {
    leaseMs: 60_000,
    heartbeatMs: 60_000,
    isOwnerActive: async () => false,
  });
  await lease.acquire({
    now: START,
    token: "interrupted-run",
    schedulerRunId: "interrupted-run",
    ownerId: "listing-scheduler:41010",
    ownerPid: 41010,
    runtimeIdentity: "release-a:helper-a",
  });

  await assert.rejects(
    runListingSchedulerLockCli([
      "reconcile-stale",
      "--expected-run-id", "foreign-run",
      "--expected-owner-id", "listing-scheduler:41010",
    ], {
      now: () => RECONCILE_AT,
      store: memoryStore(interruptedState("interrupted-run")),
      lease,
      rotationModeStore: fixedOffMode(),
      deleteModeStore: fixedOffMode(),
      writeLog: async () => undefined,
    }),
    /exakten Reconciliation-Vertrag/iu,
  );
  assert.equal((await lease.read()).schedulerRunId, "interrupted-run");
});
