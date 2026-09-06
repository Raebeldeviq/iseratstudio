import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { sharedAppleMailReadAccessGuard } from "./apple-mail-read-access-guard.mjs";
import {
  classifyAppleMailAutomationError,
  isRetryableAppleMailInvalidConnection,
} from "./apple-mail-import-report-adapter.mjs";

const execFileAsync = promisify(execFile);
const INVALID_CONNECTION_RETRY_DELAYS_MS = Object.freeze([150, 400]);

export const LIVE_CANARY_DELETE_MAIL_ACCOUNT = "Livinghaus";
export const LIVE_CANARY_DELETE_MAILBOXES = Object.freeze([
  "Inseratestudio – Importberichte",
  "Posteingang",
]);

const LIST_SCRIPT = String.raw`
-- FPI_OPERATION:LIST_LIVE_CANARY_DELETE_REPORTS_READ_ONLY
on run argv
  set accountName to item 1 of argv
  set folderName to item 2 of argv
  set lookbackHours to (item 3 of argv) as integer
  tell application "Mail"
    set accountsFound to every account whose name is accountName
    if (count of accountsFound) is not 1 then error "LIVE_CANARY_MAIL_ACCOUNT_NOT_UNIQUE"
    set targetAccount to item 1 of accountsFound
    set accountIdentifier to id of targetAccount as string
    set boxesFound to every mailbox of targetAccount whose name is folderName
    if (count of boxesFound) is not 1 then error "LIVE_CANARY_MAILBOX_NOT_UNIQUE"
    set targetBox to item 1 of boxesFound
    set cutoffDate to (current date) - (lookbackHours * hours)
    set matches to every message of targetBox whose date received is greater than cutoffDate
    set outputText to "MAILBOX" & tab & accountIdentifier & tab & folderName & linefeed
    repeat with currentMessage in matches
      set outputText to outputText & "MESSAGE" & tab & ((id of currentMessage) as string) & linefeed
    end repeat
    return outputText
  end tell
end run`;

const READ_SCRIPT = String.raw`
-- FPI_OPERATION:READ_LIVE_CANARY_DELETE_REPORT_READ_ONLY
on run argv
  set accountName to item 1 of argv
  set folderName to item 2 of argv
  set accountIdentifierExpected to item 3 of argv
  set messageIdentifier to (item 4 of argv) as integer
  tell application "Mail"
    set accountsFound to every account whose name is accountName
    if (count of accountsFound) is not 1 then error "LIVE_CANARY_MAIL_ACCOUNT_NOT_UNIQUE"
    set targetAccount to item 1 of accountsFound
    if (id of targetAccount as string) is not accountIdentifierExpected then error "LIVE_CANARY_MAIL_ACCOUNT_CHANGED"
    set boxesFound to every mailbox of targetAccount whose name is folderName
    if (count of boxesFound) is not 1 then error "LIVE_CANARY_MAILBOX_NOT_UNIQUE"
    set matches to every message of item 1 of boxesFound whose id is messageIdentifier
    if (count of matches) is not 1 then error "LIVE_CANARY_MAIL_MESSAGE_NOT_UNIQUE"
    return source of item 1 of matches
  end tell
end run`;

export function createAppleMailDeleteAutomationRunner(options = {}) {
  const execute = options.execute || execFileAsync;
  const clock = options.clock || (() => Date.now());
  const sleep = options.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const accessGuard = options.accessGuard || sharedAppleMailReadAccessGuard;
  const retryDelaysMs = Array.isArray(options.retryDelaysMs)
    ? options.retryDelaysMs.map((value) => Math.max(0, Number(value) || 0)).slice(0, 2)
    : INVALID_CONNECTION_RETRY_DELAYS_MS;
  return async function runAppleScript(script, args, runnerOptions = {}) {
    const timeout = Math.max(1, Number(runnerOptions.timeout) || 45_000);
    const operation = /FPI_OPERATION:([A-Z_]+)/u.exec(String(script || ""))?.[1] || "APPLE_MAIL_DELETE_REPORT_READ";
    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
      const startedAt = clock();
      try {
        const result = await accessGuard.run(
          () => execute("osascript", ["-e", script, "--", ...args.map(String)], {
            encoding: "utf8",
            maxBuffer: runnerOptions.maxBuffer || 20 * 1024 * 1024,
            timeout,
          }),
          { operation, waitTimeoutMs: runnerOptions.queueWaitTimeoutMs },
        );
        return result.stdout;
      } catch (error) {
        const classified = error?.code?.startsWith?.("MAIL_")
          ? error
          : classifyAppleMailAutomationError(error, { durationMs: clock() - startedAt, timeout });
        if (!isRetryableAppleMailInvalidConnection(classified) || attempt >= retryDelaysMs.length) throw classified;
        await sleep(retryDelaysMs[attempt]);
      }
    }
    throw new Error("Der begrenzte Apple-Mail-Retryvertrag wurde unerwartet verlassen.");
  };
}

function candidateLine(line, accountName, accountId, mailboxName) {
  const [kind, transportId] = line.split("\t");
  if (kind !== "MESSAGE" || !/^\d+$/u.test(transportId)) throw new Error("Apple Mail lieferte eine ungültige read-only Nachrichtenreferenz.");
  return { accountName, accountId, mailboxName, transportId };
}

export function createAppleMailLiveCanaryDeleteReportAdapter(options = {}) {
  const runner = options.runner || createAppleMailDeleteAutomationRunner({
    accessGuard: options.accessGuard,
    clock: options.clock,
    execute: options.execute,
    retryDelaysMs: options.retryDelaysMs,
    sleep: options.sleep,
  });
  const accountName = String(options.accountName || LIVE_CANARY_DELETE_MAIL_ACCOUNT).trim();
  const mailboxNames = options.mailboxNames || LIVE_CANARY_DELETE_MAILBOXES;
  return Object.freeze({
    readOnly: true,
    accountName,
    mailboxNames: [...mailboxNames],
    async findCandidates(input = {}) {
      const lookbackHours = Math.max(1, Math.min(720, Math.ceil(Number(input.lookbackHours) || 2)));
      const candidates = [];
      for (const mailboxName of mailboxNames) {
        const lines = String(await runner(LIST_SCRIPT, [accountName, mailboxName, lookbackHours]) || "")
          .split(/\r?\n/gu).map((line) => line.trim()).filter(Boolean);
        const [kind, accountId, returnedMailbox] = String(lines.shift() || "").split("\t");
        if (kind !== "MAILBOX" || !accountId || returnedMailbox !== mailboxName) throw new Error("Apple Mail lieferte keinen eindeutigen read-only Zielordner.");
        candidates.push(...lines.map((line) => candidateLine(line, accountName, accountId, mailboxName)));
      }
      return candidates;
    },
    async readRawMessage(candidate) {
      if (candidate?.accountName !== accountName || !mailboxNames.includes(candidate?.mailboxName) || !/^\d+$/u.test(String(candidate?.transportId || ""))) throw new Error("Die Nachrichtenreferenz gehört nicht zur freigegebenen read-only Suche.");
      const rawSource = await runner(READ_SCRIPT, [accountName, candidate.mailboxName, candidate.accountId, candidate.transportId]);
      if (!String(rawSource || "").trim()) throw new Error("Apple Mail lieferte eine leere Raw-Mail.");
      return { ...candidate, rawSource: String(rawSource) };
    },
  });
}

// Produktionsneutraler Exportname; der alte Name bleibt für die reproduzierbare
// Live-Canary-Historie und bestehende Tests rückwärtskompatibel erhalten.
export const createAppleMailDeleteReportAdapter = createAppleMailLiveCanaryDeleteReportAdapter;
