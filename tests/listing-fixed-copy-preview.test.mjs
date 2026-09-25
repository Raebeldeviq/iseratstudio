import assert from "node:assert/strict";
import test from "node:test";

import { runListingFixedCopyPreviewCli } from "../listing-fixed-copy-preview-cli.mjs";
import {
  LISTING_FIXED_COPY_READ_ONLY_GUARANTEE,
  LISTING_FIXED_COPY_TREATMENT,
  planListingFixedCopyPreview,
} from "../listing-fixed-copy-preview.mjs";
import {
  createStandardStaticCopy,
  initializeListingStaticCopy,
  PREVIOUS_STATIC_COPY,
  STATIC_COPY_SOURCE,
} from "../listing-copy.mjs";
import { LIVING_HAUS_IKON_TECHNICAL_PACKAGE_ID } from "../listing-claim-policy.mjs";

function state() {
  const legacy = {
    id: "legacy-listing",
    externalId: "30460-1",
    templateId: "house-1",
    texts: {
      title: "Bestandstitel",
      description: "Bestandsbeschreibung.",
      equipment: PREVIOUS_STATIC_COPY.equipment,
      location: "Bestandslage.",
      other: PREVIOUS_STATIC_COPY.other,
    },
  };
  const manual = initializeListingStaticCopy({
    id: "manual-listing",
    externalId: "30460-2",
    templateId: "house-1",
    texts: {
      title: "Manueller Titel",
      description: "Bestandsbeschreibung.",
      equipment: "Individuelle Ausstattung ohne technische Werbeaussage.",
      location: "Bestandslage.",
      other: "Individuelles Sonstiges.",
    },
  });
  manual.staticTexts = {
    provision: "Individuelle Provision.",
    annotation: "Individuelle Anmerkung.",
    terms: "Individuelle Bedingungen.",
    recommendation: "Individuelle Empfehlung.",
  };
  manual.staticCopySources = Object.fromEntries(Object.keys(createStandardStaticCopy())
    .map((field) => [field, STATIC_COPY_SOURCE.MANUAL]));
  const current = initializeListingStaticCopy({
    id: "current-listing",
    externalId: "30460-3",
    templateId: "house-1",
    texts: {
      title: "Aktueller Titel",
      description: "Aktuelle Beschreibung.",
      equipment: "",
      location: "Aktuelle Lage.",
      other: "",
    },
  });
  return {
    houses: [{
      id: "house-1",
      name: "SUN 151 V8",
      seriesId: "livinghaus",
      technicalPackage: LIVING_HAUS_IKON_TECHNICAL_PACKAGE_ID,
      energyClass: "A++",
    }],
    projects: [{
      id: "project-1",
      name: "Testprojekt",
      city: "Potsdam",
      listings: [legacy, manual, current],
    }],
  };
}

test("classifies only an exact legacy system standard as a safe later migration without changing state", () => {
  const input = state();
  const before = structuredClone(input);
  const report = planListingFixedCopyPreview(input);
  assert.deepEqual(input, before);
  assert.equal(report.readOnly, true);
  assert.deepEqual(report.guarantee, LISTING_FIXED_COPY_READ_ONLY_GUARANTEE);
  assert.equal(report.counts.activeListings, 3);

  const legacy = report.listings.find((listing) => listing.listingId === "legacy-listing");
  const manual = report.listings.find((listing) => listing.listingId === "manual-listing");
  const current = report.listings.find((listing) => listing.listingId === "current-listing");
  assert.ok(legacy && manual && current);
  assert.equal(legacy.fields.find((field) => field.field === "equipment")?.treatment, LISTING_FIXED_COPY_TREATMENT.STANDARD_REPLACE_SAFE);
  assert.equal(legacy.fields.find((field) => field.field === "terms")?.treatment, LISTING_FIXED_COPY_TREATMENT.ALREADY_CORRECT);
  assert.equal(manual.fields.find((field) => field.field === "equipment")?.treatment, LISTING_FIXED_COPY_TREATMENT.MANUAL_DIFFERENCE);
  assert.equal(manual.fields.find((field) => field.field === "provision")?.treatment, LISTING_FIXED_COPY_TREATMENT.MANUAL_DIFFERENCE);
  assert.ok(current.fields.every((field) => field.treatment === LISTING_FIXED_COPY_TREATMENT.ALREADY_CORRECT));
  assert.equal(report.counts.masterClaimBlock, 0);
  assert.equal(legacy.portalFields.find((field) => field.field === "heatingType")?.targetValue, "keine Angabe (heizungsart wird im OpenImmo-Export weggelassen)");
  assert.deepEqual(legacy.portalFields.find((field) => field.field === "energyTypes")?.targetValue, ["KFW40", "KFW55"]);
  assert.equal(legacy.portalFields.find((field) => field.field === "commissionRequired")?.targetValue, false);
  assert.ok(report.migrationCandidates.every((candidate) => candidate.treatment === LISTING_FIXED_COPY_TREATMENT.STANDARD_REPLACE_SAFE));
});

test("reports a master-text block when the I-KON package evidence is missing", () => {
  const input = state();
  input.houses[0].technicalPackage = "";
  const report = planListingFixedCopyPreview(input);
  assert.equal(report.counts.masterClaimPass, 0);
  assert.equal(report.counts.masterClaimBlock, 3);
  assert.ok(report.listings.every((listing) => listing.masterClaimValidator.blockingIssues.length > 0));
});

test("CLI loads one catalog snapshot, supports JSON and has no mutation path", async () => {
  let reads = 0;
  const result = await runListingFixedCopyPreviewCli(["--json"], {
    loadCatalogManifest: async () => {
      reads += 1;
      return { stored: true, state: state() };
    },
  });
  assert.equal(reads, 1);
  assert.equal(result.readOnly, true);
  assert.match(result.output, /"activeListings": 3/u);
  await assert.rejects(runListingFixedCopyPreviewCli(["--apply"], {
    loadCatalogManifest: async () => ({ stored: true, state: state() }),
  }), /Unbekanntes Argument/u);
});
