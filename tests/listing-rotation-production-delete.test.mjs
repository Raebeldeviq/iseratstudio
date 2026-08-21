import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createListingGroup,
  updateListingControl,
} from "../listing-groups.mjs";
import {
  buildProductionDeletePayload,
  createProductionDeleteLedger,
  createProductionDeleteModeStore,
  createProductionDeleteService,
  productionDeleteCandidates,
  productionDeleteIdentity,
  PRODUCTION_DELETE_STATUS,
  resolveProductionDeleteEligibility,
} from "../listing-rotation-production-delete.mjs";
import { createProductionBatchOverrideStore } from "../production-batch-override.mjs";
import { WORKFLOW_STATUS } from "../workflow-status.mjs";

const NOW = "2026-08-14T12:00:00.000Z";
const SOURCE_EXTERNAL_ID = "30460-654321";
const REPLACEMENT_EXTERNAL_ID = "30460-654322";
const RUNTIME_COMMIT = "a".repeat(40);

function ids() {
  let value = 0;
  return () => `test-id-${++value}`;
}

function productionState() {
  const source = {
    id: "source-listing",
    externalId: SOURCE_EXTERNAL_ID,
    templateId: "house-1",
    templateName: "SUN 1",
    status: WORKFLOW_STATUS.PUBLISHED,
    statusMessage: "Ersetzt",
    listingOrigin: "group-source",
    supersededByListingId: "replacement-listing",
    replacementConfirmedAt: NOW,
    externalDeletionPending: true,
    productionDeleteState: "authorized",
    productionDeleteAuthorizedAt: NOW,
    productionRotationRunId: "scheduler-run-1",
  };
  const replacement = {
    id: "replacement-listing",
    externalId: REPLACEMENT_EXTERNAL_ID,
    templateId: "house-1",
    templateName: "SUN 1",
    status: WORKFLOW_STATUS.PUBLISHED,
    statusMessage: "Import bestätigt",
    listingOrigin: "rotation-copy",
    rotationSourceListingId: source.id,
    importConfirmedAt: NOW,
    importReportId: "report-1",
    productionLifecycle: {
      format: 1,
      schedulerRunId: "scheduler-run-1",
      sourceListingId: source.id,
      automaticDeleteAuthorized: true,
      preparedAt: "2026-08-14T11:00:00.000Z",
      importConfirmedAt: NOW,
      importReportId: "report-1",
    },
  };
  let group = createListingGroup("project-1", { idFactory: ids(), now: "2026-07-01T00:00:00.000Z" });
  group = updateListingControl(group, source, {
    automaticUpdateEnabled: false,
    automaticDeletionEnabled: false,
    status: WORKFLOW_STATUS.PUBLISHED,
  }, { idFactory: ids(), now: NOW });
  group = updateListingControl(group, replacement, {
    automaticUpdateEnabled: true,
    automaticDeletionEnabled: false,
    status: WORKFLOW_STATUS.PUBLISHED,
    lastSuccessAt: NOW,
  }, { idFactory: ids(), now: NOW });
  return {
    version: 1,
    provider: { providerNumber: "30460", company: "Test GmbH", lastName: "Test", email: "test@example.invalid" },
    houses: [{ id: "house-1", name: "SUN 1", houseType: "Einfamilienhaus" }],
    projects: [{
      id: "project-1",
      plotId: "plot-1",
      zip: "14542",
      city: "Werder",
      listings: [source, replacement],
      listingGroup: group,
    }],
    importReports: [{
      reportId: "report-1",
      importResult: "success",
      sourceListingId: source.id,
      matchedListingId: replacement.id,
      externalObjectNumber: replacement.externalId,
    }],
    deleteReports: [],
  };
}

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

function fixedMode(mode) {
  return { async load() { return { format: 1, mode, valid: true, fallbackReason: "" }; } };
}

function fixedPolicy() {
  return { async load() { return { format: 1, maxRunItems: 3, startupCatchupMode: "guarded", valid: true, fallbackReason: "" }; } };
}

function fixedSingleItemPolicy() {
  return { async load() { return { format: 1, maxRunItems: 1, startupCatchupMode: "detect-only", valid: true, fallbackReason: "" }; } };
}

function productionStateWithSecondPair() {
  const state = productionState();
  const secondState = JSON.parse(JSON.stringify(productionState())
    .replaceAll("project-1", "project-2")
    .replaceAll("plot-1", "plot-2")
    .replaceAll("source-listing", "source-listing-2")
    .replaceAll("replacement-listing", "replacement-listing-2")
    .replaceAll("report-1", "report-2")
    .replaceAll("scheduler-run-1", "scheduler-run-2")
    .replaceAll(SOURCE_EXTERNAL_ID, "30460-574320")
    .replaceAll(REPLACEMENT_EXTERNAL_ID, "30460-259307"));
  state.projects.push(secondState.projects[0]);
  state.importReports.push(secondState.importReports[0]);
  return state;
}

function productionStateWithPairs(count, options = {}) {
  const projects = [];
  const importReports = [];
  for (let index = 0; index < count; index += 1) {
    const number = index + 1;
    const sourceExternalId = `30460-${String(100_000 + number * 2).padStart(6, "0")}`;
    const replacementExternalId = `30460-${String(100_001 + number * 2).padStart(6, "0")}`;
    const schedulerRunId = options.schedulerRunId || `scheduler-run-${number}`;
    const item = JSON.parse(JSON.stringify(productionState())
      .replaceAll("project-1", `project-${number}`)
      .replaceAll("plot-1", `plot-${number}`)
      .replaceAll("source-listing", `source-listing-${number}`)
      .replaceAll("replacement-listing", `replacement-listing-${number}`)
      .replaceAll("report-1", `report-${number}`)
      .replaceAll("scheduler-run-1", schedulerRunId)
      .replaceAll(SOURCE_EXTERNAL_ID, sourceExternalId)
      .replaceAll(REPLACEMENT_EXTERNAL_ID, replacementExternalId));
    if (options.batchOverrideId) {
      Object.assign(item.projects[0].listings[1].productionLifecycle, {
        batchOverrideId: options.batchOverrideId,
        batchOverrideMaxRunItems: options.batchOverrideMaxRunItems,
        runtimeCommit: options.runtimeCommit,
      });
    }
    projects.push(item.projects[0]);
    importReports.push(item.importReports[0]);
  }
  const state = productionState();
  state.projects = projects;
  state.importReports = importReports;
  return state;
}

async function consumedBatchOverride(directory, maxRunItems = 25, schedulerRunId = "scheduler-batch-25") {
  let id = 0;
  const store = createProductionBatchOverrideStore(join(directory, "batch-override.json"), {
    now: () => NOW,
    idFactory: () => `batch-${++id}`,
  });
  const armed = await store.arm({ maxRunItems, expectedRuntimeCommit: RUNTIME_COMMIT });
  await store.claim({ schedulerRunId, runningRuntimeCommit: RUNTIME_COMMIT });
  await store.consume({
    overrideId: armed.overrideId,
    schedulerRunId,
    endState: "transferred_pending_import",
    selectedCount: maxRunItems,
    startedCount: maxRunItems,
    completedCount: maxRunItems,
  });
  return { store, armed };
}

function fixedRuntimeProvenance(runtimeCommit = RUNTIME_COMMIT) {
  return { valid: true, runtimeCommit, runtimeRelease: "release-test" };
}

function rawDeleteReport(target = SOURCE_EXTERNAL_ID) {
  return [
    "Received: from server22.immoprofessional.eu by mail.example.invalid",
    "Authentication-Results: mail.example.invalid; spf=pass smtp.mailfrom=server22.immoprofessional.eu",
    "Message-ID: <production-delete@server22.immoprofessional.eu>",
    "Subject: Importbericht OpenImmo XML",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    "eine Importdatei wurde am 14.08.2026 um 14:26 Uhr verarbeitet.",
    "Sendersoftware: Fabian&Pascal Inseratestudio",
    "Anzahl Objekte: 1",
    "Anbieter-ID: 30460",
    `OK: Objekt-Nr.: "${target}"`,
    "Erfolgreich gelöscht -",
    `Das Objekt "${target}" wurde aus der Börse "Immobilienscout24" gelöscht.`,
  ].join("\r\n");
}

test("only explicitly marked production lifecycle sources become delete candidates", () => {
  const state = productionState();
  assert.deepEqual(productionDeleteCandidates(state).map((entry) => entry.sourceListingId), ["source-listing"]);
  delete state.projects[0].listings[0].productionDeleteState;
  assert.deepEqual(productionDeleteCandidates(state), []);
  state.projects[0].listings[0].externalDeletionPending = true;
  assert.deepEqual(productionDeleteCandidates(state), []);
});

test("production payload contains one DELETE target and never the replacement", async () => {
  const state = productionState();
  const eligibility = resolveProductionDeleteEligibility(state, "project-1", "source-listing");
  const payload = await buildProductionDeletePayload(state, eligibility, { preparedAt: NOW });
  assert.equal((payload.xmlText.match(/aktionart="DELETE"/gu) || []).length, 1);
  assert.equal((payload.xmlText.match(new RegExp(SOURCE_EXTERNAL_ID, "gu")) || []).length, 3);
  assert.equal(payload.xmlText.includes(REPLACEMENT_EXTERNAL_ID), false);
  assert.ok(payload.payloadSize > 0);
});

test("production service transfers serially, waits for a report and finalizes idempotently", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fpi-production-delete-"));
  const store = memoryStore(productionState());
  const ledger = createProductionDeleteLedger(join(directory, "jobs.json"));
  let reportAvailable = false;
  let uploads = 0;
  const mailAdapter = {
    readOnly: true,
    async findCandidates() { return reportAvailable ? [{ mailboxName: "Posteingang", transportId: "1" }] : []; },
    async readRawMessage(candidate) { return { ...candidate, rawSource: rawDeleteReport() }; },
  };
  const service = createProductionDeleteService({
    store,
    modeStore: fixedMode("active"),
    ledger,
    productionPolicyStore: fixedPolicy(),
    mailAdapter,
    upload: async () => { uploads += 1; },
    now: () => NOW,
  });
  const transferred = await service.runOnce({ trigger: "test" });
  assert.equal(transferred.ok, true);
  assert.deepEqual(transferred.transferred, [SOURCE_EXTERNAL_ID]);
  assert.deepEqual(transferred.confirmed, []);
  assert.equal(uploads, 1);
  assert.equal((await ledger.read()).jobs[0].status, PRODUCTION_DELETE_STATUS.PENDING_CONFIRMATION);
  assert.equal((await store.load()).state.projects[0].listings[0].status, WORKFLOW_STATUS.PUBLISHED);

  reportAvailable = true;
  const confirmed = await service.runOnce({ trigger: "test-report" });
  assert.deepEqual(confirmed.confirmed, [SOURCE_EXTERNAL_ID]);
  const finalState = (await store.load()).state;
  assert.equal(finalState.projects[0].listings[0].status, WORKFLOW_STATUS.DELETED);
  assert.equal(finalState.projects[0].listings[1].status, WORKFLOW_STATUS.PUBLISHED);
  const repeated = await service.runOnce({ trigger: "test-repeat" });
  assert.equal(repeated.transferred.length, 0);
  assert.equal(uploads, 1);
});

test("manual exact production run selects only its authorized target and remains single-flight", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fpi-production-delete-exact-"));
  const store = memoryStore(productionStateWithSecondPair());
  const ledger = createProductionDeleteLedger(join(directory, "jobs.json"));
  let releaseUpload;
  const uploadGate = new Promise((resolve) => { releaseUpload = resolve; });
  const uploads = [];
  const service = createProductionDeleteService({
    store,
    modeStore: fixedMode("active"),
    ledger,
    productionPolicyStore: fixedSingleItemPolicy(),
    mailAdapter: { readOnly: true, async findCandidates() { return []; }, async readRawMessage() { throw new Error("unexpected"); } },
    upload: async ({ eligibility }) => {
      uploads.push(eligibility.source.externalId);
      await uploadGate;
    },
    now: () => NOW,
  });
  const first = service.runOnce({
    trigger: "manual-exact",
    targetExternalObjectNumber: "30460-574320",
  });
  await new Promise((resolve) => setImmediate(resolve));
  const overlapping = await service.runOnce({
    trigger: "manual-exact",
    targetExternalObjectNumber: "30460-574320",
  });
  assert.equal(overlapping.ran, false);
  assert.equal(overlapping.reason, "production-delete-run-in-progress");
  releaseUpload();
  const result = await first;
  assert.deepEqual(result.transferred, ["30460-574320"]);
  assert.deepEqual(uploads, ["30460-574320"]);
  assert.equal((await ledger.read()).jobs.length, 1);

  await assert.rejects(
    service.runOnce({ trigger: "periodic", targetExternalObjectNumber: SOURCE_EXTERNAL_ID }),
    (error) => error.code === "PRODUCTION_DELETE_EXACT_CONTRACT_INVALID",
  );
});

test("off mode and an upload failure remain fail closed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fpi-production-delete-off-"));
  const offStore = memoryStore(productionState());
  let offUploads = 0;
  const adapter = { readOnly: true, async findCandidates() { return []; }, async readRawMessage() { throw new Error("unexpected"); } };
  const offService = createProductionDeleteService({
    store: offStore,
    modeStore: fixedMode("off"),
    ledger: createProductionDeleteLedger(join(directory, "off-jobs.json")),
    productionPolicyStore: fixedPolicy(),
    mailAdapter: adapter,
    upload: async () => { offUploads += 1; },
  });
  assert.equal((await offService.runOnce()).ran, false);
  assert.equal(offUploads, 0);

  const failedStore = memoryStore(productionState());
  const failedLedger = createProductionDeleteLedger(join(directory, "failed-jobs.json"));
  const failedService = createProductionDeleteService({
    store: failedStore,
    modeStore: fixedMode("active"),
    ledger: failedLedger,
    productionPolicyStore: fixedPolicy(),
    mailAdapter: adapter,
    upload: async () => { throw new Error("synthetic transfer failure"); },
    now: () => NOW,
  });
  const failed = await failedService.runOnce();
  assert.equal(failed.ok, false);
  assert.equal((await failedLedger.read()).jobs[0].status, PRODUCTION_DELETE_STATUS.TRANSFER_UNCERTAIN);
  assert.equal((await failedStore.load()).state.projects[0].listings[0].productionDeleteState, "transfer_uncertain");
});

test("missing and corrupt production delete mode fall back to off", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fpi-production-delete-mode-"));
  const path = join(directory, "mode.json");
  const store = createProductionDeleteModeStore(path, { now: () => NOW });
  assert.deepEqual(await store.load(), {
    format: 1,
    mode: "off",
    updatedAt: "",
    valid: false,
    fallbackReason: "Produktions-Delete-Modus fehlt, ist beschädigt oder unbekannt; fail-closed auf off.",
  });
  await writeFile(path, "{broken", "utf8");
  const corrupt = await store.load();
  assert.equal(corrupt.mode, "off");
  assert.equal(corrupt.valid, false);
});

test("pending reports consume the shared three-item budget before new deletes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fpi-production-delete-budget-"));
  const store = memoryStore(productionStateWithPairs(3));
  const ledger = createProductionDeleteLedger(join(directory, "jobs.json"));
  let uploads = 0;
  for (let index = 0; index < 2; index += 1) {
    const state = (await store.load()).state;
    const project = state.projects[index];
    const source = project.listings[0];
    const replacement = project.listings[1];
    const eligibility = resolveProductionDeleteEligibility(state, project.id, source.id, await ledger.read());
    const identity = productionDeleteIdentity(source, replacement);
    const payload = await buildProductionDeletePayload(state, eligibility, { preparedAt: NOW });
    const prepared = await ledger.prepare({
      ...identity,
      projectId: project.id,
      sourceListingId: source.id,
      replacementListingId: replacement.id,
      externalObjectNumber: source.externalId,
      replacementExternalObjectNumber: replacement.externalId,
      payloadFilename: payload.payloadFilename,
      payloadSha256: payload.payloadSha256,
      payloadSize: payload.payloadSize,
    }, NOW);
    const claimed = await ledger.claim(prepared.deleteJobId, NOW);
    const transferred = await ledger.transferred(prepared.deleteJobId, claimed.claimToken, NOW);
    await store.update((current) => {
      const currentProject = current.projects.find((entry) => entry.id === project.id);
      currentProject.listings[0].productionDeleteState = "pending_confirmation";
      currentProject.listings[0].productionDeleteJobId = transferred.deleteJobId;
      return { state: current };
    });
  }
  const service = createProductionDeleteService({
    store,
    modeStore: fixedMode("active"),
    ledger,
    productionPolicyStore: fixedPolicy(),
    mailAdapter: { readOnly: true, async findCandidates() { return []; }, async readRawMessage() { throw new Error("unexpected"); } },
    upload: async () => { uploads += 1; },
    now: () => NOW,
  });
  const first = await service.runOnce();
  assert.equal(first.pendingConfirmationCount, 3);
  assert.equal(uploads, 1);

  const current = (await store.load()).state;
  current.projects[2].listings[0].productionDeleteState = "authorized";
  await store.update(() => ({ state: current }));
  const second = await service.runOnce();
  assert.equal(second.pendingConfirmationCount, 3);
  assert.equal(second.transferred.length, 0);
  assert.equal(uploads, 1);
});

test("a provenance-bound consumed one-shot batch authorizes up to 25 serial production DELETE transfers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fpi-production-delete-batch-"));
  const schedulerRunId = "scheduler-batch-25";
  const { store: batchOverrideStore, armed } = await consumedBatchOverride(directory, 25, schedulerRunId);
  const state = productionStateWithPairs(25, {
    schedulerRunId,
    batchOverrideId: armed.overrideId,
    batchOverrideMaxRunItems: 25,
    runtimeCommit: RUNTIME_COMMIT,
  });
  const store = memoryStore(state);
  const ledger = createProductionDeleteLedger(join(directory, "jobs.json"));
  const logs = [];
  const uploads = [];
  let activeUploads = 0;
  let maximumConcurrentUploads = 0;
  const service = createProductionDeleteService({
    store,
    modeStore: fixedMode("active"),
    ledger,
    productionPolicyStore: fixedPolicy(),
    batchOverrideStore,
    runtimeProvenance: fixedRuntimeProvenance(),
    mailAdapter: { readOnly: true, async findCandidates() { return []; }, async readRawMessage() { throw new Error("unexpected"); } },
    upload: async ({ job }) => {
      activeUploads += 1;
      maximumConcurrentUploads = Math.max(maximumConcurrentUploads, activeUploads);
      uploads.push(job.externalObjectNumber);
      await new Promise((resolve) => setImmediate(resolve));
      activeUploads -= 1;
    },
    writeLog: async (event, details) => logs.push({ event, ...details }),
    now: () => NOW,
  });
  const result = await service.runOnce({ trigger: "batch-test" });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.maxRunItems, 3);
  assert.equal(result.effectiveMaxRunItems, 25);
  assert.equal(result.batchOverrideId, armed.overrideId);
  assert.equal(result.schedulerRunId, schedulerRunId);
  assert.equal(result.runtimeCommit, RUNTIME_COMMIT);
  assert.equal(result.transferred.length, 25);
  assert.equal(uploads.length, 25);
  assert.equal(maximumConcurrentUploads, 1);
  const jobs = (await ledger.read()).jobs;
  assert.equal(jobs.length, 25);
  assert.ok(jobs.every((job) =>
    job.status === PRODUCTION_DELETE_STATUS.PENDING_CONFIRMATION
    && job.batchOverrideId === armed.overrideId
    && job.batchOverrideMaxRunItems === 25
    && job.schedulerRunId === schedulerRunId
    && job.runtimeCommit === RUNTIME_COMMIT));
  assert.ok(logs.some((entry) => entry.event === "run-context" && entry.batchOverrideId === armed.overrideId && entry.effectiveMaxRunItems === 25));
});

test("more than three normal DELETE chains without one-shot provenance fail closed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fpi-production-delete-normal-overflow-"));
  let uploads = 0;
  const service = createProductionDeleteService({
    store: memoryStore(productionStateWithPairs(4)),
    modeStore: fixedMode("active"),
    ledger: createProductionDeleteLedger(join(directory, "jobs.json")),
    productionPolicyStore: fixedPolicy(),
    mailAdapter: { readOnly: true, async findCandidates() { return []; }, async readRawMessage() { throw new Error("unexpected"); } },
    upload: async () => { uploads += 1; },
    now: () => NOW,
  });
  await assert.rejects(
    service.runOnce({ trigger: "normal-overflow" }),
    (error) => error.code === "PRODUCTION_DELETE_NORMAL_LIMIT_EXCEEDED",
  );
  assert.equal(uploads, 0);
});

test("a DELETE job with a false batch override ID or scheduler run fails closed before FTPS", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fpi-production-delete-batch-mismatch-"));
  const schedulerRunId = "scheduler-batch-mismatch";
  const { store: batchOverrideStore, armed } = await consumedBatchOverride(directory, 25, schedulerRunId);
  const state = productionStateWithPairs(1, {
    schedulerRunId,
    batchOverrideId: armed.overrideId,
    batchOverrideMaxRunItems: 25,
    runtimeCommit: RUNTIME_COMMIT,
  });
  const ledger = createProductionDeleteLedger(join(directory, "jobs.json"));
  const eligibility = resolveProductionDeleteEligibility(state, "project-1", "source-listing-1");
  const identity = productionDeleteIdentity(eligibility.source, eligibility.replacement);
  const payload = await buildProductionDeletePayload(state, eligibility, { preparedAt: NOW });
  await ledger.prepare({
    ...identity,
    batchOverrideId: "production-batch-override:false-id",
    projectId: eligibility.project.id,
    sourceListingId: eligibility.source.id,
    replacementListingId: eligibility.replacement.id,
    externalObjectNumber: eligibility.source.externalId,
    replacementExternalObjectNumber: eligibility.replacement.externalId,
    payloadFilename: payload.payloadFilename,
    payloadSha256: payload.payloadSha256,
    payloadSize: payload.payloadSize,
  }, NOW);
  let uploads = 0;
  const service = createProductionDeleteService({
    store: memoryStore(state),
    modeStore: fixedMode("active"),
    ledger,
    productionPolicyStore: fixedPolicy(),
    batchOverrideStore,
    runtimeProvenance: fixedRuntimeProvenance(),
    mailAdapter: { readOnly: true, async findCandidates() { return []; }, async readRawMessage() { throw new Error("unexpected"); } },
    upload: async () => { uploads += 1; },
    now: () => NOW,
  });
  await assert.rejects(
    service.runOnce({ trigger: "mismatched-job" }),
    (error) => error.code === "PRODUCTION_DELETE_JOB_PROVENANCE_MISMATCH",
  );
  assert.equal(uploads, 0);

  const wrongRunState = structuredClone(state);
  wrongRunState.projects[0].listings[1].productionLifecycle.schedulerRunId = "different-scheduler-run";
  const wrongRunService = createProductionDeleteService({
    store: memoryStore(wrongRunState),
    modeStore: fixedMode("active"),
    ledger: createProductionDeleteLedger(join(directory, "wrong-run-jobs.json")),
    productionPolicyStore: fixedPolicy(),
    batchOverrideStore,
    runtimeProvenance: fixedRuntimeProvenance(),
    mailAdapter: { readOnly: true, async findCandidates() { return []; }, async readRawMessage() { throw new Error("unexpected"); } },
    upload: async () => { uploads += 1; },
    now: () => NOW,
  });
  await assert.rejects(
    wrongRunService.runOnce({ trigger: "wrong-run" }),
    (error) => error.code === "PRODUCTION_DELETE_LIFECYCLE_MISMATCH",
  );
  assert.equal(uploads, 0);
});

test("batch DELETE provenance requires the exact running runtime and persistent override record", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fpi-production-delete-runtime-mismatch-"));
  const schedulerRunId = "scheduler-batch-runtime";
  const { store: batchOverrideStore, armed } = await consumedBatchOverride(directory, 4, schedulerRunId);
  const state = productionStateWithPairs(1, {
    schedulerRunId,
    batchOverrideId: armed.overrideId,
    batchOverrideMaxRunItems: 4,
    runtimeCommit: RUNTIME_COMMIT,
  });
  let uploads = 0;
  const service = createProductionDeleteService({
    store: memoryStore(state),
    modeStore: fixedMode("active"),
    ledger: createProductionDeleteLedger(join(directory, "jobs.json")),
    productionPolicyStore: fixedPolicy(),
    batchOverrideStore,
    runtimeProvenance: fixedRuntimeProvenance("b".repeat(40)),
    mailAdapter: { readOnly: true, async findCandidates() { return []; }, async readRawMessage() { throw new Error("unexpected"); } },
    upload: async () => { uploads += 1; },
    now: () => NOW,
  });
  await assert.rejects(
    service.runOnce({ trigger: "runtime-mismatch" }),
    (error) => error.code === "PRODUCTION_DELETE_BATCH_RUNTIME_UNAUTHORIZED",
  );
  assert.equal(uploads, 0);
});

test("interrupted delete job blocks every later transfer after restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fpi-production-delete-restart-"));
  const store = memoryStore(productionState());
  const ledger = createProductionDeleteLedger(join(directory, "jobs.json"));
  const state = (await store.load()).state;
  const eligibility = resolveProductionDeleteEligibility(state, "project-1", "source-listing");
  const payload = await buildProductionDeletePayload(state, eligibility, { preparedAt: NOW });
  const identity = productionDeleteIdentity(eligibility.source, eligibility.replacement);
  const prepared = await ledger.prepare({
    ...identity,
    projectId: "project-1",
    sourceListingId: "source-listing",
    replacementListingId: "replacement-listing",
    externalObjectNumber: SOURCE_EXTERNAL_ID,
    replacementExternalObjectNumber: REPLACEMENT_EXTERNAL_ID,
    payloadFilename: payload.payloadFilename,
    payloadSha256: payload.payloadSha256,
    payloadSize: payload.payloadSize,
  }, NOW);
  await ledger.claim(prepared.deleteJobId, NOW);
  let uploads = 0;
  const restarted = createProductionDeleteService({
    store,
    modeStore: fixedMode("active"),
    ledger,
    productionPolicyStore: fixedPolicy(),
    mailAdapter: { readOnly: true, async findCandidates() { return []; }, async readRawMessage() { throw new Error("unexpected"); } },
    upload: async () => { uploads += 1; },
    now: () => NOW,
  });
  const result = await restarted.runOnce({ trigger: "restart" });
  assert.equal(result.ran, false);
  assert.match(result.reason, /unterbrochene Produktions-Deletejobs/u);
  assert.equal(uploads, 0);
});
