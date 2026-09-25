import { createHash, randomUUID } from "node:crypto";
import { constants as fileSystemConstants } from "node:fs";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  CATALOG_V2_DIRECTORY,
  commitCatalogSnapshot,
  discardCatalogSnapshot,
  loadCatalogManifest,
  startCatalogSnapshot,
} from "./catalog-store.mjs";
import { cleanupStudioState } from "./data-integrity.mjs";
import {
  createStandardStaticCopy,
  STATIC_COPY_FIELD,
  STATIC_COPY_SOURCE,
  STATIC_COPY_VERSION,
} from "./listing-copy.mjs";
import {
  LISTING_FIXED_COPY_TREATMENT,
  planListingFixedCopyPreview,
} from "./listing-fixed-copy-preview.mjs";
import { APPLICATION_DATA_DIRECTORY } from "./platform-paths.mjs";

export const FIXED_LISTING_COPY_MIGRATION_BACKUP_DIRECTORY = join(
  APPLICATION_DATA_DIRECTORY,
  "fixed-listing-copy-migration-backups",
);

export const FIXED_LISTING_COPY_MIGRATION_EXPECTED = Object.freeze({
  activeListings: 44,
  changedFields: 220,
  changedFieldsPerListing: 5,
  alreadyCorrectTerms: 44,
  manualDifferences: 0,
});

export const FIXED_LISTING_COPY_MIGRATION_GUARANTEE = Object.freeze({
  usesAi: false,
  triggersUploads: false,
  triggersFtps: false,
  triggersOpenImmoTransfer: false,
  changesOnlyActiveListings: true,
  changesOnlyApprovedStaticFields: true,
  leavesTitlesDescriptionsLocationsAndProjectingDataUntouched: true,
  verifiesBackupAndIdempotence: true,
});

const MIGRATED_FIELDS = Object.freeze([
  STATIC_COPY_FIELD.EQUIPMENT,
  STATIC_COPY_FIELD.OTHER,
  STATIC_COPY_FIELD.PROVISION,
  STATIC_COPY_FIELD.ANNOTATION,
  STATIC_COPY_FIELD.RECOMMENDATION,
]);

const TEXT_FIELDS = new Set([
  STATIC_COPY_FIELD.EQUIPMENT,
  STATIC_COPY_FIELD.OTHER,
]);

function clean(value) {
  return String(value ?? "").trim();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function activeListing(listing = {}) {
  const status = clean(listing.status).toLocaleLowerCase("de-DE");
  return Boolean(clean(listing.id))
    && !clean(listing.rotationArchivedAt)
    && !new Set(["archived", "deleted"]).has(status);
}

function activeContexts(state = {}) {
  const contexts = [];
  for (const project of state.projects || []) {
    for (const listing of project.listings || []) {
      if (activeListing(listing)) contexts.push({ project, listing });
    }
  }
  return contexts;
}

function findContext(state, listingId) {
  const context = activeContexts(state).find((candidate) => candidate.listing.id === listingId);
  if (!context) throw new Error(`FIXED_COPY_MIGRATION_SCOPE_CHANGED: ${listingId} ist nicht mehr aktiv.`);
  return context;
}

function expectedCounts(options = {}) {
  return { ...FIXED_LISTING_COPY_MIGRATION_EXPECTED, ...(options.expectedCounts || {}) };
}

function sourceField(field) {
  return TEXT_FIELDS.has(field) ? "texts" : "staticTexts";
}

function hasOwn(object, key) {
  return Boolean(object && Object.hasOwn(object, key));
}

function fieldSummary(preview, field, treatment) {
  return preview.listings.flatMap((listing) => listing.fields.filter((entry) => (
    entry.field === field && entry.treatment === treatment
  )));
}

function assertPreviewScope(preview, options = {}) {
  const expected = expectedCounts(options);
  if (preview.counts.activeListings !== expected.activeListings) {
    throw new Error(`FIXED_COPY_MIGRATION_ACTIVE_SCOPE_MISMATCH: Erwartet ${expected.activeListings} aktive Inserate, gefunden ${preview.counts.activeListings}.`);
  }
  if (preview.counts.masterClaimPass !== expected.activeListings || preview.counts.masterClaimBlock !== 0) {
    throw new Error("FIXED_COPY_MIGRATION_MASTER_CLAIMS_FAILED: Der freigegebene Ausstattungstext ist nicht für alle aktiven Inserate belegt.");
  }
  const manualDifferences = Object.values(preview.classification)
    .reduce((sum, counts) => sum + counts[LISTING_FIXED_COPY_TREATMENT.MANUAL_DIFFERENCE], 0);
  if (manualDifferences !== expected.manualDifferences) {
    throw new Error(`FIXED_COPY_MIGRATION_MANUAL_DIFFERENCE: Erwartet ${expected.manualDifferences} manuelle Abweichungen, gefunden ${manualDifferences}.`);
  }
  if (preview.classification[STATIC_COPY_FIELD.TERMS][LISTING_FIXED_COPY_TREATMENT.ALREADY_CORRECT] !== expected.alreadyCorrectTerms) {
    throw new Error(`FIXED_COPY_MIGRATION_TERMS_SCOPE_MISMATCH: Erwartet ${expected.alreadyCorrectTerms} unveränderte AGB-Felder.`);
  }
  for (const field of MIGRATED_FIELDS) {
    if (fieldSummary(preview, field, LISTING_FIXED_COPY_TREATMENT.STANDARD_REPLACE_SAFE).length !== expected.activeListings) {
      throw new Error(`FIXED_COPY_MIGRATION_FIELD_SCOPE_MISMATCH: ${field} ist nicht bei allen ${expected.activeListings} Inseraten exakt als sichere Standardmigration klassifiziert.`);
    }
  }
  if (preview.counts.migrationCandidates !== expected.changedFields) {
    throw new Error(`FIXED_COPY_MIGRATION_CHANGESET_MISMATCH: Erwartet ${expected.changedFields} sichere Feldänderungen, gefunden ${preview.counts.migrationCandidates}.`);
  }
}

function assertFinalPreview(preview, options = {}) {
  const expected = expectedCounts(options);
  if (preview.counts.activeListings !== expected.activeListings) {
    throw new Error(`FIXED_COPY_MIGRATION_FINAL_SCOPE_MISMATCH: Erwartet ${expected.activeListings} aktive Inserate, gefunden ${preview.counts.activeListings}.`);
  }
  if (preview.counts.masterClaimPass !== expected.activeListings || preview.counts.masterClaimBlock !== 0) {
    throw new Error("FIXED_COPY_MIGRATION_FINAL_MASTER_CLAIMS_FAILED: Der finale Mastertext-Claim-Check ist nicht vollständig grün.");
  }
  if (preview.counts.migrationCandidates !== 0) {
    throw new Error(`FIXED_COPY_MIGRATION_FINAL_PENDING: Nach der Migration wären noch ${preview.counts.migrationCandidates} Felder änderbar.`);
  }
  for (const field of MIGRATED_FIELDS) {
    const counts = preview.classification[field];
    if (counts[LISTING_FIXED_COPY_TREATMENT.ALREADY_CORRECT] !== expected.activeListings
      || counts[LISTING_FIXED_COPY_TREATMENT.STANDARD_REPLACE_SAFE] !== 0
      || counts[LISTING_FIXED_COPY_TREATMENT.MANUAL_DIFFERENCE] !== 0) {
      throw new Error(`FIXED_COPY_MIGRATION_FINAL_FIELD_MISMATCH: ${field} ist nicht bei allen aktiven Inseraten auf dem freigegebenen Standard.`);
    }
  }
  if (preview.classification[STATIC_COPY_FIELD.TERMS][LISTING_FIXED_COPY_TREATMENT.ALREADY_CORRECT] !== expected.alreadyCorrectTerms) {
    throw new Error("FIXED_COPY_MIGRATION_FINAL_TERMS_CHANGED: Das unveränderte AGB-Feld entspricht nicht mehr dem freigegebenen Standard.");
  }
}

function changeForListing(context, standards) {
  const fields = MIGRATED_FIELDS.map((field) => {
    const container = sourceField(field);
    const source = context.listing[container] && typeof context.listing[container] === "object"
      ? context.listing[container]
      : {};
    return {
      field,
      container,
      previousText: String(source[field] ?? ""),
      previousTextPresent: hasOwn(source, field),
      replacementText: standards[field],
      previousHash: sha256(String(source[field] ?? "")),
      replacementHash: sha256(standards[field]),
      previousSource: context.listing.staticCopySources?.[field],
      previousSourcePresent: hasOwn(context.listing.staticCopySources, field),
    };
  });
  return {
    projectId: context.project.id,
    listingId: context.listing.id,
    externalId: context.listing.externalId,
    titleHash: sha256(String(context.listing.texts?.title ?? "")),
    descriptionHash: sha256(String(context.listing.texts?.description ?? "")),
    locationHash: sha256(String(context.listing.texts?.location ?? "")),
    projectingSettingsHash: sha256(JSON.stringify(context.listing.projectingSettings ?? null)),
    fields,
    previousStaticTextsPresent: hasOwn(context.listing, "staticTexts"),
    previousStaticCopySourcesPresent: hasOwn(context.listing, "staticCopySources"),
    previousStaticCopyVersion: context.listing.staticCopyVersion,
    previousStaticCopyVersionPresent: hasOwn(context.listing, "staticCopyVersion"),
  };
}

/** Plans exactly five central static-field updates for each active listing. */
export function planFixedListingCopyMigration(state = {}, options = {}) {
  const preview = planListingFixedCopyPreview(state);
  const contexts = activeContexts(state);
  const expected = expectedCounts(options);
  const standards = createStandardStaticCopy();

  if (preview.counts.migrationCandidates === 0) {
    assertFinalPreview(preview, options);
    return {
      changed: false,
      idempotent: true,
      preview,
      changes: [],
      changedFieldCount: 0,
    };
  }

  assertPreviewScope(preview, options);
  const changes = contexts.map((context) => changeForListing(context, standards));
  const changedFieldCount = changes.reduce((sum, change) => sum + change.fields.length, 0);
  if (changes.length !== expected.activeListings || changedFieldCount !== expected.changedFields
    || changes.some((change) => change.fields.length !== expected.changedFieldsPerListing)) {
    throw new Error("FIXED_COPY_MIGRATION_PLAN_MISMATCH: Die statische Feldplanung weicht von der expliziten 44×5-Freigabe ab.");
  }
  return {
    changed: true,
    idempotent: false,
    preview,
    standards,
    changes,
    changedFieldCount,
  };
}

function setPlannedStaticCopy(state, change) {
  const context = findContext(state, change.listingId);
  if (context.project.id !== change.projectId) {
    throw new Error(`FIXED_COPY_MIGRATION_CAS_FAILED: ${change.listingId} gehört nicht mehr zum geplanten Projekt.`);
  }
  if (sha256(String(context.listing.texts?.title ?? "")) !== change.titleHash
    || sha256(String(context.listing.texts?.description ?? "")) !== change.descriptionHash
    || sha256(String(context.listing.texts?.location ?? "")) !== change.locationHash
    || sha256(JSON.stringify(context.listing.projectingSettings ?? null)) !== change.projectingSettingsHash) {
    throw new Error(`FIXED_COPY_MIGRATION_CAS_FAILED: ${change.listingId} wurde außerhalb des freigegebenen Feldumfangs geändert.`);
  }
  const texts = { ...(context.listing.texts || {}) };
  const staticTexts = { ...(context.listing.staticTexts || {}) };
  const staticCopySources = { ...(context.listing.staticCopySources || {}) };
  for (const fieldChange of change.fields) {
    const container = fieldChange.container === "texts" ? texts : staticTexts;
    if (String(container[fieldChange.field] ?? "") !== fieldChange.previousText) {
      throw new Error(`FIXED_COPY_MIGRATION_CAS_FAILED: ${change.listingId}/${fieldChange.field} wurde seit der Planung geändert.`);
    }
    container[fieldChange.field] = fieldChange.replacementText;
    staticCopySources[fieldChange.field] = STATIC_COPY_SOURCE.STANDARD;
  }
  context.listing.texts = texts;
  context.listing.staticTexts = staticTexts;
  context.listing.staticCopySources = staticCopySources;
  context.listing.staticCopyVersion = STATIC_COPY_VERSION;
}

function restoreProperty(target, key, present, value) {
  if (present) target[key] = value;
  else delete target[key];
}

function restoreContainerProperty(listing, containerName, fieldChange) {
  const container = listing[containerName] && typeof listing[containerName] === "object"
    ? listing[containerName]
    : {};
  restoreProperty(container, fieldChange.field, fieldChange.previousTextPresent, fieldChange.previousText);
  listing[containerName] = container;
}

function removeEmptyContainerIfPreviouslyAbsent(listing, containerName, previouslyPresent) {
  if (!previouslyPresent && Object.keys(listing[containerName] || {}).length === 0) delete listing[containerName];
}

/** Rejects every semantic change outside the five allowed static fields and their explicit provenance. */
export function assertFixedListingCopyMigrationIntegrity(before, after, plan) {
  const comparable = structuredClone(after);
  for (const change of plan.changes) {
    const context = findContext(comparable, change.listingId);
    if (sha256(String(context.listing.texts?.title ?? "")) !== change.titleHash
      || sha256(String(context.listing.texts?.description ?? "")) !== change.descriptionHash
      || sha256(String(context.listing.texts?.location ?? "")) !== change.locationHash
      || sha256(JSON.stringify(context.listing.projectingSettings ?? null)) !== change.projectingSettingsHash) {
      throw new Error(`FIXED_COPY_MIGRATION_PROTECTED_FIELD_CHANGED: ${change.listingId} enthält eine unzulässige Änderung an Titel, Beschreibung, Lage oder Projektierungsdaten.`);
    }
    for (const fieldChange of change.fields) {
      const container = context.listing[fieldChange.container] || {};
      if (sha256(String(container[fieldChange.field] ?? "")) !== fieldChange.replacementHash
        || context.listing.staticCopySources?.[fieldChange.field] !== STATIC_COPY_SOURCE.STANDARD) {
        throw new Error(`FIXED_COPY_MIGRATION_FIELD_INTEGRITY_FAILED: ${change.listingId}/${fieldChange.field} stimmt nicht mit dem freigegebenen Standard überein.`);
      }
      restoreContainerProperty(context.listing, fieldChange.container, fieldChange);
      restoreProperty(
        context.listing.staticCopySources || (context.listing.staticCopySources = {}),
        fieldChange.field,
        fieldChange.previousSourcePresent,
        fieldChange.previousSource,
      );
    }
    if (context.listing.staticCopyVersion !== STATIC_COPY_VERSION) {
      throw new Error(`FIXED_COPY_MIGRATION_VERSION_INTEGRITY_FAILED: ${change.listingId} trägt nicht die erwartete Standardversion.`);
    }
    restoreProperty(
      context.listing,
      "staticCopyVersion",
      change.previousStaticCopyVersionPresent,
      change.previousStaticCopyVersion,
    );
    removeEmptyContainerIfPreviouslyAbsent(context.listing, "staticTexts", change.previousStaticTextsPresent);
    removeEmptyContainerIfPreviouslyAbsent(context.listing, "staticCopySources", change.previousStaticCopySourcesPresent);
  }
  if (!isDeepStrictEqual(before, comparable)) {
    throw new Error("FIXED_COPY_MIGRATION_INTEGRITY_FAILED: Außerhalb der fünf freigegebenen statischen Inseratfelder oder ihrer Herkunftsmetadaten wurden Katalogdaten verändert.");
  }
  return true;
}

/** Pure, deterministic migration. It never performs network, upload or portal operations. */
export function applyFixedListingCopyMigration(state = {}, options = {}) {
  const plan = planFixedListingCopyMigration(state, options);
  if (plan.idempotent) {
    return { state, plan, changed: false, idempotent: true, afterPreview: plan.preview };
  }
  const nextState = structuredClone(state);
  for (const change of plan.changes) setPlannedStaticCopy(nextState, change);
  assertFixedListingCopyMigrationIntegrity(state, nextState, plan);
  const afterPreview = planListingFixedCopyPreview(nextState);
  assertFinalPreview(afterPreview, options);
  const finalPlan = planFixedListingCopyMigration(nextState, options);
  if (finalPlan.changed || !finalPlan.idempotent) {
    throw new Error("FIXED_COPY_MIGRATION_IDEMPOTENCE_FAILED: Ein zweiter Lauf würde noch Änderungen planen.");
  }
  return {
    state: nextState,
    plan,
    afterPreview,
    finalPlan,
    changed: true,
    idempotent: false,
  };
}

function validManifest(manifest) {
  return manifest?.format === 2
    && manifest.state?.version === 1
    && Array.isArray(manifest.state.houses)
    && Array.isArray(manifest.state.projects)
    && manifest.state.provider
    && typeof manifest.state.provider === "object";
}

function safeTimestamp(now) {
  const date = new Date(String(now ?? ""));
  if (Number.isNaN(date.getTime())) throw new Error("Der Backup-Zeitpunkt ist ungültig.");
  return date.toISOString().replaceAll(":", "-");
}

export async function createFixedListingCopyMigrationCatalogBackup(options = {}) {
  const catalogDirectory = options.catalogDirectory || CATALOG_V2_DIRECTORY;
  const backupDirectory = options.backupDirectory || FIXED_LISTING_COPY_MIGRATION_BACKUP_DIRECTORY;
  const now = options.now || new Date().toISOString();
  const manifestPath = join(catalogDirectory, "manifest.json");
  const source = await readFile(manifestPath);
  const manifest = JSON.parse(source.toString("utf8"));
  if (!validManifest(manifest)) throw new Error("Der aktive Katalog kann nicht als gültiger Fixed-Copy-Migrationsbackup bestätigt werden.");
  const createdAt = new Date(now).toISOString();
  const backupPath = join(backupDirectory, `manifest.pre-fixed-listing-copy-${safeTimestamp(createdAt)}.json`);
  await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
  await copyFile(manifestPath, backupPath, fileSystemConstants.COPYFILE_EXCL);
  const backup = await readFile(backupPath);
  const manifestHash = sha256(source);
  const backupHash = sha256(backup);
  if (manifestHash !== backupHash) throw new Error("FIXED_COPY_MIGRATION_BACKUP_HASH_MISMATCH: Der Backup stimmt nicht bytegenau mit dem aktiven Manifest überein.");
  return { catalogDirectory, manifestPath, backupPath, createdAt, savedAt: clean(manifest.savedAt), manifestHash, backupHash, bytes: source.length };
}

export async function verifyFixedListingCopyMigrationCatalogBackup(backupPath, expectedHash = "") {
  const data = await readFile(backupPath);
  const manifest = JSON.parse(data.toString("utf8"));
  const backupHash = sha256(data);
  if (!validManifest(manifest)) throw new Error("Der Fixed-Copy-Migrationsbackup ist nicht wiederherstellbar.");
  if (expectedHash && backupHash !== expectedHash) throw new Error("FIXED_COPY_MIGRATION_BACKUP_HASH_MISMATCH: Der Backup-Hash stimmt nicht mit dem erwarteten Stand überein.");
  return { backupHash, savedAt: clean(manifest.savedAt), bytes: data.length, restorable: true };
}

function assertNoImplicitNormalization(state, now) {
  if (cleanupStudioState(state, { apply: true, now }).changed) {
    throw new Error("FIXED_COPY_MIGRATION_NORMALIZATION_REQUIRED: Der kanonische Speicherweg würde weitere Katalogdaten normalisieren.");
  }
}

function nextSavedAt(currentSavedAt, now) {
  const current = Date.parse(String(currentSavedAt ?? ""));
  const requested = Date.parse(String(now ?? ""));
  return new Date(Math.max(
    Number.isFinite(current) ? current + 1 : 0,
    Number.isFinite(requested) ? requested : Date.now(),
  )).toISOString();
}

/** Performs one backup-protected, CAS-protected local migration of exactly 220 approved fields. */
export async function runFixedListingCopyMigration(options = {}) {
  const catalogDirectory = options.catalogDirectory || CATALOG_V2_DIRECTORY;
  const load = options.loadCatalogManifest || loadCatalogManifest;
  const start = options.startCatalogSnapshot || startCatalogSnapshot;
  const commit = options.commitCatalogSnapshot || commitCatalogSnapshot;
  const discard = options.discardCatalogSnapshot || discardCatalogSnapshot;
  const now = options.now || new Date().toISOString();
  const current = await load(catalogDirectory);
  if (!current?.stored || !current.state) throw new Error("Der aktive Inseratkatalog ist nicht verfügbar.");
  assertNoImplicitNormalization(current.state, now);

  const preview = applyFixedListingCopyMigration(current.state, options);
  if (!preview.changed) {
    return { changed: false, idempotent: true, plan: preview.plan, afterPreview: preview.afterPreview };
  }
  assertNoImplicitNormalization(preview.state, now);
  const backup = await createFixedListingCopyMigrationCatalogBackup({
    catalogDirectory,
    backupDirectory: options.backupDirectory,
    now,
  });
  const recovery = await verifyFixedListingCopyMigrationCatalogBackup(backup.backupPath, backup.backupHash);
  const sessionId = `fixed-listing-copy-${randomUUID()}`;
  try {
    const snapshot = await start({
      state: preview.state,
      sessionId,
      savedAt: nextSavedAt(current.savedAt, now),
      expectedSavedAt: current.savedAt,
    }, catalogDirectory);
    if (snapshot.missingImageIds.length) {
      throw new Error(`FIXED_COPY_MIGRATION_IMAGE_INTEGRITY_FAILED: Der Speicherweg meldet ${snapshot.missingImageIds.length} fehlende Bilddateien.`);
    }
    await commit(sessionId, catalogDirectory);
  } catch (error) {
    await discard(sessionId, catalogDirectory).catch(() => undefined);
    throw error;
  }
  const persisted = await load(catalogDirectory);
  if (!persisted?.stored || !persisted.state) throw new Error("Der Katalog konnte nach der Fixed-Copy-Migration nicht erneut geladen werden.");
  assertFixedListingCopyMigrationIntegrity(current.state, persisted.state, preview.plan);
  const idempotence = applyFixedListingCopyMigration(persisted.state, options);
  if (idempotence.changed || !idempotence.idempotent) {
    throw new Error("FIXED_COPY_MIGRATION_IDEMPOTENCE_FAILED: Der zweite Migrationslauf würde weitere Änderungen vornehmen.");
  }
  return {
    changed: true,
    idempotent: false,
    backup,
    recovery,
    plan: preview.plan,
    afterPreview: idempotence.afterPreview,
    persistedSavedAt: persisted.savedAt,
  };
}
