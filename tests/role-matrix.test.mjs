import assert from "node:assert/strict";
import test from "node:test";

import { buildExecutiveReport } from "../app/lib/executive-report.ts";
import {
  filterStudioStateForActor,
  mergeScopedStudioState,
  resolveActor,
  visibleUserIds,
} from "../app/lib/organization.ts";
import {
  projectMatchesResponsibilityScope,
  resolveImportedUserId,
  responsibilityScopeOptions,
  unitScope,
} from "../app/lib/responsibility.ts";

const NOW = "2026-07-29T12:00:00.000Z";

function user(
  id,
  name,
  businessRole,
  visibilityScope,
  organizationUnitIds,
  managerUserId,
  role = "editor",
) {
  return {
    id,
    name,
    email: `${id}@example.de`,
    role,
    businessRole,
    visibilityScope,
    organizationUnitIds,
    managerUserId,
    customVisibleUserIds: [],
    active: true,
    createdAt: "2026-07-01T08:00:00.000Z",
    lastActiveAt: "2026-07-29T08:00:00.000Z",
  };
}

function portal(status, operationStatus = "succeeded") {
  return {
    portalId: "immoscout24",
    enabled: true,
    desiredStatus: "online",
    status,
    retryCount: status === "error" ? 1 : 0,
    operationLog: [{
      id: `operation-${status}`,
      kind: "update",
      status: operationStatus,
      at: "2026-07-28T10:00:00.000Z",
      message: status,
      attempt: 1,
    }],
  };
}

function listing(userId, status = "online", operationStatus = "succeeded") {
  return {
    id: `listing-${userId}`,
    externalId: `ORG-${userId.toUpperCase()}-1001`,
    templateId: "house-1",
    templateName: "Sunshine 144",
    price: 470000,
    texts: {
      title: `Objekt ${userId}`,
      description: "Beschreibung",
      equipment: "Ausstattung",
      location: "Lage",
      other: "Sonstiges",
    },
    uploadedAt: "2026-07-28T10:00:00.000Z",
    version: 1,
    management: {
      lifecycle: status === "online" ? "online" : "error",
      released: true,
      createdAt: "2026-07-01T08:00:00.000Z",
      updatedAt: "2026-07-28T10:00:00.000Z",
      assignedUserId: userId,
      organizationUnitId: "",
      details: { transferOnSave: true },
      media: [],
      appointments: userId === "rep-north-a"
        ? [{
            id: "appointment-1",
            title: "Besichtigung",
            startsAt: "2026-07-27T10:00:00.000Z",
            endsAt: "2026-07-27T11:00:00.000Z",
            location: "",
            contactName: "",
            contactEmail: "",
            notes: "",
            status: "completed",
            createdAt: "2026-07-20T10:00:00.000Z",
          }]
        : [],
      portals: [portal(status, operationStatus)],
    },
  };
}

function project(userId, unitId, status = "online", operationStatus = "succeeded") {
  return {
    id: `project-${userId}`,
    owner: userId,
    responsibleUserId: userId,
    organizationUnitId: unitId,
    name: `Projekt ${userId}`,
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
    listings: [listing(userId, status, operationStatus)],
    createdAt: "2026-07-01T08:00:00.000Z",
  };
}

function fixture() {
  const units = [
    { id: "company", name: "Muster Hausbau", type: "company", active: true, createdAt: NOW },
    { id: "north", name: "Region Nord", type: "region", parentId: "company", active: true, createdAt: NOW },
    { id: "north-a", name: "Team Nord A", type: "team", parentId: "north", active: true, createdAt: NOW },
    { id: "north-b", name: "Team Nord B", type: "team", parentId: "north", active: true, createdAt: NOW },
    { id: "south", name: "Region Süd", type: "region", parentId: "company", active: true, createdAt: NOW },
  ];
  const users = [
    user("executive", "Geschäftsführung", "executive", "organization", ["company"], undefined, "admin"),
    user("director-north", "Vertriebsleitung Nord", "sales-director", "area", ["north"], "executive"),
    user("lead-north-a", "Teamleitung Nord A", "team-lead", "team", ["north-a"], "director-north"),
    user("rep-north-a", "Handelsvertretung Nord A", "sales-representative", "self", ["north-a"], "lead-north-a"),
    user("rep-north-b", "Handelsvertretung Nord B", "sales-representative", "self", ["north-b"], "director-north"),
    user("rep-south", "Handelsvertretung Süd", "sales-representative", "self", ["south"], "executive"),
    user("backoffice", "Backoffice", "backoffice", "self", ["company"], "executive"),
  ];
  const projects = [
    project("executive", "company"),
    project("director-north", "north"),
    project("lead-north-a", "north-a"),
    project("rep-north-a", "north-a"),
    project("rep-north-b", "north-b", "error", "failed"),
    project("rep-south", "south"),
    project("backoffice", "company"),
    {
      ...project("rep-north-a-empty", "north-a"),
      id: "project-empty-address",
      responsibleUserId: "rep-north-a",
      listings: [],
    },
  ];
  return {
    version: 1,
    provider: {
      providerNumber: "30435",
      company: "Muster Hausbau",
      firstName: "Erika",
      lastName: "Geschäftsführung",
      email: "executive@example.de",
      phone: "",
    },
    houses: [],
    projects,
    promotionImages: [],
    uploadRunHistory: [{
      id: "run-1",
      kind: "total-sync",
      scope: "all",
      status: "completed-with-errors",
      portalPublicationEnabled: true,
      createdAt: "2026-07-28T09:00:00.000Z",
      updatedAt: "2026-07-28T10:00:00.000Z",
      skippedProjectCount: 0,
      attempts: [],
      listings: [
        {
          id: "history-rep-a",
          projectId: "project-rep-north-a",
          projectName: "Projekt rep-north-a",
          owner: "rep-north-a",
          responsibleUserId: "rep-north-a",
          organizationUnitId: "north-a",
          city: "Michendorf",
          externalId: "ORG-REP-NORTH-A-1001",
          houseId: "house-1",
          houseName: "Sunshine 144",
          status: "uploaded",
          attemptCount: 1,
          uploadedAt: "2026-07-28T10:00:00.000Z",
        },
        {
          id: "history-rep-b",
          projectId: "project-rep-north-b",
          projectName: "Projekt rep-north-b",
          owner: "rep-north-b",
          responsibleUserId: "rep-north-b",
          organizationUnitId: "north-b",
          city: "Michendorf",
          externalId: "ORG-REP-NORTH-B-1001",
          houseId: "house-1",
          houseName: "Sunshine 144",
          status: "failed",
          attemptCount: 1,
          lastAttemptAt: "2026-07-28T10:00:00.000Z",
        },
      ],
    }],
    management: {
      version: 3,
      currentUserId: "executive",
      users,
      organizationUnits: units,
      escalationRules: {
        staleWarningDays: 4,
        staleCriticalDays: 8,
        inactivityWarningDays: 7,
        inactivityCriticalDays: 14,
        renewalWarningDays: 2,
        portalErrorsCritical: true,
      },
      company: { name: "Muster Hausbau", openingHours: [] },
      portals: [],
      auditLog: [],
      importReports: [],
      fileFolders: [],
      files: [],
    },
  };
}

test("checks separate account identities and the complete visibility matrix", () => {
  const state = fixture();
  const expected = new Map([
    ["executive", ["backoffice", "director-north", "executive", "lead-north-a", "rep-north-a", "rep-north-b", "rep-south"]],
    ["director-north", ["director-north", "lead-north-a", "rep-north-a", "rep-north-b"]],
    ["lead-north-a", ["lead-north-a", "rep-north-a"]],
    ["rep-north-a", ["rep-north-a"]],
    ["backoffice", ["backoffice"]],
  ]);

  for (const [actorId, visibleIds] of expected) {
    const actor = resolveActor(state.management, { email: `${actorId}@example.de` });
    assert.equal(actor.id, actorId);
    assert.deepEqual(
      [...visibleUserIds(state.management, actorId)].sort(),
      [...visibleIds].sort(),
    );
  }
  assert.equal(
    resolveActor(state.management, { email: "unbekannt@example.de" }),
    undefined,
  );

  const representative = resolveActor(
    state.management,
    { email: "rep-north-a@example.de" },
  );
  const scoped = filterStudioStateForActor(state, representative);
  assert.deepEqual(
    scoped.projects.map((entry) => entry.id).sort(),
    ["project-empty-address", "project-rep-north-a"],
  );
  assert.deepEqual(scoped.management.users.map((entry) => entry.id), ["rep-north-a"]);
});

test("prevents a representative from taking over another employee's objects", () => {
  const current = fixture();
  const representative = resolveActor(
    current.management,
    { email: "rep-north-a@example.de" },
  );
  const submitted = filterStudioStateForActor(current, representative);
  const own = submitted.projects.find((entry) => entry.id === "project-rep-north-a");
  own.responsibleUserId = "rep-south";
  own.listings[0].management.assignedUserId = "rep-south";
  submitted.projects.push(structuredClone(
    current.projects.find((entry) => entry.id === "project-rep-south"),
  ));

  const merged = mergeScopedStudioState(submitted, current, representative);
  assert.equal(
    merged.projects.find((entry) => entry.id === "project-rep-north-a").responsibleUserId,
    "rep-north-a",
  );
  assert.equal(
    merged.projects.find((entry) => entry.id === "project-rep-north-a")
      .listings[0].management.assignedUserId,
    "rep-north-a",
  );
  assert.equal(
    merged.projects.find((entry) => entry.id === "project-rep-south")
      .listings[0].texts.title,
    "Objekt rep-south",
  );
});

test("resolves imports and area scopes without fixed employee names", () => {
  const state = fixture();
  assert.equal(
    resolveImportedUserId(state.management, "rep-north-b@example.de"),
    "rep-north-b",
  );
  assert.equal(
    projectMatchesResponsibilityScope(
      state.projects.find((entry) => entry.id === "project-rep-north-a"),
      unitScope("north"),
      state.management,
    ),
    true,
  );
  assert.equal(
    projectMatchesResponsibilityScope(
      state.projects.find((entry) => entry.id === "project-rep-south"),
      unitScope("north"),
      state.management,
    ),
    false,
  );
  const northIds = visibleUserIds(state.management, "director-north");
  const scopeValues = responsibilityScopeOptions(state.management, northIds)
    .map((entry) => entry.value);
  assert.equal(scopeValues.includes("user:rep-south"), false);
  assert.equal(scopeValues.includes("user:rep-north-a"), true);
});

test("builds executive totals by employee, team and region", () => {
  const report = buildExecutiveReport(fixture(), new Date(NOW));
  assert.equal(report.totals.headcount, 7);
  assert.equal(report.totals.activeObjects, 7);
  assert.equal(report.totals.portalErrors, 1);
  assert.equal(report.totals.uploads30Days, 1);
  assert.equal(report.totals.successRate, 86);

  const north = report.units.find((entry) => entry.unit.id === "north");
  assert.equal(north.headcount, 4);
  assert.equal(north.activeObjects, 4);
  assert.equal(north.portalErrors, 1);
  assert.equal(north.successRate, 75);

  const representative = report.employees.find((entry) => entry.userId === "rep-north-a");
  assert.equal(representative.uploads30Days, 1);
  assert.equal(representative.completedAppointments30Days, 1);
  assert.equal(report.trend.at(-1).uploads, 1);
  assert.equal(report.trend.at(-1).failures, 1);
});
