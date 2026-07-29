import assert from "node:assert/strict";
import test from "node:test";

import JSZip from "jszip";

import { buildInventoryWorkbook } from "../app/lib/inventory-export.ts";

const state = {
  version: 1,
  houses: [{
    id: "house-1",
    name: "SUN 142 V2",
    houseType: "Einfamilienhaus",
    livingArea: 141.6,
    rooms: 5,
    bedrooms: 4,
    bathrooms: 1,
    floors: 2,
    housePrice: 397330,
    constructionYear: 2027,
    energyDemand: 18,
    energyClass: "A++",
    heatingType: "Wärmepumpe",
    energySource: "Umweltwärme und Strom",
    architecture: "Offener Grundriss",
    equipmentHighlights: "Moderne Haustechnik",
    useStandardPackage: true,
    images: [],
  }],
  projects: [{
    id: "project-1",
    owner: "fabian",
    name: "Schulzendorf Bergstraße",
    street: "Bergstraße",
    houseNumber: "12",
    zip: "15732",
    city: "Schulzendorf",
    district: "",
    plotArea: 625,
    plotPrice: 185000,
    additionalCosts: 25000,
    locationFacts: "Ruhiges Wohngebiet",
    transportFacts: "Busverbindung",
    familyFacts: "Kita im Ort",
    natureFacts: "Waldnähe",
    notes: "",
    selectedHouseIds: ["house-1"],
    listings: [{
      id: "listing-1",
      externalId: "FP-1001",
      templateId: "house-1",
      templateName: "SUN 142 V2",
      price: 607330,
      texts: {
        title: "Hier wohnt das gute Leben",
        description: "Eine lebendige Objektbeschreibung.",
        equipment: "Hochwertige Ausstattung.",
        location: "Schulzendorf verbindet Ruhe und Alltag.",
        other: "Weitere Angaben.",
      },
      uploadedAt: "2026-07-24T10:00:00.000Z",
      version: 1,
    }],
    createdAt: "2026-07-23T08:00:00.000Z",
  }],
  provider: {
    providerNumber: "",
    company: "Fabian Raebel",
    firstName: "Fabian",
    lastName: "Raebel",
    email: "fabian@example.invalid",
    phone: "",
  },
  promotionImages: [],
};

test("creates a valid Excel container with the complete inventory sheets", async () => {
  const result = await buildInventoryWorkbook(state);
  assert.equal(result.addressCount, 1);
  assert.equal(result.listingCount, 1);
  assert.equal(result.houseCount, 1);
  assert.equal(result.activeHouseCount, 1);
  assert.equal(result.archivedHouseCount, 0);
  assert.match(result.filename, /^Inserate-Studio-Bestand-\d{4}-\d{2}-\d{2}\.xlsx$/);
  assert.equal(
    result.blob.type,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );

  const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
  const workbook = await zip.file("xl/workbook.xml").async("string");
  const addresses = await zip.file("xl/worksheets/sheet1.xml").async("string");
  const overview = await zip.file("xl/worksheets/sheet2.xml").async("string");
  const listings = await zip.file("xl/worksheets/sheet3.xml").async("string");
  const houses = await zip.file("xl/worksheets/sheet4.xml").async("string");

  assert.match(workbook, /sheet name="Adressbestand"/);
  assert.match(workbook, /sheet name="Übersicht"/);
  assert.match(workbook, /sheet name="Inseratbestand"/);
  assert.match(workbook, /sheet name="Haustypen"/);
  assert.match(addresses, /Grundstücksfläche m²/);
  assert.match(addresses, /Bergstraße/);
  assert.match(addresses, /SUN 142 V2/);
  assert.match(overview, /Mitarbeiter mit Adressen/);
  assert.match(listings, /Hier wohnt das gute Leben/);
  assert.match(houses, /397330/);
  assert.doesNotMatch(addresses + overview + listings + houses, /fabian@example\.invalid/);
});
