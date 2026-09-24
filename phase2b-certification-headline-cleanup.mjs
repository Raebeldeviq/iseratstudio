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
  CLAIM_CATEGORY,
  collectListingFacts,
  FACT_SCOPE,
  FACT_SOURCE,
  FACT_STATUS,
  LIVING_HAUS_SERIES_ID,
  validateListingClaims,
} from "./listing-claim-policy.mjs";
import { APPLICATION_DATA_DIRECTORY } from "./platform-paths.mjs";
import { PHASE2B_TREATMENT, scanPhase2BClaims } from "./phase2b-claim-scan.mjs";

export const PHASE2B_CERTIFICATION_EXPECTED_DGNB_COUNT = 10;
export const PHASE2B_CERTIFICATION_EXPECTED_QNG_COUNT = 8;
export const PHASE2B_CERTIFICATION_EXPECTED_TECHNICAL_COUNT = 7;
export const PHASE2B_CERTIFICATION_EXPECTED_CHANGE_COUNT = (
  PHASE2B_CERTIFICATION_EXPECTED_DGNB_COUNT + PHASE2B_CERTIFICATION_EXPECTED_QNG_COUNT
);
export const PHASE2B_CERTIFICATION_BACKUP_DIRECTORY = join(
  APPLICATION_DATA_DIRECTORY,
  "phase2b-certification-headline-cleanup-backups",
);

const DGNB_REPLACEMENT = Object.freeze({
  previous: "DGNB-Gold",
  replacement: "DGNB-Serienzertifizierung",
  category: CLAIM_CATEGORY.UNVERIFIED_CERTIFICATION,
  factKey: "certification",
  factValue: "DGNB-Serienzertifizierung",
});

const QNG_REPLACEMENT = Object.freeze({
  previous: "QNG-Potenzial",
  replacement: "QNG-Serienmerkmal",
  category: CLAIM_CATEGORY.UNVERIFIED_SUSTAINABILITY_LABEL,
  factKey: "sustainability_label",
  factValue: "QNG-Serienmerkmal",
});

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
    throw new Error(`Das Überschriften-Inserat ${listingId} ist nicht mehr aktiv oder seine Hausvorlage fehlt.`);
  }
  return { project, listing, house };
}

function literalOccurrences(text, phrase) {
  let start = 0;
  let count = 0;
  while (true) {
    const index = text.indexOf(phrase, start);
    if (index < 0) return count;
    count += 1;
    start = index + phrase.length;
  }
}

function matchingSeriesFact(context, replacement) {
  return collectListingFacts({
    listingFacts: context.listing.listingFacts,
    house: context.house,
    project: context.project,
    houseSeries: LIVING_HAUS_SERIES_ID,
  }).find((fact) => (
    fact.key === replacement.factKey
    && clean(fact.value) === replacement.factValue
    && fact.sourceKind === FACT_SOURCE.VERIFIED_SERIES
    && fact.scope === FACT_SCOPE.HOUSE_SERIES
    && fact.status === FACT_STATUS.VERIFIED
    && fact.verified === true
    && fact.seriesId === LIVING_HAUS_SERIES_ID
  ));
}

function titleBlocks(context, title) {
  return validateListingClaims({
    texts: { ...context.listing.texts, title },
    images: context.house.images,
    house: context.house,
    project: context.project,
    listingFacts: context.listing.listingFacts,
    houseSeries: LIVING_HAUS_SERIES_ID,
  }).blockingIssues.filter((issue) => issue.field === "Überschrift");
}

function manualTitlePlans(report) {
  return report.fieldPlans.filter((plan) => (
    plan.field === "Überschrift"
    && plan.proposedTreatment === PHASE2B_TREATMENT.MANUAL_REVIEW
  ));
}

function planHasCategory(plan, category) {
  return Array.isArray(plan.categories) && plan.categories.includes(category);
}

function scanScope(state, report) {
  const titles = manualTitlePlans(report);
  const dgnbPlans = titles.filter((plan) => {
    if (!planHasCategory(plan, DGNB_REPLACEMENT.category)) return false;
    const context = listingContext(state, plan.projectId, plan.listingId);
    return String(context.listing.texts?.title ?? "").includes(DGNB_REPLACEMENT.previous);
  });
  const qngPlans = titles.filter((plan) => {
    if (!planHasCategory(plan, QNG_REPLACEMENT.category)) return false;
    const context = listingContext(state, plan.projectId, plan.listingId);
    return String(context.listing.texts?.title ?? "").includes(QNG_REPLACEMENT.previous);
  });
  const technicalPlans = titles.filter((plan) => planHasCategory(plan, CLAIM_CATEGORY.UNVERIFIED_TECHNICAL_CLAIM));
  return {
    titles,
    dgnbPlans,
    qngPlans,
    technicalPlans,
    unexpectedTitlePlans: titles.filter((plan) => (
      !dgnbPlans.includes(plan) && !qngPlans.includes(plan) && !technicalPlans.includes(plan)
    )),
  };
}

function planHeadlineChange(state, fieldPlan, replacement) {
  const context = listingContext(state, fieldPlan.projectId, fieldPlan.listingId);
  const previousText = String(context.listing.texts?.title ?? "");
  if (literalOccurrences(previousText, replacement.previous) !== 1) {
    return {
      listingId: fieldPlan.listingId,
      projectId: fieldPlan.projectId,
      field: fieldPlan.field,
      rejectedReason: `Die freigegebene Passage „${replacement.previous}“ ist nicht genau einmal vorhanden.`,
    };
  }
  const seriesFact = matchingSeriesFact(context, replacement);
  if (!seriesFact) {
    return {
      listingId: fieldPlan.listingId,
      projectId: fieldPlan.projectId,
      field: fieldPlan.field,
      rejectedReason: `Der verifizierte Serienfakt „${replacement.factValue}“ ist im konkreten Living-Haus-Kontext nicht verfügbar.`,
    };
  }
  const replacementText = previousText.replace(replacement.previous, replacement.replacement);
  const blockingIssues = titleBlocks(context, replacementText);
  if (blockingIssues.length) {
    return {
      listingId: fieldPlan.listingId,
      projectId: fieldPlan.projectId,
      field: fieldPlan.field,
      rejectedReason: "Die vollständige Überschrift ist nach der exakten Serienfakt-Ersetzung nicht blockfrei.",
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
    previousText,
    replacementText,
    previousHash: sha256(previousText),
    replacementHash: sha256(replacementText),
    seriesFact: {
      key: seriesFact.key,
      value: seriesFact.value,
      sourceKind: seriesFact.sourceKind,
      scope: seriesFact.scope,
      status: seriesFact.status,
      evidenceReference: seriesFact.evidenceReference,
    },
  };
}

/** Plans only exact DGNB/QNG phrase replacements in existing headlines. */
export function planPhase2BCertificationHeadlineCleanup(state, options = {}) {
  const scan = options.scan || scanPhase2BClaims;
  const report = scan(state, options.scanOptions);
  const scope = scanScope(state, report);
  const entries = [
    ...scope.dgnbPlans.map((plan) => planHeadlineChange(state, plan, DGNB_REPLACEMENT)),
    ...scope.qngPlans.map((plan) => planHeadlineChange(state, plan, QNG_REPLACEMENT)),
  ];
  const technicalSnapshots = scope.technicalPlans.map((plan) => {
    const context = listingContext(state, plan.projectId, plan.listingId);
    const text = String(context.listing.texts?.title ?? "");
    return { listingId: plan.listingId, projectId: plan.projectId, field: plan.field, text, hash: sha256(text) };
  });
  return {
    report,
    manualFieldCount: report.treatmentCounts.MANUAL_REVIEW,
    titleManualCount: scope.titles.length,
    dgnbCount: scope.dgnbPlans.length,
    qngCount: scope.qngPlans.length,
    technicalCount: scope.technicalPlans.length,
    unexpectedTitleCount: scope.unexpectedTitlePlans.length,
    changes: entries.filter((entry) => !entry.rejectedReason),
    rejected: entries.filter((entry) => entry.rejectedReason),
    technicalSnapshots,
  };
}

function isIdempotentScope(plan, expectedTechnicalCount) {
  return plan.dgnbCount === 0
    && plan.qngCount === 0
    && plan.technicalCount === expectedTechnicalCount
    && plan.titleManualCount === expectedTechnicalCount
    && plan.unexpectedTitleCount === 0;
}

function requireExecutablePlan(plan, options) {
  const expectedDgnbCount = options.expectedDgnbCount ?? PHASE2B_CERTIFICATION_EXPECTED_DGNB_COUNT;
  const expectedQngCount = options.expectedQngCount ?? PHASE2B_CERTIFICATION_EXPECTED_QNG_COUNT;
  const expectedTechnicalCount = options.expectedTechnicalCount ?? PHASE2B_CERTIFICATION_EXPECTED_TECHNICAL_COUNT;
  const expectedManualFieldCount = options.expectedManualFieldCount
    ?? (PHASE2B_CERTIFICATION_EXPECTED_CHANGE_COUNT + expectedTechnicalCount + 44);
  if (plan.report.scannedListingCount !== 44
    || plan.manualFieldCount !== expectedManualFieldCount
    || plan.titleManualCount !== expectedDgnbCount + expectedQngCount + expectedTechnicalCount
    || plan.dgnbCount !== expectedDgnbCount
    || plan.qngCount !== expectedQngCount
    || plan.technicalCount !== expectedTechnicalCount
    || plan.unexpectedTitleCount !== 0) {
    throw new Error(`PHASE2B_CERTIFICATION_SCOPE_MISMATCH: Erwartet ${expectedDgnbCount} DGNB-, ${expectedQngCount} QNG- und ${expectedTechnicalCount} Techniküberschriften.`);
  }
  if (plan.rejected.length || plan.changes.length !== expectedDgnbCount + expectedQngCount) {
    throw new Error("PHASE2B_CERTIFICATION_VALIDATION_FAILED: Mindestens eine Überschrift ist nicht exakt und policy-konform ersetzbar.");
  }
}

function setPlannedTitle(state, change) {
  const project = state.projects.find((candidate) => candidate?.id === change.projectId);
  const listing = project?.listings?.find((candidate) => candidate?.id === change.listingId);
  if (!listing || String(listing.texts?.title ?? "") !== change.previousText) {
    throw new Error(`PHASE2B_CERTIFICATION_SCOPE_CHANGED: Die Überschrift von ${change.listingId} wurde seit der Planung verändert.`);
  }
  listing.texts = { ...listing.texts, title: change.replacementText };
}

/** Pure, deterministic headline-only migration with no generator or upload dependency. */
export function applyPhase2BCertificationHeadlineCleanup(state, options = {}) {
  const expectedTechnicalCount = options.expectedTechnicalCount ?? PHASE2B_CERTIFICATION_EXPECTED_TECHNICAL_COUNT;
  const plan = planPhase2BCertificationHeadlineCleanup(state, options);
  if (isIdempotentScope(plan, expectedTechnicalCount)) {
    return { state, plan, changed: false, idempotent: true };
  }
  requireExecutablePlan(plan, options);

  const nextState = structuredClone(state);
  for (const change of plan.changes) setPlannedTitle(nextState, change);
  const afterReport = (options.scan || scanPhase2BClaims)(nextState, options.scanOptions);
  const afterPlan = planPhase2BCertificationHeadlineCleanup(nextState, { ...options, scan: () => afterReport });
  if (!isIdempotentScope(afterPlan, expectedTechnicalCount)) {
    throw new Error("PHASE2B_CERTIFICATION_POSTCHECK_FAILED: Nach der Migration sind Zertifizierungs-/QNG-Überschriften oder ein unerwarteter Rest-Scope verblieben.");
  }
  return { state: nextState, plan, afterReport, changed: true, idempotent: false };
}

export function assertPhase2BCertificationHeadlineIntegrity(before, after, plan) {
  for (const snapshot of plan.technicalSnapshots) {
    const beforeContext = listingContext(before, snapshot.projectId, snapshot.listingId);
    const afterContext = listingContext(after, snapshot.projectId, snapshot.listingId);
    const afterText = String(afterContext.listing.texts?.title ?? "");
    if (beforeContext.listing.texts.title !== afterText || sha256(afterText) !== snapshot.hash) {
      throw new Error(`PHASE2B_CERTIFICATION_TECHNICAL_CHANGED: ${snapshot.listingId} wurde unzulässig verändert.`);
    }
  }
  const comparable = structuredClone(after);
  for (const change of plan.changes) {
    const beforeContext = listingContext(before, change.projectId, change.listingId);
    const afterContext = listingContext(comparable, change.projectId, change.listingId);
    afterContext.listing.texts = { ...afterContext.listing.texts, title: beforeContext.listing.texts.title };
  }
  if (!isDeepStrictEqual(before, comparable)) {
    throw new Error("PHASE2B_CERTIFICATION_INTEGRITY_FAILED: Es wurden Daten außerhalb der 18 freigegebenen Überschriften verändert.");
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

export async function createPhase2BCertificationCatalogBackup(options = {}) {
  const catalogDirectory = options.catalogDirectory || CATALOG_V2_DIRECTORY;
  const backupDirectory = options.backupDirectory || PHASE2B_CERTIFICATION_BACKUP_DIRECTORY;
  const now = options.now || new Date().toISOString();
  const manifestPath = join(catalogDirectory, "manifest.json");
  const source = await readFile(manifestPath);
  const manifest = JSON.parse(source.toString("utf8"));
  if (!validManifest(manifest)) throw new Error("Der aktive Katalog kann nicht als gültiger Phase-2B.3-Backup bestätigt werden.");
  const createdAt = new Date(now).toISOString();
  const backupPath = join(backupDirectory, `manifest.pre-phase2b-certification-headline-cleanup-${safeTimestamp(createdAt)}.json`);
  await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
  await copyFile(manifestPath, backupPath, fileSystemConstants.COPYFILE_EXCL);
  const backup = await readFile(backupPath);
  const manifestHash = sha256(source);
  const backupHash = sha256(backup);
  if (manifestHash !== backupHash) throw new Error("Der Phase-2B.3-Backup stimmt nicht bytegenau mit dem aktiven Manifest überein.");
  return { catalogDirectory, manifestPath, backupPath, createdAt, savedAt: clean(manifest.savedAt), manifestHash, backupHash, bytes: source.length };
}

export async function verifyPhase2BCertificationCatalogBackup(backupPath, expectedHash = "") {
  const data = await readFile(backupPath);
  const manifest = JSON.parse(data.toString("utf8"));
  const backupHash = sha256(data);
  if (!validManifest(manifest)) throw new Error("Der Phase-2B.3-Backup ist nicht wiederherstellbar.");
  if (expectedHash && backupHash !== expectedHash) throw new Error("Der Phase-2B.3-Backup-Hash stimmt nicht mit dem erwarteten Stand überein.");
  return { backupHash, savedAt: clean(manifest.savedAt), bytes: data.length, restorable: true };
}

function assertNoImplicitNormalization(state, now) {
  if (cleanupStudioState(state, { apply: true, now }).changed) {
    throw new Error("PHASE2B_CERTIFICATION_NORMALIZATION_REQUIRED: Der kanonische Speicherweg würde weitere Katalogdaten normalisieren.");
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

/** Executes one CAS-protected, local 18-headline write through the catalog store. */
export async function runPhase2BCertificationHeadlineCleanup(options = {}) {
  const catalogDirectory = options.catalogDirectory || CATALOG_V2_DIRECTORY;
  const load = options.loadCatalogManifest || loadCatalogManifest;
  const start = options.startCatalogSnapshot || startCatalogSnapshot;
  const commit = options.commitCatalogSnapshot || commitCatalogSnapshot;
  const discard = options.discardCatalogSnapshot || discardCatalogSnapshot;
  const now = options.now || new Date().toISOString();
  const current = await load(catalogDirectory);
  if (!current?.stored || !current.state) throw new Error("Der aktive Inseratkatalog ist nicht verfügbar.");
  assertNoImplicitNormalization(current.state, now);

  const preview = applyPhase2BCertificationHeadlineCleanup(current.state, options);
  if (!preview.changed) return { changed: false, idempotent: true, plan: preview.plan, beforeReport: preview.plan.report };
  assertNoImplicitNormalization(preview.state, now);
  const backup = await createPhase2BCertificationCatalogBackup({ catalogDirectory, backupDirectory: options.backupDirectory, now });
  const sessionId = `phase2b-certification-headline-cleanup-${randomUUID()}`;
  try {
    const snapshot = await start({
      state: preview.state,
      sessionId,
      savedAt: nextSavedAt(current.savedAt, now),
      expectedSavedAt: current.savedAt,
    }, catalogDirectory);
    if (snapshot.missingImageIds.length) throw new Error("PHASE2B_CERTIFICATION_IMAGE_INTEGRITY_FAILED: Der Speicherweg meldet fehlende Bilddateien.");
    await commit(sessionId, catalogDirectory);
  } catch (error) {
    await discard(sessionId, catalogDirectory).catch(() => undefined);
    throw error;
  }
  const persisted = await load(catalogDirectory);
  if (!persisted?.stored || !persisted.state) throw new Error("Der Katalog konnte nach Phase-2B.3 nicht erneut geladen werden.");
  assertPhase2BCertificationHeadlineIntegrity(current.state, persisted.state, preview.plan);
  const afterReport = (options.scan || scanPhase2BClaims)(persisted.state, options.scanOptions);
  const afterPlan = planPhase2BCertificationHeadlineCleanup(persisted.state, { ...options, scan: () => afterReport });
  if (!isIdempotentScope(afterPlan, options.expectedTechnicalCount ?? PHASE2B_CERTIFICATION_EXPECTED_TECHNICAL_COUNT)) {
    throw new Error("PHASE2B_CERTIFICATION_POSTCHECK_FAILED: Der persistierte Katalog enthält einen unerwarteten Überschriften-Scope.");
  }
  return { changed: true, idempotent: false, backup, plan: preview.plan, beforeReport: preview.plan.report, afterReport, persistedSavedAt: persisted.savedAt };
}
