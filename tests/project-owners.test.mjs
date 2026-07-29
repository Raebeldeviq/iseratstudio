import assert from "node:assert/strict";
import test from "node:test";

import { normalizeProjectOwners, projectOwner } from "../app/lib/project-owners.ts";

const baseState = {
  version: 1,
  houses: [],
  projects: [],
  provider: {},
};

test("assigns legacy address projects to Fabian and preserves Pascal", () => {
  const normalized = normalizeProjectOwners({
    ...baseState,
    projects: [
      { id: "legacy-address" },
      { id: "pascal-address", owner: "pascal" },
    ],
  });

  assert.equal(normalized.projects[0].owner, "fabian");
  assert.equal(normalized.projects[1].owner, "pascal");
  assert.equal(normalized.promotionImage, null);
  assert.equal(normalized.promotionImageEnabled, false);
  assert.deepEqual(normalized.promotionImages, []);
  assert.equal(normalized.projects[0].promotionImageCount, 0);
  assert.equal(normalized.projects[0].responsibleUserId, "user-fabian");
  assert.equal(normalized.projects[1].responsibleUserId, "user-pascal");
  assert.equal(projectOwner({ owner: "fabian" }), "user-fabian");
});

test("migrates one legacy global promotion image into the new saved pool", () => {
  const normalized = normalizeProjectOwners({
    ...baseState,
    promotionImage: { id: "promo-1" },
    promotionImageEnabled: true,
    projects: [{
      id: "project-1",
      selectedHouseIds: ["house-1", "house-2"],
      listings: [],
    }],
  });

  assert.equal(normalized.promotionImages[0].id, "promo-1");
  assert.equal(normalized.projects[0].promotionImageCount, 1);
  assert.equal(Object.keys(normalized.projects[0].promotionAssignments).length, 1);
});
