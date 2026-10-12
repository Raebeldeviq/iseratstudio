import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeHouseDistribution } from "../house-distribution.mjs";
import { createInitialStudioState, createEmptyHouse } from "../studio-defaults.mjs";
import { allocateDeleteBatchNumber, confirmDeleteBatch, linkDeleteBatchListings, replanDeleteBatchesForUpload, deleteBatchTrafficLight } from "../delete-batches.mjs";
import { prepareProjectListings } from "../app/lib/listing-preparation.ts";
import { recordRefillDeletions, planSmartRefill, prepareSmartRefill, adoptApprovedRefillPools, refillPoolFingerprint,
  createSmartRefillUploadPlan, assertSmartRefillTransition, assertSmartRefillUploadReady, discardUntransferredRefill } from "../smart-refill.mjs";
import { assertBrowserCatalogTransition } from "../listing-catalog-view.mjs";
import { startCatalogSnapshot, commitCatalogSnapshot, saveCatalogImage, loadCatalogManifest } from "../catalog-store.mjs";
import { removeManagerListings, managerCleanupRevision } from '../manager-cleanup.mjs';
import { reconcileCompletedManualBatchTransferInState } from '../manual-batch-upload.mjs';
const at = "2026-10-11T12:00:00.000Z";
const address = (n = "10") => ({ street: "Teststraße", houseNumber: n, postalCode: "14469", city: "Potsdam" });
const generate = (state, ids, distribution, replacements) => prepareProjectListings(state, ids, distribution, project => project, { replacements, now: at }).state;
const prepare = (state, options = {}) => prepareSmartRefill(state, generate, { now: at, ...options });
function fixture(count = 1, sourcePool = "A", positions = [1]) {
  const initial = createInitialStudioState();
  let state = { ...initial, projects: [], plots: [], uploadHistory: [], deleteBatches: [], listingResetHistory: [] };
  state.houses = Array.from({ length: 9 }, (_, i) => ({ ...createEmptyHouse(i + 1), id: `house-${i}`, name: `Haus ${i}`, approved: true,
    housePrice: 200000 + i * 1000, livingArea: 140, rooms: 5,
    images: ["cover", "emotion", "floorplan_ground", "floorplan_upper", "awards", "trust", "qr"].map(role => ({ id: `${i}-${role}`, role, name: `${role}.jpg`, caption: role,
      dataUrl: "data:image/jpeg;base64,YQ==", mimeType: "image/jpeg", isFloorplan: role.startsWith("floorplan") })) }));
  for (let i = 0; i < count; i++) {
    const plot = { ...address(), id: `plot-${i}`, plotSizeSqm: 600, purchasePrice: 180000, isActive: true, createdAt: at,
      addressRotation: { poolA: address(), poolB: address("12"), poolBDetails: { plotSizeSqm: 602, purchasePrice: 181350 },
        currentPool: "A", cycle: 1, listingIds: [], lastUsedA: at, lastUsedB: "" } };
    const project = { ...initial.projects[0], id: `project-${i}`, plotId: plot.id, name: `Grundstück ${i}`, street: "Teststraße", houseNumber: "10", zip: "14469", city: "Potsdam",
      plotArea: 600, plotPrice: 180000, listings: [], listingGroup: { schemaVersion: 2, variants: [], listingControls: [] } };
    state.plots.push(plot);
    for (let n = 1; n <= 4; n++) {
      const allocation = allocateDeleteBatchNumber(state, { listingId: `listing-${i}-${n}`, projectId: project.id, housePosition: n, uploadDate: "2026-09-01" });
      state = allocation.state;
      const listing = { id: `listing-${i}-${n}`, externalId: allocation.externalId, templateId: `house-${n - 1}`, templateName: `Haus ${n - 1}`,
        status: "transferred_pending_import", transferredAt: "2026-09-01T12:00:00.000Z", texts: { title: "Bestand", description: "Unveränderte Beschreibung" },
        addressSnapshot: { plotId: plot.id, pool: sourcePool, cycle: 1, housePosition: n, address: sourcePool === "A" ? { ...address(), plotSizeSqm: 600, purchasePrice: 180000 }
          : { ...address("12"), plotSizeSqm: 602, purchasePrice: 181350 }, batchId: allocation.batchId, plannedDeletionDate: state.deleteBatches.at(-1).plannedDeletionDate } };
      project.listings.push(listing);
      project.listingGroup.variants.push({ id: `variant-${i}-${n}`, active: true, templateId: listing.templateId, listing, order: n });
    }
    state.projects.push(project);
  }
  state = linkDeleteBatchListings(state);
  state.houseDistribution = normalizeHouseDistribution({}, state.houses, state.projects);
  state = adoptApprovedRefillPools(state, at);
  const before = state;
  for (const batch of before.deleteBatches.filter(batch => batch.entries.some(entry => positions.includes(entry.housePosition)))) {
    state = recordRefillDeletions(state, confirmDeleteBatch(state, batch.id, at).state);
  }
  return state;
}
function newly(state) { const ids = new Set(state.smartRefill.cycles.filter(c => c.kind === "listing-replacement").flatMap(c => c.listingIds));
  return state.projects.flatMap(p => p.listings).filter(l => ids.has(l.id)); }

function cleanedReservedFixture(exportReport = false) {
  let state = prepare(fixture());
  const project = state.projects[0], source = project.listings[0], cycle = state.smartRefill.cycles[0], credit = state.smartRefill.credits[0];
  if (exportReport) {
    const hash = 'a'.repeat(64), batchId = `external-report:${hash}`;
    Object.assign(credit, { batchId, source: 'user-supplied-export-report', reportHash: hash });
    credit.id = JSON.stringify([batchId, project.id, source.id, source.externalId]); cycle.creditIds = [credit.id];
    for (const listing of project.listings) if (listing.rotationSourceListingId === source.id) listing.refillSourceCreditId = credit.id;
    for (const variant of project.listingGroup.variants) if (variant.listing?.rotationSourceListingId === source.id) variant.listing.refillSourceCreditId = credit.id;
    source.deleteConfirmedAt = credit.deletedAt;
    source.externalDeletionEvidence = { reportId: 'export-receipt', reportHash: hash, confirmedAt: credit.deletedAt, source: credit.source };
    state.deleteReports = [{ reportId: 'export-receipt', sourceListingId: source.id, projectId: project.id, plotId: project.plotId,
      externalObjectNumber: source.externalId, rawHash: hash, processedAt: credit.deletedAt, result: 'success', confirmationSource: credit.source }];
    state.deleteBatches = state.deleteBatches.map(batch => ({ ...batch, entries: batch.entries.filter(entry => entry.listingId !== source.id) }));
  }
  const entry = { project, listing: source, group: project.listingGroup };
  return removeManagerListings(state, { entries: [{ projectId: project.id, listingId: source.id, externalId: source.externalId,
    expectedRevision: managerCleanupRevision(state, entry) }] }, '2026-10-12T12:00:00.000Z');
}

test('manager removal of a confirmed batch source keeps its reserved successor eligible without mutating any facts', () => {
  const state = cleanedReservedFixture(), before = structuredClone(state), listing = newly(state)[0];
  assert.ok(state.projects[0].listings[0].managerCleanup);
  assert.doesNotThrow(() => assertSmartRefillUploadReady(state, listing));
  assert.equal(createSmartRefillUploadPlan(state, { selectedListingIds: [listing.id] }).plan.totalListings, 1);
  assert.deepEqual(state, before); assert.equal(planSmartRefill(state).reserved, 1); assert.equal(planSmartRefill(state).free, 0);
});
test('manager removal of a legacy source keeps the exact export-report receipt valid', () => {
  const state = cleanedReservedFixture(true), before = structuredClone(state);
  assert.doesNotThrow(() => assertSmartRefillUploadReady(state, newly(state)[0]));
  assert.deepEqual(state, before);
});
test('missing deletion time remains blocked even when the source has not been manager-removed', () => {
  for (const kind of ['credit', 'source']) {
    const state = prepare(fixture());
    if (kind === 'credit') state.smartRefill.credits[0].deletedAt = '';
    else state.projects[0].listings[0].deletedAt = '';
    assert.throws(() => assertSmartRefillUploadReady(state, newly(state)[0]), /Löschung/u);
  }
});
test('removed batch source still blocks missing, reverted or mismatching deletion confirmations', () => {
  const mutations = [
    s => { s.smartRefill.credits[0].deletedAt = ''; },
    s => { s.projects[0].listings[0].deletedAt = ''; },
    s => { s.projects[0].listings[0].externalDeletionPending = true; },
    s => { s.projects[0].listings[0].status = 'draft'; },
    s => { s.deleteBatches.flatMap(b => b.entries).find(e => e.listingId === 'listing-0-1').status = 'active'; },
    s => { s.deleteBatches.flatMap(b => b.entries).find(e => e.listingId === 'listing-0-1').deletedAt = ''; },
    s => { s.deleteBatches = s.deleteBatches.map(b => ({ ...b, entries: b.entries.filter(e => e.listingId !== 'listing-0-1') })); },
    s => { s.smartRefill.cycles[0].sourceListingId = 'other-source'; },
    s => { s.smartRefill.cycles[0].sourceExternalId = '30460-999999'; },
    s => { s.smartRefill.cycles[0].sourceHouseId = 'different-house'; },
    s => { s.projects[0].listings[0].managerCleanup.externalId = '30460-999999'; },
    s => { s.projects[0].listings[0].managerCleanup.source = 'discarded-refill'; },
    s => { s.projects[0].listings[0].managerCleanup.removedAt = '2026-10-10T12:00:00Z'; },
    s => { s.smartRefill.cycles[0].preparedAt = '2026-10-10T12:00:00Z'; },
  ];
  for (const mutate of mutations) { const state = cleanedReservedFixture(); mutate(state); assert.throws(() => assertSmartRefillUploadReady(state, newly(state)[0]), /Löschung|Snapshot/u); }
});
test('removed legacy source still blocks missing, duplicate and conflicting report receipts', () => {
  const mutations = [
    s => { s.deleteReports = []; },
    s => { s.deleteReports.push(structuredClone(s.deleteReports[0])); },
    s => { s.deleteReports[0].result = 'failed'; },
    s => { s.deleteReports[0].rawHash = 'b'.repeat(64); },
    s => { s.deleteReports[0].plotId = 'another-plot'; },
    s => { s.deleteReports[0].externalObjectNumber = '30460-999999'; },
    s => { s.deleteReports[0].processedAt = '2026-10-12T10:00:00Z'; },
    s => { s.deleteReports[0].sourceListingId = 'different'; },
    s => { s.projects[0].listings[0].externalDeletionEvidence = undefined; },
    s => { s.projects[0].listings[0].deleteConfirmedAt = ''; },
  ];
  for (const mutate of mutations) { const state = cleanedReservedFixture(true); mutate(state); assert.throws(() => assertSmartRefillUploadReady(state, newly(state)[0]), /Löschung/u); }
});
test('source or successor Premium and genuine manual locks remain effective after manager removal', () => {
  for (const id of ['listing-0-1', 'successor']) for (const lock of [{ premiumPlacement: true }, { manualLock: true, lockReason: 'Manuell geschützt' }, { manualLock: true, lockedUntil: '2027-01-01T12:00:00Z' }]) {
    const state = cleanedReservedFixture(), listing = newly(state)[0];
    state.projects[0].listingGroup.listingControls.push({ listingId: id === 'successor' ? listing.id : id, status: 'deleted', updateMode: 'blocked', automaticUpdateEnabled: false, ...lock });
    assert.throws(() => assertSmartRefillUploadReady(state, listing), /Löschschutz/u);
  }
});
test('a duplicate inventory correction remains blocked even when an old reservation exists', () => {
  const state = cleanedReservedFixture(true); state.projects[0].listings[0].inventoryCorrection = { active: true };
  assert.throws(() => assertSmartRefillUploadReady(state, newly(state)[0]), /Löschung/u);
});
test('retained archived source resolves from its fixed reservation and transfers without reactivating the archive', () => {
  const state = cleanedReservedFixture(true), project = state.projects[0], source = project.listings[0], listing = newly(state)[0];
  source.status = 'archived'; delete source.addressSnapshot;
  delete state.smartRefill.credits[0].sourcePool; delete state.smartRefill.credits[0].housePosition;
  project.listings = project.listings.filter(l => l.id !== source.id);
  project.listingGroup.variants = project.listingGroup.variants.filter(v => v.listing?.id !== source.id);
  state.listingResetHistory = [{ id: 'retained-source', kind: 'plot-listing-reset', projectId: project.id, plotId: project.plotId, listings: [source], listingGroup: { listingControls: [] } }];
  const before = structuredClone(state); assert.doesNotThrow(() => assertSmartRefillUploadReady(state, listing));
  const item = createSmartRefillUploadPlan(state, { selectedListingIds: [listing.id] }).plan.addresses[0].items[0];
  const next = reconcileCompletedManualBatchTransferInState(state, { ...item, ledgerStatus: 'transferred_pending_import', transferredAt: '2026-10-12T13:00:00Z' });
  assert.equal(next.projects[0].listings.find(l => l.id === listing.id).status, 'transferred_pending_import');
  assert.deepEqual(next.listingResetHistory, before.listingResetHistory); assert.deepEqual(next.smartRefill, before.smartRefill); assert.deepEqual(state, before);
  state.listingResetHistory[0].listingGroup.listingControls.push({ listingId: source.id, premiumPlacement: true });
  assert.throws(() => assertSmartRefillUploadReady(state, listing), /Löschschutz/u);
});
test('hard-missing source and already transferred successors remain blocked after cleanup', () => {
  const state = cleanedReservedFixture(), listing = newly(state)[0];
  const missing = structuredClone(state); missing.projects[0].listings = missing.projects[0].listings.filter(l => l.id !== 'listing-0-1');
  assert.throws(() => assertSmartRefillUploadReady(missing, newly(missing)[0]), /Löschung/u);
  const duplicate = structuredClone(state); duplicate.listingResetHistory = [{ projectId: state.projects[0].id, plotId: state.projects[0].plotId, listings: [structuredClone(state.projects[0].listings[0])] }];
  assert.throws(() => assertSmartRefillUploadReady(duplicate, newly(duplicate)[0]), /Löschung/u);
  listing.status = 'transferred_pending_import'; listing.transferredAt = '2026-10-12T13:00:00Z';
  assert.throws(() => assertSmartRefillUploadReady(state, listing), /neuen Upload/u);
  assert.throws(() => createSmartRefillUploadPlan(state, { selectedListingIds: [listing.id] }), /bereits übertragen/u);
});

test("one Pool A deletion produces exactly one same-plot Pool B successor and preserves three online listings", () => {
  const state = fixture(), old = structuredClone(state.projects[0].listings), prepared = prepare(state), added = newly(prepared);
  assert.equal(added.length, 1); assert.equal(added[0].addressSnapshot.pool, "B"); assert.equal(added[0].addressSnapshot.plotId, "plot-0");
  assert.deepEqual(prepared.projects[0].listings.slice(0, 4), old);
  assert.deepEqual(prepared.projects[0].listingGroup.variants.slice(0, 4), state.projects[0].listingGroup.variants);
  assert.equal(prepared.projects[0].houseNumber, "10"); assert.notEqual(added[0].templateId, old[0].templateId);
  assert.ok(!old.slice(1).some(l => l.templateId === added[0].templateId));
  assert.equal(planSmartRefill(prepared).free, 0); assert.equal(planSmartRefill(prepared).reserved, 1);
  assert.doesNotThrow(() => assertBrowserCatalogTransition(state, prepared));
});
test("one Pool B deletion returns to Pool A even with a stale plot-wide currentPool", () => {
  const result = prepare(fixture(1, "B")); assert.equal(newly(result)[0].addressSnapshot.pool, "A");
});
test("four different Batch-001 plots get four single successors, never an unrelated four-group", () => {
  const names = ["Eichenallee 5", "Am Weinberg 1D", "Max-Eyth-Allee 8", "Neuer Weg 28"];
  const state = fixture(4); state.plots.forEach((p, i) => p.regionalNotes = names[i]);
  state.plots.push({ ...state.plots[0], id: "rothenbuecherweg" });
  const prepared = prepare(state), added = newly(prepared);
  assert.equal(added.length, 4); assert.equal(prepared.projects.length, 4);
  assert.deepEqual(added.map(l => l.addressSnapshot.plotId), ["plot-0", "plot-1", "plot-2", "plot-3"]);
  assert.equal(new Set(added.map(l => l.externalId)).size, 4);
  assert.equal(prepared.smartRefill.cycles.filter(c => c.kind === "listing-replacement").length, 4);
});
test("multiple successors on the same plot exclude all occupied and already reserved houses", () => {
  const state = fixture(1, "A", [1, 2]), prepared = prepare(state), added = newly(prepared);
  assert.equal(added.length, 2); assert.equal(new Set(added.map(l => l.templateId)).size, 2);
  for (const listing of added) assert.ok(!state.projects[0].listings.slice(2).some(old => old.templateId === listing.templateId));
  assert.deepEqual(added.map(l => l.addressSnapshot.housePosition), [1, 2]);
});
test("no alternative approved house blocks just that successor without creating a duplicate", () => {
  const state = fixture(); state.houses = state.houses.slice(0, 4);
  assert.equal(planSmartRefill(state).readyCount, 0); assert.match(planSmartRefill(state).blocked[0].reason, /ohne Doppelung/u);
  assert.throws(() => prepare(state), /kein eindeutig/u);
});
test("existing approved pool data are accepted; changed or incomplete data require review", () => {
  const state = fixture(); assert.equal(planSmartRefill(state).readyCount, 1);
  const changed = structuredClone(state); changed.plots[0].addressRotation.poolBDetails.purchasePrice++;
  assert.equal(planSmartRefill(changed).readyCount, 0); assert.match(planSmartRefill(changed).blocked[0].reason, /freigeben/u);
  const missing = structuredClone(state); missing.plots[0].addressRotation.poolB.houseNumber = "";
  assert.equal(planSmartRefill(missing).readyCount, 0);
});
test("legacy sources are resolved from upload address and preserved house slot; unresolved sources never fill a foreign plot", () => {
  let state = fixture(); state.projects[0].listings[0] = { ...state.projects[0].listings[0], addressSnapshot: undefined };
  state.smartRefill.credits = state.smartRefill.credits.map(credit => {
    const legacy = { ...credit }; delete legacy.sourcePool; delete legacy.housePosition; return legacy;
  });
  state.uploadHistory = [{ projectId: "project-0", listingId: state.projects[0].listings[0].id, externalId: state.projects[0].listings[0].externalId, address: "Teststraße 10 14469 Potsdam" }];
  assert.equal(newly(prepare(state))[0].addressSnapshot.housePosition, 1);
  state.uploadHistory[0].address = "Andere Adresse"; assert.equal(planSmartRefill(state).readyCount, 0);
});
test("Pool A→B→A survives repeated confirmations and restart without duplicate credits or successors", () => {
  let state = prepare(fixture()); const first = newly(state)[0];
  state.projects[0].listings = state.projects[0].listings.map(l => l.id === first.id ? { ...l, status: "transferred_pending_import", transferredAt: at } : l);
  state = linkDeleteBatchListings(state); const before = state;
  state = recordRefillDeletions(before, confirmDeleteBatch(state, first.addressSnapshot.batchId, at).state);
  assert.equal(state.smartRefill.credits.length, 2);
  state = JSON.parse(JSON.stringify(state));
  assert.equal(planSmartRefill(state).readyCount, 1, JSON.stringify(planSmartRefill(state).blocked));
  state = prepare(state);
  assert.equal(newly(state).at(-1).addressSnapshot.pool, "A");
  assert.equal(newly(state).length, 2); assert.deepEqual(recordRefillDeletions(state, state), state);
  assert.throws(() => prepare(state), /kein eindeutig/u);
});
test("one credit and source identity cannot be processed twice, and stale browser reservations are rejected", () => {
  const state = fixture(), prepared = prepare(state);
  const duplicate = { ...prepared, smartRefill: { ...prepared.smartRefill, cycles: [...prepared.smartRefill.cycles, prepared.smartRefill.cycles[0]] } };
  assert.throws(() => assertSmartRefillTransition(prepared, duplicate), /doppelte/u);
  assert.throws(() => assertSmartRefillTransition(prepared, state), /Zuordnung/u);
  assert.throws(() => assertBrowserCatalogTransition(state, { ...state, smartRefill: { ...state.smartRefill, credits: [] } }), /Batchbestätigung/u);
  const inactive = structuredClone(state); inactive.plots[0].isActive = false;
  assert.throws(() => assertBrowserCatalogTransition(inactive, prepared), /freigegeben/u);
});
test("deletion stagger retains source slots +9/+10/+11/+12 including replan before later upload", () => {
  let state = prepare(fixture(1, "A", [1, 2, 3, 4])); const added = newly(state);
  assert.deepEqual(added.map(l => l.addressSnapshot.plannedDeletionDate), ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"]);
  state = replanDeleteBatchesForUpload(state, added.map(l => l.id), "2026-10-15");
  assert.deepEqual(newly(state).map(l => l.addressSnapshot.plannedDeletionDate), ["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"]);
  assert.doesNotThrow(() => createSmartRefillUploadPlan(state, { selectedListingIds: newly(state).map(l => l.id) }));
});
test("source premium or lock blocks replacement; protected neighbours remain unchanged and do not block another slot", () => {
  const state = fixture(); state.projects[0].listingGroup.listingControls.push({ listingId: "listing-0-1", premiumPlacement: true });
  assert.equal(planSmartRefill(state).readyCount, 0);
  state.projects[0].listingGroup.listingControls = [{ listingId: "listing-0-2", premiumPlacement: true }];
  const prepared = prepare(state); assert.deepEqual(prepared.projects[0].listings[1], state.projects[0].listings[1]);
  assert.doesNotThrow(() => createSmartRefillUploadPlan(prepared, { selectedListingIds: newly(prepared).map(l => l.id) }));
});
test("historical corrections, manager removal and archives do not become replacement sources or credits", () => {
  for (const metadata of [{ inventoryCorrection: { active: true } }, { managerCleanup: { removedAt: at } }]) {
    const state = fixture(); Object.assign(state.projects[0].listings[0], metadata);
    assert.equal(planSmartRefill(state).readyCount, 0);
  }
  const state = fixture(), archive = { id: "fritz-archive", projectId: "project-0", plotId: "plot-0", listings: [{ id: "duplicate", status: "archived", inventoryCorrection: { active: true } }] };
  state.listingResetHistory.push(archive); assert.deepEqual(prepare(state).listingResetHistory, state.listingResetHistory);
});
function wrongPreparation() {
  const state = fixture(4); const project = { ...state.projects[0], id: "wrong-project", plotId: "wrong-plot", listings: [], listingGroup: { variants: [], listingControls: [] } };
  let result = state; const ids = [];
  for (let i = 0; i < 4; i++) { const id = `wrong-${i}`; ids.push(id);
    const allocation = allocateDeleteBatchNumber(result, { projectId: project.id, listingId: id, housePosition: i + 1, uploadDate: "2026-10-11" }); result = allocation.state;
    project.listings.push({ id, externalId: allocation.externalId, templateId: `house-${i}`, status: "draft" }); }
  result.projects.push(project);
  result.smartRefill.cycles.push({ id: "wrong-cycle", plotId: "wrong-plot", projectId: project.id, pool: "A", cycle: 1, listingIds: ids, creditIds: result.smartRefill.credits.map(c => c.id), preparedAt: at });
  return result;
}
test("controlled discard releases exactly four existing reservations, preserves audit/numbers/history and can be repeated", () => {
  const state = wrongPreparation(), numbers = state.projects.at(-1).listings.map(l => l.externalId);
  const discarded = discardUntransferredRefill(state, "wrong-cycle", numbers, [], at);
  assert.equal(discarded.smartRefill.credits.length, 4); assert.equal(planSmartRefill(discarded).free, 4);
  assert.deepEqual(discarded.smartRefill.cycles, state.smartRefill.cycles); assert.deepEqual(discarded.uploadHistory, state.uploadHistory);
  assert.ok(discarded.projects.at(-1).listings.every(l => l.refillDiscard && l.managerCleanup));
  assert.deepEqual(discardUntransferredRefill(discarded, "wrong-cycle", numbers, [], at), discarded);
  const prepared = prepare(discarded); assert.ok(newly(prepared).every(l => !numbers.includes(l.externalId)));
  assert.throws(() => assertBrowserCatalogTransition(state, discarded), /Verwaltungstransaktion|Bestandskorrektur|Bereinigung/u);
});
test("discard fails closed on transfer metadata, upload history, a queued job, an active batch or mismatching numbers", () => {
  for (const kind of ["transfer", "history", "job", "batch", "numbers"]) {
    const state = wrongPreparation(), listing = state.projects.at(-1).listings[0], numbers = state.projects.at(-1).listings.map(l => l.externalId), jobs = [];
    if (kind === "transfer") listing.transferredAt = at;
    if (kind === "history") state.uploadHistory.push({ listingId: listing.id });
    if (kind === "job") jobs.push({ listingId: listing.id, status: "queued" });
    if (kind === "batch") state.deleteBatches.flatMap(b => b.entries).find(e => e.listingId === listing.id).status = "active";
    if (kind === "numbers") numbers[0] = "30460-999999";
    assert.throws(() => discardUntransferredRefill(state, "wrong-cycle", numbers, jobs, at));
  }
});
test("transferred successors never reappear in upload scope and changed pool facts block upload", () => {
  const state = prepare(fixture()), listing = newly(state)[0];
  assert.equal(createSmartRefillUploadPlan(state, { selectedListingIds: [listing.id] }).plan.totalListings, 1);
  const changed = structuredClone(state); changed.plots[0].addressRotation.poolBDetails.purchasePrice++;
  assert.throws(() => assertSmartRefillUploadReady(changed, newly(changed)[0]), /geändert/u);
  listing.transferredAt = at; listing.status = "transferred_pending_import";
  assert.throws(() => createSmartRefillUploadPlan(state, { selectedListingIds: [listing.id] }), /bereits übertragen/u);
});
test("reservations persist atomically and simultaneous preparations cannot consume the same credit", async context => {
  const directory = await mkdtemp(join(tmpdir(), "smart-refill-single-")); context.after(() => rm(directory, { recursive: true, force: true }));
  const state = fixture(); const snapshot = await startCatalogSnapshot({ state, savedAt: at, expectedSavedAt: "", sessionId: "initial" }, directory);
  for (const imageId of snapshot.missingImageIds) await saveCatalogImage({ sessionId: "initial", imageId, data: Buffer.from("a") }, directory);
  await commitCatalogSnapshot("initial", directory);
  const restored = await loadCatalogManifest(directory), prepared = prepare(restored.state);
  for (const sessionId of ["first", "second"]) await startCatalogSnapshot({ state: prepared, savedAt: "2026-10-11T13:00:00Z", expectedSavedAt: at, sessionId, protectLifecycle: true }, directory);
  await commitCatalogSnapshot("first", directory); await assert.rejects(() => commitCatalogSnapshot("second", directory), { code: "CATALOG_CONFLICT" });
  const restarted = await loadCatalogManifest(directory); assert.deepEqual(restarted.state.smartRefill, prepared.smartRefill);
  assert.equal(planSmartRefill(restarted.state).reserved, 1); assert.throws(() => prepare(restarted.state), /kein eindeutig/u);
});
test("rendered existing dashboard shows source→successor, pools, houses, number and deletion slot", async () => {
  const ts = await import("typescript"), { createElement } = await import("react"), { renderToStaticMarkup } = await import("react-dom/server");
  const source = await readFile(new URL("../app/components/SmartRefillPanel.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const resolved = compiled.replace(/from (["'])([^"']+)\1/g, (_, quote, specifier) => `from ${JSON.stringify(specifier.startsWith('.') ? new URL(specifier, new URL('../app/components/SmartRefillPanel.tsx', import.meta.url)).href : import.meta.resolve(specifier))}`);
  const { default: Component } = await import("data:text/javascript;base64," + Buffer.from(resolved).toString("base64"));
  const state = prepare(fixture()), listing = newly(state)[0];
  const html = renderToStaticMarkup(createElement(Component, { state, plan: planSmartRefill(state), online: true, busy: false, uploading: false, onCheck() {}, onPrepare() {}, onUpload() {}, onApprove() {} }));
  assert.match(html, /Nachschub &amp; Rotation/u); assert.match(html, /Pool A → Pool B/u); assert.ok(html.includes(listing.externalId));
  assert.match(html, /Hausposition /u); assert.match(html, /Haus 0/u); assert.doesNotMatch(html, /Vierergruppen/u);
});
test("replacement retains existing global interior rotation and compliant OpenImmo with pool-specific area and price", async () => {
  const { INTERIOR_SET_IDS, INTERIOR_SET_ROLES } = await import("../interior-sets.mjs"); const { buildImportPackage } = await import("../app/lib/openimmo.ts");
  let state = fixture(4); state.provider = { ...state.provider, providerNumber: "30460", email: "test@example.com" };
  state.interiorAssets = INTERIOR_SET_IDS.flatMap(set => INTERIOR_SET_ROLES.map(role => ({ id: `${set}-${role}`, role, name: `${set}-${role}.jpg`, caption: role,
    dataUrl: "data:image/jpeg;base64,YQ==", mimeType: "image/jpeg", isFloorplan: false })));
  state.interiorSets = Object.fromEntries(INTERIOR_SET_IDS.map(set => [set, Object.fromEntries(INTERIOR_SET_ROLES.map(role => [role, `${set}-${role}`]))]));
  const prepared = prepare(state), added = newly(prepared); assert.deepEqual(added.map(l => l.interiorSet), ["A", "B", "C", "A"]);
  const output = await buildImportPackage({ project: prepared.projects[0], listings: [added[0]], houses: prepared.houses, provider: prepared.provider, interiorAssets: prepared.interiorAssets });
  assert.match(output.xmlText, /<hausnummer>12<\/hausnummer>/u); assert.match(output.xmlText, /<grundstuecksflaeche>602<\/grundstuecksflaeche>/u);
  assert.ok(output.xmlText.includes(added[0].externalId)); assert.doesNotMatch(output.xmlText, /<energiepass>/u);
  assert.equal(added[0].price, prepared.houses.find(h => h.id === added[0].templateId).housePrice + 181350 + state.projects[0].additionalCosts);
});
test("saved master Pool B facts take precedence over missing legacy rotation metadata, without changing plots or Excel", () => {
  let state = fixture(); const savedPlot = structuredClone(state.plots[0]); savedPlot.addressRotation.poolB.houseNumber = "14";
  delete state.plots[0].addressRotation;
  state.activePlotCatalog = { version: 1, approvedAt: at, lastValidSource: { available: true,
    territory: { available: true, postalCodes: ["14469"], regions: {} }, masterPlots: [savedPlot] } }; state = adoptApprovedRefillPools(state, at);
  assert.equal(refillPoolFingerprint(state.plots[0], "B", state).includes('"14"'), true);
  const before = structuredClone(state.plots); const prepared = prepare(state);
  assert.equal(newly(prepared)[0].addressSnapshot.address.houseNumber, "14"); assert.deepEqual(prepared.plots, before);
});
test("historical duplicate deletion entries never grant replacement credits", () => {
  const before = fixture(), source = before.projects[0].listings[1]; source.inventoryCorrection = { active: true };
  assert.throws(() => confirmDeleteBatch(before, before.deleteBatches[1].id, at), /keine übertragenen/u);
  const after = { ...before, deleteBatches: before.deleteBatches.map(b => ({ ...b, entries: b.entries.map(e => e.listingId === source.id ? { ...e, status: "deleted", deletedAt: at } : e) })) };
  assert.equal(recordRefillDeletions(before, after).smartRefill.credits.length, 1);
  assert.ok(deleteBatchTrafficLight(after).every(b => !b.active.some(e => e.listingId === source.id)));
});

test("exact Batch-001 repair releases Rothenbücherweg reservations and refills only the four authorized sources", async () => {
  const { prepareBatch001Recovery, SOURCE_NUMBERS, WRONG_NUMBERS } = await import('../scripts/repair-batch-001-refill.mjs');
  const state = wrongPreparation();
  const plotIds = ['plot-sync-zglys2', 'plot-sync-9o8zde', 'plot-sync-1o4aam6', 'f823e638-ec7c-4ffd-8d9e-e02b44525619'];
  for (let i = 0; i < 4; i++) {
    const plot = state.plots[i], project = state.projects[i]; plot.id = plotIds[i]; project.plotId = plot.id;
    for (const l of project.listings) l.addressSnapshot.plotId = plot.id;
    project.listings[0].externalId = SOURCE_NUMBERS[i];
    const entry = state.deleteBatches.flatMap(b => b.entries).find(e => e.projectId === project.id && e.housePosition === 1);
    entry.externalId = SOURCE_NUMBERS[i]; entry.index = i + 3;
    const credit = state.smartRefill.credits[i]; credit.externalId = SOURCE_NUMBERS[i]; credit.plotId = plot.id;
    credit.id = JSON.stringify([credit.batchId, credit.projectId, credit.listingId, credit.externalId]);
  }
  const wrong = state.projects.at(-1); wrong.plotId = '93840498-dcf4-4d0b-be4a-090bc98ec9fe';
  wrong.listings.forEach((l, i) => { const e = state.deleteBatches.flatMap(b => b.entries).find(e => e.listingId === l.id); l.externalId = WRONG_NUMBERS[i]; e.externalId = l.externalId; });
  const cycle = state.smartRefill.cycles[0]; cycle.id = 'refill:93840498-dcf4-4d0b-be4a-090bc98ec9fe:1'; cycle.plotId = wrong.plotId;
  cycle.creditIds = state.smartRefill.credits.map(c => c.id);
  const approved = adoptApprovedRefillPools(state, at), repaired = prepareBatch001Recovery(approved, [], at);
  assert.equal(newly(repaired).length, 4); assert.deepEqual(newly(repaired).map(l => l.addressSnapshot.plotId), plotIds);
  assert.deepEqual(repaired.smartRefill.credits, approved.smartRefill.credits);
  assert.ok(newly(repaired).every(l => l.addressSnapshot.pool === 'B' && !WRONG_NUMBERS.includes(l.externalId)));
  assert.equal(prepareBatch001Recovery(repaired, [], at), repaired);
});

test("discarding a never-uploaded first legacy cycle clears only its pool occupancy and retains pool facts", () => {
  const state = wrongPreparation(), cycle = state.smartRefill.cycles[0];
  const p = { ...state.plots[0], id: cycle.plotId, addressRotation: { ...state.plots[0].addressRotation,
    cycle: 1, currentPool: 'A', listingIds: cycle.listingIds, lastUsedA: at } };
  state.plots.push(p); const numbers = state.projects.at(-1).listings.map(l => l.externalId);
  const discarded = discardUntransferredRefill(state, cycle.id, numbers, [], at);
  const reset = discarded.plots.at(-1).addressRotation;
  assert.equal(reset.cycle, 0); assert.equal(reset.currentPool, ''); assert.deepEqual(reset.listingIds, []);
  assert.deepEqual(reset.poolA, p.addressRotation.poolA); assert.deepEqual(reset.poolB, p.addressRotation.poolB);
  assert.deepEqual(discarded.plots.slice(0, 4), state.plots.slice(0, 4));
});

test('discarded and historical object numbers stay burned even after batch-number rollover', () => {
  const state = { projects: [], listingResetHistory: [], deleteBatches: [
    { id: 'delete-batch:1:1', cycle: 1, number: 1, plannedDeletionDate: '2020-01-01', entries: [{ externalId: '30460-001001', index: 1, status: 'void' }], completedAt: at },
    { id: 'delete-batch:1:999', cycle: 1, number: 999, plannedDeletionDate: '2020-01-01', entries: [], completedAt: at },
  ] };
  const result = allocateDeleteBatchNumber(state, { projectId: 'p', listingId: 'new', housePosition: 1, uploadDate: '2030-01-01', reserveHistoricalNumbers: true });
  assert.equal(result.cycle, 2); assert.equal(result.externalId, '30460-001002');
});
