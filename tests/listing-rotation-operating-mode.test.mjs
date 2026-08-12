import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createListingRotationOperatingModeStore } from "../listing-rotation-operating-mode.mjs";
import { runListingRotationModeCli } from "../listing-rotation-mode-cli.mjs";

test("missing operating-mode configuration fails closed to off", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fpi-rotation-mode-missing-"));
  const store = createListingRotationOperatingModeStore(join(directory, "mode.json"));
  const config = await store.load();
  assert.equal(config.mode, "off");
  assert.equal(config.valid, false);
  assert.match(config.fallbackReason, /fehlt|fail-closed/iu);
});

test("unknown or damaged operating-mode configuration fails closed to off", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fpi-rotation-mode-invalid-"));
  const path = join(directory, "mode.json");
  const store = createListingRotationOperatingModeStore(path);
  await writeFile(path, JSON.stringify({ format: 1, mode: "turbo", canaryListingIds: ["listing-1"] }), "utf8");
  const unknown = await store.load();
  assert.equal(unknown.mode, "off");
  assert.equal(unknown.valid, false);
  assert.match(unknown.fallbackReason, /unbekannter/iu);
  await writeFile(path, "{beschädigt", "utf8");
  const damaged = await store.load();
  assert.equal(damaged.mode, "off");
  assert.equal(damaged.valid, false);
  assert.match(damaged.fallbackReason, /beschädigt|nicht lesbar/iu);
});

test("unknown schema and canary without identifiers fail closed to off", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fpi-rotation-mode-schema-"));
  const path = join(directory, "mode.json");
  const store = createListingRotationOperatingModeStore(path);
  await writeFile(path, JSON.stringify({ format: 2, mode: "active" }), "utf8");
  const unknownSchema = await store.load();
  assert.equal(unknownSchema.mode, "off");
  assert.equal(unknownSchema.valid, false);
  assert.match(unknownSchema.fallbackReason, /Format|fail-closed/iu);

  await writeFile(path, JSON.stringify({ format: 1, mode: "canary", canaryListingIds: [] }), "utf8");
  const emptyCanary = await store.load();
  assert.equal(emptyCanary.mode, "off");
  assert.equal(emptyCanary.valid, false);
  assert.match(emptyCanary.fallbackReason, /keine gültige Listing-ID|fail-closed/iu);
});

test("mode CLI persists exactly the requested canary identifier", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fpi-rotation-mode-cli-"));
  const store = createListingRotationOperatingModeStore(join(directory, "mode.json"), {
    now: () => "2026-08-12T12:00:00.000Z",
  });
  const saved = await runListingRotationModeCli([
    "set",
    "--mode",
    "canary",
    "--listing-id",
    "30460-123456",
  ], { store });
  assert.equal(saved.mode, "canary");
  assert.deepEqual(saved.canaryListingIds, ["30460-123456"]);
  assert.deepEqual(await runListingRotationModeCli(["status"], { store }), saved);
});
