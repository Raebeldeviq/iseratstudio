#!/usr/bin/env node

import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  createProductionDeleteLedger,
  createProductionDeleteModeStore,
} from "./listing-rotation-production-delete.mjs";
import { APPLICATION_DATA_DIRECTORY } from "./platform-paths.mjs";

export const PRODUCTION_DELETE_MODE_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-production-delete-mode.json");
export const PRODUCTION_DELETE_LEDGER_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-production-delete-jobs.json");

function parseArguments(argv) {
  const [command = "status", ...rest] = argv;
  const parsed = { command, mode: "" };
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === "--mode") parsed.mode = String(rest[++index] || "");
    else throw new Error(`Unbekanntes Argument: ${rest[index]}`);
  }
  return parsed;
}

function publicJob(job) {
  const value = { ...job };
  delete value.claimToken;
  return value;
}

export async function runProductionDeleteCli(argv, options = {}) {
  const parsed = parseArguments(argv);
  const modeStore = options.modeStore || createProductionDeleteModeStore(PRODUCTION_DELETE_MODE_PATH);
  const ledger = options.ledger || createProductionDeleteLedger(PRODUCTION_DELETE_LEDGER_PATH);
  if (parsed.command === "status") {
    const [mode, jobs] = await Promise.all([modeStore.load(), ledger.read()]);
    return { mode, jobs: jobs.jobs.map(publicJob) };
  }
  if (parsed.command !== "mode") throw new Error("Erlaubte Befehle: status, mode.");
  return modeStore.save({ mode: parsed.mode });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runProductionDeleteCli(process.argv.slice(2)).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error?.code ? `${error.code}: ` : ""}${error instanceof Error ? error.message : "Produktions-Delete-Modus konnte nicht verarbeitet werden."}\n`);
    process.exitCode = 1;
  });
}
