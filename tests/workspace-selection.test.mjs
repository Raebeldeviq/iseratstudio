import assert from "node:assert/strict";
import test from "node:test";
import { workspaceProject } from "../app/lib/workspace-selection.ts";
import { selectablePlotIds, selectablePlotProjects } from "../plot-selection.mjs";

const projects = [
  { id: "historic", plotId: "legacy", listings: [{ id: "published", status: "online" }] },
  { id: "own", plotId: "inside", listings: [] },
];
const plots = [
  { id: "legacy", street: "Testweg", postalCode: "99999", city: "Ort", isActive: true },
  { id: "inside", street: "Testweg", postalCode: "14469", city: "Potsdam", isActive: true },
];
const source = { available: true, territory: { available: true, postalCodes: ["14469"] }, masterPlots: [plots[1]] };

test("workspace opens before cleanup approval while new-listing selection remains empty", () => {
  const before = structuredClone(projects);
  const context = { source, policy: undefined };
  const eligible = selectablePlotProjects(plots, projects, context);
  assert.deepEqual(eligible, []);
  const active = workspaceProject(projects, eligible, "historic");
  assert.equal(active, projects[0]);
  assert.deepEqual(selectablePlotIds(plots, plots.map(plot => plot.id), context), []);
  assert.deepEqual(projects, before);
});

test("workspace prioritizes current operational projects after approval", () => {
  const context = { source, policy: { version: 1, approvedAt: "2026-10-07T12:00:00Z", legacyPlotIds: plots.map(plot => plot.id) } };
  const eligible = selectablePlotProjects(plots, projects, context);
  assert.equal(workspaceProject(projects, eligible, "historic"), projects[1]);
  assert.equal(workspaceProject(projects, eligible, "own"), projects[1]);
  assert.deepEqual(selectablePlotIds(plots, plots.map(plot => plot.id), context), ["inside"]);
});

test("workspace retains a historical display project if the master is temporarily unavailable", () => {
  const context = { source: { available: false }, policy: { version: 1, approvedAt: "2026-10-07T12:00:00Z", legacyPlotIds: [] } };
  assert.equal(workspaceProject(projects, selectablePlotProjects(plots, projects, context), "own"), projects[1]);
  assert.equal(workspaceProject(projects, [], "missing"), projects[0]);
  assert.deepEqual(selectablePlotIds(plots, ["legacy", "inside"], context), []);
});
