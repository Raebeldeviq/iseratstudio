import assert from "node:assert/strict";
import test from "node:test";

import {
  createLiveCanaryRotationUpload,
  LIVE_CANARY_ROTATION_SOURCES,
  runLiveCanaryRotationOnce,
} from "../listing-rotation-live-canary-runner.mjs";

const contract = LIVE_CANARY_ROTATION_SOURCES["30460-930980"];

function modeStore(input = { format: 1, mode: "canary", canaryListingIds: [contract.externalId], valid: true, fallbackReason: "" }) {
  let value = structuredClone(input);
  return {
    async load() { return structuredClone(value); },
    async save(next) {
      value = { format: 1, mode: next.mode, canaryListingIds: next.canaryListingIds || [], valid: true, fallbackReason: "" };
      return structuredClone(value);
    },
    current() { return structuredClone(value); },
  };
}

test("manual live-canary runner always restores off after exactly one successful source", async () => {
  const store = modeStore();
  const calls = [];
  const result = await runLiveCanaryRotationOnce({ sourceExternalId: contract.externalId, ignoreTimeWindowOnce: true }, {
    runtime: {
      modeStore: store,
      service: {
        async run(input) {
          calls.push(input);
          return { claimed: true, ok: true, completedListingIds: [contract.sourceListingId] };
        },
      },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].ignoreTimeWindow, true);
  assert.equal(calls[0].trigger, "manual-live-canary-3");
  assert.deepEqual(store.current().canaryListingIds, []);
  assert.equal(store.current().mode, "off");
});

test("manual live-canary runner restores off after scheduler failure or invalid multi-target mode", async () => {
  for (const scenario of [
    {
      store: modeStore(),
      service: { run: async () => ({ claimed: true, ok: false, completedListingIds: [] }) },
      code: "LIVE_CANARY_ROTATION_SINGLE_RUN_FAILED",
    },
    {
      store: modeStore({ format: 1, mode: "canary", canaryListingIds: [contract.externalId, "30460-142086"], valid: true, fallbackReason: "" }),
      service: { run: async () => { throw new Error("must-not-run"); } },
      code: "LIVE_CANARY_ROTATION_MODE_MISMATCH",
    },
  ]) {
    await assert.rejects(
      runLiveCanaryRotationOnce({ sourceExternalId: contract.externalId, ignoreTimeWindowOnce: true }, {
        runtime: { modeStore: scenario.store, service: scenario.service },
      }),
      (error) => error.code === scenario.code,
    );
    assert.equal(scenario.store.current().mode, "off");
    assert.deepEqual(scenario.store.current().canaryListingIds, []);
  }
});

test("manual live-canary runner rejects active, unknown sources and missing transient window override", async () => {
  const activeStore = modeStore({ format: 1, mode: "active", canaryListingIds: [], valid: true, fallbackReason: "" });
  await assert.rejects(
    runLiveCanaryRotationOnce({ sourceExternalId: contract.externalId, ignoreTimeWindowOnce: true }, {
      runtime: { modeStore: activeStore, service: { run: async () => ({}) } },
    }),
    (error) => error.code === "LIVE_CANARY_ROTATION_MODE_MISMATCH",
  );
  assert.equal(activeStore.current().mode, "off");
  await assert.rejects(
    runLiveCanaryRotationOnce({ sourceExternalId: "30460-000001", ignoreTimeWindowOnce: true }),
    (error) => error.code === "LIVE_CANARY_ROTATION_SOURCE_NOT_AUTHORIZED",
  );
  await assert.rejects(
    runLiveCanaryRotationOnce({ sourceExternalId: contract.externalId }),
    (error) => error.code === "LIVE_CANARY_TIME_OVERRIDE_REQUIRED",
  );
});

test("live-canary uploader transfers exactly the fixed replacement and consumes the stable plot day", async () => {
  const source = { id: contract.sourceListingId, externalId: contract.externalId };
  const replacement = {
    id: contract.expectedReplacementListingId,
    externalId: contract.expectedReplacementExternalId,
    rotationSourceListingId: source.id,
    listingOrigin: "rotation-copy",
    templateId: "house-1",
    version: 2,
  };
  const project = { id: "project-1", plotId: contract.plotId, listings: [source, replacement] };
  const state = {
    projects: [project],
    houses: [{ id: "house-1", images: [] }],
    provider: { providerNumber: "30460" },
    uploadHistory: [],
  };
  const sequence = [];
  let completedJob = null;
  let transferredGuard = null;
  const upload = createLiveCanaryRotationUpload({
    contract,
    modeStore: modeStore(),
    uploadLedger: {
      claim: async () => ({ alreadyCompleted: false }),
      read: async () => ({ format: 1, jobs: [] }),
      complete: async (job) => { completedJob = job; sequence.push("ledger-complete"); },
      fail: async () => { sequence.push("ledger-fail"); },
    },
    dailyGuard: {
      claim: async () => ({ record: { claimToken: "claim-1" } }),
      markTransferStarted: async () => { sequence.push("guard-started"); },
      complete: async (claim) => { transferredGuard = claim; sequence.push("guard-complete"); },
      fail: async () => { sequence.push("guard-fail"); },
    },
    loadCredentialVault: async () => ({ credentials: { ftpHost: "example.invalid", ftpUser: "x", ftpPassword: "x", ftpPath: "/", ftpSecure: "explicit" } }),
    buildImportPackage: async () => ({ filename: "fixed.zip", blob: new Blob(["zip"]) }),
    clientFactory: () => ({
      ftp: { verbose: false },
      access: async () => { sequence.push("access"); },
      cd: async () => { throw new Error("unexpected cd"); },
      uploadFrom: async (stream, filename) => {
        assert.equal(filename, "fixed.zip");
        for await (const chunk of stream) {
          assert.ok(chunk.length > 0);
          sequence.push("upload");
        }
      },
      close: () => { sequence.push("close"); },
    }),
    now: (() => {
      const values = ["2026-08-13T17:00:00.000Z", "2026-08-13T17:00:01.000Z", "2026-08-13T17:00:02.000Z"];
      return () => values.shift() || "2026-08-13T17:00:03.000Z";
    })(),
  });
  const result = await upload({ state, project, listing: replacement, runId: "run-1" });
  assert.equal(result.ok, true);
  assert.equal(completedJob.listingId, contract.expectedReplacementListingId);
  assert.equal(transferredGuard.plotId, contract.plotId);
  assert.ok(sequence.indexOf("guard-started") < sequence.indexOf("upload"));
  assert.ok(sequence.indexOf("upload") < sequence.indexOf("guard-complete"));
  assert.ok(sequence.indexOf("guard-complete") < sequence.indexOf("ledger-complete"));
  assert.equal(sequence.includes("guard-fail"), false);
});

test("live-canary uploader rejects replacement or plot deviation before any FTPS action", async () => {
  let networkCalls = 0;
  const upload = createLiveCanaryRotationUpload({
    contract,
    modeStore: modeStore(),
    uploadLedger: { claim: async () => { throw new Error("ledger must not be reached"); } },
    dailyGuard: {},
    clientFactory: () => { networkCalls += 1; return {}; },
  });
  const source = { id: contract.sourceListingId, externalId: contract.externalId };
  const wrongReplacement = {
    id: contract.expectedReplacementListingId,
    externalId: "30460-000000",
    rotationSourceListingId: source.id,
    listingOrigin: "rotation-copy",
  };
  await assert.rejects(
    upload({ state: { projects: [], houses: [] }, project: { id: "p", plotId: contract.plotId, listings: [source, wrongReplacement] }, listing: wrongReplacement, runId: "run" }),
    (error) => error.code === "LIVE_CANARY_ROTATION_CONTEXT_MISMATCH",
  );
  assert.equal(networkCalls, 0);
});
