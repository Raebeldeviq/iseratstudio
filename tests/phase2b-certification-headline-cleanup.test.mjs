import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CLAIM_CATEGORY } from "../listing-claim-policy.mjs";
import {
  applyPhase2BCertificationHeadlineCleanup,
  createPhase2BCertificationCatalogBackup,
  planPhase2BCertificationHeadlineCleanup,
  verifyPhase2BCertificationCatalogBackup,
} from "../phase2b-certification-headline-cleanup.mjs";

function state() {
  return {
    version: 1,
    houses: [{ id: "house-1", name: "Testhaus", images: [], seriesId: "livinghaus" }],
    projects: [{
      id: "project-1",
      name: "Testprojekt",
      listings: [
        { id: "dgnb", externalId: "30460-1", templateId: "house-1", status: "published", texts: { title: "Haus: DGNB-Gold und 30 Jahre Garantie!", description: "Unverändert.", equipment: "Unverändert.", location: "Unverändert.", other: "Unverändert." } },
        { id: "qng", externalId: "30460-2", templateId: "house-1", status: "published", texts: { title: "Haus: QNG-Potenzial und Festpreis!", description: "Unverändert.", equipment: "Unverändert.", location: "Unverändert.", other: "Unverändert." } },
        { id: "technical", externalId: "30460-3", templateId: "house-1", status: "published", texts: { title: "Haus: Wärmepumpe und Komfortlüftung!", description: "Unverändert.", equipment: "Unverändert.", location: "Unverändert.", other: "Unverändert." } },
      ],
    }],
    provider: {},
  };
}

function scan(input) {
  const plans = [];
  for (const listing of input.projects[0].listings) {
    if (listing.texts.title.includes("DGNB-Gold")) plans.push({ listingId: listing.id, externalId: listing.externalId, projectId: "project-1", project: "Testprojekt", house: "Testhaus", field: "Überschrift", categories: [CLAIM_CATEGORY.UNVERIFIED_CERTIFICATION], proposedTreatment: "MANUAL_REVIEW" });
    if (listing.texts.title.includes("QNG-Potenzial")) plans.push({ listingId: listing.id, externalId: listing.externalId, projectId: "project-1", project: "Testprojekt", house: "Testhaus", field: "Überschrift", categories: [CLAIM_CATEGORY.UNVERIFIED_SUSTAINABILITY_LABEL], proposedTreatment: "MANUAL_REVIEW" });
    if (listing.texts.title.includes("Wärmepumpe")) plans.push({ listingId: listing.id, externalId: listing.externalId, projectId: "project-1", project: "Testprojekt", house: "Testhaus", field: "Überschrift", categories: [CLAIM_CATEGORY.UNVERIFIED_TECHNICAL_CLAIM], proposedTreatment: "MANUAL_REVIEW" });
  }
  return { scannedListingCount: 44, treatmentCounts: { MANUAL_REVIEW: plans.length }, fieldPlans: plans, findings: [] };
}

const expected = { scan, expectedDgnbCount: 1, expectedQngCount: 1, expectedTechnicalCount: 1, expectedManualFieldCount: 3 };

test("replaces DGNB but rejects the historical QNG phrase without a precise QNG fact", () => {
  const before = state();
  const plan = planPhase2BCertificationHeadlineCleanup(before, expected);
  assert.equal(plan.dgnbCount, 1);
  assert.equal(plan.qngCount, 1);
  assert.equal(plan.technicalCount, 1);
  assert.equal(plan.changes.length, 1);
  assert.equal(plan.rejected.length, 1);
  assert.equal(plan.changes[0].replacementText, "Haus: DGNB-Serienzertifizierung und 30 Jahre Garantie!");
  assert.match(plan.rejected[0].rejectedReason, /QNG-Serienmerkmal/u);
  assert.throws(
    () => applyPhase2BCertificationHeadlineCleanup(before, expected),
    /PHASE2B_CERTIFICATION_VALIDATION_FAILED/u,
  );
});

test("fails closed when the exact approved phrase is absent", () => {
  const input = state();
  input.projects[0].listings[0].texts.title = "Haus: DGNB-Silber und 30 Jahre Garantie!";
  const unsafeScan = (value) => ({
    ...scan(value),
    fieldPlans: [{ listingId: "dgnb", externalId: "30460-1", projectId: "project-1", project: "Testprojekt", house: "Testhaus", field: "Überschrift", categories: [CLAIM_CATEGORY.UNVERIFIED_CERTIFICATION], proposedTreatment: "MANUAL_REVIEW" }, ...scan(value).fieldPlans.filter((plan) => plan.listingId !== "dgnb")],
  });
  assert.throws(
    () => applyPhase2BCertificationHeadlineCleanup(input, { ...expected, scan: unsafeScan }),
    /PHASE2B_CERTIFICATION_SCOPE_MISMATCH/u,
  );
});

test("creates a separate byte-identical, verifiable backup without overwriting it", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "phase2b-certification-backup-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const catalogDirectory = join(root, "catalog-v2");
  const backupDirectory = join(root, "backups");
  await mkdir(catalogDirectory, { recursive: true });
  const manifest = { format: 2, savedAt: "2026-09-24T12:00:00.000Z", state: state() };
  await writeFile(join(catalogDirectory, "manifest.json"), JSON.stringify(manifest), "utf8");
  const backup = await createPhase2BCertificationCatalogBackup({ catalogDirectory, backupDirectory, now: "2026-09-24T12:30:00.000Z" });
  assert.equal(backup.manifestHash, backup.backupHash);
  assert.deepEqual(await verifyPhase2BCertificationCatalogBackup(backup.backupPath, backup.backupHash), {
    backupHash: backup.backupHash,
    savedAt: "2026-09-24T12:00:00.000Z",
    bytes: (await readFile(backup.backupPath)).length,
    restorable: true,
  });
  await assert.rejects(
    createPhase2BCertificationCatalogBackup({ catalogDirectory, backupDirectory, now: "2026-09-24T12:30:00.000Z" }),
    { code: "EEXIST" },
  );
});
