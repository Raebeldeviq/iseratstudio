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
  assert.equal(projectOwner({ owner: "fabian" }), "fabian");
});
