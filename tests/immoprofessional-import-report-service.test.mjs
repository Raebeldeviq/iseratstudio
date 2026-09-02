import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createUploadJobId } from "../batch-upload.mjs";
import { IMPORT_REPORT_MAIL_FOLDER } from "../apple-mail-import-report-adapter.mjs";
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
  let updates = 0;
  return {
    async load() { return { stored: true, savedAt: "2026-08-13T09:00:00.000Z", state }; },
    async update(mutator) {
      const mutation = await mutator(state, { savedAt: "2026-08-13T09:00:00.000Z", attempt: 1 });
      const nextState = mutation?.state || mutation;
      if (options.failConfirmation && nextState?.importReports?.length > (state.importReports || []).length) throw new Error("CATALOG_CAS_FAILED");
      state = nextState;
      updates += 1;
      return { stored: true, state, result: mutation?.state ? mutation.result : undefined, changed: true };
    },
    current() { return state; },
    updateCount() { return updates; },
  };
}

function fakeMail(options = {}) {
  let scanCount = 0;
  let readCount = 0;
  let mutationCount = 0;
  const candidates = options.candidates ?? [{
    transportId: "42",
    accountName: "Livinghaus",
    accountId: "synthetic-account-id",
    accountType: "unknown",
    mailboxName: IMPORT_REPORT_MAIL_FOLDER,
  }];
  const mutationTrap = async () => {
    mutationCount += 1;
    throw new Error("MAIL_MUTATION_FORBIDDEN");
  };
  return {
    readOnly: true,
    accountName: "Livinghaus",
    mailboxName: IMPORT_REPORT_MAIL_FOLDER,
    async findCandidates() {
      scanCount += 1;
      if (options.findError) throw options.findError;
      return candidates;
    },
    async readRawMessage(candidate) {
      readCount += 1;
      return { ...candidate, rawSource: options.raw || rawSuccess };
    },
    moveProcessedMessage: options.exposeMutationTraps ? mutationTrap : undefined,
    deleteMessage: options.exposeMutationTraps ? mutationTrap : undefined,
    copyMessage: options.exposeMutationTraps ? mutationTrap : undefined,
    markRead: options.exposeMutationTraps ? mutationTrap : undefined,
    markUnread: options.exposeMutationTraps ? mutationTrap : undefined,
    flagMessage: options.exposeMutationTraps ? mutationTrap : undefined,
    categorizeMessage: options.exposeMutationTraps ? mutationTrap : undefined,
    createFolder: options.exposeMutationTraps ? mutationTrap : undefined,
    renameFolder: options.exposeMutationTraps ? mutationTrap : undefined,
    counts() { return { scanCount, readCount, mutationCount }; },
  };
}

function createService(setup, store, mail, writeLog = async () => undefined) {
  return createImmoprofessionalImportReportService({
    store,
    uploadJobLedger: { read: async () => setup.ledger },
    mailAdapter: mail,
    writeLog,
  });
}

test("confirms exactly one valid report from the dedicated folder with zero mail mutations", async () => {
  const setup = setupState();
  const store = fakeStore(setup.state);
  const mail = fakeMail({ exposeMutationTraps: true });
  const service = createService(setup, store, mail);
  const result = await service.runOnce({ now: "2026-08-13T09:17:00.000Z" });

  assert.equal(result.processed[0].status, "confirmed");
  assert.equal(result.mailMutations, 0);
  assert.deepEqual(mail.counts(), { scanCount: 1, readCount: 1, mutationCount: 0 });
  const copy = store.current().projects[0].listings.find((listing) => listing.id === "copy");
  assert.equal(copy.status, WORKFLOW_STATUS.PUBLISHED);
  assert.equal(copy.lastUploadedAt, "2026-08-13T09:16:00.000Z");
  assert.equal(copy.nextUpdateAt, "2026-08-22T09:16:00.000Z");
  assert.equal(store.current().importReports[0].processingStatus, "confirmed");
  assert.equal(store.current().importReports[0].mailSourceFolder, IMPORT_REPORT_MAIL_FOLDER);
  assert.equal("mailMovedAt" in store.current().importReports[0], false);
  assert.equal(store.current().mailImportReportStatus.status, "confirmed");
});

test("ignores a valid report that exists only in Inbox because there is no Inbox fallback", async () => {
  const setup = setupState();
  const store = fakeStore(setup.state);
  const mail = fakeMail({ candidates: [] });
  const result = await createService(setup, store, mail).runOnce({ now: "2026-08-13T09:17:00.000Z" });
  assert.equal(result.candidateCount, 0);
  assert.equal(store.current().projects[0].listings.find((listing) => listing.id === "copy").status, WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT);
  assert.equal(store.current().importReports?.length || 0, 0);
  assert.deepEqual(mail.counts(), { scanCount: 1, readCount: 0, mutationCount: 0 });
});

test("helper restart and a report left permanently in the folder do not create a second business mutation", async () => {
  const setup = setupState();
  const store = fakeStore(setup.state);
  const firstMail = fakeMail({ exposeMutationTraps: true });
  await createService(setup, store, firstMail).runOnce({ now: "2026-08-13T09:17:00.000Z" });
  const afterFirst = structuredClone(store.current());

  const restartedMail = fakeMail({ exposeMutationTraps: true });
  const second = await createService(setup, store, restartedMail).runOnce({ now: "2026-08-13T09:18:00.000Z" });
  assert.equal(second.reason, "no-pending-imports");
  assert.equal(second.ran, false);
  assert.deepEqual(restartedMail.counts(), { scanCount: 0, readCount: 0, mutationCount: 0 });
  assert.deepEqual(store.current(), afterFirst);
  assert.equal(store.current().importReports.length, 1);
});

test("historical mail-move states remain readable and never trigger a mail action", async () => {
  for (const processingStatus of ["confirmed_mail_move_pending", "mail_move_manual_review_required"]) {
    const setup = setupState();
    setup.state.projects[0].listings.find((listing) => listing.id === "copy").status = WORKFLOW_STATUS.PUBLISHED;
    setup.state.importReports = [{
      reportId: `historical-${processingStatus}`,
      messageId: "<historical@example.invalid>",
      rawHash: "f".repeat(64),
      processingStatus,
      externalObjectNumber: "30460-810978",
      mailTransportId: "42",
    }];
    const store = fakeStore(setup.state);
    const mail = fakeMail({ exposeMutationTraps: true });
    const before = structuredClone(store.current());
    const result = await createService(setup, store, mail).runOnce();
    assert.equal(result.reason, "no-pending-imports");
    assert.deepEqual(mail.counts(), { scanCount: 0, readCount: 0, mutationCount: 0 });
    assert.deepEqual(store.current(), before);
  }
});

test("parsing errors, ambiguous matches and CAS failures remain fail-closed", async () => {
  for (const scenario of [
    { name: "parse", expected: "rejected", setup: setupState(), mail: fakeMail({ raw: rawSuccess.replace("Anbieter-ID: 30460", "Anbieter-ID: 99999"), exposeMutationTraps: true }), storeOptions: {} },
    { name: "ambiguous", expected: "ambiguous", setup: setupState({ duplicate: true }), mail: fakeMail({ exposeMutationTraps: true }), storeOptions: {} },
    { name: "persistence", expected: "rejected", setup: setupState(), mail: fakeMail({ exposeMutationTraps: true }), storeOptions: { failConfirmation: true } },
  ]) {
    const store = fakeStore(scenario.setup.state, scenario.storeOptions);
    const result = await createService(scenario.setup, store, scenario.mail).runOnce({ now: "2026-08-13T09:17:00.000Z" });
    assert.equal(result.processed[0].status, scenario.expected, scenario.name);
    assert.equal(scenario.mail.counts().mutationCount, 0, scenario.name);
    assert.equal(store.current().projects[0].listings.find((listing) => listing.id === "copy").status, WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT, scenario.name);
  }
});

test("does not access Apple Mail without a pending import", async () => {
  const setup = setupState();
  setup.state.projects[0].listings.find((listing) => listing.id === "copy").status = WORKFLOW_STATUS.PUBLISHED;
  const store = fakeStore(setup.state);
  const mail = fakeMail({ exposeMutationTraps: true });
  const result = await createService(setup, store, mail).runOnce();
  assert.equal(result.reason, "no-pending-imports");
  assert.deepEqual(mail.counts(), { scanCount: 0, readCount: 0, mutationCount: 0 });
});

test("missing or ambiguous account/folder exposes setup required and preserves the pending copy", async () => {
  for (const code of [
    "MAIL_ACCOUNT_NOT_FOUND",
    "MAIL_ACCOUNT_AMBIGUOUS",
    "MAIL_IMPORT_REPORT_FOLDER_NOT_FOUND",
    "MAIL_IMPORT_REPORT_FOLDER_AMBIGUOUS",
  ]) {
    const setup = setupState();
    const store = fakeStore(setup.state);
    const error = new Error(code);
    error.code = "MAIL_IMPORT_REPORT_SETUP_REQUIRED";
    const mail = fakeMail({ findError: error, exposeMutationTraps: true });
    const result = await createService(setup, store, mail).runOnce();
    assert.equal(result.setupRequired, true, code);
    assert.equal(store.current().mailImportReportStatus.status, "setup_required", code);
    assert.match(store.current().mailImportReportStatus.message, /Importbericht-Ordner nicht verfügbar/u, code);
    assert.equal(store.current().projects[0].listings.find((listing) => listing.id === "copy").status, WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT, code);
    assert.equal(mail.counts().mutationCount, 0, code);
  }
});

test("Apple Mail timeout is never setup required and preserves the existing transferred job for later recovery", async () => {
  const setup = setupState();
  const store = fakeStore(setup.state);
  const before = structuredClone(store.current());
  const timeout = Object.assign(new Error("Apple Mail hat nicht geantwortet."), {
    code: "MAIL_AUTOMATION_TIMEOUT",
    timedOut: true,
    exitSignal: "SIGTERM",
    durationMs: 10_000,
  });
  const timedOutMail = fakeMail({ findError: timeout, exposeMutationTraps: true });
  const first = await createService(setup, store, timedOutMail).runOnce({ now: "2026-08-13T09:17:00.000Z" });

  assert.equal(first.errorCode, "MAIL_AUTOMATION_TIMEOUT");
  assert.equal(first.setupRequired, false);
  assert.equal(store.current().mailImportReportStatus.status, "automation_timeout");
  assert.deepEqual(store.current().projects, before.projects);
  assert.equal(store.current().importReports?.length || 0, 0);
  assert.deepEqual(timedOutMail.counts(), { scanCount: 1, readCount: 0, mutationCount: 0 });

  const recoveredMail = fakeMail({ exposeMutationTraps: true });
  const second = await createService(setup, store, recoveredMail).runOnce({ now: "2026-08-13T09:18:00.000Z" });
  assert.equal(second.processed[0].status, "confirmed");
  const source = store.current().projects[0].listings.find((listing) => listing.id === "source");
  const copy = store.current().projects[0].listings.find((listing) => listing.id === "copy");
  assert.equal(copy.status, WORKFLOW_STATUS.PUBLISHED);
  assert.equal(copy.lastUploadedAt, "2026-08-13T09:16:00.000Z");
  assert.equal(copy.nextUpdateAt, "2026-08-22T09:16:00.000Z");
  assert.equal(source.supersededByListingId, copy.id);
  assert.equal(source.externalDeletionPending, true);
  assert.equal(store.current().importReports.length, 1);
});

test("unmatched parsed report is classified explicitly and cannot mutate the pending replacement", async () => {
  const setup = setupState();
  const store = fakeStore(setup.state);
  const beforeProjects = structuredClone(store.current().projects);
  const mail = fakeMail({ raw: rawSuccess.replaceAll("30460-810978", "30460-999999"), exposeMutationTraps: true });
  const result = await createService(setup, store, mail).runOnce({ now: "2026-08-13T09:17:00.000Z" });
  assert.equal(result.processed[0].status, "unmatched");
  assert.equal(result.processed[0].errorCode, "MAIL_IMPORT_REPORT_UNMATCHED");
  assert.deepEqual(store.current().projects, beforeProjects);
  assert.equal(store.current().importReports?.length || 0, 0);
});

test("refuses a mail adapter that is not explicitly read-only", () => {
  const setup = setupState();
  const store = fakeStore(setup.state);
  const mail = fakeMail();
  mail.readOnly = false;
  assert.throws(() => createService(setup, store, mail), /read-only/u);
});

test("bounded live-canary scan cannot mutate another pending external object number", async () => {
  const setup = setupState();
  const store = fakeStore(setup.state);
  const unrelatedRaw = rawSuccess.replaceAll("30460-810978", "30460-056361");
  const mail = fakeMail({ raw: unrelatedRaw, exposeMutationTraps: true });
  const before = structuredClone(store.current());
  const result = await createService(setup, store, mail).runOnce({
    now: "2026-08-13T09:17:00.000Z",
    allowedExternalObjectNumbers: ["30460-810978"],
  });
  assert.equal(result.pendingCount, 1);
  assert.equal(result.processed[0].status, "not-canary-authorized");
  assert.equal(result.processed[0].externalObjectNumber, "30460-056361");
  assert.deepEqual(store.current(), before);
  assert.deepEqual(mail.counts(), { scanCount: 1, readCount: 1, mutationCount: 0 });
});

test("permission denied and unavailable remain distinct fail-closed runtime classes", async () => {
  for (const [code, expectedStatus] of [
    ["MAIL_AUTOMATION_PERMISSION_DENIED", "automation_permission_denied"],
    ["MAIL_AUTOMATION_UNAVAILABLE", "automation_unavailable"],
  ]) {
    const setup = setupState();
    const store = fakeStore(setup.state);
    const error = Object.assign(new Error(code), { code });
    const mail = fakeMail({ findError: error, exposeMutationTraps: true });
    const result = await createService(setup, store, mail).runOnce();
    assert.equal(result.errorCode, code);
    assert.equal(result.setupRequired, false);
    assert.equal(store.current().mailImportReportStatus.status, expectedStatus);
    assert.equal(store.current().projects[0].listings.find((listing) => listing.id === "copy").status, WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT);
    assert.equal(mail.counts().mutationCount, 0);
  }
});

test("mail polling is single-flight and releases cleanly after completion", async () => {
  const setup = setupState();
  const store = fakeStore(setup.state);
  let releaseScan;
  let scanCount = 0;
  const mail = {
    readOnly: true,
    mailboxName: IMPORT_REPORT_MAIL_FOLDER,
    async findCandidates() {
      scanCount += 1;
      if (scanCount === 1) await new Promise((resolve) => { releaseScan = resolve; });
      return [];
    },
    async readRawMessage() { throw new Error("unexpected read"); },
  };
  const service = createService(setup, store, mail);
  const first = service.runOnce({ now: "2026-08-13T09:17:00.000Z" });
  await new Promise((resolve) => setImmediate(resolve));
  const overlapping = await service.runOnce({ now: "2026-08-13T09:17:01.000Z" });
  assert.deepEqual(overlapping, {
    ran: false,
    reason: "mail-poll-in-flight",
    inFlight: true,
    processed: [],
    mailMutations: 0,
  });
  releaseScan();
  await first;
  const afterRelease = await service.runOnce({ now: "2026-08-13T09:18:00.000Z" });
  assert.equal(afterRelease.ran, true);
  assert.equal(scanCount, 2);
});
