import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolveHousePrice } from "../house-price-catalog.mjs";
import { HOUSE_TEMPLATE_PRESETS } from "../house-template-presets.mjs";

const assetManifest = JSON.parse(
  await readFile(new URL("../assets/pascal-house-catalog/manifest.json", import.meta.url), "utf8"),
);

test("contains Pascal's complete 18-house operational catalog", () => {
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

test("resolves Pascal's stored prices except the explicitly open SUN 113 price", () => {
  for (const definition of HOUSE_TEMPLATE_PRESETS) {
    const price = resolveHousePrice(definition.name);
    if (definition.priceOpen) {
      assert.equal(price, null);
    } else {
      assert.ok(price?.price > 0, `${definition.name} has no price`);
    }
  }
});
