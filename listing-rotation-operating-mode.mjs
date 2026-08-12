import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

export const LISTING_ROTATION_OPERATING_MODES = Object.freeze(["off", "canary", "active"]);

function uniqueIdentifiers(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean))].slice(0, 1000);
}

export function normalizeListingRotationOperatingMode(value, options = {}) {
  const source = value && typeof value === "object" ? value : null;
  const rawMode = String(source?.mode || "").trim().toLowerCase();
  if (!source) {
    return {
      format: 1,
      mode: "off",
      canaryListingIds: [],
      updatedAt: "",
      valid: false,
      fallbackReason: options.fallbackReason || "Betriebsmodus-Konfiguration fehlt; fail-closed auf off.",
    };
  }
  if (Number(source.format) !== 1) {
    return {
      format: 1,
      mode: "off",
      canaryListingIds: [],
      updatedAt: String(source.updatedAt || ""),
      valid: false,
      fallbackReason: "Betriebsmodus-Konfiguration besitzt ein unbekanntes Format; fail-closed auf off.",
    };
  }
  if (!LISTING_ROTATION_OPERATING_MODES.includes(rawMode)) {
    return {
      format: 1,
      mode: "off",
      canaryListingIds: [],
      updatedAt: String(source.updatedAt || ""),
      valid: false,
      fallbackReason: `Unbekannter Betriebsmodus „${rawMode || "leer"}“; fail-closed auf off.`,
    };
  }
  const canaryListingIds = uniqueIdentifiers(source.canaryListingIds);
  if (rawMode === "canary" && (!Array.isArray(source.canaryListingIds) || !canaryListingIds.length)) {
    return {
      format: 1,
      mode: "off",
      canaryListingIds: [],
      updatedAt: String(source.updatedAt || ""),
      valid: false,
      fallbackReason: "Canary-Konfiguration enthält keine gültige Listing-ID; fail-closed auf off.",
    };
  }
  return {
    format: 1,
    mode: rawMode,
    canaryListingIds: rawMode === "canary" ? canaryListingIds : [],
    updatedAt: String(source.updatedAt || ""),
    valid: true,
    fallbackReason: "",
  };
}

export function createListingRotationOperatingModeStore(path, options = {}) {
  const idFactory = options.idFactory || randomUUID;
  const now = options.now || (() => new Date().toISOString());

  return {
    async load() {
      try {
        const parsed = JSON.parse(await readFile(path, "utf8"));
        return normalizeListingRotationOperatingMode(parsed);
      } catch (error) {
        if (error && typeof error === "object" && error.code === "ENOENT") {
          return normalizeListingRotationOperatingMode(null);
        }
        return normalizeListingRotationOperatingMode(null, {
          fallbackReason: "Betriebsmodus-Konfiguration ist beschädigt oder nicht lesbar; fail-closed auf off.",
        });
      }
    },

    async save(input) {
      const mode = String(input?.mode || "").trim().toLowerCase();
      if (!LISTING_ROTATION_OPERATING_MODES.includes(mode)) {
        throw new Error("Der Betriebsmodus muss off, canary oder active sein.");
      }
      const canaryListingIds = uniqueIdentifiers(input?.canaryListingIds);
      if (mode === "canary" && !canaryListingIds.length) {
        throw new Error("Für den Canary-Modus ist mindestens eine Listing-ID oder Objektnummer erforderlich.");
      }
      const config = {
        format: 1,
        mode,
        canaryListingIds: mode === "canary" ? canaryListingIds : [],
        updatedAt: String(input?.updatedAt || now()),
      };
      await mkdir(dirname(path), { recursive: true });
      const temporaryPath = `${path}.tmp-${process.pid}-${idFactory()}`;
      let handle;
      try {
        handle = await open(temporaryPath, "wx", 0o600);
        await handle.writeFile(JSON.stringify(config, null, 2), "utf8");
        await handle.close();
        handle = null;
        await rename(temporaryPath, path);
      } finally {
        await handle?.close();
        await rm(temporaryPath, { force: true });
      }
      return normalizeListingRotationOperatingMode(config);
    },
  };
}
