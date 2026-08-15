#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";

import { Client } from "basic-ftp";

import { createAppleMailLiveCanaryDeleteReportAdapter } from "./apple-mail-live-canary-delete-report-adapter.mjs";
import { createCatalogStateStore } from "./catalog-state-store.mjs";
import { loadCredentialVault } from "./credential-vault.mjs";
import { parseImmoprofessionalDeleteReport } from "./immoprofessional-delete-report-parser.mjs";
import {
  createLiveCanaryDeleteLedger,
  createLiveCanaryDeleteModeStore,
  finalizeLiveCanaryDeleteInState,
  prepareLiveCanaryDelete,
} from "./listing-rotation-live-canary-delete.mjs";
import { APPLICATION_DATA_DIRECTORY } from "./platform-paths.mjs";
import { createStructuredFileLogger } from "./structured-log.mjs";

export const LIVE_CANARY_DELETE_MODE_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-live-canary-delete-mode.json");
export const LIVE_CANARY_DELETE_LEDGER_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-live-canary-delete-jobs.json");
export const LIVE_CANARY_DELETE_LOG_PATH = join(APPLICATION_DATA_DIRECTORY, "listing-rotation-live-canary-delete.log");

function argumentsFor(argv) {
  const [command = "status", ...rest] = argv;
  const values = { command, mode: "", target: "", schemaPath: "", reportPath: "" };
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === "--mode") values.mode = String(rest[++index] || "");
    else if (value === "--external-id") values.target = String(rest[++index] || "");
    else if (value === "--schema") values.schemaPath = String(rest[++index] || "");
    else if (value === "--report") values.reportPath = String(rest[++index] || "");
    else throw new Error(`Unbekanntes Argument: ${value}`);
  }
  return values;
}

function runXmllint({ xmlText, schemaPath }) {
  return new Promise((resolve) => {
    const child = spawn("/usr/bin/xmllint", ["--noout", "--schema", schemaPath, "-"], { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });
    child.on("error", (error) => resolve({ ok: false, message: error.message }));
    child.on("close", (code) => resolve({ ok: code === 0, message: code === 0 ? "OpenImmo-XSD-Prüfung bestanden." : stderr.trim() }));
    child.stdin.end(xmlText, "utf8");
  });
}

function ftpOptions(credentials) {
  return {
    host: String(credentials.ftpHost),
    user: String(credentials.ftpUser),
    password: String(credentials.ftpPassword),
    secure: credentials.ftpSecure === "implicit" ? "implicit" : credentials.ftpSecure === "explicit",
    secureOptions: { rejectUnauthorized: true },
  };
}

function publicJob(job) {
  if (!job) return null;
  const value = { ...job };
  delete value.claimToken;
  return value;
}

export async function runLiveCanaryDeleteCli(argv, options = {}) {
  const parsed = argumentsFor(argv);
  const modeStore = options.modeStore || createLiveCanaryDeleteModeStore(LIVE_CANARY_DELETE_MODE_PATH);
  const ledger = options.ledger || createLiveCanaryDeleteLedger(LIVE_CANARY_DELETE_LEDGER_PATH);
  const store = options.store || createCatalogStateStore();
  const writeLog = options.writeLog || createStructuredFileLogger(LIVE_CANARY_DELETE_LOG_PATH, { jobType: "listing-rotation-live-canary-delete" });
  if (parsed.command === "status") {
    const [mode, jobs] = await Promise.all([modeStore.load(), ledger.read()]);
    return { mode, jobs: jobs.jobs.map(publicJob) };
  }
  if (parsed.command === "mode") {
    return modeStore.save({ mode: parsed.mode, externalObjectNumbers: parsed.mode === "canary" ? [parsed.target] : [] });
  }
  if (parsed.command === "scan-reports") {
    const mode = await modeStore.load();
    if (mode.mode !== "off" || mode.externalObjectNumbers.length) throw new Error("Delete-Berichte dürfen nur im Modus off gesucht werden.");
    if (!parsed.target) throw new Error("scan-reports benötigt --external-id.");
    const current = await ledger.read();
    const matches = current.jobs.filter((job) => job.externalObjectNumber === parsed.target);
    if (matches.length !== 1 || !new Set(["delete_pending_confirmation", "delete_confirmed"]).has(matches[0].status)) throw new Error("Für die alte Objektnummer existiert kein eindeutiger bestätigungsbereiter Deletejob.");
    const transferTime = Date.parse(matches[0].transferCompletedAt || "");
    const lookbackHours = Number.isFinite(transferTime)
      ? Math.max(1, Math.min(72, Math.ceil((Date.now() - transferTime) / 3600000) + 1))
      : 2;
    const adapter = options.mailAdapter || createAppleMailLiveCanaryDeleteReportAdapter();
    if (adapter.readOnly !== true) throw new Error("Der Delete-Berichtadapter ist nicht read-only.");
    const candidates = await adapter.findCandidates({ lookbackHours });
    const rejected = [];
    for (const candidate of candidates) {
      try {
        const mail = await adapter.readRawMessage(candidate);
        const report = parseImmoprofessionalDeleteReport(mail.rawSource, { expectedTarget: parsed.target });
        const job = await ledger.confirm(matches[0].deleteJobId, report, options.now?.());
        const sameCanonicalReport = job.reportHash === report.rawHash && job.reportMessageId === report.messageId;
        const persisted = sameCanonicalReport
          ? await store.update((state) => ({ state: finalizeLiveCanaryDeleteInState(state, job, report, { now: options.now?.() }).state }), { now: options.now?.() })
          : await store.load();
        await writeLog("confirmed", { deleteJobId: job.deleteJobId, externalObjectNumber: parsed.target, reportMessageId: report.messageId, reportHash: report.rawHash, mailboxName: candidate.mailboxName, mailMutations: 0, status: job.status });
        return { ok: true, matched: true, candidateCount: candidates.length, rejectedCount: rejected.length, mailMutations: 0, job: publicJob(job), report: { messageId: report.messageId, rawHash: report.rawHash, providerProcessedAt: report.providerProcessedAt, externalObjectNumber: report.externalObjectNumber, deleteResult: report.deleteResult, deletedFromExchanges: report.deletedFromExchanges, mailboxName: candidate.mailboxName }, catalogSavedAt: persisted.savedAt };
      } catch (error) {
        rejected.push({ mailboxName: candidate.mailboxName, transportId: candidate.transportId, reason: error instanceof Error ? error.message.slice(0, 240) : "Bericht nicht passend." });
      }
    }
    return { ok: true, matched: false, candidateCount: candidates.length, rejectedCount: rejected.length, mailMutations: 0, rejected };
  }
  if (parsed.command === "confirm-report") {
    const mode = await modeStore.load();
    if (mode.mode !== "off" || mode.externalObjectNumbers.length) throw new Error("Delete-Berichte dürfen nur im Modus off verarbeitet werden.");
    if (!parsed.target || !parsed.reportPath) throw new Error("confirm-report benötigt --external-id und --report.");
    const raw = options.readReport ? await options.readReport(parsed.reportPath) : await readFile(parsed.reportPath);
    const report = parseImmoprofessionalDeleteReport(raw, { expectedTarget: parsed.target });
    const current = await ledger.read();
    const matches = current.jobs.filter((job) => job.externalObjectNumber === parsed.target);
    if (matches.length !== 1) throw new Error("Der Bericht kann keinem eindeutigen Live-Canary-Deletejob zugeordnet werden.");
    const job = await ledger.confirm(matches[0].deleteJobId, report, options.now?.());
    const sameCanonicalReport = job.reportHash === report.rawHash && job.reportMessageId === report.messageId;
    const persisted = sameCanonicalReport
      ? await store.update((state) => ({
          state: finalizeLiveCanaryDeleteInState(state, job, report, { now: options.now?.() }).state,
        }), { now: options.now?.() })
      : await store.load();
    await writeLog("confirmed", { deleteJobId: job.deleteJobId, externalObjectNumber: parsed.target, reportMessageId: report.messageId, reportHash: report.rawHash, status: job.status });
    return { ok: true, job: publicJob(job), report: { messageId: report.messageId, rawHash: report.rawHash, providerProcessedAt: report.providerProcessedAt, externalObjectNumber: report.externalObjectNumber, deleteResult: report.deleteResult, deletedFromExchanges: report.deletedFromExchanges }, catalogSavedAt: persisted.savedAt };
  }
  if (!parsed.target || !parsed.schemaPath) throw new Error("preflight/transfer benötigen --external-id und --schema.");
  if (!new Set(["preflight", "transfer"]).has(parsed.command)) throw new Error("Erlaubte Befehle: status, mode, preflight, transfer, confirm-report, scan-reports.");
  if (parsed.command === "preflight") {
    const snapshot = await store.load();
    if (!snapshot?.stored || !snapshot.state) throw new Error("Der persistente Katalog ist nicht verfügbar.");
    const vault = options.vault || await loadCredentialVault();
    const credentials = vault.credentials || {};
    if (!credentials.ftpHost || !credentials.ftpUser || !credentials.ftpPassword) throw new Error("Der Immoprofessional-FTPS-Zugang ist unvollständig.");
    const transportTarget = String(credentials.ftpPath || "/").trim() || "/";
    const prepared = await prepareLiveCanaryDelete({ target: parsed.target, state: snapshot.state, modeStore, ledger, schemaPath: parsed.schemaPath, schemaValidator: options.schemaValidator || runXmllint, transportTarget, now: options.now });
    return { ok: true, target: prepared.target, sourceListingId: prepared.eligibility.source.id, replacementListingId: prepared.eligibility.replacement.id, replacementExternalId: prepared.eligibility.replacement.externalId, deleteJobId: prepared.identity.deleteJobId, payloadFilename: prepared.payload.payloadFilename, payloadSha256: prepared.payload.payloadSha256, payloadSize: prepared.payload.payloadSize, transportTarget: prepared.job.transportTarget };
  }
  let client;
  let claimed;
  let prepared;
  try {
    const snapshot = await store.load();
    if (!snapshot?.stored || !snapshot.state) throw new Error("Der persistente Katalog ist nicht verfügbar.");
    const vault = options.vault || await loadCredentialVault();
    const credentials = vault.credentials || {};
    if (!credentials.ftpHost || !credentials.ftpUser || !credentials.ftpPassword) throw new Error("Der Immoprofessional-FTPS-Zugang ist unvollständig.");
    const remotePath = String(credentials.ftpPath || "/").trim() || "/";
    prepared = await prepareLiveCanaryDelete({ target: parsed.target, state: snapshot.state, modeStore, ledger, schemaPath: parsed.schemaPath, schemaValidator: options.schemaValidator || runXmllint, transportTarget: remotePath, now: options.now });
    const modeNow = await modeStore.load();
    if (modeNow.mode !== "canary" || modeNow.externalObjectNumbers[0] !== parsed.target) throw new Error("Der Delete-Modus ist unmittelbar vor dem Transfer nicht exakt freigegeben.");
    claimed = await ledger.claim(prepared.identity.deleteJobId, options.now?.());
    const startedAt = new Date().toISOString();
    if (options.upload) await options.upload({ archive: prepared.payload.archive, filename: prepared.payload.payloadFilename });
    else {
      client = new Client(300_000);
      client.ftp.verbose = false;
      await client.access(ftpOptions(credentials));
      if (remotePath !== "/") await client.cd(remotePath);
      await client.uploadFrom(Readable.from(prepared.payload.archive), prepared.payload.payloadFilename);
    }
    const completedAt = new Date().toISOString();
    const job = await ledger.transferred(prepared.identity.deleteJobId, claimed.claimToken, options.now?.());
    await writeLog("transferred", { deleteJobId: job.deleteJobId, externalObjectNumber: parsed.target, payloadFilename: prepared.payload.payloadFilename, payloadSha256: prepared.payload.payloadSha256, payloadSize: prepared.payload.payloadSize, startedAt, completedAt, status: job.status, transferredPackages: 1, retries: 0 });
    return { ok: true, job: publicJob(job), transfer: { startedAt, completedAt, bytes: prepared.payload.payloadSize, transferredPackages: 1, retries: 0 } };
  } catch (error) {
    if (claimed && prepared) await ledger.uncertain(prepared.identity.deleteJobId, claimed.claimToken, error instanceof Error ? error.message : "Delete-Transfer unklar", options.now?.()).catch(() => undefined);
    await writeLog("failed", { externalObjectNumber: parsed.target, errorCode: String(error?.code || "LIVE_CANARY_DELETE_FAILED"), message: error instanceof Error ? error.message : "Delete-Transfer fehlgeschlagen." });
    throw error;
  } finally {
    client?.close();
    await modeStore.save({ mode: "off", externalObjectNumbers: [] });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLiveCanaryDeleteCli(process.argv.slice(2)).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error?.code ? `${error.code}: ` : ""}${error instanceof Error ? error.message : "Live-Canary-Delete fehlgeschlagen."}\n`);
    process.exitCode = 1;
  });
}
