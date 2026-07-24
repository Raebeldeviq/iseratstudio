import { readFile } from "node:fs/promises";
import {
  commitCatalogSnapshot,
  loadCatalogManifest,
  saveCatalogImage,
  startCatalogSnapshot,
} from "../catalog-store.mjs";
import {
  buildHouseTemplatePresets,
  isEmptyHousePlaceholder,
} from "../house-template-presets.mjs";
import { indexMediaLibrary } from "../media-library.mjs";

export async function installHousePresets({
  replacePlaceholders = false,
  catalogDirectory,
  mediaRoot,
  interiorRoot,
} = {}) {
  if (!replacePlaceholders) {
    throw new Error("Abbruch: Die bewusste Freigabe --replace-placeholders fehlt.");
  }

  const current = await loadCatalogManifest(catalogDirectory);
  if (!current.stored) {
    throw new Error("Abbruch: Es existiert noch kein lokaler App-Katalog.");
  }
  if (!current.state.houses.length || !current.state.houses.every(isEmptyHousePlaceholder)) {
    throw new Error("Abbruch: Der Katalog enthält mindestens einen echten Haustyp und wird nicht überschrieben.");
  }

  const mediaItems = await indexMediaLibrary(mediaRoot, interiorRoot);
  const houses = buildHouseTemplatePresets(mediaItems);
  const removedHouseIds = new Set(current.state.houses.map((house) => house.id));
  const state = {
    ...current.state,
    houses,
    projects: current.state.projects.map((project) => ({
      ...project,
      selectedHouseIds: project.selectedHouseIds.filter((id) => !removedHouseIds.has(id)),
      listings: project.listings.filter((listing) => !removedHouseIds.has(listing.templateId)),
    })),
  };

  const sessionId = `preset_${Date.now()}`;
  const savedAt = new Date().toISOString();
  const started = await startCatalogSnapshot(
    { sessionId, savedAt, expectedSavedAt: current.savedAt, state },
    catalogDirectory,
  );
  const sourceByImageId = new Map();
  for (const house of houses) {
    for (const image of house.images) sourceByImageId.set(image.id, image.sourceId);
  }
  const mediaById = new Map(mediaItems.map((item) => [item.id, item]));
  let bytes = 0;
  for (const imageId of started.missingImageIds) {
    const sourceId = sourceByImageId.get(imageId);
    const item = mediaById.get(sourceId);
    if (!item) throw new Error(`Quelldatei für Bild ${imageId} fehlt.`);
    const result = await saveCatalogImage(
      { sessionId, imageId, data: await readFile(item.absolutePath) },
      catalogDirectory,
    );
    bytes += result.bytes;
  }
  await commitCatalogSnapshot(sessionId, catalogDirectory);

  return {
    houses: houses.length,
    uniqueImages: sourceByImageId.size,
    copiedImages: started.missingImageIds.length,
    copiedBytes: bytes,
    savedAt,
  };
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    const result = await installHousePresets({
      replacePlaceholders: process.argv.includes("--replace-placeholders"),
    });
    console.log(`Vorlagen installiert: ${result.houses} Häuser, ${result.uniqueImages} eindeutige Bilder.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
