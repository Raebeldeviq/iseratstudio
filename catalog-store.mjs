import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { gunzip, gzip } from "node:zlib";
import { promisify } from "node:util";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const applicationData = process.env.LOCALAPPDATA
  || join(homedir(), "AppData", "Local");

export const CATALOG_PATH = join(
  applicationData,
  "Fabian-Pascal Inseratestudio",
  "catalog.json.gz",
);

export const CATALOG_V2_DIRECTORY = join(
  applicationData,
  "Fabian-Pascal Inseratestudio",
  "catalog-v2",
);

const MANIFEST_FILENAME = "manifest.json";
const IMAGES_DIRECTORY = "images";

function validState(state) {
  return state
    && state.version === 1
    && Array.isArray(state.houses)
    && Array.isArray(state.projects)
    && state.provider
    && typeof state.provider === "object";
}

function normalizeSavedAt(value) {
  const date = new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function safeId(value, label) {
  const id = String(value ?? "");
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(id)) throw new Error(`${label} ist ungültig.`);
  return id;
}

function withoutImageData(state) {
  return {
    ...state,
    promotionImage: state.promotionImage
      ? { ...state.promotionImage, dataUrl: "" }
      : null,
    houses: state.houses.map((house) => ({
      ...house,
      images: Array.isArray(house.images)
        ? house.images.map((image) => ({ ...image, dataUrl: "" }))
        : [],
    })),
  };
}

function imageEntries(state) {
  const images = [
    ...state.houses.flatMap((house) => house.images),
    ...(state.promotionImage ? [state.promotionImage] : []),
  ];
  return [...new Map(images.map((image) => {
    const entry = {
      id: safeId(image.id, "Bild-ID"),
      mimeType: String(image.mimeType || "application/octet-stream").slice(0, 120),
    };
    return [entry.id, entry];
  })).values()];
}

function pendingManifestPath(catalogDirectory, sessionId) {
  return join(catalogDirectory, `manifest.${safeId(sessionId, "Sicherungssitzung")}.pending.json`);
}

function imagePath(catalogDirectory, imageId) {
  return join(catalogDirectory, IMAGES_DIRECTORY, `${safeId(imageId, "Bild-ID")}.bin`);
}

async function fileExistsWithContent(path) {
  try {
    return (await stat(path)).size > 0;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function readV2Manifest(path) {
  const manifest = JSON.parse(await readFile(path, "utf8"));
  if (manifest?.format !== 2 || !validState(manifest.state)) {
    throw new Error("Die lokale Inseratstudio-Sicherung ist beschädigt.");
  }
  return manifest;
}

export async function startCatalogSnapshot(input, catalogDirectory = CATALOG_V2_DIRECTORY) {
  const state = input?.state;
  if (!validState(state)) throw new Error("Die lokale Inseratstudio-Sicherung ist unvollständig.");
  const sessionId = safeId(input.sessionId, "Sicherungssitzung");
  const manifest = {
    format: 2,
    savedAt: normalizeSavedAt(input.savedAt),
    state: withoutImageData(state),
  };
  await mkdir(join(catalogDirectory, IMAGES_DIRECTORY), { recursive: true });
  await writeFile(
    pendingManifestPath(catalogDirectory, sessionId),
    JSON.stringify(manifest),
    { encoding: "utf8", mode: 0o600 },
  );

  const missingImageIds = [];
  for (const image of imageEntries(manifest.state)) {
    if (!await fileExistsWithContent(imagePath(catalogDirectory, image.id))) {
      missingImageIds.push(image.id);
    }
  }
  return { savedAt: manifest.savedAt, missingImageIds };
}

export async function saveCatalogImage(input, catalogDirectory = CATALOG_V2_DIRECTORY) {
  const sessionId = safeId(input.sessionId, "Sicherungssitzung");
  const imageId = safeId(input.imageId, "Bild-ID");
  const manifest = await readV2Manifest(pendingManifestPath(catalogDirectory, sessionId));
  if (!imageEntries(manifest.state).some((image) => image.id === imageId)) {
    throw new Error("Das Bild gehört nicht zu dieser Sicherung.");
  }
  const data = Buffer.isBuffer(input.data) ? input.data : Buffer.from(input.data ?? []);
  if (!data.length) throw new Error("Die Bilddatei ist leer.");

  const destination = imagePath(catalogDirectory, imageId);
  if (await fileExistsWithContent(destination)) return { bytes: (await stat(destination)).size };
  const temporaryPath = `${destination}.${sessionId}.tmp`;
  try {
    await writeFile(temporaryPath, data, { mode: 0o600 });
    await rename(temporaryPath, destination);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    if (await fileExistsWithContent(destination)) return { bytes: (await stat(destination)).size };
    throw error;
  }
  return { bytes: data.length };
}

export async function commitCatalogSnapshot(sessionIdValue, catalogDirectory = CATALOG_V2_DIRECTORY) {
  const sessionId = safeId(sessionIdValue, "Sicherungssitzung");
  const pendingPath = pendingManifestPath(catalogDirectory, sessionId);
  const manifest = await readV2Manifest(pendingPath);
  for (const image of imageEntries(manifest.state)) {
    if (!await fileExistsWithContent(imagePath(catalogDirectory, image.id))) {
      throw new Error(`Bild ${image.id} fehlt in der lokalen Sicherung.`);
    }
  }

  const manifestPath = join(catalogDirectory, MANIFEST_FILENAME);
  const previousPath = `${manifestPath}.previous`;
  await rm(previousPath, { force: true });
  try {
    await rename(manifestPath, previousPath);
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  try {
    await rename(pendingPath, manifestPath);
    await rm(previousPath, { force: true });
  } catch (error) {
    if (await fileExistsWithContent(previousPath)) await rename(previousPath, manifestPath);
    throw error;
  }

  const liveImageIds = new Set(imageEntries(manifest.state).map((image) => `${image.id}.bin`));
  for (const filename of await readdir(join(catalogDirectory, IMAGES_DIRECTORY))) {
    if (/^[a-zA-Z0-9_-]{1,120}\.bin$/.test(filename) && !liveImageIds.has(filename)) {
      await rm(join(catalogDirectory, IMAGES_DIRECTORY, filename), { force: true });
    }
  }
  return { savedAt: manifest.savedAt };
}

export async function loadCatalogManifest(catalogDirectory = CATALOG_V2_DIRECTORY) {
  let manifest;
  try {
    manifest = await readV2Manifest(join(catalogDirectory, MANIFEST_FILENAME));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { stored: false };
    }
    throw error;
  }
  return {
    stored: true,
    savedAt: normalizeSavedAt(manifest.savedAt),
    state: manifest.state,
  };
}

export async function loadCatalogImage(imageIdValue, catalogDirectory = CATALOG_V2_DIRECTORY) {
  const imageId = safeId(imageIdValue, "Bild-ID");
  const manifest = await readV2Manifest(join(catalogDirectory, MANIFEST_FILENAME));
  const image = imageEntries(manifest.state).find((entry) => entry.id === imageId);
  if (!image) throw new Error("Das Bild gehört nicht zur aktuellen Sicherung.");
  return {
    data: await readFile(imagePath(catalogDirectory, imageId)),
    mimeType: image.mimeType,
  };
}

export async function saveCatalogSnapshot(input, catalogPath = CATALOG_PATH) {
  const state = input?.state;
  if (!validState(state)) throw new Error("Die lokale Inseratstudio-Sicherung ist unvollständig.");
  const snapshot = {
    format: 1,
    savedAt: normalizeSavedAt(input.savedAt),
    state,
  };
  const compressed = await gzipAsync(Buffer.from(JSON.stringify(snapshot), "utf8"), { level: 6 });
  await mkdir(dirname(catalogPath), { recursive: true });
  const temporaryPath = `${catalogPath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, compressed, { mode: 0o600 });
    await rename(temporaryPath, catalogPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
  return { savedAt: snapshot.savedAt, bytes: compressed.length };
}

export async function loadCatalogSnapshot(catalogPath = CATALOG_PATH) {
  let compressed;
  try {
    compressed = await readFile(catalogPath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { stored: false };
    }
    throw error;
  }
  const snapshot = JSON.parse((await gunzipAsync(compressed)).toString("utf8"));
  if (snapshot?.format !== 1 || !validState(snapshot.state)) {
    throw new Error("Die lokale Inseratstudio-Sicherung ist beschädigt.");
  }
  return {
    stored: true,
    savedAt: normalizeSavedAt(snapshot.savedAt),
    state: snapshot.state,
  };
}
