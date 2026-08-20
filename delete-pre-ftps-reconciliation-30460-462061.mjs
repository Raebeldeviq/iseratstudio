import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

import {
  PRODUCTION_DELETE_FORMAT,
  PRODUCTION_DELETE_STATUS,
  productionDeleteIdentity,
  resolveProductionDeleteEligibility,
} from "./listing-rotation-production-delete.mjs";
import {
  normalizeListingGroup,
  updateListingControl,
} from "./listing-groups.mjs";
import { WORKFLOW_STATUS } from "./workflow-status.mjs";

export const PRE_FTPS_DELETE_RECONCILIATION = Object.freeze({
  provenance: "pre_ftps_local_runtime_failure_reconciliation",
  externalObjectNumber: "30460-462061",
  replacementExternalObjectNumber: "30460-131712",
  projectId: "1564403a-5508-4bae-8a4a-41217a91a6ea",
  sourceListingId: "10d67234-d20b-43f3-83af-45d82d580e64",
  replacementListingId: "rotation-3017faee-fc928a2d-6155ea04-copy",
  deleteJobId: "production-delete:338e05d2aac17d3947aabd12f73f00a417e6faa33616dea207f96fdf19f55352",
  idempotencyKey: "338e05d2aac17d3947aabd12f73f00a417e6faa33616dea207f96fdf19f55352",
  payloadFilename: "delete-30460-462061-20260820T153854Z.zip",
  payloadSha256: "9ed01770984b55e08760f6b144d26fba9cc8f968971a3d477c60e2d889f2fa84",
  payloadSize: 778,
  oldRuntimeDirectory: "/Users/pascalfrohlich/Library/Application Support/Fabian-Pascal Inseratestudio/helper-runtime/release-20260817073647568-22907",
});

const RECONCILED_JOB_STATUSES = new Set([
  PRODUCTION_DELETE_STATUS.PREPARED,
  PRODUCTION_DELETE_STATUS.PROCESSING,
  PRODUCTION_DELETE_STATUS.PENDING_CONFIRMATION,
  PRODUCTION_DELETE_STATUS.CONFIRMED,
]);

function reconciliationError(code, message, details = {}) {
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

function exactCatalogPair(state, contract) {
  const matches = (state?.projects || []).flatMap((project) => (project.listings || [])
    .filter((listing) => [
      contract.externalObjectNumber,
      contract.replacementExternalObjectNumber,
    ].includes(clean(listing.externalId, 40)))
    .map((listing) => ({ project, listing })));
  const sourceMatches = matches.filter(({ listing }) => listing.externalId === contract.externalObjectNumber);
  const replacementMatches = matches.filter(({ listing }) => listing.externalId === contract.replacementExternalObjectNumber);
  if (sourceMatches.length !== 1 || replacementMatches.length !== 1) {
    throw reconciliationError(
      "PRE_FTPS_RECONCILIATION_PAIR_NOT_UNIQUE",
      "Source und Replacement sind im Katalog nicht jeweils exakt einmal vorhanden.",
    );
  }
  const sourceMatch = sourceMatches[0];
  const replacementMatch = replacementMatches[0];
  if (
    sourceMatch.project.id !== contract.projectId
    || replacementMatch.project.id !== contract.projectId
    || sourceMatch.listing.id !== contract.sourceListingId
    || replacementMatch.listing.id !== contract.replacementListingId
    || sourceMatch.listing.supersededByListingId !== contract.replacementListingId
  ) {
    throw reconciliationError(
      "PRE_FTPS_RECONCILIATION_PAIR_IDENTITY_MISMATCH",
      "Die fest gebundene Source-Replacement-Identität stimmt nicht mit dem Katalog überein.",
    );
  }
  return {
    project: sourceMatch.project,
    source: sourceMatch.listing,
    replacement: replacementMatch.listing,
  };
}

function exactJob(ledger, contract) {
  if (ledger?.format !== PRODUCTION_DELETE_FORMAT || !Array.isArray(ledger.jobs)) {
    throw reconciliationError(
      "PRE_FTPS_RECONCILIATION_LEDGER_INVALID",
      "Das Production-Deleteledger besitzt nicht das erwartete Format.",
    );
  }
  const related = ledger.jobs.filter((job) =>
    job.deleteJobId === contract.deleteJobId
    || job.sourceListingId === contract.sourceListingId
    || job.externalObjectNumber === contract.externalObjectNumber);
  if (related.length !== 1) {
    throw reconciliationError(
      "PRE_FTPS_RECONCILIATION_JOB_NOT_UNIQUE",
      "Der freigegebene Production-Deletejob ist nicht eindeutig.",
    );
  }
  const job = related[0];
  if (
    job.deleteJobId !== contract.deleteJobId
    || job.idempotencyKey !== contract.idempotencyKey
    || job.projectId !== contract.projectId
    || job.sourceListingId !== contract.sourceListingId
    || job.replacementListingId !== contract.replacementListingId
    || job.externalObjectNumber !== contract.externalObjectNumber
    || job.replacementExternalObjectNumber !== contract.replacementExternalObjectNumber
    || job.payloadFilename !== contract.payloadFilename
    || job.payloadSha256 !== contract.payloadSha256
    || job.payloadSize !== contract.payloadSize
  ) {
    throw reconciliationError(
      "PRE_FTPS_RECONCILIATION_JOB_IDENTITY_MISMATCH",
      "Identität oder Payload des freigegebenen Production-Deletejobs weicht ab.",
    );
  }
  return job;
}

function hasMatchingDeleteReport(state, contract) {
  return (state?.deleteReports || []).some((report) =>
    report.deleteJobId === contract.deleteJobId
    || report.externalObjectNumber === contract.externalObjectNumber);
}

function validateRuntimeEvidence(evidence, contract) {
  const reasons = [];
  if (evidence?.oldRuntimeDirectory !== contract.oldRuntimeDirectory) reasons.push("runtime_directory_mismatch");
  if (evidence?.sidecarPresent !== false) reasons.push("missing_sidecar_not_proven");
  if (evidence?.credentialVaultBeforeClient !== true) reasons.push("credential_before_client_not_proven");
  if (evidence?.clientBeforeAccess !== true) reasons.push("client_order_not_proven");
  if (evidence?.accessBeforeUpload !== true) reasons.push("upload_order_not_proven");
  if (evidence?.sidecarReferenceVerified !== true) reasons.push("sidecar_reference_not_proven");
  if (reasons.length) {
    throw reconciliationError(
      "PRE_FTPS_RECONCILIATION_RUNTIME_EVIDENCE_INSUFFICIENT",
      `Die lokale Pre-FTPS-Codeevidenz ist unvollständig: ${reasons.join(", ")}.`,
      { reasons },
    );
  }
}

function validateLogEvidence(evidence, contract) {
  const reasons = [];
  if (evidence?.transferStartedMarkers !== 1) reasons.push("claim_marker_not_unique");
  if (evidence?.transferredMarkers !== 0) reasons.push("transferred_marker_present");
  if (evidence?.confirmedMarkers !== 0) reasons.push("confirmation_marker_present");
  if (evidence?.matchingLocalFailures !== 1) reasons.push("local_failure_not_unique");
  if (evidence?.failureMentionsExpectedSidecar !== true) reasons.push("expected_sidecar_failure_missing");
  if (evidence?.failureSourceListingId !== contract.sourceListingId) reasons.push("failure_source_mismatch");
  if (reasons.length) {
    throw reconciliationError(
      "PRE_FTPS_RECONCILIATION_LOG_EVIDENCE_INSUFFICIENT",
      `Die persistente Pre-FTPS-Logevidenz ist unvollständig: ${reasons.join(", ")}.`,
      { reasons },
    );
  }
}

function validateMailEvidence(evidence) {
  if (
    evidence?.checked !== true
    || evidence?.readOnly !== true
    || evidence?.mailMutations !== 0
    || evidence?.matchCount !== 0
  ) {
    throw reconciliationError(
      "PRE_FTPS_RECONCILIATION_DELETE_REPORT_PRESENT_OR_UNCHECKED",
      "Der read-only Mailgegencheck fehlt oder enthält bereits einen passenden Löschbericht.",
    );
  }
}

function isReconciledJob(job, contract) {
  return RECONCILED_JOB_STATUSES.has(job.status)
    && job.preFtpsReconciliation?.provenance === contract.provenance
    && job.preFtpsReconciliation?.sourceExternalObjectNumber === contract.externalObjectNumber
    && job.preFtpsReconciliation?.replacementExternalObjectNumber === contract.replacementExternalObjectNumber
    && job.preFtpsReconciliation?.previousStatus === PRODUCTION_DELETE_STATUS.TRANSFER_UNCERTAIN
    && job.preFtpsReconciliation?.confirmedTransferCount === 0;
}

function stateForNormalEligibility(state, pair) {
  const source = {
    ...pair.source,
    productionDeleteState: "authorized",
    productionDeleteError: "",
  };
  const project = {
    ...pair.project,
    listings: pair.project.listings.map((listing) => listing.id === source.id ? source : listing),
  };
  return {
    ...state,
    projects: state.projects.map((candidate) => candidate.id === project.id ? project : candidate),
  };
}

export function resolvePreFtpsDeleteReconciliation(state, ledger, evidence, options = {}) {
  const contract = PRE_FTPS_DELETE_RECONCILIATION;
  const requestedSource = clean(options.externalObjectNumber || contract.externalObjectNumber, 40);
  const requestedReplacement = clean(options.replacementExternalObjectNumber || contract.replacementExternalObjectNumber, 40);
  const requestedJob = clean(options.deleteJobId || contract.deleteJobId, 200);
  if (
    requestedSource !== contract.externalObjectNumber
    || requestedReplacement !== contract.replacementExternalObjectNumber
    || requestedJob !== contract.deleteJobId
  ) {
    throw reconciliationError(
      "PRE_FTPS_RECONCILIATION_TARGET_NOT_AUTHORIZED",
      "Die einmalige Reconciliation ist ausschließlich für das fest gebundene Source-Replacement-Job-Triple freigegeben.",
    );
  }
  validateRuntimeEvidence(evidence?.runtime, contract);
  validateLogEvidence(evidence?.logs, contract);
  validateMailEvidence(evidence?.mail);
  const pair = exactCatalogPair(state, contract);
  const job = exactJob(ledger, contract);
  const alreadyReconciled = isReconciledJob(job, contract);

  if (hasMatchingDeleteReport(state, contract)) {
    throw reconciliationError(
      "PRE_FTPS_RECONCILIATION_DELETE_REPORT_ALREADY_PRESENT",
      "Für die Source existiert bereits ein persistenter Löschbericht; ein erneuter Transfer ist gesperrt.",
    );
  }
  if (pair.source.status !== WORKFLOW_STATUS.PUBLISHED || pair.replacement.status !== WORKFLOW_STATUS.PUBLISHED) {
    throw reconciliationError(
      "PRE_FTPS_RECONCILIATION_LISTING_STATUS_INVALID",
      "Source und Replacement müssen vor der Reconciliation weiterhin published sein.",
    );
  }
  if (
    !alreadyReconciled
    && (
      job.status !== PRODUCTION_DELETE_STATUS.TRANSFER_UNCERTAIN
      || job.attempt !== 1
      || !clean(job.transferStartedAt, 50)
      || clean(job.transferCompletedAt, 50)
      || clean(job.claimToken, 200)
      || clean(job.reportMessageId, 500)
      || clean(job.reportHash, 128)
      || clean(job.providerProcessedAt, 50)
      || !clean(job.message).includes(`${contract.oldRuntimeDirectory}/macos-keychain.swift`)
    )
  ) {
    throw reconciliationError(
      "PRE_FTPS_RECONCILIATION_JOB_NOT_PRETRANSFER_UNCERTAIN",
      "Der Job entspricht nicht mehr dem exakt freigegebenen lokalen Pre-FTPS-Abbruch.",
    );
  }
  if (
    !alreadyReconciled
    && (
      pair.source.productionDeleteState !== "transfer_uncertain"
      || pair.source.productionDeleteJobId !== contract.deleteJobId
      || pair.source.externalDeletionPending !== true
    )
  ) {
    throw reconciliationError(
      "PRE_FTPS_RECONCILIATION_CATALOG_STATE_INVALID",
      "Der Source-Katalogzustand entspricht nicht dem freigegebenen unklaren Pre-FTPS-Abbruch.",
    );
  }

  const eligibilityState = stateForNormalEligibility(state, pair);
  const eligibility = resolveProductionDeleteEligibility(
    eligibilityState,
    contract.projectId,
    contract.sourceListingId,
    ledger,
  );
  const identity = productionDeleteIdentity(eligibility.source, eligibility.replacement);
  if (identity.deleteJobId !== contract.deleteJobId || identity.idempotencyKey !== contract.idempotencyKey) {
    throw reconciliationError(
      "PRE_FTPS_RECONCILIATION_IDEMPOTENCY_MISMATCH",
      "Der normale Production-DELETE-Vertrag erzeugt nicht mehr die fest gebundene Jobidentität.",
    );
  }
  const catalogReconciled = pair.source.productionDeleteState === "authorized"
    && pair.source.productionDeleteReconciliation?.provenance === contract.provenance;
  return {
    contract,
    pair,
    job,
    eligibility,
    alreadyReconciled,
    catalogReconciled,
    idempotent: alreadyReconciled && catalogReconciled,
  };
}

export function reconcilePreFtpsDeleteJobInLedger(ledger, options = {}) {
  const contract = PRE_FTPS_DELETE_RECONCILIATION;
  const now = clean(options.now || new Date().toISOString(), 50);
  const job = exactJob(ledger, contract);
  if (isReconciledJob(job, contract)) return { ledger, job, changed: false, idempotent: true };
  if (job.status !== PRODUCTION_DELETE_STATUS.TRANSFER_UNCERTAIN) {
    throw reconciliationError(
      "PRE_FTPS_RECONCILIATION_LEDGER_STATUS_CHANGED",
      "Der Deletejob ist nicht mehr im freigegebenen unklaren Zustand.",
    );
  }
  const failureMessage = clean(job.message);
  const reconciled = {
    ...job,
    status: PRODUCTION_DELETE_STATUS.PREPARED,
    attempt: 0,
    claimToken: "",
    transferStartedAt: "",
    transferCompletedAt: "",
    updatedAt: now,
    message: "",
    preFtpsReconciliation: {
      provenance: contract.provenance,
      reconciledAt: now,
      sourceExternalObjectNumber: contract.externalObjectNumber,
      replacementExternalObjectNumber: contract.replacementExternalObjectNumber,
      previousStatus: job.status,
      previousAttempt: job.attempt,
      previousTransferStartedAt: job.transferStartedAt,
      previousFailureSha256: sha256(failureMessage),
      confirmedTransferCount: 0,
      deleteReportMatchCount: 0,
    },
  };
  return {
    ledger: {
      ...ledger,
      jobs: ledger.jobs.map((candidate) => candidate.deleteJobId === contract.deleteJobId ? reconciled : candidate),
    },
    job: reconciled,
    changed: true,
    idempotent: false,
  };
}

export function reconcilePreFtpsDeleteCatalogInState(state, ledger, evidence, options = {}) {
  const now = clean(options.now || new Date().toISOString(), 50);
  const resolution = resolvePreFtpsDeleteReconciliation(state, ledger, evidence, {
    externalObjectNumber: PRE_FTPS_DELETE_RECONCILIATION.externalObjectNumber,
    replacementExternalObjectNumber: PRE_FTPS_DELETE_RECONCILIATION.replacementExternalObjectNumber,
    deleteJobId: PRE_FTPS_DELETE_RECONCILIATION.deleteJobId,
  });
  if (resolution.catalogReconciled) {
    return { state, changed: false, idempotent: true, resolution };
  }
  if (!resolution.alreadyReconciled) {
    throw reconciliationError(
      "PRE_FTPS_RECONCILIATION_LEDGER_NOT_REOPENED",
      "Der Ledgerjob muss vor der Katalogfreigabe auditierbar reconciliiert sein.",
    );
  }
  const source = {
    ...resolution.pair.source,
    productionDeleteState: "authorized",
    productionDeleteError: "",
    productionDeleteJobId: resolution.contract.deleteJobId,
    productionDeleteReconciliation: {
      provenance: resolution.contract.provenance,
      reconciledAt: resolution.job.preFtpsReconciliation.reconciledAt,
      deleteJobId: resolution.contract.deleteJobId,
      confirmedTransferCount: 0,
    },
  };
  let group = normalizeListingGroup(resolution.pair.project.listingGroup, resolution.pair.project.id, { now });
  group = updateListingControl(group, source, {
    automaticUpdateEnabled: false,
    automaticDeletionEnabled: true,
    status: WORKFLOW_STATUS.PUBLISHED,
    statusMessage: `Ersetzt · DELETE nach lokalem Pre-FTPS-Abbruch einmalig freigegeben · ${source.externalId}`,
    processLease: null,
    schedulerSelectionId: "",
    schedulerSelectedAt: "",
  }, { now });
  const project = {
    ...resolution.pair.project,
    listings: resolution.pair.project.listings.map((listing) => listing.id === source.id ? source : listing),
    listingGroup: group,
  };
  const nextState = {
    ...state,
    projects: state.projects.map((candidate) => candidate.id === project.id ? project : candidate),
  };
  resolveProductionDeleteEligibility(
    nextState,
    resolution.contract.projectId,
    resolution.contract.sourceListingId,
    ledger,
  );
  return { state: nextState, changed: true, idempotent: false, resolution, source };
}

async function atomicWriteJson(path, value) {
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

export async function reconcilePreFtpsDeleteLedgerFile(path, options = {}) {
  const lockPath = `${path}.lock`;
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw reconciliationError(
        "PRE_FTPS_RECONCILIATION_LEDGER_LOCKED",
        "Das Production-Deleteledger wird bereits verarbeitet.",
      );
    }
    throw error;
  }
  try {
    const ledger = JSON.parse(await readFile(path, "utf8"));
    const result = reconcilePreFtpsDeleteJobInLedger(ledger, options);
    if (result.changed) await atomicWriteJson(path, result.ledger);
    return result;
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}
