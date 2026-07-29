import assert from "node:assert/strict";
import test from "node:test";

import {
  parseAddressWorkbookRows,
  parseGermanNumber,
  replaceAddressWorkbookRows,
} from "../app/lib/address-import.ts";

const headers = [
  "Benutzer",
  "Projektname",
  "Straße",
  "Hausnummer",
  "PLZ",
  "Ort",
  "Ortsteil",
  "Grundstücksfläche m²",
  "Grundstückspreis €",
  "Nebenkosten €",
  "Lagefakten",
  "Verkehr & Erreichbarkeit",
  "Familie & Versorgung",
  "Natur & Freizeit",
  "Hinweise",
];

test("imports Fabian and Pascal addresses below introductory rows", () => {
  let id = 0;
  const result = parseAddressWorkbookRows([
    ["Fabian&Pascal Adressimport"],
    ["Eine Zeile pro Grundstück"],
    [],
    headers,
    ["Fabian", "Bergstraße", "Bergstraße", "12", 1234, "Schulzendorf", "", 625, "185.000,50", "25.000", "ruhig", "Bus", "Kita", "See", "Bauträgerbindung"],
    ["Pascal", "", "Dorfstraße", "7a", "15711", "Königs Wusterhausen", "Zernsdorf", 700, 210000, 30000],
  ], [], () => `address-${++id}`);

  assert.equal(result.projects.length, 2);
  assert.equal(result.projects[0].id, "address-1");
  assert.equal(result.projects[0].owner, "fabian");
  assert.equal(result.projects[0].zip, "01234");
  assert.equal(result.projects[0].plotPrice, 185000.5);
  assert.equal(result.projects[0].selectedHouseIds.length, 0);
  assert.equal(result.projects[1].owner, "pascal");
  assert.equal(result.projects[1].name, "Dorfstraße 7a, 15711 Königs Wusterhausen");
  assert.deepEqual(result.errors, []);
});

test("skips duplicates and reports invalid rows", () => {
  const existing = [{
    owner: "fabian",
    street: "Bergstraße",
    houseNumber: "12",
    zip: "15732",
    city: "Schulzendorf",
  }];
  const result = parseAddressWorkbookRows([
    headers,
    ["Fabian", "", "Bergstraße", "12", "15732", "Schulzendorf"],
    ["Unbekannt", "", "Neue Straße", "1", "15711", "Königs Wusterhausen"],
  ], existing, () => "new-id");

  assert.equal(result.projects.length, 0);
  assert.equal(result.projectUpdates.length, 0);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /Zeile 3/);
});

test("updates supplied plot data without clearing blank price fields", () => {
  const existing = [{
    id: "existing-address",
    owner: "fabian",
    street: "Bergstraße",
    houseNumber: "12",
    zip: "15732",
    city: "Schulzendorf",
    plotArea: 0,
    plotPrice: 185000,
    additionalCosts: 25000,
  }];
  const result = parseAddressWorkbookRows([
    headers,
    ["Fabian", "", "Bergstraße", "12", "15732", "Schulzendorf", "", 625, "", ""],
  ], existing, () => "unused-id");

  assert.equal(result.projects.length, 0);
  assert.equal(result.duplicateCount, 0);
  assert.deepEqual(result.projectUpdates, [{
    id: "existing-address",
    changes: { plotArea: 625 },
  }]);
});

test("parses German-formatted numbers", () => {
  assert.equal(parseGermanNumber("1.234.567,89 €"), 1234567.89);
  assert.equal(parseGermanNumber("625 m²"), 625);
  assert.equal(parseGermanNumber(undefined), 0);
});

test("replaces the complete address inventory while preserving matched project history", () => {
  let id = 0;
  const existing = [
    {
      id: "project-1",
      owner: "fabian",
      name: "Internet 15732",
      street: "Bergstraße",
      houseNumber: "12",
      zip: "15732",
      city: "Schulzendorf",
      district: "",
      plotArea: 625,
      plotPrice: 185000,
      additionalCosts: 25000,
      locationFacts: "alt",
      transportFacts: "",
      familyFacts: "",
      natureFacts: "",
      notes: "",
      selectedHouseIds: ["house-1"],
      promotionImageCount: 1,
      listings: [{ id: "listing-1" }],
      createdAt: "2026-07-01T10:00:00.000Z",
      lastTotalSyncAt: "2026-07-20T10:00:00.000Z",
    },
    {
      id: "project-removed",
      owner: "pascal",
      name: "Nicht mehr enthalten",
      street: "Dorfstraße",
      houseNumber: "1",
      zip: "15711",
      city: "Königs Wusterhausen",
      district: "",
      plotArea: 500,
      plotPrice: 100000,
      additionalCosts: 0,
      locationFacts: "",
      transportFacts: "",
      familyFacts: "",
      natureFacts: "",
      notes: "",
      selectedHouseIds: [],
      listings: [],
      createdAt: "2026-07-01T10:00:00.000Z",
    },
  ];

  const result = replaceAddressWorkbookRows([
    headers,
    ["Fabian", "Internet 15732", "Bergstraße", "14", "15732", "Schulzendorf", "", 626, 190000, 26000, "neu"],
    ["Pascal", "Neue Adresse", "Seeweg", "3", "15711", "Königs Wusterhausen", "", 700, 210000, 30000],
  ], existing, () => `new-${++id}`);

  assert.equal(result.projects.length, 2);
  assert.equal(result.preservedProjectCount, 1);
  assert.equal(result.newProjectCount, 1);
  assert.equal(result.removedProjectCount, 1);
  assert.equal(result.projects[0].id, "project-1");
  assert.equal(result.projects[0].houseNumber, "14");
  assert.equal(result.projects[0].plotArea, 626);
  assert.deepEqual(result.projects[0].selectedHouseIds, ["house-1"]);
  assert.deepEqual(result.projects[0].listings, [{ id: "listing-1" }]);
  assert.equal(result.projects[0].lastTotalSyncAt, "2026-07-20T10:00:00.000Z");
  assert.equal(result.projects[1].id, "new-2");
});

test("keeps an incomplete exported project when replacing the inventory", () => {
  const existing = [{
    id: "incomplete",
    owner: "fabian",
    name: "Neues Adressprojekt",
    street: "",
    houseNumber: "",
    zip: "",
    city: "",
    district: "",
    plotArea: 0,
    plotPrice: 0,
    additionalCosts: 0,
    locationFacts: "",
    transportFacts: "",
    familyFacts: "",
    natureFacts: "",
    notes: "",
    selectedHouseIds: [],
    listings: [],
    createdAt: "2026-07-01T10:00:00.000Z",
  }];
  const result = replaceAddressWorkbookRows([
    headers,
    ["Fabian", "Neues Adressprojekt", "", "", "", "", "", 1],
  ], existing, () => "unused");

  assert.equal(result.projects.length, 1);
  assert.equal(result.preservedProjectCount, 1);
  assert.equal(result.projects[0].id, "incomplete");
  assert.equal(result.projects[0].plotArea, 1);
  assert.deepEqual(result.errors, []);
});
