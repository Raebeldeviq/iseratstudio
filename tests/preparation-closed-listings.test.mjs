import assert from "node:assert/strict";
import test from "node:test";
import { prepareProjectListings } from "../app/lib/listing-preparation.ts";
import { createBatchUploadPlan } from "../batch-upload.mjs";
import { createInitialStudioState, createEmptyHouse } from "../studio-defaults.mjs";
import { normalizeHouseDistribution } from "../house-distribution.mjs";
import { assertBrowserCatalogTransition } from "../listing-catalog-view.mjs";

const at = "2026-10-26T20:00:00.000Z";
const prepare = state => prepareProjectListings(state, ["legacy-project"], state.houseDistribution);

function fixture() {
  const state = createInitialStudioState();
  state.houses = Array.from({ length: 8 }, (_, i) => ({ ...createEmptyHouse(i + 1), id: `house-${i}`, name: `Haus ${i}`,
    approved: true, housePrice: 200000, livingArea: 140, rooms: 5,
    images: ["cover", "emotion", "floorplan_ground", "floorplan_upper", "awards", "trust", "qr"].map(role => ({
      id: `${i}-${role}`, name: `${role}.jpg`, role, caption: role, mimeType: "image/jpeg",
      dataUrl: "data:image/jpeg;base64,YQ==", isFloorplan: role.startsWith("floorplan") })) }));
  state.projects = [{ ...state.projects[0], id: "legacy-project", plotId: "legacy-plot", name: "Teststraße 59A",
    street: "Teststraße", houseNumber: "59A", zip: "14109", city: "Berlin", plotArea: 900, plotPrice: 1100000,
    listings: [], listingGroup: { variants: [], listingControls: [] } }];
  // Legacy plots without a persisted addressRotation use ordinary preparation, as in the reported case.
  state.plots = [{ id: "legacy-plot", street: "Teststraße", houseNumber: "59A", postalCode: "14109", city: "Berlin" }];
  state.houseDistribution = normalizeHouseDistribution({}, state.houses, state.projects);
  state.houseDistribution.projects[0].previewHouseIds = state.houses.slice(0, 4).map(house => house.id);
  return prepare(state).state;
}

function patchFourth(state, patch, staleVariant = false) {
  const project = state.projects[0], listing = project.listings[3];
  if (staleVariant) project.listingGroup.variants[3].listing = structuredClone(listing);
  Object.assign(listing, patch);
  if (!staleVariant) project.listingGroup.variants[3].listing = structuredClone(listing);
  return listing;
}

function assertPreserved(before, after) {
  for (const old of before.projects[0].listings) {
    assert.deepEqual(after.projects[0].listings.find(listing => listing.id === old.id), old);
  }
  for (const key of ["smartRefill", "uploadHistory", "listingResetHistory"]) assert.deepEqual(after[key], before[key]);
  assertBrowserCatalogTransition(before, after);
}

test("three drafts and one deleted house become four uploadable drafts, with only one new listing", () => {
  const state = fixture();
  const deleted = patchFourth(state, { status: "deleted", transferredAt: at, deletedAt: at });
  const before = structuredClone(state), result = prepare(state), project = result.state.projects[0];
  assert.equal(createBatchUploadPlan(state, [project.id]).totalListings, 3);
  assert.equal(result.preparedListings, 4);
  assert.equal(createBatchUploadPlan(result.state, [project.id]).totalListings, 4);
  const added = project.listings.filter(listing => !before.projects[0].listings.some(old => old.id === listing.id));
  assert.equal(added.length, 1);
  assert.equal(added[0].templateId, deleted.templateId);
  assert.equal(added[0].status, "draft");
  assert.notEqual(added[0].externalId, deleted.externalId);
  assert.match(added[0].externalId, /^30460-\d{6}$/u);
  assert.equal(project.listingGroup.variants[3].listing.id, added[0].id);
  assertPreserved(before, result.state);
  assert.deepEqual(state, before);
  const repeated = prepare(result.state);
  assert.equal(repeated.preparedListings, 4);
  assert.equal(repeated.state.projects[0].listings.length, project.listings.length);
  assert.deepEqual(repeated.state.projects[0].listings, project.listings);
  assert.deepEqual(repeated.state.deleteBatches, result.state.deleteBatches);
});

test("a stale draft in the variant cannot reactivate its canonically deleted listing", () => {
  const state = fixture();
  const old = patchFourth(state, { status: "deleted", deletedAt: at }, true);
  const before = structuredClone(state), result = prepare(state);
  assert.notEqual(result.state.projects[0].listingGroup.variants[3].listing.id, old.id);
  assert.equal(result.preparedListings, createBatchUploadPlan(result.state, ["legacy-project"]).totalListings);
  assertPreserved(before, result.state);
});

test("all four deleted houses receive fresh identities while all four deletion records survive", () => {
  const state = fixture();
  state.projects[0].listings.forEach(listing => Object.assign(listing, { status: "deleted", deletedAt: at }));
  const before = structuredClone(state), result = prepare(state), project = result.state.projects[0];
  assert.equal(result.preparedListings, 4);
  assert.equal(project.listings.length, 8);
  const plan = createBatchUploadPlan(result.state, [project.id]);
  assert.equal(plan.totalListings, 4);
  assert.equal(new Set(plan.addresses[0].items.map(item => item.externalId)).size, 4);
  assert.ok(plan.addresses[0].items.every(item => !before.projects[0].listings.some(old => old.externalId === item.externalId)));
  assertPreserved(before, result.state);
});

test("a current draft is reused even if an older deleted entry of the same house appears first", () => {
  const state = fixture(), project = state.projects[0], current = project.listings[3];
  project.listings.unshift({ ...structuredClone(current), id: "old-fourth", externalId: "30460-099001", status: "deleted", deletedAt: at });
  project.listingGroup.variants[3].listing = structuredClone(project.listings[0]);
  const before = structuredClone(state), result = prepare(state);
  assert.equal(result.state.projects[0].listings.length, 5);
  assert.equal(result.state.projects[0].listingGroup.variants[3].listing.id, current.id);
  assertPreserved(before, result.state);
});

test("archived, corrected, cleaned, reset and discarded entries are retained as history, never reused", () => {
  for (const patch of [{ status: "archived" }, { inventoryCorrection: { active: true, correctedAt: at } },
    { managerCleanup: { removedAt: at } }, { rotationArchivedAt: at }, { listingResetAt: at },
    { refillDiscard: { cycleId: "canceled-cycle", at, reason: "discarded" } }]) {
    const state = fixture(), old = patchFourth(state, patch), before = structuredClone(state), result = prepare(state);
    assert.equal(result.preparedListings, 4);
    assert.equal(result.state.projects[0].listings.length, 5);
    assert.notEqual(result.state.projects[0].listingGroup.variants[3].listing.id, old.id);
    assertPreserved(before, result.state);
  }
});

test("published, transferred, in-flight and failed records cannot be counted as four fresh drafts or duplicated", () => {
  for (const status of ["published", "transferred_pending_import", "scheduled", "processing", "failed", "blocked"]) {
    const state = fixture(); patchFourth(state, { status });
    const before = structuredClone(state);
    assert.throws(() => prepare(state), /nicht als neuer Entwurf uploadbereit/u);
    assert.deepEqual(state, before);
  }
});

test("a prepared fourth entry is retained with its existing identity and remains upload eligible", () => {
  const state = fixture(), old = patchFourth(state, { status: "prepared" }), before = structuredClone(state), result = prepare(state);
  assert.equal(result.preparedListings, 4);
  assert.equal(createBatchUploadPlan(result.state, ["legacy-project"]).totalListings, 4);
  assert.equal(result.state.projects[0].listingGroup.variants[3].listing.id, old.id);
  assert.equal(result.state.projects[0].listings.length, 4);
  assertPreserved(before, result.state);
});
