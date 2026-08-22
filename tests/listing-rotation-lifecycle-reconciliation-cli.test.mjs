import assert from "node:assert/strict";
import test from "node:test";

import { createUploadJobId } from "../batch-upload.mjs";
import {
  AUTHORIZED_LIFECYCLE_RECONCILIATION,
  runLifecycleReconciliationCli,
} from "../listing-rotation-lifecycle-reconciliation-cli.mjs";
import {
  productionDeleteIdentity,
  PRODUCTION_DELETE_STATUS,
} from "../listing-rotation-production-delete.mjs";
import { WORKFLOW_STATUS } from "../workflow-status.mjs";

const NOW = "2026-08-22T08:00:00.000Z";

function finalFixture() {
  const contract = AUTHORIZED_LIFECYCLE_RECONCILIATION;
  const project = { id: contract.projectId };
  const replacement = {
    id: contract.replacementListingId,
    externalId: contract.replacementExternalObjectNumber,
    version: 2,
    status: WORKFLOW_STATUS.PUBLISHED,
    listingOrigin: "rotation-copy",
    rotationSourceListingId: contract.sourceListingId,
    transferredAt: "2026-08-21T17:20:27.297Z",
    importConfirmedAt: "2026-08-21T17:20:00.000Z",
    importReportId: "import-report-a",
    productionLifecycle: {
      format: 1,
      schedulerRunId: "scheduler-a",
      sourceListingId: contract.sourceListingId,
      automaticDeleteAuthorized: true,
      preparedAt: "2026-08-21T17:20:18.214Z",
      lifecycleIndex: 1,
      lifecycleStage: "awaiting_import_confirmation",
      lifecycleStartedAt: "2026-08-21T17:20:18.214Z",
      importReportId: "import-report-a",
    },
  };
  let source = {
    id: contract.sourceListingId,
    externalId: contract.sourceExternalObjectNumber,
    status: WORKFLOW_STATUS.DELETED,
    listingOrigin: "group-source",
    supersededByListingId: replacement.id,
    productionRotationRunId: "scheduler-a",
    productionDeleteState: "confirmed",
    externalDeletionPending: false,
    deleteConfirmedAt: "2026-08-21T17:30:21.006Z",
  };
  const deleteJobId = productionDeleteIdentity(source, replacement).deleteJobId;
  source = {
    ...source,
    productionDeleteJobId: deleteJobId,
    deleteJobId,
    deleteReportHash: "b".repeat(64),
  };
  const uploadJobId = createUploadJobId(project, replacement);
  const state = {
    version: 1,
    projects: [{
      ...project,
      listings: [source, replacement],
      listingGroup: {
        format: 1,
        projectId: project.id,
        variants: [],
        listingControls: [
          { listingId: source.id, status: WORKFLOW_STATUS.DELETED, processLease: null, schedulerSelectionId: "" },
          { listingId: replacement.id, status: WORKFLOW_STATUS.PUBLISHED, processLease: null, schedulerSelectionId: "" },
        ],
      },
    }],
    uploadHistory: [{
      jobId: uploadJobId,
      projectId: project.id,
      listingId: replacement.id,
      status: WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT,
      error: "",
    }],
    importReports: [{
      reportId: replacement.importReportId,
      processingStatus: "confirmed",
      importResult: "success",
      projectId: project.id,
      sourceListingId: source.id,
      matchedListingId: replacement.id,
      externalObjectNumber: replacement.externalId,
    }],
    deleteReports: [{
      reportId: "delete-report-a",
      deleteJobId,
      sourceListingId: source.id,
      replacementListingId: replacement.id,
      externalObjectNumber: source.externalId,
      result: "success",
      messageId: "delete-message-a",
      rawHash: source.deleteReportHash,
    }],
  };
  const uploadLedger = {
    format: 1,
    jobs: [{
      jobId: uploadJobId,
      projectId: project.id,
      listingId: replacement.id,
      status: WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT,
      transferredAt: replacement.transferredAt,
    }],
  };
  const deleteLedger = {
    format: 1,
    jobs: [{
      deleteJobId,
      schedulerRunId: "scheduler-a",
      projectId: project.id,
      sourceListingId: source.id,
      replacementListingId: replacement.id,
      externalObjectNumber: source.externalId,
      replacementExternalObjectNumber: replacement.externalId,
      status: PRODUCTION_DELETE_STATUS.CONFIRMED,
      attempt: 1,
      transferStartedAt: "2026-08-21T17:25:24.762Z",
      transferCompletedAt: "2026-08-21T17:25:25.491Z",
      confirmedAt: "2026-08-21T17:30:20.965Z",
      reportMessageId: "delete-message-a",
      reportHash: source.deleteReportHash,
    }],
  };
  return { state, uploadLedger, deleteLedger };
}

function memoryOptions(input = {}) {
  const fixture = finalFixture();
  let state = structuredClone(fixture.state);
  const logs = [];
  return {
    options: {
      store: {
        async load() { return { stored: true, state: structuredClone(state) }; },
        async update(mutator) {
          const mutation = await mutator(structuredClone(state));
          state = structuredClone(mutation.state || mutation);
          return { stored: true, state: structuredClone(state), result: mutation.result };
        },
      },
      uploadLedger: { read: async () => structuredClone(fixture.uploadLedger) },
      deleteLedger: { read: async () => structuredClone(fixture.deleteLedger) },
      rotationModeStore: { load: async () => input.rotationMode || { valid: true, mode: "off", canaryListingIds: [] } },
      deleteModeStore: { load: async () => input.deleteMode || { valid: true, mode: "off" } },
      batchOverrideStore: { load: async () => ({ valid: true, state: "consumed", overrideId: "override-a" }) },
      writeLog: async (event, details) => logs.push({ event, details }),
      now: () => NOW,
    },
    state: () => structuredClone(state),
    logs,
  };
}

function exactArguments(command) {
  return [
    command,
    "--source-external-id", AUTHORIZED_LIFECYCLE_RECONCILIATION.sourceExternalObjectNumber,
    "--replacement-external-id", AUTHORIZED_LIFECYCLE_RECONCILIATION.replacementExternalObjectNumber,
    "--reason", AUTHORIZED_LIFECYCLE_RECONCILIATION.reason,
  ];
}

test("exact reconciliation CLI rejects every non-authorized pair before touching runtime stores", async () => {
  await assert.rejects(
    runLifecycleReconciliationCli([
      "reconcile",
      "--source-external-id", "30460-000001",
      "--replacement-external-id", AUTHORIZED_LIFECYCLE_RECONCILIATION.replacementExternalObjectNumber,
      "--reason", AUTHORIZED_LIFECYCLE_RECONCILIATION.reason,
    ], {
      store: { load: async () => { throw new Error("must not load"); } },
    }),
    { code: "LIFECYCLE_RECONCILIATION_PAIR_NOT_AUTHORIZED" },
  );
});

test("exact reconciliation CLI requires rotation, canary and production DELETE to remain off", async () => {
  const fixture = memoryOptions({ rotationMode: { valid: true, mode: "active", canaryListingIds: [] } });
  await assert.rejects(
    runLifecycleReconciliationCli(exactArguments("preflight"), fixture.options),
    { code: "LIFECYCLE_RECONCILIATION_MODES_NOT_OFF" },
  );
  assert.equal(fixture.state().projects[0].listings[1].productionLifecycle.lifecycleStage, "awaiting_import_confirmation");
});

test("exact reconciliation CLI is internal, evidence-bound and idempotent", async () => {
  const fixture = memoryOptions();
  const preflight = await runLifecycleReconciliationCli(exactArguments("preflight"), fixture.options);
  assert.equal(preflight.preflight, "eligible");
  assert.equal(preflight.externalMutations, 0);
  const first = await runLifecycleReconciliationCli(exactArguments("reconcile"), fixture.options);
  assert.equal(first.status, "reconciled");
  assert.equal(first.externalMutations, 0);
  assert.equal(fixture.state().projects[0].listings[1].productionLifecycle.lifecycleStage, "completed");
  const second = await runLifecycleReconciliationCli(exactArguments("reconcile"), fixture.options);
  assert.equal(second.status, "idempotent");
  assert.equal(fixture.logs.length, 2);
  assert.ok(fixture.logs.every((entry) => entry.details.externalMutations === 0));
});
