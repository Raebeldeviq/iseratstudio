import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildHouseTemplatePresets } from "../house-template-presets.mjs";
import { indexMediaLibrary } from "../media-library.mjs";

function argument(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

async function loadSharp() {
  const requestedModule = argument("--sharp-module");
  if (requestedModule) {
    return (await import(pathToFileURL(requestedModule).href)).default;
  }
  try {
    return (await import("sharp")).default;
  } catch {
    throw new Error("Sharp fehlt. Bitte --sharp-module mit dem absoluten Pfad zu sharp/lib/index.js angeben.");
  }
}

function assertHydratedImage(data, filename) {
  if (data.length < 1024
    && data.subarray(0, 100).toString("utf8").startsWith("version https://git-lfs.github.com/spec/v1")) {
    throw new Error(`Bild ${filename} ist nur ein Git-LFS-Zeiger. Bitte zuerst „git lfs pull“ ausführen.`);
  }
}

async function main() {
  const outputRoot = argument(
    "--output-root",
    fileURLToPath(new URL("../assets/bundled-house-catalog", import.meta.url)),
  );
  const sharp = await loadSharp();
  const mediaItems = await indexMediaLibrary();
  const houses = buildHouseTemplatePresets(mediaItems);
  const mediaById = new Map(mediaItems.map((item) => [item.id, item]));

  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(join(outputRoot, "images"), { recursive: true });

  const preparedByImageId = new Map();
  let outputBytes = 0;
  const manifest = {
    format: 2,
    createdAt: new Date().toISOString(),
    source: "Integrierter Git-LFS-Medienkatalog",
    houses: [],
  };

  for (const house of houses) {
    const images = [];
    for (const image of house.images) {
      const source = mediaById.get(image.sourceId);
      if (!source) throw new Error(`${house.name}: Quelldatei für ${image.name} fehlt.`);
      let prepared = preparedByImageId.get(image.id);
      if (!prepared) {
        const sourceData = await readFile(source.absolutePath);
        assertHydratedImage(sourceData, source.filename);
        const file = `images/${image.id}.webp`;
        const destination = join(outputRoot, file);
        const maximum = image.isFloorplan ? 2400 : 1920;
        const quality = image.isFloorplan ? 92 : 84;
        await sharp(sourceData)
          .rotate()
          .resize({ width: maximum, height: maximum, fit: "inside", withoutEnlargement: true })
          .webp({ quality, alphaQuality: 100, smartSubsample: true })
          .toFile(destination);
        outputBytes += (await stat(destination)).size;
        prepared = {
          id: image.id,
          sourceId: image.sourceId,
          sourceName: image.name,
          sourcePath: source.relativePath,
          file,
          mimeType: "image/webp",
        };
        preparedByImageId.set(image.id, prepared);
      }
      images.push({
        ...prepared,
        caption: image.caption,
        isFloorplan: image.isFloorplan,
        role: image.role,
        captionLocked: image.captionLocked === true,
      });
    }
    if (images.length < 4 || images.length > 14) {
      throw new Error(`${house.name}: Der Bildsatz enthält ${images.length} statt 4 bis 14 Bilder.`);
    }
    manifest.houses.push({
      key: house.id.replace(/^preset_house_/, "").replaceAll("_", "-"),
      name: house.name,
      images,
    });
    process.stdout.write(`${house.name}: ${images.length} Bilder\n`);
  }

  await writeFile(
    join(outputRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(
    `Fertig: ${houses.length} Haustypen, ${preparedByImageId.size} eindeutige Bilder, `
    + `${(outputBytes / 1024 / 1024).toFixed(1)} MB.\n`,
  );
}

await main();
