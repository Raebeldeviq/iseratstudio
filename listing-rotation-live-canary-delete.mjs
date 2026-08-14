import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

import JSZip from "jszip";

import { APP_VERSION } from "./app/lib/app-version.mjs";
import { listingControl, normalizeListingGroup, updateListingControl } from "./listing-groups.mjs";
import { validateDeleteXmlAgainstSchema } from "./immoprofessional-delete-canary.mjs";
import { WORKFLOW_STATUS } from "./workflow-status.mjs";

export const LIVE_CANARY_DELETE_MODE_FORMAT = 1;
export const LIVE_CANARY_DELETE_LEDGER_FORMAT = 1;
export const LIVE_CANARY_DELETE_PROVIDER_ID = "30460";
export const LIVE_CANARY_DELETE_TARGETS = Object.freeze({
  "30460-930980": Object.freeze({
    sourceListingId: "066b7b16-6ce0-4142-9cce-891e1eb8382b",
    expectedReplacementListingId: "rotation-3017faee-ea3dfce4-75f2914d-copy",
    expectedReplacementExternalId: "30460-578535",
    plotId: "plot-sync-1ykz0tc",
  }),
  "30460-142086": Object.freeze({
    sourceListingId: "c7756713-f826-4712-9f10-54a975680278",
    expectedReplacementListingId: "rotation-ddaed765-687ed346-41ba6d5d-copy",
    expectedReplacementExternalId: "30460-993198",
    plotId: "plot-sync-jisocl",
  }),
  "30460-132376": Object.freeze({
    sourceListingId: "5471fa99-8407-476b-8b4c-cf10feb753a1",
    expectedReplacementListingId: "rotation-0996b6d3-b3f44dd8-d6f7b446-copy",
    expectedReplacementExternalId: "30460-057911",
    plotId: "plot-sync-1oi7ndw",
  }),
});
export const LIVE_CANARY_DELETE_STATUS = Object.freeze({
  PREPARED: "delete_prepared",
  PROCESSING: "delete_processing",
  PENDING_CONFIRMATION: "delete_pending_confirmation",
  TRANSFER_UNCERTAIN: "delete_transfer_uncertain",
  CONFIRMED: "delete_confirmed",
});

function liveError(code, message, details = {}) {
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

export function assertLiveCanaryDeleteTarget(value) {
  const target = clean(value, 40);
  const contract = LIVE_CANARY_DELETE_TARGETS[target];
  if (!contract) {
    throw liveError("LIVE_CANARY_DELETE_TARGET_NOT_AUTHORIZED", "Der 3er-Live-Canary darf ausschließlich eine der drei vorab ausgewählten alten Objektnummern löschen.");
  }
  return { target, contract };
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

async function readJson(path, fallback, format, corruptCode) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (parsed?.format !== format) throw liveError(corruptCode, "Persistente Live-Canary-Daten besitzen ein unbekanntes Format.");
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    if (error?.code === corruptCode) throw error;
    throw liveError(corruptCode, "Persistente Live-Canary-Daten sind beschädigt oder nicht lesbar.");
  }
}

async function lockedMutation(path, operation) {
  const lockPath = `${path}.lock`;
  await mkdir(dirname(path), { recursive: true });
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") throw liveError("LIVE_CANARY_DELETE_LEDGER_LOCKED", "Das Live-Canary-Deleteledger wird bereits verarbeitet.");
    throw error;
  }
  try {
    return await operation();
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}

export function createLiveCanaryDeleteModeStore(path, options = {}) {
  const now = options.now || (() => new Date().toISOString());
  return {
    async load() {
      try {
        const value = await readJson(path, null, LIVE_CANARY_DELETE_MODE_FORMAT, "LIVE_CANARY_DELETE_MODE_CORRUPT");
        const targets = Array.isArray(value?.externalObjectNumbers) ? [...new Set(value.externalObjectNumbers.map((item) => assertLiveCanaryDeleteTarget(item).target))] : [];
        if (!value || !["off", "canary"].includes(value.mode) || (value.mode === "off" && targets.length) || (value.mode === "canary" && targets.length !== 1)) throw new Error("invalid");
        return { ...value, externalObjectNumbers: targets, valid: true, fallbackReason: "" };
      } catch {
        return { format: LIVE_CANARY_DELETE_MODE_FORMAT, mode: "off", externalObjectNumbers: [], valid: false, fallbackReason: "Live-Canary-Delete-Modus fehlt, ist beschädigt oder unbekannt; fail-closed auf off." };
      }
    },
    async save(input) {
      const mode = clean(input?.mode, 20).toLowerCase();
      if (!new Set(["off", "canary"]).has(mode)) throw liveError("LIVE_CANARY_DELETE_MODE_UNSUPPORTED", "Erlaubte Delete-Modi sind off und canary.");
      const targets = mode === "canary" ? [...new Set((input?.externalObjectNumbers || []).map((item) => assertLiveCanaryDeleteTarget(item).target))] : [];
      if (mode === "canary" && targets.length !== 1) throw liveError("LIVE_CANARY_DELETE_TARGET_COUNT_INVALID", "Der Live-Canary-Delete-Modus benötigt exakt ein Ziel.");
      const value = { format: LIVE_CANARY_DELETE_MODE_FORMAT, mode, externalObjectNumbers: targets, updatedAt: now() };
      await atomicWrite(path, value);
      return { ...value, valid: true, fallbackReason: "" };
    },
  };
}

function assertMode(mode, target) {
  if (mode?.valid !== true || mode.mode !== "canary" || mode.externalObjectNumbers.length !== 1 || mode.externalObjectNumbers[0] !== target) {
    throw liveError("LIVE_CANARY_DELETE_MODE_OFF", "Der Live-Canary-Delete-Modus ist nicht exakt für dieses alte Quellinserat freigegeben.");
  }
}

export function resolveLiveCanaryDeleteEligibility(state, sourceTarget, deleteLedger = { jobs: [] }) {
  const { target, contract } = assertLiveCanaryDeleteTarget(sourceTarget);
  const matches = (state.projects || []).flatMap((project) => (project.listings || [])
    .filter((listing) => listing.id === contract.sourceListingId && listing.externalId === target)
    .map((source) => ({ project, source })));
  if (matches.length !== 1) throw liveError("LIVE_CANARY_DELETE_SOURCE_NOT_UNIQUE", "Das fest freigegebene Quellinserat ist im Katalog nicht eindeutig.");
  const { project, source } = matches[0];
  const replacement = project.listings.find((listing) => listing.id === contract.expectedReplacementListingId);
  const group = normalizeListingGroup(project.listingGroup, project.id);
  const sourceControl = listingControl(group, source);
  const replacementControl = replacement ? listingControl(group, replacement) : null;
  const report = (state.importReports || []).find((item) =>
    item.reportId === replacement?.importReportId
    && item.externalObjectNumber === contract.expectedReplacementExternalId
    && item.importResult === "success"
    && item.sourceListingId === source.id
    && item.matchedListingId === replacement.id);
  const reasons = [];
  if (project.plotId !== contract.plotId) reasons.push("plot_id_changed");
  if (!replacement || replacement.externalId !== contract.expectedReplacementExternalId) reasons.push("expected_replacement_missing");
  if (replacement?.rotationSourceListingId !== source.id || source.supersededByListingId !== replacement?.id) reasons.push("source_replacement_relation_mismatch");
  if (replacement?.status !== WORKFLOW_STATUS.PUBLISHED || replacementControl?.status !== WORKFLOW_STATUS.PUBLISHED) reasons.push("replacement_not_published");
  if (!replacement?.importConfirmedAt || !source.replacementConfirmedAt || !report) reasons.push("positive_import_confirmation_missing");
  if (source.externalDeletionPending !== true) reasons.push("source_not_external_deletion_pending");
  if (sourceControl.automaticUpdateEnabled) reasons.push("source_still_scheduler_owner");
  if (!replacementControl?.automaticUpdateEnabled) reasons.push("replacement_not_scheduler_owner");
  const existingDeleteJobs = (deleteLedger.jobs || []).filter((job) => job.externalObjectNumber === target);
  const resumablePreparedJob = existingDeleteJobs.length === 1
    && existingDeleteJobs[0].status === LIVE_CANARY_DELETE_STATUS.PREPARED
    && existingDeleteJobs[0].sourceListingId === contract.sourceListingId
    && existingDeleteJobs[0].replacementListingId === contract.expectedReplacementListingId
    && existingDeleteJobs[0].replacementExternalObjectNumber === contract.expectedReplacementExternalId;
  if (existingDeleteJobs.length && !resumablePreparedJob) reasons.push("delete_job_already_exists");
  if (clean(state.provider?.providerNumber) !== LIVE_CANARY_DELETE_PROVIDER_ID) reasons.push("provider_id_mismatch");
  const house = (state.houses || []).find((entry) => entry.id === source.templateId);
  if (!house || !clean(project.zip) || !clean(project.city) || !clean(state.provider?.company) || !clean(state.provider?.email)) reasons.push("delete_payload_source_incomplete");
  if (reasons.length) throw liveError("LIVE_CANARY_DELETE_NOT_ELIGIBLE", `Das Altinserat ist nicht löschberechtigt: ${reasons.join(", ")}.`, { reasons });
  return { contract, project, source, sourceControl, replacement, replacementControl, report, group, house };
}

function mapHouseType(value) {
  const normalized = clean(value, 100).toLowerCase();
  if (normalized.includes("bungalow")) return "BUNGALOW";
  if (normalized.includes("stadt")) return "STADTHAUS";
  if (normalized.includes("doppel")) return "DOPPELHAUSHAELFTE";
  return "EINFAMILIENHAUS";
}

export async function buildLiveCanaryDeletePayload(state, eligibility, options = {}) {
  const { target, contract } = assertLiveCanaryDeleteTarget(eligibility.source.externalId);
  if (eligibility.replacement.externalId !== contract.expectedReplacementExternalId) throw liveError("LIVE_CANARY_DELETE_REPLACEMENT_GUARD", "Das Replacement entspricht nicht der fest vorab erwarteten Objektnummer.");
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
  if ((xmlText.match(/<immobilie(?:\s|>)/gu) || []).length !== 1 || (xmlText.match(/aktionart="DELETE"/gu) || []).length !== 1) throw liveError("LIVE_CANARY_DELETE_PAYLOAD_INVALID", "Der Delete-Payload enthält nicht exakt ein Objekt und eine DELETE-Aktion.");
  if (xmlText.includes(contract.expectedReplacementExternalId)) throw liveError("LIVE_CANARY_DELETE_REPLACEMENT_GUARD", "Der Delete-Payload referenziert unerwartet das Replacement.");
  const zip = new JSZip();
  zip.file(xmlFilename, xmlText, { date: new Date(preparedAt), createFolders: false });
  const archive = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 }, platform: "UNIX" });
  return { preparedAt, xmlFilename, payloadFilename, xmlText, archive, payloadSha256: sha256(archive), xmlSha256: sha256(xmlText), payloadSize: archive.length };
}

function emptyLedger() {
  return { format: LIVE_CANARY_DELETE_LEDGER_FORMAT, jobs: [] };
}

export function liveCanaryDeleteIdentity(source, replacement) {
  const { target, contract } = assertLiveCanaryDeleteTarget(source?.externalId);
  if (
    source.id !== contract.sourceListingId
    || replacement?.id !== contract.expectedReplacementListingId
    || replacement?.externalId !== contract.expectedReplacementExternalId
  ) {
    throw liveError("LIVE_CANARY_DELETE_REPLACEMENT_GUARD", "Die Source-Replacement-Identität weicht vom read-only Vorabplan ab.");
  }
  const canonical = [
    "contract=live-canary-3-observed-delete-v1",
    `sourceListingId=${source.id}`,
    `sourceExternalId=${target}`,
    `replacementListingId=${replacement.id}`,
    `replacementExternalId=${replacement.externalId}`,
    `replacementConfirmedAt=${replacement.importConfirmedAt || ""}`,
  ].join("\n");
  const idempotencyKey = sha256(canonical);
  return { deleteJobId: `live-canary-delete:${idempotencyKey}`, idempotencyKey, canonical, target };
}

export function createLiveCanaryDeleteLedger(path) {
  const read = () => readJson(path, emptyLedger(), LIVE_CANARY_DELETE_LEDGER_FORMAT, "LIVE_CANARY_DELETE_LEDGER_CORRUPT");
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
        const { target, contract } = assertLiveCanaryDeleteTarget(input.externalObjectNumber);
        if (
          input.sourceListingId !== contract.sourceListingId
          || input.replacementListingId !== contract.expectedReplacementListingId
          || input.replacementExternalObjectNumber !== contract.expectedReplacementExternalId
        ) throw liveError("LIVE_CANARY_DELETE_REPLACEMENT_GUARD", "Der vorbereitete Deletejob entspricht nicht dem fest vorab ausgewählten Source-Replacement-Paar.");
        const job = {
          deleteJobId: clean(input.deleteJobId, 200),
          idempotencyKey: clean(input.idempotencyKey, 128),
          projectId: clean(input.projectId, 200),
          sourceListingId: contract.sourceListingId,
          replacementListingId: contract.expectedReplacementListingId,
          externalObjectNumber: target,
          replacementExternalObjectNumber: contract.expectedReplacementExternalId,
          payloadFilename: clean(input.payloadFilename, 240),
          payloadSha256: clean(input.payloadSha256, 128),
          payloadSize: Number(input.payloadSize) || 0,
          preparedAt: now,
          transferStartedAt: "",
          transferCompletedAt: "",
          status: LIVE_CANARY_DELETE_STATUS.PREPARED,
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
        if (!current) throw liveError("LIVE_CANARY_DELETE_JOB_NOT_FOUND", "Der Deletejob fehlt.");
        if (current.status !== LIVE_CANARY_DELETE_STATUS.PREPARED) throw liveError("LIVE_CANARY_DELETE_ALREADY_ATTEMPTED", "Dieser Deletejob wurde bereits versucht und darf nicht erneut übertragen werden.");
        const job = { ...current, status: LIVE_CANARY_DELETE_STATUS.PROCESSING, attempt: 1, claimToken: randomUUID(), transferStartedAt: now, updatedAt: now };
        return { changed: true, ledger: replace(ledger, job), value: job };
      });
    },
    transferred(jobId, token, now = new Date().toISOString()) {
      return mutate(async (ledger) => {
        const current = ledger.jobs.find((job) => job.deleteJobId === jobId);
        if (current?.status !== LIVE_CANARY_DELETE_STATUS.PROCESSING || current.claimToken !== token) throw liveError("LIVE_CANARY_DELETE_CLAIM_MISMATCH", "Der Delete-Transfer besitzt keinen passenden Claim.");
        const job = { ...current, status: LIVE_CANARY_DELETE_STATUS.PENDING_CONFIRMATION, claimToken: "", transferCompletedAt: now, updatedAt: now };
        return { changed: true, ledger: replace(ledger, job), value: job };
      });
    },
    uncertain(jobId, token, message, now = new Date().toISOString()) {
      return mutate(async (ledger) => {
        const current = ledger.jobs.find((job) => job.deleteJobId === jobId);
        if (current?.status !== LIVE_CANARY_DELETE_STATUS.PROCESSING || current.claimToken !== token) return { changed: false, ledger, value: current };
        const job = { ...current, status: LIVE_CANARY_DELETE_STATUS.TRANSFER_UNCERTAIN, claimToken: "", message: clean(message), updatedAt: now };
        return { changed: true, ledger: replace(ledger, job), value: job };
      });
    },
    confirm(jobId, report, now = new Date().toISOString()) {
      return mutate(async (ledger) => {
        const current = ledger.jobs.find((job) => job.deleteJobId === jobId);
        if (!current) throw liveError("LIVE_CANARY_DELETE_JOB_NOT_FOUND", "Der Deletejob fehlt.");
        if (current.status === LIVE_CANARY_DELETE_STATUS.CONFIRMED) {
          if (current.reportHash === report.rawHash && current.reportMessageId === report.messageId) return { changed: false, ledger, value: current };
          if (current.externalObjectNumber !== report.externalObjectNumber || report.deleteResult !== "success") throw liveError("LIVE_CANARY_DELETE_CONFIRMATION_CONFLICT", "Ein bestätigter Delete erhielt einen widersprüchlichen Bericht.");
          const evidence = { messageId: clean(report.messageId, 500), rawHash: clean(report.rawHash, 128), providerProcessedAt: clean(report.providerProcessedAt, 50) };
          const existingEvidence = current.additionalReports || [];
          if (existingEvidence.some((item) => item.rawHash === evidence.rawHash || item.messageId === evidence.messageId)) return { changed: false, ledger, value: current };
          const job = { ...current, additionalReports: [...existingEvidence, evidence].slice(-20), updatedAt: now };
          return { changed: true, ledger: replace(ledger, job), value: job };
        }
        if (current.status !== LIVE_CANARY_DELETE_STATUS.PENDING_CONFIRMATION) throw liveError("LIVE_CANARY_DELETE_CONFIRMATION_STATUS_INVALID", "Nur ein eindeutig übertragener Delete darf bestätigt werden.");
        if (current.externalObjectNumber !== report.externalObjectNumber || report.deleteResult !== "success") throw liveError("LIVE_CANARY_DELETE_CONFIRMATION_MISMATCH", "Der Löschbericht gehört nicht exakt zur alten Quell-Objektnummer.");
        const job = { ...current, status: LIVE_CANARY_DELETE_STATUS.CONFIRMED, reportMessageId: clean(report.messageId, 500), reportHash: clean(report.rawHash, 128), providerProcessedAt: clean(report.providerProcessedAt, 50), confirmedAt: now, updatedAt: now };
        return { changed: true, ledger: replace(ledger, job), value: job };
      });
    },
  };
}

export function finalizeLiveCanaryDeleteInState(state, job, report, options = {}) {
  const now = clean(options.now || new Date().toISOString(), 50);
  const { contract } = assertLiveCanaryDeleteTarget(job.externalObjectNumber);
  const project = state.projects.find((candidate) => candidate.id === job.projectId);
  const source = project?.listings.find((listing) => listing.id === contract.sourceListingId);
  const replacement = project?.listings.find((listing) => listing.id === contract.expectedReplacementListingId);
  if (
    !project || !source || !replacement
    || source.externalId !== job.externalObjectNumber
    || replacement.externalId !== contract.expectedReplacementExternalId
    || source.supersededByListingId !== replacement.id
  ) throw liveError("LIVE_CANARY_DELETE_CATALOG_MISMATCH", "Die persistente Source-Replacement-Beziehung hat sich geändert.");
  if (job.status !== LIVE_CANARY_DELETE_STATUS.CONFIRMED || report.externalObjectNumber !== source.externalId || report.deleteResult !== "success") throw liveError("LIVE_CANARY_DELETE_CONFIRMATION_MISMATCH", "Ohne positiven exakten Löschbericht darf der Katalog nicht finalisiert werden.");
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
  if (JSON.stringify(nextProject.listings.find((listing) => listing.id === replacement.id)) !== replacementSnapshot) throw liveError("LIVE_CANARY_DELETE_REPLACEMENT_MUTATED", "Die Delete-Finalisierung hat das Replacement unerwartet verändert.");
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

export async function prepareLiveCanaryDelete(input) {
  const { target } = assertLiveCanaryDeleteTarget(input.target);
  const mode = await input.modeStore.load();
  assertMode(mode, target);
  const ledgerState = await input.ledger.read();
  const eligibility = resolveLiveCanaryDeleteEligibility(input.state, target, ledgerState);
  const identity = liveCanaryDeleteIdentity(eligibility.source, eligibility.replacement);
  const existingJob = ledgerState.jobs.find((job) => job.deleteJobId === identity.deleteJobId);
  const payload = await buildLiveCanaryDeletePayload(input.state, eligibility, {
    preparedAt: existingJob?.status === LIVE_CANARY_DELETE_STATUS.PREPARED
      ? existingJob.preparedAt
      : input.now?.(),
  });
  await validateDeleteXmlAgainstSchema(payload.xmlText, input.schemaPath, { spawn: input.schemaValidator });
  const job = await input.ledger.prepare({
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
  if (
    job.payloadFilename !== payload.payloadFilename
    || job.payloadSha256 !== payload.payloadSha256
    || job.payloadSize !== payload.payloadSize
  ) {
    throw liveError(
      "LIVE_CANARY_DELETE_PAYLOAD_MISMATCH",
      "Der erneut erzeugte Delete-Payload stimmt nicht exakt mit dem vorbereiteten Ledgerjob überein.",
    );
  }
  return { target, mode, eligibility, identity, payload, job };
}
