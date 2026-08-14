import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";

import { PROCESS_LEASE_MS } from "./listing-rules.mjs";
import { WORKFLOW_STATUS } from "./workflow-status.mjs";

export const PLOT_DAILY_UPLOAD_GUARD_FORMAT = 1;
export const PLOT_DAILY_UPLOAD_TIME_ZONE = "Europe/Berlin";
export const PLOT_DAILY_UPLOAD_LIMIT_CODE = "PLOT_DAILY_UPLOAD_LIMIT_REACHED";

export const PLOT_DAILY_UPLOAD_STATUS = Object.freeze({
  CLAIMED: "claimed",
  TRANSFER_STARTED: "transfer_started",
  TRANSFERRED: "transferred",
  UNCERTAIN: "uncertain",
  RELEASED: "released",
});

function guardError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function clean(value, maximum = 500) {
  return String(value ?? "").trim().slice(0, maximum);
}

function validIso(value) {
  const text = clean(value, 50);
  if (!Number.isFinite(Date.parse(text))) throw guardError("PLOT_DAILY_UPLOAD_TIME_INVALID", "Der Uploadzeitpunkt ist ungültig.");
  return new Date(text).toISOString();
}

export function berlinCalendarDay(value = new Date().toISOString()) {
  const at = validIso(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PLOT_DAILY_UPLOAD_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(at));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function plotUploadDayKey(plotId, value = new Date().toISOString()) {
  const stablePlotId = clean(plotId, 200);
  if (!stablePlotId) throw guardError("PLOT_DAILY_UPLOAD_PLOT_ID_REQUIRED", "Für einen produktiven Inserat-Upload fehlt die stabile plotId.");
  return `${stablePlotId}:${berlinCalendarDay(value)}`;
}

function emptyLedger() {
  return { format: PLOT_DAILY_UPLOAD_GUARD_FORMAT, timeZone: PLOT_DAILY_UPLOAD_TIME_ZONE, records: [] };
}

function normalizeLedger(value) {
  if (
    value?.format !== PLOT_DAILY_UPLOAD_GUARD_FORMAT
    || value?.timeZone !== PLOT_DAILY_UPLOAD_TIME_ZONE
    || !Array.isArray(value?.records)
  ) {
    throw guardError("PLOT_DAILY_UPLOAD_GUARD_CORRUPT", "Der persistente Grundstücks-Tagesguard ist beschädigt oder besitzt ein unbekanntes Format.");
  }
  return value;
}

async function readLedger(path) {
  try {
    return normalizeLedger(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return emptyLedger();
    if (error?.code === "PLOT_DAILY_UPLOAD_GUARD_CORRUPT") throw error;
    throw guardError("PLOT_DAILY_UPLOAD_GUARD_CORRUPT", "Der persistente Grundstücks-Tagesguard ist beschädigt oder nicht lesbar.");
  }
}

async function atomicWrite(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(JSON.stringify(value, null, 2), "utf8");
    await handle.close();
    handle = null;
    await rename(temporaryPath, path);
  } finally {
    await handle?.close();
    await rm(temporaryPath, { force: true });
  }
}

async function withExclusiveLock(path, leaseMs, operation) {
  const lockPath = `${path}.lock`;
  await mkdir(dirname(path), { recursive: true });
  let handle;
  try {
    handle = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const details = await stat(lockPath).catch(() => null);
    if (!details || Date.now() - details.mtimeMs <= leaseMs) throw guardError("PLOT_DAILY_UPLOAD_GUARD_BUSY", "Der Grundstücks-Tagesguard wird bereits von einem anderen Prozess aktualisiert.");
    await rm(lockPath, { force: true });
    handle = await open(lockPath, "wx", 0o600);
  }
  try {
    return await operation();
  } finally {
    await handle.close();
    await rm(lockPath, { force: true });
  }
}

function recordFromInput(input, now, status, current = null) {
  const plotId = clean(input?.plotId, 200);
  const jobId = clean(input?.jobId, 500);
  const listingId = clean(input?.listingId, 200);
  const projectId = clean(input?.projectId, 200);
  if (!plotId || !jobId || !listingId || !projectId) {
    throw guardError(
      "PLOT_DAILY_UPLOAD_CONTEXT_INCOMPLETE",
      "Der Grundstücks-Tagesguard benötigt plotId, projectId, listingId und jobId.",
    );
  }
  const key = plotUploadDayKey(plotId, now);
  return {
    key,
    plotId,
    day: berlinCalendarDay(now),
    projectId,
    listingId,
    jobId,
    status,
    claimToken: status === PLOT_DAILY_UPLOAD_STATUS.CLAIMED
      ? clean(input.claimToken, 200) || randomUUID()
      : clean(current?.claimToken, 200),
    claimedAt: clean(current?.claimedAt, 50) || now,
    transferStartedAt: status === PLOT_DAILY_UPLOAD_STATUS.TRANSFER_STARTED
      ? now
      : clean(current?.transferStartedAt, 50),
    transferredAt: status === PLOT_DAILY_UPLOAD_STATUS.TRANSFERRED
      ? now
      : clean(current?.transferredAt, 50),
    releasedAt: status === PLOT_DAILY_UPLOAD_STATUS.RELEASED
      ? now
      : clean(current?.releasedAt, 50),
    reason: clean(input?.reason, 500),
    updatedAt: now,
  };
}

function positiveEvidenceForKey(evidence, key) {
  return (Array.isArray(evidence) ? evidence : []).find((item) => item?.key === key && item?.consumesDay === true);
}

function activeConsumption(record) {
  return [
    PLOT_DAILY_UPLOAD_STATUS.TRANSFERRED,
    PLOT_DAILY_UPLOAD_STATUS.UNCERTAIN,
    PLOT_DAILY_UPLOAD_STATUS.TRANSFER_STARTED,
  ].includes(record?.status);
}

export function collectPlotUploadEvidence(state, uploadLedger, at = new Date().toISOString()) {
  const day = berlinCalendarDay(at);
  const projects = new Map((state?.projects || []).map((project) => [String(project.id), project]));
  const evidence = [];
  const add = (project, listing, timestamp, source, reference, uncertain = false) => {
    if (!project?.plotId || berlinCalendarDay(timestamp) !== day) return;
    evidence.push({
      key: plotUploadDayKey(project.plotId, timestamp),
      plotId: String(project.plotId),
      day,
      projectId: String(project.id || ""),
      listingId: String(listing?.id || ""),
      externalId: String(listing?.externalId || ""),
      timestamp: new Date(timestamp).toISOString(),
      source,
      reference: String(reference || ""),
      uncertain,
      consumesDay: true,
    });
  };

  for (const project of state?.projects || []) {
    for (const listing of project.listings || []) {
      if (listing.lastUploadedAt && Number.isFinite(Date.parse(listing.lastUploadedAt))) {
        add(project, listing, listing.lastUploadedAt, "listing.lastUploadedAt", listing.externalId);
      }
      if (listing.transferredAt && Number.isFinite(Date.parse(listing.transferredAt))) {
        add(project, listing, listing.transferredAt, "listing.transferredAt", listing.externalId);
      }
      if (listing.importConfirmedAt && Number.isFinite(Date.parse(listing.importConfirmedAt))) {
        add(project, listing, listing.importConfirmedAt, "listing.importConfirmedAt", listing.externalId);
      }
    }
  }
  for (const item of state?.uploadHistory || []) {
    if (![WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT, WORKFLOW_STATUS.PUBLISHED].includes(String(item?.status || ""))) continue;
    const project = projects.get(String(item.projectId || ""));
    const listing = project?.listings?.find((candidate) => candidate.id === item.listingId);
    const timestamp = item.transferredAt || item.updatedAt || item.createdAt;
    if (Number.isFinite(Date.parse(timestamp))) add(project, listing, timestamp, "catalog.uploadHistory", item.jobId || item.id);
  }
  for (const job of uploadLedger?.jobs || []) {
    if (![WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT, WORKFLOW_STATUS.PUBLISHED].includes(String(job?.status || ""))) continue;
    const project = projects.get(String(job.projectId || ""));
    const listing = project?.listings?.find((candidate) => candidate.id === job.listingId);
    const timestamp = job.transferredAt || job.updatedAt;
    if (Number.isFinite(Date.parse(timestamp))) add(project, listing, timestamp, "upload-job-ledger", job.jobId);
  }

  const seen = new Set();
  return evidence.filter((item) => {
    const signature = `${item.key}:${item.source}:${item.reference}:${item.timestamp}`;
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

export function createPlotDailyUploadGuard(path, options = {}) {
  const leaseMs = Number(options.leaseMs) > 0 ? Number(options.leaseMs) : PROCESS_LEASE_MS;
  let queue = Promise.resolve();
  const serialized = (operation) => {
    const result = queue.then(operation, operation);
    queue = result.catch(() => undefined);
    return result;
  };
  const mutate = (operation) => serialized(() => withExclusiveLock(path, leaseMs, async () => {
    const ledger = await readLedger(path);
    const result = await operation(ledger);
    if (result?.ledger) await atomicWrite(path, result.ledger);
    return result?.value;
  }));

  return {
    claim(input, optionsValue = {}) {
      return mutate(async (ledger) => {
        const now = validIso(optionsValue.now || new Date().toISOString());
        const key = plotUploadDayKey(input?.plotId, now);
        const evidence = positiveEvidenceForKey(optionsValue.evidence, key);
        if (evidence) {
          throw guardError(PLOT_DAILY_UPLOAD_LIMIT_CODE, "Für dieses Grundstück wurde am heutigen Europe/Berlin-Kalendertag bereits ein Haus übertragen.", { key, evidence });
        }
        const current = ledger.records.find((record) => record.key === key && record.status !== PLOT_DAILY_UPLOAD_STATUS.RELEASED);
        if (activeConsumption(current)) {
          const sameCompletedJob = current.status === PLOT_DAILY_UPLOAD_STATUS.TRANSFERRED && current.jobId === clean(input?.jobId, 500);
          return {
            value: sameCompletedJob
              ? { claimed: false, alreadyCompleted: true, record: current }
              : (() => { throw guardError(PLOT_DAILY_UPLOAD_LIMIT_CODE, "Für dieses Grundstück ist der Uploadtag bereits verbraucht oder der Transferzustand unklar.", { key, record: current }); })(),
          };
        }
        if (current?.status === PLOT_DAILY_UPLOAD_STATUS.CLAIMED) {
          const activeAt = Date.parse(current.updatedAt || current.claimedAt || "");
          if (Number.isFinite(activeAt) && Date.parse(now) - activeAt < leaseMs) {
            throw guardError("PLOT_DAILY_UPLOAD_ALREADY_CLAIMED", "Für dieses Grundstück läuft bereits ein Upload-Claim.", { key, record: current });
          }
        }
        const record = recordFromInput({ ...input, claimToken: randomUUID() }, now, PLOT_DAILY_UPLOAD_STATUS.CLAIMED, current);
        const records = [...ledger.records.filter((entry) => entry.key !== key), record];
        return { ledger: { ...ledger, records }, value: { claimed: true, alreadyCompleted: false, record } };
      });
    },
    markTransferStarted(input, nowValue = new Date().toISOString()) {
      return mutate(async (ledger) => {
        const now = validIso(nowValue);
        const key = plotUploadDayKey(input?.plotId, now);
        const current = ledger.records.find((record) => record.key === key);
        if (
          current?.status !== PLOT_DAILY_UPLOAD_STATUS.CLAIMED
          || current.claimToken !== clean(input?.claimToken, 200)
          || current.jobId !== clean(input?.jobId, 500)
        ) {
          throw guardError("PLOT_DAILY_UPLOAD_CLAIM_MISMATCH", "Der FTPS-Start besitzt keinen passenden Grundstücks-Tagesclaim.", { key });
        }
        const record = recordFromInput(input, now, PLOT_DAILY_UPLOAD_STATUS.TRANSFER_STARTED, current);
        return { ledger: { ...ledger, records: ledger.records.map((entry) => entry.key === key ? record : entry) }, value: record };
      });
    },
    complete(input, nowValue = new Date().toISOString()) {
      return mutate(async (ledger) => {
        const now = validIso(nowValue);
        const key = plotUploadDayKey(input?.plotId, now);
        const current = ledger.records.find((record) => record.key === key);
        if (current?.status === PLOT_DAILY_UPLOAD_STATUS.TRANSFERRED && current.jobId === clean(input?.jobId, 500)) {
          return { value: current };
        }
        if (
          current?.status !== PLOT_DAILY_UPLOAD_STATUS.TRANSFER_STARTED
          || current.claimToken !== clean(input?.claimToken, 200)
          || current.jobId !== clean(input?.jobId, 500)
        ) {
          throw guardError("PLOT_DAILY_UPLOAD_CLAIM_MISMATCH", "Der erfolgreiche FTPS-Transfer besitzt keinen passenden gestarteten Grundstücks-Tagesclaim.", { key });
        }
        const record = recordFromInput(input, now, PLOT_DAILY_UPLOAD_STATUS.TRANSFERRED, current);
        return { ledger: { ...ledger, records: ledger.records.map((entry) => entry.key === key ? record : entry) }, value: record };
      });
    },
    fail(input, nowValue = new Date().toISOString()) {
      return mutate(async (ledger) => {
        const now = validIso(nowValue);
        const key = plotUploadDayKey(input?.plotId, now);
        const current = ledger.records.find((record) => record.key === key);
        if (!current || current.claimToken !== clean(input?.claimToken, 200) || current.jobId !== clean(input?.jobId, 500)) {
          return { value: current || null };
        }
        if ([PLOT_DAILY_UPLOAD_STATUS.TRANSFERRED, PLOT_DAILY_UPLOAD_STATUS.UNCERTAIN].includes(current.status)) return { value: current };
        const status = current.status === PLOT_DAILY_UPLOAD_STATUS.TRANSFER_STARTED
          ? PLOT_DAILY_UPLOAD_STATUS.UNCERTAIN
          : PLOT_DAILY_UPLOAD_STATUS.RELEASED;
        const record = recordFromInput({ ...input, reason: input?.reason }, now, status, current);
        return { ledger: { ...ledger, records: ledger.records.map((entry) => entry.key === key ? record : entry) }, value: record };
      });
    },
    recordEvidence(input, nowValue = new Date().toISOString()) {
      return mutate(async (ledger) => {
        const now = validIso(nowValue);
        const record = recordFromInput(input, now, input?.uncertain === true ? PLOT_DAILY_UPLOAD_STATUS.UNCERTAIN : PLOT_DAILY_UPLOAD_STATUS.TRANSFERRED);
        const current = ledger.records.find((entry) => entry.key === record.key);
        if (activeConsumption(current)) return { value: current };
        return { ledger: { ...ledger, records: [...ledger.records.filter((entry) => entry.key !== record.key), record] }, value: record };
      });
    },
    read() {
      return serialized(() => readLedger(path));
    },
    async inspect(input, optionsValue = {}) {
      const now = validIso(optionsValue.now || new Date().toISOString());
      const key = plotUploadDayKey(input?.plotId, now);
      const ledger = await this.read();
      const record = ledger.records.find((entry) => entry.key === key && entry.status !== PLOT_DAILY_UPLOAD_STATUS.RELEASED) || null;
      const evidence = positiveEvidenceForKey(optionsValue.evidence, key) || null;
      return { key, day: berlinCalendarDay(now), consumed: activeConsumption(record) || Boolean(evidence), record, evidence };
    },
  };
}
