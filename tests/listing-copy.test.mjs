import assert from "node:assert/strict";
import test from "node:test";

import {
  buildListingHeadline,
  cleanSalesLocationText,
  enforceListingCopy,
  fillMissingListingCopy,
  fillMissingProjectingDefaults,
  planListingHeadline,
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
  createStandardStaticCopy,
  createStandardStaticCopySources,
  initializeListingStaticCopy,
  resolveListingStaticCopy,
  STATIC_COPY_SOURCE,
} from "../listing-copy.mjs";
import {
  LIVING_HAUS_SERIES_ID,
  LIVING_HAUS_IKON_TECHNICAL_PACKAGE_ID,
  QNG_GUARANTEE_TITLE,
  validateListingClaims,
} from "../listing-claim-policy.mjs";

const house = { id: "sun-113-v6", name: "SUN 113 V6", livingArea: 113.49, rooms: 5 };
const project = { city: "Potsdam", district: "Roskow" };

test("builds a factual headline with district, rounded area and room count", () => {
  const title = buildListingHeadline(house, project);
  assert.match(title, /in Roskow:/);
  assert.match(title, /113 m², 5 Zimmer$/);
  assert.doesNotMatch(title, /113[,.]\d/u);
  assert.doesNotMatch(title, /QNG|DGNB|energieeffizient|nachhaltig/iu);
});

test("selects two distinct, evidence-backed USPs deterministically without redundant package components", () => {
  const packageHouse = { ...house, technicalPackage: LIVING_HAUS_IKON_TECHNICAL_PACKAGE_ID };
  const first = planListingHeadline(packageHouse, project, {
    houseSeries: LIVING_HAUS_SERIES_ID,
    titleSeed: "stable-listing-1",
  });
  const repeated = planListingHeadline(packageHouse, project, {
    houseSeries: LIVING_HAUS_SERIES_ID,
    titleSeed: "stable-listing-1",
  });
  assert.deepEqual(repeated, first);
  assert.equal(first.usps.length, 2);
  assert.notEqual(first.usps[0].id, first.usps[1].id);
  assert.ok(first.usps.every((usp) => usp.fact?.verified));
  assert.doesNotMatch(first.title, /wärmepumpe/u);
  assert.equal(validateListingClaims({
    texts: { title: first.title },
    house: packageHouse,
    project,
    houseSeries: LIVING_HAUS_SERIES_ID,
  }).ok, true);

  const combinations = new Set(Array.from({ length: 24 }, (_, index) =>
    planListingHeadline(packageHouse, project, {
      houseSeries: LIVING_HAUS_SERIES_ID,
      titleSeed: `stable-listing-${index}`,
    }).usps.map((usp) => usp.id).join("+")));
  assert.ok(combinations.size > 1);
});

test("shortens the opening before dropping the lower-priority USP and never truncates a claim", () => {
  const packageHouse = { ...house, technicalPackage: LIVING_HAUS_IKON_TECHNICAL_PACKAGE_ID };
  const longProject = { city: "SehrlangerWohnort".repeat(8), district: "" };
  const plan = planListingHeadline(packageHouse, longProject, {
    houseSeries: LIVING_HAUS_SERIES_ID,
    titleSeed: "long-title",
  });
  assert.equal(plan.withinLengthLimit, true);
  assert.ok(plan.length <= plan.maxLength);
  assert.equal(plan.usps.length, 1);
  assert.equal(plan.title.endsWith("…"), false);
  assert.ok(plan.title.endsWith(plan.usps[0].label));
});

test("preserves all existing static copy even when dynamic copy is regenerated", () => {
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
  assert.equal(generated.title, "Alter Titel");
  assert.equal(generated.equipment, "Alter Ausstattungstext");
  assert.equal(generated.other, "Alter Sonstiges-Text");
  assert.ok(generated.description.endsWith(FIXED_DESCRIPTION_CTA));
  assert.equal(generated.description.split(FIXED_DESCRIPTION_CTA).length - 1, 1);
});

test("initializes only new static fields and keeps an explicit manual source across read resolution", () => {
  const created = initializeListingStaticCopy({
    texts: { title: "Titel", description: "Beschreibung", equipment: "", location: "Lage", other: "" },
  });
  assert.deepEqual(created.staticCopySources, createStandardStaticCopySources());
  assert.deepEqual(resolveListingStaticCopy(created).values, createStandardStaticCopy());

  const manual = {
    ...created,
    texts: { ...created.texts, equipment: "Individuelle Ausstattung" },
    staticCopySources: { ...created.staticCopySources, equipment: STATIC_COPY_SOURCE.MANUAL },
  };
  assert.equal(resolveListingStaticCopy(manual).values.equipment, "Individuelle Ausstattung");
  assert.equal(resolveListingStaticCopy(manual).sources.equipment, STATIC_COPY_SOURCE.MANUAL);
});

test("keeps the central QNG label in the generated title but out of the marketing description", () => {
  const generated = enforceListingCopy({
    description: "Sachliche Beschreibung des projektierten Hauses.",
  }, {
    house,
    project,
    generated: true,
    houseSeries: LIVING_HAUS_SERIES_ID,
  });
  assert.match(generated.title, new RegExp(`${QNG_GUARANTEE_TITLE}`, "u"));
  assert.match(generated.title, /DGNB-Serienzertifizierung/u);
  assert.doesNotMatch(generated.description, /QNG/u);
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
    constructionYear: 2027,
    constructionPhase: "PROJEKTIERT",
    availableFrom: "2027",
    attic: true,
    guestWc: true,
    gardenUse: true,
    underfloorHeating: false,
    electricFuel: false,
    airSourceHeatPump: true,
    kfw40: true,
    kfw55: true,
    energyClass: "A++",
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
  assert.equal(FIXED_PROVISION_TEXT, "Für den reinen Grundstückskauf fällt eine Provision an. Die Hausplanung/Bauträgerleistung (LivingHaus) ist davon nicht betroffen.");
  assert.match(FIXED_ANNOTATION_TEXT, /Daten des Verkäufers/);
  assert.match(FIXED_TERMS_TEXT, /Kenntnis und Ihr Einverständnis/);
  assert.match(FIXED_RECOMMENDATION_TEXT, /HEUN-Finanz/);
});

test("enforces global portal targets while preserving unrelated explicit values", () => {
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
    constructionYear: 2027,
    constructionPhase: "PROJEKTIERT",
    availableFrom: "2027",
    attic: true,
    guestWc: true,
    gardenUse: true,
    underfloorHeating: false,
    electricFuel: false,
    airSourceHeatPump: true,
    kfw40: true,
    kfw55: true,
    energyClass: "A++",
    commissionRequired: false,
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
    constructionYear: 2027,
    constructionPhase: "PROJEKTIERT",
    availableFrom: "2027",
    attic: true,
    guestWc: true,
    gardenUse: true,
    underfloorHeating: false,
    electricFuel: false,
    airSourceHeatPump: true,
    kfw40: true,
    kfw55: true,
    energyClass: "A++",
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
