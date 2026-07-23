import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import { promisify } from "node:util";
import {
  buildRecommendedMediaSequence,
  inferImageRole,
  INTERIOR_IMAGE_ROLES,
} from "./image-sequence.mjs";
import { resolveHousePrice } from "./house-price-catalog.mjs";

export const DEFAULT_MEDIA_LIBRARY_ROOT = process.env.FPI_MEDIA_LIBRARY_ROOT
  || "/Users/pascalfrohlich/Library/Mobile Documents/com~apple~CloudDocs/Life Business-System/01_HANDELSVERTRETUNG/03_MARKETING/04_ANZEIGEN";
export const DEFAULT_INTERIOR_LIBRARY_ROOT = process.env.FPI_INTERIOR_LIBRARY_ROOT
  || "/Users/pascalfrohlich/Library/Mobile Documents/com~apple~CloudDocs/Life Business-System/01_HANDELSVERTRETUNG/03_MARKETING/01_RENDERING/Inneneinrichtung";

const SUPPORTED_EXTENSIONS = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);
const CACHE_LIFETIME_MS = 15 * 60_000;
const cacheByRoot = new Map();
const execFileAsync = promisify(execFile);

function cleanLabel(value) {
  return String(value)
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  const relativePath = relative(root, absolutePath).split("\\").join("/");
  let classification = classify(relativePath, source);
  const role = inferImageRole({ filename: basename(absolutePath), relativePath, kind: classification.kind });
  if (INTERIOR_IMAGE_ROLES.includes(role) && classification.kind === "marketing") {
    classification = { ...classification, kind: "interior" };
  }
  const idSource = source === "interior" ? `interior:${relativePath}` : relativePath;
  output.push({
    id: createHash("sha256").update(idSource).digest("hex").slice(0, 32),
    absolutePath,
    relativePath,
    filename: basename(absolutePath),
    caption: cleanLabel(basename(absolutePath)),
    mimeType,
    ...classification,
    role,
    brandedCover: classification.kind === "house"
      && (/mit logo/i.test(basename(absolutePath))
        || (extension === ".png" && /^(?:sun|sol)\s*\d+/i.test(basename(absolutePath)))),
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
    if (!entry.isFile()) continue;
    appendFileToIndex(absolutePath, root, output, source);
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
      throw new Error("macOS hat den Zugriff auf iCloud Drive nicht rechtzeitig freigegeben. Bitte Terminal unter Systemeinstellungen > Datenschutz & Sicherheit > Dateien und Ordner den Zugriff auf iCloud Drive erlauben.");
    }
    throw error;
  }
  for (const absolutePath of Buffer.from(stdout).toString("utf8").split("\0")) {
    if (absolutePath) appendFileToIndex(absolutePath, root, output, source);
  }
}

function configuredRoots(root, interiorRoot) {
  if (root) return [
    { root, source: "advertisements", required: true },
    ...(interiorRoot ? [{ root: interiorRoot, source: "interior", required: true }] : []),
  ];
  return [
    { root: DEFAULT_MEDIA_LIBRARY_ROOT, source: "advertisements", required: true },
    { root: DEFAULT_INTERIOR_LIBRARY_ROOT, source: "interior", required: false },
  ];
}

export async function indexMediaLibrary(root, interiorRoot) {
  const roots = configuredRoots(root, interiorRoot);
  const cacheKey = roots.map((entry) => `${entry.source}:${entry.root}`).join("|");
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
      if (!entry.required && error && typeof error === "object" && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
  }
  items.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "de", { numeric: true }));
  cacheByRoot.set(cacheKey, { createdAt: now, items });
  return items;
}

export async function queryMediaLibrary({
  root,
  interiorRoot,
  query = "",
  group = "",
  kind = "",
  page = 1,
  pageSize = 36,
} = {}) {
  try {
    const allItems = await indexMediaLibrary(root, interiorRoot);
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
    for (const item of allItems) groupCounts.set(item.group, (groupCounts.get(item.group) || 0) + 1);
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

export async function getMediaLibraryItem(id, root) {
  const items = await indexMediaLibrary(root);
  return items.find((item) => item.id === String(id || "")) || null;
}

export async function recommendedMediaSequence(coverId, root) {
  const items = await indexMediaLibrary(root);
  const result = buildRecommendedMediaSequence(coverId, items);
  return {
    ...result,
    priceMatch: result.warnings.length
      ? null
      : resolveHousePrice(result.items.map((item) => item.filename)),
  };
}

export function clearMediaLibraryCache() {
  cacheByRoot.clear();
}
