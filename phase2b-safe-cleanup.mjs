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
  FIXED_DESCRIPTION_CTA,
  FIXED_EQUIPMENT_TEXT,
  FIXED_OTHER_TEXT,
} from "./listing-copy.mjs";
import { LIVING_HAUS_SERIES_ID, validateListingClaims } from "./listing-claim-policy.mjs";
import { APPLICATION_DATA_DIRECTORY } from "./platform-paths.mjs";
import {
  LEGACY_FIXED_DESCRIPTION_CTA,
  PHASE2B_TREATMENT,
  scanPhase2BClaims,
} from "./phase2b-claim-scan.mjs";

export const PHASE2B_SAFE_CLEANUP_EXPECTED_FIELD_COUNT = 44;
export const PHASE2B_SAFE_CLEANUP_BACKUP_DIRECTORY = join(
  APPLICATION_DATA_DIRECTORY,
  "phase2b-safe-cleanup-backups",
);

const FIELD_DETAILS = Object.freeze({
  Ausstattung: Object.freeze({ key: "equipment", replacement: () => FIXED_EQUIPMENT_TEXT }),
  Sonstiges: Object.freeze({ key: "other", replacement: () => FIXED_OTHER_TEXT }),
  Objektbeschreibung: Object.freeze({
    key: "description",
    replacement: (current) => {
      if (!String(current ?? "").endsWith(LEGACY_FIXED_DESCRIPTION_CTA)) return "";
      const body = String(current).slice(0, -LEGACY_FIXED_DESCRIPTION_CTA.length).trimEnd();
      return body ? `${body}\n\n${FIXED_DESCRIPTION_CTA}` : FIXED_DESCRIPTION_CTA;
    },
  }),
});

function clean(value) {
  return String(value ?? "").trim();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function catalogManifestPath(catalogDirectory) {
  return join(catalogDirectory, "manifest.json");
}

function nextSavedAt(currentSavedAt, now) {
  const current = Date.parse(String(currentSavedAt ?? ""));
  const requested = Date.parse(String(now ?? ""));
  const value = Math.max(
    Number.isFinite(current) ? current + 1 : 0,
    Number.isFinite(requested) ? requested : Date.now(),
  );
  return new Date(value).toISOString();
}

function safeTimestamp(now) {
  const date = new Date(String(now ?? ""));
  if (Number.isNaN(date.getTime())) throw new Error("Der Sicherungszeitpunkt ist ungültig.");
  return date.toISOString().replaceAll(":", "-");
}

function activeListing(project, listing) {
  const status = clean(listing?.status).toLocaleLowerCase("de-DE");
  return Boolean(project?.id && listing?.id)
    && !clean(listing?.rotationArchivedAt)
    && !new Set(["archived", "deleted"]).has(status);
}

function listingContext(state, projectId, listingId) {
  const project = (state?.projects || []).find((candidate) => candidate?.id === projectId);
  const listing = project?.listings?.find((candidate) => candidate?.id === listingId);
  const house = (state?.houses || []).find((candidate) => candidate?.id === listing?.templateId);
  if (!activeListing(project, listing) || !house) {
    throw new Error(`Das freigegebene Inserat ${listingId} ist nicht mehr aktiv oder seine Hausvorlage fehlt.`);
  }
  return { project, listing, house };
}

function validationForField({ listing, house, project }, field, texts) {
  return validateListingClaims({
    texts,
    images: house.images,
    house,
    project,
    listingFacts: listing.listingFacts,
    houseSeries: LIVING_HAUS_SERIES_ID,
  }).blockingIssues.filter((issue) => issue.field === field);
}

function planEntry(state, fieldPlan) {
  const detail = FIELD_DETAILS[fieldPlan.field];
  if (!detail) {
    return {
      listingId: fieldPlan.listingId,
      projectId: fieldPlan.projectId,
      field: fieldPlan.field,
      rejectedReason: "Für dieses Feld existiert kein deterministischer Phase-2A-Ersatzbaustein.",
    };
  }
  const context = listingContext(state, fieldPlan.projectId, fieldPlan.listingId);
  const previousText = String(context.listing.texts?.[detail.key] ?? "");
  const replacementText = detail.replacement(previousText);
  if (!replacementText) {
    return {
      listingId: fieldPlan.listingId,
      projectId: fieldPlan.projectId,
      field: fieldPlan.field,
      rejectedReason: "Der erkannte historische Baustein ist im aktuellen Feld nicht mehr vollständig vorhanden.",
    };
  }
  const texts = { ...context.listing.texts, [detail.key]: replacementText };
  const blockingIssues = validationForField(context, fieldPlan.field, texts);
  if (blockingIssues.length) {
    return {
      listingId: fieldPlan.listingId,
      projectId: fieldPlan.projectId,
      field: fieldPlan.field,
      rejectedReason: "Der kanonische Ersatztext ist für dieses vollständige Feld nicht blockfrei.",
      blockingIssues,
    };
  }
  return {
    listingId: fieldPlan.listingId,
    externalId: context.listing.externalId,
    projectId: fieldPlan.projectId,
    project: fieldPlan.project,
    house: fieldPlan.house,
    field: fieldPlan.field,
    textKey: detail.key,
    previousText,
    replacementText,
    previousHash: sha256(previousText),
    replacementHash: sha256(replacementText),
    historicalStandard: fieldPlan.textOrigins,
    blockingIssues: [],
  };
}

/**
 * Builds the exclusive field-level Phase-2B.1 scope from the same central
 * Claim scanner that created the approved read-only report. No search-based
 * widening is permitted.
 */
export function planPhase2BSafeCleanup(state, options = {}) {
  const scan = options.scan || scanPhase2BClaims;
  const report = scan(state, options.scanOptions);
  const safeFieldPlans = report.fieldPlans.filter((fieldPlan) => (
    fieldPlan.proposedTreatment === PHASE2B_TREATMENT.SAFE_DETERMINISTIC_REPLACEMENT
  ));
  const entries = safeFieldPlans.map((fieldPlan) => planEntry(state, fieldPlan));
  return {
    report,
    safeFieldCount: safeFieldPlans.length,
    changes: entries.filter((entry) => !entry.rejectedReason),
    rejected: entries.filter((entry) => entry.rejectedReason),
  };
}

function requireExecutablePlan(plan, expectedSafeFieldCount) {
  if (plan.safeFieldCount !== expectedSafeFieldCount) {
    throw new Error(`PHASE2B_SAFE_SCOPE_MISMATCH: Erwartet ${expectedSafeFieldCount} SAFE-Felder, gefunden ${plan.safeFieldCount}.`);
  }
  if (plan.rejected.length || plan.changes.length !== expectedSafeFieldCount) {
    throw new Error("PHASE2B_SAFE_VALIDATION_FAILED: Mindestens ein freigegebenes Feld ist nicht atomar und blockfrei ersetzbar.");
  }
}

function setPlannedText(state, change) {
  const project = state.projects.find((candidate) => candidate?.id === change.projectId);
  const listing = project?.listings?.find((candidate) => candidate?.id === change.listingId);
  if (!listing || String(listing.texts?.[change.textKey] ?? "") !== change.previousText) {
    throw new Error(`PHASE2B_SAFE_SCOPE_CHANGED: Das Feld ${change.field} von ${change.listingId} wurde seit der Planung verändert.`);
  }
  listing.texts = { ...listing.texts, [change.textKey]: change.replacementText };
}

/**
 * Pure migration. It changes only approved field entries and returns the
 * original state object when rerun after a successful cleanup.
 */
export function applyPhase2BSafeCleanup(state, options = {}) {
  const expectedSafeFieldCount = options.expectedSafeFieldCount
    ?? PHASE2B_SAFE_CLEANUP_EXPECTED_FIELD_COUNT;
  const plan = planPhase2BSafeCleanup(state, options);
  if (plan.safeFieldCount === 0) {
    return { state, plan, changed: false, idempotent: true };
  }
  requireExecutablePlan(plan, expectedSafeFieldCount);

  const nextState = structuredClone(state);
  for (const change of plan.changes) setPlannedText(nextState, change);

  const afterReport = (options.scan || scanPhase2BClaims)(nextState, options.scanOptions);
  const remainingSafeFields = afterReport.fieldPlans.filter((fieldPlan) => (
    fieldPlan.proposedTreatment === PHASE2B_TREATMENT.SAFE_DETERMINISTIC_REPLACEMENT
  ));
  if (remainingSafeFields.length) {
    throw new Error(`PHASE2B_SAFE_POSTCHECK_FAILED: ${remainingSafeFields.length} SAFE-Felder blieben nach der Migration bestehen.`);
  }
  return {
    state: nextState,
    plan,
    afterReport,
    changed: true,
    idempotent: false,
  };
}

function stateWithPlannedFieldsRestored(before, after, changes) {
  const comparable = structuredClone(after);
  for (const change of changes) {
    const beforeContext = listingContext(before, change.projectId, change.listingId);
    const afterContext = listingContext(comparable, change.projectId, change.listingId);
    afterContext.listing.texts = {
      ...afterContext.listing.texts,
      [change.textKey]: beforeContext.listing.texts[change.textKey],
    };
  }
  return comparable;
}

export function assertPhase2BSafeCleanupIntegrity(before, after, changes) {
  const comparable = stateWithPlannedFieldsRestored(before, after, changes);
  if (!isDeepStrictEqual(before, comparable)) {
    throw new Error("PHASE2B_SAFE_INTEGRITY_FAILED: Es wurden Daten außerhalb der freigegebenen Felder verändert.");
  }
  for (const change of changes) {
    const afterContext = listingContext(after, change.projectId, change.listingId);
    if (afterContext.listing.texts[change.textKey] !== change.replacementText) {
      throw new Error(`PHASE2B_SAFE_INTEGRITY_FAILED: Der Ersatztext für ${change.listingId} wurde nicht vollständig gespeichert.`);
    }
  }
  return true;
}

function validBackupManifest(manifest) {
  return manifest?.format === 2
    && manifest.state
    && manifest.state.version === 1
    && Array.isArray(manifest.state.houses)
    && Array.isArray(manifest.state.projects);
}

export async function createPhase2BSafeCatalogBackup(options = {}) {
  const catalogDirectory = options.catalogDirectory || CATALOG_V2_DIRECTORY;
  const backupDirectory = options.backupDirectory || PHASE2B_SAFE_CLEANUP_BACKUP_DIRECTORY;
  const now = options.now || new Date().toISOString();
  const manifestPath = catalogManifestPath(catalogDirectory);
  const source = await readFile(manifestPath);
  const manifest = JSON.parse(source.toString("utf8"));
  if (!validBackupManifest(manifest)) throw new Error("Der aktive Katalog kann nicht als gültiger Phase-2B.1-Backup bestätigt werden.");

  const createdAt = new Date(now).toISOString();
  const backupPath = join(
    backupDirectory,
    `manifest.pre-phase2b-safe-cleanup-${safeTimestamp(createdAt)}.json`,
  );
  await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
  await copyFile(manifestPath, backupPath, fileSystemConstants.COPYFILE_EXCL);
  const backup = await readFile(backupPath);
  const manifestHash = sha256(source);
  const backupHash = sha256(backup);
  if (manifestHash !== backupHash) throw new Error("Der Phase-2B.1-Backup stimmt nicht bytegenau mit dem aktiven Manifest überein.");
  return {
    catalogDirectory,
    manifestPath,
    backupPath,
    createdAt,
    savedAt: clean(manifest.savedAt),
    manifestHash,
    backupHash,
    bytes: source.length,
  };
}

/** Verifies that a backup is readable and can serve as a restore source. */
export async function verifyPhase2BSafeCatalogBackup(backupPath, expectedHash = "") {
  const data = await readFile(backupPath);
  const manifest = JSON.parse(data.toString("utf8"));
  const backupHash = sha256(data);
  if (!validBackupManifest(manifest)) throw new Error("Der Phase-2B.1-Backup ist nicht als Katalogmanifest wiederherstellbar.");
  if (expectedHash && backupHash !== expectedHash) throw new Error("Der Phase-2B.1-Backup-Hash stimmt nicht mit dem erwarteten Stand überein.");
  return { backupHash, savedAt: clean(manifest.savedAt), bytes: data.length, restorable: true };
}

function assertNoImplicitNormalization(state, now) {
  // cleanupStudioState({ apply: false }) reports diagnostics only. Run its
  // pure in-memory transform instead, so a persistence side effect can never
  // hide behind the dry-run result.
  if (cleanupStudioState(state, { apply: true, now }).changed) {
    throw new Error("PHASE2B_SAFE_NORMALIZATION_REQUIRED: Der kanonische Speicherweg würde weitere Katalogdaten normalisieren.");
  }
}

/**
 * Executes one compare-and-swap write through the product's catalog snapshot
 * path. It has no upload, OpenImmo, FTPS or generation dependencies.
 */
export async function runPhase2BSafeCleanup(options = {}) {
  const catalogDirectory = options.catalogDirectory || CATALOG_V2_DIRECTORY;
  const load = options.loadCatalogManifest || loadCatalogManifest;
  const start = options.startCatalogSnapshot || startCatalogSnapshot;
  const commit = options.commitCatalogSnapshot || commitCatalogSnapshot;
  const discard = options.discardCatalogSnapshot || discardCatalogSnapshot;
  const now = options.now || new Date().toISOString();
  const current = await load(catalogDirectory);
  if (!current?.stored || !current.state) throw new Error("Der aktive Inseratkatalog ist nicht verfügbar.");
  assertNoImplicitNormalization(current.state, now);

  const preview = applyPhase2BSafeCleanup(current.state, options);
  if (!preview.changed) {
    return {
      changed: false,
      idempotent: true,
      plan: preview.plan,
      beforeReport: preview.plan.report,
    };
  }
  assertNoImplicitNormalization(preview.state, now);

  const backup = await createPhase2BSafeCatalogBackup({
    catalogDirectory,
    backupDirectory: options.backupDirectory,
    now,
  });
  const sessionId = `phase2b-safe-cleanup-${randomUUID()}`;
  try {
    const snapshot = await start({
      state: preview.state,
      sessionId,
      savedAt: nextSavedAt(current.savedAt, now),
      expectedSavedAt: current.savedAt,
    }, catalogDirectory);
    if (snapshot.missingImageIds.length) {
      throw new Error("PHASE2B_SAFE_IMAGE_INTEGRITY_FAILED: Der kanonische Speicherweg meldet fehlende Bilddateien.");
    }
    await commit(sessionId, catalogDirectory);
  } catch (error) {
    await discard(sessionId, catalogDirectory).catch(() => undefined);
    throw error;
  }

  const persisted = await load(catalogDirectory);
  if (!persisted?.stored || !persisted.state) throw new Error("Der Katalog konnte nach Phase-2B.1 nicht erneut geladen werden.");
  assertPhase2BSafeCleanupIntegrity(current.state, persisted.state, preview.plan.changes);
  const afterReport = (options.scan || scanPhase2BClaims)(persisted.state, options.scanOptions);
  const remainingSafeFields = afterReport.fieldPlans.filter((fieldPlan) => (
    fieldPlan.proposedTreatment === PHASE2B_TREATMENT.SAFE_DETERMINISTIC_REPLACEMENT
  ));
  if (remainingSafeFields.length) throw new Error("PHASE2B_SAFE_POSTCHECK_FAILED: Der persistierte Katalog enthält weiter SAFE-Felder.");

  return {
    changed: true,
    idempotent: false,
    backup,
    plan: preview.plan,
    beforeReport: preview.plan.report,
    afterReport,
    persistedSavedAt: persisted.savedAt,
  };
}
