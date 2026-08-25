#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createCatalogStateStore } from "./catalog-state-store.mjs";
import { assertProductionRuntime, loadHelperRuntimeProvenance } from "./helper-runtime-provenance.mjs";
import { createListingRotationOperatingModeStore } from "./listing-rotation-operating-mode.mjs";
import { createProductionDeleteLedger, createProductionDeleteModeStore, PRODUCTION_DELETE_STATUS } from "./listing-rotation-production-delete.mjs";
import { createListingRotationProductionPolicyStore } from "./listing-rotation-production-policy.mjs";
import { APPLICATION_DATA_DIRECTORY } from "./platform-paths.mjs";
import {
  createRegression85CampaignStore,
  deriveRegression85Scope,
  REGRESSION_85_EXPECTED_COUNT,
} from "./regression-85-repair-scope.mjs";
import { previewRegression85Repair } from "./regression-85-repair-service.mjs";
import { createUploadJobLedger } from "./upload-job-ledger.mjs";

const CAMPAIGN_PATH = join(APPLICATION_DATA_DIRECTORY, "regression-85-repair.json");
const UPLOAD_LOG_PATH = join(APPLICATION_DATA_DIRECTORY, "upload.log");
const UPLOAD_LEDGER_PATH = join(APPLICATION_DATA_DIRECTORY, "upload-jobs.json");
const DELETE_LEDGER_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-production-delete-jobs.json");
const ROTATION_MODE_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-mode.json");
const PORTAL_MODE_PATH = join(APPLICATION_DATA_DIRECTORY, "immoprofessional-portal-export-mode.json");
const DELETE_MODE_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-production-delete-mode.json");
const PRODUCTION_POLICY_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-production-policy.json");

function parseArguments(argv) {
  const [command = "status", ...rest] = argv;
  let portalSnapshotPath = "";
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === "--portal-snapshot") portalSnapshotPath = String(rest[++index] || "").trim();
    else throw new Error(`Unbekanntes Argument: ${rest[index]}`);
  }
  if (!new Set(["status", "prepare-scope", "preview", "activate", "pause", "off"]).has(command)) {
    throw new Error("Verwendung: node regression-85-repair-cli.mjs status|prepare-scope|preview|activate|pause|off [--portal-snapshot <json>]");
  }
  if (command === "prepare-scope" && !portalSnapshotPath) throw new Error("prepare-scope benötigt den read-only Portalstatus über --portal-snapshot.");
  if (command !== "prepare-scope" && portalSnapshotPath) throw new Error("--portal-snapshot ist ausschließlich für prepare-scope zulässig.");
  return { command, portalSnapshotPath };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readJsonLines(path) {
  return (await readFile(path, "utf8")).split(/\r?\n/gu).filter(Boolean).map((line) => JSON.parse(line));
}

async function readPortalMode() {
  try {
    const value = await readJson(PORTAL_MODE_PATH);
    return { valid: value?.format === 1 && value?.mode === "off", mode: String(value?.mode || "off") };
  } catch (error) {
    if (error?.code === "ENOENT") return { valid: true, mode: "off", reason: "Portalfeature nicht produktiv installiert." };
    return { valid: false, mode: "off", reason: "Portalmodus ist beschädigt oder nicht lesbar." };
  }
}

function summary(campaign) {
  if (campaign.valid !== true) return { valid: false, mode: "off", reason: campaign.fallbackReason };
  const completed = campaign.progress.filter((item) => item.stage === "repair_completed").length;
  return {
    valid: true,
    campaignId: campaign.campaignId,
    scopeHash: campaign.scopeHash,
    scopeCount: campaign.scope.items.length,
    mode: campaign.mode,
    activeScopeItemId: campaign.activeScopeItemId || null,
    completed,
    pending: campaign.progress.length - completed,
    lastErrorCode: campaign.lastErrorCode || null,
    lastError: campaign.lastError || null,
  };
}

export async function runRegression85RepairCli(argv, options = {}) {
  const args = parseArguments(argv);
  const campaignStore = options.campaignStore || createRegression85CampaignStore(CAMPAIGN_PATH);
  const catalogStore = options.catalogStore || createCatalogStateStore();
  const uploadLedger = options.uploadLedger || createUploadJobLedger(UPLOAD_LEDGER_PATH);
  const deleteLedger = options.deleteLedger || createProductionDeleteLedger(DELETE_LEDGER_PATH);
  const rotationModeStore = options.rotationModeStore || createListingRotationOperatingModeStore(ROTATION_MODE_PATH);
  const deleteModeStore = options.deleteModeStore || createProductionDeleteModeStore(DELETE_MODE_PATH);
  const productionPolicyStore = options.productionPolicyStore || createListingRotationProductionPolicyStore(PRODUCTION_POLICY_PATH);
  const portalModeReader = options.portalModeReader || readPortalMode;
  const now = options.now || (() => new Date().toISOString());

  if (args.command === "status") return summary(await campaignStore.load());

  if (args.command === "prepare-scope") {
    const [snapshot, ledger, uploadEvents, portalSnapshot, policy, provenance] = await Promise.all([
      catalogStore.load(),
      uploadLedger.read(),
      (options.readUploadEvents || (() => readJsonLines(UPLOAD_LOG_PATH)))(),
      (options.readPortalSnapshot || (() => readJson(args.portalSnapshotPath)))(),
      productionPolicyStore.load(),
      (options.loadRuntimeProvenance || loadHelperRuntimeProvenance)(),
    ]);
    assertProductionRuntime(provenance, policy);
    const portalStatuses = Array.isArray(portalSnapshot) ? portalSnapshot : portalSnapshot?.items;
    const derived = deriveRegression85Scope(snapshot.state, uploadEvents, ledger, { portalStatuses });
    const campaign = await campaignStore.initialize(derived.scope, derived.scopeHash, { now: now() });
    return { ...summary(campaign), idempotent: campaign.idempotent, houseDistribution: campaign.scope.houseDistribution, observedIsoEvidence: campaign.scope.observedIsoEvidence };
  }

  const campaign = await campaignStore.load();
  if (campaign.valid !== true || campaign.scope.items.length !== REGRESSION_85_EXPECTED_COUNT) throw new Error(campaign.fallbackReason || "Die exakte 85er-Kampagne fehlt.");
  if (args.command === "preview") {
    const snapshot = await catalogStore.load();
    return previewRegression85Repair(snapshot.state, campaign, { now: now() });
  }

  if (args.command === "activate") {
    const [snapshot, rotationMode, portalMode, deleteMode, policy, deletes] = await Promise.all([
      catalogStore.load(),
      rotationModeStore.load(),
      portalModeReader(),
      deleteModeStore.load(),
      productionPolicyStore.load(),
      deleteLedger.read(),
    ]);
    if (rotationMode.mode !== "off") throw new Error("Die normale Rotation muss vor Aktivierung off sein.");
    if (portalMode.mode !== "off" || portalMode.valid !== true) throw new Error("Der Portalexport muss vor Aktivierung eindeutig off sein.");
    if (deleteMode.valid !== true || deleteMode.mode !== "active") throw new Error("Production-DELETE muss für den seriellen Reparaturlifecycle aktiv sein.");
    const openDeletes = deletes.jobs.filter((job) => [
      PRODUCTION_DELETE_STATUS.PREPARED,
      PRODUCTION_DELETE_STATUS.PROCESSING,
      PRODUCTION_DELETE_STATUS.PENDING_CONFIRMATION,
      PRODUCTION_DELETE_STATUS.TRANSFER_UNCERTAIN,
    ].includes(job.status));
    if (openDeletes.length) throw new Error("Vor Aktivierung muss jede bereits begonnene DELETE-Kette eindeutig abgeschlossen sein.");
    const provenance = await (options.loadRuntimeProvenance || loadHelperRuntimeProvenance)();
    assertProductionRuntime(provenance, policy);
    const preview = previewRegression85Repair(snapshot.state, campaign, { now: now() });
    if (
      preview.summary.candidateCount !== REGRESSION_85_EXPECTED_COUNT
      || preview.summary.distinctHouseCount < 2
      || preview.summary.mostFrequentHouse?.count >= 80
    ) throw new Error("Die 85er-Creative-Preview erfüllt die Mindestvariation nicht.");
    const updatedAt = now();
    const active = await campaignStore.update((current) => ({
      ...current,
      mode: "active",
      activatedAt: current.activatedAt || updatedAt,
      pausedAt: "",
      completedAt: "",
      lastErrorCode: "",
      lastError: "",
    }), { now: updatedAt });
    return { ...summary(active), previewSummary: preview.summary };
  }

  const updatedAt = now();
  const mode = args.command === "pause" ? "paused" : "off";
  const updated = await campaignStore.update((current) => ({
    ...current,
    mode,
    ...(mode === "paused" ? { pausedAt: updatedAt } : {}),
  }), { now: updatedAt });
  return summary(updated);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRegression85RepairCli(process.argv.slice(2)).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error?.code ? `${error.code}: ` : ""}${error instanceof Error ? error.message : "Die 85er-Reparatursteuerung ist fehlgeschlagen."}\n`);
    process.exitCode = 1;
  });
}
