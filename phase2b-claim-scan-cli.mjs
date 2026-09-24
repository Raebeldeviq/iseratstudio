#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { loadCatalogManifest } from "./catalog-store.mjs";
import { formatPhase2BScanMarkdown, scanPhase2BClaims } from "./phase2b-claim-scan.mjs";

function parseArguments(argv) {
  const format = argv.includes("--json") ? "json" : "markdown";
  const unknown = argv.filter((argument) => !["scan", "--json"].includes(argument));
  if (unknown.length) throw new Error(`Unbekanntes Argument: ${unknown.join(", ")}`);
  return { format };
}

export async function runPhase2BClaimScanCli(argv, options = {}) {
  const { format } = parseArguments(argv);
  const load = options.loadCatalogManifest || loadCatalogManifest;
  const snapshot = await load();
  if (!snapshot?.stored || !snapshot.state) {
    throw new Error("Der persistente Inseratkatalog ist nicht verfügbar.");
  }
  const report = scanPhase2BClaims(snapshot.state, { now: options.now });
  return {
    ...report,
    output: format === "json" ? JSON.stringify(report, null, 2) : formatPhase2BScanMarkdown(report),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPhase2BClaimScanCli(process.argv.slice(2)).then((result) => {
    process.stdout.write(`${result.output}\n`);
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Phase-2B-Scan fehlgeschlagen."}\n`);
    process.exitCode = 1;
  });
}
