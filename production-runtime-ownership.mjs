import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { helperRuntimeDirectory } from "./helper-runtime-stage.mjs";
import { helperRuntimeWorkingDirectory } from "./helper-launch-agent.mjs";
import {
  PRODUCTION_RUNTIME_MISMATCH,
  verifyProductionRuntime,
} from "./helper-runtime-provenance.mjs";

const execFileAsync = promisify(execFile);

export const PRODUCTION_RUNTIME_PORT_OWNER_MISMATCH = "PRODUCTION_RUNTIME_PORT_OWNER_MISMATCH";
export const PRODUCTION_RUNTIME_SOURCE_DIRECTORY_BLOCKED = "PRODUCTION_RUNTIME_SOURCE_DIRECTORY_BLOCKED";

function clean(value, maximum = 500) {
  return String(value ?? "").trim().slice(0, maximum);
}

function ownershipError(code, message, diagnostics = {}) {
  const error = new Error(message);
  error.code = code;
  error.diagnostics = diagnostics;
  return error;
}

function uniquePositiveIntegers(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => Math.trunc(Number(value)))
    .filter((value) => Number.isInteger(value) && value > 0))]
    .sort((left, right) => left - right);
}

function parseLsofPids(output) {
  return uniquePositiveIntegers(String(output || "")
    .split(/\r?\n/gu)
    .filter((line) => /^p\d+$/u.test(line.trim()))
    .map((line) => line.trim().slice(1)));
}

function parseHelperProcesses(output) {
  return String(output || "")
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const match = /^(\d+)\s+(.+)$/u.exec(line);
      if (!match) return [];
      const command = match[2];
      if (!/(?:^|\s)(?:[^\s]*\/)?(?:local-helper-launcher|local-upload-server)\.mjs(?:\s|$)/u.test(command)) return [];
      return [{ pid: Number(match[1]), command }];
    });
}

async function defaultPortOwnerInspector(port) {
  const { stdout } = await execFileAsync("/usr/sbin/lsof", [
    "-nP",
    "-a",
    `-iTCP:${port}`,
    "-sTCP:LISTEN",
    "-Fp",
  ], { encoding: "utf8", timeout: 10_000, maxBuffer: 1024 * 1024 });
  return parseLsofPids(stdout);
}

async function defaultHelperProcessInspector() {
  const { stdout } = await execFileAsync("/bin/ps", ["-axo", "pid=,command="], {
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return parseHelperProcesses(stdout);
}

async function canonicalPath(value) {
  const path = resolve(String(value || "."));
  return realpath(path).catch(() => path);
}

function pathWithin(path, parent) {
  return path === parent || path.startsWith(`${parent}/`);
}

/**
 * Verbindet die bereits vorhandene Commit-/Manifestprüfung mit der tatsächlichen
 * lokalen Prozess- und Portbelegung. Die Prüfung verändert keinen Prozess und
 * beendet insbesondere niemals einen unbekannten Port-Owner.
 */
export function createProductionRuntimeOwnershipGuard(options = {}) {
  const homeDirectory = resolve(String(options.homeDirectory || homedir()));
  const runtimePath = resolve(String(options.runtimePath || dirname(fileURLToPath(import.meta.url))));
  const runtimeParent = resolve(String(options.runtimeParent || helperRuntimeDirectory(homeDirectory)));
  const expectedWorkingDirectory = resolve(String(
    options.expectedWorkingDirectory || helperRuntimeWorkingDirectory(homeDirectory),
  ));
  const currentPid = Math.trunc(Number(options.currentPid || process.pid));
  const port = Math.trunc(Number(options.port || 43182));
  const argvEntry = resolve(String(options.argvEntry || process.argv[1] || ""));
  const workingDirectory = resolve(String(options.workingDirectory || process.cwd()));
  const provenance = options.provenance || {};
  const inspectPortOwners = options.inspectPortOwners || defaultPortOwnerInspector;
  const inspectHelperProcesses = options.inspectHelperProcesses || defaultHelperProcessInspector;

  async function inspect(productionPolicy) {
    const runtimeGuard = verifyProductionRuntime(provenance, productionPolicy);
    const [canonicalRuntimePath, canonicalRuntimeParent, canonicalWorkingDirectory, canonicalExpectedWorkingDirectory] = await Promise.all([
      canonicalPath(runtimePath),
      canonicalPath(runtimeParent),
      canonicalPath(workingDirectory),
      canonicalPath(expectedWorkingDirectory),
    ]);
    const expectedLauncherPath = join(canonicalRuntimePath, "local-helper-launcher.mjs");
    const releaseName = basename(canonicalRuntimePath);
    const releaseParentName = basename(dirname(canonicalRuntimePath));
    const releasePathValid = pathWithin(canonicalRuntimePath, canonicalRuntimeParent)
      && dirname(canonicalRuntimePath) === canonicalRuntimeParent
      && releaseParentName === "helper-runtime"
      && /^release-[a-zA-Z0-9-]+$/u.test(releaseName)
      && releaseName === clean(provenance?.runtimeRelease, 200);
    const launcherPathValid = argvEntry === expectedLauncherPath;
    const workingDirectoryValid = canonicalWorkingDirectory === canonicalExpectedWorkingDirectory;

    let portOwnerPids = [];
    let helperProcesses = [];
    let inspectionError = "";
    try {
      [portOwnerPids, helperProcesses] = await Promise.all([
        inspectPortOwners(port),
        inspectHelperProcesses(),
      ]);
    } catch (error) {
      inspectionError = clean(error instanceof Error ? error.message : "Runtime-Prozessprüfung fehlgeschlagen.");
    }
    portOwnerPids = uniquePositiveIntegers(portOwnerPids);
    helperProcesses = (Array.isArray(helperProcesses) ? helperProcesses : [])
      .map((entry) => ({ pid: Math.trunc(Number(entry?.pid)), command: clean(entry?.command, 2_000) }))
      .filter((entry) => Number.isInteger(entry.pid) && entry.pid > 0);
    const helperProcessPids = uniquePositiveIntegers(helperProcesses.map((entry) => entry.pid));
    const portOwnerValid = portOwnerPids.length === 1 && portOwnerPids[0] === currentPid;
    const singleHelperValid = helperProcessPids.length === 1 && helperProcessPids[0] === currentPid;
    const valid = runtimeGuard.valid
      && provenance?.sourceTreeClean === true
      && releasePathValid
      && launcherPathValid
      && workingDirectoryValid
      && !inspectionError
      && portOwnerValid
      && singleHelperValid;
    const diagnostics = {
      valid,
      runtimeGuardValid: runtimeGuard.valid,
      runtimeCommit: runtimeGuard.runtimeCommit,
      expectedProductionCommit: runtimeGuard.expectedProductionCommit,
      runtimeRelease: clean(provenance?.runtimeRelease, 200),
      runtimePath: canonicalRuntimePath,
      expectedLauncherPath,
      launcherPathValid,
      workingDirectory: canonicalWorkingDirectory,
      expectedWorkingDirectory: canonicalExpectedWorkingDirectory,
      workingDirectoryValid,
      releasePathValid,
      sourceTreeClean: provenance?.sourceTreeClean === true,
      currentPid,
      port,
      portOwnerPids,
      helperProcessPids,
      portOwnerValid,
      singleHelperValid,
      inspectionError,
      fallbackReason: "",
    };
    if (!runtimeGuard.valid) diagnostics.fallbackReason = runtimeGuard.fallbackReason;
    else if (!releasePathValid || !launcherPathValid || !workingDirectoryValid || provenance?.sourceTreeClean !== true) {
      diagnostics.fallbackReason = "Produktive Mutation ist außerhalb der freigegebenen sauberen helper-runtime/release-*-Runtime gesperrt.";
    } else if (inspectionError) diagnostics.fallbackReason = `Runtime-Owner konnte nicht sicher geprüft werden: ${inspectionError}`;
    else if (!portOwnerValid || !singleHelperValid) diagnostics.fallbackReason = "Produktionsport oder Helperinstanz gehört nicht eindeutig zur erwarteten Release-Runtime.";
    return diagnostics;
  }

  async function assert(productionPolicy) {
    const result = await inspect(productionPolicy);
    if (result.valid) return result;
    const sourceBlocked = !result.releasePathValid
      || !result.launcherPathValid
      || !result.workingDirectoryValid
      || result.sourceTreeClean !== true;
    throw ownershipError(
      !result.runtimeGuardValid
        ? PRODUCTION_RUNTIME_MISMATCH
        : sourceBlocked
          ? PRODUCTION_RUNTIME_SOURCE_DIRECTORY_BLOCKED
          : PRODUCTION_RUNTIME_PORT_OWNER_MISMATCH,
      result.fallbackReason || "Produktive Mutation wurde durch den Runtime-Ownership-Guard gesperrt.",
      result,
    );
  }

  return Object.freeze({ inspect, assert });
}

export const __test = Object.freeze({ parseLsofPids, parseHelperProcesses });
