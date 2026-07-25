import assert from "node:assert/strict";
import test from "node:test";

import { applyPlotImportPreview, parsePlotWorkbookRows } from "../app/lib/address-import.ts";

const headers = ["Straße", "Hausnummer", "PLZ", "Ort", "Grundstücksfläche m²", "Grundstückspreis €", "Lagefakten"];

test("previews valid, invalid and duplicate Excel rows without changing stored records", () => {
  const existing = [{
    id: "plot-existing", street: "Kirschallee", houseNumber: "12", postalCode: "14469", city: "Potsdam",
    plotSizeSqm: 700, purchasePrice: 300000, regionalNotes: "", exposeFileReference: "", exposeFilename: "", exposeUploadedAt: "",
    createdAt: "2026-07-20T10:00:00.000Z", updatedAt: "2026-07-20T10:00:00.000Z", isActive: true,
  }];
  let id = 0;
  const preview = parsePlotWorkbookRows([
    ["Grundstücke"],
    headers,
    ["Kirschallee", "12", "14469", "Potsdam", 720, 325000, "grün"],
    ["Neue Straße", "2", "14532", "Kleinmachnow", 600, 250000],
    ["Ohne Ort", "1", "14469", "", 500, 200000],
  ], existing, () => `new-${++id}`, "pascal");

  assert.equal(preview.rows.length, 3);
  assert.equal(preview.rows[0].status, "duplicate");
  assert.equal(preview.rows[0].action, "skip");
  assert.equal(preview.rows[1].status, "valid");
  assert.equal(preview.rows[2].status, "invalid");
  assert.equal(preview.rows[2].selected, false);
  assert.equal(existing[0].plotSizeSqm, 700);
});

test("updates a duplicate only after explicit decision and preserves its expose reference", () => {
  const existing = [{
    id: "plot-existing", street: "Kirschallee", houseNumber: "12", postalCode: "14469", city: "Potsdam",
    plotSizeSqm: 700, purchasePrice: 300000, regionalNotes: "alt", exposeFileReference: "plot/file.pdf", exposeFilename: "Expose.pdf", exposeUploadedAt: "2026-07-20T10:00:00.000Z",
    createdAt: "2026-07-20T10:00:00.000Z", updatedAt: "2026-07-20T10:00:00.000Z", isActive: true,
  }];
  const preview = parsePlotWorkbookRows([headers, ["Kirschallee", "12", "14469", "Potsdam", 720, 325000, "neu"]], existing, () => "new", "pascal");
  preview.rows[0].action = "update";
  const result = applyPlotImportPreview(existing, preview.rows, "2026-07-25T10:00:00.000Z");
  assert.equal(result.updated, 1);
  assert.equal(result.created, 0);
  assert.equal(result.plots[0].id, "plot-existing");
  assert.equal(result.plots[0].plotSizeSqm, 720);
  assert.equal(result.plots[0].purchasePrice, 325000);
  assert.equal(result.plots[0].exposeFileReference, "plot/file.pdf");
});

test("allows creating a separate record for a reviewed duplicate", () => {
  const existing = [{ id: "old", street: "Weg", houseNumber: "1", postalCode: "12345", city: "Ort", isActive: true }];
  const preview = parsePlotWorkbookRows([headers, ["Weg", "1", "12345", "Ort", 500, 200000]], existing, () => "new", "fabian");
  preview.rows[0].action = "create";
  const result = applyPlotImportPreview(existing, preview.rows, "2026-07-25T10:00:00.000Z");
  assert.equal(result.created, 1);
  assert.equal(result.plots.length, 2);
});
