import assert from "node:assert/strict";
import test from "node:test";

import { assignListingGroupVariant, createListingGroup, updateListingControl } from "../listing-groups.mjs";
import {
  createListingScheduler,
  listingHealthScore,
  reserveSchedulerSelection,
  runSchedulerDryRun,
  schedulerWindowBlockReasons,
  selectSchedulerListings,
  updateListingSchedulerSettings,
} from "../listing-scheduler.mjs";

function ids(prefix) { let value = 0; return () => `${prefix}-${++value}`; }

function house(id) {
  return {
    id, name: `SUN ${id}`, approved: true, houseType: "Einfamilienhaus", livingArea: 130,
    rooms: 5, bedrooms: 3, bathrooms: 2, floors: 2, housePrice: 400000,
    constructionYear: 2027, energyDemand: 18, energyClass: "A++",
    heatingType: "Fußbodenheizung mit Luft-Wasser-Wärmepumpe", energySource: "Umweltwärme und Strom",
    architecture: "Offener Grundriss", equipmentHighlights: "Hochwertige Ausstattung", useStandardPackage: true,
    images: Array.from({ length: 4 }, (_, index) => ({ id: `${id}-img-${index}`, name: `${id}-${index}.jpg`, caption: "Bild", mimeType: "image/jpeg", isFloorplan: index > 1, role: index > 1 ? "floorplan_ground" : "cover" })),
  };
}

function listing(houseValue, id) {
  return {
    id, externalId: `FPI-${id}`, templateId: houseValue.id, templateName: houseValue.name,
    price: 500000, version: 1, createdAt: "2026-06-01T08:00:00.000Z",
    texts: { title: "Titel", description: "Beschreibung", equipment: "Ausstattung", location: "Lage", other: "Sonstiges" },
  };
}

function project(projectIndex, listingsPerAddress = 4) {
  const idFactory = ids(`p${projectIndex}`);
  const projectId = `project-${projectIndex}`;
  let group = createListingGroup(projectId, { idFactory, now: "2026-06-01T08:00:00.000Z" });
  const houses = [];
  for (let index = 0; index < listingsPerAddress; index += 1) {
    const selectedHouse = house(`${projectIndex}-${index}`);
    houses.push(selectedHouse);
    group = assignListingGroupVariant(group, group.variants[index].id, selectedHouse, listing(selectedHouse, `${projectIndex}-${index}`), { idFactory, now: "2026-06-01T08:00:00.000Z" });
  }
  return {
    project: { id: projectId, name: `Adresse ${projectIndex}`, listings: group.variants.map((variant) => variant.listing), listingGroup: group, createdAt: "2026-06-01T08:00:00.000Z" },
    houses,
  };
}

function state(addressCount, listingsPerAddress = 4) {
  const built = Array.from({ length: addressCount }, (_, index) => project(index + 1, listingsPerAddress));
  let scheduler = createListingScheduler({ now: "2026-06-01T08:00:00.000Z" });
  scheduler = updateListingSchedulerSettings(scheduler, {
    enabled: true, paused: false, mode: "prepare-only", maxUpdatesPerDay: 20,
    maxUpdatesPerAddressPerDay: 1, minimumSpacingHours: 1, initialWaitDays: 1,
    updateIntervalDays: 1, allowedWeekdays: [0, 1, 2, 3, 4, 5, 6], startTime: "00:00", endTime: "23:59",
  });
  return { version: 1, projects: built.map((item) => item.project), houses: built.flatMap((item) => item.houses), scheduler };
}

test("scheduler distributes a day across addresses instead of draining one group", () => {
  const current = state(3, 4);
  current.scheduler = updateListingSchedulerSettings(current.scheduler, { maxUpdatesPerDay: 3 });
  const result = selectSchedulerListings(current, "2026-07-24T10:00:00.000Z");
  assert.equal(result.selections.length, 3);
  assert.equal(new Set(result.selections.map((item) => item.project.id)).size, 3);
  assert.deepEqual(result.selections.map((item) => item.listing.id), ["1-0", "2-0", "3-0"]);

  const reserved = reserveSchedulerSelection(current, result, { now: "2026-07-24T10:00:00.000Z" });
  const repeated = selectSchedulerListings(reserved.state, "2026-07-24T11:30:00.000Z");
  assert.equal(repeated.selections.length, 0);
});

test("health score is extensible and respects user priority and failures", () => {
  const current = state(1, 4);
  const projectValue = current.projects[0];
  const selected = projectValue.listings[1];
  projectValue.listingGroup = updateListingControl(projectValue.listingGroup, selected, { userPriority: 4, lastError: "FTP-Fehler" });
  const preferred = listingHealthScore(projectValue.listingGroup, selected, current.scheduler.settings, "2026-07-24T10:00:00.000Z");
  const normal = listingHealthScore(projectValue.listingGroup, projectValue.listings[0], current.scheduler.settings, "2026-07-24T10:00:00.000Z");
  assert.ok(preferred.score > normal.score);
  assert.deepEqual(preferred.contributions.map((item) => item.id), ["age", "overdue", "last-error", "user-priority"]);
});

test("window, pause, locks and failure isolation are enforced", () => {
  const current = state(3, 4);
  current.scheduler = updateListingSchedulerSettings(current.scheduler, { startTime: "09:00", endTime: "12:00" });
  assert.match(schedulerWindowBlockReasons(current.scheduler, "2026-07-24T06:00:00.000Z").join(" "), /Zeitfensters/);
  const first = current.projects[0].listings[0];
  current.projects[0].listingGroup = updateListingControl(current.projects[0].listingGroup, first, { premiumPlacement: true });
  current.projects[1].listingGroup.variants[1].templateId = current.projects[1].listingGroup.variants[0].templateId;
  const dryRun = runSchedulerDryRun(current, current.houses, () => 500000, { now: "2026-07-24T10:00:00.000Z" });
  assert.equal(dryRun.results.length, 2);
  assert.equal(dryRun.results.every((item) => item.ok), true);
  assert.ok(dryRun.skipped.some((item) => item.projectId === "project-2"));
});

test("selection scales to 2,000 listings without fixed limits", () => {
  const current = state(500, 4);
  current.scheduler = updateListingSchedulerSettings(current.scheduler, { maxUpdatesPerDay: 200, maxUpdatesPerAddressPerDay: 1 });
  const result = selectSchedulerListings(current, "2026-07-24T10:00:00.000Z");
  assert.equal(current.projects.reduce((sum, projectValue) => sum + projectValue.listings.length, 0), 2000);
  assert.equal(result.selections.length, 200);
  assert.equal(new Set(result.selections.map((item) => item.project.id)).size, 200);
});
