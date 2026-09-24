import assert from "node:assert/strict";
import test from "node:test";

import {
  addListingGroupVariant,
  assignListingGroupVariant,
  claimListingOperation,
  createListingGroup,
  listingControl,
  listingDeletionBlockReasons,
  moveListingGroupVariant,
  normalizeListingGroup,
  recordListingGroupCopy,
  releaseListingOperation,
  removeListingGroupVariant,
  updateListingControl,
  validateListingGroupVariant,
} from "../listing-groups.mjs";

function ids(prefix = "id") {
  let value = 0;
  return () => `${prefix}-${++value}`;
}

function house(id, price = 400000) {
  return {
    id, name: `SUN ${id}`, approved: true, houseType: "Einfamilienhaus",
    livingArea: 130 + Number(id || 0), rooms: 5, bedrooms: 3, bathrooms: 2, floors: 2,
    housePrice: price, constructionYear: 2027, energyDemand: 18, energyClass: "A++",
    heatingType: "Fußbodenheizung mit Luft-Wasser-Wärmepumpe", energySource: "Umweltwärme und Strom",
    architecture: "Offener Grundriss", equipmentHighlights: "Hochwertige Ausstattung",
    useStandardPackage: true,
    images: Array.from({ length: 4 }, (_, index) => ({
      id: `${id}-image-${index + 1}`, name: `${id}-${index + 1}.jpg`, caption: `Bild ${index + 1}`,
      mimeType: "image/jpeg", isFloorplan: index > 1,
      role: index === 0 ? "cover" : index === 2 ? "floorplan_ground" : index === 3 ? "floorplan_upper" : "living",
    })),
  };
}

function listing(houseValue, id, price = 500000, createdAt = "2026-06-01T08:00:00.000Z") {
  return {
    id, externalId: `FPI-${id}`, templateId: houseValue.id, templateName: houseValue.name,
    price, version: 1, createdAt,
    texts: {
      title: "Sicher und planbar ins eigene Zuhause", description: "Vollständige Objektbeschreibung",
      equipment: "Vollständige Ausstattung", location: "Vollständige Lagebeschreibung",
      other: "Vollständige sonstige Angaben",
    },
  };
}

function assignedGroup(projectId, count = 4, idFactory = ids(projectId)) {
  let group = createListingGroup(projectId, { idFactory, now: "2026-06-01T08:00:00.000Z" });
  while (group.variants.length < count) group = addListingGroupVariant(group, { idFactory });
  for (let index = 0; index < count; index += 1) {
    const selectedHouse = house(String(index + 1));
    group = assignListingGroupVariant(group, group.variants[index].id, selectedHouse, listing(selectedHouse, `${projectId}-${index + 1}`), { idFactory });
  }
  return group;
}

test("new groups suggest four variants but have no fixed upper or lower bound", () => {
  const idFactory = ids();
  let group = createListingGroup("project-1", { idFactory });
  assert.equal(group.variants.length, 4);
  assert.ok(group.variants.every((variant) => variant.role === "variant" && !variant.templateId));

  group = addListingGroupVariant(group, { idFactory });
  group = addListingGroupVariant(group, { idFactory });
  assert.equal(group.variants.length, 6);
  const lastId = group.variants.at(-1).id;
  group = removeListingGroupVariant(group, lastId, { idFactory });
  assert.equal(group.variants.length, 5);
  assert.deepEqual(group.variants.map((variant) => variant.order), [1, 2, 3, 4, 5]);

  const large = createListingGroup("scale", { idFactory: ids("scale"), suggestedVariantCount: 2000 });
  assert.equal(large.variants.length, 2000);
  assert.equal(large.variants.at(-1).order, 2000);
});

test("legacy 4+4 groups migrate assigned snapshots into a dynamic list", () => {
  const selectedHouse = house("143");
  const legacy = {
    id: "legacy", projectId: "project-legacy",
    variants: Array.from({ length: 8 }, (_, index) => ({
      id: `legacy-${index + 1}`, projectId: "project-legacy",
      role: index < 4 ? "primary" : "alternative", order: index + 1,
      templateId: index === 0 || index === 6 ? selectedHouse.id : "",
      templateName: index === 0 || index === 6 ? selectedHouse.name : "",
      active: index === 0 || index === 6, approved: index === 0 || index === 6,
      houseSnapshot: null, listing: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    })),
  };
  let prepared = normalizeListingGroup(legacy, "project-legacy", { idFactory: ids("migration") });
  prepared = assignListingGroupVariant(prepared, prepared.variants[0].id, selectedHouse, listing(selectedHouse, "legacy-source"));
  const restored = normalizeListingGroup(prepared, "project-legacy", { idFactory: ids("restored") });
  assert.equal(restored.schemaVersion, 2);
  assert.ok(restored.variants.every((variant) => variant.role === "variant"));
  assert.equal(restored.variants[0].listing.projectingSettings.energyCertificateClass, "");
});

test("variant snapshots stay coherent and ordering is freely changeable", () => {
  const idFactory = ids();
  let group = assignedGroup("project-2", 6, idFactory);
  const selectedHouse = house("1");
  assert.deepEqual(validateListingGroupVariant(group.variants[0], selectedHouse, { expectedPrice: 500000 }), []);
  assert.match(validateListingGroupVariant(group.variants[0], selectedHouse, { expectedPrice: 510000 }).join(" "), /Inseratspreis/);
  const movedId = group.variants[5].id;
  group = moveListingGroupVariant(group, movedId, "up", { idFactory });
  assert.equal(group.variants[4].id, movedId);
});

test("statuses, locks and leases belong to each individual listing", () => {
  const idFactory = ids("rotation");
  let group = assignedGroup("project-3", 3, idFactory);
  const firstListing = group.variants[0].listing;
  const secondListing = group.variants[1].listing;
  const target = group.variants[1];
  const copy = {
    ...target.listing,
    id: "copy-1",
    externalId: "FPI-COPY-1",
    rotationSourceListingId: firstListing.id,
  };
  group = recordListingGroupCopy(group, target.id, copy, {
    idFactory,
    sourceListing: firstListing,
    sourceListingId: firstListing.id,
    now: "2026-07-24T12:00:00.000Z",
  }).group;
  assert.equal(listingControl(group, firstListing).status, "published");
  assert.equal(group.rotationCounter, 1);

  group = updateListingControl(group, secondListing, {
    premiumPlacement: true,
    manualLock: true,
    automaticDeletionEnabled: true,
    updateMode: "full-auto",
  }, { idFactory });
  const reasons = listingDeletionBlockReasons(group, secondListing, "2026-07-24T12:00:00.000Z", {
    newListingCreated: true, newExternalId: true, validationPassed: true,
  });
  assert.match(reasons.join(" "), /Premium-Sperre/);
  assert.match(reasons.join(" "), /manuelle Sperre/);

  group = claimListingOperation(group, firstListing, "token-1", { idFactory, now: "2026-07-24T12:00:00.000Z" });
  assert.throws(() => claimListingOperation(group, firstListing, "token-2", { idFactory, now: "2026-07-24T12:01:00.000Z" }), /bereits/);
  assert.doesNotThrow(() => claimListingOperation(group, secondListing, "token-2", { idFactory, now: "2026-07-24T12:01:00.000Z" }));
  group = releaseListingOperation(group, firstListing, "token-1", { now: "2026-07-24T12:02:00.000Z" });
  assert.equal(listingControl(group, firstListing).processLease, null);
});
