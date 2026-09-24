#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { loadCatalogManifest } from "./catalog-store.mjs";
import {
  analyzePhase2BDescriptions,
  formatPhase2BDescriptionAnalysisMarkdown,
} from "./phase2b-description-analysis.mjs";

function parseArguments(argv) {
  const [format = "markdown", ...unknown] = argv;
  if (!new Set(["markdown", "json"]).has(format) || unknown.length) {
    throw new Error("Verwendung: phase2b-description-analysis-cli.mjs [markdown|json]");
  }
  return { format };
}

export async function runPhase2BDescriptionAnalysisCli(argv, options = {}) {
  const { format } = parseArguments(argv);
  const load = options.loadCatalogManifest || loadCatalogManifest;
  const current = await load(options.catalogDirectory);
  if (!current?.stored || !current.state) throw new Error("Der aktive Inseratkatalog ist nicht verfügbar.");
  const analysis = analyzePhase2BDescriptions(current.state, options);
  return { format, readOnly: true, analysis, output: format === "json" ? JSON.stringify(analysis, null, 2) : formatPhase2BDescriptionAnalysisMarkdown(analysis) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPhase2BDescriptionAnalysisCli(process.argv.slice(2)).then((result) => {
    process.stdout.write(`${result.output}\n`);
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Phase-2B.4-Analyse fehlgeschlagen."}\n`);
    process.exitCode = 1;
  });
}
