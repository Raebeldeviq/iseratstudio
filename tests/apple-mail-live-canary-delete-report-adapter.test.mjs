import assert from "node:assert/strict";
import test from "node:test";

import {
  createAppleMailLiveCanaryDeleteReportAdapter,
  LIVE_CANARY_DELETE_MAILBOXES,
} from "../apple-mail-live-canary-delete-report-adapter.mjs";

test("live-canary reconciliation checks the status folder before the historical inbox fallback", () => {
  assert.deepEqual(LIVE_CANARY_DELETE_MAILBOXES, ["21_Statusmeldungen", "Posteingang"]);
});

test("limited delete-report adapter scans exactly the dedicated folder and inbox read-only", async () => {
  const calls = [];
  const adapter = createAppleMailLiveCanaryDeleteReportAdapter({
    runner: async (script, args) => {
      calls.push({ script, args });
      if (script.includes("LIST_LIVE_CANARY_DELETE_REPORTS")) return `MAILBOX\taccount-id\t${args[1]}\nMESSAGE\t${args[1] === LIVE_CANARY_DELETE_MAILBOXES[0] ? "101" : "202"}\n`;
      return "Subject: synthetic\r\n\r\nbody";
    },
  });
  assert.equal(adapter.readOnly, true);
  const candidates = await adapter.findCandidates({ lookbackHours: 2 });
  assert.deepEqual(candidates.map((item) => item.mailboxName), [...LIVE_CANARY_DELETE_MAILBOXES]);
  const raw = await adapter.readRawMessage(candidates[0]);
  assert.match(raw.rawSource, /synthetic/u);
  assert.equal(calls.some((call) => /\bmove\s+(?:item|message)|\bdelete\s+(?:item|message)|set\s+read\s+status/iu.test(call.script)), false);
});

test("adapter rejects references outside the two fixed read-only folders", async () => {
  const adapter = createAppleMailLiveCanaryDeleteReportAdapter({ runner: async () => "" });
  await assert.rejects(adapter.readRawMessage({ accountName: "Livinghaus", accountId: "x", mailboxName: "Papierkorb", transportId: "1" }), /nicht zur freigegebenen/u);
});
