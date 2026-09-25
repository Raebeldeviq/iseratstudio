import assert from "node:assert/strict";
import test from "node:test";

import {
  QNG_GUARANTEE_PREVIEW_TREATMENT,
  planQngGuaranteedStatusMigration,
} from "../qng-guaranteed-status-preview.mjs";
import {
  QNG_GUARANTEE_SENTENCE,
  QNG_GUARANTEE_TITLE,
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

test("plans central QNG title and description additions without mutating the input", () => {
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
  assert.deepEqual(preview.listings[0].title, {
    treatment: QNG_GUARANTEE_PREVIEW_TREATMENT.ADD_TITLE,
    proposedText: `Projektierte Wohnidee – ${QNG_GUARANTEE_TITLE}`,
  });
  assert.deepEqual(preview.listings[0].description, {
    treatment: QNG_GUARANTEE_PREVIEW_TREATMENT.ADD_DESCRIPTION,
    proposedText: `Sachliche Objektbeschreibung.\n\n${QNG_GUARANTEE_SENTENCE}`,
  });
});

test("prevents QNG duplicates and routes incompatible legacy QNG wording to manual review", () => {
  const alreadyCentral = planQngGuaranteedStatusMigration(stateWithListing({
    title: `Projektierte Wohnidee – ${QNG_GUARANTEE_TITLE}`,
    description: `Sachliche Objektbeschreibung.\n\n${QNG_GUARANTEE_SENTENCE}`,
  }));
  assert.equal(alreadyCentral.counts.titleChanges, 0);
  assert.equal(alreadyCentral.counts.descriptionChanges, 0);

  const legacyQng = planQngGuaranteedStatusMigration(stateWithListing({
    title: "QNG-Serienmerkmal für dein Zuhause",
    description: "QNG-Potenzial ist vorhanden.",
  }));
  assert.equal(legacyQng.counts.manualReviews, 1);
  assert.equal(legacyQng.listings[0].title.treatment, QNG_GUARANTEE_PREVIEW_TREATMENT.MANUAL_REVIEW);
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
