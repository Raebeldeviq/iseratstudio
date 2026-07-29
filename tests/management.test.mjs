import test from "node:test";
import assert from "node:assert/strict";
import {
  appendAuditLog,
  managementPermission,
  normalizeStudioManagementState,
} from "../app/lib/management.ts";

function fixture() {
  return {
    version: 1,
    provider: {
      providerNumber: "30435",
      company: "Fabian & Pascal",
      firstName: "Fabian",
      lastName: "Raebel",
      email: "kontakt@example.de",
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
      images: [{
        id: "image-1",
        name: "haus.jpg",
        mimeType: "image/jpeg",
        dataUrl: "data:image/jpeg;base64,AA==",
        caption: "Hausansicht",
        isFloorplan: false,
      }],
    }],
    projects: [{
      id: "project-1",
      owner: "fabian",
      name: "Michendorf",
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
      listings: [{
        id: "listing-1",
        externalId: "30435-13226",
        templateId: "house-1",
        templateName: "Sunshine 144",
        price: 460000,
        texts: {
          title: "Familienhaus in Michendorf",
          description: "Beschreibung",
          equipment: "Ausstattung",
          location: "Lage",
          other: "Sonstiges",
        },
        version: 1,
      }],
      createdAt: "2026-07-29T08:00:00.000Z",
    }],
    promotionImages: [],
    portalPublicationEnabled: false,
    uploadRunHistory: [],
  };
}

test("normalizes existing listings into persistent management records", () => {
  const normalized = normalizeStudioManagementState(
    fixture(),
    "2026-07-29T10:00:00.000Z",
  );
  const listing = normalized.projects[0].listings[0];
  assert.equal(normalized.management.users.length, 2);
  assert.equal(normalized.management.portals.length, 4);
  assert.equal(listing.management.details.city, "Michendorf");
  assert.equal(listing.management.details.purchasePrice, 460000);
  assert.equal(listing.management.media.length, 1);
  assert.equal(listing.management.media[0].sourceImageId, "image-1");
  assert.equal(listing.management.lifecycle, "draft");

  const again = normalizeStudioManagementState(
    normalized,
    "2026-07-30T10:00:00.000Z",
  );
  assert.equal(
    again.projects[0].listings[0].management.media[0].id,
    listing.management.media[0].id,
  );
});

test("enforces role permissions and records the acting user", () => {
  assert.equal(managementPermission("admin", "delete-remote"), true);
  assert.equal(managementPermission("editor", "transfer"), true);
  assert.equal(managementPermission("editor", "manage-users"), false);
  assert.equal(managementPermission("viewer", "edit-listings"), false);

  const normalized = normalizeStudioManagementState(fixture());
  const withAudit = appendAuditLog(normalized, {
    action: "Objekt freigegeben",
    targetType: "listing",
    targetId: "listing-1",
    description: "Test",
  }, "2026-07-29T11:00:00.000Z");
  assert.equal(withAudit.management.auditLog.length, 1);
  assert.equal(withAudit.management.auditLog[0].userId, "user-fabian");
});
