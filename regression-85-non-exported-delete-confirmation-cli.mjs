#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createAppleMailDeleteReportAdapter } from "./apple-mail-live-canary-delete-report-adapter.mjs";
import { createCatalogStateStore } from "./catalog-state-store.mjs";
import { parseImmoprofessionalDeleteReport } from "./immoprofessional-delete-report-parser.mjs";
import { finalizeRegressionRollbackInState } from "./listing-regression-repair.mjs";
import { createListingRotationOperatingModeStore } from "./listing-rotation-operating-mode.mjs";
import {
  createProductionDeleteLedger,
  createProductionDeleteModeStore,
  finalizeProductionDeleteInState,
  PRODUCTION_DELETE_STATUS,
} from "./listing-rotation-production-delete.mjs";
import { APPLICATION_DATA_DIRECTORY } from "./platform-paths.mjs";
import {
  createRegression85NonExportedAttestation,
  createRegression85NonExportedAttestationStore,
  createRegression85NonExportedConfirmationResolver,
  assertRegression85NonExportedAttestation,
  REGRESSION_85_NON_EXPORTED_CONFIRMATION_TYPE,
} from "./regression-85-non-exported-delete-confirmation.mjs";
import {
  createRegression85CampaignStore,
  REGRESSION_85_REPAIR_STAGES,
} from "./regression-85-repair-scope.mjs";
import { WORKFLOW_STATUS } from "./workflow-status.mjs";

export const FIRST_NON_EXPORTED_DELETE_TARGET = "30460-423286";
export const FIRST_NON_EXPORTED_DELETE_ORIGINAL = "30460-755080";
export const FIRST_NON_EXPORTED_DELETE_JOB_ID = "production-delete:18e9ac8f89a5555d16effff523ae71303d9625d9760e4dd0fc2665609ff5c9c4";

const CAMPAIGN_PATH = join(APPLICATION_DATA_DIRECTORY, "regression-85-repair.json");
const ATTESTATION_PATH = join(APPLICATION_DATA_DIRECTORY, "regression-85-non-exported-delete-confirmation.json");
const DELETE_LEDGER_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-production-delete-jobs.json");
const DELETE_MODE_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-production-delete-mode.json");
const ROTATION_MODE_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-mode.json");
const PORTAL_MODE_PATH = join(APPLICATION_DATA_DIRECTORY, "immoprofessional-portal-export-mode.json");
const PORTAL_LEDGER_PATH = join(APPLICATION_DATA_DIRECTORY, "immoprofessional-portal-export-jobs.json");
const PORTAL_LOG_PATH = join(APPLICATION_DATA_DIRECTORY, "immoprofessional-portal-export.log");

function clean(value, maximum = 500) {
  return String(value ?? "").trim().slice(0, maximum);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function cliError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function parseArguments(argv) {
  const [command = "status", ...rest] = argv;
  let evidenceSnapshotPath = "";
  let presenceEvidencePath = "";
  let target = "";
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === "--evidence-snapshot") evidenceSnapshotPath = clean(rest[++index], 1000);
    else if (rest[index] === "--presence-evidence") presenceEvidencePath = clean(rest[++index], 1000);
    else if (rest[index] === "--target") target = clean(rest[++index], 40);
    else throw cliError("DELETE_NON_EXPORTED_ARGUMENT_INVALID", `Unbekanntes Argument: ${rest[index]}`);
  }
  if (!new Set(["status", "prepare-evidence", "reconcile-first"]).has(command)) {
    throw cliError("DELETE_NON_EXPORTED_ARGUMENT_INVALID", "Verwendung: status | prepare-evidence --evidence-snapshot <json> | reconcile-first --target <Objektnummer> --presence-evidence <json>");
  }
  if (command === "prepare-evidence" && (!evidenceSnapshotPath || presenceEvidencePath || target)) {
    throw cliError("DELETE_NON_EXPORTED_ARGUMENT_INVALID", "prepare-evidence benötigt ausschließlich --evidence-snapshot <json>.");
  }
  if (command === "reconcile-first" && (target !== FIRST_NON_EXPORTED_DELETE_TARGET || !presenceEvidencePath || evidenceSnapshotPath)) {
    throw cliError("DELETE_NON_EXPORTED_ARGUMENT_INVALID", `reconcile-first ist ausschließlich für ${FIRST_NON_EXPORTED_DELETE_TARGET} mit --presence-evidence zulässig.`);
  }
  if (command === "status" && (evidenceSnapshotPath || presenceEvidencePath || target)) {
    throw cliError("DELETE_NON_EXPORTED_ARGUMENT_INVALID", "status akzeptiert keine weiteren Argumente.");
  }
  return { command, evidenceSnapshotPath, presenceEvidencePath, target };
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" && fallback !== undefined) return fallback;
    throw error;
  }
}

async function readJsonLines(path) {
  try {
    return (await readFile(path, "utf8")).split(/\r?\n/gu).filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function validatePresenceEvidence(value, now) {
  const observedAt = clean(value?.observedAt, 50);
  const observedTimestamp = Date.parse(observedAt);
  const nowTimestamp = Date.parse(now);
  const reasons = [];
  if (value?.format !== 1) reasons.push("format_invalid");
  if (value?.channel !== "immoprofessional-read-only-exact-reference") reasons.push("channel_invalid");
  if (value?.targetExternalObjectNumber !== FIRST_NON_EXPORTED_DELETE_TARGET || value?.targetPresence !== "absent") reasons.push("target_presence_not_absent");
  if (value?.originalExternalObjectNumber !== FIRST_NON_EXPORTED_DELETE_ORIGINAL || value?.originalPresence !== "present") reasons.push("original_presence_not_present");
  if (value?.mailMutations !== 0 || value?.portalMutations !== 0) reasons.push("mutation_counter_invalid");
  if (!Number.isFinite(observedTimestamp) || !Number.isFinite(nowTimestamp) || observedTimestamp > nowTimestamp || nowTimestamp - observedTimestamp > 24 * 60 * 60 * 1000) reasons.push("observation_not_current");
  if (reasons.length) {
    throw cliError("DELETE_NON_EXPORTED_PRESENCE_EVIDENCE_INVALID", `Der read-only Presence-Nachweis ist ungültig: ${reasons.join(", ")}.`, { reasons });
  }
  return {
    format: 1,
    channel: value.channel,
    observedAt: new Date(observedTimestamp).toISOString(),
    targetExternalObjectNumber: value.targetExternalObjectNumber,
    targetPresence: value.targetPresence,
    originalExternalObjectNumber: value.originalExternalObjectNumber,
    originalPresence: value.originalPresence,
    mailMutations: 0,
    portalMutations: 0,
  };
}

async function assertSafeModes(stores, campaign) {
  const [rotation, deletion, portal] = await Promise.all([
    stores.rotationModeStore.load(),
    stores.deleteModeStore.load(),
    stores.readPortalMode(),
  ]);
  const reasons = [];
  if (campaign.valid !== true || campaign.mode !== "paused") reasons.push("campaign_not_paused");
  if (rotation.valid !== true || rotation.mode !== "off") reasons.push("rotation_not_off");
  if (deletion.valid !== true || deletion.mode !== "off") reasons.push("production_delete_not_off");
  if (portal.valid !== true || portal.mode !== "off") reasons.push("portal_export_not_off");
  if (reasons.length) {
    throw cliError("DELETE_NON_EXPORTED_SAFE_STATE_REQUIRED", `Die interne Reconciliation ist fail-closed blockiert: ${reasons.join(", ")}.`, { reasons });
  }
  return { rotation, deletion, portal };
}

function findScopeContext(campaign) {
  const scopeItem = campaign.scope.items.find((item) => item.regressionExternalId === FIRST_NON_EXPORTED_DELETE_TARGET);
  const progress = campaign.progress.find((item) => item.scopeItemId === scopeItem?.scopeItemId);
  const resumableStages = new Set([
    REGRESSION_85_REPAIR_STAGES.ROLLBACK_DELETE_PENDING,
    REGRESSION_85_REPAIR_STAGES.ROLLBACK_ROGUE_DELETED,
    REGRESSION_85_REPAIR_STAGES.REPAIR_COMPLETED,
  ]);
  const activeItemMatches = progress?.stage === REGRESSION_85_REPAIR_STAGES.REPAIR_COMPLETED
    ? !campaign.activeScopeItemId
    : progress?.scopeItemId === campaign.activeScopeItemId;
  if (
    !scopeItem
    || !progress
    || scopeItem.originalSourceListingId === scopeItem.regressionListingId
    || !activeItemMatches
    || !resumableStages.has(progress.stage)
    || progress.deleteJobId !== FIRST_NON_EXPORTED_DELETE_JOB_ID
  ) {
    throw cliError("DELETE_NON_EXPORTED_ACTIVE_ITEM_MISMATCH", "Der pausierte aktive 85er-Vorgang stimmt nicht exakt mit dem ersten Never-exported-DELETE überein.");
  }
  return { scopeItem, progress };
}

function publicSummary(campaign, attestation, ledger) {
  const completed = campaign.valid === true
    ? campaign.progress.filter((item) => item.stage === REGRESSION_85_REPAIR_STAGES.REPAIR_COMPLETED).length
    : 0;
  const job = ledger.jobs?.find((item) => item.deleteJobId === FIRST_NON_EXPORTED_DELETE_JOB_ID);
  return {
    ok: true,
    campaignMode: campaign.mode || "off",
    completed,
    pending: campaign.valid === true ? campaign.progress.length - completed : null,
    activeScopeItemId: campaign.activeScopeItemId || null,
    attestationPrepared: Boolean(attestation),
    attestationHash: attestation?.attestationHash || null,
    target: FIRST_NON_EXPORTED_DELETE_TARGET,
    original: FIRST_NON_EXPORTED_DELETE_ORIGINAL,
    deleteJobStatus: job?.status || null,
    confirmationType: job?.confirmationType || null,
  };
}

export async function runRegression85NonExportedDeleteConfirmationCli(argv, options = {}) {
  const args = parseArguments(argv);
  const now = options.now || (() => new Date().toISOString());
  const campaignStore = options.campaignStore || createRegression85CampaignStore(CAMPAIGN_PATH);
  const attestationStore = options.attestationStore || createRegression85NonExportedAttestationStore(ATTESTATION_PATH);
  const deleteLedger = options.deleteLedger || createProductionDeleteLedger(DELETE_LEDGER_PATH);
  const catalogStore = options.catalogStore || createCatalogStateStore();
  const stores = {
    rotationModeStore: options.rotationModeStore || createListingRotationOperatingModeStore(ROTATION_MODE_PATH),
    deleteModeStore: options.deleteModeStore || createProductionDeleteModeStore(DELETE_MODE_PATH),
    readPortalMode: options.readPortalMode || (async () => {
      try {
        const value = await readJson(PORTAL_MODE_PATH);
        return { valid: new Set([1, 2]).has(value?.format) && value?.mode === "off", mode: clean(value?.mode, 20) || "off" };
      } catch {
        return { valid: false, mode: "off" };
      }
    }),
  };
  const readPortalLedger = options.readPortalLedger || (() => readJson(PORTAL_LEDGER_PATH, { format: 1, jobs: [] }));
  const readPortalEvents = options.readPortalEvents || (() => readJsonLines(PORTAL_LOG_PATH));
  const contract = options.contract;
  const [campaign, attestation, ledger] = await Promise.all([
    campaignStore.load(),
    attestationStore.load(),
    deleteLedger.read(),
  ]);

  if (args.command === "status") return publicSummary(campaign, attestation, ledger);
  await assertSafeModes(stores, campaign);
  const initialScopeContext = findScopeContext(campaign);

  if (args.command === "prepare-evidence") {
    const [evidenceSnapshot, portalLedger, portalEvents] = await Promise.all([
      (options.readEvidenceSnapshot || readJson)(args.evidenceSnapshotPath),
      readPortalLedger(),
      readPortalEvents(),
    ]);
    const created = createRegression85NonExportedAttestation({
      campaign,
      evidenceSnapshot,
      portalLedger,
      portalEvents,
      createdAt: now(),
    }, { contract });
    const saved = await attestationStore.save(created);
    return {
      ...publicSummary(campaign, saved, ledger),
      idempotent: saved.idempotent,
      scopeHash: saved.scopeHash,
      scopeEvidenceHash: saved.scopeEvidenceHash,
      classificationFingerprint: saved.classificationFingerprint,
      scopedPortalJobCount: saved.portalEvidenceSummary.scopedJobCount,
      scopedPortalEventCount: saved.portalEvidenceSummary.scopedEventCount,
    };
  }

  const presenceEvidence = validatePresenceEvidence(
    await (options.readPresenceEvidence || readJson)(args.presenceEvidencePath),
    now(),
  );
  const currentAttestation = assertRegression85NonExportedAttestation(attestation, campaign, { contract });
  const resolver = options.resolveConfirmationContext || createRegression85NonExportedConfirmationResolver({
    attestationStore,
    campaignStore,
    readPortalLedger,
    readPortalEvents,
    contract,
  });
  const unresolvedJobs = ledger.jobs.filter((job) => [
    PRODUCTION_DELETE_STATUS.PREPARED,
    PRODUCTION_DELETE_STATUS.PROCESSING,
    PRODUCTION_DELETE_STATUS.PENDING_CONFIRMATION,
    PRODUCTION_DELETE_STATUS.TRANSFER_UNCERTAIN,
  ].includes(job.status));
  const job = ledger.jobs.find((entry) => entry.deleteJobId === FIRST_NON_EXPORTED_DELETE_JOB_ID);
  const expectedUnresolvedCount = job?.status === PRODUCTION_DELETE_STATUS.PENDING_CONFIRMATION ? 1 : 0;
  if (
    !job
    || !new Set([PRODUCTION_DELETE_STATUS.PENDING_CONFIRMATION, PRODUCTION_DELETE_STATUS.CONFIRMED]).has(job.status)
    || unresolvedJobs.length !== expectedUnresolvedCount
    || (expectedUnresolvedCount === 1 && unresolvedJobs[0]?.deleteJobId !== FIRST_NON_EXPORTED_DELETE_JOB_ID)
  ) {
    throw cliError("DELETE_NON_EXPORTED_PENDING_JOB_NOT_UNIQUE", "Die interne Reconciliation verlangt exakt den einen bereits übertragenen offenen DELETE-Job.");
  }
  const confirmationContext = await resolver(job);
  if (!confirmationContext || confirmationContext.attestationHash !== currentAttestation.attestationHash) {
    throw cliError("DELETE_NON_EXPORTED_CONTEXT_NOT_VALIDATED", "Der offene DELETE besitzt keinen validierten Never-exported-Bestätigungskontext.");
  }
  if (job.status === PRODUCTION_DELETE_STATUS.CONFIRMED && initialScopeContext.progress.stage === REGRESSION_85_REPAIR_STAGES.REPAIR_COMPLETED) {
    const finalSnapshot = await catalogStore.load();
    const finalProject = finalSnapshot.state.projects.find((project) => project.id === initialScopeContext.scopeItem.projectId);
    const finalTarget = finalProject?.listings.find((listing) => listing.id === initialScopeContext.scopeItem.regressionListingId);
    const finalOriginal = finalProject?.listings.find((listing) => listing.id === initialScopeContext.scopeItem.originalSourceListingId);
    if (
      finalTarget?.status !== WORKFLOW_STATUS.DELETED
      || finalTarget?.productionDeleteState !== "confirmed"
      || finalTarget?.deleteConfirmationType !== REGRESSION_85_NON_EXPORTED_CONFIRMATION_TYPE
      || finalOriginal?.status !== WORKFLOW_STATUS.PUBLISHED
      || finalOriginal?.externalDeletionPending !== false
    ) {
      throw cliError("DELETE_NON_EXPORTED_FINAL_STATE_MISMATCH", "Der bereits reconciliierte Katalogzustand erfüllt nicht mehr den erwarteten A-bleibt/B-gelöscht-Vertrag.");
    }
    return {
      ...publicSummary(campaign, currentAttestation, ledger),
      reconciled: true,
      idempotent: true,
      secondDeleteTransferred: false,
      mailMutations: 0,
      portalMutations: 0,
      targetStatus: finalTarget.status,
      originalStatus: finalOriginal.status,
      originalExternalDeletionPending: finalOriginal.externalDeletionPending,
      confirmationType: finalTarget.deleteConfirmationType,
    };
  }
  const mailAdapter = options.mailAdapter || createAppleMailDeleteReportAdapter();
  const candidates = await mailAdapter.findCandidates({ lookbackHours: 72 });
  const reports = new Map();
  for (const candidate of candidates) {
    try {
      const mail = await mailAdapter.readRawMessage(candidate);
      const parsed = (options.parseReport || parseImmoprofessionalDeleteReport)(mail.rawSource, {
        expectedTarget: FIRST_NON_EXPORTED_DELETE_TARGET,
        confirmationContext,
      });
      reports.set(parsed.rawHash, parsed);
    } catch {
      // Nicht passende Mails sind keine Evidenz und werden unverändert übergangen.
    }
  }
  if (reports.size !== 1) {
    throw cliError("DELETE_NON_EXPORTED_REPORT_NOT_UNIQUE", `Es wurde ${reports.size} statt exakt eines positiven objektbezogenen DELETE-Berichts gefunden.`);
  }
  const report = {
    ...reports.values().next().value,
    externalPresenceEvidenceHash: sha256(JSON.stringify(presenceEvidence)),
    externalPresenceObservedAt: presenceEvidence.observedAt,
  };
  if (report.confirmationType !== REGRESSION_85_NON_EXPORTED_CONFIRMATION_TYPE || report.deletedFromExchanges.length !== 0) {
    throw cliError("DELETE_NON_EXPORTED_REPORT_CONTRACT_MISMATCH", "Der Bericht erfüllt den engen Never-exported-Bestätigungsvertrag nicht.");
  }

  const confirmedJob = await deleteLedger.confirm(job.deleteJobId, report, now());
  await catalogStore.update((state) => ({
    state: finalizeProductionDeleteInState(state, confirmedJob, report, { now: now() }).state,
  }), { now: now() });

  let updatedCampaign = await campaignStore.update((current) => ({
    ...current,
    progress: current.progress.map((item) => item.scopeItemId === confirmationContext.scopeItemId
      && item.stage !== REGRESSION_85_REPAIR_STAGES.REPAIR_COMPLETED
      ? {
          ...item,
          stage: REGRESSION_85_REPAIR_STAGES.ROLLBACK_ROGUE_DELETED,
          deleteJobId: confirmedJob.deleteJobId,
          deleteReportId: `delete-report-${report.rawHash.slice(0, 32)}`,
          repairState: "rollback_rogue_deleted",
          updatedAt: now(),
        }
      : item),
  }), { now: now() });
  const scopeItem = updatedCampaign.scope.items.find((item) => item.scopeItemId === confirmationContext.scopeItemId);
  const progress = updatedCampaign.progress.find((item) => item.scopeItemId === confirmationContext.scopeItemId);
  await catalogStore.update((state) => {
    const project = state.projects.find((item) => item.id === scopeItem.projectId);
    const target = project?.listings.find((listing) => listing.id === scopeItem.regressionListingId);
    const original = project?.listings.find((listing) => listing.id === scopeItem.originalSourceListingId);
    const alreadyFinal = target?.status === WORKFLOW_STATUS.DELETED
      && target?.productionDeleteState === "confirmed"
      && original?.status === WORKFLOW_STATUS.PUBLISHED
      && original?.externalDeletionPending === false;
    return {
      state: alreadyFinal
        ? state
        : finalizeRegressionRollbackInState(state, scopeItem, progress, { now: now() }).state,
    };
  }, { now: now() });
  updatedCampaign = await campaignStore.update((current) => ({
    ...current,
    activeScopeItemId: "",
    lastErrorCode: "",
    lastError: "",
    progress: current.progress.map((item) => item.scopeItemId === confirmationContext.scopeItemId
      ? {
          ...item,
          stage: REGRESSION_85_REPAIR_STAGES.REPAIR_COMPLETED,
          repairState: "repair_completed",
          completedAt: now(),
          updatedAt: now(),
        }
      : item),
  }), { now: now() });

  const finalSnapshot = await catalogStore.load();
  const finalProject = finalSnapshot.state.projects.find((project) => project.id === scopeItem.projectId);
  const finalTarget = finalProject?.listings.find((listing) => listing.id === scopeItem.regressionListingId);
  const finalOriginal = finalProject?.listings.find((listing) => listing.id === scopeItem.originalSourceListingId);
  if (
    finalTarget?.status !== WORKFLOW_STATUS.DELETED
    || finalTarget?.productionDeleteState !== "confirmed"
    || finalTarget?.deleteConfirmationType !== REGRESSION_85_NON_EXPORTED_CONFIRMATION_TYPE
    || finalOriginal?.status !== WORKFLOW_STATUS.PUBLISHED
    || finalOriginal?.externalDeletionPending !== false
  ) {
    throw cliError("DELETE_NON_EXPORTED_FINAL_STATE_MISMATCH", "Der interne Katalogzustand erfüllt nach der Reconciliation nicht den erwarteten A-bleibt/B-gelöscht-Vertrag.");
  }
  const finalLedger = await deleteLedger.read();
  return {
    ...publicSummary(updatedCampaign, currentAttestation, finalLedger),
    reconciled: true,
    idempotent: false,
    secondDeleteTransferred: false,
    mailMutations: 0,
    portalMutations: 0,
    targetStatus: finalTarget.status,
    originalStatus: finalOriginal.status,
    originalExternalDeletionPending: finalOriginal.externalDeletionPending,
    confirmationType: finalTarget.deleteConfirmationType,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRegression85NonExportedDeleteConfirmationCli(process.argv.slice(2)).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${clean(error?.code, 120) || "DELETE_NON_EXPORTED_CONFIRMATION_FAILED"}: ${error instanceof Error ? error.message : "Die Never-exported-Reconciliation ist fehlgeschlagen."}\n`);
    process.exitCode = 1;
  });
}
