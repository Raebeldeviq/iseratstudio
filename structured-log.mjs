import { appendFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";

const SENSITIVE_KEY = /password|passwort|token|cookie|secret|authorization|credential|api.?key/iu;

function redactedString(value) {
  return String(value)
    .replace(/\bsk-[a-zA-Z0-9_-]{12,}\b/gu, "[REDACTED]")
    .replace(/\bBearer\s+[a-zA-Z0-9._~+\/-]+=*/giu, "Bearer [REDACTED]")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/giu, "$1[REDACTED]@")
    .replace(/\b(password|passwort|token|secret|api.?key)\s*[=:]\s*[^\s,;]+/giu, "$1=[REDACTED]");
}

function safeValue(value, depth = 0) {
  if (typeof value === "string") return redactedString(value).slice(0, 500);
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 4) return "[TRUNCATED]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => safeValue(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !SENSITIVE_KEY.test(key))
      .slice(0, 100)
      .map(([key, item]) => [key, safeValue(item, depth + 1)]));
  }
  return String(value).slice(0, 500);
}

function safeDetails(details) {
  return Object.fromEntries(Object.entries(details || {})
    .filter(([key]) => !SENSITIVE_KEY.test(key))
    .map(([key, value]) => [key, safeValue(value)]));
}

export function createStructuredFileLogger(path, options = {}) {
  const maximumBytes = Number(options.maximumBytes) > 0 ? Number(options.maximumBytes) : 5 * 1024 * 1024;
  const defaultJobType = String(options.jobType || "local-helper").slice(0, 100);
  let queue = Promise.resolve();

  return async function writeStructuredLog(event, details = {}) {
    const write = async () => {
      await mkdir(dirname(path), { recursive: true });
      try {
        if ((await stat(path)).size >= maximumBytes) {
          const previous = `${path}.previous`;
          await rm(previous, { force: true });
          await rename(path, previous);
        }
      } catch (error) {
        if (!error || typeof error !== "object" || error.code !== "ENOENT") throw error;
      }
      const sanitized = safeDetails(details);
      const record = {
        ...sanitized,
        timestamp: new Date().toISOString(),
        processId: process.pid,
        jobId: String(sanitized.jobId || "").slice(0, 500),
        listingId: String(sanitized.listingId || "").slice(0, 160),
        projectId: String(sanitized.projectId || "").slice(0, 160),
        jobType: String(sanitized.jobType || defaultJobType).slice(0, 100),
        status: String(sanitized.status || event).slice(0, 100),
        errorCode: String(sanitized.errorCode || "").slice(0, 100),
        message: String(sanitized.message || "").slice(0, 500),
        event: String(event).slice(0, 100),
      };
      await appendFile(path, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
      return record;
    };
    const result = queue.then(write, write);
    queue = result.catch(() => undefined);
    return result;
  };
}
