import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier === "./total-sync"
      && context.parentURL?.endsWith("/app/lib/preflight.ts")
    ) {
      return nextResolve("./total-sync.ts", context);
    }
    return nextResolve(specifier, context);
  },
});

const {
  buildPreflightReport,
  houseIsReadyForUpload,
} = await import("../app/lib/preflight.ts");

function image(id) {
  return {
    id,
    name: `${id}.jpg`,
    mimeType: "image/jpeg",
    dataUrl: `data:image/jpeg;base64,${Buffer.from(`valid-${id}`).toString("base64")}`,
    caption: id,
    isFloorplan: false,
  };
}

function house(id, overrides = {}) {
  return {
    id,
    name: `Haus ${id}`,
    houseType: "Einfamilienhaus",
    livingArea: 140,
    rooms: 5,
    bedrooms: 3,
    bathrooms: 2,
    floors: 2,
    housePrice: 350000,
    constructionYear: 2027,
    energyDemand: 18,
    energyClass: "A+",
    heatingType: "Wärmepumpe",
    energySource: "Umweltwärme",
    architecture: "",
    equipmentHighlights: "",
    useStandardPackage: true,
    images: Array.from({ length: 4 }, (_, index) => image(`${id}-${index}`)),
    ...overrides,
  };
}

function listing(id, houseId, overrides = {}) {
  return {
    id,
    externalId: `FPI-${id}`,
    templateId: houseId,
    templateName: `Haus ${houseId}`,
    price: 500000,
    texts: {
      title: "Titel",
      description: "Beschreibung",
      equipment: "Ausstattung",
      location: "Lage",
      other: "Sonstiges",
    },
    version: 1,
    ...overrides,
  };
}

function project(id, overrides = {}) {
  return {
    id,
    owner: "fabian",
    name: `Projekt ${id}`,
    street: "Musterstraße",
    houseNumber: "12a",
    zip: "14513",
    city: "Teltow",
    district: "",
    plotArea: 500,
    plotPrice: 150000,
    additionalCosts: 0,
    locationFacts: "",
    transportFacts: "",
    familyFacts: "",
    natureFacts: "",
    notes: "",
    selectedHouseIds: [],
    listings: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const provider = {
  providerNumber: "30435",
  company: "Fabian Raebel",
  firstName: "Fabian",
  lastName: "Raebel",
  email: "fabian@example.de",
  phone: "",
};

const credentials = {
  credentialsReady: true,
  ftpHost: "example.invalid",
  ftpUser: "fabian",
  ftpPassword: "secret",
  helperOnline: true,
  openAiKeyValid: true,
  openAiKeyVerified: true,
};

function input(overrides = {}) {
  const currentProject = project("one");
  const currentHouse = house("one");
  return {
    mode: "manual-upload",
    projects: [currentProject],
    allProjects: [currentProject],
    houses: [currentHouse],
    provider,
    credentials,
    requireOpenAi: false,
    minHouseImages: 4,
    maxHouseImages: 14,
    checkListings: false,
    ...overrides,
  };
}

function category(report, id) {
  return report.categories.find((entry) => entry.id === id);
}

test("passes a complete upload and exposes all six categories", () => {
  const report = buildPreflightReport(input());

  assert.equal(report.canStart, true);
  assert.equal(report.blockerCount, 0);
  assert.deepEqual(
    report.categories.map((entry) => entry.id),
    ["areas", "prices", "house-numbers", "images", "credentials", "duplicates"],
  );
});

test("collects missing area, prices, house number, images and credentials at once", () => {
  const brokenProject = project("broken", {
    plotArea: 0,
    plotPrice: 0,
    houseNumber: "",
    listings: [listing("broken", "broken", { price: 0 })],
  });
  const report = buildPreflightReport(input({
    projects: [brokenProject],
    allProjects: [brokenProject],
    houses: [house("broken", { housePrice: 0, images: [] })],
    provider: { ...provider, providerNumber: "", company: "", email: "invalid" },
    credentials: {
      credentialsReady: false,
      ftpHost: "",
      ftpUser: "",
      ftpPassword: "",
      helperOnline: false,
      openAiKeyValid: false,
      openAiKeyVerified: false,
    },
    requireOpenAi: true,
    checkListings: true,
  }));

  assert.equal(report.canStart, false);
  for (const id of ["areas", "prices", "house-numbers", "images", "credentials"]) {
    assert.ok(category(report, id).blockerCount > 0, `${id} should contain blockers`);
  }
  assert.ok(report.blockerCount >= 10);
});

test("keeps unused incomplete library houses as warnings when four ready houses exist", () => {
  const readyHouses = [
    house("ready-0", { houseType: "Einfamilienhaus" }),
    house("ready-1", { houseType: "Bungalow" }),
    house("ready-2", { houseType: "Zweifamilienhaus" }),
    house("ready-3", { houseType: "Einfamilienhaus" }),
  ];
  const report = buildPreflightReport(input({
    mode: "total-sync",
    houses: [...readyHouses, house("draft", { housePrice: 0, images: [] })],
    libraryMode: true,
    requiredReadyHouseCount: 4,
    requireOpenAi: true,
  }));

  assert.equal(report.canStart, true);
  assert.equal(category(report, "prices").warningCount, 1);
  assert.equal(category(report, "images").warningCount, 1);
  assert.equal(houseIsReadyForUpload(readyHouses[0], 4, 14), true);
});

test("blocks a new total sync when a required house category is missing", () => {
  const report = buildPreflightReport(input({
    mode: "total-sync",
    houses: [
      house("ready-0", { houseType: "Einfamilienhaus" }),
      house("ready-1", { houseType: "Bungalow" }),
      house("ready-2", { houseType: "Einfamilienhaus" }),
      house("ready-3", { houseType: "Bungalow" }),
    ],
    libraryMode: true,
    requiredReadyHouseCount: 4,
  }));

  assert.equal(report.canStart, false);
  assert.match(
    category(report, "images").items
      .find((item) => item.id.endsWith("required-house-type-mix")).detail,
    /Zweifamilienhaus/,
  );
});

test("blocks physical address duplicates across Fabian and Pascal", () => {
  const fabian = project("fabian", {
    street: "Hauptstr.",
    houseNumber: "12 a",
  });
  const pascal = project("pascal", {
    owner: "pascal",
    street: "Hauptstraße",
    houseNumber: "12a",
  });
  const report = buildPreflightReport(input({
    projects: [fabian],
    allProjects: [fabian, pascal],
  }));

  assert.equal(category(report, "duplicates").blockerCount, 1);
  assert.match(category(report, "duplicates").items[0].detail, /Fabian/);
  assert.match(category(report, "duplicates").items[0].detail, /Pascal/);
});

test("keeps meaningful house-number separators distinct", () => {
  const target = project("target", { houseNumber: "12-14" });
  const compact = project("compact", { houseNumber: "1214" });
  const slash = project("slash", { houseNumber: "12/14" });
  const report = buildPreflightReport(input({
    projects: [target],
    allProjects: [target, compact, slash],
  }));

  assert.equal(category(report, "duplicates").blockerCount, 0);
  assert.equal(category(report, "duplicates").warningCount, 0);
});

test("reports duplicate object IDs and leaves unrelated duplicates as warnings", () => {
  const target = project("target");
  const outsideOne = project("outside-one", {
    street: "Nebenweg",
    houseNumber: "2",
    listings: [listing("one", "one", { externalId: "SAME-ID" })],
  });
  const outsideTwo = project("outside-two", {
    owner: "pascal",
    street: "Nebenweg",
    houseNumber: "2",
    listings: [listing("two", "two", { externalId: "same-id" })],
  });
  const report = buildPreflightReport(input({
    projects: [target],
    allProjects: [target, outsideOne, outsideTwo],
  }));

  assert.equal(report.canStart, true);
  assert.equal(category(report, "duplicates").blockerCount, 0);
  assert.equal(category(report, "duplicates").warningCount, 2);
});

test("blocks missing replacement houses and promotion images", () => {
  const target = project("target", {
    selectedHouseIds: ["ready-0", "ready-1", "ready-2", "ready-3"],
  });
  const readyHouses = Array.from({ length: 5 }, (_, index) => house(`ready-${index}`));
  const report = buildPreflightReport(input({
    mode: "seven-day",
    projects: [target],
    allProjects: [target],
    houses: readyHouses,
    libraryMode: true,
    requiredReadyHouseCount: 4,
    requiredPromotionImageCount: 2,
    promotionImages: [image("promotion-one")],
    replacementExclusionsByProject: {
      [target.id]: target.selectedHouseIds,
    },
    requireOpenAi: true,
  }));

  assert.equal(report.canStart, false);
  assert.ok(category(report, "images").blockerCount >= 2);
});

test("blocks missing projects and houses referenced by a saved run", () => {
  const target = project("target");
  const report = buildPreflightReport(input({
    projects: [target],
    allProjects: [target],
    houses: [],
    expectedProjectIds: ["target", "deleted-project"],
    expectedHouseIds: ["deleted-house"],
  }));

  assert.equal(report.targetCount, 2);
  assert.equal(report.canStart, false);
  assert.match(category(report, "areas").items[0].detail, /deleted-project/);
  assert.match(category(report, "images").items[0].detail, /deleted-house/);
});

test("checks only listings belonging to the resumable run", () => {
  const runHouse = house("run-house");
  const oldListing = listing("old", "old-house", { price: 0 });
  const runListing = listing("run", "run-house", { totalSyncRunId: "run-1" });
  const target = project("target", { listings: [oldListing, runListing] });
  const readyReport = buildPreflightReport(input({
    projects: [target],
    allProjects: [target],
    houses: [runHouse],
    checkListings: true,
    listingRunId: "run-1",
    listingProjectIds: [target.id],
  }));
  const brokenReport = buildPreflightReport(input({
    projects: [{ ...target, listings: [oldListing, { ...runListing, price: 0 }] }],
    allProjects: [target],
    houses: [runHouse],
    checkListings: true,
    listingRunId: "run-1",
    listingProjectIds: [target.id],
  }));

  assert.equal(readyReport.canStart, true);
  assert.equal(category(readyReport, "prices").blockerCount, 0);
  assert.equal(category(brokenReport, "prices").blockerCount, 1);
});

test("blocks a manual upload before any listing was generated", () => {
  const target = project("target");
  const report = buildPreflightReport(input({
    projects: [target],
    allProjects: [target],
    checkListings: true,
    minimumListingCount: 1,
  }));

  assert.equal(report.canStart, false);
  assert.match(category(report, "images").items[0].detail, /kein fertiges Inserat/);
});

test("rejects undecodable image data and missing living area", () => {
  const brokenImage = {
    ...image("broken"),
    dataUrl: "data:image/jpeg;base64,abcde",
  };
  const brokenHouse = house("broken", {
    livingArea: 0,
    images: [brokenImage, image("two"), image("three"), image("four")],
  });
  const report = buildPreflightReport(input({
    houses: [brokenHouse],
  }));

  assert.equal(houseIsReadyForUpload(brokenHouse, 4, 14), false);
  assert.equal(category(report, "areas").blockerCount, 1);
  assert.equal(category(report, "images").blockerCount, 1);
});

test("collects missing street, postal code and city with the house-number check", () => {
  const target = project("target", {
    street: "",
    zip: "",
    city: "",
  });
  const report = buildPreflightReport(input({
    projects: [target],
    allProjects: [target],
  }));

  assert.equal(report.canStart, false);
  assert.match(category(report, "house-numbers").items[0].detail, /Straße, PLZ, Ort/);
});

test("requires at least one target address", () => {
  const report = buildPreflightReport(input({
    projects: [],
  }));

  assert.equal(report.targetCount, 0);
  assert.equal(report.canStart, false);
});
