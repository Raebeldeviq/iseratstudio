import assert from "node:assert/strict";
import test from "node:test";
import { addressRotationStatus, mergeAddressPools, parseAddressPoolRows, snapshotAddressRotation } from "../address-rotation.mjs";
import { allocateDeleteBatchNumber, linkDeleteBatchListings, replanDeleteBatchesForUpload } from "../delete-batches.mjs";

const a = { street: "Hauptstraße", houseNumber: "12", postalCode: "12345", city: "Berlin" };
const b = { street: "Hauptstraße", houseNumber: "14", postalCode: "12345", city: "Berlin" };
const headers = ["plotId", "Straße", "Hausnummer", "PLZ", "Ort"];
const row = (id, address) => [id, address.street, address.houseNumber, address.postalCode, address.city];

function fixture() {
  const listings = Array.from({ length: 4 }, (_, index) => ({ id: `listing-${index + 1}`, externalId: `30460-00100${index + 1}`, status: "uploaded" }));
  return {
    plots: [{ id: "GS-001", addressRotation: { poolA: a, poolB: b, currentPool: "A", cycle: 1,
      listingIds: listings.map((listing) => listing.id), lastUsedA: "2026-09-01", lastUsedB: "" } }],
    projects: [{ id: "project-1", plotId: "GS-001", listings, listingGroup: { listingControls: [] } }],
    deleteBatches: [{ id: "delete-batch:1:1", number: 1, cycle: 1, entries: listings.map((listing, index) => ({
      batchId: "delete-batch:1:1", listingId: listing.id, projectId: "project-1", externalId: listing.externalId,
      index: index + 1, housePosition: index + 1, status: "active", uploadDate: "2026-09-01",
      plannedDeletionDate: "2026-09-10", deletedAt: "",
    })) }],
  };
}

test("Master import links only equal plotIds and never guesses a missing pool", () => {
  const poolA = parseAddressPoolRows([headers, row("GS-001", a), row("GS-002", a)], "A");
  const poolB = parseAddressPoolRows([headers, row("GS-001", b)], "B");
  const plots = mergeAddressPools([{ id: "GS-001" }, { id: "GS-002" }], poolA, poolB);
  assert.deepEqual(plots[0].addressRotation.poolA, a);
  assert.deepEqual(plots[0].addressRotation.poolB, b);
  assert.equal(plots[1].addressRotation.poolB, null);
  assert.equal(addressRotationStatus({ plots, projects: [] }, "GS-002").state, "incomplete");
  assert.throws(() => mergeAddressPools(plots, poolA, [{ ...poolB[0], plotId: "GS-003" }]), /unbekannt/u);
  assert.throws(() => parseAddressPoolRows([headers, row("GS-001", a), row("GS-001", b)], "A"), /mehrfach/u);
});

test("A to B needs four confirmed deletions; B to A works across cycles", () => {
  const state = fixture();
  assert.equal(addressRotationStatus(state, "GS-001").remaining, 4);
  state.deleteBatches[0].entries.slice(0, 3).forEach((entry) => { entry.status = "deleted"; });
  assert.equal(addressRotationStatus(state, "GS-001").remaining, 1);
  assert.equal(addressRotationStatus(state, "GS-001").state, "active");
  state.deleteBatches[0].entries[3].status = "deleted";
  assert.deepEqual([addressRotationStatus(state, "GS-001").state, addressRotationStatus(state, "GS-001").nextPool], ["ready", "B"]);
  state.plots[0].addressRotation = { ...state.plots[0].addressRotation, currentPool: "B", cycle: 2 };
  assert.equal(addressRotationStatus(state, "GS-001").nextPool, "A");
  state.plots[0].addressRotation.cycle = 3;
  state.plots[0].addressRotation.currentPool = "A";
  assert.equal(addressRotationStatus(state, "GS-001").nextPool, "B");
});

test("premium and deletion lock keep active entries from completing a cycle", () => {
  const state = fixture();
  state.projects[0].listingGroup.listingControls = [
    { listingId: "listing-1", premiumPlacement: true },
    { listingId: "listing-2", manualLock: true },
  ];
  state.deleteBatches[0].entries.slice(2).forEach((entry) => { entry.status = "deleted"; });
  assert.equal(addressRotationStatus(state, "GS-001").remaining, 2);
  assert.equal(addressRotationStatus(state, "GS-001").state, "active");
});

test("new cycle stores immutable address and fresh batch numbers", () => {
  const state = fixture();
  state.deleteBatches[0].entries.forEach((entry) => { entry.status = "deleted"; });
  state.projects[0].listings.forEach((listing) => { listing.status = "deleted"; });
  const originalAddress = structuredClone(state.plots[0].addressRotation.poolA);
  const originalPoolB = structuredClone(state.plots[0].addressRotation.poolB);
  let next = state;
  const newListings = [];
  for (let position = 1; position <= 4; position += 1) {
    const id = `cycle2-${position}`;
    const allocated = allocateDeleteBatchNumber(next, { projectId: "project-1", listingId: id,
      housePosition: position, uploadDate: "2026-09-20" });
    next = allocated.state;
    newListings.push({ id, externalId: allocated.externalId, status: "draft" });
  }
  next.projects[0].listings.push(...newListings);
  next = linkDeleteBatchListings(next);
  const snapshot = snapshotAddressRotation(next, "GS-001", newListings, "2026-09-20T12:00:00Z");
  assert.equal(snapshot.pool, "B");
  assert.equal(snapshot.cycle, 2);
  assert.deepEqual(snapshot.listings.map((listing) => listing.addressSnapshot.housePosition), [1, 2, 3, 4]);
  assert.deepEqual(snapshot.listings.map((listing) => listing.addressSnapshot.address), [b, b, b, b]);
  assert.equal(new Set(snapshot.listings.map((listing) => listing.externalId)).size, 4);
  assert.ok(snapshot.listings.every((listing) => !state.projects[0].listings.slice(0, 4).some((old) => old.externalId === listing.externalId)));
  next.plots[0].addressRotation.poolB.street = "Andere Straße";
  assert.deepEqual(snapshot.listings[0].addressSnapshot.address, originalPoolB);
  assert.deepEqual(originalAddress, a);
  next.projects[0].listings = [...next.projects[0].listings.slice(0, 4), ...snapshot.listings];
  const replanned = replanDeleteBatchesForUpload(next, [snapshot.listings[0].id], "2026-09-21");
  const changed = replanned.projects[0].listings.find((listing) => listing.id === snapshot.listings[0].id);
  assert.equal(changed.addressSnapshot.plannedDeletionDate, "2026-09-30");
  assert.notEqual(changed.externalId, snapshot.listings[0].externalId);
});
