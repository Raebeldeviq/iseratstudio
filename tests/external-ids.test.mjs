import assert from "node:assert/strict";
import test from "node:test";

import {
  allocateProviderExternalIds,
  isProviderExternalId,
  migrateDraftExternalIds,
  normalizeProviderNumber,
} from "../app/lib/external-ids.ts";

function listing(id, externalId, patch = {}) {
  return {
    id,
    externalId,
    templateId: `house-${id}`,
    templateName: `Haus ${id}`,
    price: 0,
    texts: {
      title: "",
      description: "",
      equipment: "",
      location: "",
      other: "",
    },
    version: 1,
    ...patch,
  };
}

function project(listings) {
  return {
    id: "project-one",
    owner: "fabian",
    name: "Projekt",
    street: "Musterweg",
    houseNumber: "1",
    zip: "12345",
    city: "Musterstadt",
    district: "",
    plotArea: 500,
    plotPrice: 150000,
    additionalCosts: 0,
    locationFacts: "",
    transportFacts: "",
    familyFacts: "",
    natureFacts: "",
    notes: "",
    selectedHouseIds: [],
    listings,
    createdAt: "2026-07-28T00:00:00.000Z",
  };
}

test("normalizes the HV/provider number used as the object-id prefix", () => {
  assert.equal(normalizeProviderNumber(" 30435 "), "30435");
  assert.equal(isProviderExternalId("30435-13226", "30435"), true);
  assert.equal(isProviderExternalId("FPI-PROJECT-1", "30435"), false);
});

test("allocates consecutive unique object ids after the reserved example", () => {
  assert.deepEqual(
    allocateProviderExternalIds("30435", [], 3),
    ["30435-13226", "30435-13227", "30435-13228"],
  );
});

test("continues after the highest historical object id", () => {
  assert.deepEqual(
    allocateProviderExternalIds(
      "30435",
      ["30435-13226", "30435-14001", "99999-90000"],
      2,
    ),
    ["30435-14002", "30435-14003"],
  );
});

test("migrates only safe drafts and preserves uploaded or resumable listings", () => {
  const projects = [project([
    listing("draft-old", "FPI-OLD-1"),
    listing("draft-correct", "30435-14001"),
    listing("uploaded", "FPI-UPLOADED", {
      uploadedAt: "2026-07-27T10:00:00.000Z",
    }),
    listing("active-run", "FPI-T-RUN-1", {
      totalSyncRunId: "run-one",
    }),
  ])];

  const migrated = migrateDraftExternalIds(
    projects,
    "30435",
    ["30435-14500"],
  );

  assert.equal(migrated.changedCount, 1);
  assert.deepEqual(
    migrated.projects[0].listings.map((item) => item.externalId),
    ["30435-14501", "30435-14001", "FPI-UPLOADED", "FPI-T-RUN-1"],
  );
  assert.equal(projects[0].listings[0].externalId, "FPI-OLD-1");
});
