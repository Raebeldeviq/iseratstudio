#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { loadCatalogManifest } from "./catalog-store.mjs";
import { planQngGuaranteedStatusMigration } from "./qng-guaranteed-status-preview.mjs";

export async function runQngGuaranteedStatusPreviewCli(argv = [], options = {}) {
  if (argv.length) throw new Error("Verwendung: qng-guaranteed-status-preview-cli.mjs");
  const load = options.loadCatalogManifest || loadCatalogManifest;
  const catalog = await load();
  if (!catalog?.stored || !catalog.state) throw new Error("Der persistente Inseratkatalog ist nicht verfügbar.");
  return planQngGuaranteedStatusMigration(catalog.state);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runQngGuaranteedStatusPreviewCli(process.argv.slice(2)).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "QNG-Vorschau fehlgeschlagen."}\n`);
    process.exitCode = 1;
  });
}
