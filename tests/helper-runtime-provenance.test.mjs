import assert from "node:assert/strict";
import test from "node:test";

import {
  assertProductionRuntime,
  normalizeHelperRuntimeManifest,
  verifyProductionRuntime,
} from "../helper-runtime-provenance.mjs";
import { runHelperRuntimeProvenanceCli } from "../helper-runtime-provenance-cli.mjs";

const RUNTIME_COMMIT = "a".repeat(40);

function policy(expectedRuntimeCommit = RUNTIME_COMMIT) {
  return {
    format: 2,
    maxRunItems: 3,
    startupCatchupMode: "guarded",
    expectedRuntimeCommit,
    valid: true,
    fallbackReason: "",
  };
}

test("runtime manifest requires immutable clean Git provenance", () => {
  const valid = normalizeHelperRuntimeManifest({
    format: 2,
    releaseId: "release-20260821080000",
    runtimeCommit: RUNTIME_COMMIT,
    sourceTreeClean: true,
    createdAt: "2026-08-21T08:00:00.000Z",
    codeSha256: "b".repeat(64),
  }, "/tmp/release-20260821080000");
  assert.equal(valid.valid, true);
  assert.equal(valid.runtimeCommit, RUNTIME_COMMIT);
  assert.equal(valid.runtimeRelease, "release-20260821080000");

  assert.equal(normalizeHelperRuntimeManifest({ ...valid, format: 1 }, "/tmp/release-old").valid, false);
  assert.equal(normalizeHelperRuntimeManifest({ ...valid, sourceTreeClean: false }, "/tmp/release-dirty").valid, false);
  assert.equal(normalizeHelperRuntimeManifest({ ...valid, runtimeCommit: "unknown" }, "/tmp/release-invalid").valid, false);
});

test("production runtime guard accepts only the exact policy commit", () => {
  const provenance = {
    valid: true,
    runtimeCommit: RUNTIME_COMMIT,
    runtimeRelease: "release-20260821080000",
    runtimeBuiltAt: "2026-08-21T08:00:00.000Z",
    runtimeCodeSha256: "b".repeat(64),
  };
  assert.equal(verifyProductionRuntime(provenance, policy()).valid, true);
  const mismatch = verifyProductionRuntime(provenance, policy("c".repeat(40)));
  assert.equal(mismatch.valid, false);
  assert.match(mismatch.fallbackReason, /Runtime-Commit/iu);
  assert.throws(
    () => assertProductionRuntime(provenance, policy("c".repeat(40))),
    (error) => error.code === "PRODUCTION_RUNTIME_COMMIT_MISMATCH",
  );
});

test("runtime status reports the immutable release and matching production guard", async () => {
  const provenance = {
    valid: true,
    runtimeManifestFormat: 2,
    runtimeCommit: RUNTIME_COMMIT,
    runtimeRelease: "release-20260821080000",
    runtimeBuiltAt: "2026-08-21T08:00:00.000Z",
    sourceTreeClean: true,
    runtimeCodeSha256: "b".repeat(64),
    fallbackReason: "",
  };
  const result = await runHelperRuntimeProvenanceCli(["status"], {
    loadProvenance: async () => provenance,
    policyStore: { load: async () => policy() },
  });
  assert.equal(result.runtimeCommit, RUNTIME_COMMIT);
  assert.equal(result.runtimeRelease, provenance.runtimeRelease);
  assert.equal(result.productionGuard.valid, true);
});
