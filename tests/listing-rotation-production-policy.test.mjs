import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createListingRotationProductionPolicyStore,
  normalizeListingRotationProductionPolicy,
} from "../listing-rotation-production-policy.mjs";

test("missing, damaged and unknown production policies fail closed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fpi-production-policy-"));
  const path = join(directory, "policy.json");
  const store = createListingRotationProductionPolicyStore(path);
  assert.deepEqual(await store.load(), {
    format: 1,
    maxRunItems: 0,
    startupCatchupMode: "detect-only",
    updatedAt: "",
    valid: false,
    fallbackReason: "Produktions-Rollout-Policy fehlt; active ist fail-closed gesperrt.",
  });
  await writeFile(path, "{broken", "utf8");
  assert.equal((await store.load()).valid, false);
  assert.equal(normalizeListingRotationProductionPolicy({ format: 1, maxRunItems: 4, startupCatchupMode: "guarded" }).valid, false);
  assert.equal(normalizeListingRotationProductionPolicy({ format: 1, maxRunItems: 3, startupCatchupMode: "unknown" }).valid, false);
});

test("policy persists an explicit cap of three and a bounded startup mode", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fpi-production-policy-save-"));
  const path = join(directory, "policy.json");
  const store = createListingRotationProductionPolicyStore(path, { now: () => "2026-08-14T12:00:00.000Z" });
  const saved = await store.save({ maxRunItems: 3, startupCatchupMode: "detect-only" });
  assert.equal(saved.valid, true);
  assert.equal(saved.maxRunItems, 3);
  assert.equal(saved.startupCatchupMode, "detect-only");
  assert.deepEqual(await store.load(), saved);
  const guarded = await store.save({ maxRunItems: 3, startupCatchupMode: "guarded" });
  assert.equal(guarded.startupCatchupMode, "guarded");
});
