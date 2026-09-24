#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { loadCatalogManifest } from "./catalog-store.mjs";
import {
  planPhase2BQngQdfScopeCleanup,
  runPhase2BQngQdfScopeCleanup,
} from "./phase2b-qng-qdf-scope-cleanup.mjs";

function parseArguments(argv) {
  const [command = "plan", ...unknown] = argv;
  if (!new Set(["plan", "apply"]).has(command) || unknown.length) {
    throw new Error("Verwendung: phase2b-qng-qdf-scope-cleanup-cli.mjs [plan|apply]");
  }
  return { command };
}

export async function runPhase2BQngQdfScopeCleanupCli(argv, options = {}) {
  const { command } = parseArguments(argv);
  if (command === "plan") {
    const load = options.loadCatalogManifest || loadCatalogManifest;
    const current = await load(options.catalogDirectory);
    if (!current?.stored || !current.state) throw new Error("Der aktive Inseratkatalog ist nicht verfügbar.");
    return { command, readOnly: true, plan: planPhase2BQngQdfScopeCleanup(current.state, options) };
  }
  return { command, readOnly: false, result: await runPhase2BQngQdfScopeCleanup(options) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPhase2BQngQdfScopeCleanupCli(process.argv.slice(2)).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Phase-2B.7 fehlgeschlagen."}\n`);
    process.exitCode = 1;
  });
}
