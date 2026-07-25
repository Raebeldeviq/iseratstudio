import assert from "node:assert/strict";
import test from "node:test";

import { auditStudioState, cleanupStudioState, STUDIO_DATA_SCHEMA_VERSION } from "../data-integrity.mjs";
import { WORKFLOW_STATUS } from "../workflow-status.mjs";

function fixture() {
  const listing = { id: "listing-1", externalId: "FPI-1", templateId: "house-1", uploadStatus: "Upload erfolgreich" };
  const control = { listingId: "listing-1", status: "Entwurf wartet auf Upload", processLease: { token: "old", startedAt: "2026-07-20T00:00:00.000Z" } };
  return {
    version: 1,
    houses: [{ id: "house-1", name: "SUN 113", houseType: "Einfamilienhaus", livingArea: 106.15, rooms: 4, housePrice: 355122 }],
    projects: [{
      id: "project-1", street: "Weg", houseNumber: "1", zip: "12345", city: "Ort", notes: "Altwert",
      selectedHouseIds: ["house-1"], listings: [listing, { ...listing }],
      listingGroup: {
        listingControls: [control, { ...control }],
        logs: [{ id: "log-1", processStatus: "Kopie vorbereitet" }, { id: "log-1", processStatus: "Kopie vorbereitet" }],
        lastStatus: "Kopie vorbereitet",
        processLease: null,
      },
    }],
    promotionImages: [],
    promotionUsage: [],
    uploadHistory: [],
    scheduler: { runs: [], lastStatus: "Noch nicht ausgeführt" },
  };
}

test("dry run reports legacy data without modifying the state", () => {
  const state = fixture();
  const result = cleanupStudioState(state, { apply: false, now: "2026-07-25T12:00:00.000Z" });
  assert.equal(result.changed, false);
  assert.equal(result.state, state);
  assert.equal(result.report.before.findings.find((entry) => entry.code === "legacy-project-notes").count, 1);
});

test("safe cleanup is idempotent and migrates canonical statuses", () => {
  const first = cleanupStudioState(fixture(), { apply: true, now: "2026-07-25T12:00:00.000Z" });
  assert.equal(first.changed, true);
  assert.equal(first.state.dataSchemaVersion, STUDIO_DATA_SCHEMA_VERSION);
  assert.equal("notes" in first.state.projects[0], false);
  assert.equal(first.state.projects[0].listings.length, 1);
  assert.equal(first.state.projects[0].listings[0].status, WORKFLOW_STATUS.PUBLISHED);
  assert.equal("uploadStatus" in first.state.projects[0].listings[0], false);
  assert.equal(first.state.projects[0].listingGroup.listingControls.length, 1);
  assert.equal(first.state.projects[0].listingGroup.listingControls[0].status, WORKFLOW_STATUS.PREPARED);
  assert.equal(first.state.projects[0].listingGroup.listingControls[0].processLease, null);
  assert.equal("processLease" in first.state.projects[0].listingGroup, false);
  const second = cleanupStudioState(first.state, { apply: true, now: "2026-07-25T12:00:00.000Z" });
  assert.equal(second.changed, false);
});

test("audit marks conflicting productive duplicates for review instead of deleting them", () => {
  const state = fixture();
  state.projects.push({ ...state.projects[0], name: "Andere Fassung" });
  const report = auditStudioState(state, { now: "2026-07-25T12:00:00.000Z" });
  assert.equal(report.findings.find((entry) => entry.code === "duplicate-project-id").action, "review");
  const cleaned = cleanupStudioState(state, { apply: true, now: "2026-07-25T12:00:00.000Z" });
  assert.equal(cleaned.state.projects.length, 2);
});

test("cleanup preserves referenced variant controls and removes only truly stale controls", () => {
  const state = fixture();
  const project = state.projects[0];
  project.listingGroup.variants = Array.from({ length: 5 }, (_, index) => ({
    id: `variant-${index + 1}`,
    active: true,
    templateId: `house-${index + 1}`,
    listing: { id: `variant-listing-${index + 1}` },
  }));
  project.listingGroup.listingControls.push(
    { listingId: "variant-listing-1", status: "active" },
    { listingId: "stale-listing", status: "active" },
  );
  const dryRun = auditStudioState(state, { now: "2026-07-25T12:00:00.000Z" });
  assert.equal(dryRun.findings.find((entry) => entry.code === "variant-only-control-listing").count, 1);
  assert.equal(dryRun.findings.find((entry) => entry.code === "stale-control-listing").count, 1);
  const cleaned = cleanupStudioState(state, { apply: true, now: "2026-07-25T12:00:00.000Z" });
  assert.equal(cleaned.state.projects[0].listingGroup.listingControls.some((control) => control.listingId === "variant-listing-1"), true);
  assert.equal(cleaned.state.projects[0].listingGroup.listingControls.some((control) => control.listingId === "stale-listing"), false);
  assert.equal(cleaned.state.projects[0].listingGroup.variants.filter((variant) => variant.active).length, 4);
});

test("cleanup enforces one current promotion assignment without deleting usage history", () => {
  const state = fixture();
  state.projects[0].listings = [
    { id: "listing-1", templateId: "house-1", promotionImageId: "promo-a", promotionAssignedAt: "2026-07-23T08:00:00.000Z" },
    { id: "listing-2", templateId: "house-1", promotionImageId: "promo-b", promotionAssignedAt: "2026-07-24T08:00:00.000Z" },
  ];
  state.projects[0].listingGroup.listingControls = [];
  state.promotionUsage = [{ id: "usage-1", projectId: "project-1", listingId: "listing-1", imageId: "promo-a" }];
  const cleaned = cleanupStudioState(state, { apply: true, now: "2026-07-25T12:00:00.000Z" });
  const assigned = cleaned.state.projects[0].listings.filter((listing) => listing.promotionImageId);
  assert.equal(assigned.length, 1);
  assert.equal(assigned[0].id, "listing-2");
  assert.equal(cleaned.state.promotionUsage.length, 1);
});
