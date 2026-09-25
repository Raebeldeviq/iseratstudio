import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadCatalogManifest } from "../catalog-store.mjs";
import {
  applyFixedListingCopyMigration,
  assertFixedListingCopyMigrationIntegrity,
  createFixedListingCopyMigrationCatalogBackup,
  FIXED_LISTING_COPY_MIGRATION_GUARANTEE,
  planFixedListingCopyMigration,
  runFixedListingCopyMigration,
  verifyFixedListingCopyMigrationCatalogBackup,
} from "../fixed-listing-copy-migration.mjs";
import {
  LIVING_HAUS_IKON_TECHNICAL_PACKAGE_ID,
  LIVING_HAUS_SERIES_ID,
} from "../listing-claim-policy.mjs";
import { PREVIOUS_STATIC_COPY } from "../listing-copy.mjs";

const expectedCounts = {
  activeListings: 1,
  changedFields: 5,
  changedFieldsPerListing: 5,
  alreadyCorrectTerms: 1,
  manualDifferences: 0,
};

const options = { expectedCounts, now: "2026-09-25T12:00:00.000Z" };

function state() {
  return {
    version: 1,
    houses: [{
      id: "house-1",
      name: "SUN 151 V8",
      seriesId: LIVING_HAUS_SERIES_ID,
      technicalPackage: LIVING_HAUS_IKON_TECHNICAL_PACKAGE_ID,
      images: [],
      unrelatedHouseField: "unverändert",
    }],
    projects: [{
      id: "project-1",
      name: "Testprojekt",
      city: "Potsdam",
      plotId: "plot-project-1",
      street: "",
      houseNumber: "",
      zip: "",
      plotArea: 0,
      plotPrice: 0,
      isActive: true,
      unrelatedProjectField: "unverändert",
      listings: [{
        id: "listing-1",
        externalId: "30460-1",
        templateId: "house-1",
        status: "draft",
        statusMessage: "Entwurf",
        unrelatedListingField: "unverändert",
        projectingSettings: { kfw40: true, kfw55: true, energyClass: "A++" },
        texts: {
          title: "Unveränderter Titel",
          description: "Unveränderte Beschreibung",
          equipment: PREVIOUS_STATIC_COPY.equipment,
          location: "Unveränderte Lage",
          other: PREVIOUS_STATIC_COPY.other,
        },
        staticTexts: {
          provision: PREVIOUS_STATIC_COPY.provision,
          annotation: PREVIOUS_STATIC_COPY.annotation,
          terms: PREVIOUS_STATIC_COPY.terms,
          recommendation: PREVIOUS_STATIC_COPY.recommendation,
        },
      }],
    }],
    provider: { company: "Test GmbH" },
    plots: [{
      id: "plot-project-1",
      street: "",
      houseNumber: "",
      postalCode: "",
      city: "Potsdam",
      plotSizeSqm: 0,
      purchasePrice: 0,
      regionalNotes: "",
      sourceInternalId: "",
      listingUrl: "",
      sourceName: "",
      sourceStatus: "",
      sourceFirstSeenAt: "",
      sourceLastCheckedAt: "",
      sourceExposeFilename: "",
      syncedAt: "",
      exposeFileReference: "",
      exposeFilename: "",
      exposeUploadedAt: "",
      createdAt: "2026-09-25T12:00:00.000Z",
      updatedAt: "2026-09-25T12:00:00.000Z",
      isActive: true,
    }],
    uploadHistory: [],
    dataSchemaVersion: 4,
    promotionImage: null,
    promotionImages: [],
    promotionUsage: [],
    plotSchemaVersion: 2,
    selectedPlotIds: [],
  };
}

test("plans exactly the five approved static fields, preserves protected listing data and is idempotent", () => {
  const before = state();
  const plan = planFixedListingCopyMigration(before, options);
  assert.equal(plan.changed, true);
  assert.equal(plan.changedFieldCount, 5);
  assert.deepEqual(plan.changes[0].fields.map((field) => field.field), [
    "equipment",
    "other",
    "provision",
    "annotation",
    "recommendation",
  ]);

  const migrated = applyFixedListingCopyMigration(before, options);
  const listing = migrated.state.projects[0].listings[0];
  assert.equal(migrated.changed, true);
  assert.equal(listing.texts.title, "Unveränderter Titel");
  assert.equal(listing.texts.description, "Unveränderte Beschreibung");
  assert.equal(listing.texts.location, "Unveränderte Lage");
  assert.deepEqual(listing.projectingSettings, { kfw40: true, kfw55: true, energyClass: "A++" });
  assert.equal(listing.staticTexts.terms, PREVIOUS_STATIC_COPY.terms);
  assert.deepEqual(
    Object.fromEntries(Object.entries(listing.staticCopySources).filter(([field]) => field !== "terms")),
    {
      equipment: "standard",
      other: "standard",
      provision: "standard",
      annotation: "standard",
      recommendation: "standard",
    },
  );
  assert.equal(Object.hasOwn(listing.staticCopySources, "terms"), false);
  assert.equal(listing.staticCopyVersion, 1);
  assert.equal(listing.unrelatedListingField, "unverändert");
  assert.equal(migrated.state.houses[0].unrelatedHouseField, "unverändert");
  assert.equal(migrated.state.projects[0].unrelatedProjectField, "unverändert");
  assertFixedListingCopyMigrationIntegrity(before, migrated.state, plan);

  const secondRun = applyFixedListingCopyMigration(migrated.state, options);
  assert.equal(secondRun.changed, false);
  assert.equal(secondRun.idempotent, true);
});

test("rejects every change beyond the approved static fields", () => {
  const before = state();
  const migrated = applyFixedListingCopyMigration(before, options);
  const unexpectedTitle = structuredClone(migrated.state);
  unexpectedTitle.projects[0].listings[0].texts.title = "Unzulässig geändert";
  assert.throws(
    () => assertFixedListingCopyMigrationIntegrity(before, unexpectedTitle, migrated.plan),
    /FIXED_COPY_MIGRATION_PROTECTED_FIELD_CHANGED/u,
  );

  const unexpectedField = structuredClone(migrated.state);
  unexpectedField.projects[0].listings[0].staticTexts.unrelated = "unzulässig";
  assert.throws(
    () => assertFixedListingCopyMigrationIntegrity(before, unexpectedField, migrated.plan),
    /FIXED_COPY_MIGRATION_INTEGRITY_FAILED/u,
  );
});

test("fails closed for a manual source instead of inferring migration authority", () => {
  const manual = state();
  manual.projects[0].listings[0].staticCopySources = { equipment: "manual" };
  assert.throws(
    () => planFixedListingCopyMigration(manual, options),
    /FIXED_COPY_MIGRATION_MANUAL_DIFFERENCE/u,
  );
});

test("creates a byte-identical restorable backup and commits the local snapshot once", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "fixed-listing-copy-migration-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const catalogDirectory = join(root, "catalog-v2");
  const backupDirectory = join(root, "backups");
  await mkdir(catalogDirectory, { recursive: true });
  await writeFile(join(catalogDirectory, "manifest.json"), JSON.stringify({
    format: 2,
    savedAt: "2026-09-25T11:00:00.000Z",
    state: state(),
  }), "utf8");

  const backup = await createFixedListingCopyMigrationCatalogBackup({
    catalogDirectory,
    backupDirectory,
    now: options.now,
  });
  assert.equal(backup.manifestHash, backup.backupHash);
  assert.deepEqual(
    await verifyFixedListingCopyMigrationCatalogBackup(backup.backupPath, backup.backupHash),
    {
      backupHash: backup.backupHash,
      savedAt: "2026-09-25T11:00:00.000Z",
      bytes: (await readFile(backup.backupPath)).length,
      restorable: true,
    },
  );

  const runOptions = { ...options, now: "2026-09-25T12:01:00.000Z", catalogDirectory, backupDirectory };
  const result = await runFixedListingCopyMigration(runOptions);
  assert.equal(result.changed, true);
  assert.equal(result.idempotent, false);
  assert.equal(result.recovery.restorable, true);
  assert.equal(result.plan.changedFieldCount, 5);
  const persisted = await loadCatalogManifest(catalogDirectory);
  assert.equal(persisted.stored, true);
  assert.equal(persisted.state.projects[0].listings[0].staticCopyVersion, 1);
  assert.equal((await runFixedListingCopyMigration(runOptions)).idempotent, true);
  assert.deepEqual(FIXED_LISTING_COPY_MIGRATION_GUARANTEE, {
    usesAi: false,
    triggersUploads: false,
    triggersFtps: false,
    triggersOpenImmoTransfer: false,
    changesOnlyActiveListings: true,
    changesOnlyApprovedStaticFields: true,
    leavesTitlesDescriptionsLocationsAndProjectingDataUntouched: true,
    verifiesBackupAndIdempotence: true,
  });
});
