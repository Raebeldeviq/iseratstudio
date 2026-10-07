import assert from "node:assert/strict";
import test from "node:test";
import { catalogCleanupPreview, approveActivePlotCatalog, operationalCatalogPlots, catalogGeographicLabel, filterCatalogPlots } from "../plot-active-catalog.mjs";
import { createActivePlotCatalogService } from "../plot-active-catalog-service.mjs";
import { normalizePlotRecord } from "../plot-records.mjs";
import { selectablePlotIds, selectablePlotProjects } from "../plot-selection.mjs";
import { applyMasterRowsToPlot, generatePoolB, parseMasterRows, reconcileMaster } from "../plot-master-sync.mjs";
import { loadActivePlotCatalogSource } from "../plot-active-catalog-source.mjs";
import { createMasterWorkbook } from "../plot-master-workbook.mjs";
import { togglePlotTerritoryVisibility, readPlotTerritoryVisibility, savePlotTerritoryVisibility } from "../plot-territory-visibility.mjs";

const plot = (id, postalCode = "14469", extra = {}) => normalizePlotRecord({ id, street: "Testweg", houseNumber: "2", postalCode, city: "Potsdam", isActive: true, ...extra });
const territory = { available: true, postalCodes: ["14089", "13591", "13585", "14469", "14624", "14542", "14165"],
  regions: { "14089": "Berlin 5", "13591": "Berlin 8", "13585": "Berlin 8", "14165": "Berlin 5", "14469": "Potsdam", "14624": "Havelland", "14542": "Potsdam-Mittelmark" } };
const source = (masterPlots) => ({ available: true, masterPlots, territory });
const approved = (plots) => ({ version: 1, approvedAt: "2026-10-07T12:00:00Z", legacyPlotIds: plots.map(p => p.id) });

test("master and Pool A/B identity produce one operational card per plotId", () => {
  const p = plot("same");
  const result = operationalCatalogPlots([p, { ...p, addressRotation: { poolA: {}, poolB: {} } }], { source: source([p]), policy: approved([p]) });
  assert.equal(result.length, 1);
  assert.ok(result[0].addressRotation.poolB);
});

test("own territory geographical labels reuse Suchgebiet; Berlin practical groups are presentation only", () => {
  const fixtures = [["14089", "Berlin", "Berlin – Kladow"], ["13591", "Berlin", "Berlin – Staaken"], ["13585", "Berlin", "Berlin – Spandau"],
    ["14624", "Dallgow-Döberitz", "Havelland"], ["14469", "Potsdam", "Potsdam"], ["14542", "Werder", "Potsdam-Mittelmark"], ["14165", "Berlin-Zehlendorf", "Berlin – Zehlendorf"]];
  const plots = fixtures.map(([zip, city], i) => plot(String(i), zip, { city }));
  const context = { source: source(plots), policy: approved(plots) };
  assert.equal(operationalCatalogPlots(plots, context).length, fixtures.length);
  fixtures.forEach(([, , label], i) => assert.equal(catalogGeographicLabel(plots[i], context.source), label));
});

test("outside only explicitly opted-in plots are selectable, including generation workflows", () => {
  const plots = [plot("inside"), plot("external", "99999"), plot("exclusive", "99999", { exclusiveOutsideTerritory: true })];
  const context = { source: source(plots), policy: approved(plots) };
  assert.deepEqual(selectablePlotIds(plots, plots.map(p => p.id), context), ["inside", "exclusive"]);
  const projects = plots.map(p => ({ id: `project-${p.id}`, plotId: p.id, isActive: true }));
  projects.push({ id: "unlinked-old", street: "Testweg", zip: "14469", city: "Potsdam", isActive: true });
  assert.deepEqual(selectablePlotProjects(plots, projects, context).map(p => p.id), ["project-inside", "project-exclusive"]);
});

test("new local, worker or sync plots inside activate automatically; new external plots await opt-in", () => {
  const old = plot("old");
  const plots = [old, plot("new-local"), plot("new-worker", "99999")];
  assert.deepEqual(operationalCatalogPlots(plots, { source: source([]), policy: approved([old]) }).map(p => p.id), ["new-local"]);
  assert.equal(operationalCatalogPlots(plots, { source: source(plots), policy: undefined }).length, 0);
  assert.equal(operationalCatalogPlots(plots, { source: { available: false }, policy: approved(plots) }).length, 0);
});

test("cleanup preview writes nothing; explicit approval preserves all history and all legacy records", () => {
  const plots = [plot("master"), plot("inside-old"), plot("outside-old", "99999"), plot("private", "14469", { street: "Adresse nicht öffentlich angegeben" })];
  const state = { plots, projects: [{ id: "old-project", plotId: "outside-old", listings: [{ id: "published", status: "published", images: ["unchanged"] }] }],
    selectedPlotIds: plots.map(p => p.id), uploadHistory: [{ id: "upload" }], deleteBatches: [{ id: "batch" }], audit: [{ id: "evidence" }] };
  const before = structuredClone(state);
  const data = source([plots[0], plot("new-master")]);
  const preview = catalogCleanupPreview(state, data);
  assert.deepEqual([preview.inside.length, preview.outside.length, preview.removed.length], [2, 0, 3]);
  assert.deepEqual(state, before);
  const result = approveActivePlotCatalog(state, data, "2026-10-07T12:00:00Z");
  for (const key of ["projects", "uploadHistory", "deleteBatches", "audit"]) assert.equal(result[key], state[key]);
  assert.deepEqual(result.plots.slice(0, plots.length), plots);
  assert.equal(result.plots.length, plots.length + 1);
  assert.deepEqual(result.selectedPlotIds, ["master"]);
  assert.deepEqual(operationalCatalogPlots(result.plots, { source: data, policy: result.activePlotCatalog }).map(p => p.id), ["master", "new-master"]);
  assert.throws(() => approveActivePlotCatalog(result, data, "later"), /bereits bestätigt/);
});

test("explicitly retained local plots inside survive cleanup without a master row", () => {
  const local = plot("kept-local", "14089", { city: "Berlin-Kladow", keepInActiveCatalog: true });
  const legacy = plot("unconfirmed-legacy");
  const projects = [{ id: "historic", plotId: local.id, listings: [{ id: "online", status: "published" }] }];
  const state = { plots: [local, legacy], projects, selectedPlotIds: [local.id, legacy.id] };
  const data = source([]);
  const preview = catalogCleanupPreview(state, data);
  assert.deepEqual(preview.inside.map(p => p.id), [local.id]);
  assert.deepEqual(preview.removed.map(p => p.id), [legacy.id]);
  const result = approveActivePlotCatalog(state, data, "2026-10-07T12:00:00Z");
  const reloaded = JSON.parse(JSON.stringify(result));
  assert.deepEqual(operationalCatalogPlots(reloaded.plots, { source: data, policy: reloaded.activePlotCatalog }).map(p => p.id), [local.id]);
  assert.deepEqual(result.selectedPlotIds, [local.id]);
  assert.equal(result.projects, projects);
  assert.equal(result.plots[0], local);
});

test("retention inside the own territory does not activate outside or invalid addresses", () => {
  const plots = [plot("outside", "99999", { keepInActiveCatalog: true }),
    plot("private", "14469", { keepInActiveCatalog: true, street: "Adresse nicht öffentlich angegeben" }),
    plot("inactive", "14469", { keepInActiveCatalog: true, isActive: false })];
  const context = { source: source([]), policy: approved(plots) };
  assert.deepEqual(operationalCatalogPlots(plots, context), []);
  assert.deepEqual(selectablePlotIds(plots, plots.map(p => p.id), context), []);
});

test("retention survives normalization and Pool A/B sync without reviving unrelated legacy plots", () => {
  const kept = plot("kept", "14469", { keepInActiveCatalog: true });
  const legacy = plot("legacy");
  const projects = [{ id: "historic", listings: [{ id: "online" }] }];
  const result = reconcileMaster({ plots: [kept, legacy], projects, activePlotCatalog: approved([kept, legacy]) }, [], []);
  assert.deepEqual(result.poolA.map(p => p.plotId), [kept.id]);
  assert.deepEqual(result.poolB.map(p => p.plotId), [kept.id]);
  assert.equal(result.state.plots.find(p => p.id === kept.id).keepInActiveCatalog, true);
  assert.deepEqual(result.state.projects, projects);
  assert.equal(normalizePlotRecord({ ...kept, keepInActiveCatalog: "false" }).keepInActiveCatalog, false);
  assert.equal(Object.hasOwn(normalizePlotRecord(legacy), "keepInActiveCatalog"), false);
});

test("exclusive boolean survives normalization and existing Pool A/B reconciliation", () => {
  const row = { plotId: "exclusive", street: "Testweg", houseNumber: "2", postalCode: "99999", city: "Ort", plotSizeSqm: 100, purchasePrice: 10000, mode: "AUTO_GENERATED", status: "" };
  const p = applyMasterRowsToPlot(plot("exclusive", "99999", { exclusiveOutsideTerritory: true }), row, generatePoolB(row), "2026-10-07T12:00:00Z");
  assert.equal(p.exclusiveOutsideTerritory, true);
  const result = reconcileMaster({ plots: [p], projects: [] }, [{ ...row, purchasePrice: 12000 }], [generatePoolB(row)]);
  assert.equal(result.state.plots[0].exclusiveOutsideTerritory, true);
  assert.equal(normalizePlotRecord({ ...p, exclusiveOutsideTerritory: "false" }).exclusiveOutsideTerritory, false);
});

test("historical excluded plots cannot be exported back into the master to undo cleanup", () => {
  const p = plot("legacy");
  const result = reconcileMaster({ plots: [p], projects: [], activePlotCatalog: approved([p]) }, [], []);
  assert.equal(result.poolA.length, 0);
  assert.equal(result.poolB.length, 0);
  assert.equal(result.state.plots[0].isActive, true);
});

test("search and city filters span both active areas and exclude historical results", () => {
  const plots = [plot("own"), plot("exclusive", "99999", { city: "Anderer Ort", exclusiveOutsideTerritory: true }), plot("old")];
  const active = operationalCatalogPlots(plots, { source: source([plots[0]]), policy: approved(plots) });
  assert.equal(filterCatalogPlots(active, "testweg").length, 2);
  assert.deepEqual(filterCatalogPlots(active, "99999").map(p => p.id), ["exclusive"]);
  assert.equal(filterCatalogPlots(active, "old").length, 0);
  assert.deepEqual(filterCatalogPlots(active, "", "Potsdam").map(p => p.id), ["own"]);
});

test("each geographical collapse state is independent and survives reload beside old section settings", () => {
  const key = "group:inside:Berlin – Kladow";
  const values = new Map();
  const storage = { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v) };
  const next = togglePlotTerritoryVisibility({ inside: true, outside: true }, key);
  assert.equal(next[key], false);
  assert.equal(next.inside, true);
  savePlotTerritoryVisibility(storage, next);
  assert.equal(readPlotTerritoryVisibility(storage)[key], false);
  assert.equal(togglePlotTerritoryVisibility(next, key)[key], true);
});

test("production worker headers parse full size and status; inactive source rows remain excluded", async () => {
  const rows = [["plotId", "Straße", "Hausnummer", "PLZ", "Ort", "Grundstücksgröße (m²)", "Grundstückspreis (€)", "Status"],
    ["ok", "Testweg", 2, "14469", "Potsdam", 518, 127000, "Vorhanden"], ["gone", "Testweg", 3, "14469", "Potsdam", 600, 120000, "Nicht mehr vorhanden"]];
  const poolA = parseMasterRows(rows, "A");
  assert.equal(poolA[0].plotSizeSqm, 518);
  const bytes = await createMasterWorkbook(poolA, poolA.map(generatePoolB));
  const paths = [];
  const result = await loadActivePlotCatalogSource({ path: "master", territoryPath: "existing-scope",
    readWorkbook: async () => ({ bytes, poolA, poolB: poolA.map(generatePoolB) }),
    loadTerritory: async path => { paths.push(path); return path === "master" ? { available: false } : territory; } });
  assert.deepEqual(paths, ["master", "existing-scope"]);
  assert.deepEqual(result.masterPlots.map(p => p.id), ["ok"]);
  assert.equal(result.masterPlots[0].addressRotation.poolB.houseNumber, "4");
});

test("cleanup service requires an unchanged preview and explicit confirmation, then commits only once", async () => {
  let state = { plots: [plot("own"), plot("legacy", "99999")], projects: [{ id: "historic", listings: [{ id: "online" }] }], selectedPlotIds: [] };
  let savedAt = "first";
  let staged, commits = 0;
  const fixedSource = source([plot("own")]);
  const service = createActivePlotCatalogService({ loadSource: async () => fixedSource, loadCatalog: async () => ({ state, savedAt }),
    start: async input => { assert.equal(input.expectedSavedAt, savedAt); assert.equal(input.protectLifecycle, true); staged = input.state; return {}; },
    commit: async () => { state = staged; savedAt = "second"; commits++; }, discard: async () => {}, now: () => "2026-10-07T12:00:00Z" });
  const preview = await service.preview();
  assert.equal(commits, 0);
  await assert.rejects(service.apply({ token: preview.token }), /ausdrücklich/);
  savedAt = "changed";
  await assert.rejects(service.apply({ token: preview.token, confirmed: true }), /ausdrücklich/);
  const current = await service.preview();
  const history = state.projects;
  await service.apply({ token: current.token, confirmed: true });
  assert.equal(commits, 1);
  assert.equal(state.projects, history);
  const again = await service.preview();
  await assert.rejects(service.apply({ token: again.token, confirmed: true }), /bereits bestätigt/);
  assert.equal(commits, 1);
});
