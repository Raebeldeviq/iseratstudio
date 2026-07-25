import assert from "node:assert/strict";
import test from "node:test";
import { plotListingCountAppearance } from "../plot-selection.mjs";

test("plot listing count colors follow the required thresholds", () => {
  assert.deepEqual(plotListingCountAppearance(0), { count: 0, tone: "neutral", detail: "" });
  for (const count of [1, 2, 3]) assert.equal(plotListingCountAppearance(count).tone, "yellow");
  assert.deepEqual(plotListingCountAppearance(4), { count: 4, tone: "green", detail: "" });
  assert.deepEqual(plotListingCountAppearance(5), { count: 5, tone: "green", detail: "Mehr als 4 Inserate vorhanden" });
});
