import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

export const LISTING_ROTATION_PRODUCTION_POLICY_FORMAT = 2;
export const LISTING_ROTATION_PRODUCTION_MAX_RUN_ITEMS = 3;
export const LISTING_ROTATION_STARTUP_CATCHUP_MODES = Object.freeze(["detect-only", "guarded"]);

function failClosed(reason, updatedAt = "") {
  return {
    format: LISTING_ROTATION_PRODUCTION_POLICY_FORMAT,
    maxRunItems: 0,
    startupCatchupMode: "detect-only",
    expectedRuntimeCommit: "",
    updatedAt: String(updatedAt || ""),
    valid: false,
    fallbackReason: reason,
  };
}

export function normalizeListingRotationProductionPolicy(value) {
  if (!value || typeof value !== "object") {
    return failClosed("Produktions-Rollout-Policy fehlt; active ist fail-closed gesperrt.");
  }
  if (Number(value.format) !== LISTING_ROTATION_PRODUCTION_POLICY_FORMAT) {
    return failClosed("Produktions-Rollout-Policy besitzt ein unbekanntes Format; active ist fail-closed gesperrt.", value.updatedAt);
  }
  const maxRunItems = Math.trunc(Number(value.maxRunItems));
  const startupCatchupMode = String(value.startupCatchupMode || "").trim();
  const expectedRuntimeCommit = String(value.expectedRuntimeCommit || "").trim().toLowerCase();
  if (!Number.isInteger(maxRunItems) || maxRunItems < 1 || maxRunItems > LISTING_ROTATION_PRODUCTION_MAX_RUN_ITEMS) {
    return failClosed(`Produktionslimit muss zwischen 1 und ${LISTING_ROTATION_PRODUCTION_MAX_RUN_ITEMS} liegen; active ist fail-closed gesperrt.`, value.updatedAt);
  }
  if (!LISTING_ROTATION_STARTUP_CATCHUP_MODES.includes(startupCatchupMode)) {
    return failClosed("Startup-Catch-up-Modus ist unbekannt; active ist fail-closed gesperrt.", value.updatedAt);
  }
  if (!/^[a-f0-9]{40}$/u.test(expectedRuntimeCommit)) {
    return failClosed("Der erwartete Produktions-Runtime-Commit fehlt oder ist ungültig; active ist fail-closed gesperrt.", value.updatedAt);
  }
  return {
    format: LISTING_ROTATION_PRODUCTION_POLICY_FORMAT,
    maxRunItems,
    startupCatchupMode,
    expectedRuntimeCommit,
    updatedAt: String(value.updatedAt || ""),
    valid: true,
    fallbackReason: "",
  };
}

async function atomicWrite(path, value, idFactory) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}-${idFactory()}`;
  let handle;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(JSON.stringify(value, null, 2), "utf8");
    await handle.close();
    handle = null;
    await rename(temporaryPath, path);
  } finally {
    await handle?.close();
    await rm(temporaryPath, { force: true });
  }
}

export function createListingRotationProductionPolicyStore(path, options = {}) {
  const now = options.now || (() => new Date().toISOString());
  const idFactory = options.idFactory || randomUUID;
  return {
    async load() {
      try {
        return normalizeListingRotationProductionPolicy(JSON.parse(await readFile(path, "utf8")));
      } catch (error) {
        if (error?.code === "ENOENT") return normalizeListingRotationProductionPolicy(null);
        return failClosed("Produktions-Rollout-Policy ist beschädigt oder nicht lesbar; active ist fail-closed gesperrt.");
      }
    },
    async save(input) {
      const config = {
        format: LISTING_ROTATION_PRODUCTION_POLICY_FORMAT,
        maxRunItems: Math.trunc(Number(input?.maxRunItems)),
        startupCatchupMode: String(input?.startupCatchupMode || "").trim(),
        expectedRuntimeCommit: String(input?.expectedRuntimeCommit || "").trim().toLowerCase(),
        updatedAt: String(input?.updatedAt || now()),
      };
      const normalized = normalizeListingRotationProductionPolicy(config);
      if (!normalized.valid) throw new Error(normalized.fallbackReason);
      await atomicWrite(path, config, idFactory);
      return normalized;
    },
  };
}
