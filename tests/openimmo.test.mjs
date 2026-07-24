import assert from "node:assert/strict";
import test from "node:test";

import { buildImportPackage, buildOpenImmoXml } from "../app/lib/openimmo.ts";

test("exports listings with the OpenImmo CHANGE upsert action", async () => {
  const input = {
    project: {
      id: "project-1",
      name: "Testprojekt",
      street: "Teststraße",
      houseNumber: "1",
      zip: "15732",
      city: "Schulzendorf",
      district: "",
      plotArea: 600,
      plotPrice: 100000,
      additionalCosts: 0,
      locationFacts: "",
      transportFacts: "",
      familyFacts: "",
      natureFacts: "",
      notes: "",
      selectedHouseIds: ["house-1"],
      listings: [],
      createdAt: "2026-07-22T00:00:00.000Z",
    },
    listings: [{
      id: "listing-1",
      externalId: "FPI-TEST-1",
      templateId: "house-1",
      templateName: "Testhaus",
      price: 500000,
      version: 1,
      texts: {
        title: "Neues Zuhause in Schulzendorf",
        description: "Objektbeschreibung",
        equipment: "Ausstattung",
        location: "Lage",
        other: "Sonstiges",
      },
    }],
    houses: [{
      id: "house-1",
      name: "Testhaus",
      houseType: "Einfamilienhaus",
      livingArea: 150,
      rooms: 5,
      bedrooms: 3,
      bathrooms: 2,
      floors: 2,
      housePrice: 400000,
      constructionYear: 2027,
      energyDemand: 18,
      energyClass: "A+",
      heatingType: "Wärmepumpe",
      energySource: "Strom",
      architecture: "",
      equipmentHighlights: "",
      useStandardPackage: true,
      images: [{
        id: "house-image-1",
        name: "haus.jpg",
        mimeType: "image/jpeg",
        dataUrl: "data:image/jpeg;base64,aGF1cw==",
        caption: "Eigenes Hausbild",
        isFloorplan: false,
      }],
    }],
    provider: {
      providerNumber: "30435",
      company: "Fabian Raebel - Freie Handelsvertretung der Living Fertighaus GmbH",
      firstName: "Fabian",
      lastName: "Raebel",
      email: "test@example.com",
      phone: "0000",
    },
    promotionImage: {
      id: "promotion-image-1",
      name: "aktion.jpg",
      mimeType: "image/jpeg",
      dataUrl: "data:image/jpeg;base64,YWt0aW9u",
      caption: "Aktuelles Angebot für dein neues Zuhause",
      isFloorplan: false,
    },
    promotionImageEnabled: true,
  };
  const xml = buildOpenImmoXml(input);

  assert.match(xml, /<openimmo_obid>FPI-TEST-1<\/openimmo_obid>/);
  assert.match(xml, /<aktion aktionart="CHANGE" timestamp="[^"]+" \/>/);
  assert.ok(xml.indexOf("Aktuelles Angebot für dein neues Zuhause") < xml.indexOf("Eigenes Hausbild"));

  const assignedInput = {
    ...input,
    listings: [{
      ...input.listings[0],
      promotionImageId: "promotion-image-2",
    }],
    houses: [{
      ...input.houses[0],
      images: Array.from({ length: 14 }, (_, index) => ({
        ...input.houses[0].images[0],
        id: `house-image-${index + 1}`,
        name: `haus-${index + 1}.jpg`,
        caption: `Normales Hausbild ${index + 1}`,
      })),
    }],
    promotionImages: [{
      ...input.promotionImage,
      id: "promotion-image-2",
      caption: "Zufällig zugeordnetes Aktionsbild",
    }],
    promotionImage: null,
    promotionImageEnabled: false,
  };
  const assignedXml = buildOpenImmoXml(assignedInput);
  assert.equal((assignedXml.match(/<anhang location=/g) ?? []).length, 14);
  assert.ok(assignedXml.indexOf("Zufällig zugeordnetes Aktionsbild") < assignedXml.indexOf("Normales Hausbild 1"));
  assert.match(assignedXml, /Normales Hausbild 13/);
  assert.doesNotMatch(assignedXml, /Normales Hausbild 14/);

  const packageResult = await buildImportPackage(input);
  assert.match(packageResult.filename, /testprojekt-testhaus-fpi-test-1-\d{4}-\d{2}-\d{2}\.zip/);
});
