import assert from "node:assert/strict";
import test from "node:test";

import {
  completedManualBatchListingIds,
  createManualBatchResumptionPlan,
  requiresPlotDailyUploadClaim,
  UPLOAD_ORIGIN,
} from "../manual-batch-upload.mjs";
import { WORKFLOW_STATUS } from "../workflow-status.mjs";

function stateWithTenPlots() {
  return {
    projects: Array.from({ length: 10 }, (_, projectIndex) => ({
      id: `project-${projectIndex + 1}`,
      name: `Adresse ${projectIndex + 1}`,
      street: "Teststraße",
      houseNumber: String(projectIndex + 1),
      zip: "10115",
      city: "Berlin",
      listings: Array.from({ length: 4 }, (_, listingIndex) => ({
        id: `listing-${projectIndex + 1}-${listingIndex + 1}`,
        templateName: `Haus ${listingIndex + 1}`,
        templateId: `house-${listingIndex + 1}`,
        version: 1,
      })),
    })),
    uploadHistory: [],
    promotionLibrary: { promotionImages: [], promotionSettings: {} },
  };
}

test("automatic uploads retain the daily plot guard while only the explicit manual batch bypasses it", () => {
  assert.equal(requiresPlotDailyUploadClaim(UPLOAD_ORIGIN.AUTOMATIC_ROTATION), true);
  assert.equal(requiresPlotDailyUploadClaim(UPLOAD_ORIGIN.LEGACY_MANUAL), true);
  assert.equal(requiresPlotDailyUploadClaim("unknown"), true);
  assert.equal(requiresPlotDailyUploadClaim(UPLOAD_ORIGIN.MANUAL_BATCH), false);
});

test("an explicit manual batch admits all four variants on one plot without taking a daily claim", () => {
  const dailyClaims = [];
  for (const listingId of ["listing-1", "listing-2", "listing-3", "listing-4"]) {
    if (requiresPlotDailyUploadClaim(UPLOAD_ORIGIN.MANUAL_BATCH)) dailyClaims.push(listingId);
  }
  assert.deepEqual(dailyClaims, []);
});

test("manual batch resumes exactly the three untransferred listings after one completed listing", () => {
  const state = stateWithTenPlots();
  const { plan, protectedListingIds } = createManualBatchResumptionPlan(state, ["project-1"], {
    jobs: [{ projectId: "project-1", listingId: "listing-1-1", status: WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT }],
  });
  assert.deepEqual(protectedListingIds, ["listing-1-1"]);
  assert.equal(plan.totalListings, 3);
  assert.deepEqual(plan.addresses[0].items.map((item) => item.listingId), ["listing-1-2", "listing-1-3", "listing-1-4"]);
});

test("manual batch dry run selects exactly 30 and protects exactly 10 completed listings without duplicates", () => {
  const state = stateWithTenPlots();
  const projectIds = state.projects.map((project) => project.id);
  const ledger = {
    jobs: state.projects.map((project) => ({
      projectId: project.id,
      listingId: project.listings[0].id,
      status: WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT,
    })),
  };
  const { plan, protectedListingIds } = createManualBatchResumptionPlan(state, projectIds, ledger);
  const selectedListingIds = plan.addresses.flatMap((address) => address.items.map((item) => item.listingId));
  assert.equal(protectedListingIds.length, 10);
  assert.equal(plan.totalListings, 30);
  assert.equal(new Set(selectedListingIds).size, 30);
  assert.equal(selectedListingIds.some((listingId) => protectedListingIds.includes(listingId)), false);
  assert.deepEqual(completedManualBatchListingIds(ledger, projectIds), protectedListingIds);
});
