import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRenewalSchedule,
  classifyRenewal,
  formatRenewalDate,
  renewalAnchor,
} from "../app/lib/renewal-schedule.ts";

function project(id, overrides = {}) {
  return {
    id,
    owner: "fabian",
    name: id,
    street: "Musterweg",
    houseNumber: "1",
    zip: "12345",
    city: "Musterort",
    district: "",
    plotArea: 500,
    plotPrice: 0,
    additionalCosts: 0,
    locationFacts: "",
    transportFacts: "",
    familyFacts: "",
    natureFacts: "",
    notes: "",
    selectedHouseIds: [],
    listings: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("marks an address without a reliable upload date as due today", () => {
  const entry = classifyRenewal(
    project("unknown"),
    new Date("2026-07-24T10:00:00.000Z"),
  );
  assert.equal(entry.status, "today");
  assert.equal(entry.untracked, true);
  assert.equal(entry.dueDate, undefined);
  assert.deepEqual(renewalAnchor(entry.project), { source: "unknown" });
});

test("classifies Berlin calendar days across the daylight-saving change", () => {
  const source = project("dst", {
    lastRenewedAt: "2026-03-22T11:30:00.000Z",
  });
  const dueToday = classifyRenewal(
    source,
    new Date("2026-03-29T06:00:00.000Z"),
  );
  const overdue = classifyRenewal(
    source,
    new Date("2026-03-30T06:00:00.000Z"),
  );
  assert.equal(dueToday.status, "today");
  assert.equal(dueToday.dueDate, "2026-03-29");
  assert.equal(overdue.status, "overdue");
});

test("uses the earliest upload only when all four current listings were transferred", () => {
  const listings = [0, 1, 2, 3].map((index) => ({
    id: `listing-${index}`,
    externalId: `FPI-${index}`,
    templateId: `house-${index}`,
    templateName: `House ${index}`,
    price: 0,
    texts: {
      title: "",
      description: "",
      equipment: "",
      location: "",
      other: "",
    },
    version: 1,
    uploadedAt: `2026-07-2${index + 1}T10:00:00.000Z`,
  }));
  const anchor = renewalAnchor(project("complete", { listings }));
  assert.equal(anchor.source, "complete-listing-upload");
  assert.equal(anchor.at, "2026-07-21T10:00:00.000Z");

  listings[3] = { ...listings[3], uploadedAt: undefined };
  assert.deepEqual(
    renewalAnchor(project("partial", { listings })),
    { source: "unknown" },
  );
});

test("filters the schedule by Fabian and Pascal and sorts urgent rows first", () => {
  const schedule = buildRenewalSchedule([
    project("future", {
      lastRenewedAt: "2026-07-23T10:00:00.000Z",
    }),
    project("old", {
      lastRenewedAt: "2026-07-10T10:00:00.000Z",
    }),
    project("pascal", {
      owner: "pascal",
      lastRenewedAt: "2026-07-17T10:00:00.000Z",
    }),
  ], new Date("2026-07-24T10:00:00.000Z"), "fabian");

  assert.deepEqual(schedule.map((entry) => entry.project.id), ["old", "future"]);
  assert.equal(schedule[0].status, "overdue");
  assert.equal(schedule[1].status, "upcoming");
  assert.equal(formatRenewalDate(schedule[1].dueDate), "30.07.2026");
});
