import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CLAIM_CATEGORY,
  collectListingFacts,
  FACT_SCOPE,
  FACT_SOURCE,
  FACT_STATUS,
  isLivingHausIKonTechnicalPackage,
  LIVING_HAUS_IKON_TECHNICAL_PACKAGE_ID,
  technicalPackageFactSentence,
  validateListingClaims,
} from "../listing-claim-policy.mjs";
import {
  applyPhase2BIKonTechnicalFactsCleanup,
  assertPhase2BIKonTechnicalFactsCleanupIntegrity,
  createPhase2BIKonTechnicalFactsCatalogBackup,
  planPhase2BIKonTechnicalFactsCleanup,
  verifyPhase2BIKonTechnicalFactsCatalogBackup,
} from "../phase2b-ikon-technical-facts-cleanup.mjs";
import { createEmptyHouse } from "../studio-defaults.mjs";

const expectedCounts = {
  ikonSegments: 1,
  heatingVentilationSegments: 1,
  technicalTitles: 1,
  certificationSegments: 1,
  houseTemplates: 1,
};

const expectedInitialScope = {
  activeListings: 1,
  affectedFields: 2,
  blockClaims: 7,
  descriptionFields: 1,
  descriptionClaims: 5,
  technicalHeadlineFields: 1,
  technicalClaims: 2,
};

const expectedFinalScope = {
  activeListings: 1,
  affectedFields: 1,
  blockClaims: 1,
  descriptionFields: 1,
  descriptionClaims: 1,
  technicalHeadlineFields: 0,
  technicalClaims: 0,
};

function state() {
  return {
    version: 1,
    houses: [{
      id: "house-ikon",
      name: "I-KON-Testhaus",
      useStandardPackage: true,
      heatingType: "Luft-Wasser-Wärmepumpe",
      images: [],
      unrelatedHouseField: "unverändert",
    }, {
      id: "house-foreign",
      name: "Fremdhaus",
      useStandardPackage: false,
      images: [],
    }],
    projects: [{
      id: "project-ikon",
      name: "I-KON-Testprojekt",
      unrelatedProjectField: "unverändert",
      listings: [{
        id: "listing-ikon",
        externalId: "30460-test",
        templateId: "house-ikon",
        status: "published",
        unrelatedListingField: "unverändert",
        texts: {
          title: "Testhaus mit Wärmepumpe und Komfortlüftung",
          description: "Das I-KON-Konzept umfasst Photovoltaikanlage und Batteriespeicher.\n\nEine Luft-Wasser-Wärmepumpe und Komfortlüftung sind vorgesehen.\n\nDGNB-Serienzertifizierung in Gold und QDF-Zertifizierung.",
          equipment: "Unveränderte Ausstattung.",
          location: "Unveränderte Lage.",
          other: "Unveränderte Hinweise.",
        },
      }],
    }],
    provider: { unrelatedProviderField: "unverändert" },
  };
}

function issue(listing, project, field, text, needle, category) {
  const position = text.indexOf(needle);
  if (position < 0) return undefined;
  return {
    listingId: listing.id,
    externalId: listing.externalId,
    projectId: project.id,
    field,
    severity: "BLOCK",
    position,
    category,
    textOriginCode: "LISTING_ORIGIN_ONLY",
  };
}

function scan(input) {
  const project = input.projects[0];
  const listing = project.listings[0];
  const house = input.houses.find((candidate) => candidate.id === listing.templateId);
  const description = listing.texts.description;
  const title = listing.texts.title;
  const findings = [
    house.technicalPackage ? undefined : issue(listing, project, "Objektbeschreibung", description, "Photovoltaikanlage", CLAIM_CATEGORY.UNVERIFIED_TECHNICAL_CLAIM),
    house.technicalPackage ? undefined : issue(listing, project, "Objektbeschreibung", description, "Batteriespeicher", CLAIM_CATEGORY.UNVERIFIED_TECHNICAL_CLAIM),
    house.technicalPackage ? undefined : issue(listing, project, "Objektbeschreibung", description, "Luft-Wasser-Wärmepumpe", CLAIM_CATEGORY.UNVERIFIED_TECHNICAL_CLAIM),
    house.technicalPackage ? undefined : issue(listing, project, "Objektbeschreibung", description, "Komfortlüftung", CLAIM_CATEGORY.UNVERIFIED_TECHNICAL_CLAIM),
    issue(listing, project, "Objektbeschreibung", description, "DGNB-Serienzertifizierung", CLAIM_CATEGORY.UNVERIFIED_CERTIFICATION),
    house.technicalPackage ? undefined : issue(listing, project, "Überschrift", title, "Wärmepumpe", CLAIM_CATEGORY.UNVERIFIED_TECHNICAL_CLAIM),
    house.technicalPackage ? undefined : issue(listing, project, "Überschrift", title, "Komfortlüftung", CLAIM_CATEGORY.UNVERIFIED_TECHNICAL_CLAIM),
  ].filter(Boolean);
  const groups = findings.reduce((result, finding) => {
    const key = `${finding.listingId}:${finding.field}`;
    const entries = result.get(key) || [];
    entries.push(finding);
    result.set(key, entries);
    return result;
  }, new Map());
  const fieldPlans = [...groups.values()].map((entries) => ({
    listingId: listing.id,
    externalId: listing.externalId,
    projectId: project.id,
    project: project.name,
    house: "I-KON-Testhaus",
    field: entries[0].field,
    categories: [...new Set(entries.map((entry) => entry.category))],
    proposedTreatment: "MANUAL_REVIEW",
  }));
  return {
    scannedListingCount: 1,
    affectedFieldCount: fieldPlans.length,
    severityCounts: { BLOCK: findings.length, REVIEW: 0 },
    fieldPlans,
    findings,
  };
}

const options = { scan, expectedCounts, expectedInitialScope, expectedFinalScope };

test("models the four I-KON facts only for the explicit technical package context", () => {
  const facts = collectListingFacts({ house: { technicalPackage: LIVING_HAUS_IKON_TECHNICAL_PACKAGE_ID } });
  assert.deepEqual(facts.filter((fact) => fact.scope === FACT_SCOPE.TECHNICAL_PACKAGE).map((fact) => ({
    key: fact.key,
    value: fact.value,
    sourceKind: fact.sourceKind,
    status: fact.status,
    verified: fact.verified,
  })), [
    { key: "photovoltaic", value: "Photovoltaikanlage", sourceKind: FACT_SOURCE.OPTIONAL_PACKAGE, status: FACT_STATUS.VERIFIED, verified: true },
    { key: "battery_storage", value: "Batteriespeicher", sourceKind: FACT_SOURCE.OPTIONAL_PACKAGE, status: FACT_STATUS.VERIFIED, verified: true },
    { key: "heat_pump", value: "Wärmepumpe", sourceKind: FACT_SOURCE.OPTIONAL_PACKAGE, status: FACT_STATUS.VERIFIED, verified: true },
    { key: "ventilation", value: "Lüftungsanlage", sourceKind: FACT_SOURCE.OPTIONAL_PACKAGE, status: FACT_STATUS.VERIFIED, verified: true },
  ]);
  assert.ok(facts.filter((fact) => fact.scope === FACT_SCOPE.TECHNICAL_PACKAGE)
    .every((fact) => isLivingHausIKonTechnicalPackage(fact.packageId)));
  assert.deepEqual(collectListingFacts({ house: { technicalPackage: "foreign-package" } }), []);
  const unverifiedNewHouse = createEmptyHouse();
  assert.equal(unverifiedNewHouse.technicalPackage, undefined);
  assert.equal(collectListingFacts({ house: unverifiedNewHouse })
    .some((fact) => fact.scope === FACT_SCOPE.TECHNICAL_PACKAGE), false);
  assert.equal(technicalPackageFactSentence({ house: { technicalPackage: LIVING_HAUS_IKON_TECHNICAL_PACKAGE_ID } }), "Das I-KON-Technikpaket umfasst Photovoltaikanlage, Batteriespeicher, Wärmepumpe und Lüftungsanlage.");
  assert.equal(technicalPackageFactSentence({ house: { technicalPackage: LIVING_HAUS_IKON_TECHNICAL_PACKAGE_ID } }, ["heat_pump", "ventilation"]), "Das I-KON-Technikpaket umfasst Wärmepumpe und Lüftungsanlage.");
});

test("allows only package-covered factual names and never derives environmental effects", () => {
  const context = { house: { technicalPackage: LIVING_HAUS_IKON_TECHNICAL_PACKAGE_ID } };
  assert.equal(validateListingClaims({
    ...context,
    texts: { description: "Das I-KON-Technikpaket umfasst Photovoltaikanlage, Batteriespeicher, Wärmepumpe und Lüftungsanlage." },
  }).ok, true);
  assert.ok(validateListingClaims({
    ...context,
    texts: { description: "Eine Komfortlüftung ist Bestandteil der Ausstattung." },
  }).blockingIssues.some((entry) => entry.category === CLAIM_CATEGORY.UNVERIFIED_TECHNICAL_CLAIM));
  assert.ok(validateListingClaims({
    ...context,
    texts: { description: "Eine Luft-Wasser-Wärmepumpe ist Bestandteil der Ausstattung." },
  }).blockingIssues.some((entry) => entry.category === CLAIM_CATEGORY.UNVERIFIED_TECHNICAL_CLAIM));
  assert.ok(validateListingClaims({
    ...context,
    texts: { description: "Photovoltaikanlage und Wärmepumpe machen dieses Haus nachhaltig." },
  }).blockingIssues.some((entry) => entry.category === CLAIM_CATEGORY.GENERIC_ENVIRONMENTAL_CLAIM));
});

test("replaces only released technical segments, keeps certification untouched and is idempotent", () => {
  const before = state();
  const plan = planPhase2BIKonTechnicalFactsCleanup(before, options);
  assert.equal(plan.packageMarkers.length, 1);
  assert.equal(plan.descriptionChanges.length, 1);
  assert.equal(plan.descriptionChanges[0].segments.length, 2);
  assert.equal(plan.titleChanges.length, 1);

  const migrated = applyPhase2BIKonTechnicalFactsCleanup(before, options);
  const listing = migrated.state.projects[0].listings[0];
  assert.equal(migrated.changed, true);
  assert.equal(listing.texts.description, "Das I-KON-Technikpaket umfasst Photovoltaikanlage, Batteriespeicher, Wärmepumpe und Lüftungsanlage.\n\nDas I-KON-Technikpaket umfasst Wärmepumpe und Lüftungsanlage.\n\nDGNB-Serienzertifizierung in Gold und QDF-Zertifizierung.");
  assert.equal(listing.texts.title, "Testhaus mit Wärmepumpe und Lüftungsanlage");
  assert.equal(migrated.state.houses[0].technicalPackage, LIVING_HAUS_IKON_TECHNICAL_PACKAGE_ID);
  assert.equal(migrated.state.houses[1].technicalPackage, undefined);
  assert.equal(listing.unrelatedListingField, "unverändert");
  assert.equal(migrated.state.projects[0].unrelatedProjectField, "unverändert");
  assert.equal(migrated.state.provider.unrelatedProviderField, "unverändert");
  assertPhase2BIKonTechnicalFactsCleanupIntegrity(before, migrated.state, migrated.plan);

  const changedCertification = structuredClone(migrated.state);
  changedCertification.projects[0].listings[0].texts.description = changedCertification.projects[0].listings[0].texts.description.replace("QDF", "Anderes Zertifikat");
  assert.throws(
    () => assertPhase2BIKonTechnicalFactsCleanupIntegrity(before, changedCertification, migrated.plan),
    /PHASE2B_IKON_CERTIFICATION_CHANGED/u,
  );
  const repeated = applyPhase2BIKonTechnicalFactsCleanup(migrated.state, options);
  assert.equal(repeated.changed, false);
  assert.equal(repeated.idempotent, true);
});

test("creates a separate byte-identical and restorable I-KON backup", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "phase2b-ikon-technical-facts-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const catalogDirectory = join(root, "catalog-v2");
  const backupDirectory = join(root, "backups");
  await mkdir(catalogDirectory, { recursive: true });
  const manifest = { format: 2, savedAt: "2026-09-24T13:00:00.000Z", state: state() };
  await writeFile(join(catalogDirectory, "manifest.json"), JSON.stringify(manifest), "utf8");

  const backup = await createPhase2BIKonTechnicalFactsCatalogBackup({
    catalogDirectory,
    backupDirectory,
    now: "2026-09-24T15:30:00.000Z",
  });
  assert.equal(backup.manifestHash, backup.backupHash);
  assert.deepEqual(
    await verifyPhase2BIKonTechnicalFactsCatalogBackup(backup.backupPath, backup.backupHash),
    {
      backupHash: backup.backupHash,
      savedAt: "2026-09-24T13:00:00.000Z",
      bytes: (await readFile(backup.backupPath)).length,
      restorable: true,
    },
  );
});
