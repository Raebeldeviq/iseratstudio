import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { catalogSourceReady, operationalCatalogPlots, rememberActiveCatalogSource, resolveActiveCatalogSource } from "../plot-active-catalog.mjs";
import { loadActivePlotCatalogSource } from "../plot-active-catalog-source.mjs";
import { createActivePlotCatalogService } from "../plot-active-catalog-service.mjs";
import { createPlotMasterService } from "../plot-master-service.mjs";
import { createMasterWorkbook, readMasterWorkbook } from "../plot-master-workbook.mjs";
import { applyMasterRowsToPlot, generatePoolB } from "../plot-master-sync.mjs";
import { plotAddressSelection, selectablePlotIds } from "../plot-selection.mjs";

const territory = { available: true, postalCodes: ["14469"], regions: { "14469": "Potsdam" } };
const row = (id, extra = {}) => ({ plotId: id, street: "Testweg", houseNumber: "2", postalCode: "14469", city: "Potsdam", plotSizeSqm: 518, purchasePrice: 129500, mode: "AUTO_GENERATED", status: "", ...extra });
const plot = (id, extra) => { const a = row(id, extra); return applyMasterRowsToPlot(null, a, generatePoolB(a), "2026-10-07T00:00:00.000Z"); };
const live = { available: true, excelAvailable: true, sourcePath: "master.xlsx", territory, masterPlots: [plot("own-0")] };
const rawRows = rows => [["plotId", "Straße", "Hausnummer", "PLZ", "Ort", "Grundstücksfläche m²", "Grundstückspreis €", "PoolBModus", "PoolBStatus"],
  ...rows.map(r => [r.plotId, r.street, r.houseNumber, r.postalCode, r.city, r.plotSizeSqm, r.purchasePrice, r.mode, r.status])];
const failed = { available: false, excelAvailable: false, territory: null, masterPlots: [] };
const fixture = () => {
  const plots = [
    ...Array.from({ length: 35 }, (_, i) => plot(`own-${i}`)),
    ...Array.from({ length: 16 }, (_, i) => plot(`review-${i}`, { street: "Adresse nicht öffentlich angegeben" })),
    ...Array.from({ length: 73 }, (_, i) => plot(`old-${i}`, { postalCode: "99999", street: i % 2 ? "Altweg" : "Adresse nicht öffentlich angegeben" })),
    ...Array.from({ length: 4 }, (_, i) => ({ ...plot(`archived-${i}`), isActive: false })),
  ];
  return { plots, activePlotCatalog: { version: 1, approvedAt: "2026-10-07T11:56:57.279Z", legacyPlotIds: plots.map(p => p.id) },
    selectedPlotIds: ["own-0"], projects: [{ id: "project", plotId: "old-0", listings: [{ id: "published", status: "published", images: ["kept"] }] }],
    uploadHistory: [{ id: "upload" }], deleteBatches: [{ id: "batch", status: "pending" }], audit: [{ id: "audit" }] };
};

test("persisted source keeps 51 own plots, 35 selectable and 16 reviews across offline restart without reviving legacy plots", () => {
  const initial = fixture();
  const before = structuredClone(initial);
  const cached = rememberActiveCatalogSource(initial, live);
  assert.deepEqual(initial, before);
  for (const key of ["plots", "projects", "uploadHistory", "deleteBatches", "audit", "selectedPlotIds"]) assert.equal(cached[key], initial[key]);
  assert.equal(rememberActiveCatalogSource(cached, live), cached, "polling identical data must not repeatedly save");
  assert.equal(rememberActiveCatalogSource(cached, failed), cached, "failures must not overwrite the valid source");
  const restored = JSON.parse(JSON.stringify(cached));
  for (const source of [failed, null, resolveActiveCatalogSource(failed, restored.activePlotCatalog.lastValidSource)]) {
    const context = { source, policy: restored.activePlotCatalog };
    const active = operationalCatalogPlots(restored.plots, context);
    assert.equal(active.length, 51);
    assert.equal(active.filter(p => !plotAddressSelection(p).selectable).length, 16);
    assert.equal(selectablePlotIds(restored.plots, restored.plots.map(p => p.id), context).length, 35);
    assert.ok(active.every(p => !p.id.startsWith("old-") && !p.id.startsWith("archived-")));
  }
  assert.deepEqual(restored.plots, JSON.parse(JSON.stringify(before.plots)), "Pool A/B and active flags remain unchanged");
  assert.equal(operationalCatalogPlots(initial.plots, { source: failed, policy: initial.activePlotCatalog }).length, 0, "never guess an uncached territory");
});

test("master failure bootstraps existing Suchgebiet but persisted territory wins; reconnect removes fallback", async () => {
  const paths = [];
  const fallback = await loadActivePlotCatalogSource({ path: "cloud", territoryPath: "existing-local-source",
    readWorkbook: async () => { throw Error("Unknown system error -11, read"); },
    loadTerritory: async path => { paths.push(path); return territory; } });
  assert.deepEqual(paths, ["existing-local-source"]);
  assert.equal(catalogSourceReady(fallback), true);
  assert.equal(fallback.excelAvailable, false);
  assert.doesNotMatch(fallback.message, /-11|read|stack/iu);
  const cached = rememberActiveCatalogSource(fixture(), live);
  let current = { ...fallback, territory: { available: true, postalCodes: ["99999"] } };
  let writes = 0;
  const service = createActivePlotCatalogService({ loadSource: async () => current, loadCatalog: async () => ({ state: cached }), start: async () => { writes++; } });
  const offline = await service.source();
  assert.deepEqual(offline.territory, territory);
  assert.equal(offline.fallback, true);
  await assert.rejects(service.preview(), { httpStatus: 503 });
  await assert.rejects(service.apply({ confirmed: true, token: "old" }), { httpStatus: 503 });
  assert.equal(writes, 0);
  current = live;
  assert.equal(await service.source(), live);
  assert.equal((await service.source()).excelAvailable, true);
  assert.equal((await service.source()).fallback, undefined);
});

test("missing or empty master cannot become a valid source", async () => {
  for (const workbook of [{ bytes: null, poolA: [], poolB: [] }, { bytes: await createMasterWorkbook([], []), poolA: [], poolB: [] }]) {
    const result = await loadActivePlotCatalogSource({ readWorkbook: async () => workbook, loadTerritory: async () => territory });
    assert.equal(result.excelAvailable, false);
    assert.equal(result.fallback, true);
  }
});

test("unreadable, missing and empty Excel reject preview and apply before any mutation; sync works after recovery", async () => {
  const directory = await mkdtemp(join(tmpdir(), "icloud-master-"));
  const path = join(directory, "master.xlsx");
  const a = row("own-0"), b = generatePoolB(a);
  const bytes = await createMasterWorkbook([a], [b], rawRows([a]), rawRows([b]));
  let manifest = { stored: true, savedAt: "initial", state: { ...fixture(), plots: fixture().plots.map(p => p.id === "own-0" ? { ...p, purchasePrice: 140000 } : p) } };
  let before;
  let mode = "online", staged, commits = 0, stages = 0;
  const service = createPlotMasterService({ path, loadCatalog: async () => manifest,
    readWorkbook: async file => {
      if (mode === "error") throw Error("Unknown system error -11, read");
      if (mode === "missing") return { bytes: null, poolA: [], poolB: [] };
      if (mode === "empty") return { bytes: await createMasterWorkbook([], []), poolA: [], poolB: [] };
      return readMasterWorkbook(file);
    }, stageCatalog: async input => { stages++; staged = input; return {}; },
    commitCatalog: async () => { commits++; manifest = { stored: true, savedAt: staged.savedAt, state: staged.state }; }, discardCatalog: async () => { staged = undefined; } });
  try {
    await writeFile(path, bytes);
    const initialWorkbook = await readMasterWorkbook(path);
    manifest.state.plots[0] = { ...applyMasterRowsToPlot(manifest.state.plots[0], initialWorkbook.poolA[0], initialWorkbook.poolB[0], "2026-10-07T00:00:00.000Z"), purchasePrice: 140000 };
    before = structuredClone(manifest);
    const preview = await service.preview();
    for (mode of ["error", "missing", "empty"]) {
      await assert.rejects(service.preview(), { code: "MASTER_UNAVAILABLE", httpStatus: 503 });
      await assert.rejects(service.apply({ token: preview.token, decisions: { "own-0": "remove-app" } }), { code: "MASTER_UNAVAILABLE" });
      assert.deepEqual(await readdir(directory), ["master.xlsx"], "no lock or temporary workbook written");
      assert.deepEqual(await readFile(path), bytes);
      assert.deepEqual(manifest, before);
      assert.equal(stages, 0); assert.equal(commits, 0);
    }
    mode = "online";
    const retry = await service.preview();
    assert.equal(retry.counts.update, 1);
    assert.equal((await service.apply({ token: retry.token })).applied, true);
    assert.equal((await readMasterWorkbook(path)).poolA.find(r => r.plotId === "own-0").purchasePrice, 140000);
    for (const key of ["uploadHistory", "deleteBatches", "audit"]) assert.deepEqual(manifest.state[key], before.state[key]);
    assert.deepEqual(manifest.state.projects.map(p => p.listings), before.state.projects.map(p => p.listings));
    assert.ok(manifest.state.plots.filter(p => p.id.startsWith("archived-")).every(p => p.isActive === false));
    assert.equal((await service.preview()).counts.update, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("connection loss during apply discards staged data and leaves original Excel and catalog intact", async () => {
  const directory = await mkdtemp(join(tmpdir(), "icloud-race-"));
  const path = join(directory, "master.xlsx");
  const bytes = await createMasterWorkbook([row("own-0")], [generatePoolB(row("own-0"))]);
  const manifest = { stored: true, savedAt: "initial", state: { ...fixture(), plots: [plot("own-0"), plot("new-local")] } };
  const before = structuredClone(manifest);
  let reads = 0, failed = false, staged, commits = 0;
  const service = createPlotMasterService({ path, loadCatalog: async () => manifest,
    readWorkbook: async file => { if (failed && ++reads === 3) throw Error("iCloud unavailable"); return readMasterWorkbook(file); },
    stageCatalog: async input => { staged = input; return {}; }, commitCatalog: async () => { commits++; }, discardCatalog: async () => { staged = undefined; } });
  try {
    await writeFile(path, bytes);
    const preview = await service.preview();
    failed = true;
    await assert.rejects(service.apply({ token: preview.token }), { code: "MASTER_UNAVAILABLE" });
    assert.equal(staged, undefined); assert.equal(commits, 0);
    assert.deepEqual(manifest, before); assert.deepEqual(await readFile(path), bytes);
    assert.deepEqual(await readdir(directory), ["master.xlsx"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("UI shows 35 selectable / 16 reviews offline, disables Excel sync and removes warning on recovery", async () => {
  const ts = await import("typescript");
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const url = new URL("../app/components/PlotManagement.tsx", import.meta.url);
  const compiled = ts.transpileModule(await readFile(url, "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const resolved = compiled.replace(/from (["'])([^"']+)\1/g, (_match, _quote, specifier) => `from ${JSON.stringify(specifier.startsWith(".") ? new URL(specifier + (specifier === "../lib/address-import" ? ".ts" : ""), url).href : import.meta.resolve(specifier))}`);
  const { default: Component } = await import("data:text/javascript;base64," + Buffer.from(resolved).toString("base64"));
  const state = rememberActiveCatalogSource(fixture(), live);
  const props = { plots: state.plots, catalogPolicy: state.activePlotCatalog, selectedPlotIds: [], defaultOwner: "pascal", helperOnline: true,
    rotationStatuses: {}, selectionMeta: {}, linkedProjectCounts: {}, onRetrySource: async () => {}, helperRequest: () => { throw Error("No requests during render"); } };
  const render = source => renderToStaticMarkup(createElement(Component, { ...props, syncStatus: { activeCatalog: source } }));
  const offline = render(failed);
  assert.match(offline, /Excel momentan nicht erreichbar/u);
  assert.match(offline, /Erneut prüfen/u);
  assert.match(offline, /letzten gespeicherten Stand/u);
  assert.match(offline, /disabled=""[^>]*>Excel synchronisieren/u);
  assert.match(offline, /Auswählbare Grundstücke \(35\)/u);
  assert.match(offline, /Müssen geprüft werden \(16\)/u);
  assert.equal((offline.match(/type="checkbox"/gu) || []).length, 35);
  assert.doesNotMatch(offline, /Grundstücks-ID: (old-|archived-)/u);
  const online = render(live);
  assert.doesNotMatch(online, /Excel momentan nicht erreichbar|Erneut prüfen/u);
  assert.match(online, /<button class="primary">Excel synchronisieren/u);
  assert.match(online, /Auswählbare Grundstücke \(35\)/u);
  assert.match(online, /Müssen geprüft werden \(16\)/u);
});
