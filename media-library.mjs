import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
} from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  buildRecommendedMediaSequence,
  inferImageRole,
  INTERIOR_IMAGE_ROLES,
} from "./image-sequence.mjs";
import { resolveHousePrice } from "./house-price-catalog.mjs";
import { APPLICATION_DATA_DIRECTORY } from "./platform-paths.mjs";

const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
export const BUNDLED_MEDIA_LIBRARY_ROOT = join(MODULE_DIRECTORY, "bundled-media", "advertisements");
export const BUNDLED_INTERIOR_LIBRARY_ROOT = join(MODULE_DIRECTORY, "bundled-media", "interiors");
export const LEGACY_MEDIA_LIBRARY_ROOT =
  "/Users/pascalfrohlich/Library/Mobile Documents/com~apple~CloudDocs/Life Business-System/01_HANDELSVERTRETUNG/03_MARKETING/04_ANZEIGEN";
export const LEGACY_INTERIOR_LIBRARY_ROOT =
  "/Users/pascalfrohlich/Library/Mobile Documents/com~apple~CloudDocs/Life Business-System/01_HANDELSVERTRETUNG/03_MARKETING/01_RENDERING/Inneneinrichtung";
export const DEFAULT_MEDIA_LIBRARY_ROOT = process.env.FPI_MEDIA_LIBRARY_ROOT
  || (existsSync(BUNDLED_MEDIA_LIBRARY_ROOT) ? BUNDLED_MEDIA_LIBRARY_ROOT : LEGACY_MEDIA_LIBRARY_ROOT);
export const DEFAULT_INTERIOR_LIBRARY_ROOT = process.env.FPI_INTERIOR_LIBRARY_ROOT
  || (existsSync(BUNDLED_INTERIOR_LIBRARY_ROOT) ? BUNDLED_INTERIOR_LIBRARY_ROOT : LEGACY_INTERIOR_LIBRARY_ROOT);
export const MANAGED_MEDIA_LIBRARY_ROOT = join(
  APPLICATION_DATA_DIRECTORY,
  "media-library",
  "uploads",
);
export const MEDIA_LIBRARY_TOMBSTONE_PATH = join(
  APPLICATION_DATA_DIRECTORY,
  "media-library",
  "tombstones.json",
);

const SUPPORTED_EXTENSIONS = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);
const MANAGED_MEDIA_KINDS = new Set([
  "house",
  "floorplan",
  "interior",
  "location",
  "marketing",
]);
const MANAGED_FILENAME_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}--/i;
const MAX_MANAGED_MEDIA_BYTES = 100 * 1024 * 1024;
const MAX_DUPLICATE_DELETE_ITEMS = 1_000;
const CACHE_LIFETIME_MS = 15 * 60_000;
const cacheByRoot = new Map();
const mediaContentHashCache = new Map();
const execFileAsync = promisify(execFile);
let mediaMutationQueue = Promise.resolve();

function cleanLabel(value) {
  return String(value)
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mediaLibraryError(message, httpStatus = 400) {
  const error = new Error(message);
  error.httpStatus = httpStatus;
  return error;
}

function serializedMediaMutation(task) {
  const result = mediaMutationQueue.then(task, task);
  mediaMutationQueue = result.catch(() => undefined);
  return result;
}

function normalizedMimeType(value) {
  return String(value || "")
    .split(";", 1)[0]
    .trim()
    .toLocaleLowerCase("en-US");
}

function detectedImageMimeType(data) {
  if (
    data.length >= 8
    && data[0] === 0x89
    && data[1] === 0x50
    && data[2] === 0x4e
    && data[3] === 0x47
    && data[4] === 0x0d
    && data[5] === 0x0a
    && data[6] === 0x1a
    && data[7] === 0x0a
  ) {
    return "image/png";
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    data.length >= 12
    && data.subarray(0, 4).toString("ascii") === "RIFF"
    && data.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return "";
}

function isGitLfsPointer(data) {
  return data.length < 1024
    && data.subarray(0, 100).toString("utf8")
      .startsWith("version https://git-lfs.github.com/spec/v1");
}

async function streamFileHash(path) {
  return new Promise((resolve, reject) => {
    const digest = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(digest.digest("hex")));
  });
}

async function mediaFileFingerprint(item, { force = false } = {}) {
  let fileStats;
  try {
    fileStats = await lstat(item.absolutePath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  if (!fileStats.isFile() || fileStats.isSymbolicLink()) return null;

  const cacheKey = `${item.id}\0${item.absolutePath}`;
  const cached = mediaContentHashCache.get(cacheKey);
  if (
    !force
    && cached
    && cached.bytes === fileStats.size
    && cached.mtimeMs === fileStats.mtimeMs
  ) {
    return cached;
  }

  if (fileStats.size < 1024) {
    const data = await readFile(item.absolutePath);
    if (isGitLfsPointer(data)) return null;
  }
  const fingerprint = {
    bytes: fileStats.size,
    mtimeMs: fileStats.mtimeMs,
    contentHash: await streamFileHash(item.absolutePath),
  };
  mediaContentHashCache.set(cacheKey, fingerprint);
  return fingerprint;
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), values.length) },
      () => worker(),
    ),
  );
  return results;
}

function mediaReferenceCount(referenceCounts, id) {
  if (referenceCounts instanceof Map) return Number(referenceCounts.get(id)) || 0;
  if (referenceCounts && typeof referenceCounts === "object") {
    return Number(referenceCounts[id]) || 0;
  }
  return 0;
}

function safeManagedFilename(value) {
  const filename = String(value || "").normalize("NFC").trim();
  if (
    !filename
    || filename.length > 180
    || filename.includes("\0")
    || filename.includes("/")
    || filename.includes("\\")
    || isAbsolute(filename)
    || /^[a-zA-Z]:/.test(filename)
    || filename === "."
    || filename === ".."
  ) {
    throw mediaLibraryError("Der Dateiname des Bildes ist ungültig.");
  }

  const extension = extname(filename).toLocaleLowerCase("en-US");
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw mediaLibraryError("Es können nur JPEG-, PNG- und WebP-Bilder gespeichert werden.");
  }
  const stem = filename.slice(0, -extension.length).trim();
  if (
    !stem
    || /[<>:"|?*\u0000-\u001f]/.test(stem)
    || /[. ]$/.test(stem)
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)
  ) {
    throw mediaLibraryError("Der Bilddateiname ist unter Windows nicht zulässig.");
  }
  return {
    filename: `${stem}${extension}`,
    extension,
    mimeType: SUPPORTED_EXTENSIONS.get(extension),
  };
}

function safeManagedGroup(value) {
  const group = String(value || "Eigene Bilder").normalize("NFC").trim();
  if (
    !group
    || group.length > 80
    || group.includes("\0")
    || group.includes("/")
    || group.includes("\\")
    || isAbsolute(group)
    || /^[a-zA-Z]:/.test(group)
    || group === "."
    || group === ".."
    || /[<>:"|?*\u0000-\u001f]/.test(group)
    || /[. ]$/.test(group)
  ) {
    throw mediaLibraryError("Die Mediengruppe ist ungültig.");
  }
  return group;
}

function safeManagedKind(value) {
  const kind = String(value || "marketing").trim();
  if (!MANAGED_MEDIA_KINDS.has(kind)) {
    throw mediaLibraryError("Die Bildart ist ungültig.");
  }
  return kind;
}

async function readTombstoneIds(tombstonePath) {
  if (!tombstonePath) return new Set();
  try {
    const data = JSON.parse(await readFile(tombstonePath, "utf8"));
    if (data?.format !== 1 || !Array.isArray(data.hiddenIds)) {
      throw new Error("invalid tombstone format");
    }
    return new Set(data.hiddenIds.filter((id) => /^[a-f0-9]{32}$/i.test(String(id))));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return new Set();
    }
    throw mediaLibraryError("Die Liste dauerhaft gelöschter Medien ist beschädigt.");
  }
}

async function replaceFileAtomically(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const previousPath = `${path}.previous`;
  await writeFile(temporaryPath, contents, { encoding: "utf8", mode: 0o600 });
  await rm(previousPath, { force: true });
  try {
    await rename(path, previousPath);
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }
  try {
    await rename(temporaryPath, path);
    await rm(previousPath, { force: true });
  } catch (error) {
    await rm(temporaryPath, { force: true });
    try {
      await rename(previousPath, path);
    } catch (restoreError) {
      if (
        !restoreError
        || typeof restoreError !== "object"
        || !("code" in restoreError)
        || restoreError.code !== "ENOENT"
      ) {
        throw restoreError;
      }
    }
    throw error;
  }
}

async function saveTombstoneIds(tombstonePath, ids) {
  await replaceFileAtomically(
    tombstonePath,
    JSON.stringify({
      format: 1,
      updatedAt: new Date().toISOString(),
      hiddenIds: [...ids].sort(),
    }),
  );
}

function classify(relativePath, source) {
  if (source === "interior") {
    return {
      collection: "Inneneinrichtung",
      family: "",
      houseModel: "",
      group: "Inneneinrichtung",
      kind: "interior",
    };
  }

  const parts = relativePath.split("/");
  if (source === "managed") {
    const kind = MANAGED_MEDIA_KINDS.has(parts[0]) ? parts[0] : "marketing";
    const group = cleanLabel(parts[1] || "Eigene Bilder");
    return {
      collection: "Eigene Medien",
      family: "",
      houseModel: "",
      group,
      kind,
    };
  }

  const normalizedParts = parts.map((part) => part.toLocaleLowerCase("de-DE"));
  const isFloorplan = normalizedParts.some((part) => /grundriss|grundrisse|floorplan/.test(part))
    || /(?:^|[_\s-])(?:eg\d?|og\d?|dg\d?)(?=[_\s.-]|$)/i.test(parts.at(-1) || "");

  if (parts[0] === "Haustypen") {
    if (parts.length === 2) {
      return {
        collection: "Haustypen",
        family: "",
        houseModel: "",
        group: "Haustypen · Übersicht",
        kind: "house",
      };
    }
    const family = parts[1] || "Haustypen";
    const houseModel = parts[2] || "Übersicht";
    return {
      collection: "Haustypen",
      family,
      houseModel: houseModel === "Übersicht" ? "" : houseModel,
      group: houseModel === "Übersicht" ? "Haustypen · Übersicht" : `${family} · ${houseModel}`,
      kind: isFloorplan ? "floorplan" : "house",
    };
  }

  if (parts.length > 1) {
    const group = cleanLabel(parts[0]);
    return {
      collection: group,
      family: "",
      houseModel: "",
      group,
      kind: parts[0] === "26_05_Hausbesichtigung" ? "marketing" : "location",
    };
  }

  return {
    collection: "Allgemeine Anzeigen",
    family: "",
    houseModel: "",
    group: "Allgemeine Anzeigen",
    kind: "marketing",
  };
}

function appendFileToIndex(absolutePath, root, output, source) {
  const extension = extname(absolutePath).toLocaleLowerCase("de-DE");
  const mimeType = SUPPORTED_EXTENSIONS.get(extension);
  if (!mimeType) return;
  const storedRelativePath = relative(root, absolutePath).split("\\").join("/");
  const storedFilename = basename(absolutePath);
  const filename = source === "managed"
    ? storedFilename.replace(MANAGED_FILENAME_PREFIX, "")
    : storedFilename;
  const relativePath = source === "managed"
    ? [...storedRelativePath.split("/").slice(0, -1), filename].join("/")
    : storedRelativePath;
  let classification = classify(storedRelativePath, source);
  const role = inferImageRole({
    filename,
    relativePath,
    kind: classification.kind,
  });
  if (INTERIOR_IMAGE_ROLES.includes(role) && classification.kind === "marketing") {
    classification = { ...classification, kind: "interior" };
  }
  const idSource = source === "interior"
    ? `interior:${storedRelativePath}`
    : source === "managed"
      ? `managed:${storedRelativePath}`
      : storedRelativePath;
  output.push({
    id: createHash("sha256").update(idSource).digest("hex").slice(0, 32),
    absolutePath,
    relativePath,
    filename,
    caption: cleanLabel(filename),
    mimeType,
    ...classification,
    role,
    managed: source === "managed",
    deletable: true,
    brandedCover: classification.kind === "house"
      && (
        /mit logo/i.test(filename)
        || (extension === ".png" && /^(?:sun|sol)\s*\d+/i.test(filename))
      ),
  });
}

async function walkWithNode(directory, root, output, source) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walkWithNode(absolutePath, root, output, source);
      continue;
    }
    if (entry.isFile()) appendFileToIndex(absolutePath, root, output, source);
  }
}

async function scanFiles(root, output, source) {
  if (process.platform !== "darwin") {
    await walkWithNode(root, root, output, source);
    return;
  }

  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      "/usr/bin/find",
      [root, "-type", "f", "-print0"],
      { encoding: "buffer", maxBuffer: 20 * 1024 * 1024, timeout: 8_000 },
    ));
  } catch (error) {
    if (error && typeof error === "object" && (error.killed || error.signal)) {
      throw new Error(
        "macOS hat den Zugriff auf das konfigurierte Medienverzeichnis nicht rechtzeitig freigegeben. Bitte Git LFS und die lokalen Dateiberechtigungen prüfen.",
      );
    }
    throw error;
  }
  for (const absolutePath of Buffer.from(stdout).toString("utf8").split("\0")) {
    if (absolutePath) appendFileToIndex(absolutePath, root, output, source);
  }
}

function configuredRoots(root, interiorRoot, managedRoot) {
  const roots = root
    ? [
      { root, source: "advertisements", required: true },
      ...(interiorRoot ? [{ root: interiorRoot, source: "interior", required: true }] : []),
    ]
    : [
      { root: DEFAULT_MEDIA_LIBRARY_ROOT, source: "advertisements", required: true },
      { root: DEFAULT_INTERIOR_LIBRARY_ROOT, source: "interior", required: false },
    ];
  if (managedRoot) roots.push({ root: managedRoot, source: "managed", required: false });
  return roots;
}

function resolvedIndexOptions(root, options = {}) {
  return {
    managedRoot: options.managedRoot === undefined
      ? (root ? "" : MANAGED_MEDIA_LIBRARY_ROOT)
      : String(options.managedRoot || ""),
    tombstonePath: options.tombstonePath === undefined
      ? (root ? "" : MEDIA_LIBRARY_TOMBSTONE_PATH)
      : String(options.tombstonePath || ""),
  };
}

export async function indexMediaLibrary(root, interiorRoot, options = {}) {
  const { managedRoot, tombstonePath } = resolvedIndexOptions(root, options);
  const roots = configuredRoots(root, interiorRoot, managedRoot);
  const cacheKey = [
    ...roots.map((entry) => `${entry.source}:${entry.root}`),
    `tombstones:${tombstonePath}`,
  ].join("|");
  const now = Date.now();
  const cached = cacheByRoot.get(cacheKey);
  if (cached && now - cached.createdAt < CACHE_LIFETIME_MS) return cached.items;

  const items = [];
  for (const entry of roots) {
    try {
      const rootStats = await stat(entry.root);
      if (!rootStats.isDirectory()) throw new Error("Der konfigurierte Medienpfad ist kein Ordner.");
      await scanFiles(entry.root, items, entry.source);
    } catch (error) {
      if (
        !entry.required
        && error
        && typeof error === "object"
        && "code" in error
        && error.code === "ENOENT"
      ) {
        continue;
      }
      throw error;
    }
  }
  const hiddenIds = await readTombstoneIds(tombstonePath);
  const visibleItems = items.filter((item) => !hiddenIds.has(item.id));
  visibleItems.sort((left, right) => (
    left.relativePath.localeCompare(right.relativePath, "de", { numeric: true })
  ));
  cacheByRoot.set(cacheKey, { createdAt: now, items: visibleItems });
  return visibleItems;
}

export async function queryMediaLibrary({
  root,
  interiorRoot,
  managedRoot,
  tombstonePath,
  query = "",
  group = "",
  kind = "",
  page = 1,
  pageSize = 36,
} = {}) {
  try {
    const allItems = await indexMediaLibrary(root, interiorRoot, {
      managedRoot,
      tombstonePath,
    });
    const normalizedQuery = String(query).trim().toLocaleLowerCase("de-DE");
    const normalizedGroup = String(group).trim();
    const normalizedKind = String(kind).trim();
    const filteredItems = allItems.filter((item) => {
      if (normalizedGroup && item.group !== normalizedGroup) return false;
      if (normalizedKind && item.kind !== normalizedKind) return false;
      if (!normalizedQuery) return true;
      return `${item.caption} ${item.relativePath} ${item.group}`
        .toLocaleLowerCase("de-DE")
        .includes(normalizedQuery);
    });
    const safePageSize = Math.min(80, Math.max(1, Number(pageSize) || 36));
    const pages = Math.max(1, Math.ceil(filteredItems.length / safePageSize));
    const safePage = Math.min(pages, Math.max(1, Number(page) || 1));
    const start = (safePage - 1) * safePageSize;
    const groupCounts = new Map();
    for (const item of allItems) {
      groupCounts.set(item.group, (groupCounts.get(item.group) || 0) + 1);
    }
    const groups = [...groupCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => left.name.localeCompare(right.name, "de", { numeric: true }));

    return {
      available: true,
      root: root || DEFAULT_MEDIA_LIBRARY_ROOT,
      total: filteredItems.length,
      libraryTotal: allItems.length,
      page: safePage,
      pages,
      pageSize: safePageSize,
      groups,
      items: filteredItems.slice(start, start + safePageSize),
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {
        available: false,
        root: root || DEFAULT_MEDIA_LIBRARY_ROOT,
        total: 0,
        libraryTotal: 0,
        page: 1,
        pages: 1,
        pageSize: Math.min(80, Math.max(1, Number(pageSize) || 36)),
        groups: [],
        items: [],
      };
    }
    throw error;
  }
}

export async function findMediaLibraryDuplicates({
  root,
  interiorRoot,
  managedRoot,
  tombstonePath,
  referenceCounts,
} = {}) {
  const items = await indexMediaLibrary(root, interiorRoot, {
    managedRoot,
    tombstonePath,
  });
  const sizedItems = (await mapWithConcurrency(items, 8, async (item) => {
    try {
      const fileStats = await lstat(item.absolutePath);
      if (!fileStats.isFile() || fileStats.isSymbolicLink()) return null;
      return { item, bytes: fileStats.size };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  })).filter(Boolean);

  const candidatesByContextAndSize = new Map();
  for (const entry of sizedItems) {
    const key = `${entry.item.kind}\0${entry.item.group}\0${entry.bytes}`;
    const candidates = candidatesByContextAndSize.get(key) || [];
    candidates.push(entry.item);
    candidatesByContextAndSize.set(key, candidates);
  }
  const candidates = [...candidatesByContextAndSize.values()]
    .filter((entries) => entries.length > 1)
    .flat();
  const fingerprinted = (await mapWithConcurrency(candidates, 2, async (item) => {
    const fingerprint = await mediaFileFingerprint(item);
    return fingerprint ? { item, ...fingerprint } : null;
  })).filter(Boolean);

  const exactGroups = new Map();
  for (const entry of fingerprinted) {
    const key = `${entry.item.kind}\0${entry.item.group}\0${entry.contentHash}`;
    const matches = exactGroups.get(key) || [];
    matches.push(entry);
    exactGroups.set(key, matches);
  }

  const groups = [...exactGroups.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([key, entries]) => {
      const rankedItems = entries
        .map((entry) => ({
          ...entry.item,
          bytes: entry.bytes,
          mtimeMs: entry.mtimeMs,
          contentHash: entry.contentHash,
          referenceCount: mediaReferenceCount(referenceCounts, entry.item.id),
        }))
        .sort((left, right) => (
          right.referenceCount - left.referenceCount
          || Number(left.managed === true) - Number(right.managed === true)
          || left.relativePath.localeCompare(right.relativePath, "de", { numeric: true })
          || left.id.localeCompare(right.id)
        ));
      const recommendedKeepId = rankedItems[0].id;
      const recommendedDuplicates = rankedItems.filter((item) => item.id !== recommendedKeepId);
      const [kind, group, contentHash] = key.split("\0");
      return {
        id: createHash("sha256").update(key).digest("hex").slice(0, 32),
        kind,
        group,
        contentHash,
        bytes: rankedItems[0].bytes,
        itemCount: rankedItems.length,
        duplicateCount: rankedItems.length - 1,
        recommendedKeepId,
        redundantBytes: rankedItems[0].bytes * (rankedItems.length - 1),
        physicallyReclaimableBytes: recommendedDuplicates.reduce(
          (sum, item) => sum + (item.managed ? item.bytes : 0),
          0,
        ),
        items: rankedItems,
      };
    })
    .sort((left, right) => (
      left.group.localeCompare(right.group, "de", { numeric: true })
      || left.kind.localeCompare(right.kind, "de")
      || left.id.localeCompare(right.id)
    ));

  return {
    groups,
    groupCount: groups.length,
    duplicateCount: groups.reduce((sum, group) => sum + group.duplicateCount, 0),
    affectedItemCount: groups.reduce((sum, group) => sum + group.itemCount, 0),
    redundantBytes: groups.reduce((sum, group) => sum + group.redundantBytes, 0),
    physicallyReclaimableBytes: groups.reduce(
      (sum, group) => sum + group.physicallyReclaimableBytes,
      0,
    ),
  };
}

export async function deleteMediaLibraryDuplicateItems(idValues, options = {}) {
  return serializedMediaMutation(async () => {
    if (!Array.isArray(idValues)) {
      throw mediaLibraryError("Die Liste der Dubletten ist ungültig.");
    }
    const ids = [...new Set(idValues.map((id) => String(id || "")))];
    if (!ids.length) throw mediaLibraryError("Es wurden keine Dubletten ausgewählt.");
    if (ids.length > MAX_DUPLICATE_DELETE_ITEMS) {
      throw mediaLibraryError(
        `Pro Bereinigung können höchstens ${MAX_DUPLICATE_DELETE_ITEMS} Bilder entfernt werden.`,
      );
    }
    if (ids.some((id) => !/^[a-f0-9]{32}$/i.test(id))) {
      throw mediaLibraryError("Mindestens eine Medien-ID ist ungültig.");
    }

    const duplicateResult = await findMediaLibraryDuplicates(options);
    const groupByItemId = new Map();
    const itemById = new Map();
    for (const group of duplicateResult.groups) {
      for (const item of group.items) {
        groupByItemId.set(item.id, group);
        itemById.set(item.id, item);
      }
    }
    const unknownIds = ids.filter((id) => !itemById.has(id));
    if (unknownIds.length) {
      throw mediaLibraryError(
        "Die Dublettenliste ist nicht mehr aktuell. Bitte die Prüfung erneut starten.",
        409,
      );
    }

    const selectedIds = new Set(ids);
    const affectedGroups = new Set(ids.map((id) => groupByItemId.get(id).id));
    for (const groupId of affectedGroups) {
      const group = duplicateResult.groups.find((entry) => entry.id === groupId);
      const remaining = group.items.filter((item) => !selectedIds.has(item.id));
      if (!remaining.length) {
        throw mediaLibraryError(
          "In jeder Dublettengruppe muss mindestens ein Original erhalten bleiben.",
          409,
        );
      }
    }

    const selectedItems = ids.map((id) => itemById.get(id));
    if (
      !options.force
      && selectedItems.some((item) => item.referenceCount > 0)
    ) {
      throw mediaLibraryError(
        "Mindestens eine Dublette wird noch in einer Hausvorlage verwendet.",
        409,
      );
    }

    const resolvedOptions = resolvedIndexOptions(options.root, options);
    if (selectedItems.some((item) => item.managed) && !resolvedOptions.managedRoot) {
      throw mediaLibraryError("Der verwaltete Medienordner ist nicht konfiguriert.");
    }
    if (selectedItems.some((item) => !item.managed) && !resolvedOptions.tombstonePath) {
      throw mediaLibraryError("Für diese Medienquelle ist keine sichere Löschliste konfiguriert.");
    }

    let managedRootPath = "";
    if (selectedItems.some((item) => item.managed)) {
      managedRootPath = await realpath(resolvedOptions.managedRoot);
    }
    for (const item of selectedItems) {
      const currentFingerprint = await mediaFileFingerprint(item, { force: true });
      if (
        !currentFingerprint
        || currentFingerprint.bytes !== item.bytes
        || currentFingerprint.contentHash !== item.contentHash
      ) {
        throw mediaLibraryError(
          "Mindestens eine Bilddatei wurde seit der Prüfung verändert. Bitte erneut prüfen.",
          409,
        );
      }
      if (!item.managed) continue;
      const itemPath = await realpath(item.absolutePath);
      const pathInsideRoot = relative(managedRootPath, itemPath);
      if (!pathInsideRoot || pathInsideRoot.startsWith("..") || isAbsolute(pathInsideRoot)) {
        throw mediaLibraryError("Ein Bild liegt außerhalb des verwalteten Medienordners.");
      }
    }

    const bundledItems = selectedItems.filter((item) => !item.managed);
    const hiddenIds = bundledItems.length
      ? await readTombstoneIds(resolvedOptions.tombstonePath)
      : new Set();
    const results = [];
    for (const item of selectedItems.filter((entry) => entry.managed)) {
      await unlink(item.absolutePath);
      mediaContentHashCache.delete(`${item.id}\0${item.absolutePath}`);
      results.push({
        deletedId: item.id,
        managed: true,
        deletionMode: "deleted",
      });
    }
    for (const item of bundledItems) {
      hiddenIds.add(item.id);
      results.push({
        deletedId: item.id,
        managed: false,
        deletionMode: "hidden",
      });
    }
    if (bundledItems.length) {
      await saveTombstoneIds(resolvedOptions.tombstonePath, hiddenIds);
    }

    clearMediaLibraryCache();
    return {
      requestedCount: idValues.length,
      deletedCount: results.filter((item) => item.deletionMode === "deleted").length,
      hiddenCount: results.filter((item) => item.deletionMode === "hidden").length,
      results,
    };
  });
}

export async function getMediaLibraryItem(id, root, interiorRoot, options = {}) {
  const items = await indexMediaLibrary(root, interiorRoot, options);
  return items.find((item) => item.id === String(id || "")) || null;
}

export async function recommendedMediaSequence(coverId, root, interiorRoot, options = {}) {
  const items = await indexMediaLibrary(root, interiorRoot, options);
  const result = buildRecommendedMediaSequence(coverId, items);
  return {
    ...result,
    priceMatch: result.warnings.length
      ? null
      : resolveHousePrice(result.items.map((item) => item.filename)),
  };
}

export async function saveMediaLibraryImage(input, options = {}) {
  return serializedMediaMutation(async () => {
    const managedRoot = String(options.managedRoot || MANAGED_MEDIA_LIBRARY_ROOT);
    const kind = safeManagedKind(input?.kind);
    const group = safeManagedGroup(input?.group);
    const file = safeManagedFilename(input?.filename);
    const declaredMimeType = normalizedMimeType(input?.mimeType);
    const data = Buffer.isBuffer(input?.data) ? input.data : Buffer.from(input?.data ?? []);
    if (!data.length) throw mediaLibraryError("Die Bilddatei ist leer.");
    if (data.length > MAX_MANAGED_MEDIA_BYTES) {
      throw mediaLibraryError("Die Bilddatei ist größer als 100 MB.");
    }
    if (declaredMimeType !== file.mimeType) {
      throw mediaLibraryError("Dateiendung und Content-Type des Bildes passen nicht zusammen.");
    }
    if (detectedImageMimeType(data) !== file.mimeType) {
      throw mediaLibraryError("Der Dateiinhalt ist kein gültiges Bild im angegebenen Format.");
    }

    const destinationDirectory = join(managedRoot, kind, group);
    await mkdir(destinationDirectory, { recursive: true });
    const storedFilename = `${randomUUID()}--${file.filename}`;
    const destination = join(destinationDirectory, storedFilename);
    let handle;
    let created = false;
    try {
      handle = await open(destination, "wx", 0o600);
      created = true;
      await handle.writeFile(data);
      await handle.close();
    } catch (error) {
      await handle?.close();
      if (created) await rm(destination, { force: true });
      throw error;
    }

    const indexed = [];
    appendFileToIndex(destination, managedRoot, indexed, "managed");
    clearMediaLibraryCache();
    return {
      created: true,
      item: indexed[0],
      bytes: data.length,
    };
  });
}

export async function deleteMediaLibraryImage(idValue, options = {}) {
  return serializedMediaMutation(async () => {
    const id = String(idValue || "");
    if (!/^[a-f0-9]{32}$/i.test(id)) {
      throw mediaLibraryError("Die Medien-ID ist ungültig.");
    }
    const root = options.root;
    const interiorRoot = options.interiorRoot;
    const resolvedOptions = resolvedIndexOptions(root, options);
    const item = await getMediaLibraryItem(id, root, interiorRoot, resolvedOptions);
    if (!item) {
      throw mediaLibraryError("Das Bild wurde in der Medienbibliothek nicht gefunden.", 404);
    }

    let deletionMode;
    if (item.managed) {
      if (!resolvedOptions.managedRoot) {
        throw mediaLibraryError("Der verwaltete Medienordner ist nicht konfiguriert.");
      }
      const itemStats = await lstat(item.absolutePath);
      if (!itemStats.isFile() || itemStats.isSymbolicLink()) {
        throw mediaLibraryError("Nur reguläre Dateien im verwalteten Medienordner dürfen gelöscht werden.");
      }
      const [rootPath, itemPath] = await Promise.all([
        realpath(resolvedOptions.managedRoot),
        realpath(item.absolutePath),
      ]);
      const pathInsideRoot = relative(rootPath, itemPath);
      if (!pathInsideRoot || pathInsideRoot.startsWith("..") || isAbsolute(pathInsideRoot)) {
        throw mediaLibraryError("Das Bild liegt außerhalb des verwalteten Medienordners.");
      }
      await unlink(item.absolutePath);
      deletionMode = "deleted";
    } else {
      if (!resolvedOptions.tombstonePath) {
        throw mediaLibraryError("Für diese Medienquelle ist keine sichere Löschliste konfiguriert.");
      }
      const hiddenIds = await readTombstoneIds(resolvedOptions.tombstonePath);
      hiddenIds.add(item.id);
      await saveTombstoneIds(resolvedOptions.tombstonePath, hiddenIds);
      deletionMode = "hidden";
    }

    clearMediaLibraryCache();
    return {
      deletedId: item.id,
      managed: item.managed === true,
      deletionMode,
    };
  });
}

export function clearMediaLibraryCache() {
  cacheByRoot.clear();
}
