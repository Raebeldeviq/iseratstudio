import assert from "node:assert/strict";
import test from "node:test";

import { runMailRuntimeProbe } from "../mail-runtime-probe.mjs";

test("runtime probe reads setup and bounded candidate metadata without any mail mutation", async () => {
  let inspectCount = 0;
  let scanCount = 0;
  const adapter = {
    readOnly: true,
    async inspectSetup() {
      inspectCount += 1;
      return { accountName: "Livinghaus", mailboxName: "Inseratestudio – Importberichte", mailboxClass: "container" };
    },
    async findCandidates() {
      scanCount += 1;
      return [{ transportId: "1" }, { transportId: "2" }];
    },
  };
  const result = await runMailRuntimeProbe({ mailAdapter: adapter });
  assert.equal(result.ok, true);
  assert.equal(result.candidateCount, 2);
  assert.equal(result.readOnly, true);
  assert.equal(result.mailMutations, 0);
  assert.equal(inspectCount, 1);
  assert.equal(scanCount, 1);
  assert.equal("rawSource" in result, false);
});

test("runtime probe preserves timeout classification and failing stage", async () => {
  const error = Object.assign(new Error("Apple Mail antwortet nicht."), {
    code: "MAIL_AUTOMATION_TIMEOUT",
    timedOut: true,
    exitSignal: "SIGKILL",
  });
  const result = await runMailRuntimeProbe({
    mailAdapter: {
      readOnly: true,
      async inspectSetup() { return { accountName: "Livinghaus", mailboxName: "Inseratestudio – Importberichte" }; },
      async findCandidates() { throw error; },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.stage, "find-candidates");
  assert.equal(result.errorCode, "MAIL_AUTOMATION_TIMEOUT");
  assert.equal(result.timedOut, true);
  assert.equal(result.mailMutations, 0);
});
