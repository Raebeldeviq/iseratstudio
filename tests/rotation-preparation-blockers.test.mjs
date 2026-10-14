import assert from "node:assert/strict";
import test from "node:test";
import { addressRotationPreparationIssue, addressRotationStatus } from "../address-rotation.mjs";
import { prepareProjectListings } from "../app/lib/listing-preparation.ts";
import { activeWorkingListingCount } from "../active-listings.mjs";
import { createInitialStudioState, createEmptyHouse } from "../studio-defaults.mjs";
import { normalizeHouseDistribution } from "../house-distribution.mjs";

const at = "2026-10-14T10:00:00.000Z", deletedAt = "2026-10-11T09:45:16.597Z";
const address = number => ({ street: "Fritz-Zubeil-Straße", houseNumber: number, postalCode: "14482", city: "Potsdam-Babelsberg" });

function fixture() {
  const state = createInitialStudioState();
  state.houses = Array.from({ length: 8 }, (_, i) => ({ ...createEmptyHouse(i + 1), id: `house-${i}`, name: `Haus ${i}`,
    approved: true, housePrice: 200000, livingArea: 140, rooms: 5,
    images: ["cover", "emotion", "floorplan_ground", "floorplan_upper", "awards", "trust", "qr"].map(role => ({ id: `${i}-${role}`,
      name: `${role}.jpg`, role, caption: role, mimeType: "image/jpeg", dataUrl: "data:image/jpeg;base64,YQ==", isFloorplan: role.startsWith("floorplan") })) }));
  const project = { ...state.projects[0], id: "fritz-project", plotId: "fritz-plot", name: "Fritz-Zubeil-Straße 23A",
    street: address("23A").street, houseNumber: "23A", zip: "14482", city: "Potsdam-Babelsberg", plotArea: 531, plotPrice: 298000,
    listings: [], listingGroup: { variants: [], listingControls: [] } };
  const numbers = ["30460-002007", "30460-003007", "30460-004007", "30460-005001"];
  project.listings = numbers.map((externalId, i) => ({ id: `confirmed-${i}`, externalId, templateId: `house-${i}`, status: "deleted",
    transferredAt: "2026-09-30T12:00:00.000Z", deletedAt, deleteConfirmedAt: deletedAt, managerCleanup: { removedAt: at } }));
  const duplicates = Array.from({ length: 4 }, (_, i) => ({ id: `duplicate-${i}`, externalId: `30460-00301${i + 5}`,
    templateId: `house-${i}`, status: "transferred_pending_import", transferredAt: "2026-10-01T12:00:00.000Z",
    inventoryCorrection: { active: true, correctedAt: deletedAt }, managerCleanup: { removedAt: at } }));
  project.listings.push(...duplicates);
  state.projects = [project];
  state.plots = [{ id: "fritz-plot", ...address("23"), plotSizeSqm: 531, purchasePrice: 298000,
    addressRotation: { poolA: address("23"), poolB: address("25"), currentPool: "", cycle: 0, listingIds: [] } }];
  state.deleteBatches = [{ id: "old-batch", entries: project.listings.map(l => ({ projectId: project.id, listingId: l.id,
    externalId: l.externalId, status: l.status === "deleted" ? "deleted" : "active", deletedAt: l.deletedAt || "" })) }];
  project.listingGroup.listingControls = project.listings.filter(l => l.status === "deleted").map(l => ({ listingId: l.id,
    status: "deleted", manualLock: true, automaticUpdateEnabled: false, updateMode: "blocked", lockReason: "", lockedUntil: "" }));
  state.listingResetHistory = [{ id: "reset", projectId: project.id, plotId: project.plotId,
    listings: duplicates.map((l, i) => ({ ...l, id: `archive-${i}`, externalId: `30460-00100${i + 1}` })) }];
  state.smartRefill = { credits: numbers.map((externalId, i) => ({ id: `credit-${i}`, projectId: project.id, listingId: `confirmed-${i}`, externalId, deletedAt })),
    cycles: [], cancellations: [], poolApprovals: [] };
  state.uploadHistory = project.listings.map(l => ({ listingId: l.id, projectId: project.id, externalId: l.externalId, address: "Fritz-Zubeil-Straße 23A" }));
  state.houseDistribution = normalizeHouseDistribution({}, state.houses, state.projects);
  state.houseDistribution.projects.find(record => record.projectId === project.id).previewHouseIds = state.houses.slice(0, 4).map(house => house.id);
  return state;
}

function generate(state) {
  return prepareProjectListings(state, [state.projects[0].id], state.houseDistribution, p => p, { now: at });
}

test("Fritz: confirmed deletions and corrected duplicates leave zero working listings and allow a fresh pool-A cycle", () => {
  const state = fixture(), before = structuredClone(state), original = state.projects[0].listings;
  assert.equal(activeWorkingListingCount(state.projects[0]), 0);
  assert.equal(addressRotationPreparationIssue(state, "fritz-plot"), "");
  const prepared = generate(state), project = prepared.state.projects[0];
  const added = project.listings.filter(l => !original.some(old => old.id === l.id));
  assert.equal(added.length, 4); assert.equal(new Set(added.map(l => l.templateId)).size, 4);
  assert.equal(new Set(added.map(l => l.externalId)).size, 4);
  assert.ok(added.every(l => /^30460-\d{6}$/u.test(l.externalId) && l.addressSnapshot.plotId === "fritz-plot"
    && l.addressSnapshot.pool === "A" && l.addressSnapshot.address.houseNumber === "23"));
  for (const listing of original) assert.deepEqual(project.listings.find(l => l.id === listing.id), listing);
  for (const key of ["smartRefill", "uploadHistory", "listingResetHistory"]) assert.deepEqual(prepared.state[key], state[key]);
  assert.deepEqual(state, before);
});

test("same street and similar number at another plotId never block or merge the Fritz plot", () => {
  const state = fixture();
  state.projects.push({ id: "other-project", plotId: "other-plot", name: "Fritz-Zubeil-Straße 23A",
    listings: [{ id: "active-other", externalId: "30460-009001", status: "published", transferredAt: at }] });
  assert.equal(addressRotationPreparationIssue(state, "fritz-plot"), "");
  state.projects[1].plotId = "fritz-plot";
  assert.match(addressRotationPreparationIssue(state, "fritz-plot"), /1 aktive.*30460-009001/u);
});

test("a live portal entry in the reset archive still blocks, but a confirmed closed archive entry does not", () => {
  const state = fixture(), listing = state.listingResetHistory[0].listings[0];
  delete listing.inventoryCorrection; delete listing.managerCleanup;
  assert.match(addressRotationPreparationIssue(state, "fritz-plot"), /30460-001001/u);
  Object.assign(listing, { status: "archived", deletedAt, deleteConfirmedAt: deletedAt });
  state.deleteReports = [{ projectId: "fritz-project", plotId: "fritz-plot", sourceListingId: listing.id,
    externalObjectNumber: listing.externalId, result: "success", processedAt: deletedAt }];
  assert.equal(addressRotationPreparationIssue(state, "fritz-plot"), "");
  state.deleteReports[0].plotId = "other-plot";
  assert.match(addressRotationPreparationIssue(state, "fritz-plot"), /30460-001001/u);
});

test("cleanup alone never substitutes for a missing or contradictory deletion confirmation", () => {
  for (const mutate of [s => { s.projects[0].listings[0].deletedAt = ""; },
    s => { s.deleteBatches[0].entries[0].status = "active"; }, s => { s.projects[0].listings[0].externalDeletionPending = true; }]) {
    const state = fixture(); mutate(state);
    assert.notEqual(addressRotationPreparationIssue(state, "fritz-plot"), "");
    assert.throws(() => generate(state));
  }
  const state = fixture(); state.projects[0].listingGroup.listingControls = [];
  delete state.projects[0].listings[0].transferredAt;
  state.deleteBatches[0].entries = state.deleteBatches[0].entries.filter(e => e.listingId !== "confirmed-0");
  assert.match(addressRotationPreparationIssue(state, "fritz-plot"), /Löschbestätigung.*30460-002007/u);
});

test("premium, genuine manual protection, active uploads and pending copies stay protected even on hidden listings", () => {
  const patches = [{ premiumPlacement: true }, { manualLock: true, lockReason: "Nicht löschen" }, { lockedUntil: "2099-01-01T00:00:00Z" },
    { processLease: { startedAt: at } }, { pendingRotationJobId: "pending-job" }, { pendingRotationListingId: "pending-copy" }, { status: "processing" }];
  for (const patch of patches) {
    const state = fixture(); Object.assign(state.projects[0].listingGroup.listingControls[0], patch);
    assert.notEqual(addressRotationPreparationIssue(state, "fritz-plot"), "");
    assert.throws(() => generate(state));
  }
  for (const status of ["uploading", "queued", "processing", "scheduled"]) {
    const state = fixture(); state.projects[0].listings[4].status = status;
    assert.match(addressRotationPreparationIssue(state, "fritz-plot"), /aktiver Vorgang/u);
  }
});

test("a valid refill reservation and an orphaned reserved listing remain blocked; canceled reservations do not", () => {
  const state = fixture(), project = state.projects[0];
  const listing = { id: "reserved", externalId: "30460-008001", status: "draft" }; project.listings.push(listing);
  state.smartRefill.cycles = [{ id: "reserved-cycle", plotId: "fritz-plot", projectId: project.id, listingIds: [listing.id], creditIds: ["credit-0"] }];
  assert.match(addressRotationPreparationIssue(state, "fritz-plot"), /Nachschubreservierung/u);
  Object.assign(listing, { status: "archived", refillDiscard: { cycleId: "reserved-cycle" }, managerCleanup: { removedAt: at } });
  assert.match(addressRotationPreparationIssue(state, "fritz-plot"), /Nachschubreservierung/u);
  state.smartRefill.cancellations.push({ cycleId: "reserved-cycle" });
  assert.equal(addressRotationPreparationIssue(state, "fritz-plot"), "");
  state.smartRefill.cancellations = []; project.listings.pop();
  assert.match(addressRotationPreparationIssue(state, "fritz-plot"), /Nachschubreservierung/u);
});

test("Rothen: a discarded four-listing cycle is not an active blocker; the actual missing pool is explained", () => {
  const state = fixture(), project = state.projects[0], plot = state.plots[0];
  plot.street = "Rothenbücherweg"; plot.houseNumber = "58";
  const ids = ["discard-1", "discard-2", "discard-3", "discard-4"];
  project.listings = ids.map((id, i) => ({ id, externalId: `30460-01000${i + 1}`, status: "archived",
    refillDiscard: { cycleId: "discarded" }, managerCleanup: { removedAt: at, source: "discarded-refill" } }));
  project.listingGroup = { variants: [], listingControls: [] }; state.listingResetHistory = []; state.deleteBatches = [];
  state.smartRefill.cycles = [{ id: "discarded", plotId: plot.id, listingIds: ids, creditIds: ["credit-0", "credit-1", "credit-2", "credit-3"] }];
  state.smartRefill.cancellations = [{ cycleId: "discarded" }];
  assert.equal(addressRotationPreparationIssue(state, plot.id), "");
  plot.addressRotation.poolB = null;
  assert.equal(addressRotationStatus(state, plot.id).state, "incomplete");
  const issue = addressRotationPreparationIssue(state, plot.id);
  assert.match(issue, /Rothenbücherweg 58.*Pool B fehlt/u); assert.doesNotMatch(issue, /0\/4/u);
  assert.throws(() => generate(state), /Pool B fehlt/u);
  assert.equal(plot.addressRotation.poolB, null);
});

test("complete pools are validated field by field, with no invented fallback addresses", () => {
  for (const pool of ["poolA", "poolB"]) for (const field of ["street", "houseNumber", "postalCode", "city"]) {
    const state = fixture(); state.plots[0].addressRotation[pool][field] = "";
    assert.equal(addressRotationStatus(state, "fritz-plot").state, "incomplete");
    assert.match(addressRotationPreparationIssue(state, "fritz-plot"), /unvollständig/u);
  }
  const state = fixture(); state.plots[0].addressRotation.poolBDetails = { status: "POOL_B_PRÜFEN" };
  assert.match(addressRotationPreparationIssue(state, "fritz-plot"), /offenen Prüffall/u);
});

test("an empty numerator is not proof that an established cycle is complete", () => {
  const state = fixture(); Object.assign(state.plots[0].addressRotation, { currentPool: "A", cycle: 1, listingIds: [] });
  assert.match(addressRotationPreparationIssue(state, "fritz-plot"), /Rotationszyklus unvollständig/u);
});

test("a confirmed closed four-listing cycle can advance despite later inventory correction or manager cleanup", () => {
  const state = fixture(), old = state.projects[0].listings.slice(0, 4);
  Object.assign(state.plots[0].addressRotation, { currentPool: "A", cycle: 1, listingIds: old.map(l => l.id) });
  old[0].inventoryCorrection = { active: true };
  assert.equal(addressRotationStatus(state, "fritz-plot").state, "ready");
  assert.equal(addressRotationPreparationIssue(state, "fritz-plot"), "");
  const prepared = generate(state), added = prepared.state.projects[0].listings.filter(l => !state.projects[0].listings.some(old => old.id === l.id));
  assert.ok(added.every(l => l.addressSnapshot.pool === "B" && l.addressSnapshot.address.houseNumber === "25"));
  assert.deepEqual(prepared.state.smartRefill, state.smartRefill);
});

test("a mismatching listing snapshot requires review instead of treating two plotIds as equal", () => {
  const state = fixture(); state.projects[0].listings[0].addressSnapshot = { plotId: "other-plot" };
  assert.match(addressRotationPreparationIssue(state, "fritz-plot"), /Grundstückszuordnung.*uneindeutig/u);
});
