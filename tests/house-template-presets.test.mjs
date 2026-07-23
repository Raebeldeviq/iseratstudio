import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHouseTemplatePresets,
  HOUSE_TEMPLATE_PRESETS,
  isEmptyHousePlaceholder,
} from "../house-template-presets.mjs";
import { indexMediaLibrary } from "../media-library.mjs";

test("the approved starter catalog contains exactly 18 unique templates", () => {
  assert.equal(HOUSE_TEMPLATE_PRESETS.length, 18);
  assert.equal(new Set(HOUSE_TEMPLATE_PRESETS.map((item) => item.key)).size, 18);
  assert.deepEqual(
    HOUSE_TEMPLATE_PRESETS.slice(-4).map((item) => item.name),
    ["SOL 101 V2", "SOL 107 V2", "SOL 110 V2", "SUN 113 V6"],
  );
});

test("only the explicit empty starter houses qualify as replaceable placeholders", () => {
  assert.equal(isEmptyHousePlaceholder({ name: "Zweifamilienhaus – Muster", housePrice: 0, images: [] }), true);
  assert.equal(isEmptyHousePlaceholder({ name: "Haustyp 2", housePrice: 0, images: [] }), true);
  assert.equal(isEmptyHousePlaceholder({ name: "SUN 126 V2", housePrice: 365_073, images: [] }), false);
  assert.equal(isEmptyHousePlaceholder({ name: "Haustyp 2", housePrice: 0, images: [{ id: "image" }] }), false);
});

test("all 18 templates build from the configured media library when it is available", async (context) => {
  let mediaItems;
  try {
    mediaItems = await indexMediaLibrary();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      context.skip("Die lokale iCloud-Medienbibliothek ist auf diesem System nicht verfügbar.");
      return;
    }
    throw error;
  }
  const houses = buildHouseTemplatePresets(mediaItems, { constructionYear: 2027 });
  assert.equal(houses.length, 18);
  assert.equal(houses.filter((house) => house.floors === 1).length, 3);
  assert.equal(houses.find((house) => house.name === "SUN 113 V6").housePrice, 0);
  assert.equal(houses.find((house) => house.name === "SUN 126 V2").housePrice, 365_073);
  assert.equal(houses.find((house) => house.name === "SUN 165 V2").housePrice, 426_931);
  for (const house of houses) {
    assert.equal(house.images.length, house.floors === 1 ? 12 : 13, house.name);
    assert.equal(house.images[0].role, "cover", house.name);
    assert.equal(house.images.at(-1).role, "qr", house.name);
  }
});
