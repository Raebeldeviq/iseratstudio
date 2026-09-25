import assert from "node:assert/strict";
import test from "node:test";

import {
  CLAIM_CATEGORY,
  FACT_EVIDENCE_KIND,
  FACT_SCOPE,
  FACT_SOURCE,
  FACT_STATUS,
  LIVING_HAUS_SERIES_ID,
  QNG_GUARANTEE_SENTENCE,
  QNG_GUARANTEE_TITLE,
  qngGuaranteeSentence,
  qngGuaranteeTitle,
  releasedListingFacts,
  releasedTitleUsps,
  releasedTechnicalFacts,
  seriesFactSentences,
  technicalFactSentences,
  validateListingClaims,
} from "../listing-claim-policy.mjs";
import { FIXED_DESCRIPTION_CTA, FIXED_EQUIPMENT_TEXT, FIXED_OTHER_TEXT } from "../listing-copy.mjs";
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

const qngGuaranteeFact = (overrides = {}) => ({
  key: "qng_guarantee",
  value: "QNG-Siegel garantiert",
  source: FACT_SOURCE.VERIFIED_SERIES,
  sourceKind: FACT_SOURCE.VERIFIED_SERIES,
  scope: FACT_SCOPE.PROJECT,
  sourceScope: FACT_SCOPE.HOUSE_SERIES,
  projectScope: FACT_SCOPE.PROJECT,
  status: FACT_STATUS.GUARANTEED,
  verified: true,
  seriesId: LIVING_HAUS_SERIES_ID,
  evidenceKind: FACT_EVIDENCE_KIND.QNG_SERIES_GUARANTEE,
  evidenceReference: "Verifizierte Living-Haus-Serienfreigabe: QNG-Garantie für projektierte Häuser",
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

test("inherits verified DGNB and project-scoped QNG guarantee facts only for the matching Living-Haus series", () => {
  const context = { houseSeries: LIVING_HAUS_SERIES_ID };
  const released = releasedListingFacts(context);
  assert.ok(released.some((fact) => fact.key === "certification" && fact.sourceKind === FACT_SOURCE.VERIFIED_SERIES));
  const guarantee = released.find((fact) => fact.key === "qng_guarantee");
  assert.deepEqual({
    sourceKind: guarantee?.sourceKind,
    scope: guarantee?.scope,
    sourceScope: guarantee?.sourceScope,
    projectScope: guarantee?.projectScope,
    status: guarantee?.status,
    evidenceKind: guarantee?.evidenceKind,
  }, {
    sourceKind: FACT_SOURCE.VERIFIED_SERIES,
    scope: FACT_SCOPE.PROJECT,
    sourceScope: FACT_SCOPE.HOUSE_SERIES,
    projectScope: FACT_SCOPE.PROJECT,
    status: FACT_STATUS.GUARANTEED,
    evidenceKind: FACT_EVIDENCE_KIND.QNG_SERIES_GUARANTEE,
  });
  assert.equal(qngGuaranteeSentence(context), QNG_GUARANTEE_SENTENCE);
  assert.equal(qngGuaranteeTitle(context), QNG_GUARANTEE_TITLE);
  assert.deepEqual(seriesFactSentences(context), [
    "Das projektierte Haus gehört zu einer Hausserie mit verifizierter DGNB-Serienzertifizierung.",
  ]);
  assert.equal(validateListingClaims({
    texts: { equipment: "Das projektierte Haus gehört zu einer Hausserie mit verifizierter DGNB-Serienzertifizierung." },
    ...context,
  }).ok, true);
  assert.ok(issueCategories("Dieses Haus trägt DGNB Gold.", [])
    .includes(CLAIM_CATEGORY.UNVERIFIED_CERTIFICATION));
  assert.ok(validateListingClaims({
    texts: { equipment: "Das projektierte Haus gehört zu einer Hausserie mit verifizierter DGNB-Serienzertifizierung." },
    houseSeries: "fremdhersteller",
  }).blockingIssues.some((issue) => issue.category === CLAIM_CATEGORY.UNVERIFIED_CERTIFICATION));
  assert.equal(qngGuaranteeSentence({ houseSeries: "fremdhersteller" }), "");
  assert.equal(qngGuaranteeTitle({ houseSeries: "fremdhersteller" }), "");
});

test("releases compact title USPs only from the matching structured series and package facts", () => {
  const context = {
    houseSeries: LIVING_HAUS_SERIES_ID,
    house: { technicalPackage: "livinghaus-ikon-standard" },
  };
  assert.deepEqual(releasedTitleUsps(context).map((usp) => usp.id), [
    "qng_guarantee",
    "dgnb_series_certification",
    "ikon_technical_package",
  ]);
  assert.equal(validateListingClaims({
    texts: { title: "Endlich ankommen in Potsdam: 153 m², 5 Zimmer – QNG-Siegel garantiert & I-KON-Technikpaket" },
    ...context,
  }).ok, true);
  assert.ok(validateListingClaims({
    texts: { title: "Endlich ankommen in Potsdam: 153 m², 5 Zimmer – I-KON-Technikpaket" },
    houseSeries: LIVING_HAUS_SERIES_ID,
  }).blockingIssues.some((issue) => issue.category === CLAIM_CATEGORY.UNVERIFIED_TECHNICAL_CLAIM));
});

test("allows only the centrally phrased QNG guarantee and never converts it into a sustainability or individual certificate claim", () => {
  const context = { listingFacts: [qngGuaranteeFact()], houseSeries: LIVING_HAUS_SERIES_ID };
  for (const text of [QNG_GUARANTEE_SENTENCE, "QNG-Siegel serienmäßig garantiert", QNG_GUARANTEE_TITLE]) {
    assert.equal(validateListingClaims({ texts: { description: text }, ...context }).ok, true, text);
  }
  for (const text of [
    "Dieses Haus ist QNG-zertifiziert.",
    "Das nachhaltige QNG-Haus.",
    "QNG garantiert besonders nachhaltiges Wohnen.",
  ]) {
    assert.equal(validateListingClaims({ texts: { description: text }, ...context }).ok, false, text);
  }
  assert.equal(validateListingClaims({
    texts: { description: QNG_GUARANTEE_SENTENCE },
    houseSeries: "fremdhersteller",
  }).ok, false);
});

test("keeps QNG guarantee, planning certificate and individual certification as separate fact states", () => {
  const planningCertificate = {
    key: "qng_planning_certificate",
    value: "QNG-Planungszertifikat",
    source: FACT_SOURCE.PROJECT,
    scope: FACT_SCOPE.PROJECT,
    status: FACT_STATUS.PLANNING_CERTIFICATE,
    verified: true,
    evidenceKind: FACT_EVIDENCE_KIND.QNG_PLANNING_CERTIFICATE,
    evidenceReference: "Planungszertifikat QNG-2026-001",
  };
  const certified = {
    key: "qng_certified",
    value: "QNG-Zertifikat",
    source: FACT_SOURCE.PROJECT,
    scope: FACT_SCOPE.HOUSE,
    status: FACT_STATUS.CERTIFIED,
    verified: true,
    evidenceKind: FACT_EVIDENCE_KIND.QNG_INDIVIDUAL_CERTIFICATE,
    evidenceReference: "Individuelles QNG-Zertifikat QNG-2028-001",
  };
  assert.equal(validateListingClaims({
    texts: { description: "Für dieses Projekt liegt ein QNG-Planungszertifikat vor." },
    listingFacts: [planningCertificate],
  }).ok, true);
  assert.equal(validateListingClaims({
    texts: { description: "Dieses Haus ist QNG-zertifiziert." },
    listingFacts: [certified],
  }).ok, true);
  assert.equal(validateListingClaims({
    texts: { description: "Dieses Haus ist QNG-zertifiziert." },
    listingFacts: [qngGuaranteeFact()],
    houseSeries: LIVING_HAUS_SERIES_ID,
  }).ok, false);
});

test("keeps QNG planning, object certification and manufacturer QDF strictly separated", () => {
  const qngProjectBasis = technicalFact("qng_project_basis", "QNG-Projektierungsgrundlage", {
    source: FACT_SOURCE.VERIFIED_SERIES,
    scope: FACT_SCOPE.HOUSE_SERIES,
    seriesId: LIVING_HAUS_SERIES_ID,
    evidenceReference: "Serienfreigabe QNG-Projektierungsgrundlage",
  });
  assert.equal(validateListingClaims({
    texts: { equipment: "Für die Hausserie ist eine verifizierte QNG-Projektierungsgrundlage dokumentiert." },
    listingFacts: [qngProjectBasis],
    houseSeries: LIVING_HAUS_SERIES_ID,
  }).ok, true);
  assert.ok(validateListingClaims({
    texts: { equipment: "Das konkrete Haus ist QNG-zertifiziert." },
    listingFacts: [qngProjectBasis],
    houseSeries: LIVING_HAUS_SERIES_ID,
  }).blockingIssues.some((issue) => issue.category === CLAIM_CATEGORY.UNVERIFIED_SUSTAINABILITY_LABEL));

  const qdfManufacturer = technicalFact("manufacturer_quality", "Qualitätsgemeinschaft Deutscher Fertigbau (QDF)", {
    source: FACT_SOURCE.VERIFIED_MANUFACTURER,
    scope: FACT_SCOPE.MANUFACTURER,
    manufacturerId: "livinghaus",
    evidenceReference: "Verifizierte Herstellerzuordnung und QDF-Nachweis",
  });
  const manufacturerContext = { listingFacts: [qdfManufacturer], manufacturerId: "livinghaus" };
  assert.equal(validateListingClaims({
    texts: { equipment: "Der Hersteller erfüllt die Qualitätsanforderungen der Qualitätsgemeinschaft Deutscher Fertigbau (QDF)." },
    ...manufacturerContext,
  }).ok, true);
  assert.ok(validateListingClaims({
    texts: { equipment: "Das konkrete Haus verfügt über eine QDF-Zertifizierung." },
    ...manufacturerContext,
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

test("blocks a DGNB Gold claim unless the verified series fact explicitly carries Gold", () => {
  assert.ok(validateListingClaims({
    texts: { equipment: "Für die Hausserie liegt eine DGNB-Serienzertifizierung in Gold vor." },
    houseSeries: LIVING_HAUS_SERIES_ID,
  }).blockingIssues.some((issue) => issue.category === CLAIM_CATEGORY.UNVERIFIED_CERTIFICATION));
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

test("deterministic generation uses the fact-covered standard copy and preserves explicit static overrides", () => {
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
    seriesId: LIVING_HAUS_SERIES_ID,
    technicalPackage: "livinghaus-ikon-standard",
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
    approvedMasterTextFields: ["equipment"],
  }).ok, true);
  assert.equal(generated.equipment, FIXED_EQUIPMENT_TEXT);
  assert.equal(generated.other, FIXED_OTHER_TEXT);
  assert.match(generated.equipment, /DGNB-Zertifizierung/u);
  assert.doesNotMatch(generated.equipment, /QNG/u);
  assert.match(generated.title, /m², 5 Zimmer/u);
  assert.match(generated.title, /QNG-Siegel garantiert|DGNB-Serienzertifizierung|I-KON-Technikpaket/u);
  assert.equal(generated.description.split(QNG_GUARANTEE_SENTENCE).length - 1, 1);
  assert.doesNotMatch(generated.description, /nachhaltig|energieeffizient|dgnb/iu);

  const completed = completeListingTexts(house, project, provider, {
    title: "Nachhaltiges Familienhaus",
    description: "Besonders energieeffizientes Eigenheim.",
    equipment: "Ideal gedämmte Gebäudehülle.",
    location: "Sachliche Lage.",
    other: "Dauerhaft niedrige Energiekosten.",
  });
  assert.equal(completed.title, "Nachhaltiges Familienhaus");
  assert.equal(completed.equipment, "Ideal gedämmte Gebäudehülle.");
  assert.equal(completed.other, "Dauerhaft niedrige Energiekosten.");
  assert.ok(completed.description.endsWith(FIXED_DESCRIPTION_CTA));
  assert.equal(validateListingClaims({
    texts: completed,
    house,
    project,
    houseSeries: LIVING_HAUS_SERIES_ID,
  }).ok, false);
  assert.equal(completed.description.split(QNG_GUARANTEE_SENTENCE).length - 1, 1);
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
