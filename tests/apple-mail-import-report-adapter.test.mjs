import assert from "node:assert/strict";
import test from "node:test";

import {
  createAppleMailImportReportAdapter,
  IMPORT_REPORT_MAIL_FOLDER,
} from "../apple-mail-import-report-adapter.mjs";

test("uses only the configured Livinghaus account, direct INBOX and server-account target folder", async () => {
  const calls = [];
  const runner = async (script, args) => {
    calls.push({ script, args });
    if (script.includes("ACCOUNT_OK")) return "ACCOUNT_OK\t0";
    if (script.includes("return source of item 1")) return "Raw message source";
    if (script.includes("move currentMessage")) return "MOVED";
    return "42\n";
  };
  const adapter = createAppleMailImportReportAdapter({ runner, accountName: "Livinghaus" });
  const setup = await adapter.inspectSetup();
  assert.equal(setup.targetFolderExists, false);
  const candidates = await adapter.findCandidates({ lookbackHours: 48 });
  assert.deepEqual(candidates, [{ transportId: "42", accountName: "Livinghaus", mailboxName: "Posteingang" }]);
  await adapter.readRawMessage(candidates[0]);
  const moved = await adapter.moveProcessedMessage({ transportId: "42", messageId: "<id@server22.immoprofessional.eu>" });
  assert.equal(moved.folderName, IMPORT_REPORT_MAIL_FOLDER);
  assert.equal(calls.every((call) => call.args[0] === "Livinghaus"), true);
  const moveScript = calls.find((call) => call.script.includes("move currentMessage")).script;
  assert.match(moveScript, /mailbox of targetAccount/u);
  assert.match(moveScript, /make new mailbox/u);
  assert.doesNotMatch(moveScript, /On My Mac|Auf meinem Mac/u);
});

test("fails closed when account resolution or message identity is not unique", async () => {
  const accountError = new Error("MAIL_ACCOUNT_NOT_UNIQUE");
  accountError.code = "MAIL_IMPORT_REPORT_SETUP_REQUIRED";
  const adapter = createAppleMailImportReportAdapter({ runner: async () => { throw accountError; } });
  await assert.rejects(adapter.findCandidates(), /MAIL_ACCOUNT_NOT_UNIQUE/u);
  const invalid = createAppleMailImportReportAdapter({ runner: async () => "not-a-number\n" });
  await assert.rejects(invalid.findCandidates(), /Nachrichten-ID/u);
});

test("accepts an already moved report idempotently", async () => {
  const adapter = createAppleMailImportReportAdapter({ runner: async () => "ALREADY_MOVED" });
  const result = await adapter.moveProcessedMessage({ transportId: "9", messageId: "<id@server22.immoprofessional.eu>" });
  assert.equal(result.moved, false);
  assert.equal(result.alreadyMoved, true);
});

test("rejects ambiguous server-side target folders instead of using a local fallback", async () => {
  const adapter = createAppleMailImportReportAdapter({ runner: async () => "ACCOUNT_OK\t2" });
  await assert.rejects(adapter.inspectSetup(), /MAIL_TARGET_FOLDER_NOT_UNIQUE/u);
});
