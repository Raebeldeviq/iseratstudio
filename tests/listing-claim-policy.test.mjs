import assert from "node:assert/strict";
import test from "node:test";

import {
  CLAIM_CATEGORY,
  FACT_EVIDENCE_KIND,
  FACT_SCOPE,
  FACT_SOURCE,
  FACT_STATUS,
  LIVING_HAUS_SERIES_ID,
  releasedListingFacts,
  releasedTechnicalFacts,
  seriesFactSentences,
  technicalFactSentences,
  validateListingClaims,
} from "../listing-claim-policy.mjs";
import { FIXED_DESCRIPTION_CTA, FIXED_OTHER_TEXT } from "../listing-copy.mjs";
import { completeListingTexts, generateListingTexts } from "../app/lib/text-generator.ts";

const technicalFact = (key, value, overrides = {}) => ({
  key,
  value,
  source: "Individuelle Bau- und Leistungsbeschreibung",
  scope: FACT_SCOPE.TECHNICAL_SYSTEM,
  status: FACT_STATUS.VERIFIED,
  verified: true,
  evidenceReference: "BLS-2026-001",
  ...overrides,
});

const issueCategories = (text, facts = []) => validateListingClaims({
  texts: { description: text },
  listingFacts: facts,
}).blockingIssues.map((issue) => issue.category);

test("blocks every required general, performance and climate claim with a structured BLOCK finding", () => {
  const cases = [
    ["Nachhaltiges Familienhaus", CLAIM_CATEGORY.GENERIC_ENVIRONMENTAL_CLAIM],
    ["Besonders energieeffizientes Eigenheim", CLAIM_CATEGORY.GENERIC_ENVIRONMENTAL_CLAIM],
    ["Klimafreundliches Haus", CLAIM_CATEGORY.GENERIC_ENVIRONMENTAL_CLAIM],
    ["Umweltfreundlich bauen", CLAIM_CATEGORY.GENERIC_ENVIRONMENTAL_CLAIM],
    ["Dauerhaft niedrige Energiekosten", CLAIM_CATEGORY.UNVERIFIED_PERFORMANCE_OR_COST_CLAIM],
    ["Geprüfte Nachhaltigkeit", CLAIM_CATEGORY.GENERIC_ENVIRONMENTAL_CLAIM],
    ["Ideal gedämmte Gebäudehülle", CLAIM_CATEGORY.UNVERIFIED_PERFORMANCE_OR_COST_CLAIM],
    ["Klimaneutrales Haus", CLAIM_CATEGORY.GHG_OR_OFFSET_CLAIM],
    ["CO₂-neutrales Eigenheim", CLAIM_CATEGORY.GHG_OR_OFFSET_CLAIM],
  ];

  for (const [input, expectedCategory] of cases) {
    const result = validateListingClaims({ texts: { description: input } });
    assert.equal(result.ok, false, input);
    assert.ok(result.blockingIssues.some((issue) => issue.category === expectedCategory), input);
    assert.ok(result.blockingIssues.every((issue) => issue.severity === "BLOCK"), input);
    assert.equal(typeof result.blockingIssues[0].field, "string");
    assert.equal(typeof result.blockingIssues[0].excerpt, "string");
    assert.equal(typeof result.blockingIssues[0].position, "number");
    assert.equal(typeof result.blockingIssues[0].reason, "string");
    assert.equal(typeof result.blockingIssues[0].evidence, "string");
  }
});

test("blocks a whole-house environmental claim even when only a lower-scope PV fact exists", () => {
  const facts = [technicalFact("photovoltaic", "Photovoltaikanlage", { scope: FACT_SCOPE.COMPONENT })];
  const categories = issueCategories("Die PV-Anlage macht dieses Haus zu einem nachhaltigen Eigenheim.", facts);
  assert.ok(categories.includes(CLAIM_CATEGORY.GENERIC_ENVIRONMENTAL_CLAIM));
  assert.ok(categories.includes(CLAIM_CATEGORY.ENVIRONMENTAL_SCOPE_OVERCLAIM));
});

test("does not derive energy efficiency from a documented heat pump", () => {
  const facts = [technicalFact("heat_pump", "Luft-Wasser-Wärmepumpe")];
  const categories = issueCategories("Die Wärmepumpe macht das Haus energieeffizient.", facts);
  assert.ok(categories.includes(CLAIM_CATEGORY.GENERIC_ENVIRONMENTAL_CLAIM));
  assert.ok(categories.includes(CLAIM_CATEGORY.ENVIRONMENTAL_SCOPE_OVERCLAIM));
});

test("allows a concrete technical statement only with matching structured evidence", () => {
  const statement = "Die Wärmeversorgung erfolgt über eine Luft-Wasser-Wärmepumpe.";
  const missingEvidence = validateListingClaims({ texts: { equipment: statement } });
  assert.ok(missingEvidence.blockingIssues.some((issue) => issue.category === CLAIM_CATEGORY.UNVERIFIED_TECHNICAL_CLAIM));

  const documented = validateListingClaims({
    texts: { equipment: statement },
    listingFacts: [technicalFact("heat_pump", "Luft-Wasser-Wärmepumpe")],
  });
  assert.equal(documented.ok, true);
});

test("keeps planned and optional statuses linguistically bounded", () => {
  const plannedFact = technicalFact("heat_pump", "Luft-Wasser-Wärmepumpe", { status: FACT_STATUS.PLANNED });
  assert.equal(validateListingClaims({
    texts: { equipment: "In der derzeitigen Planung ist eine Luft-Wasser-Wärmepumpe vorgesehen." },
    listingFacts: [plannedFact],
  }).ok, true);
  assert.ok(issueCategories("Eine Luft-Wasser-Wärmepumpe ist Bestandteil der Ausstattung.", [plannedFact])
    .includes(CLAIM_CATEGORY.UNVERIFIED_TECHNICAL_CLAIM));

  const optionalFact = technicalFact("photovoltaic", "Photovoltaikanlage", { status: FACT_STATUS.OPTIONAL });
  assert.ok(issueCategories("Eine Photovoltaikanlage ist Bestandteil des Leistungsumfangs.", [optionalFact])
    .includes(CLAIM_CATEGORY.UNVERIFIED_TECHNICAL_CLAIM));
});

test("releases only the fixed projected energy demand, never legacy defaults", () => {
  const houseWithLegacyDefaults = {
    energyDemand: 18,
    energyClass: "A++",
    heatingType: "Fußbodenheizung mit Luft-Wasser-Wärmepumpe",
    energySource: "Umweltwärme und Strom",
  };
  const released = releasedTechnicalFacts({ house: houseWithLegacyDefaults });
  assert.equal(released.length, 1);
  assert.equal(released[0].key, "energy_demand");
  assert.equal(released[0].sourceKind, FACT_SOURCE.HOUSE_TEMPLATE);
  assert.equal(released[0].status, FACT_STATUS.PLANNED);
  assert.equal(released[0].evidenceKind, FACT_EVIDENCE_KIND.PROJECTED_HOUSE_VALUE);
  assert.deepEqual(technicalFactSentences({ house: houseWithLegacyDefaults }), [
    "Für die derzeitige Planung ist ein Endenergiebedarf von 18 kWh/(m²·a) vorgesehen.",
  ]);
  assert.ok(issueCategories("Die Energieeffizienzklasse A++ ist vorgesehen.")
    .includes(CLAIM_CATEGORY.UNVERIFIED_TECHNICAL_CLAIM));
  assert.ok(issueCategories("Das Haus erfüllt KfW 40.")
    .includes(CLAIM_CATEGORY.UNVERIFIED_TECHNICAL_CLAIM));
});

test("inherits verified Living-Haus series facts only for the matching house series", () => {
  const context = { houseSeries: LIVING_HAUS_SERIES_ID };
  const released = releasedListingFacts(context);
  assert.ok(released.some((fact) => fact.key === "certification" && fact.sourceKind === FACT_SOURCE.VERIFIED_SERIES));
  assert.ok(released.some((fact) => fact.key === "sustainability_label" && fact.sourceKind === FACT_SOURCE.VERIFIED_SERIES));
  assert.deepEqual(seriesFactSentences(context), [
    "Das projektierte Haus gehört zu einer Hausserie mit verifizierter DGNB-Serienzertifizierung.",
    "Für die zugehörige Hausserie ist ein verifiziertes QNG-Serienmerkmal hinterlegt.",
  ]);
  assert.equal(validateListingClaims({
    texts: { equipment: "Das projektierte Haus gehört zu einer Hausserie mit verifizierter DGNB-Serienzertifizierung. Für die zugehörige Hausserie ist ein verifiziertes QNG-Serienmerkmal hinterlegt." },
    ...context,
  }).ok, true);
  assert.ok(issueCategories("Dieses Haus trägt DGNB Gold.", [])
    .includes(CLAIM_CATEGORY.UNVERIFIED_CERTIFICATION));
  assert.ok(validateListingClaims({
    texts: { equipment: "Das projektierte Haus gehört zu einer Hausserie mit verifizierter DGNB-Serienzertifizierung." },
    houseSeries: "fremdhersteller",
  }).blockingIssues.some((issue) => issue.category === CLAIM_CATEGORY.UNVERIFIED_CERTIFICATION));
});

test("allows confirmed series technology as a factual project statement", () => {
  const seriesHeatPump = technicalFact("heat_pump", "Luft-Wasser-Wärmepumpe", {
    source: FACT_SOURCE.VERIFIED_SERIES,
    scope: FACT_SCOPE.HOUSE_SERIES,
    status: FACT_STATUS.VERIFIED,
    seriesId: LIVING_HAUS_SERIES_ID,
  });
  const context = { listingFacts: [seriesHeatPump], houseSeries: LIVING_HAUS_SERIES_ID };
  assert.equal(validateListingClaims({
    texts: { equipment: "Die Wärmeversorgung erfolgt über Luft-Wasser-Wärmepumpe." },
    ...context,
  }).ok, true);
  assert.ok(issueCategories("Die Wärmepumpe macht dieses Haus energieeffizient.", [seriesHeatPump])
    .includes(CLAIM_CATEGORY.GENERIC_ENVIRONMENTAL_CLAIM));
});

test("gives an actual energy certificate priority over the projected template value", () => {
  const energyCertificate = technicalFact("energy_demand", "42 kWh/(m²·a)", {
    source: FACT_SOURCE.PROJECT,
    scope: FACT_SCOPE.HOUSE,
    status: FACT_STATUS.VERIFIED,
    evidenceKind: FACT_EVIDENCE_KIND.ENERGY_CERTIFICATE,
    evidenceReference: "Energieausweis EA-2026-17",
  });
  const house = { energyDemand: 18 };
  const facts = releasedTechnicalFacts({ house, listingFacts: [energyCertificate] });
  assert.equal(facts.filter((fact) => fact.key === "energy_demand").length, 1);
  assert.equal(facts.find((fact) => fact.key === "energy_demand")?.value, "42 kWh/(m²·a)");
  assert.deepEqual(technicalFactSentences({ house, listingFacts: [energyCertificate] }), [
    "Der vorliegende Energieausweis weist einen Endenergiebedarf von 42 kWh/(m²·a) aus.",
  ]);
});

test("does not invent an energy value when neither template nor certificate provides one", () => {
  assert.deepEqual(releasedTechnicalFacts({ house: { energyDemand: 0, energyClass: "" } }), []);
  assert.deepEqual(technicalFactSentences({ house: { energyDemand: 0, energyClass: "" } }), []);
});

test("distinguishes a declared house-series certification from a concrete-object certification", () => {
  const seriesFact = technicalFact("certification", "DGNB Gold", {
    source: FACT_SOURCE.VERIFIED_SERIES,
    scope: FACT_SCOPE.HOUSE_SERIES,
    seriesId: LIVING_HAUS_SERIES_ID,
  });
  assert.equal(validateListingClaims({
    texts: { equipment: "Für die Hausserie liegt eine DGNB-Serienzertifizierung in Gold vor." },
    listingFacts: [seriesFact],
    houseSeries: LIVING_HAUS_SERIES_ID,
  }).ok, true);
  assert.ok(validateListingClaims({
    texts: { description: "Dieses Haus trägt DGNB Gold." },
    listingFacts: [seriesFact],
    houseSeries: LIVING_HAUS_SERIES_ID,
  }).blockingIssues.map((issue) => issue.category)
    .includes(CLAIM_CATEGORY.UNVERIFIED_CERTIFICATION));
  assert.ok(issueCategories("QNG-Potenzial für dieses Haus.")
    .includes(CLAIM_CATEGORY.UNVERIFIED_SUSTAINABILITY_LABEL));
});

test("scans captions and CTA texts without silently changing manual input", () => {
  const result = validateListingClaims({
    texts: { title: "Sachlicher Titel" },
    ctaTexts: ["Jetzt klimafreundlich beraten lassen"],
    images: [{ id: "image-1", caption: "Nachhaltiges Wohnen im Grünen" }],
  });
  assert.equal(result.ok, false);
  assert.ok(result.blockingIssues.some((issue) => issue.field.startsWith("CTA")));
  assert.ok(result.blockingIssues.some((issue) => issue.field.startsWith("Bildunterschrift")));
});

test("deterministic generation uses only structured technical facts and otherwise stays claim-safe", () => {
  const house = {
    id: "fact-house",
    name: "Fact House",
    houseType: "Einfamilienhaus",
    livingArea: 150,
    rooms: 5,
    bedrooms: 3,
    bathrooms: 2,
    floors: 2,
    housePrice: 400000,
    constructionYear: 2027,
    energyDemand: 18,
    energyClass: "A++",
    heatingType: "Luft-Wasser-Wärmepumpe",
    energySource: "Strom",
    architecture: "Nachhaltige Architektur",
    equipmentHighlights: "Energieeffiziente Technik",
    useStandardPackage: true,
    images: [],
    listingFacts: [technicalFact("heat_pump", "Luft-Wasser-Wärmepumpe", { status: FACT_STATUS.PLANNED })],
  };
  const project = {
    id: "fact-project", owner: "fabian", name: "Fact", street: "", houseNumber: "", zip: "", city: "Berlin", district: "",
    plotArea: 500, plotPrice: 0, additionalCosts: 0, locationFacts: "", transportFacts: "", familyFacts: "", natureFacts: "", selectedHouseIds: [], listings: [], createdAt: "2026-09-23T00:00:00.000Z",
  };
  const provider = { firstName: "", lastName: "", phone: "", providerNumber: "", company: "", email: "" };
  const generated = generateListingTexts(house, project, provider);
  assert.equal(validateListingClaims({
    texts: generated,
    house,
    project,
    houseSeries: LIVING_HAUS_SERIES_ID,
  }).ok, true);
  assert.match(generated.equipment, /derzeitigen Planung ist eine Luft-Wasser-Wärmepumpe vorgesehen/u);
  assert.match(generated.equipment, /Endenergiebedarf von 18 kWh\/\(m²·a\) vorgesehen/u);
  assert.match(generated.equipment, /DGNB-Serienzertifizierung/u);
  assert.match(generated.equipment, /QNG-Serienmerkmal/u);
  assert.doesNotMatch(generated.description, /nachhaltig|energieeffizient|dgnb|qng/iu);

  const completed = completeListingTexts(house, project, provider, {
    title: "Nachhaltiges Familienhaus",
    description: "Besonders energieeffizientes Eigenheim.",
    equipment: "Ideal gedämmte Gebäudehülle.",
    location: "Sachliche Lage.",
    other: "Dauerhaft niedrige Energiekosten.",
  });
  assert.equal(validateListingClaims({
    texts: completed,
    house,
    project,
    houseSeries: LIVING_HAUS_SERIES_ID,
  }).ok, true);
  assert.ok(completed.description.endsWith(FIXED_DESCRIPTION_CTA));
  assert.match(completed.equipment, /derzeitigen Planung ist eine Luft-Wasser-Wärmepumpe vorgesehen/u);
  assert.match(completed.equipment, /DGNB-Serienzertifizierung/u);
  assert.match(completed.equipment, /QNG-Serienmerkmal/u);
  assert.equal(completed.other, FIXED_OTHER_TEXT);
});

test("documents technical facts in neutral sentences without an environmental inference", () => {
  const sentences = technicalFactSentences({
    listingFacts: [technicalFact("photovoltaic", "Photovoltaikanlage")],
  });
  assert.deepEqual(sentences, ["Eine Photovoltaikanlage ist Bestandteil des Leistungsumfangs."]);
  assert.equal(validateListingClaims({
    texts: { equipment: sentences.join(" ") },
    listingFacts: [technicalFact("photovoltaic", "Photovoltaikanlage")],
  }).ok, true);
});
