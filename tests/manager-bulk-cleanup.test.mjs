import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { allocateDeleteBatchNumber, linkDeleteBatchListings, deleteBatchTrafficLight } from "../delete-batches.mjs";
import { correctListingInventory, assertInventoryUploadAllowed } from "../inventory-correction.mjs";
import { managerCleanupEligibility, managerCleanupRevision, managerEntryKey, removeManagerListings } from "../manager-cleanup.mjs";
import { filterManagedListings } from "../listing-manager-view.mjs";
import { planSmartRefill } from "../smart-refill.mjs";
import { assertBrowserCatalogTransition, isDraftListing } from "../listing-catalog-view.mjs";
import { isBatchEligibleListing } from "../active-listings.mjs";
import { normalizeListingGroup } from "../listing-groups.mjs";
import { createCatalogStateStore } from "../catalog-state-store.mjs";
import { startCatalogSnapshot, commitCatalogSnapshot, loadCatalogManifest, discardCatalogSnapshot } from "../catalog-store.mjs";
import { runCatalogManagementAction } from "../catalog-management-actions.mjs";

const at = "2026-10-11T10:00:00.000Z";
function fixture(count = 10) {
  let state = { version: 1, provider: {}, houses: [], plots: [], uploadHistory: [], projects: [{ id: "p", plotId: "plot", listings: [], listingGroup: { projectId: "p", variants: [], listingControls: [] } }], deleteBatches: [] };
  for (let i = 0; i < count; i++) {
    const id = `listing-${i}`;
    const allocated = allocateDeleteBatchNumber(state, { projectId: "p", listingId: id, housePosition: 1, uploadDate: "2026-10-01" });
    state = allocated.state;
    const listing = { id, externalId: allocated.externalId, status: "transferred_pending_import", transferredAt: at };
    state.projects[0].listings.push(listing);
    state.projects[0].listingGroup.variants.push({ listing });
    state.projects[0].listingGroup.listingControls.push({ listingId: id, manualLock: false, automaticUpdateEnabled: false });
  }
  return linkDeleteBatchListings(state);
}
const entries = state => state.projects.flatMap(project => [
  ...project.listings.map(listing => ({ project, listing, group: project.listingGroup, archiveId: "" })),
  ...(state.listingResetHistory || []).filter(a => a.projectId === project.id).flatMap(a => a.listings.map(listing => ({ project, listing, group: a.listingGroup, archiveId: a.id }))),
]);
const request = (state, selected = entries(state)) => ({ entries: selected.map(entry => ({ projectId: entry.project.id, archiveId: entry.archiveId,
  listingId: entry.listing.id, externalId: entry.listing.externalId, expectedRevision: managerCleanupRevision(state, entry) })) });
const correct = (state, i) => correctListingInventory(state, { projectId: "p", listingId: state.projects[0].listings[i].id, externalId: state.projects[0].listings[i].externalId, action: "exclude", expectedRevision: 0 }, at);
const visible = state => filterManagedListings(entries(state), "");
async function isolated(context, state) {
  const directory = await mkdtemp(join(tmpdir(), "manager-bulk-tests-"));
  await startCatalogSnapshot({ state, savedAt: at, expectedSavedAt: "", sessionId: "initial" }, directory);
  await commitCatalogSnapshot("initial", directory);
  const openStore = () => createCatalogStateStore({ loadCatalogManifest: () => loadCatalogManifest(directory),
    startCatalogSnapshot: input => startCatalogSnapshot(input, directory), commitCatalogSnapshot: id => commitCatalogSnapshot(id, directory), discardCatalogSnapshot: id => discardCatalogSnapshot(id, directory) });
  const store = openStore();
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.method, "POST");
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const result = await runCatalogManagementAction(store, req.url, JSON.parse(Buffer.concat(chunks).toString()));
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
    } catch (error) { res.writeHead(409, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: false, message: error.message })); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  context.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  const post = async (path, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  return { store, openStore, post };
}

test("A/C: isolated HTTP batch confirmation deletes 10, credits 10, repeat and restart do not credit twice", async context => {
  const { store, openStore, post } = await isolated(context, fixture());
  const state = (await store.load()).state, body = { batchId: state.deleteBatches[0].id, expectedCount: 10 };
  const first = await post("/delete-batches/confirm", body);
  assert.equal(first.status, 200); assert.equal(first.body.deletedCount, 10);
  const saved = await store.load();
  assert.equal(saved.state.projects[0].listings.filter(l => l.status === "deleted").length, 10);
  assert.equal(planSmartRefill(saved.state).free, 10);
  assert.equal((await post("/delete-batches/confirm", body)).status, 409);
  assert.deepEqual(await openStore().load(), saved);
});

test("B: mixed batch confirms exactly six, never historical duplicates or the Premium listing", async context => {
  let input = fixture(); for (const i of [6, 7, 8]) input = correct(input, i);
  input.projects[0].listingGroup.listingControls[9].premiumPlacement = true;
  const { store, post } = await isolated(context, input);
  const original = (await store.load()).state;
  const batchId = original.deleteBatches[0].id;
  assert.equal(deleteBatchTrafficLight(original)[0].active.length, 6);
  assert.equal((await post("/delete-batches/confirm", { batchId, expectedCount: 10 })).status, 409);
  assert.deepEqual((await store.load()).state, original);
  assert.equal((await post("/delete-batches/confirm", { batchId, expectedCount: 6 })).body.deletedCount, 6);
  const final = (await store.load()).state;
  assert.equal(planSmartRefill(final).free, 6);
  assert.deepEqual(final.projects[0].listings.slice(6), original.projects[0].listings.slice(6));
  assert.equal(final.deleteBatches[0].entries[9].status, "paused");
  assert.equal((await post("/delete-batches/confirm", { batchId, expectedCount: 6 })).status, 409);
  assert.deepEqual((await store.load()).state, final);
});

test("C: two simultaneous HTTP confirmations produce only one persisted credit set", async context => {
  const { store, post } = await isolated(context, fixture());
  const state = (await store.load()).state, body = { batchId: state.deleteBatches[0].id, expectedCount: 10 };
  const results = await Promise.all([post("/delete-batches/confirm", body), post("/delete-batches/confirm", body)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(planSmartRefill((await store.load()).state).free, 10);
});

test("D: removing 20 historical current/archive rows retains all facts and audit, with no credits or active batch entries", async context => {
  let input = fixture(20); for (let i = 0; i < 20; i++) input = correct(input, i);
  const project = input.projects[0];
  input.listingResetHistory = [{ id: "archive", projectId: "p", kind: "plot-listing-reset", resetAt: at, listings: project.listings.slice(10), listingGroup: { variants: [] } }];
  project.listings = project.listings.slice(0, 10); project.listingGroup.variants = project.listingGroup.variants.slice(0, 10);
  const { store, openStore, post } = await isolated(context, input);
  const original = (await store.load()).state, body = request(original);
  assert.equal(visible(original).length, 20);
  assert.equal((await post("/manager/cleanup", body)).status, 200);
  const saved = await store.load(), cleaned = saved.state;
  assert.equal(visible(cleaned).length, 0); assert.equal(entries(cleaned).length, 20);
  assert.equal(new Set(entries(cleaned).map(e => e.listing.managerCleanup.operationId)).size, 1);
  for (const entry of entries(cleaned)) {
    const { managerCleanup, ...facts } = entry.listing;
    assert.deepEqual(facts, entries(original).find(e => managerEntryKey(e) === managerEntryKey(entry)).listing);
    assert.ok(managerCleanup.removedAt); assert.ok(managerCleanup.reason);
    assert.equal(entry.listing.inventoryCorrection.active, true);
  }
  assert.deepEqual(cleaned.uploadHistory, original.uploadHistory); assert.deepEqual(cleaned.smartRefill, original.smartRefill);
  assert.deepEqual(cleaned.deleteBatches, original.deleteBatches); assert.equal(deleteBatchTrafficLight(cleaned).length, 0);
  assert.equal(planSmartRefill(cleaned).free, 0);
  assert.equal((await post("/manager/cleanup", body)).body.changed, false);
  assert.deepEqual(await openStore().load(), saved);
  assert.throws(() => assertBrowserCatalogTransition(cleaned, original), /Korrekturaktion/u);
  assert.doesNotThrow(() => assertBrowserCatalogTransition(cleaned, structuredClone(cleaned)));
});

test("only explicit historical evidence permits cleanup; reset alone, failed transfers and Premium remain protected", () => {
  const state = fixture(1), base = entries(state)[0];
  assert.equal(managerCleanupEligibility(state, base).allowed, false);
  assert.equal(managerCleanupEligibility(state, { ...base, archiveId: "old" }).allowed, false);
  const failed = { ...base, listing: { id: "failed", externalId: "TEST", status: "failed" }, group: { listingControls: [] } };
  assert.equal(managerCleanupEligibility(state, failed).allowed, true);
  for (const patch of [{ transferredAt: at }, { lastUploadedAt: at }, { importConfirmedAt: at }, { externalDeletionPending: true }]) {
    assert.equal(managerCleanupEligibility(state, { ...failed, listing: { ...failed.listing, ...patch } }).allowed, false);
  }
  const historical = entries(correct(state, 0))[0];
  for (const protection of [{ premiumPlacement: true }, { processLease: { token: "isolated-test-lease" } }, { pendingRotationJobId: "job" }]) {
    assert.equal(managerCleanupEligibility(state, { ...historical, group: { listingControls: [{ listingId: historical.listing.id, ...protection }] } }).allowed, false);
  }
  assert.equal(managerCleanupEligibility({ ...state, uploadHistory: [{ listingId: "failed", status: "failed" }] }, failed).allowed, false);
});

test("mixed unsafe selection, wrong identity and stale revision are atomic failures", () => {
  const state = correct(fixture(2), 0), before = structuredClone(state);
  assert.throws(() => removeManagerListings(state, request(state)), /Keine Einträge entfernt/u);
  const body = request(state, entries(state).slice(0, 1));
  assert.throws(() => removeManagerListings(state, { entries: [{ ...body.entries[0], externalId: "wrong" }] }), /nicht mehr eindeutig/u);
  assert.throws(() => removeManagerListings(state, { entries: [body.entries[0], body.entries[0]] }), /mehrfach/u);
  assert.throws(() => removeManagerListings(state, { entries: [{ ...body.entries[0], expectedRevision: "stale" }] }), /inzwischen/u);
  assert.deepEqual(state, before);
});

test("removed failed drafts cannot be regenerated, uploaded, reactivated, or resurrected by stale browser saves", () => {
  const state = fixture(0);
  state.projects[0].listings.push({ id: "failed", externalId: "FAILED", status: "failed" });
  const cleaned = removeManagerListings(state, request(state), at), listing = cleaned.projects[0].listings[0];
  assert.equal(isDraftListing(listing), false); assert.equal(isBatchEligibleListing(listing), false);
  assert.throws(() => assertInventoryUploadAllowed(listing), /Historischer Bestand/u);
  assert.throws(() => correctListingInventory(cleaned, { projectId: "p", listingId: "failed", externalId: "FAILED", action: "restore", expectedRevision: 0 }), /nicht reaktiviert/u);
  assert.throws(() => assertBrowserCatalogTransition(cleaned, state), /Korrekturaktion/u);
});

test("status and object-number filters compose; removed rows are omitted in every filter", () => {
  let state = fixture(4); state = correct(state, 1);
  state.projects[0].listings[2] = { id: "failed", externalId: "FAILED-1", status: "failed" };
  state.listingResetHistory = [{ id: "old", projectId: "p", listings: [{ id: "archived", externalId: "ARCHIVE-1", status: "archived" }], listingGroup: { variants: [] } }];
  assert.equal(filterManagedListings(entries(state), "", "active").length, 2);
  assert.equal(filterManagedListings(entries(state), "", "reset").length, 1);
  assert.equal(filterManagedListings(entries(state), "", "failed").length, 1);
  assert.equal(filterManagedListings(entries(state), "", "corrected").length, 1);
  assert.equal(filterManagedListings(entries(state), "NO-MATCH", "reset").length, 0);
  assert.equal(filterManagedListings(entries(state), "ARCHIVE", "reset").length, 1);
  const target = entries(state).filter(e => e.listing.id === "archived");
  state = removeManagerListings(state, request(state, target));
  assert.equal(filterManagedListings(entries(state), "", "reset").length, 0);
});

test("rendered compact toolbar has count, selection controls and no remove action without selection", async () => {
  const ts = await import("typescript"), { createElement } = await import("react"), { renderToStaticMarkup } = await import("react-dom/server");
  const source = await readFile(new URL("../app/components/ManagerBulkActions.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const resolved = compiled.replace(/from (["'])([^"']+)\1/g, (_, quote, specifier) => `from ${JSON.stringify(import.meta.resolve(specifier))}`);
  const { default: Component } = await import("data:text/javascript;base64," + Buffer.from(resolved).toString("base64"));
  const render = selectedCount => renderToStaticMarkup(createElement(Component, { selectedCount, selectableCount: 20, disabled: false, onSelectAll() {}, onClear() {}, onRemove() {} }));
  assert.match(render(20), /20 ausgewählte Inserate entfernen/u); assert.match(render(20), /Auswahl aufheben/u);
  assert.match(render(0), /Alle gefilterten Treffer auswählen/u); assert.doesNotMatch(render(0), /ausgewählte Inserate entfernen/u);
});

test("Fritz-Zubeil regression: cleaning all 12 corrected rows preserves exactly the four real objects and never reactivates old rows", () => {
  const state = fixture(0);
  const keep = [["71b08b0c-2df4-4db7-bb34-0549f1638cc5", "30460-002007"], ["f7ac9ab4-8473-44cf-ba1f-3f70c86517f2", "30460-003007"], ["e1806784-2266-4aed-98e0-eeb7af1e0ca3", "30460-004007"], ["5fac9b78-325b-42bc-a3ff-ecdfeffe7f10", "30460-005001"]];
  const correction = { active: true, reason: "Nicht im Portal vorhanden / Duplikat", correctedAt: at, reversedAt: "", history: [{ action: "exclude", at }] };
  const listing = ([id, externalId], corrected = false) => ({ id, externalId, status: "transferred_pending_import", transferredAt: at, ...(corrected ? { inventoryCorrection: structuredClone(correction) } : {}) });
  const extras = [["67d10191-0fa6-4ea4-9878-252d633866f4", "30460-003015"], ["f12e90fa-2694-4bb3-9f0a-1ab6ede2affc", "30460-003016"], ["e8c0b31e-4341-4af0-b5f6-2812fa59f871", "30460-003017"], ["8175cee8-21b5-4aa3-8501-36043669909a", "30460-003018"]];
  state.projects[0].listings = [...keep.map(pair => listing(pair)), ...extras.map(pair => listing(pair, true))];
  state.listingResetHistory = [{ id: "411bfe23-8a0e-4c23-ac33-54ac4c6e1df7", projectId: "p", kind: "plot-listing-reset", listings: ["001001", "001002", "002001", "002002", "003001", "003002", "004001", "004002"].map(suffix => listing([`archive-${suffix}`, `30460-${suffix}`], true)), listingGroup: { variants: [] } }];
  state.deleteBatches = [1, 2, 3, 4, 5].map(number => ({ id: `delete-batch:1:${number}`, cycle: 1, number, plannedDeletionDate: "2026-10-10", entries: entries(state).filter(e => Number(e.listing.externalId.slice(6, 9)) === number).map(e => ({ batchId: `delete-batch:1:${number}`, projectId: "p", listingId: e.listing.id, externalId: e.listing.externalId, status: "active" })) }));
  const selected = entries(state).filter(entry => managerCleanupEligibility(state, entry).allowed);
  assert.equal(selected.length, 12);
  const cleaned = removeManagerListings(state, request(state, selected), at);
  assert.deepEqual(visible(cleaned).map(e => e.listing), state.projects[0].listings.slice(0, 4));
  assert.deepEqual(deleteBatchTrafficLight(cleaned).flatMap(b => b.active).map(e => e.externalId), keep.map(pair => pair[1]));
  assert.deepEqual(cleaned.smartRefill, state.smartRefill);
  assert.equal(planSmartRefill(cleaned).free, 0);
  assert.ok(entries(cleaned).filter(e => e.listing.managerCleanup).every(e => e.listing.inventoryCorrection.active));
});


test("UI-normalized controls produce the same cleanup revision as stored controls", () => {
  const state = correct(fixture(1), 0), original = entries(state)[0];
  const browserEntry = { ...original, group: normalizeListingGroup(original.group, original.project.id) };
  assert.equal(managerCleanupRevision(state, browserEntry), managerCleanupRevision(state, original));
  const cleaned = removeManagerListings(state, request(state, [browserEntry]));
  assert.equal(visible(cleaned).length, 0);
});
