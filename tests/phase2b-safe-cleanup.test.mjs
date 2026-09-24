import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { FIXED_EQUIPMENT_TEXT } from "../listing-copy.mjs";
import {
  applyPhase2BSafeCleanup,
  assertPhase2BSafeCleanupIntegrity,
  createPhase2BSafeCatalogBackup,
  planPhase2BSafeCleanup,
  verifyPhase2BSafeCatalogBackup,
} from "../phase2b-safe-cleanup.mjs";
import { cleanupStudioState } from "../data-integrity.mjs";

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
          title: "Nachhaltiges Eigenheim",
          description: "Individueller Freitext bleibt unverändert.",
          equipment: "Historischer erzwungener Ausstattungstext.",
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
  const safe = listing.texts.equipment === "Historischer erzwungener Ausstattungstext.";
  return {
    fieldPlans: safe ? [{
      listingId: listing.id,
      externalId: listing.externalId,
      projectId: "project-1",
      project: "Testprojekt",
      house: "Testhaus",
      field: "Ausstattung",
      textOrigins: ["Exakt erkannter historischer Standardbaustein im gesamten Feld."],
      proposedTreatment: "SAFE_DETERMINISTIC_REPLACEMENT",
    }] : [],
    findings: [],
  };
}

test("plans and applies only the approved equipment field, then stays idempotent", () => {
  const before = state();
  const plan = planPhase2BSafeCleanup(before, { scan });
  assert.equal(plan.safeFieldCount, 1);
  assert.equal(plan.changes.length, 1);
  assert.equal(plan.changes[0].field, "Ausstattung");
  assert.equal(plan.changes[0].previousText, "Historischer erzwungener Ausstattungstext.");
  assert.equal(plan.changes[0].replacementText, FIXED_EQUIPMENT_TEXT);

  const migrated = applyPhase2BSafeCleanup(before, { scan, expectedSafeFieldCount: 1 });
  assert.equal(migrated.changed, true);
  assert.equal(migrated.state.projects[0].listings[0].texts.equipment, FIXED_EQUIPMENT_TEXT);
  assert.equal(migrated.state.projects[0].listings[0].texts.title, before.projects[0].listings[0].texts.title);
  assert.equal(migrated.state.projects[0].listings[0].texts.description, before.projects[0].listings[0].texts.description);
  assertPhase2BSafeCleanupIntegrity(before, migrated.state, migrated.plan.changes);

  const second = applyPhase2BSafeCleanup(migrated.state, { scan, expectedSafeFieldCount: 1 });
  assert.equal(second.changed, false);
  assert.equal(second.idempotent, true);
  assert.strictEqual(second.state, migrated.state);
});

test("refuses an unrecognized SAFE field instead of widening the migration", () => {
  const input = state();
  const unsafeScan = () => ({
    fieldPlans: [{
      listingId: "listing-1",
      projectId: "project-1",
      project: "Testprojekt",
      house: "Testhaus",
      field: "Überschrift",
      textOrigins: ["Unzulässig"],
      proposedTreatment: "SAFE_DETERMINISTIC_REPLACEMENT",
    }],
    findings: [],
  });
  const plan = planPhase2BSafeCleanup(input, { scan: unsafeScan });
  assert.equal(plan.changes.length, 0);
  assert.equal(plan.rejected.length, 1);
  assert.throws(
    () => applyPhase2BSafeCleanup(input, { scan: unsafeScan, expectedSafeFieldCount: 1 }),
    /PHASE2B_SAFE_VALIDATION_FAILED/u,
  );
  assert.equal(input.projects[0].listings[0].texts.title, "Nachhaltiges Eigenheim");
});

test("the isolated migration fixture needs no implicit catalog normalization", () => {
  const stabilized = cleanupStudioState(state(), { apply: true, now: "2026-09-24T10:00:00.000Z" }).state;
  const normalized = cleanupStudioState(stabilized, { apply: true, now: "2026-09-24T10:00:00.000Z" });
  assert.equal(normalized.changed, false);
});

test("creates a byte-identical, verifiable backup without overwriting it", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "phase2b-safe-backup-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const catalogDirectory = join(root, "catalog-v2");
  const backupDirectory = join(root, "backups");
  await mkdir(catalogDirectory, { recursive: true });
  const manifest = { format: 2, savedAt: "2026-09-24T09:00:00.000Z", state: state() };
  await writeFile(join(catalogDirectory, "manifest.json"), JSON.stringify(manifest), "utf8");

  const backup = await createPhase2BSafeCatalogBackup({
    catalogDirectory,
    backupDirectory,
    now: "2026-09-24T10:00:00.000Z",
  });
  assert.equal(backup.manifestHash, backup.backupHash);
  assert.deepEqual(await verifyPhase2BSafeCatalogBackup(backup.backupPath, backup.backupHash), {
    backupHash: backup.backupHash,
    savedAt: "2026-09-24T09:00:00.000Z",
    bytes: (await readFile(backup.backupPath)).length,
    restorable: true,
  });
  await assert.rejects(
    createPhase2BSafeCatalogBackup({ catalogDirectory, backupDirectory, now: "2026-09-24T10:00:00.000Z" }),
    { code: "EEXIST" },
  );
});
