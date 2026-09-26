#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { loadCatalogManifest } from "./catalog-store.mjs";
import {
  applyCurrentCatalogCopyRemediation,
  runCurrentCatalogCopyRemediation,
} from "./current-catalog-copy-remediation.mjs";

async function main(argv) {
  const [command = "plan", ...unknown] = argv;
  if (!new Set(["plan", "apply"]).has(command) || unknown.length) {
    throw new Error("Verwendung: current-catalog-copy-remediation-cli.mjs [plan|apply]");
  }
  if (command === "apply") return runCurrentCatalogCopyRemediation();
  const current = await loadCatalogManifest();
  if (!current?.stored || !current.state) throw new Error("Der aktive Inseratkatalog ist nicht verfügbar.");
  const result = applyCurrentCatalogCopyRemediation(current.state);
  return {
    readOnly: true,
    changed: result.changed,
    idempotent: result.idempotent,
    counts: result.counts,
    initialSeverityCounts: result.initialReport?.severityCounts,
    finalSeverityCounts: result.finalReport.severityCounts,
    normalizationActions: result.normalizationReport?.actions,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Bestandsbereinigung fehlgeschlagen."}\n`);
    process.exitCode = 1;
  });
}
