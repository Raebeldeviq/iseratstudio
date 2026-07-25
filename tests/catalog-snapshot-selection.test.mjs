import assert from "node:assert/strict";
import test from "node:test";

import {
  catalogSnapshotSummary,
  selectCatalogSnapshot,
} from "../catalog-snapshot-selection.mjs";

function snapshot(source, savedAt, state) {
  return { source, savedAt, state: { version: 1, houses: [], projects: [], ...state } };
}

test("keeps a productive device catalog ahead of a newer empty browser shell", () => {
  const device = snapshot("device", "2026-07-25T10:00:00.000Z", {
    houses: [{ id: "sun-113", housePrice: 355122, images: [{ id: "cover" }] }],
    projects: [{ id: "project-1", street: "Kirschallee", zip: "14469", city: "Potsdam" }],
  });
  const browser = snapshot("browser", "2026-07-25T11:00:00.000Z", {
    houses: [{ id: "placeholder", housePrice: 0, images: [] }],
    projects: [{ id: "new-project", street: "", zip: "", city: "" }],
    plots: [{ id: "imported-plot", street: "Kirschallee", postalCode: "14469", city: "Potsdam" }],
  });

  assert.equal(selectCatalogSnapshot([browser, device]), device);
});

test("uses the newer browser snapshot when it contains productive edits", () => {
  const device = snapshot("device", "2026-07-25T10:00:00.000Z", {
    houses: [{ id: "sun-113", housePrice: 355122, images: [{ id: "cover" }] }],
    projects: [{ id: "project-1", street: "Kirschallee", city: "Potsdam" }],
  });
  const browser = snapshot("browser", "2026-07-25T11:00:00.000Z", {
    houses: [{ id: "sun-113", housePrice: 355122, images: [{ id: "cover" }] }],
    projects: [{ id: "project-1", street: "Kirschallee", city: "Potsdam", plotArea: 651 }],
  });

  assert.equal(selectCatalogSnapshot([device, browser]), browser);
});

test("uses the device snapshot normally when it is newest", () => {
  const browser = snapshot("browser", "2026-07-25T10:00:00.000Z", {
    houses: [{ id: "house", housePrice: 1, images: [] }],
  });
  const device = snapshot("device", "2026-07-25T11:00:00.000Z", {
    houses: [{ id: "house", housePrice: 2, images: [] }],
  });

  assert.equal(selectCatalogSnapshot([browser, device]), device);
  assert.deepEqual(catalogSnapshotSummary(device), { preparedHouses: 1, addressedProjects: 0 });
});

test("keeps the migrated device catalog ahead of a newer stale browser schema", () => {
  const device = snapshot("device", "2026-07-25T10:00:00.000Z", {
    dataSchemaVersion: 4,
    houses: [{ id: "new-house", housePrice: 1, images: [] }],
    projects: [{ id: "project", street: "Weg" }],
  });
  const browser = snapshot("browser", "2026-07-25T11:00:00.000Z", {
    dataSchemaVersion: 3,
    houses: [{ id: "old-house", housePrice: 1, images: [] }],
    projects: [{ id: "project", street: "Weg" }],
  });
  assert.equal(selectCatalogSnapshot([browser, device]), device);
});
