import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  analyzePlotExpose,
  archivePlotExpose,
  commitPlotExpose,
  readPlotExpose,
} from "../plot-expose-store.mjs";

function minimalPdf() {
  const content = "BT /F1 12 Tf 72 720 Td 16 TL (Adresse: Kirschallee 12) Tj T* (14469 Potsdam) Tj T* (Grundstuecksflaeche: 720 m2) Tj T* (Kaufpreis: 325.000 EUR) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body, "binary");
}

test("stages, commits, reads and recoverably archives a local plot expose", async (context) => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "plot-expose-store-"));
  context.after(() => rm(rootDirectory, { recursive: true, force: true }));
  const analyzed = await analyzePlotExpose({ data: minimalPdf(), filename: "Grundstück Potsdam.pdf" }, { rootDirectory });
  assert.match(analyzed.temporaryReference, /^\.pending\//u);
  assert.equal(analyzed.fields.postalCode, "14469");
  assert.equal(analyzed.fields.purchasePrice, 325000);

  const stored = await commitPlotExpose({
    temporaryReference: analyzed.temporaryReference,
    plotId: "plot-1",
    filename: analyzed.filename,
  }, { rootDirectory });
  assert.match(stored.reference, /^plot-1\//u);
  const loaded = await readPlotExpose(stored.reference, { rootDirectory });
  assert.equal(loaded.data.subarray(0, 5).toString("ascii"), "%PDF-");

  await archivePlotExpose(stored.reference, { rootDirectory });
  await assert.rejects(() => readPlotExpose(stored.reference, { rootDirectory }));
});

test("rejects non-PDF input and path traversal references", async (context) => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "plot-expose-store-"));
  context.after(() => rm(rootDirectory, { recursive: true, force: true }));
  await assert.rejects(
    () => analyzePlotExpose({ data: Buffer.from("not a pdf"), filename: "fake.pdf" }, { rootDirectory }),
    /gültige PDF-Datei/u,
  );
  await assert.rejects(() => readPlotExpose("../secret.pdf", { rootDirectory }), /Referenz ist ungültig/u);
});
