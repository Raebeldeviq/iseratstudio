import assert from "node:assert/strict";
import test from "node:test";

import { normalizeHouseDistribution } from "../house-distribution.mjs";
import {
  assignListingGroupVariant,
  createListingGroup,
  updateListingControl,
} from "../listing-groups.mjs";
import {
  evaluateLiveCanaryCandidates,
  LIVE_CANARY_INSUFFICIENT_ELIGIBLE_PLOTS,
} from "../listing-rotation-live-canary.mjs";
import { createListingScheduler, updateListingSchedulerSettings } from "../listing-scheduler.mjs";
import { WORKFLOW_STATUS } from "../workflow-status.mjs";

function ids(prefix) {
  let value = 0;
  return () => `${prefix}-${++value}`;
}

function house(id) {
  return {
    id,
    name: `House ${id}`,
    approved: true,
    houseType: "Einfamilienhaus",
    livingArea: 130,
    rooms: 5,
    bedrooms: 3,
    bathrooms: 2,
    floors: 2,
    housePrice: 400_000,
    constructionYear: 2027,
    energyDemand: 18,
    energyClass: "A++",
    heatingType: "Wärmepumpe",
    energySource: "Strom",
    architecture: "Offen",
    equipmentHighlights: "Vollständig",
    useStandardPackage: true,
    images: Array.from({ length: 4 }, (_, index) => ({
      id: `${id}-image-${index}`,
      name: `${id}-${index}.jpg`,
      caption: `Bild ${index + 1}`,
      mimeType: "image/jpeg",
      dataUrl: "data:image/jpeg;base64,AA==",
      isFloorplan: index >= 2,
      role: index === 0 ? "cover" : index >= 2 ? "floorplan_ground" : "living",
    })),
  };
}

function sourceListing(houseValue, projectIndex, index, createdAt) {
  return {
    id: `source-${projectIndex}-${index}`,
    externalId: `30460-${String(projectIndex * 100 + index).padStart(6, "0")}`,
    templateId: houseValue.id,
    templateName: houseValue.name,
    price: 500_000,
    version: 1,
    createdAt,
    status: WORKFLOW_STATUS.PUBLISHED,
    statusMessage: "Veröffentlicht",
    listingOrigin: "group-source",
    texts: { title: "Titel", description: "Beschreibung", equipment: "Ausstattung", location: "Lage", other: "Sonstiges" },
  };
}

function project(projectIndex, houses, createdAt) {
  const projectId = `project-${projectIndex}`;
  const idFactory = ids(projectId);
  let group = createListingGroup(projectId, { idFactory, now: createdAt });
  for (let index = 0; index < 4; index += 1) {
    group = assignListingGroupVariant(group, group.variants[index].id, houses[index], sourceListing(houses[index], projectIndex, index, createdAt), { idFactory, now: createdAt });
    const listing = group.variants[index].listing;
    group = updateListingControl(group, listing, {
      automaticUpdateEnabled: true,
      automaticDeletionEnabled: false,
      status: WORKFLOW_STATUS.PUBLISHED,
      lastSuccessAt: createdAt,
      lastUpdatedAt: createdAt,
    }, { idFactory, now: createdAt });
  }
  return {
    id: projectId,
    plotId: `plot-${projectIndex}`,
    isActive: true,
    name: `Projekt ${projectIndex}`,
    street: "Teststraße",
    houseNumber: String(projectIndex),
    zip: "14542",
    city: "Werder",
    district: "",
    plotArea: 600,
    plotPrice: 120_000,
    additionalCosts: 20_000,
    locationFacts: "Ruhig",
    transportFacts: "Angebunden",
    familyFacts: "Familienfreundlich",
    natureFacts: "Naturnah",
    selectedHouseIds: houses.slice(0, 4).map((item) => item.id),
    listings: group.variants.map((variant) => variant.listing).filter(Boolean),
    listingGroup: group,
    createdAt,
  };
}

function state(projectCount = 4) {
  const houses = Array.from({ length: 6 }, (_, index) => house(`house-${index + 1}`));
  const projects = Array.from({ length: projectCount }, (_, index) => project(index + 1, houses, `2026-07-${String(index + 1).padStart(2, "0")}T08:00:00.000Z`));
  let scheduler = createListingScheduler({ now: "2026-07-01T08:00:00.000Z" });
  scheduler = updateListingSchedulerSettings(scheduler, {
    enabled: true,
    paused: false,
    mode: "full-auto",
    maxUpdatesPerDay: 50,
    maxUpdatesPerAddressPerDay: 1,
    minimumSpacingHours: 1,
    initialWaitDays: 12,
    updateIntervalDays: 12,
    allowedWeekdays: [0, 1, 2, 3, 4, 5, 6],
    startTime: "08:00",
    endTime: "18:00",
  }, { now: "2026-07-01T08:00:00.000Z" });
  return {
    version: 1,
    selectedPlotIds: [],
    houses,
    projects,
    provider: { providerNumber: "30460", company: "Test GmbH", firstName: "Test", lastName: "Person", email: "test@example.invalid", phone: "0000" },
    promotionImage: null,
    promotionImageEnabled: false,
    uploadHistory: [],
    scheduler,
    houseDistribution: normalizeHouseDistribution({}, houses, projects),
  };
}

function dailyGuard(consumedPlots = []) {
  const consumed = new Set(consumedPlots);
  return {
    async inspect(input) { return { consumed: consumed.has(input.plotId), record: null, evidence: null }; },
  };
}

test("read-only selection uses oldest effective publication, skips a used plot and chooses three unique plots", async () => {
  const result = await evaluateLiveCanaryCandidates(state(4), {
    at: "2026-08-13T10:00:00.000Z",
    dailyGuard: dailyGuard(["plot-1"]),
    uploadLedger: { jobs: [] },
    uploadEvidence: [],
    houseImageCounts: new Map(Array.from({ length: 6 }, (_, index) => [`house-${index + 1}`, 4])),
    validatePrepared: async () => [],
  });
  assert.equal(result.ok, true, JSON.stringify(result.candidates));
  assert.deepEqual(result.candidates.map((candidate) => candidate.plotId), ["plot-2", "plot-3", "plot-4"]);
  assert.equal(new Set(result.candidates.map((candidate) => candidate.plotId)).size, 3);
  assert.equal(result.considered.find((candidate) => candidate.plotId === "plot-1").reasons.includes("PLOT_DAILY_UPLOAD_LIMIT_REACHED"), true);
  assert.deepEqual(result.candidates.map((candidate) => candidate.effectivePublishedAt), [
    "2026-07-02T08:00:00.000Z",
    "2026-07-03T08:00:00.000Z",
    "2026-07-04T08:00:00.000Z",
  ]);
});

test("read-only selection stops without mutation when fewer than three unused eligible plots exist", async () => {
  const catalog = state(3);
  const before = structuredClone(catalog);
  const result = await evaluateLiveCanaryCandidates(catalog, {
    at: "2026-08-13T10:00:00.000Z",
    dailyGuard: dailyGuard(["plot-1"]),
    uploadLedger: { jobs: [] },
    uploadEvidence: [],
    validatePrepared: async () => [],
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, LIVE_CANARY_INSUFFICIENT_ELIGIBLE_PLOTS);
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(catalog, before);
});
