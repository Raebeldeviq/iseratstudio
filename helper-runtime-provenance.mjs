import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const HELPER_RUNTIME_MANIFEST_FORMAT = 2;
export const PRODUCTION_RUNTIME_MISMATCH = "PRODUCTION_RUNTIME_COMMIT_MISMATCH";

function commit(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return /^[a-f0-9]{40}$/u.test(normalized) ? normalized : "";
}

export async function inspectSourceGitProvenance(sourceRoot = process.cwd()) {
  const root = resolve(String(sourceRoot));
  const [{ stdout: head }, { stdout: status }] = await Promise.all([
    execFileAsync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }),
    execFileAsync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8" }),
  ]);
  const runtimeCommit = commit(head);
  if (!runtimeCommit) throw new Error("Der Git-Commit der Helper-Quelle konnte nicht eindeutig ermittelt werden.");
  if (String(status).trim()) throw new Error("Eine produktive Helper-Runtime darf nur aus einem sauberen Git-Stand gebaut werden.");
  return { runtimeCommit, sourceTreeClean: true };
}

export function normalizeHelperRuntimeManifest(value, runtimePath = "") {
  const runtimeCommit = commit(value?.runtimeCommit);
  const releaseId = String(value?.releaseId || basename(resolve(String(runtimePath || ".")))).trim();
  const valid = Number(value?.format) === HELPER_RUNTIME_MANIFEST_FORMAT
    && Boolean(runtimeCommit)
    && value?.sourceTreeClean === true
    && /^release-[a-zA-Z0-9-]+$/u.test(releaseId);
  return {
    valid,
    runtimeManifestFormat: Number(value?.format) || 0,
    runtimeCommit: valid ? runtimeCommit : "",
    runtimeRelease: valid ? releaseId : "",
    runtimeBuiltAt: valid ? String(value?.createdAt || "") : "",
    sourceTreeClean: valid,
    runtimeCodeSha256: valid && /^[a-f0-9]{64}$/u.test(String(value?.codeSha256 || ""))
      ? String(value.codeSha256)
      : "",
    fallbackReason: valid
      ? ""
      : "Helper-Runtime-Manifest fehlt, ist veraltet oder besitzt keinen sauberen Git-Provenienznachweis.",
  };
}

export async function loadHelperRuntimeProvenance(options = {}) {
  const moduleDirectory = resolve(String(options.runtimePath || dirname(fileURLToPath(import.meta.url))));
  const manifestPath = resolve(String(options.manifestPath || join(moduleDirectory, "helper-runtime-manifest.json")));
  try {
    const value = JSON.parse(await readFile(manifestPath, "utf8"));
    return normalizeHelperRuntimeManifest(value, moduleDirectory);
  } catch {
    return normalizeHelperRuntimeManifest(null, moduleDirectory);
  }
}

export function verifyProductionRuntime(provenance, productionPolicy) {
  const runtimeCommit = commit(provenance?.runtimeCommit);
  const expectedProductionCommit = commit(productionPolicy?.expectedRuntimeCommit);
  const valid = provenance?.valid === true
    && productionPolicy?.valid === true
    && Boolean(runtimeCommit)
    && runtimeCommit === expectedProductionCommit;
  return {
    valid,
    runtimeCommit,
    expectedProductionCommit,
    runtimeRelease: String(provenance?.runtimeRelease || ""),
    runtimeBuiltAt: String(provenance?.runtimeBuiltAt || ""),
    runtimeCodeSha256: String(provenance?.runtimeCodeSha256 || ""),
    fallbackReason: valid
      ? ""
      : `Produktive Mutation gesperrt: laufender Runtime-Commit ${runtimeCommit || "unbekannt"} stimmt nicht mit dem erwarteten Commit ${expectedProductionCommit || "unbekannt"} überein.`,
  };
}

export function assertProductionRuntime(provenance, productionPolicy) {
  const result = verifyProductionRuntime(provenance, productionPolicy);
  if (result.valid) return result;
  const error = new Error(result.fallbackReason);
  error.code = PRODUCTION_RUNTIME_MISMATCH;
  error.runtime = result;
  throw error;
}
