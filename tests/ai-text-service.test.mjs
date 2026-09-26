import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSourceData,
  createOpenAiImageCaptionRequest,
  createOpenAiRequest,
  extractImageCaptions,
  extractListingTexts,
  looksLikeOpenAiApiKey,
  validateListingTexts,
  validateLocationPrivacy,
  validateNovelty,
} from "../ai-text-service.mjs";
import {
  buildListingHeadline,
  enforceListingCopy,
  FIXED_DESCRIPTION_CTA,
  FIXED_DESCRIPTION_FINANCING,
  FIXED_EQUIPMENT_TEXT,
  FIXED_OTHER_TEXT,
} from "../listing-copy.mjs";

const longText = (sentence, minimum) => {
  let value = sentence;
  while (value.length < minimum) value += ` ${sentence}`;
  return value;
};

const testHouse = {
  id: "sun-113-v6",
  name: "SUN 113 V6",
  livingArea: 113.4,
  rooms: 5,
};
const testProject = { city: "Schulzendorf", district: "" };
const validTexts = enforceListingCopy({
  title: buildListingHeadline(testHouse, testProject),
  description: longText("Der projektierte Entwurf verbindet klare Architektur mit flexibel nutzbaren Räumen und einer sorgfältig abgestimmten Planung für den Familienalltag.", 1800),
  equipment: "",
  location: longText("Das Grundstück liegt in Schulzendorf und bietet einen stimmigen Rahmen für das geplante Zuhause; alle weiteren Details werden anhand bestätigter Standortdaten beurteilt.", 550),
  other: "",
}, { house: testHouse, project: testProject, generated: true });

test("removes the exact house number before building the AI source data", () => {
  const source = buildSourceData({
    project: { name: "Test Bergstraße 27a", street: "Bergstraße", houseNumber: "27a", zip: "15732", city: "Schulzendorf", plotArea: 600, locationFacts: "Das Grundstück Bergstraße 27a liegt ruhig." },
    house: { name: "Concept 150", useStandardPackage: true },
    previousTexts: { title: "Bauen in der Bergstraße 27a" },
  });
  assert.equal(source.projectWithTownOnly.city, "Schulzendorf");
  assert.equal("street" in source.projectWithTownOnly, false);
  assert.equal("zip" in source.projectWithTownOnly, false);
  assert.equal("houseNumber" in source.projectWithTownOnly, false);
  const { variationId: generatedVariationId, ...sourceWithoutVolatileId } = source;
  assert.match(generatedVariationId, /^[0-9a-f-]{36}$/i);
  assert.doesNotMatch(JSON.stringify(sourceWithoutVolatileId), /Bergstraße|15732|27a/);
});

test("keeps offer prices and internal variants out of the AI source data", () => {
  const source = buildSourceData({
    project: { city: "Schulzendorf", plotArea: 600, plotPrice: 189000, additionalCosts: 32000 },
    house: {
      name: "SUN 144 V4 Tag",
      housePrice: 358000,
      architecture: "Offener Wohnbereich; Hauspreis laut Muster 358.000 Euro.",
    },
    configuredOfferPriceEuro: 579000,
    selectedHouseNames: ["SUN 144 V4 Tag", "SUN 136 V2 Nacht"],
  });
  const serialized = JSON.stringify(source);
  assert.equal(source.house.name, "SUN 144");
  assert.deepEqual(source.allSelectedHouseNames, ["SUN 144", "SUN 136"]);
  assert.equal("housePriceEuro" in source.house, false);
  assert.equal("plotPriceEuro" in source.projectWithTownOnly, false);
  assert.equal("configuredOfferPriceEuro" in source, false);
  assert.doesNotMatch(serialized, /358\.000|189000|579000|V4|V2|Tag|Nacht|Hauspreis|Euro/u);
});

test("supplies only released series facts and projected energy values to the AI", () => {
  const source = buildSourceData({
    project: { city: "Schulzendorf" },
    house: { name: "Concept 150", energyDemand: 18, energyClass: "A++" },
  });
  assert.ok(source.house.releasedListingFacts.some((fact) => fact.key === "certification" && fact.sourceKind === "verified_series"));
  assert.deepEqual(source.house.releasedListingFacts.find((fact) => fact.key === "qng_guarantee"), {
    key: "qng_guarantee",
    value: "QNG-Siegel garantiert",
    source: "verified_series",
    sourceKind: "verified_series",
    scope: "project",
    status: "guaranteed",
    verified: true,
    evidenceReference: "Verifizierte Living-Haus-Serienfreigabe: QNG-Garantie für projektierte Häuser",
    evidenceKind: "qng_series_guarantee",
    sourceScope: "house_series",
    projectScope: "project",
  });
  assert.ok(source.house.releasedListingFacts.some((fact) => (
    fact.key === "energy_demand"
    && fact.status === "planned"
    && fact.evidenceKind === "projected_house_value"
  )));
  assert.deepEqual(source.house.releasedListingFacts.find((fact) => fact.key === "energy_class"), {
    key: "energy_class",
    value: "A++",
    source: "verified_series",
    sourceKind: "verified_series",
    scope: "project",
    status: "planned",
    verified: true,
    evidenceReference: "Verifizierter Living-Haus-Projektierungswert: Energieeffizienzklasse A++",
    evidenceKind: "projected_house_energy_class",
    sourceScope: undefined,
    projectScope: undefined,
  });
});

test("uses the Responses API quality settings and a strict text schema", () => {
  const request = createOpenAiRequest({ model: "gpt-5.6-sol", project: {}, house: {} });
  assert.equal(request.model, "gpt-5.6-sol");
  assert.equal(request.store, false);
  assert.equal(request.reasoning.effort, "medium");
  assert.equal(request.text.verbosity, "high");
  assert.equal(request.text.format.type, "json_schema");
  assert.deepEqual(request.text.format.schema.required, ["description", "location"]);
  assert.deepEqual(Object.keys(request.text.format.schema.properties), ["description", "location"]);
  assert.match(request.input[0].content[0].text, /160 bis 215 Wörter/);
  assert.match(request.input[0].content[0].text, /Erzeuge selbst keinen Finanzierungshinweis/);
  assert.match(request.input[0].content[0].text, /Nenne niemals Preise oder preisbezogene Informationen/);
  assert.match(request.input[0].content[0].text, /keine internen Hausvarianten/);
  assert.match(request.input[0].content[0].text, /DGNB, QDF oder QNG/);
  assert.match(request.input[0].content[0].text, /keine allgemeinen Umwelt-, Klima-, Nachhaltigkeits- oder Energieversprechen/);
  assert.match(request.text.format.schema.properties.description.description, /160 bis 215 Wörtern/);
});

test("uses GPT-5.6 Luna as the economical default", () => {
  assert.equal(createOpenAiRequest({ project: {}, house: {} }).model, "gpt-5.6-luna");
  assert.equal(createOpenAiImageCaptionRequest({ images: [] }).model, "gpt-5.6-luna");
});

test("sends uploaded images at low detail and requires structured short captions", () => {
  const request = createOpenAiImageCaptionRequest({
    model: "gpt-5.6-terra",
    house: { name: "Concept 150", houseType: "Einfamilienhaus" },
    images: [{
      id: "image-1",
      name: "wohnzimmer.jpg",
      isFloorplan: false,
      dataUrl: "data:image/jpeg;base64,AA==",
    }],
  });
  const imageInput = request.input[0].content.find((item) => item.type === "input_image");
  assert.equal(request.model, "gpt-5.6-terra");
  assert.equal(request.store, false);
  assert.equal(request.reasoning.effort, "low");
  assert.equal(imageInput.detail, "low");
  assert.equal(request.text.format.schema.properties.captions.type, "array");
  assert.deepEqual(
    extractImageCaptions({ output_text: JSON.stringify({ captions: [{ id: "image-1", caption: "Licht und Weite für gemeinsame Lieblingsmomente" }] }) }),
    [{ id: "image-1", caption: "Licht und Weite für gemeinsame Lieblingsmomente" }],
  );
});

test("accepts complete texts and rejects short or Markdown-formatted output", () => {
  assert.deepEqual(validateListingTexts(validTexts, testHouse, testProject), []);
  const errors = validateListingTexts({ ...validTexts, description: "## Zu kurz" }, testHouse, testProject);
  assert.ok(errors.some((value) => value.includes("zu kurz")));
  assert.ok(errors.some((value) => value.includes("Markdown")));
});

test("rejects prices and internal variants in the generated object description", () => {
  const priceErrors = validateListingTexts({
    ...validTexts,
    description: `${validTexts.description.replace(FIXED_DESCRIPTION_CTA, "Der Kaufpreis beträgt 489.000 Euro.")}`,
  }, testHouse, testProject);
  assert.ok(priceErrors.some((value) => value.includes("Preisangabe")));

  const variantErrors = validateListingTexts({
    ...validTexts,
    description: validTexts.description.replace(FIXED_DESCRIPTION_CTA, "Der Entwurf SUN 113 V4 Tag passt zum Familienalltag.\n\n" + FIXED_DESCRIPTION_CTA),
  }, testHouse, testProject);
  assert.ok(variantErrors.some((value) => value.includes("interne Hausvariante")));
});

test("adds only the central safe financing note and rejects AI-authored financing claims", () => {
  assert.equal(validTexts.description.split(FIXED_DESCRIPTION_FINANCING).length - 1, 1);
  assert.match(validTexts.description, /Zuhause-Darlehen/u);
  assert.match(validTexts.description, /möglichen Fördermöglichkeiten/u);
  assert.doesNotMatch(validTexts.description, /\b(?:Darlehenshöhe|Rate|Zusage|für jeden geeignet)\b/iu);

  const unsafe = validateListingTexts({
    ...validTexts,
    description: validTexts.description.replace(
      FIXED_DESCRIPTION_FINANCING,
      `Eine Finanzierung mit einer festen Rate ist garantiert.\n\n${FIXED_DESCRIPTION_FINANCING}`,
    ),
  }, testHouse, testProject);
  assert.ok(unsafe.some((error) => /nicht zentral freigegebenen Finanzierungshinweis/u.test(error)));
});

test("requires the factual headline with place, rounded area and rooms", () => {
  const title = buildListingHeadline(testHouse, testProject);
  assert.match(title, /in Schulzendorf:/);
  assert.match(title, /113 m², 5 Zimmer$/);
  assert.deepEqual(validateListingTexts(validTexts, testHouse, testProject), []);
  const errors = validateListingTexts({ ...validTexts, title: "Dein Zuhause in Schulzendorf" }, testHouse, testProject);
  assert.ok(errors.some((value) => value.includes("Wohnfläche")));
  assert.equal(validTexts.equipment, FIXED_EQUIPMENT_TEXT);
  assert.equal(validTexts.other, FIXED_OTHER_TEXT);
});

test("extracts structured text from a Responses API output block", () => {
  const response = {
    output: [{ content: [{ type: "output_text", text: JSON.stringify(validTexts) }] }],
  };
  assert.deepEqual(extractListingTexts(response), validTexts);
});

test("rejects a new version that repeats the previous listing", () => {
  const errors = validateNovelty(validTexts, validTexts);
  assert.ok(errors.some((value) => value.includes("Objektbeschreibung")));
  assert.ok(errors.some((value) => value.includes("Lage")));
  assert.equal(errors.some((value) => value.includes("Ausstattung")), false);
});

test("rejects street names in every AI-generated listing field", () => {
  const errors = validateLocationPrivacy({
    ...validTexts,
    title: "Modernes Zuhause in Schulzendorf",
    location: `${validTexts.location} Das Grundstück liegt an der Bergstraße.`,
  }, { street: "Bergstraße" });
  assert.ok(errors.some((value) => value.includes("Straßenname")));
  const unconfiguredStreet = validateLocationPrivacy({
    ...validTexts,
    location: `${validTexts.location} Eine genaue Anschrift am Fichtenweg 8 wird nicht veröffentlicht.`,
  }, {});
  assert.ok(unconfiguredStreet.some((value) => value.includes("Straßenname")));
  const postalCode = validateLocationPrivacy({
    ...validTexts,
    title: "Ein neues Zuhause in 15732 Schulzendorf",
  }, {});
  assert.ok(postalCode.some((value) => value.includes("Postleitzahl")));
  assert.equal(looksLikeOpenAiApiKey("LivingHaus"), false);
  assert.equal(looksLikeOpenAiApiKey("sk-proj-example_12345678901234567890"), true);
});
