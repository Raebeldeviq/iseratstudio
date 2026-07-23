import assert from "node:assert/strict";
import test from "node:test";

import { buildImportPackage, buildOpenImmoXml, validateImportPackage } from "../app/lib/openimmo.ts";
import {
  FIXED_ANNOTATION_TEXT,
  FIXED_EQUIPMENT_TEXT,
  FIXED_OTHER_TEXT,
  FIXED_PROVISION_TEXT,
  FIXED_RECOMMENDATION_TEXT,
  FIXED_TERMS_TEXT,
} from "../listing-copy.mjs";

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
      images: Array.from({ length: 4 }, (_, index) => ({
        id: `image-${index + 1}`,
        name: `bild-${index + 1}.jpg`,
        mimeType: "image/jpeg",
        dataUrl: "data:image/jpeg;base64,/9j/2Q==",
        caption: `Bild ${index + 1}`,
        isFloorplan: false,
      })),
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

  assert.match(xml, /senderversion="0\.9\.4"/);
  assert.match(xml, /<openimmo_obid>FPI-TEST-1<\/openimmo_obid>/);
  assert.match(xml, /<aktion aktionart="CHANGE" timestamp="[^"]+" \/>/);
  assert.match(xml, /<bad dusche="true" wanne="true" fenster="true" \/>/);
  assert.match(xml, /<kueche ebk="true" offen="true" \/>/);
  assert.match(xml, /<heizungsart fussboden="true" \/>/);
  assert.match(xml, /<befeuerung elektro="true" luftwp="true" \/>/);
  assert.match(xml, /<gartennutzung>true<\/gartennutzung>/);
  assert.match(xml, /<energietyp kfw40="true" kfw55="true" \/>/);
  assert.match(xml, /<dachboden>true<\/dachboden>/);
  assert.match(xml, /<gaestewc>true<\/gaestewc>/);
  assert.match(xml, /<wertklasse>A\+\+<\/wertklasse>/);
  assert.match(xml, /<provisionspflichtig>true<\/provisionspflichtig>/);
  assert.ok(xml.includes(FIXED_PROVISION_TEXT));
  assert.ok(xml.includes(FIXED_EQUIPMENT_TEXT));
  assert.ok(xml.includes(FIXED_OTHER_TEXT));
  assert.ok(xml.includes(FIXED_ANNOTATION_TEXT));
  assert.ok(xml.includes(FIXED_TERMS_TEXT));
  assert.ok(xml.includes(FIXED_RECOMMENDATION_TEXT));
  assert.ok(xml.indexOf("<kaufpreis>") < xml.indexOf("<provisionspflichtig>"));
  assert.ok(xml.indexOf("<courtage_hinweis>") < xml.indexOf("<waehrung "));
  assert.ok(xml.indexOf("<bad ") < xml.indexOf("<kueche "));
  assert.ok(xml.indexOf("<gartennutzung>") < xml.indexOf("<energietyp "));
  assert.ok(xml.indexOf("Aktuelles Angebot für dein neues Zuhause") < xml.indexOf("Bild 1"));
  const packageResult = await buildImportPackage(input);
  assert.match(packageResult.filename, /testprojekt-testhaus-fpi-test-1-\d{4}-\d{2}-\d{2}\.zip/);
  assert.deepEqual(validateImportPackage(input), []);
});

test("rejects malformed project and unsupported image data before packaging", () => {
  const errors = validateImportPackage({
    project: { street: "", zip: "123", city: "", plotArea: 0 },
    listings: [],
    houses: [],
    provider: { providerNumber: "", company: "", email: "invalid" },
  });
  assert.ok(errors.length >= 7);
  assert.match(errors.join(" "), /Postleitzahl|Grundstücksfläche|Anbieter-E-Mail/);
});

test("exports the fixed role sequence and keeps the action image in front", () => {
  const roleImages = [
    ["qr", "Jetzt Starten!"],
    ["trust", "Bestens Beraten"],
    ["awards", "Ausgezeichnet gebaut"],
    ["floorplan_upper", "Dein Dachgeschoss"],
    ["floorplan_ground", "Dein Erdgeschoss"],
    ["emotion", "Hier beginnt dein Zuhause"],
    ["office", "Work-Life Balance"],
    ["living", "Setz dich und Ruh dich aus"],
    ["kids", "Der Entwicklungsraum"],
    ["bedroom", "Deine Ruhezone"],
    ["bathroom", "Dein Spa"],
    ["kitchen", "Deine 5* Küche"],
    ["cover", "Dein schönes Zuhause"],
  ].map(([role, caption], index) => ({
    id: `role-${index}`,
    name: `${role}.jpg`,
    mimeType: "image/jpeg",
    dataUrl: "data:image/jpeg;base64,/9j/2Q==",
    caption,
    isFloorplan: role.startsWith("floorplan"),
    role,
  }));
  const input = {
    project: {
      street: "Teststraße",
      zip: "15732",
      city: "Schulzendorf",
      plotArea: 600,
      name: "Testprojekt",
    },
    listings: [{
      id: "listing-role-order",
      externalId: "FPI-ROLE-ORDER",
      templateId: "house-role-order",
      templateName: "SUN 130 V2",
      price: 500000,
      texts: {
        title: "Sicher ankommen und zuhause fühlen",
        description: "Objektbeschreibung",
        equipment: "Ausstattung",
        location: "Lage",
        other: "Sonstiges",
      },
    }],
    houses: [{
      id: "house-role-order",
      name: "SUN 130 V2",
      houseType: "Einfamilienhaus",
      livingArea: 130,
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
      images: roleImages,
    }],
    provider: {
      providerNumber: "30435",
      company: "Testanbieter",
      firstName: "Fabian",
      lastName: "Raebel",
      email: "test@example.com",
      phone: "0000",
    },
    promotionImage: {
      id: "promotion-role-order",
      name: "aktion.jpg",
      mimeType: "image/jpeg",
      dataUrl: "data:image/jpeg;base64,YWt0aW9u",
      caption: "Aktionsangebot",
      isFloorplan: false,
      role: "promotion",
    },
    promotionImageEnabled: true,
  };

  assert.deepEqual(validateImportPackage(input), []);
  const xml = buildOpenImmoXml(input);
  const captions = [
    "Aktionsangebot",
    "Dein schönes Zuhause",
    "Work-Life Balance",
    "Setz dich und Ruh dich aus",
    "Der Entwicklungsraum",
    "Deine Ruhezone",
    "Dein Spa",
    "Deine 5* Küche",
    "Hier beginnt dein Zuhause",
    "Dein Erdgeschoss",
    "Dein Dachgeschoss",
    "Ausgezeichnet gebaut",
    "Bestens Beraten",
    "Jetzt Starten!",
  ];
  for (let index = 1; index < captions.length; index += 1) {
    assert.ok(
      xml.indexOf(captions[index - 1]) < xml.indexOf(captions[index]),
      `${captions[index - 1]} muss vor ${captions[index]} stehen`,
    );
  }
});
