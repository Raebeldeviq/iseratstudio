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
import { LIVING_HAUS_SERIES_ID, validateListingClaims } from "./listing-claim-policy.mjs";
import { APPLICATION_DATA_DIRECTORY } from "./platform-paths.mjs";
import {
  LEGACY_FIXED_DESCRIPTION_CTA,
  PHASE2B_TREATMENT,
  scanPhase2BClaims,
} from "./phase2b-claim-scan.mjs";

export const PHASE2B_CTA_EXPECTED_FIELD_COUNT = 44;
export const PHASE2B_CTA_EXPECTED_TRUE_MANUAL_COUNT = 25;
export const PHASE2B_CTA_BACKUP_DIRECTORY = join(
  APPLICATION_DATA_DIRECTORY,
  "phase2b-cta-cleanup-backups",
);

function clean(value) {
  return String(value ?? "").trim();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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
    throw new Error(`Das CTA-Inserat ${listingId} ist nicht mehr aktiv oder seine Hausvorlage fehlt.`);
  }
  return { project, listing, house };
}

function fieldBlocks(context, texts) {
  return validateListingClaims({
    texts,
    images: context.house.images,
    house: context.house,
    project: context.project,
    listingFacts: context.listing.listingFacts,
    houseSeries: LIVING_HAUS_SERIES_ID,
  }).blockingIssues.filter((issue) => issue.field === "Objektbeschreibung");
}

function removeKnownCta(current) {
  const value = String(current ?? "");
  if (!value.endsWith(LEGACY_FIXED_DESCRIPTION_CTA)) return { text: "", reason: "Der historische CTA ist nicht mehr exakt am Feldende vorhanden." };
  const text = value.slice(0, -LEGACY_FIXED_DESCRIPTION_CTA.length).trimEnd();
  if (!text) return { text: "", reason: "Die CTA-Entfernung würde eine leere Objektbeschreibung erzeugen." };
  if (/\n{3,}/u.test(text)) return { text: "", reason: "Die CTA-Entfernung würde eine unzulässige Folge leerer Absätze hinterlassen." };
  if (!/[.!?…]$/u.test(text)) return { text: "", reason: "Der verbleibende Text endet nicht mit einem vollständigen Satzzeichen." };
  return { text };
}

function scanScope(state, report) {
  const manualPlans = report.fieldPlans.filter((plan) => (
    plan.proposedTreatment === PHASE2B_TREATMENT.MANUAL_REVIEW
  ));
  const descriptionManualPlans = manualPlans.filter((plan) => plan.field === "Objektbeschreibung");
  const ctaPlans = descriptionManualPlans.filter((plan) => {
    // The phase-2B.1 analysis identified this terminal, byte-exact legacy
    // block.  A text search or an arbitrary manual description must never
    // become part of this migration scope.
    const context = listingContext(state, plan.projectId, plan.listingId);
    return String(context.listing.texts?.description ?? "").endsWith(LEGACY_FIXED_DESCRIPTION_CTA);
  });
  return {
    manualPlans,
    descriptionManualPlans,
    ctaPlans,
    trueManualPlans: manualPlans.filter((plan) => plan.field === "Überschrift"),
    nonCtaDescriptionPlans: descriptionManualPlans.filter((plan) => !ctaPlans.includes(plan)),
    unexpectedManualPlans: manualPlans.filter((plan) => (
      plan.field !== "Objektbeschreibung" && plan.field !== "Überschrift"
    )),
  };
}

function legacyCtaEntries(state) {
  const entries = [];
  for (const project of state?.projects || []) {
    for (const listing of project?.listings || []) {
      if (!activeListing(project, listing)) continue;
      const description = String(listing.texts?.description ?? "");
      if (description.includes(LEGACY_FIXED_DESCRIPTION_CTA)) {
        entries.push({ projectId: project.id, listingId: listing.id });
      }
    }
  }
  return entries;
}

function terminalCtaEntries(state) {
  return legacyCtaEntries(state).filter(({ projectId, listingId }) => {
    const { listing } = listingContext(state, projectId, listingId);
    return String(listing.texts?.description ?? "").endsWith(LEGACY_FIXED_DESCRIPTION_CTA);
  });
}

function sameFieldScope(fieldPlans, entries) {
  const planKeys = new Set(fieldPlans.map((plan) => `${plan.projectId}:${plan.listingId}`));
  const entryKeys = new Set(entries.map((entry) => `${entry.projectId}:${entry.listingId}`));
  return planKeys.size === entryKeys.size
    && [...planKeys].every((key) => entryKeys.has(key));
}

function planCtaChange(state, fieldPlan) {
  const context = listingContext(state, fieldPlan.projectId, fieldPlan.listingId);
  const previousText = String(context.listing.texts?.description ?? "");
  const removal = removeKnownCta(previousText);
  if (!removal.text) {
    return {
      listingId: fieldPlan.listingId,
      projectId: fieldPlan.projectId,
      field: fieldPlan.field,
      rejectedReason: removal.reason,
    };
  }
  const beforeBlocks = fieldBlocks(context, context.listing.texts);
  const replacementTexts = { ...context.listing.texts, description: removal.text };
  const afterBlocks = fieldBlocks(context, replacementTexts);
  if (afterBlocks.length >= beforeBlocks.length) {
    return {
      listingId: fieldPlan.listingId,
      projectId: fieldPlan.projectId,
      field: fieldPlan.field,
      rejectedReason: "Die exakte CTA-Entfernung reduziert keine BLOCK-Treffer im vollständigen Feld.",
    };
  }
  return {
    listingId: fieldPlan.listingId,
    externalId: context.listing.externalId,
    projectId: fieldPlan.projectId,
    project: fieldPlan.project,
    house: fieldPlan.house,
    field: fieldPlan.field,
    previousText,
    replacementText: removal.text,
    previousHash: sha256(previousText),
    replacementHash: sha256(removal.text),
    removedCtaHash: sha256(LEGACY_FIXED_DESCRIPTION_CTA),
    beforeBlocks,
    afterBlocks,
  };
}

/** Builds the Phase-2B.2 scope only from remaining MANUAL_REVIEW fields. */
export function planPhase2BCtaCleanup(state, options = {}) {
  const scan = options.scan || scanPhase2BClaims;
  const report = scan(state, options.scanOptions);
  const scope = scanScope(state, report);
  const legacyCtas = legacyCtaEntries(state);
  const terminalCtas = terminalCtaEntries(state);
  const entries = scope.ctaPlans.map((fieldPlan) => planCtaChange(state, fieldPlan));
  const trueManualSnapshots = scope.trueManualPlans.map((fieldPlan) => {
    const context = listingContext(state, fieldPlan.projectId, fieldPlan.listingId);
    return {
      listingId: fieldPlan.listingId,
      projectId: fieldPlan.projectId,
      field: fieldPlan.field,
      text: String(context.listing.texts?.title ?? ""),
      hash: sha256(String(context.listing.texts?.title ?? "")),
    };
  });
  return {
    report,
    manualFieldCount: scope.manualPlans.length,
    descriptionManualCount: scope.descriptionManualPlans.length,
    ctaCandidateCount: scope.ctaPlans.length,
    legacyCtaOccurrenceCount: legacyCtas.length,
    terminalCtaCount: terminalCtas.length,
    ctaScopeMatchesTerminalCtas: sameFieldScope(scope.ctaPlans, terminalCtas),
    trueManualCount: scope.trueManualPlans.length,
    nonCtaDescriptionCount: scope.nonCtaDescriptionPlans.length,
    unexpectedManualCount: scope.unexpectedManualPlans.length,
    changes: entries.filter((entry) => !entry.rejectedReason),
    rejected: entries.filter((entry) => entry.rejectedReason),
    trueManualSnapshots,
  };
}

function isIdempotentScope(scope, legacyCtas, terminalCtas, expectedTrueManualCount) {
  return legacyCtas.length === 0
    && terminalCtas.length === 0
    && scope.trueManualPlans.length === expectedTrueManualCount
    && scope.unexpectedManualPlans.length === 0;
}

function requireExecutablePlan(plan, expectedCtaCount, expectedTrueManualCount) {
  if (plan.manualFieldCount !== expectedCtaCount + expectedTrueManualCount
    || plan.descriptionManualCount !== expectedCtaCount
    || plan.ctaCandidateCount !== expectedCtaCount
    || plan.legacyCtaOccurrenceCount !== expectedCtaCount
    || plan.terminalCtaCount !== expectedCtaCount
    || !plan.ctaScopeMatchesTerminalCtas
    || plan.trueManualCount !== expectedTrueManualCount
    || plan.nonCtaDescriptionCount !== 0
    || plan.unexpectedManualCount !== 0) {
    throw new Error(`PHASE2B_CTA_SCOPE_MISMATCH: Erwartet ${expectedCtaCount} CTA- und ${expectedTrueManualCount} TRUE-MANUAL-Felder, gefunden ${plan.ctaCandidateCount} und ${plan.trueManualCount}.`);
  }
  if (plan.rejected.length || plan.changes.length !== expectedCtaCount) {
    throw new Error("PHASE2B_CTA_VALIDATION_FAILED: Mindestens ein CTA-Feld ist nicht exakt und atomar entfernbar.");
  }
}

function updatePlannedDescription(state, change) {
  const project = state.projects.find((candidate) => candidate?.id === change.projectId);
  const listing = project?.listings?.find((candidate) => candidate?.id === change.listingId);
  if (!listing || String(listing.texts?.description ?? "") !== change.previousText) {
    throw new Error(`PHASE2B_CTA_SCOPE_CHANGED: Das CTA-Feld von ${change.listingId} wurde seit der Planung verändert.`);
  }
  listing.texts = { ...listing.texts, description: change.replacementText };
}

/** Pure and idempotent CTA-only migration; it has no generator or upload path. */
export function applyPhase2BCtaCleanup(state, options = {}) {
  const expectedCtaCount = options.expectedCtaCount ?? PHASE2B_CTA_EXPECTED_FIELD_COUNT;
  const expectedTrueManualCount = options.expectedTrueManualCount ?? PHASE2B_CTA_EXPECTED_TRUE_MANUAL_COUNT;
  const plan = planPhase2BCtaCleanup(state, options);
  const beforeScope = scanScope(state, plan.report);
  const beforeLegacyCtas = legacyCtaEntries(state);
  const beforeTerminalCtas = terminalCtaEntries(state);
  if (isIdempotentScope(beforeScope, beforeLegacyCtas, beforeTerminalCtas, expectedTrueManualCount)) {
    return { state, plan, changed: false, idempotent: true };
  }
  requireExecutablePlan(plan, expectedCtaCount, expectedTrueManualCount);

  const nextState = structuredClone(state);
  for (const change of plan.changes) updatePlannedDescription(nextState, change);

  const afterReport = (options.scan || scanPhase2BClaims)(nextState, options.scanOptions);
  const afterScope = scanScope(nextState, afterReport);
  if (!isIdempotentScope(
    afterScope,
    legacyCtaEntries(nextState),
    terminalCtaEntries(nextState),
    expectedTrueManualCount,
  )) {
    throw new Error("PHASE2B_CTA_POSTCHECK_FAILED: Der Katalog enthält noch CTA-Fälle oder einen unerwarteten MANUAL-Review-Scope.");
  }
  return { state: nextState, plan, afterReport, changed: true, idempotent: false };
}

export function assertPhase2BCtaCleanupIntegrity(before, after, plan) {
  for (const snapshot of plan.trueManualSnapshots) {
    const beforeContext = listingContext(before, snapshot.projectId, snapshot.listingId);
    const afterContext = listingContext(after, snapshot.projectId, snapshot.listingId);
    const afterText = String(afterContext.listing.texts?.title ?? "");
    if (beforeContext.listing.texts.title !== afterText || sha256(afterText) !== snapshot.hash) {
      throw new Error(`PHASE2B_CTA_TRUE_MANUAL_CHANGED: ${snapshot.listingId} wurde unzulässig verändert.`);
    }
  }
  const comparable = structuredClone(after);
  for (const change of plan.changes) {
    const beforeContext = listingContext(before, change.projectId, change.listingId);
    const afterContext = listingContext(comparable, change.projectId, change.listingId);
    afterContext.listing.texts = { ...afterContext.listing.texts, description: beforeContext.listing.texts.description };
  }
  if (!isDeepStrictEqual(before, comparable)) {
    throw new Error("PHASE2B_CTA_INTEGRITY_FAILED: Es wurden Daten außerhalb der freigegebenen CTA-Felder verändert.");
  }
  return true;
}

function validManifest(manifest) {
  return manifest?.format === 2
    && manifest.state?.version === 1
    && Array.isArray(manifest.state.houses)
    && Array.isArray(manifest.state.projects);
}

function safeTimestamp(now) {
  const date = new Date(String(now ?? ""));
  if (Number.isNaN(date.getTime())) throw new Error("Der Backup-Zeitpunkt ist ungültig.");
  return date.toISOString().replaceAll(":", "-");
}

export async function createPhase2BCtaCatalogBackup(options = {}) {
  const catalogDirectory = options.catalogDirectory || CATALOG_V2_DIRECTORY;
  const backupDirectory = options.backupDirectory || PHASE2B_CTA_BACKUP_DIRECTORY;
  const now = options.now || new Date().toISOString();
  const manifestPath = join(catalogDirectory, "manifest.json");
  const source = await readFile(manifestPath);
  const manifest = JSON.parse(source.toString("utf8"));
  if (!validManifest(manifest)) throw new Error("Der aktive Katalog kann nicht als gültiger Phase-2B.2-Backup bestätigt werden.");
  const createdAt = new Date(now).toISOString();
  const backupPath = join(backupDirectory, `manifest.pre-phase2b-cta-cleanup-${safeTimestamp(createdAt)}.json`);
  await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
  await copyFile(manifestPath, backupPath, fileSystemConstants.COPYFILE_EXCL);
  const backup = await readFile(backupPath);
  const manifestHash = sha256(source);
  const backupHash = sha256(backup);
  if (manifestHash !== backupHash) throw new Error("Der Phase-2B.2-Backup stimmt nicht bytegenau mit dem aktiven Manifest überein.");
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

export async function verifyPhase2BCtaCatalogBackup(backupPath, expectedHash = "") {
  const data = await readFile(backupPath);
  const manifest = JSON.parse(data.toString("utf8"));
  const backupHash = sha256(data);
  if (!validManifest(manifest)) throw new Error("Der Phase-2B.2-Backup ist nicht wiederherstellbar.");
  if (expectedHash && backupHash !== expectedHash) throw new Error("Der Phase-2B.2-Backup-Hash stimmt nicht mit dem erwarteten Stand überein.");
  return { backupHash, savedAt: clean(manifest.savedAt), bytes: data.length, restorable: true };
}

function assertNoImplicitNormalization(state, now) {
  if (cleanupStudioState(state, { apply: true, now }).changed) {
    throw new Error("PHASE2B_CTA_NORMALIZATION_REQUIRED: Der kanonische Speicherweg würde weitere Katalogdaten normalisieren.");
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

/** Executes one canonical, CAS-protected CTA-only local catalog write. */
export async function runPhase2BCtaCleanup(options = {}) {
  const catalogDirectory = options.catalogDirectory || CATALOG_V2_DIRECTORY;
  const load = options.loadCatalogManifest || loadCatalogManifest;
  const start = options.startCatalogSnapshot || startCatalogSnapshot;
  const commit = options.commitCatalogSnapshot || commitCatalogSnapshot;
  const discard = options.discardCatalogSnapshot || discardCatalogSnapshot;
  const now = options.now || new Date().toISOString();
  const current = await load(catalogDirectory);
  if (!current?.stored || !current.state) throw new Error("Der aktive Inseratkatalog ist nicht verfügbar.");
  assertNoImplicitNormalization(current.state, now);

  const preview = applyPhase2BCtaCleanup(current.state, options);
  if (!preview.changed) return { changed: false, idempotent: true, plan: preview.plan, beforeReport: preview.plan.report };
  assertNoImplicitNormalization(preview.state, now);

  const backup = await createPhase2BCtaCatalogBackup({
    catalogDirectory,
    backupDirectory: options.backupDirectory,
    now,
  });
  const sessionId = `phase2b-cta-cleanup-${randomUUID()}`;
  try {
    const snapshot = await start({
      state: preview.state,
      sessionId,
      savedAt: nextSavedAt(current.savedAt, now),
      expectedSavedAt: current.savedAt,
    }, catalogDirectory);
    if (snapshot.missingImageIds.length) {
      throw new Error("PHASE2B_CTA_IMAGE_INTEGRITY_FAILED: Der Speicherweg meldet fehlende Bilddateien.");
    }
    await commit(sessionId, catalogDirectory);
  } catch (error) {
    await discard(sessionId, catalogDirectory).catch(() => undefined);
    throw error;
  }

  const persisted = await load(catalogDirectory);
  if (!persisted?.stored || !persisted.state) throw new Error("Der Katalog konnte nach Phase-2B.2 nicht erneut geladen werden.");
  assertPhase2BCtaCleanupIntegrity(current.state, persisted.state, preview.plan);
  const afterReport = (options.scan || scanPhase2BClaims)(persisted.state, options.scanOptions);
  const persistedScope = scanScope(persisted.state, afterReport);
  if (!isIdempotentScope(
    persistedScope,
    legacyCtaEntries(persisted.state),
    terminalCtaEntries(persisted.state),
    options.expectedTrueManualCount ?? PHASE2B_CTA_EXPECTED_TRUE_MANUAL_COUNT,
  )) {
    throw new Error("PHASE2B_CTA_POSTCHECK_FAILED: Der persistierte Katalog enthält einen unerwarteten CTA- oder MANUAL-Review-Scope.");
  }
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
