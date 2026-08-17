import { createUploadJobId } from "./batch-upload.mjs";
import { recordHouseRotation } from "./house-distribution.mjs";
import {
  listingControl,
  normalizeListingGroup,
  updateListingControl,
} from "./listing-groups.mjs";
import { normalizeListingScheduler, listingDueAt } from "./listing-scheduler.mjs";
import { MAX_LISTING_GROUP_LOGS } from "./listing-rules.mjs";
import { recordPromotionUsage } from "./promotion-images.mjs";
import { normalizeWorkflowStatus, WORKFLOW_STATUS } from "./workflow-status.mjs";

export const IMPORT_REPORT_PROCESSING_STATUS = Object.freeze({
  CONFIRMED: "confirmed",
  REVIEW_REQUIRED: "review_required",
  // Read compatibility only. New reports never enter these historical states.
  CONFIRMED_MOVE_PENDING: "confirmed_mail_move_pending",
  CONFIRMED_MOVED: "confirmed_mail_moved",
  MOVE_REQUESTED: "mail_move_requested",
  MOVE_AMBIGUOUS: "mail_move_ambiguous",
  MOVE_UNRESOLVED: "mail_move_unresolved",
  MAIL_MOVE_MANUAL_REVIEW_REQUIRED: "mail_move_manual_review_required",
});

function text(value) {
  return String(value ?? "").trim();
}

function reportIdFor(parsed) {
  return `import-report-${text(parsed.rawHash).slice(0, 32)}`;
}

function updateProject(state, project) {
  return {
    ...state,
    projects: state.projects.map((candidate) => candidate.id === project.id ? project : candidate),
  };
}

function pendingCandidates(state, externalObjectNumber) {
  return (state.projects || []).flatMap((project) => {
    const group = normalizeListingGroup(project.listingGroup, project.id);
    return (project.listings || []).flatMap((listing) => {
      const control = listingControl(group, listing);
      const listingStatus = normalizeWorkflowStatus(listing.status, WORKFLOW_STATUS.DRAFT);
      if (
        listing.externalId !== externalObjectNumber
        || listing.listingOrigin !== "rotation-copy"
        || listingStatus !== WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT
        || control.status !== WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT
      ) return [];
      const source = project.listings.find((candidate) => candidate.id === listing.rotationSourceListingId);
      return source ? [{ project, group, listing, control, source, sourceControl: listingControl(group, source) }] : [];
    });
  });
}

export function matchPendingImportReport(state, parsed, uploadLedger) {
  if (!text(parsed?.externalObjectNumber)) return { status: "unmatched", reason: "Die externe Objektnummer fehlt." };
  const candidates = pendingCandidates(state, parsed.externalObjectNumber);
  if (candidates.length === 0) return { status: "unmatched", reason: "Keine offene Rotationskopie besitzt diese externe Objektnummer." };
  if (candidates.length > 1) return { status: "ambiguous", reason: "Mehrere offene Rotationskopien besitzen dieselbe externe Objektnummer." };
  const candidate = candidates[0];
  const expectedJobId = createUploadJobId(candidate.project, candidate.listing);
  const pendingJobId = text(candidate.sourceControl.pendingRotationJobId);
  if (!pendingJobId || pendingJobId !== expectedJobId) {
    return { status: "unmatched", reason: "Der persistente Uploadauftrag der Quelle stimmt nicht mit der Rotationskopie überein." };
  }
  if (candidate.sourceControl.pendingRotationListingId !== candidate.listing.id) {
    return { status: "unmatched", reason: "Die Quelle verweist nicht eindeutig auf diese offene Rotationskopie." };
  }
  const matchingJobs = (uploadLedger?.jobs || []).filter((job) => job.jobId === expectedJobId);
  if (
    matchingJobs.length !== 1
    || matchingJobs[0].status !== WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT
    || matchingJobs[0].projectId !== candidate.project.id
    || matchingJobs[0].listingId !== candidate.listing.id
  ) {
    return { status: "unmatched", reason: "Das persistente Uploadledger bestätigt keinen eindeutigen abgeschlossenen FTPS-Auftrag." };
  }
  const matchingHistory = (state.uploadHistory || []).filter((entry) => entry.jobId === expectedJobId);
  if (!matchingHistory.length || matchingHistory.some((entry) => entry.listingId !== candidate.listing.id || entry.projectId !== candidate.project.id)) {
    return { status: "unmatched", reason: "Der Katalog enthält keinen eindeutig zugehörigen FTPS-Übertragungsbeleg." };
  }
  return { status: "matched", ...candidate, uploadJobId: expectedJobId };
}

function confirmationReport(parsed, mail, match, processedAt) {
  return {
    reportId: reportIdFor(parsed),
    messageId: text(parsed.messageId),
    rawHash: text(parsed.rawHash),
    receivedAt: text(mail.receivedAt),
    processedAt,
    providerImportAt: parsed.providerImportAt,
    subject: parsed.subject,
    channel: "email",
    senderSoftware: parsed.senderSoftware,
    objectCount: parsed.objectCount,
    providerId: parsed.providerId,
    providerCompany: parsed.providerCompany,
    providerEmail: parsed.providerEmail,
    externalObjectNumber: parsed.externalObjectNumber,
    importResult: parsed.importResult,
    matchedListingId: match.listing.id,
    matchedUploadJobId: match.uploadJobId,
    sourceListingId: match.source.id,
    projectId: match.project.id,
    parserVersion: parsed.parserVersion,
    processingStatus: IMPORT_REPORT_PROCESSING_STATUS.CONFIRMED,
    confirmationSource: "import_report",
    mailAccount: text(mail.accountName),
    mailAccountId: text(mail.accountId),
    mailTransportId: text(mail.transportId),
    mailSourceFolder: text(mail.mailboxName),
  };
}

function findExistingReport(state, parsed) {
  const byMessage = (state.importReports || []).find((report) => report.messageId === parsed.messageId);
  const byHash = (state.importReports || []).find((report) => report.rawHash === parsed.rawHash);
  if (byMessage && byMessage.rawHash !== parsed.rawHash) {
    return { conflict: true, reason: "Die bekannte Message-ID ist mit einem abweichenden Mailinhalt aufgetaucht." };
  }
  return { report: byMessage || byHash || null };
}

function addConfirmationLog(group, report, source, copy, timestamp) {
  const log = {
    id: report.reportId,
    timestamp,
    projectId: group.projectId,
    oldExternalId: source.externalId,
    newExternalId: copy.externalId,
    oldVariantId: source.listingGroupVariantId || "",
    oldVariantName: source.templateName || "",
    newVariantId: copy.listingGroupVariantId || "",
    newVariantName: copy.templateName || "",
    mode: "import-report-confirmation",
    deletionAllowed: false,
    premiumLockActive: false,
    checkResult: "Immoprofessional-Einzelimport durch validierten Mailbericht bestätigt.",
    variation: "Scheduler-Verantwortung auf die bestätigte Rotationskopie übertragen; keine externe Löschung ausgeführt.",
    error: "",
    processStatus: WORKFLOW_STATUS.PUBLISHED,
    message: `Import bestätigt · ${copy.externalId}`,
  };
  return {
    ...group,
    logs: [...group.logs.filter((item) => item.id !== log.id), log].slice(-MAX_LISTING_GROUP_LOGS),
    rotationCounter: Math.max(0, Number(group.rotationCounter) || 0) + 1,
    lastStatus: WORKFLOW_STATUS.PUBLISHED,
    lastStatusMessage: log.message,
    lastError: "",
    updatedAt: timestamp,
  };
}

export function confirmImportReportInState(state, parsed, mail, uploadLedger, options = {}) {
  const processedAt = text(options.now || new Date().toISOString());
  const existing = findExistingReport(state, parsed);
  if (existing.conflict) return { state, result: { status: "rejected", reason: existing.reason } };
  if (existing.report) {
    return { state, result: { status: "idempotent", report: existing.report, matchedListingId: existing.report.matchedListingId } };
  }
  if (text(state.provider?.providerNumber) !== parsed.providerId) {
    return { state, result: { status: "rejected", reason: "Die Anbieter-ID des Katalogs stimmt nicht mit dem Bericht überein." } };
  }
  const match = matchPendingImportReport(state, parsed, uploadLedger);
  if (match.status !== "matched") return { state, result: match };

  const report = confirmationReport(parsed, mail, match, processedAt);
  const importedAt = parsed.providerImportAt;
  const productionLifecycle = match.listing.productionLifecycle;
  const automaticDeleteAuthorized = productionLifecycle?.format === 1
    && productionLifecycle.automaticDeleteAuthorized === true
    && productionLifecycle.sourceListingId === match.source.id
    && Boolean(productionLifecycle.schedulerRunId);
  const publishedCopy = {
    ...match.listing,
    status: WORKFLOW_STATUS.PUBLISHED,
    statusMessage: `Import bestätigt · ${match.listing.externalId}`,
    lastUploadedAt: importedAt,
    importConfirmedAt: importedAt,
    importReportId: report.reportId,
    confirmationSource: "import_report",
    uploadError: "",
    ...(automaticDeleteAuthorized ? {
      productionLifecycle: {
        ...productionLifecycle,
        importConfirmedAt: importedAt,
        importReportId: report.reportId,
      },
    } : {}),
  };
  const replacedSource = {
    ...match.source,
    status: WORKFLOW_STATUS.PUBLISHED,
    statusMessage: `Ersetzt · neues Objekt ${match.listing.externalId} · externe Löschung ausstehend`,
    supersededByListingId: match.listing.id,
    replacementConfirmedAt: importedAt,
    externalDeletionPending: true,
    ...(automaticDeleteAuthorized ? {
      productionDeleteState: "authorized",
      productionDeleteAuthorizedAt: processedAt,
      productionRotationRunId: productionLifecycle.schedulerRunId,
    } : {}),
  };

  let group = normalizeListingGroup(match.group, match.project.id, { now: processedAt });
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
  }, { now: processedAt });
  group = updateListingControl(group, publishedCopy, {
    automaticUpdateEnabled: true,
    automaticDeletionEnabled: false,
    updateMode: match.sourceControl.updateMode,
    status: WORKFLOW_STATUS.PUBLISHED,
    statusMessage: publishedCopy.statusMessage,
    lastAttemptAt: importedAt,
    lastSuccessAt: importedAt,
    lastUpdatedAt: importedAt,
    nextUpdatedAt: "",
    schedulerSelectionId: "",
    schedulerSelectedAt: "",
    pendingRotationListingId: "",
    pendingRotationJobId: "",
    processLease: null,
    lastError: "",
  }, { now: processedAt });
  const scheduler = normalizeListingScheduler(state.scheduler, { now: processedAt });
  const nextUpdateAt = listingDueAt(group, publishedCopy, scheduler.settings);
  publishedCopy.nextUpdateAt = nextUpdateAt;
  group = updateListingControl(group, publishedCopy, { nextUpdatedAt: nextUpdateAt }, { now: processedAt });
  group = {
    ...group,
    variants: group.variants.map((variant) => variant.listing?.id === publishedCopy.id
      ? { ...variant, listing: publishedCopy, updatedAt: processedAt }
      : variant),
  };
  group = addConfirmationLog(group, report, replacedSource, publishedCopy, processedAt);

  const project = {
    ...match.project,
    listings: match.project.listings.map((listing) => {
      if (listing.id === publishedCopy.id) return publishedCopy;
      if (listing.id === replacedSource.id) return replacedSource;
      return listing;
    }),
    listingGroup: group,
  };
  let nextState = updateProject({
    ...state,
    importReports: [...(state.importReports || []), report].slice(-1000),
    mailImportReportStatus: {
      status: "confirmed",
      message: `Import bestätigt · ${publishedCopy.externalId} · Immoprofessional erfolgreich importiert.`,
      updatedAt: processedAt,
      externalObjectNumber: publishedCopy.externalId,
      reportId: report.reportId,
    },
  }, project);
  if (publishedCopy.rotationRemovedHouseId && publishedCopy.rotationAddedHouseId) {
    nextState = {
      ...nextState,
      houseDistribution: recordHouseRotation(
        nextState.houseDistribution,
        nextState.houses || [],
        nextState.projects || [],
        project.id,
        publishedCopy.rotationRemovedHouseId,
        publishedCopy.rotationAddedHouseId,
        { now: importedAt },
      ),
    };
  }
  if (publishedCopy.promotionImageId) {
    nextState = {
      ...nextState,
      ...recordPromotionUsage(nextState, {
        projectId: project.id,
        listingId: publishedCopy.id,
        externalId: publishedCopy.externalId,
        houseId: publishedCopy.templateId,
        imageId: publishedCopy.promotionImageId,
        mode: "create",
      }, {
        id: `promotion-usage-${report.reportId}`,
        now: importedAt,
      }),
    };
  }
  return {
    state: nextState,
    result: {
      status: "confirmed",
      report,
      matchedListingId: publishedCopy.id,
      sourceListingId: replacedSource.id,
      matchedUploadJobId: match.uploadJobId,
      nextUpdateAt,
    },
  };
}

export function recordImportReportReviewInState(state, input, options = {}) {
  const timestamp = text(options.now || new Date().toISOString());
  const key = text(input.messageId || input.rawHash || input.transportId);
  const review = {
    reviewId: `import-report-review-${key.replace(/[^a-zA-Z0-9_-]/gu, "").slice(0, 48) || "unknown"}`,
    messageId: text(input.messageId),
    rawHash: text(input.rawHash),
    receivedAt: text(input.receivedAt),
    externalObjectNumber: text(input.externalObjectNumber),
    reason: text(input.reason).slice(0, 500),
    processingStatus: IMPORT_REPORT_PROCESSING_STATUS.REVIEW_REQUIRED,
    updatedAt: timestamp,
  };
  return {
    ...state,
    importReportReviews: [
      ...(state.importReportReviews || []).filter((item) => item.reviewId !== review.reviewId),
      review,
    ].slice(-100),
    mailImportReportStatus: {
      status: "review_required",
      message: `Importbericht prüfen: ${review.reason}`,
      updatedAt: timestamp,
      externalObjectNumber: review.externalObjectNumber,
    },
  };
}
