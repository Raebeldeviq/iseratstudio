import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { MAX_UPLOAD_LOGS, PROCESS_LEASE_MS } from "./listing-rules.mjs";
import { WORKFLOW_STATUS } from "./workflow-status.mjs";

const LEDGER_FORMAT = 1;

function text(value, maximum = 240) {
  return String(value ?? "").trim().slice(0, maximum);
}

function safeMessage(value, maximum = 500) {
  return text(value, maximum * 2)
    .replace(/\bsk-[a-zA-Z0-9_-]{12,}\b/gu, "[REDACTED]")
    .replace(/\bBearer\s+[a-zA-Z0-9._~+\/-]+=*/giu, "Bearer [REDACTED]")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/giu, "$1[REDACTED]@")
    .replace(/\b(password|passwort|token|secret|api.?key)\s*[=:]\s*[^\s,;]+/giu, "$1=[REDACTED]")
    .slice(0, maximum);
}

function validJobId(value) {
  const jobId = text(value, 500);
  if (!jobId || !/^[a-zA-Z0-9:._-]+$/u.test(jobId)) throw new Error("Die Upload-Job-ID ist ungültig.");
  return jobId;
}

function emptyLedger() {
  return { format: LEDGER_FORMAT, jobs: [] };
}

async function readLedger(path) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (parsed?.format !== LEDGER_FORMAT || !Array.isArray(parsed.jobs)) throw new Error("Das Upload-Jobprotokoll ist beschädigt.");
    return parsed;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return emptyLedger();
    throw error;
  }
}

async function writeLedger(path, ledger) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(ledger), { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

function jobRecord(input, current, status, now) {
  return {
    jobId: validJobId(input.jobId),
    projectId: text(input.projectId, 160),
    listingId: text(input.listingId, 160),
    jobType: text(input.jobType || "immoprofessional-upload", 100),
    status,
    createdAt: current?.createdAt || now,
    updatedAt: now,
    errorCode: status === WORKFLOW_STATUS.FAILED ? text(input.errorCode, 100) : "",
    message: status === WORKFLOW_STATUS.FAILED ? safeMessage(input.message, 500) : "",
  };
}

export function createUploadJobLedger(path, options = {}) {
  const leaseMs = Number(options.leaseMs) > 0 ? Number(options.leaseMs) : PROCESS_LEASE_MS;
  let queue = Promise.resolve();
  const serialized = (operation) => {
    const result = queue.then(operation, operation);
    queue = result.catch(() => undefined);
    return result;
  };

  async function mutate(input, status, now) {
    const ledger = await readLedger(path);
    const jobId = validJobId(input.jobId);
    const current = ledger.jobs.find((job) => job.jobId === jobId);
    const next = jobRecord(input, current, status, now);
    const jobs = [...ledger.jobs.filter((job) => job.jobId !== jobId), next].slice(-MAX_UPLOAD_LOGS);
    await writeLedger(path, { format: LEDGER_FORMAT, jobs });
    return next;
  }

  return {
    claim(input, nowValue = new Date().toISOString()) {
      return serialized(async () => {
        const now = text(nowValue, 50);
        const ledger = await readLedger(path);
        const jobId = validJobId(input.jobId);
        const current = ledger.jobs.find((job) => job.jobId === jobId);
        if (
          current?.status === WORKFLOW_STATUS.PUBLISHED
          || current?.status === WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT
        ) {
          return { claimed: false, alreadyCompleted: true, job: current };
        }
        const activeAt = Date.parse(current?.updatedAt || "");
        if (
          current?.status === WORKFLOW_STATUS.PROCESSING
          && Number.isFinite(activeAt)
          && Date.parse(now) - activeAt < leaseMs
        ) {
          const error = new Error("Dieser Upload-Job wird bereits verarbeitet.");
          error.code = "DUPLICATE_ACTIVE_JOB";
          error.httpStatus = 409;
          throw error;
        }
        const job = jobRecord(input, current, WORKFLOW_STATUS.PROCESSING, now);
        const jobs = [...ledger.jobs.filter((entry) => entry.jobId !== jobId), job].slice(-MAX_UPLOAD_LOGS);
        await writeLedger(path, { format: LEDGER_FORMAT, jobs });
        return { claimed: true, alreadyCompleted: false, job };
      });
    },
    complete(input, now = new Date().toISOString()) {
      return serialized(() => mutate(input, WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT, text(now, 50)));
    },
    fail(input, now = new Date().toISOString()) {
      return serialized(() => mutate(input, WORKFLOW_STATUS.FAILED, text(now, 50)));
    },
    read() {
      return serialized(() => readLedger(path));
    },
  };
}
