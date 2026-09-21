import { Client } from "basic-ftp";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join, parse } from "node:path";
import { Readable } from "node:stream";
import { generateAiImageCaptions, generateAiListing, validateOpenAiApiKey } from "./ai-text-service.mjs";
import {
  clearCredentialVault,
  loadCredentialVault,
  normalizeCredentials,
  publicCredentialStatus,
  saveCredentialVault,
} from "./credential-vault.mjs";
import { APPLICATION_DATA_DIRECTORY } from "./platform-paths.mjs";
import {
  commitCatalogSnapshot,
  loadCatalogSnapshot,
  loadCatalogImage,
  loadCatalogManifest,
  migrateCatalogManifest,
  saveCatalogSnapshot,
  saveCatalogImage,
  startCatalogSnapshot,
} from "./catalog-store.mjs";
import { getMediaLibraryItem, queryMediaLibrary, recommendedMediaSequence } from "./media-library.mjs";
import { createStructuredFileLogger } from "./structured-log.mjs";
import { createUploadJobLedger } from "./upload-job-ledger.mjs";
import {
  completedManualBatchListingIds,
  requiresPlotDailyUploadClaim,
  UPLOAD_ORIGIN,
} from "./manual-batch-upload.mjs";
import {
  collectPlotUploadEvidence,
  createPlotDailyUploadGuard,
  plotUploadDayKey,
} from "./plot-daily-upload-guard.mjs";
import { WORKFLOW_STATUS } from "./workflow-status.mjs";
import { assertCatalogProductionReady } from "./listing-catalog-view.mjs";
import {
  analyzePlotExpose,
  archivePlotExpose,
  commitPlotExpose,
  MAX_PLOT_EXPOSE_BYTES,
  readPlotExpose,
} from "./plot-expose-store.mjs";
import { createPlotSyncService } from "./plot-sync-service.mjs";
import { buildImportPackage } from "./app/lib/openimmo.ts";
import { createUploadJobId } from "./batch-upload.mjs";
import { eligiblePromotionHeroImages } from "./listing-creative-selection.mjs";
import { assertCreativePayload } from "./listing-creative-payload-guard.mjs";
import {
  assertProductionRuntime,
  loadHelperRuntimeProvenance,
  verifyProductionRuntime,
} from "./helper-runtime-provenance.mjs";
import { createProductionRuntimeOwnershipGuard } from "./production-runtime-ownership.mjs";
import { createRegression85CampaignStore } from "./regression-85-repair-scope.mjs";
import {
  createRegression85NonExportedAttestationStore,
  createRegression85NonExportedConfirmationResolver,
} from "./regression-85-non-exported-delete-confirmation.mjs";
import { createRegression85DeleteMutationGuard } from "./regression-85-repair-service.mjs";
import { createCatalogStateStore } from "./catalog-state-store.mjs";
import { createListingRotationSchedulerService } from "./listing-rotation-scheduler-service.mjs";
import { createProductionRotationLifecycleCoordinator } from "./listing-rotation-lifecycle-coordinator.mjs";
import { createPersistentLease } from "./persistent-lease.mjs";
import { createListingRotationOperatingModeStore } from "./listing-rotation-operating-mode.mjs";
import {
  assertPolicyBoundAutomaticRotationUpload,
  createListingRotationProductionPolicyStore,
} from "./listing-rotation-production-policy.mjs";
import { createProductionBatchOverrideStore } from "./production-batch-override.mjs";
import { createAppleMailImportReportAdapter } from "./apple-mail-import-report-adapter.mjs";
import { runMailRuntimeProbe } from "./mail-runtime-probe.mjs";
import { createAppleMailDeleteReportAdapter } from "./apple-mail-live-canary-delete-report-adapter.mjs";
import {
  createImmoprofessionalImportReportService,
  DEFAULT_IMPORT_REPORT_POLL_INTERVAL_MS,
} from "./immoprofessional-import-report-service.mjs";
import {
  createProductionDeleteLedger,
  createProductionDeleteModeStore,
  createProductionDeleteService,
} from "./listing-rotation-production-delete.mjs";
import {
  EXACT_PRODUCTION_DELETE_PATH,
  requireExactProductionDeleteTarget,
} from "./listing-rotation-production-delete-exact-contract.mjs";

const HOST = "127.0.0.1";
const PORT = 43182;
const MAX_BODY_BYTES = 180 * 1024 * 1024;
const MAX_CATALOG_BODY_BYTES = 500 * 1024 * 1024;
const MAX_IMAGE_BYTES = 100 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;
const UPLOAD_LOG_PATH = join(APPLICATION_DATA_DIRECTORY, "upload.log");
const UPLOAD_JOB_LEDGER_PATH = join(APPLICATION_DATA_DIRECTORY, "upload-jobs.json");
const PLOT_DAILY_UPLOAD_GUARD_PATH = join(APPLICATION_DATA_DIRECTORY, "plot-daily-upload-guard.json");
const LISTING_SCHEDULER_LOG_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-scheduler.log");
const LISTING_SCHEDULER_LOCK_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-scheduler.lock");
const LISTING_ROTATION_MODE_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-mode.json");
const LISTING_ROTATION_PRODUCTION_POLICY_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-production-policy.json");
const PRODUCTION_BATCH_OVERRIDE_PATH = join(APPLICATION_DATA_DIRECTORY, "production-batch-override.json");
const IMPORT_REPORT_LOG_PATH = join(APPLICATION_DATA_DIRECTORY, "immoprofessional-import-reports.log");
const MAIL_RUNTIME_LOG_PATH = join(APPLICATION_DATA_DIRECTORY, "mail-runtime.log");
const PRODUCTION_DELETE_MODE_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-production-delete-mode.json");
const PRODUCTION_DELETE_LEDGER_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-production-delete-jobs.json");
const PRODUCTION_DELETE_LOG_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-production-delete.log");
const REGRESSION_85_CAMPAIGN_PATH = join(APPLICATION_DATA_DIRECTORY, "regression-85-repair.json");
const PORTAL_EXPORT_LEDGER_PATH = join(APPLICATION_DATA_DIRECTORY, "immoprofessional-portal-export-jobs.json");
const PORTAL_EXPORT_LOG_PATH = join(APPLICATION_DATA_DIRECTORY, "immoprofessional-portal-export.log");
const REGRESSION_85_NON_EXPORTED_ATTESTATION_PATH = join(APPLICATION_DATA_DIRECTORY, "regression-85-non-exported-delete-confirmation.json");
const SESSION_TOKEN = String(process.env.FPI_SESSION_TOKEN || randomBytes(32).toString("hex"));
const HELPER_STARTED_AT = new Date().toISOString();
const RUNTIME_PROVENANCE = await loadHelperRuntimeProvenance();
const runtimeOwnershipGuard = createProductionRuntimeOwnershipGuard({
  provenance: RUNTIME_PROVENANCE,
  port: PORT,
});
const allowedOrigins = new Set([
  "http://localhost:43181",
  "http://127.0.0.1:43181",
]);
let credentialCache;
const writeUploadLog = createStructuredFileLogger(UPLOAD_LOG_PATH, { jobType: "immoprofessional-upload" });
const writeListingSchedulerLog = createStructuredFileLogger(LISTING_SCHEDULER_LOG_PATH, { jobType: "listing-rotation-scheduler" });
const writeImportReportLog = createStructuredFileLogger(IMPORT_REPORT_LOG_PATH, { jobType: "immoprofessional-import-report" });
const writeMailRuntimeLog = createStructuredFileLogger(MAIL_RUNTIME_LOG_PATH, { jobType: "mail-runtime-probe" });
const writeProductionDeleteLog = createStructuredFileLogger(PRODUCTION_DELETE_LOG_PATH, { jobType: "listing-rotation-production-delete" });
const uploadJobLedger = createUploadJobLedger(UPLOAD_JOB_LEDGER_PATH);
const plotDailyUploadGuard = createPlotDailyUploadGuard(PLOT_DAILY_UPLOAD_GUARD_PATH);
const plotSyncService = createPlotSyncService();
const catalogStateStore = createCatalogStateStore();
const listingSchedulerLease = createPersistentLease(LISTING_SCHEDULER_LOCK_PATH, {
  writeEvent: (event, details) => writeListingSchedulerLog(`lease-${event}`, {
    runtimeCommit: RUNTIME_PROVENANCE.runtimeCommit,
    runtimeRelease: RUNTIME_PROVENANCE.runtimeRelease,
    helperStartedAt: HELPER_STARTED_AT,
    ...details,
  }),
});
const listingRotationOperatingModeStore = createListingRotationOperatingModeStore(LISTING_ROTATION_MODE_PATH);
const listingRotationProductionPolicyStore = createListingRotationProductionPolicyStore(LISTING_ROTATION_PRODUCTION_POLICY_PATH);
const productionBatchOverrideStore = createProductionBatchOverrideStore(PRODUCTION_BATCH_OVERRIDE_PATH);
const productionDeleteModeStore = createProductionDeleteModeStore(PRODUCTION_DELETE_MODE_PATH);
const productionDeleteLedger = createProductionDeleteLedger(PRODUCTION_DELETE_LEDGER_PATH);
const regression85CampaignStore = createRegression85CampaignStore(REGRESSION_85_CAMPAIGN_PATH);
const regression85NonExportedAttestationStore = createRegression85NonExportedAttestationStore(REGRESSION_85_NON_EXPORTED_ATTESTATION_PATH);
const regression85DeleteMutationGuard = createRegression85DeleteMutationGuard(regression85CampaignStore);
const importReportMailAdapter = createAppleMailImportReportAdapter();
const productionDeleteMailAdapter = createAppleMailDeleteReportAdapter();
const importReportService = createImmoprofessionalImportReportService({
  store: catalogStateStore,
  uploadJobLedger,
  mailAdapter: importReportMailAdapter,
  writeLog: (event, details) => writeImportReportLog(event, details),
});

async function readPortalExportLedger() {
  try {
    return JSON.parse(await readFile(PORTAL_EXPORT_LEDGER_PATH, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return { format: 1, jobs: [] };
    throw new Error("Das Portalexport-Jobledger ist nicht eindeutig lesbar.");
  }
}

async function readPortalExportEvents() {
  try {
    return (await readFile(PORTAL_EXPORT_LOG_PATH, "utf8"))
      .split(/\r?\n/gu)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw new Error("Das Portalexport-Protokoll ist nicht eindeutig lesbar.");
  }
}

const regression85NonExportedConfirmationResolver = createRegression85NonExportedConfirmationResolver({
  attestationStore: regression85NonExportedAttestationStore,
  campaignStore: regression85CampaignStore,
  readPortalLedger: readPortalExportLedger,
  readPortalEvents: readPortalExportEvents,
});

async function credentialVault() {
  if (!credentialCache) credentialCache = await loadCredentialVault();
  return credentialCache;
}

function headers(origin) {
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "http://localhost:43181",
    "Access-Control-Allow-Headers": "Content-Type, X-FPI-Filename, X-FPI-Session, X-FPI-Job-Id, X-FPI-Project-Id, X-FPI-Listing-Id",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  };
}

function validSession(request) {
  const supplied = String(request.headers["x-fpi-session"] || "");
  const expected = Buffer.from(SESSION_TOKEN);
  const actual = Buffer.from(supplied);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function mediaSignature(id) {
  return createHmac("sha256", SESSION_TOKEN)
    .update(`media:${String(id || "")}`)
    .digest("base64url");
}

function validMediaSignature(id, suppliedSignature) {
  const expected = Buffer.from(mediaSignature(id));
  const actual = Buffer.from(String(suppliedSignature || ""));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function isGitLfsPointer(data) {
  return data.length < 1024
    && data.subarray(0, 100).toString("utf8").startsWith("version https://git-lfs.github.com/spec/v1");
}

function publicMediaItem(item) {
  const signature = mediaSignature(item.id);
  return {
    id: item.id,
    relativePath: item.relativePath,
    filename: item.filename,
    caption: item.caption,
    mimeType: item.mimeType,
    collection: item.collection,
    family: item.family,
    houseModel: item.houseModel,
    group: item.group,
    kind: item.kind,
    role: item.role,
    captionLocked: item.captionLocked === true,
    brandedCover: item.brandedCover === true,
    imageUrl: `http://${HOST}:${PORT}/media-library/image?id=${encodeURIComponent(item.id)}&sig=${encodeURIComponent(signature)}`,
  };
}

function send(response, status, payload, origin = "") {
  response.writeHead(status, headers(origin));
  response.end(JSON.stringify(payload));
}

function safeFilename(value) {
  const filename = String(value || "fabian-pascal-import.zip")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
  return filename.toLowerCase().endsWith(".zip") ? filename : `${filename}.zip`;
}

function decodedHeader(request, name) {
  const value = request.headers[name];
  if (!value) return "";
  try {
    return decodeURIComponent(String(value));
  } catch {
    return String(value);
  }
}

async function logUpload(event, details = {}) {
  try {
    const status = event === "failed"
      ? WORKFLOW_STATUS.FAILED
      : event === "transferred"
        ? WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT
        : WORKFLOW_STATUS.PROCESSING;
    await writeUploadLog(event, {
      status,
      runtimeCommit: RUNTIME_PROVENANCE.runtimeCommit,
      runtimeRelease: RUNTIME_PROVENANCE.runtimeRelease,
      helperStartedAt: HELPER_STARTED_AT,
      ...details,
    });
  } catch {
    // Ein Diagnoseprotokoll darf den eigentlichen Upload nicht blockieren.
  }
}

async function readJson(request, maximumBytes = MAX_BODY_BYTES) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maximumBytes) throw new Error("Die lokale Anfrage ist zu groß.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function readBytes(request, maximumBytes = MAX_IMAGE_BYTES) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maximumBytes) throw new Error("Die einzelne Datei ist zu groß.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
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

async function verifyFtpCredentials(ftp) {
  if (!ftp.ftpHost || !ftp.ftpUser || !ftp.ftpPassword) return false;
  const verificationClient = new Client(30_000);
  try {
    await verificationClient.access(ftpAccessOptions(ftp));
    if (ftp.ftpPath && ftp.ftpPath !== "/") await verificationClient.cd(ftp.ftpPath);
    return true;
  } finally {
    verificationClient.close();
  }
}

async function hydratedCatalogImage(image) {
  if (/^data:image\/(?:jpeg|png|webp);base64,/iu.test(String(image?.dataUrl || ""))) return image;
  const stored = await loadCatalogImage(image.id);
  return {
    ...image,
    mimeType: stored.mimeType,
    dataUrl: `data:${stored.mimeType};base64,${stored.data.toString("base64")}`,
  };
}

async function claimPlotDailyUpload({ state, project, uploadJob, now = new Date().toISOString() }) {
  if (!project?.plotId) {
    const error = new Error("Der produktive Listing-Upload besitzt keine stabile plotId und wird fail-closed blockiert.");
    error.code = "PLOT_DAILY_UPLOAD_PLOT_ID_REQUIRED";
    throw error;
  }
  const ledger = await uploadJobLedger.read();
  const evidence = collectPlotUploadEvidence(state, ledger, now);
  const context = {
    ...uploadJob,
    plotId: String(project.plotId),
    plotUploadDayKey: plotUploadDayKey(project.plotId, now),
  };
  const result = await plotDailyUploadGuard.claim(context, { now, evidence });
  return { ...context, claimToken: result.record.claimToken };
}

async function persistedUploadContext(projectId, listingId) {
  const snapshot = await catalogStateStore.load();
  if (!snapshot?.stored || !snapshot.state) {
    const error = new Error("Der persistente Katalog ist für den produktiven Upload nicht verfügbar.");
    error.code = "PLOT_DAILY_UPLOAD_CATALOG_UNAVAILABLE";
    throw error;
  }
  const project = snapshot.state.projects.find((candidate) => candidate.id === projectId);
  const listing = project?.listings?.find((candidate) => candidate.id === listingId);
  if (!project || !listing) {
    const error = new Error("Der produktive Upload kann keinem eindeutigen Kataloginserat zugeordnet werden.");
    error.code = "PLOT_DAILY_UPLOAD_CONTEXT_INCOMPLETE";
    throw error;
  }
  return { state: snapshot.state, project, listing };
}

async function automaticRotationUpload({ state, project, listing, runId, batchOverrideId = "", batchSchedulerRunId = "", effectiveMaxRunItems = null }) {
  assertCatalogProductionReady(state);
  assertCatalogProductionReady((await loadCatalogManifest()).state);
  const productionPolicy = await listingRotationProductionPolicyStore.load();
  const runtimeGuard = assertProductionRuntime(RUNTIME_PROVENANCE, productionPolicy);
  const runtimeOwnership = await runtimeOwnershipGuard.assert(productionPolicy);
  const lifecycle = listing.productionLifecycle;
  if (batchOverrideId) {
    const authorization = await productionBatchOverrideStore.authorize({
      overrideId: batchOverrideId,
      schedulerRunId: batchSchedulerRunId,
      runningRuntimeCommit: runtimeGuard.runtimeCommit,
    });
    if (
      authorization.valid !== true
      || lifecycle?.batchOverrideId !== batchOverrideId
      || !batchSchedulerRunId
      || lifecycle?.schedulerRunId !== batchSchedulerRunId
      || lifecycle?.runtimeCommit !== runtimeGuard.runtimeCommit
      || lifecycle?.batchOverrideMaxRunItems !== authorization.record?.maxRunItems
      || effectiveMaxRunItems !== authorization.record?.maxRunItems
    ) {
      const error = new Error("Der Rotationsupload besitzt keine eindeutige persistente One-Shot-/Scheduler-/Runtime-Provenienz.");
      error.code = "PRODUCTION_BATCH_OVERRIDE_UPLOAD_UNAUTHORIZED";
      throw error;
    }
  } else {
    assertPolicyBoundAutomaticRotationUpload({
      productionPolicy,
      lifecycle,
      runId,
      effectiveMaxRunItems,
    });
  }
  const jobId = createUploadJobId(project, listing);
  const uploadJob = {
    jobId,
    projectId: project.id,
    listingId: listing.id,
    plotId: String(project.plotId || ""),
    plotUploadDayKey: project.plotId ? plotUploadDayKey(project.plotId) : "",
    jobType: "automatic-listing-rotation",
    batchOverrideId,
    batchSchedulerRunId,
    effectiveMaxRunItems,
  };
  const claim = await uploadJobLedger.claim(uploadJob);
  if (claim.alreadyCompleted) {
    await logUpload("idempotent-skip", {
      ...uploadJob,
      runId,
      externalId: listing.externalId,
      status: WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT,
      message: "Der automatische Rotationsupload war bereits erfolgreich übertragen.",
    });
    return { ok: true, idempotent: true, jobId };
  }

  let client;
  let dailyClaim;
  try {
    dailyClaim = await claimPlotDailyUpload({ state, project, listing, uploadJob });
    const sourceHouse = state.houses.find((house) => house.id === listing.templateId);
    if (!sourceHouse) throw new Error("Der Haustyp der Rotationskopie ist nicht mehr vorhanden.");
    const hydratedHouse = {
      ...sourceHouse,
      images: await Promise.all((sourceHouse.images || []).map(hydratedCatalogImage)),
    };
    const promotionImageId = String(listing.promotionImageId || "");
    const promotionImage = promotionImageId
      ? eligiblePromotionHeroImages(state).find((image) => image.id === promotionImageId)
      : null;
    if (promotionImageId && !promotionImage) {
      const error = new Error("Das persistierte Aktionsbild ist nicht mehr für automatische Portalinserate freigegeben.");
      error.code = "AUTOMATIC_ROTATION_PROMOTION_NOT_ELIGIBLE";
      throw error;
    }
    const hydratedPromotionImage = promotionImage ? await hydratedCatalogImage(promotionImage) : null;
    const packageResult = await buildImportPackage({
      project,
      listings: [listing],
      houses: [hydratedHouse],
      provider: state.provider,
      promotionImageEnabled: listing.heroCreativeType === "action",
      promotionImagesByListingId: hydratedPromotionImage
        ? { [listing.id]: hydratedPromotionImage }
        : {},
      heroImageIdsByListingId: listing.heroCreativeType !== "action" && listing.heroImageId
        ? { [listing.id]: listing.heroImageId }
        : {},
    });
    const archive = Buffer.from(await packageResult.blob.arrayBuffer());
    const creativeGuard = await assertCreativePayload({
      listing,
      house: hydratedHouse,
      project,
      promotionImage: hydratedPromotionImage,
      packageResult,
      archive,
    });
    await logUpload("creative-payload-verified", {
      ...uploadJob,
      runId,
      externalId: listing.externalId,
      status: WORKFLOW_STATUS.PROCESSING,
      ...runtimeGuard,
      runtimeOwnershipValid: runtimeOwnership.valid,
      runtimePortOwnerPid: runtimeOwnership.portOwnerPids[0],
      ...creativeGuard.diagnostics,
    });
    const vault = await credentialVault();
    const ftp = vault.credentials;
    if (!ftp.ftpHost || !ftp.ftpUser || !ftp.ftpPassword) {
      throw new Error("Der FTP-Zugang ist unvollständig.");
    }
    const remotePath = String(ftp.ftpPath || "/").trim();
    await logUpload("started", {
      ...uploadJob,
      runId,
      externalId: listing.externalId,
      filename: packageResult.filename,
      archiveBytes: archive.length,
      host: String(ftp.ftpHost),
      remotePath,
      status: WORKFLOW_STATUS.PROCESSING,
    });
    assertCatalogProductionReady((await loadCatalogManifest()).state);
    client = new Client(300_000);
    client.ftp.verbose = false;
    await client.access(ftpAccessOptions(ftp));
    if (remotePath && remotePath !== "/") await client.cd(remotePath);
    await logUpload("connected", {
      ...uploadJob,
      runId,
      externalId: listing.externalId,
      filename: packageResult.filename,
      host: String(ftp.ftpHost),
      remotePath,
      transport: ftp.ftpSecure,
      status: WORKFLOW_STATUS.PROCESSING,
    });
    await plotDailyUploadGuard.markTransferStarted(dailyClaim);
    await client.uploadFrom(Readable.from(archive), packageResult.filename);
    await plotDailyUploadGuard.complete(dailyClaim);
    await uploadJobLedger.complete(uploadJob);
    await logUpload("transferred", {
      ...uploadJob,
      runId,
      externalId: listing.externalId,
      filename: packageResult.filename,
      archiveBytes: archive.length,
      host: String(ftp.ftpHost),
      remotePath,
      transport: ftp.ftpSecure,
      status: WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT,
      message: "FTPS-Übertragung abgeschlossen; Portalimport ist noch nicht bestätigt.",
    });
    return { ok: true, idempotent: false, jobId, filename: packageResult.filename };
  } catch (error) {
    if (error?.code === "CREATIVE_PAYLOAD_MISMATCH") {
      await logUpload("creative-payload-blocked", {
        ...uploadJob,
        runId,
        externalId: listing.externalId,
        status: WORKFLOW_STATUS.FAILED,
        errorCode: error.code,
        ...(error.diagnostics || {}),
      });
    }
    if (dailyClaim) {
      await plotDailyUploadGuard.fail({
        ...dailyClaim,
        reason: error instanceof Error ? error.message : "Automatischer Rotationsupload fehlgeschlagen.",
      }).catch(() => undefined);
    }
    await uploadJobLedger.fail({
      ...uploadJob,
      errorCode: String(error?.code || "AUTOMATIC_ROTATION_UPLOAD_FAILED"),
      message: error instanceof Error ? error.message : "Automatischer Rotationsupload fehlgeschlagen.",
    }).catch(() => undefined);
    await logUpload("failed", {
      ...uploadJob,
      runId,
      externalId: listing.externalId,
      status: WORKFLOW_STATUS.FAILED,
      errorCode: String(error?.code || "AUTOMATIC_ROTATION_UPLOAD_FAILED"),
      message: error instanceof Error ? error.message : "Automatischer Rotationsupload fehlgeschlagen.",
    });
    throw error;
  } finally {
    client?.close();
  }
}

async function automaticProductionDeleteUpload({ archive, filename }) {
  const productionPolicy = await listingRotationProductionPolicyStore.load();
  await runtimeOwnershipGuard.assert(productionPolicy);
  const vault = await credentialVault();
  const ftp = vault.credentials;
  if (!ftp.ftpHost || !ftp.ftpUser || !ftp.ftpPassword) {
    throw new Error("Der Immoprofessional-FTPS-Zugang ist unvollständig.");
  }
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
}

const productionDeleteService = createProductionDeleteService({
  store: catalogStateStore,
  modeStore: productionDeleteModeStore,
  ledger: productionDeleteLedger,
  productionPolicyStore: listingRotationProductionPolicyStore,
  batchOverrideStore: productionBatchOverrideStore,
  runtimeProvenance: RUNTIME_PROVENANCE,
  runtimeOwnershipGuard,
  mutationGuard: regression85DeleteMutationGuard,
  mailAdapter: productionDeleteMailAdapter,
  resolveConfirmationContext: regression85NonExportedConfirmationResolver,
  upload: automaticProductionDeleteUpload,
  writeLog: (event, details) => writeProductionDeleteLog(event, details),
});

const productionRotationLifecycleCoordinator = createProductionRotationLifecycleCoordinator({
  store: catalogStateStore,
  importReportService,
  productionDeleteService,
  productionDeleteModeStore,
  uploadJobLedger,
  productionDeleteLedger,
  writeLog: (event, details) => writeListingSchedulerLog(event, {
    runtimeCommit: RUNTIME_PROVENANCE.runtimeCommit,
    runtimeRelease: RUNTIME_PROVENANCE.runtimeRelease,
    helperStartedAt: HELPER_STARTED_AT,
    ...details,
  }),
});

const listingRotationSchedulerService = createListingRotationSchedulerService({
  store: catalogStateStore,
  lease: listingSchedulerLease,
  operatingModeStore: listingRotationOperatingModeStore,
  productionPolicyStore: listingRotationProductionPolicyStore,
  batchOverrideStore: productionBatchOverrideStore,
  runtimeProvenance: RUNTIME_PROVENANCE,
  runtimeOwnershipGuard,
  helperIdentity: `${RUNTIME_PROVENANCE.runtimeRelease || "runtime-unknown"}:${HELPER_STARTED_AT}:${process.pid}`,
  lifecycleCoordinator: productionRotationLifecycleCoordinator,
  upload: automaticRotationUpload,
  writeRunLog: (event, details) => writeListingSchedulerLog(event, {
    runtimeCommit: RUNTIME_PROVENANCE.runtimeCommit,
    runtimeRelease: RUNTIME_PROVENANCE.runtimeRelease,
    helperStartedAt: HELPER_STARTED_AT,
    ...details,
  }),
});

async function saveToDownloads(archive, requestedFilename) {
  const downloadsDirectory = join(homedir(), "Downloads");
  await mkdir(downloadsDirectory, { recursive: true });

  const filename = safeFilename(requestedFilename);
  const parts = parse(filename);
  for (let index = 0; index < 1000; index += 1) {
    const candidateName = index === 0
      ? filename
      : `${parts.name} (${index})${parts.ext}`;
    const candidatePath = join(downloadsDirectory, candidateName);
    let handle;
    try {
      handle = await open(candidatePath, "wx");
      await handle.writeFile(archive);
      await handle.close();
      return { filename: candidateName, path: candidatePath };
    } catch (error) {
      await handle?.close();
      if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") continue;
      throw error;
    }
  }
  throw new Error("Im Downloadordner konnte kein freier Dateiname gefunden werden.");
}

const server = createServer(async (request, response) => {
  const origin = String(request.headers.origin || "");
  const requestUrl = new URL(request.url || "/", `http://${HOST}:${PORT}`);
  const pathname = requestUrl.pathname;
  if (request.method === "OPTIONS") {
    response.writeHead(204, headers(origin));
    response.end();
    return;
  }

  const isHealth = request.method === "GET" && pathname === "/health";
  const isRuntimeProvenance = request.method === "GET" && pathname === "/runtime-provenance";
  const isUpload = request.method === "POST" && pathname === "/upload";
  const isBinaryUpload = request.method === "POST" && pathname === "/upload-binary";
  const isManualBatchResumption = request.method === "GET" && pathname === "/manual-batch-resumption";
  const isLocalSave = request.method === "POST" && pathname === "/save-package";
  const isTextGeneration = request.method === "POST" && pathname === "/generate-texts";
  const isImageCaptionGeneration = request.method === "POST" && pathname === "/generate-image-captions";
  const isOpenAiKeyValidation = request.method === "POST" && pathname === "/validate-openai-key";
  const isCredentialLoad = request.method === "GET" && pathname === "/credentials";
  const isCredentialSave = request.method === "POST" && pathname === "/credentials";
  const isCatalogLoad = request.method === "GET" && pathname === "/catalog";
  const isCatalogSave = request.method === "POST" && pathname === "/catalog";
  const isCatalogV2Start = request.method === "POST" && pathname === "/catalog-v2/start";
  const isCatalogV2ImageSave = request.method === "POST" && pathname === "/catalog-v2/image";
  const isCatalogV2Commit = request.method === "POST" && pathname === "/catalog-v2/commit";
  const isCatalogV2ManifestLoad = request.method === "GET" && pathname === "/catalog-v2/manifest";
  const isCatalogV2ImageLoad = request.method === "GET" && pathname === "/catalog-v2/image";
  const isMediaLibraryList = request.method === "GET" && pathname === "/media-library";
  const isMediaLibrarySequence = request.method === "GET" && pathname === "/media-library/sequence";
  const isMediaLibraryImage = request.method === "GET" && pathname === "/media-library/image";
  const isPlotExposeAnalyze = request.method === "POST" && pathname === "/plot-exposes/analyze";
  const isPlotExposeCommit = request.method === "POST" && pathname === "/plot-exposes/commit";
  const isPlotExposeLoad = request.method === "GET" && pathname === "/plot-exposes/file";
  const isPlotExposeArchive = request.method === "POST" && pathname === "/plot-exposes/archive";
  const isPlotSyncStatus = request.method === "GET" && pathname === "/plot-sync/status";
  const isPlotSyncRun = request.method === "POST" && pathname === "/plot-sync/run";
  const isPlotSyncSchedule = request.method === "POST" && pathname === "/plot-sync/schedule";
  const isPlotSyncLog = request.method === "GET" && pathname === "/plot-sync/log";
  const isMailRuntimeProbe = request.method === "POST" && pathname === "/mail-runtime/probe";
  const isExactProductionDelete = request.method === "POST" && pathname === EXACT_PRODUCTION_DELETE_PATH;
  if (!isPlotSyncSchedule && !isHealth && !isRuntimeProvenance && !isUpload && !isBinaryUpload && !isManualBatchResumption && !isLocalSave && !isTextGeneration && !isImageCaptionGeneration && !isOpenAiKeyValidation && !isCredentialLoad && !isCredentialSave && !isCatalogLoad && !isCatalogSave && !isCatalogV2Start && !isCatalogV2ImageSave && !isCatalogV2Commit && !isCatalogV2ManifestLoad && !isCatalogV2ImageLoad && !isMediaLibraryList && !isMediaLibrarySequence && !isMediaLibraryImage && !isPlotExposeAnalyze && !isPlotExposeCommit && !isPlotExposeLoad && !isPlotExposeArchive && !isPlotSyncStatus && !isPlotSyncRun && !isPlotSyncLog && !isMailRuntimeProbe && !isExactProductionDelete) {
    send(response, 404, { ok: false, message: "Nicht gefunden." }, origin);
    return;
  }

  if (origin && !allowedOrigins.has(origin)) {
    send(response, 403, { ok: false, message: "Diese Anwendung darf den Upload-Helfer nicht verwenden." }, origin);
    return;
  }

  const mediaImageId = requestUrl.searchParams.get("id");
  const signedMediaRequest = isMediaLibraryImage
    && validMediaSignature(mediaImageId, requestUrl.searchParams.get("sig"));
  if (!validSession(request) && !signedMediaRequest) {
    send(response, 401, { ok: false, message: "Die lokale Sitzung ist nicht autorisiert. Bitte die App über den macOS-Startknopf öffnen." }, origin);
    return;
  }

  if (request.method === "GET" && pathname === "/health") {
    send(response, 200, {
      ok: true,
      service: "fabian-pascal-helper",
      platform: process.platform,
      runtimeCommit: RUNTIME_PROVENANCE.runtimeCommit,
      runtimeRelease: RUNTIME_PROVENANCE.runtimeRelease,
      helperStartedAt: HELPER_STARTED_AT,
    }, origin);
    return;
  }

  if (isRuntimeProvenance) {
    const productionPolicy = await listingRotationProductionPolicyStore.load();
    send(response, 200, {
      ok: true,
      ...RUNTIME_PROVENANCE,
      helperStartedAt: HELPER_STARTED_AT,
      processId: process.pid,
      productionGuard: verifyProductionRuntime(RUNTIME_PROVENANCE, productionPolicy),
    }, origin);
    return;
  }

  if (isManualBatchResumption) {
    const projectIds = requestUrl.searchParams.getAll("projectId");
    const protectedListingIds = completedManualBatchListingIds(await uploadJobLedger.read(), projectIds);
    send(response, 200, { ok: true, protectedListingIds }, origin);
    return;
  }

  let client;
  let temporaryUploadPath = "";
  let uploadJob = null;
  let uploadJobClaimed = false;
  let uploadJobCompleted = false;
  let plotDailyUploadClaim = null;
  const uploadLog = (event, details = {}) => logUpload(event, { ...(uploadJob || {}), ...details });
  try {
    if (isMediaLibrarySequence) {
      const result = await recommendedMediaSequence(requestUrl.searchParams.get("coverId"));
      send(response, 200, {
        ok: true,
        warnings: result.warnings,
        priceMatch: result.priceMatch,
        items: result.items.map(publicMediaItem),
      }, origin);
      return;
    }

    if (isMediaLibraryList) {
      const result = await queryMediaLibrary({
        query: requestUrl.searchParams.get("query") || "",
        group: requestUrl.searchParams.get("group") || "",
        kind: requestUrl.searchParams.get("kind") || "",
        page: requestUrl.searchParams.get("page") || 1,
        pageSize: requestUrl.searchParams.get("pageSize") || 36,
      });
      send(response, 200, {
        ok: true,
        available: result.available,
        total: result.total,
        libraryTotal: result.libraryTotal,
        page: result.page,
        pages: result.pages,
        pageSize: result.pageSize,
        groups: result.groups,
        items: result.items.map(publicMediaItem),
      }, origin);
      return;
    }

    if (isMediaLibraryImage) {
      const item = await getMediaLibraryItem(mediaImageId);
      if (!item) {
        send(response, 404, { ok: false, message: "Das Bild wurde in der Medienbibliothek nicht gefunden." }, origin);
        return;
      }
      const fileStats = await stat(item.absolutePath);
      if (!fileStats.isFile() || fileStats.size > MAX_IMAGE_BYTES) {
        throw new Error("Das Bild ist ungültig oder größer als 100 MB.");
      }
      const controller = new AbortController();
      const downloadTimeout = setTimeout(() => controller.abort(), 45_000);
      let data;
      try {
        data = await readFile(item.absolutePath, { signal: controller.signal });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error("Die Mediendatei konnte nicht innerhalb von 45 Sekunden geladen werden. Bitte Git LFS beziehungsweise den konfigurierten Medienpfad prüfen.");
        }
        throw error;
      } finally {
        clearTimeout(downloadTimeout);
      }
      if (isGitLfsPointer(data)) {
        throw new Error("Die Bildoriginale wurden noch nicht geladen. Bitte im App-Ordner zuerst „git lfs pull“ ausführen.");
      }
      response.writeHead(200, {
        ...headers(origin),
        "Content-Type": item.mimeType,
        "Content-Length": String(data.length),
        "X-Content-Type-Options": "nosniff",
      });
      response.end(data);
      return;
    }

    if (isPlotExposeLoad) {
      const result = await readPlotExpose(requestUrl.searchParams.get("reference"));
      response.writeHead(200, {
        ...headers(origin),
        "Content-Type": "application/pdf",
        "Content-Length": String(result.data.length),
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
        "X-Content-Type-Options": "nosniff",
      });
      response.end(result.data);
      return;
    }

    if (isPlotExposeAnalyze) {
      const result = await analyzePlotExpose({
        data: await readBytes(request, MAX_PLOT_EXPOSE_BYTES),
        filename: decodedHeader(request, "x-fpi-filename"),
      });
      send(response, 200, { ok: true, ...result }, origin);
      return;
    }

    if (isCatalogV2ManifestLoad) {
      const result = await loadCatalogManifest();
      send(response, 200, { ok: true, ...result }, origin);
      return;
    }

    if (isPlotSyncStatus) {
      send(response, 200, { ok: true, ...(await plotSyncService.loadStatus()) }, origin);
      return;
    }

    if (isPlotSyncLog) {
      send(response, 200, { ok: true, log: await plotSyncService.lastLog() }, origin);
      return;
    }

    if (isMailRuntimeProbe) {
      const result = await runMailRuntimeProbe({ mailAdapter: importReportMailAdapter });
      await writeMailRuntimeLog(result.ok ? "probe-completed" : "probe-failed", result);
      send(response, 200, result, origin);
      return;
    }

    if (isCatalogV2ImageLoad) {
      const result = await loadCatalogImage(requestUrl.searchParams.get("imageId"));
      response.writeHead(200, {
        ...headers(origin),
        "Content-Type": result.mimeType,
        "Content-Length": String(result.data.length),
      });
      response.end(result.data);
      return;
    }

    if (isCatalogLoad) {
      const result = await loadCatalogSnapshot();
      send(response, 200, { ok: true, ...result }, origin);
      return;
    }

    if (isCredentialLoad) {
      const result = await credentialVault();
      send(response, 200, {
        ok: true,
        stored: result.stored,
        credentials: publicCredentialStatus(result.credentials),
      }, origin);
      return;
    }

    if (isCatalogV2ImageSave) {
      const result = await saveCatalogImage({
        sessionId: requestUrl.searchParams.get("sessionId"),
        imageId: requestUrl.searchParams.get("imageId"),
        data: await readBytes(request),
      });
      send(response, 200, { ok: true, ...result }, origin);
      return;
    }

    if (isBinaryUpload) {
      assertCatalogProductionReady((await loadCatalogManifest()).state);
      const filename = safeFilename(decodedHeader(request, "x-fpi-filename"));
      uploadJob = {
        jobId: decodedHeader(request, "x-fpi-job-id") || `legacy:${randomUUID()}`,
        projectId: decodedHeader(request, "x-fpi-project-id"),
        listingId: decodedHeader(request, "x-fpi-listing-id"),
        jobType: "immoprofessional-upload",
        uploadOrigin: UPLOAD_ORIGIN.MANUAL_BATCH,
      };
      const claim = await uploadJobLedger.claim(uploadJob);
      if (claim.alreadyCompleted) {
        await uploadLog("idempotent-skip", { status: WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT, message: "Der Upload-Job war bereits erfolgreich übertragen." });
        send(response, 200, { ok: true, idempotent: true, message: "Der Upload war bereits erfolgreich abgeschlossen und wurde nicht erneut übertragen." }, origin);
        return;
      }
      uploadJobClaimed = true;
      if (requiresPlotDailyUploadClaim(uploadJob.uploadOrigin)) {
        const context = await persistedUploadContext(uploadJob.projectId, uploadJob.listingId);
        plotDailyUploadClaim = await claimPlotDailyUpload({ ...context, uploadJob });
        uploadJob = { ...uploadJob, plotId: plotDailyUploadClaim.plotId, plotUploadDayKey: plotDailyUploadClaim.plotUploadDayKey };
      }
      const vault = await credentialVault();
      const ftp = vault.credentials;
      if (!ftp.ftpHost || !ftp.ftpUser || !ftp.ftpPassword) {
        throw new Error("Der FTP-Zugang ist unvollständig.");
      }

      const stagingDirectory = join(dirname(UPLOAD_LOG_PATH), "upload-staging");
      await mkdir(stagingDirectory, { recursive: true });
      temporaryUploadPath = join(stagingDirectory, `${randomUUID()}.zip`);
      const handle = await open(temporaryUploadPath, "wx");
      let archiveBytes = 0;
      let nextProgressLog = 25 * 1024 * 1024;
      await uploadLog("receiving-started", {
        filename,
        expectedBytes: Number(request.headers["content-length"] || 0),
        host: ftp.ftpHost,
        remotePath: ftp.ftpPath,
      });
      try {
        for await (const chunk of request) {
          archiveBytes += chunk.length;
          if (archiveBytes > MAX_UPLOAD_BYTES) {
            throw new Error("Das Importpaket ist größer als 1 GB.");
          }
          await handle.write(chunk);
          if (archiveBytes >= nextProgressLog) {
            await uploadLog("receiving-progress", { filename, archiveBytes });
            nextProgressLog += 25 * 1024 * 1024;
          }
        }
      } finally {
        await handle.close();
      }
      if (!archiveBytes) throw new Error("Das Importpaket ist leer.");
      await uploadLog("received", { filename, archiveBytes, host: ftp.ftpHost, remotePath: ftp.ftpPath });

      client = new Client(300_000);
      client.ftp.verbose = false;
      await client.access({
        ...ftpAccessOptions(ftp),
      });
      if (ftp.ftpPath && ftp.ftpPath !== "/") await client.cd(ftp.ftpPath);
      await uploadLog("connected", { filename, host: ftp.ftpHost, remotePath: ftp.ftpPath, transport: ftp.ftpSecure });
      if (plotDailyUploadClaim) await plotDailyUploadGuard.markTransferStarted(plotDailyUploadClaim);
      await client.uploadFrom(temporaryUploadPath, filename);
      if (plotDailyUploadClaim) await plotDailyUploadGuard.complete(plotDailyUploadClaim);
      await uploadJobLedger.complete(uploadJob);
      uploadJobCompleted = true;
      await uploadLog("transferred", { filename, archiveBytes, host: ftp.ftpHost, remotePath: ftp.ftpPath, transport: ftp.ftpSecure });
      send(response, 200, {
        ok: true,
        message: `Importpaket „${filename}“ wurde an Immoprofessional übertragen. Bitte den Importbericht und den Entwurfsstatus prüfen.`,
      }, origin);
      return;
    }

    if (isUpload) assertCatalogProductionReady((await loadCatalogManifest()).state);
    const body = await readJson(request, isCatalogSave ? MAX_CATALOG_BODY_BYTES : MAX_BODY_BYTES);

    if (isExactProductionDelete) {
      const externalObjectNumber = requireExactProductionDeleteTarget(body.externalObjectNumber);
      const [rotationMode, deleteMode, productionPolicy, schedulerLease] = await Promise.all([
        listingRotationOperatingModeStore.load(),
        productionDeleteModeStore.load(),
        listingRotationProductionPolicyStore.load(),
        listingSchedulerLease.read(),
      ]);
      if (rotationMode.valid !== true || rotationMode.mode !== "off") {
        throw new Error("Für den exakten Production-DELETE muss die Inseratrotation gültig auf off stehen.");
      }
      if (deleteMode.valid !== true || deleteMode.mode !== "active") {
        throw new Error("Für den exakten Production-DELETE muss Production-DELETE kontrolliert aktiv sein.");
      }
      if (productionPolicy.valid !== true || productionPolicy.maxRunItems !== 1) {
        throw new Error("Für den exakten Production-DELETE muss das Produktionslimit exakt 1 sein.");
      }
      if (schedulerLease) throw new Error("Während eines aktiven Scheduler-Claims ist der exakte Production-DELETE gesperrt.");
      const result = await productionDeleteService.runOnce({
        trigger: "manual-exact",
        targetExternalObjectNumber: externalObjectNumber,
      });
      if (result.ran !== true) throw new Error(result.reason || "Der exakte Production-DELETE wurde fail-closed nicht ausgeführt.");
      if (result.ok !== true) {
        throw new Error(result.errors?.[0]?.message || "Der exakte Production-DELETE ist fehlgeschlagen.");
      }
      if (!result.transferred.includes(externalObjectNumber)) {
        throw new Error("Der exakte Production-DELETE hat das angeforderte Ziel nicht übertragen.");
      }
      send(response, 200, { ok: true, ...result }, origin);
      return;
    }

    if (isPlotExposeCommit) {
      const result = await commitPlotExpose(body);
      send(response, 200, { ok: true, ...result }, origin);
      return;
    }

    if (isPlotExposeArchive) {
      const result = await archivePlotExpose(body.reference, { allowPending: body.pending === true });
      send(response, 200, { ok: true, ...result }, origin);
      return;
    }

    if (isPlotSyncRun) {
      const result = await plotSyncService.run({
        dryRun: body.dryRun === true,
        trigger: "manual",
      });
      send(response, 200, { ok: true, ...result }, origin);
      return;
    }

    if (isPlotSyncSchedule) {
      send(response, 200, { ok: true, ...(await plotSyncService.setScheduleEnabled(body.enabled)) }, origin);
      return;
    }

    if (isCatalogV2Start) {
      const result = await startCatalogSnapshot({ ...body, protectLifecycle: true });
      send(response, 200, { ok: true, ...result }, origin);
      return;
    }

    if (isCatalogV2Commit) {
      const result = await commitCatalogSnapshot(body.sessionId);
      send(response, 200, { ok: true, ...result }, origin);
      return;
    }

    if (isCatalogSave) {
      const result = await saveCatalogSnapshot(body);
      send(response, 200, { ok: true, stored: true, ...result }, origin);
      return;
    }

    if (isCredentialSave) {
      if (body.clear === true) {
        await clearCredentialVault();
        credentialCache = undefined;
        send(response, 200, { ok: true, stored: false }, origin);
      } else {
        const current = await credentialVault();
        const incoming = body.credentials && typeof body.credentials === "object" ? body.credentials : {};
        const nextCredentials = normalizeCredentials({
          ...current.credentials,
          ...incoming,
          openAiKey: incoming.openAiKey || current.credentials.openAiKey,
          ftpPassword: incoming.ftpPassword || current.credentials.ftpPassword,
        });
        if (incoming.ftpPassword && (!nextCredentials.ftpHost || !nextCredentials.ftpUser)) {
          throw new Error("Host und Benutzername werden für die Prüfung des Immoprofessional-Zugangs benötigt.");
        }
        const ftpValidated = incoming.ftpPassword
          ? await verifyFtpCredentials(nextCredentials)
          : false;
        const savedCredentials = await saveCredentialVault(nextCredentials);
        credentialCache = { stored: true, credentials: savedCredentials };
        send(response, 200, { ok: true, stored: true, ftpValidated }, origin);
      }
      return;
    }

    if (isTextGeneration) {
      const vault = await credentialVault();
      const result = await generateAiListing({ ...body, apiKey: vault.credentials.openAiKey });
      send(response, 200, { ok: true, ...result }, origin);
      return;
    }

    if (isImageCaptionGeneration) {
      const vault = await credentialVault();
      const result = await generateAiImageCaptions({ ...body, apiKey: vault.credentials.openAiKey });
      send(response, 200, { ok: true, ...result }, origin);
      return;
    }

    if (isOpenAiKeyValidation) {
      const result = await validateOpenAiApiKey(body);
      send(response, 200, { ok: true, ...result }, origin);
      return;
    }

    if (!body.archiveBase64) throw new Error("Das Importpaket ist unvollständig.");
    const archive = Buffer.from(String(body.archiveBase64), "base64");
    if (!archive.length || archive.length > MAX_BODY_BYTES) {
      throw new Error("Das Importpaket ist leer oder zu groß.");
    }

    if (isLocalSave) {
      const saved = await saveToDownloads(archive, body.filename);
      send(response, 200, {
        ok: true,
        filename: saved.filename,
        path: saved.path,
        message: `Importpaket „${saved.filename}“ wurde im Downloadordner gespeichert.`,
      }, origin);
      return;
    }

    const vault = await credentialVault();
    const ftp = vault.credentials;
    if (!ftp.ftpHost || !ftp.ftpUser || !ftp.ftpPassword) {
      throw new Error("Der FTP-Zugang ist unvollständig.");
    }

    const filename = safeFilename(body.filename);
    uploadJob = {
      jobId: String(body.jobId || `legacy:${randomUUID()}`),
      projectId: String(body.projectId || ""),
      listingId: String(body.listingId || ""),
      jobType: "immoprofessional-upload",
      uploadOrigin: UPLOAD_ORIGIN.LEGACY_MANUAL,
    };
    const claim = await uploadJobLedger.claim(uploadJob);
    if (claim.alreadyCompleted) {
      await uploadLog("idempotent-skip", { status: WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT, message: "Der Upload-Job war bereits erfolgreich übertragen." });
      send(response, 200, { ok: true, idempotent: true, message: "Der Upload war bereits erfolgreich abgeschlossen und wurde nicht erneut übertragen." }, origin);
      return;
    }
    uploadJobClaimed = true;
    if (requiresPlotDailyUploadClaim(uploadJob.uploadOrigin)) {
      const context = await persistedUploadContext(uploadJob.projectId, uploadJob.listingId);
      plotDailyUploadClaim = await claimPlotDailyUpload({ ...context, uploadJob });
      uploadJob = { ...uploadJob, plotId: plotDailyUploadClaim.plotId, plotUploadDayKey: plotDailyUploadClaim.plotUploadDayKey };
    }
    const remotePath = String(ftp.ftpPath || "/").trim();
    await uploadLog("started", {
      filename,
      archiveBytes: archive.length,
      host: String(ftp.ftpHost),
      remotePath,
    });

    client = new Client(45_000);
    client.ftp.verbose = false;
    await client.access(ftpAccessOptions(ftp));

    if (remotePath && remotePath !== "/") await client.cd(remotePath);
    await uploadLog("connected", { filename, host: String(ftp.ftpHost), remotePath, transport: ftp.ftpSecure });
    if (plotDailyUploadClaim) await plotDailyUploadGuard.markTransferStarted(plotDailyUploadClaim);
    await client.uploadFrom(Readable.from(archive), filename);
    if (plotDailyUploadClaim) await plotDailyUploadGuard.complete(plotDailyUploadClaim);
    await uploadJobLedger.complete(uploadJob);
    uploadJobCompleted = true;
    await uploadLog("transferred", { filename, archiveBytes: archive.length, host: String(ftp.ftpHost), remotePath, transport: ftp.ftpSecure });
    send(response, 200, {
      ok: true,
      message: `Importpaket „${filename}“ wurde an Immoprofessional übertragen. Bitte den Importbericht und den Entwurfsstatus prüfen.`,
    }, origin);
  } catch (error) {
    const status = error && typeof error === "object" && "httpStatus" in error
      ? Number(error.httpStatus) || 400
      : 400;
    if (uploadJobClaimed && !uploadJobCompleted && uploadJob) {
      await uploadJobLedger.fail({
        ...uploadJob,
        errorCode: String(error?.code || "UPLOAD_FAILED"),
        message: error instanceof Error ? error.message : "Upload fehlgeschlagen.",
      }).catch(() => undefined);
    }
    if (plotDailyUploadClaim && !uploadJobCompleted) {
      await plotDailyUploadGuard.fail({
        ...plotDailyUploadClaim,
        reason: error instanceof Error ? error.message : "Upload fehlgeschlagen.",
      }).catch(() => undefined);
    }
    if (isUpload || isBinaryUpload) {
      await uploadLog("failed", {
        errorCode: String(error?.code || "UPLOAD_FAILED"),
        message: error instanceof Error ? error.message.slice(0, 500) : "Upload fehlgeschlagen.",
      });
    }
    send(response, status, {
      ok: false,
      message: error instanceof Error ? error.message : "Upload fehlgeschlagen.",
    }, origin);
  } finally {
    client?.close();
    if (temporaryUploadPath) await rm(temporaryUploadPath, { force: true }).catch(() => undefined);
  }
});

async function startLocalHelper() {
  const migration = await migrateCatalogManifest();
  if (migration.migrated) {
    console.log(`Lokaler Katalog wurde auf Datenschema ${migration.schemaVersion} migriert.`);
  }
  server.listen(PORT, HOST, () => {
    console.log(`Fabian&Pascal Helfer: http://${HOST}:${PORT}`);
  });
  void (async () => {
    try {
      const [productionPolicy, operatingMode] = await Promise.all([
        listingRotationProductionPolicyStore.load(),
        listingRotationOperatingModeStore.load(),
      ]);
      if (
        productionPolicy.valid === true
        && productionPolicy.startupCatchupMode === "guarded"
        && operatingMode.valid === true
        && operatingMode.mode === "active"
      ) {
        const result = await listingRotationSchedulerService.runIfDue({ trigger: "startup-guarded" });
        if (result.ran && !result.ok && result.abortReason) console.error(`Inseratrotation: ${result.abortReason}`);
      } else {
        await listingRotationSchedulerService.inspect({ trigger: "startup-detect-only" });
      }
    } catch (error) {
      console.error(`Inseratrotation: ${error instanceof Error ? error.message : "Read-only Startprüfung fehlgeschlagen."}`);
    }
    try {
      await plotSyncService.runIfDue();
    } catch (error) {
      console.error(`Grundstücksabgleich: ${error instanceof Error ? error.message : "Start fehlgeschlagen."}`);
    }
  })();
  const syncTimer = setInterval(() => {
    void plotSyncService.runIfDue().catch((error) => {
      if (error?.code !== "PLOT_SYNC_LOCKED") console.error(`Grundstücksabgleich: ${error instanceof Error ? error.message : "Zeitplan fehlgeschlagen."}`);
    });
  }, 60_000);
  syncTimer.unref();
  const listingSchedulerTimer = setInterval(() => {
    void listingRotationSchedulerService.runIfDue({ trigger: "periodic" }).catch((error) => {
      if (error?.code !== "LISTING_SCHEDULER_LOCKED") {
        console.error(`Inseratrotation: ${error instanceof Error ? error.message : "Zeitplan fehlgeschlagen."}`);
      }
    });
  }, 60_000);
  listingSchedulerTimer.unref();
  const importReportTimer = setInterval(() => {
    void (async () => {
      let deleteReconciliation;
      try {
        deleteReconciliation = await productionDeleteService.runOnce({
          trigger: "periodic-reconciliation",
          reconcileOnly: true,
        });
      } catch (error) {
        console.error(`Immoprofessional-DELETE-Bestätigung: ${error instanceof Error ? error.message : "Read-only Bestätigungsprüfung fehlgeschlagen."}`);
      }
      await importReportService.runOnce({ trigger: "periodic" });
      if (!deleteReconciliation?.ran || deleteReconciliation.pendingConfirmationCount === 0) {
        await productionDeleteService.runOnce({ trigger: "periodic" });
      }
    })().catch((error) => {
      console.error(`Immoprofessional-Lebenszyklus: ${error instanceof Error ? error.message : "Berichts- oder Deleteprüfung fehlgeschlagen."}`);
    });
  }, DEFAULT_IMPORT_REPORT_POLL_INTERVAL_MS);
  importReportTimer.unref();
}

startLocalHelper().catch((error) => {
  console.error(error instanceof Error ? error.message : "Der lokale Helfer konnte nicht gestartet werden.");
  process.exitCode = 1;
});
