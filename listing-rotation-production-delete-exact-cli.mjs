#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  EXACT_PRODUCTION_DELETE_PATH,
  requireExactProductionDeleteTarget,
} from "./listing-rotation-production-delete-exact-contract.mjs";
import { APPLICATION_DATA_DIRECTORY } from "./platform-paths.mjs";

function parseArguments(argv) {
  const [command = "", ...rest] = argv;
  let externalObjectNumber = "";
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === "--external-id") externalObjectNumber = String(rest[++index] || "").trim();
    else throw new Error(`Unbekanntes Argument: ${rest[index]}`);
  }
  if (command !== "run") throw new Error("Verwendung: node listing-rotation-production-delete-exact-cli.mjs run --external-id 30460-XXXXXX");
  return { externalObjectNumber: requireExactProductionDeleteTarget(externalObjectNumber) };
}

export async function runExactProductionDeleteCli(argv, options = {}) {
  const parsed = parseArguments(argv);
  const sessionToken = String(await (options.readSessionToken || (() => readFile(
    join(APPLICATION_DATA_DIRECTORY, "helper-session"),
    "utf8",
  )))()).trim();
  if (!/^[a-f0-9]{64}$/u.test(sessionToken)) throw new Error("Die lokale Helper-Sitzung ist nicht verfügbar.");
  const response = await (options.fetch || fetch)(`http://127.0.0.1:43182${EXACT_PRODUCTION_DELETE_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-FPI-Session": sessionToken,
    },
    body: JSON.stringify({ externalObjectNumber: parsed.externalObjectNumber }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = await response.json();
  if (!response.ok || body?.ok !== true) {
    throw new Error(String(body?.message || `Der Helper antwortete mit HTTP ${response.status}.`));
  }
  return body;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runExactProductionDeleteCli(process.argv.slice(2)).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error?.code ? `${error.code}: ` : ""}${error instanceof Error ? error.message : "Der exakte Produktions-DELETE ist fehlgeschlagen."}\n`);
    process.exitCode = 1;
  });
}
