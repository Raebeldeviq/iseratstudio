import assert from "node:assert/strict";
import test from "node:test";

import {
  PRE_FTPS_DELETE_RECONCILIATION,
  reconcilePreFtpsDeleteCatalogInState,
  reconcilePreFtpsDeleteJobInLedger,
  resolvePreFtpsDeleteReconciliation,
} from "../delete-pre-ftps-reconciliation-30460-462061.mjs";
import { runPreFtpsDeleteReconciliationCli } from "../delete-pre-ftps-reconciliation-30460-462061-cli.mjs";
import {
  createListingGroup,
  listingControl,
  updateListingControl,
} from "../listing-groups.mjs";
import { PRODUCTION_DELETE_STATUS } from "../listing-rotation-production-delete.mjs";
import { WORKFLOW_STATUS } from "../workflow-status.mjs";

const CONTRACT = PRE_FTPS_DELETE_RECONCILIATION;
const NOW = "2026-08-20T16:00:00.000Z";

function evidence(overrides = {}) {
  return {
    runtime: {
      oldRuntimeDirectory: CONTRACT.oldRuntimeDirectory,
      sidecarPresent: false,
      credentialVaultBeforeClient: true,
      clientBeforeAccess: true,
      accessBeforeUpload: true,
      sidecarReferenceVerified: true,
      ...overrides.runtime,
    },
    logs: {
      transferStartedMarkers: 1,
      transferredMarkers: 0,
      confirmedMarkers: 0,
      matchingLocalFailures: 1,
      failureMentionsExpectedSidecar: true,
      failureSourceListingId: CONTRACT.sourceListingId,
      ...overrides.logs,
    },
    mail: {
      checked: true,
      readOnly: true,
      candidateCount: 8,
      matchCount: 0,
      mailMutations: 0,
      ...overrides.mail,
    },
  };
}

function fixture(overrides = {}) {
  const schedulerRunId = "b213892d-f11a-4a3d-b94f-46368be50479";
  const source = {
    id: CONTRACT.sourceListingId,
    externalId: CONTRACT.externalObjectNumber,
    templateId: "house-1",
    templateName: "SUN 165 V2",
    listingGroupVariantId: "variant-source",
    listingOrigin: "group-source",
    status: WORKFLOW_STATUS.PUBLISHED,
    externalDeletionPending: true,
    productionDeleteState: "transfer_uncertain",
    productionDeleteJobId: CONTRACT.deleteJobId,
    productionDeleteError: `${CONTRACT.oldRuntimeDirectory}/macos-keychain.swift fehlt`,
    productionDeleteAuthorizedAt: "2026-08-17T06:05:44.000Z",
    productionRotationRunId: schedulerRunId,
    supersededByListingId: CONTRACT.replacementListingId,
    ...overrides.source,
  };
  const replacement = {
    id: CONTRACT.replacementListingId,
    externalId: CONTRACT.replacementExternalObjectNumber,
    templateId: "house-2",
    templateName: "SOL 242 V4",
    listingGroupVariantId: "variant-replacement",
    listingOrigin: "rotation-copy",
    status: WORKFLOW_STATUS.PUBLISHED,
    importConfirmedAt: "2026-08-16T14:59:00.000Z",
    importReportId: "report-replacement",
    productionLifecycle: {
      format: 1,
      automaticDeleteAuthorized: true,
      sourceListingId: CONTRACT.sourceListingId,
      schedulerRunId,
    },
    ...overrides.replacement,
  };
  let group = createListingGroup(CONTRACT.projectId, { now: "2026-08-16T14:59:00.000Z" });
  group = updateListingControl(group, source, {
    automaticUpdateEnabled: false,
    automaticDeletionEnabled: true,
    status: WORKFLOW_STATUS.PUBLISHED,
  }, { now: "2026-08-17T06:05:44.000Z" });
  group = updateListingControl(group, replacement, {
    automaticUpdateEnabled: true,
    automaticDeletionEnabled: false,
    status: WORKFLOW_STATUS.PUBLISHED,
  }, { now: "2026-08-17T06:05:44.000Z" });
  const project = {
    id: CONTRACT.projectId,
    zip: "14797",
    city: "Kloster Lehnin",
    listings: [source, replacement],
    listingGroup: group,
  };
  const state = {
    projects: [project],
    houses: [
      { id: "house-1", houseType: "Einfamilienhaus" },
      { id: "house-2", houseType: "Einfamilienhaus" },
    ],
    provider: {
      providerNumber: "30460",
      company: "Fabian & Pascal",
      email: "service@example.invalid",
    },
    importReports: [{
      reportId: "report-replacement",
      importResult: "success",
      sourceListingId: CONTRACT.sourceListingId,
      matchedListingId: CONTRACT.replacementListingId,
      externalObjectNumber: CONTRACT.replacementExternalObjectNumber,
    }],
    deleteReports: [],
  };
  const job = {
    deleteJobId: CONTRACT.deleteJobId,
    idempotencyKey: CONTRACT.idempotencyKey,
    schedulerRunId,
    projectId: CONTRACT.projectId,
    sourceListingId: CONTRACT.sourceListingId,
    replacementListingId: CONTRACT.replacementListingId,
    externalObjectNumber: CONTRACT.externalObjectNumber,
    replacementExternalObjectNumber: CONTRACT.replacementExternalObjectNumber,
    payloadFilename: CONTRACT.payloadFilename,
    payloadSha256: CONTRACT.payloadSha256,
    payloadSize: CONTRACT.payloadSize,
    preparedAt: "2026-08-20T15:38:54.502Z",
    transferStartedAt: "2026-08-20T15:38:54.513Z",
    transferCompletedAt: "",
    status: PRODUCTION_DELETE_STATUS.TRANSFER_UNCERTAIN,
    attempt: 1,
    claimToken: "",
    updatedAt: "2026-08-20T15:38:57.713Z",
    reportMessageId: "",
    reportHash: "",
    providerProcessedAt: "",
    message: `error opening input file '${CONTRACT.oldRuntimeDirectory}/macos-keychain.swift' (No such file or directory)`,
    ...overrides.job,
  };
  return { state, ledger: { format: 1, jobs: [job] } };
}

function memoryStore(initialState) {
  let state = structuredClone(initialState);
  return {
    async load() {
      return { stored: true, state: structuredClone(state), savedAt: NOW };
    },
    async update(mutator) {
      const mutation = await mutator(structuredClone(state));
      const next = mutation?.state || mutation;
      const changed = JSON.stringify(next) !== JSON.stringify(state);
      state = structuredClone(next);
      return {
        stored: true,
        state: structuredClone(state),
        result: mutation?.result,
        changed,
        savedAt: NOW,
      };
    },
  };
}

function mode(value = "off") {
  return {
    async load() {
      return { format: 1, mode: value, valid: true, fallbackReason: "" };
    },
  };
}

test("exact local pre-FTPS failure reopens only the bound job and keeps its payload immutable", () => {
  const source = fixture();
  const beforeReplacement = JSON.stringify(source.state.projects[0].listings[1]);
  const resolution = resolvePreFtpsDeleteReconciliation(source.state, source.ledger, evidence(), { now: NOW });
  assert.equal(resolution.job.status, PRODUCTION_DELETE_STATUS.TRANSFER_UNCERTAIN);
  assert.equal(resolution.idempotent, false);

  const ledgerResult = reconcilePreFtpsDeleteJobInLedger(source.ledger, { now: NOW });
  assert.equal(ledgerResult.changed, true);
  assert.equal(ledgerResult.job.status, PRODUCTION_DELETE_STATUS.PREPARED);
  assert.equal(ledgerResult.job.attempt, 0);
  assert.equal(ledgerResult.job.transferStartedAt, "");
  assert.equal(ledgerResult.job.transferCompletedAt, "");
  assert.equal(ledgerResult.job.payloadFilename, CONTRACT.payloadFilename);
  assert.equal(ledgerResult.job.payloadSha256, CONTRACT.payloadSha256);
  assert.equal(ledgerResult.job.payloadSize, CONTRACT.payloadSize);
  assert.equal(ledgerResult.job.preFtpsReconciliation.provenance, CONTRACT.provenance);
  assert.equal(ledgerResult.job.preFtpsReconciliation.confirmedTransferCount, 0);

  const catalogResult = reconcilePreFtpsDeleteCatalogInState(
    source.state,
    ledgerResult.ledger,
    evidence(),
    { now: NOW },
  );
  const project = catalogResult.state.projects[0];
  const reconciledSource = project.listings[0];
  assert.equal(reconciledSource.productionDeleteState, "authorized");
  assert.equal(reconciledSource.externalDeletionPending, true);
  assert.equal(reconciledSource.productionDeleteReconciliation.provenance, CONTRACT.provenance);
  assert.equal(listingControl(project.listingGroup, reconciledSource).automaticUpdateEnabled, false);
  assert.equal(JSON.stringify(project.listings[1]), beforeReplacement);
});

test("reconciliation is idempotent and recovers a ledger-first partial update", () => {
  const source = fixture();
  const firstLedger = reconcilePreFtpsDeleteJobInLedger(source.ledger, { now: NOW });
  const repeatedLedger = reconcilePreFtpsDeleteJobInLedger(firstLedger.ledger, { now: "2026-08-20T16:01:00.000Z" });
  assert.equal(repeatedLedger.changed, false);
  assert.equal(repeatedLedger.idempotent, true);
  assert.equal(repeatedLedger.ledger, firstLedger.ledger);

  const firstCatalog = reconcilePreFtpsDeleteCatalogInState(source.state, firstLedger.ledger, evidence(), { now: NOW });
  const repeatedCatalog = reconcilePreFtpsDeleteCatalogInState(
    firstCatalog.state,
    firstLedger.ledger,
    evidence(),
    { now: "2026-08-20T16:01:00.000Z" },
  );
  assert.equal(repeatedCatalog.changed, false);
  assert.equal(repeatedCatalog.idempotent, true);
  assert.equal(repeatedCatalog.state, firstCatalog.state);
});

test("wrong identity, transfer evidence, report evidence and changed payload fail closed", () => {
  const source = fixture();
  assert.throws(
    () => resolvePreFtpsDeleteReconciliation(source.state, source.ledger, evidence(), {
      externalObjectNumber: "30460-999999",
    }),
    (error) => error.code === "PRE_FTPS_RECONCILIATION_TARGET_NOT_AUTHORIZED",
  );
  for (const badEvidence of [
    evidence({ runtime: { sidecarPresent: true } }),
    evidence({ logs: { transferredMarkers: 1 } }),
    evidence({ mail: { matchCount: 1 } }),
  ]) {
    assert.throws(
      () => resolvePreFtpsDeleteReconciliation(source.state, source.ledger, badEvidence),
      (error) => String(error.code).startsWith("PRE_FTPS_RECONCILIATION_"),
    );
  }
  const completed = fixture({ job: { transferCompletedAt: NOW } });
  assert.throws(
    () => resolvePreFtpsDeleteReconciliation(completed.state, completed.ledger, evidence()),
    (error) => error.code === "PRE_FTPS_RECONCILIATION_JOB_NOT_PRETRANSFER_UNCERTAIN",
  );
  const changedPayload = fixture({ job: { payloadSha256: "f".repeat(64) } });
  assert.throws(
    () => resolvePreFtpsDeleteReconciliation(changedPayload.state, changedPayload.ledger, evidence()),
    (error) => error.code === "PRE_FTPS_RECONCILIATION_JOB_IDENTITY_MISMATCH",
  );
  const withReport = fixture();
  withReport.state.deleteReports.push({
    deleteJobId: CONTRACT.deleteJobId,
    externalObjectNumber: CONTRACT.externalObjectNumber,
  });
  assert.throws(
    () => resolvePreFtpsDeleteReconciliation(withReport.state, withReport.ledger, evidence()),
    (error) => error.code === "PRE_FTPS_RECONCILIATION_DELETE_REPORT_ALREADY_PRESENT",
  );
});

test("CLI requires off modes, free scheduler, exact one-time flag and performs no external mutation", async () => {
  const source = fixture();
  let ledgerValue = structuredClone(source.ledger);
  const common = {
    store: memoryStore(source.state),
    productionDeleteLedger: {
      async read() { return structuredClone(ledgerValue); },
    },
    reconcileLedgerFile: async (input) => {
      const result = reconcilePreFtpsDeleteJobInLedger(ledgerValue, input);
      ledgerValue = structuredClone(result.ledger);
      return { ...result, ledger: structuredClone(ledgerValue) };
    },
    rotationModeStore: mode("off"),
    productionDeleteModeStore: mode("off"),
    schedulerLockExists: async () => false,
    runtimeEvidence: async () => evidence().runtime,
    logEvidence: async () => evidence().logs,
    mailEvidence: async () => evidence().mail,
    writeLog: async () => undefined,
    now: () => NOW,
  };
  const status = await runPreFtpsDeleteReconciliationCli(["status"], common);
  assert.equal(status.status, PRODUCTION_DELETE_STATUS.TRANSFER_UNCERTAIN);
  assert.equal(status.externalMutation, false);
  assert.equal(status.mailMutations, 0);

  await assert.rejects(
    runPreFtpsDeleteReconciliationCli(["reconcile"], common),
    (error) => error.code === "PRE_FTPS_RECONCILIATION_MODE_REQUIRED",
  );
  await assert.rejects(
    runPreFtpsDeleteReconciliationCli(["status"], { ...common, rotationModeStore: mode("active") }),
    (error) => error.code === "PRE_FTPS_RECONCILIATION_MODES_NOT_OFF",
  );
  await assert.rejects(
    runPreFtpsDeleteReconciliationCli(["status"], { ...common, schedulerLockExists: async () => true }),
    (error) => error.code === "PRE_FTPS_RECONCILIATION_SCHEDULER_LOCKED",
  );

  const reconciled = await runPreFtpsDeleteReconciliationCli([
    "reconcile",
    "--external-id", CONTRACT.externalObjectNumber,
    "--replacement-external-id", CONTRACT.replacementExternalObjectNumber,
    "--delete-job-id", CONTRACT.deleteJobId,
    "--reconciliation-mode", "one-time-pre-ftps",
  ], common);
  assert.equal(reconciled.status, PRODUCTION_DELETE_STATUS.PREPARED);
  assert.equal(reconciled.catalogState, "authorized");
  assert.equal(reconciled.confirmedTransferCount, 0);
  assert.equal(reconciled.externalMutation, false);

  const repeated = await runPreFtpsDeleteReconciliationCli([
    "reconcile",
    "--external-id", CONTRACT.externalObjectNumber,
    "--replacement-external-id", CONTRACT.replacementExternalObjectNumber,
    "--delete-job-id", CONTRACT.deleteJobId,
    "--reconciliation-mode", "one-time-pre-ftps",
  ], common);
  assert.equal(repeated.idempotent, true);
  assert.equal(repeated.changed, false);
});
