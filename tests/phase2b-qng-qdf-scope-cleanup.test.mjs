import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LIVING_HAUS_IKON_TECHNICAL_PACKAGE_ID } from "../listing-claim-policy.mjs";
import {
  applyPhase2BQngQdfScopeCleanup,
  assertPhase2BQngQdfScopeCleanupIntegrity,
  createPhase2BQngQdfScopeCatalogBackup,
  PHASE2B_QNG_QDF_SCOPE_GUARANTEE,
  planPhase2BQngQdfScopeCleanup,
  verifyPhase2BQngQdfScopeCatalogBackup,
} from "../phase2b-qng-qdf-scope-cleanup.mjs";

const expectedCounts = {
  activeListings: 1,
  qngSentenceRemovals: 1,
  qngTitleRemovals: 1,
  energyClassRemovals: 1,
  ikonDuplicateRemovals: 1,
  certificationSentenceReplacements: 1,
};

const QNG_SENTENCE = "Für die zugehörige Hausserie ist ein verifiziertes QNG-Serienmerkmal hinterlegt.";
const FULL_IKON = "Das I-KON-Technikpaket umfasst Photovoltaikanlage, Batteriespeicher, Wärmepumpe und Lüftungsanlage.";
const SHORT_IKON = "Das I-KON-Technikpaket umfasst Wärmepumpe und Lüftungsanlage.";
const CERTIFICATION = "Hinzu kommen – gemäß Leistungsbeschreibung – unter anderem Bauantragsplanung, Bodengutachten, zwei Tage persönliche Ausstattungsberatung, Bauversicherungen, digitale Hausbauakte sowie DGNB-Serienzertifizierung in Gold und QDF-Zertifizierung.";
const REPLACEMENT = "Hinzu kommen – gemäß Leistungsbeschreibung – unter anderem Bauantragsplanung, Bodengutachten, zwei Tage persönliche Ausstattungsberatung, Bauversicherungen und digitale Hausbauakte. Das projektierte Haus gehört zu einer Hausserie mit verifizierter DGNB-Serienzertifizierung.";

function state() {
  return {
    version: 1,
    houses: [{
      id: "house-1",
      name: "Testhaus",
      seriesId: "livinghaus",
      technicalPackage: LIVING_HAUS_IKON_TECHNICAL_PACKAGE_ID,
      energyDemand: 18,
      images: [],
      unrelatedHouseField: "unverändert",
    }],
    projects: [{
      id: "project-1",
      name: "Testprojekt",
      unrelatedProjectField: "unverändert",
      listings: [{
        id: "listing-1",
        externalId: "30460-4",
        templateId: "house-1",
        status: "published",
        unrelatedListingField: "unverändert",
        texts: {
          title: "Sachliche QNG-Serienmerkmal und Überschrift",
          description: `${FULL_IKON} ${SHORT_IKON}\n\nDer geplante Energiebedarf liegt bei 18 kWh/(m²·a), die geplante Energieeffizienzklasse ist A++.\n\n${QNG_SENTENCE}\n\n${CERTIFICATION}`,
          equipment: "Unveränderte Ausstattung.",
          location: "Unveränderte Lage.",
          other: "Unveränderte Hinweise.",
        },
      }],
    }],
    provider: { unrelatedProviderField: "unverändert" },
  };
}

const options = { expectedCounts };

test("removes only the approved QNG, energy, duplicate and certification segments and is idempotent", () => {
  const before = state();
  const plan = planPhase2BQngQdfScopeCleanup(before, options);
  assert.equal(plan.changes.length, 2);
  assert.deepEqual(plan.changes.find((change) => change.field === "description").operations.map((operation) => operation.kind), [
    "qng_sentence_removal",
    "energy_class_removal",
    "ikon_duplicate_removal",
    "certification_sentence_replacement",
  ]);

  const migrated = applyPhase2BQngQdfScopeCleanup(before, options);
  const listing = migrated.state.projects[0].listings[0];
  assert.equal(migrated.changed, true);
  assert.equal(migrated.afterReport.severityCounts.BLOCK, 0);
  assert.equal(migrated.afterReport.severityCounts.REVIEW, 0);
  assert.equal(listing.texts.description, `${FULL_IKON}\n\nDer geplante Energiebedarf liegt bei 18 kWh/(m²·a).\n\n${REPLACEMENT}`);
  assert.equal(listing.texts.title, "Sachliche Überschrift");
  assert.equal(listing.unrelatedListingField, "unverändert");
  assert.equal(migrated.state.houses[0].unrelatedHouseField, "unverändert");
  assert.equal(migrated.state.projects[0].unrelatedProjectField, "unverändert");
  assert.equal(migrated.state.provider.unrelatedProviderField, "unverändert");
  assertPhase2BQngQdfScopeCleanupIntegrity(before, migrated.state, migrated.plan);

  const changedForeignData = structuredClone(migrated.state);
  changedForeignData.projects[0].listings[0].texts.location = "Unzulässig verändert.";
  assert.throws(
    () => assertPhase2BQngQdfScopeCleanupIntegrity(before, changedForeignData, migrated.plan),
    /PHASE2B7_INTEGRITY_FAILED/u,
  );
  const repeated = applyPhase2BQngQdfScopeCleanup(migrated.state, options);
  assert.equal(repeated.changed, false);
  assert.equal(repeated.idempotent, true);
});

test("fails closed if the approved A+/A++ clause is not exactly separable", () => {
  const changed = state();
  changed.projects[0].listings[0].texts.description = changed.projects[0].listings[0].texts.description
    .replace("die geplante Energieeffizienzklasse ist A++.", "die Energieeffizienzklasse A++ ist vorgesehen.");
  assert.throws(
    () => applyPhase2BQngQdfScopeCleanup(changed, options),
    /PHASE2B7_CHANGESET_MISMATCH/u,
  );
});

test("creates a separate byte-identical, restorable Phase-2B.7 backup", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "phase2b-qng-qdf-scope-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const catalogDirectory = join(root, "catalog-v2");
  const backupDirectory = join(root, "backups");
  await mkdir(catalogDirectory, { recursive: true });
  const manifest = { format: 2, savedAt: "2026-09-24T15:12:21.021Z", state: state() };
  await writeFile(join(catalogDirectory, "manifest.json"), JSON.stringify(manifest), "utf8");
  const backup = await createPhase2BQngQdfScopeCatalogBackup({
    catalogDirectory,
    backupDirectory,
    now: "2026-09-24T16:00:00.000Z",
  });
  assert.equal(backup.manifestHash, backup.backupHash);
  assert.deepEqual(
    await verifyPhase2BQngQdfScopeCatalogBackup(backup.backupPath, backup.backupHash),
    {
      backupHash: backup.backupHash,
      savedAt: "2026-09-24T15:12:21.021Z",
      bytes: (await readFile(backup.backupPath)).length,
      restorable: true,
    },
  );
  assert.deepEqual(PHASE2B_QNG_QDF_SCOPE_GUARANTEE, {
    usesAi: false,
    triggersUploads: false,
    createsQdfFactWithoutEvidence: false,
    changesOnlyApprovedTextFields: true,
  });
});
