import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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

async function defaultRunner(script, args) {
  const result = await execFileAsync("osascript", ["-e", script, "--", ...args.map(String)], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    timeout: 45_000,
  });
  return result.stdout;
}

function candidateLine(line, accountName, accountId, mailboxName) {
  const [kind, transportId] = line.split("\t");
  if (kind !== "MESSAGE" || !/^\d+$/u.test(transportId)) throw new Error("Apple Mail lieferte eine ungültige read-only Nachrichtenreferenz.");
  return { accountName, accountId, mailboxName, transportId };
}

export function createAppleMailLiveCanaryDeleteReportAdapter(options = {}) {
  const runner = options.runner || defaultRunner;
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
