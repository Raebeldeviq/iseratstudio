import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { auditStudioState, cleanupStudioState } from "../data-integrity.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const inputIndex = process.argv.indexOf("--input");
const outputIndex = process.argv.indexOf("--output");
const inputPath = resolve(inputIndex >= 0 ? process.argv[inputIndex + 1] : join(projectRoot, "work", "catalog-audit-input.json"));
const manifest = JSON.parse(await readFile(inputPath, "utf8"));
const state = manifest?.state || manifest;
const dryRun = cleanupStudioState(state, { apply: false });
const report = auditStudioState(state);

const imageDirectory = join(dirname(inputPath), "images");
let duplicateImageHashGroups = 0;
try {
  const hashes = new Map();
  for (const filename of await readdir(imageDirectory)) {
    if (!filename.endsWith(".bin")) continue;
    const hash = createHash("sha256").update(await readFile(join(imageDirectory, filename))).digest("hex");
    hashes.set(hash, (hashes.get(hash) || 0) + 1);
  }
  duplicateImageHashGroups = [...hashes.values()].filter((count) => count > 1).length;
} catch (error) {
  if (!error || typeof error !== "object" || error.code !== "ENOENT") throw error;
}

const output = {
  ...report,
  duplicateImageHashGroups,
  cleanupMode: dryRun.report.mode,
};

if (args.has("--apply")) {
  if (outputIndex < 0 || !process.argv[outputIndex + 1]) {
    throw new Error("--apply benötigt einen expliziten --output-Pfad; der Eingabekatalog wird niemals überschrieben.");
  }
  const applied = cleanupStudioState(state, { apply: true });
  await writeFile(resolve(process.argv[outputIndex + 1]), JSON.stringify({ ...manifest, state: applied.state }, null, 2), { flag: "wx", mode: 0o600 });
  output.appliedActions = applied.report.actions;
}

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
