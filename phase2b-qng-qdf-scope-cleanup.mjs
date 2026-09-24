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
  collectListingFacts,
  FACT_SCOPE,
  LIVING_HAUS_IKON_TECHNICAL_PACKAGE_ID,
  LIVING_HAUS_SERIES_ID,
  technicalPackageFactSentence,
  validateListingClaims,
} from "./listing-claim-policy.mjs";
import { APPLICATION_DATA_DIRECTORY } from "./platform-paths.mjs";
import { scanPhase2BClaims } from "./phase2b-claim-scan.mjs";

export const PHASE2B_QNG_QDF_SCOPE_BACKUP_DIRECTORY = join(
  APPLICATION_DATA_DIRECTORY,
  "phase2b-qng-qdf-scope-backups",
);

export const PHASE2B_QNG_QDF_SCOPE_EXPECTED = Object.freeze({
  activeListings: 44,
  qngSentenceRemovals: 44,
  qngTitleRemovals: 8,
  energyClassRemovals: 3,
  ikonDuplicateRemovals: 4,
  certificationSentenceReplacements: 1,
});

export const PHASE2B_QNG_QDF_SCOPE_GUARANTEE = Object.freeze({
  usesAi: false,
  triggersUploads: false,
  createsQdfFactWithoutEvidence: false,
  changesOnlyApprovedTextFields: true,
});

const QNG_SENTENCE = "Für die zugehörige Hausserie ist ein verifiziertes QNG-Serienmerkmal hinterlegt.";
const QNG_TITLE_FRAGMENT = "QNG-Serienmerkmal und ";
const CERTIFICATION_LISTING_EXTERNAL_ID = "30460-4";
const CERTIFICATION_SENTENCE = "Hinzu kommen – gemäß Leistungsbeschreibung – unter anderem Bauantragsplanung, Bodengutachten, zwei Tage persönliche Ausstattungsberatung, Bauversicherungen, digitale Hausbauakte sowie DGNB-Serienzertifizierung in Gold und QDF-Zertifizierung.";
const CERTIFICATION_REPLACEMENT = "Hinzu kommen – gemäß Leistungsbeschreibung – unter anderem Bauantragsplanung, Bodengutachten, zwei Tage persönliche Ausstattungsberatung, Bauversicherungen und digitale Hausbauakte. Das projektierte Haus gehört zu einer Hausserie mit verifizierter DGNB-Serienzertifizierung.";
const ENERGY_CLASS_CLAUSE = /([,;])\s*die geplante Energieeffizienzklasse ist A\+\+?\./giu;

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

function activeContexts(state) {
  const houses = new Map((state?.houses || []).map((house) => [house?.id, house]));
  const contexts = [];
  for (const project of state?.projects || []) {
    for (const listing of project?.listings || []) {
      if (!activeListing(project, listing)) continue;
      const house = houses.get(listing.templateId);
      if (!house) throw new Error(`PHASE2B7_HOUSE_MISSING: Hausvorlage für ${listing.id} fehlt.`);
      contexts.push({ project, listing, house });
    }
  }
  return contexts;
}

function findContext(state, listingId) {
  const context = activeContexts(state).find((candidate) => candidate.listing.id === listingId);
  if (!context) throw new Error(`PHASE2B7_LISTING_SCOPE_CHANGED: ${listingId} ist nicht mehr aktiv.`);
  return context;
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

function factsFor(context) {
  return collectListingFacts({
    listingFacts: context.listing.listingFacts,
    house: context.house,
    project: context.project,
    houseSeries: LIVING_HAUS_SERIES_ID,
  });
}

function hasEnergyClassEvidence(context) {
  return factsFor(context).some((fact) => (
    fact.key === "energy_class"
    && fact.scope === FACT_SCOPE.HOUSE
    && fact.verified === true
  ));
}

function qngRemoval(context) {
  const text = String(context.listing.texts?.description ?? "");
  const occurrences = literalOccurrences(text, QNG_SENTENCE);
  if (occurrences !== 1) {
    throw new Error(`PHASE2B7_QNG_SCOPE_CHANGED: ${context.listing.id} enthält den freigegebenen QNG-Satz nicht exakt einmal.`);
  }
  return { kind: "qng_sentence_removal", previousText: QNG_SENTENCE, occurrences };
}

function qngTitleRemoval(context) {
  const text = String(context.listing.texts?.title ?? "");
  const occurrences = literalOccurrences(text, QNG_TITLE_FRAGMENT);
  if (!occurrences) return undefined;
  if (occurrences !== 1) {
    throw new Error(`PHASE2B7_QNG_TITLE_SCOPE_CHANGED: ${context.listing.id} enthält das QNG-Titelfragment nicht exakt einmal.`);
  }
  return {
    kind: "qng_title_removal",
    previousText: QNG_TITLE_FRAGMENT,
    replacementText: "",
    occurrences,
  };
}

function energyClassRemoval(context) {
  const text = String(context.listing.texts?.description ?? "");
  const matches = [...text.matchAll(ENERGY_CLASS_CLAUSE)];
  if (!matches.length) return undefined;
  if (hasEnergyClassEvidence(context)) {
    throw new Error(`PHASE2B7_ENERGY_CLASS_EVIDENCE_CONFLICT: ${context.listing.id} enthält eine belegte Energieklasse und darf nicht automatisch geändert werden.`);
  }
  if (matches.length !== 1) {
    throw new Error(`PHASE2B7_ENERGY_CLASS_SCOPE_CHANGED: ${context.listing.id} enthält nicht genau eine trennbare A+/A++-Klausel.`);
  }
  return {
    kind: "energy_class_removal",
    previousText: matches[0][0],
    replacementText: ".",
    occurrences: 1,
  };
}

function ikonDuplicateRemoval(context) {
  if (clean(context.house.technicalPackage) !== LIVING_HAUS_IKON_TECHNICAL_PACKAGE_ID) return undefined;
  const input = { house: context.house, technicalPackage: context.house.technicalPackage };
  const complete = technicalPackageFactSentence(input);
  const short = technicalPackageFactSentence(input, ["heat_pump", "ventilation"]);
  // Phase 2B.6 hat diese beiden vollständigen Aussagen unmittelbar durch ein
  // Leerzeichen getrennt persistiert. Nur exakt diese direkte Wiederholung ist
  // als redundante Dublette freigegeben.
  const pair = `${complete} ${short}`;
  const text = String(context.listing.texts?.description ?? "");
  const occurrences = literalOccurrences(text, pair);
  if (!occurrences) return undefined;
  if (occurrences !== 1) {
    throw new Error(`PHASE2B7_IKON_DUPLICATE_SCOPE_CHANGED: ${context.listing.id} enthält die I-KON-Dublette nicht exakt einmal.`);
  }
  return {
    kind: "ikon_duplicate_removal",
    previousText: pair,
    replacementText: complete,
    occurrences,
  };
}

function certificationReplacement(context) {
  if (clean(context.listing.externalId) !== CERTIFICATION_LISTING_EXTERNAL_ID) return undefined;
  const text = String(context.listing.texts?.description ?? "");
  const occurrences = literalOccurrences(text, CERTIFICATION_SENTENCE);
  if (occurrences !== 1) {
    throw new Error(`PHASE2B7_CERTIFICATION_SCOPE_CHANGED: ${context.listing.id} enthält den freigegebenen Zertifizierungssatz nicht exakt einmal.`);
  }
  return {
    kind: "certification_sentence_replacement",
    previousText: CERTIFICATION_SENTENCE,
    replacementText: CERTIFICATION_REPLACEMENT,
    occurrences,
  };
}

function applyOperation(text, operation, listingId) {
  if (literalOccurrences(text, operation.previousText) !== operation.occurrences) {
    throw new Error(`PHASE2B7_OPERATION_SCOPE_CHANGED: ${listingId} enthält ${operation.kind} nicht mehr im freigegebenen Umfang.`);
  }
  if (operation.kind === "qng_sentence_removal") {
    return text
      .replace(operation.previousText, "")
      .replace(/[ \t]+\n/gu, "\n")
      .replace(/\n{3,}/gu, "\n\n")
      .trim();
  }
  return text.replace(operation.previousText, operation.replacementText);
}

function descriptionBlocks(context, description) {
  return validateListingClaims({
    texts: { ...context.listing.texts, description },
    images: context.house.images,
    house: context.house,
    project: context.project,
    listingFacts: context.listing.listingFacts,
    houseSeries: LIVING_HAUS_SERIES_ID,
  }).blockingIssues.filter((issue) => issue.field === "Objektbeschreibung");
}

function expectedCounts(options) {
  return { ...PHASE2B_QNG_QDF_SCOPE_EXPECTED, ...(options.expectedCounts || {}) };
}

function countOperations(changes, kind) {
  return changes.flatMap((change) => change.operations).filter((operation) => operation.kind === kind).length;
}

function finalReport(state, options) {
  return (options.scan || scanPhase2BClaims)(state, options.scanOptions);
}

function assertFinalCompliance(state, options) {
  const report = finalReport(state, options);
  if (report.scannedListingCount !== expectedCounts(options).activeListings) {
    throw new Error(`PHASE2B7_FINAL_SCOPE_CHANGED: Erwartet ${expectedCounts(options).activeListings} aktive Inserate, gefunden ${report.scannedListingCount}.`);
  }
  if (report.severityCounts.BLOCK !== 0) {
    throw new Error(`PHASE2B7_FINAL_BLOCKS: Der finale Policy-Scan enthält noch ${report.severityCounts.BLOCK} BLOCK-Treffer.`);
  }
  return report;
}

function idempotentPlan(state, options) {
  const report = assertFinalCompliance(state, options);
  const forbidden = activeContexts(state).flatMap((context) => {
    const text = String(context.listing.texts?.description ?? "");
    return [
      literalOccurrences(text, QNG_SENTENCE),
      literalOccurrences(String(context.listing.texts?.title ?? ""), QNG_TITLE_FRAGMENT),
      [...text.matchAll(ENERGY_CLASS_CLAUSE)].length,
    ];
  }).reduce((sum, count) => sum + count, 0);
  if (forbidden) throw new Error("PHASE2B7_POSTCHECK_FAILED: Ein freigegebener QNG- oder Energieklassenrest ist verblieben.");
  return { changed: false, idempotent: true, report, changes: [] };
}

/** Plans only the released QNG/QDF-scope corrections; it does not persist data. */
export function planPhase2BQngQdfScopeCleanup(state, options = {}) {
  const expected = expectedCounts(options);
  const contexts = activeContexts(state);
  if (contexts.length !== expected.activeListings) {
    throw new Error(`PHASE2B7_ACTIVE_SCOPE_MISMATCH: Erwartet ${expected.activeListings} aktive Inserate, gefunden ${contexts.length}.`);
  }

  const qngOccurrences = contexts.reduce(
    (sum, context) => sum + literalOccurrences(String(context.listing.texts?.description ?? ""), QNG_SENTENCE),
    0,
  );
  if (qngOccurrences === 0) return idempotentPlan(state, options);
  if (qngOccurrences !== expected.qngSentenceRemovals) {
    throw new Error(`PHASE2B7_QNG_SCOPE_MISMATCH: Erwartet ${expected.qngSentenceRemovals} QNG-Sätze, gefunden ${qngOccurrences}.`);
  }

  const existingReport = finalReport(state, options);
  const descriptionChanges = contexts.map((context) => {
    const operations = [
      qngRemoval(context),
      energyClassRemoval(context),
      ikonDuplicateRemoval(context),
      certificationReplacement(context),
    ].filter(Boolean);
    if (!operations.length) return undefined;
    const previousText = String(context.listing.texts?.description ?? "");
    const replacementText = operations.reduce(
      (current, operation) => applyOperation(current, operation, context.listing.id),
      previousText,
    );
    if (!replacementText || /\n{3,}/u.test(replacementText)) {
      throw new Error(`PHASE2B7_DESCRIPTION_FORMAT_FAILED: ${context.listing.id} hätte eine unzulässige Beschreibung.`);
    }
    if (descriptionBlocks(context, replacementText).length) {
      throw new Error(`PHASE2B7_DESCRIPTION_POLICY_FAILED: ${context.listing.id} enthält nach der Minimaländerung noch einen BLOCK.`);
    }
    return {
      field: "description",
      listingId: context.listing.id,
      externalId: context.listing.externalId,
      projectId: context.project.id,
      previousText,
      replacementText,
      previousHash: sha256(previousText),
      replacementHash: sha256(replacementText),
      operations,
    };
  }).filter(Boolean);
  const titleChanges = contexts.map((context) => {
    const operation = qngTitleRemoval(context);
    if (!operation) return undefined;
    const previousText = String(context.listing.texts?.title ?? "");
    const replacementText = applyOperation(previousText, operation, context.listing.id);
    if (!replacementText || /\s{2,}/u.test(replacementText)) {
      throw new Error(`PHASE2B7_TITLE_FORMAT_FAILED: ${context.listing.id} hätte eine unzulässige Überschrift.`);
    }
    return {
      field: "title",
      listingId: context.listing.id,
      externalId: context.listing.externalId,
      projectId: context.project.id,
      previousText,
      replacementText,
      previousHash: sha256(previousText),
      replacementHash: sha256(replacementText),
      operations: [operation],
    };
  }).filter(Boolean);
  const changes = [...descriptionChanges, ...titleChanges];

  if (!changes.length) return idempotentPlan(state, options);
  if (countOperations(changes, "qng_sentence_removal") !== expected.qngSentenceRemovals
    || countOperations(changes, "qng_title_removal") !== expected.qngTitleRemovals
    || countOperations(changes, "energy_class_removal") !== expected.energyClassRemovals
    || countOperations(changes, "ikon_duplicate_removal") !== expected.ikonDuplicateRemovals
    || countOperations(changes, "certification_sentence_replacement") !== expected.certificationSentenceReplacements) {
    throw new Error("PHASE2B7_CHANGESET_MISMATCH: Der deterministische QNG-/QDF-/Energie-/I-KON-Scope weicht von der Freigabe ab.");
  }
  return { changed: true, idempotent: false, beforeReport: existingReport, changes };
}

function setPlannedText(state, change) {
  const context = findContext(state, change.listingId);
  if (context.project.id !== change.projectId || String(context.listing.texts?.[change.field] ?? "") !== change.previousText) {
    throw new Error(`PHASE2B7_CAS_FAILED: ${change.listingId} wurde seit der Planung verändert.`);
  }
  context.listing.texts = { ...context.listing.texts, [change.field]: change.replacementText };
}

export function assertPhase2BQngQdfScopeCleanupIntegrity(before, after, plan) {
  const comparable = structuredClone(after);
  for (const change of plan.changes) {
    const context = findContext(comparable, change.listingId);
    if (sha256(String(context.listing.texts?.[change.field] ?? "")) !== change.replacementHash) {
      throw new Error(`PHASE2B7_DESCRIPTION_INTEGRITY_FAILED: ${change.listingId} stimmt nicht mit dem freigegebenen Ergebnis überein.`);
    }
    context.listing.texts = { ...context.listing.texts, [change.field]: change.previousText };
  }
  if (!isDeepStrictEqual(before, comparable)) {
    throw new Error("PHASE2B7_INTEGRITY_FAILED: Außerhalb der freigegebenen Objektbeschreibungen wurden Daten verändert.");
  }
  return true;
}

/** Pure, deterministic and fail-closed migration without AI, upload or portal access. */
export function applyPhase2BQngQdfScopeCleanup(state, options = {}) {
  const plan = planPhase2BQngQdfScopeCleanup(state, options);
  if (plan.idempotent) return { state, plan, changed: false, idempotent: true, afterReport: plan.report };
  const nextState = structuredClone(state);
  for (const change of plan.changes) setPlannedText(nextState, change);
  assertPhase2BQngQdfScopeCleanupIntegrity(state, nextState, plan);
  const afterReport = assertFinalCompliance(nextState, options);
  const finalPlan = idempotentPlan(nextState, options);
  return { state: nextState, plan, afterReport, finalPlan, changed: true, idempotent: false };
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

export async function createPhase2BQngQdfScopeCatalogBackup(options = {}) {
  const catalogDirectory = options.catalogDirectory || CATALOG_V2_DIRECTORY;
  const backupDirectory = options.backupDirectory || PHASE2B_QNG_QDF_SCOPE_BACKUP_DIRECTORY;
  const now = options.now || new Date().toISOString();
  const manifestPath = join(catalogDirectory, "manifest.json");
  const source = await readFile(manifestPath);
  const manifest = JSON.parse(source.toString("utf8"));
  if (!validManifest(manifest)) throw new Error("Der aktive Katalog kann nicht als gültiger Phase-2B.7-Backup bestätigt werden.");
  const createdAt = new Date(now).toISOString();
  const backupPath = join(backupDirectory, `manifest.pre-phase2b-qng-qdf-scope-${safeTimestamp(createdAt)}.json`);
  await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
  await copyFile(manifestPath, backupPath, fileSystemConstants.COPYFILE_EXCL);
  const backup = await readFile(backupPath);
  const manifestHash = sha256(source);
  const backupHash = sha256(backup);
  if (manifestHash !== backupHash) throw new Error("Der Phase-2B.7-Backup stimmt nicht bytegenau mit dem aktiven Manifest überein.");
  return { catalogDirectory, manifestPath, backupPath, createdAt, savedAt: clean(manifest.savedAt), manifestHash, backupHash, bytes: source.length };
}

export async function verifyPhase2BQngQdfScopeCatalogBackup(backupPath, expectedHash = "") {
  const data = await readFile(backupPath);
  const manifest = JSON.parse(data.toString("utf8"));
  const backupHash = sha256(data);
  if (!validManifest(manifest)) throw new Error("Der Phase-2B.7-Backup ist nicht wiederherstellbar.");
  if (expectedHash && backupHash !== expectedHash) throw new Error("Der Phase-2B.7-Backup-Hash stimmt nicht mit dem erwarteten Stand überein.");
  return { backupHash, savedAt: clean(manifest.savedAt), bytes: data.length, restorable: true };
}

function assertNoImplicitNormalization(state, now) {
  if (cleanupStudioState(state, { apply: true, now }).changed) {
    throw new Error("PHASE2B7_NORMALIZATION_REQUIRED: Der kanonische Speicherweg würde weitere Katalogdaten normalisieren.");
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

/** Executes one backup-protected, CAS-protected local Phase-2B.7 migration. */
export async function runPhase2BQngQdfScopeCleanup(options = {}) {
  const catalogDirectory = options.catalogDirectory || CATALOG_V2_DIRECTORY;
  const load = options.loadCatalogManifest || loadCatalogManifest;
  const start = options.startCatalogSnapshot || startCatalogSnapshot;
  const commit = options.commitCatalogSnapshot || commitCatalogSnapshot;
  const discard = options.discardCatalogSnapshot || discardCatalogSnapshot;
  const now = options.now || new Date().toISOString();
  const current = await load(catalogDirectory);
  if (!current?.stored || !current.state) throw new Error("Der aktive Inseratkatalog ist nicht verfügbar.");
  assertNoImplicitNormalization(current.state, now);

  const preview = applyPhase2BQngQdfScopeCleanup(current.state, options);
  if (!preview.changed) return { changed: false, idempotent: true, plan: preview.plan, beforeReport: preview.plan.report, afterReport: preview.afterReport };
  assertNoImplicitNormalization(preview.state, now);
  const backup = await createPhase2BQngQdfScopeCatalogBackup({ catalogDirectory, backupDirectory: options.backupDirectory, now });
  const sessionId = `phase2b-qng-qdf-scope-${randomUUID()}`;
  try {
    const snapshot = await start({
      state: preview.state,
      sessionId,
      savedAt: nextSavedAt(current.savedAt, now),
      expectedSavedAt: current.savedAt,
    }, catalogDirectory);
    if (snapshot.missingImageIds.length) throw new Error("PHASE2B7_IMAGE_INTEGRITY_FAILED: Der Speicherweg meldet fehlende Bilddateien.");
    await commit(sessionId, catalogDirectory);
  } catch (error) {
    await discard(sessionId, catalogDirectory).catch(() => undefined);
    throw error;
  }
  const persisted = await load(catalogDirectory);
  if (!persisted?.stored || !persisted.state) throw new Error("Der Katalog konnte nach Phase-2B.7 nicht erneut geladen werden.");
  assertPhase2BQngQdfScopeCleanupIntegrity(current.state, persisted.state, preview.plan);
  const persistedCheck = applyPhase2BQngQdfScopeCleanup(persisted.state, options);
  if (persistedCheck.changed || !persistedCheck.idempotent) {
    throw new Error("PHASE2B7_IDEMPOTENCE_FAILED: Der zweite Migrationslauf würde weitere Änderungen vornehmen.");
  }
  return {
    changed: true,
    idempotent: false,
    backup,
    plan: preview.plan,
    beforeReport: preview.plan.beforeReport,
    afterReport: persistedCheck.afterReport,
    finalPlan: persistedCheck.plan,
    persistedSavedAt: persisted.savedAt,
  };
}
