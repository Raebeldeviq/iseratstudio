import { createHash } from "node:crypto";

import {
  confirmImportReportInState,
  recordImportReportReviewInState,
} from "./immoprofessional-import-confirmation.mjs";
import {
  parseImmoprofessionalImportReport,
  parseRfc822Headers,
} from "./immoprofessional-import-report-parser.mjs";
import { normalizeWorkflowStatus, WORKFLOW_STATUS } from "./workflow-status.mjs";

// Five minutes is deliberate: import confirmation is asynchronous and does not
// warrant a high-frequency mailbox poll. The service exits before Apple Mail is
// touched whenever no transferred_pending_import copy exists.
export const DEFAULT_IMPORT_REPORT_POLL_INTERVAL_MS = 5 * 60 * 1000;

function pendingImportListings(state) {
  return (state.projects || []).flatMap((project) => (project.listings || []).filter((listing) =>
    listing.listingOrigin === "rotation-copy"
    && normalizeWorkflowStatus(listing.status, WORKFLOW_STATUS.DRAFT) === WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT));
}

function lookbackHoursFor(listings, now) {
  const timestamps = listings.map((listing) => Date.parse(listing.transferredAt || "")).filter(Number.isFinite);
  const earliest = timestamps.length ? Math.min(...timestamps) : Date.parse(now) - 72 * 3600000;
  return Math.max(24, Math.min(720, Math.ceil((Date.parse(now) - earliest) / 3600000) + 24));
}

function rawMetadata(rawSource) {
  const raw = Buffer.from(String(rawSource || ""), "utf8");
  const headerEnd = raw.toString("utf8").search(/\r?\n\r?\n/u);
  const headers = headerEnd >= 0 ? parseRfc822Headers(raw.toString("utf8", 0, headerEnd)) : new Map();
  const value = (name) => (headers.get(name) || [""])[0];
  const received = new Date(value("date"));
  return {
    rawHash: createHash("sha256").update(raw).digest("hex"),
    messageId: value("message-id").trim(),
    receivedAt: Number.isNaN(received.getTime()) ? "" : received.toISOString(),
  };
}

function safeReason(error) {
  return (error instanceof Error ? error.message : String(error || "Unbekannter Importberichtfehler")).slice(0, 500);
}

function mailFailureStatus(error) {
  const code = String(error?.code || "");
  if (code === "MAIL_IMPORT_REPORT_SETUP_REQUIRED") return { status: "setup_required", setupRequired: true };
  if (code === "MAIL_AUTOMATION_TIMEOUT") return { status: "automation_timeout", setupRequired: false };
  if (code === "MAIL_AUTOMATION_UNAVAILABLE") return { status: "automation_unavailable", setupRequired: false };
  if (code === "MAIL_AUTOMATION_PERMISSION_DENIED") return { status: "automation_permission_denied", setupRequired: false };
  if (code === "MAIL_IMPORT_REPORT_PARSE_ERROR") return { status: "parse_error", setupRequired: false };
  return { status: "access_failed", setupRequired: false };
}

async function storeMailStatus(store, status, message, now) {
  return store.update((state) => ({
    ...state,
    mailImportReportStatus: { status, message: String(message || "").slice(0, 500), updatedAt: now },
  }), { now });
}

export function createImmoprofessionalImportReportService(options) {
  if (!options?.store?.load || !options?.store?.update) throw new Error("Dem Importberichtdienst fehlt der persistente Katalogspeicher.");
  if (!options?.uploadJobLedger?.read) throw new Error("Dem Importberichtdienst fehlt das persistente Uploadledger.");
  if (!options?.mailAdapter?.findCandidates || !options?.mailAdapter?.readRawMessage || options.mailAdapter.readOnly !== true) {
    throw new Error("Dem Importberichtdienst fehlt der read-only Apple-Mail-Adapter.");
  }
  const writeLog = options.writeLog || (async () => undefined);
  const clock = options.clock || (() => Date.now());
  let activeRun = null;

  async function processCandidate(candidate, now, allowedExternalObjectNumbers = null) {
    let mail;
    let metadata = { rawHash: "", messageId: "", receivedAt: "" };
    try {
      mail = await options.mailAdapter.readRawMessage(candidate);
      metadata = rawMetadata(mail.rawSource);
      let parsed;
      try {
        parsed = parseImmoprofessionalImportReport(mail.rawSource, options.parserOptions);
      } catch (error) {
        if (!error.code) error.code = "MAIL_IMPORT_REPORT_PARSE_ERROR";
        throw error;
      }
      if (allowedExternalObjectNumbers instanceof Set && !allowedExternalObjectNumbers.has(parsed.externalObjectNumber)) {
        return { status: "not-canary-authorized", externalObjectNumber: parsed.externalObjectNumber, mailMutations: 0 };
      }
      const ledger = await options.uploadJobLedger.read();
      const persisted = await options.store.update((state) => confirmImportReportInState(
        state,
        parsed,
        { ...mail, receivedAt: metadata.receivedAt },
        ledger,
        { now },
      ), { now });
      const result = persisted.result;
      if (!new Set(["confirmed", "idempotent"]).has(result?.status)) {
        const reason = String(result?.reason || "Der Importbericht konnte nicht eindeutig zugeordnet werden.");
        const errorCode = result?.status === "unmatched" ? "MAIL_IMPORT_REPORT_UNMATCHED" : "";
        await options.store.update((state) => ({
          state: recordImportReportReviewInState(state, {
            ...metadata,
            transportId: candidate.transportId,
            receivedAt: metadata.receivedAt,
            externalObjectNumber: parsed.externalObjectNumber,
            reason,
          }, { now }),
        }), { now });
        await writeLog("review-required", {
          externalObjectNumber: parsed.externalObjectNumber,
          processingStatus: result?.status || "rejected",
          reason,
          errorCode,
          mailboxName: candidate.mailboxName,
          mailMutations: 0,
        });
        return { status: result?.status || "rejected", reason, errorCode, mailMutations: 0 };
      }
      const report = result.report;
      await writeLog(result.status === "confirmed" ? "confirmed" : "deduplicated", {
        reportId: report.reportId,
        externalObjectNumber: parsed.externalObjectNumber,
        mailboxName: candidate.mailboxName,
        mailMutations: 0,
      });
      return {
        status: result.status,
        reportId: report.reportId,
        externalObjectNumber: parsed.externalObjectNumber,
        mailMutations: 0,
      };
    } catch (error) {
      const reason = safeReason(error);
      const errorCode = String(error?.code || "MAIL_IMPORT_REPORT_PARSE_ERROR");
      if (mail) {
        await options.store.update((state) => ({
          state: recordImportReportReviewInState(state, {
            ...metadata,
            transportId: candidate.transportId,
            receivedAt: metadata.receivedAt,
            reason,
          }, { now }),
        }), { now }).catch(() => undefined);
      }
      await writeLog("rejected", {
        processingStatus: "review_required",
        reason,
        errorCode,
        mailboxName: candidate.mailboxName,
        mailMutations: 0,
      });
      return { status: "rejected", reason, errorCode, mailMutations: 0 };
    }
  }

  async function executeRunOnce(input = {}) {
    const now = String(input.now || new Date().toISOString());
    const snapshot = await options.store.load();
    if (!snapshot?.stored || !snapshot.state) return { ran: false, reason: "catalog-not-stored", processed: [], mailMutations: 0 };
    const allowedExternalObjectNumbers = Array.isArray(input.allowedExternalObjectNumbers)
      ? new Set(input.allowedExternalObjectNumbers.map(String).filter(Boolean))
      : null;
    const allPending = pendingImportListings(snapshot.state);
    const pending = allowedExternalObjectNumbers
      ? allPending.filter((listing) => allowedExternalObjectNumbers.has(String(listing.externalId || "")))
      : allPending;
    if (!pending.length) {
      return { ran: false, reason: "no-pending-imports", pendingCount: 0, processed: [], mailMutations: 0 };
    }
    let candidates;
    const scanStartedAt = clock();
    try {
      candidates = await options.mailAdapter.findCandidates({ lookbackHours: lookbackHoursFor(pending, now) });
      await writeLog("scan-completed", {
        pendingCount: pending.length,
        candidateCount: candidates.length,
        durationMs: Math.max(0, clock() - scanStartedAt),
        mailboxName: options.mailAdapter.mailboxName,
        mailMutations: 0,
      });
    } catch (error) {
      const reason = safeReason(error);
      const failure = mailFailureStatus(error);
      const setupRequired = failure.setupRequired;
      const message = setupRequired
        ? "Importbericht-Ordner nicht verfügbar. Livinghaus / 21_Statusmeldungen muss serverseitig eindeutig vorhanden sein."
        : reason;
      await storeMailStatus(options.store, failure.status, message, now).catch(() => undefined);
      await writeLog("scan-failed", {
        pendingCount: pending.length,
        reason,
        errorCode: String(error?.code || ""),
        setupRequired,
        durationMs: Math.max(0, Number(error?.durationMs) || clock() - scanStartedAt),
        timedOut: error?.timedOut === true,
        exitSignal: String(error?.exitSignal || ""),
        mailMutations: 0,
      });
      return { ran: true, reason, errorCode: String(error?.code || ""), pendingCount: pending.length, setupRequired, processed: [], mailMutations: 0 };
    }
    const processed = [];
    for (const candidate of candidates) processed.push(await processCandidate(candidate, now, allowedExternalObjectNumbers));
    if (!candidates.length) {
      await storeMailStatus(
        options.store,
        "waiting",
        "Offene Immoprofessional-Importbestätigung; im dedizierten Importbericht-Ordner wurde noch kein passender Bericht gefunden.",
        now,
      ).catch(() => undefined);
    }
    return {
      ran: true,
      pendingCount: pending.length,
      candidateCount: candidates.length,
      processed,
      mailMutations: 0,
    };
  }

  async function runOnce(input = {}) {
    if (activeRun) {
      return {
        ran: false,
        reason: "mail-poll-in-flight",
        inFlight: true,
        processed: [],
        mailMutations: 0,
      };
    }
    const currentRun = executeRunOnce(input);
    activeRun = currentRun;
    try {
      return await currentRun;
    } finally {
      if (activeRun === currentRun) activeRun = null;
    }
  }

  return { runOnce };
}
