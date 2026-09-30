import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { normalizePlotRecord } from "../plot-records.mjs";
import { createPlotMasterService } from "../plot-master-service.mjs";
import { createMasterWorkbook, readMasterWorkbook } from "../plot-master-workbook.mjs";
import { applyMasterRowsToPlot, generatePoolB, parseMasterRows, reconcileMaster } from "../plot-master-sync.mjs";

const a = (id = "plot-sync-m1al60", overrides = {}) => ({ plotId: id, street: "Testweg", houseNumber: "2",
  postalCode: "14532", city: "Ort", plotSizeSqm: 518, purchasePrice: 129500,
  mode: "AUTO_GENERATED", status: "", ...overrides });
const plot = (row = a()) => normalizePlotRecord({ id: row.plotId, street: row.street, houseNumber: row.houseNumber,
  postalCode: row.postalCode, city: row.city, plotSizeSqm: row.plotSizeSqm,
  purchasePrice: row.purchasePrice }, { now: "2026-09-30T00:00:00.000Z" });
const state = (plots) => ({ plots, projects: [], selectedPlotIds: [], deleteBatches: [{ id: "historic-batch" }] });

test("Pool B uses exact plotId and transforms numeric values", () => {
  const b = generatePoolB(a());
  assert.equal(b.plotId, "plot-sync-m1al60");
  assert.equal(b.plotSizeSqm, 520);
  assert.equal(b.houseNumber, "4");
  assert.equal(b.purchasePrice, 130850);
  for (const houseNumber of ["12a", "12-14", ""]) {
    assert.deepEqual({ houseNumber: generatePoolB(a("x", { houseNumber })).houseNumber,
      status: generatePoolB(a("x", { houseNumber })).status },
    { houseNumber: "", status: "POOL_B_PRÜFEN" });
  }
});

test("German-formatted Excel prices retain their full value", () => {
  const rows = [["plotId", "Straße", "Hausnummer", "PLZ", "Ort", "Grundstücksfläche m²", "Grundstückspreis €"],
    ["worker-1", "Testweg", "2", "14532", "Ort", "518", "129.500 €"]];
  assert.equal(parseMasterRows(rows, "A")[0].purchasePrice, 129500);
});

test("new app plot exports to both pools and Excel import never duplicates", () => {
  const initial = state([plot()]);
  const exported = reconcileMaster(initial, [], [], {}, "2026-09-30T00:00:00.000Z");
  assert.deepEqual(exported.items.map((item) => item.action), ["export"]);
  assert.equal(exported.poolA[0].plotId, exported.poolB[0].plotId);
  assert.equal(exported.poolB[0].plotSizeSqm, 520);
  const imported = reconcileMaster(exported.state, [...exported.poolA, a("worker-2")],
    exported.poolB, {}, "2026-09-30T01:00:00.000Z");
  assert.deepEqual(imported.items.map((item) => item.action), ["import"]);
  assert.equal(imported.state.plots.length, 2);
  assert.equal(imported.poolB.find((item) => item.plotId === "worker-2").houseNumber, "4");
  assert.equal(reconcileMaster(imported.state, imported.poolA, imported.poolB).state.plots.length, 2);
});

test("missing Excel plot waits for an explicit removal decision and preserves linked work", () => {
  const row = a();
  const synced = applyMasterRowsToPlot(plot(row), row, generatePoolB(row), "2026-09-30T00:00:00.000Z");
  const original = state([synced]);
  original.projects = [{ id: "project-1", plotId: row.plotId, listings: [{ id: "listing-1" }], isActive: true }];
  const pending = reconcileMaster(original, [], []);
  assert.equal(pending.items[0].action, "missing-excel");
  assert.equal(pending.state.plots[0].isActive, true);
  const removed = reconcileMaster(original, [], [], { [row.plotId]: "remove-app" });
  assert.equal(removed.state.plots[0].isActive, false);
  assert.equal(removed.state.projects[0].listings[0].id, "listing-1");
  assert.deepEqual(removed.state.deleteBatches, original.deleteBatches);
});

test("simultaneous app and Excel changes require a choice", () => {
  const row = a();
  const synced = applyMasterRowsToPlot(plot(row), row, generatePoolB(row), "2026-09-30T00:00:00.000Z");
  const appChanged = { ...synced, purchasePrice: 135000 };
  const excelChanged = a(row.plotId, { purchasePrice: 140000 });
  const preview = reconcileMaster(state([appChanged]), [excelChanged], [generatePoolB(row)]);
  assert.equal(preview.items[0].action, "conflict");
  assert.equal(preview.poolA[0].purchasePrice, 140000);
  assert.equal(preview.state.plots[0].purchasePrice, 135000);
  const chosen = reconcileMaster(state([appChanged]), [excelChanged], [generatePoolB(row)], { [row.plotId]: "app" });
  assert.equal(chosen.poolA[0].purchasePrice, 135000);
});

test("a manually changed Pool B survives Pool A updates", () => {
  const row = a(); const b = generatePoolB(row);
  const synced = applyMasterRowsToPlot(plot(row), row, b, "2026-09-30T00:00:00.000Z");
  const changed = { ...synced, plotSizeSqm: 530, addressRotation: { ...synced.addressRotation,
    poolBDetails: { ...synced.addressRotation.poolBDetails, mode: "MANUAL", plotSizeSqm: 555 } } };
  const result = reconcileMaster(state([changed]), [row], [b]);
  assert.equal(result.poolB[0].plotSizeSqm, 555);
  assert.equal(result.poolB[0].mode, "MANUAL");
});

test("worker-updated automatic Pool B remains automatic", () => {
  const row = a(); const b = generatePoolB(row);
  const synced = applyMasterRowsToPlot(plot(row), row, b, "2026-09-30T00:00:00.000Z");
  const nextA = a(row.plotId, { plotSizeSqm: 600, purchasePrice: 150000 });
  const result = reconcileMaster(state([synced]), [nextA], [generatePoolB(nextA)]);
  assert.equal(result.items[0].direction, "excel");
  assert.equal(result.state.plots[0].addressRotation.poolBDetails.mode, "AUTO_GENERATED");
  assert.equal(result.poolB[0].plotSizeSqm, 602);
});

test("workbook roundtrip keeps two sheets and rejects duplicate plotIds", async () => {
  const directory = await mkdtemp(join(tmpdir(), "master-workbook-"));
  const path = join(directory, "KI_Grundstuecke_MASTER.xlsx");
  try {
    await writeFile(path, await createMasterWorkbook([a()], [generatePoolB(a())]));
    const read = await readMasterWorkbook(path);
    assert.equal(read.poolA[0].plotId, "plot-sync-m1al60");
    assert.equal(read.poolB[0].purchasePrice, 130850);
    const archive = await JSZip.loadAsync(read.bytes);
    archive.file("custom/worker-note.txt", "unrelated master content");
    const withOtherContent = await archive.generateAsync({ type: "nodebuffer" });
    const updated = await createMasterWorkbook([a(), a("worker-2")],
      [generatePoolB(a()), generatePoolB(a("worker-2"))], read.rawA, read.rawB, withOtherContent);
    const updatedZip = await JSZip.loadAsync(updated);
    assert.equal(await updatedZip.file("custom/worker-note.txt").async("string"), "unrelated master content");
    await writeFile(path, updated);
    assert.equal((await readMasterWorkbook(path)).poolA.length, 2);
    assert.throws(() => parseMasterRows([["plotId", "Straße", "Hausnummer", "PLZ", "Ort", "Grundstücksfläche m²", "Grundstückspreis €"],
      ["same", "A", "1", "14532", "Ort", 10, 20], ["same", "B", "2", "14532", "Ort", 11, 21]], "A"), /doppelte plotId/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("service requires a current preview token before writing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "master-service-"));
  const path = join(directory, "KI_Grundstuecke_MASTER.xlsx");
  let manifest = { stored: true, savedAt: "initial", state: state([plot()]) };
  let staged;
  const service = createPlotMasterService({ path, loadCatalog: async () => manifest,
    stageCatalog: async (input) => { staged = input; return { missingImageIds: [] }; },
    commitCatalog: async () => { manifest = { stored: true, savedAt: staged.savedAt, state: staged.state }; },
    discardCatalog: async () => undefined });
  try {
    const preview = await service.preview();
    assert.equal(preview.counts.export, 1);
    await assert.rejects(service.apply({ token: "stale" }), /Vorschau neu öffnen/u);
    assert.equal((await service.apply({ token: preview.token })).applied, true);
    const workbook = await readMasterWorkbook(path);
    assert.equal(workbook.poolA[0].plotId, workbook.poolB[0].plotId);
    assert.ok((await readFile(path)).length > 0);
    assert.equal((await service.preview()).counts.export, 0);
    await writeFile(path, await createMasterWorkbook([...workbook.poolA, a("worker-2")], workbook.poolB,
      workbook.rawA, workbook.rawB, workbook.bytes));
    const workerPreview = await service.preview();
    assert.equal(workerPreview.counts.import, 1);
    await service.apply({ token: workerPreview.token });
    assert.equal(manifest.state.plots.filter((item) => item.id === "worker-2").length, 1);
    assert.equal((await readMasterWorkbook(path)).poolB.find((item) => item.plotId === "worker-2").houseNumber, "4");
    manifest = { ...manifest, savedAt: "after-app-delete", state: { ...manifest.state,
      plots: manifest.state.plots.map((item) => item.id === "plot-sync-m1al60"
        ? { ...item, isActive: false, masterSync: { ...item.masterSync, excelDeleteRequested: true } } : item) } };
    const deletionPreview = await service.preview();
    assert.equal(deletionPreview.counts["delete-excel"], 1);
    await service.apply({ token: deletionPreview.token });
    const afterDeletion = await readMasterWorkbook(path);
    assert.deepEqual(afterDeletion.poolA.map((item) => item.plotId), ["worker-2"]);
    assert.deepEqual(afterDeletion.poolB.map((item) => item.plotId), ["worker-2"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
