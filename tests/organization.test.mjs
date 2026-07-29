import test from "node:test";
import assert from "node:assert/strict";
import { normalizeStudioManagementState } from "../app/lib/management.ts";
import {
  buildStaffOperationalMetrics,
  filterStudioStateForActor,
  mergeScopedStudioState,
  visibleUserIds,
} from "../app/lib/organization.ts";

function listing(id, externalId, templateId) {
  return {
    id,
    externalId,
    templateId,
    templateName: "Sunshine 144",
    price: 460000,
    texts: {
      title: `Objekt ${id}`,
      description: "Beschreibung",
      equipment: "Ausstattung",
      location: "Lage",
      other: "Sonstiges",
    },
    version: 1,
  };
}

function project(id, owner, listingId, externalId) {
  return {
    id,
    owner,
    name: id,
    street: "Beispielweg",
    houseNumber: "7",
    zip: "14552",
    city: "Michendorf",
    district: "",
    plotArea: 620,
    plotPrice: 160000,
    additionalCosts: 20000,
    locationFacts: "",
    transportFacts: "",
    familyFacts: "",
    natureFacts: "",
    notes: "",
    selectedHouseIds: ["house-1"],
    listings: [listing(listingId, externalId, "house-1")],
    createdAt: "2026-07-20T08:00:00.000Z",
  };
}

function fixture() {
  return normalizeStudioManagementState({
    version: 1,
    provider: {
      providerNumber: "30435",
      company: "Muster Hausbau",
      firstName: "Fabian",
      lastName: "Raebel",
      email: "fabian@example.de",
      phone: "030 123",
    },
    houses: [{
      id: "house-1",
      name: "Sunshine 144",
      houseType: "Einfamilienhaus",
      livingArea: 144,
      rooms: 5,
      bedrooms: 3,
      bathrooms: 2,
      floors: 2,
      housePrice: 300000,
      constructionYear: 2026,
      energyDemand: 18,
      energyClass: "A+",
      heatingType: "Fußbodenheizung",
      energySource: "Luftwärmepumpe",
      architecture: "",
      equipmentHighlights: "",
      useStandardPackage: true,
      images: [],
    }],
    projects: [
      project("project-fabian", "fabian", "listing-fabian", "30435-1"),
      project("project-pascal", "pascal", "listing-pascal", "30435-2"),
    ],
    promotionImages: [],
    uploadRunHistory: [],
  }, "2026-07-20T10:00:00.000Z");
}

test("migrates organization fields and assigns legacy objects to their representatives", () => {
  const state = fixture();
  assert.equal(state.management.version, 3);
  assert.equal(state.management.organizationUnits.length, 3);
  assert.equal(state.management.escalationRules.staleWarningDays, 4);
  assert.equal(
    state.projects[0].listings[0].management.assignedUserId,
    "user-fabian",
  );
  assert.equal(
    state.projects[1].listings[0].management.assignedUserId,
    "user-pascal",
  );
});

test("enforces self, team and organization visibility", () => {
  const state = fixture();
  const pascal = state.management.users.find((user) => user.id === "user-pascal");
  const fabian = state.management.users.find((user) => user.id === "user-fabian");

  assert.deepEqual([...visibleUserIds(state.management, pascal.id)], ["user-pascal"]);
  const pascalState = filterStudioStateForActor(state, pascal);
  assert.deepEqual(
    pascalState.projects.flatMap((entry) => entry.listings.map((item) => item.id)),
    ["listing-pascal"],
  );
  assert.deepEqual(pascalState.management.users.map((user) => user.id), ["user-pascal"]);

  assert.equal(visibleUserIds(state.management, fabian.id).size, 2);
  assert.equal(filterStudioStateForActor(state, fabian).projects.length, 2);

  const teamState = fixture();
  const teamLead = teamState.management.users.find((user) => user.id === "user-fabian");
  const teamMember = teamState.management.users.find((user) => user.id === "user-pascal");
  teamLead.role = "editor";
  teamLead.businessRole = "team-lead";
  teamLead.visibilityScope = "team";
  teamLead.organizationUnitIds = ["unit-sales-fabian"];
  teamMember.organizationUnitIds = ["unit-sales-fabian"];
  teamMember.managerUserId = teamLead.id;
  assert.deepEqual(
    [...visibleUserIds(teamState.management, teamLead.id)].sort(),
    ["user-fabian", "user-pascal"],
  );
});

test("merges scoped changes without deleting or taking over hidden objects", () => {
  const current = fixture();
  const pascal = current.management.users.find((user) => user.id === "user-pascal");
  current.management.auditLog.push({
    id: "audit-fabian",
    at: "2026-07-20T09:00:00.000Z",
    userId: "user-fabian",
    action: "Objekt bearbeitet",
    targetType: "listing",
    targetId: "listing-fabian",
    description: "Vertraulicher Fabian-Eintrag",
  });
  current.management.importReports.push({
    id: "report-all",
    filename: "status.xml",
    importedAt: "2026-07-20T09:30:00.000Z",
    eventCount: 2,
    matchedCount: 2,
    events: [
      {
        externalId: "30435-1",
        status: "online",
        message: "Fabian online",
      },
      {
        externalId: "30435-2",
        status: "online",
        message: "Pascal online",
      },
    ],
  });
  const submitted = filterStudioStateForActor(current, pascal);
  submitted.projects[0].listings[0].texts.title = "Pascal aktualisiert";
  submitted.management.auditLog.push({
    ...current.management.auditLog[0],
    userId: "user-pascal",
    description: "Manipulierter Eintrag",
  });
  const merged = mergeScopedStudioState(submitted, current, pascal);

  assert.equal(merged.projects.length, 2);
  assert.equal(
    merged.projects.find((entry) => entry.id === "project-pascal").listings[0].texts.title,
    "Pascal aktualisiert",
  );
  assert.equal(
    merged.projects.find((entry) => entry.id === "project-fabian").listings[0].texts.title,
    "Objekt listing-fabian",
  );
  assert.equal(merged.management.importReports[0].events.length, 2);
  assert.equal(
    merged.management.auditLog.find((entry) => entry.id === "audit-fabian").description,
    "Vertraulicher Fabian-Eintrag",
  );

  const manipulated = structuredClone(filterStudioStateForActor(current, pascal));
  manipulated.projects[0].listings[0].management.assignedUserId = "user-fabian";
  const protectedMerge = mergeScopedStudioState(manipulated, current, pascal);
  assert.equal(
    protectedMerge.projects.find((entry) => entry.id === "project-pascal").listings[0].management.assignedUserId,
    "user-pascal",
  );
});

test("derives critical employee status from stale objects and portal errors", () => {
  const state = fixture();
  const pascalListing = state.projects[1].listings[0];
  pascalListing.management.updatedAt = "2026-07-01T08:00:00.000Z";
  pascalListing.management.portals[0].status = "error";
  const metrics = buildStaffOperationalMetrics(
    state,
    new Date("2026-07-29T12:00:00.000Z"),
  );
  const pascal = metrics.find((entry) => entry.user.id === "user-pascal");
  assert.equal(pascal.status, "critical");
  assert.equal(pascal.portalErrors, 1);
  assert.equal(pascal.staleObjects, 1);
});
