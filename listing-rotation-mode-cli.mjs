#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { APPLICATION_DATA_DIRECTORY } from "./platform-paths.mjs";
import {
  createListingRotationOperatingModeStore,
  LISTING_ROTATION_OPERATING_MODES,
} from "./listing-rotation-operating-mode.mjs";

export const LISTING_ROTATION_MODE_PATH = join(
  APPLICATION_DATA_DIRECTORY,
  "listing-rotation-mode.json",
);

function parseArguments(argv) {
  const [command = "status", ...rest] = argv;
  let mode = "";
  const canaryListingIds = [];
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === "--mode") mode = String(rest[++index] || "");
    else if (value === "--listing-id") canaryListingIds.push(String(rest[++index] || ""));
    else throw new Error(`Unbekanntes Argument: ${value}`);
  }
  return { command, mode, canaryListingIds };
}

export async function runListingRotationModeCli(argv, options = {}) {
  const parsed = parseArguments(argv);
  const store = options.store || createListingRotationOperatingModeStore(LISTING_ROTATION_MODE_PATH);
  if (parsed.command === "status") return store.load();
  if (parsed.command !== "set") throw new Error("Erlaubte Befehle: status oder set.");
  const mode = parsed.mode.trim().toLowerCase();
  if (!LISTING_ROTATION_OPERATING_MODES.includes(mode)) {
    throw new Error("Für set ist --mode off, canary oder active erforderlich.");
  }
  return store.save({ mode, canaryListingIds: parsed.canaryListingIds });
}

async function main() {
  try {
    const result = await runListingRotationModeCli(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Betriebsmodus konnte nicht gesetzt werden."}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
