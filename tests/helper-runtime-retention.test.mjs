import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { pruneOldHelperRuntimes } from "../helper-runtime-retention.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(await realpath(tmpdir()), "fpi-runtime-retention-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const parent = join(root, "helper-runtime");
  await mkdir(parent);
  const release = async (name, createdAt = "2026-10-11T10:00:00.000Z", extra = {}) => {
    const path = join(parent, name);
    await mkdir(path);
    await writeFile(join(path, "helper-runtime-manifest.json"), JSON.stringify({
      format: 2, releaseId: name, runtimeCommit: "a".repeat(40), sourceTreeClean: true,
      excludesSecretsAndWorkingData: true, createdAt, ...extra,
    }));
    await writeFile(join(path, "local-helper-launcher.mjs"), "export {};\n");
    return path;
  };
  const current = await release("release-current", "2026-10-12T10:00:00.000Z");
  const old = await release("release-old");
  const options = { runtimeParent: parent, runtimePath: current, inspectHealth: async () => true, inspectReferences: async () => "" };
  return { root, parent, current, old, release, options };
}

test("retention removes retired releases only after health checks and preserves current runtime and sibling production data", async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, "catalog.json"), "protected production data");
  const before = await readFile(join(f.current, "helper-runtime-manifest.json"), "utf8");
  const result = await pruneOldHelperRuntimes(f.options);
  assert.deepEqual(result.deleted, ["release-old"]);
  await assert.rejects(access(f.old), { code: "ENOENT" });
  assert.equal(await readFile(join(f.current, "helper-runtime-manifest.json"), "utf8"), before);
  assert.equal(await readFile(join(f.root, "catalog.json"), "utf8"), "protected production data");
  assert.deepEqual((await pruneOldHelperRuntimes(f.options)).deleted, []);
});

test("failed app/helper health preserves every old release", async t => {
  const f = await fixture(t);
  const result = await pruneOldHelperRuntimes({ ...f.options, inspectHealth: async () => false });
  assert.equal(result.healthy, false);
  assert.deepEqual(result.deleted, []);
  await access(f.old);
});

test("releases referenced by active processes or open files stay protected", async t => {
  const f = await fixture(t);
  const result = await pruneOldHelperRuntimes({ ...f.options, inspectReferences: async () => `n${f.old}/dist/server/index.js\n` });
  assert.deepEqual(result.deleted, []);
  assert.deepEqual(result.retained, [{ name: "release-old", reason: "in-use" }]);
  await access(f.old);
});

test("unknown paths, staging releases, future deployments, secrets and invalid manifests are preserved", async t => {
  const f = await fixture(t);
  await mkdir(join(f.parent, ".release-incomplete.staging"));
  await f.release("release-future", "2026-10-13T10:00:00.000Z");
  const secret = await f.release("release-secret"); await writeFile(join(secret, ".env"), "PRIVATE_PLACEHOLDER");
  await f.release("release-unproven", undefined, { sourceTreeClean: false });
  const result = await pruneOldHelperRuntimes(f.options);
  assert.deepEqual(result.deleted, ["release-old"]);
  assert.deepEqual(new Set(result.retained.map(item => item.name)), new Set([".release-incomplete.staging", "release-future", "release-secret", "release-unproven"]));
  assert.equal(await readFile(join(secret, ".env"), "utf8"), "PRIVATE_PLACEHOLDER");
});

test("runtime symlinks never authorize deleting their target", async t => {
  const f = await fixture(t);
  const external = join(f.root, "external"); await mkdir(external);
  await writeFile(join(external, "keep"), "protected");
  await symlink(external, join(f.parent, "release-linked"));
  const result = await pruneOldHelperRuntimes(f.options);
  assert.ok(result.retained.some(item => item.name === "release-linked"));
  assert.equal(await readFile(join(external, "keep"), "utf8"), "protected");
  assert.equal((await pruneOldHelperRuntimes({ ...f.options, runtimePath: join(f.parent, "release-linked") })).healthy, false);
});

test("loss of health before deletion leaves the old runtime intact", async t => {
  const f = await fixture(t); let checks = 0;
  const result = await pruneOldHelperRuntimes({ ...f.options, inspectHealth: async () => ++checks === 1 });
  assert.deepEqual(result.deleted, []);
  assert.equal(result.healthy, false);
  await access(f.old);
});

test("a failed process inspection cannot remove any runtime", async t => {
  const f = await fixture(t);
  await assert.rejects(pruneOldHelperRuntimes({ ...f.options, inspectReferences: async () => { throw new Error("Unavailable"); } }));
  await access(f.old);
});
