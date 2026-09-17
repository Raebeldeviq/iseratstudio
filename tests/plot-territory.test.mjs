import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTerritoryPostalCodes, partitionPlotsByTerritory } from "../plot-territory.mjs";
import { loadPlotTerritory } from "../plot-territory-source.mjs";
import { createPlotSyncService } from "../plot-sync-service.mjs";
import { selectablePlotIds } from "../plot-selection.mjs";

const territory = { available: true, postalCodes: ["10115", "14469"], message: "" };
const plot = (id, postalCode, extra = {}) => ({ id, postalCode, street: `Teststraße ${id}`, houseNumber: "4", city: "Testort", isActive: true, ...extra });

test("active territory uses exact five-digit PLZ, not region names or prefixes", () => {
  assert.deepEqual(parseTerritoryPostalCodes([["Postleitzahl", "Aktiv"], [10115, "Ja"], [1067, true], ["14469", "Nein"], [null, null]]), ["01067", "10115"]);
  const sections = partitionPlotsByTerritory([plot("out", "10116"), plot("in", "10115")], territory);
  assert.deepEqual(sections.map((s) => [s.id, s.plots.map((p) => p.id)]), [["inside", ["in"]], ["outside", ["out"]]]);
});

test("missing headers, invalid active PLZ, duplicates, empty scope and unclear activation fail closed", () => {
  for (const rows of [[], [["PLZ"]], [["PLZ", "Aktiv"]], [["PLZ", "Aktiv"], ["1446", "Ja"]], [["PLZ", "Aktiv"], [null, "Ja"]], [["PLZ", "Aktiv"], ["14469", "Ja"], [14469, true]], [["PLZ", "Aktiv"], ["14469", "Vielleicht"]]]) {
    assert.throws(() => parseTerritoryPostalCodes(rows));
  }
});

test("unknown territory is not falsely classified as outside; malformed plot PLZ is unknown", () => {
  for (const value of [null, { available: false, postalCodes: ["10115"] }, { available: true, postalCodes: [] }, { available: true, postalCodes: ["bad"] }, { available: true, postalCodes: ["10115", "10115"] }]) {
    assert.deepEqual(partitionPlotsByTerritory([plot("a", "10115")], value).map((s) => s.id), ["unknown"]);
  }
  assert.deepEqual(partitionPlotsByTerritory([plot("a", "")], territory).find((s) => s.id === "unknown").plots.map((p) => p.id), ["a"]);
});

test("manual outside plots remain selectable and changes to the PLZ list only regroup", () => {
  const plots = [plot("manual", "99999"), plot("own", "10115"), plot("hidden", "99999", { street: "Adresse nicht öffentlich angegeben" })];
  const before = structuredClone(plots);
  assert.deepEqual(selectablePlotIds(plots, plots.map((p) => p.id)), ["manual", "own"]);
  assert.equal(partitionPlotsByTerritory(plots, territory)[1].plots.length, 2);
  const changed = partitionPlotsByTerritory(plots, { available: true, postalCodes: ["99999"] });
  assert.deepEqual(changed[0].plots.map((p) => p.id), ["manual", "hidden"]);
  assert.deepEqual(plots, before);
});

test("published listings and histories stay untouched regardless of territory or Excel membership", () => {
  const state = { plots: [plot("legacy", "99999")], projects: [{ plotId: "legacy", listings: [{ id: "online", status: "published" }] }], selectedPlotIds: ["legacy"] };
  const before = structuredClone(state);
  partitionPlotsByTerritory(state.plots, territory);
  assert.deepEqual(state, before);
});

test("source loader reads one snapshot and the Suchgebiet sheet without writes", async () => {
  const bytes = Buffer.from("synthetic-workbook");
  const calls = [];
  const result = await loadPlotTerritory("synthetic.xlsx", {
    readFile: async (path) => { calls.push(path); return bytes; },
    readSheet: async (input, sheet) => { assert.equal(input, bytes); assert.equal(sheet, "Suchgebiet"); return [["PLZ", "Aktiv"], ["10115", "Ja"]]; },
  });
  assert.deepEqual(calls, ["synthetic.xlsx"]);
  assert.deepEqual(result, { available: true, postalCodes: ["10115"], message: "" });
  const failed = await loadPlotTerritory("missing.xlsx", { readFile: async () => { throw Error("private-path-not-for-display"); } });
  assert.equal(failed.available, false);
  assert.deepEqual(failed.postalCodes, []);
  assert.doesNotMatch(failed.message, /private-path/);
});

test("status returns current territory even when sync is paused, ignores stale saved scope and writes nothing", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "fpi-territory-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const statePath = join(root, "status.json");
  const saved = JSON.stringify({ territory: { available: true, postalCodes: ["99999"] } });
  await writeFile(statePath, saved);
  let current = territory;
  const service = createPlotSyncService({ config: { statePath, sourcePath: join(root, "missing.xlsx") }, loadTerritory: async () => current, loadCatalog: () => { throw Error("No catalog access"); } });
  assert.deepEqual((await service.loadStatus()).territory, territory);
  current = { available: false, postalCodes: [], message: "unavailable" };
  const second = await service.loadStatus();
  assert.deepEqual(second.territory, current);
  assert.equal(second.scheduleEnabled, false);
  assert.equal(await readFile(statePath, "utf8"), saved);
  assert.deepEqual(await readdir(root), ["status.json"]);
});

test("installed XLSX reader selects Suchgebiet rather than the first worksheet", async () => {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
  zip.file("xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Grundstücke" sheetId="1" r:id="rId1"/><sheet name="Suchgebiet" sheetId="2" r:id="rId2"/></sheets></workbook>');
  zip.file("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  zip.file("xl/styles.xml", '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="1"><xf numFmtId="0"/></cellXfs></styleSheet>');
  const sheet = (rows) => `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((values, row) => `<row r="${row + 1}">${values.map((value, column) => `<c r="${String.fromCharCode(65 + column)}${row + 1}" t="inlineStr"><is><t>${value}</t></is></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`;
  zip.file("xl/worksheets/sheet1.xml", sheet([["PLZ", "Aktiv"], ["99999", "Ja"]]));
  zip.file("xl/worksheets/sheet2.xml", sheet([["PLZ", "Aktiv"], ["10115", "Ja"], ["14469", "Nein"]]));
  const bytes = await zip.generateAsync({ type: "nodebuffer" });
  const { readSheet } = await import("read-excel-file/node");
  assert.deepEqual(await readSheet(bytes, "Suchgebiet"), [["PLZ", "Aktiv"], ["10115", "Ja"], ["14469", "Nein"]]);
  const result = await loadPlotTerritory("synthetic.xlsx", { readFile: async () => bytes });
  assert.deepEqual(result, { available: true, postalCodes: ["10115"], message: "" });
});

async function renderPlots(plots, overrides = {}) {
  const ts = await import("typescript");
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const url = new URL("../app/components/PlotManagement.tsx", import.meta.url);
  const compiled = ts.transpileModule(await readFile(url, "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const resolved = compiled.replace(/from (["'])([^"']+)\1/g, (_match, _quote, specifier) => `from ${JSON.stringify(specifier.startsWith(".") ? new URL(specifier + (specifier === "../lib/address-import" ? ".ts" : ""), url).href : import.meta.resolve(specifier))}`);
  const { default: Component } = await import("data:text/javascript;base64," + Buffer.from(resolved).toString("base64"));
  return renderToStaticMarkup(createElement(Component, {
    plots, selectedPlotIds: [], defaultOwner: "pascal", helperOnline: true,
    helperRequest: () => { throw Error("No requests during render"); }, linkedProjectCounts: {},
    selectionMeta: Object.fromEntries(plots.map((p) => [p.id, { regionLabel: "Gleicher Landkreis", listingCount: 1, uploadDate: "" }])),
    syncStatus: { territory, config: {} }, syncBusy: false, onSelectionChange: () => {}, onSave: () => {}, onDelete: () => { throw Error("No deletion"); }, onSync: () => {}, onScheduleChange: () => {}, ...overrides,
  }));
}

test("render separates same county into inside then outside, PLZ ascending in each; outside checkbox enabled", async () => {
  const html = await renderPlots([plot("outside-high", "99999"), plot("inside-high", "14469"), plot("outside-low", "10116"), plot("inside-low", "10115")]);
  assert.ok(html.indexOf('aria-label="Im eigenen PLZ-Gebiet"') < html.indexOf('aria-label="Außerhalb des eigenen PLZ-Gebiets"'));
  assert.ok(html.indexOf("Teststraße inside-low") < html.indexOf("Teststraße inside-high"));
  assert.ok(html.indexOf("Teststraße inside-high") < html.indexOf("Teststraße outside-low"));
  assert.ok(html.indexOf("Teststraße outside-low") < html.indexOf("Teststraße outside-high"));
  assert.equal((html.match(/<b>Gleicher Landkreis<\/b>/g) || []).length, 2);
  assert.equal((html.match(/type="checkbox"/g) || []).length, 4);
  assert.doesNotMatch(html, /type="checkbox"[^>]*disabled/);
  assert.match(html, /value="postalCode" selected/);
});

test("offline rendering never reuses stale territory; private addresses remain excluded", async () => {
  const html = await renderPlots([plot("public", "10115"), plot("hidden", "14469", { street: "Adresse nicht öffentlich angegeben" })], { helperOnline: false });
  assert.match(html, /aria-label="Gebietszuordnung nicht verfügbar"/);
  assert.doesNotMatch(html, /aria-label="Im eigenen PLZ-Gebiet"/);
  assert.doesNotMatch(html, /Adresse nicht öffentlich angegeben/);
});
