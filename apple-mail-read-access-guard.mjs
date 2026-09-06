const DEFAULT_MAX_QUEUED_CALLS = 16;
const DEFAULT_QUEUE_WAIT_TIMEOUT_MS = 50_000;

function guardError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function createAppleMailReadAccessGuard(options = {}) {
  const maxQueuedCalls = positiveInteger(options.maxQueuedCalls, DEFAULT_MAX_QUEUED_CALLS);
  const defaultWaitTimeoutMs = positiveInteger(options.waitTimeoutMs, DEFAULT_QUEUE_WAIT_TIMEOUT_MS);
  const queue = [];
  let activeOperation = "";

  function drain() {
    if (activeOperation || queue.length === 0) return;
    const entry = queue.shift();
    clearTimeout(entry.waitTimer);
    activeOperation = entry.operation;
    Promise.resolve()
      .then(entry.callback)
      .then(entry.resolve, entry.reject)
      .finally(() => {
        activeOperation = "";
        queueMicrotask(drain);
      });
  }

  function run(callback, runOptions = {}) {
    if (typeof callback !== "function") throw new TypeError("Der Apple-Mail-Guard benötigt eine ausführbare read-only Operation.");
    const operation = String(runOptions.operation || "apple-mail-read").trim() || "apple-mail-read";
    const waitTimeoutMs = positiveInteger(runOptions.waitTimeoutMs, defaultWaitTimeoutMs);
    if (activeOperation && queue.length >= maxQueuedCalls) {
      return Promise.reject(guardError(
        "MAIL_AUTOMATION_QUEUE_FULL",
        "Die begrenzte Apple-Mail-Warteschlange ist ausgelastet.",
        { activeOperation, operation, maxQueuedCalls },
      ));
    }
    return new Promise((resolve, reject) => {
      const entry = {
        callback,
        operation,
        resolve,
        reject,
        waitTimer: null,
      };
      entry.waitTimer = setTimeout(() => {
        const index = queue.indexOf(entry);
        if (index < 0) return;
        queue.splice(index, 1);
        reject(guardError(
          "MAIL_AUTOMATION_QUEUE_TIMEOUT",
          "Die read-only Apple-Mail-Abfrage konnte den prozessweiten Zugriff nicht rechtzeitig übernehmen.",
          { activeOperation, operation, waitTimeoutMs },
        ));
      }, waitTimeoutMs);
      queue.push(entry);
      drain();
    });
  }

  return Object.freeze({
    run,
    inspect() {
      return Object.freeze({
        active: Boolean(activeOperation),
        activeOperation,
        queuedCalls: queue.length,
        maxQueuedCalls,
        defaultWaitTimeoutMs,
      });
    },
  });
}

export const sharedAppleMailReadAccessGuard = createAppleMailReadAccessGuard();
