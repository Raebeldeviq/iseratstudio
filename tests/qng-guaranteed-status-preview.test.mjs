import assert from "node:assert/strict";
import test from "node:test";

import {
  QNG_GUARANTEE_PREVIEW_TREATMENT,
  planQngGuaranteedStatusMigration,
} from "../qng-guaranteed-status-preview.mjs";
import {
  QNG_GUARANTEE_SENTENCE,
} from "../listing-claim-policy.mjs";

function stateWithListing(texts = {}, seriesId = "livinghaus") {
  return {
    houses: [{ id: "house-1", seriesId, name: "SUN", livingArea: 150, rooms: 5 }],
    projects: [{
      id: "project-1",
      city: "Berlin",
      listings: [{
        id: "listing-1",
        externalId: "30460-1",
        templateId: "house-1",
        texts: { title: "Projektierte Wohnidee", description: "Sachliche Objektbeschreibung.", ...texts },
      }],
    }],
  };
}

test("plans a deterministic two-USP title and central QNG description without mutating the input", () => {
  const state = stateWithListing();
  const before = structuredClone(state);
  const preview = planQngGuaranteedStatusMigration(state);
  assert.deepEqual(state, before);
  assert.equal(preview.readOnly, true);
  assert.deepEqual(preview.counts, {
    scannedListings: 1,
    eligibleListings: 1,
    affectedListings: 1,
    titleChanges: 1,
    descriptionChanges: 1,
    manualReviews: 0,
  });
  const title = preview.listings[0].title;
  assert.equal(title.treatment, QNG_GUARANTEE_PREVIEW_TREATMENT.REPLACE_TITLE);
  assert.equal(title.previousText, "Projektierte Wohnidee");
  assert.match(title.proposedText, /in Berlin: 150 m², 5 Zimmer/u);
  assert.equal(title.usp1?.id, "qng_guarantee");
  assert.equal(title.usp2?.id, "dgnb_series_certification");
  assert.equal(title.claimValidator.ok, true);
  assert.equal(title.claimValidator.blockingIssues.length, 0);
  assert.equal(title.titleLength, title.proposedText.length);
  assert.ok(title.titleLength <= title.titleLimit);
  assert.equal(title.usp1?.evidence.evidenceKind, "qng_series_guarantee");
  assert.match(title.usp2?.evidence.evidenceReference || "", /DGNB/u);
  assert.deepEqual(preview.listings[0].description, {
    treatment: QNG_GUARANTEE_PREVIEW_TREATMENT.ADD_DESCRIPTION,
    previousText: "Sachliche Objektbeschreibung.",
    proposedText: `Sachliche Objektbeschreibung.\n\n${QNG_GUARANTEE_SENTENCE}`,
  });
});

test("replans titles from facts while preventing description duplicates and preserving manual QNG text review", () => {
  const generatedTitle = planQngGuaranteedStatusMigration(stateWithListing()).listings[0].title.proposedText;
  const alreadyCentral = planQngGuaranteedStatusMigration(stateWithListing({
    title: generatedTitle,
    description: `Sachliche Objektbeschreibung.\n\n${QNG_GUARANTEE_SENTENCE}`,
  }));
  assert.equal(alreadyCentral.counts.titleChanges, 0);
  assert.equal(alreadyCentral.counts.descriptionChanges, 0);

  const legacyQng = planQngGuaranteedStatusMigration(stateWithListing({
    title: "QNG-Serienmerkmal für dein Zuhause",
    description: "QNG-Potenzial ist vorhanden.",
  }));
  assert.equal(legacyQng.counts.manualReviews, 1);
  assert.equal(legacyQng.listings[0].title.treatment, QNG_GUARANTEE_PREVIEW_TREATMENT.REPLACE_TITLE);
  assert.equal(legacyQng.listings[0].description.treatment, QNG_GUARANTEE_PREVIEW_TREATMENT.MANUAL_REVIEW);
});

test("does not derive a guarantee for a foreign house series", () => {
  const preview = planQngGuaranteedStatusMigration(stateWithListing({}, "fremdhersteller"));
  assert.equal(preview.counts.eligibleListings, 0);
  assert.equal(preview.counts.affectedListings, 0);
});

test("excludes archived and rotation-archived listings from the active migration scope", () => {
  const state = stateWithListing();
  state.projects[0].listings.push(
    {
      id: "listing-archived",
      externalId: "30460-archived",
      templateId: "house-1",
      status: "archived",
      texts: { title: "Archiv", description: "Archiv" },
    },
    {
      id: "listing-rotation-archived",
      externalId: "30460-rotation-archived",
      templateId: "house-1",
      rotationArchivedAt: "2026-09-25T10:00:00.000Z",
      texts: { title: "Rotation", description: "Rotation" },
    },
  );
  const preview = planQngGuaranteedStatusMigration(state);
  assert.equal(preview.counts.scannedListings, 1);
  assert.equal(preview.listings[0].listingId, "listing-1");
});

test("reports deterministic opening, USP and pair distributions for the active title scope", () => {
  const state = stateWithListing();
  state.houses[0].technicalPackage = "livinghaus-ikon-standard";
  for (let index = 2; index <= 16; index += 1) {
    state.projects[0].listings.push({
      id: `listing-${index}`,
      externalId: `30460-${index}`,
      templateId: "house-1",
      texts: { title: `Bestand ${index}`, description: "Sachliche Objektbeschreibung." },
    });
  }
  const before = structuredClone(state);
  const preview = planQngGuaranteedStatusMigration(state);
  assert.deepEqual(state, before);
  assert.equal(preview.counts.scannedListings, 16);
  assert.equal(preview.counts.titleChanges, 16);
  assert.equal(preview.counts.manualReviews, 0);
  assert.ok(Object.keys(preview.distribution.emotionalOpenings).length > 1);
  assert.ok(Object.keys(preview.distribution.uspCombinations).length > 1);
  assert.equal(Object.values(preview.distribution.uspCombinations).reduce((sum, count) => sum + count, 0), 16);
  assert.ok(preview.listings.every((listing) => listing.title.usp1 && listing.title.usp2));
  assert.ok(preview.listings.every((listing) => listing.title.claimValidator.ok));
});
