#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createCatalogStateStore } from "./catalog-state-store.mjs";
import { APPLICATION_DATA_DIRECTORY } from "./platform-paths.mjs";
import {
  REGRESSION_85_MANUAL_CLOSURE_STATUS,
  previewRegression85SchedulerOwnerReconciliation,
  reconcileRegression85SchedulerOwnersInState,
} from "./regression-85-scheduler-owner-reconciliation.mjs";

const CAMPAIGN_PATH = join(APPLICATION_DATA_DIRECTORY, "regression-85-repair.json");

function parseArguments(argv) {
  const [command = "preview", ...rest] = argv;
  let confirmation = "";
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === "--confirm") confirmation = String(rest[++index] || "");
    else throw new Error(`Unbekanntes Argument: ${rest[index]}`);
  }
  if (!new Set(["preview", "apply"]).has(command)) throw new Error(`Unbekannter Befehl: ${command}`);
  return { command, confirmation };
}

async function loadCampaign(path = CAMPAIGN_PATH) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function runRegression85SchedulerOwnerReconciliationCli(argv, options = {}) {
  const parsed = parseArguments(argv);
  const store = options.store || createCatalogStateStore();
  const campaign = options.campaign || await loadCampaign(options.campaignPath);
  const snapshot = await store.load();
  if (!snapshot?.stored || !snapshot.state) throw new Error("Der persistente Inseratstudio-Katalog ist nicht verfügbar.");
  if (parsed.command === "preview") {
    return previewRegression85SchedulerOwnerReconciliation(snapshot.state, campaign, options);
  }
  if (parsed.confirmation !== REGRESSION_85_MANUAL_CLOSURE_STATUS) {
    throw new Error(`Die interne Reconciliation verlangt --confirm ${REGRESSION_85_MANUAL_CLOSURE_STATUS}.`);
  }
  const at = String(options.now || new Date().toISOString());
  const updated = await store.update((state) => reconcileRegression85SchedulerOwnersInState(
    state,
    campaign,
    { ...options, now: at },
  ), { now: at });
  return updated.result;
}

async function main() {
  const result = await runRegression85SchedulerOwnerReconciliationCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Scheduler-Owner-Reconciliation fehlgeschlagen."}\n`);
    process.exitCode = 1;
  });
}
