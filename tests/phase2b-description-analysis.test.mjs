import assert from "node:assert/strict";
import test from "node:test";

import { CLAIM_CATEGORY } from "../listing-claim-policy.mjs";
import {
  analyzePhase2BDescriptions,
  DESCRIPTION_ACTION,
  formatPhase2BDescriptionAnalysisMarkdown,
} from "../phase2b-description-analysis.mjs";

function state() {
  return {
    version: 1,
    houses: [{ id: "house-1", name: "Testhaus", images: [], energyDemand: 18, seriesId: "livinghaus" }],
    projects: [{
      id: "project-1",
      name: "Testprojekt",
      listings: [{
        id: "listing-1",
        externalId: "30460-1",
        templateId: "house-1",
        status: "published",
        texts: {
          title: "Unveränderte Überschrift",
          description: "Energieeffizientes I-KON-Konzept\nDas Konzept verbindet Photovoltaikanlage und Batteriespeicher.\n\nDas Haus ist als Effizienzhaus 40 QNG konzipiert und auf einen niedrigen Energieverbrauch ausgerichtet.",
          equipment: "Unverändert.", location: "Unverändert.", other: "Unverändert.",
        },
      }],
    }],
    provider: {},
  };
}

function finding(position, category) {
  return { listingId: "listing-1", projectId: "project-1", field: "Objektbeschreibung", severity: "BLOCK", position, category, textOriginCode: "LISTING_ORIGIN_ONLY" };
}

function scan(input) {
  const text = input.projects[0].listings[0].texts.description;
  return {
    scannedListingCount: 1,
    affectedFieldCount: 2,
    severityCounts: { BLOCK: 4, REVIEW: 0 },
    fieldPlans: [
      { listingId: "listing-1", externalId: "30460-1", projectId: "project-1", field: "Objektbeschreibung", categories: [CLAIM_CATEGORY.GENERIC_ENVIRONMENTAL_CLAIM], proposedTreatment: "MANUAL_REVIEW" },
      { listingId: "listing-1", externalId: "30460-1", projectId: "project-1", field: "Überschrift", categories: [CLAIM_CATEGORY.UNVERIFIED_TECHNICAL_CLAIM], proposedTreatment: "MANUAL_REVIEW" },
    ],
    findings: [
      finding(text.indexOf("Energieeffizientes"), CLAIM_CATEGORY.GENERIC_ENVIRONMENTAL_CLAIM),
      finding(text.indexOf("Photovoltaikanlage"), CLAIM_CATEGORY.UNVERIFIED_TECHNICAL_CLAIM),
      finding(text.indexOf("Batteriespeicher"), CLAIM_CATEGORY.UNVERIFIED_TECHNICAL_CLAIM),
      finding(text.indexOf("Effizienzhaus"), CLAIM_CATEGORY.UNVERIFIED_SUSTAINABILITY_LABEL),
      { listingId: "listing-1", projectId: "project-1", field: "Überschrift", severity: "BLOCK", position: 0, category: CLAIM_CATEGORY.UNVERIFIED_TECHNICAL_CLAIM },
    ],
  };
}

const expectedScope = { activeListings: 1, affectedFields: 2, blockClaims: 4, descriptionFields: 1, descriptionClaims: 4, technicalHeadlineFields: 1, technicalClaims: 1 };

test("analyses paragraphs read-only, clusters repeated text and classifies only against released facts", () => {
  const before = state();
  const analysis = analyzePhase2BDescriptions(before, { scan, expectedScope });
  assert.deepEqual(before, state());
  assert.equal(analysis.entries.length, 3);
  assert.equal(analysis.entries.find((entry) => entry.kind === "heading").action, DESCRIPTION_ACTION.SAFE_REMOVE);
  assert.equal(analysis.entries.find((entry) => /Effizienzhaus/u.test(entry.sentence)).action, DESCRIPTION_ACTION.SAFE_FACT_REPLACEMENT);
  const technicalEntry = analysis.entries.find((entry) => /Photovoltaikanlage/u.test(entry.sentence));
  assert.equal(technicalEntry.action, DESCRIPTION_ACTION.HUMAN_DECISION);
  assert.equal(technicalEntry.cluster, "I_KON_TECHNIK_BAUSTEIN");
  assert.match(formatPhase2BDescriptionAnalysisMarkdown(analysis), /Read-only-Analyse Objektbeschreibungen|SAFE_FACT_REPLACEMENT/u);
});

test("stops on an unexpected audit scope", () => {
  assert.throws(
    () => analyzePhase2BDescriptions(state(), { scan, expectedScope: { ...expectedScope, descriptionClaims: 5 } }),
    /PHASE2B_DESCRIPTION_AUDIT_SCOPE_MISMATCH/u,
  );
});
