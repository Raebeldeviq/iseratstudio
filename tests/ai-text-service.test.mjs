import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSourceData,
  createOpenAiImageCaptionRequest,
  createOpenAiRequest,
  extractImageCaptions,
  extractListingTexts,
  looksLikeOpenAiApiKey,
  validateEditorialQuality,
  validateHeadlineDiversity,
  validateListingTexts,
  validateLocationPrivacy,
  validateNovelty,
} from "../ai-text-service.mjs";
import {
  headlineSimilarity,
  headlinesAreTooSimilar,
  removePrivateAddressFromHeadline,
} from "../app/lib/headline-diversity.js";

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
  const request = createOpenAiRequest({
    model: "gpt-5.6-sol",
    project: {},
    house: {},
    titlesToAvoid: ["Couch sucht endlich mehr Platz"],
    headlineCycleId: "cycle-1",
  });
  assert.equal(request.model, "gpt-5.6-sol");
  assert.equal(request.store, false);
  assert.equal(request.reasoning.effort, "medium");
  assert.equal(request.text.verbosity, "high");
  assert.equal(request.text.format.type, "json_schema");
  assert.deepEqual(request.text.format.schema.required, ["title", "description", "equipment", "location", "other"]);
  assert.match(request.text.format.schema.properties.title.description, /3 bis 8 Wörtern/);
  assert.match(request.input[0].content[0].text, /niemals die gelieferte Haus- oder Modellbezeichnung/);
  assert.match(request.input[0].content[0].text, /modern und leicht humorvoll/);
  assert.match(request.input[0].content[0].text, /mindestens vier/);
  assert.match(request.input[1].content[0].text, /Couch sucht endlich mehr Platz/);
  assert.match(request.text.format.schema.properties.description.description, /interessantem Einstieg/);
});

test("assigns different headline and body directions within one generation batch", () => {
  const first = buildSourceData({
    project: {},
    house: {},
    headlineCycleId: "shared-cycle",
    listingPosition: 1,
  });
  const second = buildSourceData({
    project: {},
    house: {},
    headlineCycleId: "shared-cycle",
    listingPosition: 2,
  });
  assert.notEqual(
    first.writingDirection.headlineDirection,
    second.writingDirection.headlineDirection,
  );
  assert.notEqual(
    first.writingDirection.bodyProfileId,
    second.writingDirection.bodyProfileId,
  );
  const nextVersion = buildSourceData({
    project: {},
    house: {},
    headlineCycleId: "shared-cycle",
    listingPosition: 1,
    previousWritingProfile: first.writingDirection.bodyProfileId,
  });
  assert.notEqual(
    first.writingDirection.bodyProfileId,
    nextVersion.writingDirection.bodyProfileId,
  );
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

test("requires engaging openings and readable paragraph structure", () => {
  const engagingTexts = {
    ...validTexts,
    description: [
      "Morgens Ruhe, nachmittags Leben und abends genug Platz für alle.",
      "Der geplante Grundriss verbindet gemeinschaftliche Bereiche mit Rückzugsorten.",
      "Die Räume lassen sich im Rahmen der Planung auf den Alltag abstimmen.",
      "Im persönlichen Gespräch werden Haus, Grundstück und Wünsche zusammengeführt.",
    ].join("\n\n"),
    equipment: ["Komfort im Alltag", "Technik mit Nutzen", "Individuelle Auswahl", "Klare Planung", "Verlässliche Abstimmung"].join("\n\n"),
    location: ["Schulzendorf bildet den Rahmen.", "Bestätigte Fakten werden alltagsnah eingeordnet.", "Die Planung berücksichtigt das Grundstück."].join("\n\n"),
    other: ["Das Haus ist projektiert.", "Kosten werden individuell geprüft.", "Maßgeblich sind die Vereinbarungen."].join("\n\n"),
  };
  assert.deepEqual(validateEditorialQuality(engagingTexts), []);

  const flatTexts = {
    ...engagingTexts,
    description: "Dieses projektierte Haus bietet einen klassischen Einstieg.\n\nZweiter Absatz.\n\nDritter Absatz.\n\nVierter Absatz.",
    equipment: "Nur ein langer Ausstattungsblock.",
  };
  const errors = validateEditorialQuality(flatTexts);
  assert.ok(errors.some((value) => value.includes("zu formelhaft")));
  assert.ok(errors.some((value) => value.includes("Ausstattung")));
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
  const forbiddenWordErrors = validateListingTexts(
    { ...validTexts, title: "Klare Sache für Familienmenschen" },
  );
  assert.ok(forbiddenWordErrors.some((value) => value.includes("ausgeschlossene Wort")));
  const forbiddenWordFormErrors = validateListingTexts(
    { ...validTexts, title: "Klarheit trifft auf Lieblingsplätze" },
  );
  assert.ok(forbiddenWordFormErrors.some((value) => value.includes("ausgeschlossene Wort")));
});

test("rejects repeated, similar and overused headlines", () => {
  assert.deepEqual(
    validateHeadlineDiversity(
      "Die Couch bekommt ein eigenes Zimmer",
      ["Küche gut, Familienchaos besser"],
    ),
    [],
  );
  assert.ok(validateHeadlineDiversity(
    "Die Couch bekommt endlich ein Zimmer",
    ["Die Couch bekommt ein eigenes Zimmer"],
  ).some((value) => value.includes("bereits verwendeten")));
  assert.ok(validateHeadlineDiversity(
    "Mehr Raum für neue Lieblingsmomente",
    [],
  ).some((value) => value.includes("Standardformulierung")));
  assert.equal(
    headlinesAreTooSimilar(
      "Die Couch bekommt endlich ein Zimmer",
      "Die Couch bekommt ein eigenes Zimmer",
    ),
    true,
  );
  assert.ok(headlineSimilarity("Küche gut, Familienchaos besser", "Endlich Feierabend mit Garten") < 0.6);
  assert.equal(
    removePrivateAddressFromHeadline(
      "Familienglück in der Bergstraße 27a",
      { street: "Bergstraße", houseNumber: "27a", zip: "15732" },
    ),
    "Familienglück in der",
  );
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
