import assert from "node:assert/strict";
import test from "node:test";

import { createAppleMailReadAccessGuard } from "../apple-mail-read-access-guard.mjs";
import { createAppleMailAutomationRunner } from "../apple-mail-import-report-adapter.mjs";
import { createAppleMailDeleteAutomationRunner } from "../apple-mail-live-canary-delete-report-adapter.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function invalidConnectionError() {
  return Object.assign(new Error("AppleScript execution error: Die Verbindung ist ungültig. (-609)"), {
    code: 1,
    stderr: "execution error: Die Verbindung ist ungültig. (-609)",
  });
}

test("lifecycle and background Mail reads share one process-wide FIFO guard", async () => {
  const guard = createAppleMailReadAccessGuard({ waitTimeoutMs: 1_000 });
  const firstGate = deferred();
  const entered = [];
  let active = 0;
  let maxActive = 0;
  const execute = async (_file, args) => {
    const operation = /FPI_OPERATION:([A-Z_]+)/u.exec(args[1])?.[1];
    entered.push(operation);
    active += 1;
    maxActive = Math.max(maxActive, active);
    if (operation === "LIFECYCLE_IMPORT_READ") await firstGate.promise;
    active -= 1;
    return { stdout: operation === "LIFECYCLE_IMPORT_READ" ? "FPI_OK\tconfirmed" : "background", stderr: "" };
  };
  const lifecycleRunner = createAppleMailAutomationRunner({ accessGuard: guard, execute, retryDelaysMs: [] });
  const backgroundRunner = createAppleMailDeleteAutomationRunner({ accessGuard: guard, execute, retryDelaysMs: [] });

  const lifecycle = lifecycleRunner("-- FPI_OPERATION:LIFECYCLE_IMPORT_READ", []);
  await new Promise((resolve) => setImmediate(resolve));
  const background = backgroundRunner("-- FPI_OPERATION:BACKGROUND_DELETE_READ", []);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(guard.inspect().activeOperation, "LIFECYCLE_IMPORT_READ");
  assert.equal(guard.inspect().queuedCalls, 1);
  firstGate.resolve();
  assert.equal(await lifecycle, "confirmed");
  assert.equal(await background, "background");
  assert.equal(maxActive, 1);
  assert.deepEqual(entered, ["LIFECYCLE_IMPORT_READ", "BACKGROUND_DELETE_READ"]);
});

test("a lifecycle Mail read waits bounded behind a background read", async () => {
  const guard = createAppleMailReadAccessGuard({ waitTimeoutMs: 1_000 });
  const firstGate = deferred();
  const entered = [];
  const execute = async (_file, args) => {
    const operation = /FPI_OPERATION:([A-Z_]+)/u.exec(args[1])?.[1];
    entered.push(operation);
    if (operation === "BACKGROUND_IMPORT_READ") await firstGate.promise;
    return { stdout: operation === "LIFECYCLE_DELETE_READ" ? "lifecycle" : "FPI_OK\tbackground", stderr: "" };
  };
  const backgroundRunner = createAppleMailAutomationRunner({ accessGuard: guard, execute, retryDelaysMs: [] });
  const lifecycleRunner = createAppleMailDeleteAutomationRunner({ accessGuard: guard, execute, retryDelaysMs: [] });

  const background = backgroundRunner("-- FPI_OPERATION:BACKGROUND_IMPORT_READ", []);
  await new Promise((resolve) => setImmediate(resolve));
  const lifecycle = lifecycleRunner("-- FPI_OPERATION:LIFECYCLE_DELETE_READ", []);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(entered, ["BACKGROUND_IMPORT_READ"]);
  firstGate.resolve();
  assert.equal(await background, "background");
  assert.equal(await lifecycle, "lifecycle");
  assert.deepEqual(entered, ["BACKGROUND_IMPORT_READ", "LIFECYCLE_DELETE_READ"]);
});

test("exceptions and bounded queue timeouts cannot leave the guard locked", async () => {
  const guard = createAppleMailReadAccessGuard({ waitTimeoutMs: 10 });
  await assert.rejects(
    guard.run(async () => { throw new Error("synthetic failure"); }, { operation: "failed-read" }),
    /synthetic failure/u,
  );
  assert.equal(await guard.run(async () => "released", { operation: "next-read" }), "released");

  const gate = deferred();
  let queuedExecuted = false;
  const active = guard.run(() => gate.promise, { operation: "active" });
  await assert.rejects(
    guard.run(() => { queuedExecuted = true; }, { operation: "queued" }),
    (error) => error.code === "MAIL_AUTOMATION_QUEUE_TIMEOUT" && error.operation === "queued",
  );
  gate.resolve();
  await active;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(queuedExecuted, false);
  assert.equal(guard.inspect().active, false);
  assert.equal(guard.inspect().queuedCalls, 0);
});

test("exact -609 retries only the read and never replays lifecycle transfers", async () => {
  let readAttempts = 0;
  let ftpsTransfers = 0;
  let deleteTransfers = 0;
  const sleepCalls = [];
  const runner = createAppleMailAutomationRunner({
    accessGuard: createAppleMailReadAccessGuard(),
    retryDelaysMs: [5, 10],
    sleep: async (milliseconds) => { sleepCalls.push(milliseconds); },
    execute: async () => {
      readAttempts += 1;
      if (readAttempts === 1) throw invalidConnectionError();
      return { stdout: "FPI_OK\tpositive-provider-report", stderr: "" };
    },
  });

  ftpsTransfers += 1;
  deleteTransfers += 1;
  assert.equal(await runner("-- FPI_OPERATION:READ_CONFIRMATION", []), "positive-provider-report");
  assert.equal(readAttempts, 2);
  assert.deepEqual(sleepCalls, [5]);
  assert.equal(ftpsTransfers, 1);
  assert.equal(deleteTransfers, 1);
});

test("exact -609 exhausts after three reads and unknown failures are not retried", async () => {
  let invalidAttempts = 0;
  const invalidRunner = createAppleMailAutomationRunner({
    accessGuard: createAppleMailReadAccessGuard(),
    retryDelaysMs: [0, 0],
    sleep: async () => {},
    execute: async () => {
      invalidAttempts += 1;
      throw invalidConnectionError();
    },
  });
  await assert.rejects(
    invalidRunner("-- FPI_OPERATION:READ_CONFIRMATION", []),
    (error) => error.code === "MAIL_AUTOMATION_UNAVAILABLE"
      && error.appleEventErrorNumber === -609
      && error.retryableReadOnly === true,
  );
  assert.equal(invalidAttempts, 3);

  let unknownAttempts = 0;
  const unknownRunner = createAppleMailAutomationRunner({
    accessGuard: createAppleMailReadAccessGuard(),
    retryDelaysMs: [0, 0],
    sleep: async () => assert.fail("unknown errors must not sleep or retry"),
    execute: async () => {
      unknownAttempts += 1;
      throw Object.assign(new Error("unknown AppleScript failure"), { code: 1, stderr: "syntax error" });
    },
  });
  await assert.rejects(unknownRunner("-- FPI_OPERATION:READ_CONFIRMATION", []), (error) =>
    error.code === "MAIL_IMPORT_REPORT_ACCESS_FAILED");
  assert.equal(unknownAttempts, 1);
});

test("delete-report reads use the same bounded -609 contract", async () => {
  let attempts = 0;
  const runner = createAppleMailDeleteAutomationRunner({
    accessGuard: createAppleMailReadAccessGuard(),
    retryDelaysMs: [0],
    sleep: async () => {},
    execute: async () => {
      attempts += 1;
      if (attempts === 1) throw invalidConnectionError();
      return { stdout: "positive-delete-report", stderr: "" };
    },
  });
  assert.equal(await runner("-- FPI_OPERATION:READ_DELETE_CONFIRMATION", []), "positive-delete-report");
  assert.equal(attempts, 2);
});

test("three serial lifecycles with a background timer keep one Mail call and one transfer per stage", async () => {
  const guard = createAppleMailReadAccessGuard({ waitTimeoutMs: 1_000 });
  let activeMailCalls = 0;
  let maxActiveMailCalls = 0;
  const uploadTransfers = new Map();
  const deleteTransfers = new Map();
  const execute = async (_file, args) => {
    activeMailCalls += 1;
    maxActiveMailCalls = Math.max(maxActiveMailCalls, activeMailCalls);
    await new Promise((resolve) => setImmediate(resolve));
    activeMailCalls -= 1;
    return { stdout: args[1].includes("IMPORT") ? "FPI_OK\tconfirmed" : "confirmed", stderr: "" };
  };
  const importRunner = createAppleMailAutomationRunner({ accessGuard: guard, execute, retryDelaysMs: [] });
  const deleteRunner = createAppleMailDeleteAutomationRunner({ accessGuard: guard, execute, retryDelaysMs: [] });
  let backgroundStopped = false;
  const background = (async () => {
    while (!backgroundStopped) {
      await importRunner("-- FPI_OPERATION:BACKGROUND_IMPORT_TIMER", []);
      await new Promise((resolve) => setImmediate(resolve));
    }
  })();

  for (const lifecycleId of ["one", "two", "three"]) {
    uploadTransfers.set(lifecycleId, (uploadTransfers.get(lifecycleId) || 0) + 1);
    await importRunner("-- FPI_OPERATION:LIFECYCLE_IMPORT_CONFIRMATION", []);
    deleteTransfers.set(lifecycleId, (deleteTransfers.get(lifecycleId) || 0) + 1);
    await deleteRunner("-- FPI_OPERATION:LIFECYCLE_DELETE_CONFIRMATION", []);
  }
  backgroundStopped = true;
  await background;

  assert.equal(maxActiveMailCalls, 1);
  assert.deepEqual([...uploadTransfers.values()], [1, 1, 1]);
  assert.deepEqual([...deleteTransfers.values()], [1, 1, 1]);
});
