import { readFile } from "node:fs/promises";
import {
  commitCatalogSnapshot,
  loadCatalogManifest,
  saveCatalogImage,
  startCatalogSnapshot,
} from "../catalog-store.mjs";
import { buildHouseTemplatePresets } from "../house-template-presets.mjs";
import { indexMediaLibrary } from "../media-library.mjs";
import { createInitialStudioState } from "../studio-defaults.mjs";

const BUNDLED_CATALOG_DATE = "2026-07-24T00:00:00.000Z";

function assertHydratedImage(data, filename) {
  if (data.subarray(0, 100).toString("utf8").startsWith("version https://git-lfs.github.com/spec/v1")) {
    throw new Error(`Bild ${filename} ist nur ein Git-LFS-Zeiger. Bitte im App-Ordner zuerst „git lfs pull“ ausführen.`);
  }
}

export async function persistBundledStarterCatalog({
  catalogDirectory,
  houses,
  mediaItems,
  savedAt = BUNDLED_CATALOG_DATE,
} = {}) {
  const current = await loadCatalogManifest(catalogDirectory);
  const existingHouseIds = new Set((current.state?.houses || []).map((house) => house.id));
  const missingHouses = current.stored ? houses.filter((house) => !existingHouseIds.has(house.id)) : houses;
  if (current.stored && !missingHouses.length) return { created: false, updated: false, addedHouses: 0, houses: current.state.houses.length };

  const state = current.stored
    ? { ...current.state, houses: [...current.state.houses, ...missingHouses] }
    : createInitialStudioState({ houses });
  const sessionId = `bundled_${Date.now()}`;
  const started = await startCatalogSnapshot(
    { sessionId, savedAt: current.stored ? new Date().toISOString() : savedAt, expectedSavedAt: current.savedAt || "", state },
    catalogDirectory,
  );
  const sourceByImageId = new Map();
  for (const house of missingHouses) {
    for (const image of house.images) sourceByImageId.set(image.id, image.sourceId);
  }
  const mediaById = new Map(mediaItems.map((item) => [item.id, item]));
  let copiedBytes = 0;
  for (const imageId of started.missingImageIds) {
    const sourceId = sourceByImageId.get(imageId);
    const item = mediaById.get(sourceId);
    if (!item) throw new Error(`Quelldatei für Bild ${imageId} fehlt.`);
    const data = await readFile(item.absolutePath);
    assertHydratedImage(data, item.filename);
    const result = await saveCatalogImage(
      { sessionId, imageId, data },
      catalogDirectory,
    );
    copiedBytes += result.bytes;
  }
  await commitCatalogSnapshot(sessionId, catalogDirectory);
  return {
    created: !current.stored,
    updated: current.stored,
    addedHouses: missingHouses.length,
    houses: state.houses.length,
    uniqueImages: sourceByImageId.size,
    copiedImages: started.missingImageIds.length,
    copiedBytes,
  };
}

export async function ensureBundledStarterCatalog({
  catalogDirectory,
  mediaRoot,
  interiorRoot,
} = {}) {
  const mediaItems = await indexMediaLibrary(mediaRoot, interiorRoot);
  const houses = buildHouseTemplatePresets(mediaItems);
  return persistBundledStarterCatalog({ catalogDirectory, houses, mediaItems });
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    const result = await ensureBundledStarterCatalog();
    if (result.created || result.updated) {
      console.log(`Integrierter Katalog aktualisiert: ${result.houses} Häuser, ${result.addedHouses || result.houses} ergänzt.`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
