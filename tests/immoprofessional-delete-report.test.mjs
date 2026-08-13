import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createDeleteCanaryJobIdentity,
  createDeleteCanaryLedger,
  createDeleteCanaryModeStore,
  DELETE_CANARY_STATUS,
  DELETE_CANARY_TARGET,
} from "../immoprofessional-delete-canary.mjs";
import { runDeleteCanaryCli } from "../immoprofessional-delete-canary-cli.mjs";
import { parseImmoprofessionalDeleteReport } from "../immoprofessional-delete-report-parser.mjs";

const NOW = "2026-08-13T16:40:00.000Z";

function rawDeleteReport(overrides = {}) {
  const target = overrides.target || DELETE_CANARY_TARGET;
  const status = overrides.status || "Erfolgreich gelöscht -";
  const objectCount = overrides.objectCount ?? 1;
  const providerId = overrides.providerId || "30460";
  const messageId = overrides.messageId || "<delete-report@example.server22.invalid>";
  const messageDomain = overrides.messageDomain || "server22.immoprofessional.eu";
  const extra = overrides.extra || "";
  const exchangeTarget = overrides.exchangeTarget || target;
  return Buffer.from([
    `Received: from server22.immoprofessional.eu by mail.example.invalid`,
    `Authentication-Results: mail.example.invalid; spf=pass smtp.mailfrom=${messageDomain}`,
    `Message-ID: ${messageId.replace("example.server22.invalid", messageDomain)}`,
    "Subject: Importbericht OpenImmo XML",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    "eine Importdatei wurde am 13.08.2026 um 18:26 Uhr verarbeitet.",
    "Sendersoftware: Fabian&Pascal Inseratestudio",
    `Anzahl Objekte: ${objectCount}`,
    `Anbieter-ID: ${providerId}`,
    `OK: Objekt-Nr.: "${target}"`,
    status,
    `Das Objekt "${exchangeTarget}" wurde aus der Börse "Immobilienscout24" gelöscht.`,
    `Das Objekt "${exchangeTarget}" wurde aus der Börse "Immowelt" gelöscht.`,
    `Das Objekt "${exchangeTarget}" wurde aus der Börse "www.livinghaus.de" gelöscht.`,
    `Das Objekt "${exchangeTarget}" wurde aus der Börse "Ebay-Kleinanzeigen" gelöscht.`,
    extra,
  ].join("\r\n"), "utf8");
}

async function temporaryRuntime() {
  const directory = await mkdtemp(join(tmpdir(), "fpi-delete-report-test-"));
  const ledger = createDeleteCanaryLedger(join(directory, "jobs.json"));
  const modeStore = createDeleteCanaryModeStore(join(directory, "mode.json"), { now: () => NOW });
  await modeStore.save({ mode: "off", externalObjectNumbers: [] });
  return {
    directory,
    ledger,
    modeStore,
    async cleanup() { await rm(directory, { recursive: true, force: true }); },
  };
}

async function pendingJob(ledger) {
  const identity = createDeleteCanaryJobIdentity();
  const prepared = await ledger.prepare({
    ...identity,
    externalObjectNumber: DELETE_CANARY_TARGET,
    sourceListingId: "synthetic-listing",
    preparedAt: NOW,
    payloadFilename: "synthetic.zip",
    payloadSha256: "a".repeat(64),
    payloadSize: 1,
    transportTarget: "/",
  }, NOW);
  const claimed = await ledger.claim(identity.deleteJobId, {
    expectedUpdatedAt: prepared.updatedAt,
    claimToken: "synthetic-claim",
  }, "2026-08-13T16:40:01.000Z");
  const transferred = await ledger.markTransferred(identity.deleteJobId, {
    expectedUpdatedAt: claimed.updatedAt,
    claimToken: "synthetic-claim",
  }, "2026-08-13T16:40:02.000Z");
  return ledger.markPendingConfirmation(identity.deleteJobId, {
    expectedUpdatedAt: transferred.updatedAt,
  }, "2026-08-13T16:40:03.000Z");
}

test("strict delete report accepts the observed single-object success contract", () => {
  const result = parseImmoprofessionalDeleteReport(rawDeleteReport());
  assert.equal(result.externalObjectNumber, DELETE_CANARY_TARGET);
  assert.equal(result.deleteResult, "success");
  assert.equal(result.providerProcessedAt, "2026-08-13T16:26:00.000Z");
  assert.deepEqual(result.deletedFromExchanges, [
    "Immobilienscout24",
    "Immowelt",
    "www.livinghaus.de",
    "Ebay-Kleinanzeigen",
  ]);
});

test("strict delete report normalizes the observed Apple-Mail UTF-8 mojibake", () => {
  const raw = rawDeleteReport().toString("utf8")
    .replaceAll("gelöscht", "gelÃ¶scht")
    .replaceAll("Börse", "BÃ¶rse");
  const result = parseImmoprofessionalDeleteReport(raw);
  assert.equal(result.externalObjectNumber, DELETE_CANARY_TARGET);
  assert.equal(result.deleteResult, "success");
  assert.equal(result.deletedFromExchanges.length, 4);
});

test("delete report rejects a wrong OK target", () => {
  assert.throws(() => parseImmoprofessionalDeleteReport(rawDeleteReport({ target: "30460-032963" })), /nicht exklusiv/u);
});

test("delete report rejects an exchange target mismatch", () => {
  assert.throws(() => parseImmoprofessionalDeleteReport(rawDeleteReport({ exchangeTarget: "30460-810978" })), /nicht exklusiv/u);
});

test("delete report rejects a missing positive delete status", () => {
  assert.throws(() => parseImmoprofessionalDeleteReport(rawDeleteReport({ status: "Verarbeitung abgeschlossen" })), /erfolgreiche Löschung/u);
});

test("delete report rejects explicit provider warnings", () => {
  assert.throws(() => parseImmoprofessionalDeleteReport(rawDeleteReport({ extra: "WARNUNG: synthetischer Hinweis" })), /Fehler- oder Warnstatus/u);
});

test("delete report rejects explicit provider errors", () => {
  assert.throws(() => parseImmoprofessionalDeleteReport(rawDeleteReport({ extra: "Fehler: synthetische Ablehnung" })), /Fehler- oder Warnstatus/u);
});

test("delete report rejects multiple objects", () => {
  assert.throws(() => parseImmoprofessionalDeleteReport(rawDeleteReport({ objectCount: 2 })), /Einzelobjekt-Delete/u);
});

test("delete report rejects a foreign provider id", () => {
  assert.throws(() => parseImmoprofessionalDeleteReport(rawDeleteReport({ providerId: "99999" })), /Anbieter-ID/u);
});

test("delete report rejects transport without SPF pass", () => {
  const raw = rawDeleteReport().toString("utf8").replace("spf=pass", "spf=fail");
  assert.throws(() => parseImmoprofessionalDeleteReport(raw), /SPF=pass/u);
});

test("pending delete job becomes confirmed only from the exact positive report", async () => {
  const runtime = await temporaryRuntime();
  try {
    const pending = await pendingJob(runtime.ledger);
    const report = parseImmoprofessionalDeleteReport(rawDeleteReport());
    const confirmed = await runtime.ledger.confirm(pending.deleteJobId, {
      externalObjectNumber: report.externalObjectNumber,
      providerReportMessageId: report.messageId,
      providerReportHash: report.rawHash,
      providerResult: report.deleteResult,
      providerProcessedAt: report.providerProcessedAt,
    }, NOW);
    assert.equal(confirmed.status, DELETE_CANARY_STATUS.CONFIRMED);
    assert.equal(confirmed.providerReportHash, report.rawHash);
    assert.equal(confirmed.providerResult, "success");
  } finally { await runtime.cleanup(); }
});

test("duplicate identical confirmation is idempotent", async () => {
  const runtime = await temporaryRuntime();
  try {
    const pending = await pendingJob(runtime.ledger);
    const report = parseImmoprofessionalDeleteReport(rawDeleteReport());
    const input = {
      externalObjectNumber: report.externalObjectNumber,
      providerReportMessageId: report.messageId,
      providerReportHash: report.rawHash,
      providerResult: report.deleteResult,
      providerProcessedAt: report.providerProcessedAt,
    };
    const first = await runtime.ledger.confirm(pending.deleteJobId, input, NOW);
    const second = await runtime.ledger.confirm(pending.deleteJobId, input, "2026-08-13T16:41:00.000Z");
    assert.deepEqual(second, first);
    assert.equal((await runtime.ledger.read()).jobs.length, 1);
  } finally { await runtime.cleanup(); }
});

test("different second report is blocked as ambiguous", async () => {
  const runtime = await temporaryRuntime();
  try {
    const pending = await pendingJob(runtime.ledger);
    const first = parseImmoprofessionalDeleteReport(rawDeleteReport());
    await runtime.ledger.confirm(pending.deleteJobId, {
      externalObjectNumber: first.externalObjectNumber,
      providerReportMessageId: first.messageId,
      providerReportHash: first.rawHash,
      providerResult: first.deleteResult,
    }, NOW);
    await assert.rejects(runtime.ledger.confirm(pending.deleteJobId, {
      externalObjectNumber: DELETE_CANARY_TARGET,
      providerReportMessageId: "<different@server22.immoprofessional.eu>",
      providerReportHash: "b".repeat(64),
      providerResult: "success",
    }, "2026-08-13T16:41:00.000Z"), { code: "DELETE_CONFIRMATION_AMBIGUOUS" });
  } finally { await runtime.cleanup(); }
});

test("CLI confirmation stays off and never accesses FTPS or catalog state", async () => {
  const runtime = await temporaryRuntime();
  try {
    await pendingJob(runtime.ledger);
    let reportReads = 0;
    const result = await runDeleteCanaryCli([
      "confirm-report",
      "--external-id", DELETE_CANARY_TARGET,
      "--report", "synthetic.eml",
    ], {
      modeStore: runtime.modeStore,
      ledger: runtime.ledger,
      readReport: async () => { reportReads += 1; return rawDeleteReport(); },
      writeLog: async () => undefined,
      now: () => NOW,
    });
    assert.equal(result.ok, true);
    assert.equal(result.job.status, DELETE_CANARY_STATUS.CONFIRMED);
    assert.equal(reportReads, 1);
    assert.equal((await runtime.modeStore.load()).mode, "off");
  } finally { await runtime.cleanup(); }
});
