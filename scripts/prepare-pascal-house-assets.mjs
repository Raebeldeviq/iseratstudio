import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  captionForImageRole,
  floorplanLevel,
  parseHouseVariant,
} from "../image-sequence.mjs";
import { HOUSE_TEMPLATE_PRESETS } from "../house-template-presets.mjs";

const SUPPORTED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const EMOTIONAL_CAPTIONS = [
  "Architektur zum Ankommen",
  "Ein Zuhause voller Lieblingsplätze",
  "Freiraum für deine schönsten Pläne",
  "Wohngefühl, das jeden Tag begeistert",
  "So fühlt sich Zuhause an",
  "Dein neuer Lieblingsort",
  "Mehr Raum für das gute Leben",
  "Hier wächst Zukunft",
  "Ein Haus mit Wohlfühlfaktor",
  "Platz für alles, was dir wichtig ist",
];

function argument(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

async function walk(directory, root, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) await walk(absolutePath, root, files);
    if (entry.isFile() && SUPPORTED_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      files.push({
        absolutePath,
        relativePath: relative(root, absolutePath).split("\\").join("/"),
        filename: entry.name,
      });
    }
  }
  return files;
}

function isFloorplan(file) {
  return /grundriss|grundrisse|floorplan/i.test(file.relativePath)
    || Boolean(floorplanLevel(file.filename));
}

function variantOf(file) {
  return parseHouseVariant(`${file.filename} ${file.relativePath}`);
}

function candidateRank(file, targetVariant) {
  const variant = variantOf(file);
  const versionRank = variant?.version === targetVariant.version ? 0 : 1;
  const rootRank = file.relativePath.split("/").length <= 2 ? 1 : 0;
  return versionRank * 100 + rootRank * 10;
}

function selectedFiles(definition, files) {
  const targetVariant = parseHouseVariant(definition.name);
  const cover = files.find(
    (file) => file.relativePath === `Haustypen/${definition.coverFilename}`,
  );
  if (!targetVariant || !cover) {
    throw new Error(`${definition.name}: Titelbild oder Haustyp konnte nicht erkannt werden.`);
  }

  const matching = files.filter((file) => {
    const variant = variantOf(file);
    if (file.absolutePath === cover.absolutePath) return false;
    const modelFolderMatch = file.relativePath
      .split("/")
      .slice(1, -1)
      .some((part) => parseHouseVariant(part)?.modelKey === targetVariant.modelKey);
    if (modelFolderMatch) return true;
    return variant?.modelKey === targetVariant.modelKey;
  });
  const houseImages = matching
    .filter((file) => !isFloorplan(file))
    .sort((left, right) => candidateRank(left, targetVariant) - candidateRank(right, targetVariant)
      || left.relativePath.localeCompare(right.relativePath, "de", { numeric: true }));
  const floorplans = matching
    .filter(isFloorplan)
    .sort((left, right) => {
      const levelRank = { ground: 0, upper: 1, attic: 2, "": 3 };
      return levelRank[floorplanLevel(left.filename)] - levelRank[floorplanLevel(right.filename)]
        || left.relativePath.localeCompare(right.relativePath, "de", { numeric: true });
    });

  const floorplanLimit = Math.min(3, floorplans.length);
  const houseLimit = 14 - 1 - floorplanLimit;
  return [cover, ...houseImages.slice(0, houseLimit), ...floorplans.slice(0, floorplanLimit)];
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

function imageRole(file, position) {
  if (position === 0) return "cover";
  if (!isFloorplan(file)) return "other";
  const level = floorplanLevel(file.filename);
  if (level === "upper") return "floorplan_upper";
  if (level === "attic") return "floorplan_third";
  return "floorplan_ground";
}

function imageCaption(role, position, filename) {
  if (role === "cover") return "Dein wundervolles Zuhause";
  if (role.startsWith("floorplan_")) {
    return captionForImageRole(role, filename, "Dein Grundriss");
  }
  return EMOTIONAL_CAPTIONS[(position - 1) % EMOTIONAL_CAPTIONS.length];
}

async function main() {
  const sourceRoot = argument("--source-root");
  const outputRoot = argument(
    "--output-root",
    fileURLToPath(new URL("../assets/pascal-house-catalog", import.meta.url)),
  );
  if (!sourceRoot) throw new Error("--source-root fehlt.");

  const sharp = await loadSharp();
  const files = await walk(sourceRoot, sourceRoot);
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });

  const manifest = {
    format: 1,
    createdAt: new Date().toISOString(),
    source: "Pascal Google Drive / Haustypen",
    houses: [],
  };
  for (const definition of HOUSE_TEMPLATE_PRESETS) {
    const candidates = selectedFiles(definition, files);
    const houseDirectory = join(outputRoot, definition.key);
    await mkdir(houseDirectory, { recursive: true });
    const seenHashes = new Set();
    const images = [];
    for (const candidate of candidates) {
      const sourceData = await readFile(candidate.absolutePath);
      const sourceHash = createHash("sha256").update(sourceData).digest("hex");
      if (seenHashes.has(sourceHash)) continue;
      seenHashes.add(sourceHash);

      const role = imageRole(candidate, images.length);
      const filename = `${String(images.length + 1).padStart(2, "0")}-${createHash("sha256")
        .update(`${definition.key}:${candidate.relativePath}`)
        .digest("hex")
        .slice(0, 12)}.webp`;
      const destination = join(houseDirectory, filename);
      const maximum = role.startsWith("floorplan_") ? 2400 : 1920;
      const quality = role.startsWith("floorplan_") ? 92 : 84;
      await sharp(sourceData)
        .rotate()
        .resize({ width: maximum, height: maximum, fit: "inside", withoutEnlargement: true })
        .webp({ quality, alphaQuality: 100, smartSubsample: true })
        .toFile(destination);
      images.push({
        id: `pascal_${createHash("sha256")
          .update(`${definition.key}:${candidate.relativePath}`)
          .digest("hex")
          .slice(0, 24)}`,
        file: `${definition.key}/${filename}`,
        sourceName: candidate.filename,
        sourcePath: candidate.relativePath,
        mimeType: "image/webp",
        caption: imageCaption(role, images.length, candidate.filename),
        isFloorplan: role.startsWith("floorplan_"),
        role,
        captionLocked: role.startsWith("floorplan_"),
      });
      if (images.length >= 14) break;
    }
    if (images.length < 4) {
      const cover = candidates[0];
      const sourceData = await readFile(cover.absolutePath);
      while (images.length < 4) {
        const derivativeNumber = images.length + 1;
        const filename = `${String(derivativeNumber).padStart(2, "0")}-architekturdetail.webp`;
        await sharp(sourceData)
          .rotate()
          .resize({
            width: 1600,
            height: 1100,
            fit: "cover",
            position: derivativeNumber % 2 ? "attention" : "centre",
          })
          .webp({ quality: 86, alphaQuality: 100, smartSubsample: true })
          .toFile(join(houseDirectory, filename));
        images.push({
          id: `pascal_${createHash("sha256")
            .update(`${definition.key}:architekturdetail:${derivativeNumber}`)
            .digest("hex")
            .slice(0, 24)}`,
          file: `${definition.key}/${filename}`,
          sourceName: `${cover.filename} – Architekturdetail`,
          sourcePath: `${cover.relativePath}#architekturdetail-${derivativeNumber}`,
          mimeType: "image/webp",
          caption: EMOTIONAL_CAPTIONS[(derivativeNumber - 1) % EMOTIONAL_CAPTIONS.length],
          isFloorplan: false,
          role: "other",
          captionLocked: false,
        });
      }
    }
    if (images.length < 4) {
      throw new Error(`${definition.name}: Nur ${images.length} unterschiedliche Bilder gefunden.`);
    }
    manifest.houses.push({ key: definition.key, images });
    process.stdout.write(`${definition.name}: ${images.length} Bilder\n`);
  }
  await writeFile(
    join(outputRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`Fertig: ${manifest.houses.length} Haustypen in ${outputRoot}\n`);
}

await main();
