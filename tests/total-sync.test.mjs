import assert from "node:assert/strict";
import test from "node:test";

import {
  createTotalSyncRun,
  pickRandomHouseIds,
  projectIsReadyForTotalSync,
  projectsInTotalSyncScope,
  totalSyncCanResume,
  totalSyncExternalId,
  totalSyncProgress,
} from "../app/lib/total-sync.ts";

function project(id, owner = "fabian", complete = true) {
  return {
    id,
    owner,
    name: id,
    street: complete ? "Musterweg" : "",
    houseNumber: "1",
    zip: complete ? "12345" : "",
    city: complete ? "Musterort" : "",
    district: "",
    plotArea: complete ? 500 : 0,
    plotPrice: 0,
    additionalCosts: 0,
    locationFacts: "",
    transportFacts: "",
    familyFacts: "",
    natureFacts: "",
    notes: "",
    selectedHouseIds: [],
    listings: [],
    createdAt: "2026-07-23T00:00:00.000Z",
  };
}

test("selects four different random house types", () => {
  const selected = pickRandomHouseIds(
    ["h1", "h2", "h3", "h4", "h5", "h6"],
    4,
    () => 0.42,
  );
  assert.equal(selected.length, 4);
  assert.equal(new Set(selected).size, 4);
});

test("creates new stable object ids for every total sync run", () => {
  const first = totalSyncExternalId("run-alpha", "project-one", 1);
  const repeated = totalSyncExternalId("run-alpha", "project-one", 1);
  const nextRun = totalSyncExternalId("run-beta", "project-one", 1);
  assert.equal(first, repeated);
  assert.notEqual(first, nextRun);
  assert.match(first, /^FPI-T-[A-Z0-9]+-[A-Z0-9]+-1$/);
});

test("builds a total sync only from complete addresses in the selected scope", () => {
  const projects = [
    project("fabian-ready"),
    project("fabian-draft", "fabian", false),
    project("pascal-ready", "pascal"),
  ];
  assert.equal(projectIsReadyForTotalSync(projects[0]), true);
  assert.equal(projectIsReadyForTotalSync(projects[1]), false);
  assert.deepEqual(
    projectsInTotalSyncScope(projects, "fabian").map((item) => item.id),
    ["fabian-ready", "fabian-draft"],
  );

  const run = createTotalSyncRun({
    projects,
    eligibleHouseIds: ["h1", "h2", "h3", "h4", "h5"],
    scope: "fabian",
    runId: "run-1",
    createdAt: "2026-07-23T12:00:00.000Z",
    random: () => 0.25,
  });
  assert.equal(run.tasks.length, 1);
  assert.equal(run.tasks[0].houseIds.length, 4);
  assert.equal(run.skippedProjectCount, 1);
});

test("tracks generated and individually uploaded listings for safe resume", () => {
  const run = createTotalSyncRun({
    projects: [project("address-1"), project("address-2")],
    eligibleHouseIds: ["h1", "h2", "h3", "h4"],
    scope: "all",
    runId: "run-2",
    createdAt: "2026-07-23T12:00:00.000Z",
  });
  run.tasks[0].generated = true;
  run.tasks[0].uploadedExternalIds = ["listing-1", "listing-2"];
  assert.deepEqual(totalSyncProgress(run), {
    total: 8,
    generated: 4,
    uploaded: 2,
    completedProjects: 0,
  });
  assert.equal(totalSyncCanResume(run), true);

  for (const task of run.tasks) {
    task.generated = true;
    task.uploadedExternalIds = task.houseIds.map((houseId) => `listing-${houseId}`);
  }
  run.status = "completed";
  assert.equal(totalSyncCanResume(run), false);
});
