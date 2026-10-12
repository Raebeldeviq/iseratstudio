import { execFile } from "node:child_process";
import { lstat, readFile, readdir, realpath, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { helperRuntimeDirectory } from "./helper-runtime-stage.mjs";
import { HELPER_LAUNCH_AGENT_LABEL, UI_LAUNCH_AGENT_LABEL } from "./helper-launch-agent.mjs";
import { PRODUCTION_HEALTH_BODY, PRODUCTION_HEALTH_PATH } from "./production-server.mjs";

const execute = promisify(execFile);
const validCommit = value => /^[a-f0-9]{40}$/u.test(value || "");

async function healthyProduction(runtimePath, manifest, homeDirectory) {
  for (const [label, entrypoint] of [[HELPER_LAUNCH_AGENT_LABEL, "local-helper-launcher.mjs"], [UI_LAUNCH_AGENT_LABEL, "production-server.mjs"]]) {
    const { stdout } = await execute("/usr/bin/plutil", ["-convert", "json", "-o", "-", join(homeDirectory, "Library", "LaunchAgents", `${label}.plist`)]);
    const plist = JSON.parse(stdout);
    if (plist.Label !== label || plist.ProgramArguments?.[1] !== join(runtimePath, entrypoint)) return false;
  }
  const session = (await readFile(join(dirname(dirname(runtimePath)), "helper-session"), "utf8")).trim();
  const helper = await fetch("http://127.0.0.1:43182/runtime-provenance", {
    headers: { "X-FPI-Session": session }, signal: AbortSignal.timeout(5_000),
  });
  if (!helper.ok) return false;
  const provenance = await helper.json();
  if (provenance.runtimeCommit !== manifest.runtimeCommit || provenance.runtimeRelease !== manifest.releaseId
    || provenance.productionGuard?.valid !== true) return false;
  const ui = await fetch(`http://127.0.0.1:43181${PRODUCTION_HEALTH_PATH}`, { signal: AbortSignal.timeout(5_000) });
  return ui.ok && await ui.text() === PRODUCTION_HEALTH_BODY;
}

async function activeReferences() {
  const [files, processes] = await Promise.all([
    execute("/usr/sbin/lsof", ["-n", "-P", "-Fn"], { maxBuffer: 32 * 1024 * 1024, timeout: 10_000 }),
    execute("/bin/ps", ["-axo", "command="], { maxBuffer: 8 * 1024 * 1024, timeout: 10_000 }),
  ]);
  return `${files.stdout}\n${processes.stdout}`;
}

function runtimeManifestValid(manifest, name) {
  return manifest?.format === 2 && manifest.releaseId === name && validCommit(manifest.runtimeCommit)
    && manifest.sourceTreeClean === true && manifest.excludesSecretsAndWorkingData === true
    && Number.isFinite(Date.parse(manifest.createdAt));
}

function runtimeOnlyEntry(name) {
  return ["app", "bundled-media", "dist", "public", "node_modules", "package.json", "helper-runtime-manifest.json", ".DS_Store"].includes(name)
    || name.endsWith(".mjs") || name === "macos-keychain.swift";
}

// Only retired, self-contained releases are removed. Source trees, unknown staging
// directories, secrets, working data and releases still referenced by a process stay.
export async function pruneOldHelperRuntimes(options = {}) {
  const homeDirectory = resolve(options.homeDirectory || homedir());
  const parent = resolve(options.runtimeParent || helperRuntimeDirectory(homeDirectory));
  const current = resolve(options.runtimePath || dirname(fileURLToPath(import.meta.url)));
  const result = { deleted: [], retained: [], healthy: false };
  if (dirname(current) !== parent || !/^release-[a-zA-Z0-9-]+$/u.test(basename(current))) return result;
  if ((await lstat(parent)).isSymbolicLink() || (await lstat(current)).isSymbolicLink()
    || await realpath(parent) !== parent || await realpath(current) !== current) return result;
  const manifest = JSON.parse(await readFile(join(current, "helper-runtime-manifest.json"), "utf8"));
  if (!runtimeManifestValid(manifest, basename(current))) return result;
  const inspectHealth = options.inspectHealth || healthyProduction;
  if (!await inspectHealth(current, manifest, homeDirectory)) return result;
  const references = await (options.inspectReferences || activeReferences)();
  result.healthy = true;
  for (const entry of await readdir(parent, { withFileTypes: true })) {
    const candidate = join(parent, entry.name);
    if (candidate === current) continue;
    let reason = "";
    if (!entry.isDirectory() || entry.isSymbolicLink() || !/^release-[a-zA-Z0-9-]+$/u.test(entry.name)) reason = "unknown-path";
    else if (references.includes(`${candidate}/`)) reason = "in-use";
    else {
      let old;
      try { old = JSON.parse(await readFile(join(candidate, "helper-runtime-manifest.json"), "utf8")); } catch { /* Unknown releases remain. */ }
      if (!runtimeManifestValid(old, entry.name)) reason = "unknown-manifest";
      else if (Date.parse(old.createdAt) >= Date.parse(manifest.createdAt)) reason = "not-retired";
      else if (!(await readdir(candidate)).every(runtimeOnlyEntry)) reason = "working-data";
    }
    if (reason) { result.retained.push({ name: entry.name, reason }); continue; }
    // Recheck the installed, healthy production pair immediately before deletion.
    if (!await inspectHealth(current, manifest, homeDirectory)) { result.healthy = false; break; }
    if ((await lstat(candidate)).isSymbolicLink() || await realpath(candidate) !== candidate) {
      result.retained.push({ name: entry.name, reason: "path-changed" }); continue;
    }
    await rm(candidate, { recursive: true, force: false });
    result.deleted.push(entry.name);
  }
  return result;
}

export async function retainHealthyRuntimeAfterStartup(options = {}) {
  if (process.platform !== "darwin") return;
  const delay = options.delay || (ms => new Promise(resolveDelay => {
    const timer = setTimeout(resolveDelay, ms); timer.unref();
  }));
  for (let attempt = 0; attempt < 20; attempt++) {
    await delay(3_000);
    try {
      const result = await pruneOldHelperRuntimes(options);
      if (result.healthy) {
        if (result.deleted.length) console.log(`Runtime-Bereinigung: ${result.deleted.length} alte Versionen entfernt.`);
        if (result.retained.length) console.log(`Runtime-Bereinigung: ${result.retained.length} nicht eindeutig entbehrliche Verzeichnisse erhalten.`);
        return result;
      }
    } catch { /* A failed health/process check never authorizes deleting a release. */ }
  }
  console.error("Runtime-Bereinigung zurückgestellt: aktuelle App und Helper konnten nicht gemeinsam bestätigt werden.");
}
