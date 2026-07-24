import assert from "node:assert/strict";
import test from "node:test";

import {
  createDefaultProvider,
  createEmptyHouse,
  createEmptyProject,
  createInitialStudioState,
} from "../studio-defaults.mjs";

test("creates a private-data-free initial studio state", () => {
  const state = createInitialStudioState();
  assert.equal(state.version, 1);
  assert.equal(state.houses.length, 1);
  assert.equal(state.projects.length, 1);
  assert.equal(state.provider.email, "");
  assert.equal(state.provider.phone, "");
  assert.equal(state.promotionImage, null);
});

test("keeps shared empty house, project and provider defaults consistent", () => {
  assert.equal(createEmptyHouse(1).name, "Zweifamilienhaus – Muster");
  assert.equal(createEmptyProject("pascal").owner, "pascal");
  assert.match(createDefaultProvider().company, /Living Fertighaus GmbH/);
});
