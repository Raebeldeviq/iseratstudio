import assert from "node:assert/strict";
import test from "node:test";

import {
  createDeleteCanaryJobIdentity,
  DELETE_CANARY_STATUS,
} from "../immoprofessional-delete-canary.mjs";
import {
  HISTORICAL_DELETE_RECONCILIATION,
  reconcileHistoricalDeleteStateInState,
  resolveHistoricalDeleteStateReconciliation,
} from "../historical-delete-state-reconciliation.mjs";
import { runHistoricalDeleteStateReconciliationCli } from "../historical-delete-state-reconciliation-cli.mjs";
import {
  createListingGroup,
  listingControl,
  updateListingControl,
} from "../listing-groups.mjs";
import { schedulerDueListings } from "../listing-scheduler.mjs";
import { WORKFLOW_STATUS } from "../workflow-status.mjs";

const NOW = "2026-08-20T09:00:00.000Z";
const CONTRACT = HISTORICAL_DELETE_RECONCILIATION;

function fixture(overrides = {}) {
  const listing = {
    id: CONTRACT.listingId,
    externalId: CONTRACT.externalObjectNumber,
    templateId: "house-1",
    templateName: "SUN 126 V2",
    listingGroupVariantId: "variant-1",
    listingOrigin: "group-source",
    status: WORKFLOW_STATUS.PUBLISHED,
    lastUploadedAt: "2026-07-28T22:43:02.002Z",
    ...overrides.listing,
  };
  let group = createListingGroup(CONTRACT.projectId, { now: "2026-07-01T00:00:00.000Z" });
  group = updateListingControl(group, listing, {
    automaticUpdateEnabled: true,
    status: WORKFLOW_STATUS.PUBLISHED,
    nextUpdatedAt: "2026-08-09T22:43:02.002Z",
    updateMode: "prepare-only",
    ...overrides.control,
  }, { now: "2026-07-28T22:43:02.002Z" });
  const project = {
    id: CONTRACT.projectId,
    plotId: "plot-historical",
    isActive: true,
    listings: [listing, ...(overrides.otherListings || [])],
    listingGroup: group,
  };
  const identity = createDeleteCanaryJobIdentity(CONTRACT.externalObjectNumber);
  const canaryDeleteJob = {
    deleteJobId: identity.deleteJobId,
    idempotencyKey: identity.idempotencyKey,
    externalObjectNumber: CONTRACT.externalObjectNumber,
    sourceListingId: CONTRACT.listingId,
    status: DELETE_CANARY_STATUS.CONFIRMED,
    providerResult: "success",
    attempt: 1,
    providerReportMessageId: "<confirmed@server22.immoprofessional.eu>",
    providerReportHash: "a".repeat(64),
    providerProcessedAt: "2026-08-13T16:26:00.000Z",
    confirmationReceivedAt: "2026-08-13T16:43:00.440Z",
    ...overrides.canaryDeleteJob,
  };
  return {
    state: {
      projects: [project, ...(overrides.otherProjects || [])],
      houses: [{ id: "house-1" }],
      deleteReports: [],
      scheduler: {
        settings: {
          enabled: true,
          paused: false,
          mode: "full-auto",
          initialWaitDays: 12,
          updateIntervalDays: 12,
          allowedWeekdays: [0, 1, 2, 3, 4, 5, 6],
          startTime: "08:00",
          endTime: "18:00",
        },
        runs: [],
      },
    },
    ledgers: {
      uploadLedger: { format: 1, jobs: [{
        jobId: "upload-historical",
        projectId: CONTRACT.projectId,
        listingId: CONTRACT.listingId,
        status: WORKFLOW_STATUS.PUBLISHED,
      }] },
      productionDeleteLedger: { format: 1, jobs: [] },
      canaryDeleteLedger: { format: 1, jobs: [canaryDeleteJob] },
    },
  };
}

function memoryStore(initialState) {
  let state = structuredClone(initialState);
  return {
    async load() { return { stored: true, state: structuredClone(state), savedAt: NOW }; },
    async update(mutator) {
      const mutation = await mutator(structuredClone(state));
      const next = mutation?.state || mutation;
      const changed = JSON.stringify(next) !== JSON.stringify(state);
      state = structuredClone(next);
      return { stored: true, state: structuredClone(state), result: mutation?.result, changed, savedAt: NOW };
    },
  };
}

function ledger(value) {
  return { async read() { return structuredClone(value); } };
}

function mode(value = "off") {
  return { async load() { return { format: 1, mode: value, valid: true, fallbackReason: "" }; } };
}

test("exact confirmed canary proof reconciles only 30460-287191 and external upload age never creates scheduler eligibility", () => {
  const source = fixture();
  assert.deepEqual(schedulerDueListings(source.state, NOW), []);
  const beforeOtherProjects = JSON.stringify(source.state.projects.slice(1));
  const result = reconcileHistoricalDeleteStateInState(source.state, source.ledgers, { now: NOW });
  const project = result.state.projects.find((candidate) => candidate.id === CONTRACT.projectId);
  const listing = project.listings.find((candidate) => candidate.id === CONTRACT.listingId);
  const control = listingControl(project.listingGroup, listing);
  assert.equal(result.changed, true);
  assert.equal(result.idempotent, false);
  assert.equal(listing.status, WORKFLOW_STATUS.DELETED);
  assert.equal(listing.externalDeletionPending, false);
  assert.equal(control.status, WORKFLOW_STATUS.DELETED);
  assert.equal(control.automaticUpdateEnabled, false);
  assert.equal(control.processLease, null);
  assert.deepEqual(schedulerDueListings(result.state, NOW), []);
  assert.equal(result.state.deleteReports.length, 1);
  assert.equal(result.state.deleteReports[0].externalObjectNumber, CONTRACT.externalObjectNumber);
  assert.equal(result.state.deleteReports[0].confirmationSource, CONTRACT.confirmationSource);
  assert.equal(JSON.stringify(result.state.projects.slice(1)), beforeOtherProjects);
});

test("reconciliation is idempotent and creates neither a second report nor a second mutation", () => {
  const source = fixture();
  const first = reconcileHistoricalDeleteStateInState(source.state, source.ledgers, { now: NOW });
  const second = reconcileHistoricalDeleteStateInState(first.state, source.ledgers, { now: "2026-08-20T09:01:00.000Z" });
  assert.equal(second.idempotent, true);
  assert.equal(second.changed, false);
  assert.equal(second.state, first.state);
  assert.equal(second.state.deleteReports.length, 1);
});

test("wrong target, missing proof, active work and conflicting jobs fail closed", () => {
  const source = fixture();
  assert.throws(
    () => resolveHistoricalDeleteStateReconciliation(source.state, source.ledgers, { externalObjectNumber: "30460-999999", now: NOW }),
    (error) => error.code === "HISTORICAL_DELETE_TARGET_NOT_AUTHORIZED",
  );
  assert.throws(
    () => resolveHistoricalDeleteStateReconciliation(source.state, { ...source.ledgers, canaryDeleteLedger: { format: 1, jobs: [] } }, { now: NOW }),
    (error) => error.code === "HISTORICAL_DELETE_PROOF_NOT_UNIQUE",
  );
  for (const control of [
    { processLease: { token: "busy" } },
    { schedulerSelectionId: "run-1", schedulerSelectedAt: NOW },
    { pendingRotationListingId: "copy", pendingRotationJobId: "upload-copy" },
  ]) {
    const blocked = fixture({ control });
    assert.throws(
      () => resolveHistoricalDeleteStateReconciliation(blocked.state, blocked.ledgers, { now: NOW }),
      (error) => error.code === "HISTORICAL_DELETE_RECONCILIATION_BLOCKED",
    );
  }
  const activeUpload = fixture();
  activeUpload.ledgers.uploadLedger.jobs[0].status = WORKFLOW_STATUS.PROCESSING;
  assert.throws(
    () => resolveHistoricalDeleteStateReconciliation(activeUpload.state, activeUpload.ledgers, { now: NOW }),
    (error) => error.details.reasons.includes("upload_history_not_terminal_published"),
  );
  const productionDelete = fixture();
  productionDelete.ledgers.productionDeleteLedger.jobs.push({ sourceListingId: CONTRACT.listingId });
  assert.throws(
    () => resolveHistoricalDeleteStateReconciliation(productionDelete.state, productionDelete.ledgers, { now: NOW }),
    (error) => error.details.reasons.includes("production_delete_job_present"),
  );
  const copy = fixture({ otherListings: [{
    id: "copy",
    externalId: "30460-111111",
    rotationSourceListingId: CONTRACT.listingId,
    status: WORKFLOW_STATUS.PREPARED,
  }] });
  assert.throws(
    () => resolveHistoricalDeleteStateReconciliation(copy.state, copy.ledgers, { now: NOW }),
    (error) => error.details.reasons.includes("rotation_copy_present"),
  );
});

test("CLI requires both global modes off, no scheduler lock and explicit one-time mode", async () => {
  const source = fixture();
  const common = {
    store: memoryStore(source.state),
    uploadLedger: ledger(source.ledgers.uploadLedger),
    productionDeleteLedger: ledger(source.ledgers.productionDeleteLedger),
    canaryDeleteLedger: ledger(source.ledgers.canaryDeleteLedger),
    rotationModeStore: mode("off"),
    productionDeleteModeStore: mode("off"),
    schedulerLockExists: async () => false,
    writeLog: async () => undefined,
    now: () => NOW,
  };
  const status = await runHistoricalDeleteStateReconciliationCli(["status"], common);
  assert.equal(status.externalMutation, false);
  await assert.rejects(
    runHistoricalDeleteStateReconciliationCli(["reconcile", "--external-id", CONTRACT.externalObjectNumber], common),
    (error) => error.code === "HISTORICAL_DELETE_RECONCILIATION_MODE_REQUIRED",
  );
  await assert.rejects(
    runHistoricalDeleteStateReconciliationCli(["status"], { ...common, rotationModeStore: mode("active") }),
    (error) => error.code === "HISTORICAL_DELETE_MODES_NOT_OFF",
  );
  await assert.rejects(
    runHistoricalDeleteStateReconciliationCli(["status"], { ...common, schedulerLockExists: async () => true }),
    (error) => error.code === "HISTORICAL_DELETE_SCHEDULER_LOCKED",
  );
  const reconciled = await runHistoricalDeleteStateReconciliationCli([
    "reconcile",
    "--external-id", CONTRACT.externalObjectNumber,
    "--reconciliation-mode", "one-time",
  ], common);
  assert.equal(reconciled.status, WORKFLOW_STATUS.DELETED);
  assert.equal(reconciled.automaticUpdateEnabled, false);
  assert.equal(reconciled.externalMutation, false);
});
