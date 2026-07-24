import assert from "node:assert/strict";
import test from "node:test";

import { parseAddressWorkbookRows, parseGermanNumber } from "../app/lib/address-import.ts";

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
