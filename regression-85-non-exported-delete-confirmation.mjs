import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

import {
  assertRegression85Campaign,
  canonicalRegression85Json,
  REGRESSION_85_CLASSIFICATIONS,
  REGRESSION_85_EXPECTED_COUNT,
  REGRESSION_85_REPAIR_STRATEGIES,
} from "./regression-85-repair-scope.mjs";

export const REGRESSION_85_NON_EXPORTED_CONFIRMATION_FORMAT = 1;
export const REGRESSION_85_NON_EXPORTED_CONFIRMATION_TYPE = "provider_object_delete_confirmed_non_exported";
export const REGRESSION_85_NON_EXPORTED_CONFIRMATION_CONTRACT = Object.freeze({
  format: REGRESSION_85_NON_EXPORTED_CONFIRMATION_FORMAT,
  contract: "regression-85-non-exported-delete-confirmation-v1",
  scopeHash: "abcf59c654f573bc13906e555badeb13e090eb67d9c971cfb0216b5a4abace58",
  scopeEvidenceHash: "aed402ff8661fcafe70bddd15cd9abebd1e7f5a5cbf86fb506e0613e34654602",
  classificationFingerprint: "97569eac0bc46176b3975d5687d48903547e0ebb29cd2dea858c277c69852e80",
});

const PORTAL_KEYS = Object.freeze(["immowelt", "kleinanzeigen", "immoscout24"]);
const validatedContexts = new WeakSet();

function clean(value, maximum = 500) {
  return String(value ?? "").trim().slice(0, maximum);
}

function iso(value) {
  const parsed = Date.parse(clean(value, 50));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function confirmationError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function exactPortalStatuses(value) {
  const statuses = Object.fromEntries(PORTAL_KEYS.map((key) => [key, clean(value?.[key], 100)]));
  if (PORTAL_KEYS.some((key) => statuses[key] !== "not_transferred")) {
    throw confirmationError(
      "DELETE_NON_EXPORTED_PORTAL_STATUS_NOT_PROVEN",
      "Der Never-exported-Nachweis verlangt für Immowelt, Kleinanzeigen und ImmoScout24 jeweils exakt not_transferred.",
      { statuses },
    );
  }
  return statuses;
}

export function regression85ClassificationFingerprint(campaignValue) {
  const campaign = assertRegression85Campaign(campaignValue);
  return sha256(canonicalRegression85Json(campaign.progress.map((item) => ({
    scopeItemId: item.scopeItemId,
    classification: item.classification,
    reason: item.classificationReason,
    evidenceHash: item.evidenceHash,
  }))));
}

function assertCampaignContract(campaignValue, contract) {
  const campaign = assertRegression85Campaign(campaignValue);
  const reasons = [];
  if (campaign.scopeHash !== contract.scopeHash) reasons.push("scope_hash_mismatch");
  if (campaign.scopeEvidenceHash !== contract.scopeEvidenceHash) reasons.push("scope_evidence_hash_mismatch");
  if (campaign.scope.items.length !== REGRESSION_85_EXPECTED_COUNT) reasons.push("scope_count_mismatch");
  if (campaign.classificationSummary?.total !== REGRESSION_85_EXPECTED_COUNT) reasons.push("classification_count_mismatch");
  if (campaign.classificationSummary?.counts?.ROLLBACK_ELIGIBLE !== REGRESSION_85_EXPECTED_COUNT) reasons.push("rollback_count_mismatch");
  if (campaign.classificationSummary?.counts?.REPLACEMENT_REQUIRED !== 0) reasons.push("replacement_count_not_zero");
  if (campaign.classificationSummary?.counts?.AMBIGUOUS !== 0) reasons.push("ambiguous_count_not_zero");
  if (campaign.progress.some((item) =>
    item.classification !== REGRESSION_85_CLASSIFICATIONS.ROLLBACK_ELIGIBLE
    || item.repairStrategy !== REGRESSION_85_REPAIR_STRATEGIES.ROLLBACK
    || !/^[a-f0-9]{64}$/u.test(clean(item.evidenceHash, 64)))) reasons.push("classification_provenance_invalid");
  const fingerprint = regression85ClassificationFingerprint(campaign);
  if (fingerprint !== contract.classificationFingerprint) reasons.push("classification_fingerprint_mismatch");
  if (reasons.length) {
    throw confirmationError(
      "DELETE_NON_EXPORTED_SCOPE_OR_FINGERPRINT_MISMATCH",
      `Der Never-exported-Vertrag stimmt nicht exakt mit dem freigegebenen 85er-Scope überein: ${reasons.join(", ")}.`,
      { reasons, fingerprint },
    );
  }
  return campaign;
}

function portalReference(value, listingIds, externalIds) {
  const listingId = clean(value?.listingId || value?.sourceListingId || value?.regressionListingId, 200);
  const externalId = clean(value?.externalObjectNumber || value?.externalId || value?.regressionExternalId, 40);
  return listingIds.has(listingId) || externalIds.has(externalId);
}

export function assertNoRegression85PortalTransferProvenance(campaignValue, portalLedgerValue, portalEventsValue) {
  const campaign = assertRegression85Campaign(campaignValue);
  const listingIds = new Set(campaign.scope.items.map((item) => item.regressionListingId));
  const externalIds = new Set(campaign.scope.items.map((item) => item.regressionExternalId));
  const jobs = Array.isArray(portalLedgerValue?.jobs) ? portalLedgerValue.jobs : [];
  const events = Array.isArray(portalEventsValue) ? portalEventsValue : [];
  const scopedJobs = jobs.filter((job) => portalReference(job, listingIds, externalIds));
  const scopedEvents = events.filter((event) => portalReference(event, listingIds, externalIds));
  if (scopedJobs.length || scopedEvents.length) {
    throw confirmationError(
      "DELETE_NON_EXPORTED_PORTAL_TRANSFER_PROVENANCE_PRESENT",
      "Mindestens ein Rogue-B besitzt Portaljob- oder Portaltransfer-Provenienz; der Never-exported-Vertrag ist fail-closed blockiert.",
      {
        jobIds: scopedJobs.map((job) => clean(job.jobId, 200)),
        eventIds: scopedEvents.map((event) => clean(event.evidenceId || event.jobId, 200)),
      },
    );
  }
  return {
    scopedJobCount: 0,
    scopedEventCount: 0,
    observedPortalJobCount: jobs.length,
    observedPortalEventCount: events.length,
  };
}

function normalizedSnapshotItems(snapshotValue, campaign) {
  if (snapshotValue?.format !== 1 || !iso(snapshotValue.observedAt)) {
    throw confirmationError("DELETE_NON_EXPORTED_EVIDENCE_INVALID", "Der read-only Portalstatus-Snapshot ist ungültig.");
  }
  const records = Array.isArray(snapshotValue.items) ? snapshotValue.items : [];
  if (records.length !== REGRESSION_85_EXPECTED_COUNT) {
    throw confirmationError("DELETE_NON_EXPORTED_EVIDENCE_INCOMPLETE", "Der Never-exported-Nachweis muss exakt 85 Einträge enthalten.");
  }
  const byScopeItemId = new Map();
  for (const record of records) {
    const scopeItemId = clean(record?.scopeItemId, 200);
    if (!scopeItemId || byScopeItemId.has(scopeItemId)) {
      throw confirmationError("DELETE_NON_EXPORTED_EVIDENCE_INCOMPLETE", "Der Never-exported-Nachweis enthält fehlende oder doppelte Scope-IDs.");
    }
    byScopeItemId.set(scopeItemId, record);
  }
  return campaign.scope.items.map((scopeItem) => {
    const record = byScopeItemId.get(scopeItem.scopeItemId);
    const progress = campaign.progress.find((item) => item.scopeItemId === scopeItem.scopeItemId);
    if (
      !record
      || clean(record.regressionExternalId, 40) !== scopeItem.regressionExternalId
      || !/^30460-\d{6}$/u.test(clean(record.sourceExternalId, 40))
      || !iso(record.observedAt || snapshotValue.observedAt)
    ) {
      throw confirmationError(
        "DELETE_NON_EXPORTED_EVIDENCE_SCOPE_MISMATCH",
        `Der Portalstatus-Snapshot stimmt für ${scopeItem.scopeItemId} nicht exakt mit der 85er-Allowlist überein.`,
      );
    }
    return {
      scopeItemId: scopeItem.scopeItemId,
      projectId: scopeItem.projectId,
      regressionListingId: scopeItem.regressionListingId,
      regressionExternalId: scopeItem.regressionExternalId,
      originalSourceListingId: scopeItem.originalSourceListingId,
      originalSourceExternalId: clean(record.sourceExternalId, 40),
      observedAt: iso(record.observedAt || snapshotValue.observedAt),
      sourcePresenceChannel: clean(record.sourcePresenceChannel || snapshotValue.channel, 100),
      portalStatuses: exactPortalStatuses(record.portalStatuses),
      classificationEvidenceHash: progress.evidenceHash,
    };
  });
}

function attestationCore(value) {
  return {
    format: value.format,
    contract: value.contract,
    scopeHash: value.scopeHash,
    scopeEvidenceHash: value.scopeEvidenceHash,
    classificationFingerprint: value.classificationFingerprint,
    snapshotObservedAt: value.snapshotObservedAt,
    classificationSnapshotHash: value.classificationSnapshotHash,
    portalLedgerSnapshotHash: value.portalLedgerSnapshotHash,
    portalEventSnapshotHash: value.portalEventSnapshotHash,
    portalEvidenceSummary: value.portalEvidenceSummary,
    items: value.items,
  };
}

export function createRegression85NonExportedAttestation(input, options = {}) {
  const contract = options.contract || REGRESSION_85_NON_EXPORTED_CONFIRMATION_CONTRACT;
  const campaign = assertCampaignContract(input.campaign, contract);
  const portalSummary = assertNoRegression85PortalTransferProvenance(campaign, input.portalLedger, input.portalEvents);
  const items = normalizedSnapshotItems(input.evidenceSnapshot, campaign);
  const core = {
    format: REGRESSION_85_NON_EXPORTED_CONFIRMATION_FORMAT,
    contract: contract.contract,
    scopeHash: contract.scopeHash,
    scopeEvidenceHash: contract.scopeEvidenceHash,
    classificationFingerprint: contract.classificationFingerprint,
    snapshotObservedAt: iso(input.evidenceSnapshot.observedAt),
    classificationSnapshotHash: sha256(canonicalRegression85Json(input.evidenceSnapshot)),
    portalLedgerSnapshotHash: sha256(canonicalRegression85Json(input.portalLedger || { format: 1, jobs: [] })),
    portalEventSnapshotHash: sha256(canonicalRegression85Json(input.portalEvents || [])),
    portalEvidenceSummary: portalSummary,
    items,
  };
  return Object.freeze({
    ...core,
    attestationHash: sha256(canonicalRegression85Json(core)),
    createdAt: iso(input.createdAt || new Date().toISOString()),
  });
}

export function assertRegression85NonExportedAttestation(value, campaignValue, options = {}) {
  const contract = options.contract || REGRESSION_85_NON_EXPORTED_CONFIRMATION_CONTRACT;
  const campaign = assertCampaignContract(campaignValue, contract);
  const reasons = [];
  if (value?.format !== REGRESSION_85_NON_EXPORTED_CONFIRMATION_FORMAT) reasons.push("format_invalid");
  if (value?.contract !== contract.contract) reasons.push("contract_invalid");
  if (value?.scopeHash !== contract.scopeHash) reasons.push("scope_hash_invalid");
  if (value?.scopeEvidenceHash !== contract.scopeEvidenceHash) reasons.push("scope_evidence_hash_invalid");
  if (value?.classificationFingerprint !== contract.classificationFingerprint) reasons.push("classification_fingerprint_invalid");
  if (!iso(value?.snapshotObservedAt) || !iso(value?.createdAt)) reasons.push("timestamps_invalid");
  for (const field of ["classificationSnapshotHash", "portalLedgerSnapshotHash", "portalEventSnapshotHash", "attestationHash"]) {
    if (!/^[a-f0-9]{64}$/u.test(clean(value?.[field], 64))) reasons.push(`${field}_invalid`);
  }
  if (!Array.isArray(value?.items) || value.items.length !== REGRESSION_85_EXPECTED_COUNT) reasons.push("item_count_invalid");
  if (Array.isArray(value?.items)) {
    const byScopeItemId = new Map(value.items.map((item) => [item.scopeItemId, item]));
    if (byScopeItemId.size !== REGRESSION_85_EXPECTED_COUNT) reasons.push("item_ids_not_unique");
    for (const scopeItem of campaign.scope.items) {
      const item = byScopeItemId.get(scopeItem.scopeItemId);
      const progress = campaign.progress.find((entry) => entry.scopeItemId === scopeItem.scopeItemId);
      if (
        !item
        || item.projectId !== scopeItem.projectId
        || item.regressionListingId !== scopeItem.regressionListingId
        || item.regressionExternalId !== scopeItem.regressionExternalId
        || item.originalSourceListingId !== scopeItem.originalSourceListingId
        || item.classificationEvidenceHash !== progress.evidenceHash
        || !/^30460-\d{6}$/u.test(clean(item.originalSourceExternalId, 40))
      ) reasons.push(`item_scope_mismatch:${scopeItem.scopeItemId}`);
      try {
        exactPortalStatuses(item?.portalStatuses);
      } catch {
        reasons.push(`item_portal_status_invalid:${scopeItem.scopeItemId}`);
      }
    }
  }
  if (value?.attestationHash !== sha256(canonicalRegression85Json(attestationCore(value || {})))) reasons.push("attestation_hash_mismatch");
  if (reasons.length) {
    throw confirmationError(
      "DELETE_NON_EXPORTED_ATTESTATION_INVALID",
      `Der persistente Never-exported-Nachweis ist ungültig: ${reasons.join(", ")}.`,
      { reasons },
    );
  }
  return value;
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

export function createRegression85NonExportedAttestationStore(path) {
  return Object.freeze({
    async load() {
      try {
        return JSON.parse(await readFile(path, "utf8"));
      } catch (error) {
        if (error?.code === "ENOENT") return null;
        throw confirmationError("DELETE_NON_EXPORTED_ATTESTATION_UNREADABLE", "Der persistente Never-exported-Nachweis ist beschädigt oder nicht lesbar.");
      }
    },
    async save(value) {
      const current = await this.load();
      if (current) {
        if (current.attestationHash !== value.attestationHash) {
          throw confirmationError("DELETE_NON_EXPORTED_ATTESTATION_IMMUTABLE", "Ein abweichender Never-exported-Nachweis darf die persistierte Attestation nicht ersetzen.");
        }
        return { ...current, idempotent: true };
      }
      await atomicWrite(path, value);
      return { ...value, idempotent: false };
    },
  });
}

export function createRegression85NonExportedConfirmationResolver(options) {
  if (!options?.attestationStore?.load || !options?.campaignStore?.load) {
    throw new Error("Dem Never-exported-Bestätigungsresolver fehlen Attestation oder Kampagnenspeicher.");
  }
  if (typeof options.readPortalLedger !== "function" || typeof options.readPortalEvents !== "function") {
    throw new Error("Dem Never-exported-Bestätigungsresolver fehlt der aktuelle Portalprovenienz-Abgleich.");
  }
  const contract = options.contract || REGRESSION_85_NON_EXPORTED_CONFIRMATION_CONTRACT;
  return async (job) => {
    const [attestationValue, campaignValue, portalLedger, portalEvents] = await Promise.all([
      options.attestationStore.load(),
      options.campaignStore.load(),
      options.readPortalLedger(),
      options.readPortalEvents(),
    ]);
    if (!attestationValue) return null;
    const campaign = assertCampaignContract(campaignValue, contract);
    const attestation = assertRegression85NonExportedAttestation(attestationValue, campaign, { contract });
    assertNoRegression85PortalTransferProvenance(campaign, portalLedger, portalEvents);
    const scopeItem = campaign.scope.items.find((item) =>
      item.regressionListingId === clean(job?.sourceListingId, 200)
      && item.originalSourceListingId === clean(job?.replacementListingId, 200)
      && item.regressionExternalId === clean(job?.externalObjectNumber, 40));
    if (!scopeItem) return null;
    const progress = campaign.progress.find((item) => item.scopeItemId === scopeItem.scopeItemId);
    const evidence = attestation.items.find((item) => item.scopeItemId === scopeItem.scopeItemId);
    if (
      !progress
      || !evidence
      || progress.classification !== REGRESSION_85_CLASSIFICATIONS.ROLLBACK_ELIGIBLE
      || progress.repairStrategy !== REGRESSION_85_REPAIR_STRATEGIES.ROLLBACK
      || progress.evidenceHash !== evidence.classificationEvidenceHash
      || clean(job?.replacementExternalObjectNumber, 40) !== evidence.originalSourceExternalId
    ) {
      throw confirmationError("DELETE_NON_EXPORTED_JOB_PROVENANCE_MISMATCH", "Der offene DELETE-Job stimmt nicht exakt mit der Never-exported-Attestation überein.");
    }
    const context = Object.freeze({
      confirmationType: REGRESSION_85_NON_EXPORTED_CONFIRMATION_TYPE,
      targetWasNeverPortalExported: true,
      scopeHash: contract.scopeHash,
      scopeEvidenceHash: contract.scopeEvidenceHash,
      classificationFingerprint: contract.classificationFingerprint,
      attestationHash: attestation.attestationHash,
      scopeItemId: scopeItem.scopeItemId,
      targetExternalObjectNumber: scopeItem.regressionExternalId,
      originalExternalObjectNumber: evidence.originalSourceExternalId,
      classificationEvidenceHash: evidence.classificationEvidenceHash,
      portalStatuses: evidence.portalStatuses,
    });
    validatedContexts.add(context);
    return context;
  };
}

export function isValidatedRegression85NonExportedConfirmationContext(value, expectedTarget) {
  return Boolean(
    value
    && validatedContexts.has(value)
    && value.confirmationType === REGRESSION_85_NON_EXPORTED_CONFIRMATION_TYPE
    && value.targetWasNeverPortalExported === true
    && value.targetExternalObjectNumber === expectedTarget
    && /^[a-f0-9]{64}$/u.test(clean(value.attestationHash, 64))
    && PORTAL_KEYS.every((key) => value.portalStatuses?.[key] === "not_transferred"),
  );
}
