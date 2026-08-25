import assert from "node:assert/strict";
import test from "node:test";

import {
  createProductionRuntimeOwnershipGuard,
  PRODUCTION_RUNTIME_PORT_OWNER_MISMATCH,
  PRODUCTION_RUNTIME_SOURCE_DIRECTORY_BLOCKED,
} from "../production-runtime-ownership.mjs";
import { PRODUCTION_RUNTIME_MISMATCH } from "../helper-runtime-provenance.mjs";

const COMMIT = "a".repeat(40);
const HOME = "/Users/test";
const RUNTIME_PARENT = `${HOME}/Library/Application Support/Fabian-Pascal Inseratestudio/helper-runtime`;
const RUNTIME = `${RUNTIME_PARENT}/release-20260825080000-123`;
const WORKING = `${HOME}/Library/Application Support/Fabian-Pascal Inseratestudio/helper-runtime-context`;

function policy(expectedRuntimeCommit = COMMIT) {
  return { valid: true, expectedRuntimeCommit };
}

function guard(overrides = {}) {
  return createProductionRuntimeOwnershipGuard({
    homeDirectory: HOME,
    runtimeParent: RUNTIME_PARENT,
    runtimePath: RUNTIME,
    expectedWorkingDirectory: WORKING,
    workingDirectory: WORKING,
    argvEntry: `${RUNTIME}/local-helper-launcher.mjs`,
    currentPid: 123,
    port: 43182,
    provenance: {
      valid: true,
      runtimeCommit: COMMIT,
      runtimeRelease: "release-20260825080000-123",
      runtimeBuiltAt: "2026-08-25T08:00:00.000Z",
      runtimeCodeSha256: "b".repeat(64),
      sourceTreeClean: true,
    },
    inspectPortOwners: async () => [123],
    inspectHelperProcesses: async () => [{ pid: 123, command: `node ${RUNTIME}/local-helper-launcher.mjs` }],
    ...overrides,
  });
}

test("the exact clean release runtime is the sole productive port owner", async () => {
  const result = await guard().assert(policy());
  assert.equal(result.valid, true);
  assert.deepEqual(result.portOwnerPids, [123]);
  assert.deepEqual(result.helperProcessPids, [123]);
  assert.equal(result.runtimeCommit, COMMIT);
  assert.equal(result.runtimeRelease, "release-20260825080000-123");
});

test("a foreign port owner fails closed without a kill operation", async () => {
  await assert.rejects(
    guard({ inspectPortOwners: async () => [4460] }).assert(policy()),
    (error) => error.code === PRODUCTION_RUNTIME_PORT_OWNER_MISMATCH
      && error.diagnostics.portOwnerPids[0] === 4460,
  );
});

test("two helper processes fail closed even when the current process owns the port", async () => {
  await assert.rejects(
    guard({
      inspectHelperProcesses: async () => [
        { pid: 123, command: `node ${RUNTIME}/local-helper-launcher.mjs` },
        { pid: 4460, command: "node local-upload-server.mjs" },
      ],
    }).assert(policy()),
    (error) => error.code === PRODUCTION_RUNTIME_PORT_OWNER_MISMATCH
      && error.diagnostics.helperProcessPids.length === 2,
  );
});

test("a source working-directory runtime is explicitly blocked", async () => {
  const source = "/Users/test/Documents/Hsndelsvertretung/inseratstudio";
  await assert.rejects(
    guard({
      runtimePath: source,
      argvEntry: `${source}/local-upload-server.mjs`,
      workingDirectory: source,
      inspectHelperProcesses: async () => [{ pid: 123, command: `node ${source}/local-upload-server.mjs` }],
    }).assert(policy()),
    (error) => error.code === PRODUCTION_RUNTIME_SOURCE_DIRECTORY_BLOCKED,
  );
});

test("a release without the exact expected commit is blocked", async () => {
  await assert.rejects(
    guard().assert(policy("c".repeat(40))),
    (error) => error.code === PRODUCTION_RUNTIME_MISMATCH
      && error.diagnostics.runtimeCommit === COMMIT,
  );
});

test("an absent release id or dirty source provenance is blocked", async () => {
  for (const provenance of [
    { valid: true, runtimeCommit: COMMIT, runtimeRelease: "", sourceTreeClean: true },
    { valid: true, runtimeCommit: COMMIT, runtimeRelease: "release-20260825080000-123", sourceTreeClean: false },
  ]) {
    await assert.rejects(
      guard({ provenance }).assert(policy()),
      (error) => error.code === PRODUCTION_RUNTIME_SOURCE_DIRECTORY_BLOCKED,
    );
  }
});

test("a restarted authorized helper is accepted after the old instance disappears", async () => {
  const restarted = guard({
    currentPid: 789,
    inspectPortOwners: async () => [789],
    inspectHelperProcesses: async () => [{ pid: 789, command: `node ${RUNTIME}/local-helper-launcher.mjs` }],
  });
  assert.equal((await restarted.assert(policy())).valid, true);
});
