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
  title: "Entwurf",
  description: longText("Der projektierte Entwurf verbindet klare Architektur mit flexibel nutzbaren Räumen und einer sorgfältig abgestimmten Planung für den Familienalltag.", 1250),
  equipment: "Wird ersetzt.",
  location: longText("Das Grundstück liegt in Schulzendorf und bietet einen stimmigen Rahmen für das geplante Zuhause; alle weiteren Details werden anhand bestätigter Standortdaten beurteilt.", 550),
  other: "Wird ersetzt.",
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

test("supplies only released series facts and projected energy values to the AI", () => {
  const source = buildSourceData({
    project: { city: "Schulzendorf" },
    house: { name: "Concept 150", energyDemand: 18, energyClass: "A++" },
  });
  assert.ok(source.house.releasedListingFacts.some((fact) => fact.key === "certification" && fact.sourceKind === "verified_series"));
  assert.equal(source.house.releasedListingFacts.some((fact) => /qng/iu.test(String(fact.value))), false);
  assert.ok(source.house.releasedListingFacts.some((fact) => (
    fact.key === "energy_demand"
    && fact.status === "planned"
    && fact.evidenceKind === "projected_house_value"
  )));
  assert.equal(source.house.releasedListingFacts.some((fact) => fact.key === "energy_class"), false);
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
  assert.match(request.input[0].content[0].text, /gerundeter Wohnfläche und Zimmerzahl/);
  assert.match(request.input[0].content[0].text, /keine allgemeinen Umwelt-, Klima-, Nachhaltigkeits- oder Energieversprechen/);
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

test("requires the factual headline with place, rounded area and rooms", () => {
  const title = buildListingHeadline(testHouse, testProject);
  assert.match(title, /in Schulzendorf:/);
  assert.match(title, /113 m² Wohnfläche und 5 Zimmer$/);
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
