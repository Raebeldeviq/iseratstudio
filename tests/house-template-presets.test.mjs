import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolveHousePrice } from "../house-price-catalog.mjs";
import {
  CONFIRMED_HOUSE_MODEL_DETAILS,
  HOUSE_TEMPLATE_PRESETS,
} from "../house-template-presets.mjs";

const assetManifest = JSON.parse(
  await readFile(new URL("../assets/bundled-house-catalog/manifest.json", import.meta.url), "utf8"),
);

test("contains the complete 18-house operational catalog", () => {
  assert.equal(HOUSE_TEMPLATE_PRESETS.length, 18);
  assert.equal(assetManifest.houses.length, 18);
  assert.deepEqual(
    assetManifest.houses.map((house) => house.key),
    HOUSE_TEMPLATE_PRESETS.map((house) => house.key),
  );
});

test("keeps every bundled house between four and fourteen images", () => {
  for (const house of assetManifest.houses) {
    assert.ok(house.images.length >= 4, `${house.key} has too few images`);
    assert.ok(house.images.length <= 14, `${house.key} has too many images`);
    assert.equal(house.images[0].role, "cover");
    assert.ok(house.images.every((image) => image.mimeType === "image/webp"));
  }
});

test("resolves every stored house price including SUN 113", () => {
  for (const definition of HOUSE_TEMPLATE_PRESETS) {
    const price = resolveHousePrice(definition.name);
    assert.ok(price?.price > 0, `${definition.name} has no price`);
  }
  const sun113 = HOUSE_TEMPLATE_PRESETS.find((house) => house.key === "sun113-v6");
  assert.deepEqual(
    {
      livingArea: sun113.livingArea,
      rooms: sun113.rooms,
      bedrooms: sun113.bedrooms,
    },
    CONFIRMED_HOUSE_MODEL_DETAILS.SUN113,
  );
});
