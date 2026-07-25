import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  commitCatalogSnapshot,
  loadCatalogImage,
  loadCatalogManifest,
  loadCatalogSnapshot,
  migrateCatalogManifest,
  saveCatalogImage,
  saveCatalogSnapshot,
  startCatalogSnapshot,
} from "../catalog-store.mjs";

test("stores and restores the complete local catalog including images", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "fabian-pascal-catalog-test-"));
  const catalogPath = join(directory, "catalog.json.gz");
  context.after(() => rm(directory, { recursive: true, force: true }));

  const state = {
    version: 1,
    dataSchemaVersion: 4,
    plotSchemaVersion: 2,
    plots: [],
    selectedPlotIds: [],
    houses: [{
      id: "house-1",
      name: "Testhaus",
      images: [{
        id: "image-1",
        name: "ansicht.jpg",
        mimeType: "image/jpeg",
        dataUrl: "data:image/jpeg;base64,ZmFrZS1pbWFnZS1kYXRh",
        caption: "Ansicht",
        isFloorplan: false,
      }],
    }],
    projects: [],
    provider: { company: "Fabian Raebel" },
    promotionImage: null,
    promotionImageEnabled: false,
    promotionImages: [],
    promotionUsage: [],
    uploadHistory: [],
  };
  const savedAt = "2026-07-22T12:00:00.000Z";
  await saveCatalogSnapshot({ state, savedAt }, catalogPath);

  const storedBytes = await readFile(catalogPath);
  assert.doesNotMatch(storedBytes.toString("utf8"), /fake-image-data|Testhaus/);
  const loaded = await loadCatalogSnapshot(catalogPath);
  assert.equal(loaded.stored, true);
  assert.equal(loaded.savedAt, savedAt);
  assert.deepEqual(loaded.state, state);

  const updatedState = {
    ...state,
    houses: [{ ...state.houses[0], name: "Aktualisiertes Testhaus" }],
  };
  await saveCatalogSnapshot({ state: updatedState, savedAt: "2026-07-22T12:01:00.000Z" }, catalogPath);
  assert.equal((await loadCatalogSnapshot(catalogPath)).state.houses[0].name, "Aktualisiertes Testhaus");
});

test("stores large catalog images separately and reuses unchanged image files", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "fabian-pascal-catalog-v2-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const state = {
    version: 1,
    houses: [{
      id: "house-1",
      name: "Testhaus",
      images: [{
        id: "image-1",
        name: "ansicht.jpg",
        mimeType: "image/jpeg",
        dataUrl: "data:image/jpeg;base64,aW1hZ2UtYnl0ZXM=",
        caption: "Ein Zuhause zum Ankommen",
        isFloorplan: false,
      }],
    }],
    projects: [],
    provider: { company: "Fabian Raebel" },
    promotionImage: {
      id: "promotion-image-1",
      name: "aktion.jpg",
      mimeType: "image/jpeg",
      dataUrl: "data:image/jpeg;base64,YWt0aW9uc2JpbGQ=",
      caption: "Aktuelles Angebot für dein neues Zuhause",
      isFloorplan: false,
    },
    promotionImageEnabled: true,
    promotionImages: [
      {
        id: "promotion-image-1",
        name: "aktion.jpg",
        mimeType: "image/jpeg",
        dataUrl: "data:image/jpeg;base64,YWt0aW9uc2JpbGQ=",
        caption: "Aktuelles Angebot für dein neues Zuhause",
        isFloorplan: false,
      },
      {
        id: "promotion-image-2",
        name: "aktion-zwei.jpg",
        mimeType: "image/jpeg",
        dataUrl: "data:image/jpeg;base64,YWt0aW9uc2JpbGQtemdlaQ==",
        caption: "Zweites Aktionsbild",
        isFloorplan: false,
      },
    ],
  };

  const first = await startCatalogSnapshot({ state, savedAt: "2026-07-22T13:00:00.000Z", expectedSavedAt: "", sessionId: "session-1" }, directory);
  assert.deepEqual(first.missingImageIds, ["image-1", "promotion-image-1", "promotion-image-2"]);
  await saveCatalogImage({ sessionId: "session-1", imageId: "image-1", data: Buffer.from("image-bytes") }, directory);
  await saveCatalogImage({ sessionId: "session-1", imageId: "promotion-image-1", data: Buffer.from("promotion-image-bytes") }, directory);
  await saveCatalogImage({ sessionId: "session-1", imageId: "promotion-image-2", data: Buffer.from("second-promotion-image-bytes") }, directory);
  await commitCatalogSnapshot("session-1", directory);

  const manifest = await loadCatalogManifest(directory);
  assert.equal(manifest.state.houses[0].images[0].dataUrl, "");
  assert.equal(manifest.state.promotionImage.dataUrl, "");
  assert.equal(manifest.state.promotionImages[1].dataUrl, "");
  assert.equal((await loadCatalogImage("image-1", directory)).data.toString("utf8"), "image-bytes");
  assert.equal((await loadCatalogImage("promotion-image-1", directory)).data.toString("utf8"), "promotion-image-bytes");
  assert.equal((await loadCatalogImage("promotion-image-2", directory)).data.toString("utf8"), "second-promotion-image-bytes");

  const updatedState = {
    ...state,
    houses: [{
      ...state.houses[0],
      images: [{ ...state.houses[0].images[0], caption: "Neu formulierter Bildtext" }],
    }],
  };
  await assert.rejects(
    startCatalogSnapshot({ state: updatedState, savedAt: "2026-07-22T13:01:00.000Z", sessionId: "stale-session" }, directory),
    /inzwischen von einer anderen App-Sitzung geändert/,
  );
  const second = await startCatalogSnapshot({ state: updatedState, savedAt: "2026-07-22T13:01:00.000Z", expectedSavedAt: "2026-07-22T13:00:00.000Z", sessionId: "session-2" }, directory);
  assert.deepEqual(second.missingImageIds, []);
  await commitCatalogSnapshot("session-2", directory);
  assert.equal((await loadCatalogManifest(directory)).state.houses[0].images[0].caption, "Neu formulierter Bildtext");
});

test("migrates an existing manifest atomically and keeps a pre-migration backup", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "fabian-pascal-catalog-migration-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const legacyState = {
    version: 1,
    houses: [],
    projects: [{
      id: "project-1",
      street: "Kirschallee",
      houseNumber: "12",
      postalCode: "14469",
      city: "Potsdam",
      plotArea: 651,
      plotPrice: 420000,
      notes: "Altes Hinweisfeld",
      selectedHouseIds: ["house-1", "house-2", "house-3", "house-4", "house-5"],
      listings: [],
      listingGroup: {
        id: "group-1",
        variants: ["house-1", "house-2", "house-3", "house-4", "house-5"].map((templateId, index) => ({
          id: `variant-${index + 1}`,
          templateId,
          active: true,
        })),
        listingControls: [],
        logs: [],
        automation: {},
      },
    }],
    provider: {},
    promotionImage: null,
    promotionImageEnabled: false,
  };
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "manifest.json"), JSON.stringify({
    format: 2,
    savedAt: "2026-07-22T14:00:00.000Z",
    state: legacyState,
  }));

  const result = await migrateCatalogManifest(directory);
  assert.equal(result.migrated, true);
  const migrated = await loadCatalogManifest(directory);
  assert.equal(migrated.state.dataSchemaVersion, 4);
  assert.equal(migrated.state.plotSchemaVersion, 2);
  assert.equal(migrated.state.plots.length, 1);
  assert.equal(migrated.state.projects[0].plotId, migrated.state.plots[0].id);
  assert.equal(Object.hasOwn(migrated.state.projects[0], "notes"), false);
  assert.equal(migrated.state.projects[0].listingGroup.variants.filter((variant) => variant.active).length, 4);
  assert.deepEqual(await readdir(join(directory, "backups")), ["manifest.pre-schema-4.json"]);

  const repeated = await migrateCatalogManifest(directory);
  assert.equal(repeated.migrated, false);
});
