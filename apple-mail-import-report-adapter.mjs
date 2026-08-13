import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { IMMOPROFESSIONAL_IMPORT_REPORT_SUBJECT } from "./immoprofessional-import-report-parser.mjs";

export const IMPORT_REPORT_MAIL_FOLDER = "Inseratestudio – Importberichte";
export const DEFAULT_IMPORT_REPORT_MAIL_ACCOUNT = "Livinghaus";

const execFileAsync = promisify(execFile);

const LIST_MESSAGES_SCRIPT = String.raw`
on run argv
  set accountName to item 1 of argv
  set expectedSubject to item 2 of argv
  set lookbackHours to (item 3 of argv) as integer
  tell application "Mail"
    set matchingAccounts to every account whose name is accountName
    if (count of matchingAccounts) is not 1 then error "MAIL_ACCOUNT_NOT_UNIQUE"
    set targetAccount to item 1 of matchingAccounts
    set localizedInboxes to every mailbox of targetAccount whose name is "Posteingang"
    set canonicalInboxes to every mailbox of targetAccount whose name is "INBOX"
    if ((count of localizedInboxes) + (count of canonicalInboxes)) is not 1 then error "MAIL_INBOX_NOT_UNIQUE"
    if (count of localizedInboxes) is 1 then
      set inboxBox to item 1 of localizedInboxes
    else
      set inboxBox to item 1 of canonicalInboxes
    end if
    set cutoffDate to (current date) - (lookbackHours * hours)
    set matches to every message of inboxBox whose subject is expectedSubject and date received is greater than cutoffDate
    set outputText to ""
    repeat with currentMessage in matches
      set outputText to outputText & ((id of currentMessage) as string) & linefeed
    end repeat
    return outputText
  end tell
end run`;

const INSPECT_SETUP_SCRIPT = String.raw`
on run argv
  set accountName to item 1 of argv
  set folderName to item 2 of argv
  tell application "Mail"
    set matchingAccounts to every account whose name is accountName
    if (count of matchingAccounts) is not 1 then error "MAIL_ACCOUNT_NOT_UNIQUE"
    set targetAccount to item 1 of matchingAccounts
    set localizedInboxes to every mailbox of targetAccount whose name is "Posteingang"
    set canonicalInboxes to every mailbox of targetAccount whose name is "INBOX"
    if ((count of localizedInboxes) + (count of canonicalInboxes)) is not 1 then error "MAIL_INBOX_NOT_UNIQUE"
    set targetBoxes to every mailbox of targetAccount whose name is folderName
    return "ACCOUNT_OK" & tab & ((count of targetBoxes) as string)
  end tell
end run`;

const READ_MESSAGE_SCRIPT = String.raw`
on run argv
  set accountName to item 1 of argv
  set messageIdentifier to (item 2 of argv) as integer
  tell application "Mail"
    set matchingAccounts to every account whose name is accountName
    if (count of matchingAccounts) is not 1 then error "MAIL_ACCOUNT_NOT_UNIQUE"
    set targetAccount to item 1 of matchingAccounts
    set localizedInboxes to every mailbox of targetAccount whose name is "Posteingang"
    set canonicalInboxes to every mailbox of targetAccount whose name is "INBOX"
    if ((count of localizedInboxes) + (count of canonicalInboxes)) is not 1 then error "MAIL_INBOX_NOT_UNIQUE"
    if (count of localizedInboxes) is 1 then
      set inboxBox to item 1 of localizedInboxes
    else
      set inboxBox to item 1 of canonicalInboxes
    end if
    set matches to every message of inboxBox whose id is messageIdentifier
    if (count of matches) is not 1 then error "MAIL_MESSAGE_NOT_UNIQUE"
    return source of item 1 of matches
  end tell
end run`;

const MOVE_MESSAGE_SCRIPT = String.raw`
on run argv
  set accountName to item 1 of argv
  set messageIdentifier to (item 2 of argv) as integer
  set expectedMessageId to item 3 of argv
  set folderName to item 4 of argv
  tell application "Mail"
    set matchingAccounts to every account whose name is accountName
    if (count of matchingAccounts) is not 1 then error "MAIL_ACCOUNT_NOT_UNIQUE"
    set targetAccount to item 1 of matchingAccounts
    set localizedInboxes to every mailbox of targetAccount whose name is "Posteingang"
    set canonicalInboxes to every mailbox of targetAccount whose name is "INBOX"
    if ((count of localizedInboxes) + (count of canonicalInboxes)) is not 1 then error "MAIL_INBOX_NOT_UNIQUE"
    if (count of localizedInboxes) is 1 then
      set inboxBox to item 1 of localizedInboxes
    else
      set inboxBox to item 1 of canonicalInboxes
    end if
    set targetBoxes to every mailbox of targetAccount whose name is folderName
    if (count of targetBoxes) is 0 then
      tell targetAccount to make new mailbox with properties {name:folderName}
      set targetBoxes to every mailbox of targetAccount whose name is folderName
    end if
    if (count of targetBoxes) is not 1 then error "MAIL_TARGET_FOLDER_NOT_UNIQUE"
    set targetBox to item 1 of targetBoxes
    set inboxMatches to every message of inboxBox whose id is messageIdentifier
    if (count of inboxMatches) is 1 then
      set currentMessage to item 1 of inboxMatches
      if (message id of currentMessage) is not expectedMessageId then error "MAIL_MESSAGE_ID_CHANGED"
      move currentMessage to targetBox
      return "MOVED"
    end if
    set destinationMatches to every message of targetBox whose message id is expectedMessageId
    if (count of destinationMatches) is 1 then return "ALREADY_MOVED"
    error "MAIL_MESSAGE_NOT_UNIQUE"
  end tell
end run`;

function setupError(error) {
  const message = error instanceof Error ? error.message : String(error || "Apple Mail ist nicht verfügbar.");
  const wrapped = new Error(message);
  wrapped.code = /MAIL_ACCOUNT_NOT_UNIQUE|MAIL_INBOX_NOT_UNIQUE|MAIL_TARGET_FOLDER_NOT_UNIQUE/u.test(message)
    ? "MAIL_IMPORT_REPORT_SETUP_REQUIRED"
    : "MAIL_IMPORT_REPORT_ACCESS_FAILED";
  return wrapped;
}

async function defaultRunner(script, args, options = {}) {
  try {
    const result = await execFileAsync("osascript", ["-e", script, "--", ...args.map(String)], {
      encoding: "utf8",
      maxBuffer: options.maxBuffer || 10 * 1024 * 1024,
      timeout: options.timeout || 30_000,
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

export function createAppleMailImportReportAdapter(options = {}) {
  const runner = options.runner || defaultRunner;
  const accountName = String(options.accountName || process.env.FPI_IMPORT_REPORT_MAIL_ACCOUNT || DEFAULT_IMPORT_REPORT_MAIL_ACCOUNT).trim();
  const targetFolder = String(options.targetFolder || IMPORT_REPORT_MAIL_FOLDER).trim();
  if (!accountName) throw new Error("Der Apple-Mail-Accountname fehlt.");
  if (!targetFolder) throw new Error("Der Apple-Mail-Zielordner fehlt.");

  return {
    accountName,
    targetFolder,
    async inspectSetup() {
      const output = String(await runner(INSPECT_SETUP_SCRIPT, [accountName, targetFolder]) || "").trim();
      const [status, targetCountText] = output.split("\t");
      const targetCount = Number(targetCountText);
      if (status !== "ACCOUNT_OK" || !Number.isInteger(targetCount)) throw new Error("Apple Mail hat die Account-/Ordnerprüfung nicht eindeutig beantwortet.");
      if (targetCount > 1) {
        const error = new Error("MAIL_TARGET_FOLDER_NOT_UNIQUE");
        error.code = "MAIL_IMPORT_REPORT_SETUP_REQUIRED";
        throw error;
      }
      return { accountName, inboxName: "Posteingang/INBOX", targetFolder, targetFolderExists: targetCount === 1 };
    },
    async findCandidates(input = {}) {
      const lookbackHours = Math.max(1, Math.min(720, Math.ceil(Number(input.lookbackHours) || 72)));
      const output = await runner(LIST_MESSAGES_SCRIPT, [
        accountName,
        IMMOPROFESSIONAL_IMPORT_REPORT_SUBJECT,
        String(lookbackHours),
      ]);
      return String(output || "").split(/\r?\n/gu).map((value) => value.trim()).filter(Boolean).map((transportId) => ({
        transportId: validTransportId(transportId),
        accountName,
        mailboxName: "Posteingang",
      }));
    },
    async readRawMessage(candidate) {
      const transportId = validTransportId(candidate?.transportId);
      const rawSource = await runner(READ_MESSAGE_SCRIPT, [accountName, transportId], { maxBuffer: 20 * 1024 * 1024 });
      if (!String(rawSource || "").trim()) throw new Error("Apple Mail lieferte eine leere Raw-Mail.");
      return { ...candidate, accountName, mailboxName: "Posteingang", rawSource: String(rawSource) };
    },
    async moveProcessedMessage(input) {
      const transportId = validTransportId(input?.transportId);
      const messageId = String(input?.messageId || "").trim();
      if (!messageId) throw new Error("Die validierte Message-ID fehlt für die Mailverschiebung.");
      const appleMessageId = messageId.replace(/^</u, "").replace(/>$/u, "");
      const output = String(await runner(MOVE_MESSAGE_SCRIPT, [accountName, transportId, appleMessageId, targetFolder]) || "").trim();
      if (!new Set(["MOVED", "ALREADY_MOVED"]).has(output)) throw new Error("Apple Mail hat die Mailverschiebung nicht eindeutig bestätigt.");
      return { moved: output === "MOVED", alreadyMoved: output === "ALREADY_MOVED", accountName, folderName: targetFolder };
    },
  };
}
