import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CLAIM_CATEGORY } from "../listing-claim-policy.mjs";
import {
  applyPhase2BDescriptionSafeCleanup,
  assertPhase2BDescriptionSafeCleanupIntegrity,
  createPhase2BDescriptionSafeCleanupCatalogBackup,
  planPhase2BDescriptionSafeCleanup,
  verifyPhase2BDescriptionSafeCleanupCatalogBackup,
} from "../phase2b-description-safe-cleanup.mjs";

const expectedCounts = {
  environmentalHeadlines: 1,
  qngReplacements: 1,
  energyClassRemovals: 1,
  protectedHumanSegments: 1,
  changedFields: 1,
};

const expectedInitialScope = {
  activeListings: 1,
  affectedFields: 1,
  blockClaims: 5,
  descriptionFields: 1,
  descriptionClaims: 5,
  technicalHeadlineFields: 0,
  technicalClaims: 0,
};

const expectedFinalScope = {
  activeListings: 1,
  affectedFields: 1,
  blockClaims: 2,
  descriptionFields: 1,
  descriptionClaims: 2,
  technicalHeadlineFields: 0,
  technicalClaims: 0,
};

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
          title: "Unveränderte Techniküberschrift",
          description: "Energieeffizientes I-KON-Konzept\nDas Konzept verbindet eine moderne Gebäudehülle mit zeitgemäßer Haustechnik, Photovoltaikanlage und Batteriespeicher.\n\nDas Haus ist als Effizienzhaus 40 QNG konzipiert.\n\nDer geplante Energiebedarf liegt bei 18 kWh/(m²·a), die geplante Energieeffizienzklasse ist A++.",
          equipment: "Unveränderte Ausstattung.",
          location: "Unveränderte Lage.",
          other: "Unveränderte Hinweise.",
        },
      }],
    }],
    provider: {},
  };
}

function finding(listing, text, needle, category) {
  const position = text.indexOf(needle);
  if (position < 0) return undefined;
  return {
    listingId: listing.id,
    externalId: listing.externalId,
    projectId: "project-1",
    field: "Objektbeschreibung",
    severity: "BLOCK",
    position,
    category,
    textOriginCode: "LISTING_ORIGIN_ONLY",
  };
}

function scan(input) {
  const listing = input.projects[0].listings[0];
  const text = listing.texts.description;
  const findings = [
    finding(listing, text, "Energieeffizientes I-KON-Konzept", CLAIM_CATEGORY.GENERIC_ENVIRONMENTAL_CLAIM),
    finding(listing, text, "Photovoltaikanlage", CLAIM_CATEGORY.UNVERIFIED_TECHNICAL_CLAIM),
    finding(listing, text, "Batteriespeicher", CLAIM_CATEGORY.UNVERIFIED_TECHNICAL_CLAIM),
    finding(listing, text, "Effizienzhaus 40 QNG", CLAIM_CATEGORY.UNVERIFIED_SUSTAINABILITY_LABEL),
    finding(listing, text, "Energieeffizienzklasse ist A++", CLAIM_CATEGORY.UNVERIFIED_TECHNICAL_CLAIM),
  ].filter(Boolean);
  return {
    scannedListingCount: 1,
    affectedFieldCount: findings.length ? 1 : 0,
    severityCounts: { BLOCK: findings.length, REVIEW: 0 },
    fieldPlans: findings.length ? [{
      listingId: listing.id,
      externalId: listing.externalId,
      projectId: "project-1",
      project: "Testprojekt",
      house: "Testhaus",
      field: "Objektbeschreibung",
      categories: [...new Set(findings.map((entry) => entry.category))],
      proposedTreatment: "MANUAL_REVIEW",
    }] : [],
    findings,
  };
}

const options = { scan, expectedCounts, expectedInitialScope, expectedFinalScope };

test("removes exactly the approved segments, preserves human text and is idempotent", () => {
  const before = state();
  const plan = planPhase2BDescriptionSafeCleanup(before, options);
  assert.equal(plan.changes.length, 1);
  assert.equal(plan.changes[0].segments.length, 3);
  assert.deepEqual(plan.changes[0].segments.map((segment) => segment.action), [
    "SAFE_REMOVE",
    "SAFE_REMOVE",
    "SAFE_PARTIAL_REMOVE",
  ]);
  assert.equal(plan.protectedSnapshots.length, 1);

  const migrated = applyPhase2BDescriptionSafeCleanup(before, options);
  assert.equal(migrated.changed, true);
  assert.equal(migrated.idempotent, false);
  assert.equal(migrated.state.projects[0].listings[0].texts.description, "Das Konzept verbindet eine moderne Gebäudehülle mit zeitgemäßer Haustechnik, Photovoltaikanlage und Batteriespeicher.\n\nFür die derzeitige Planung ist ein Endenergiebedarf von 18 kWh/(m²·a) vorgesehen.");
  assert.equal(migrated.state.projects[0].listings[0].texts.title, before.projects[0].listings[0].texts.title);
  assert.equal(migrated.state.projects[0].listings[0].texts.equipment, before.projects[0].listings[0].texts.equipment);
  assertPhase2BDescriptionSafeCleanupIntegrity(before, migrated.state, migrated.plan);

  const changedHumanText = structuredClone(migrated.state);
  changedHumanText.projects[0].listings[0].texts.description = changedHumanText.projects[0].listings[0].texts.description.replace("Batteriespeicher", "anderer Speicher");
  assert.throws(
    () => assertPhase2BDescriptionSafeCleanupIntegrity(before, changedHumanText, migrated.plan),
    /PHASE2B_DESCRIPTION_HUMAN_CHANGED/u,
  );

  const repeated = applyPhase2BDescriptionSafeCleanup(migrated.state, options);
  assert.equal(repeated.changed, false);
  assert.equal(repeated.idempotent, true);
});

test("fails closed if an approved segment no longer matches exactly", () => {
  const changed = state();
  changed.projects[0].listings[0].texts.description = changed.projects[0].listings[0].texts.description.replace("Energieeffizienzklasse ist A++", "Energieeffizienzklasse ist A+");
  assert.throws(
    () => applyPhase2BDescriptionSafeCleanup(changed, options),
    /PHASE2B_DESCRIPTION_AUDIT_SCOPE_MISMATCH/u,
  );
});

test("creates a separate byte-identical and restorable backup without overwriting it", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "phase2b-description-safe-cleanup-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const catalogDirectory = join(root, "catalog-v2");
  const backupDirectory = join(root, "backups");
  await mkdir(catalogDirectory, { recursive: true });
  const manifest = { format: 2, savedAt: "2026-09-24T12:45:00.000Z", state: state() };
  await writeFile(join(catalogDirectory, "manifest.json"), JSON.stringify(manifest), "utf8");

  const backup = await createPhase2BDescriptionSafeCleanupCatalogBackup({
    catalogDirectory,
    backupDirectory,
    now: "2026-09-24T15:00:00.000Z",
  });
  assert.equal(backup.manifestHash, backup.backupHash);
  assert.deepEqual(
    await verifyPhase2BDescriptionSafeCleanupCatalogBackup(backup.backupPath, backup.backupHash),
    {
      backupHash: backup.backupHash,
      savedAt: "2026-09-24T12:45:00.000Z",
      bytes: (await readFile(backup.backupPath)).length,
      restorable: true,
    },
  );
  await assert.rejects(
    createPhase2BDescriptionSafeCleanupCatalogBackup({
      catalogDirectory,
      backupDirectory,
      now: "2026-09-24T15:00:00.000Z",
    }),
    { code: "EEXIST" },
  );
});
