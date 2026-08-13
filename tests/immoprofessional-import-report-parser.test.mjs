import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseImmoprofessionalImportReport } from "../immoprofessional-import-report-parser.mjs";

const fixtureUrl = new URL("./fixtures/immoprofessional-import-success.eml", import.meta.url);
const fixture = await readFile(fixtureUrl, "utf8");

function changed(source, from, to) {
  const output = source.replace(from, to);
  assert.notEqual(output, source, `Testvorbereitung konnte ${String(from)} nicht ersetzen.`);
  return output;
}

test("parses the strict real-world single-object success contract and prefers plaintext", () => {
  const report = parseImmoprofessionalImportReport(fixture);
  assert.equal(report.externalObjectNumber, "30460-810978");
  assert.equal(report.providerId, "30460");
  assert.equal(report.objectCount, 1);
  assert.equal(report.providerImportAt, "2026-08-13T09:16:00.000Z");
  assert.equal(report.senderSoftware, "Fabian&Pascal Inseratestudio");
  assert.equal(report.importResult, "success");
  assert.equal(report.bodySource, "text/plain");
  assert.equal(report.transport.messageIdDomain, "server22.immoprofessional.eu");
  assert.equal(report.transport.spfPassed, true);
  assert.match(report.rawHash, /^[a-f0-9]{64}$/u);
});

for (const [label, from, to, expected] of [
  ["wrong subject", "Subject: Importbericht OpenImmo XML", "Subject: Allgemeiner Importhinweis", /Mailbetreff/u],
  ["wrong sender software", "Sendersoftware: Fabian&Pascal Inseratestudio", "Sendersoftware: Fremdsystem", /Sendersoftware/u],
  ["wrong provider", "Anbieter-ID: 30460", "Anbieter-ID: 99999", /Anbieter-ID/u],
  ["batch import", "Anzahl Objekte: 1", "Anzahl Objekte: 2", /Einzelobjekt/u],
  ["missing OK", "- OK: Erfolgreich importiert - Objekt-Nr.: \"30460-810978\"", "- Hinweis: importiert - Objekt-Nr.: \"30460-810978\"", /Erfolgszeile/u],
  ["missing object number", "- OK: Erfolgreich importiert - Objekt-Nr.: \"30460-810978\"", "- OK: Erfolgreich importiert", /Erfolgszeile/u],
  ["unknown success wording", "Erfolgreich importiert", "Import erfolgreich abgeschlossen", /Erfolgszeile/u],
]) {
  test(`fails closed for ${label}`, () => {
    assert.throws(() => parseImmoprofessionalImportReport(changed(fixture, from, to)), expected);
  });
}

test("uses HTML only when plaintext is absent", () => {
  const raw = `Received: from server22.immoprofessional.eu by mail.example.invalid\nAuthentication-Results: mx; spf=pass\nMessage-ID: <html-only@server22.immoprofessional.eu>\nSubject: Importbericht OpenImmo XML\nContent-Type: text/html; charset=utf-8\n\n<p>eine Importdatei wurde am 13.08.2026 um 11:16 Uhr verarbeitet.</p><p>Sendersoftware: Fabian&amp;Pascal Inseratestudio</p><p>Anzahl Objekte: 1</p><p>Anbieter-ID: 30460</p><p>Firma: Synthetische Testfirma</p><p>E-Mail: test@example.invalid</p><p>- OK: Erfolgreich importiert - Objekt-Nr.: &quot;30460-123456&quot;</p>`;
  const report = parseImmoprofessionalImportReport(raw);
  assert.equal(report.bodySource, "text/html");
  assert.equal(report.externalObjectNumber, "30460-123456");
});

test("rejects broken multipart MIME, missing SPF and untrusted transport", () => {
  assert.throws(() => parseImmoprofessionalImportReport(fixture.replace("--synthetic-import-boundary--", "--wrong-boundary--")), /MIME-Struktur/u);
  assert.throws(() => parseImmoprofessionalImportReport(fixture.replaceAll("spf=pass", "spf=neutral").replace(/^Received-SPF: pass.*\n/mu, "")), /SPF/u);
  assert.throws(() => parseImmoprofessionalImportReport(fixture.replaceAll("server22.immoprofessional.eu", "untrusted.example.invalid")), /Immoprofessional-Host/u);
});
