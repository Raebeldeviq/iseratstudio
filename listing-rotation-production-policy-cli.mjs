#!/usr/bin/env node

import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createListingRotationProductionPolicyStore } from "./listing-rotation-production-policy.mjs";
import { APPLICATION_DATA_DIRECTORY } from "./platform-paths.mjs";

export const LISTING_ROTATION_PRODUCTION_POLICY_PATH = join(
  APPLICATION_DATA_DIRECTORY,
  "listing-rotation-production-policy.json",
);

function parseArguments(argv) {
  const [command = "status", ...rest] = argv;
  const parsed = { command, maxRunItems: "", startupCatchupMode: "", expectedRuntimeCommit: "" };
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === "--max-run-items") parsed.maxRunItems = String(rest[++index] || "");
    else if (rest[index] === "--startup-catchup-mode") parsed.startupCatchupMode = String(rest[++index] || "");
    else if (rest[index] === "--expected-runtime-commit") parsed.expectedRuntimeCommit = String(rest[++index] || "");
    else throw new Error(`Unbekanntes Argument: ${rest[index]}`);
  }
  return parsed;
}

export async function runListingRotationProductionPolicyCli(argv, options = {}) {
  const parsed = parseArguments(argv);
  const store = options.store || createListingRotationProductionPolicyStore(LISTING_ROTATION_PRODUCTION_POLICY_PATH);
  if (parsed.command === "status") return store.load();
  if (parsed.command !== "set") throw new Error("Erlaubte Befehle: status, set.");
  return store.save({
    maxRunItems: parsed.maxRunItems,
    startupCatchupMode: parsed.startupCatchupMode,
    expectedRuntimeCommit: parsed.expectedRuntimeCommit,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runListingRotationProductionPolicyCli(process.argv.slice(2)).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Produktions-Policy konnte nicht verarbeitet werden."}\n`);
    process.exitCode = 1;
  });
}
