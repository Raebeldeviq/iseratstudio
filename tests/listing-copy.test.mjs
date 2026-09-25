import assert from "node:assert/strict";
import test from "node:test";

import {
  buildListingHeadline,
  cleanSalesLocationText,
  enforceListingCopy,
  fillMissingListingCopy,
  fillMissingProjectingDefaults,
  projectingEnvironmentLabels,
  FIXED_ANNOTATION_TEXT,
  FIXED_DESCRIPTION_CTA,
  FIXED_EQUIPMENT_TEXT,
  FIXED_OTHER_TEXT,
  FIXED_PROVISION_TEXT,
  FIXED_RECOMMENDATION_TEXT,
  FIXED_TERMS_TEXT,
  FACTUAL_BUILDABILITY_NOTE,
  IMMOPROFESSIONAL_DEFAULTS,
} from "../listing-copy.mjs";
import {
  LIVING_HAUS_SERIES_ID,
  QNG_GUARANTEE_SENTENCE,
  QNG_GUARANTEE_TITLE,
} from "../listing-claim-policy.mjs";

const house = { id: "sun-113-v6", name: "SUN 113 V6", livingArea: 113.49, rooms: 5 };
const project = { city: "Potsdam", district: "Roskow" };

test("builds a factual headline with district, rounded area and room count", () => {
  const title = buildListingHeadline(house, project);
  assert.match(title, /in Roskow:/);
  assert.match(title, /113 m² Wohnfläche und 5 Zimmer$/);
  assert.doesNotMatch(title, /113[,.]\d/u);
  assert.doesNotMatch(title, /QNG|DGNB|energieeffizient|nachhaltig/iu);
});

test("preserves manual free text and enforces safe blocks only for generated copy", () => {
  const manual = enforceListingCopy({
    title: "Alter Titel",
    description: `Ein emotionaler und individueller Hausabsatz.\n\n${FIXED_DESCRIPTION_CTA}`,
    equipment: "Alter Ausstattungstext",
    location: "Roskow bietet ein ruhiges Wohnumfeld.",
    other: "Alter Sonstiges-Text",
  }, { house, project });

  assert.equal(manual.title, "Alter Titel");
  assert.equal(manual.equipment, "Alter Ausstattungstext");
  assert.equal(manual.other, "Alter Sonstiges-Text");
  assert.equal(manual.location, "Roskow bietet ein ruhiges Wohnumfeld.");

  const generated = enforceListingCopy(manual, { house, project, generated: true });
  assert.equal(generated.title, buildListingHeadline(house, project));
  assert.equal(generated.equipment, FIXED_EQUIPMENT_TEXT);
  assert.equal(generated.other, FIXED_OTHER_TEXT);
  assert.ok(generated.description.endsWith(FIXED_DESCRIPTION_CTA));
  assert.equal(generated.description.split(FIXED_DESCRIPTION_CTA).length - 1, 1);
});

test("adds the central QNG guarantee only for generated Living-Haus copy", () => {
  const generated = enforceListingCopy({
    description: "Sachliche Beschreibung des projektierten Hauses.",
  }, {
    house,
    project,
    generated: true,
    houseSeries: LIVING_HAUS_SERIES_ID,
  });
  assert.match(generated.title, new RegExp(`${QNG_GUARANTEE_TITLE}$`, "u"));
  assert.equal(generated.description.split(QNG_GUARANTEE_SENTENCE).length - 1, 1);
  assert.ok(generated.description.endsWith(FIXED_DESCRIPTION_CTA));

  const foreignSeries = enforceListingCopy({
    description: "Sachliche Beschreibung des projektierten Hauses.",
  }, {
    house,
    project,
    generated: true,
    houseSeries: "fremdhersteller",
  });
  assert.doesNotMatch(foreignSeries.title, /QNG/u);
  assert.doesNotMatch(foreignSeries.description, /QNG/u);
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
  }, { house, project, generated: true });

  assert.match(result.description, /^Vorhandene individuelle Objektbeschreibung\./);
  assert.ok(result.description.endsWith(FIXED_DESCRIPTION_CTA));
  assert.equal(result.location, "Roskow bietet den Rahmen für das geplante Zuhause.");
  assert.equal(result.equipment, FIXED_EQUIPMENT_TEXT);
  assert.equal(result.other, FIXED_OTHER_TEXT);
});

test("keeps planning language out of the sales location and exposes the separate factual note", () => {
  const location = cleanSalesLocationText("Potsdam verbindet Natur und Alltag. Die Bebaubarkeit wird im weiteren Planungsverlauf geprüft. Schulen und Einkaufsmöglichkeiten sind nach geprüfter Angabe erreichbar.");
  assert.equal(location, "Potsdam verbindet Natur und Alltag. Schulen und Einkaufsmöglichkeiten sind nach geprüfter Angabe erreichbar.");
  assert.doesNotMatch(location, /Bebaubarkeit|Planungsverlauf/u);
  assert.match(FACTUAL_BUILDABILITY_NOTE, /öffentlich-rechtlichen Vorgaben geprüft und abgestimmt/u);
});

test("keeps the immoprofessional defaults and legal copy explicit", () => {
  assert.deepEqual(IMMOPROFESSIONAL_DEFAULTS, {
    equipmentQuality: "GEHOBEN",
    constructionPhase: "PROJEKTIERT",
    attic: true,
    guestWc: true,
    gardenUse: true,
    underfloorHeating: false,
    electricFuel: false,
    airSourceHeatPump: false,
    kfw40: false,
    kfw55: false,
    energyClass: "",
    commissionRequired: false,
    energyCertificateClass: "",
    fittedKitchen: true,
    openKitchen: true,
    shower: true,
    bathtub: true,
    bathroomWindow: true,
    environmentBus: true,
    environmentShopping: true,
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
    fittedKitchen: false,
    bathroomWindow: false,
    environmentBus: false,
  }), {
    equipmentQuality: "GEHOBEN",
    constructionPhase: "PROJEKTIERT",
    attic: true,
    guestWc: true,
    gardenUse: true,
    underfloorHeating: false,
    electricFuel: false,
    airSourceHeatPump: false,
    kfw40: false,
    kfw55: true,
    energyClass: "B",
    commissionRequired: true,
    energyCertificateClass: "C",
    fittedKitchen: false,
    bathroomWindow: false,
    environmentBus: false,
    openKitchen: true,
    shower: true,
    bathtub: true,
    environmentShopping: true,
  });

  assert.deepEqual(fillMissingProjectingDefaults(), {
    equipmentQuality: "GEHOBEN",
    constructionPhase: "PROJEKTIERT",
    attic: true,
    guestWc: true,
    gardenUse: true,
    underfloorHeating: false,
    electricFuel: false,
    airSourceHeatPump: false,
    kfw40: false,
    kfw55: false,
    energyClass: "",
    commissionRequired: false,
    energyCertificateClass: "",
    fittedKitchen: true,
    openKitchen: true,
    shower: true,
    bathtub: true,
    bathroomWindow: true,
    environmentBus: true,
    environmentShopping: true,
  });

  assert.deepEqual(projectingEnvironmentLabels(), ["Bus", "Einkaufsmöglichkeit"]);
  assert.deepEqual(projectingEnvironmentLabels({ environmentBus: false }), ["Einkaufsmöglichkeit"]);
});
