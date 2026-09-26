import assert from "node:assert/strict";
import test from "node:test";

import {
  BUNGALOW_HOUSE_MODEL_KEYS,
  portalHouseStructure,
} from "../listing-copy.mjs";

const bungalows = [
  ["Sol 82", "SOL82"],
  ["Solution 101", "SOL101"],
  ["Solution 107", "SOL107"],
  ["Solution 110", "SOL110"],
];

test("maps exactly the four approved bungalow models to one floor and barrier-free", () => {
  assert.deepEqual(BUNGALOW_HOUSE_MODEL_KEYS, ["SOL82", "SOL101", "SOL107", "SOL110"]);
  for (const [name, modelKey] of bungalows) {
    assert.deepEqual(portalHouseStructure({ name }), {
      modelKey,
      floors: 1,
      barrierFree: true,
    });
  }
});

test("maps stored SOL variants of the approved bungalow models identically", () => {
  for (const model of ["82", "101", "107", "110"]) {
    assert.equal(portalHouseStructure({ name: `SOL ${model} V2` }).floors, 1);
    assert.equal(portalHouseStructure({ name: `SOL ${model} V2` }).barrierFree, true);
  }
});

test("maps every other model to two floors and not barrier-free", () => {
  assert.deepEqual(portalHouseStructure({ name: "SUN 113 V6" }), {
    modelKey: "SUN113",
    floors: 2,
    barrierFree: false,
  });
  assert.equal(portalHouseStructure({ name: "Unbekanntes Haus", floors: 0 }).floors, 2);
});
