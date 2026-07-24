import assert from "node:assert/strict";
import test from "node:test";

import {
  housePriceCatalogEntries,
  resolveHousePrice,
} from "../house-price-catalog.mjs";

test("contains every supplied house price", () => {
  const entries = housePriceCatalogEntries();
  assert.equal(entries.length, 30);
  assert.equal(resolveHousePrice("SUN 113 V6.png").price, 355_122);
  assert.equal(resolveHousePrice("SUN 126 V2.png").price, 365_073);
  assert.equal(resolveHousePrice("SUN_165_V7_KAT_OG.jpg").price, 426_931);
  assert.equal(resolveHousePrice("SOL_082_B_SD").price, 325_931);
  assert.equal(resolveHousePrice("SOL_242_ZFH_SD").price, 655_971);
});

test("ignores image versions while retaining L and XL as separate models", () => {
  assert.equal(resolveHousePrice("SOL_125L_KAT_V2_DG.jpg").price, 378_568);
  assert.equal(resolveHousePrice("SOL_125XL_KAT_V4_EG.jpg").price, 483_864);
  assert.equal(resolveHousePrice("SOL 117 V3.png"), null);
});

test("uses a floorplan suffix to resolve a generic cover", () => {
  const match = resolveHousePrice([
    "SOL 125 V3.png",
    "SOL_125L_KAT_V3_EG.jpg",
    "SOL_125L_KAT_V3_DG.jpg",
  ]);
  assert.deepEqual(match, {
    key: "SOL125L",
    label: "SOL 125 L",
    price: 378_568,
    houseType: "Doppelhaushälfte",
  });
});

test("does not guess unknown or conflicting model identifiers", () => {
  assert.equal(resolveHousePrice("SUN 112 V2.png"), null);
  assert.equal(resolveHousePrice(["SOL_117L_EG.jpg", "SOL_117XL_EG.jpg"]), null);
  assert.equal(resolveHousePrice(["SUN 126 V2.png", "SUN 165 V3.png"]), null);
});
