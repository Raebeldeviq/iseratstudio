import assert from "node:assert/strict";
import test from "node:test";
import { allocateDeleteBatchNumber, addCalendarDays, assertDeleteBatchUploadReady, confirmDeleteBatch, deleteBatchTrafficLight, linkDeleteBatchListings, replanDeleteBatchesForUpload } from "../delete-batches.mjs";
import { isHvObjectNumber } from "../object-number-sequence.mjs";

function empty() { return { projects: [], deleteBatches: [] }; }
function allocate(state, projectId, housePosition, uploadDate, listingId = "") {
  return allocateDeleteBatchNumber(state, { projectId, housePosition, uploadDate, listingId });
}

test("four houses of one address receive four consecutive deletion days and batches", () => {
  let state = empty();
  const numbers = [];
  for (let position = 1; position <= 4; position += 1) {
    const result = allocate(state, "address-a", position, "2026-09-29", `a-${position}`);
    state = result.state;
    numbers.push(result.externalId);
  }
  assert.deepEqual(numbers, ["30460-001001", "30460-002001", "30460-003001", "30460-004001"]);
  assert.deepEqual(state.deleteBatches.map((batch) => batch.plannedDeletionDate), ["2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"]);
  for (const number of numbers) assert.equal(isHvObjectNumber(number), true);
  const second = allocate(state, "address-b", 1, "2026-09-30", "b-1");
  assert.equal(second.externalId, "30460-002002");
  assert.equal(second.state.deleteBatches.length, 4);
});

test("batch 999 and index 999 wrap to cycle two while history stays unique", () => {
  const entries = Array.from({ length: 998 }, (_, index) => ({ index: index + 1, externalId: `30460-999${String(index + 1).padStart(3, "0")}`, status: "deleted" }));
  const state = { ...empty(), deleteBatches: [{ id: "delete-batch:1:999", cycle: 1, number: 999, plannedDeletionDate: "2026-10-08", entries, completedAt: "" }] };
  const last = allocate(state, "a", 1, "2026-09-29", "last");
  assert.equal(last.externalId, "30460-999999");
  const first = allocate(last.state, "b", 2, "2026-09-29", "first");
  assert.equal(first.externalId, "30460-001001");
  assert.equal(first.cycle, 2);
  assert.notEqual(first.batchId, last.batchId);
});

test("old active special numbers are never interpreted as batch entries or reused", () => {
  const state = { ...empty(), projects: [{ id: "old", listings: [{ id: "canary", externalId: "30460-900001", status: "published" }] }], deleteBatches: [{ id: "delete-batch:1:899", cycle: 1, number: 899, plannedDeletionDate: "2026-10-07", entries: [], completedAt: "" }] };
  const result = allocate(state, "new", 1, "2026-09-29", "new-1");
  assert.equal(result.externalId, "30460-900002");
  assert.equal(result.state.projects[0].listings[0].externalId, "30460-900001");
});

test("traffic light and manual confirmation use explicit batch records only", () => {
  let state = empty();
  for (const [index, uploadDate] of ["2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28"].entries()) {
    const result = allocate(state, `p-${index}`, 1, uploadDate, `listing-${index}`);
    state = result.state;
    const listing = { id: `listing-${index}`, externalId: result.externalId, status: "transferred_pending_import", transferredAt: `${uploadDate}T10:00:00Z` };
    state.projects.push({ id: `p-${index}`, listings: [listing], listingGroup: { variants: [{ listing }], listingControls: [{ listingId: listing.id, status: "published", automaticUpdateEnabled: true }] } });
  }
  state = linkDeleteBatchListings(state);
  const view = deleteBatchTrafficLight(state, "2026-10-05");
  assert.deepEqual(view.map((batch) => batch.signal), ["red", "red", "yellow", "green"]);
  const confirmed = confirmDeleteBatch(state, view[0].id, "2026-10-05T11:00:00Z");
  assert.equal(confirmed.deletedCount, 1);
  assert.equal(confirmed.state.projects[0].listings[0].status, "deleted");
  assert.equal(confirmed.state.projects[0].listings[0].deletedAt, "2026-10-05T11:00:00Z");
  assert.equal(confirmed.state.projects[0].listingGroup.variants[0].listing.status, "deleted");
  assert.equal(confirmed.state.projects[0].listingGroup.listingControls[0].automaticUpdateEnabled, false);
  assert.equal(confirmed.state.deleteBatches[0].completedAt, "2026-10-05T11:00:00Z");
  assert.equal(deleteBatchTrafficLight(confirmed.state, "2026-10-05").find((batch) => batch.id === view[0].id).signal, "gray");
  assert.equal(state.projects[0].listings[0].status, "transferred_pending_import");
});

test("untransferred draft can be re-planned for actual upload date without changing old listings", () => {
  const first = allocate(empty(), "new", 1, "2026-09-29", "new-1");
  const old = { id: "old", externalId: "30460-41", status: "published" };
  const draft = { id: "new-1", externalId: first.externalId, status: "draft" };
  const state = { ...first.state, projects: [{ id: "new", listings: [draft, old], listingGroup: { variants: [{ listing: draft }] } }] };
  const revised = replanDeleteBatchesForUpload(state, ["new-1"], "2026-09-30");
  assert.equal(revised.projects[0].listings[0].externalId, "30460-002001");
  assert.equal(revised.projects[0].listings[1].externalId, "30460-41");
  assert.equal(revised.deleteBatches[0].entries[0].status, "void");
  assert.equal(addCalendarDays("2026-09-30", 9), "2026-10-09");
  assert.throws(() => assertDeleteBatchUploadReady(state, draft, "2026-09-30"), /passt nicht zum heutigen Uploadtag/u);
  assert.doesNotThrow(() => assertDeleteBatchUploadReady(revised, revised.projects[0].listings[0], "2026-09-30"));
  assert.doesNotThrow(() => assertDeleteBatchUploadReady(state, old, "2026-09-30"));
});
