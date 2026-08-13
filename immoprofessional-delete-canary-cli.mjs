#!/usr/bin/env node
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { Readable } from "node:stream";

import { Client } from "basic-ftp";

import { loadCatalogManifest } from "./catalog-store.mjs";
import { loadCredentialVault } from "./credential-vault.mjs";
import {
  createDeleteCanaryLedger,
  createDeleteCanaryModeStore,
  DELETE_CANARY_TARGET,
  executeDeleteCanary,
  prepareDeleteCanary,
} from "./immoprofessional-delete-canary.mjs";
import { APPLICATION_DATA_DIRECTORY } from "./platform-paths.mjs";
import { createStructuredFileLogger } from "./structured-log.mjs";

export const DELETE_CANARY_MODE_PATH = join(APPLICATION_DATA_DIRECTORY, "immoprofessional-delete-canary-mode.json");
export const DELETE_CANARY_LEDGER_PATH = join(APPLICATION_DATA_DIRECTORY, "immoprofessional-delete-canary-jobs.json");
export const DELETE_CANARY_LOG_PATH = join(APPLICATION_DATA_DIRECTORY, "immoprofessional-delete-canary.log");

function parseArguments(argv) {
  const [command = "status", ...rest] = argv;
  const values = {
    command,
    mode: "",
    externalObjectNumbers: [],
    authorizedTarget: "",
    schemaPath: "",
  };
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === "--mode") values.mode = String(rest[++index] || "");
    else if (argument === "--external-id") values.externalObjectNumbers.push(String(rest[++index] || ""));
    else if (argument === "--authorized-external-id") values.authorizedTarget = String(rest[++index] || "");
    else if (argument === "--schema") values.schemaPath = String(rest[++index] || "");
    else throw new Error(`Unbekanntes Argument: ${argument}`);
  }
  return values;
}

function ftpAccessOptions(credentials) {
  return {
    host: String(credentials.ftpHost),
    user: String(credentials.ftpUser),
    password: String(credentials.ftpPassword),
    secure: credentials.ftpSecure === "implicit" ? "implicit" : credentials.ftpSecure === "explicit",
    secureOptions: { rejectUnauthorized: true },
  };
}

export function runXmllint({ xmlText, schemaPath }, options = {}) {
  const executable = options.executable || "/usr/bin/xmllint";
  return new Promise((resolve) => {
    const child = spawn(executable, ["--noout", "--schema", schemaPath, "-"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-4000);
    });
    child.on("error", (error) => resolve({ ok: false, message: error.message }));
    child.on("close", (code) => resolve({
      ok: code === 0,
      message: code === 0 ? "OpenImmo-XSD-Prüfung bestanden." : stderr.trim() || `xmllint endete mit Code ${code}.`,
    }));
    child.stdin.end(xmlText, "utf8");
  });
}

function printPreflight(preflight, write = (value) => process.stdout.write(value)) {
  write([
    "DELETE CANARY PRE-FLIGHT",
    "",
    `TARGET: ${preflight.target}`,
    `PROVIDER: ${preflight.provider}`,
    `OPERATION: ${preflight.operation}`,
    `MODE: ${preflight.mode}`,
    `PAYLOAD OBJECT COUNT: ${preflight.payloadObjectCount}`,
    `PAYLOAD DELETE COUNT: ${preflight.payloadDeleteCount}`,
    `OPENIMMO_OBID: ${preflight.openimmoObid}`,
    `KENNUNG_URSPRUNG: ${preflight.kennungUrsprung}`,
    ...preflight.protectedObjects.map((value) => `PROTECTED OBJECT: ${value}`),
    `ALLOWED DELETE TRANSFERS: ${preflight.allowedDeleteTransfers}`,
    `DELETE JOB ID: ${preflight.deleteJobId}`,
    `PAYLOAD FILE: ${preflight.payloadFilename}`,
    `XML FILE: ${preflight.xmlFilename}`,
    `PAYLOAD BYTES: ${preflight.payloadSize}`,
    `PAYLOAD SHA-256: ${preflight.payloadSha256}`,
    "",
  ].join("\n"));
}

function publicJob(job) {
  if (!job) return null;
  const safe = { ...job };
  delete safe.claimToken;
  return safe;
}

export async function runDeleteCanaryCli(argv, options = {}) {
  const parsed = parseArguments(argv);
  const modeStore = options.modeStore || createDeleteCanaryModeStore(DELETE_CANARY_MODE_PATH);
  const ledger = options.ledger || createDeleteCanaryLedger(DELETE_CANARY_LEDGER_PATH);
  const writeLog = options.writeLog || createStructuredFileLogger(DELETE_CANARY_LOG_PATH, {
    jobType: "immoprofessional-delete-canary",
  });
  if (parsed.command === "status") {
    const [mode, ledgerState] = await Promise.all([modeStore.load(), ledger.read()]);
    return { mode, jobs: ledgerState.jobs.map(publicJob) };
  }
  if (parsed.command === "mode") {
    const mode = parsed.mode.trim().toLowerCase();
    return modeStore.save({ mode, externalObjectNumbers: parsed.externalObjectNumbers });
  }
  if (!parsed.schemaPath) throw new Error("Für preflight und transfer ist --schema mit dem offiziellen OpenImmo-XSD erforderlich.");
  if (parsed.externalObjectNumbers.length !== 1) throw new Error("Für den Delete-Canary ist exakt ein --external-id erforderlich.");
  const catalog = options.catalog || await loadCatalogManifest();
  if (!catalog?.stored || !catalog.state) throw new Error("Der persistente Inseratestudio-Katalog ist nicht verfügbar.");
  const vault = options.vault || await loadCredentialVault();
  const credentials = vault.credentials || {};
  const transportTarget = String(credentials.ftpPath || "/").trim() || "/";
  const common = {
    target: parsed.externalObjectNumbers[0],
    authorizedTarget: parsed.authorizedTarget || DELETE_CANARY_TARGET,
    modeStore,
    ledger,
    state: catalog.state,
    schemaPath: parsed.schemaPath,
    schemaValidator: options.schemaValidator || runXmllint,
    transportTarget,
    now: options.now,
  };
  if (parsed.command === "preflight") {
    const result = await prepareDeleteCanary(common);
    printPreflight(result.preflight, options.write);
    await writeLog("preflight", {
      deleteJobId: result.identity.deleteJobId,
      externalObjectNumber: result.target,
      payloadFilename: result.payload.payloadFilename,
      payloadSha256: result.payload.payloadSha256,
      payloadSize: result.payload.payloadSize,
      status: "delete_preflight_validated",
    });
    return { ok: true, preflight: result.preflight, localListingId: result.snapshot.sourceListingId };
  }
  if (parsed.command !== "transfer") throw new Error("Erlaubte Befehle: status, mode, preflight oder transfer.");
  if (!credentials.ftpHost || !credentials.ftpUser || !credentials.ftpPassword) {
    throw new Error("Der bestehende Immoprofessional-FTPS-Zugang ist unvollständig.");
  }
  let client;
  try {
    const result = await executeDeleteCanary({
      ...common,
      onPreflight: async (preflight) => {
        printPreflight(preflight, options.write);
        await writeLog("transfer-preflight", {
          deleteJobId: preflight.deleteJobId,
          externalObjectNumber: preflight.target,
          payloadFilename: preflight.payloadFilename,
          payloadSha256: preflight.payloadSha256,
          payloadSize: preflight.payloadSize,
          status: "delete_processing",
        });
      },
      upload: options.upload || (async ({ archive, filename, target, preflight }) => {
        const startedAt = new Date().toISOString();
        client = new Client(300_000);
        client.ftp.verbose = false;
        await client.access(ftpAccessOptions(credentials));
        if (transportTarget !== "/") await client.cd(transportTarget);
        await client.uploadFrom(Readable.from(archive), filename);
        const completedAt = new Date().toISOString();
        await writeLog("transferred", {
          deleteJobId: preflight.deleteJobId,
          externalObjectNumber: target,
          payloadFilename: filename,
          payloadSha256: preflight.payloadSha256,
          payloadSize: archive.length,
          host: String(credentials.ftpHost),
          remotePath: transportTarget,
          transport: String(credentials.ftpSecure),
          startedAt,
          completedAt,
          status: "delete_pending_confirmation",
          message: "Einzelner Delete-Canary übertragen; Providerbestätigung ausstehend.",
        });
        return {
          startedAt,
          completedAt,
          host: String(credentials.ftpHost),
          remotePath: transportTarget,
          transport: String(credentials.ftpSecure),
          bytes: archive.length,
          transferredPackages: 1,
          retries: 0,
        };
      }),
    });
    return {
      ok: true,
      job: publicJob(result.job),
      preflight: result.preflight,
      transport: result.transport,
      localListingId: result.snapshot.sourceListingId,
    };
  } catch (error) {
    await writeLog("failed", {
      externalObjectNumber: parsed.externalObjectNumbers[0],
      errorCode: String(error?.code || "DELETE_CANARY_FAILED"),
      message: error instanceof Error ? error.message : "Der Delete-Canary ist fehlgeschlagen.",
      status: "delete_transfer_failed",
    }).catch(() => undefined);
    throw error;
  } finally {
    client?.close();
    await modeStore.save({ mode: "off", externalObjectNumbers: [] });
  }
}

async function main() {
  try {
    const result = await runDeleteCanaryCli(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error?.code ? `${error.code}: ` : ""}${error instanceof Error ? error.message : "Delete-Canary fehlgeschlagen."}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
