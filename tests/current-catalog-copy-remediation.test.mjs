import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";

import { generateListingTexts } from "../app/lib/text-generator.ts";
import { applyCurrentCatalogCopyRemediation } from "../current-catalog-copy-remediation.mjs";
import { LIVING_HAUS_SERIES_ID } from "../listing-claim-policy.mjs";
import { initializeListingStaticCopy } from "../listing-copy.mjs";
import { scanPhase2BClaims } from "../phase2b-claim-scan.mjs";

function hash(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function fixture() {
  const house = {
    id: "house-1",
    name: "SUN 136 V4",
    houseType: "Einfamilienhaus",
    livingArea: 136,
    rooms: 5,
    bedrooms: 3,
    bathrooms: 2,
    floors: 2,
    seriesId: LIVING_HAUS_SERIES_ID,
    listingFacts: [],
    images: [],
  };
  const project = {
    id: "project-1",
    street: "Testweg",
    houseNumber: "1",
    zip: "14467",
    city: "Potsdam",
    district: "Bornstedt",
    plotArea: 500,
    plotPrice: 0,
    additionalCosts: 0,
    listings: [],
  };
  const generated = generateListingTexts(house, project, {}, 1, "listing-1");
  const listing = initializeListingStaticCopy({
    id: "listing-1",
    externalId: "test-1",
    templateId: house.id,
    templateName: house.name,
    status: "published",
    version: 1,
    texts: {
      ...generated,
      title: "QNG-Potenzial für dein Zuhause",
      description: "Dieses energieeffiziente Zuhause senkt dauerhaft deine Energiekosten.",
    },
  });
  listing.texts.equipment = "Sachliche Ausstattung gemäß individueller Bau- und Leistungsbeschreibung.";
  listing.texts.other = "Sachlicher Hinweis ohne Werbe- oder Umweltclaim.";
  listing.staticCopySources.equipment = "manual";
  listing.staticCopySources.other = "manual";
  project.listings = [listing];
  return { state: { version: 1, dataSchemaVersion: 5, houses: [house], projects: [project], provider: {} }, listing };
}

test("replaces only the explicitly approved dynamic fields and reaches zero BLOCK/REVIEW", () => {
  const { state, listing } = fixture();
  const initial = scanPhase2BClaims(state);
  const result = applyCurrentCatalogCopyRemediation(state, {
    now: "2026-09-26T13:00:00.000Z",
    targets: [{
      listingId: listing.id,
      descriptionHash: hash(listing.texts.description),
      titleHash: hash(listing.texts.title),
      replaceTitle: true,
    }],
    expectedActiveListingIds: [listing.id],
    expected: {
      activeListings: 1,
      affectedListings: 1,
      blockClaims: initial.severityCounts.BLOCK,
      reviewClaims: 0,
      safeFields: 0,
      staticChanges: 0,
      descriptions: 1,
      titles: 1,
    },
  });

  assert.equal(result.changed, true);
  assert.deepEqual(result.finalReport.severityCounts, { BLOCK: 0, REVIEW: 0 });
  assert.match(result.state.projects[0].listings[0].texts.description, /Zuhause-Darlehen/u);
  assert.match(result.state.projects[0].listings[0].texts.description, /calendly\.com/u);
  assert.notEqual(result.state.projects[0].listings[0].texts.title, listing.texts.title);

  const rerun = applyCurrentCatalogCopyRemediation(result.state, {
    targets: [{
      listingId: listing.id,
      descriptionHash: hash(listing.texts.description),
      titleHash: hash(listing.texts.title),
      replaceTitle: true,
    }],
    expectedActiveListingIds: [listing.id],
    expected: { activeListings: 1 },
  });
  assert.equal(rerun.changed, false);
  assert.equal(rerun.idempotent, true);
});

test("fails closed when an approved source text changes after authorization", () => {
  const { state, listing } = fixture();
  const initial = scanPhase2BClaims(state);
  listing.texts.description = `${listing.texts.description} Nachträgliche Änderung.`;
  assert.throws(() => applyCurrentCatalogCopyRemediation(state, {
    targets: [{
      listingId: listing.id,
      descriptionHash: hash("anderer freigegebener Text"),
      titleHash: hash(listing.texts.title),
      replaceTitle: true,
    }],
    expectedActiveListingIds: [listing.id],
    expected: {
      activeListings: 1,
      affectedListings: 1,
      blockClaims: initial.severityCounts.BLOCK,
      reviewClaims: 0,
      safeFields: 0,
      staticChanges: 0,
      descriptions: 1,
      titles: 1,
    },
  }), /CURRENT_COPY_HASH_SCOPE/u);
});
