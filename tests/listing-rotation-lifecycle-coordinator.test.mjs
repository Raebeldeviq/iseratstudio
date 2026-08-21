import assert from "node:assert/strict";
import test from "node:test";

import { createUploadJobId } from "../batch-upload.mjs";
import {
  createProductionRotationLifecycleCoordinator,
  openProductionRotationLifecycles,
  ROTATION_LIFECYCLE_STAGE,
} from "../listing-rotation-lifecycle-coordinator.mjs";
import { PRODUCTION_DELETE_STATUS } from "../listing-rotation-production-delete.mjs";
import { WORKFLOW_STATUS } from "../workflow-status.mjs";

const START = Date.parse("2026-08-21T10:00:00.000Z");

function fixtureState() {
  const source = {
    id: "source-a",
    externalId: "30460-100001",
    status: WORKFLOW_STATUS.PUBLISHED,
    listingOrigin: "group-source",
  };
  const replacement = {
    id: "replacement-a",
    externalId: "30460-200001",
    status: WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT,
    listingOrigin: "rotation-copy",
    rotationSourceListingId: source.id,
    transferredAt: "2026-08-21T10:00:00.000Z",
    productionLifecycle: {
      format: 1,
      schedulerRunId: "scheduler-a",
      sourceListingId: source.id,
      automaticDeleteAuthorized: true,
      preparedAt: "2026-08-21T09:59:00.000Z",
    },
  };
  return {
    version: 1,
    projects: [{
      id: "project-a",
      listings: [source, replacement],
      listingGroup: {
        format: 1,
        projectId: "project-a",
        variants: [],
        listingControls: [
          { listingId: source.id, status: WORKFLOW_STATUS.PUBLISHED, processLease: null },
          { listingId: replacement.id, status: WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT, processLease: null },
        ],
      },
    }],
    importReports: [],
    deleteReports: [],
  };
}

function memoryStore(initialState) {
  let state = structuredClone(initialState);
  return {
    async load() {
      return { stored: true, state: structuredClone(state) };
    },
    async update(mutator) {
      const mutation = await mutator(structuredClone(state));
      state = structuredClone(mutation?.state || mutation);
      return { stored: true, state: structuredClone(state), result: mutation?.result };
    },
  };
}

function updatePair(store, mutator, at) {
  return store.update((state) => {
    const project = state.projects[0];
    const source = project.listings.find((listing) => listing.id === "source-a");
    const replacement = project.listings.find((listing) => listing.id === "replacement-a");
    const result = mutator({ state, project, source, replacement });
    return {
      state: {
        ...state,
        ...result.statePatch,
        projects: [{
          ...project,
          listings: project.listings.map((listing) => {
            if (listing.id === source.id) return result.source || source;
            if (listing.id === replacement.id) return result.replacement || replacement;
            return listing;
          }),
          listingGroup: {
            ...project.listingGroup,
            listingControls: project.listingGroup.listingControls.map((control) => {
              if (control.listingId === source.id) return { ...control, status: result.source?.status || source.status, processLease: null };
              if (control.listingId === replacement.id) return { ...control, status: result.replacement?.status || replacement.status, processLease: null };
              return control;
            }),
          },
        }],
      },
    };
  }, { now: at });
}

function coordinatorFixture(options = {}) {
  const store = memoryStore(fixtureState());
  let clockValue = START;
  let deleteJobs = [];
  const events = [];
  const uploadJob = {
    jobId: createUploadJobId(
      { id: "project-a" },
      { id: "replacement-a", externalId: "30460-200001", version: 1 },
    ),
    projectId: "project-a",
    listingId: "replacement-a",
    status: WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT,
  };
  let importPolls = 0;
  let deletePolls = 0;

  async function confirmImport() {
    const importedAt = new Date(clockValue).toISOString();
    await updatePair(store, ({ state, source, replacement }) => {
      const report = {
        reportId: "import-report-a",
        processingStatus: "confirmed",
        importResult: "success",
        projectId: "project-a",
        sourceListingId: source.id,
        matchedListingId: replacement.id,
        externalObjectNumber: replacement.externalId,
      };
      return {
        source: {
          ...source,
          status: WORKFLOW_STATUS.PUBLISHED,
          supersededByListingId: replacement.id,
          externalDeletionPending: true,
          productionDeleteState: "authorized",
          productionDeleteAuthorizedAt: importedAt,
          productionRotationRunId: "scheduler-a",
        },
        replacement: {
          ...replacement,
          status: WORKFLOW_STATUS.PUBLISHED,
          importConfirmedAt: importedAt,
          importReportId: report.reportId,
          lastUploadedAt: importedAt,
          productionLifecycle: { ...replacement.productionLifecycle, importConfirmedAt: importedAt, importReportId: report.reportId },
        },
        statePatch: { importReports: [...state.importReports, report] },
      };
    }, importedAt);
    events.push("import-confirmed");
  }

  async function confirmDelete() {
    const confirmedAt = new Date(clockValue).toISOString();
    await updatePair(store, ({ state, source, replacement }) => {
      const job = {
        deleteJobId: "delete-job-a",
        schedulerRunId: "scheduler-a",
        sourceListingId: source.id,
        replacementListingId: replacement.id,
        externalObjectNumber: source.externalId,
        replacementExternalObjectNumber: replacement.externalId,
        status: PRODUCTION_DELETE_STATUS.CONFIRMED,
        transferCompletedAt: new Date(clockValue - 1_000).toISOString(),
        confirmedAt,
      };
      deleteJobs = [job];
      const report = {
        reportId: "delete-report-a",
        deleteJobId: job.deleteJobId,
        sourceListingId: source.id,
        replacementListingId: replacement.id,
        externalObjectNumber: source.externalId,
        result: "success",
      };
      return {
        source: {
          ...source,
          status: WORKFLOW_STATUS.DELETED,
          externalDeletionPending: false,
          productionDeleteState: "confirmed",
          deleteConfirmedAt: confirmedAt,
          deleteReportHash: "a".repeat(64),
          deleteJobId: job.deleteJobId,
        },
        replacement,
        statePatch: { deleteReports: [...state.deleteReports, report] },
      };
    }, confirmedAt);
    events.push("delete-confirmed");
  }

  const importReportService = {
    async runOnce() {
      importPolls += 1;
      events.push("import-poll");
      if (options.importErrorCode) {
        return {
          ran: false,
          errorCode: options.importErrorCode,
          reason: options.importErrorReason || "Apple-Mail-Abfrage ist fehlgeschlagen.",
        };
      }
      if (importPolls > (options.importDelayPolls || 0) && options.importNever !== true) await confirmImport();
      return { ran: true, processed: [] };
    },
  };
  const productionDeleteService = {
    async runOnce(input) {
      assert.equal(input.trigger, "scheduler-lifecycle");
      assert.equal(input.targetExternalObjectNumber, "30460-100001");
      deletePolls += 1;
      events.push("delete-poll");
      if (deletePolls > (options.deleteDelayPolls || 0) && options.deleteNever !== true) await confirmDelete();
      else if (!deleteJobs.length) {
        deleteJobs = [{
          deleteJobId: "delete-job-a",
          schedulerRunId: "scheduler-a",
          sourceListingId: "source-a",
          replacementListingId: "replacement-a",
          externalObjectNumber: "30460-100001",
          replacementExternalObjectNumber: "30460-200001",
          status: PRODUCTION_DELETE_STATUS.PENDING_CONFIRMATION,
          transferCompletedAt: new Date(clockValue).toISOString(),
        }];
        await updatePair(store, ({ source, replacement }) => ({
          source: { ...source, productionDeleteState: "pending_confirmation", deleteJobId: "delete-job-a" },
          replacement,
          statePatch: {},
        }), new Date(clockValue).toISOString());
      }
      return { ran: true, transferred: deletePolls === 1 ? ["30460-100001"] : [], confirmed: [], errors: [] };
    },
  };
  const coordinator = createProductionRotationLifecycleCoordinator({
    store,
    importReportService,
    productionDeleteService,
    productionDeleteModeStore: { load: async () => ({ valid: true, mode: "active" }) },
    uploadJobLedger: { read: async () => ({ format: 1, jobs: [uploadJob] }) },
    productionDeleteLedger: { read: async () => ({ format: 1, jobs: structuredClone(deleteJobs) }) },
    pollIntervalMs: 10,
    importTimeoutMs: options.importTimeoutMs || 100,
    deleteTimeoutMs: options.deleteTimeoutMs || 100,
    clock: () => clockValue,
    now: () => new Date(clockValue).toISOString(),
    sleep: async (milliseconds) => { events.push("sleep"); clockValue += milliseconds; },
    writeLog: async (event, details) => events.push(`${event}:${details.lifecycleStage || details.finalResult || ""}`),
  });
  return { coordinator, store, events, counts: () => ({ importPolls, deletePolls }) };
}

function completeInput() {
  return {
    schedulerRunId: "scheduler-a",
    productionSchedulerRunId: "scheduler-a",
    projectId: "project-a",
    sourceListingId: "source-a",
    replacementListingId: "replacement-a",
    lifecycleIndex: 1,
    lifecycleStartedAt: "2026-08-21T10:00:00.000Z",
    ftpsCompletedAt: "2026-08-21T10:00:00.000Z",
  };
}

test("complete waits asynchronously for import and delete confirmation before returning", async () => {
  const fixture = coordinatorFixture({ importDelayPolls: 1, deleteDelayPolls: 1 });
  const result = await fixture.coordinator.complete(completeInput());
  assert.equal(result.ok, true);
  assert.equal(result.lifecycleStage, ROTATION_LIFECYCLE_STAGE.COMPLETED);
  assert.equal(fixture.counts().importPolls, 2);
  assert.equal(fixture.counts().deletePolls, 2);
  assert.ok(fixture.events.indexOf("import-confirmed") < fixture.events.indexOf("delete-poll"));
  assert.ok(fixture.events.indexOf("delete-confirmed") < fixture.events.indexOf("lifecycle-stage:completed"));
  const state = (await fixture.store.load()).state;
  assert.deepEqual(openProductionRotationLifecycles(state), []);
  const source = state.projects[0].listings.find((listing) => listing.id === "source-a");
  const replacement = state.projects[0].listings.find((listing) => listing.id === "replacement-a");
  assert.equal(source.status, WORKFLOW_STATUS.DELETED);
  assert.equal(replacement.status, WORKFLOW_STATUS.PUBLISHED);
  assert.equal(replacement.productionLifecycle.lifecycleStage, ROTATION_LIFECYCLE_STAGE.COMPLETED);
});

test("import timeout keeps the transferred copy pending and never starts DELETE", async () => {
  const fixture = coordinatorFixture({ importNever: true, importTimeoutMs: 20 });
  await assert.rejects(
    fixture.coordinator.complete(completeInput()),
    { code: "ROTATION_IMPORT_CONFIRMATION_TIMEOUT" },
  );
  assert.equal(fixture.counts().deletePolls, 0);
  const state = (await fixture.store.load()).state;
  const replacement = state.projects[0].listings.find((listing) => listing.id === "replacement-a");
  assert.equal(replacement.status, WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT);
  assert.equal(replacement.productionLifecycle.lifecycleStage, ROTATION_LIFECYCLE_STAGE.AWAITING_IMPORT_CONFIRMATION);
});

test("a fatal Mail runtime error fails immediately before DELETE", async () => {
  const fixture = coordinatorFixture({
    importErrorCode: "MAIL_AUTOMATION_TIMEOUT",
    importErrorReason: "Apple Mail hat innerhalb des sicheren Limits nicht geantwortet.",
  });
  await assert.rejects(
    fixture.coordinator.complete(completeInput()),
    { code: "MAIL_AUTOMATION_TIMEOUT" },
  );
  assert.equal(fixture.counts().importPolls, 1);
  assert.equal(fixture.counts().deletePolls, 0);
  const state = (await fixture.store.load()).state;
  const replacement = state.projects[0].listings.find((listing) => listing.id === "replacement-a");
  assert.equal(replacement.status, WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT);
  assert.equal(replacement.productionLifecycle.lifecycleErrorCode, "MAIL_AUTOMATION_TIMEOUT");
});

test("delete timeout keeps the exact pending job and performs no second transfer", async () => {
  const fixture = coordinatorFixture({ deleteNever: true, deleteTimeoutMs: 20 });
  await assert.rejects(
    fixture.coordinator.complete(completeInput()),
    { code: "ROTATION_DELETE_CONFIRMATION_TIMEOUT" },
  );
  assert.equal(fixture.counts().deletePolls, 3);
  const state = (await fixture.store.load()).state;
  const source = state.projects[0].listings.find((listing) => listing.id === "source-a");
  assert.equal(source.status, WORKFLOW_STATUS.PUBLISHED);
  assert.equal(source.productionDeleteState, "pending_confirmation");
  assert.equal(source.externalDeletionPending, true);
});

test("preflight blocks a new scheduler mutation while restart recovery is pending", async () => {
  const fixture = coordinatorFixture();
  const result = await fixture.coordinator.preflight();
  assert.equal(result.ok, false);
  assert.equal(result.code, "ROTATION_LIFECYCLE_RECOVERY_PENDING");
  assert.equal(result.open.length, 1);
});

test("restart recovery stamps a fully proven prior lifecycle without repeating provider actions", async () => {
  const fixture = coordinatorFixture();
  await fixture.coordinator.complete(completeInput());
  const countsBeforeRecovery = fixture.counts();
  await fixture.store.update((state) => ({
    state: {
      ...state,
      projects: state.projects.map((project) => ({
        ...project,
        listings: project.listings.map((listing) => listing.id === "replacement-a"
          ? {
              ...listing,
              productionLifecycle: {
                ...listing.productionLifecycle,
                lifecycleStage: ROTATION_LIFECYCLE_STAGE.AWAITING_DELETE_CONFIRMATION,
                completedAt: "",
              },
            }
          : listing),
      })),
    },
  }));
  assert.equal(openProductionRotationLifecycles((await fixture.store.load()).state).length, 1);
  const result = await fixture.coordinator.preflight({ schedulerRunId: "scheduler-after-restart" });
  assert.equal(result.ok, true);
  assert.equal(result.recoveredCount, 1);
  assert.deepEqual(fixture.counts(), countsBeforeRecovery);
  const state = (await fixture.store.load()).state;
  assert.deepEqual(openProductionRotationLifecycles(state), []);
  const replacement = state.projects[0].listings.find((listing) => listing.id === "replacement-a");
  assert.equal(replacement.productionLifecycle.lifecycleStage, ROTATION_LIFECYCLE_STAGE.COMPLETED);
  assert.ok(replacement.productionLifecycle.recoveredAt);
});
