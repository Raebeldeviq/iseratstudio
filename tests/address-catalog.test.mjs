import assert from "node:assert/strict";
import test from "node:test";

import {
  addressCatalogCities,
  addressProjectIsComplete,
  filterAddressProjects,
  missingAddressFields,
  paginateAddressProjects,
  projectLastUploadAt,
} from "../app/lib/address-catalog.ts";
import { projectIsReadyForTotalSync } from "../app/lib/total-sync.ts";

function project(id, overrides = {}) {
  return {
    id,
    owner: "fabian",
    name: id,
    street: "Musterweg",
    houseNumber: "1",
    zip: "14513",
    city: "Teltow",
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
    listings: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const defaultFilters = {
  query: "",
  city: "",
  zip: "",
  owner: "all",
  completeness: "all",
  upload: "all",
  sort: "city",
};

test("uses the most recent reliable project upload timestamp", () => {
  const item = project("upload", {
    lastRenewedAt: "2026-07-10T08:00:00.000Z",
    lastTotalSyncAt: "2026-07-12T08:00:00.000Z",
    listings: [{ uploadedAt: "2026-07-15T08:00:00.000Z" }],
    renewalHistory: [{ completedAt: "2026-07-14T08:00:00.000Z" }],
  });

  assert.equal(projectLastUploadAt(item), "2026-07-15T08:00:00.000Z");
  assert.equal(projectLastUploadAt(project("never")), undefined);
});

test("defines completeness like the upload workflow", () => {
  const samples = [
    project("complete"),
    project("no-street", { street: "" }),
    project("no-area", { plotArea: 0 }),
    project("no-house-number", { houseNumber: "" }),
    project("no-price", { plotPrice: 0 }),
  ];
  for (const sample of samples) {
    assert.equal(addressProjectIsComplete(sample), projectIsReadyForTotalSync(sample));
  }
  assert.deepEqual(
    missingAddressFields(project("missing", {
      street: "",
      houseNumber: "",
      zip: "",
      plotArea: 0,
      plotPrice: 0,
    })),
    ["Straße", "Hausnummer", "PLZ", "Grundstücksfläche", "Grundstückspreis"],
  );
});

test("combines city, zip, owner, completeness and upload filters", () => {
  const projects = [
    project("fabian-recent", {
      lastTotalSyncAt: "2026-07-23T10:00:00.000Z",
    }),
    project("pascal-old", {
      owner: "pascal",
      zip: "14469",
      city: "Potsdam",
      lastTotalSyncAt: "2026-07-01T10:00:00.000Z",
    }),
    project("pascal-never-incomplete", {
      owner: "pascal",
      zip: "14469",
      city: "Potsdam",
      street: "",
    }),
  ];
  const now = new Date("2026-07-24T12:00:00.000Z");

  assert.deepEqual(
    filterAddressProjects(projects, {
      ...defaultFilters,
      city: "Potsdam",
      zip: "144",
      owner: "pascal",
      completeness: "incomplete",
      upload: "never",
    }, now).map((item) => item.id),
    ["pascal-never-incomplete"],
  );
  assert.deepEqual(
    filterAddressProjects(projects, {
      ...defaultFilters,
      upload: "recent",
    }, now).map((item) => item.id),
    ["fabian-recent"],
  );
  assert.deepEqual(
    filterAddressProjects(projects, {
      ...defaultFilters,
      upload: "older",
    }, now).map((item) => item.id),
    ["pascal-old"],
  );
});

test("uses Berlin calendar days for the seven-day upload filter", () => {
  const uploadedBeforeDstChange = project("dst", {
    lastTotalSyncAt: "2026-10-18T10:00:00.000Z",
  });
  const sevenBerlinDaysLater = new Date("2026-10-25T11:00:00.000Z");

  assert.deepEqual(
    filterAddressProjects(
      [uploadedBeforeDstChange],
      { ...defaultFilters, upload: "recent" },
      sevenBerlinDaysLater,
    ).map((item) => item.id),
    ["dst"],
  );
  assert.deepEqual(
    filterAddressProjects(
      [uploadedBeforeDstChange],
      { ...defaultFilters, upload: "older" },
      sevenBerlinDaysLater,
    ),
    [],
  );
});

test("searches address, user, completeness and German upload date", () => {
  const projects = [
    project("one", {
      owner: "pascal",
      name: "Potsdam Nord",
      street: "Kirschallee",
      city: "Potsdam",
      lastTotalSyncAt: "2026-07-23T10:00:00.000Z",
    }),
    project("two", { city: "Teltow" }),
  ];

  for (const query of ["Kirschallee", "Pascal", "23.07.2026"]) {
    assert.deepEqual(
      filterAddressProjects(projects, { ...defaultFilters, query }).map((item) => item.id),
      ["one"],
    );
  }
  assert.deepEqual(
    filterAddressProjects(projects, { ...defaultFilters, query: "vollständig" })
      .map((item) => item.id),
    ["one", "two"],
  );

  const umlautProject = project("umlaut", {
    zip: "14913",
    city: "Görzke",
    street: "Bücknitzer Weg",
  });
  assert.deepEqual(
    filterAddressProjects(
      [umlautProject],
      { ...defaultFilters, query: "14913 goerzke buecknitzer" },
    ).map((item) => item.id),
    ["umlaut"],
  );
});

test("sorts by upload or postal code and paginates safely", () => {
  const projects = [
    project("new", { zip: "14513", lastTotalSyncAt: "2026-07-23T10:00:00.000Z" }),
    project("old", { zip: "10115", lastTotalSyncAt: "2026-07-01T10:00:00.000Z" }),
    project("never", { zip: "14469" }),
  ];

  assert.deepEqual(
    filterAddressProjects(projects, { ...defaultFilters, sort: "upload-newest" })
      .map((item) => item.id),
    ["new", "old", "never"],
  );
  assert.deepEqual(
    filterAddressProjects(projects, { ...defaultFilters, sort: "zip" })
      .map((item) => item.id),
    ["old", "never", "new"],
  );
  assert.deepEqual(
    filterAddressProjects(
      [...projects, project("missing-place", { city: "", zip: "" })],
      { ...defaultFilters, sort: "city" },
    ).at(-1)?.id,
    "missing-place",
  );
  assert.deepEqual(paginateAddressProjects(projects, 2, 2), {
    items: [projects[2]],
    page: 2,
    pageCount: 2,
    total: 3,
  });
  assert.equal(paginateAddressProjects(projects, 99, 2).page, 2);

  const ninetyFiveProjects = Array.from(
    { length: 95 },
    (_, index) => project(`project-${index + 1}`),
  );
  const lastPage = paginateAddressProjects(ninetyFiveProjects, 99, 25);
  assert.equal(lastPage.page, 4);
  assert.equal(lastPage.pageCount, 4);
  assert.equal(lastPage.items.length, 20);
});

test("returns unique German-sorted cities", () => {
  assert.deepEqual(
    addressCatalogCities([
      project("one", { city: "Teltow" }),
      project("two", { city: "Potsdam" }),
      project("three", { city: "Teltow" }),
      project("empty", { city: "" }),
    ]),
    ["Potsdam", "Teltow"],
  );
});
