import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import { createAppleMailReadAccessGuard } from "../apple-mail-read-access-guard.mjs";
import {
  classifyAppleMailAutomationError,
  createAppleMailAutomationRunner,
  createAppleMailImportReportAdapter,
  createAppleMailProcessExecutor,
  IMPORT_REPORT_FOLDER_MESSAGE_LIMIT,
  IMPORT_REPORT_MAIL_FOLDER,
} from "../apple-mail-import-report-adapter.mjs";

const accountId = "synthetic-account-id";

test("production import reports are bound to the Livinghaus status folder", () => {
  assert.equal(IMPORT_REPORT_MAIL_FOLDER, "21_Statusmeldungen");
});

function operation(script) {
  return /FPI_OPERATION:([A-Z_]+)/u.exec(script)?.[1] || "UNKNOWN";
}

function scriptedAdapter(options = {}) {
  const calls = [];
  const runner = async (script, args) => {
    const current = operation(script);
    calls.push({ operation: current, script, args });
    if (options.errors?.[current]) throw options.errors[current];
    if (current === "INSPECT_IMPORT_REPORT_FOLDER") {
      return options.setup || `SETUP\t${accountId}\tunknown\t${IMPORT_REPORT_MAIL_FOLDER}\tmailbox`;
    }
    if (current === "LIST_IMPORT_REPORTS") {
      return options.list || `MAILBOX\t${accountId}\tunknown\t${IMPORT_REPORT_MAIL_FOLDER}\nMESSAGE\t42\n`;
    }
    if (current === "READ_IMPORT_REPORT") return options.raw || "Raw message source";
    throw new Error(`Unexpected operation ${current}`);
  };
  return { adapter: createAppleMailImportReportAdapter({ runner }), calls };
}

test("resolves one Livinghaus account and the exact direct server-side report folder", async () => {
  const { adapter, calls } = scriptedAdapter();
  const setup = await adapter.inspectSetup();
  assert.equal(setup.accountName, "Livinghaus");
  assert.equal(setup.accountType, "unknown");
  assert.equal(setup.mailboxName, IMPORT_REPORT_MAIL_FOLDER);
  assert.equal(setup.targetFolderExists, true);
  assert.equal(setup.readOnly, true);

  const candidates = await adapter.findCandidates({ lookbackHours: 48 });
  assert.deepEqual(candidates, [{
    transportId: "42",
    accountName: "Livinghaus",
    accountId,
    accountType: "unknown",
    mailboxName: IMPORT_REPORT_MAIL_FOLDER,
  }]);
  const mail = await adapter.readRawMessage(candidates[0]);
  assert.equal(mail.rawSource, "Raw message source");
  assert.equal(calls.every((call) => call.args[0] === "Livinghaus"), true);
  assert.equal(calls.every((call) => call.args[1] === IMPORT_REPORT_MAIL_FOLDER), true);
});

test("fails closed when Livinghaus is missing or ambiguous", async () => {
  for (const message of ["MAIL_ACCOUNT_NOT_FOUND", "MAIL_ACCOUNT_AMBIGUOUS"]) {
    const error = new Error(message);
    error.code = "MAIL_IMPORT_REPORT_SETUP_REQUIRED";
    const { adapter } = scriptedAdapter({ errors: { INSPECT_IMPORT_REPORT_FOLDER: error } });
    await assert.rejects(adapter.inspectSetup(), new RegExp(message, "u"));
  }
});

test("fails closed when the target folder is missing, ambiguous or under another account", async () => {
  for (const message of [
    "MAIL_IMPORT_REPORT_FOLDER_NOT_FOUND",
    "MAIL_IMPORT_REPORT_FOLDER_AMBIGUOUS",
    "MAIL_IMPORT_REPORT_FOLDER_WRONG_ACCOUNT",
  ]) {
    const error = new Error(message);
    error.code = "MAIL_IMPORT_REPORT_SETUP_REQUIRED";
    const { adapter } = scriptedAdapter({ errors: { INSPECT_IMPORT_REPORT_FOLDER: error } });
    await assert.rejects(adapter.inspectSetup(), new RegExp(message, "u"));
  }
});

test("never resolves a same-name local or wrong-account mailbox as fallback", async () => {
  const { adapter, calls } = scriptedAdapter();
  await adapter.inspectSetup();
  await adapter.findCandidates();
  const scripts = calls.map((call) => call.script).join("\n");
  assert.equal(calls.every((call) => call.script.includes('tell application id "com.apple.mail"')), true);
  assert.equal(calls.every((call) => !call.script.includes('tell application "Mail"')), true);
  assert.match(scripts, /every mailbox of targetAccount whose name is folderName/u);
  assert.match(scripts, /\(\(id of \(account of targetBox\)\) as string\)/u);
  assert.doesNotMatch(scripts, /On My Mac|Auf meinem Mac|every mailbox whose name/u);
});

test("AppleScript and adapter capability surface are strictly read-only", async () => {
  const { adapter, calls } = scriptedAdapter();
  await adapter.inspectSetup();
  const candidates = await adapter.findCandidates();
  await adapter.readRawMessage(candidates[0]);

  assert.equal(adapter.readOnly, true);
  assert.equal("moveProcessedMessage" in adapter, false);
  assert.equal("deleteMessage" in adapter, false);
  assert.equal("copyMessage" in adapter, false);
  assert.equal("createFolder" in adapter, false);
  assert.equal("renameFolder" in adapter, false);

  const scripts = calls.map((call) => call.script).join("\n").toLowerCase();
  for (const forbidden of [
    /\bmove\s+[^\n]+\s+to\b/u,
    /\bdelete\b/u,
    /\bduplicate\b/u,
    /\bcopy\s+[^\n]+\s+to\b/u,
    /set\s+read status/u,
    /set\s+flagged status/u,
    /make new mailbox/u,
    /set\s+name\s+of\s+targetbox/u,
  ]) assert.doesNotMatch(scripts, forbidden);
});

test("rejects malformed transport ids and cross-folder message references", async () => {
  const malformed = scriptedAdapter({ list: `MAILBOX\t${accountId}\tunknown\t${IMPORT_REPORT_MAIL_FOLDER}\nMESSAGE\tnot-a-number\n` }).adapter;
  await assert.rejects(malformed.findCandidates(), /Nachrichten-ID/u);

  const { adapter } = scriptedAdapter();
  await assert.rejects(adapter.readRawMessage({
    transportId: "42",
    accountName: "Livinghaus",
    accountId,
    mailboxName: "Posteingang",
  }), /gehört nicht/u);
});

test("rejects a response for any mailbox other than the configured target", async () => {
  const adapter = scriptedAdapter({ setup: `SETUP\t${accountId}\tunknown\tPosteingang\tmailbox` }).adapter;
  await assert.rejects(adapter.inspectSetup(), (error) => error.code === "MAIL_IMPORT_REPORT_PARSE_ERROR");
});

function processAdapter(execute, options = {}) {
  return createAppleMailImportReportAdapter({ execute, clock: options.clock });
}

test("accepts only real structured account and mailbox setup sentinels", async () => {
  for (const [reason, expectedSetupReason] of [
    ["ACCOUNT_NOT_FOUND", "ACCOUNT_NOT_FOUND"],
    ["MAILBOX_NOT_FOUND", "MAILBOX_NOT_FOUND"],
  ]) {
    const adapter = processAdapter(async () => ({
      stdout: `FPI_ERROR\tSETUP_REQUIRED\t${reason}\n`,
      stderr: "",
    }));
    await assert.rejects(adapter.inspectSetup(), (error) =>
      error.code === "MAIL_IMPORT_REPORT_SETUP_REQUIRED"
      && error.setupReason === expectedSetupReason);
  }
});

test("sentinel strings embedded in AppleScript never reclassify a process timeout as setup required", async () => {
  let observedScript = "";
  const adapter = processAdapter(async (_file, args) => {
    observedScript = args[1];
    const error = new Error(`command failed: ${args.join(" ")}`);
    error.killed = true;
    error.signal = "SIGTERM";
    error.stderr = "";
    throw error;
  });
  await assert.rejects(adapter.inspectSetup(), (error) =>
    error.code === "MAIL_AUTOMATION_TIMEOUT"
    && error.timedOut === true
    && error.exitSignal === "SIGTERM");
  assert.match(observedScript, /SETUP_REQUIRED/u);
  for (const sentinel of [
    "MAIL_ACCOUNT_NOT_FOUND",
    "MAIL_ACCOUNT_AMBIGUOUS",
    "MAIL_ACCOUNT_ID_CHANGED",
    "MAIL_IMPORT_REPORT_FOLDER_NOT_FOUND",
    "MAIL_IMPORT_REPORT_FOLDER_AMBIGUOUS",
    "MAIL_IMPORT_REPORT_FOLDER_WRONG_ACCOUNT",
  ]) assert.match(observedScript, new RegExp(sentinel, "u"));
});

test("process SIGTERM due to timeout is classified before any stderr or command-text inspection", () => {
  const error = Object.assign(new Error("SETUP_REQUIRED MAIL_ACCOUNT_NOT_FOUND"), {
    killed: true,
    signal: "SIGTERM",
    stderr: "MAIL_IMPORT_REPORT_FOLDER_NOT_FOUND",
  });
  const classified = classifyAppleMailAutomationError(error, { durationMs: 10_000 });
  assert.equal(classified.code, "MAIL_AUTOMATION_TIMEOUT");
  assert.equal(classified.timedOut, true);
  assert.equal(classified.durationMs, 10_000);
});

test("explicit macOS automation denial is classified separately", async () => {
  const adapter = processAdapter(async () => {
    const error = new Error("osascript failed");
    error.stderr = "Not authorized to send Apple events to Mail. (-1743)";
    throw error;
  });
  await assert.rejects(adapter.inspectSetup(), (error) => error.code === "MAIL_AUTOMATION_PERMISSION_DENIED");
});

test("successful structured setup is not misclassified and remains read-only", async () => {
  const adapter = processAdapter(async (_file, args) => {
    assert.match(args[1], /FPI_OK/u);
    return { stdout: `FPI_OK\tSETUP\t${accountId}\tunknown\t${IMPORT_REPORT_MAIL_FOLDER}\tmailbox\n`, stderr: "" };
  });
  const setup = await adapter.inspectSetup();
  assert.equal(setup.accountId, accountId);
  assert.equal(setup.mailboxName, IMPORT_REPORT_MAIL_FOLDER);
  assert.equal(setup.readOnly, true);
});

test("reachable mailbox with no report is a successful empty scan, not setup required", async () => {
  const adapter = processAdapter(async () => ({
    stdout: `FPI_OK\tMAILBOX\t${accountId}\tunknown\t${IMPORT_REPORT_MAIL_FOLDER}\tmailbox\n`,
    stderr: "",
  }));
  assert.deepEqual(await adapter.findCandidates(), []);
});

test("unknown or unstructured Apple Mail output is a parse error", async () => {
  const runner = createAppleMailAutomationRunner({ execute: async () => ({ stdout: "SETUP_REQUIRED", stderr: "" }) });
  await assert.rejects(runner("script containing MAIL_ACCOUNT_NOT_FOUND", []), (error) =>
    error.code === "MAIL_IMPORT_REPORT_PARSE_ERROR");
});

test("bounded folder traversal filters only metadata and never asks Mail for a compound whose query", async () => {
  const { adapter, calls } = scriptedAdapter();
  await adapter.findCandidates({ lookbackHours: 48 });
  const call = calls.find((item) => item.operation === "LIST_IMPORT_REPORTS");
  assert.equal(call.args[4], String(IMPORT_REPORT_FOLDER_MESSAGE_LIMIT));
  assert.match(call.script, /set targetMessages to messages of targetBox/u);
  assert.match(call.script, /subject of currentMessage/u);
  assert.match(call.script, /date received of currentMessage/u);
  assert.doesNotMatch(call.script, /every message of targetBox whose/u);
  assert.doesNotMatch(call.script, /source of currentMessage|content of currentMessage/u);
});

test("folder traversal limit is classified fail-closed", async () => {
  const adapter = processAdapter(async () => ({
    stdout: "FPI_ERROR\tACCESS_FAILED\tMAILBOX_MESSAGE_LIMIT_EXCEEDED\n",
    stderr: "",
  }));
  await assert.rejects(adapter.findCandidates(), (error) =>
    error.code === "MAIL_IMPORT_REPORT_SCAN_LIMIT_EXCEEDED");
});

test("adapter serializes overlapping Apple Mail operations and releases the shared guard", async () => {
  let release;
  const accessGuard = createAppleMailReadAccessGuard({ waitTimeoutMs: 1_000 });
  const execute = async (_file, args) => {
    if (operation(args[1]) === "INSPECT_IMPORT_REPORT_FOLDER") {
      await new Promise((resolve) => { release = resolve; });
      return { stdout: `FPI_OK\tSETUP\t${accountId}\tunknown\t${IMPORT_REPORT_MAIL_FOLDER}\tmailbox`, stderr: "" };
    }
    return { stdout: `FPI_OK\tMAILBOX\t${accountId}\tunknown\t${IMPORT_REPORT_MAIL_FOLDER}\tmailbox\n`, stderr: "" };
  };
  const adapter = createAppleMailImportReportAdapter({ accessGuard, execute, retryDelaysMs: [] });
  const first = adapter.inspectSetup();
  await new Promise((resolve) => setImmediate(resolve));
  const second = adapter.findCandidates();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(accessGuard.inspect().queuedCalls, 1);
  release();
  await first;
  assert.deepEqual(await second, []);
});

test("timeout escalates from SIGTERM to SIGKILL and waits for the owned child to close", async () => {
  const child = new EventEmitter();
  child.pid = 4242;
  child.exitCode = null;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const signals = [];
  child.kill = (signal) => {
    signals.push(signal);
    if (signal === "SIGKILL") {
      child.exitCode = 137;
      queueMicrotask(() => child.emit("close", null, "SIGKILL"));
    }
    return true;
  };
  const execute = createAppleMailProcessExecutor({
    spawnProcess: () => child,
    terminationGraceMs: 5,
  });
  await assert.rejects(
    execute("osascript", [], { timeout: 5 }),
    (error) => error.code === "ETIMEDOUT"
      && error.timedOut === true
      && error.processId === 4242
      && error.signal === "SIGKILL",
  );
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
});
