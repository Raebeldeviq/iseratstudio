#!/usr/bin/env node

import { join } from "node:path";

import { buildImportPackage, validateImportPackage } from "./app/lib/openimmo.ts";
import { loadCatalogImage } from "./catalog-store.mjs";
import { createCatalogStateStore } from "./catalog-state-store.mjs";
import { evaluateLiveCanaryCandidates } from "./listing-rotation-live-canary.mjs";
import { APPLICATION_DATA_DIRECTORY } from "./platform-paths.mjs";
import { collectPlotUploadEvidence, createPlotDailyUploadGuard } from "./plot-daily-upload-guard.mjs";
import { createUploadJobLedger } from "./upload-job-ledger.mjs";

const guard = createPlotDailyUploadGuard(join(APPLICATION_DATA_DIRECTORY, "plot-daily-upload-guard.json"));
const uploadLedger = createUploadJobLedger(join(APPLICATION_DATA_DIRECTORY, "upload-jobs.json"));
const store = createCatalogStateStore();

async function hydrateHouse(house) {
  return {
    ...house,
    images: await Promise.all((house.images || []).map(async (image) => {
      if (/^data:image\/(?:jpeg|png|webp);base64,/iu.test(String(image?.dataUrl || ""))) return image;
      const stored = await loadCatalogImage(image.id);
      return { ...image, mimeType: stored.mimeType, dataUrl: `data:${stored.mimeType};base64,${stored.data.toString("base64")}` };
    })),
  };
}

async function main() {
  if (!process.argv.includes("preflight")) throw new Error("Unterstützt wird ausschließlich der read-only Befehl preflight.");
  const snapshot = await store.load();
  if (!snapshot?.stored || !snapshot.state) throw new Error("Der persistente Katalog ist nicht verfügbar.");
  const ledger = await uploadLedger.read();
  const atArgument = process.argv.indexOf("--at");
  const at = atArgument >= 0 ? process.argv[atArgument + 1] : new Date().toISOString();
  const evidence = collectPlotUploadEvidence(snapshot.state, ledger, at);
  const houseImageCounts = new Map((snapshot.state.houses || []).map((house) => [house.id, (house.images || []).length]));
  const result = await evaluateLiveCanaryCandidates(snapshot.state, {
    at,
    dailyGuard: guard,
    uploadLedger: ledger,
    uploadEvidence: evidence,
    additionalBlockedPlotIds: ["plot-sync-nuw9l9"],
    houseImageCounts,
    validatePrepared: async ({ state, project, copy }) => {
      const sourceHouse = state.houses.find((house) => house.id === copy.templateId);
      if (!sourceHouse) return ["Ersatzhaus fehlt."];
      try {
        const house = await hydrateHouse(sourceHouse);
        const input = {
          project,
          listings: [copy],
          houses: [house],
          provider: state.provider,
          promotionImageEnabled: false,
          promotionImagesByListingId: {},
        };
        const issues = validateImportPackage(input);
        if (issues.length) return issues;
        await buildImportPackage(input);
        return [];
      } catch (error) {
        return [error instanceof Error ? error.message : "Lokale Bild- oder Paketprüfung fehlgeschlagen."];
      }
    },
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Canary-Preflight fehlgeschlagen."}\n`);
  process.exitCode = 1;
});
