import assert from "node:assert/strict";
import test from "node:test";
import { normalizeHouseDistribution } from "../house-distribution.mjs";
import { createInitialStudioState, createEmptyHouse } from "../studio-defaults.mjs";
import { allocateDeleteBatchNumber, confirmDeleteBatch, linkDeleteBatchListings, deleteBatchesNeedReplan, replanDeleteBatchesForUpload } from "../delete-batches.mjs";
import { prepareProjectListings } from "../app/lib/listing-preparation.ts";
import { recordRefillDeletions, planSmartRefill, prepareSmartRefill, approveRefillPool, refillPoolFingerprint, createSmartRefillUploadPlan, assertSmartRefillTransition, assertSmartRefillUploadReady } from "../smart-refill.mjs";
import { assertBrowserCatalogTransition } from "../listing-catalog-view.mjs";
import { createCatalogStateStore } from "../catalog-state-store.mjs";
import { startCatalogSnapshot, commitCatalogSnapshot, saveCatalogImage, loadCatalogManifest } from "../catalog-store.mjs";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const day = "2026-10-09";
const at = `${day}T12:00:00.000Z`;
const address = (number = "10") => ({ street: "Teststraße", houseNumber: number, postalCode: "14469", city: "Potsdam" });
const plot = id => ({ ...address(), id, plotSizeSqm: 600, purchasePrice: 180000, isActive: true, createdAt: at, regionalNotes: "" });
function fixture(credits = 20, candidates = 5) {
  let state = { ...createInitialStudioState(), projects: [], plots: Array.from({ length: candidates }, (_, i) => plot(`fresh-${i}`)), deleteBatches: [], uploadHistory: [] };
  state.houses = Array.from({ length: 6 }, (_, i) => ({ ...createEmptyHouse(i + 1), id: `house-${i}`, name: `Haus ${i}`, approved: true,
    housePrice: 200000, livingArea: 140, rooms: 5, images: Array.from({ length: 4 }, (_, n) => ({ id: `img-${i}-${n}`, name: `Bild ${n}`, role: n < 2 ? "exterior" : "floorplan", dataUrl: "data:image/png;base64,YQ==", mimeType: "image/png" })) }));
  const source = { ...createInitialStudioState().projects[0], id: "old-project", plotId: "source", name: "Historisches Grundstück", listings: [], listingGroup: { variants: [], listingControls: [] } };
  for (let i = 0; i < credits; i++) {
    const id = `old-${i}`;
    const allocation = allocateDeleteBatchNumber(state, { listingId: id, projectId: source.id, housePosition: i % 4 + 1, uploadDate: "2026-09-01" });
    state = allocation.state;
    source.listings.push({ id, externalId: allocation.externalId, templateId: `house-${i % 4}`, status: "transferred_pending_import", transferredAt: "2026-09-01T12:00:00.000Z" });
  }
  state.projects = [source];
  state.houseDistribution = normalizeHouseDistribution({}, state.houses, state.projects);
  return linkDeleteBatchListings(state);
}
function confirmAll(state) {
  for (const batch of state.deleteBatches.filter(batch => batch.entries.some(entry => entry.status === "active"))) {
    const confirmed = confirmDeleteBatch(state, batch.id, at);
    state = recordRefillDeletions(state, confirmed.state);
  }
  return state;
}
const generate = (state, ids, distribution) => prepareProjectListings(state, ids, distribution, project => project, { initialPoolAOnly: true, now: at }).state;
const prepare = state => prepareSmartRefill(state, generate, { now: at });

// A real 20-place flow uses the production generator, allocator and confirmation logic.
test("20 confirmed deletions prepare five complete groups with unique new numbers and retained history", () => {
  const due = fixture();
  assert.equal(planSmartRefill(due).free, 0);
  const state = confirmAll(due);
  const before = structuredClone(state.projects[0]);
  assert.equal(planSmartRefill(state).free, 20);
  assert.equal(planSmartRefill(state).readyCount, 20);
  const prepared = prepare(state);
  assert.deepEqual(prepared.projects[0], before);
  assert.equal(prepared.smartRefill.cycles.length, 5);
  assert.equal(planSmartRefill(prepared).free, 0);
  assert.equal(planSmartRefill(prepared).preparedListingIds.length, 20);
  const created = prepared.projects.slice(1).flatMap(project => project.listings);
  assert.equal(new Set(created.map(listing => listing.externalId)).size, 20);
  assert.equal(new Set(created.map(listing => listing.id)).size, 20);
  for (const project of prepared.projects.slice(1)) {
    assert.equal(new Set(project.listings.map(listing => listing.templateId)).size, 4);
    assert.deepEqual(project.listings.map(listing => listing.addressSnapshot.housePosition), [1, 2, 3, 4]);
    assert.ok(project.listings.every(listing => listing.addressSnapshot.pool === "A"));
  }
  assert.doesNotThrow(() => assertBrowserCatalogTransition(state, prepared));
  assert.throws(() => prepare(prepared), /keine vollständige/u);
});

test("due and partial confirmation release only the actually confirmed entries, never rounded up", () => {
  const state = fixture(6, 3);
  assert.equal(planSmartRefill(state).released, 0);
  const batch = state.deleteBatches[0];
  const result = confirmDeleteBatch(state, batch.id, at);
  const confirmed = recordRefillDeletions(state, result.state);
  assert.equal(planSmartRefill(confirmed).free, result.deletedCount);
  assert.equal(planSmartRefill(confirmed).readyCount, Math.floor(result.deletedCount / 4) * 4);
  const all = confirmAll(confirmed);
  const prepared = prepare(all);
  assert.equal(planSmartRefill(prepared).free, 2);
  assert.equal(planSmartRefill(prepared).readyCount, 0);
});

test("same confirmation does not credit or generate twice, including after restart", () => {
  const state = fixture(4, 1), result = confirmDeleteBatch(state, state.deleteBatches[0].id, at);
  const once = recordRefillDeletions(state, result.state);
  assert.deepEqual(recordRefillDeletions(once, once), once);
  const all = confirmAll(once);
  const prepared = JSON.parse(JSON.stringify(prepare(all)));
  assert.equal(createSmartRefillUploadPlan(prepared).plan.totalListings, 4);
  assert.throws(() => prepare(prepared), /keine vollständige/u);
  const repeated = { ...prepared, smartRefill: { ...prepared.smartRefill, cycles: [...prepared.smartRefill.cycles, prepared.smartRefill.cycles[0]] } };
  assert.throws(() => assertSmartRefillTransition(prepared, repeated), /doppelte/u);
});

function rotating(state, deleted = 4, pool = "A") {
  const p = plot("source");
  p.addressRotation = { poolA: address(), poolB: address("12"), poolBDetails: { plotSizeSqm: 602, purchasePrice: 181350, mode: "AUTO_GENERATED", status: "" }, currentPool: pool, cycle: 1,
    listingIds: state.projects[0].listings.slice(0, 4).map(listing => listing.id), lastUsedA: at, lastUsedB: "" };
  const ids = new Set(p.addressRotation.listingIds.slice(deleted));
  state = { ...state, plots: [p, ...state.plots], projects: state.projects.map(project => ({ ...project, listings: project.listings.map(listing => ids.has(listing.id) ? { ...listing, status: "published", deletedAt: "" } : listing) })),
    deleteBatches: state.deleteBatches.map(batch => ({ ...batch, entries: batch.entries.map(entry => ids.has(entry.listingId) ? { ...entry, status: "active", deletedAt: "" } : entry) })) };
  return state;
}

test("2/4 deleted never rotates; unused plots fill capacity instead", () => {
  const state = rotating(confirmAll(fixture(4, 2)), 2);
  const plan = planSmartRefill(state);
  assert.equal(plan.candidates[0].plotId, "fresh-0");
  assert.ok(plan.blocked.some(item => item.plotId === "source"));
});

test("4/4 deleted prioritizes approved Pool B; auto-derived data require explicit matching approval", () => {
  let state = rotating(confirmAll(fixture(4, 1)));
  assert.equal(planSmartRefill(state).candidates[0].plotId, "fresh-0");
  assert.equal(planSmartRefill(state).blocked.find(item => item.plotId === "source").reason, "Pooldaten fachlich freigeben");
  const source = state.plots[0];
  state = approveRefillPool(state, source.id, "B", refillPoolFingerprint(source, "B"), at);
  assert.equal(planSmartRefill(state).candidates[0].plotId, "source");
  const prepared = prepare(state);
  const p = prepared.projects[0];
  assert.equal(p.plotArea, 602);
  assert.equal(p.plotPrice, 181350);
  assert.equal(p.houseNumber, "12");
  assert.ok(p.listings.slice(-4).every(listing => listing.addressSnapshot.pool === "B"));
  const changed = structuredClone(prepared);
  changed.plots[0].addressRotation.poolBDetails.purchasePrice++;
  assert.throws(() => createSmartRefillUploadPlan(changed), /geändert/u);
});

test("completed Pool B can switch back to Pool A without changing old listings", () => {
  const state = rotating(confirmAll(fixture(4, 1)), 4, "B");
  const prepared = prepare(state);
  assert.equal(prepared.smartRefill.cycles[0].pool, "A");
  assert.deepEqual(prepared.projects[0].listings.slice(0, 4), state.projects[0].listings);
});

test("premium, incomplete addresses, reviews and existing drafts exclude candidates", () => {
  const state = rotating(confirmAll(fixture(4, 0)));
  state.projects[0].listingGroup.listingControls = [{ listingId: "old-0", premiumPlacement: true }];
  assert.equal(planSmartRefill(state).readyCount, 0);
  assert.match(planSmartRefill(state).blocked[0].reason, /Premium/u);
  const invalid = confirmAll(fixture(4, 1)); invalid.plots[0].houseNumber = "0";
  assert.equal(planSmartRefill(invalid).readyCount, 0);
  const review = confirmAll(fixture(4, 1)); review.catalogRepairReview = { unresolved: [{ plotId: "fresh-0" }] };
  assert.equal(planSmartRefill(review).readyCount, 0);
  const draft = confirmAll(fixture(4, 1)); draft.projects.push({ id: "draft-project", plotId: "fresh-0", listings: [{ id: "draft", status: "draft" }] });
  assert.equal(planSmartRefill(draft).readyCount, 0);
});

test("no eligible plots or fewer than four valid houses leaves capacity visible", () => {
  const state = confirmAll(fixture(20, 0));
  assert.equal(planSmartRefill(state).remaining, 20);
  const houses = confirmAll(fixture(20, 5)); houses.houses = houses.houses.slice(0, 3);
  assert.equal(planSmartRefill(houses).readyCount, 0);
  assert.equal(planSmartRefill(houses).remaining, 20);
});

test("upload scope contains only reserved drafts; completed transfers never reappear", () => {
  const state = prepare(confirmAll(fixture(8, 2)));
  state.projects.push({ id: "unrelated", listings: [{ id: "other-draft", status: "draft", externalId: "30460-900001" }] });
  const first = state.projects[1].listings[0];
  first.status = "transferred_pending_import"; first.transferredAt = at;
  assert.equal(createSmartRefillUploadPlan(state).plan.totalListings, 7);
  assert.ok(createSmartRefillUploadPlan(state).plan.addresses.flatMap(item => item.items).every(item => item.listingId !== "other-draft" && item.listingId !== first.id));
  assert.throws(() => assertSmartRefillUploadReady(state, first), /nicht mehr/u);
});

test("actual upload day reassigns batches at +9/+10/+11/+12 and retains reservation", () => {
  const state = prepare(confirmAll(fixture(4, 1)));
  const ids = state.smartRefill.cycles[0].listingIds;
  assert.equal(deleteBatchesNeedReplan(state, ids, "2026-10-15"), true);
  const replanned = replanDeleteBatchesForUpload(state, ids, "2026-10-15");
  assert.equal(deleteBatchesNeedReplan(replanned, ids, "2026-10-15"), false);
  const dates = replanned.deleteBatches.flatMap(batch => batch.entries).filter(entry => ids.includes(entry.listingId) && entry.status === "planned").map(entry => entry.plannedDeletionDate).sort();
  assert.deepEqual(dates, ["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"]);
  assert.deepEqual(replanned.smartRefill, state.smartRefill);
  assert.doesNotThrow(() => assertBrowserCatalogTransition(state, replanned));
});

test("browser save cannot invent credits, erase reservations or reserve a stale candidate", () => {
  const current = confirmAll(fixture(4, 1));
  const prepared = prepare(current);
  assert.throws(() => assertBrowserCatalogTransition(current, { ...current, smartRefill: { ...current.smartRefill, credits: [] } }), /Bestätigung|Batchbestätigung/u);
  assert.throws(() => assertBrowserCatalogTransition(prepared, current), /Zuordnung/u);
  const protectedCurrent = structuredClone(current); protectedCurrent.plots[0].isActive = false;
  assert.throws(() => assertBrowserCatalogTransition(protectedCurrent, prepared), /nicht mehr/u);
});

test("reservation persists atomically and a competing preparation cannot consume the same credits", async context => {
  const directory = await mkdtemp(join(tmpdir(), "smart-refill-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const state = confirmAll(fixture(4, 1));
  const initial = await startCatalogSnapshot({ state, savedAt: at, expectedSavedAt: "", sessionId: "initial" }, directory);
  for (const imageId of initial.missingImageIds) await saveCatalogImage({ sessionId: "initial", imageId, data: Buffer.from("a") }, directory);
  await commitCatalogSnapshot("initial", directory);
  const store = createCatalogStateStore({ loadCatalogManifest: () => loadCatalogManifest(directory),
    startCatalogSnapshot: input => startCatalogSnapshot(input, directory), commitCatalogSnapshot: id => commitCatalogSnapshot(id, directory) });
  const restored = await store.load();
  assert.deepEqual(restored.state.smartRefill, state.smartRefill);
  const next = prepare(restored.state);
  await startCatalogSnapshot({ state: next, savedAt: "2026-10-09T13:00:00Z", expectedSavedAt: at, sessionId: "first", protectLifecycle: true }, directory);
  await startCatalogSnapshot({ state: next, savedAt: "2026-10-09T13:00:01Z", expectedSavedAt: at, sessionId: "second", protectLifecycle: true }, directory);
  await commitCatalogSnapshot("first", directory);
  await assert.rejects(() => commitCatalogSnapshot("second", directory), { code: "CATALOG_CONFLICT" });
  const restarted = await store.load();
  assert.deepEqual(restarted.state.smartRefill, next.smartRefill);
  assert.equal(createSmartRefillUploadPlan(restarted.state).plan.totalListings, 4);
  assert.throws(() => prepare(restarted.state), /keine vollständige/u);
});


test("replanned and then confirmed cycle is ready despite obsolete void entries", () => {
  let state = prepare(confirmAll(fixture(4, 1)));
  const ids = state.smartRefill.cycles[0].listingIds;
  state = replanDeleteBatchesForUpload(state, ids, "2026-10-15");
  state.projects = state.projects.map(project => ({ ...project, listings: project.listings.map(listing => ids.includes(listing.id) ? { ...listing, status: "transferred_pending_import", transferredAt: at } : listing) }));
  state = confirmAll(linkDeleteBatchListings(state));
  const p = state.plots[0];
  p.addressRotation.poolB = address("12");
  p.addressRotation.poolBDetails = { plotSizeSqm: 602, purchasePrice: 181350 };
  state = approveRefillPool(state, p.id, "B", refillPoolFingerprint(p, "B"), at);
  assert.equal(planSmartRefill(state).free, 4);
  assert.equal(prepare(state).smartRefill.cycles.at(-1).pool, "B");
});

test("protected batch entries never create free places", () => {
  let state = fixture(4, 1);
  state.projects[0].listingGroup.listingControls = [{ listingId: "old-0", premiumPlacement: true }];
  state = confirmAll(linkDeleteBatchListings(state));
  assert.equal(planSmartRefill(state).free, 3);
  assert.equal(planSmartRefill(state).readyCount, 0);
  assert.equal(state.projects[0].listings[0].status, "transferred_pending_import");
});

test("rendered panel shows counts, explicit actions, foldable details and factual approval", async () => {
  const ts = await import("typescript");
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const source = await readFile(new URL("../app/components/SmartRefillPanel.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const resolved = compiled.replace(/from (["'])([^"']+)\1/g, (_, quote, specifier) => `from ${JSON.stringify(import.meta.resolve(specifier))}`);
  const { default: Component } = await import("data:text/javascript;base64," + Buffer.from(resolved).toString("base64"));
  const state = rotating(confirmAll(fixture(4, 1)));
  const render = (input, online = true) => renderToStaticMarkup(createElement(Component, { plan: planSmartRefill(input), state: input, online, busy: false, uploading: false,
    onCheck() {}, onPrepare() {}, onUpload() {}, onApprove() {} }));
  const html = render(state);
  assert.match(html, /<b>4<\/b> freie Plätze/u);
  assert.match(html, /Nachschub prüfen/u);
  assert.match(html, /Inserate vorbereiten/u);
  assert.match(html, /Vorbereitete Inserate hochladen/u);
  assert.match(html, /<details><summary>/u);
  assert.match(html, /Diese Pooldaten fachlich freigeben/u);
  const preview = render(prepare(state));
  assert.match(preview, /Kurze Vorschau/u);
  assert.match(preview, /30460-\d{6}/u);
  assert.equal((render(state, false).match(/disabled=""/g) || []).length, 4);
});

test("refill uses global interior rotation and the existing compliant OpenImmo package", async () => {
  const { INTERIOR_SET_IDS, INTERIOR_SET_ROLES } = await import("../interior-sets.mjs");
  const { buildImportPackage } = await import("../app/lib/openimmo.ts");
  let state = rotating(confirmAll(fixture(4, 1)));
  state.provider = { ...state.provider, providerNumber: "30460", email: "test@example.com" };
  state.houses = state.houses.map(house => ({ ...house, images: ["cover", "emotion", "floorplan_ground", "floorplan_upper", "awards", "trust", "qr"].map(role => ({ id: `${house.id}-${role}`, role, name: `${role}.jpg`, mimeType: "image/jpeg", dataUrl: "data:image/jpeg;base64,YQ==", caption: role, isFloorplan: role.startsWith("floorplan") })) }));
  state.interiorAssets = INTERIOR_SET_IDS.flatMap(set => INTERIOR_SET_ROLES.map(role => ({ id: `${set}-${role}`, role,
    name: `${set}-${role}.jpg`, mimeType: "image/jpeg", dataUrl: "data:image/jpeg;base64,YQ==", caption: role, isFloorplan: false })));
  state.interiorSets = Object.fromEntries(INTERIOR_SET_IDS.map(set => [set, Object.fromEntries(INTERIOR_SET_ROLES.map(role => [role, `${set}-${role}`]))]));
  state = approveRefillPool(state, "source", "B", refillPoolFingerprint(state.plots[0], "B"), at);
  const prepared = prepare(state);
  const project = prepared.projects[0];
  const generated = project.listings.slice(-4);
  assert.deepEqual(generated.map(listing => listing.interiorSet), ["A", "B", "C", "A"]);
  const output = await buildImportPackage({ project, listings: generated, houses: prepared.houses, provider: prepared.provider, interiorAssets: prepared.interiorAssets });
  assert.match(output.xmlText, /<hausnummer>12<\/hausnummer>/u);
  assert.match(output.xmlText, /<grundstuecksflaeche>602<\/grundstuecksflaeche>/u);
  for (const listing of generated) assert.ok(output.xmlText.includes(listing.externalId));
  assert.doesNotMatch(output.xmlText, /<energiepass>/u);
  assert.deepEqual(project.listings.slice(0, 4), state.projects[0].listings);
});
