import assert from "node:assert/strict";
import test from "node:test";

import {
  randomPromotionAssignments,
  reconcilePromotionAssignments,
} from "../app/lib/promotion-images.js";

test("assigns distinct random promotion images to the requested number of houses", () => {
  const assignments = randomPromotionAssignments(
    ["house-1", "house-2", "house-3", "house-4"],
    ["image-1", "image-2", "image-3", "image-4", "image-5"],
    3,
    () => 0.25,
  );
  assert.equal(Object.keys(assignments).length, 3);
  assert.equal(new Set(Object.values(assignments)).size, 3);
});

test("supports zero promoted houses and never assigns more than four", () => {
  assert.deepEqual(
    randomPromotionAssignments(["h1", "h2"], ["i1", "i2"], 0),
    {},
  );
  assert.equal(
    Object.keys(randomPromotionAssignments(
      ["h1", "h2", "h3", "h4", "h5"],
      ["i1", "i2", "i3", "i4", "i5"],
      5,
    )).length,
    4,
  );
});

test("preserves valid saved assignments and replaces removed images", () => {
  const assignments = reconcilePromotionAssignments(
    ["h1", "h2", "h3"],
    ["i1", "i2", "i3"],
    2,
    { h1: "i1", h2: "removed" },
    () => 0,
  );
  assert.equal(assignments.h1, "i1");
  assert.equal(Object.keys(assignments).length, 2);
  assert.equal(new Set(Object.values(assignments)).size, 2);
  assert.ok(!Object.values(assignments).includes("removed"));
});
