import { createHash } from "node:crypto";

import { createUploadJobId } from "./batch-upload.mjs";
import { parseImmoprofessionalDeleteReport } from "./immoprofessional-delete-report-parser.mjs";
import {
  listingControl,
  normalizeListingGroup,
  updateListingControl,
} from "./listing-groups.mjs";
import {
  buildProductionDeletePayload,
  PRODUCTION_DELETE_STATUS,
} from "./listing-rotation-production-delete.mjs";
import { listingDueAt, normalizeListingScheduler } from "./listing-scheduler.mjs";
import { MAX_LISTING_GROUP_LOGS } from "./listing-rules.mjs";
import { normalizeWorkflowStatus, WORKFLOW_STATUS } from "./workflow-status.mjs";

export const LEGACY_CONFIRMATION_SOURCE = "legacy_provider_presence_verification";
export const LEGACY_VERIFICATION_METHOD = "manual_immoprofessional_exact_object_number";
export const LEGACY_TIMESTAMP_SOURCE = "historical_ftps_transfer_for_legacy_reconciliation";
export const LEGACY_VERIFIED_BY = "user_confirmed_provider_presence";
export const LEGACY_DELETE_JOB_PREFIX = "legacy-reconciliation-delete:";

export const LEGACY_RECONCILIATION_CASES = Object.freeze({
  "30460-652921": Object.freeze({
    projectId: "d3647c02-2fe5-49b3-b45c-0553f12d62f9",
    sourceListingId: "13880341-6167-4be0-a46e-8af211bd43ab",
    sourceExternalObjectNumber: "30460-095107",
    replacementListingId: "rotation-81674147-8c0458c3-d73ed783-copy",
    uploadJobId: "upload:d3647c02-2fe5-49b3-b45c-0553f12d62f9:rotation-81674147-8c0458c3-d73ed783-copy:30460-652921:2:normal",
  }),
  "30460-056361": Object.freeze({
    projectId: "3426878d-c8a9-466b-973e-4846683119d7",
    sourceListingId: "b6611304-746a-48f5-a6ce-46dce260ab78",
    sourceExternalObjectNumber: "30460-028212",
    replacementListingId: "rotation-e910c181-68f72874-d6f9b831-copy",
    uploadJobId: "upload:3426878d-c8a9-466b-973e-4846683119d7:rotation-e910c181-68f72874-d6f9b831-copy:30460-056361:2:normal",
  }),
});

export const ALLOWED_LEGACY_EXTERNAL_OBJECT_NUMBERS = Object.freeze(Object.keys(LEGACY_RECONCILIATION_CASES));

function clean(value, maximum = 500) {
  return String(value ?? "").trim().slice(0, maximum);
}

function legacyError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function authorizedCase(externalObjectNumber) {
  const target = clean(externalObjectNumber, 40);
  const contract = LEGACY_RECONCILIATION_CASES[target];
  if (!contract) {
    throw legacyError(
      "LEGACY_RECONCILIATION_NOT_AUTHORIZED",
      `Die Objektnummer ${target || "(leer)"} ist nicht für die einmalige Legacy-Reconciliation freigegeben.`,
    );
  }
  return { replacementExternalObjectNumber: target, ...contract };
}

function iso(value, code, label) {
  const timestamp = clean(value, 50);
  if (!Number.isFinite(Date.parse(timestamp))) throw legacyError(code, `${label} fehlt oder ist ungültig.`);
  return new Date(timestamp).toISOString();
}

export function validateLegacyProviderPresenceEvidence(input, options = {}) {
  const now = iso(options.now || new Date().toISOString(), "LEGACY_RECONCILIATION_CLOCK_INVALID", "Der Reconciliation-Zeitpunkt");
  const contract = authorizedCase(input?.externalObjectNumber);
  const verifiedAt = iso(input?.verifiedAt, "LEGACY_PROVIDER_VERIFICATION_INVALID", "Der aktuelle Provider-Prüfzeitpunkt");
  const ageMs = Date.parse(now) - Date.parse(verifiedAt);
  const maximumAgeMs = Math.max(1, Number(options.maximumAgeMs) || 15 * 60 * 1000);
  if (ageMs < -60_000 || ageMs > maximumAgeMs) {
    throw legacyError("LEGACY_PROVIDER_VERIFICATION_STALE", "Die read-only Providerprüfung ist nicht aktuell genug für eine Katalogmutation.");
  }
  if (
    input?.format !== 1
    || input?.evidenceType !== LEGACY_CONFIRMATION_SOURCE
    || input?.confirmationSource !== LEGACY_CONFIRMATION_SOURCE
    || input?.verificationMethod !== LEGACY_VERIFICATION_METHOD
    || input?.verifiedBy !== LEGACY_VERIFIED_BY
    || input?.providerSystem !== "immoprofessional"
    || clean(input?.providerId, 40) !== "30460"
    || input?.verificationScope !== "current_provider_inventory"
    || input?.providerPresenceConfirmed !== true
    || input?.readOnly !== true
    || input?.originalImportReportAvailable !== false
    || clean(input?.providerRecordExternalObjectNumber, 40) !== contract.replacementExternalObjectNumber
  ) {
    throw legacyError(
      "LEGACY_PROVIDER_PRESENCE_NOT_CONFIRMED",
      "Der aktuelle read-only Providernachweis bestätigt die exakte Objektnummer nicht vollständig.",
    );
  }
  return Object.freeze({
    format: 1,
    evidenceType: LEGACY_CONFIRMATION_SOURCE,
    confirmationSource: LEGACY_CONFIRMATION_SOURCE,
    verificationMethod: LEGACY_VERIFICATION_METHOD,
    externalObjectNumber: contract.replacementExternalObjectNumber,
    providerRecordExternalObjectNumber: contract.replacementExternalObjectNumber,
    providerPresenceConfirmed: true,
    verifiedAt,
    verifiedBy: LEGACY_VERIFIED_BY,
    providerSystem: "immoprofessional",
    providerId: "30460",
    verificationScope: "current_provider_inventory",
    readOnly: true,
    originalImportReportAvailable: false,
    reason: "historical_upload_before_machine_import_confirmation_contract",
  });
}

function matchingListings(state, externalObjectNumber) {
  return (state.projects || []).flatMap((project) => (project.listings || [])
    .filter((listing) => listing.externalId === externalObjectNumber)
    .map((listing) => ({ project, listing })));
}

function reconciliationEvidence(state, externalObjectNumber) {
  return (state.legacyImportReconciliations || []).filter((entry) =>
    entry.externalObjectNumber === externalObjectNumber
    && entry.confirmationSource === LEGACY_CONFIRMATION_SOURCE);
}

function normalImportEvidence(state, externalObjectNumber) {
  return (state.importReports || []).filter((entry) => entry.externalObjectNumber === externalObjectNumber);
}

function reviewEvidence(state, externalObjectNumber) {
  return (state.importReportReviews || []).filter((entry) => entry.externalObjectNumber === externalObjectNumber);
}

function hasActiveClaim(control) {
  return Boolean(control?.processLease || clean(control?.schedulerSelectionId, 200));
}

export function resolveLegacyReconciliationEligibility(state, uploadLedger, verificationInput, options = {}) {
  const now = iso(options.now || new Date().toISOString(), "LEGACY_RECONCILIATION_CLOCK_INVALID", "Der Reconciliation-Zeitpunkt");
  const verification = validateLegacyProviderPresenceEvidence(verificationInput, { ...options, now });
  const contract = authorizedCase(verification.externalObjectNumber);
  const existingEvidence = reconciliationEvidence(state, contract.replacementExternalObjectNumber);
  if (existingEvidence.length > 1) throw legacyError("LEGACY_RECONCILIATION_EVIDENCE_AMBIGUOUS", "Mehrere Legacy-Belege existieren für dieselbe Objektnummer.");

  const matches = matchingListings(state, contract.replacementExternalObjectNumber);
  if (matches.length !== 1) throw legacyError("LEGACY_RECONCILIATION_LISTING_NOT_UNIQUE", "Das Legacy-Replacement ist im Katalog nicht exakt einmal vorhanden.");
  const { project, listing } = matches[0];
  const source = (project.listings || []).find((candidate) => candidate.id === listing.rotationSourceListingId);
  const activeReplacementRelations = (project.listings || []).filter((candidate) =>
    candidate.rotationSourceListingId === contract.sourceListingId
    && !candidate.rotationArchivedAt
    && ![WORKFLOW_STATUS.ARCHIVED, WORKFLOW_STATUS.DELETED].includes(normalizeWorkflowStatus(candidate.status, WORKFLOW_STATUS.DRAFT)));
  if (
    project.id !== contract.projectId
    || listing.id !== contract.replacementListingId
    || !source
    || source.id !== contract.sourceListingId
    || source.externalId !== contract.sourceExternalObjectNumber
    || source.id === listing.id
    || (project.listings || []).filter((candidate) => candidate.externalId === contract.sourceExternalObjectNumber).length !== 1
    || activeReplacementRelations.length !== 1
    || activeReplacementRelations[0].id !== listing.id
  ) throw legacyError("LEGACY_RECONCILIATION_RELATION_INVALID", "Die historische Source-Replacement-Beziehung ist nicht eindeutig.");

  if (existingEvidence.length === 1) {
    const evidence = existingEvidence[0];
    const consistent = evidence.matchedListingId === listing.id
      && evidence.sourceListingId === source.id
      && listing.status === WORKFLOW_STATUS.PUBLISHED
      && source.supersededByListingId === listing.id;
    if (!consistent) throw legacyError("LEGACY_RECONCILIATION_EVIDENCE_CONFLICT", "Der vorhandene Legacy-Beleg widerspricht dem Katalogzustand.");
    return { status: "idempotent", project, listing, source, evidence, verification };
  }

  if (normalImportEvidence(state, contract.replacementExternalObjectNumber).length) {
    return { status: "normal_confirmation_exists", project, listing, source, verification };
  }
  if (reviewEvidence(state, contract.replacementExternalObjectNumber).length) {
    throw legacyError("LEGACY_RECONCILIATION_REPORT_CONFLICT", "Für das Legacy-Replacement existiert bereits ein negativer oder unklarer Importberichtbeleg.");
  }

  const group = normalizeListingGroup(project.listingGroup, project.id, { now });
  const listingControlValue = listingControl(group, listing);
  const sourceControl = listingControl(group, source);
  if (
    listing.listingOrigin !== "rotation-copy"
    || normalizeWorkflowStatus(listing.status, WORKFLOW_STATUS.DRAFT) !== WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT
    || listingControlValue.status !== WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT
  ) throw legacyError("LEGACY_RECONCILIATION_STATUS_INVALID", "Nur eine offene transferred_pending_import-Rotationskopie darf reconciliiert werden.");
  if (normalizeWorkflowStatus(source.status, WORKFLOW_STATUS.DRAFT) !== WORKFLOW_STATUS.PUBLISHED || sourceControl.status !== WORKFLOW_STATUS.PUBLISHED) {
    throw legacyError("LEGACY_RECONCILIATION_SOURCE_INVALID", "Die historische Quelle ist nicht mehr eindeutig published.");
  }
  if (hasActiveClaim(sourceControl) || hasActiveClaim(listingControlValue)) {
    throw legacyError("LEGACY_RECONCILIATION_CONCURRENT_CLAIM", "Ein konkurrierender Schedulerclaim oder Process-Lease blockiert die Reconciliation.");
  }

  const expectedJobId = createUploadJobId(project, listing);
  if (
    expectedJobId !== contract.uploadJobId
    || sourceControl.pendingRotationListingId !== listing.id
    || sourceControl.pendingRotationJobId !== expectedJobId
  ) {
    throw legacyError("LEGACY_RECONCILIATION_PENDING_RELATION_INVALID", "Die persistente Pending-Rotation verweist nicht exakt auf das Legacy-Replacement.");
  }
  const jobs = (uploadLedger?.jobs || []).filter((job) => job.jobId === expectedJobId);
  const relatedJobs = (uploadLedger?.jobs || []).filter((job) =>
    job.listingId === listing.id
    || clean(job.jobId, 500).includes(`:${contract.replacementExternalObjectNumber}:`));
  if (
    jobs.length !== 1
    || relatedJobs.length !== 1
    || jobs[0].projectId !== project.id
    || jobs[0].listingId !== listing.id
    || jobs[0].status !== WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT
  ) throw legacyError("LEGACY_RECONCILIATION_TRANSFER_NOT_CONFIRMED", "Das Uploadledger bestätigt keinen eindeutigen historischen FTPS-Transfer.");
  const history = (state.uploadHistory || []).filter((entry) => entry.jobId === expectedJobId);
  const relatedHistory = (state.uploadHistory || []).filter((entry) =>
    entry.listingId === listing.id
    || clean(entry.jobId, 500).includes(`:${contract.replacementExternalObjectNumber}:`));
  if (
    history.length !== 1
    || relatedHistory.length !== 1
    || history[0].projectId !== project.id
    || history[0].listingId !== listing.id
    || history[0].status !== WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT
    || clean(history[0].error)
  ) throw legacyError("LEGACY_RECONCILIATION_TRANSFER_HISTORY_INVALID", "Der Katalog enthält keinen eindeutigen erfolgreichen historischen Transferbeleg.");
  const historicalTransferAt = iso(
    listing.transferredAt || jobs[0].transferredAt || jobs[0].updatedAt || history[0].updatedAt,
    "LEGACY_RECONCILIATION_TRANSFER_TIME_MISSING",
    "Der historische FTPS-Transferzeitpunkt",
  );
  return {
    status: "eligible",
    now,
    verification,
    contract,
    project,
    listing,
    source,
    group,
    listingControl: listingControlValue,
    sourceControl,
    uploadJob: jobs[0],
    uploadHistory: history[0],
    uploadJobId: expectedJobId,
    historicalTransferAt,
  };
}

function updateProject(state, project) {
  return { ...state, projects: state.projects.map((candidate) => candidate.id === project.id ? project : candidate) };
}

function legacyEvidence(eligibility) {
  const evidenceId = `legacy-import-reconciliation-${sha256([
    eligibility.project.id,
    eligibility.source.id,
    eligibility.listing.id,
    eligibility.listing.externalId,
    eligibility.verification.verifiedAt,
  ].join("\n")).slice(0, 32)}`;
  return {
    evidenceId,
    format: 1,
    evidenceType: LEGACY_CONFIRMATION_SOURCE,
    confirmationSource: LEGACY_CONFIRMATION_SOURCE,
    verificationMethod: LEGACY_VERIFICATION_METHOD,
    externalObjectNumber: eligibility.listing.externalId,
    providerRecordExternalObjectNumber: eligibility.listing.externalId,
    providerPresenceConfirmed: true,
    verifiedAt: eligibility.verification.verifiedAt,
    verifiedBy: LEGACY_VERIFIED_BY,
    readOnly: true,
    originalImportReportAvailable: false,
    reason: eligibility.verification.reason,
    projectId: eligibility.project.id,
    sourceListingId: eligibility.source.id,
    sourceExternalObjectNumber: eligibility.source.externalId,
    matchedListingId: eligibility.listing.id,
    matchedUploadJobId: eligibility.uploadJobId,
    historicalTransferAt: eligibility.historicalTransferAt,
    timestampSource: LEGACY_TIMESTAMP_SOURCE,
    reconciledAt: eligibility.now,
  };
}

export function reconcileLegacyImportInState(state, uploadLedger, verificationInput, options = {}) {
  const eligibility = resolveLegacyReconciliationEligibility(state, uploadLedger, verificationInput, options);
  if (eligibility.status === "idempotent" || eligibility.status === "normal_confirmation_exists") {
    return { state, result: eligibility };
  }
  const evidence = legacyEvidence(eligibility);
  const publishedCopy = {
    ...eligibility.listing,
    status: WORKFLOW_STATUS.PUBLISHED,
    statusMessage: `Legacy-Providerbestand bestätigt · ${eligibility.listing.externalId}`,
    lastUploadedAt: eligibility.historicalTransferAt,
    legacyProviderVerifiedAt: eligibility.verification.verifiedAt,
    legacyReconciliationId: evidence.evidenceId,
    confirmationSource: LEGACY_CONFIRMATION_SOURCE,
    timestampSource: LEGACY_TIMESTAMP_SOURCE,
    originalImportReportAvailable: false,
    uploadError: "",
  };
  const replacedSource = {
    ...eligibility.source,
    status: WORKFLOW_STATUS.PUBLISHED,
    statusMessage: `Ersetzt · Legacy-Replacement ${publishedCopy.externalId} bestätigt · externe Löschung ausstehend`,
    supersededByListingId: publishedCopy.id,
    replacementConfirmedAt: eligibility.verification.verifiedAt,
    externalDeletionPending: true,
    legacyReconciliationId: evidence.evidenceId,
    legacyDeleteState: "authorized",
    legacyDeleteAuthorizedAt: eligibility.now,
  };

  let group = normalizeListingGroup(eligibility.group, eligibility.project.id, { now: eligibility.now });
  group = updateListingControl(group, replacedSource, {
    automaticUpdateEnabled: false,
    automaticDeletionEnabled: false,
    status: WORKFLOW_STATUS.PUBLISHED,
    statusMessage: replacedSource.statusMessage,
    schedulerSelectionId: "",
    schedulerSelectedAt: "",
    pendingRotationListingId: "",
    pendingRotationJobId: "",
    processLease: null,
    lastError: "",
  }, { now: eligibility.now });
  group = updateListingControl(group, publishedCopy, {
    automaticUpdateEnabled: true,
    automaticDeletionEnabled: false,
    updateMode: eligibility.sourceControl.updateMode,
    status: WORKFLOW_STATUS.PUBLISHED,
    statusMessage: publishedCopy.statusMessage,
    lastAttemptAt: eligibility.historicalTransferAt,
    lastSuccessAt: eligibility.historicalTransferAt,
    lastUpdatedAt: eligibility.historicalTransferAt,
    nextUpdatedAt: "",
    schedulerSelectionId: "",
    schedulerSelectedAt: "",
    pendingRotationListingId: "",
    pendingRotationJobId: "",
    processLease: null,
    lastError: "",
  }, { now: eligibility.now });
  group = {
    ...group,
    variants: group.variants.map((variant) => variant.listing?.id === publishedCopy.id
      ? { ...variant, listing: publishedCopy, updatedAt: eligibility.now }
      : variant),
  };
  const scheduler = normalizeListingScheduler(state.scheduler, { now: eligibility.now });
  const nextUpdateAt = listingDueAt(group, publishedCopy, scheduler.settings);
  publishedCopy.nextUpdateAt = nextUpdateAt;
  group = updateListingControl(group, publishedCopy, { nextUpdatedAt: nextUpdateAt }, { now: eligibility.now });
  group = {
    ...group,
    logs: [...group.logs, {
      id: evidence.evidenceId,
      timestamp: eligibility.now,
      projectId: eligibility.project.id,
      oldExternalId: replacedSource.externalId,
      newExternalId: publishedCopy.externalId,
      oldVariantId: replacedSource.listingGroupVariantId || "",
      oldVariantName: replacedSource.templateName || "",
      newVariantId: publishedCopy.listingGroupVariantId || "",
      newVariantName: publishedCopy.templateName || "",
      mode: "legacy-provider-presence-reconciliation",
      deletionAllowed: false,
      premiumLockActive: false,
      checkResult: "Aktueller read-only Providerbestand der exakt allowlist-berechtigten historischen Objektnummer bestätigt.",
      variation: "Scheduler-Verantwortung übertragen; normaler Importbericht-Vertrag bleibt unverändert.",
      error: "",
      processStatus: WORKFLOW_STATUS.PUBLISHED,
      message: `Legacy-Reconciliation bestätigt · ${publishedCopy.externalId}`,
    }].slice(-MAX_LISTING_GROUP_LOGS),
    rotationCounter: Math.max(0, Number(group.rotationCounter) || 0) + 1,
    lastStatus: WORKFLOW_STATUS.PUBLISHED,
    lastStatusMessage: `Legacy-Reconciliation bestätigt · ${publishedCopy.externalId}`,
    lastError: "",
    updatedAt: eligibility.now,
  };
  const project = {
    ...eligibility.project,
    listings: eligibility.project.listings.map((listing) => {
      if (listing.id === publishedCopy.id) return publishedCopy;
      if (listing.id === replacedSource.id) return replacedSource;
      return listing;
    }),
    listingGroup: group,
  };
  const nextState = updateProject({
    ...state,
    legacyImportReconciliations: [...(state.legacyImportReconciliations || []), evidence].slice(-20),
  }, project);
  return {
    state: nextState,
    result: {
      status: "reconciled",
      evidence,
      matchedListingId: publishedCopy.id,
      sourceListingId: replacedSource.id,
      matchedUploadJobId: eligibility.uploadJobId,
      lastUploadedAt: eligibility.historicalTransferAt,
      timestampSource: LEGACY_TIMESTAMP_SOURCE,
      nextUpdateAt,
    },
  };
}

export function legacyDeleteIdentity(source, replacement) {
  const contract = authorizedCase(replacement?.externalId);
  if (
    source?.externalId !== contract.sourceExternalObjectNumber
    || source?.id === replacement?.id
    || source?.supersededByListingId !== replacement?.id
    || !source?.legacyReconciliationId
    || source.legacyReconciliationId !== replacement?.legacyReconciliationId
  ) throw legacyError("DELETE_REPLACEMENT_GUARD_VIOLATION", "Source und Replacement erfüllen den Legacy-Delete-Zielguard nicht.");
  const schedulerRunId = `legacy-reconciliation:${source.legacyReconciliationId}`;
  const canonical = [
    "contract=legacy-import-reconciliation-delete-v1",
    `legacyReconciliationId=${source.legacyReconciliationId}`,
    `sourceListingId=${source.id}`,
    `sourceExternalId=${source.externalId}`,
    `replacementListingId=${replacement.id}`,
    `replacementExternalId=${replacement.externalId}`,
    `replacementVerifiedAt=${replacement.legacyProviderVerifiedAt || ""}`,
  ].join("\n");
  const idempotencyKey = sha256(canonical);
  return { deleteJobId: `${LEGACY_DELETE_JOB_PREFIX}${idempotencyKey}`, idempotencyKey, schedulerRunId, canonical };
}

export function resolveLegacyDeleteEligibility(state, replacementExternalObjectNumber, ledger = { jobs: [] }, options = {}) {
  const contract = authorizedCase(replacementExternalObjectNumber);
  const matches = matchingListings(state, contract.replacementExternalObjectNumber);
  if (matches.length !== 1) throw legacyError("LEGACY_DELETE_RELATION_NOT_UNIQUE", "Das Legacy-Replacement ist nicht exakt einmal vorhanden.");
  const { project, listing: replacement } = matches[0];
  const source = (project.listings || []).find((listing) => listing.id === replacement.rotationSourceListingId);
  const evidence = reconciliationEvidence(state, replacement.externalId);
  const group = normalizeListingGroup(project.listingGroup, project.id);
  const sourceControl = source ? listingControl(group, source) : null;
  const replacementControl = listingControl(group, replacement);
  const reasons = [];
  if (
    project.id !== contract.projectId
    || replacement.id !== contract.replacementListingId
    || !source
    || source.id !== contract.sourceListingId
    || source.externalId !== contract.sourceExternalObjectNumber
    || source.id === replacement.id
    || source.supersededByListingId !== replacement.id
  ) reasons.push("source_replacement_mismatch");
  if (evidence.length !== 1 || evidence[0].evidenceId !== replacement.legacyReconciliationId || evidence[0].sourceListingId !== source?.id) reasons.push("legacy_evidence_missing");
  if (replacement.status !== WORKFLOW_STATUS.PUBLISHED || replacementControl.status !== WORKFLOW_STATUS.PUBLISHED || replacement.confirmationSource !== LEGACY_CONFIRMATION_SOURCE) reasons.push("replacement_not_legacy_published");
  if (replacement.importReportId || replacement.importConfirmedAt) reasons.push("legacy_provenance_conflict");
  const operation = clean(options.operation || "inspect", 30);
  const sourcePhaseAllowed = operation === "transfer"
    ? ["authorized", "pending_confirmation", "confirmed"].includes(source?.legacyDeleteState)
    : operation === "confirm"
      ? ["pending_confirmation", "confirmed"].includes(source?.legacyDeleteState)
      : ["authorized", "pending_confirmation", "confirmed", "transfer_uncertain"].includes(source?.legacyDeleteState);
  const sourceStatusAllowed = source?.legacyDeleteState === "confirmed"
    ? source?.status === WORKFLOW_STATUS.DELETED && source.externalDeletionPending === false
    : source?.status === WORKFLOW_STATUS.PUBLISHED && source?.externalDeletionPending === true;
  if (!sourceStatusAllowed || !sourcePhaseAllowed) reasons.push("source_delete_phase_invalid");
  if (sourceControl?.automaticUpdateEnabled) reasons.push("source_still_scheduler_owner");
  if (!replacementControl.automaticUpdateEnabled) reasons.push("replacement_not_scheduler_owner");
  if (hasActiveClaim(sourceControl) || hasActiveClaim(replacementControl)) reasons.push("concurrent_claim");
  if (clean(state.provider?.providerNumber) !== "30460") reasons.push("provider_id_mismatch");
  const house = (state.houses || []).find((entry) => entry.id === source?.templateId);
  if (!house || !clean(project.zip) || !clean(project.city) || !clean(state.provider?.company) || !clean(state.provider?.email)) reasons.push("delete_payload_source_incomplete");
  const jobs = (ledger.jobs || []).filter((job) => job.sourceListingId === source?.id || job.externalObjectNumber === source?.externalId);
  if (jobs.length > 1) reasons.push("multiple_delete_jobs");
  if (jobs[0] && !clean(jobs[0].deleteJobId).startsWith(LEGACY_DELETE_JOB_PREFIX)) reasons.push("foreign_delete_job");
  if (reasons.length) throw legacyError("LEGACY_DELETE_NOT_ELIGIBLE", `Die historische Quelle ist nicht löschberechtigt: ${reasons.join(", ")}.`, { reasons });
  const eligibility = { project, source, sourceControl, replacement, replacementControl, evidence: evidence[0], group, house, existingJob: jobs[0] || null };
  const identity = legacyDeleteIdentity(source, replacement);
  if (eligibility.existingJob && eligibility.existingJob.deleteJobId !== identity.deleteJobId) {
    throw legacyError("LEGACY_DELETE_JOB_IDENTITY_CONFLICT", "Der persistente Legacy-Deletejob besitzt nicht die erwartete deterministische Identität.");
  }
  return eligibility;
}

function updateLegacySource(state, projectId, sourceListingId, update, controlPatch, now) {
  const project = state.projects.find((candidate) => candidate.id === projectId);
  const source = project?.listings.find((listing) => listing.id === sourceListingId);
  if (!project || !source) throw legacyError("LEGACY_DELETE_CATALOG_MISMATCH", "Die historische Quelle fehlt im Katalog.");
  const replacement = project.listings.find((listing) => listing.id === source.supersededByListingId);
  if (!replacement) throw legacyError("LEGACY_DELETE_CATALOG_MISMATCH", "Das bestätigte Legacy-Replacement fehlt im Katalog.");
  const updatedSource = { ...source, ...update };
  let group = normalizeListingGroup(project.listingGroup, project.id, { now });
  group = updateListingControl(group, updatedSource, controlPatch, { now });
  const nextProject = { ...project, listings: project.listings.map((listing) => listing.id === source.id ? updatedSource : listing), listingGroup: group };
  return { ...state, projects: state.projects.map((candidate) => candidate.id === project.id ? nextProject : candidate) };
}

export function markLegacyDeleteTransferredInState(state, eligibility, job, options = {}) {
  const now = clean(options.now || new Date().toISOString(), 50);
  const currentProject = state.projects.find((candidate) => candidate.id === eligibility.project.id);
  const source = currentProject?.listings.find((listing) => listing.id === eligibility.source.id);
  const replacement = currentProject?.listings.find((listing) => listing.id === eligibility.replacement.id);
  if (
    !source || !replacement
    || source.legacyDeleteState !== "authorized"
    || source.supersededByListingId !== replacement.id
    || source.externalId !== job.externalObjectNumber
    || replacement.externalId !== job.replacementExternalObjectNumber
  ) throw legacyError("LEGACY_DELETE_CATALOG_CHANGED_AFTER_TRANSFER", "Der Katalog hat sich während des Legacy-Delete-Transfers geändert.");
  return updateLegacySource(state, currentProject.id, source.id, {
    legacyDeleteState: "pending_confirmation",
    legacyDeleteJobId: job.deleteJobId,
    legacyDeleteTransferredAt: job.transferCompletedAt || now,
    statusMessage: `Legacy-DELETE übertragen · Bericht für ${source.externalId} ausstehend`,
  }, {
    automaticUpdateEnabled: false,
    automaticDeletionEnabled: false,
    status: WORKFLOW_STATUS.PUBLISHED,
    statusMessage: `Legacy-DELETE übertragen · Bericht für ${source.externalId} ausstehend`,
  }, now);
}

export function finalizeLegacyDeleteInState(state, job, report, options = {}) {
  const now = clean(options.now || new Date().toISOString(), 50);
  const contract = authorizedCase(job.replacementExternalObjectNumber);
  const project = state.projects.find((candidate) => candidate.id === job.projectId);
  const source = project?.listings.find((listing) => listing.id === job.sourceListingId);
  const replacement = project?.listings.find((listing) => listing.id === job.replacementListingId);
  if (
    !project || !source || !replacement
    || source.externalId !== contract.sourceExternalObjectNumber
    || replacement.externalId !== contract.replacementExternalObjectNumber
    || source.supersededByListingId !== replacement.id
    || source.id === replacement.id
  ) throw legacyError("DELETE_REPLACEMENT_GUARD_VIOLATION", "Der finale Legacy-Delete-Zielguard ist verletzt.");
  if (job.status !== PRODUCTION_DELETE_STATUS.CONFIRMED || report.externalObjectNumber !== source.externalId || report.deleteResult !== "success") {
    throw legacyError("LEGACY_DELETE_CONFIRMATION_MISMATCH", "Ohne positiven exakten Löschbericht darf die historische Quelle nicht finalisiert werden.");
  }
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
    legacyDeleteState: "confirmed",
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
  if (JSON.stringify(nextProject.listings.find((listing) => listing.id === replacement.id)) !== replacementSnapshot) {
    throw legacyError("LEGACY_DELETE_REPLACEMENT_MUTATED", "Die Delete-Finalisierung hat das Legacy-Replacement unerwartet verändert.");
  }
  const deleteReport = {
    reportId: `delete-report-${clean(report.rawHash, 128).slice(0, 32)}`,
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
    confirmationSource: LEGACY_CONFIRMATION_SOURCE,
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

export function createLegacyDeleteService(options) {
  if (!options?.store?.load || !options?.store?.update) throw new Error("Dem Legacy-Deletedienst fehlt der persistente Katalogspeicher.");
  if (!options?.ledger?.read || typeof options.upload !== "function") throw new Error("Dem Legacy-Deletedienst fehlen Ledger oder FTPS-Transferadapter.");
  if (!options?.mailAdapter?.findCandidates || !options?.mailAdapter?.readRawMessage || options.mailAdapter.readOnly !== true) throw new Error("Dem Legacy-Deletedienst fehlt der read-only Löschberichtadapter.");
  const now = options.now || (() => new Date().toISOString());
  const writeLog = options.writeLog || (async () => undefined);
  const assertSafeModes = options.assertSafeModes || (async () => undefined);

  async function transfer(replacementExternalObjectNumber) {
    await assertSafeModes();
    authorizedCase(replacementExternalObjectNumber);
    const snapshot = await options.store.load();
    const ledgerSnapshot = await options.ledger.read();
    const eligibility = resolveLegacyDeleteEligibility(snapshot.state, replacementExternalObjectNumber, ledgerSnapshot, { operation: "transfer" });
    const identity = legacyDeleteIdentity(eligibility.source, eligibility.replacement);
    if (eligibility.existingJob && eligibility.existingJob.status !== PRODUCTION_DELETE_STATUS.PREPARED) {
      if ([PRODUCTION_DELETE_STATUS.PENDING_CONFIRMATION, PRODUCTION_DELETE_STATUS.CONFIRMED].includes(eligibility.existingJob.status)) {
        return { status: eligibility.existingJob.status, transferred: false, idempotent: true, job: eligibility.existingJob, payloadSha256: eligibility.existingJob.payloadSha256, payloadSize: eligibility.existingJob.payloadSize };
      }
      throw legacyError("LEGACY_DELETE_ALREADY_ATTEMPTED", "Der Legacy-Deletejob wurde bereits beansprucht oder besitzt einen unklaren Transferzustand; ein Retry ist gesperrt.");
    }
    const payload = await buildProductionDeletePayload(snapshot.state, eligibility, { preparedAt: eligibility.existingJob?.preparedAt });
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
    if (job.status !== PRODUCTION_DELETE_STATUS.PREPARED) {
      return { status: job.status, transferred: false, job, payloadSha256: job.payloadSha256, payloadSize: job.payloadSize };
    }
    if (job.payloadFilename !== payload.payloadFilename || job.payloadSha256 !== payload.payloadSha256 || job.payloadSize !== payload.payloadSize) {
      throw legacyError("LEGACY_DELETE_PAYLOAD_MISMATCH", "Der erneut erzeugte Legacy-Delete-Payload stimmt nicht bytegenau mit dem persistenten Job überein.");
    }
    const claimed = await options.ledger.claim(job.deleteJobId, now());
    await writeLog("transfer-started", { deleteJobId: job.deleteJobId, externalObjectNumber: eligibility.source.externalId, replacementExternalObjectNumber: eligibility.replacement.externalId, payloadFilename: payload.payloadFilename, payloadSha256: payload.payloadSha256, payloadSize: payload.payloadSize });
    try {
      await assertSafeModes();
      await options.upload({ archive: payload.archive, filename: payload.payloadFilename, job, eligibility });
      const transferredJob = await options.ledger.transferred(job.deleteJobId, claimed.claimToken, now());
      await options.store.update((state) => ({ state: markLegacyDeleteTransferredInState(state, eligibility, transferredJob, { now: now() }) }), { now: now() });
      await writeLog("transferred", { deleteJobId: transferredJob.deleteJobId, externalObjectNumber: transferredJob.externalObjectNumber, replacementExternalObjectNumber: transferredJob.replacementExternalObjectNumber, payloadFilename: payload.payloadFilename, payloadSha256: payload.payloadSha256, payloadSize: payload.payloadSize, status: transferredJob.status });
      return { status: transferredJob.status, transferred: true, job: transferredJob, payloadSha256: payload.payloadSha256, payloadSize: payload.payloadSize };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Legacy-Delete-Transfer fehlgeschlagen.";
      const uncertain = await options.ledger.uncertain(job.deleteJobId, claimed.claimToken, message, now()).catch(() => null);
      if (uncertain) {
        await options.store.update((state) => ({ state: updateLegacySource(state, eligibility.project.id, eligibility.source.id, {
          legacyDeleteState: "transfer_uncertain",
          legacyDeleteJobId: job.deleteJobId,
          legacyDeleteError: clean(message),
        }, {
          automaticUpdateEnabled: false,
          automaticDeletionEnabled: false,
          status: WORKFLOW_STATUS.PUBLISHED,
          statusMessage: `Legacy-DELETE unklar · ${eligibility.source.externalId}`,
        }, now()) }), { now: now() }).catch(() => undefined);
      }
      await writeLog("failed", { deleteJobId: job.deleteJobId, externalObjectNumber: eligibility.source.externalId, errorCode: clean(error?.code, 120), message: clean(message) });
      throw error;
    }
  }

  async function confirm(replacementExternalObjectNumber) {
    await assertSafeModes();
    const snapshot = await options.store.load();
    const ledgerSnapshot = await options.ledger.read();
    const eligibility = resolveLegacyDeleteEligibility(snapshot.state, replacementExternalObjectNumber, ledgerSnapshot, { operation: "confirm" });
    const identity = legacyDeleteIdentity(eligibility.source, eligibility.replacement);
    const job = ledgerSnapshot.jobs.find((candidate) => candidate.deleteJobId === identity.deleteJobId);
    if (!job) return { status: "not_transferred", confirmed: false, candidateCount: 0, mailMutations: 0 };
    if (job.status === PRODUCTION_DELETE_STATUS.CONFIRMED) {
      const report = { externalObjectNumber: job.externalObjectNumber, deleteResult: "success", messageId: job.reportMessageId, rawHash: job.reportHash, providerProcessedAt: job.providerProcessedAt };
      const persisted = await options.store.update((state) => ({ state: finalizeLegacyDeleteInState(state, job, report, { now: now() }).state }), { now: now() });
      return { status: "confirmed", confirmed: true, idempotent: persisted.changed === false, job, candidateCount: 0, mailMutations: 0 };
    }
    if (job.status !== PRODUCTION_DELETE_STATUS.PENDING_CONFIRMATION) {
      throw legacyError("LEGACY_DELETE_CONFIRMATION_STATUS_INVALID", "Nur ein eindeutig übertragener Legacy-Delete darf bestätigt werden.");
    }
    const transferredAt = Date.parse(job.transferCompletedAt || now());
    const lookbackHours = Math.max(2, Math.min(720, Math.ceil((Date.now() - transferredAt) / 3600000) + 24));
    const candidates = await options.mailAdapter.findCandidates({ lookbackHours });
    for (const candidate of candidates) {
      const mail = await options.mailAdapter.readRawMessage(candidate);
      let report;
      try {
        report = (options.parseReport || parseImmoprofessionalDeleteReport)(mail.rawSource, { expectedTarget: job.externalObjectNumber });
      } catch {
        // Nicht passende Berichte sind keine Evidenz und werden unverändert übergangen.
        continue;
      }
      const confirmedJob = await options.ledger.confirm(job.deleteJobId, report, now());
      await options.store.update((state) => ({ state: finalizeLegacyDeleteInState(state, confirmedJob, report, { now: now() }).state }), { now: now() });
      await writeLog("confirmed", { deleteJobId: job.deleteJobId, externalObjectNumber: job.externalObjectNumber, replacementExternalObjectNumber: job.replacementExternalObjectNumber, reportMessageId: report.messageId, reportHash: report.rawHash, mailboxName: candidate.mailboxName, mailMutations: 0, status: confirmedJob.status });
      return { status: "confirmed", confirmed: true, job: confirmedJob, candidateCount: candidates.length, mailMutations: 0 };
    }
    return { status: "pending_confirmation", confirmed: false, job, candidateCount: candidates.length, mailMutations: 0 };
  }

  return { transfer, confirm };
}
