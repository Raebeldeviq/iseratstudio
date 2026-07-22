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

const longText = (sentence, minimum) => {
  let value = sentence;
  while (value.length < minimum) value += ` ${sentence}`;
  return value;
};

const validTexts = {
  title: "Ein Zuhause mit Weitblick in Schulzendorf",
  description: longText("Der projektierte Entwurf verbindet klare Architektur mit flexibel nutzbaren Räumen und einer sorgfältig abgestimmten Planung für den Familienalltag.", 1250),
  equipment: longText("Die geplante Ausstattung kombiniert eine moderne Wärmepumpe, komfortable Flächen und individuell zu vereinbarende Materialien gemäß Bau- und Leistungsbeschreibung.", 1550),
  location: longText("Das Grundstück liegt in Schulzendorf und bietet einen stimmigen Rahmen für das geplante Zuhause; alle weiteren Details werden anhand bestätigter Standortdaten beurteilt.", 550),
  other: longText("Das Haus ist projektiert; maßgeblich sind die konkrete Planung, die Grundstücksprüfung und die individuell vereinbarte Bau- und Leistungsbeschreibung.", 600),
};

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
  assert.doesNotMatch(JSON.stringify(source), /Bergstraße|15732|27a/);
});

test("uses the Responses API quality settings and a strict text schema", () => {
  const request = createOpenAiRequest({ model: "gpt-5.6-sol", project: {}, house: {} });
  assert.equal(request.model, "gpt-5.6-sol");
  assert.equal(request.store, false);
  assert.equal(request.reasoning.effort, "medium");
  assert.equal(request.text.verbosity, "high");
  assert.equal(request.text.format.type, "json_schema");
  assert.deepEqual(request.text.format.schema.required, ["title", "description", "equipment", "location", "other"]);
  assert.match(request.text.format.schema.properties.title.description, /3 bis 8 Wörtern/);
  assert.match(request.input[0].content[0].text, /niemals die gelieferte Haus- oder Modellbezeichnung/);
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
  assert.deepEqual(validateListingTexts(validTexts), []);
  const errors = validateListingTexts({ ...validTexts, description: "## Zu kurz" });
  assert.ok(errors.some((value) => value.includes("zu kurz")));
  assert.ok(errors.some((value) => value.includes("Markdown")));
});

test("requires short headlines without the configured house designation", () => {
  assert.deepEqual(
    validateListingTexts({ ...validTexts, title: "Mehr Raum für euer Familienleben" }, { name: "Sunshine 125" }),
    [],
  );
  const designationErrors = validateListingTexts(
    { ...validTexts, title: "Sunshine 125 für die ganze Familie" },
    { name: "Sunshine 125" },
  );
  assert.ok(designationErrors.some((value) => value.includes("Hausbezeichnung")));
  const punctuationErrors = validateListingTexts(
    { ...validTexts, title: "Familienglück: Raum für neue Pläne" },
  );
  assert.ok(punctuationErrors.some((value) => value.includes("Doppelpunkt")));
});

test("extracts structured text from a Responses API output block", () => {
  const response = {
    output: [{ content: [{ type: "output_text", text: JSON.stringify(validTexts) }] }],
  };
  assert.deepEqual(extractListingTexts(response), validTexts);
});

test("rejects a new version that repeats the previous listing", () => {
  const errors = validateNovelty(validTexts, validTexts);
  assert.ok(errors.some((value) => value.includes("Überschrift")));
  assert.ok(errors.some((value) => value.includes("Objektbeschreibung")));
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
