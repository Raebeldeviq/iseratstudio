import test from "node:test";
import assert from "node:assert/strict";
import {
  applyImportReport,
  parseImportReport,
} from "../app/lib/import-reports.ts";
import { normalizeStudioManagementState } from "../app/lib/management.ts";

function stateFixture() {
  return normalizeStudioManagementState({
    version: 1,
    provider: {
      providerNumber: "30435",
      company: "Fabian & Pascal",
      firstName: "Fabian",
      lastName: "",
      email: "kontakt@example.de",
      phone: "",
    },
    houses: [{
      id: "house",
      name: "Haus",
      houseType: "Einfamilienhaus",
      livingArea: 120,
      rooms: 4,
      bedrooms: 3,
      bathrooms: 2,
      floors: 2,
      housePrice: 250000,
      constructionYear: 2026,
      energyDemand: 20,
      energyClass: "A+",
      heatingType: "",
      energySource: "",
      architecture: "",
      equipmentHighlights: "",
      useStandardPackage: true,
      images: [],
    }],
    projects: [{
      id: "project",
      owner: "fabian",
      name: "Projekt",
      street: "",
      houseNumber: "",
      zip: "14552",
      city: "Michendorf",
      district: "",
      plotArea: 500,
      plotPrice: 100000,
      additionalCosts: 0,
      locationFacts: "",
      transportFacts: "",
      familyFacts: "",
      natureFacts: "",
      notes: "",
      selectedHouseIds: ["house"],
      listings: [{
        id: "listing",
        externalId: "30435-13226",
        templateId: "house",
        templateName: "Haus",
        price: 350000,
        texts: { title: "Titel", description: "", equipment: "", location: "", other: "" },
        version: 1,
      }],
      createdAt: "2026-07-29T08:00:00.000Z",
    }],
    promotionImages: [],
  });
}

test("parses portal-specific success and error messages", () => {
  const state = stateFixture();
  const events = parseImportReport(
    [
      "ImmoScout24; 30435-13226; erfolgreich veröffentlicht und online",
      "Immowelt; 30435-13227; Fehler: Pflichtfeld fehlt",
    ].join("\n"),
    state.management.portals,
  );
  assert.equal(events.length, 2);
  assert.deepEqual(
    events.map((event) => [event.externalId, event.portalId, event.status]),
    [
      ["30435-13226", "immoscout24", "online"],
      ["30435-13227", "immowelt", "error"],
    ],
  );
});

test("applies report events to matching listings and portal counters", () => {
  const state = stateFixture();
  const events = parseImportReport(
    "ImmoScout24 30435-13226 erfolgreich online",
    state.management.portals,
  );
  const result = applyImportReport(
    state,
    "bericht.txt",
    events,
    "2026-07-29T12:00:00.000Z",
  );
  const listing = result.state.projects[0].listings[0];
  assert.equal(result.matchedCount, 1);
  assert.equal(listing.management.lifecycle, "online");
  assert.equal(
    listing.management.portals.find((portal) => portal.portalId === "immoscout24").status,
    "online",
  );
  assert.equal(
    result.state.management.portals.find((portal) => portal.id === "immoscout24").currentOnline,
    1,
  );
  assert.equal(result.state.management.importReports[0].filename, "bericht.txt");
});
