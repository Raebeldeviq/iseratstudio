import assert from "node:assert/strict";
import test from "node:test";

import { activeWorkingListingCount } from "../active-listings.mjs";
import { createBatchUploadPlan } from "../batch-upload.mjs";
import { assertBrowserCatalogTransition } from "../listing-catalog-view.mjs";
import { allocateObjectNumbers } from "../object-number-sequence.mjs";
import { latestResetListingFacts, resetPlotListings } from "../plot-listing-reset.mjs";
import { WORKFLOW_STATUS } from "../workflow-status.mjs";

const NOW = "2026-09-27T10:15:00.000Z";
const ENERGY_FACTS = Object.freeze([
  { key: "energy_demand", value: "18", status: "verified", verified: true, evidenceKind: "energy_certificate", evidenceReference: "Freigabe 2026-09-27" },
  { key: "energy_class", value: "A+", status: "verified", verified: true, evidenceKind: "energy_certificate", evidenceReference: "Freigabe 2026-09-27" },
]);

function listing(index, status = WORKFLOW_STATUS.DRAFT) {
  return {
    id: `old-${index}`,
    externalId: `30460-${index}`,
    templateId: `house-${index}`,
    templateName: `Haus ${index}`,
    status,
    version: 1,
    listingFacts: index === 1 ? structuredClone(ENERGY_FACTS) : [],
    texts: { title: `Titel ${index}`, description: "Text", equipment: "Ausstattung", location: "Lage", other: "Sonstiges" },
  };
}

function fixture() {
  const targetListings = Array.from({ length: 10 }, (_, offset) => listing(
    offset + 1,
    offset < 4 ? WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT : WORKFLOW_STATUS.DRAFT,
  ));
  return {
    plots: [{ id: "plot-target", street: "Gertraudstraße" }, { id: "plot-other", street: "Musterallee" }],
    projects: [
      {
        id: "project-target", plotId: "plot-target", name: "Gertraudstraße", selectedHouseIds: targetListings.map((entry) => entry.templateId), listings: targetListings,
        listingGroup: { schemaVersion: 2, id: "group-target", projectId: "project-target", variants: [], listingControls: [], logs: [] },
      },
      {
        id: "project-other", plotId: "plot-other", name: "Musterallee", selectedHouseIds: ["house-80"], listings: [listing(80)],
        listingGroup: { schemaVersion: 2, id: "group-other", projectId: "project-other", variants: [], listingControls: [], logs: [] },
      },
    ],
    uploadHistory: [{ id: "upload-audit", listingId: "old-1" }],
    promotionUsage: [{ id: "promotion-audit", listingId: "old-1" }],
    scheduler: { runs: [{ id: "scheduler-audit", selectedListingIds: ["old-1"] }] },
    houseDistribution: { projects: [{ projectId: "project-target", activeHouseIds: ["house-1"], previewHouseIds: ["house-2"], pinnedHouseIds: ["house-3"], excludedHouseIds: ["house-4"], combinationHistory: ["historic"] }] },
    objectNumberSequence: { format: 1, prefix: "30460", next: 81 },
  };
}

test("resets ten active listings to zero locally and preserves unrelated projects", () => {
  const state = fixture();
  const otherBefore = structuredClone(state.projects[1]);
  const result = resetPlotListings(state, "plot-target", { now: NOW, idFactory: () => "reset-1" });
  const target = result.state.projects[0];

  assert.equal(result.changed, true);
  assert.equal(result.activeListingCount, 10);
  assert.equal(target.listings.length, 0);
  assert.equal(activeWorkingListingCount(target), 0);
  assert.deepEqual(result.state.projects[1], otherBefore);
});

test("preserves audit state, object sequence, and verified energy evidence in the immutable reset archive", () => {
  const state = fixture();
  const auditBefore = structuredClone({ uploadHistory: state.uploadHistory, promotionUsage: state.promotionUsage, scheduler: state.scheduler, objectNumberSequence: state.objectNumberSequence });
  const result = resetPlotListings(state, "plot-target", { now: NOW, idFactory: () => "archive-1" });

  assert.deepEqual({ uploadHistory: result.state.uploadHistory, promotionUsage: result.state.promotionUsage, scheduler: result.state.scheduler, objectNumberSequence: result.state.objectNumberSequence }, auditBefore);
  assert.deepEqual(result.state.listingResetHistory[0].listings[0].listingFacts, ENERGY_FACTS);
  const restoredFacts = latestResetListingFacts(result.state, "project-target", "house-1");
  assert.deepEqual(restoredFacts, ENERGY_FACTS);
  restoredFacts[0].value = "changed outside archive";
  assert.equal(result.state.listingResetHistory[0].listings[0].listingFacts[0].value, "18");
  assert.deepEqual(result.state.houseDistribution.projects[0].activeHouseIds, []);
  assert.deepEqual(result.state.houseDistribution.projects[0].combinationHistory, ["historic"]);
  assert.deepEqual(allocateObjectNumbers(result.state, 1).objectNumbers, ["30460-81"]);
});

test("preserves deletion batch history when a plot is reset", () => {
  const state = fixture();
  state.deleteBatches = [{ id: "delete-batch:1:1", cycle: 1, number: 1, plannedDeletionDate: "2026-10-06", completedAt: "", entries: [{ batchId: "delete-batch:1:1", listingId: "old-1", projectId: "project-target", externalId: "30460-001001", index: 1, housePosition: 1, uploadDate: "2026-09-27", plannedDeletionDate: "2026-10-06", status: "active", deletedAt: "" }] }];
  const result = resetPlotListings(state, "plot-target", { now: NOW, idFactory: () => "reset-batch" });
  assert.deepEqual(result.state.deleteBatches, state.deleteBatches);
  assert.equal(result.state.listingResetHistory[0].listings.length, 10);
});

test("plans only newly prepared listings after reset and excludes open historical transfers", () => {
  const state = fixture();
  const beforeResetPlan = createBatchUploadPlan(state, ["project-target"]);
  assert.deepEqual(beforeResetPlan.addresses[0].items.map((item) => item.listingId), ["old-5", "old-6", "old-7", "old-8", "old-9", "old-10"]);

  const reset = resetPlotListings(state, "plot-target", { now: NOW, idFactory: () => "archive-1" });
  const newListings = [81, 82, 83, 84].map((index) => ({ ...listing(index, WORKFLOW_STATUS.PREPARED), id: `new-${index}` }));
  const next = { ...reset.state, projects: reset.state.projects.map((project) => project.id === "project-target" ? { ...project, listings: newListings } : project) };
  const selected = createBatchUploadPlan(next, ["project-target"]).addresses[0].items.map((item) => item.listingId);
  assert.deepEqual(selected, ["new-81", "new-82", "new-83", "new-84"]);
});

test("allows terminal listings to leave the active catalog only through the immutable reset archive", () => {
  const state = fixture();
  state.projects[0].listings[0].status = WORKFLOW_STATUS.PUBLISHED;
  const result = resetPlotListings(state, "plot-target", { now: NOW, idFactory: () => "archive-1" });
  assert.doesNotThrow(() => assertBrowserCatalogTransition(state, result.state));
  const tampered = structuredClone(result.state);
  tampered.listingResetHistory = [];
  assert.throws(() => assertBrowserCatalogTransition(result.state, tampered), { code: "CATALOG_LISTING_CONFLICT" });
});

test("keeps reset archives as evidence without feeding archived listings back into the active catalog", () => {
  const state = fixture();
  const result = resetPlotListings(state, "plot-target", { now: NOW, idFactory: () => "archive-1" });
  const archived = result.state.listingResetHistory[0].listings;

  assert.equal(result.state.projects[0].listings.length, 0);
  assert.equal(archived.length, 10);
  assert.deepEqual(latestResetListingFacts(result.state, "project-target", "house-1"), ENERGY_FACTS);
  assert.doesNotThrow(() => assertBrowserCatalogTransition(state, result.state));
});

test("performs no network operation", () => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error("network forbidden"); };
  try {
    resetPlotListings(fixture(), "plot-target", { now: NOW });
  } finally {
    globalThis.fetch = previousFetch;
  }
  assert.equal(calls, 0);
});
