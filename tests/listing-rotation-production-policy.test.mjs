import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertPolicyBoundAutomaticRotationUpload,
  createListingRotationProductionPolicyStore,
  normalizeListingRotationProductionPolicy,
} from "../listing-rotation-production-policy.mjs";
import { runListingRotationProductionPolicyCli } from "../listing-rotation-production-policy-cli.mjs";

const RUNTIME_COMMIT = "a".repeat(40);

test("missing, damaged and unknown production policies fail closed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fpi-production-policy-"));
  const path = join(directory, "policy.json");
  const store = createListingRotationProductionPolicyStore(path);
  assert.deepEqual(await store.load(), {
    format: 2,
    maxRunItems: 0,
    startupCatchupMode: "detect-only",
    expectedRuntimeCommit: "",
    updatedAt: "",
    valid: false,
    fallbackReason: "Produktions-Rollout-Policy fehlt; active ist fail-closed gesperrt.",
  });
  await writeFile(path, "{broken", "utf8");
  assert.equal((await store.load()).valid, false);
  assert.equal(normalizeListingRotationProductionPolicy({ format: 2, maxRunItems: 41, startupCatchupMode: "guarded", expectedRuntimeCommit: RUNTIME_COMMIT }).valid, false);
  assert.equal(normalizeListingRotationProductionPolicy({ format: 2, maxRunItems: 3, startupCatchupMode: "unknown", expectedRuntimeCommit: RUNTIME_COMMIT }).valid, false);
  assert.equal(normalizeListingRotationProductionPolicy({ format: 2, maxRunItems: 3, startupCatchupMode: "guarded" }).valid, false);
  assert.equal(normalizeListingRotationProductionPolicy({ format: 2, maxRunItems: 3, startupCatchupMode: "guarded", expectedRuntimeCommit: "unknown" }).valid, false);
  assert.equal(normalizeListingRotationProductionPolicy({ format: 1, maxRunItems: 3, startupCatchupMode: "guarded", expectedRuntimeCommit: RUNTIME_COMMIT }).valid, false);
});

test("policy persists the explicit 40-item daily drain ceiling and a bounded startup mode", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fpi-production-policy-save-"));
  const path = join(directory, "policy.json");
  const store = createListingRotationProductionPolicyStore(path, { now: () => "2026-08-14T12:00:00.000Z" });
  const saved = await store.save({ maxRunItems: 40, startupCatchupMode: "detect-only", expectedRuntimeCommit: RUNTIME_COMMIT });
  assert.equal(saved.valid, true);
  assert.equal(saved.maxRunItems, 40);
  assert.equal(saved.startupCatchupMode, "detect-only");
  assert.equal(saved.expectedRuntimeCommit, RUNTIME_COMMIT);
  assert.deepEqual(await store.load(), saved);
  const guarded = await store.save({ maxRunItems: 40, startupCatchupMode: "guarded", expectedRuntimeCommit: RUNTIME_COMMIT });
  assert.equal(guarded.startupCatchupMode, "guarded");
});

test("policy CLI requires and forwards the exact expected runtime commit", async () => {
  let saved;
  const result = await runListingRotationProductionPolicyCli([
    "set",
    "--max-run-items", "3",
    "--startup-catchup-mode", "detect-only",
    "--expected-runtime-commit", RUNTIME_COMMIT,
  ], {
    store: {
      async save(value) {
        saved = value;
        return { ...value, valid: true };
      },
    },
  });
  assert.equal(saved.expectedRuntimeCommit, RUNTIME_COMMIT);
  assert.equal(result.valid, true);
});

test("a regular policy-bound scheduler run may use the persistent 40-item limit without one-shot provenance", () => {
  const productionPolicy = normalizeListingRotationProductionPolicy({
    format: 2,
    maxRunItems: 40,
    startupCatchupMode: "guarded",
    expectedRuntimeCommit: RUNTIME_COMMIT,
  });
  const result = assertPolicyBoundAutomaticRotationUpload({
    productionPolicy,
    runId: "regular-scheduler-40",
    effectiveMaxRunItems: 40,
    lifecycle: {
      format: 1,
      schedulerRunId: "regular-scheduler-40",
      effectiveMaxRunItems: 40,
    },
  });
  assert.deepEqual(result, {
    contract: "policy-bound-automatic-rotation-upload-v1",
    schedulerRunId: "regular-scheduler-40",
    supervisingSchedulerRunId: "regular-scheduler-40",
    effectiveMaxRunItems: 40,
  });
});

test("a valid open lifecycle remains policy-bound when a restart gives its supervisor a new run id", () => {
  const productionPolicy = normalizeListingRotationProductionPolicy({
    format: 2,
    maxRunItems: 40,
    startupCatchupMode: "guarded",
    expectedRuntimeCommit: RUNTIME_COMMIT,
  });
  const result = assertPolicyBoundAutomaticRotationUpload({
    productionPolicy,
    runId: "restart-supervisor",
    effectiveMaxRunItems: 40,
    lifecycle: {
      format: 1,
      schedulerRunId: "original-production-lifecycle",
      effectiveMaxRunItems: 40,
    },
  });
  assert.equal(result.schedulerRunId, "original-production-lifecycle");
  assert.equal(result.supervisingSchedulerRunId, "restart-supervisor");
});

test("a limit above the regular policy remains blocked without the dedicated one-shot contract", () => {
  const productionPolicy = normalizeListingRotationProductionPolicy({
    format: 2,
    maxRunItems: 3,
    startupCatchupMode: "detect-only",
    expectedRuntimeCommit: RUNTIME_COMMIT,
  });
  assert.throws(() => assertPolicyBoundAutomaticRotationUpload({
    productionPolicy,
    runId: "unbound-one-shot",
    effectiveMaxRunItems: 25,
    lifecycle: {
      format: 1,
      schedulerRunId: "unbound-one-shot",
      effectiveMaxRunItems: 25,
    },
  }), (error) => error.code === "PRODUCTION_POLICY_UPLOAD_PROVENANCE_INVALID");
});

test("regular policy uploads reject incomplete lifecycle and hidden one-shot provenance", () => {
  const productionPolicy = normalizeListingRotationProductionPolicy({
    format: 2,
    maxRunItems: 40,
    startupCatchupMode: "guarded",
    expectedRuntimeCommit: RUNTIME_COMMIT,
  });
  for (const lifecycle of [
    { schedulerRunId: "", effectiveMaxRunItems: 40 },
    { schedulerRunId: "regular-run", effectiveMaxRunItems: 39 },
    { schedulerRunId: "regular-run", effectiveMaxRunItems: 40, batchOverrideId: "one-shot" },
  ]) {
    assert.throws(() => assertPolicyBoundAutomaticRotationUpload({
      productionPolicy,
      runId: "regular-run",
      effectiveMaxRunItems: 40,
      lifecycle,
    }), (error) => error.code === "PRODUCTION_POLICY_UPLOAD_PROVENANCE_INVALID");
  }
});
