#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { loadCatalogManifest } from "./catalog-store.mjs";
import {
  planPhase2BDescriptionSafeCleanup,
  runPhase2BDescriptionSafeCleanup,
} from "./phase2b-description-safe-cleanup.mjs";

function parseArguments(argv) {
  const [command = "plan", ...unknown] = argv;
  if (!new Set(["plan", "apply"]).has(command) || unknown.length) {
    throw new Error("Verwendung: phase2b-description-safe-cleanup-cli.mjs [plan|apply]");
  }
  return { command };
}

export async function runPhase2BDescriptionSafeCleanupCli(argv, options = {}) {
  const { command } = parseArguments(argv);
  if (command === "plan") {
    const load = options.loadCatalogManifest || loadCatalogManifest;
    const current = await load(options.catalogDirectory);
    if (!current?.stored || !current.state) throw new Error("Der aktive Inseratkatalog ist nicht verfügbar.");
    return { command, readOnly: true, plan: planPhase2BDescriptionSafeCleanup(current.state, options) };
  }
  return { command, readOnly: false, result: await runPhase2BDescriptionSafeCleanup(options) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPhase2BDescriptionSafeCleanupCli(process.argv.slice(2)).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Phase-2B.5 fehlgeschlagen."}\n`);
    process.exitCode = 1;
  });
}
