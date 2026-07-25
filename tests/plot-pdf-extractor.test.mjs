import assert from "node:assert/strict";
import test from "node:test";

import { extractPlotFieldsFromPdf, extractPlotFieldsFromText } from "../plot-pdf-extractor.mjs";

function minimalPdf(lines) {
  const escapedLines = lines.map((line) => String(line).replace(/([\\()])/gu, "\\$1"));
  const content = `BT /F1 12 Tf 72 720 Td 16 TL ${escapedLines.map((line, index) => `${index ? "T* " : ""}(${line}) Tj`).join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body, "binary");
}

test("extracts only the five requested plot values from text and leaves missing values empty", () => {
  const fields = extractPlotFieldsFromText(`
Adresse: Kirschallee 12
14469 Potsdam
Grundstücksfläche: 720 m²
Kaufpreis: 325.000 EUR
Makler: Beispiel GmbH
Bebaubarkeit: nicht geprüft
  `);
  assert.equal(fields.street, "Kirschallee");
  assert.equal(fields.houseNumber, "12");
  assert.equal(fields.postalCode, "14469");
  assert.equal(fields.city, "Potsdam");
  assert.equal(fields.plotSizeSqm, 720);
  assert.equal(fields.purchasePrice, 325000);
  assert.deepEqual(Object.keys(fields).sort(), ["city", "houseNumber", "plotSizeSqm", "postalCode", "purchasePrice", "reviewRequired", "street"].sort());
});

test("marks uncertain values for manual review instead of inventing them", () => {
  const fields = extractPlotFieldsFromText("Grundstück in Potsdam\nBitte anfragen");
  assert.equal(fields.street, "");
  assert.equal(fields.postalCode, "");
  assert.equal(fields.purchasePrice, 0);
  assert.equal(fields.reviewRequired.street, true);
  assert.equal(fields.reviewRequired.purchasePrice, true);
});

test("reads the five fields from a real local PDF byte stream", async () => {
  const result = await extractPlotFieldsFromPdf(minimalPdf([
    "Adresse: Kirschallee 12",
    "14469 Potsdam",
    "Grundstuecksflaeche: 720 m2",
    "Kaufpreis: 325.000 EUR",
  ]));
  assert.equal(result.pageCount, 1);
  assert.equal(result.fields.street, "Kirschallee");
  assert.equal(result.fields.postalCode, "14469");
  assert.equal(result.fields.city, "Potsdam");
  assert.equal(result.fields.plotSizeSqm, 720);
  assert.equal(result.fields.purchasePrice, 325000);
});
