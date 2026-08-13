import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createUploadJobId } from "../batch-upload.mjs";
import { createImmoprofessionalImportReportService } from "../immoprofessional-import-report-service.mjs";
import { WORKFLOW_STATUS } from "../workflow-status.mjs";

const rawSuccess = await readFile(new URL("./fixtures/immoprofessional-import-success.eml", import.meta.url), "utf8");

function setupState({ duplicate = false } = {}) {
  const source = { id: "source", externalId: "30460-100000", listingOrigin: "group-source", listingGroupVariantId: "v1", templateId: "h1", templateName: "Haus 1", createdAt: "2026-07-01T08:00:00.000Z", status: WORKFLOW_STATUS.PUBLISHED };
  const copy = { id: "copy", externalId: "30460-810978", listingOrigin: "rotation-copy", rotationSourceListingId: source.id, listingGroupVariantId: "v1", templateId: "h2", templateName: "Haus 2", version: 2, createdAt: "2026-08-13T09:14:00.000Z", transferredAt: "2026-08-13T09:15:00.000Z", status: WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT };
  const project = {
    id: "p1", isActive: true, listings: [source, copy],
    listingGroup: {
      projectId: "p1", automation: { rotationEnabled: true, updateIntervalDays: 12 }, variants: [], logs: [],
      listingControls: [
        { listingId: source.id, externalId: source.externalId, status: WORKFLOW_STATUS.PUBLISHED, automaticUpdateEnabled: true, updateMode: "full-auto", pendingRotationListingId: copy.id },
        { listingId: copy.id, externalId: copy.externalId, status: WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT, automaticUpdateEnabled: false, updateMode: "full-auto" },
      ],
    },
  };
  const jobId = createUploadJobId(project, copy);
  project.listingGroup.listingControls[0].pendingRotationJobId = jobId;
  const projects = [project];
  if (duplicate) {
    const second = structuredClone(project);
    second.id = "p2";
    second.listings = second.listings.map((listing) => ({ ...listing, id: `${listing.id}-2`, rotationSourceListingId: listing.rotationSourceListingId ? "source-2" : undefined }));
    second.listingGroup.projectId = "p2";
    second.listingGroup.listingControls = second.listingGroup.listingControls.map((control) => ({ ...control, projectId: "p2", listingId: `${control.listingId}-2`, pendingRotationListingId: control.pendingRotationListingId ? "copy-2" : "" }));
    projects.push(second);
  }
  return {
    state: {
      version: 1, houses: [], projects, provider: { providerNumber: "30460" }, promotionImage: null, promotionImageEnabled: false,
      uploadHistory: [{ id: "u1", jobId, projectId: project.id, listingId: copy.id, status: WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT }],
      scheduler: { settings: { enabled: true, paused: false, mode: "full-auto", updateIntervalDays: 12 }, runs: [] },
    },
    ledger: { format: 1, jobs: [{ jobId, projectId: project.id, listingId: copy.id, status: WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT }] },
  };
}

function fakeStore(initialState, options = {}) {
  let state = structuredClone(initialState);
  return {
    async load() { return { stored: true, savedAt: "2026-08-13T09:00:00.000Z", state }; },
    async update(mutator) {
      const mutation = await mutator(state, { savedAt: "2026-08-13T09:00:00.000Z", attempt: 1 });
      const nextState = mutation?.state || mutation;
      if (options.failConfirmation && nextState?.importReports?.length > (state.importReports || []).length) throw new Error("CATALOG_CAS_FAILED");
      state = nextState;
      return { stored: true, state, result: mutation?.state ? mutation.result : undefined, changed: true };
    },
    current() { return state; },
  };
}

function fakeMail(options = {}) {
  let moveCount = 0;
  let scanCount = 0;
  return {
    accountName: "Livinghaus",
    targetFolder: "Inseratestudio – Importberichte",
    async findCandidates() { scanCount += 1; return [{ transportId: "42", accountName: "Livinghaus", mailboxName: "INBOX" }]; },
    async readRawMessage(candidate) { return { ...candidate, rawSource: options.raw || rawSuccess }; },
    async moveProcessedMessage() {
      moveCount += 1;
      if (options.failFirstMove && moveCount === 1) throw new Error("MAIL_MOVE_FAILED");
      return { moved: true, alreadyMoved: false, accountName: "Livinghaus", folderName: "Inseratestudio – Importberichte" };
    },
    counts() { return { moveCount, scanCount }; },
  };
}

test("confirms, persists, then moves exactly one Inbox report", async () => {
  const setup = setupState();
  const store = fakeStore(setup.state);
  const mail = fakeMail();
  const service = createImmoprofessionalImportReportService({ store, uploadJobLedger: { read: async () => setup.ledger }, mailAdapter: mail });
  const result = await service.runOnce({ now: "2026-08-13T09:17:00.000Z" });
  assert.equal(result.processed[0].status, "confirmed");
  assert.equal(result.processed[0].moved, true);
  assert.deepEqual(mail.counts(), { moveCount: 1, scanCount: 1 });
  assert.equal(store.current().projects[0].listings.find((listing) => listing.id === "copy").status, WORKFLOW_STATUS.PUBLISHED);
  assert.equal(store.current().importReports[0].processingStatus, "confirmed");
});

test("restarts safely after catalog confirmation when the mail remained in Inbox", async () => {
  const setup = setupState();
  const store = fakeStore(setup.state);
  const firstMail = fakeMail({ failFirstMove: true });
  const first = createImmoprofessionalImportReportService({ store, uploadJobLedger: { read: async () => setup.ledger }, mailAdapter: firstMail });
  const firstResult = await first.runOnce({ now: "2026-08-13T09:17:00.000Z" });
  assert.equal(firstResult.processed[0].status, "confirmed");
  assert.equal(firstResult.processed[0].moved, false);
  assert.equal(store.current().importReports.length, 1);
  assert.equal(store.current().importReports[0].processingStatus, "confirmed_mail_move_pending");

  const restartedMail = fakeMail();
  const restarted = createImmoprofessionalImportReportService({ store, uploadJobLedger: { read: async () => setup.ledger }, mailAdapter: restartedMail });
  const secondResult = await restarted.runOnce({ now: "2026-08-13T09:18:00.000Z" });
  assert.equal(secondResult.reason, "no-pending-imports");
  assert.equal(secondResult.retriedMoves[0].moved, true);
  assert.deepEqual(restartedMail.counts(), { moveCount: 1, scanCount: 0 });
  assert.equal(store.current().importReports.length, 1);
  assert.equal(store.current().importReports[0].processingStatus, "confirmed");
});

test("keeps parsing errors, ambiguous reports and persistence failures in Inbox", async () => {
  for (const scenario of [
    { name: "parse", setup: setupState(), mail: fakeMail({ raw: rawSuccess.replace("Anbieter-ID: 30460", "Anbieter-ID: 99999") }), storeOptions: {} },
    { name: "ambiguous", setup: setupState({ duplicate: true }), mail: fakeMail(), storeOptions: {} },
    { name: "persistence", setup: setupState(), mail: fakeMail(), storeOptions: { failConfirmation: true } },
  ]) {
    const store = fakeStore(scenario.setup.state, scenario.storeOptions);
    const service = createImmoprofessionalImportReportService({ store, uploadJobLedger: { read: async () => scenario.setup.ledger }, mailAdapter: scenario.mail });
    const result = await service.runOnce({ now: "2026-08-13T09:17:00.000Z" });
    assert.equal(result.processed[0].moved, false, scenario.name);
    assert.equal(scenario.mail.counts().moveCount, 0, scenario.name);
    assert.equal(store.current().projects[0].listings.find((listing) => listing.id === "copy").status, WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT, scenario.name);
  }
});

test("does not access Apple Mail when there is no pending import", async () => {
  const setup = setupState();
  setup.state.projects[0].listings.find((listing) => listing.id === "copy").status = WORKFLOW_STATUS.PUBLISHED;
  const store = fakeStore(setup.state);
  const mail = fakeMail();
  const service = createImmoprofessionalImportReportService({ store, uploadJobLedger: { read: async () => setup.ledger }, mailAdapter: mail });
  const result = await service.runOnce();
  assert.equal(result.reason, "no-pending-imports");
  assert.deepEqual(mail.counts(), { moveCount: 0, scanCount: 0 });
});

test("fails closed and exposes setup required when Livinghaus is not uniquely resolved", async () => {
  const setup = setupState();
  const store = fakeStore(setup.state);
  const error = new Error("MAIL_ACCOUNT_NOT_UNIQUE");
  error.code = "MAIL_IMPORT_REPORT_SETUP_REQUIRED";
  const mail = { ...fakeMail(), findCandidates: async () => { throw error; } };
  const service = createImmoprofessionalImportReportService({ store, uploadJobLedger: { read: async () => setup.ledger }, mailAdapter: mail });
  const result = await service.runOnce();
  assert.equal(result.setupRequired, true);
  assert.equal(store.current().mailImportReportStatus.status, "setup_required");
  assert.equal(store.current().projects[0].listings.find((listing) => listing.id === "copy").status, WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT);
});
