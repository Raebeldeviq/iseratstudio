import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

import JSZip from "jszip";

import { APP_VERSION } from "./app/lib/app-version.mjs";
import { parseImmoprofessionalDeleteReport } from "./immoprofessional-delete-report-parser.mjs";
import { listingControl, normalizeListingGroup, updateListingControl } from "./listing-groups.mjs";
import {
  isRegressionRepairLifecycle,
  regressionRepairIdentity,
  REGRESSION_REPAIR_SOURCE_STATUS,
} from "./listing-regression-repair.mjs";
import {
  PRODUCTION_BATCH_OVERRIDE_MAX_ITEMS,
  PRODUCTION_BATCH_OVERRIDE_MIN_ITEMS,
} from "./production-batch-override.mjs";
import { WORKFLOW_STATUS } from "./workflow-status.mjs";

export const PRODUCTION_DELETE_FORMAT = 1;
export const PRODUCTION_DELETE_PROVIDER_ID = "30460";
export const PRODUCTION_DELETE_STATUS = Object.freeze({
  PREPARED: "delete_prepared",
  PROCESSING: "delete_processing",
  PENDING_CONFIRMATION: "delete_pending_confirmation",
  TRANSFER_UNCERTAIN: "delete_transfer_uncertain",
  CONFIRMED: "delete_confirmed",
});

function productionError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function clean(value, maximum = 500) {
  return String(value ?? "").trim().slice(0, maximum);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function xml(value) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}

async function atomicWrite(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(JSON.stringify(value, null, 2), "utf8");
    await handle.close();
    handle = null;
    await rename(temporaryPath, path);
  } finally {
    await handle?.close();
    await rm(temporaryPath, { force: true });
  }
}

async function readJson(path, fallback, code) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (parsed?.format !== PRODUCTION_DELETE_FORMAT) throw productionError(code, "Persistente Delete-Daten besitzen ein unbekanntes Format.");
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    if (error?.code === code) throw error;
    throw productionError(code, "Persistente Delete-Daten sind beschädigt oder nicht lesbar.");
  }
}

async function lockedMutation(path, operation) {
  const lockPath = `${path}.lock`;
  await mkdir(dirname(path), { recursive: true });
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") throw productionError("PRODUCTION_DELETE_LEDGER_LOCKED", "Das Produktions-Deleteledger wird bereits verarbeitet.");
    throw error;
  }
  try {
    return await operation();
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}

export function normalizeProductionDeleteMode(value) {
  if (!value || value.format !== PRODUCTION_DELETE_FORMAT || !new Set(["off", "active"]).has(value.mode)) {
    return {
      format: PRODUCTION_DELETE_FORMAT,
      mode: "off",
      updatedAt: clean(value?.updatedAt, 50),
      valid: false,
      fallbackReason: "Produktions-Delete-Modus fehlt, ist beschädigt oder unbekannt; fail-closed auf off.",
    };
  }
  return { format: PRODUCTION_DELETE_FORMAT, mode: value.mode, updatedAt: clean(value.updatedAt, 50), valid: true, fallbackReason: "" };
}

export function createProductionDeleteModeStore(path, options = {}) {
  const now = options.now || (() => new Date().toISOString());
  return {
    async load() {
      try {
        return normalizeProductionDeleteMode(await readJson(path, null, "PRODUCTION_DELETE_MODE_CORRUPT"));
      } catch {
        return normalizeProductionDeleteMode(null);
      }
    },
    async save(input) {
      const mode = clean(input?.mode, 20).toLowerCase();
      if (!new Set(["off", "active"]).has(mode)) throw productionError("PRODUCTION_DELETE_MODE_UNSUPPORTED", "Erlaubte Produktions-Delete-Modi sind off und active.");
      const value = { format: PRODUCTION_DELETE_FORMAT, mode, updatedAt: now() };
      await atomicWrite(path, value);
      return normalizeProductionDeleteMode(value);
    },
  };
}

function emptyLedger() {
  return { format: PRODUCTION_DELETE_FORMAT, jobs: [] };
}

export function createProductionDeleteLedger(path) {
  const read = () => readJson(path, emptyLedger(), "PRODUCTION_DELETE_LEDGER_CORRUPT");
  const mutate = (operation) => lockedMutation(path, async () => {
    const ledger = await read();
    const result = await operation(ledger);
    if (result.changed) await atomicWrite(path, result.ledger);
    return result.value;
  });
  const replace = (ledger, job) => ({ ...ledger, jobs: [...ledger.jobs.filter((entry) => entry.deleteJobId !== job.deleteJobId), job] });
  return {
    read,
    prepare(input, now = new Date().toISOString()) {
      return mutate(async (ledger) => {
        const existing = ledger.jobs.find((job) => job.deleteJobId === input.deleteJobId);
        if (existing) return { changed: false, ledger, value: existing };
        const job = {
          deleteJobId: clean(input.deleteJobId, 200),
          idempotencyKey: clean(input.idempotencyKey, 128),
          schedulerRunId: clean(input.schedulerRunId, 200),
          batchOverrideId: clean(input.batchOverrideId, 200),
          batchOverrideMaxRunItems: Math.max(0, Math.trunc(Number(input.batchOverrideMaxRunItems) || 0)),
          runtimeCommit: clean(input.runtimeCommit, 40).toLowerCase(),
          projectId: clean(input.projectId, 200),
          sourceListingId: clean(input.sourceListingId, 200),
          replacementListingId: clean(input.replacementListingId, 200),
          externalObjectNumber: clean(input.externalObjectNumber, 40),
          replacementExternalObjectNumber: clean(input.replacementExternalObjectNumber, 40),
          payloadFilename: clean(input.payloadFilename, 240),
          payloadSha256: clean(input.payloadSha256, 128),
          payloadSize: Number(input.payloadSize) || 0,
          preparedAt: now,
          transferStartedAt: "",
          transferCompletedAt: "",
          status: PRODUCTION_DELETE_STATUS.PREPARED,
          attempt: 0,
          claimToken: "",
          updatedAt: now,
          reportMessageId: "",
          reportHash: "",
          providerProcessedAt: "",
        };
        return { changed: true, ledger: replace(ledger, job), value: job };
      });
    },
    claim(jobId, now = new Date().toISOString()) {
      return mutate(async (ledger) => {
        const current = ledger.jobs.find((job) => job.deleteJobId === jobId);
        if (!current) throw productionError("PRODUCTION_DELETE_JOB_NOT_FOUND", "Der Produktions-Deletejob fehlt.");
        if (current.status !== PRODUCTION_DELETE_STATUS.PREPARED) throw productionError("PRODUCTION_DELETE_ALREADY_ATTEMPTED", "Dieser Deletejob wurde bereits versucht und darf nicht erneut übertragen werden.");
        const job = { ...current, status: PRODUCTION_DELETE_STATUS.PROCESSING, attempt: 1, claimToken: randomUUID(), transferStartedAt: now, updatedAt: now };
        return { changed: true, ledger: replace(ledger, job), value: job };
      });
    },
    transferred(jobId, token, now = new Date().toISOString()) {
      return mutate(async (ledger) => {
        const current = ledger.jobs.find((job) => job.deleteJobId === jobId);
        if (current?.status !== PRODUCTION_DELETE_STATUS.PROCESSING || current.claimToken !== token) throw productionError("PRODUCTION_DELETE_CLAIM_MISMATCH", "Der Delete-Transfer besitzt keinen passenden Claim.");
        const job = { ...current, status: PRODUCTION_DELETE_STATUS.PENDING_CONFIRMATION, claimToken: "", transferCompletedAt: now, updatedAt: now };
        return { changed: true, ledger: replace(ledger, job), value: job };
      });
    },
    uncertain(jobId, token, message, now = new Date().toISOString()) {
      return mutate(async (ledger) => {
        const current = ledger.jobs.find((job) => job.deleteJobId === jobId);
        if (current?.status !== PRODUCTION_DELETE_STATUS.PROCESSING || current.claimToken !== token) return { changed: false, ledger, value: current };
        const job = { ...current, status: PRODUCTION_DELETE_STATUS.TRANSFER_UNCERTAIN, claimToken: "", message: clean(message), updatedAt: now };
        return { changed: true, ledger: replace(ledger, job), value: job };
      });
    },
    confirm(jobId, report, now = new Date().toISOString()) {
      return mutate(async (ledger) => {
        const current = ledger.jobs.find((job) => job.deleteJobId === jobId);
        if (!current) throw productionError("PRODUCTION_DELETE_JOB_NOT_FOUND", "Der Produktions-Deletejob fehlt.");
        if (current.status === PRODUCTION_DELETE_STATUS.CONFIRMED) {
          if (current.externalObjectNumber !== report.externalObjectNumber || report.deleteResult !== "success") throw productionError("PRODUCTION_DELETE_CONFIRMATION_CONFLICT", "Ein bestätigter Delete erhielt einen widersprüchlichen Bericht.");
          if (current.reportHash === report.rawHash || current.reportMessageId === report.messageId) return { changed: false, ledger, value: current };
          const evidence = { messageId: clean(report.messageId), rawHash: clean(report.rawHash, 128), providerProcessedAt: clean(report.providerProcessedAt, 50) };
          const job = { ...current, additionalReports: [...(current.additionalReports || []), evidence].slice(-20), updatedAt: now };
          return { changed: true, ledger: replace(ledger, job), value: job };
        }
        if (current.status !== PRODUCTION_DELETE_STATUS.PENDING_CONFIRMATION) throw productionError("PRODUCTION_DELETE_CONFIRMATION_STATUS_INVALID", "Nur ein eindeutig übertragener Delete darf bestätigt werden.");
        if (current.externalObjectNumber !== report.externalObjectNumber || report.deleteResult !== "success") throw productionError("PRODUCTION_DELETE_CONFIRMATION_MISMATCH", "Der Löschbericht gehört nicht exakt zur alten Quell-Objektnummer.");
        const job = { ...current, status: PRODUCTION_DELETE_STATUS.CONFIRMED, reportMessageId: clean(report.messageId), reportHash: clean(report.rawHash, 128), providerProcessedAt: clean(report.providerProcessedAt, 50), confirmedAt: now, updatedAt: now };
        return { changed: true, ledger: replace(ledger, job), value: job };
      });
    },
  };
}

function mapHouseType(value) {
  const normalized = clean(value, 100).toLowerCase();
  if (normalized.includes("bungalow")) return "BUNGALOW";
  if (normalized.includes("stadt")) return "STADTHAUS";
  if (normalized.includes("doppel")) return "DOPPELHAUSHAELFTE";
  return "EINFAMILIENHAUS";
}

export function productionDeleteIdentity(source, replacement) {
  const lifecycle = replacement?.productionLifecycle;
  const schedulerRunId = clean(lifecycle?.schedulerRunId, 200);
  if (!schedulerRunId || source?.productionRotationRunId !== schedulerRunId) throw productionError("PRODUCTION_DELETE_LIFECYCLE_MISMATCH", "Source und Replacement besitzen keinen identischen Produktions-Rotationslauf.");
  const batchOverrideId = clean(lifecycle?.batchOverrideId, 200);
  const batchOverrideMaxRunItems = Math.max(0, Math.trunc(Number(lifecycle?.batchOverrideMaxRunItems) || 0));
  const runtimeCommit = clean(lifecycle?.runtimeCommit, 40).toLowerCase();
  const regressionRepair = isRegressionRepairLifecycle(lifecycle)
    ? regressionRepairIdentity(lifecycle)
    : null;
  const batchValuesPresent = Boolean(batchOverrideId || batchOverrideMaxRunItems || runtimeCommit);
  if (batchValuesPresent && (
    !batchOverrideId
    || batchOverrideMaxRunItems < PRODUCTION_BATCH_OVERRIDE_MIN_ITEMS
    || batchOverrideMaxRunItems > PRODUCTION_BATCH_OVERRIDE_MAX_ITEMS
    || !/^[a-f0-9]{40}$/u.test(runtimeCommit)
  )) {
    throw productionError("PRODUCTION_DELETE_BATCH_PROVENANCE_INVALID", "Die One-Shot-Provenienz der Deletekette ist unvollständig oder ungültig.");
  }
  const canonical = [
    "contract=production-rotation-delete-v1",
    `schedulerRunId=${schedulerRunId}`,
    ...(batchOverrideId ? [
      `batchOverrideId=${batchOverrideId}`,
      `batchOverrideMaxRunItems=${batchOverrideMaxRunItems}`,
      `runtimeCommit=${runtimeCommit}`,
    ] : []),
    ...(regressionRepair ? [
      "repairContract=regression-85-repair-v1",
      `repairCampaignId=${regressionRepair.campaignId}`,
      `repairScopeHash=${regressionRepair.scopeHash}`,
      `repairScopeItemId=${regressionRepair.scopeItemId}`,
      `repairOriginalStatus=${regressionRepair.sourceOriginalStatus}`,
    ] : []),
    `sourceListingId=${source.id}`,
    `sourceExternalId=${source.externalId}`,
    `replacementListingId=${replacement.id}`,
    `replacementExternalId=${replacement.externalId}`,
    `replacementConfirmedAt=${replacement.importConfirmedAt || ""}`,
  ].join("\n");
  const idempotencyKey = sha256(canonical);
  return {
    deleteJobId: `production-delete:${idempotencyKey}`,
    idempotencyKey,
    schedulerRunId,
    batchOverrideId,
    batchOverrideMaxRunItems,
    runtimeCommit,
    canonical,
  };
}

export function productionDeleteCandidates(state) {
  return (state.projects || []).flatMap((project) => (project.listings || [])
    .filter((source) => source.productionDeleteState === "authorized" && source.externalDeletionPending === true)
    .map((source) => ({ projectId: project.id, sourceListingId: source.id, authorizedAt: source.productionDeleteAuthorizedAt || "" })))
    .sort((left, right) => Date.parse(left.authorizedAt || "1970-01-01") - Date.parse(right.authorizedAt || "1970-01-01") || left.sourceListingId.localeCompare(right.sourceListingId));
}

export function resolveProductionDeleteEligibility(state, projectId, sourceListingId, ledger = { jobs: [] }) {
  const project = state.projects.find((candidate) => candidate.id === projectId);
  const source = project?.listings.find((listing) => listing.id === sourceListingId);
  const replacement = project?.listings.find((listing) => listing.id === source?.supersededByListingId);
  if (!project || !source || !replacement) throw productionError("PRODUCTION_DELETE_RELATION_NOT_UNIQUE", "Die Produktions-Source-Replacement-Beziehung ist nicht eindeutig.");
  const group = normalizeListingGroup(project.listingGroup, project.id);
  const sourceControl = listingControl(group, source);
  const replacementControl = listingControl(group, replacement);
  const lifecycle = replacement.productionLifecycle;
  const regressionRepair = isRegressionRepairLifecycle(lifecycle);
  const report = (state.importReports || []).find((entry) =>
    entry.reportId === replacement.importReportId
    && entry.importResult === "success"
    && entry.sourceListingId === source.id
    && entry.matchedListingId === replacement.id
    && entry.externalObjectNumber === replacement.externalId);
  const reasons = [];
  const sourceStatusAllowed = source.status === WORKFLOW_STATUS.PUBLISHED
    || (regressionRepair && source.status === REGRESSION_REPAIR_SOURCE_STATUS);
  if (!sourceStatusAllowed || source.externalDeletionPending !== true || source.productionDeleteState !== "authorized") reasons.push("source_not_authorized");
  if (!source.productionDeleteAuthorizedAt || !source.productionRotationRunId) reasons.push("production_authorization_missing");
  if (replacement.status !== WORKFLOW_STATUS.PUBLISHED || replacementControl.status !== WORKFLOW_STATUS.PUBLISHED) reasons.push("replacement_not_published");
  if (!replacement.importConfirmedAt || !report) reasons.push("positive_import_confirmation_missing");
  if (lifecycle?.format !== 1 || lifecycle.automaticDeleteAuthorized !== true || lifecycle.sourceListingId !== source.id || lifecycle.schedulerRunId !== source.productionRotationRunId) reasons.push("production_lifecycle_mismatch");
  if (sourceControl.automaticUpdateEnabled) reasons.push("source_still_scheduler_owner");
  if (!replacementControl.automaticUpdateEnabled) reasons.push("replacement_not_scheduler_owner");
  if (clean(state.provider?.providerNumber) !== PRODUCTION_DELETE_PROVIDER_ID) reasons.push("provider_id_mismatch");
  if (!/^30460-\d{6}$/u.test(clean(source.externalId, 40)) || !/^30460-\d{6}$/u.test(clean(replacement.externalId, 40))) reasons.push("external_object_number_invalid");
  const house = (state.houses || []).find((entry) => entry.id === source.templateId);
  if (!house || !clean(project.zip) || !clean(project.city) || !clean(state.provider?.company) || !clean(state.provider?.email)) reasons.push("delete_payload_source_incomplete");
  const jobs = (ledger.jobs || []).filter((job) => job.sourceListingId === source.id || job.externalObjectNumber === source.externalId);
  if (jobs.length > 1) reasons.push("multiple_delete_jobs");
  if (jobs.length === 1) {
    try {
      const identity = productionDeleteIdentity(source, replacement);
      const job = jobs[0];
      if (
        clean(job.deleteJobId, 200) !== identity.deleteJobId
        || clean(job.schedulerRunId, 200) !== identity.schedulerRunId
        || clean(job.batchOverrideId, 200) !== identity.batchOverrideId
        || Math.max(0, Math.trunc(Number(job.batchOverrideMaxRunItems) || 0)) !== identity.batchOverrideMaxRunItems
        || clean(job.runtimeCommit, 40).toLowerCase() !== identity.runtimeCommit
      ) reasons.push("delete_job_provenance_mismatch");
    } catch {
      reasons.push("delete_job_provenance_mismatch");
    }
  }
  if (reasons.length) throw productionError("PRODUCTION_DELETE_NOT_ELIGIBLE", `Das Altinserat ist nicht produktiv löschberechtigt: ${reasons.join(", ")}.`, { reasons });
  return { project, source, sourceControl, replacement, replacementControl, lifecycle, report, group, house, existingJob: jobs[0] || null };
}

export async function buildProductionDeletePayload(state, eligibility, options = {}) {
  const target = clean(eligibility.source.externalId, 40);
  const replacementExternalId = clean(eligibility.replacement.externalId, 40);
  const preparedAt = new Date(options.preparedAt || new Date().toISOString()).toISOString();
  const timestamp = preparedAt.replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");
  const date = preparedAt.slice(0, 10);
  const xmlFilename = `delete-${target}-${timestamp}.xml`;
  const payloadFilename = `delete-${target}-${timestamp}.zip`;
  const provider = state.provider;
  const xmlText = `<?xml version="1.0" encoding="UTF-8"?>
<openimmo>
  <uebertragung art="OFFLINE" umfang="TEIL" modus="DELETE" version="1.2.7" sendersoftware="Fabian&amp;Pascal Inseratestudio" senderversion="${xml(APP_VERSION)}" techn_email="${xml(provider.email)}" regi_id="30460" timestamp="${preparedAt}" />
  <anbieter><anbieternr>30460</anbieternr><firma>${xml(provider.company)}</firma><openimmo_anid>30460</openimmo_anid><immobilie>
    <objektkategorie><nutzungsart WOHNEN="true" GEWERBE="false" /><vermarktungsart KAUF="true" MIETE_PACHT="false" /><objektart><haus haustyp="${mapHouseType(eligibility.house.houseType)}" /></objektart></objektkategorie>
    <geo><plz>${xml(eligibility.project.zip)}</plz><ort>${xml(eligibility.project.city)}</ort></geo>
    <kontaktperson><email_zentrale>${xml(provider.email)}</email_zentrale><name>${xml(provider.lastName || provider.company)}</name></kontaktperson>
    <verwaltung_techn><objektnr_extern>${target}</objektnr_extern><aktion aktionart="DELETE" /><openimmo_obid>${target}</openimmo_obid><kennung_ursprung>${target}</kennung_ursprung><stand_vom>${date}</stand_vom></verwaltung_techn>
  </immobilie></anbieter>
</openimmo>`;
  if ((xmlText.match(/<immobilie(?:\s|>)/gu) || []).length !== 1 || (xmlText.match(/aktionart="DELETE"/gu) || []).length !== 1) throw productionError("PRODUCTION_DELETE_PAYLOAD_INVALID", "Der Delete-Payload enthält nicht exakt ein Objekt und eine DELETE-Aktion.");
  if ((xmlText.match(new RegExp(target, "gu")) || []).length !== 3 || xmlText.includes(replacementExternalId)) throw productionError("PRODUCTION_DELETE_TARGET_GUARD", "Der Delete-Payload ist nicht exklusiv auf die alte Quell-Objektnummer begrenzt.");
  const zip = new JSZip();
  zip.file(xmlFilename, xmlText, { date: new Date(preparedAt), createFolders: false });
  const archive = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 }, platform: "UNIX" });
  return { preparedAt, xmlFilename, payloadFilename, xmlText, archive, payloadSha256: sha256(archive), xmlSha256: sha256(xmlText), payloadSize: archive.length };
}

function markDeleteTransferredInState(state, eligibility, job, now) {
  const project = state.projects.find((candidate) => candidate.id === eligibility.project.id);
  const currentSource = project?.listings.find((listing) => listing.id === eligibility.source.id);
  const currentReplacement = project?.listings.find((listing) => listing.id === eligibility.replacement.id);
  if (
    !project
    || !currentSource
    || !currentReplacement
    || currentSource.productionDeleteState !== "authorized"
    || currentSource.supersededByListingId !== currentReplacement.id
    || currentReplacement.externalId !== job.replacementExternalObjectNumber
  ) throw productionError("PRODUCTION_DELETE_CATALOG_CHANGED_AFTER_TRANSFER", "Der Katalog hat sich während des Delete-Transfers geändert; die Übertragung bleibt bis zur manuellen Prüfung unbestätigt.");
  const source = {
    ...currentSource,
    productionDeleteState: "pending_confirmation",
    productionDeleteJobId: job.deleteJobId,
    productionDeleteTransferredAt: job.transferCompletedAt || now,
  };
  let group = normalizeListingGroup(project.listingGroup, project.id, { now });
  group = updateListingControl(group, source, {
    automaticUpdateEnabled: false,
    automaticDeletionEnabled: false,
    status: isRegressionRepairLifecycle(currentReplacement.productionLifecycle)
      ? REGRESSION_REPAIR_SOURCE_STATUS
      : WORKFLOW_STATUS.PUBLISHED,
    statusMessage: `Ersetzt · DELETE übertragen · Bericht für ${source.externalId} ausstehend`,
  }, { now });
  const nextProject = { ...project, listings: project.listings.map((listing) => listing.id === source.id ? source : listing), listingGroup: group };
  return { ...state, projects: state.projects.map((candidate) => candidate.id === project.id ? nextProject : candidate) };
}

function markDeleteUncertainInState(state, projectId, sourceListingId, job, message) {
  const project = state.projects.find((candidate) => candidate.id === projectId);
  const source = project?.listings.find((listing) => listing.id === sourceListingId);
  if (!project || !source) return state;
  const updated = { ...source, productionDeleteState: "transfer_uncertain", productionDeleteJobId: job?.deleteJobId || "", productionDeleteError: clean(message) };
  const nextProject = { ...project, listings: project.listings.map((listing) => listing.id === source.id ? updated : listing) };
  return { ...state, projects: state.projects.map((candidate) => candidate.id === project.id ? nextProject : candidate) };
}

export function finalizeProductionDeleteInState(state, job, report, options = {}) {
  const now = clean(options.now || new Date().toISOString(), 50);
  const project = state.projects.find((candidate) => candidate.id === job.projectId);
  const source = project?.listings.find((listing) => listing.id === job.sourceListingId);
  const replacement = project?.listings.find((listing) => listing.id === job.replacementListingId);
  if (!project || !source || !replacement || source.externalId !== job.externalObjectNumber || replacement.externalId !== job.replacementExternalObjectNumber || source.supersededByListingId !== replacement.id) throw productionError("PRODUCTION_DELETE_CATALOG_MISMATCH", "Die persistente Source-Replacement-Beziehung hat sich geändert.");
  if (job.status !== PRODUCTION_DELETE_STATUS.CONFIRMED || report.externalObjectNumber !== source.externalId || report.deleteResult !== "success") throw productionError("PRODUCTION_DELETE_CONFIRMATION_MISMATCH", "Ohne positiven exakten Löschbericht darf der Katalog nicht finalisiert werden.");
  if (source.status === WORKFLOW_STATUS.DELETED && source.deleteReportHash === report.rawHash) return { state, idempotent: true, source, replacement };
  const replacementSnapshot = JSON.stringify(replacement);
  const deletedSource = {
    ...source,
    status: WORKFLOW_STATUS.DELETED,
    statusMessage: `Extern gelöscht · ${source.externalId}`,
    externalDeletionPending: false,
    externalDeletionConfirmedAt: report.providerProcessedAt || now,
    deleteConfirmedAt: now,
    deleteReportMessageId: report.messageId,
    deleteReportHash: report.rawHash,
    deleteJobId: job.deleteJobId,
    productionDeleteState: "confirmed",
  };
  let group = normalizeListingGroup(project.listingGroup, project.id, { now });
  group = updateListingControl(group, deletedSource, {
    automaticUpdateEnabled: false,
    automaticDeletionEnabled: false,
    status: WORKFLOW_STATUS.DELETED,
    statusMessage: deletedSource.statusMessage,
    processLease: null,
    schedulerSelectionId: "",
    schedulerSelectedAt: "",
  }, { now });
  const nextProject = { ...project, listings: project.listings.map((listing) => listing.id === source.id ? deletedSource : listing), listingGroup: group };
  if (JSON.stringify(nextProject.listings.find((listing) => listing.id === replacement.id)) !== replacementSnapshot) throw productionError("PRODUCTION_DELETE_REPLACEMENT_MUTATED", "Die Delete-Finalisierung hat das Replacement unerwartet verändert.");
  const deleteReport = {
    reportId: `delete-report-${report.rawHash.slice(0, 32)}`,
    deleteJobId: job.deleteJobId,
    sourceListingId: source.id,
    replacementListingId: replacement.id,
    externalObjectNumber: source.externalId,
    messageId: report.messageId,
    rawHash: report.rawHash,
    providerProcessedAt: report.providerProcessedAt,
    processedAt: now,
    result: "success",
    channel: "email",
  };
  return {
    state: {
      ...state,
      projects: state.projects.map((candidate) => candidate.id === project.id ? nextProject : candidate),
      deleteReports: [...(state.deleteReports || []).filter((item) => item.reportId !== deleteReport.reportId), deleteReport].slice(-1000),
    },
    idempotent: false,
    source: deletedSource,
    replacement,
    deleteReport,
  };
}

export function createProductionDeleteService(options) {
  if (!options?.store?.load || !options?.store?.update) throw new Error("Dem Produktions-Deletedienst fehlt der persistente Katalogspeicher.");
  if (!options?.modeStore?.load || !options?.ledger?.read) throw new Error("Dem Produktions-Deletedienst fehlen Modus oder Ledger.");
  if (!options?.productionPolicyStore?.load) throw new Error("Dem Produktions-Deletedienst fehlt das persistente Produktionslimit.");
  if (!options?.runtimeOwnershipGuard?.assert) throw new Error("Dem Produktions-Deletedienst fehlt der verpflichtende Runtime-Ownership-Guard.");
  if (typeof options.upload !== "function") throw new Error("Dem Produktions-Deletedienst fehlt der FTPS-Transferadapter.");
  if (!options?.mailAdapter?.findCandidates || !options?.mailAdapter?.readRawMessage || options.mailAdapter.readOnly !== true) throw new Error("Dem Produktions-Deletedienst fehlt der read-only Löschberichtadapter.");
  const writeLog = options.writeLog || (async () => undefined);
  const now = options.now || (() => new Date().toISOString());

  function deleteContextKey(identity) {
    return identity.batchOverrideId
      ? `batch:${identity.batchOverrideId}:${identity.schedulerRunId}:${identity.runtimeCommit}`
      : "normal";
  }

  async function authorizeDeleteIdentity(identity) {
    if (!identity.batchOverrideId) {
      return {
        key: "normal",
        overrideId: null,
        schedulerRunId: "",
        runtimeCommit: "",
        maxRunItems: 3,
      };
    }
    const runtimeCommit = clean(options.runtimeProvenance?.runtimeCommit, 40).toLowerCase();
    if (
      !options.batchOverrideStore?.authorize
      || options.runtimeProvenance?.valid !== true
      || !/^[a-f0-9]{40}$/u.test(runtimeCommit)
      || runtimeCommit !== identity.runtimeCommit
    ) {
      throw productionError(
        "PRODUCTION_DELETE_BATCH_RUNTIME_UNAUTHORIZED",
        "Die One-Shot-Deletekette stimmt nicht eindeutig mit der laufenden Helper-Runtime überein.",
      );
    }
    const authorization = await options.batchOverrideStore.authorize({
      overrideId: identity.batchOverrideId,
      schedulerRunId: identity.schedulerRunId,
      runningRuntimeCommit: runtimeCommit,
    });
    if (
      authorization.valid !== true
      || authorization.record?.overrideId !== identity.batchOverrideId
      || authorization.record?.claimedBySchedulerRunId !== identity.schedulerRunId
      || authorization.record?.expectedRuntimeCommit !== identity.runtimeCommit
      || authorization.record?.maxRunItems !== identity.batchOverrideMaxRunItems
    ) {
      throw productionError(
        "PRODUCTION_DELETE_BATCH_OVERRIDE_UNAUTHORIZED",
        authorization.reason || "Die Deletekette besitzt keine passende persistente One-Shot-Provenienz.",
      );
    }
    return {
      key: deleteContextKey(identity),
      overrideId: identity.batchOverrideId,
      schedulerRunId: identity.schedulerRunId,
      runtimeCommit: identity.runtimeCommit,
      maxRunItems: identity.batchOverrideMaxRunItems,
    };
  }

  function identityForJob(state, job) {
    const project = state.projects.find((entry) => entry.id === job.projectId);
    const source = project?.listings.find((entry) => entry.id === job.sourceListingId);
    const replacement = project?.listings.find((entry) => entry.id === job.replacementListingId);
    if (!project || !source || !replacement) {
      throw productionError("PRODUCTION_DELETE_JOB_CATALOG_MISMATCH", "Ein offener Deletejob besitzt keine eindeutige Katalogbeziehung.");
    }
    const identity = productionDeleteIdentity(source, replacement);
    if (
      job.deleteJobId !== identity.deleteJobId
      || clean(job.schedulerRunId, 200) !== identity.schedulerRunId
      || clean(job.batchOverrideId, 200) !== identity.batchOverrideId
      || Math.max(0, Math.trunc(Number(job.batchOverrideMaxRunItems) || 0)) !== identity.batchOverrideMaxRunItems
      || clean(job.runtimeCommit, 40).toLowerCase() !== identity.runtimeCommit
    ) {
      throw productionError("PRODUCTION_DELETE_JOB_PROVENANCE_MISMATCH", "Ein offener Deletejob stimmt nicht mit seiner persistierten Rotations-/Batch-Provenienz überein.");
    }
    return identity;
  }

  async function resolveDeleteContexts(state, ledger) {
    const contexts = new Map();
    const ensureContext = (authorized) => {
      const existing = contexts.get(authorized.key);
      if (existing) return existing;
      const context = { ...authorized, candidates: [], pendingJobs: [] };
      contexts.set(authorized.key, context);
      return context;
    };
    const candidates = productionDeleteCandidates(state);
    for (const candidate of candidates) {
      const project = state.projects.find((entry) => entry.id === candidate.projectId);
      const source = project?.listings.find((entry) => entry.id === candidate.sourceListingId);
      const replacement = project?.listings.find((entry) => entry.id === source?.supersededByListingId);
      if (!source || !replacement) throw productionError("PRODUCTION_DELETE_RELATION_NOT_UNIQUE", "Eine autorisierte Deletekette besitzt keine eindeutige Source-/Replacement-Beziehung.");
      const identity = productionDeleteIdentity(source, replacement);
      const context = ensureContext(await authorizeDeleteIdentity(identity));
      context.candidates.push(candidate);
    }
    const openJobs = (ledger.jobs || []).filter((job) => [
      PRODUCTION_DELETE_STATUS.PREPARED,
      PRODUCTION_DELETE_STATUS.PENDING_CONFIRMATION,
    ].includes(job.status));
    for (const job of openJobs) {
      const identity = identityForJob(state, job);
      const context = ensureContext(await authorizeDeleteIdentity(identity));
      if (job.status === PRODUCTION_DELETE_STATUS.PENDING_CONFIRMATION) context.pendingJobs.push(job);
    }
    for (const context of contexts.values()) {
      const chainIds = new Set([
        ...context.candidates.map((candidate) => candidate.sourceListingId),
        ...context.pendingJobs.map((job) => job.sourceListingId),
      ]);
      if (chainIds.size > context.maxRunItems) {
        throw productionError(
          context.overrideId ? "PRODUCTION_DELETE_BATCH_LIMIT_EXCEEDED" : "PRODUCTION_DELETE_NORMAL_LIMIT_EXCEEDED",
          `${chainIds.size} Deleteketten überschreiten das eindeutig autorisierte Limit ${context.maxRunItems} dieses Produktionskontexts.`,
        );
      }
    }
    const totalPending = [...contexts.values()].reduce((sum, context) => sum + context.pendingJobs.length, 0);
    if (totalPending > PRODUCTION_BATCH_OVERRIDE_MAX_ITEMS) {
      throw productionError("PRODUCTION_DELETE_GLOBAL_PENDING_LIMIT_EXCEEDED", "Mehr als 25 offene Delete-Berichte sind auch über mehrere Produktionskontexte nicht zulässig.");
    }
    return { contexts, candidates, totalPending };
  }

  async function transferEligibleSources(context, maxRunItems, targetExternalObjectNumber = "") {
    const maximum = context?.overrideId ? context.maxRunItems : 3;
    if (!Number.isInteger(maxRunItems) || maxRunItems < 0 || maxRunItems > maximum) {
      throw productionError("PRODUCTION_DELETE_TRANSFER_BUDGET_INVALID", "Das verbleibende Produktions-Deletebudget ist ungültig.");
    }
    const snapshot = await options.store.load();
    const candidates = productionDeleteCandidates(snapshot.state);
    const contextCandidates = [];
    for (const candidate of candidates) {
      const project = snapshot.state.projects.find((entry) => entry.id === candidate.projectId);
      const source = project?.listings.find((entry) => entry.id === candidate.sourceListingId);
      const replacement = project?.listings.find((entry) => entry.id === source?.supersededByListingId);
      if (!source || !replacement) continue;
      const identity = productionDeleteIdentity(source, replacement);
      const currentContext = await authorizeDeleteIdentity(identity);
      if (currentContext.key === context.key) contextCandidates.push(candidate);
    }
    let eligibleCandidates = contextCandidates;
    if (targetExternalObjectNumber) {
      eligibleCandidates = contextCandidates.filter((candidate) => {
        const project = snapshot.state.projects.find((entry) => entry.id === candidate.projectId);
        const listing = project?.listings.find((entry) => entry.id === candidate.sourceListingId);
        return listing?.externalId === targetExternalObjectNumber;
      });
      if (eligibleCandidates.length !== 1) {
        throw productionError(
          "PRODUCTION_DELETE_EXACT_TARGET_NOT_ELIGIBLE",
          "Das exakt angeforderte Produktions-Deleteziel ist nicht eindeutig löschberechtigt.",
        );
      }
    }
    const selected = eligibleCandidates.slice(0, maxRunItems);
    const transferred = [];
    const errors = [];
    for (const candidate of selected) {
      let claimed;
      let identity;
      try {
        const currentPolicy = await options.productionPolicyStore.load();
        await options.runtimeOwnershipGuard.assert(currentPolicy);
        const currentSnapshot = await options.store.load();
        const currentLedger = await options.ledger.read();
        const eligibility = resolveProductionDeleteEligibility(currentSnapshot.state, candidate.projectId, candidate.sourceListingId, currentLedger);
        await options.mutationGuard?.assert?.({
          projectId: eligibility.project.id,
          sourceListingId: eligibility.source.id,
          sourceExternalId: eligibility.source.externalId,
          replacementListingId: eligibility.replacement.id,
          replacementExternalId: eligibility.replacement.externalId,
        });
        identity = productionDeleteIdentity(eligibility.source, eligibility.replacement);
        const currentContext = await authorizeDeleteIdentity(identity);
        if (currentContext.key !== context.key) throw productionError("PRODUCTION_DELETE_CONTEXT_CHANGED", "Die Deletekette wechselte während der Verarbeitung ihren Produktionskontext.");
        const payload = await buildProductionDeletePayload(currentSnapshot.state, eligibility, {
          preparedAt: eligibility.existingJob?.preparedAt,
        });
        const job = await options.ledger.prepare({
          ...identity,
          projectId: eligibility.project.id,
          sourceListingId: eligibility.source.id,
          replacementListingId: eligibility.replacement.id,
          externalObjectNumber: eligibility.source.externalId,
          replacementExternalObjectNumber: eligibility.replacement.externalId,
          payloadFilename: payload.payloadFilename,
          payloadSha256: payload.payloadSha256,
          payloadSize: payload.payloadSize,
        }, payload.preparedAt);
        if (job.status !== PRODUCTION_DELETE_STATUS.PREPARED) continue;
        if (job.payloadFilename !== payload.payloadFilename || job.payloadSha256 !== payload.payloadSha256 || job.payloadSize !== payload.payloadSize) throw productionError("PRODUCTION_DELETE_PAYLOAD_MISMATCH", "Der erneut erzeugte Delete-Payload stimmt nicht mit dem persistenten Job überein.");
        claimed = await options.ledger.claim(job.deleteJobId, now());
        await writeLog("transfer-started", { deleteJobId: job.deleteJobId, schedulerRunId: identity.schedulerRunId, batchOverrideId: identity.batchOverrideId || null, effectiveMaxRunItems: context.maxRunItems, runtimeCommit: identity.runtimeCommit || null, externalObjectNumber: eligibility.source.externalId, payloadFilename: payload.payloadFilename, payloadSha256: payload.payloadSha256, payloadSize: payload.payloadSize });
        await options.upload({ archive: payload.archive, filename: payload.payloadFilename, job, eligibility });
        const transferredJob = await options.ledger.transferred(job.deleteJobId, claimed.claimToken, now());
        await options.store.update((state) => ({ state: markDeleteTransferredInState(state, eligibility, transferredJob, now()) }), { now: now() });
        transferred.push(transferredJob.externalObjectNumber);
        await writeLog("transferred", { deleteJobId: transferredJob.deleteJobId, schedulerRunId: identity.schedulerRunId, batchOverrideId: identity.batchOverrideId || null, effectiveMaxRunItems: context.maxRunItems, runtimeCommit: identity.runtimeCommit || null, externalObjectNumber: transferredJob.externalObjectNumber, payloadFilename: payload.payloadFilename, payloadSha256: payload.payloadSha256, payloadSize: payload.payloadSize, status: transferredJob.status });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Produktions-Delete-Transfer fehlgeschlagen.";
        if (claimed && identity) {
          const uncertain = await options.ledger.uncertain(identity.deleteJobId, claimed.claimToken, message, now()).catch(() => null);
          await options.store.update((state) => ({ state: markDeleteUncertainInState(state, candidate.projectId, candidate.sourceListingId, uncertain, message) }), { now: now() }).catch(() => undefined);
        }
        errors.push({ sourceListingId: candidate.sourceListingId, message });
        await writeLog("failed", { sourceListingId: candidate.sourceListingId, errorCode: clean(error?.code, 120), message });
        break;
      }
    }
    return { candidateCount: candidates.length, selectedCount: selected.length, skippedCount: Math.max(0, candidates.length - selected.length), transferred, errors };
  }

  async function confirmPendingReports() {
    const ledger = await options.ledger.read();
    const confirmedJobs = ledger.jobs.filter((job) => job.status === PRODUCTION_DELETE_STATUS.CONFIRMED);
    for (const job of confirmedJobs) {
      const report = {
        externalObjectNumber: job.externalObjectNumber,
        deleteResult: "success",
        messageId: job.reportMessageId,
        rawHash: job.reportHash,
        providerProcessedAt: job.providerProcessedAt,
      };
      await options.store.update((state) => ({
        state: finalizeProductionDeleteInState(state, job, report, { now: now() }).state,
      }), { now: now() });
    }
    const pending = ledger.jobs.filter((job) => job.status === PRODUCTION_DELETE_STATUS.PENDING_CONFIRMATION);
    if (!pending.length) return { pendingCount: 0, candidateCount: 0, confirmed: [], mailMutations: 0 };
    const earliest = Math.min(...pending.map((job) => Date.parse(job.transferCompletedAt || now())).filter(Number.isFinite));
    const lookbackHours = Math.max(2, Math.min(720, Math.ceil((Date.now() - earliest) / 3600000) + 24));
    const candidates = await options.mailAdapter.findCandidates({ lookbackHours });
    const rawMessages = new Map();
    const confirmed = [];
    for (const job of pending) {
      for (const candidate of candidates) {
        let report;
        try {
          const key = `${candidate.mailboxName}:${candidate.transportId}`;
          if (!rawMessages.has(key)) rawMessages.set(key, await options.mailAdapter.readRawMessage(candidate));
          const mail = rawMessages.get(key);
          report = (options.parseReport || parseImmoprofessionalDeleteReport)(mail.rawSource, { expectedTarget: job.externalObjectNumber });
        } catch {
          // Eine nicht passende Mail ist keine Evidenz und wird unverändert übergangen.
          continue;
        }
        const confirmedJob = await options.ledger.confirm(job.deleteJobId, report, now());
        await options.store.update((state) => ({ state: finalizeProductionDeleteInState(state, confirmedJob, report, { now: now() }).state }), { now: now() });
        confirmed.push(job.externalObjectNumber);
        await writeLog("confirmed", { deleteJobId: job.deleteJobId, schedulerRunId: job.schedulerRunId, batchOverrideId: job.batchOverrideId || null, effectiveMaxRunItems: job.batchOverrideId ? job.batchOverrideMaxRunItems : 3, runtimeCommit: job.runtimeCommit || null, externalObjectNumber: job.externalObjectNumber, reportMessageId: report.messageId, reportHash: report.rawHash, mailboxName: candidate.mailboxName, mailMutations: 0, status: confirmedJob.status });
        break;
      }
    }
    return { pendingCount: pending.length, candidateCount: candidates.length, confirmed, mailMutations: 0 };
  }

  let runInProgress = false;

  async function runOnceUnlocked(input = {}) {
    const mode = await options.modeStore.load();
    if (mode.valid !== true || mode.mode !== "active") return { ran: false, reason: mode.fallbackReason || "delete-mode-off", transferred: [], confirmed: [], mailMutations: 0 };
    const policy = await options.productionPolicyStore.load();
    if (policy.valid !== true || !Number.isInteger(policy.maxRunItems) || policy.maxRunItems < 1 || policy.maxRunItems > 3) {
      return { ran: false, reason: policy.fallbackReason || "production-policy-invalid", transferred: [], confirmed: [], mailMutations: 0 };
    }
    const trigger = clean(input.trigger || "periodic", 100);
    const reconcileOnly = input.reconcileOnly === true;
    if (input.reconcileOnly !== undefined && typeof input.reconcileOnly !== "boolean") {
      throw productionError(
        "PRODUCTION_DELETE_RECONCILE_ONLY_INVALID",
        "Der reine DELETE-Bestätigungslauf verlangt einen eindeutigen booleschen Vertrag.",
      );
    }
    const targetExternalObjectNumber = clean(input.targetExternalObjectNumber, 40);
    const manualExact = trigger === "manual-exact";
    const schedulerLifecycleExact = trigger === "scheduler-lifecycle" && Boolean(targetExternalObjectNumber);
    if (manualExact !== Boolean(targetExternalObjectNumber) && !schedulerLifecycleExact) {
      throw productionError(
        "PRODUCTION_DELETE_EXACT_CONTRACT_INVALID",
        "Ein exakter Produktions-DELETE verlangt den passenden manuellen oder seriellen Scheduler-Lifecycle-Vertrag und eine konkrete Objektnummer.",
      );
    }
    if (manualExact && (!/^30460-\d{6}$/u.test(targetExternalObjectNumber) || policy.maxRunItems !== 1)) {
      throw productionError(
        "PRODUCTION_DELETE_EXACT_POLICY_REQUIRED",
        "Ein exakter Produktions-DELETE verlangt eine gültige Anbieter-Objektnummer und das Produktionslimit 1.",
      );
    }
    if (schedulerLifecycleExact && !/^30460-\d{6}$/u.test(targetExternalObjectNumber)) {
      throw productionError(
        "PRODUCTION_DELETE_LIFECYCLE_TARGET_INVALID",
        "Der serielle Scheduler-Lifecycle benötigt eine gültige konkrete Anbieter-Objektnummer.",
      );
    }
    const ledgerBefore = await options.ledger.read();
    const unresolved = ledgerBefore.jobs.filter((job) => [
      PRODUCTION_DELETE_STATUS.PROCESSING,
      PRODUCTION_DELETE_STATUS.TRANSFER_UNCERTAIN,
    ].includes(job.status));
    if (unresolved.length) {
      return {
        ran: false,
        reason: `Es existieren ${unresolved.length} unklare oder unterbrochene Produktions-Deletejobs; weitere Transfers sind fail-closed gesperrt.`,
        unresolvedDeleteJobIds: unresolved.map((job) => job.deleteJobId),
        transferred: [],
        confirmed: [],
        mailMutations: 0,
      };
    }

    const snapshotBeforeConfirmation = await options.store.load();
    await resolveDeleteContexts(snapshotBeforeConfirmation.state, ledgerBefore);
    const confirmation = await confirmPendingReports();
    const ledgerAfterConfirmation = await options.ledger.read();
    const snapshotAfterConfirmation = await options.store.load();
    const resolved = await resolveDeleteContexts(snapshotAfterConfirmation.state, ledgerAfterConfirmation);
    if (reconcileOnly) {
      await writeLog("reconciliation-only", {
        trigger,
        pendingConfirmationCount: resolved.totalPending,
        reportCandidateCount: confirmation.candidateCount,
        confirmedCount: confirmation.confirmed.length,
        transferredCount: 0,
      });
      return {
        ran: true,
        trigger,
        reconcileOnly: true,
        maxRunItems: policy.maxRunItems,
        candidateCount: resolved.candidates.length,
        selectedCount: 0,
        skippedCount: resolved.candidates.length,
        transferred: [],
        errors: [],
        pendingConfirmationCount: resolved.totalPending,
        reportCandidateCount: confirmation.candidateCount,
        confirmed: confirmation.confirmed,
        mailMutations: 0,
        ok: true,
      };
    }
    const contextsWithCandidates = [...resolved.contexts.values()].filter((context) => context.candidates.length);
    let selectedContext = null;
    let targetCandidateSelected = false;
    if (targetExternalObjectNumber) {
      const candidateMatches = contextsWithCandidates.flatMap((context) => context.candidates.map((candidate) => ({ context, candidate }))).filter(({ candidate }) => {
        const project = snapshotAfterConfirmation.state.projects.find((entry) => entry.id === candidate.projectId);
        const source = project?.listings.find((entry) => entry.id === candidate.sourceListingId);
        return source?.externalId === targetExternalObjectNumber;
      });
      const pendingMatches = [...resolved.contexts.values()].flatMap((context) => context.pendingJobs.map((job) => ({ context, job })))
        .filter(({ job }) => job.externalObjectNumber === targetExternalObjectNumber);
      const completedMatches = snapshotAfterConfirmation.state.projects.flatMap((project) => project.listings
        .filter((source) =>
          source.externalId === targetExternalObjectNumber
          && source.status === WORKFLOW_STATUS.DELETED
          && source.productionDeleteState === "confirmed"
          && source.externalDeletionPending === false));
      const exactMatchCount = candidateMatches.length + pendingMatches.length + completedMatches.length;
      if (exactMatchCount !== 1) throw productionError("PRODUCTION_DELETE_EXACT_TARGET_NOT_ELIGIBLE", "Das exakt angeforderte Produktions-Deleteziel ist nicht eindeutig löschberechtigt oder bestätigt.");
      selectedContext = candidateMatches[0]?.context || pendingMatches[0]?.context || null;
      targetCandidateSelected = candidateMatches.length === 1;
    } else {
      selectedContext = contextsWithCandidates.sort((left, right) => {
        const leftAt = Math.min(...left.candidates.map((candidate) => Date.parse(candidate.authorizedAt || "1970-01-01")));
        const rightAt = Math.min(...right.candidates.map((candidate) => Date.parse(candidate.authorizedAt || "1970-01-01")));
        return leftAt - rightAt || left.key.localeCompare(right.key);
      })[0] || null;
    }
    const effectiveMaxRunItems = selectedContext?.overrideId
      ? selectedContext.maxRunItems
      : policy.maxRunItems;
    const remainingTransferBudget = selectedContext
      ? Math.max(0, Math.min(
          effectiveMaxRunItems - selectedContext.pendingJobs.length,
          PRODUCTION_BATCH_OVERRIDE_MAX_ITEMS - resolved.totalPending,
        ))
      : 0;
    const transfer = selectedContext?.candidates.length && (!targetExternalObjectNumber || targetCandidateSelected)
      ? await transferEligibleSources({ ...selectedContext, maxRunItems: effectiveMaxRunItems }, remainingTransferBudget, targetExternalObjectNumber)
      : { candidateCount: resolved.candidates.length, selectedCount: 0, skippedCount: resolved.candidates.length, transferred: [], errors: [] };
    await writeLog("run-context", {
      trigger,
      batchOverrideId: selectedContext?.overrideId || null,
      schedulerRunId: selectedContext?.schedulerRunId || null,
      runtimeCommit: selectedContext?.runtimeCommit || null,
      effectiveMaxRunItems,
      candidateCount: transfer.candidateCount,
      selectedCount: transfer.selectedCount,
      pendingConfirmationCount: resolved.totalPending + transfer.transferred.length,
    });
    return {
      ran: true,
      trigger,
      targetExternalObjectNumber,
      maxRunItems: policy.maxRunItems,
      effectiveMaxRunItems,
      batchOverrideId: selectedContext?.overrideId || null,
      schedulerRunId: selectedContext?.schedulerRunId || null,
      runtimeCommit: selectedContext?.runtimeCommit || null,
      ...transfer,
      pendingConfirmationCount: resolved.totalPending + transfer.transferred.length,
      reportCandidateCount: confirmation.candidateCount,
      confirmed: confirmation.confirmed,
      mailMutations: 0,
      ok: transfer.errors.length === 0,
    };
  }

  async function runOnce(input = {}) {
    if (runInProgress) {
      return {
        ran: false,
        reason: "production-delete-run-in-progress",
        transferred: [],
        confirmed: [],
        mailMutations: 0,
      };
    }
    runInProgress = true;
    try {
      return await runOnceUnlocked(input);
    } finally {
      runInProgress = false;
    }
  }

  return { runOnce };
}
