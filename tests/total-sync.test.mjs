import assert from "node:assert/strict";
import test from "node:test";

import {
  createTotalSyncRun,
  pickBalancedTotalSyncHouseIds,
  pickRandomHouseIds,
  projectIsReadyForTotalSync,
  protectedProjectLocationMatches,
  projectsInTotalSyncScope,
  snapshotProtectedProjectLocation,
  totalSyncCanResume,
  totalSyncExternalId,
  totalSyncProgress,
} from "../app/lib/total-sync.ts";

const HOUSE_TYPES = [
  "Einfamilienhaus",
  "Bungalow",
  "Zweifamilienhaus",
  "Einfamilienhaus",
];

function houseCandidates(ids) {
  return ids.map((id, index) => ({
    id,
    houseType: HOUSE_TYPES[index % HOUSE_TYPES.length],
  }));
}

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
    plotPrice: complete ? 150000 : 0,
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

test("selects the required house mix plus one random fourth type", () => {
  const candidates = houseCandidates(["h1", "h2", "h3", "h4", "h5", "h6"]);
  const selected = pickBalancedTotalSyncHouseIds(candidates, 4, () => 0.42);
  const selectedTypes = new Set(
    selected.map((houseId) => (
      candidates.find((house) => house.id === houseId).houseType
    )),
  );

  assert.equal(selected.length, 4);
  assert.equal(new Set(selected).size, 4);
  assert.equal(selectedTypes.has("Einfamilienhaus"), true);
  assert.equal(selectedTypes.has("Bungalow"), true);
  assert.equal(selectedTypes.has("Zweifamilienhaus"), true);
});

test("rejects a total sync without an upload-ready two-family house", () => {
  assert.throws(
    () => pickBalancedTotalSyncHouseIds([
      { id: "h1", houseType: "Einfamilienhaus" },
      { id: "h2", houseType: "Bungalow" },
      { id: "h3", houseType: "Einfamilienhaus" },
      { id: "h4", houseType: "Bungalow" },
    ]),
    /Zweifamilienhaus/,
  );
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
    eligibleHouses: houseCandidates(["h1", "h2", "h3", "h4", "h5"]),
    scope: "fabian",
    promotionImageCount: 3,
    portalPublicationEnabled: true,
    aiModel: "gpt-5.6-luna",
    runId: "run-1",
    createdAt: "2026-07-23T12:00:00.000Z",
    random: () => 0.25,
  });
  assert.equal(run.tasks.length, 1);
  assert.equal(run.tasks[0].houseIds.length, 4);
  assert.equal(run.skippedProjectCount, 1);
  assert.equal(run.promotionImageCount, 3);
  assert.equal(run.portalPublicationEnabled, true);
  assert.equal(run.aiModel, "gpt-5.6-luna");
  assert.equal(run.kind, "total-sync");
  assert.equal(
    protectedProjectLocationMatches(
      projects[0],
      run.tasks[0].protectedLocation,
    ),
    true,
  );
});

test("stores a safe action-image count for every resumable total sync", () => {
  const run = createTotalSyncRun({
    projects: [project("address-1")],
    eligibleHouses: houseCandidates(["h1", "h2", "h3", "h4"]),
    scope: "all",
    promotionImageCount: 12,
    runId: "run-promotions",
    createdAt: "2026-07-23T12:00:00.000Z",
  });
  assert.equal(run.promotionImageCount, 4);
  assert.equal(run.portalPublicationEnabled, false);
});

test("tracks generated and individually uploaded listings for safe resume", () => {
  const run = createTotalSyncRun({
    projects: [project("address-1"), project("address-2")],
    eligibleHouses: houseCandidates(["h1", "h2", "h3", "h4"]),
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

test("creates a seven-day run only for explicitly selected addresses", () => {
  const selected = project("selected", "pascal");
  selected.selectedHouseIds = ["h1", "h2", "h3", "h4"];
  selected.listings = selected.selectedHouseIds.map((templateId, index) => ({
    id: `old-${index}`,
    externalId: `OLD-${index}`,
    templateId,
    templateName: templateId,
    price: 0,
    texts: {
      title: "",
      description: "",
      equipment: "",
      location: "",
      other: "",
    },
    version: 1,
  }));
  const ignored = project("ignored", "pascal");
  const run = createTotalSyncRun({
    projects: [selected, ignored],
    eligibleHouses: houseCandidates(["h1", "h2", "h3", "h4", "h5", "h6", "h7", "h8"]),
    scope: "pascal",
    projectIds: ["selected"],
    kind: "seven-day",
    runId: "renewal-run",
    createdAt: "2026-07-24T12:00:00.000Z",
    random: () => 0.4,
  });

  assert.equal(run.kind, "seven-day");
  assert.deepEqual(run.tasks.map((task) => task.projectId), ["selected"]);
  assert.deepEqual(
    run.tasks[0].houseIds.slice().sort(),
    ["h5", "h6", "h7", "h8"],
  );
  assert.deepEqual(run.tasks[0].previousExternalIds, ["OLD-0", "OLD-1", "OLD-2", "OLD-3"]);
});

test("protects the real address and plot data stored with a run", () => {
  const original = project("protected");
  const snapshot = snapshotProtectedProjectLocation(original);
  assert.equal(protectedProjectLocationMatches(original, snapshot), true);
  assert.equal(
    protectedProjectLocationMatches(
      { ...original, plotArea: original.plotArea + 1 },
      snapshot,
    ),
    false,
  );
  assert.equal(
    protectedProjectLocationMatches(
      { ...original, houseNumber: "99" },
      snapshot,
    ),
    false,
  );
});

test("a paused run remains resumable after its fourth upload until completion is saved", () => {
  const run = createTotalSyncRun({
    projects: [project("address-1")],
    eligibleHouses: houseCandidates(["h1", "h2", "h3", "h4"]),
    scope: "all",
    runId: "run-finalize",
    createdAt: "2026-07-24T12:00:00.000Z",
  });
  run.tasks[0].generated = true;
  run.tasks[0].uploadedExternalIds = ["one", "two", "three", "four"];
  run.status = "paused";
  assert.equal(totalSyncCanResume(run), true);
});
