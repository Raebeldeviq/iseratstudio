#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";

import { Client } from "basic-ftp";

import { createAppleMailDeleteReportAdapter } from "./apple-mail-live-canary-delete-report-adapter.mjs";
import { createCatalogStateStore } from "./catalog-state-store.mjs";
import { loadCredentialVault } from "./credential-vault.mjs";
import {
  ALLOWED_LEGACY_EXTERNAL_OBJECT_NUMBERS,
  createLegacyDeleteService,
  LEGACY_RECONCILIATION_CASES,
  reconcileLegacyImportInState,
  resolveLegacyReconciliationEligibility,
} from "./listing-rotation-legacy-reconciliation.mjs";
import { createListingRotationOperatingModeStore } from "./listing-rotation-operating-mode.mjs";
import {
  createProductionDeleteLedger,
  createProductionDeleteModeStore,
} from "./listing-rotation-production-delete.mjs";
import { APPLICATION_DATA_DIRECTORY } from "./platform-paths.mjs";
import { createStructuredFileLogger } from "./structured-log.mjs";
import { createUploadJobLedger } from "./upload-job-ledger.mjs";

export const LEGACY_DELETE_LEDGER_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-legacy-delete-jobs.json");
export const LEGACY_RECONCILIATION_LOG_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-legacy-reconciliation.log");
const ROTATION_MODE_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-mode.json");
const PRODUCTION_DELETE_MODE_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-production-delete-mode.json");
const UPLOAD_LEDGER_PATH = join(APPLICATION_DATA_DIRECTORY, "upload-jobs.json");
const UPLOAD_LOG_PATH = join(APPLICATION_DATA_DIRECTORY, "upload.log");

function legacyCliError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseArguments(argv) {
  const [command = "status", ...rest] = argv;
  const parsed = { command, externalObjectNumber: "", evidencePath: "", legacyMode: "" };
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === "--external-id") parsed.externalObjectNumber = String(rest[++index] || "").trim();
    else if (rest[index] === "--evidence") parsed.evidencePath = String(rest[++index] || "").trim();
    else if (rest[index] === "--legacy-mode") parsed.legacyMode = String(rest[++index] || "").trim();
    else throw new Error(`Unbekanntes Argument: ${rest[index]}`);
  }
  return parsed;
}

function assertLegacyCommand(parsed) {
  if (!ALLOWED_LEGACY_EXTERNAL_OBJECT_NUMBERS.includes(parsed.externalObjectNumber)) {
    throw legacyCliError("LEGACY_RECONCILIATION_NOT_AUTHORIZED", "Die exakte Replacement-Objektnummer ist nicht für die einmalige Legacy-Reconciliation freigegeben.");
  }
  if (parsed.legacyMode !== "one-time") {
    throw legacyCliError("LEGACY_MODE_REQUIRED", "Mutierende Legacy-Befehle verlangen ausdrücklich --legacy-mode one-time.");
  }
}

async function readEvidence(path) {
  if (!path) throw legacyCliError("LEGACY_PROVIDER_EVIDENCE_REQUIRED", "Der aktuelle read-only Providernachweis fehlt.");
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size < 2 || metadata.size > 16 * 1024) {
    throw legacyCliError("LEGACY_PROVIDER_EVIDENCE_INVALID", "Die Providernachweisdatei besitzt eine ungültige Größe oder Dateiform.");
  }
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw legacyCliError("LEGACY_PROVIDER_EVIDENCE_INVALID", "Die Providernachweisdatei ist kein gültiges JSON.");
  }
}

function ftpAccessOptions(ftp) {
  return {
    host: String(ftp.ftpHost),
    user: String(ftp.ftpUser),
    password: String(ftp.ftpPassword),
    secure: ftp.ftpSecure === "implicit" ? "implicit" : ftp.ftpSecure === "explicit",
    secureOptions: { rejectUnauthorized: true },
  };
}

function publicDeleteJob(job) {
  if (!job) return null;
  const value = { ...job };
  delete value.claimToken;
  return value;
}

async function readHistoricalUploadEvidence(path = UPLOAD_LOG_PATH) {
  try {
    return (await readFile(path, "utf8"))
      .split(/\r?\n/gu)
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const entry = JSON.parse(line);
          return entry?.event === "transferred" ? [entry] : [];
        } catch {
          return [];
        }
      });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function caseStatus(state, uploadLedger, deleteLedger, uploadEvidence, externalObjectNumber) {
  const contract = LEGACY_RECONCILIATION_CASES[externalObjectNumber];
  const project = (state.projects || []).find((candidate) => candidate.id === contract.projectId);
  const source = project?.listings?.find((listing) => listing.id === contract.sourceListingId);
  const replacement = project?.listings?.find((listing) => listing.id === contract.replacementListingId);
  const uploadJob = (uploadLedger.jobs || []).find((job) => job.jobId === contract.uploadJobId);
  const uploadHistory = (state.uploadHistory || []).find((entry) => entry.jobId === contract.uploadJobId);
  const uploadLog = uploadEvidence.find((entry) => entry.jobId === contract.uploadJobId);
  const deleteJob = (deleteLedger.jobs || []).find((job) => job.sourceListingId === contract.sourceListingId);
  const evidence = (state.legacyImportReconciliations || []).find((entry) => entry.externalObjectNumber === externalObjectNumber);
  return {
    replacementExternalObjectNumber: externalObjectNumber,
    sourceExternalObjectNumber: contract.sourceExternalObjectNumber,
    projectId: project?.id || null,
    plotId: project?.plotId || null,
    plot: project?.name || null,
    replacementListingId: replacement?.id || null,
    sourceListingId: source?.id || null,
    replacementStatus: replacement?.status || null,
    sourceStatus: source?.status || null,
    house: replacement?.templateName || null,
    uploadJobId: uploadJob?.jobId || null,
    historicalTransferAt: replacement?.transferredAt || uploadLog?.timestamp || uploadJob?.transferredAt || uploadJob?.updatedAt || uploadHistory?.updatedAt || null,
    archiveFilename: uploadLog?.filename || uploadJob?.filename || uploadJob?.archiveFilename || uploadHistory?.filename || uploadHistory?.archiveFilename || null,
    archiveBytes: uploadLog?.archiveBytes || uploadJob?.bytes || uploadJob?.archiveBytes || uploadHistory?.bytes || uploadHistory?.archiveBytes || null,
    archiveSha256: uploadLog?.archiveSha256 || uploadJob?.archiveSha256 || uploadHistory?.archiveSha256 || null,
    imageCount: uploadLog?.imageCount || uploadJob?.imageCount || uploadHistory?.imageCount || null,
    uploadStatus: uploadJob?.status || null,
    replacementRelationConsistent: replacement?.rotationSourceListingId === source?.id,
    reconciliationEvidenceId: evidence?.evidenceId || null,
    confirmationSource: replacement?.confirmationSource || null,
    externalDeletionPending: source?.externalDeletionPending === true,
    legacyDeleteState: source?.legacyDeleteState || null,
    deleteJob: publicDeleteJob(deleteJob),
  };
}

export async function runLegacyReconciliationCli(argv, options = {}) {
  const parsed = parseArguments(argv);
  const store = options.store || createCatalogStateStore();
  const uploadLedger = options.uploadLedger || createUploadJobLedger(UPLOAD_LEDGER_PATH);
  const legacyDeleteLedger = options.legacyDeleteLedger || createProductionDeleteLedger(LEGACY_DELETE_LEDGER_PATH);
  const rotationModeStore = options.rotationModeStore || createListingRotationOperatingModeStore(ROTATION_MODE_PATH);
  const productionDeleteModeStore = options.productionDeleteModeStore || createProductionDeleteModeStore(PRODUCTION_DELETE_MODE_PATH);
  const writeLog = options.writeLog || createStructuredFileLogger(LEGACY_RECONCILIATION_LOG_PATH, { jobType: "legacy-import-reconciliation" });
  const now = options.now || (() => new Date().toISOString());

  const assertSafeModes = async () => {
    const [rotation, deletion] = await Promise.all([rotationModeStore.load(), productionDeleteModeStore.load()]);
    if (rotation.valid !== true || rotation.mode !== "off" || deletion.valid !== true || deletion.mode !== "off") {
      throw legacyCliError("LEGACY_RECONCILIATION_MODES_NOT_OFF", "Rotation und reguläres Produktions-Delete müssen für die einmalige Legacy-Reconciliation explizit gültig auf off stehen.");
    }
    return { rotation, deletion };
  };

  if (parsed.command === "status") {
    const [snapshot, uploads, deletes, uploadEvidence, modes] = await Promise.all([
      store.load(),
      uploadLedger.read(),
      legacyDeleteLedger.read(),
      options.readHistoricalUploadEvidence ? options.readHistoricalUploadEvidence() : readHistoricalUploadEvidence(),
      Promise.all([rotationModeStore.load(), productionDeleteModeStore.load()]),
    ]);
    return {
      modes: { rotation: modes[0], deletion: modes[1] },
      allowedLegacyExternalObjectNumbers: ALLOWED_LEGACY_EXTERNAL_OBJECT_NUMBERS,
      cases: ALLOWED_LEGACY_EXTERNAL_OBJECT_NUMBERS.map((externalObjectNumber) => caseStatus(snapshot.state, uploads, deletes, uploadEvidence, externalObjectNumber)),
    };
  }

  assertLegacyCommand(parsed);
  await assertSafeModes();
  if (parsed.command === "preflight") {
    const evidence = await readEvidence(parsed.evidencePath);
    const [snapshot, uploads] = await Promise.all([store.load(), uploadLedger.read()]);
    const result = resolveLegacyReconciliationEligibility(snapshot.state, uploads, evidence, { now: now() });
    return { status: result.status, replacementExternalObjectNumber: parsed.externalObjectNumber, sourceExternalObjectNumber: result.source.externalId, uploadJobId: result.uploadJobId || result.evidence?.matchedUploadJobId || null, historicalTransferAt: result.historicalTransferAt || result.evidence?.historicalTransferAt || null };
  }
  if (parsed.command === "reconcile") {
    const evidence = await readEvidence(parsed.evidencePath);
    const uploads = await uploadLedger.read();
    await assertSafeModes();
    const updated = await store.update((state) => reconcileLegacyImportInState(state, uploads, evidence, { now: now() }), { now: now() });
    await writeLog("reconciled", {
      replacementExternalObjectNumber: parsed.externalObjectNumber,
      sourceExternalObjectNumber: LEGACY_RECONCILIATION_CASES[parsed.externalObjectNumber].sourceExternalObjectNumber,
      status: updated.result?.status,
      evidenceId: updated.result?.evidence?.evidenceId || null,
      confirmationSource: updated.result?.evidence?.confirmationSource || null,
      timestampSource: updated.result?.timestampSource || null,
    });
    return updated.result;
  }

  const mailAdapter = options.mailAdapter || createAppleMailDeleteReportAdapter();
  const upload = options.upload || (async ({ archive, filename }) => {
    const vault = await loadCredentialVault();
    const ftp = vault.credentials;
    if (!ftp.ftpHost || !ftp.ftpUser || !ftp.ftpPassword) throw legacyCliError("LEGACY_DELETE_FTPS_CREDENTIALS_MISSING", "Der Immoprofessional-FTPS-Zugang ist unvollständig.");
    const remotePath = String(ftp.ftpPath || "/").trim() || "/";
    const client = new Client(300_000);
    client.ftp.verbose = false;
    try {
      await client.access(ftpAccessOptions(ftp));
      if (remotePath !== "/") await client.cd(remotePath);
      await client.uploadFrom(Readable.from(archive), filename);
    } finally {
      client.close();
    }
  });
  const service = createLegacyDeleteService({
    store,
    ledger: legacyDeleteLedger,
    mailAdapter,
    upload,
    assertSafeModes,
    writeLog,
    now,
  });
  if (parsed.command === "delete") return service.transfer(parsed.externalObjectNumber);
  if (parsed.command === "confirm-delete") return service.confirm(parsed.externalObjectNumber);
  throw new Error("Erlaubte Befehle: status, preflight, reconcile, delete, confirm-delete.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLegacyReconciliationCli(process.argv.slice(2)).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error?.code ? `${error.code}: ` : ""}${error instanceof Error ? error.message : "Legacy-Reconciliation fehlgeschlagen."}\n`);
    process.exitCode = 1;
  });
}
