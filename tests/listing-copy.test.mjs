import assert from "node:assert/strict";
import test from "node:test";

import {
  buildListingHeadline,
  enforceListingCopy,
  fillMissingListingCopy,
  fillMissingProjectingDefaults,
  FIXED_ANNOTATION_TEXT,
  FIXED_DESCRIPTION_CTA,
  FIXED_EQUIPMENT_TEXT,
  FIXED_OTHER_TEXT,
  FIXED_PROVISION_TEXT,
  FIXED_RECOMMENDATION_TEXT,
  FIXED_TERMS_TEXT,
  IMMOPROFESSIONAL_DEFAULTS,
} from "../listing-copy.mjs";

const house = { id: "sun-113-v6", name: "SUN 113 V6", livingArea: 113.49, rooms: 5 };
const project = { city: "Potsdam", district: "Roskow" };

test("builds a benefit headline with district, rounded area and room count", () => {
  const title = buildListingHeadline(house, project);
  assert.match(title, /^Dein .+ in Roskow:/);
  assert.match(title, /113 m², 5 Zimmer,/);
  assert.match(title, /!$/);
  assert.doesNotMatch(title, /113[,.]\d/u);
});

test("enforces every prescribed listing block and keeps the CTA exactly once", () => {
  const result = enforceListingCopy({
    title: "Alter Titel",
    description: `Ein emotionaler und individueller Hausabsatz.\n\n${FIXED_DESCRIPTION_CTA}`,
    equipment: "Alter Ausstattungstext",
    location: "Roskow bietet ein ruhiges Wohnumfeld.",
    other: "Alter Sonstiges-Text",
  }, { house, project });

  assert.equal(result.title, buildListingHeadline(house, project));
  assert.equal(result.equipment, FIXED_EQUIPMENT_TEXT);
  assert.equal(result.other, FIXED_OTHER_TEXT);
  assert.equal(result.location, "Roskow bietet ein ruhiges Wohnumfeld.");
  assert.ok(result.description.endsWith(FIXED_DESCRIPTION_CTA));
  assert.equal(result.description.split(FIXED_DESCRIPTION_CTA).length - 1, 1);
});

test("fills empty existing text fields without overwriting usable dynamic copy", () => {
  const result = fillMissingListingCopy({
    title: "",
    description: "Vorhandene individuelle Objektbeschreibung.",
    equipment: "",
    location: "",
    other: "",
  }, {
    description: "Lokale Ersatzbeschreibung.",
    location: "Roskow bietet den Rahmen für das geplante Zuhause.",
  }, { house, project });

  assert.match(result.description, /^Vorhandene individuelle Objektbeschreibung\./);
  assert.ok(result.description.endsWith(FIXED_DESCRIPTION_CTA));
  assert.equal(result.location, "Roskow bietet den Rahmen für das geplante Zuhause.");
  assert.equal(result.equipment, FIXED_EQUIPMENT_TEXT);
  assert.equal(result.other, FIXED_OTHER_TEXT);
});

test("keeps the immoprofessional defaults and legal copy explicit", () => {
  assert.deepEqual(IMMOPROFESSIONAL_DEFAULTS, {
    equipmentQuality: "GEHOBEN",
    constructionPhase: "PROJEKTIERT",
    attic: true,
    guestWc: true,
    gardenUse: true,
    underfloorHeating: true,
    electricFuel: true,
    airSourceHeatPump: true,
    kfw40: true,
    kfw55: true,
    energyClass: "A++",
    commissionRequired: false,
    energyCertificateClass: "A+",
    fittedKitchen: true,
    openKitchen: true,
    shower: true,
    bathtub: true,
    bathroomWindow: true,
  });
  assert.equal(FIXED_PROVISION_TEXT, "Das Grundstück wird über einen Drittanbieter provisionspflichtig verkauft.");
  assert.match(FIXED_ANNOTATION_TEXT, /Informationenbezüglich des Grundstückes/);
  assert.match(FIXED_TERMS_TEXT, /Kenntnis und Ihr Einverständnis/);
  assert.match(FIXED_RECOMMENDATION_TEXT, /HEUN-Finanz/);
});

test("fills only missing projecting defaults and preserves explicit user values", () => {
  assert.deepEqual(fillMissingProjectingDefaults({
    equipmentQuality: "keine Angabe",
    constructionPhase: "",
    underfloorHeating: false,
    airSourceHeatPump: false,
    kfw40: false,
    kfw55: true,
    energyClass: "B",
    commissionRequired: true,
    energyCertificateClass: "C",
  }), {
    equipmentQuality: "GEHOBEN",
    constructionPhase: "PROJEKTIERT",
    underfloorHeating: false,
    airSourceHeatPump: false,
    kfw40: false,
    kfw55: true,
    energyClass: "B",
    commissionRequired: true,
    energyCertificateClass: "C",
  });

  assert.deepEqual(fillMissingProjectingDefaults(), {
    equipmentQuality: "GEHOBEN",
    constructionPhase: "PROJEKTIERT",
    underfloorHeating: true,
    airSourceHeatPump: true,
    kfw40: true,
    kfw55: true,
    energyClass: "A++",
    commissionRequired: false,
    energyCertificateClass: "A+",
  });
});
