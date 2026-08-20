import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  access,
  constants,
  cp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";

import { APP_DIRECTORY_NAME } from "./platform-paths.mjs";

const RUNTIME_RESOURCE_DIRECTORIES = Object.freeze(["app", "bundled-media"]);
const RUNTIME_DEPENDENCIES = Object.freeze([
  "basic-ftp",
  "jszip",
  "pdfjs-dist",
  "read-excel-file",
]);
const REQUIRED_RUNTIME_FILES = Object.freeze([
  "local-helper-launcher.mjs",
  "local-upload-server.mjs",
  "macos-keychain.swift",
  "package.json",
]);
const RUNTIME_SUPPORT_FILES = Object.freeze([
  "macos-keychain.swift",
]);
const COPY_MODE = constants.COPYFILE_FICLONE;

function releaseName(now = new Date(), pid = process.pid) {
  return `release-${now.toISOString().replace(/[^0-9]/gu, "").slice(0, 17)}-${pid}`;
}

function isSensitivePath(path) {
  return relative("/", resolve(path))
    .split(sep)
    .some((part) => part === ".git"
      || part === "work"
      || part === "tests"
      || part === "dist"
      || part === ".next"
      || part === ".env"
      || part.startsWith(".env."));
}

async function copyRuntimeDirectory(source, destination) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("/bin/cp", ["-cR", source, destination], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4_096);
    });
    child.once("error", rejectPromise);
    child.once("close", (code, signal) => {
      if (code === 0 && !signal) resolvePromise();
      else rejectPromise(new Error(`Helper-Runtime-Kopie fehlgeschlagen (${signal || code}): ${stderr.trim()}`));
    });
  });
}

async function collectRuntimeDependencies(sourceRoot) {
  const sourceNodeModules = await realpath(join(sourceRoot, "node_modules"));
  const resolved = new Map();
  const queue = [];
  for (const name of RUNTIME_DEPENDENCIES) {
    queue.push({ name, path: await realpath(join(sourceNodeModules, name)), optional: false });
  }
  while (queue.length) {
    const current = queue.shift();
    const existing = resolved.get(current.name);
    if (existing) {
      if (existing !== current.path) {
        throw new Error(`Helper-Runtime-Abhängigkeitskonflikt: ${current.name}`);
      }
      continue;
    }
    resolved.set(current.name, current.path);
    const packageJson = JSON.parse(await readFile(join(current.path, "package.json"), "utf8"));
    const dependencyRoot = current.name.startsWith("@")
      ? dirname(dirname(current.path))
      : dirname(current.path);
    const dependencies = Object.keys(packageJson.dependencies || {});
    const optionalDependencies = Object.keys(packageJson.optionalDependencies || {});
    for (const name of [...dependencies, ...optionalDependencies]) {
      try {
        queue.push({
          name,
          path: await realpath(join(dependencyRoot, name)),
          optional: optionalDependencies.includes(name),
        });
      } catch (error) {
        if (!optionalDependencies.includes(name) || error?.code !== "ENOENT") throw error;
      }
    }
  }
  return resolved;
}

async function copyRuntimeDependencies(sourceRoot, destinationRoot) {
  const dependencies = await collectRuntimeDependencies(sourceRoot);
  await mkdir(destinationRoot, { recursive: false });
  for (const [name, source] of [...dependencies.entries()].sort(([left], [right]) => left.localeCompare(right, "en"))) {
    const destination = join(destinationRoot, name);
    await mkdir(dirname(destination), { recursive: true });
    await copyRuntimeDirectory(source, destination);
  }
  return dependencies.size;
}

async function codeFingerprint(sourceRoot, rootFiles) {
  const hash = createHash("sha256");
  const codeFiles = [...rootFiles];
  const pending = [join(sourceRoot, "app")];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (isSensitivePath(path) || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) codeFiles.push(path);
    }
  }
  codeFiles.sort((left, right) => left.localeCompare(right, "en"));
  for (const path of codeFiles) {
    hash.update(relative(sourceRoot, path));
    hash.update("\0");
    hash.update(await readFile(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function helperRuntimeDirectory(homeDirectory = homedir()) {
  return join(homeDirectory, "Library", "Application Support", APP_DIRECTORY_NAME, "helper-runtime");
}

export async function stageHelperRuntime(options = {}) {
  const sourceRoot = resolve(String(options.sourceRoot || process.cwd()));
  const runtimeParent = resolve(String(options.runtimeParent || helperRuntimeDirectory(options.homeDirectory)));
  const runtimeName = String(options.runtimeName || releaseName(options.now, options.pid));
  if (!/^release-[a-zA-Z0-9-]+$/u.test(runtimeName)) throw new Error("Ungültiger Helper-Runtime-Name.");
  const destination = join(runtimeParent, runtimeName);
  const staging = join(runtimeParent, `.${runtimeName}.staging`);
  await mkdir(runtimeParent, { recursive: true });
  await access(destination).then(
    () => { throw new Error("Die Helper-Runtime existiert bereits."); },
    (error) => { if (error?.code !== "ENOENT") throw error; },
  );
  await access(staging).then(
    () => { throw new Error("Eine unvollständige Helper-Runtime blockiert die Installation."); },
    (error) => { if (error?.code !== "ENOENT") throw error; },
  );
  await mkdir(staging, { recursive: false });

  const rootEntries = await readdir(sourceRoot, { withFileTypes: true });
  const rootFiles = rootEntries
    .filter((entry) => entry.isFile() && (extname(entry.name) === ".mjs" || entry.name === "package.json"))
    .map((entry) => join(sourceRoot, entry.name))
    .sort((left, right) => left.localeCompare(right, "en"));
  const supportFiles = RUNTIME_SUPPORT_FILES.map((name) => join(sourceRoot, name));
  for (const source of [...rootFiles, ...supportFiles]) {
    await access(source, constants.R_OK);
    await cp(source, join(staging, basename(source)), { force: false, errorOnExist: true, mode: COPY_MODE });
  }
  for (const name of RUNTIME_RESOURCE_DIRECTORIES) {
    await copyRuntimeDirectory(join(sourceRoot, name), join(staging, name));
  }
  const dependencyCount = await copyRuntimeDependencies(sourceRoot, join(staging, "node_modules"));

  for (const name of REQUIRED_RUNTIME_FILES) await access(join(staging, name), constants.R_OK);
  await access(join(staging, "node_modules", "basic-ftp"), constants.R_OK);
  await access(join(staging, "node_modules", "jszip"), constants.R_OK);
  const manifest = {
    format: 1,
    createdAt: (options.now || new Date()).toISOString(),
    codeSha256: await codeFingerprint(sourceRoot, [...rootFiles, ...supportFiles]),
    rootModuleCount: rootFiles.length,
    runtimeSupportFileCount: supportFiles.length,
    runtimeDependencyCount: dependencyCount,
    includesBundledMedia: true,
    includesDependencies: true,
    excludesSecretsAndWorkingData: true,
  };
  await writeFile(join(staging, "helper-runtime-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(staging, destination);
  return { runtimePath: destination, manifest };
}
