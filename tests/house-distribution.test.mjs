import assert from "node:assert/strict";
import test from "node:test";

import {
  commitHouseDistributionPreviews,
  generateWeightedDistribution,
  houseCombinationKey,
  HOUSES_PER_PROJECT,
  normalizeHouseDistribution,
  planWeightedHouseRotation,
  recordHouseRotation,
  setHouseDistributionPool,
  updateProjectHouseRules,
  validateHousePool,
} from "../house-distribution.mjs";

function houses(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `house-${index + 1}`,
    approved: true,
    name: `Haus ${index + 1}`,
    housePrice: 300000 + index * 1000,
    livingArea: 100 + index,
    rooms: 4 + (index % 2),
    images: Array.from({ length: 4 }, (__, imageIndex) => ({ id: `house-${index + 1}-image-${imageIndex}` })),
  }));
}

function projects(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `project-${index + 1}`,
    selectedHouseIds: [],
    listingGroup: { variants: [] },
  }));
}

function assertValidAssignments(assignments, projectList) {
  for (const project of projectList) {
    const selected = assignments[project.id];
    assert.equal(selected.length, HOUSES_PER_PROJECT);
    assert.equal(new Set(selected).size, HOUSES_PER_PROJECT);
  }
}

test("distributes ten houses across four projects with distinct weighted combinations", () => {
  const houseList = houses(10);
  const projectList = projects(4);
  const result = generateWeightedDistribution({}, houseList, projectList.map((project) => project.id), {
    projects: projectList,
    seed: "four-by-ten",
    now: "2026-07-24T08:00:00.000Z",
  });
  assert.equal(result.ok, true);
  assertValidAssignments(result.assignments, projectList);
  assert.ok(new Set(Object.values(result.assignments).map(houseCombinationKey)).size > 1);
});

test("scales weighted distribution to twenty projects and fifteen houses", () => {
  const houseList = houses(15);
  const projectList = projects(20);
  const result = generateWeightedDistribution({}, houseList, projectList.map((project) => project.id), {
    projects: projectList,
    seed: "twenty-by-fifteen",
  });
  assert.equal(result.ok, true);
  assertValidAssignments(result.assignments, projectList);
  assert.ok(new Set(Object.values(result.assignments).map(houseCombinationKey)).size >= 10);
});

test("continues when there are more projects than useful unique combinations", () => {
  const houseList = houses(5);
  const projectList = projects(30);
  const result = generateWeightedDistribution({}, houseList, projectList.map((project) => project.id), {
    projects: projectList,
    seed: "combination-pressure",
  });
  assert.equal(result.ok, true);
  assertValidAssignments(result.assignments, projectList);
});

test("accepts exactly four complete houses and blocks pools with fewer than four", () => {
  const four = houses(4);
  const projectList = projects(2);
  const exact = generateWeightedDistribution({}, four, projectList.map((project) => project.id), { projects: projectList });
  assert.equal(exact.ok, true);
  assertValidAssignments(exact.assignments, projectList);
  const insufficient = validateHousePool({}, houses(3), { projects: projectList });
  assert.equal(insufficient.ok, false);
  assert.match(insufficient.issues.join(" "), /mindestens 4/);
});

test("honors pinned houses, project exclusions and inactive catalog entries", () => {
  const houseList = houses(8);
  houseList[7].approved = false;
  const projectList = projects(1);
  let distribution = normalizeHouseDistribution({}, houseList, projectList);
  distribution = setHouseDistributionPool(distribution, houseList.map((house) => house.id), houseList, projectList);
  assert.equal(distribution.poolHouseIds.includes("house-8"), false);
  distribution = updateProjectHouseRules(distribution, houseList, projectList, "project-1", {
    previewHouseIds: ["house-1"],
    pinnedHouseIds: ["house-1"],
    excludedHouseIds: ["house-2", "house-3"],
  });
  const result = generateWeightedDistribution(distribution, houseList, ["project-1"], {
    projects: projectList,
    seed: "manual-rules",
  });
  assert.equal(result.ok, true);
  assert.equal(result.assignments["project-1"].includes("house-1"), true);
  assert.equal(result.assignments["project-1"].includes("house-2"), false);
  assert.equal(result.assignments["project-1"].includes("house-3"), false);
  assert.equal(result.assignments["project-1"].includes("house-8"), false);
});

test("persists usage and combination history only when a preview is committed", () => {
  const houseList = houses(7);
  const projectList = projects(1);
  const preview = generateWeightedDistribution({}, houseList, ["project-1"], {
    projects: projectList,
    seed: "commit",
    now: "2026-07-24T08:00:00.000Z",
  });
  assert.equal(preview.distribution.houseUsage.every((usage) => usage.totalUses === 0), true);
  const committed = commitHouseDistributionPreviews(preview.distribution, houseList, projectList, ["project-1"], {
    now: "2026-07-24T09:00:00.000Z",
  });
  assert.equal(committed.ok, true);
  const record = committed.distribution.projects[0];
  assert.equal(record.activeHouseIds.length, 4);
  assert.equal(record.combinationHistory.length, 1);
  assert.equal(committed.distribution.combinationUsage.length, 1);
  assert.equal(committed.distribution.combinationUsage[0].totalUses, 1);
});

test("rotates for twenty cycles without duplicates or an immediate previous combination", () => {
  const houseList = houses(10);
  const projectList = [{ ...projects(1)[0], selectedHouseIds: ["house-1", "house-2", "house-3", "house-4"] }];
  let distribution = normalizeHouseDistribution({}, houseList, projectList);
  distribution = updateProjectHouseRules(distribution, houseList, projectList, "project-1", {
    previewHouseIds: ["house-1", "house-2", "house-3", "house-4"],
  });
  distribution = commitHouseDistributionPreviews(distribution, houseList, projectList, ["project-1"], {
    now: "2026-07-01T08:00:00.000Z",
  }).distribution;
  const combinations = [];
  for (let cycle = 0; cycle < 20; cycle += 1) {
    const record = distribution.projects[0];
    const removed = record.activeHouseIds[cycle % HOUSES_PER_PROJECT];
    const before = houseCombinationKey(record.activeHouseIds);
    const plan = planWeightedHouseRotation(distribution, houseList, projectList, "project-1", removed, {
      seed: `cycle-${cycle}`,
      now: new Date(Date.UTC(2026, 6, cycle + 2, 8)).toISOString(),
    });
    assert.equal(plan.ok, true);
    assert.equal(plan.combination.length, 4);
    assert.equal(new Set(plan.combination).size, 4);
    assert.notEqual(houseCombinationKey(plan.combination), before);
    distribution = recordHouseRotation(
      distribution,
      houseList,
      projectList,
      "project-1",
      removed,
      plan.houseId,
      { now: new Date(Date.UTC(2026, 6, cycle + 2, 9)).toISOString() },
    );
    combinations.push(houseCombinationKey(distribution.projects[0].activeHouseIds));
  }
  assert.ok(new Set(combinations).size >= 10);
  assert.equal(distribution.projects[0].combinationHistory.length >= 20, true);
  assert.equal(distribution.houseUsage.some((usage) => usage.totalUses > 1), true);
});

test("manual preview validation rejects duplicates and houses outside the pool", () => {
  const houseList = houses(6);
  const projectList = projects(1);
  let distribution = normalizeHouseDistribution({}, houseList, projectList);
  distribution = updateProjectHouseRules(distribution, houseList, projectList, "project-1", {
    previewHouseIds: ["house-1", "house-1", "house-2", "house-3"],
  });
  const duplicate = commitHouseDistributionPreviews(distribution, houseList, projectList, ["project-1"]);
  assert.equal(duplicate.ok, false);
  distribution = updateProjectHouseRules(distribution, houseList, projectList, "project-1", {
    previewHouseIds: ["house-1", "house-2", "house-3", "missing-house"],
  });
  const missing = commitHouseDistributionPreviews(distribution, houseList, projectList, ["project-1"]);
  assert.equal(missing.ok, false);
});
