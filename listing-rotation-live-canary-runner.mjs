#!/usr/bin/env node
import { Client } from "basic-ftp";
import { Readable } from "node:stream";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createUploadJobId } from "./batch-upload.mjs";
import { loadCatalogImage } from "./catalog-store.mjs";
import { createCatalogStateStore } from "./catalog-state-store.mjs";
import { loadCredentialVault } from "./credential-vault.mjs";
import { buildImportPackage } from "./app/lib/openimmo.ts";
import { createListingRotationOperatingModeStore } from "./listing-rotation-operating-mode.mjs";
import { createListingRotationSchedulerService } from "./listing-rotation-scheduler-service.mjs";
import { createPersistentLease } from "./persistent-lease.mjs";
import { APPLICATION_DATA_DIRECTORY } from "./platform-paths.mjs";
import {
  collectPlotUploadEvidence,
  createPlotDailyUploadGuard,
  plotUploadDayKey,
} from "./plot-daily-upload-guard.mjs";
import { createStructuredFileLogger } from "./structured-log.mjs";
import { createUploadJobLedger } from "./upload-job-ledger.mjs";
import { LIVE_CANARY_DELETE_TARGETS } from "./listing-rotation-live-canary-delete.mjs";
import { WORKFLOW_STATUS } from "./workflow-status.mjs";

export const LIVE_CANARY_ROTATION_SOURCES = Object.freeze(Object.fromEntries(
  Object.entries(LIVE_CANARY_DELETE_TARGETS).map(([externalId, contract]) => [externalId, Object.freeze({
    externalId,
    sourceListingId: contract.sourceListingId,
    plotId: contract.plotId,
    expectedReplacementListingId: contract.expectedReplacementListingId,
    expectedReplacementExternalId: contract.expectedReplacementExternalId,
  })]),
));

const MODE_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-mode.json");
const SCHEDULER_LOCK_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-scheduler.lock");
const SCHEDULER_LOG_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-scheduler.log");
const UPLOAD_LOG_PATH = join(APPLICATION_DATA_DIRECTORY, "upload.log");
const UPLOAD_LEDGER_PATH = join(APPLICATION_DATA_DIRECTORY, "upload-jobs.json");
const DAILY_GUARD_PATH = join(APPLICATION_DATA_DIRECTORY, "plot-daily-upload-guard.json");

function liveError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function safeMessage(value, maximum = 500) {
  return String(value || "")
    .replace(/\bsk-[a-zA-Z0-9_-]{12,}\b/gu, "[REDACTED]")
    .replace(/\bBearer\s+[a-zA-Z0-9._~+\/-]+=*/giu, "Bearer [REDACTED]")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/giu, "$1[REDACTED]@")
    .replace(/\b(password|passwort|token|secret|api.?key)\s*[=:]\s*[^\s,;]+/giu, "$1=[REDACTED]")
    .slice(0, maximum);
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

async function hydrateImage(image) {
  if (/^data:image\/(?:jpeg|png|webp);base64,/iu.test(String(image?.dataUrl || ""))) return image;
  const stored = await loadCatalogImage(image.id);
  return { ...image, mimeType: stored.mimeType, dataUrl: `data:${stored.mimeType};base64,${stored.data.toString("base64")}` };
}

function assertAuthorizedSource(value) {
  const externalId = String(value || "").trim();
  const contract = LIVE_CANARY_ROTATION_SOURCES[externalId];
  if (!contract) throw liveError("LIVE_CANARY_ROTATION_SOURCE_NOT_AUTHORIZED", "Der Runner akzeptiert ausschließlich eine der drei read-only vorab ausgewählten Quell-Objektnummern.");
  return contract;
}

function assertExactCanaryMode(mode, contract) {
  if (
    mode?.valid !== true
    || mode.mode !== "canary"
    || mode.canaryListingIds?.length !== 1
    || ![contract.sourceListingId, contract.externalId].includes(mode.canaryListingIds[0])
  ) {
    throw liveError("LIVE_CANARY_ROTATION_MODE_MISMATCH", "Der persistente Rotationsmodus ist nicht exakt für die eine angeforderte Quelle freigegeben.");
  }
}

function assertExactUploadContext(state, project, listing, contract) {
  const source = project?.listings?.find((candidate) => candidate.id === contract.sourceListingId);
  if (
    project?.plotId !== contract.plotId
    || source?.externalId !== contract.externalId
    || listing?.id !== contract.expectedReplacementListingId
    || listing?.externalId !== contract.expectedReplacementExternalId
    || listing?.rotationSourceListingId !== contract.sourceListingId
  ) {
    throw liveError("LIVE_CANARY_ROTATION_CONTEXT_MISMATCH", "Der Scheduler-Upload weicht vom vorab festgelegten Source-Replacement-Paar ab.");
  }
  const matchingCopies = (state.projects || []).flatMap((candidateProject) => (candidateProject.listings || []).filter((candidate) =>
    candidate.listingOrigin === "rotation-copy"
    && candidate.rotationSourceListingId === contract.sourceListingId
    && !candidate.rotationArchivedAt));
  if (matchingCopies.length !== 1 || matchingCopies[0].id !== listing.id) {
    throw liveError("LIVE_CANARY_ROTATION_COPY_COUNT_INVALID", "Für die Quelle existiert nicht exakt die erwartete eine Rotationskopie.");
  }
}

export function createLiveCanaryRotationUpload(options) {
  const contract = assertAuthorizedSource(options.contract.externalId);
  const modeStore = options.modeStore;
  const uploadLedger = options.uploadLedger;
  const dailyGuard = options.dailyGuard;
  const loadVault = options.loadCredentialVault || loadCredentialVault;
  const loadImage = options.hydrateImage || hydrateImage;
  const packageBuilder = options.buildImportPackage || buildImportPackage;
  const clientFactory = options.clientFactory || (() => new Client(300_000));
  const writeLog = options.writeLog || (async () => undefined);
  const now = options.now || (() => new Date().toISOString());

  return async ({ state, project, listing, runId }) => {
    assertExactCanaryMode(await modeStore.load(), contract);
    assertExactUploadContext(state, project, listing, contract);
    const at = now();
    const jobId = createUploadJobId(project, listing);
    const uploadJob = {
      jobId,
      projectId: project.id,
      listingId: listing.id,
      plotId: project.plotId,
      plotUploadDayKey: plotUploadDayKey(project.plotId, at),
      jobType: "automatic-listing-rotation",
    };
    const uploadClaim = await uploadLedger.claim(uploadJob, at);
    if (uploadClaim.alreadyCompleted) return { ok: true, idempotent: true, jobId };

    let dailyClaim;
    let client;
    try {
      const ledger = await uploadLedger.read();
      const evidence = collectPlotUploadEvidence(state, ledger, at);
      const claimed = await dailyGuard.claim(uploadJob, { now: at, evidence });
      dailyClaim = { ...uploadJob, claimToken: claimed.record.claimToken };

      const vault = await loadVault();
      const ftp = vault?.credentials || {};
      if (!ftp.ftpHost || !ftp.ftpUser || !ftp.ftpPassword) throw liveError("LIVE_CANARY_FTPS_CREDENTIALS_MISSING", "Der FTPS-Zugang ist unvollständig.");
      const sourceHouse = state.houses.find((house) => house.id === listing.templateId);
      if (!sourceHouse) throw liveError("LIVE_CANARY_HOUSE_MISSING", "Der erwartete Haustyp fehlt im Katalog.");
      const hydratedHouse = { ...sourceHouse, images: await Promise.all((sourceHouse.images || []).map(loadImage)) };
      const packageResult = await packageBuilder({
        project,
        listings: [listing],
        houses: [hydratedHouse],
        provider: state.provider,
        promotionImageEnabled: false,
        promotionImagesByListingId: {},
      });
      const archive = Buffer.from(await packageResult.blob.arrayBuffer());
      const remotePath = String(ftp.ftpPath || "/").trim();
      await writeLog("started", { ...uploadJob, runId, externalId: listing.externalId, filename: packageResult.filename, archiveBytes: archive.length, status: WORKFLOW_STATUS.PROCESSING });
      client = clientFactory();
      client.ftp.verbose = false;
      await client.access(ftpAccessOptions(ftp));
      if (remotePath && remotePath !== "/") await client.cd(remotePath);
      await dailyGuard.markTransferStarted(dailyClaim, now());
      await client.uploadFrom(Readable.from(archive), packageResult.filename);
      const transferredAt = now();
      await dailyGuard.complete(dailyClaim, transferredAt);
      await uploadLedger.complete(uploadJob, transferredAt);
      await writeLog("transferred", { ...uploadJob, runId, externalId: listing.externalId, filename: packageResult.filename, archiveBytes: archive.length, status: WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT });
      return { ok: true, idempotent: false, jobId, filename: packageResult.filename };
    } catch (error) {
      if (dailyClaim) await dailyGuard.fail({ ...dailyClaim, reason: safeMessage(error?.message || "Canary-Upload fehlgeschlagen.") }, now()).catch(() => undefined);
      await uploadLedger.fail({ ...uploadJob, errorCode: String(error?.code || "LIVE_CANARY_UPLOAD_FAILED"), message: safeMessage(error?.message || "Canary-Upload fehlgeschlagen.") }, now()).catch(() => undefined);
      await writeLog("failed", { ...uploadJob, runId, externalId: listing.externalId, status: WORKFLOW_STATUS.FAILED, errorCode: String(error?.code || "LIVE_CANARY_UPLOAD_FAILED"), message: safeMessage(error?.message || "Canary-Upload fehlgeschlagen.") });
      throw error;
    } finally {
      client?.close();
    }
  };
}

function defaultRuntime(contract) {
  const modeStore = createListingRotationOperatingModeStore(MODE_PATH);
  const uploadLedger = createUploadJobLedger(UPLOAD_LEDGER_PATH);
  const dailyGuard = createPlotDailyUploadGuard(DAILY_GUARD_PATH);
  const writeUploadLog = createStructuredFileLogger(UPLOAD_LOG_PATH, { jobType: "immoprofessional-upload" });
  const service = createListingRotationSchedulerService({
    store: createCatalogStateStore(),
    lease: createPersistentLease(SCHEDULER_LOCK_PATH),
    operatingModeStore: modeStore,
    upload: createLiveCanaryRotationUpload({ contract, modeStore, uploadLedger, dailyGuard, writeLog: writeUploadLog }),
    writeRunLog: createStructuredFileLogger(SCHEDULER_LOG_PATH, { jobType: "listing-rotation-scheduler" }),
  });
  return { modeStore, service };
}

export async function runLiveCanaryRotationOnce(input, options = {}) {
  const contract = assertAuthorizedSource(input?.sourceExternalId);
  if (input?.ignoreTimeWindowOnce !== true) throw liveError("LIVE_CANARY_TIME_OVERRIDE_REQUIRED", "Der Einzel-Canary benötigt den ausdrücklich flüchtigen Zeitfenster-Override.");
  const runtime = options.runtime || defaultRuntime(contract);
  try {
    assertExactCanaryMode(await runtime.modeStore.load(), contract);
    const result = await runtime.service.run({
      trigger: "manual-live-canary-3",
      ignoreTimeWindow: true,
      now: input.now,
    });
    if (!result.claimed || !result.ok || result.completedListingIds.length !== 1 || result.completedListingIds[0] !== contract.sourceListingId) {
      throw liveError("LIVE_CANARY_ROTATION_SINGLE_RUN_FAILED", "Der Schedulerlauf hat nicht exakt die freigegebene eine Quelle erfolgreich übertragen.");
    }
    return { ok: true, sourceExternalId: contract.externalId, expectedReplacementExternalId: contract.expectedReplacementExternalId, result };
  } finally {
    await runtime.modeStore.save({ mode: "off", canaryListingIds: [] });
  }
}

function parseArguments(argv) {
  const input = { sourceExternalId: "", ignoreTimeWindowOnce: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--source") input.sourceExternalId = String(argv[++index] || "");
    else if (argv[index] === "--ignore-time-window-once") input.ignoreTimeWindowOnce = true;
    else throw new Error(`Unbekanntes Argument: ${argv[index]}`);
  }
  return input;
}

async function main() {
  try {
    const result = await runLiveCanaryRotationOnce(parseArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error?.code ? `${error.code}: ` : ""}${safeMessage(error?.message || "Der Live-Canary ist fehlgeschlagen.")}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
