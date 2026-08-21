#!/usr/bin/env node

import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { loadHelperRuntimeProvenance } from "./helper-runtime-provenance.mjs";
import { APPLICATION_DATA_DIRECTORY } from "./platform-paths.mjs";
import { createProductionBatchOverrideStore } from "./production-batch-override.mjs";

export const PRODUCTION_BATCH_OVERRIDE_PATH = join(APPLICATION_DATA_DIRECTORY, "production-batch-override.json");

function parseArguments(argv) {
  const [command = "status", ...rest] = argv;
  let maxRunItems;
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] !== "--max-run-items") throw new Error(`Unbekanntes Argument: ${rest[index]}`);
    const raw = String(rest[++index] || "");
    if (!/^\d+$/u.test(raw)) throw new Error("--max-run-items muss eine ganze Zahl sein.");
    maxRunItems = Number(raw);
  }
  return { command, maxRunItems };
}

export async function runProductionBatchOverrideCli(argv, options = {}) {
  const parsed = parseArguments(argv);
  const store = options.store || createProductionBatchOverrideStore(PRODUCTION_BATCH_OVERRIDE_PATH);
  if (parsed.command === "status") {
    if (parsed.maxRunItems !== undefined) throw new Error("status akzeptiert keine zusätzlichen Argumente.");
    return store.load();
  }
  if (parsed.command === "cancel") {
    if (parsed.maxRunItems !== undefined) throw new Error("cancel akzeptiert keine zusätzlichen Argumente.");
    return store.cancel();
  }
  if (parsed.command !== "arm" || parsed.maxRunItems === undefined) {
    throw new Error("Verwendung: status | cancel | arm --max-run-items <4..25>.");
  }
  const provenance = await (options.loadRuntimeProvenance || loadHelperRuntimeProvenance)();
  if (provenance?.valid !== true || !/^[a-f0-9]{40}$/u.test(String(provenance.runtimeCommit || ""))) {
    const error = new Error("Armieren ist nur aus einer gültigen, commit-gebundenen Helper-Runtime zulässig.");
    error.code = "PRODUCTION_BATCH_OVERRIDE_RUNTIME_INVALID";
    throw error;
  }
  return store.arm({
    maxRunItems: parsed.maxRunItems,
    expectedRuntimeCommit: provenance.runtimeCommit,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runProductionBatchOverrideCli(process.argv.slice(2)).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error?.code ? `${error.code}: ` : ""}${error instanceof Error ? error.message : "One-Shot-Produktionsoverride konnte nicht verarbeitet werden."}\n`);
    process.exitCode = 1;
  });
}
