import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createStructuredFileLogger } from "../structured-log.mjs";
import { createUploadJobLedger } from "../upload-job-ledger.mjs";
import { WORKFLOW_STATUS } from "../workflow-status.mjs";

test("persists upload claims and makes successful retries idempotent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fpi-ledger-"));
  const path = join(directory, "jobs.json");
  const ledger = createUploadJobLedger(path, { leaseMs: 60_000 });
  const input = { jobId: "upload:project-1:listing-1", projectId: "project-1", listingId: "listing-1" };
  const claim = await ledger.claim(input, "2026-07-25T10:00:00.000Z");
  assert.equal(claim.claimed, true);
  await assert.rejects(
    ledger.claim(input, "2026-07-25T10:00:30.000Z"),
    (error) => error.code === "DUPLICATE_ACTIVE_JOB",
  );
  await ledger.complete(input, "2026-07-25T10:00:40.000Z");
  const repeated = await createUploadJobLedger(path).claim(input, "2026-07-25T11:00:00.000Z");
  assert.equal(repeated.alreadyCompleted, true);
  assert.equal(repeated.job.status, WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT);
});

test("allows retry after an expired or failed job", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fpi-ledger-"));
  const ledger = createUploadJobLedger(join(directory, "jobs.json"), { leaseMs: 1_000 });
  const input = { jobId: "upload:project-2:listing-2" };
  await ledger.claim(input, "2026-07-25T10:00:00.000Z");
  assert.equal((await ledger.claim(input, "2026-07-25T10:00:02.000Z")).claimed, true);
  await ledger.fail({ ...input, errorCode: "FTP_FAILURE", message: "Verbindung fehlgeschlagen" }, "2026-07-25T10:00:03.000Z");
  assert.equal((await ledger.claim(input, "2026-07-25T10:00:04.000Z")).claimed, true);
});

test("structured logs contain required references and redact sensitive keys and values", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fpi-log-"));
  const path = join(directory, "upload.log");
  const log = createStructuredFileLogger(path, { maximumBytes: 1024 });
  await log("failed", {
    jobId: "job-1",
    listingId: "listing-1",
    projectId: "project-1",
    jobType: "upload",
    status: WORKFLOW_STATUS.FAILED,
    errorCode: "TEST",
    message: "password=do-not-log Bearer abc.def.ghi",
    password: "DARF-NICHT-IM-LOG-STEHEN",
    sessionToken: "DARF-NICHT-IM-LOG-STEHEN",
    context: { cookie: "hidden", note: "sk-exampleSecret123456789" },
  });
  const record = JSON.parse((await readFile(path, "utf8")).trim());
  assert.equal(record.listingId, "listing-1");
  assert.equal(record.projectId, "project-1");
  assert.equal(record.errorCode, "TEST");
  assert.equal("password" in record, false);
  assert.equal("sessionToken" in record, false);
  assert.equal("cookie" in record.context, false);
  assert.equal(record.context.note, "[REDACTED]");
  assert.equal(record.message.includes("do-not-log"), false);
});
