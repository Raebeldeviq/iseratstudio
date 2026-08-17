#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { APPLICATION_DATA_DIRECTORY } from "./platform-paths.mjs";

function option(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || fallback) : fallback;
}

function integerOption(name, fallback, minimum, maximum) {
  const value = Number(option(name, String(fallback)));
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} muss eine ganze Zahl zwischen ${minimum} und ${maximum} sein.`);
  }
  return value;
}

async function probe(sessionToken) {
  const response = await fetch("http://127.0.0.1:43182/mail-runtime/probe", {
    method: "POST",
    headers: { "X-FPI-Session": sessionToken },
    signal: AbortSignal.timeout(55_000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(String(body?.message || `Mail-Runtime-Probe antwortete mit HTTP ${response.status}.`));
  return body;
}

async function main() {
  if (process.argv[2] !== "probe") {
    throw new Error("Verwendung: node mail-runtime-probe-cli.mjs probe [--runs 1..20] [--interval-ms 0..300000]");
  }
  const runs = integerOption("--runs", 1, 1, 20);
  const intervalMs = integerOption("--interval-ms", 0, 0, 300_000);
  const sessionToken = String(await readFile(join(APPLICATION_DATA_DIRECTORY, "helper-session"), "utf8")).trim();
  if (!/^[a-f0-9]{64}$/u.test(sessionToken)) throw new Error("Die lokale Helper-Sitzung ist nicht verfügbar.");
  const results = [];
  for (let index = 0; index < runs; index += 1) {
    if (index > 0 && intervalMs > 0) await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const result = await probe(sessionToken);
    results.push({ run: index + 1, ...result });
    process.stdout.write(`${JSON.stringify(results.at(-1))}\n`);
    if (!result.ok) break;
  }
  const successfulRuns = results.filter((result) => result.ok).length;
  process.stdout.write(`${JSON.stringify({ summary: true, requestedRuns: runs, completedRuns: results.length, successfulRuns, failedRuns: results.length - successfulRuns })}\n`);
  if (successfulRuns !== runs) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
