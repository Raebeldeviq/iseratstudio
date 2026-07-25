import assert from "node:assert/strict";
import test from "node:test";

import {
  createBatchUploadLog,
  createBatchUploadPlan,
  resetBatchJobRegistryForTests,
  runSequentialBatchUpload,
} from "../batch-upload.mjs";
import { WORKFLOW_STATUS } from "../workflow-status.mjs";

function stateWithProjects(count, listingsPerProject) {
  return {
    projects: Array.from({ length: count }, (_, projectIndex) => ({
      id: `project-${projectIndex}`,
      name: `Projekt ${projectIndex}`,
      street: "Musterweg",
      houseNumber: String(projectIndex + 1),
      zip: "14467",
      city: "Potsdam",
      createdAt: "2026-07-24T08:00:00.000Z",
      listings: Array.from({ length: listingsPerProject }, (_, listingIndex) => ({
        id: `listing-${projectIndex}-${listingIndex}`,
        externalId: `FPI-${projectIndex}-${listingIndex}`,
        templateId: `house-${listingIndex}`,
        templateName: `Haus ${listingIndex}`,
      })),
    })),
    promotionImages: [
      { id: "promo-a", name: "a.jpg", active: true, priority: 1 },
      { id: "promo-b", name: "b.jpg", active: true, priority: 0 },
    ],
    promotionSettings: { enabled: true, automaticRotation: true },
    promotionUsage: [],
  };
}

test("plans any number of addresses and assigns at most one action image per address", () => {
  const state = stateWithProjects(250, 4);
  const plan = createBatchUploadPlan(state, state.projects.map((project) => project.id));
  assert.equal(plan.totalAddresses, 250);
  assert.equal(plan.totalListings, 1000);
  for (const address of plan.addresses) {
    assert.equal(address.items.filter((item) => item.promotionImageId).length, 1);
  }
});

test("uploads strictly sequentially and continues after isolated failures", async () => {
  const state = stateWithProjects(3, 4);
  const plan = createBatchUploadPlan(state, state.projects.map((project) => project.id));
  let concurrent = 0;
  let maximumConcurrent = 0;
  const order = [];
  const result = await runSequentialBatchUpload(plan, async ({ item }) => {
    concurrent += 1;
    maximumConcurrent = Math.max(maximumConcurrent, concurrent);
    order.push(item.listingId);
    await Promise.resolve();
    concurrent -= 1;
    if (item.listingId === "listing-1-1") throw new Error("gezielter Testfehler");
  });
  assert.equal(maximumConcurrent, 1);
  assert.equal(result.processed, 12);
  assert.equal(result.successful, 11);
  assert.equal(result.failed, 1);
  assert.deepEqual(order, plan.addresses.flatMap((address) => address.items.map((item) => item.listingId)));
});

test("creates the required persistent per-listing upload record", () => {
  const state = stateWithProjects(1, 1);
  const project = state.projects[0];
  const listing = project.listings[0];
  const log = createBatchUploadLog(project, listing, { ok: false, error: "Testfehler" }, {
    id: "log-1",
    batchId: "batch-1",
    promotionImageId: "promo-a",
    now: "2026-07-24T10:00:00.000Z",
    updateIntervalDays: 12,
  });
  assert.equal(log.projectId, project.id);
  assert.equal(log.externalId, listing.externalId);
  assert.equal(log.houseVariant, listing.templateName);
  assert.equal(log.status, WORKFLOW_STATUS.FAILED);
  assert.equal(log.statusMessage, "Upload fehlgeschlagen");
  assert.match(log.jobId, /^upload:/);
  assert.equal(log.error, "Testfehler");
  assert.equal(log.nextUpdatedAt, "2026-08-05T10:00:00.000Z");
});

test("uploads a prepared rotation instead of re-uploading its protected source", () => {
  const state = stateWithProjects(1, 4);
  const source = state.projects[0].listings[0];
  state.projects[0].listings.push({
    ...source,
    id: "rotation-copy",
    externalId: "FPI-ROTATION",
    templateId: "house-new",
    templateName: "Neues Haus",
    listingOrigin: "rotation-copy",
    rotationSourceListingId: source.id,
    rotationAddedHouseId: "house-new",
    rotationRemovedHouseId: source.templateId,
  });
  state.projects[0].listings[1].rotationArchivedAt = "2026-07-24T10:00:00.000Z";
  const plan = createBatchUploadPlan(state, [state.projects[0].id]);
  assert.equal(plan.addresses[0].items.some((item) => item.listingId === source.id), false);
  assert.equal(plan.addresses[0].items.some((item) => item.listingId === "rotation-copy"), true);
  assert.equal(plan.addresses[0].items.some((item) => item.listingId === state.projects[0].listings[1].id), false);
});

test("blocks parallel and repeated execution of the same upload job", async () => {
  resetBatchJobRegistryForTests();
  const state = stateWithProjects(1, 1);
  const plan = createBatchUploadPlan(state, [state.projects[0].id]);
  let releaseWorker;
  let signalStarted;
  const workerStarted = new Promise((resolve) => { signalStarted = resolve; });
  const workerGate = new Promise((resolve) => { releaseWorker = resolve; });
  let calls = 0;
  const firstRun = runSequentialBatchUpload(plan, async () => {
    calls += 1;
    signalStarted();
    await workerGate;
    return { ok: true };
  });
  await workerStarted;
  const parallelRun = await runSequentialBatchUpload(plan, async () => {
    calls += 1;
  });
  assert.equal(parallelRun.failed, 1);
  assert.equal(parallelRun.results[0].errorCode, "DUPLICATE_ACTIVE_JOB");
  releaseWorker();
  const completed = await firstRun;
  assert.equal(completed.successful, 1);
  const repeatedRun = await runSequentialBatchUpload(plan, async () => {
    calls += 1;
  });
  assert.equal(repeatedRun.results[0].errorCode, "JOB_ALREADY_COMPLETED");
  assert.equal(calls, 1);
});

test("excludes a persistently completed job and duplicate object number", () => {
  resetBatchJobRegistryForTests();
  const state = stateWithProjects(2, 1);
  state.projects[1].listings[0].externalId = state.projects[0].listings[0].externalId;
  const initial = createBatchUploadPlan(state, state.projects.map((project) => project.id));
  assert.equal(initial.totalListings, 1);
  const item = initial.addresses[0].items[0];
  state.uploadHistory = [{ jobId: item.jobId, status: WORKFLOW_STATUS.PUBLISHED }];
  const repeated = createBatchUploadPlan(state, state.projects.map((project) => project.id));
  assert.equal(repeated.totalListings, 0);
});
