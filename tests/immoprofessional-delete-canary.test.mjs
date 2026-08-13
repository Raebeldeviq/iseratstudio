import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertAuthorizedDeleteTarget,
  assertDeleteCanaryMode,
  assertSingleDeleteTarget,
  buildImmoprofessionalDeletePayload,
  createDeleteCanaryJobIdentity,
  createDeleteCanaryLedger,
  createDeleteCanaryModeStore,
  DELETE_CANARY_LEDGER_FORMAT,
  DELETE_CANARY_STATUS,
  DELETE_CANARY_TARGET,
  executeDeleteCanary,
  normalizeDeleteCanaryMode,
  prepareDeleteCanary,
  resolveDeleteCanarySnapshot,
  validateDeleteArchive,
  validateDeleteXmlAgainstSchema,
  validateDeleteXmlInvariants,
} from "../immoprofessional-delete-canary.mjs";
import { runDeleteCanaryCli } from "../immoprofessional-delete-canary-cli.mjs";

const NOW = "2026-08-13T16:00:00.000Z";

function listing(externalId, id = `listing-${externalId}`) {
  return {
    id,
    externalId,
    templateId: "house-canary",
    templateName: "SUN 126 V2",
    status: "published",
    version: 1,
    texts: {
      title: "Synthetischer Titel",
      description: "Synthetische Beschreibung",
      equipment: "Synthetische Ausstattung",
      location: "Synthetische Lage",
      other: "Synthetischer sonstiger Text",
    },
  };
}

function stateFixture() {
  return {
    provider: {
      providerNumber: "30460",
      company: "Synthetischer Anbieter",
      email: "synthetic@example.invalid",
      lastName: "Mustermann",
    },
    houses: [{
      id: "house-canary",
      name: "SUN 126 V2",
      houseType: "Einfamilienhaus",
      images: [],
    }],
    projects: [
      {
        id: "project-canary",
        zip: "14793",
        city: "Testort",
        listings: [listing(DELETE_CANARY_TARGET)],
      },
      {
        id: "project-protected-source",
        zip: "14793",
        city: "Testort",
        listings: [listing("30460-032963")],
      },
      {
        id: "project-protected-replacement",
        zip: "14793",
        city: "Testort",
        listings: [listing("30460-810978")],
      },
    ],
    uploadHistory: [{ jobId: "normal-upload", externalId: "30460-032963", status: "published" }],
    scheduler: { runs: [{ runId: "existing-run" }], lastRunAt: NOW },
  };
}

async function temporaryRuntime() {
  const directory = await mkdtemp(join(tmpdir(), "fpi-delete-canary-test-"));
  const modeStore = createDeleteCanaryModeStore(join(directory, "mode.json"), { now: () => NOW });
  const ledger = createDeleteCanaryLedger(join(directory, "jobs.json"), { leaseMs: 60_000 });
  return {
    directory,
    modeStore,
    ledger,
    async cleanup() { await rm(directory, { recursive: true, force: true }); },
  };
}

async function payloadFixture() {
  const snapshot = resolveDeleteCanarySnapshot(stateFixture());
  return buildImmoprofessionalDeletePayload(snapshot, { preparedAt: NOW });
}

async function executeFixture(runtime, options = {}) {
  if (options.mode !== "off") {
    await runtime.modeStore.save({ mode: "canary", externalObjectNumbers: [DELETE_CANARY_TARGET] });
  }
  let uploadCount = 0;
  const state = options.state || stateFixture();
  const result = await executeDeleteCanary({
    target: DELETE_CANARY_TARGET,
    authorizedTarget: DELETE_CANARY_TARGET,
    modeStore: runtime.modeStore,
    ledger: runtime.ledger,
    state,
    schemaPath: "synthetic-openimmo.xsd",
    schemaValidator: options.schemaValidator || (async () => ({ ok: true })),
    transportTarget: "/",
    now: () => NOW,
    onPreflight: options.onPreflight,
    upload: options.upload || (async ({ archive }) => {
      uploadCount += 1;
      return { completedAt: NOW, bytes: archive.length, transferredPackages: 1, retries: 0 };
    }),
  });
  return { result, uploadCount, state };
}

test("1 target guard allows exactly 30460-287191", () => {
  assert.equal(assertAuthorizedDeleteTarget(DELETE_CANARY_TARGET), DELETE_CANARY_TARGET);
});

test("2 target guard hard-stops protected source 30460-032963", () => {
  assert.throws(() => assertAuthorizedDeleteTarget("30460-032963"), { code: "DELETE_REPLACEMENT_GUARD_VIOLATION" });
});

test("3 target guard hard-stops protected replacement 30460-810978", () => {
  assert.throws(() => assertAuthorizedDeleteTarget("30460-810978"), { code: "DELETE_REPLACEMENT_GUARD_VIOLATION" });
});

test("4 target guard hard-stops every arbitrary object number", () => {
  assert.throws(() => assertAuthorizedDeleteTarget("30460-999999"), { code: "DELETE_REPLACEMENT_GUARD_VIOLATION" });
});

test("5 target guard hard-stops an empty number", () => {
  assert.throws(() => assertAuthorizedDeleteTarget(""), { code: "DELETE_REPLACEMENT_GUARD_VIOLATION" });
});

test("6 target guard hard-stops more than one target", () => {
  assert.throws(() => assertSingleDeleteTarget([DELETE_CANARY_TARGET, DELETE_CANARY_TARGET]), { code: "DELETE_CANARY_TARGET_COUNT_INVALID" });
});

test("7 off mode performs no transfer", async () => {
  const runtime = await temporaryRuntime();
  try {
    let uploads = 0;
    await assert.rejects(executeDeleteCanary({
      target: DELETE_CANARY_TARGET,
      authorizedTarget: DELETE_CANARY_TARGET,
      modeStore: runtime.modeStore,
      ledger: runtime.ledger,
      state: stateFixture(),
      schemaPath: "synthetic.xsd",
      schemaValidator: async () => ({ ok: true }),
      upload: async () => { uploads += 1; },
    }), { code: "DELETE_CANARY_MODE_OFF" });
    assert.equal(uploads, 0);
  } finally { await runtime.cleanup(); }
});

test("8 canary mode with the exact target permits one transfer", async () => {
  const runtime = await temporaryRuntime();
  try {
    const { result, uploadCount } = await executeFixture(runtime);
    assert.equal(uploadCount, 1);
    assert.equal(result.job.status, DELETE_CANARY_STATUS.PENDING_CONFIRMATION);
  } finally { await runtime.cleanup(); }
});

test("9 unknown mode fails closed to off", () => {
  assert.equal(normalizeDeleteCanaryMode({ format: 1, mode: "unknown" }).mode, "off");
});

test("10 active mode is not supported", async () => {
  const runtime = await temporaryRuntime();
  try {
    await assert.rejects(runtime.modeStore.save({ mode: "active" }), { code: "DELETE_MODE_UNSUPPORTED" });
  } finally { await runtime.cleanup(); }
});

test("11 payload contains exactly one object", async () => {
  assert.equal(validateDeleteXmlInvariants((await payloadFixture()).xmlText).objectCount, 1);
});

test("12 payload contains exactly one DELETE action", async () => {
  assert.equal(validateDeleteXmlInvariants((await payloadFixture()).xmlText).deleteCount, 1);
});

test("13 payload contains provider id 30460", async () => {
  assert.equal(validateDeleteXmlInvariants((await payloadFixture()).xmlText).providerId, true);
});

test("14 payload openimmo_obid is exactly the authorized target", async () => {
  assert.equal(validateDeleteXmlInvariants((await payloadFixture()).xmlText).openimmoObid, true);
});

test("15 payload kennung_ursprung is exactly the authorized target", async () => {
  assert.equal(validateDeleteXmlInvariants((await payloadFixture()).xmlText).originId, true);
});

test("16 payload action is DELETE and never CHANGE", async () => {
  const checks = validateDeleteXmlInvariants((await payloadFixture()).xmlText);
  assert.equal(checks.deleteCount, 1);
  assert.equal(checks.noChange, true);
});

test("17 payload transfer mode is DELETE", async () => {
  assert.equal(validateDeleteXmlInvariants((await payloadFixture()).xmlText).mode, true);
});

test("18 payload transfer scope is TEIL", async () => {
  assert.equal(validateDeleteXmlInvariants((await payloadFixture()).xmlText).scope, true);
});

test("19 payload delegates formal XML validation to the required schema validator", async () => {
  const payload = await payloadFixture();
  let calls = 0;
  const result = await validateDeleteXmlAgainstSchema(payload.xmlText, "openimmo_127d.xsd", {
    spawn: async ({ xmlText, schemaPath }) => {
      calls += 1;
      assert.match(xmlText, /aktionart="DELETE"/u);
      assert.equal(schemaPath, "openimmo_127d.xsd");
      return { ok: true };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(calls, 1);
});

test("20 payload ZIP contains exactly one validated XML file", async () => {
  const payload = await payloadFixture();
  assert.deepEqual(await validateDeleteArchive(payload.archive, payload), {
    fileCount: 1,
    xmlFilename: payload.xmlFilename,
  });
});

test("21 preparing the same deterministic delete job twice creates one job", async () => {
  const runtime = await temporaryRuntime();
  try {
    const payload = await payloadFixture();
    const identity = createDeleteCanaryJobIdentity();
    const input = { ...identity, externalObjectNumber: DELETE_CANARY_TARGET, sourceListingId: "source", preparedAt: NOW, ...payload };
    await runtime.ledger.prepare(input, NOW);
    await runtime.ledger.prepare(input, NOW);
    assert.equal((await runtime.ledger.read()).jobs.length, 1);
  } finally { await runtime.cleanup(); }
});

test("22 an existing active claim blocks a second claim", async () => {
  const runtime = await temporaryRuntime();
  try {
    const payload = await payloadFixture();
    const identity = createDeleteCanaryJobIdentity();
    const prepared = await runtime.ledger.prepare({ ...identity, externalObjectNumber: DELETE_CANARY_TARGET, ...payload }, NOW);
    const claimed = await runtime.ledger.claim(identity.deleteJobId, { expectedUpdatedAt: prepared.updatedAt, claimToken: "claim-a" }, NOW);
    await assert.rejects(runtime.ledger.claim(identity.deleteJobId, { expectedUpdatedAt: claimed.updatedAt, claimToken: "claim-b" }, NOW), { code: "DELETE_JOB_ALREADY_CLAIMED" });
  } finally { await runtime.cleanup(); }
});

test("23 helper-style restart resumes a prepared job without a duplicate", async () => {
  const runtime = await temporaryRuntime();
  try {
    const payload = await payloadFixture();
    const identity = createDeleteCanaryJobIdentity();
    const prepared = await runtime.ledger.prepare({ ...identity, externalObjectNumber: DELETE_CANARY_TARGET, ...payload }, NOW);
    const restartedLedger = createDeleteCanaryLedger(join(runtime.directory, "jobs.json"));
    const claimed = await restartedLedger.claim(identity.deleteJobId, { expectedUpdatedAt: prepared.updatedAt, claimToken: "restart" }, NOW);
    assert.equal(claimed.attempt, 1);
    assert.equal((await restartedLedger.read()).jobs.length, 1);
  } finally { await runtime.cleanup(); }
});

test("24 restart after delete_transferred never transfers again", async () => {
  const runtime = await temporaryRuntime();
  try {
    const payload = await payloadFixture();
    const identity = createDeleteCanaryJobIdentity();
    const prepared = await runtime.ledger.prepare({ ...identity, externalObjectNumber: DELETE_CANARY_TARGET, ...payload }, NOW);
    const claimed = await runtime.ledger.claim(identity.deleteJobId, { expectedUpdatedAt: prepared.updatedAt, claimToken: "transfer" }, NOW);
    const transferred = await runtime.ledger.markTransferred(identity.deleteJobId, { expectedUpdatedAt: claimed.updatedAt, claimToken: "transfer" }, NOW);
    const restartedLedger = createDeleteCanaryLedger(join(runtime.directory, "jobs.json"));
    await assert.rejects(restartedLedger.claim(identity.deleteJobId, { expectedUpdatedAt: transferred.updatedAt }), { code: "DELETE_JOB_ALREADY_TRANSFERRED" });
  } finally { await runtime.cleanup(); }
});

test("25 restart after delete_pending_confirmation never transfers again", async () => {
  const runtime = await temporaryRuntime();
  try {
    await executeFixture(runtime);
    const identity = createDeleteCanaryJobIdentity();
    const job = (await runtime.ledger.read()).jobs[0];
    const restartedLedger = createDeleteCanaryLedger(join(runtime.directory, "jobs.json"));
    await assert.rejects(restartedLedger.claim(identity.deleteJobId, { expectedUpdatedAt: job.updatedAt }), { code: "DELETE_JOB_ALREADY_TRANSFERRED" });
  } finally { await runtime.cleanup(); }
});

test("26 delete_confirmed is permanently idempotent", async () => {
  const runtime = await temporaryRuntime();
  try {
    const payload = await payloadFixture();
    const identity = createDeleteCanaryJobIdentity();
    const prepared = await runtime.ledger.prepare({ ...identity, externalObjectNumber: DELETE_CANARY_TARGET, ...payload }, NOW);
    await writeFile(join(runtime.directory, "jobs.json"), JSON.stringify({
      format: DELETE_CANARY_LEDGER_FORMAT,
      jobs: [{ ...prepared, status: DELETE_CANARY_STATUS.CONFIRMED }],
    }));
    await assert.rejects(prepareDeleteCanary({
      target: DELETE_CANARY_TARGET,
      authorizedTarget: DELETE_CANARY_TARGET,
      modeStore: runtime.modeStore,
      ledger: runtime.ledger,
      state: stateFixture(),
      schemaPath: "synthetic.xsd",
      schemaValidator: async () => ({ ok: true }),
    }), { code: "DELETE_CANARY_MODE_OFF" });
    await runtime.modeStore.save({ mode: "canary", externalObjectNumbers: [DELETE_CANARY_TARGET] });
    await assert.rejects(prepareDeleteCanary({
      target: DELETE_CANARY_TARGET,
      authorizedTarget: DELETE_CANARY_TARGET,
      modeStore: runtime.modeStore,
      ledger: runtime.ledger,
      state: stateFixture(),
      schemaPath: "synthetic.xsd",
      schemaValidator: async () => ({ ok: true }),
    }), { code: "DELETE_JOB_ALREADY_TRANSFERRED" });
  } finally { await runtime.cleanup(); }
});

test("27 parallel persistent claims allow at most one winner", async () => {
  const runtime = await temporaryRuntime();
  try {
    const payload = await payloadFixture();
    const identity = createDeleteCanaryJobIdentity();
    const prepared = await runtime.ledger.prepare({ ...identity, externalObjectNumber: DELETE_CANARY_TARGET, ...payload }, NOW);
    const ledgerA = createDeleteCanaryLedger(join(runtime.directory, "jobs.json"));
    const ledgerB = createDeleteCanaryLedger(join(runtime.directory, "jobs.json"));
    const results = await Promise.allSettled([
      ledgerA.claim(identity.deleteJobId, { expectedUpdatedAt: prepared.updatedAt, claimToken: "parallel-a" }, NOW),
      ledgerB.claim(identity.deleteJobId, { expectedUpdatedAt: prepared.updatedAt, claimToken: "parallel-b" }, NOW),
    ]);
    assert.equal(results.filter((entry) => entry.status === "fulfilled").length, 1);
  } finally { await runtime.cleanup(); }
});

test("28 CAS conflict blocks before transfer", async () => {
  const runtime = await temporaryRuntime();
  try {
    const payload = await payloadFixture();
    const identity = createDeleteCanaryJobIdentity();
    await runtime.ledger.prepare({ ...identity, externalObjectNumber: DELETE_CANARY_TARGET, ...payload }, NOW);
    await assert.rejects(runtime.ledger.claim(identity.deleteJobId, { expectedUpdatedAt: "2026-01-01T00:00:00.000Z" }), { code: "DELETE_JOB_CAS_CONFLICT" });
  } finally { await runtime.cleanup(); }
});

test("29 protected source 30460-032963 remains byte-equivalent", async () => {
  const runtime = await temporaryRuntime();
  try {
    const state = stateFixture();
    const before = JSON.stringify(state.projects[1]);
    await executeFixture(runtime, { state });
    assert.equal(JSON.stringify(state.projects[1]), before);
  } finally { await runtime.cleanup(); }
});

test("30 protected replacement 30460-810978 remains byte-equivalent", async () => {
  const runtime = await temporaryRuntime();
  try {
    const state = stateFixture();
    const before = JSON.stringify(state.projects[2]);
    await executeFixture(runtime, { state });
    assert.equal(JSON.stringify(state.projects[2]), before);
  } finally { await runtime.cleanup(); }
});

test("31 delete canary creates no listing rotation job", async () => {
  const runtime = await temporaryRuntime();
  try {
    const state = stateFixture();
    await executeFixture(runtime, { state });
    assert.equal((await runtime.ledger.read()).jobs[0].operation, "manual_external_delete_canary");
    assert.equal(JSON.stringify(state).includes("automatic-listing-rotation"), false);
  } finally { await runtime.cleanup(); }
});

test("32 delete canary performs no scheduler handover", async () => {
  const runtime = await temporaryRuntime();
  try {
    const state = stateFixture();
    const before = JSON.stringify(state.scheduler);
    await executeFixture(runtime, { state });
    assert.equal(JSON.stringify(state.scheduler), before);
  } finally { await runtime.cleanup(); }
});

test("33 delete canary creates no normal upload job", async () => {
  const runtime = await temporaryRuntime();
  try {
    const state = stateFixture();
    const before = JSON.stringify(state.uploadHistory);
    await executeFixture(runtime, { state });
    assert.equal(JSON.stringify(state.uploadHistory), before);
    assert.equal((await runtime.ledger.read()).jobs.length, 1);
  } finally { await runtime.cleanup(); }
});

test("34 transfer failure is persisted and cannot retry without a new contract", async () => {
  const runtime = await temporaryRuntime();
  try {
    await runtime.modeStore.save({ mode: "canary", externalObjectNumbers: [DELETE_CANARY_TARGET] });
    await assert.rejects(executeDeleteCanary({
      target: DELETE_CANARY_TARGET,
      authorizedTarget: DELETE_CANARY_TARGET,
      modeStore: runtime.modeStore,
      ledger: runtime.ledger,
      state: stateFixture(),
      schemaPath: "synthetic.xsd",
      schemaValidator: async () => ({ ok: true }),
      now: () => NOW,
      upload: async () => { throw new Error("synthetic FTPS failure"); },
    }));
    const job = (await runtime.ledger.read()).jobs[0];
    assert.equal(job.status, DELETE_CANARY_STATUS.TRANSFER_FAILED);
    await assert.rejects(runtime.ledger.claim(job.deleteJobId, { expectedUpdatedAt: job.updatedAt }), { code: "DELETE_JOB_RETRY_NOT_AUTHORIZED" });
  } finally { await runtime.cleanup(); }
});

test("35 prepared payload is deterministic across restart", async () => {
  const first = await payloadFixture();
  const second = await payloadFixture();
  assert.equal(first.payloadSha256, second.payloadSha256);
  assert.equal(first.payloadFilename, second.payloadFilename);
});

test("36 missing local target snapshot blocks fail-closed", () => {
  const state = stateFixture();
  state.projects[0].listings = [];
  assert.throws(() => resolveDeleteCanarySnapshot(state), { code: "DELETE_CANARY_NEEDS_VALID_PAYLOAD_SOURCE" });
});

test("37 ambiguous local target snapshot blocks fail-closed", () => {
  const state = stateFixture();
  state.projects[1].listings.push(listing(DELETE_CANARY_TARGET, "duplicate"));
  assert.throws(() => resolveDeleteCanarySnapshot(state), { code: "DELETE_CANARY_TARGET_AMBIGUOUS" });
});

test("38 local XSD rejection prevents every upload", async () => {
  const runtime = await temporaryRuntime();
  try {
    await runtime.modeStore.save({ mode: "canary", externalObjectNumbers: [DELETE_CANARY_TARGET] });
    let uploads = 0;
    await assert.rejects(executeDeleteCanary({
      target: DELETE_CANARY_TARGET,
      authorizedTarget: DELETE_CANARY_TARGET,
      modeStore: runtime.modeStore,
      ledger: runtime.ledger,
      state: stateFixture(),
      schemaPath: "synthetic.xsd",
      schemaValidator: async () => ({ ok: false, message: "synthetic schema error" }),
      upload: async () => { uploads += 1; },
    }), { code: "DELETE_PAYLOAD_SCHEMA_REJECTED_LOCALLY" });
    assert.equal(uploads, 0);
    assert.equal((await runtime.ledger.read()).jobs.length, 0);
  } finally { await runtime.cleanup(); }
});

test("39 CLI transfer always resets mode to off and clears the target", async () => {
  const runtime = await temporaryRuntime();
  try {
    await runtime.modeStore.save({ mode: "canary", externalObjectNumbers: [DELETE_CANARY_TARGET] });
    await runDeleteCanaryCli([
      "transfer",
      "--external-id", DELETE_CANARY_TARGET,
      "--authorized-external-id", DELETE_CANARY_TARGET,
      "--schema", "synthetic.xsd",
    ], {
      modeStore: runtime.modeStore,
      ledger: runtime.ledger,
      catalog: { stored: true, state: stateFixture() },
      vault: { credentials: { ftpHost: "synthetic.invalid", ftpUser: "synthetic", ftpPassword: "synthetic", ftpPath: "/", ftpSecure: "explicit" } },
      schemaValidator: async () => ({ ok: true }),
      upload: async () => ({ completedAt: NOW, bytes: 1, transferredPackages: 1, retries: 0 }),
      writeLog: async () => undefined,
      write: () => undefined,
      now: () => NOW,
    });
    const mode = await runtime.modeStore.load();
    assert.equal(mode.mode, "off");
    assert.deepEqual(mode.externalObjectNumbers, []);
  } finally { await runtime.cleanup(); }
});

test("40 no unvalidated report can mark a delete job confirmed", async () => {
  const runtime = await temporaryRuntime();
  try {
    await executeFixture(runtime);
    const serialized = await readFile(join(runtime.directory, "jobs.json"), "utf8");
    assert.equal(serialized.includes(DELETE_CANARY_STATUS.CONFIRMED), false);
    assert.equal(JSON.parse(serialized).jobs[0].status, DELETE_CANARY_STATUS.PENDING_CONFIRMATION);
  } finally { await runtime.cleanup(); }
});

test("41 mode assertion rejects a canary list containing a second target", () => {
  assert.throws(() => assertDeleteCanaryMode({
    mode: "canary",
    valid: true,
    externalObjectNumbers: [DELETE_CANARY_TARGET, "30460-999999"],
  }), { code: "DELETE_CANARY_TARGET_COUNT_INVALID" });
});

test("42 successful upload with failed ledger finalization becomes transfer-uncertain and never retries", async () => {
  const runtime = await temporaryRuntime();
  try {
    await runtime.modeStore.save({ mode: "canary", externalObjectNumbers: [DELETE_CANARY_TARGET] });
    let uncertainCalls = 0;
    const guardedLedger = {
      read: (...args) => runtime.ledger.read(...args),
      prepare: (...args) => runtime.ledger.prepare(...args),
      claim: (...args) => runtime.ledger.claim(...args),
      markTransferred: async () => { throw new Error("synthetic ledger finalization failure"); },
      markPendingConfirmation: (...args) => runtime.ledger.markPendingConfirmation(...args),
      markTransferFailed: (...args) => runtime.ledger.markTransferFailed(...args),
      markTransferUncertain: async (...args) => {
        uncertainCalls += 1;
        return runtime.ledger.markTransferUncertain(...args);
      },
    };
    await assert.rejects(executeDeleteCanary({
      target: DELETE_CANARY_TARGET,
      authorizedTarget: DELETE_CANARY_TARGET,
      modeStore: runtime.modeStore,
      ledger: guardedLedger,
      state: stateFixture(),
      schemaPath: "synthetic.xsd",
      schemaValidator: async () => ({ ok: true }),
      now: () => NOW,
      upload: async () => ({ completedAt: NOW, transferredPackages: 1, retries: 0 }),
    }));
    assert.equal(uncertainCalls, 1);
    const job = (await runtime.ledger.read()).jobs[0];
    assert.equal(job.status, DELETE_CANARY_STATUS.TRANSFER_UNCERTAIN);
    await assert.rejects(runtime.ledger.claim(job.deleteJobId, { expectedUpdatedAt: job.updatedAt }), { code: "DELETE_JOB_ALREADY_TRANSFERRED" });
  } finally { await runtime.cleanup(); }
});

test("43 damaged persistent mode configuration fails closed to off", async () => {
  const runtime = await temporaryRuntime();
  try {
    await writeFile(join(runtime.directory, "mode.json"), "{broken-json", "utf8");
    const mode = await runtime.modeStore.load();
    assert.equal(mode.mode, "off");
    assert.deepEqual(mode.externalObjectNumbers, []);
    assert.equal(mode.valid, false);
  } finally { await runtime.cleanup(); }
});
