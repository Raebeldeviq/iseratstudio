import { createHash } from "node:crypto";

import {
  confirmImportReportInState,
  IMPORT_REPORT_PROCESSING_STATUS,
  markImportReportMailMovedInState,
  recordImportReportReviewInState,
} from "./immoprofessional-import-confirmation.mjs";
import {
  parseImmoprofessionalImportReport,
  parseRfc822Headers,
} from "./immoprofessional-import-report-parser.mjs";
import { normalizeWorkflowStatus, WORKFLOW_STATUS } from "./workflow-status.mjs";

export const DEFAULT_IMPORT_REPORT_POLL_INTERVAL_MS = 5 * 60 * 1000;

function pendingImportListings(state) {
  return (state.projects || []).flatMap((project) => (project.listings || []).filter((listing) =>
    listing.listingOrigin === "rotation-copy"
    && normalizeWorkflowStatus(listing.status, WORKFLOW_STATUS.DRAFT) === WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT));
}

function pendingMailMoves(state) {
  return (state.importReports || []).filter((report) =>
    report.processingStatus === IMPORT_REPORT_PROCESSING_STATUS.CONFIRMED_MOVE_PENDING
    && report.mailTransportId
    && report.messageId);
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

async function storeMailStatus(store, status, message, now) {
  return store.update((state) => ({
    ...state,
    mailImportReportStatus: { status, message: String(message || "").slice(0, 500), updatedAt: now },
  }), { now });
}

export function createImmoprofessionalImportReportService(options) {
  if (!options?.store?.load || !options?.store?.update) throw new Error("Dem Importberichtdienst fehlt der persistente Katalogspeicher.");
  if (!options?.uploadJobLedger?.read) throw new Error("Dem Importberichtdienst fehlt das persistente Uploadledger.");
  if (!options?.mailAdapter?.findCandidates || !options?.mailAdapter?.readRawMessage || !options?.mailAdapter?.moveProcessedMessage) {
    throw new Error("Dem Importberichtdienst fehlt der lokale Apple-Mail-Adapter.");
  }
  const writeLog = options.writeLog || (async () => undefined);

  async function moveReportMail(report, candidate = null, now = new Date().toISOString()) {
    const transportId = candidate?.transportId || report.mailTransportId;
    const messageId = candidate?.messageId || report.messageId;
    const moved = await options.mailAdapter.moveProcessedMessage({ transportId, messageId });
    await options.store.update((state) => ({
      state: markImportReportMailMovedInState(state, report.reportId, moved.folderName, { now }),
    }), { now });
    await writeLog("mail-moved", {
      reportId: report.reportId,
      externalObjectNumber: report.externalObjectNumber,
      folderName: moved.folderName,
      idempotent: moved.alreadyMoved === true,
    });
    return moved;
  }

  async function retryPendingMoves(state, now) {
    const outcomes = [];
    for (const report of pendingMailMoves(state)) {
      try {
        await moveReportMail(report, null, now);
        outcomes.push({ reportId: report.reportId, moved: true });
      } catch (error) {
        const reason = safeReason(error);
        await writeLog("mail-move-failed", { reportId: report.reportId, externalObjectNumber: report.externalObjectNumber, reason });
        outcomes.push({ reportId: report.reportId, moved: false, reason });
      }
    }
    return outcomes;
  }

  async function processCandidate(candidate, now) {
    let mail;
    let metadata = { rawHash: "", messageId: "", receivedAt: "" };
    try {
      mail = await options.mailAdapter.readRawMessage(candidate);
      metadata = rawMetadata(mail.rawSource);
      const parsed = parseImmoprofessionalImportReport(mail.rawSource, options.parserOptions);
      const ledger = await options.uploadJobLedger.read();
      const persisted = await options.store.update((state) => confirmImportReportInState(
        state,
        parsed,
        {
          ...mail,
          receivedAt: metadata.receivedAt,
        },
        ledger,
        { now },
      ), { now });
      const result = persisted.result;
      if (!new Set(["confirmed", "idempotent"]).has(result?.status)) {
        const reason = String(result?.reason || "Der Importbericht konnte nicht eindeutig zugeordnet werden.");
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
        });
        return { status: result?.status || "rejected", moved: false, reason };
      }
      const report = result.report;
      try {
        await moveReportMail(report, { transportId: candidate.transportId, messageId: parsed.messageId }, now);
        return { status: result.status, moved: true, reportId: report.reportId, externalObjectNumber: parsed.externalObjectNumber };
      } catch (error) {
        const reason = safeReason(error);
        await writeLog("confirmation-saved-mail-move-failed", {
          reportId: report.reportId,
          externalObjectNumber: parsed.externalObjectNumber,
          reason,
        });
        return { status: result.status, moved: false, reportId: report.reportId, externalObjectNumber: parsed.externalObjectNumber, reason };
      }
    } catch (error) {
      const reason = safeReason(error);
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
      await writeLog("rejected", { processingStatus: "review_required", reason });
      return { status: "rejected", moved: false, reason };
    }
  }

  async function runOnce(input = {}) {
    const now = String(input.now || new Date().toISOString());
    const snapshot = await options.store.load();
    if (!snapshot?.stored || !snapshot.state) return { ran: false, reason: "catalog-not-stored", processed: [] };
    const retryResults = await retryPendingMoves(snapshot.state, now);
    const refreshed = await options.store.load();
    const pending = pendingImportListings(refreshed.state || snapshot.state);
    if (!pending.length) {
      return { ran: retryResults.length > 0, reason: "no-pending-imports", pendingCount: 0, retriedMoves: retryResults, processed: [] };
    }
    let candidates;
    try {
      candidates = await options.mailAdapter.findCandidates({ lookbackHours: lookbackHoursFor(pending, now) });
    } catch (error) {
      const reason = safeReason(error);
      await storeMailStatus(options.store, error?.code === "MAIL_IMPORT_REPORT_SETUP_REQUIRED" ? "setup_required" : "access_failed", reason, now).catch(() => undefined);
      await writeLog("scan-failed", { pendingCount: pending.length, reason });
      return { ran: true, reason, pendingCount: pending.length, setupRequired: error?.code === "MAIL_IMPORT_REPORT_SETUP_REQUIRED", processed: [] };
    }
    const processed = [];
    for (const candidate of candidates) processed.push(await processCandidate(candidate, now));
    if (!candidates.length) {
      await storeMailStatus(options.store, "waiting", "Offene Immoprofessional-Importbestätigung; noch kein passender Mailbericht gefunden.", now).catch(() => undefined);
    }
    return { ran: true, pendingCount: pending.length, candidateCount: candidates.length, retriedMoves: retryResults, processed };
  }

  return { runOnce };
}
