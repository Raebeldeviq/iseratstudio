import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runProductionBatchOverrideCli } from "../production-batch-override-cli.mjs";
import {
  createProductionBatchOverrideStore,
  PRODUCTION_BATCH_OVERRIDE_MAX_ITEMS,
  PRODUCTION_BATCH_OVERRIDE_STATES,
} from "../production-batch-override.mjs";

const COMMIT = "a".repeat(40);
const OTHER_COMMIT = "b".repeat(40);
const NOW = "2026-08-21T09:00:00.000Z";

function ids(prefix = "override") {
  let value = 0;
  return () => `${prefix}-${++value}`;
}

async function storeFixture(now = NOW) {
  const directory = await mkdtemp(join(tmpdir(), "fpi-production-batch-override-"));
  const path = join(directory, "override.json");
  return {
    path,
    store: createProductionBatchOverrideStore(path, { now: () => now, idFactory: ids() }),
  };
}

test("one-shot limits accept only numeric integers from 4 through 25", async () => {
  for (const value of [0, -1, 3, 26, Number.NaN, "25", 4.5]) {
    const { store } = await storeFixture();
    await assert.rejects(
      Promise.resolve().then(() => store.arm({ maxRunItems: value, expectedRuntimeCommit: COMMIT })),
      (error) => error.code === "PRODUCTION_BATCH_OVERRIDE_LIMIT_INVALID",
      String(value),
    );
  }
  for (const value of [4, 24, 25]) {
    const { store } = await storeFixture();
    const armed = await store.arm({ maxRunItems: value, expectedRuntimeCommit: COMMIT });
    assert.equal(armed.maxRunItems, value);
    assert.equal(armed.state, PRODUCTION_BATCH_OVERRIDE_STATES.ARMED);
  }
  assert.equal(PRODUCTION_BATCH_OVERRIDE_MAX_ITEMS, 25);
});

test("missing override is harmless and an armed override expires after its TTL", async () => {
  const { path, store } = await storeFixture();
  assert.deepEqual(await store.load(), {
    format: 1,
    exists: false,
    valid: true,
    state: "none",
    fallbackReason: "",
  });
  await store.arm({ maxRunItems: 25, expectedRuntimeCommit: COMMIT });
  const later = createProductionBatchOverrideStore(path, {
    now: () => "2026-08-21T10:00:01.000Z",
    idFactory: ids("later"),
  });
  const status = await later.load();
  assert.equal(status.state, PRODUCTION_BATCH_OVERRIDE_STATES.EXPIRED);
  const claim = await later.claim({ schedulerRunId: "run-late", runningRuntimeCommit: COMMIT });
  assert.equal(claim.claimed, false);
  assert.equal(claim.reason, "override-expired");
  assert.equal((await later.load()).state, PRODUCTION_BATCH_OVERRIDE_STATES.EXPIRED);
});

test("a corrupt persistent override fails closed", async () => {
  const { path, store } = await storeFixture();
  await writeFile(path, "{not-json", { encoding: "utf8", mode: 0o600 });
  const status = await store.load();
  assert.equal(status.valid, false);
  assert.match(status.fallbackReason, /beschädigt|nicht lesbar/iu);
  await assert.rejects(
    store.arm({ maxRunItems: 25, expectedRuntimeCommit: COMMIT }),
    (error) => error.code === "PRODUCTION_BATCH_OVERRIDE_CORRUPT",
  );
});

test("exactly one competing scheduler claim wins and a second run falls back", async () => {
  const { path, store } = await storeFixture();
  const armed = await store.arm({ maxRunItems: 25, expectedRuntimeCommit: COMMIT });
  const first = createProductionBatchOverrideStore(path, { now: () => NOW, idFactory: ids("first") });
  const second = createProductionBatchOverrideStore(path, { now: () => NOW, idFactory: ids("second") });
  const settled = await Promise.allSettled([
    first.claim({ schedulerRunId: "scheduler-a", runningRuntimeCommit: COMMIT }),
    second.claim({ schedulerRunId: "scheduler-b", runningRuntimeCommit: COMMIT }),
  ]);
  const winners = settled.filter((entry) => entry.status === "fulfilled" && entry.value.claimed);
  assert.equal(winners.length, 1);
  const status = await store.load();
  assert.equal(status.overrideId, armed.overrideId);
  assert.equal(status.state, PRODUCTION_BATCH_OVERRIDE_STATES.CLAIMED);
  const later = await store.claim({ schedulerRunId: "scheduler-c", runningRuntimeCommit: COMMIT });
  assert.equal(later.claimed, false);
  assert.equal(later.reason, "no-armed-override");
});

test("runtime mismatch cancels the override without granting an elevated run", async () => {
  const { store } = await storeFixture();
  await store.arm({ maxRunItems: 25, expectedRuntimeCommit: COMMIT });
  const result = await store.claim({ schedulerRunId: "scheduler-a", runningRuntimeCommit: OTHER_COMMIT });
  assert.equal(result.claimed, false);
  assert.equal(result.blocking, true);
  assert.equal(result.reason, "runtime_mismatch");
  assert.equal((await store.load()).state, PRODUCTION_BATCH_OVERRIDE_STATES.CANCELLED);
});

test("a claimed override remains single-use across restart and graceful abort", async () => {
  const { path, store } = await storeFixture();
  const armed = await store.arm({ maxRunItems: 25, expectedRuntimeCommit: COMMIT });
  await store.claim({ schedulerRunId: "scheduler-a", runningRuntimeCommit: COMMIT });
  const restarted = createProductionBatchOverrideStore(path, { now: () => "2026-08-21T09:10:00.000Z", idFactory: ids("restart") });
  const second = await restarted.claim({ schedulerRunId: "scheduler-b", runningRuntimeCommit: COMMIT });
  assert.equal(second.claimed, false);
  await restarted.consume({
    overrideId: armed.overrideId,
    schedulerRunId: "scheduler-a",
    endState: "failed",
    selectedCount: 25,
    startedCount: 7,
    completedCount: 6,
    failedCount: 1,
    abortReason: "synthetic abort",
  });
  const consumed = await restarted.load();
  assert.equal(consumed.state, PRODUCTION_BATCH_OVERRIDE_STATES.CONSUMED);
  assert.equal(consumed.startedCount, 7);
  assert.equal(consumed.completedCount, 6);
  assert.equal((await restarted.claim({ schedulerRunId: "scheduler-c", runningRuntimeCommit: COMMIT })).claimed, false);
});

test("only armed overrides can be cancelled and claimed overrides stay immutable to cancel", async () => {
  const { store } = await storeFixture();
  await store.arm({ maxRunItems: 25, expectedRuntimeCommit: COMMIT });
  assert.equal((await store.cancel()).state, PRODUCTION_BATCH_OVERRIDE_STATES.CANCELLED);
  const next = await store.arm({ maxRunItems: 24, expectedRuntimeCommit: COMMIT });
  await store.claim({ schedulerRunId: "scheduler-a", runningRuntimeCommit: COMMIT });
  await assert.rejects(store.cancel(), (error) => error.code === "PRODUCTION_BATCH_OVERRIDE_NOT_ARMED");
  assert.equal((await store.load()).overrideId, next.overrideId);
  assert.equal((await store.load()).state, PRODUCTION_BATCH_OVERRIDE_STATES.CLAIMED);
});

test("consume rejects inconsistent completion counters and leaves the claim intact", async () => {
  const { store } = await storeFixture();
  const armed = await store.arm({ maxRunItems: 4, expectedRuntimeCommit: COMMIT });
  await store.claim({ schedulerRunId: "scheduler-a", runningRuntimeCommit: COMMIT });
  await assert.rejects(
    store.consume({
      overrideId: armed.overrideId,
      schedulerRunId: "scheduler-a",
      selectedCount: 4,
      startedCount: 3,
      completedCount: 3,
      failedCount: 1,
    }),
    (error) => error.code === "PRODUCTION_BATCH_OVERRIDE_COUNTS_INVALID",
  );
  assert.equal((await store.load()).state, PRODUCTION_BATCH_OVERRIDE_STATES.CLAIMED);
});

test("CLI arm is explicit and binds the override to validated runtime provenance", async () => {
  const { store } = await storeFixture();
  const status = await runProductionBatchOverrideCli(["status"], { store });
  assert.equal(status.state, "none");
  const armed = await runProductionBatchOverrideCli(["arm", "--max-run-items", "25"], {
    store,
    loadRuntimeProvenance: async () => ({ valid: true, runtimeCommit: COMMIT }),
  });
  assert.equal(armed.expectedRuntimeCommit, COMMIT);
  await assert.rejects(
    runProductionBatchOverrideCli(["arm", "--max-run-items", "25"], {
      store,
      loadRuntimeProvenance: async () => ({ valid: true, runtimeCommit: COMMIT }),
    }),
    (error) => error.code === "PRODUCTION_BATCH_OVERRIDE_ALREADY_EXISTS",
  );
  const cancelled = await runProductionBatchOverrideCli(["cancel"], { store });
  assert.equal(cancelled.state, PRODUCTION_BATCH_OVERRIDE_STATES.CANCELLED);
});

test("CLI refuses invalid runtime provenance and invalid textual limits", async () => {
  const { store } = await storeFixture();
  await assert.rejects(
    runProductionBatchOverrideCli(["arm", "--max-run-items", "NaN"], { store }),
    /ganze Zahl/u,
  );
  await assert.rejects(
    runProductionBatchOverrideCli(["arm", "--max-run-items", "25"], {
      store,
      loadRuntimeProvenance: async () => ({ valid: false, runtimeCommit: "" }),
    }),
    (error) => error.code === "PRODUCTION_BATCH_OVERRIDE_RUNTIME_INVALID",
  );
});
