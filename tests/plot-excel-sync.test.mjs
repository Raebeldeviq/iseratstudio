import assert from "node:assert/strict";
import test from "node:test";
import { applyPlotSyncRows, normalizeListingUrl, parsePlotSyncRows } from "../plot-excel-sync.mjs";

const HEADERS = ["Postleitzahl", "Ort", "Straße", "Größe (m²)", "Preis (€)", "Quelle", "Inseratslink", "Erstmals gefunden", "Zuletzt geprüft", "Status", "Exposé-Dateiname", "Interne ID"];

function workbookRow({
  postalCode = "14469", city = "Potsdam", street = "Kirschallee 12", size = 700, price = 300000,
  source = "Quelle", url = "https://example.test/expose/1/?tracking=yes", status = "Neu", internalId = "KI-1",
} = {}) {
  return [postalCode, city, street, size, price, source, url, new Date("2026-07-20T00:00:00Z"), new Date("2026-07-25T00:00:00Z"), status, "expose.pdf", internalId];
}

function emptyState() {
  return { version: 1, plots: [], projects: [], houses: [], provider: {} };
}

test("new rows are idempotent and URL parameters are normalized", () => {
  const rows = parsePlotSyncRows([HEADERS, workbookRow()]);
  const first = applyPlotSyncRows(emptyState(), rows, { now: "2026-07-25T10:00:00.000Z" });
  assert.equal(first.stats.created, 1);
  assert.equal(first.state.plots[0].sourceInternalId, "KI-1");
  assert.equal(normalizeListingUrl(first.state.plots[0].listingUrl), "https://example.test/expose/1");
  const second = applyPlotSyncRows(first.state, rows, { now: "2026-07-25T11:00:00.000Z" });
  assert.equal(second.state.plots.length, 1);
  assert.equal(second.stats.created, 0);
  assert.equal(second.stats.skipped, 1);
  assert.equal(second.stats.duplicatesPrevented, 1);
});

test("existing rows match by internal ID before URL and update source fields", () => {
  const state = {
    ...emptyState(),
    plots: [{ id: "plot", sourceInternalId: "KI-1", listingUrl: "https://old.test/one", street: "Altweg", houseNumber: "1", postalCode: "14469", city: "Potsdam", plotSizeSqm: 500, purchasePrice: 100000, exposeFileReference: "local-expose", exposeFilename: "local.pdf", isActive: true }],
  };
  const rows = parsePlotSyncRows([HEADERS, workbookRow({ status: "Vorhanden", price: 310000, url: "https://new.test/two" })]);
  const result = applyPlotSyncRows(state, rows, { now: "2026-07-25T10:00:00.000Z" });
  assert.equal(result.stats.updated, 1);
  assert.equal(result.state.plots[0].purchasePrice, 310000);
  assert.equal(result.state.plots[0].exposeFileReference, "local-expose");
  assert.equal(result.state.plots[0].id, "plot");
});

test("existing rows match a normalized listing URL when no internal ID exists", () => {
  const state = {
    ...emptyState(),
    plots: [{ id: "plot", listingUrl: "https://example.test/expose/1/", street: "Weg", houseNumber: "2", postalCode: "14469", city: "Potsdam", plotSizeSqm: 500, purchasePrice: 100000, isActive: true }],
  };
  const rows = parsePlotSyncRows([HEADERS, workbookRow({ status: "Vorhanden", internalId: "", url: "https://example.test/expose/1?utm_source=test" })]);
  const result = applyPlotSyncRows(state, rows, { now: "2026-07-25T10:00:00.000Z" });
  assert.equal(result.stats.updated, 1);
  assert.equal(result.state.plots.length, 1);
});

test("inactive source status hides a plot and blocks its project without deleting history", () => {
  const state = {
    ...emptyState(),
    plots: [{ id: "plot", sourceInternalId: "KI-1", street: "Kirschallee", houseNumber: "12", postalCode: "14469", city: "Potsdam", plotSizeSqm: 700, purchasePrice: 300000, isActive: true }],
    projects: [{ id: "project", plotId: "plot", street: "Kirschallee", houseNumber: "12", zip: "14469", city: "Potsdam", listings: [{ id: "listing", externalId: "external" }] }],
  };
  const rows = parsePlotSyncRows([HEADERS, workbookRow({ status: "Nicht mehr vorhanden" })]);
  const result = applyPlotSyncRows(state, rows, { now: "2026-07-25T10:00:00.000Z" });
  assert.equal(result.stats.deactivated, 1);
  assert.equal(result.state.plots[0].isActive, false);
  assert.equal(result.state.projects[0].isActive, false);
  assert.equal(result.state.projects[0].listings[0].externalId, "external");
  assert.equal(result.warnings.length, 1);
});

test("ambiguous addresses, unknown statuses and incomplete new rows become record errors", () => {
  const duplicate = { street: "Kirschallee", houseNumber: "12", postalCode: "14469", city: "Potsdam", plotSizeSqm: 700, purchasePrice: 300000, isActive: true };
  const state = { ...emptyState(), plots: [{ ...duplicate, id: "one" }, { ...duplicate, id: "two" }] };
  const rows = parsePlotSyncRows([
    HEADERS,
    workbookRow({ status: "Vorhanden", internalId: "", url: "" }),
    workbookRow({ status: "Unbekannt", internalId: "KI-2", url: "https://example.test/2" }),
    workbookRow({ street: "", internalId: "KI-3", url: "https://example.test/3" }),
  ]);
  const result = applyPlotSyncRows(state, rows, { now: "2026-07-25T10:00:00.000Z" });
  assert.equal(result.stats.failed, 3);
  assert.equal(result.stats.duplicatesPrevented, 1);
  assert.equal(result.state.plots.length, 2);
});

test("200 source plots complete and a repeated run creates no duplicates", () => {
  const workbook = [HEADERS];
  for (let index = 0; index < 200; index += 1) {
    workbook.push(workbookRow({
      postalCode: String(12000 + index),
      street: `Teststraße ${index + 1}`,
      url: `https://example.test/${index}`,
      internalId: `KI-${index}`,
    }));
  }
  const rows = parsePlotSyncRows(workbook);
  const first = applyPlotSyncRows(emptyState(), rows, { now: "2026-07-25T10:00:00.000Z" });
  const second = applyPlotSyncRows(first.state, rows, { now: "2026-07-25T11:00:00.000Z" });
  assert.equal(first.stats.created, 200);
  assert.equal(second.state.plots.length, 200);
  assert.equal(second.stats.created, 0);
  assert.equal(second.stats.duplicatesPrevented, 200);
});
