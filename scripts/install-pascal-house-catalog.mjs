import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CATALOG_V2_DIRECTORY,
  commitCatalogSnapshot,
  loadCatalogManifest,
  saveCatalogImage,
  startCatalogSnapshot,
} from "../catalog-store.mjs";
import {
  HOUSE_TEMPLATE_PRESETS,
  houseTemplateFromPreset,
} from "../house-template-presets.mjs";

function argument(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

async function main() {
  if (!process.argv.includes("--replace-active")) {
    throw new Error("Sicherheitsstopp: --replace-active fehlt.");
  }
  const assetRoot = argument(
    "--asset-root",
    fileURLToPath(new URL("../assets/pascal-house-catalog", import.meta.url)),
  );
  const catalogDirectory = argument("--catalog-directory", CATALOG_V2_DIRECTORY);
  const assetManifest = JSON.parse(await readFile(join(assetRoot, "manifest.json"), "utf8"));
  const current = await loadCatalogManifest(catalogDirectory);
  if (!current.stored) throw new Error("Die vorhandene Inseratstudio-Gerätesicherung wurde nicht gefunden.");
  const projectSourceManifest = argument("--project-source-manifest");
  const preservedProjects = projectSourceManifest
    ? JSON.parse(await readFile(projectSourceManifest, "utf8")).state.projects
    : current.state.projects;
  if (!Array.isArray(preservedProjects)) {
    throw new Error("Die zu erhaltenden Adressprojekte sind unvollständig.");
  }

  const imagesByHouse = new Map(assetManifest.houses.map((house) => [
    house.key,
    house.images.map((image) => ({
      id: image.id,
      name: image.sourceName,
      mimeType: image.mimeType,
      dataUrl: "",
      caption: image.caption,
      isFloorplan: image.isFloorplan,
      role: image.role,
      captionLocked: image.captionLocked,
    })),
  ]));
  const activeHouses = HOUSE_TEMPLATE_PRESETS.map((definition) => {
    const images = imagesByHouse.get(definition.key);
    if (!images || images.length < 4 || images.length > 14) {
      throw new Error(`${definition.name}: Der Bildsatz ist unvollständig.`);
    }
    return houseTemplateFromPreset(definition, images);
  });
  const presetIds = new Set(activeHouses.map((house) => house.id));
  const archivedHouses = current.state.houses
    .filter((house) => !presetIds.has(house.id))
    .map((house) => ({ ...house, archived: true }));
  const state = {
    ...current.state,
    houses: [...activeHouses, ...archivedHouses],
    projects: preservedProjects,
  };

  const sessionId = `pascal_sync_${Date.now()}`;
  const started = await startCatalogSnapshot({
    sessionId,
    savedAt: new Date().toISOString(),
    state,
  }, catalogDirectory);
  const assetById = new Map(assetManifest.houses.flatMap((house) => (
    house.images.map((image) => [image.id, image])
  )));
  for (const imageId of started.missingImageIds) {
    const image = assetById.get(imageId);
    if (!image) {
      throw new Error(`Das Bestandsbild ${imageId} fehlt. Der Abgleich wurde nicht aktiviert.`);
    }
    await saveCatalogImage({
      sessionId,
      imageId,
      data: await readFile(join(assetRoot, image.file)),
    }, catalogDirectory);
  }
  await commitCatalogSnapshot(sessionId, catalogDirectory);

  const newImageCount = activeHouses.reduce((sum, house) => sum + house.images.length, 0);
  process.stdout.write(
    `Aktiviert: ${activeHouses.length} Pascal-Haustypen mit ${newImageCount} Bildern. `
    + `${archivedHouses.length} bisherige Haustypen bleiben für die Upload-Historie archiviert. `
    + `${state.projects.length} Adressen wurden unverändert übernommen.\n`,
  );
}

await main();
