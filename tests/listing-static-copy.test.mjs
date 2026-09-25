import assert from "node:assert/strict";
import test from "node:test";

import { buildOpenImmoXml } from "../app/lib/openimmo.ts";
import { cleanupStudioState } from "../data-integrity.mjs";
import {
  createStandardStaticCopy,
  initializeListingStaticCopy,
  isCurrentStaticCopyText,
  resolveListingStaticCopy,
  STATIC_COPY_SOURCE,
} from "../listing-copy.mjs";
import {
  LIVING_HAUS_IKON_TECHNICAL_PACKAGE_ID,
  LIVING_HAUS_SERIES_ID,
  validateListingClaims,
} from "../listing-claim-policy.mjs";

function images() {
  const roles = [
    "cover", "kitchen", "bathroom", "bedroom", "kids", "living", "office", "emotion",
    "floorplan_ground", "floorplan_upper", "awards", "trust", "qr",
  ];
  return roles.map((role, index) => ({
    id: `static-image-${index + 1}`,
    name: `static-${index + 1}.jpg`,
    caption: `Statisches Bild ${index + 1}`,
    mimeType: "image/jpeg",
    dataUrl: "data:image/jpeg;base64,/9j/2Q==",
    isFloorplan: role.startsWith("floorplan"),
    role,
  }));
}

function house() {
  return {
    id: "static-house",
    name: "SUN 151 V8",
    seriesId: LIVING_HAUS_SERIES_ID,
    technicalPackage: LIVING_HAUS_IKON_TECHNICAL_PACKAGE_ID,
    houseType: "Einfamilienhaus",
    livingArea: 152,
    rooms: 5,
    bedrooms: 3,
    bathrooms: 2,
    floors: 2,
    housePrice: 400000,
    constructionYear: 2027,
    energyDemand: 18,
    energyClass: "A++",
    heatingType: "",
    energySource: "",
    architecture: "",
    equipmentHighlights: "",
    useStandardPackage: true,
    images: images(),
  };
}

function project(listing) {
  return {
    id: "static-project",
    name: "Statisches Projekt",
    street: "Musterstraße",
    houseNumber: "1",
    zip: "14542",
    city: "Werder",
    district: "",
    plotArea: 600,
    plotPrice: 100000,
    additionalCosts: 0,
    locationFacts: "",
    transportFacts: "",
    familyFacts: "",
    natureFacts: "",
    selectedHouseIds: ["static-house"],
    listings: [listing],
    createdAt: "2026-09-25T00:00:00.000Z",
  };
}

function newListing() {
  return initializeListingStaticCopy({
    id: "static-listing",
    externalId: "30460-STATIC",
    templateId: "static-house",
    templateName: "SUN 151 V8",
    price: 500000,
    version: 1,
    texts: {
      title: "Sicher wohnen in Werder: 152 m², 5 Zimmer – QNG-Siegel garantiert & I-KON-Technikpaket",
      description: "Sachliche Objektbeschreibung.",
      equipment: "",
      location: "Sachliche Lagebeschreibung.",
      other: "",
    },
  });
}

const provider = {
  providerNumber: "30460",
  company: "Test GmbH",
  firstName: "Max",
  lastName: "Mustermann",
  email: "test@example.invalid",
  phone: "0000",
};

test("the exact equipment master is fact-validated, not globally exempted", () => {
  const listing = newListing();
  const master = resolveListingStaticCopy(listing);
  const valid = validateListingClaims({
    texts: listing.texts,
    staticTexts: listing.staticTexts,
    approvedMasterTextFields: isCurrentStaticCopyText("equipment", master.values.equipment) ? ["equipment"] : [],
    house: house(),
    project: project(listing),
    houseSeries: LIVING_HAUS_SERIES_ID,
  });
  assert.equal(valid.ok, true, JSON.stringify(valid.blockingIssues));

  const noPackage = validateListingClaims({
    texts: listing.texts,
    staticTexts: listing.staticTexts,
    approvedMasterTextFields: ["equipment"],
    house: { ...house(), technicalPackage: "" },
    project: project(listing),
    houseSeries: LIVING_HAUS_SERIES_ID,
  });
  assert.equal(noPackage.ok, false);
  assert.ok(noPackage.blockingIssues.some((issue) => /ikon_technical_package|photovoltaic/u.test(issue.reason)));
});

test("manual static copy survives normalization and OpenImmo exports every separate portal field", () => {
  const listing = newListing();
  listing.texts.equipment = "Manuelle Ausstattung ohne technische Werbeaussage.";
  listing.texts.other = "Manuelles Sonstiges.";
  listing.staticTexts = {
    provision: "Manuelle Provision.",
    annotation: "Manuelle Anmerkung.",
    terms: "Manuelle AGB.",
    recommendation: "Manuelle Empfehlung.",
  };
  listing.staticCopySources = Object.fromEntries(Object.keys(createStandardStaticCopy())
    .map((field) => [field, STATIC_COPY_SOURCE.MANUAL]));

  const state = {
    version: 1,
    houses: [house()],
    projects: [project(listing)],
    provider,
    plots: [],
    uploadHistory: [],
  };
  const restored = cleanupStudioState(structuredClone(state), { apply: true }).state;
  const restoredListing = restored.projects[0].listings[0];
  assert.equal(restoredListing.texts.equipment, listing.texts.equipment);
  assert.deepEqual(restoredListing.staticTexts, listing.staticTexts);
  assert.deepEqual(restoredListing.staticCopySources, listing.staticCopySources);

  const xml = buildOpenImmoXml({
    project: restored.projects[0],
    listings: [restoredListing],
    houses: restored.houses,
    provider,
  });
  assert.match(xml, /<ausstatt_beschr><!\[CDATA\[Manuelle Ausstattung ohne technische Werbeaussage\.\]\]><\/ausstatt_beschr>/u);
  assert.match(xml, /<sonstige_angaben><!\[CDATA\[Manuelles Sonstiges\.\]\]><\/sonstige_angaben>/u);
  assert.match(xml, /<courtage_hinweis><!\[CDATA\[Manuelle Provision\.\]\]><\/courtage_hinweis>/u);
  assert.match(xml, /feldname="Anmerkung"><!\[CDATA\[Manuelle Anmerkung\.\]\]/u);
  assert.match(xml, /feldname="Allgemeine Geschäftsbedingungen"><!\[CDATA\[Manuelle AGB\.\]\]/u);
  assert.match(xml, /feldname="Freier Textblock für Empfehlungen"><!\[CDATA\[Manuelle Empfehlung\.\]\]/u);
  assert.doesNotMatch(xml, /<heizungsart\b/u);
  assert.match(xml, /<befeuerung elektro="false" luftwp="true" \/>/u);
  assert.match(xml, /<energietyp kfw40="true" kfw55="true" \/>/u);
  assert.match(xml, /Projektierte Energieeffizienzklasse"><!\[CDATA\[A\+\+ – Planungswert/u);
  assert.match(xml, /<provisionspflichtig>false<\/provisionspflichtig>/u);
});

test("a manual blocked claim remains stored and prevents export instead of being replaced", () => {
  const listing = newListing();
  listing.texts.equipment = "Dieses nachhaltige Haus spart dauerhaft Energiekosten.";
  listing.staticCopySources = { ...listing.staticCopySources, equipment: STATIC_COPY_SOURCE.MANUAL };

  assert.throws(
    () => buildOpenImmoXml({ project: project(listing), listings: [listing], houses: [house()], provider }),
    (error) => error?.code === "LISTING_CLAIM_VALIDATION_FAILED"
      && /Ausstattung/u.test(error.message),
  );
  assert.equal(listing.texts.equipment, "Dieses nachhaltige Haus spart dauerhaft Energiekosten.");
});
