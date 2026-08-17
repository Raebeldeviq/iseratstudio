import assert from "node:assert/strict";
import test from "node:test";

import { assignListingGroupVariant, createListingGroup, updateListingControl } from "../listing-groups.mjs";
import { normalizeHouseDistribution } from "../house-distribution.mjs";
import { planListingRotation } from "../rotation-service.mjs";

function ids() {
  let value = 0;
  return () => `id-${++value}`;
}

function houses(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `house-${index + 1}`,
    name: `Haus ${index + 1}`,
    approved: true,
    houseType: "Einfamilienhaus",
    livingArea: 110 + index,
    rooms: 4 + (index % 2),
    bedrooms: 3,
    bathrooms: 2,
    floors: 2,
    housePrice: 350000 + index * 1000,
    constructionYear: 2027,
    energyDemand: 18,
    energyClass: "A++",
    heatingType: "Fußbodenheizung mit Luft-Wasser-Wärmepumpe",
    energySource: "Umweltwärme und Strom",
    architecture: "Offener Grundriss",
    equipmentHighlights: "Gehobene Ausstattung",
    useStandardPackage: true,
    images: Array.from({ length: 4 }, (__, imageIndex) => ({
      id: `house-${index + 1}-image-${imageIndex + 1}`,
      name: `image-${imageIndex + 1}.jpg`,
      caption: "Bild",
      mimeType: "image/jpeg",
      isFloorplan: imageIndex >= 2,
      role: imageIndex === 0 ? "cover" : imageIndex === 2 ? "floorplan_ground" : imageIndex === 3 ? "floorplan_upper" : "living",
    })),
  }));
}

function buildState(poolSize) {
  const idFactory = ids();
  const houseList = houses(poolSize);
  const project = {
    id: "project-1",
    name: "Adresse 1",
    selectedHouseIds: houseList.slice(0, 4).map((house) => house.id),
    listings: [],
    createdAt: "2026-07-01T08:00:00.000Z",
  };
  let group = createListingGroup(project.id, { idFactory, now: project.createdAt });
  for (let index = 0; index < 4; index += 1) {
    const house = houseList[index];
    const listing = {
      id: `listing-${index + 1}`,
      externalId: `FPI-${index + 1}`,
      templateId: house.id,
      templateName: house.name,
      price: 500000 + index,
      version: 1,
      createdAt: project.createdAt,
      texts: { title: "Titel", description: "Beschreibung", equipment: "Ausstattung", location: "Lage", other: "Sonstiges" },
    };
    group = assignListingGroupVariant(group, group.variants[index].id, house, listing, { idFactory, now: project.createdAt });
  }
  project.listings = group.variants.map((variant) => variant.listing);
  project.listingGroup = group;
  const state = { houses: houseList, projects: [project], houseDistribution: {} };
  state.houseDistribution = normalizeHouseDistribution({}, houseList, [project]);
  return state;
}

test("central rotation handles pools with 4, 10 and 20 houses consistently", () => {
  const exact = buildState(4);
  const fallback = planListingRotation(exact, "project-1", "listing-1", { now: "2026-07-25T09:00:00.000Z" });
  assert.equal(fallback.ok, true);
  assert.equal(fallback.houseId, "house-1");
  assert.equal(fallback.creativeHouseSelection.variationExhausted, true);

  for (const poolSize of [10, 20]) {
    const state = buildState(poolSize);
    const plan = planListingRotation(state, "project-1", "listing-1", {
      now: "2026-07-25T09:00:00.000Z",
      seed: `pool-${poolSize}`,
    });
    assert.equal(plan.ok, true);
    assert.equal(plan.combination.length, 4);
    assert.equal(new Set(plan.combination).size, 4);
    assert.equal(plan.combination.includes("house-1"), false);
  }
});

test("central rotation is deterministic for a repeated dry run and blocks duplicates", () => {
  const state = buildState(10);
  const first = planListingRotation(state, "project-1", "listing-1", {
    now: "2026-07-25T09:00:00.000Z",
    seed: "same-run",
  });
  const repeated = planListingRotation(state, "project-1", "listing-1", {
    now: "2026-07-25T09:00:00.000Z",
    seed: "same-run",
  });
  assert.equal(first.houseId, repeated.houseId);
  const duplicate = planListingRotation(state, "project-1", "listing-1", {
    explicitHouseId: "house-2",
    now: "2026-07-25T09:00:00.000Z",
  });
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.issues.join(" "), /bereits aktiv/);
});

test("premium and active process locks are shared by UI and scheduler planning", () => {
  const state = buildState(10);
  const project = state.projects[0];
  const listing = project.listings[0];
  project.listingGroup = updateListingControl(project.listingGroup, listing, {
    premiumPlacement: true,
    processLease: { token: "active", startedAt: "2026-07-25T08:55:00.000Z" },
  }, { now: "2026-07-25T08:55:00.000Z" });
  const plan = planListingRotation(state, project.id, listing.id, { now: "2026-07-25T09:00:00.000Z" });
  assert.equal(plan.ok, false);
  assert.match(plan.issues.join(" "), /Premium-Sperre/);
  assert.match(plan.issues.join(" "), /bereits verarbeitet/);
});
