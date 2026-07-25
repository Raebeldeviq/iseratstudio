import assert from "node:assert/strict";
import test from "node:test";

import {
  archivePlotRecord,
  createProjectFromPlot,
  deletePlotRecordCascade,
  normalizePlotState,
  patchPlotFromProject,
  plotAddressKey,
} from "../plot-records.mjs";

test("migrates legacy project addresses into canonical plot records without losing project data", () => {
  const state = {
    version: 1,
    projects: [{
      id: "project-1",
      owner: "pascal",
      name: "Potsdam",
      street: "Kirschallee",
      houseNumber: "12",
      zip: "14469",
      city: "Potsdam",
      plotArea: 720,
      plotPrice: 325000,
      locationFacts: "grün und ruhig",
      listings: [{ id: "listing-1" }],
      createdAt: "2026-07-20T10:00:00.000Z",
    }],
  };
  const result = normalizePlotState(state, { now: "2026-07-25T10:00:00.000Z" });
  assert.equal(result.plots.length, 1);
  assert.equal(result.plots[0].street, "Kirschallee");
  assert.equal(result.plots[0].postalCode, "14469");
  assert.equal(result.plots[0].plotSizeSqm, 720);
  assert.equal(result.projects[0].plotId, result.plots[0].id);
  assert.deepEqual(result.projects[0].listings, [{ id: "listing-1" }]);
});

test("uses one plot record for projects with the same address and is idempotent", () => {
  const project = { id: "one", street: "Weg", houseNumber: "1", zip: "12345", city: "Ort", createdAt: "2026-07-20T10:00:00.000Z" };
  const first = normalizePlotState({ projects: [project, { ...project, id: "two" }] }, { now: "2026-07-25T10:00:00.000Z" });
  assert.equal(first.plots.length, 1);
  assert.equal(first.projects[0].plotId, first.projects[1].plotId);
  const second = normalizePlotState(first, { now: "2026-07-25T10:00:00.000Z" });
  assert.deepEqual(second, first);
});

test("propagates edited core fields and only archives the plot selection record", () => {
  const plot = normalizePlotState({ projects: [{ id: "p", street: "Weg", houseNumber: "1", zip: "12345", city: "Ort" }] }, { now: "2026-07-25T10:00:00.000Z" }).plots[0];
  const updated = patchPlotFromProject(plot, { street: "Allee", houseNumber: "2", zip: "14469", city: "Potsdam", plotArea: 800, plotPrice: 400000 }, "2026-07-25T11:00:00.000Z");
  assert.equal(plotAddressKey(updated), plotAddressKey({ street: "Allee", houseNumber: "2", zip: "14469", city: "Potsdam" }));
  assert.equal(updated.purchasePrice, 400000);
  const archived = archivePlotRecord([updated], updated.id, "2026-07-25T12:00:00.000Z");
  assert.equal(archived[0].isActive, false);
});

test("creates a project reference from a selected plot", () => {
  const project = createProjectFromPlot({
    id: "plot-1", street: "Seestraße", houseNumber: "3", postalCode: "14476", city: "Potsdam",
    plotSizeSqm: 650, purchasePrice: 300000, regionalNotes: "seenreich", owner: "pascal",
  }, { createId: () => "project-1", now: "2026-07-25T10:00:00.000Z" });
  assert.equal(project.plotId, "plot-1");
  assert.equal(project.owner, "pascal");
  assert.equal(project.locationFacts, "seenreich");
  assert.equal(project.listingGroup.projectId, "project-1");
});

test("manual plot deletion removes all internal project relationships without external deletion", () => {
  const state = {
    plots: [{ id: "plot-1" }, { id: "plot-2" }],
    projects: [
      { id: "project-1", plotId: "plot-1", listings: [{ id: "listing-1", externalId: "external-1" }] },
      { id: "project-2", plotId: "plot-2", listings: [{ id: "listing-2" }] },
    ],
    promotionUsage: [{ projectId: "project-1", listingId: "listing-1" }, { projectId: "project-2", listingId: "listing-2" }],
    uploadHistory: [{ projectId: "project-1", listingId: "listing-1" }, { projectId: "project-2", listingId: "listing-2" }],
    houseDistribution: {
      projects: [{ projectId: "project-1" }, { projectId: "project-2" }],
      houseUsage: [{ houseId: "house", projectIds: ["project-1", "project-2"], activeProjectIds: ["project-1", "project-2"] }],
      combinationUsage: [{ key: "house", lastProjectId: "project-1" }],
    },
    scheduler: { runs: [{ selectedListingIds: ["listing-1", "listing-2"], completedListingIds: ["listing-1"], failedListingIds: [] }] },
  };
  const result = deletePlotRecordCascade(state, "plot-1");
  assert.deepEqual(result.state.plots.map((plot) => plot.id), ["plot-2"]);
  assert.deepEqual(result.state.projects.map((project) => project.id), ["project-2"]);
  assert.deepEqual(result.state.promotionUsage.map((entry) => entry.projectId), ["project-2"]);
  assert.deepEqual(result.state.uploadHistory.map((entry) => entry.projectId), ["project-2"]);
  assert.deepEqual(result.state.houseDistribution.projects.map((entry) => entry.projectId), ["project-2"]);
  assert.deepEqual(result.state.houseDistribution.houseUsage[0].projectIds, ["project-2"]);
  assert.equal(result.state.houseDistribution.combinationUsage[0].lastProjectId, "");
  assert.deepEqual(result.state.scheduler.runs[0].selectedListingIds, ["listing-2"]);
  assert.equal(Object.hasOwn(result.state, "externalDeletion"), false);
});
