#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { createCatalogStateStore } from "./catalog-state-store.mjs";
import { previewListingCreativeRotation } from "./listing-creative-preview.mjs";

function parseArguments(argv) {
  let limit = 10;
  let at = "";
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "preview") continue;
    if (argument === "--limit") limit = Number(argv[++index]);
    else if (argument === "--at") at = String(argv[++index] || "");
    else throw new Error(`Unbekanntes Argument: ${argument}`);
  }
  if (![10, 20].includes(limit)) throw new Error("Die Creative-Vorschau unterstützt ausschließlich --limit 10 oder --limit 20.");
  if (at && !Number.isFinite(Date.parse(at))) throw new Error("Der Vorschauzeitpunkt ist ungültig.");
  return { limit, at };
}

export async function runListingCreativePreviewCli(argv, options = {}) {
  const input = parseArguments(argv);
  const store = options.store || createCatalogStateStore();
  const snapshot = await store.load();
  if (!snapshot?.stored || !snapshot.state) throw new Error("Der persistente Inseratkatalog ist nicht verfügbar.");
  return previewListingCreativeRotation(snapshot.state, {
    limit: input.limit,
    at: input.at || options.now?.() || new Date().toISOString(),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runListingCreativePreviewCli(process.argv.slice(2)).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Creative-Vorschau fehlgeschlagen."}\n`);
    process.exitCode = 1;
  });
}
