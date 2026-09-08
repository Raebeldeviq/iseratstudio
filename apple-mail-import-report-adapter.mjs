import { spawn } from "node:child_process";

import { sharedAppleMailReadAccessGuard } from "./apple-mail-read-access-guard.mjs";
import { IMMOPROFESSIONAL_IMPORT_REPORT_SUBJECT } from "./immoprofessional-import-report-parser.mjs";

export const IMPORT_REPORT_MAIL_FOLDER = "21_Statusmeldungen";
export const DEFAULT_IMPORT_REPORT_MAIL_ACCOUNT = "Livinghaus";

const PROCESS_TIMEOUT_MS = 45_000;
const PROCESS_TERMINATION_GRACE_MS = 1_000;
const INVALID_CONNECTION_RETRY_DELAYS_MS = Object.freeze([150, 400]);
export const IMPORT_REPORT_FOLDER_MESSAGE_LIMIT = 500;
const FPI_OK_PREFIX = "FPI_OK\t";
const FPI_ERROR_PREFIX = "FPI_ERROR\t";

const STRUCTURED_ERROR_HANDLER = String.raw`
on fpiStructuredError(errorMessage)
  if errorMessage is "MAIL_ACCOUNT_NOT_FOUND" then return "FPI_ERROR" & tab & "SETUP_REQUIRED" & tab & "ACCOUNT_NOT_FOUND"
  if errorMessage is "MAIL_ACCOUNT_AMBIGUOUS" then return "FPI_ERROR" & tab & "SETUP_REQUIRED" & tab & "ACCOUNT_AMBIGUOUS"
  if errorMessage is "MAIL_ACCOUNT_ID_CHANGED" then return "FPI_ERROR" & tab & "SETUP_REQUIRED" & tab & "ACCOUNT_ID_CHANGED"
  if errorMessage is "MAIL_IMPORT_REPORT_FOLDER_NOT_FOUND" then return "FPI_ERROR" & tab & "SETUP_REQUIRED" & tab & "MAILBOX_NOT_FOUND"
  if errorMessage is "MAIL_IMPORT_REPORT_FOLDER_AMBIGUOUS" then return "FPI_ERROR" & tab & "SETUP_REQUIRED" & tab & "MAILBOX_AMBIGUOUS"
  if errorMessage is "MAIL_IMPORT_REPORT_FOLDER_WRONG_ACCOUNT" then return "FPI_ERROR" & tab & "SETUP_REQUIRED" & tab & "MAILBOX_WRONG_ACCOUNT"
  if errorMessage is "MAIL_IMPORT_REPORT_FOLDER_LIMIT_EXCEEDED" then return "FPI_ERROR" & tab & "ACCESS_FAILED" & tab & "MAILBOX_MESSAGE_LIMIT_EXCEEDED"
  return ""
end fpiStructuredError`;

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
    if ((id of (account of targetBox)) as string) is not accountIdentifier then error "MAIL_IMPORT_REPORT_FOLDER_WRONG_ACCOUNT"`;

const INSPECT_SETUP_SCRIPT = String.raw`
-- FPI_OPERATION:INSPECT_IMPORT_REPORT_FOLDER
${STRUCTURED_ERROR_HANDLER}
on run argv
  try
    set accountName to item 1 of argv
    set folderName to item 2 of argv
    tell application id "com.apple.mail"
${RESOLVE_TARGET_PREAMBLE}
      return "FPI_OK" & tab & "SETUP" & tab & accountIdentifier & tab & (account type of targetAccount as string) & tab & (name of targetBox as string) & tab & (class of targetBox as string)
    end tell
  on error errorMessage number errorNumber
    set structuredError to my fpiStructuredError(errorMessage)
    if structuredError is not "" then return structuredError
    error errorMessage number errorNumber
  end try
end run`;

const LIST_MESSAGES_SCRIPT = String.raw`
-- FPI_OPERATION:LIST_IMPORT_REPORTS
${STRUCTURED_ERROR_HANDLER}
on run argv
  try
    set accountName to item 1 of argv
    set folderName to item 2 of argv
    set expectedSubject to item 3 of argv
    set lookbackHours to (item 4 of argv) as integer
    set messageLimit to (item 5 of argv) as integer
    tell application id "com.apple.mail"
${RESOLVE_TARGET_PREAMBLE}
      set cutoffDate to (current date) - (lookbackHours * hours)
      set targetMessages to messages of targetBox
      if (count of targetMessages) is greater than messageLimit then error "MAIL_IMPORT_REPORT_FOLDER_LIMIT_EXCEEDED"
      set outputText to "MAILBOX" & tab & accountIdentifier & tab & (account type of targetAccount as string) & tab & (name of targetBox as string) & tab & (class of targetBox as string) & linefeed
      repeat with currentMessage in targetMessages
        set currentSubject to subject of currentMessage as string
        set currentReceivedAt to date received of currentMessage
        if currentSubject is expectedSubject and currentReceivedAt is greater than cutoffDate then
          set outputText to outputText & "MESSAGE" & tab & ((id of currentMessage) as string) & linefeed
        end if
      end repeat
      return "FPI_OK" & tab & outputText
    end tell
  on error errorMessage number errorNumber
    set structuredError to my fpiStructuredError(errorMessage)
    if structuredError is not "" then return structuredError
    error errorMessage number errorNumber
  end try
end run`;

const READ_MESSAGE_SCRIPT = String.raw`
-- FPI_OPERATION:READ_IMPORT_REPORT
${STRUCTURED_ERROR_HANDLER}
on run argv
  try
    set accountName to item 1 of argv
    set folderName to item 2 of argv
    set expectedAccountId to item 3 of argv
    set messageIdentifier to (item 4 of argv) as integer
    tell application id "com.apple.mail"
${RESOLVE_TARGET_PREAMBLE}
      if accountIdentifier is not expectedAccountId then error "MAIL_ACCOUNT_ID_CHANGED"
      set matches to every message of targetBox whose id is messageIdentifier
      if (count of matches) is not 1 then error "MAIL_MESSAGE_NOT_UNIQUE_IN_IMPORT_REPORT_FOLDER"
      return "FPI_OK" & tab & (source of item 1 of matches)
    end tell
  on error errorMessage number errorNumber
    set structuredError to my fpiStructuredError(errorMessage)
    if structuredError is not "" then return structuredError
    error errorMessage number errorNumber
  end try
end run`;

const SETUP_REASONS = new Set([
  "ACCOUNT_NOT_FOUND",
  "ACCOUNT_AMBIGUOUS",
  "ACCOUNT_ID_CHANGED",
  "MAILBOX_NOT_FOUND",
  "MAILBOX_AMBIGUOUS",
  "MAILBOX_WRONG_ACCOUNT",
]);

function adapterError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function cleanProcessText(value) {
  return String(value || "").trim().slice(0, 500);
}

function parseStructuredOutput(stdout) {
  const output = String(stdout || "");
  if (output.startsWith(FPI_OK_PREFIX)) return output.slice(FPI_OK_PREFIX.length);
  if (output.startsWith(FPI_ERROR_PREFIX)) {
    const [kind, reason] = output.slice(FPI_ERROR_PREFIX.length).trim().split("\t");
    if (kind === "SETUP_REQUIRED" && SETUP_REASONS.has(reason)) {
      throw adapterError(
        "MAIL_IMPORT_REPORT_SETUP_REQUIRED",
        `Apple Mail meldet einen strukturierten Setupfehler: ${reason}.`,
        { setupReason: reason },
      );
    }
    if (kind === "ACCESS_FAILED" && reason === "MAILBOX_MESSAGE_LIMIT_EXCEEDED") {
      throw adapterError(
        "MAIL_IMPORT_REPORT_SCAN_LIMIT_EXCEEDED",
        `Der dedizierte Importberichtordner enthält mehr als ${IMPORT_REPORT_FOLDER_MESSAGE_LIMIT} Nachrichten und wird fail-closed nicht vollständig traversiert.`,
      );
    }
    throw adapterError("MAIL_IMPORT_REPORT_PARSE_ERROR", "Apple Mail lieferte einen unbekannten strukturierten Fehler.");
  }
  throw adapterError("MAIL_IMPORT_REPORT_PARSE_ERROR", "Apple Mail lieferte keine strukturierte Adapterantwort.");
}

export function classifyAppleMailAutomationError(error, context = {}) {
  if (error?.code?.startsWith?.("MAIL_")) return error;
  const durationMs = Math.max(0, Number(context.durationMs) || 0);
  const exitSignal = String(error?.signal || context.exitSignal || "");
  const stderr = cleanProcessText(error?.stderr);
  const timedOut = error?.timedOut === true
    || error?.killed === true
    || error?.code === "ETIMEDOUT"
    || /AppleEvent timed out|event timed out|\(-1712\)/iu.test(stderr);
  if (timedOut) {
    return adapterError(
      "MAIL_AUTOMATION_TIMEOUT",
      "Apple Mail hat innerhalb des begrenzten Automationszeitfensters nicht geantwortet.",
      { timedOut: true, exitSignal: exitSignal || "SIGTERM", durationMs },
    );
  }
  if (/not authorized to send apple events|not permitted to send apple events|aeeventnotpermitted|\(-1743\)|operation not permitted/iu.test(stderr)) {
    return adapterError(
      "MAIL_AUTOMATION_PERMISSION_DENIED",
      "macOS hat die Apple-Mail-Automation ausdrücklich verweigert.",
      { timedOut: false, exitSignal, durationMs },
    );
  }
  const invalidConnectionSignature = [stderr, cleanProcessText(error?.message), String(error?.code || "")].join(" ");
  if (/connection is invalid|invalid connection|verbindung ist ungültig|\(-609\)|(?:^|\s)-609(?:\s|$)/iu.test(invalidConnectionSignature)) {
    return adapterError(
      "MAIL_AUTOMATION_UNAVAILABLE",
      "Apple Mail oder die AppleEvent-Verbindung ist technisch nicht verfügbar.",
      {
        timedOut: false,
        exitSignal,
        durationMs,
        appleEventErrorNumber: -609,
        transientSignature: "apple-event-invalid-connection",
        retryableReadOnly: true,
      },
    );
  }
  if (/application isn.?t running|application not found|no such process|\(-600\)/iu.test(stderr)) {
    return adapterError(
      "MAIL_AUTOMATION_UNAVAILABLE",
      "Apple Mail oder die AppleEvent-Verbindung ist technisch nicht verfügbar.",
      { timedOut: false, exitSignal, durationMs, retryableReadOnly: false },
    );
  }
  return adapterError(
    "MAIL_IMPORT_REPORT_ACCESS_FAILED",
    "Apple Mail konnte read-only nicht abgefragt werden.",
    { timedOut: false, exitSignal, durationMs },
  );
}

export function isRetryableAppleMailInvalidConnection(error) {
  return error?.code === "MAIL_AUTOMATION_UNAVAILABLE"
    && error?.appleEventErrorNumber === -609
    && error?.transientSignature === "apple-event-invalid-connection"
    && error?.retryableReadOnly === true;
}

function processError(message, details = {}) {
  const error = new Error(message);
  Object.assign(error, details);
  return error;
}

export function createAppleMailProcessExecutor(options = {}) {
  const spawnProcess = options.spawnProcess || spawn;
  const terminationGraceMs = Math.max(1, Number(options.terminationGraceMs) || PROCESS_TERMINATION_GRACE_MS);
  return async function execute(file, args, executionOptions = {}) {
    const timeout = Math.max(1, Number(executionOptions.timeout) || PROCESS_TIMEOUT_MS);
    const maxBuffer = Math.max(1024, Number(executionOptions.maxBuffer) || 10 * 1024 * 1024);
    return new Promise((resolve, reject) => {
      const child = spawnProcess(file, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: executionOptions.env || process.env,
      });
      const stdout = [];
      const stderr = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let timedOut = false;
      let bufferExceeded = false;
      let requestedSignal = "";
      let spawnFailure = null;
      let timeoutTimer;
      let hardKillTimer;

      const terminate = (reason) => {
        if (requestedSignal || child.exitCode !== null) return;
        requestedSignal = "SIGTERM";
        if (reason === "timeout") timedOut = true;
        if (reason === "buffer") bufferExceeded = true;
        child.kill("SIGTERM");
        hardKillTimer = setTimeout(() => {
          if (child.exitCode === null) {
            requestedSignal = "SIGKILL";
            child.kill("SIGKILL");
          }
        }, terminationGraceMs);
      };

      const collect = (target, chunk, stream) => {
        const data = Buffer.from(chunk);
        if (stream === "stdout") stdoutBytes += data.length;
        else stderrBytes += data.length;
        if (stdoutBytes > maxBuffer || stderrBytes > maxBuffer) {
          terminate("buffer");
          return;
        }
        target.push(data);
      };

      child.stdout?.on("data", (chunk) => collect(stdout, chunk, "stdout"));
      child.stderr?.on("data", (chunk) => collect(stderr, chunk, "stderr"));
      child.once("error", (error) => {
        spawnFailure = error;
      });
      timeoutTimer = setTimeout(() => terminate("timeout"), timeout);
      child.once("close", (code, signal) => {
        clearTimeout(timeoutTimer);
        clearTimeout(hardKillTimer);
        const stdoutText = Buffer.concat(stdout).toString(executionOptions.encoding || "utf8");
        const stderrText = Buffer.concat(stderr).toString(executionOptions.encoding || "utf8");
        if (spawnFailure) {
          Object.assign(spawnFailure, { stdout: stdoutText, stderr: stderrText, processId: child.pid });
          reject(spawnFailure);
          return;
        }
        if (timedOut) {
          reject(processError("osascript timed out", {
            code: "ETIMEDOUT",
            killed: true,
            timedOut: true,
            signal: signal || requestedSignal || "SIGTERM",
            stdout: stdoutText,
            stderr: stderrText,
            processId: child.pid,
          }));
          return;
        }
        if (bufferExceeded) {
          reject(processError("osascript output exceeded the bounded buffer", {
            code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
            killed: true,
            signal: signal || requestedSignal,
            stdout: stdoutText,
            stderr: stderrText,
            processId: child.pid,
          }));
          return;
        }
        if (code !== 0) {
          reject(processError(`osascript exited with code ${code}`, {
            code,
            killed: Boolean(signal),
            signal: signal || "",
            stdout: stdoutText,
            stderr: stderrText,
            processId: child.pid,
          }));
          return;
        }
        resolve({ stdout: stdoutText, stderr: stderrText, processId: child.pid });
      });
    });
  };
}

export function createAppleMailAutomationRunner(options = {}) {
  const execute = options.execute || createAppleMailProcessExecutor({
    spawnProcess: options.spawnProcess,
    terminationGraceMs: options.terminationGraceMs,
  });
  const clock = options.clock || (() => Date.now());
  const sleep = options.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const accessGuard = options.accessGuard || sharedAppleMailReadAccessGuard;
  const retryDelaysMs = Array.isArray(options.retryDelaysMs)
    ? options.retryDelaysMs.map((value) => Math.max(0, Number(value) || 0)).slice(0, 2)
    : INVALID_CONNECTION_RETRY_DELAYS_MS;
  return async function runAppleScript(script, args, runnerOptions = {}) {
    const timeout = Math.max(1, Number(runnerOptions.timeout) || PROCESS_TIMEOUT_MS);
    const operation = /FPI_OPERATION:([A-Z_]+)/u.exec(String(script || ""))?.[1] || "APPLE_MAIL_READ";
    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
      const startedAt = clock();
      try {
        const result = await accessGuard.run(
          () => execute("osascript", ["-e", script, "--", ...args.map(String)], {
            encoding: "utf8",
            maxBuffer: runnerOptions.maxBuffer || 10 * 1024 * 1024,
            timeout,
          }),
          { operation, waitTimeoutMs: runnerOptions.queueWaitTimeoutMs },
        );
        return parseStructuredOutput(result.stdout);
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
    throw adapterError("MAIL_IMPORT_REPORT_PARSE_ERROR", "Apple Mail lieferte keinen eindeutigen strukturierten Mailbox-Header.");
  }
  return { accountId: validAccountId(accountId), accountType, mailboxName, mailboxClass };
}

export function createAppleMailImportReportAdapter(options = {}) {
  const runner = options.runner || createAppleMailAutomationRunner({
    accessGuard: options.accessGuard,
    clock: options.clock,
    execute: options.execute,
    retryDelaysMs: options.retryDelaysMs,
    sleep: options.sleep,
  });
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
        String(IMPORT_REPORT_FOLDER_MESSAGE_LIMIT),
      ]) || "");
      const lines = output.split(/\r?\n/gu).map((line) => line.trim()).filter(Boolean);
      const header = validMailboxHeader(lines.shift(), "MAILBOX", mailboxName);
      return lines.map((line) => {
        const [kind, transportId] = line.split("\t");
        if (kind !== "MESSAGE") throw adapterError("MAIL_IMPORT_REPORT_PARSE_ERROR", "Apple Mail hat eine ungültige Nachrichtenreferenz geliefert.");
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
      if (!String(rawSource || "").trim()) throw adapterError("MAIL_IMPORT_REPORT_PARSE_ERROR", "Apple Mail lieferte eine leere Raw-Mail.");
      return { ...candidate, accountName, accountId, mailboxName, rawSource: String(rawSource) };
    },
  });
}
