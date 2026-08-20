import assert from "node:assert/strict";
import test from "node:test";

import { runExactProductionDeleteCli } from "../listing-rotation-production-delete-exact-cli.mjs";

const SESSION_TOKEN = "a".repeat(64);

test("exact production delete CLI rejects every non-allowlisted source before a request", async () => {
  let requests = 0;
  await assert.rejects(
    runExactProductionDeleteCli(["run", "--external-id", "30460-999999"], {
      readSessionToken: async () => SESSION_TOKEN,
      fetch: async () => { requests += 1; },
    }),
    (error) => error.code === "PRODUCTION_DELETE_EXACT_TARGET_NOT_AUTHORIZED",
  );
  assert.equal(requests, 0);
});

test("exact production delete CLI sends one session-protected request for an allowlisted source", async () => {
  const requests = [];
  const result = await runExactProductionDeleteCli(["run", "--external-id", "30460-574320"], {
    readSessionToken: async () => SESSION_TOKEN,
    fetch: async (url, options) => {
      requests.push({
        url,
        method: options.method,
        sessionHeaderPresent: options.headers["X-FPI-Session"] === SESSION_TOKEN,
        body: JSON.parse(options.body),
      });
      return {
        ok: true,
        async json() { return { ok: true, transferred: ["30460-574320"] }; },
      };
    },
  });
  assert.deepEqual(result.transferred, ["30460-574320"]);
  assert.deepEqual(requests, [{
    url: "http://127.0.0.1:43182/production-delete/run-exact",
    method: "POST",
    sessionHeaderPresent: true,
    body: { externalObjectNumber: "30460-574320" },
  }]);
});
