import assert from "node:assert/strict";
import test from "node:test";

import {
  createAppleMailImportReportAdapter,
  IMPORT_REPORT_MAIL_FOLDER,
} from "../apple-mail-import-report-adapter.mjs";

const accountId = "synthetic-account-id";

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
  assert.match(scripts, /every mailbox of targetAccount whose name is folderName/u);
  assert.match(scripts, /id of account of targetBox/u);
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
  await assert.rejects(adapter.inspectSetup(), /MAIL_IMPORT_REPORT_FOLDER_NOT_UNIQUE/u);
});
