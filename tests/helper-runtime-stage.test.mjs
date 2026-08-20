import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { stageHelperRuntime } from "../helper-runtime-stage.mjs";

test("stages a self-contained helper runtime without secrets, tests or working data", async () => {
  const root = await mkdtemp(join(tmpdir(), "fpi-helper-source-"));
  const dependencies = await mkdtemp(join(tmpdir(), "fpi-helper-dependencies-"));
  const runtimeParent = await mkdtemp(join(tmpdir(), "fpi-helper-runtime-"));
  await Promise.all([
    mkdir(join(root, "app"), { recursive: true }),
    mkdir(join(root, "bundled-media"), { recursive: true }),
    mkdir(join(root, "tests"), { recursive: true }),
    mkdir(join(root, "work"), { recursive: true }),
    mkdir(join(dependencies, "basic-ftp"), { recursive: true }),
    mkdir(join(dependencies, "jszip"), { recursive: true }),
    mkdir(join(dependencies, "pdfjs-dist"), { recursive: true }),
    mkdir(join(dependencies, "read-excel-file"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(root, "local-helper-launcher.mjs"), "export {};\n"),
    writeFile(join(root, "local-upload-server.mjs"), "export {};\n"),
    writeFile(join(root, "macos-keychain.swift"), "import Foundation\n"),
    writeFile(join(root, "package.json"), "{\"type\":\"module\"}\n"),
    writeFile(join(root, ".env"), "SECRET=must-not-copy\n"),
    writeFile(join(root, "tests", "ignored.mjs"), "throw new Error();\n"),
    writeFile(join(root, "work", "credential.json"), "{}\n"),
    writeFile(join(root, "app", "runtime.ts"), "export const runtime = true;\n"),
    writeFile(join(root, "bundled-media", "image.jpg"), "image"),
    writeFile(join(dependencies, "basic-ftp", "package.json"), "{}\n"),
    writeFile(join(dependencies, "jszip", "package.json"), "{}\n"),
    writeFile(join(dependencies, "pdfjs-dist", "package.json"), "{}\n"),
    writeFile(join(dependencies, "read-excel-file", "package.json"), "{}\n"),
  ]);
  await symlink(dependencies, join(root, "node_modules"));

  const result = await stageHelperRuntime({
    sourceRoot: root,
    runtimeParent,
    runtimeName: "release-test",
    now: new Date("2026-08-17T08:00:00.000Z"),
  });
  assert.equal(result.manifest.excludesSecretsAndWorkingData, true);
  assert.equal(result.manifest.runtimeSupportFileCount, 1);
  assert.match(await readFile(join(result.runtimePath, "local-upload-server.mjs"), "utf8"), /export/u);
  assert.match(await readFile(join(result.runtimePath, "macos-keychain.swift"), "utf8"), /Foundation/u);
  assert.match(await readFile(join(result.runtimePath, "node_modules", "basic-ftp", "package.json"), "utf8"), /\{/u);
  await assert.rejects(readFile(join(result.runtimePath, ".env")), { code: "ENOENT" });
  await assert.rejects(readFile(join(result.runtimePath, "tests", "ignored.mjs")), { code: "ENOENT" });
  await assert.rejects(readFile(join(result.runtimePath, "work", "credential.json")), { code: "ENOENT" });
});

test("fails closed when the required macOS Keychain sidecar is absent", async () => {
  const root = await mkdtemp(join(tmpdir(), "fpi-helper-source-missing-sidecar-"));
  const dependencies = await mkdtemp(join(tmpdir(), "fpi-helper-dependencies-missing-sidecar-"));
  const runtimeParent = await mkdtemp(join(tmpdir(), "fpi-helper-runtime-missing-sidecar-"));
  await Promise.all([
    mkdir(join(root, "app"), { recursive: true }),
    mkdir(join(root, "bundled-media"), { recursive: true }),
    mkdir(join(dependencies, "basic-ftp"), { recursive: true }),
    mkdir(join(dependencies, "jszip"), { recursive: true }),
    mkdir(join(dependencies, "pdfjs-dist"), { recursive: true }),
    mkdir(join(dependencies, "read-excel-file"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(root, "local-helper-launcher.mjs"), "export {};\n"),
    writeFile(join(root, "local-upload-server.mjs"), "export {};\n"),
    writeFile(join(root, "package.json"), "{\"type\":\"module\"}\n"),
    writeFile(join(root, "app", "runtime.ts"), "export const runtime = true;\n"),
    writeFile(join(root, "bundled-media", "image.jpg"), "image"),
    writeFile(join(dependencies, "basic-ftp", "package.json"), "{}\n"),
    writeFile(join(dependencies, "jszip", "package.json"), "{}\n"),
    writeFile(join(dependencies, "pdfjs-dist", "package.json"), "{}\n"),
    writeFile(join(dependencies, "read-excel-file", "package.json"), "{}\n"),
  ]);
  await symlink(dependencies, join(root, "node_modules"));

  await assert.rejects(
    stageHelperRuntime({ sourceRoot: root, runtimeParent, runtimeName: "release-test-missing-sidecar" }),
    { code: "ENOENT" },
  );
});
