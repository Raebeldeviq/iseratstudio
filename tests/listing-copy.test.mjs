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
  FIXED_DESCRIPTION_FINANCING,
  FIXED_EQUIPMENT_TEXT,
  PREVIOUS_FIXED_EQUIPMENT_TEXT,
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

test("builds a factual, varied headline with place and house data", () => {
  const title = buildListingHeadline(house, project);
  assert.match(title, /Roskow/u);
  assert.match(title, /113 m²/u);
  assert.match(title, /5 Zimmer/u);
  assert.doesNotMatch(title, /113[,.]\d/u);
  assert.doesNotMatch(title, /QNG|DGNB|energieeffizient|nachhaltig/iu);
});

test("selects at most two evidence-backed USPs deterministically", () => {
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
  assert.ok(first.usps.every((usp) => usp.fact?.verified));
  assert.match(first.title, /113 m²/u);
  assert.match(first.title, /5 Zimmer/u);
  assert.equal(new Set(first.usps.map((usp) => usp.id)).size, first.usps.length);
  assert.doesNotMatch(first.title, /QNG-Siegel garantiert|\bV\d+\b|€|Kaufpreis/iu);
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

test("keeps normal headline candidates within the maximum without truncating claims", () => {
  const packageHouse = { ...house, technicalPackage: LIVING_HAUS_IKON_TECHNICAL_PACKAGE_ID };
  const longProject = { city: "Brandenburg an der Havel", district: "Neustadt" };
  const plan = planListingHeadline(packageHouse, longProject, {
    houseSeries: LIVING_HAUS_SERIES_ID,
    titleSeed: "long-title",
  });
  assert.equal(plan.withinLengthLimit, true);
  assert.ok(plan.length <= plan.maxLength);
  assert.ok(plan.usps.length <= 2);
  assert.equal(plan.title.endsWith("…"), false);
  assert.match(plan.title, /113 m²/u);
  assert.match(plan.title, /5 Zimmer/u);
  assert.ok(plan.usps.every((usp) => plan.title.includes(usp.label)
    || plan.title.includes({
      fixed_price_guarantee: "18 Monaten Festpreisgarantie",
      building_insurance: "Bauversicherungen",
      bau_cockpit: "Bau-Cockpit-App",
      structural_guarantee: "30 Jahren Garantie auf die tragende Holzkonstruktion",
      dgnb_series_certification: "DGNB-Serienzertifizierung",
      ikon_technical_package: "I-KON-Technikpaket",
    }[usp.id])));
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
  assert.equal(generated.description.split(FIXED_DESCRIPTION_FINANCING).length - 1, 1);
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

test("replaces only the exact previous system equipment master at read time", () => {
  const previous = initializeListingStaticCopy({ texts: { equipment: PREVIOUS_FIXED_EQUIPMENT_TEXT } });
  assert.equal(resolveListingStaticCopy(previous).values.equipment, FIXED_EQUIPMENT_TEXT);
  assert.equal(previous.texts.equipment, PREVIOUS_FIXED_EQUIPMENT_TEXT);
  previous.staticCopySources.equipment = STATIC_COPY_SOURCE.MANUAL;
  assert.equal(resolveListingStaticCopy(previous).values.equipment, PREVIOUS_FIXED_EQUIPMENT_TEXT);
});

test("keeps QNG guarantees out of newly generated titles and descriptions", () => {
  const generated = enforceListingCopy({
    description: "Sachliche Beschreibung des projektierten Hauses.",
  }, {
    house,
    project,
    generated: true,
    houseSeries: LIVING_HAUS_SERIES_ID,
  });
  assert.doesNotMatch(generated.title, new RegExp(`${QNG_GUARANTEE_TITLE}`, "u"));
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
  const location = cleanSalesLocationText("Potsdam verbindet Natur und Alltag. Die Bebaubarkeit wird im weiteren Planungsverlauf geprüft. Konkrete Aussagen zu Versorgung werden ausschließlich aus geprüften Ortsinformationen ergänzt. Das Grundstück befindet sich in Potsdam. Schulen und Einkaufsmöglichkeiten sind nach geprüfter Angabe erreichbar.");
  assert.equal(location, "Potsdam verbindet Natur und Alltag. Schulen und Einkaufsmöglichkeiten sind nach geprüfter Angabe erreichbar.");
  assert.doesNotMatch(location, /Bebaubarkeit|Planungsverlauf|Konkrete Aussagen|Grundstück befindet/u);
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
    kfw55: false,
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
  assert.equal(FIXED_RECOMMENDATION_TEXT, `Gemeinsam mit unserem strategischen Partner HEUN-Finanz bieten wir Ihnen attraktive Finanzierungsmöglichkeiten – einschließlich der Beantragung sämtlicher für Ihr Bauvorhaben infrage kommender Fördermittel.
Die Hausabbildungen und Bilder der Innenausstattung können Sonderausstattungen zeigen, die nicht im angegebenen Kaufpreis enthalten sind.
Eine gute Beratung ist die Grundlage für alles. Deshalb analysieren wir gemeinsam mit Ihnen Ihre Vorstellungen, Wünsche und Bedürfnisse und finden das passende Living Haus für Sie und Ihre Familie.
Interesse geweckt? Kontaktieren Sie mich noch heute und vereinbaren Sie ein kostenloses und unverbindliches Beratungsgespräch.`);
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
    kfw55: false,
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
    kfw55: false,
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
