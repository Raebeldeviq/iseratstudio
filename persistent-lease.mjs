import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

function parsedTimestamp(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

async function readLease(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return null;
    throw error;
  }
}

export function createPersistentLease(path, options = {}) {
  const leaseMs = Math.max(1_000, Number(options.leaseMs) || 30 * 60 * 1000);
  const heartbeatMs = Math.max(1_000, Math.min(leaseMs / 3, Number(options.heartbeatMs) || leaseMs / 3));
  const idFactory = options.idFactory || (() => globalThis.crypto.randomUUID());

  async function tryCreate(record) {
    const handle = await open(path, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(record), "utf8");
    } finally {
      await handle.close();
    }
  }

  return {
    async acquire(input = {}) {
      const now = String(input.now || new Date().toISOString());
      const record = {
        format: 1,
        token: String(input.token || idFactory()),
        ownerId: String(input.ownerId || process.pid),
        startedAt: now,
        expiresAt: new Date(Date.parse(now) + leaseMs).toISOString(),
      };
      await mkdir(dirname(path), { recursive: true });
      try {
        await tryCreate(record);
      } catch (error) {
        if (!error || typeof error !== "object" || error.code !== "EEXIST") throw error;
        const current = await readLease(path);
        const currentExpiry = parsedTimestamp(current?.expiresAt)
          || parsedTimestamp(current?.startedAt) + leaseMs;
        if (current && currentExpiry > Date.parse(now)) {
          const locked = new Error("Der Inserat-Scheduler wird bereits von einem anderen Helper-Lauf ausgeführt.");
          locked.code = "LISTING_SCHEDULER_LOCKED";
          locked.current = current;
          throw locked;
        }
        const stalePath = `${path}.stale-${record.token}`;
        try {
          await rename(path, stalePath);
        } catch (renameError) {
          if (!renameError || typeof renameError !== "object" || renameError.code !== "ENOENT") throw renameError;
        }
        try {
          await tryCreate(record);
        } finally {
          await rm(stalePath, { force: true });
        }
      }

      let released = false;
      let heartbeatError = null;
      async function refresh(inputValue = {}) {
        if (released) throw new Error("Der Inserat-Scheduler-Claim wurde bereits freigegeben.");
        if (heartbeatError) throw heartbeatError;
        const refreshedAt = String(inputValue.now || new Date().toISOString());
        const handle = await open(path, "r+");
        try {
          const current = JSON.parse(await handle.readFile("utf8"));
          if (current?.token !== record.token) {
            const lost = new Error("Der Inserat-Scheduler hat seinen persistenten Claim verloren.");
            lost.code = "LISTING_SCHEDULER_LOCK_LOST";
            throw lost;
          }
          const refreshed = {
            ...current,
            updatedAt: refreshedAt,
            expiresAt: new Date(Date.parse(refreshedAt) + leaseMs).toISOString(),
          };
          await handle.truncate(0);
          await handle.write(JSON.stringify(refreshed), 0, "utf8");
          Object.assign(record, refreshed);
          return refreshed;
        } finally {
          await handle.close();
        }
      }
      const heartbeat = setInterval(() => {
        void refresh().catch((error) => {
          heartbeatError = error instanceof Error ? error : new Error("Der Scheduler-Claim konnte nicht erneuert werden.");
        });
      }, heartbeatMs);
      heartbeat.unref();
      return {
        record,
        refresh,
        async release() {
          if (released) return;
          released = true;
          clearInterval(heartbeat);
          const current = await readLease(path);
          if (current?.token === record.token) await rm(path, { force: true });
        },
      };
    },
    read() {
      return readLease(path);
    },
  };
}
