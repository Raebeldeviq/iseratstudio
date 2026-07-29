import assert from "node:assert/strict";
import test from "node:test";

const {
  findAddressDuplicateGroups,
  normalizedPhysicalAddressKey,
} = await import("../app/lib/address-duplicates.ts");

function listing(id, uploadedAt) {
  return {
    id,
    externalId: `FPI-${id}`,
    templateId: "house",
    templateName: "Haus",
    price: 500000,
    texts: {
      title: "Titel",
      description: "Beschreibung",
      equipment: "Ausstattung",
      location: "Lage",
      other: "Sonstiges",
    },
    uploadedAt,
    version: 1,
  };
}

function project(id, overrides = {}) {
  return {
    id,
    owner: "fabian",
    name: `Projekt ${id}`,
    street: "Hauptstraße",
    houseNumber: "12a",
    zip: "14513",
    city: "Teltow",
    district: "",
    plotArea: 0,
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

test("uses the same physical-address normalization as the preflight check", () => {
  const abbreviated = project("short", {
    street: " Hauptstr. ",
    houseNumber: " 12 a ",
    zip: " 14513 ",
    city: "Teltow",
  });
  const writtenOut = project("long", {
    street: "Hauptstraße",
    houseNumber: "12a",
    zip: "14513",
    city: "Teltow ",
  });
  const rangeWithUnicodeDash = project("range-one", {
    houseNumber: "12–14",
  });
  const rangeWithAsciiDash = project("range-two", {
    houseNumber: "12-14",
  });

  assert.equal(
    normalizedPhysicalAddressKey(abbreviated),
    normalizedPhysicalAddressKey(writtenOut),
  );
  assert.equal(
    normalizedPhysicalAddressKey(rangeWithUnicodeDash),
    normalizedPhysicalAddressKey(rangeWithAsciiDash),
  );
});

test("returns only complete physical-address groups with at least two projects", () => {
  const duplicateOne = project("duplicate-one");
  const duplicateTwo = project("duplicate-two", { owner: "pascal" });
  const unique = project("unique", { houseNumber: "13" });
  const incomplete = project("incomplete", { houseNumber: "" });

  const groups = findAddressDuplicateGroups([
    duplicateOne,
    unique,
    incomplete,
    duplicateTwo,
  ]);

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].projectIds, ["duplicate-one", "duplicate-two"]);
  assert.equal(normalizedPhysicalAddressKey(incomplete), undefined);
});

test("recommends the more complete project before considering upload time", () => {
  const recentButSparse = project("recent", {
    lastTotalSyncAt: "2026-07-24T12:00:00.000Z",
  });
  const olderButComplete = project("complete", {
    plotArea: 700,
    plotPrice: 180000,
    district: "Ruhlsdorf",
    locationFacts: "Ruhige Wohnlage",
    lastTotalSyncAt: "2026-07-01T12:00:00.000Z",
  });

  const [group] = findAddressDuplicateGroups([
    recentButSparse,
    olderButComplete,
  ]);

  assert.equal(group.recommendedKeepId, "complete");
});

test("recommends the latest uploaded project when completeness is equal", () => {
  const older = project("older", {
    listings: [listing("older", "2026-07-10T09:00:00.000Z")],
  });
  const newer = project("newer", {
    listings: [listing("newer", "2026-07-20T09:00:00.000Z")],
  });

  const [group] = findAddressDuplicateGroups([older, newer]);

  assert.equal(group.recommendedKeepId, "newer");
});

test("produces stable group ids, ordering and recommendations regardless of input order", () => {
  const addressAOne = project("a-one", { city: "Berlin", zip: "10115" });
  const addressATwo = project("a-two", { city: "Berlin", zip: "10115" });
  const addressBOne = project("b-one", { houseNumber: "20" });
  const addressBTwo = project("b-two", { houseNumber: "20" });

  const forwards = findAddressDuplicateGroups([
    addressBTwo,
    addressAOne,
    addressBOne,
    addressATwo,
  ]);
  const backwards = findAddressDuplicateGroups([
    addressATwo,
    addressBOne,
    addressAOne,
    addressBTwo,
  ]);

  assert.deepEqual(forwards, backwards);
  assert.deepEqual(
    forwards.map((group) => group.recommendedKeepId),
    ["a-one", "b-one"],
  );
  assert.ok(forwards.every((group) => group.id === `address-duplicate:${group.addressKey}`));
});
