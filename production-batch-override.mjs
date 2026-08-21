import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

export const PRODUCTION_BATCH_OVERRIDE_FORMAT = 1;
export const PRODUCTION_BATCH_OVERRIDE_TYPE = "production_batch_once";
export const PRODUCTION_BATCH_OVERRIDE_MIN_ITEMS = 4;
export const PRODUCTION_BATCH_OVERRIDE_MAX_ITEMS = 25;
export const PRODUCTION_BATCH_OVERRIDE_TTL_MS = 60 * 60 * 1000;
export const PRODUCTION_BATCH_OVERRIDE_STATES = Object.freeze({
  ARMED: "armed",
  CLAIMED: "claimed",
  CONSUMED: "consumed",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
});

const TERMINAL_STATES = new Set([
  PRODUCTION_BATCH_OVERRIDE_STATES.CONSUMED,
  PRODUCTION_BATCH_OVERRIDE_STATES.CANCELLED,
  PRODUCTION_BATCH_OVERRIDE_STATES.EXPIRED,
]);
const ALL_STATES = new Set([
  PRODUCTION_BATCH_OVERRIDE_STATES.ARMED,
  PRODUCTION_BATCH_OVERRIDE_STATES.CLAIMED,
  ...TERMINAL_STATES,
]);
const MAX_HISTORY = 100;
const MUTATION_LOCK_MS = 30_000;

function overrideError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function clean(value, maximum = 240) {
  return String(value ?? "").trim().slice(0, maximum);
}

function validCommit(value) {
  return /^[a-f0-9]{40}$/u.test(clean(value, 40).toLowerCase());
}

function validIso(value) {
  const parsed = Date.parse(clean(value, 50));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function assertMaxRunItems(value) {
  if (
    typeof value !== "number"
    || !Number.isInteger(value)
    || value < PRODUCTION_BATCH_OVERRIDE_MIN_ITEMS
    || value > PRODUCTION_BATCH_OVERRIDE_MAX_ITEMS
  ) {
    throw overrideError(
      "PRODUCTION_BATCH_OVERRIDE_LIMIT_INVALID",
      `Ein One-Shot-Produktionsbatch erlaubt ausschließlich ganze Zahlen zwischen ${PRODUCTION_BATCH_OVERRIDE_MIN_ITEMS} und ${PRODUCTION_BATCH_OVERRIDE_MAX_ITEMS}.`,
    );
  }
  return value;
}

function emptyLedger() {
  return { format: PRODUCTION_BATCH_OVERRIDE_FORMAT, overrides: [] };
}

function normalizeRecord(value) {
  const maxRunItems = Number(value?.maxRunItems);
  const expectedRuntimeCommit = clean(value?.expectedRuntimeCommit, 40).toLowerCase();
  const state = clean(value?.state, 40);
  const rawCounts = [
    value?.selectedCount,
    value?.startedCount,
    value?.completedCount,
    value?.failedCount,
  ];
  const countsValid = rawCounts.every((count) =>
    count === undefined
    || (typeof count === "number" && Number.isInteger(count) && count >= 0));
  const record = {
    overrideId: clean(value?.overrideId, 200),
    type: clean(value?.type, 80),
    maxRunItems,
    createdAt: validIso(value?.createdAt),
    expiresAt: validIso(value?.expiresAt),
    state,
    expectedRuntimeCommit,
    claimedBySchedulerRunId: clean(value?.claimedBySchedulerRunId, 200),
    claimedAt: validIso(value?.claimedAt),
    consumedAt: validIso(value?.consumedAt),
    cancelledAt: validIso(value?.cancelledAt),
    expiredAt: validIso(value?.expiredAt),
    finishedAt: validIso(value?.finishedAt),
    updatedAt: validIso(value?.updatedAt),
    endState: clean(value?.endState, 80),
    cancellationReason: clean(value?.cancellationReason, 240),
    selectedCount: Math.max(0, Math.trunc(Number(value?.selectedCount) || 0)),
    startedCount: Math.max(0, Math.trunc(Number(value?.startedCount) || 0)),
    completedCount: Math.max(0, Math.trunc(Number(value?.completedCount) || 0)),
    failedCount: Math.max(0, Math.trunc(Number(value?.failedCount) || 0)),
    abortReason: clean(value?.abortReason, 500),
  };
  const valid = Boolean(
    record.overrideId
    && record.type === PRODUCTION_BATCH_OVERRIDE_TYPE
    && Number.isInteger(record.maxRunItems)
    && record.maxRunItems >= PRODUCTION_BATCH_OVERRIDE_MIN_ITEMS
    && record.maxRunItems <= PRODUCTION_BATCH_OVERRIDE_MAX_ITEMS
    && record.createdAt
    && record.expiresAt
    && Date.parse(record.expiresAt) > Date.parse(record.createdAt)
    && ALL_STATES.has(record.state)
    && validCommit(record.expectedRuntimeCommit)
    && (record.state !== PRODUCTION_BATCH_OVERRIDE_STATES.CLAIMED || (record.claimedBySchedulerRunId && record.claimedAt))
    && (record.state !== PRODUCTION_BATCH_OVERRIDE_STATES.CONSUMED || (
      record.claimedBySchedulerRunId
      && record.claimedAt
      && record.consumedAt
      && record.finishedAt
      && record.endState
      && countsValid
      && record.selectedCount <= record.maxRunItems
      && record.startedCount <= record.selectedCount
      && record.completedCount + record.failedCount <= record.startedCount
    ))
    && (record.state !== PRODUCTION_BATCH_OVERRIDE_STATES.CANCELLED || record.cancelledAt)
    && (record.state !== PRODUCTION_BATCH_OVERRIDE_STATES.EXPIRED || record.expiredAt)
  );
  return { ...record, valid };
}

function normalizedLedger(value) {
  if (value?.format !== PRODUCTION_BATCH_OVERRIDE_FORMAT || !Array.isArray(value?.overrides)) {
    throw overrideError(
      "PRODUCTION_BATCH_OVERRIDE_CORRUPT",
      "Der persistente One-Shot-Produktionsoverride ist beschädigt oder besitzt ein unbekanntes Format.",
    );
  }
  const overrides = value.overrides.map(normalizeRecord);
  if (overrides.some((record) => !record.valid)) {
    throw overrideError("PRODUCTION_BATCH_OVERRIDE_CORRUPT", "Der persistente One-Shot-Produktionsoverride enthält einen ungültigen Datensatz.");
  }
  return { format: PRODUCTION_BATCH_OVERRIDE_FORMAT, overrides };
}

async function readLedger(path) {
  try {
    return normalizedLedger(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return emptyLedger();
    if (error?.code === "PRODUCTION_BATCH_OVERRIDE_CORRUPT") throw error;
    throw overrideError("PRODUCTION_BATCH_OVERRIDE_CORRUPT", "Der persistente One-Shot-Produktionsoverride ist beschädigt oder nicht lesbar.");
  }
}

async function atomicWrite(path, value, idFactory) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${idFactory()}.tmp`;
  let handle;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.close();
    handle = null;
    await rename(temporaryPath, path);
  } finally {
    await handle?.close();
    await rm(temporaryPath, { force: true });
  }
}

async function readLock(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    return null;
  }
}

async function acquireMutationLock(path, at, idFactory) {
  const lockPath = `${path}.lock`;
  const token = idFactory();
  const record = {
    format: 1,
    token,
    createdAt: at,
    expiresAt: new Date(Date.parse(at) + MUTATION_LOCK_MS).toISOString(),
  };
  await mkdir(dirname(path), { recursive: true });
  const create = async () => {
    const handle = await open(lockPath, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(record), "utf8");
    } finally {
      await handle.close();
    }
  };
  try {
    await create();
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const current = await readLock(lockPath);
    if (!current || Date.parse(current.expiresAt || "") > Date.parse(at)) {
      throw overrideError("PRODUCTION_BATCH_OVERRIDE_LOCKED", "Der One-Shot-Produktionsoverride wird bereits atomar verarbeitet.");
    }
    const stalePath = `${lockPath}.stale-${token}`;
    try {
      await rename(lockPath, stalePath);
      await create();
    } catch (recoveryError) {
      if (recoveryError?.code === "EEXIST" || recoveryError?.code === "ENOENT") {
        throw overrideError("PRODUCTION_BATCH_OVERRIDE_LOCKED", "Der One-Shot-Produktionsoverride wird bereits atomar verarbeitet.");
      }
      throw recoveryError;
    } finally {
      await rm(stalePath, { force: true });
    }
  }
  return async () => {
    const current = await readLock(lockPath);
    if (current?.token === token) await rm(lockPath, { force: true });
  };
}

function latestRecord(ledger) {
  return ledger.overrides.at(-1) || null;
}

function publicStatus(record, now) {
  if (!record) {
    return {
      format: PRODUCTION_BATCH_OVERRIDE_FORMAT,
      exists: false,
      valid: true,
      state: "none",
      fallbackReason: "",
    };
  }
  if (record.state === PRODUCTION_BATCH_OVERRIDE_STATES.ARMED && Date.parse(record.expiresAt) <= Date.parse(now)) {
    return {
      ...record,
      state: PRODUCTION_BATCH_OVERRIDE_STATES.EXPIRED,
      expiredAt: record.expiredAt || now,
      valid: true,
      exists: true,
      fallbackReason: "",
    };
  }
  return { ...record, valid: true, exists: true, fallbackReason: "" };
}

function replaceRecord(ledger, record) {
  return {
    format: PRODUCTION_BATCH_OVERRIDE_FORMAT,
    overrides: [...ledger.overrides.filter((entry) => entry.overrideId !== record.overrideId), record].slice(-MAX_HISTORY),
  };
}

function activeRecord(ledger, now) {
  return [...ledger.overrides].reverse().find((record) => {
    if (record.state === PRODUCTION_BATCH_OVERRIDE_STATES.CLAIMED) return true;
    return record.state === PRODUCTION_BATCH_OVERRIDE_STATES.ARMED && Date.parse(record.expiresAt) > Date.parse(now);
  }) || null;
}

export function createProductionBatchOverrideStore(path, options = {}) {
  const idFactory = options.idFactory || randomUUID;
  const now = options.now || (() => new Date().toISOString());

  async function mutate(operation, at = now()) {
    const release = await acquireMutationLock(path, at, idFactory);
    try {
      const ledger = await readLedger(path);
      const result = await operation(ledger, at);
      if (result.changed) await atomicWrite(path, result.ledger, idFactory);
      return result.value;
    } finally {
      await release();
    }
  }

  return {
    async load(input = {}) {
      const at = validIso(input.now || now()) || now();
      try {
        return publicStatus(latestRecord(await readLedger(path)), at);
      } catch (error) {
        return {
          format: PRODUCTION_BATCH_OVERRIDE_FORMAT,
          exists: false,
          valid: false,
          state: "none",
          fallbackReason: clean(error?.message || "One-Shot-Produktionsoverride ist nicht lesbar.", 500),
        };
      }
    },
    arm(input = {}) {
      const maxRunItems = assertMaxRunItems(input.maxRunItems);
      const expectedRuntimeCommit = clean(input.expectedRuntimeCommit, 40).toLowerCase();
      if (!validCommit(expectedRuntimeCommit)) {
        throw overrideError("PRODUCTION_BATCH_OVERRIDE_RUNTIME_INVALID", "Der One-Shot-Produktionsoverride benötigt einen exakten Runtime-Commit.");
      }
      return mutate(async (ledger, at) => {
        const existing = activeRecord(ledger, at);
        if (existing) {
          throw overrideError(
            "PRODUCTION_BATCH_OVERRIDE_ALREADY_EXISTS",
            "Es existiert bereits ein nicht verbrauchter One-Shot-Produktionsoverride.",
            { overrideId: existing.overrideId, state: existing.state },
          );
        }
        let nextLedger = ledger;
        const latest = latestRecord(ledger);
        if (latest?.state === PRODUCTION_BATCH_OVERRIDE_STATES.ARMED && Date.parse(latest.expiresAt) <= Date.parse(at)) {
          const expired = { ...latest, state: PRODUCTION_BATCH_OVERRIDE_STATES.EXPIRED, expiredAt: at, updatedAt: at };
          nextLedger = replaceRecord(nextLedger, expired);
        }
        const record = normalizeRecord({
          overrideId: `production-batch-override:${idFactory()}`,
          type: PRODUCTION_BATCH_OVERRIDE_TYPE,
          maxRunItems,
          createdAt: at,
          expiresAt: new Date(Date.parse(at) + PRODUCTION_BATCH_OVERRIDE_TTL_MS).toISOString(),
          state: PRODUCTION_BATCH_OVERRIDE_STATES.ARMED,
          expectedRuntimeCommit,
          updatedAt: at,
        });
        return { changed: true, ledger: replaceRecord(nextLedger, record), value: publicStatus(record, at) };
      });
    },
    claim(input = {}) {
      const schedulerRunId = clean(input.schedulerRunId, 200);
      const runningRuntimeCommit = clean(input.runningRuntimeCommit, 40).toLowerCase();
      const claimAt = validIso(input.now) || now();
      if (!schedulerRunId || !validCommit(runningRuntimeCommit)) {
        throw overrideError("PRODUCTION_BATCH_OVERRIDE_CLAIM_INVALID", "Der One-Shot-Claim benötigt Schedulerlauf und Runtime-Commit.");
      }
      return mutate(async (ledger, at) => {
        const record = [...ledger.overrides].reverse().find((entry) => entry.state === PRODUCTION_BATCH_OVERRIDE_STATES.ARMED) || null;
        if (!record) return { changed: false, ledger, value: { claimed: false, blocking: false, reason: "no-armed-override", record: null } };
        if (Date.parse(record.expiresAt) <= Date.parse(at)) {
          const expired = { ...record, state: PRODUCTION_BATCH_OVERRIDE_STATES.EXPIRED, expiredAt: at, updatedAt: at };
          return { changed: true, ledger: replaceRecord(ledger, expired), value: { claimed: false, blocking: false, reason: "override-expired", record: expired } };
        }
        if (record.expectedRuntimeCommit !== runningRuntimeCommit) {
          const cancelled = {
            ...record,
            state: PRODUCTION_BATCH_OVERRIDE_STATES.CANCELLED,
            cancelledAt: at,
            cancellationReason: "runtime_mismatch",
            updatedAt: at,
          };
          return {
            changed: true,
            ledger: replaceRecord(ledger, cancelled),
            value: { claimed: false, blocking: true, reason: "runtime_mismatch", record: cancelled },
          };
        }
        const claimed = {
          ...record,
          state: PRODUCTION_BATCH_OVERRIDE_STATES.CLAIMED,
          claimedBySchedulerRunId: schedulerRunId,
          claimedAt: at,
          updatedAt: at,
        };
        return { changed: true, ledger: replaceRecord(ledger, claimed), value: { claimed: true, blocking: false, reason: "", record: claimed } };
      }, claimAt);
    },
    consume(input = {}) {
      const overrideId = clean(input.overrideId, 200);
      const schedulerRunId = clean(input.schedulerRunId, 200);
      return mutate(async (ledger, at) => {
        const record = ledger.overrides.find((entry) => entry.overrideId === overrideId);
        if (!record || record.state !== PRODUCTION_BATCH_OVERRIDE_STATES.CLAIMED || record.claimedBySchedulerRunId !== schedulerRunId) {
          throw overrideError("PRODUCTION_BATCH_OVERRIDE_CONSUME_MISMATCH", "Der One-Shot-Produktionsoverride gehört nicht eindeutig zu diesem Schedulerlauf.");
        }
        const selectedCount = Math.max(0, Math.trunc(Number(input.selectedCount) || 0));
        const startedCount = Math.max(0, Math.trunc(Number(input.startedCount) || 0));
        const completedCount = Math.max(0, Math.trunc(Number(input.completedCount) || 0));
        const failedCount = Math.max(0, Math.trunc(Number(input.failedCount) || 0));
        if (
          selectedCount > record.maxRunItems
          || startedCount > selectedCount
          || completedCount + failedCount > startedCount
        ) {
          throw overrideError("PRODUCTION_BATCH_OVERRIDE_COUNTS_INVALID", "Die Abschlusszählwerte des One-Shot-Produktionsbatches sind inkonsistent.");
        }
        const consumed = {
          ...record,
          state: PRODUCTION_BATCH_OVERRIDE_STATES.CONSUMED,
          consumedAt: at,
          finishedAt: validIso(input.finishedAt) || at,
          endState: clean(input.endState, 80),
          selectedCount,
          startedCount,
          completedCount,
          failedCount,
          abortReason: clean(input.abortReason, 500),
          updatedAt: at,
        };
        return { changed: true, ledger: replaceRecord(ledger, consumed), value: publicStatus(consumed, at) };
      });
    },
    cancel() {
      return mutate(async (ledger, at) => {
        const record = [...ledger.overrides].reverse().find((entry) => entry.state === PRODUCTION_BATCH_OVERRIDE_STATES.ARMED) || null;
        if (!record) throw overrideError("PRODUCTION_BATCH_OVERRIDE_NOT_ARMED", "Es existiert kein abbrechbarer armed One-Shot-Produktionsoverride.");
        if (Date.parse(record.expiresAt) <= Date.parse(at)) {
          const expired = { ...record, state: PRODUCTION_BATCH_OVERRIDE_STATES.EXPIRED, expiredAt: at, updatedAt: at };
          return { changed: true, ledger: replaceRecord(ledger, expired), value: publicStatus(expired, at) };
        }
        const cancelled = { ...record, state: PRODUCTION_BATCH_OVERRIDE_STATES.CANCELLED, cancelledAt: at, cancellationReason: "operator_cancelled", updatedAt: at };
        return { changed: true, ledger: replaceRecord(ledger, cancelled), value: publicStatus(cancelled, at) };
      });
    },
    async authorize(input = {}) {
      const overrideId = clean(input.overrideId, 200);
      const schedulerRunId = clean(input.schedulerRunId, 200);
      const runningRuntimeCommit = clean(input.runningRuntimeCommit, 40).toLowerCase();
      try {
        const ledger = await readLedger(path);
        const record = ledger.overrides.find((entry) => entry.overrideId === overrideId);
        const valid = Boolean(
          record
          && new Set([PRODUCTION_BATCH_OVERRIDE_STATES.CLAIMED, PRODUCTION_BATCH_OVERRIDE_STATES.CONSUMED]).has(record.state)
          && record.claimedBySchedulerRunId === schedulerRunId
          && record.expectedRuntimeCommit === runningRuntimeCommit
          && validCommit(runningRuntimeCommit)
        );
        return {
          valid,
          record: record || null,
          reason: valid ? "" : "Der One-Shot-Produktionsbatch besitzt keine passende persistente Runtime-/Scheduler-Provenienz.",
        };
      } catch (error) {
        return { valid: false, record: null, reason: clean(error?.message, 500) };
      }
    },
  };
}
