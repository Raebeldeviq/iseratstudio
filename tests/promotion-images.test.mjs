import assert from "node:assert/strict";
import test from "node:test";

import {
  choosePromotionImage,
  choosePromotionListing,
  enforceSinglePromotionAssignment,
  normalizePromotionLibrary,
  recordPromotionUsage,
} from "../promotion-images.mjs";

const images = [
  { id: "promo-a", name: "a.jpg", active: true, priority: 2, order: 1 },
  { id: "promo-b", name: "b.jpg", active: true, priority: 1, order: 2 },
];

test("migrates the legacy single promotion image into the managed library", () => {
  const library = normalizePromotionLibrary({
    promotionImage: { id: "legacy", name: "legacy.jpg" },
    promotionImageEnabled: true,
  });
  assert.equal(library.promotionImages.length, 1);
  assert.equal(library.promotionSettings.enabled, true);
  assert.equal(library.promotionImages[0].role, "promotion");
});

test("rotates image and listing while honoring explicit manual choices", () => {
  const value = {
    promotionImages: images,
    promotionSettings: { enabled: true, automaticRotation: true },
    promotionUsage: [{
      id: "usage-1",
      projectId: "project-1",
      listingId: "listing-1",
      imageId: "promo-a",
      usedAt: "2026-07-24T08:00:00.000Z",
    }],
  };
  assert.equal(choosePromotionImage(value, { projectId: "project-1" }).id, "promo-b");
  assert.equal(choosePromotionImage(value, { projectId: "project-1", imageId: "promo-a" }).id, "promo-a");
  const listing = choosePromotionListing({
    id: "project-1",
    listings: [{ id: "listing-1" }, { id: "listing-2" }],
  }, value.promotionUsage);
  assert.equal(listing.id, "listing-2");
});

test("records usage count, timestamp and assignment without losing older history", () => {
  const updated = recordPromotionUsage({
    promotionImages: images,
    promotionSettings: { enabled: true },
    promotionUsage: [],
  }, {
    projectId: "project-1",
    listingId: "listing-2",
    externalId: "FPI-2",
    houseId: "house-7",
    imageId: "promo-b",
  }, { id: "usage-2", now: "2026-07-24T09:00:00.000Z" });
  assert.equal(updated.promotionUsage.length, 1);
  assert.equal(updated.promotionUsage[0].listingId, "listing-2");
  assert.equal(updated.promotionImages.find((image) => image.id === "promo-b").usageCount, 1);
  assert.equal(updated.promotionImages.find((image) => image.id === "promo-b").lastUsedAt, "2026-07-24T09:00:00.000Z");
  assert.equal(updated.promotionImages.find((image) => image.id === "promo-b").lastProjectId, "project-1");
  assert.equal(updated.promotionImages.find((image) => image.id === "promo-b").lastHouseId, "house-7");
  assert.equal(updated.promotionImages.find((image) => image.id === "promo-b").lastListingId, "listing-2");
});

test("keeps a random batch preview stable until the usage history changes", () => {
  const value = {
    promotionImages: images,
    promotionSettings: { enabled: true, automaticRotation: false, randomSelection: true },
    promotionUsage: [],
  };
  const first = choosePromotionImage(value, { projectId: "project-stable" });
  const second = choosePromotionImage(value, { projectId: "project-stable" });
  assert.equal(first.id, second.id);
});

test("keeps exactly one active promotion assignment per project", () => {
  const project = {
    id: "project-1",
    listings: [
      { id: "listing-1", promotionImageId: "promo-a", promotionAssignedAt: "2026-07-23T08:00:00.000Z" },
      { id: "listing-2", promotionImageId: "promo-b", promotionAssignedAt: "2026-07-24T08:00:00.000Z" },
    ],
    listingGroup: {
      variants: [
        { id: "variant-1", listing: { id: "listing-1", promotionImageId: "promo-a" } },
        { id: "variant-2", listing: { id: "listing-2", promotionImageId: "promo-b" } },
      ],
    },
  };
  const updated = enforceSinglePromotionAssignment(
    project,
    "listing-2",
    "promo-a",
    { now: "2026-07-25T09:00:00.000Z" },
  );
  assert.equal(updated.listings.filter((listing) => listing.promotionImageId).length, 1);
  assert.equal(updated.listings[1].promotionImageId, "promo-a");
  assert.equal(updated.listingGroup.variants.filter((variant) => variant.listing.promotionImageId).length, 1);
});
