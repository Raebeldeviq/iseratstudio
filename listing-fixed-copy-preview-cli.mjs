#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { loadCatalogManifest } from "./catalog-store.mjs";
import {
  formatListingFixedCopyPreviewMarkdown,
  planListingFixedCopyPreview,
} from "./listing-fixed-copy-preview.mjs";

function parseArguments(argv = []) {
  const format = argv.includes("--json") ? "json" : "markdown";
  const unknown = argv.filter((argument) => !["preview", "--json"].includes(argument));
  if (unknown.length) throw new Error(`Unbekanntes Argument: ${unknown.join(", ")}`);
  return { format };
}

/** Loads exactly one local catalog snapshot and performs no persistence. */
export async function runListingFixedCopyPreviewCli(argv = [], options = {}) {
  const { format } = parseArguments(argv);
  const load = options.loadCatalogManifest || loadCatalogManifest;
  const catalog = await load();
  if (!catalog?.stored || !catalog.state) throw new Error("Der persistente Inseratkatalog ist nicht verfügbar.");
  const report = planListingFixedCopyPreview(catalog.state);
  return {
    ...report,
    output: format === "json"
      ? JSON.stringify(report, null, 2)
      : formatListingFixedCopyPreviewMarkdown(report),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runListingFixedCopyPreviewCli(process.argv.slice(2)).then((result) => {
    process.stdout.write(`${result.output}\n`);
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Read-only-Vorschau fehlgeschlagen."}\n`);
    process.exitCode = 1;
  });
}
