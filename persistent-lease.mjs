import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

const pathMutationChains = new Map();

function parsedTimestamp(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function ownerPid(record) {
  const explicit = Number(record?.ownerPid);
  if (Number.isSafeInteger(explicit) && explicit > 0) return explicit;
  const match = String(record?.ownerId || "").match(/:(\d+)$/u);
  const inferred = Number(match?.[1]);
  return Number.isSafeInteger(inferred) && inferred > 0 ? inferred : 0;
}

function processIsActive(pid) {
  if (!pid) return null;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    return null;
  }
}

function leaseError(code, message, current = null) {
  const error = new Error(message);
  error.code = code;
  if (current) error.current = current;
  return error;
}

function lockedError(current, reason = "") {
  return leaseError(
    "LISTING_SCHEDULER_LOCKED",
    reason || "Der Inserat-Scheduler wird bereits von einem anderen Helper-Lauf ausgeführt.",
    current,
  );
}

function lostError(current = null, reason = "") {
  return leaseError(
    "LISTING_SCHEDULER_LOCK_LOST",
    reason || "Der Inserat-Scheduler hat seinen persistenten Claim verloren.",
    current,
  );
}

function sameOwnership(current, expected) {
  return Boolean(current)
    && current.token === expected.token
    && String(current.schedulerRunId || current.token || "") === String(expected.schedulerRunId || expected.token || "")
    && String(current.ownerId || "") === String(expected.ownerId || "")
    && String(current.runtimeIdentity || "") === String(expected.runtimeIdentity || "")
    && Number(current.leaseVersion || 1) === Number(expected.leaseVersion || 1);
}

function sameRevision(current, expected) {
  return sameOwnership(current, expected)
    && Number(current.revision || 0) === Number(expected.revision || 0)
    && String(current.expiresAt || "") === String(expected.expiresAt || "");
}

async function serializedPathMutation(path, operation) {
  const previous = pathMutationChains.get(path) || Promise.resolve();
  const current = previous.then(operation, operation);
  const settled = current.then(() => undefined, () => undefined);
  pathMutationChains.set(path, settled);
  try {
    return await current;
  } finally {
    if (pathMutationChains.get(path) === settled) pathMutationChains.delete(path);
  }
}

async function readLease(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeNewLease(path, record) {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(record), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function replaceLeaseAtomically(path, record) {
  const temporaryPath = `${path}.next-${record.token}-${record.revision}`;
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(record), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function acquireRecoveryGate(path, input = {}) {
  const gatePath = `${path}.recovery`;
  const gate = {
    format: 1,
    token: String(input.token || globalThis.crypto.randomUUID()),
    ownerPid: process.pid,
    createdAt: String(input.now || new Date().toISOString()),
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await writeNewLease(gatePath, gate);
      return {
        async release() {
          const current = await readLease(gatePath);
          if (current?.token !== gate.token || Number(current.ownerPid) !== gate.ownerPid) {
            throw lostError(current, "Der Scheduler-Recovery-Claim wurde unerwartet ersetzt.");
          }
          await rm(gatePath);
        },
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const current = await readLease(gatePath);
      const active = processIsActive(ownerPid(current));
      if (active !== false) {
        throw lockedError(
          current,
          active === true
            ? "Eine atomare Scheduler-Recovery wird bereits von einem aktiven Prozess ausgeführt."
            : "Der Owner des Scheduler-Recovery-Claims ist unklar; die Recovery bleibt fail-closed gesperrt.",
        );
      }
      const stalePath = `${gatePath}.stale-${gate.token}`;
      try {
        await rename(gatePath, stalePath);
        await rm(stalePath, { force: true });
      } catch (renameError) {
        if (renameError?.code !== "ENOENT") throw renameError;
      }
    }
  }
  throw lockedError(null, "Der atomare Scheduler-Recovery-Claim konnte nicht eindeutig erworben werden.");
}

async function withRecoveryGate(path, input, operation) {
  const gate = await acquireRecoveryGate(path, input);
  try {
    return await operation();
  } finally {
    await gate.release();
  }
}

export function createPersistentLease(path, options = {}) {
  const leaseMs = Math.max(1_000, Number(options.leaseMs) || 30 * 60 * 1000);
  const heartbeatMs = Math.max(1_000, Math.min(leaseMs / 3, Number(options.heartbeatMs) || leaseMs / 3));
  const idFactory = options.idFactory || (() => globalThis.crypto.randomUUID());
  const ownerActivity = options.isOwnerActive || ((record) => processIsActive(ownerPid(record)));
  const assessStaleOwner = options.assessStaleOwner;
  const writeEvent = options.writeEvent || (async () => undefined);

  return {
    async acquire(input = {}) {
      return serializedPathMutation(path, async () => {
        const now = String(input.now || new Date().toISOString());
        const nowTimestamp = parsedTimestamp(now);
        if (!nowTimestamp) throw leaseError("LISTING_SCHEDULER_LEASE_TIME_INVALID", "Der Scheduler-Claim besitzt keinen gültigen Startzeitpunkt.");
        const token = String(input.token || idFactory());
        const record = {
          format: 2,
          leaseVersion: 1,
          revision: 0,
          token,
          schedulerRunId: String(input.schedulerRunId || token),
          ownerId: String(input.ownerId || process.pid),
          ownerPid: Number(input.ownerPid) || process.pid,
          runtimeIdentity: String(input.runtimeIdentity || `process:${process.pid}`),
          startedAt: now,
          updatedAt: now,
          expiresAt: new Date(nowTimestamp + leaseMs).toISOString(),
        };
        await mkdir(dirname(path), { recursive: true });
        try {
          await writeNewLease(path, record);
        } catch (error) {
          if (!error || typeof error !== "object" || error.code !== "EEXIST") throw error;
          await withRecoveryGate(path, { token: record.token, now }, async () => {
            const current = await readLease(path);
            if (!current) {
              throw lockedError(null, "Der Scheduler-Lock änderte sich während des atomaren Acquire; der Lauf bleibt fail-closed gesperrt.");
            }
            const currentExpiry = parsedTimestamp(current.expiresAt)
              || parsedTimestamp(current.updatedAt || current.startedAt) + leaseMs;
            if (currentExpiry > nowTimestamp) throw lockedError(current);

            const active = await ownerActivity(current);
            if (active !== false) {
              throw lockedError(
                current,
                active === true
                  ? "Der abgelaufene Scheduler-Lock gehört weiterhin einem aktiven Helper-Prozess und darf nicht übernommen werden."
                  : "Die Aktivität des bisherigen Scheduler-Owners ist unklar; die Stale-Recovery bleibt fail-closed gesperrt.",
              );
            }

            const staleAssessment = await (input.assessStaleOwner || assessStaleOwner)?.(current, record);
            if (staleAssessment?.recoverable !== true) {
              throw lockedError(
                current,
                staleAssessment?.reason
                  || "Der bisherige Scheduler-Run ist persistent nicht eindeutig als stale nachgewiesen; die Recovery bleibt gesperrt.",
              );
            }

            const latest = await readLease(path);
            if (!latest || !sameRevision(latest, current)) {
              throw lockedError(latest, "Der Scheduler-Lock wurde parallel erneuert oder ersetzt; eine Stale-Übernahme ist nicht zulässig.");
            }
            await writeEvent("stale-recovery-authorized", {
              previousSchedulerRunId: String(current.schedulerRunId || current.token || ""),
              previousOwnerId: String(current.ownerId || ""),
              previousOwnerPid: ownerPid(current) || null,
              previousRuntimeIdentity: String(current.runtimeIdentity || ""),
              previousExpiresAt: String(current.expiresAt || ""),
              recoveryReason: String(staleAssessment.reason || "Owner inaktiv, Lease abgelaufen und persistenter Run geprüft."),
            });
            await replaceLeaseAtomically(path, record);
            await writeEvent("stale-recovered", {
              schedulerRunId: record.schedulerRunId,
              ownerId: record.ownerId,
              ownerPid: record.ownerPid,
              runtimeIdentity: record.runtimeIdentity,
              recoveredPreviousSchedulerRunId: String(current.schedulerRunId || current.token || ""),
            });
          });
        }

        let released = false;
        let heartbeatError = null;
        let heartbeat;

        async function refresh(inputValue = {}) {
          if (released) {
            throw leaseError("LISTING_SCHEDULER_LOCK_RELEASED", "Der Inserat-Scheduler-Claim wurde bereits freigegeben.");
          }
          if (heartbeatError) throw heartbeatError;
          return serializedPathMutation(path, async () => {
            const current = await readLease(path);
            if (!current) {
              throw lostError(null, "Der aktive Scheduler-Owner erwartet seinen Lock, die authoritative Lockdatei fehlt jedoch.");
            }
            if (!sameOwnership(current, record)) throw lostError(current);

            const requestedAt = String(inputValue.now || new Date().toISOString());
            const requestedTimestamp = parsedTimestamp(requestedAt);
            if (!requestedTimestamp) {
              throw leaseError("LISTING_SCHEDULER_LEASE_TIME_INVALID", "Die Scheduler-Lease kann nicht mit einem ungültigen Zeitpunkt erneuert werden.");
            }
            const currentUpdatedAt = parsedTimestamp(current.updatedAt || current.startedAt);
            const effectiveUpdatedAt = Math.max(requestedTimestamp, currentUpdatedAt);
            const currentExpiry = parsedTimestamp(current.expiresAt);
            const refreshed = {
              ...current,
              revision: Number(current.revision || 0) + 1,
              updatedAt: new Date(effectiveUpdatedAt).toISOString(),
              expiresAt: new Date(Math.max(currentExpiry, effectiveUpdatedAt + leaseMs)).toISOString(),
            };
            await replaceLeaseAtomically(path, refreshed);
            Object.assign(record, refreshed);
            return refreshed;
          });
        }

        heartbeat = setInterval(() => {
          void refresh().catch(async (error) => {
            heartbeatError = error instanceof Error
              ? error
              : lostError(null, "Der Scheduler-Claim konnte nicht erneuert werden.");
            clearInterval(heartbeat);
            await writeEvent("heartbeat-failed", {
              schedulerRunId: record.schedulerRunId,
              ownerId: record.ownerId,
              errorCode: String(heartbeatError.code || "LISTING_SCHEDULER_HEARTBEAT_FAILED"),
              message: heartbeatError.message,
            }).catch(() => undefined);
          });
        }, heartbeatMs);
        heartbeat.unref();

        return {
          record,
          refresh,
          async release() {
            if (released) return { released: false, alreadyReleased: true };
            clearInterval(heartbeat);
            return serializedPathMutation(path, async () => {
              const current = await readLease(path);
              if (!current) {
                throw lostError(null, "Der aktive Scheduler-Owner kann seinen Lock nicht freigeben, weil die authoritative Lockdatei fehlt.");
              }
              if (!sameOwnership(current, record)) throw lostError(current);
              try {
                await rm(path);
              } catch (error) {
                if (error?.code === "ENOENT") {
                  throw lostError(null, "Der Scheduler-Lock verschwand während der Owner-Freigabe.");
                }
                throw error;
              }
              released = true;
              return { released: true, alreadyReleased: false };
            });
          },
        };
      });
    },
    read() {
      return readLease(path);
    },
    async reconcileStale(input = {}) {
      return serializedPathMutation(path, async () => {
        const initial = await readLease(path);
        if (!initial) return { reconciled: false, reason: "lock-not-present" };
        const gateToken = String(input.reconciliationId || idFactory());
        return withRecoveryGate(path, { token: gateToken, now: input.now }, async () => {
          const current = await readLease(path);
          if (!current) return { reconciled: false, reason: "lock-not-present" };
          const expectedSchedulerRunId = String(input.expectedSchedulerRunId || "");
          const expectedOwnerId = String(input.expectedOwnerId || "");
          if (!expectedSchedulerRunId || !expectedOwnerId) {
            throw lockedError(current, "Eine Stale-Reconciliation verlangt den exakten erwarteten Scheduler-Run und Owner.");
          }
          if (
            String(current.schedulerRunId || current.token || "") !== expectedSchedulerRunId
            || String(current.ownerId || "") !== expectedOwnerId
          ) {
            throw lockedError(current, "Der vorhandene Scheduler-Lock stimmt nicht mit dem exakt freigegebenen Stale-Reconciliation-Vertrag überein.");
          }
          const now = String(input.now || new Date().toISOString());
          const nowTimestamp = parsedTimestamp(now);
          const currentExpiry = parsedTimestamp(current.expiresAt)
            || parsedTimestamp(current.updatedAt || current.startedAt) + leaseMs;
          if (!nowTimestamp || currentExpiry > nowTimestamp) {
            throw lockedError(current, "Der Scheduler-Lock ist nicht eindeutig abgelaufen.");
          }
          const active = await ownerActivity(current);
          if (active !== false) {
            throw lockedError(
              current,
              active === true
                ? "Der Scheduler-Lock gehört weiterhin einem aktiven Helper-Prozess."
                : "Die Aktivität des Scheduler-Owners ist unklar; der Lock bleibt fail-closed bestehen.",
            );
          }
          const staleAssessment = await (input.assessStaleOwner || assessStaleOwner)?.(current, null);
          if (staleAssessment?.recoverable !== true) {
            throw lockedError(
              current,
              staleAssessment?.reason || "Der persistente Scheduler-Run ist nicht eindeutig als stale nachgewiesen.",
            );
          }
          const latest = await readLease(path);
          if (!latest || !sameRevision(latest, current)) {
            throw lockedError(latest, "Der Scheduler-Lock wurde parallel erneuert oder ersetzt; die Reconciliation ist gesperrt.");
          }
          await writeEvent("stale-removal-authorized", {
            previousSchedulerRunId: expectedSchedulerRunId,
            previousOwnerId: expectedOwnerId,
            previousOwnerPid: ownerPid(current) || null,
            previousRuntimeIdentity: String(current.runtimeIdentity || ""),
            previousExpiresAt: String(current.expiresAt || ""),
            reconciliationReason: String(staleAssessment.reason || "Owner inaktiv, Lease abgelaufen und persistenter Run geprüft."),
          });
          await rm(path);
          await writeEvent("stale-removed", {
            previousSchedulerRunId: expectedSchedulerRunId,
            previousOwnerId: expectedOwnerId,
            previousExpiresAt: String(current.expiresAt || ""),
            reconciledAt: now,
          });
          return {
            reconciled: true,
            schedulerRunId: expectedSchedulerRunId,
            ownerId: expectedOwnerId,
            previousExpiresAt: String(current.expiresAt || ""),
            reconciledAt: now,
            reason: String(staleAssessment.reason || "stale-lock-reconciled"),
          };
        });
      });
    },
  };
}
