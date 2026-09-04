#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createCatalogStateStore } from "./catalog-state-store.mjs";
import { createListingRotationOperatingModeStore } from "./listing-rotation-operating-mode.mjs";
import { createProductionDeleteLedger, createProductionDeleteModeStore, PRODUCTION_DELETE_STATUS } from "./listing-rotation-production-delete.mjs";
import {
  NINE_DAY_ROTATION_START_RECONCILIATION_CONFIRMATION,
  previewNineDayRotationStartReconciliation,
  reconcileNineDayRotationStartInState,
} from "./listing-rotation-start-reconciliation.mjs";
import { APPLICATION_DATA_DIRECTORY } from "./platform-paths.mjs";
import { createUploadJobLedger } from "./upload-job-ledger.mjs";
import { WORKFLOW_STATUS } from "./workflow-status.mjs";

const CAMPAIGN_PATH = join(APPLICATION_DATA_DIRECTORY, "regression-85-repair.json");
const ROTATION_MODE_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-mode.json");
const DELETE_MODE_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-production-delete-mode.json");
const DELETE_LEDGER_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-production-delete-jobs.json");
const UPLOAD_LEDGER_PATH = join(APPLICATION_DATA_DIRECTORY, "upload-jobs.json");
const PORTAL_MODE_PATH = join(APPLICATION_DATA_DIRECTORY, "immoprofessional-portal-export-mode.json");

function parseArguments(argv) {
  const [command = "preview", ...rest] = argv;
  let confirmation = "";
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === "--confirm") confirmation = String(rest[++index] || "");
    else throw new Error(`Unbekanntes Argument: ${rest[index]}`);
  }
  if (!new Set(["preview", "apply"]).has(command)) throw new Error("Erlaubte Befehle: preview, apply.");
  return { command, confirmation };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function assertNoConcurrentWork(state, uploadLedger, deleteLedger) {
  const activeUploads = (uploadLedger.jobs || []).filter((job) => job.status === WORKFLOW_STATUS.PROCESSING);
  const openDeletes = (deleteLedger.jobs || []).filter((job) => new Set([
    PRODUCTION_DELETE_STATUS.PREPARED,
    PRODUCTION_DELETE_STATUS.PROCESSING,
    PRODUCTION_DELETE_STATUS.PENDING_CONFIRMATION,
    PRODUCTION_DELETE_STATUS.TRANSFER_UNCERTAIN,
  ]).has(job.status));
  const activeControls = (state.projects || []).flatMap((project) => project.listingGroup?.listingControls || [])
    .filter((control) => control.processLease || control.schedulerSelectionId);
  if (activeUploads.length || openDeletes.length || activeControls.length) {
    throw new Error("Offene Upload-/DELETE-Jobs, Scheduler-Auswahlen oder Leases blockieren die interne Reconciliation.");
  }
}

export async function runNineDayRotationStartReconciliationCli(argv, options = {}) {
  const parsed = parseArguments(argv);
  const store = options.store || createCatalogStateStore();
  const campaign = options.campaign || await readJson(options.campaignPath || CAMPAIGN_PATH);
  const rotationMode = options.rotationMode || await (options.rotationModeStore || createListingRotationOperatingModeStore(ROTATION_MODE_PATH)).load();
  const deleteMode = options.deleteMode || await (options.deleteModeStore || createProductionDeleteModeStore(DELETE_MODE_PATH)).load();
  const portalMode = options.portalMode || await readJson(options.portalModePath || PORTAL_MODE_PATH);
  const uploadLedger = options.uploadLedger || await (options.uploadLedgerStore || createUploadJobLedger(UPLOAD_LEDGER_PATH)).read();
  const deleteLedger = options.deleteLedger || await (options.deleteLedgerStore || createProductionDeleteLedger(DELETE_LEDGER_PATH)).read();
  const snapshot = await store.load();
  if (!snapshot?.stored || !snapshot.state) throw new Error("Der persistente Inseratstudio-Katalog ist nicht verfügbar.");
  if (
    rotationMode.valid !== true || rotationMode.mode !== "off" || rotationMode.canaryListingIds?.length
    || deleteMode.valid !== true || deleteMode.mode !== "off"
    || portalMode?.mode !== "off"
  ) {
    throw new Error("Rotation, Canary, Production-DELETE und Portalexport müssen für die interne Reconciliation eindeutig off sein.");
  }
  assertNoConcurrentWork(snapshot.state, uploadLedger, deleteLedger);
  const preview = previewNineDayRotationStartReconciliation(snapshot.state, campaign, deleteLedger, options);
  if (parsed.command === "preview") return { ...preview, modes: { rotation: "off", productionDelete: "off", portalExport: "off" } };
  if (parsed.confirmation !== NINE_DAY_ROTATION_START_RECONCILIATION_CONFIRMATION) {
    throw new Error(`Die Mutation verlangt --confirm ${NINE_DAY_ROTATION_START_RECONCILIATION_CONFIRMATION}.`);
  }
  const at = String(options.now || new Date().toISOString());
  const updated = await store.update((state) => reconcileNineDayRotationStartInState(
    state,
    campaign,
    deleteLedger,
    { ...options, now: at },
  ), { now: at });
  return { ...updated.result, modes: { rotation: "off", productionDelete: "off", portalExport: "off" } };
}

async function main() {
  const result = await runNineDayRotationStartReconciliationCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "9-Tage-Start-Reconciliation fehlgeschlagen."}\n`);
    process.exitCode = 1;
  });
}
