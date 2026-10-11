import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { correctListingInventory, assertInventoryCorrectionTransition, assertInventoryUploadAllowed } from "../inventory-correction.mjs";
import { allocateDeleteBatchNumber, linkDeleteBatchListings, deleteBatchTrafficLight, confirmDeleteBatch, replanDeleteBatchesForUpload } from "../delete-batches.mjs";
import { planSmartRefill, recordRefillDeletions } from "../smart-refill.mjs";
import { addressRotationStatus } from "../address-rotation.mjs";
import { listingControl } from "../listing-groups.mjs";
import { isBatchEligibleListing } from "../active-listings.mjs";
import { isDraftListing, assertBrowserCatalogTransition } from "../listing-catalog-view.mjs";
import { createCatalogStateStore } from "../catalog-state-store.mjs";
import { startCatalogSnapshot, commitCatalogSnapshot, loadCatalogManifest, discardCatalogSnapshot } from "../catalog-store.mjs";

const at = "2026-10-11T12:00:00.000Z";
function fixture(count = 6, status = "transferred_pending_import") {
  let state = { version: 1, provider: {}, projects: [{ id: "p", plotId: "plot", listings: [], listingGroup: { projectId: "p", variants: [], listingControls: [] } }], plots: [], houses: [], deleteBatches: [], uploadHistory: [{ id: "transfer", status: "success" }] };
  for (let i = 0; i < count; i++) {
    const id = `listing-${i}`;
    const allocated = allocateDeleteBatchNumber(state, { projectId: "p", listingId: id, housePosition: 1, uploadDate: "2026-10-01" });
    state = allocated.state;
    const listing = { id, externalId: allocated.externalId, status, ...(status === "draft" ? {} : { transferredAt: "2026-10-01T12:00:00Z" }) };
    state.projects[0].listings.push(listing);
    state.projects[0].listingGroup.variants.push({ listing });
    state.projects[0].listingGroup.listingControls.push({ listingId: id, automaticUpdateEnabled: true, manualLock: false, updateMode: "prepare-only" });
  }
  return linkDeleteBatchListings(state);
}
const input = (state, index, action = "exclude") => {
  const listing = state.projects[0].listings[index];
  return { projectId: "p", listingId: listing.id, externalId: listing.externalId, action, expectedRevision: listing.inventoryCorrection?.history.length || 0 };
};
const correct = (state, index, action) => correctListingInventory(state, input(state, index, action), at);
const visible = state => deleteBatchTrafficLight(state).reduce((count, batch) => count + batch.active.length, 0);

test("six entries minus four corrections leaves two deletable entries and zero new credits", () => {
  const original = fixture();
  let state = original;
  for (let i = 0; i < 4; i++) state = correct(state, i);
  assert.equal(visible(state), 2);
  assert.deepEqual(state.deleteBatches, original.deleteBatches);
  assert.deepEqual(state.uploadHistory, original.uploadHistory);
  assert.deepEqual(state.plots, original.plots);
  assert.deepEqual(state.smartRefill, original.smartRefill);
  assert.deepEqual(state.projects[0].listingGroup.listingControls, original.projects[0].listingGroup.listingControls);
  assert.deepEqual(state.projects[0].listings.slice(4), original.projects[0].listings.slice(4));
  for (let i = 0; i < 4; i++) {
    const { inventoryCorrection, ...listing } = state.projects[0].listings[i];
    assert.deepEqual(listing, original.projects[0].listings[i]);
    assert.equal(inventoryCorrection.active, true);
    assert.equal(inventoryCorrection.history.length, 1);
  }
  assert.equal(planSmartRefill(state).free, 0);
  assert.equal(planSmartRefill(state).activeCount, 2);
  const confirmed = confirmDeleteBatch(state, state.deleteBatches[0].id, at);
  assert.equal(confirmed.deletedCount, 2);
  const credited = recordRefillDeletions(state, confirmed.state);
  assert.equal(planSmartRefill(credited).free, 2);
  assert.deepEqual(credited.projects[0].listings.slice(0, 4), state.projects[0].listings.slice(0, 4));
  let restored = credited;
  for (let i = 0; i < 4; i++) restored = correct(restored, i, "restore");
  assert.equal(visible(restored), 4);
  assert.equal(planSmartRefill(restored).free, 2);
  assert.deepEqual(restored.projects[0].listings.slice(4), credited.projects[0].listings.slice(4));
  assert.equal(restored.projects[0].listings[0].inventoryCorrection.history.length, 2);
});

test("undo restores the prior control settings and active batch; all corrected hides the batch", () => {
  const original = fixture(1);
  const state = correct(original, 0);
  assert.equal(deleteBatchTrafficLight(state).length, 0);
  assert.throws(() => confirmDeleteBatch(state, state.deleteBatches[0].id), /keine übertragenen/u);
  const blocked = listingControl(state.projects[0].listingGroup, state.projects[0].listings[0]);
  assert.equal(blocked.manualLock, true);
  assert.equal(blocked.automaticUpdateEnabled, false);
  const restored = correct(state, 0, "restore");
  assert.equal(visible(restored), 1);
  assert.deepEqual(listingControl(restored.projects[0].listingGroup, restored.projects[0].listings[0]), listingControl(original.projects[0].listingGroup, original.projects[0].listings[0]));
});

test("exact identity, revision and in-flight protections prevent stale or broad correction", () => {
  const original = fixture(2);
  for (const bad of [{ listingId: "wrong" }, { externalId: "wrong" }, { projectId: "wrong" }, { expectedRevision: 8 }, { action: "delete" }]) {
    assert.throws(() => correctListingInventory(original, { ...input(original, 0), ...bad }));
  }
  const state = correct(original, 0);
  assert.throws(() => correctListingInventory(state, input(original, 0)), /inzwischen/u);
  assert.equal(correct(state, 0), state);
  const running = fixture(1, "uploading");
  assert.throws(() => correct(running, 0), /laufender Vorgang/u);
});

test("historical drafts cannot enter generation, batch upload, or number replanning", () => {
  const state = correct(fixture(1, "draft"), 0), listing = state.projects[0].listings[0];
  assert.equal(isDraftListing(listing), false);
  assert.equal(isBatchEligibleListing(listing), false);
  assert.throws(() => assertInventoryUploadAllowed(listing), /Historischer Bestand/u);
  assert.deepEqual(replanDeleteBatchesForUpload(state, [listing.id], "2026-10-20"), state);
});

test("correction does not count as completed pool cycle, even for an already deleted listing", () => {
  let state = fixture(4);
  state = confirmDeleteBatch(state, state.deleteBatches[0].id, at).state;
  const address = { street: "Teststraße", houseNumber: "1", postalCode: "14482", city: "Potsdam" };
  state.plots = [{ id: "plot", addressRotation: { currentPool: "A", poolA: address, poolB: { ...address, houseNumber: "2" }, listingIds: state.projects[0].listings.map(item => item.id), cycle: 1 } }];
  assert.equal(addressRotationStatus(state, "plot").state, "ready");
  const corrected = correct(state, 0);
  assert.equal(addressRotationStatus(corrected, "plot").state, "active");
  assert.deepEqual(corrected.plots, state.plots);
  assert.equal(addressRotationStatus(correct(corrected, 0, "restore"), "plot").state, "ready");
});

test("browser saves cannot erase, invent or revert correction metadata including drafts", () => {
  const original = fixture(1, "draft"), state = correct(original, 0);
  assert.throws(() => assertBrowserCatalogTransition(original, state), /Korrekturaktion/u);
  assert.throws(() => assertBrowserCatalogTransition(state, original), /Korrekturaktion/u);
  assert.throws(() => assertInventoryCorrectionTransition(state, correct(state, 0, "restore")), /Korrekturaktion/u);
  assert.doesNotThrow(() => assertBrowserCatalogTransition(state, structuredClone(state)));
});

test("correction and reversal survive persistent catalog reload; stale revisions fail", async context => {
  const directory = await mkdtemp(join(tmpdir(), "inventory-correction-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const state = fixture(1);
  await startCatalogSnapshot({ state, savedAt: at, expectedSavedAt: "", sessionId: "initial" }, directory);
  await commitCatalogSnapshot("initial", directory);
  const store = createCatalogStateStore({ loadCatalogManifest: () => loadCatalogManifest(directory), startCatalogSnapshot: value => startCatalogSnapshot(value, directory), commitCatalogSnapshot: id => commitCatalogSnapshot(id, directory), discardCatalogSnapshot: id => discardCatalogSnapshot(id, directory) });
  await store.update(current => correctListingInventory(current, input(state, 0), at));
  const reloaded = await store.load();
  assert.equal(reloaded.state.projects[0].listings[0].inventoryCorrection.active, true);
  await assert.rejects(() => store.update(current => correctListingInventory(current, input(state, 0), at)), /inzwischen/u);
  await store.update(current => correct(current, 0, "restore"));
  assert.equal((await store.load()).state.projects[0].listings[0].inventoryCorrection.history.length, 2);
});

test("rendered manager action shows exact object, reason, audit trail and reversible buttons", async () => {
  const ts = await import("typescript"), { createElement } = await import("react"), { renderToStaticMarkup } = await import("react-dom/server");
  const source = await readFile(new URL("../app/components/InventoryCorrectionActions.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const resolved = compiled.replace(/from (["'])([^"']+)\1/g, (_, quote, specifier) => `from ${JSON.stringify(import.meta.resolve(specifier))}`);
  const { default: Component } = await import("data:text/javascript;base64," + Buffer.from(resolved).toString("base64"));
  const listing = correct(fixture(1), 0).projects[0].listings[0];
  const render = disabled => renderToStaticMarkup(createElement(Component, { listing, disabled, onCorrect() {} }));
  const html = render(false);
  assert.match(html, /HISTORISCH \/ NICHT IM PORTAL/u);
  assert.match(html, /Bestand korrigieren/u);
  assert.match(html, /30460-001001/u);
  assert.match(html, /Korrekturverlauf/u);
  assert.match(html, /disabled="">Nicht im Portal vorhanden/u);
  assert.doesNotMatch(html, /disabled="">Korrektur rückgängig/u);
  assert.match(render(true), /disabled="">Korrektur rückgängig/u);
});

test("Fritz-Zubeil exact corrections preserve all four confirmed objects including Batch 002", () => {
  const keep = [["71b08b0c-2df4-4db7-bb34-0549f1638cc5", "30460-002007"], ["f7ac9ab4-8473-44cf-ba1f-3f70c86517f2", "30460-003007"], ["e1806784-2266-4aed-98e0-eeb7af1e0ca3", "30460-004007"], ["5fac9b78-325b-42bc-a3ff-ecdfeffe7f10", "30460-005001"]];
  const extras = [["67d10191-0fa6-4ea4-9878-252d633866f4", "30460-003015"], ["f12e90fa-2694-4bb3-9f0a-1ab6ede2affc", "30460-003016"], ["e8c0b31e-4341-4af0-b5f6-2812fa59f871", "30460-003017"], ["8175cee8-21b5-4aa3-8501-36043669909a", "30460-003018"]];
  const original = fixture(0);
  original.projects[0].listings = [...keep, ...extras].map(([id, externalId]) => ({ id, externalId, status: "transferred_pending_import", transferredAt: "2026-10-01T12:00:00Z" }));
  original.deleteBatches = [2, 3, 4, 5].map(number => ({ id: `delete-batch:1:${number}`, cycle: 1, number, plannedDeletionDate: "2026-10-10", entries: original.projects[0].listings.filter(listing => Number(listing.externalId.slice(6, 9)) === number).map(listing => ({ batchId: `delete-batch:1:${number}`, projectId: "p", listingId: listing.id, externalId: listing.externalId, status: "active" })) }));
  let state = original;
  for (let i = 4; i < 8; i++) state = correct(state, i);
  assert.deepEqual(state.projects[0].listings.slice(0, 4), original.projects[0].listings.slice(0, 4));
  assert.deepEqual(deleteBatchTrafficLight(state).map(batch => [batch.number, batch.active.map(entry => entry.externalId)]), keep.map(([, externalId], i) => [i + 2, [externalId]]));
  assert.equal(planSmartRefill(state).free, 0);
});

test("helper accepts correction and existing batch confirmation routes through its allowlist", async () => {
  const source = await readFile(new URL("../local-upload-server.mjs", import.meta.url), "utf8");
  assert.match(source, /const isInventoryCorrection = request.method === "POST" && pathname === "\/inventory\/correct"/u);
  const routeGuard = source.slice(source.indexOf("if (!isInventoryCorrection"), source.indexOf("if (!isInventoryCorrection") + 1800);
  assert.match(routeGuard, /!isDeleteBatchConfirm/u);
  assert.match(source, /catalogStateStore.update\(state => correctListingInventory\(state, body\)\)/u);
});

test("reset-archive correction excludes exact old references, preserves archive facts, and is reversible", () => {
  const original = fixture(2);
  original.listingResetHistory = [{ id: "archive", projectId: "p", kind: "plot-listing-reset", resetAt: at, listings: [original.projects[0].listings[0]], listingGroup: { variants: [{ listing: original.projects[0].listings[0] }] } }];
  original.projects[0].listings = original.projects[0].listings.slice(1);
  original.projects[0].listingGroup.variants = original.projects[0].listingGroup.variants.slice(1);
  const listing = original.listingResetHistory[0].listings[0];
  const request = { projectId: "p", archiveId: "archive", listingId: listing.id, externalId: listing.externalId, action: "exclude", expectedRevision: 0 };
  assert.throws(() => correctListingInventory(original, { ...request, archiveId: "wrong" }), /nicht eindeutig/u);
  const corrected = correctListingInventory(original, request, at);
  assert.equal(visible(corrected), 1);
  assert.deepEqual(corrected.projects, original.projects);
  assert.deepEqual(corrected.deleteBatches, original.deleteBatches);
  const { inventoryCorrection, ...facts } = corrected.listingResetHistory[0].listings[0];
  assert.deepEqual(facts, listing);
  assert.equal(inventoryCorrection.active, true);
  assert.equal(planSmartRefill(corrected).free, 0);
  assert.throws(() => assertBrowserCatalogTransition(corrected, original), /Korrekturaktion/u);
  assert.doesNotThrow(() => assertBrowserCatalogTransition(corrected, structuredClone(corrected)));
  const confirmed = confirmDeleteBatch(corrected, corrected.deleteBatches[0].id, at).state;
  assert.equal(recordRefillDeletions(corrected, confirmed).smartRefill.credits.length, 1);
  assert.equal(confirmed.deleteBatches[0].entries.find(e=>e.listingId===listing.id).status, "active");
  const restored = correctListingInventory(corrected, { ...request, action: "restore", expectedRevision: 1 }, at);
  assert.equal(visible(restored), 2);
  assert.equal(restored.listingResetHistory[0].listings[0].inventoryCorrection.history.length, 2);
});
