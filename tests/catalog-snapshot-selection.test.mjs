import assert from "node:assert/strict";
import test from "node:test";

import {
  catalogSnapshotSummary,
  selectCatalogSnapshot,
  hasCatalogLifecycleConflict,
  loadCatalogAfterUpload,
} from "../catalog-snapshot-selection.mjs";

function snapshot(source, savedAt, state) {
  return { source, savedAt, state: { version: 1, houses: [], projects: [], ...state } };
}

test('reconciled device state outranks a newer stale browser cache',()=>{
 const device=snapshot('device','2026-09-14T10:00:00Z',{catalogIntegrityRevision:1});
 const browser=snapshot('browser','2026-09-14T11:00:00Z',{});
 assert.equal(selectCatalogSnapshot([device,browser]),device);
});

function transferredDevice() {
  return snapshot("device", "2026-11-18T08:38:07.123Z", {
    houses: [{ id: "house", housePrice: 1 }],
    projects: [{ id: "project", street: "Im Schäferfeld", listings: [
      { id: "0f5367b0-77ae-49ad-82c2-31eb1b514869", externalId: "30460-036002", status: "transferred_pending_import", transferredAt: "2026-11-18T08:38:07.123Z", version: 1, texts: { title: "Aktueller Text" } },
      { id: "pending", externalId: "30460-037002", status: "draft" },
    ] }],
    smartRefill: { credits: [{ id: "credit" }], cycles: [{ id: "reservation", kind: "listing-replacement", listingIds: ["0f5367b0-77ae-49ad-82c2-31eb1b514869"], creditIds: ["credit"] }], cancellations: [] },
    listingResetHistory: [],
  });
}

test("a newer browser timestamp cannot restore a transferred listing to draft or its old batch number", () => {
  for (const change of [l => { l.status = "draft"; delete l.transferredAt; }, l => { l.externalId = "30460-032037"; }, l => { l.deletedAt = "2026-11-18T09:00:00Z"; }]) {
    const device = transferredDevice(), browser = { ...structuredClone(device), source: "browser", savedAt: "2026-11-18T09:49:00Z" };
    change(browser.state.projects[0].listings[0]);
    const before = structuredClone([device, browser]);
    assert.equal(hasCatalogLifecycleConflict(browser, device), true);
    assert.equal(selectCatalogSnapshot([browser, device]), device);
    assert.deepEqual([device, browser], before);
  }
});

test("missing transferred records, reservations and inventory audits prefer the saved device evidence", () => {
  for (const change of [s => { s.projects[0].listings.shift(); }, s => { s.smartRefill.cycles = []; }, s => { s.smartRefill.credits = []; },
    s => { s.projects[0].listings[0].inventoryCorrection = { active: true }; }]) {
    const device = transferredDevice(), browser = { ...structuredClone(device), source: "browser", savedAt: "2026-11-18T09:49:00Z" };
    change(browser.state);
    assert.equal(selectCatalogSnapshot([browser, device]), device);
  }
});

test("safe text edits and new ordinary drafts remain eligible in a newer browser snapshot", () => {
  const device = transferredDevice(), browser = { ...structuredClone(device), source: "browser", savedAt: "2026-11-18T09:49:00Z" };
  browser.state.projects[0].listings[0].texts.title = "Bewusst bearbeiteter Text";
  browser.state.projects[0].listings.push({ id: "new-draft", externalId: "30460-038001", status: "draft" });
  assert.equal(hasCatalogLifecycleConflict(browser, device), false);
  assert.equal(selectCatalogSnapshot([device, browser]), browser);
  assert.equal(selectCatalogSnapshot([browser]), browser);
});

test("post-upload reload waits for queued saves and writes the authoritative browser snapshot before returning", async () => {
  const events = []; let release;
  const pendingSave = new Promise(resolve => { release = () => { events.push("pending-save-settled"); resolve(); }; });
  const device = transferredDevice();
  const result = loadCatalogAfterUpload({ pendingSave,
    loadDeviceSnapshot: async () => { events.push("load-device"); return device; },
    normalize: state => { events.push("normalize"); return { ...state, selectedPlotIds: [] }; },
    saveBrowserSnapshot: async (state, savedAt) => { events.push("save-browser"); assert.equal(state.projects[0].listings[0].status, "transferred_pending_import"); assert.equal(savedAt, device.savedAt); },
  });
  await Promise.resolve(); assert.deepEqual(events, []);
  release(); const adopted = await result;
  assert.deepEqual(events, ["pending-save-settled", "load-device", "normalize", "save-browser"]);
  assert.equal(adopted.savedAt, device.savedAt); assert.deepEqual(adopted.state.selectedPlotIds, []);
});

test("a rejected stale save does not prevent recovery, while missing device state or failed browser persistence is reported", async () => {
  const device = transferredDevice(); let saved = 0;
  const recovered = await loadCatalogAfterUpload({ pendingSave: Promise.reject(new Error("stale revision")), loadDeviceSnapshot: async () => device, saveBrowserSnapshot: async () => { saved++; } });
  assert.equal(recovered.state, device.state); assert.equal(saved, 1);
  await assert.rejects(loadCatalogAfterUpload({ pendingSave: Promise.resolve(), loadDeviceSnapshot: async () => null, saveBrowserSnapshot: async () => { saved++; } }), /Katalog.*neu geladen/u);
  assert.equal(saved, 1);
  await assert.rejects(loadCatalogAfterUpload({ pendingSave: Promise.resolve(), loadDeviceSnapshot: async () => device, saveBrowserSnapshot: async () => { throw new Error("Browser voll"); } }), /Browser voll/u);
});

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
