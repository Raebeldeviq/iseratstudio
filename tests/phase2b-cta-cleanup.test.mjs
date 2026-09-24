import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LEGACY_FIXED_DESCRIPTION_CTA } from "../phase2b-claim-scan.mjs";
import {
  applyPhase2BCtaCleanup,
  assertPhase2BCtaCleanupIntegrity,
  createPhase2BCtaCatalogBackup,
  planPhase2BCtaCleanup,
  verifyPhase2BCtaCatalogBackup,
} from "../phase2b-cta-cleanup.mjs";

function state() {
  return {
    version: 1,
    houses: [{ id: "house-1", name: "Testhaus", images: [] }],
    projects: [{
      id: "project-1",
      name: "Testprojekt",
      listings: [{
        id: "listing-1",
        externalId: "30460-1",
        templateId: "house-1",
        status: "published",
        listingOrigin: "group-source",
        price: 500000,
        texts: {
          title: "DGNB-Gold für dein Zuhause",
          description: `Ein vollständiger, individueller Beschreibungssatz.\n\n${LEGACY_FIXED_DESCRIPTION_CTA}`,
          equipment: "Bereits bereinigte Ausstattung.",
          location: "Unveränderte Lage.",
          other: "Unveränderte Hinweise.",
        },
      }],
    }],
    provider: {},
  };
}

function scan(input) {
  const listing = input.projects[0].listings[0];
  const descriptionNeedsReview = listing.texts.description.includes(LEGACY_FIXED_DESCRIPTION_CTA);
  return {
    fieldPlans: [
      ...(descriptionNeedsReview ? [{
        listingId: listing.id,
        externalId: listing.externalId,
        projectId: "project-1",
        project: "Testprojekt",
        house: "Testhaus",
        field: "Objektbeschreibung",
        proposedTreatment: "MANUAL_REVIEW",
      }] : []),
      {
        listingId: listing.id,
        externalId: listing.externalId,
        projectId: "project-1",
        project: "Testprojekt",
        house: "Testhaus",
        field: "Überschrift",
        proposedTreatment: "MANUAL_REVIEW",
      },
    ],
    findings: [],
  };
}

test("removes only the exact CTA, preserves true-manual text and is idempotent", () => {
  const before = state();
  const plan = planPhase2BCtaCleanup(before, { scan });
  assert.equal(plan.manualFieldCount, 2);
  assert.equal(plan.ctaCandidateCount, 1);
  assert.equal(plan.trueManualCount, 1);
  assert.equal(plan.changes.length, 1);
  assert.equal(plan.changes[0].replacementText, "Ein vollständiger, individueller Beschreibungssatz.");

  const migrated = applyPhase2BCtaCleanup(before, {
    scan,
    expectedCtaCount: 1,
    expectedTrueManualCount: 1,
  });
  assert.equal(migrated.changed, true);
  assert.equal(migrated.state.projects[0].listings[0].texts.description, "Ein vollständiger, individueller Beschreibungssatz.");
  assert.equal(migrated.state.projects[0].listings[0].texts.title, before.projects[0].listings[0].texts.title);
  assertPhase2BCtaCleanupIntegrity(before, migrated.state, migrated.plan);

  const changedManualTitle = structuredClone(migrated.state);
  changedManualTitle.projects[0].listings[0].texts.title = "Unzulässig verändert";
  assert.throws(
    () => assertPhase2BCtaCleanupIntegrity(before, changedManualTitle, migrated.plan),
    /PHASE2B_CTA_TRUE_MANUAL_CHANGED/u,
  );

  const repeated = applyPhase2BCtaCleanup(migrated.state, {
    scan,
    expectedCtaCount: 1,
    expectedTrueManualCount: 1,
  });
  assert.equal(repeated.changed, false);
  assert.equal(repeated.idempotent, true);
});

test("refuses a non-terminal or incomplete CTA removal", () => {
  const input = state();
  input.projects[0].listings[0].texts.description = `${LEGACY_FIXED_DESCRIPTION_CTA}\n\nUnvollständiger Rest`;
  const plan = planPhase2BCtaCleanup(input, { scan });
  assert.equal(plan.changes.length, 0);
  assert.equal(plan.rejected.length, 0);
  assert.throws(
    () => applyPhase2BCtaCleanup(input, { scan, expectedCtaCount: 1, expectedTrueManualCount: 1 }),
    /PHASE2B_CTA_SCOPE_MISMATCH/u,
  );
});

test("allows documented residual claims in a description after removing its CTA", () => {
  const scanWithResidualDescriptionReview = (input) => {
    const listing = input.projects[0].listings[0];
    return {
      fieldPlans: [
        {
          listingId: listing.id,
          externalId: listing.externalId,
          projectId: "project-1",
          project: "Testprojekt",
          house: "Testhaus",
          field: "Objektbeschreibung",
          proposedTreatment: "MANUAL_REVIEW",
        },
        {
          listingId: listing.id,
          externalId: listing.externalId,
          projectId: "project-1",
          project: "Testprojekt",
          house: "Testhaus",
          field: "Überschrift",
          proposedTreatment: "MANUAL_REVIEW",
        },
      ],
      findings: [],
    };
  };
  const migrated = applyPhase2BCtaCleanup(state(), {
    scan: scanWithResidualDescriptionReview,
    expectedCtaCount: 1,
    expectedTrueManualCount: 1,
  });
  assert.equal(migrated.changed, true);
  assert.equal(migrated.afterReport.fieldPlans.filter((plan) => plan.field === "Objektbeschreibung").length, 1);

  const repeated = applyPhase2BCtaCleanup(migrated.state, {
    scan: scanWithResidualDescriptionReview,
    expectedCtaCount: 1,
    expectedTrueManualCount: 1,
  });
  assert.equal(repeated.changed, false);
  assert.equal(repeated.idempotent, true);
});

test("creates a separate byte-identical, verifiable CTA backup without overwriting it", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "phase2b-cta-backup-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const catalogDirectory = join(root, "catalog-v2");
  const backupDirectory = join(root, "backups");
  await mkdir(catalogDirectory, { recursive: true });
  const manifest = { format: 2, savedAt: "2026-09-24T09:00:00.000Z", state: state() };
  await writeFile(join(catalogDirectory, "manifest.json"), JSON.stringify(manifest), "utf8");

  const backup = await createPhase2BCtaCatalogBackup({
    catalogDirectory,
    backupDirectory,
    now: "2026-09-24T10:00:00.000Z",
  });
  assert.equal(backup.manifestHash, backup.backupHash);
  assert.deepEqual(await verifyPhase2BCtaCatalogBackup(backup.backupPath, backup.backupHash), {
    backupHash: backup.backupHash,
    savedAt: "2026-09-24T09:00:00.000Z",
    bytes: (await readFile(backup.backupPath)).length,
    restorable: true,
  });
  await assert.rejects(
    createPhase2BCtaCatalogBackup({ catalogDirectory, backupDirectory, now: "2026-09-24T10:00:00.000Z" }),
    { code: "EEXIST" },
  );
});
