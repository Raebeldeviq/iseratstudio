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
import { WORKFLOW_STATUS } from "../workflow-status.mjs";

const NOW = "2026-08-14T12:00:00.000Z";
const SOURCE_EXTERNAL_ID = "30460-654321";
const REPLACEMENT_EXTERNAL_ID = "30460-654322";

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
  const store = memoryStore(productionState());
  const ledger = createProductionDeleteLedger(join(directory, "jobs.json"));
  let uploads = 0;
  for (let index = 0; index < 2; index += 1) {
    const suffix = String(index + 10).padStart(6, "0");
    const prepared = await ledger.prepare({
      deleteJobId: `existing-pending-${index}`,
      idempotencyKey: `existing-idempotency-${index}`,
      schedulerRunId: `existing-run-${index}`,
      projectId: `existing-project-${index}`,
      sourceListingId: `existing-source-${index}`,
      replacementListingId: `existing-replacement-${index}`,
      externalObjectNumber: `30460-${suffix}`,
      replacementExternalObjectNumber: `30460-${String(index + 20).padStart(6, "0")}`,
      payloadFilename: `existing-${index}.zip`,
      payloadSha256: `sha-${index}`,
      payloadSize: 100 + index,
    }, NOW);
    const claimed = await ledger.claim(prepared.deleteJobId, NOW);
    await ledger.transferred(prepared.deleteJobId, claimed.claimToken, NOW);
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
  current.projects[0].listings[0].productionDeleteState = "authorized";
  await store.update(() => ({ state: current }));
  const second = await service.runOnce();
  assert.equal(second.pendingConfirmationCount, 3);
  assert.equal(second.transferred.length, 0);
  assert.equal(uploads, 1);
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
