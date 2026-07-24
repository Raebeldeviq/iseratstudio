import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRecommendedMediaSequence,
  captionForImageRole,
  imageSequenceIssues,
  inferImageRole,
  orderHouseImages,
  parseHouseVariant,
} from "../image-sequence.mjs";

function item(id, filename, kind = "marketing", collection = "Allgemeine Anzeigen") {
  return {
    id,
    filename,
    relativePath: filename,
    caption: filename.replace(/\.[^.]+$/, ""),
    kind,
    collection,
  };
}

const standardAssets = [
  item("kitchen", "Deine 5_ Küche.jpeg", "interior", "Inneneinrichtung"),
  item("bathroom", "Dein Spa.png", "interior"),
  item("bedroom", "Deine Ruhezone.jpeg", "interior", "Inneneinrichtung"),
  item("kids", "Der Entwicklungsraum.jpeg", "interior", "Inneneinrichtung"),
  item("living", "Setz dich und Ruh dich aus.jpeg", "interior", "Inneneinrichtung"),
  item("office", "Work-Life Balance.jpg", "interior"),
  item("emotion", "Hier beginnt dein Zuhause.png"),
  item("awards", "Ausgezeichnet gebaut.png"),
  item("trust", "Bestens Beraten.jpg"),
  item("qr", "Jetzt Starten!.png"),
];

test("recognizes the fixed image roles and house variants", () => {
  assert.equal(inferImageRole(item("bed", "Deine Ruhezone.jpeg", "interior")), "bedroom");
  assert.equal(inferImageRole(item("kids", "Der Entwicklungsraum.jpeg", "interior")), "kids");
  assert.equal(inferImageRole(item("catch", "Hier beginnt dein Zuhause.png")), "emotion");
  assert.deepEqual(parseHouseVariant("SUN_130_SD_V2_EG.jpg"), {
    family: "SUN",
    model: "130",
    modelKey: "SUN130",
    version: "V2",
    roof: "SD",
  });
  assert.deepEqual(parseHouseVariant("3274_LivingHaus_Solution_Doppelhauser_117_V4_SD_02.jpg"), {
    family: "SOL",
    model: "117",
    modelKey: "SOL117",
    version: "V4",
    roof: "SD",
  });
});

test("builds the complete SUN sequence with ground floor before attic", () => {
  const cover = item("cover", "SUN 130 V2.png", "house");
  const result = buildRecommendedMediaSequence("cover", [
    cover,
    ...standardAssets,
    item("ground", "SUN_130_SD_V2_EG.jpg", "floorplan"),
    item("attic", "SUN_130_SD_V2_DG.jpg", "floorplan"),
    item("wrong", "SUN_130_SD_V3_EG.jpg", "floorplan"),
  ]);

  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.items.map((image) => image.role), [
    "cover",
    "kitchen",
    "bathroom",
    "bedroom",
    "kids",
    "living",
    "office",
    "emotion",
    "floorplan_ground",
    "floorplan_upper",
    "awards",
    "trust",
    "qr",
  ]);
  assert.equal(result.items[8].id, "ground");
  assert.equal(result.items[9].id, "attic");
  assert.equal(result.items[9].caption, "Dein Dachgeschoss");
  assert.equal(result.items[1].caption, "Deine 5* Küche");
  assert.equal(result.items[1].captionLocked, true);
  assert.equal(result.items[0].captionLocked, false);
});

test("keeps SOL bungalow sequences on the ground floor", () => {
  const result = buildRecommendedMediaSequence("cover", [
    item("cover", "SOL 107 V3.png", "house"),
    ...standardAssets,
    item("ground", "SOL_107_V3_KAT_TYP_WD_EG1-BP.jpg", "floorplan"),
  ]);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.items.filter((image) => image.role.startsWith("floorplan")).length, 1);
  assert.deepEqual(imageSequenceIssues(result.items, { requiresUpperFloor: false }), []);
});

test("rejects an unbranded render as the automatic title image", () => {
  const cover = { ...item("cover", "3743_LivingHaus_Sunshine130_V2_03.jpg", "house"), brandedCover: false };
  const result = buildRecommendedMediaSequence("cover", [cover, ...standardAssets]);
  assert.deepEqual(result.items, []);
  assert.match(result.warnings[0], /LivingHaus-Logo/);
});

test("uses the branded SUN 112 variant to choose its versionless roof plans", () => {
  const result = buildRecommendedMediaSequence("cover", [
    item("cover", "Sun 112 V2.png", "house"),
    ...standardAssets,
    item("fd-ground", "SUN_112_V_FD_EG.jpg", "floorplan"),
    item("fd-upper", "SUN_112_V_FD_OG.jpg", "floorplan"),
    item("sd-ground", "SUN_112_V_SD_EG.jpg", "floorplan"),
    item("sd-attic", "SUN_112_V_SD_DG.jpg", "floorplan"),
  ]);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(
    result.items.filter((image) => image.role.startsWith("floorplan")).map((image) => image.id),
    ["sd-ground", "sd-attic"],
  );
});

test("preserves the selected interior order while restoring the fixed sequence blocks", () => {
  const images = [
    { ...item("qr", "Jetzt Starten!.png"), role: "qr" },
    { ...item("office", "Work-Life Balance.jpg"), role: "office" },
    { ...item("kitchen", "Deine 5_ Küche.jpeg"), role: "kitchen" },
    { ...item("cover", "SUN 130 V2.png", "house"), role: "cover" },
    { ...item("emotion", "Hier beginnt dein Zuhause.png"), role: "emotion" },
  ];
  assert.deepEqual(orderHouseImages(images).map((image) => image.id), [
    "cover",
    "office",
    "kitchen",
    "emotion",
    "qr",
  ]);
});

test("reports incomplete role-aware sequences without changing legacy image sets", () => {
  assert.deepEqual(imageSequenceIssues([
    { filename: "front.jpg", isFloorplan: false },
    { filename: "room.jpg", isFloorplan: false },
  ]), []);
  const issues = imageSequenceIssues([
    { filename: "SUN 130 V2.png", role: "cover" },
    { filename: "Küche 1.jpg", role: "kitchen" },
    { filename: "Küche 2.jpg", role: "kitchen" },
  ], { requiresUpperFloor: true });
  assert.ok(issues.includes("Küche ist 2-mal vorhanden."));
  assert.ok(issues.includes("Grundriss Ober-/Dachgeschoss fehlt."));
});

test("keeps fixed captions and allows the title caption to vary", () => {
  assert.equal(captionForImageRole("trust", "Bestens Beraten.jpg"), "Bestens Beraten");
  assert.equal(captionForImageRole("cover", "SUN 130 V2.png", "Dein schönes Zuhause"), "Dein schönes Zuhause");
});
