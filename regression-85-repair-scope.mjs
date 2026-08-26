import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";

import { WORKFLOW_STATUS } from "./workflow-status.mjs";

export const REGRESSION_85_SCOPE_FORMAT = 2;
export const REGRESSION_85_EXPECTED_COUNT = 85;
export const REGRESSION_85_ROOT_PROCESS_ID = 4460;
export const REGRESSION_85_APPROVED_SCOPE_HASH = "abcf59c654f573bc13906e555badeb13e090eb67d9c971cfb0216b5a4abace58";
export const REGRESSION_85_DECLARED_WINDOW = Object.freeze({
  start: "2026-08-24T16:51:00+02:00",
  end: "2026-08-25T07:00:00+02:00",
  timeZone: "Europe/Berlin",
});
export const REGRESSION_85_EXPECTED_HOUSE_DISTRIBUTION = Object.freeze({
  "SOL 242 V4": 82,
  "SOL 204 V4": 2,
  "SOL 229 V3": 1,
});
export const REGRESSION_85_REPAIR_STAGES = Object.freeze({
  IDENTIFIED: "identified",
  AMBIGUOUS_BLOCKED: "ambiguous_blocked",
  ROLLBACK_DELETE_AUTHORIZED: "rollback_delete_authorized",
  ROLLBACK_DELETE_PENDING: "rollback_delete_pending",
  ROLLBACK_ROGUE_DELETED: "rollback_rogue_deleted",
  WAITING_DAILY_PLOT_WINDOW: "waiting_daily_plot_window",
  CREATIVE_SELECTED: "creative_selected",
  REPLACEMENT_CREATED: "replacement_created",
  TRANSFERRED_PENDING_IMPORT: "transferred_pending_import",
  REPLACEMENT_PUBLISHED: "replacement_published",
  OLD_DELETE_PENDING: "old_delete_pending",
  OLD_DELETED: "old_deleted",
  REPAIR_COMPLETED: "repair_completed",
});
export const REGRESSION_85_CAMPAIGN_MODES = Object.freeze(["off", "active", "paused", "completed"]);
export const REGRESSION_85_CLASSIFICATIONS = Object.freeze({
  ROLLBACK_ELIGIBLE: "ROLLBACK_ELIGIBLE",
  REPLACEMENT_REQUIRED: "REPLACEMENT_REQUIRED",
  AMBIGUOUS: "AMBIGUOUS",
});
export const REGRESSION_85_REPAIR_STRATEGIES = Object.freeze({
  ROLLBACK: "delete_rogue_keep_original",
  REPLACEMENT: "replace_rogue_then_delete",
  NONE: "none",
});

const STAGES = new Set(Object.values(REGRESSION_85_REPAIR_STAGES));
const MUTATION_LOCK_MS = 30_000;

function clean(value, maximum = 500) {
  return String(value ?? "").trim().slice(0, maximum);
}

function scopeError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function iso(value) {
  const parsed = Date.parse(clean(value, 50));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

export function canonicalRegression85Json(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalRegression85Json).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalRegression85Json(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const canonicalJson = canonicalRegression85Json;

export function hashRegression85Scope(scope) {
  return createHash("sha256").update(canonicalJson(scope)).digest("hex");
}

function houseDistribution(items) {
  return Object.fromEntries([...new Set(items.map((item) => item.houseName))]
    .sort()
    .map((name) => [name, items.filter((item) => item.houseName === name).length]));
}

function assertExpectedDistribution(items) {
  const observed = houseDistribution(items);
  const expected = REGRESSION_85_EXPECTED_HOUSE_DISTRIBUTION;
  const valid = Object.keys(expected).length === Object.keys(observed).length
    && Object.entries(expected).every(([name, count]) => observed[name] === count);
  if (!valid) {
    throw scopeError(
      "REGRESSION_85_SCOPE_MISMATCH",
      "Die Hausverteilung des belegten Regression-Batches stimmt nicht exakt mit 82/2/1 überein.",
      { expected, observed },
    );
  }
  return observed;
}

/**
 * Beweist den Scope über konkrete erfolgreiche Transferereignisse des
 * bestätigten Rogue-Prozesses. Die deklarierte Europe/Berlin-Zeitspanne wird
 * als Auditangabe bewahrt; die tatsächlichen ISO-Zeitstempel werden getrennt
 * und unverändert dokumentiert, damit kein Zeitzonenfehler IDs ein- oder
 * ausschließt.
 */
export function deriveRegression85Scope(state, uploadEvents, uploadLedger) {
  const transferred = (Array.isArray(uploadEvents) ? uploadEvents : []).filter((event) =>
    event?.processId === REGRESSION_85_ROOT_PROCESS_ID
    && event?.event === "transferred"
    && event?.jobType === "automatic-listing-rotation"
    && event?.status === WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT);
  const uniqueJobs = new Map();
  for (const event of transferred) {
    const jobId = clean(event.jobId, 500);
    if (!jobId) throw scopeError("REGRESSION_85_SCOPE_MISMATCH", "Ein Rogue-Transfer besitzt keine Uploadjob-ID.");
    if (uniqueJobs.has(jobId)) throw scopeError("REGRESSION_85_SCOPE_MISMATCH", "Ein Rogue-Uploadjob besitzt mehrere erfolgreiche Transferereignisse.", { jobId });
    uniqueJobs.set(jobId, event);
  }
  if (uniqueJobs.size !== REGRESSION_85_EXPECTED_COUNT) {
    throw scopeError(
      "REGRESSION_85_SCOPE_MISMATCH",
      `Der persistente Rogue-Transferbeleg enthält ${uniqueJobs.size} statt exakt 85 eindeutige Jobs.`,
      { observedCount: uniqueJobs.size, expectedCount: REGRESSION_85_EXPECTED_COUNT },
    );
  }
  const catalogRows = (state?.projects || []).flatMap((project) => (project.listings || []).map((listing) => ({ project, listing })));
  const listingById = new Map(catalogRows.map((row) => [row.listing.id, row]));
  const ledgerJobs = new Map((uploadLedger?.jobs || []).map((job) => [clean(job.jobId, 500), job]));
  const items = [...uniqueJobs.values()].map((event) => {
    const row = listingById.get(clean(event.listingId, 200));
    const listing = row?.listing;
    const project = row?.project;
    const ledgerJob = ledgerJobs.get(clean(event.jobId, 500));
    const reasons = [];
    if (!project || !listing) reasons.push("catalog_listing_missing");
    if (listing?.externalId !== clean(event.externalId, 40)) reasons.push("external_id_mismatch");
    const positiveImportReports = (state?.importReports || []).filter((report) =>
      report?.importResult === "success"
      && report?.matchedListingId === listing?.id
      && report?.externalObjectNumber === listing?.externalId
      && report?.sourceListingId === listing?.rotationSourceListingId);
    const pending = listing?.status === WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT;
    const confirmedPublished = listing?.status === WORKFLOW_STATUS.PUBLISHED
      && positiveImportReports.length === 1
      && listing?.importReportId === positiveImportReports[0]?.reportId
      && Boolean(listing?.importConfirmedAt);
    if (!pending && !confirmedPublished) reasons.push("catalog_status_not_monotone_or_unproven");
    if (listing?.listingOrigin !== "rotation-copy") reasons.push("not_rotation_copy");
    if (listing?.creativeSelection?.format === 1) reasons.push("creative_selection_unexpectedly_present");
    if (!clean(listing?.rotationSourceListingId, 200)) reasons.push("original_source_missing");
    if (!clean(listing?.rotationRemovedHouseId, 200)) reasons.push("distribution_removed_house_missing");
    if (!project?.plotId) reasons.push("plot_id_missing");
    if (!ledgerJob) reasons.push("upload_ledger_job_missing");
    if (ledgerJob && (
      ledgerJob.projectId !== project?.id
      || ledgerJob.listingId !== listing?.id
      || ledgerJob.status !== WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT
    )) reasons.push("upload_ledger_mismatch");
    if (reasons.length) {
      throw scopeError(
        "REGRESSION_85_SCOPE_MISMATCH",
        `Der belegte Regression-Transfer ${clean(event.externalId, 40)} ist nicht mehr eindeutig: ${reasons.join(", ")}.`,
        { reasons, jobId: clean(event.jobId, 500) },
      );
    }
    return {
      scopeItemId: `regression-85:${listing.id}`,
      projectId: project.id,
      plotId: clean(project.plotId, 200),
      originalSourceListingId: clean(listing.rotationSourceListingId, 200),
      regressionListingId: listing.id,
      regressionExternalId: listing.externalId,
      rotationId: listing.id,
      schedulerRunId: clean(event.runId, 200),
      uploadJobId: clean(event.jobId, 500),
      uploadTime: iso(event.timestamp),
      catalogTransferTime: iso(listing.transferredAt),
      createdAt: iso(listing.createdAt),
      rootProcessId: REGRESSION_85_ROOT_PROCESS_ID,
      runtimeCommit: clean(event.runtimeCommit, 40).toLowerCase(),
      runtimeRelease: clean(event.runtimeRelease, 200),
      runtimeProvenanceStatus: event.runtimeCommit || event.runtimeRelease ? "unexpected_partial" : "missing_rogue_runtime_provenance",
      houseId: clean(listing.templateId, 200),
      houseName: clean(listing.templateName, 200),
      distributionRemovedHouseId: clean(listing.rotationRemovedHouseId, 200),
      heroType: clean(listing.heroCreativeType || (listing.promotionImageId ? "action" : "house"), 40),
      heroImageId: clean(listing.heroImageId || listing.promotionImageId, 200),
      importState: confirmedPublished ? WORKFLOW_STATUS.PUBLISHED : WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT,
      importReportId: confirmedPublished ? positiveImportReports[0].reportId : "",
      importConfirmedAt: confirmedPublished ? iso(listing.importConfirmedAt) : "",
    };
  }).sort((left, right) =>
    Date.parse(left.createdAt) - Date.parse(right.createdAt)
    || left.regressionListingId.localeCompare(right.regressionListingId));
  if (new Set(items.map((item) => item.regressionListingId)).size !== REGRESSION_85_EXPECTED_COUNT) {
    throw scopeError("REGRESSION_85_SCOPE_MISMATCH", "Der Regression-Scope enthält keine exakt 85 eindeutigen Listing-IDs.");
  }
  if (new Set(items.map((item) => item.regressionExternalId)).size !== REGRESSION_85_EXPECTED_COUNT) {
    throw scopeError("REGRESSION_85_SCOPE_MISMATCH", "Der Regression-Scope enthält keine exakt 85 eindeutigen Objektnummern.");
  }
  const distribution = assertExpectedDistribution(items);
  const observedCreatedAt = items.map((item) => item.createdAt).filter(Boolean).sort();
  const observedTransferredAt = items.map((item) => item.uploadTime).filter(Boolean).sort();
  const scope = {
    format: REGRESSION_85_SCOPE_FORMAT,
    contract: "regression-85-exact-allowlist-v2",
    expectedCount: REGRESSION_85_EXPECTED_COUNT,
    rootProcessId: REGRESSION_85_ROOT_PROCESS_ID,
    declaredWindow: REGRESSION_85_DECLARED_WINDOW,
    observedIsoEvidence: {
      createdFirst: observedCreatedAt[0],
      createdLast: observedCreatedAt.at(-1),
      transferFirst: observedTransferredAt[0],
      transferLast: observedTransferredAt.at(-1),
      note: "ISO-Zeitstempel werden unverändert geführt; die Allowlist wird ausschließlich aus den 85 konkreten Rogue-Jobs gebildet.",
    },
    houseDistribution: distribution,
    items,
  };
  return {
    scope,
    scopeHash: REGRESSION_85_APPROVED_SCOPE_HASH,
    scopeEvidenceHash: hashRegression85Scope(scope),
  };
}

export function assertRegression85Campaign(value) {
  const validMode = REGRESSION_85_CAMPAIGN_MODES.includes(value?.mode);
  const scope = value?.scope;
  const scopeHash = clean(value?.scopeHash, 64).toLowerCase();
  const scopeEvidenceHash = clean(value?.scopeEvidenceHash, 64).toLowerCase();
  const items = scope?.items;
  const progress = Array.isArray(value?.progress) ? value.progress : [];
  const reasons = [];
  if (value?.format !== REGRESSION_85_SCOPE_FORMAT) reasons.push("format_invalid");
  if (!clean(value?.campaignId, 200)) reasons.push("campaign_id_missing");
  if (!validMode) reasons.push("mode_invalid");
  if (scope?.format !== REGRESSION_85_SCOPE_FORMAT || scope?.expectedCount !== REGRESSION_85_EXPECTED_COUNT) reasons.push("scope_format_invalid");
  if (!Array.isArray(items) || items.length !== REGRESSION_85_EXPECTED_COUNT) reasons.push("scope_count_invalid");
  if (scopeHash !== REGRESSION_85_APPROVED_SCOPE_HASH) reasons.push("approved_scope_hash_invalid");
  if (!/^[a-f0-9]{64}$/u.test(scopeEvidenceHash) || hashRegression85Scope(scope) !== scopeEvidenceHash) reasons.push("scope_evidence_hash_invalid");
  if (items && new Set(items.map((item) => item.scopeItemId)).size !== REGRESSION_85_EXPECTED_COUNT) reasons.push("scope_ids_not_unique");
  if (progress.length !== REGRESSION_85_EXPECTED_COUNT) reasons.push("progress_count_invalid");
  if (progress.some((item) => !STAGES.has(item.stage))) reasons.push("progress_stage_invalid");
  const classifications = new Set(Object.values(REGRESSION_85_CLASSIFICATIONS));
  const strategies = new Set(Object.values(REGRESSION_85_REPAIR_STRATEGIES));
  const rollbackStages = new Set([
    REGRESSION_85_REPAIR_STAGES.IDENTIFIED,
    REGRESSION_85_REPAIR_STAGES.ROLLBACK_DELETE_AUTHORIZED,
    REGRESSION_85_REPAIR_STAGES.ROLLBACK_DELETE_PENDING,
    REGRESSION_85_REPAIR_STAGES.ROLLBACK_ROGUE_DELETED,
    REGRESSION_85_REPAIR_STAGES.REPAIR_COMPLETED,
  ]);
  const replacementStages = new Set([
    REGRESSION_85_REPAIR_STAGES.IDENTIFIED,
    REGRESSION_85_REPAIR_STAGES.WAITING_DAILY_PLOT_WINDOW,
    REGRESSION_85_REPAIR_STAGES.CREATIVE_SELECTED,
    REGRESSION_85_REPAIR_STAGES.REPLACEMENT_CREATED,
    REGRESSION_85_REPAIR_STAGES.TRANSFERRED_PENDING_IMPORT,
    REGRESSION_85_REPAIR_STAGES.REPLACEMENT_PUBLISHED,
    REGRESSION_85_REPAIR_STAGES.OLD_DELETE_PENDING,
    REGRESSION_85_REPAIR_STAGES.OLD_DELETED,
    REGRESSION_85_REPAIR_STAGES.REPAIR_COMPLETED,
  ]);
  if (progress.some((item) => item.classification && !classifications.has(item.classification))) reasons.push("classification_invalid");
  if (progress.some((item) => item.repairStrategy && !strategies.has(item.repairStrategy))) reasons.push("repair_strategy_invalid");
  if (progress.some((item) => item.classification && (!item.classificationReason || !/^[a-f0-9]{64}$/u.test(item.evidenceHash) || !iso(item.classifiedAt)))) reasons.push("classification_provenance_incomplete");
  if (progress.some((item) => item.classification === REGRESSION_85_CLASSIFICATIONS.ROLLBACK_ELIGIBLE
    && (item.repairStrategy !== REGRESSION_85_REPAIR_STRATEGIES.ROLLBACK || !rollbackStages.has(item.stage)))) reasons.push("rollback_contract_invalid");
  if (progress.some((item) => item.classification === REGRESSION_85_CLASSIFICATIONS.REPLACEMENT_REQUIRED
    && (item.repairStrategy !== REGRESSION_85_REPAIR_STRATEGIES.REPLACEMENT || !replacementStages.has(item.stage)))) reasons.push("replacement_contract_invalid");
  if (progress.some((item) => item.classification === REGRESSION_85_CLASSIFICATIONS.AMBIGUOUS
    && item.repairStrategy !== REGRESSION_85_REPAIR_STRATEGIES.NONE)) reasons.push("ambiguous_strategy_invalid");
  if (progress.some((item) => !item.classification && (
    item.stage !== REGRESSION_85_REPAIR_STAGES.IDENTIFIED
    || item.classificationReason
    || item.evidenceHash
    || item.classifiedAt
    || item.repairStrategy
    || item.repairState !== "unclassified"
  ))) reasons.push("unclassified_contract_invalid");
  if (progress.some((item) => item.classification === REGRESSION_85_CLASSIFICATIONS.AMBIGUOUS && item.stage !== REGRESSION_85_REPAIR_STAGES.AMBIGUOUS_BLOCKED)) reasons.push("ambiguous_not_blocked");
  if (new Set(progress.map((item) => item.scopeItemId)).size !== REGRESSION_85_EXPECTED_COUNT) reasons.push("progress_ids_not_unique");
  if (items && progress.some((item) => !items.some((scopeItem) => scopeItem.scopeItemId === item.scopeItemId))) reasons.push("progress_scope_mismatch");
  if (Array.isArray(items) && items.length === REGRESSION_85_EXPECTED_COUNT) {
    try {
      assertExpectedDistribution(items);
    } catch {
      reasons.push("scope_house_distribution_invalid");
    }
  }
  if (reasons.length) {
    throw scopeError("REGRESSION_85_CAMPAIGN_CORRUPT", `Die persistente 85er-Reparaturkampagne ist ungültig: ${reasons.join(", ")}.`, { reasons });
  }
  return value;
}

export function regression85PortalExclusions(campaignValue) {
  const campaign = assertRegression85Campaign(campaignValue);
  return Object.freeze({
    listingIds: Object.freeze(campaign.scope.items.map((item) => item.regressionListingId)),
    externalObjectNumbers: Object.freeze(campaign.scope.items.map((item) => item.regressionExternalId)),
    scopeHash: campaign.scopeHash,
  });
}

function initialCampaign(scope, scopeHash, scopeEvidenceHash, input = {}) {
  const now = iso(input.now || new Date().toISOString());
  return {
    format: REGRESSION_85_SCOPE_FORMAT,
    campaignId: clean(input.campaignId, 200) || `regression-85-${scopeHash.slice(0, 24)}`,
    scopeHash,
    scopeEvidenceHash,
    scope,
    mode: "off",
    activeScopeItemId: "",
    createdAt: now,
    updatedAt: now,
    activatedAt: "",
    pausedAt: "",
    completedAt: "",
    lastErrorCode: "",
    lastError: "",
    checkpointHistory: [],
    progress: scope.items.map((item) => ({
      scopeItemId: item.scopeItemId,
      stage: REGRESSION_85_REPAIR_STAGES.IDENTIFIED,
      classification: "",
      classificationReason: "",
      evidenceHash: "",
      classifiedAt: "",
      repairStrategy: "",
      repairState: "unclassified",
      updatedAt: now,
      earliestEligibleAt: "",
      replacementListingId: "",
      replacementExternalId: "",
      uploadJobId: "",
      importReportId: "",
      deleteJobId: "",
      deleteReportId: "",
      lastErrorCode: "",
      lastError: "",
    })),
  };
}

async function atomicWrite(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporaryPath, path);
  } finally {
    await handle?.close();
    await rm(temporaryPath, { force: true });
  }
}

async function readCampaign(path) {
  try {
    return assertRegression85Campaign(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error?.code === "REGRESSION_85_CAMPAIGN_CORRUPT") throw error;
    throw scopeError("REGRESSION_85_CAMPAIGN_CORRUPT", "Die persistente 85er-Reparaturkampagne ist beschädigt oder nicht lesbar.");
  }
}

async function acquireMutationLock(path) {
  const lockPath = `${path}.lock`;
  await mkdir(dirname(path), { recursive: true });
  const token = randomUUID();
  const create = async () => {
    const handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(JSON.stringify({ format: 1, token, processId: process.pid, createdAt: new Date().toISOString() }), "utf8");
    await handle.close();
  };
  try {
    await create();
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const details = await stat(lockPath).catch(() => null);
    if (!details || Date.now() - details.mtimeMs <= MUTATION_LOCK_MS) {
      throw scopeError("REGRESSION_85_CAMPAIGN_LOCKED", "Die 85er-Reparaturkampagne wird bereits atomar aktualisiert.");
    }
    const stalePath = `${lockPath}.stale-${token}`;
    try {
      await rename(lockPath, stalePath);
      await create();
    } catch (recoveryError) {
      if (new Set(["EEXIST", "ENOENT"]).has(recoveryError?.code)) {
        throw scopeError("REGRESSION_85_CAMPAIGN_LOCKED", "Die atomare Recovery der 85er-Kampagne wurde parallel übernommen.");
      }
      throw recoveryError;
    } finally {
      await rm(stalePath, { force: true });
    }
  }
  return async () => {
    try {
      const current = JSON.parse(await readFile(lockPath, "utf8"));
      if (current?.token !== token) throw scopeError("REGRESSION_85_CAMPAIGN_LOCK_LOST", "Der 85er-Kampagnenclaim wurde ersetzt.");
      await rm(lockPath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  };
}

export function createRegression85CampaignStore(path) {
  return {
    async load() {
      try {
        const campaign = await readCampaign(path);
        if (!campaign) {
          return { valid: false, mode: "off", fallbackReason: "85er-Reparaturkampagne fehlt; fail-closed auf off." };
        }
        return { ...campaign, valid: true, fallbackReason: "" };
      } catch (error) {
        return {
          valid: false,
          mode: "off",
          fallbackReason: error instanceof Error ? error.message : "85er-Reparaturkampagne ist nicht lesbar; fail-closed auf off.",
          errorCode: clean(error?.code, 120),
        };
      }
    },
    async initialize(scope, scopeHash, scopeEvidenceHash, input = {}) {
      const release = await acquireMutationLock(path);
      try {
        const current = await readCampaign(path);
        if (current) {
          if (current.scopeHash !== scopeHash || current.scopeEvidenceHash !== scopeEvidenceHash) throw scopeError("REGRESSION_85_SCOPE_IMMUTABLE", "Eine abweichende 85er-Allowlist darf die persistierte Kampagne nicht ersetzen.");
          return { ...current, valid: true, fallbackReason: "", idempotent: true };
        }
        const campaign = assertRegression85Campaign(initialCampaign(scope, scopeHash, scopeEvidenceHash, input));
        await atomicWrite(path, campaign);
        return { ...campaign, valid: true, fallbackReason: "", idempotent: false };
      } finally {
        await release();
      }
    },
    async update(mutator, input = {}) {
      const release = await acquireMutationLock(path);
      try {
        const current = await readCampaign(path);
        if (!current) throw scopeError("REGRESSION_85_CAMPAIGN_MISSING", "Die 85er-Reparaturkampagne wurde noch nicht initialisiert.");
        const result = await mutator(structuredClone(current));
        const next = result?.campaign || result;
        if (next.scopeHash !== current.scopeHash || next.scopeEvidenceHash !== current.scopeEvidenceHash || canonicalJson(next.scope) !== canonicalJson(current.scope)) {
          throw scopeError("REGRESSION_85_SCOPE_IMMUTABLE", "Die harte 85er-Allowlist darf nach Initialisierung nicht verändert werden.");
        }
        const now = iso(input.now || new Date().toISOString());
        const normalized = assertRegression85Campaign({ ...next, updatedAt: now });
        await atomicWrite(path, normalized);
        return { ...normalized, valid: true, fallbackReason: "", result: result?.campaign ? result.result : undefined };
      } finally {
        await release();
      }
    },
  };
}
