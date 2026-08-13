import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { IMMOPROFESSIONAL_IMPORT_REPORT_SUBJECT } from "./immoprofessional-import-report-parser.mjs";

export const IMPORT_REPORT_MAIL_FOLDER = "Inseratestudio – Importberichte";
export const DEFAULT_IMPORT_REPORT_MAIL_ACCOUNT = "Livinghaus";

const execFileAsync = promisify(execFile);

const RESOLVE_TARGET_PREAMBLE = String.raw`
    set matchingAccounts to every account whose name is accountName
    if (count of matchingAccounts) is 0 then error "MAIL_ACCOUNT_NOT_FOUND"
    if (count of matchingAccounts) is greater than 1 then error "MAIL_ACCOUNT_AMBIGUOUS"
    set targetAccount to item 1 of matchingAccounts
    set accountIdentifier to id of targetAccount as string
    set targetBoxes to every mailbox of targetAccount whose name is folderName
    if (count of targetBoxes) is 0 then error "MAIL_IMPORT_REPORT_FOLDER_NOT_FOUND"
    if (count of targetBoxes) is greater than 1 then error "MAIL_IMPORT_REPORT_FOLDER_AMBIGUOUS"
    set targetBox to item 1 of targetBoxes
    if (id of account of targetBox as string) is not accountIdentifier then error "MAIL_IMPORT_REPORT_FOLDER_WRONG_ACCOUNT"`;

const INSPECT_SETUP_SCRIPT = String.raw`
-- FPI_OPERATION:INSPECT_IMPORT_REPORT_FOLDER
on run argv
  set accountName to item 1 of argv
  set folderName to item 2 of argv
  tell application "Mail"
${RESOLVE_TARGET_PREAMBLE}
    return "SETUP" & tab & accountIdentifier & tab & (account type of targetAccount as string) & tab & (name of targetBox as string) & tab & (class of targetBox as string)
  end tell
end run`;

const LIST_MESSAGES_SCRIPT = String.raw`
-- FPI_OPERATION:LIST_IMPORT_REPORTS
on run argv
  set accountName to item 1 of argv
  set folderName to item 2 of argv
  set expectedSubject to item 3 of argv
  set lookbackHours to (item 4 of argv) as integer
  tell application "Mail"
${RESOLVE_TARGET_PREAMBLE}
    set cutoffDate to (current date) - (lookbackHours * hours)
    set matches to every message of targetBox whose subject is expectedSubject and date received is greater than cutoffDate
    set outputText to "MAILBOX" & tab & accountIdentifier & tab & (account type of targetAccount as string) & tab & (name of targetBox as string) & linefeed
    repeat with currentMessage in matches
      set outputText to outputText & "MESSAGE" & tab & ((id of currentMessage) as string) & linefeed
    end repeat
    return outputText
  end tell
end run`;

const READ_MESSAGE_SCRIPT = String.raw`
-- FPI_OPERATION:READ_IMPORT_REPORT
on run argv
  set accountName to item 1 of argv
  set folderName to item 2 of argv
  set expectedAccountId to item 3 of argv
  set messageIdentifier to (item 4 of argv) as integer
  tell application "Mail"
${RESOLVE_TARGET_PREAMBLE}
    if accountIdentifier is not expectedAccountId then error "MAIL_ACCOUNT_ID_CHANGED"
    set matches to every message of targetBox whose id is messageIdentifier
    if (count of matches) is not 1 then error "MAIL_MESSAGE_NOT_UNIQUE_IN_IMPORT_REPORT_FOLDER"
    return source of item 1 of matches
  end tell
end run`;

const SETUP_ERROR_PATTERN = /MAIL_ACCOUNT_NOT_FOUND|MAIL_ACCOUNT_AMBIGUOUS|MAIL_ACCOUNT_ID_CHANGED|MAIL_IMPORT_REPORT_FOLDER_NOT_FOUND|MAIL_IMPORT_REPORT_FOLDER_AMBIGUOUS|MAIL_IMPORT_REPORT_FOLDER_WRONG_ACCOUNT/u;

function setupError(error) {
  const message = error instanceof Error ? error.message : String(error || "Apple Mail ist nicht verfügbar.");
  const wrapped = new Error(message);
  wrapped.code = SETUP_ERROR_PATTERN.test(message)
    ? "MAIL_IMPORT_REPORT_SETUP_REQUIRED"
    : "MAIL_IMPORT_REPORT_ACCESS_FAILED";
  return wrapped;
}

async function defaultRunner(script, args, options = {}) {
  try {
    const result = await execFileAsync("osascript", ["-e", script, "--", ...args.map(String)], {
      encoding: "utf8",
      maxBuffer: options.maxBuffer || 10 * 1024 * 1024,
      timeout: options.timeout || 45_000,
    });
    return result.stdout;
  } catch (error) {
    throw setupError(error);
  }
}

function validTransportId(value) {
  const id = String(value || "").trim();
  if (!/^\d+$/u.test(id)) throw new Error("Die lokale Apple-Mail-Nachrichten-ID ist ungültig.");
  return id;
}

function validAccountId(value) {
  const accountId = String(value || "").trim();
  if (!accountId || /[\r\n\t]/u.test(accountId)) throw new Error("Die Apple-Mail-Account-ID ist ungültig.");
  return accountId;
}

function validMailboxHeader(output, expectedStatus, expectedMailbox) {
  const [status, accountId, accountType, mailboxName, mailboxClass] = String(output || "").trim().split("\t");
  if (status !== expectedStatus || !accountId || mailboxName !== expectedMailbox) {
    const error = new Error("MAIL_IMPORT_REPORT_FOLDER_NOT_UNIQUE");
    error.code = "MAIL_IMPORT_REPORT_SETUP_REQUIRED";
    throw error;
  }
  return { accountId: validAccountId(accountId), accountType, mailboxName, mailboxClass };
}

export function createAppleMailImportReportAdapter(options = {}) {
  const runner = options.runner || defaultRunner;
  const accountName = String(options.accountName || process.env.FPI_IMPORT_REPORT_MAIL_ACCOUNT || DEFAULT_IMPORT_REPORT_MAIL_ACCOUNT).trim();
  const mailboxName = String(
    options.mailboxName
      || options.targetFolder
      || process.env.FPI_IMPORT_REPORT_MAILBOX
      || IMPORT_REPORT_MAIL_FOLDER,
  ).trim();
  if (!accountName) throw new Error("Der Apple-Mail-Accountname fehlt.");
  if (!mailboxName) throw new Error("Der Apple-Mail-Importberichtordner fehlt.");

  return Object.freeze({
    accountName,
    mailboxName,
    targetFolder: mailboxName,
    readOnly: true,
    async inspectSetup() {
      const output = await runner(INSPECT_SETUP_SCRIPT, [accountName, mailboxName]);
      const setup = validMailboxHeader(output, "SETUP", mailboxName);
      return {
        accountName,
        accountId: setup.accountId,
        accountType: setup.accountType,
        mailboxName,
        mailboxClass: setup.mailboxClass,
        targetFolder: mailboxName,
        targetFolderExists: true,
        readOnly: true,
      };
    },
    async findCandidates(input = {}) {
      const lookbackHours = Math.max(1, Math.min(720, Math.ceil(Number(input.lookbackHours) || 72)));
      const output = String(await runner(LIST_MESSAGES_SCRIPT, [
        accountName,
        mailboxName,
        IMMOPROFESSIONAL_IMPORT_REPORT_SUBJECT,
        String(lookbackHours),
      ]) || "");
      const lines = output.split(/\r?\n/gu).map((line) => line.trim()).filter(Boolean);
      const header = validMailboxHeader(lines.shift(), "MAILBOX", mailboxName);
      return lines.map((line) => {
        const [kind, transportId] = line.split("\t");
        if (kind !== "MESSAGE") throw new Error("Apple Mail hat eine ungültige Nachrichtenreferenz geliefert.");
        return {
          transportId: validTransportId(transportId),
          accountName,
          accountId: header.accountId,
          accountType: header.accountType,
          mailboxName,
        };
      });
    },
    async readRawMessage(candidate) {
      const transportId = validTransportId(candidate?.transportId);
      const accountId = validAccountId(candidate?.accountId);
      if (candidate?.accountName !== accountName || candidate?.mailboxName !== mailboxName) {
        throw new Error("Die Apple-Mail-Nachrichtenreferenz gehört nicht zum konfigurierten Importberichtordner.");
      }
      const rawSource = await runner(
        READ_MESSAGE_SCRIPT,
        [accountName, mailboxName, accountId, transportId],
        { maxBuffer: 20 * 1024 * 1024 },
      );
      if (!String(rawSource || "").trim()) throw new Error("Apple Mail lieferte eine leere Raw-Mail.");
      return { ...candidate, accountName, accountId, mailboxName, rawSource: String(rawSource) };
    },
  });
}
