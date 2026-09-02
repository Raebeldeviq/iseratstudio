import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createUploadJobId } from "../batch-upload.mjs";
import { confirmImportReportInState } from "../immoprofessional-import-confirmation.mjs";
import {
  createListingGroup,
  listingControl,
  normalizeListingGroup,
  updateListingControl,
} from "../listing-groups.mjs";
import {
  ALLOWED_LEGACY_EXTERNAL_OBJECT_NUMBERS,
  createLegacyDeleteService,
  LEGACY_CONFIRMATION_SOURCE,
  LEGACY_RECONCILIATION_CASES,
  LEGACY_TIMESTAMP_SOURCE,
  LEGACY_VERIFICATION_METHOD,
  LEGACY_VERIFIED_BY,
  legacyDeleteIdentity,
  reconcileLegacyImportInState,
  resolveLegacyDeleteEligibility,
  resolveLegacyReconciliationEligibility,
  validateLegacyProviderPresenceEvidence,
} from "../listing-rotation-legacy-reconciliation.mjs";
import { runLegacyReconciliationCli } from "../listing-rotation-legacy-reconciliation-cli.mjs";
import {
  buildProductionDeletePayload,
  createProductionDeleteLedger,
  PRODUCTION_DELETE_STATUS,
} from "../listing-rotation-production-delete.mjs";
import { schedulerDueListings } from "../listing-scheduler.mjs";
import { WORKFLOW_STATUS } from "../workflow-status.mjs";

const NOW = "2026-08-15T10:00:00.000Z";
const TRANSFER_AT = "2026-08-12T15:22:59.957Z";

function caseFixture(replacementExternalObjectNumber = "30460-652921", overrides = {}) {
  const contract = LEGACY_RECONCILIATION_CASES[replacementExternalObjectNumber];
  const source = {
    id: contract.sourceListingId,
    externalId: contract.sourceExternalObjectNumber,
    templateId: "house-source",
    templateName: "SOL 242 V4",
    listingGroupVariantId: "variant-1",
    listingOrigin: "group-source",
    version: 1,
    status: WORKFLOW_STATUS.PUBLISHED,
  };
  const replacement = {
    id: contract.replacementListingId,
    externalId: replacementExternalObjectNumber,
    templateId: "house-replacement",
    templateName: "SOL 242 V4",
    listingGroupVariantId: "variant-1",
    listingOrigin: "rotation-copy",
    rotationSourceListingId: source.id,
    version: 2,
    transferredAt: TRANSFER_AT,
    status: WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT,
    ...overrides.replacement,
  };
  const project = {
    id: contract.projectId,
    plotId: "plot-legacy",
    zip: "14480",
    city: "Potsdam",
    isActive: true,
    listings: [source, replacement],
  };
  let group = createListingGroup(project.id, { now: "2026-07-01T00:00:00.000Z" });
  group = {
    ...group,
    automation: { ...group.automation, rotationEnabled: true, updateIntervalDays: 12 },
    variants: [{
      id: "variant-1",
      projectId: project.id,
      role: "variant",
      order: 1,
      templateId: replacement.templateId,
      templateName: replacement.templateName,
      active: true,
      approved: true,
      houseSnapshot: {},
      listing: replacement,
      createdAt: "2026-08-12T15:21:00.000Z",
      updatedAt: TRANSFER_AT,
    }],
  };
  group = updateListingControl(group, source, {
    automaticUpdateEnabled: true,
    automaticDeletionEnabled: false,
    updateMode: "full-auto",
    status: WORKFLOW_STATUS.PUBLISHED,
    pendingRotationListingId: replacement.id,
    pendingRotationJobId: contract.uploadJobId,
  }, { now: TRANSFER_AT });
  group = updateListingControl(group, replacement, {
    automaticUpdateEnabled: false,
    automaticDeletionEnabled: false,
    updateMode: "full-auto",
    status: WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT,
  }, { now: TRANSFER_AT });
  project.listingGroup = group;
  assert.equal(createUploadJobId(project, replacement), contract.uploadJobId);
  const state = {
    version: 1,
    provider: { providerNumber: "30460", company: "Test GmbH", lastName: "Test", email: "test@example.invalid" },
    houses: [
      { id: "house-source", name: "SOL 242 V4", houseType: "Einfamilienhaus" },
      { id: "house-replacement", name: "SOL 242 V4", houseType: "Einfamilienhaus" },
    ],
    projects: [project],
    importReports: [],
    importReportReviews: [],
    uploadHistory: [{
      id: "historical-transfer",
      jobId: contract.uploadJobId,
      projectId: project.id,
      listingId: replacement.id,
      status: WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT,
      updatedAt: TRANSFER_AT,
      error: "",
    }],
    scheduler: {
      settings: { enabled: true, paused: false, mode: "full-auto", updateIntervalDays: 12, initialWaitDays: 12 },
      runs: [],
    },
    ...overrides.state,
  };
  const ledger = {
    format: 1,
    jobs: [{
      jobId: contract.uploadJobId,
      projectId: project.id,
      listingId: replacement.id,
      status: WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT,
      transferredAt: TRANSFER_AT,
    }],
    ...overrides.ledger,
  };
  return { state, ledger, project, source, replacement, contract };
}

function providerEvidence(externalObjectNumber, overrides = {}) {
  return {
    format: 1,
    evidenceType: LEGACY_CONFIRMATION_SOURCE,
    confirmationSource: LEGACY_CONFIRMATION_SOURCE,
    verificationMethod: LEGACY_VERIFICATION_METHOD,
    externalObjectNumber,
    providerRecordExternalObjectNumber: externalObjectNumber,
    providerPresenceConfirmed: true,
    verifiedAt: NOW,
    verifiedBy: LEGACY_VERIFIED_BY,
    providerSystem: "immoprofessional",
    providerId: "30460",
    verificationScope: "current_provider_inventory",
    readOnly: true,
    originalImportReportAvailable: false,
    ...overrides,
  };
}

function memoryStore(initialState) {
  let state = structuredClone(initialState);
  return {
    async load() { return { stored: true, state: structuredClone(state), savedAt: NOW }; },
    async update(mutator) {
      const current = structuredClone(state);
      const mutation = await mutator(current);
      const next = mutation?.state || mutation;
      const changed = JSON.stringify(next) !== JSON.stringify(state);
      state = structuredClone(next);
      return { stored: true, state: structuredClone(state), result: mutation?.result, changed };
    },
  };
}

function fixedMode(mode = "off") {
  return { async load() { return { format: 1, mode, canaryListingIds: [], valid: true, fallbackReason: "" }; } };
}

function rawDeleteReport(target, messageId = "legacy-delete") {
  return [
    "Received: from server22.immoprofessional.eu by mail.example.invalid",
    "Authentication-Results: mail.example.invalid; spf=pass smtp.mailfrom=server22.immoprofessional.eu",
    `Message-ID: <${messageId}@server22.immoprofessional.eu>`,
    "Subject: Importbericht OpenImmo XML",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    "eine Importdatei wurde am 15.08.2026 um 12:01 Uhr verarbeitet.",
    "Sendersoftware: Fabian&Pascal Inseratestudio",
    "Anzahl Objekte: 1",
    "Anbieter-ID: 30460",
    `OK: Objekt-Nr.: "${target}"`,
    "Erfolgreich gelöscht -",
    `Das Objekt "${target}" wurde aus der Börse "Immobilienscout24" gelöscht.`,
  ].join("\r\n");
}

function publishedLegacyFixture(externalObjectNumber = "30460-652921") {
  const fixture = caseFixture(externalObjectNumber);
  const reconciliation = reconcileLegacyImportInState(fixture.state, fixture.ledger, providerEvidence(externalObjectNumber), { now: NOW });
  return { ...fixture, state: reconciliation.state, reconciliation };
}

test("1-3: hardcoded allowlist accepts only the two historical replacement numbers", () => {
  assert.deepEqual([...ALLOWED_LEGACY_EXTERNAL_OBJECT_NUMBERS].sort(), ["30460-056361", "30460-652921"]);
  for (const externalObjectNumber of ALLOWED_LEGACY_EXTERNAL_OBJECT_NUMBERS) {
    const fixture = caseFixture(externalObjectNumber);
    assert.equal(resolveLegacyReconciliationEligibility(fixture.state, fixture.ledger, providerEvidence(externalObjectNumber), { now: NOW }).status, "eligible");
  }
  assert.throws(
    () => validateLegacyProviderPresenceEvidence(providerEvidence("30460-999999"), { now: NOW }),
    (error) => error.code === "LEGACY_RECONCILIATION_NOT_AUTHORIZED",
  );
});

test("4-10: eligibility rejects status, transfer, reports and non-exact provider evidence", () => {
  const wrongStatus = caseFixture("30460-652921", { replacement: { status: WORKFLOW_STATUS.PUBLISHED } });
  assert.throws(() => resolveLegacyReconciliationEligibility(wrongStatus.state, wrongStatus.ledger, providerEvidence("30460-652921"), { now: NOW }), /transferred_pending_import/u);

  const noTransfer = caseFixture();
  noTransfer.ledger.jobs = [];
  assert.throws(() => resolveLegacyReconciliationEligibility(noTransfer.state, noTransfer.ledger, providerEvidence("30460-652921"), { now: NOW }), /Uploadledger/u);

  const duplicateTransfer = caseFixture();
  duplicateTransfer.ledger.jobs.push({ ...duplicateTransfer.ledger.jobs[0], jobId: `${duplicateTransfer.ledger.jobs[0].jobId}:duplicate` });
  assert.throws(() => resolveLegacyReconciliationEligibility(duplicateTransfer.state, duplicateTransfer.ledger, providerEvidence("30460-652921"), { now: NOW }), /Uploadledger/u);

  const duplicateReplacement = caseFixture();
  duplicateReplacement.state.projects[0].listings.push({ ...duplicateReplacement.replacement, id: "unexpected-second-copy", externalId: "30460-111111" });
  assert.throws(() => resolveLegacyReconciliationEligibility(duplicateReplacement.state, duplicateReplacement.ledger, providerEvidence("30460-652921"), { now: NOW }), /Source-Replacement/u);

  const negative = caseFixture();
  negative.state.importReportReviews = [{ externalObjectNumber: "30460-652921", result: "error" }];
  assert.throws(() => resolveLegacyReconciliationEligibility(negative.state, negative.ledger, providerEvidence("30460-652921"), { now: NOW }), /Importberichtbeleg/u);

  const positive = caseFixture();
  positive.state.importReports = [{ externalObjectNumber: "30460-652921", importResult: "success" }];
  assert.equal(resolveLegacyReconciliationEligibility(positive.state, positive.ledger, providerEvidence("30460-652921"), { now: NOW }).status, "normal_confirmation_exists");

  assert.throws(() => validateLegacyProviderPresenceEvidence(providerEvidence("30460-652921", { providerPresenceConfirmed: false }), { now: NOW }), (error) => error.code === "LEGACY_PROVIDER_PRESENCE_NOT_CONFIRMED");
  assert.throws(() => validateLegacyProviderPresenceEvidence(providerEvidence("30460-652921", { providerRecordExternalObjectNumber: "30460-056361" }), { now: NOW }), (error) => error.code === "LEGACY_PROVIDER_PRESENCE_NOT_CONFIRMED");
  assert.throws(() => validateLegacyProviderPresenceEvidence(providerEvidence("30460-652921", { readOnly: false }), { now: NOW }), (error) => error.code === "LEGACY_PROVIDER_PRESENCE_NOT_CONFIRMED");
  assert.equal(validateLegacyProviderPresenceEvidence(providerEvidence("30460-652921"), { now: NOW }).providerPresenceConfirmed, true);
});

test("11-17: legacy provenance is explicit and never fabricates report metadata", () => {
  const fixture = publishedLegacyFixture();
  const evidence = fixture.reconciliation.result.evidence;
  const copy = fixture.reconciliation.state.projects[0].listings.find((listing) => listing.externalId === "30460-652921");
  assert.equal(evidence.evidenceType, LEGACY_CONFIRMATION_SOURCE);
  assert.notEqual(evidence.evidenceType, "import_report");
  assert.equal(evidence.confirmationSource, LEGACY_CONFIRMATION_SOURCE);
  assert.equal(evidence.verificationMethod, "manual_immoprofessional_exact_object_number");
  assert.equal(evidence.verifiedBy, "user_confirmed_provider_presence");
  assert.equal(evidence.verifiedAt, NOW);
  assert.equal(evidence.timestampSource, LEGACY_TIMESTAMP_SOURCE);
  assert.equal(evidence.historicalTransferAt, TRANSFER_AT);
  assert.equal(copy.lastUploadedAt, TRANSFER_AT);
  assert.equal(copy.legacyProviderVerifiedAt, NOW);
  assert.equal(copy.importReportId, undefined);
  assert.equal(copy.importConfirmedAt, undefined);
  assert.equal("messageId" in evidence, false);
  assert.equal("rawHash" in evidence, false);
  assert.equal("providerImportAt" in evidence, false);
  assert.equal(fixture.reconciliation.state.importReports.length, 0);
});

test("18-23: reconciliation publishes, performs the scheduler handover and is idempotent", () => {
  const fixture = publishedLegacyFixture();
  const project = fixture.reconciliation.state.projects[0];
  const source = project.listings.find((listing) => listing.externalId === fixture.contract.sourceExternalObjectNumber);
  const copy = project.listings.find((listing) => listing.externalId === "30460-652921");
  const group = normalizeListingGroup(project.listingGroup, project.id, { now: NOW });
  assert.equal(copy.status, WORKFLOW_STATUS.PUBLISHED);
  assert.equal(copy.nextUpdateAt, "2026-08-21T15:22:59.957Z");
  assert.equal(source.supersededByListingId, copy.id);
  assert.equal(source.externalDeletionPending, true);
  assert.equal(listingControl(group, copy).automaticUpdateEnabled, true);
  assert.equal(listingControl(group, source).automaticUpdateEnabled, false);
  assert.equal(listingControl(group, source).pendingRotationListingId, "");
  assert.deepEqual(schedulerDueListings(fixture.reconciliation.state, "2026-08-25T00:00:00.000Z").map((item) => item.listingId), [copy.id]);
  const repeated = reconcileLegacyImportInState(fixture.reconciliation.state, fixture.ledger, providerEvidence("30460-652921"), { now: NOW });
  assert.equal(repeated.result.status, "idempotent");
  assert.equal(repeated.state, fixture.reconciliation.state);
});

test("24-27: legacy delete is impossible before reconciliation and targets only the source", async () => {
  const pending = caseFixture();
  assert.throws(() => resolveLegacyDeleteEligibility(pending.state, "30460-652921"), /löschberechtigt/u);
  const published = publishedLegacyFixture();
  const eligibility = resolveLegacyDeleteEligibility(published.state, "30460-652921", { jobs: [] }, { operation: "transfer" });
  const identity = legacyDeleteIdentity(eligibility.source, eligibility.replacement);
  assert.match(identity.deleteJobId, /^legacy-reconciliation-delete:/u);
  const payload = await buildProductionDeletePayload(published.state, eligibility, { preparedAt: NOW });
  assert.equal((payload.xmlText.match(/aktionart="DELETE"/gu) || []).length, 1);
  assert.equal((payload.xmlText.match(/30460-095107/gu) || []).length, 3);
  assert.equal(payload.xmlText.includes("30460-652921"), false);
  assert.throws(() => legacyDeleteIdentity(eligibility.replacement, eligibility.source), (error) => error.code === "LEGACY_RECONCILIATION_NOT_AUTHORIZED" || error.code === "DELETE_REPLACEMENT_GUARD_VIOLATION");
});

test("27-30: exactly one delete survives restart; positive exact report finalizes source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fpi-legacy-delete-"));
  const fixture = publishedLegacyFixture();
  const store = memoryStore(fixture.state);
  const ledgerPath = join(directory, "legacy-delete-jobs.json");
  const ledger = createProductionDeleteLedger(ledgerPath);
  let uploads = 0;
  let reportAvailable = false;
  const mailAdapter = {
    readOnly: true,
    async findCandidates() { return reportAvailable ? [{ mailboxName: "Inseratestudio – Importberichte", transportId: "1" }] : []; },
    async readRawMessage(candidate) { return { ...candidate, rawSource: rawDeleteReport("30460-095107") }; },
  };
  const service = createLegacyDeleteService({ store, ledger, mailAdapter, upload: async () => { uploads += 1; }, now: () => NOW });
  const transferred = await service.transfer("30460-652921");
  assert.equal(transferred.transferred, true);
  assert.equal(uploads, 1);
  assert.equal((await ledger.read()).jobs.length, 1);
  assert.equal((await ledger.read()).jobs[0].status, PRODUCTION_DELETE_STATUS.PENDING_CONFIRMATION);

  const restarted = createLegacyDeleteService({ store, ledger: createProductionDeleteLedger(ledgerPath), mailAdapter, upload: async () => { uploads += 1; }, now: () => NOW });
  const duplicate = await restarted.transfer("30460-652921");
  assert.equal(duplicate.idempotent, true);
  assert.equal(uploads, 1);
  assert.equal((await ledger.read()).jobs.length, 1);
  assert.equal((await store.load()).state.projects[0].listings.find((listing) => listing.externalId === "30460-095107").status, WORKFLOW_STATUS.PUBLISHED);

  reportAvailable = true;
  const confirmed = await restarted.confirm("30460-652921");
  assert.equal(confirmed.confirmed, true);
  const finalState = (await store.load()).state;
  assert.equal(finalState.projects[0].listings.find((listing) => listing.externalId === "30460-095107").status, WORKFLOW_STATUS.DELETED);
  assert.equal(finalState.projects[0].listings.find((listing) => listing.externalId === "30460-652921").status, WORKFLOW_STATUS.PUBLISHED);
  const third = await restarted.transfer("30460-652921");
  assert.equal(third.idempotent, true);
  assert.equal(uploads, 1);
});

test("30: ambiguous delete report remains pending and never retries the transfer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fpi-legacy-delete-ambiguous-"));
  const fixture = publishedLegacyFixture();
  const store = memoryStore(fixture.state);
  const ledger = createProductionDeleteLedger(join(directory, "legacy-delete-jobs.json"));
  let uploads = 0;
  const service = createLegacyDeleteService({
    store,
    ledger,
    mailAdapter: {
      readOnly: true,
      async findCandidates() { return [{ mailboxName: "Posteingang", transportId: "2" }]; },
      async readRawMessage(candidate) {
        return { ...candidate, rawSource: `${rawDeleteReport("30460-095107", "ambiguous")}\r\nWarnung: synthetisch unklar` };
      },
    },
    upload: async () => { uploads += 1; },
    now: () => NOW,
  });
  await service.transfer("30460-652921");
  const pending = await service.confirm("30460-652921");
  assert.equal(pending.confirmed, false);
  assert.equal(pending.status, "pending_confirmation");
  assert.equal((await ledger.read()).jobs[0].status, PRODUCTION_DELETE_STATUS.PENDING_CONFIRMATION);
  await service.transfer("30460-652921");
  assert.equal(uploads, 1);
});

test("a systemic read-only mail failure is surfaced and never converted into pending evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fpi-legacy-delete-mail-failure-"));
  const fixture = publishedLegacyFixture();
  const store = memoryStore(fixture.state);
  const ledger = createProductionDeleteLedger(join(directory, "legacy-delete-jobs.json"));
  const service = createLegacyDeleteService({
    store,
    ledger,
    mailAdapter: {
      readOnly: true,
      async findCandidates() { return [{ mailboxName: "Posteingang", transportId: "2" }]; },
      async readRawMessage() { throw new Error("synthetic mail automation unavailable"); },
    },
    upload: async () => undefined,
    now: () => NOW,
  });
  await service.transfer("30460-652921");
  await assert.rejects(() => service.confirm("30460-652921"), /mail automation unavailable/u);
  assert.equal((await ledger.read()).jobs[0].status, PRODUCTION_DELETE_STATUS.PENDING_CONFIRMATION);
});

test("31-36: the normal report contract remains strict for every non-allowlisted pending import", () => {
  const fixture = caseFixture();
  const copy = fixture.state.projects[0].listings[1];
  copy.externalId = "30460-999999";
  assert.throws(() => reconcileLegacyImportInState(fixture.state, fixture.ledger, providerEvidence("30460-999999"), { now: "2027-01-01T00:00:00.000Z" }), (error) => error.code === "LEGACY_RECONCILIATION_NOT_AUTHORIZED");
  assert.equal(copy.status, WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT);
  assert.equal(fixture.state.importReports.length, 0);
  assert.equal(fixture.state.importReportReviews.length, 0);
  const due = schedulerDueListings(fixture.state, "2027-01-01T00:00:00.000Z");
  assert.deepEqual(due.map((item) => item.listingId), []);
  assert.equal(due.some((item) => item.listingId === copy.id), false);
  assert.equal(copy.status, WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT);
});

test("normal import reports explicitly retain import_report provenance and accept older records without the new field", () => {
  const fixture = caseFixture();
  const parsed = {
    messageId: "<normal-report@server22.immoprofessional.eu>",
    rawHash: "a".repeat(64),
    providerImportAt: "2026-08-15T10:01:00.000Z",
    subject: "Importbericht OpenImmo XML",
    senderSoftware: "Fabian&Pascal Inseratstudio",
    objectCount: 1,
    providerId: "30460",
    providerCompany: "Test GmbH",
    providerEmail: "test@example.invalid",
    externalObjectNumber: "30460-652921",
    importResult: "success",
    parserVersion: "1.0.0",
  };
  const mail = { accountName: "Livinghaus", accountId: "test", mailboxName: "Inseratestudio – Importberichte", transportId: "1", receivedAt: NOW };
  const result = confirmImportReportInState(fixture.state, parsed, mail, fixture.ledger, { now: NOW });
  assert.equal(result.result.status, "confirmed");
  assert.equal(result.result.report.confirmationSource, "import_report");
  assert.equal(result.state.projects[0].listings.find((listing) => listing.externalId === "30460-652921").confirmationSource, "import_report");
});

test("the CLI requires one-time mode, an evidence file and both global modes off", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fpi-legacy-cli-"));
  const evidencePath = join(directory, "provider-evidence.json");
  await writeFile(evidencePath, JSON.stringify(providerEvidence("30460-652921")), { mode: 0o600 });
  const fixture = caseFixture();
  const common = {
    store: memoryStore(fixture.state),
    uploadLedger: { async read() { return structuredClone(fixture.ledger); } },
    legacyDeleteLedger: createProductionDeleteLedger(join(directory, "legacy-delete-jobs.json")),
    rotationModeStore: fixedMode("off"),
    productionDeleteModeStore: fixedMode("off"),
    writeLog: async () => undefined,
    now: () => NOW,
  };
  await assert.rejects(
    () => runLegacyReconciliationCli(["reconcile", "--external-id", "30460-652921", "--evidence", evidencePath], common),
    (error) => error.code === "LEGACY_MODE_REQUIRED",
  );
  await assert.rejects(
    () => runLegacyReconciliationCli(["reconcile", "--legacy-mode", "one-time", "--external-id", "30460-652921", "--evidence", evidencePath], { ...common, rotationModeStore: fixedMode("canary") }),
    (error) => error.code === "LEGACY_RECONCILIATION_MODES_NOT_OFF",
  );
  const preflight = await runLegacyReconciliationCli(["preflight", "--legacy-mode", "one-time", "--external-id", "30460-652921", "--evidence", evidencePath], common);
  assert.equal(preflight.status, "eligible");
  const reconciled = await runLegacyReconciliationCli(["reconcile", "--legacy-mode", "one-time", "--external-id", "30460-652921", "--evidence", evidencePath], common);
  assert.equal(reconciled.status, "reconciled");
});
