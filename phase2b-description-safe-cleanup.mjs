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
  FACT_EVIDENCE_KIND,
  FACT_SCOPE,
  FACT_SOURCE,
  FACT_STATUS,
  LIVING_HAUS_SERIES_ID,
  technicalFactSentences,
  validateListingClaims,
} from "./listing-claim-policy.mjs";
import { APPLICATION_DATA_DIRECTORY } from "./platform-paths.mjs";
import {
  analyzePhase2BDescriptions,
  DESCRIPTION_ACTION,
} from "./phase2b-description-analysis.mjs";
import { PHASE2B_TREATMENT, scanPhase2BClaims } from "./phase2b-claim-scan.mjs";

export const PHASE2B_DESCRIPTION_SAFE_CLEANUP_BACKUP_DIRECTORY = join(
  APPLICATION_DATA_DIRECTORY,
  "phase2b-description-safe-cleanup-backups",
);

export const PHASE2B_DESCRIPTION_SAFE_CLEANUP_INITIAL_SCOPE = Object.freeze({
  activeListings: 44,
  affectedFields: 51,
  blockClaims: 288,
  descriptionFields: 44,
  descriptionClaims: 274,
  technicalHeadlineFields: 7,
  technicalClaims: 14,
});

export const PHASE2B_DESCRIPTION_SAFE_CLEANUP_FINAL_SCOPE = Object.freeze({
  activeListings: 44,
  affectedFields: 51,
  blockClaims: 119,
  descriptionFields: 44,
  descriptionClaims: 105,
  technicalHeadlineFields: 7,
  technicalClaims: 14,
});

export const PHASE2B_DESCRIPTION_SAFE_CLEANUP_EXPECTED = Object.freeze({
  environmentalHeadlines: 40,
  qngReplacements: 44,
  energyClassRemovals: 1,
  protectedHumanSegments: 51,
  changedFields: 44,
});

const CLUSTER = Object.freeze({
  ENVIRONMENTAL_HEADLINE: "I_KON_UMWELT_HEADLINE",
  QNG: "EFFIZIENZHAUS_QNG_BAUSTEIN",
  ENERGY: "ENERGIEKENNWERT_BAUSTEIN",
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
    throw new Error(`Das Inserat ${listingId} ist nicht mehr aktiv oder seine Hausvorlage fehlt.`);
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

function assertOnlyProtectedDescriptionBlocks(context, afterText, protectedEntries) {
  for (const issue of descriptionBlocks(context, afterText)) {
    const protectedMatch = protectedEntries.some((entry) => {
      const start = afterText.indexOf(entry.sentence);
      return start >= 0 && issue.position >= start && issue.position < start + entry.sentence.length;
    });
    if (!protectedMatch) {
      throw new Error(`PHASE2B_DESCRIPTION_NEW_CLAIM: ${context.listing.id} enthält nach der Migration einen neuen BLOCK-Treffer.`);
    }
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

function projectedEnergyReplacement(context, sentence) {
  const fact = factsFor(context).find((candidate) => (
    candidate.key === "energy_demand"
    && candidate.sourceKind === FACT_SOURCE.HOUSE_TEMPLATE
    && candidate.scope === FACT_SCOPE.HOUSE
    && candidate.status === FACT_STATUS.PLANNED
    && candidate.verified === true
    && candidate.evidenceKind === FACT_EVIDENCE_KIND.PROJECTED_HOUSE_VALUE
  ));
  if (!fact) {
    throw new Error(`PHASE2B_DESCRIPTION_ENERGY_EVIDENCE_MISSING: ${context.listing.id} hat keinen freigegebenen Projektierungswert der Hausvorlage.`);
  }
  const value = `${clean(fact.value)} kWh/(m²·a)`;
  const expected = `Der geplante Energiebedarf liegt bei ${value}, die geplante Energieeffizienzklasse ist A++.`;
  if (sentence !== expected) {
    throw new Error(`PHASE2B_DESCRIPTION_ENERGY_SCOPE_CHANGED: ${context.listing.id} enthält keinen exakt teilbaren Energiekennwertsatz.`);
  }
  const sentences = technicalFactSentences({
    listingFacts: context.listing.listingFacts,
    house: context.house,
    project: context.project,
    houseSeries: LIVING_HAUS_SERIES_ID,
  }).filter((candidate) => /endenergiebedarf/iu.test(candidate));
  if (sentences.length !== 1) {
    throw new Error(`PHASE2B_DESCRIPTION_ENERGY_SENTENCE_MISSING: ${context.listing.id} liefert keine eindeutige zentrale Planungsangabe.`);
  }
  const replacement = sentences[0];
  if (descriptionBlocks(context, replacement).length) {
    throw new Error(`PHASE2B_DESCRIPTION_ENERGY_POLICY_FAILED: Der erhaltene Projektierungswert ist nicht policy-konform.`);
  }
  return {
    text: replacement,
    fact: {
      key: fact.key,
      value: fact.value,
      sourceKind: fact.sourceKind,
      scope: fact.scope,
      status: fact.status,
      evidenceKind: fact.evidenceKind,
      evidenceReference: fact.evidenceReference,
    },
  };
}

function removeExactHeading(text, heading) {
  const line = `${heading}\n`;
  if (literalOccurrences(text, heading) !== 1 || literalOccurrences(text, line) !== 1) {
    throw new Error(`PHASE2B_DESCRIPTION_HEADLINE_SCOPE_CHANGED: Die freigegebene Überschrift „${heading}“ ist nicht exakt einmal als Zeile vorhanden.`);
  }
  const replacement = text.replace(line, "").replace(/\n{3,}/gu, "\n\n");
  if (replacement === text || /\n{3,}/u.test(replacement)) {
    throw new Error("PHASE2B_DESCRIPTION_HEADLINE_FORMAT_FAILED: Die minimale Leerzeilennormalisierung ist nicht sicher möglich.");
  }
  return replacement;
}

function replaceExactSentence(text, previous, replacement, code) {
  if (literalOccurrences(text, previous) !== 1) {
    throw new Error(`${code}: Die freigegebene Passage ist nicht exakt einmal vorhanden.`);
  }
  return text.replace(previous, replacement);
}

function removeExactSentence(text, sentence, code) {
  return replaceExactSentence(text, sentence, "", code)
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function analysisScope(report) {
  const descriptionPlans = report.fieldPlans.filter((plan) => plan.field === "Objektbeschreibung");
  const descriptionFindings = report.findings.filter((finding) => (
    finding.field === "Objektbeschreibung" && finding.severity === "BLOCK"
  ));
  const technicalHeadlinePlans = report.fieldPlans.filter((plan) => (
    plan.field === "Überschrift"
    && plan.proposedTreatment === PHASE2B_TREATMENT.MANUAL_REVIEW
    && plan.categories.includes(CLAIM_CATEGORY.UNVERIFIED_TECHNICAL_CLAIM)
  ));
  const technicalFindings = report.findings.filter((finding) => (
    finding.field === "Überschrift"
    && finding.severity === "BLOCK"
    && finding.category === CLAIM_CATEGORY.UNVERIFIED_TECHNICAL_CLAIM
  ));
  return {
    activeListings: report.scannedListingCount,
    affectedFields: report.affectedFieldCount,
    blockClaims: report.severityCounts.BLOCK,
    descriptionFields: descriptionPlans.length,
    descriptionClaims: descriptionFindings.length,
    technicalHeadlineFields: technicalHeadlinePlans.length,
    technicalClaims: technicalFindings.length,
  };
}

function sameScope(actual, expected) {
  return Object.entries(expected).every(([key, value]) => actual[key] === value);
}

function expectedOptions(options, key, fallback) {
  return options[key] || fallback;
}

function scan(state, options) {
  return (options.scan || scanPhase2BClaims)(state, options.scanOptions);
}

function analysisForScope(state, report, expectedScope, options) {
  return analyzePhase2BDescriptions(state, {
    ...options,
    scan: () => report,
    expectedScope,
  });
}

function exactEntries(analysis) {
  const environmentalHeadlines = analysis.entries.filter((entry) => (
    entry.cluster === CLUSTER.ENVIRONMENTAL_HEADLINE
    && entry.action === DESCRIPTION_ACTION.SAFE_REMOVE
  ));
  const qngReplacements = analysis.entries.filter((entry) => (
    entry.cluster === CLUSTER.QNG
    && entry.action === DESCRIPTION_ACTION.SAFE_REMOVE
  ));
  const energyClassRemovals = analysis.entries.filter((entry) => (
    entry.cluster === CLUSTER.ENERGY
    && entry.action === DESCRIPTION_ACTION.SAFE_PARTIAL_REMOVE
  ));
  const human = analysis.entries.filter((entry) => entry.action === DESCRIPTION_ACTION.HUMAN_DECISION);
  return { environmentalHeadlines, qngReplacements, energyClassRemovals, human };
}

function assertExecutableAnalysis(analysis, options) {
  const expected = expectedOptions(options, "expectedCounts", PHASE2B_DESCRIPTION_SAFE_CLEANUP_EXPECTED);
  const targets = exactEntries(analysis);
  if (targets.environmentalHeadlines.length !== expected.environmentalHeadlines
    || targets.qngReplacements.length !== expected.qngReplacements
    || targets.energyClassRemovals.length !== expected.energyClassRemovals
    || targets.human.length !== expected.protectedHumanSegments
    || analysis.actionCounts.SAFE_REMOVE !== expected.environmentalHeadlines + expected.qngReplacements
    || analysis.actionCounts.SAFE_FACT_REPLACEMENT !== 0
    || analysis.actionCounts.SAFE_PARTIAL_REMOVE !== expected.energyClassRemovals
    || analysis.actionCounts.REWRITE_SENTENCE !== 0
    || analysis.actionCounts.REWRITE_PARAGRAPH !== 0
    || analysis.actionCounts.HUMAN_DECISION !== expected.protectedHumanSegments) {
    throw new Error("PHASE2B_DESCRIPTION_SCOPE_MISMATCH: Die exakt freigegebenen 85 Segmente sind nicht vollständig vorhanden.");
  }
  if (analysis.entries.length !== (
    expected.environmentalHeadlines
    + expected.qngReplacements
    + expected.energyClassRemovals
    + expected.protectedHumanSegments
  )) {
    throw new Error("PHASE2B_DESCRIPTION_SEGMENT_MISMATCH: Neben den 85 freigegebenen Segmenten existiert ein nicht freigegebener Analyse-Segmenttyp.");
  }
  return targets;
}

function protectedSnapshots(state, entries) {
  return entries.map((entry) => {
    const context = listingContext(state, entry.projectId, entry.listingId);
    const description = String(context.listing.texts?.description ?? "");
    const occurrences = literalOccurrences(description, entry.sentence);
    if (occurrences !== 1) {
      throw new Error(`PHASE2B_DESCRIPTION_PROTECTED_SCOPE_CHANGED: ${entry.listingId} enthält eine geschützte Passage nicht exakt einmal.`);
    }
    return {
      listingId: entry.listingId,
      externalId: entry.externalId,
      projectId: entry.projectId,
      paragraph: entry.paragraph,
      sentence: entry.sentence,
      hash: sha256(entry.sentence),
      occurrences,
      cluster: entry.cluster,
      cause: entry.cause,
    };
  });
}

function replacementFor(context, entry) {
  if (entry.cluster === CLUSTER.ENVIRONMENTAL_HEADLINE) {
    return { action: entry.action, text: undefined, apply: (current) => removeExactHeading(current, entry.sentence) };
  }
  if (entry.cluster === CLUSTER.QNG) {
    return {
      action: entry.action,
      text: undefined,
      apply: (current) => removeExactSentence(current, entry.sentence, "PHASE2B_DESCRIPTION_QNG_SCOPE_CHANGED"),
    };
  }
  if (entry.cluster === CLUSTER.ENERGY) {
    const replacement = projectedEnergyReplacement(context, entry.sentence);
    return {
      action: entry.action,
      text: replacement.text,
      fact: replacement.fact,
      apply: (current) => replaceExactSentence(current, entry.sentence, replacement.text, "PHASE2B_DESCRIPTION_ENERGY_SCOPE_CHANGED"),
    };
  }
  throw new Error(`PHASE2B_DESCRIPTION_UNAPPROVED_CLUSTER: ${entry.cluster} darf nicht migriert werden.`);
}

function changeOrder(left, right) {
  const order = new Map([
    [CLUSTER.ENVIRONMENTAL_HEADLINE, 1],
    [CLUSTER.QNG, 2],
    [CLUSTER.ENERGY, 3],
  ]);
  return order.get(left.cluster) - order.get(right.cluster);
}

function buildFieldChanges(state, targets) {
  const entries = [
    ...targets.environmentalHeadlines,
    ...targets.qngReplacements,
    ...targets.energyClassRemovals,
  ];
  const grouped = entries.reduce((groups, entry) => {
    const key = `${entry.projectId}:${entry.listingId}`;
    const group = groups.get(key) || [];
    group.push(entry);
    groups.set(key, group);
    return groups;
  }, new Map());
  const protectedByListing = targets.human.reduce((groups, entry) => {
    const key = `${entry.projectId}:${entry.listingId}`;
    const group = groups.get(key) || [];
    group.push(entry);
    groups.set(key, group);
    return groups;
  }, new Map());
  return [...grouped.values()].map((group) => {
    const first = group[0];
    const context = listingContext(state, first.projectId, first.listingId);
    const previousText = String(context.listing.texts?.description ?? "");
    let replacementText = previousText;
    const segments = [];
    for (const entry of [...group].sort(changeOrder)) {
      const replacement = replacementFor(context, entry);
      replacementText = replacement.apply(replacementText);
      segments.push({
        listingId: entry.listingId,
        externalId: entry.externalId,
        projectId: entry.projectId,
        paragraph: entry.paragraph,
        cluster: entry.cluster,
        action: entry.action,
        previousText: entry.sentence,
        previousHash: sha256(entry.sentence),
        replacementText: replacement.text || "",
        replacementHash: replacement.text ? sha256(replacement.text) : "",
        fact: replacement.fact,
      });
    }
    if (!replacementText || /\n{3,}/u.test(replacementText)) {
      throw new Error(`PHASE2B_DESCRIPTION_FORMAT_FAILED: ${first.listingId} hätte nach der exakt freigegebenen Migration eine unzulässige Absatzstruktur.`);
    }
    assertOnlyProtectedDescriptionBlocks(
      context,
      replacementText,
      protectedByListing.get(`${first.projectId}:${first.listingId}`) || [],
    );
    return {
      listingId: first.listingId,
      externalId: first.externalId,
      projectId: first.projectId,
      previousText,
      replacementText,
      previousHash: sha256(previousText),
      replacementHash: sha256(replacementText),
      beforeBlocks: descriptionBlocks(context, previousText),
      afterBlocks: descriptionBlocks(context, replacementText),
      segments,
    };
  });
}

function assertFinalAnalysis(analysis, options) {
  const expected = expectedOptions(options, "expectedCounts", PHASE2B_DESCRIPTION_SAFE_CLEANUP_EXPECTED);
  if (analysis.entries.length !== expected.protectedHumanSegments
    || analysis.actionCounts.SAFE_REMOVE !== 0
    || analysis.actionCounts.SAFE_FACT_REPLACEMENT !== 0
    || analysis.actionCounts.SAFE_PARTIAL_REMOVE !== 0
    || analysis.actionCounts.REWRITE_SENTENCE !== 0
    || analysis.actionCounts.REWRITE_PARAGRAPH !== 0
    || analysis.actionCounts.HUMAN_DECISION !== expected.protectedHumanSegments
    || analysis.clusters.some((cluster) => [CLUSTER.ENVIRONMENTAL_HEADLINE, CLUSTER.QNG, CLUSTER.ENERGY].includes(cluster.cluster))) {
    throw new Error("PHASE2B_DESCRIPTION_POSTCHECK_FAILED: Freigegebene Segmente sind nach der Migration noch vorhanden oder der geschützte Rest-Scope ist abgewichen.");
  }
}

function idempotentPlan(state, report, options) {
  const finalScope = expectedOptions(options, "expectedFinalScope", PHASE2B_DESCRIPTION_SAFE_CLEANUP_FINAL_SCOPE);
  const analysis = analysisForScope(state, report, finalScope, options);
  assertFinalAnalysis(analysis, options);
  return {
    idempotent: true,
    changed: false,
    report,
    analysis,
    scope: analysis.scope,
    changes: [],
    protectedSnapshots: protectedSnapshots(state, analysis.entries),
  };
}

/** Plans only the 85 explicitly released description segments, without mutation. */
export function planPhase2BDescriptionSafeCleanup(state, options = {}) {
  const report = scan(state, options);
  const currentScope = analysisScope(report);
  const finalScope = expectedOptions(options, "expectedFinalScope", PHASE2B_DESCRIPTION_SAFE_CLEANUP_FINAL_SCOPE);
  if (sameScope(currentScope, finalScope)) return idempotentPlan(state, report, options);

  const initialScope = expectedOptions(options, "expectedInitialScope", PHASE2B_DESCRIPTION_SAFE_CLEANUP_INITIAL_SCOPE);
  const analysis = analysisForScope(state, report, initialScope, options);
  const targets = assertExecutableAnalysis(analysis, options);
  const changes = buildFieldChanges(state, targets);
  const expected = expectedOptions(options, "expectedCounts", PHASE2B_DESCRIPTION_SAFE_CLEANUP_EXPECTED);
  if (changes.length !== expected.changedFields
    || changes.flatMap((change) => change.segments).length !== (
      expected.environmentalHeadlines + expected.qngReplacements + expected.energyClassRemovals
    )) {
    throw new Error("PHASE2B_DESCRIPTION_CHANGESET_MISMATCH: Die Feld- oder Segmentanzahl der geplanten Migration stimmt nicht exakt überein.");
  }
  return {
    idempotent: false,
    changed: true,
    report,
    analysis,
    scope: analysis.scope,
    targets,
    changes,
    protectedSnapshots: protectedSnapshots(state, targets.human),
  };
}

function setPlannedDescription(state, change) {
  const project = state.projects.find((candidate) => candidate?.id === change.projectId);
  const listing = project?.listings?.find((candidate) => candidate?.id === change.listingId);
  if (!listing || String(listing.texts?.description ?? "") !== change.previousText) {
    throw new Error(`PHASE2B_DESCRIPTION_SCOPE_CHANGED: Die Objektbeschreibung von ${change.listingId} wurde seit der Planung verändert.`);
  }
  listing.texts = { ...listing.texts, description: change.replacementText };
}

export function assertPhase2BDescriptionSafeCleanupIntegrity(before, after, plan) {
  for (const snapshot of plan.protectedSnapshots) {
    const afterContext = listingContext(after, snapshot.projectId, snapshot.listingId);
    const description = String(afterContext.listing.texts?.description ?? "");
    if (sha256(snapshot.sentence) !== snapshot.hash
      || literalOccurrences(description, snapshot.sentence) !== snapshot.occurrences) {
      throw new Error(`PHASE2B_DESCRIPTION_HUMAN_CHANGED: Die geschützte ${snapshot.cluster}-Passage in ${snapshot.listingId} wurde verändert.`);
    }
  }
  const comparable = structuredClone(after);
  for (const change of plan.changes) {
    const context = listingContext(comparable, change.projectId, change.listingId);
    context.listing.texts = { ...context.listing.texts, description: change.previousText };
  }
  if (!isDeepStrictEqual(before, comparable)) {
    throw new Error("PHASE2B_DESCRIPTION_INTEGRITY_FAILED: Außerhalb der exakt freigegebenen 85 Segmente wurden Daten verändert.");
  }
  return true;
}

/** Pure deterministic migration. It never calls AI, uploads or portal services. */
export function applyPhase2BDescriptionSafeCleanup(state, options = {}) {
  const plan = planPhase2BDescriptionSafeCleanup(state, options);
  if (plan.idempotent) return { state, plan, changed: false, idempotent: true, afterReport: plan.report };

  const nextState = structuredClone(state);
  for (const change of plan.changes) setPlannedDescription(nextState, change);
  assertPhase2BDescriptionSafeCleanupIntegrity(state, nextState, plan);
  const afterReport = scan(nextState, options);
  const finalPlan = idempotentPlan(nextState, afterReport, options);
  return {
    state: nextState,
    plan,
    afterReport,
    finalPlan,
    changed: true,
    idempotent: false,
  };
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

export async function createPhase2BDescriptionSafeCleanupCatalogBackup(options = {}) {
  const catalogDirectory = options.catalogDirectory || CATALOG_V2_DIRECTORY;
  const backupDirectory = options.backupDirectory || PHASE2B_DESCRIPTION_SAFE_CLEANUP_BACKUP_DIRECTORY;
  const now = options.now || new Date().toISOString();
  const manifestPath = join(catalogDirectory, "manifest.json");
  const source = await readFile(manifestPath);
  const manifest = JSON.parse(source.toString("utf8"));
  if (!validManifest(manifest)) throw new Error("Der aktive Katalog kann nicht als gültiger Phase-2B.5-Backup bestätigt werden.");
  const createdAt = new Date(now).toISOString();
  const backupPath = join(backupDirectory, `manifest.pre-phase2b-description-safe-cleanup-${safeTimestamp(createdAt)}.json`);
  await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
  await copyFile(manifestPath, backupPath, fileSystemConstants.COPYFILE_EXCL);
  const backup = await readFile(backupPath);
  const manifestHash = sha256(source);
  const backupHash = sha256(backup);
  if (manifestHash !== backupHash) throw new Error("Der Phase-2B.5-Backup stimmt nicht bytegenau mit dem aktiven Manifest überein.");
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

export async function verifyPhase2BDescriptionSafeCleanupCatalogBackup(backupPath, expectedHash = "") {
  const data = await readFile(backupPath);
  const manifest = JSON.parse(data.toString("utf8"));
  const backupHash = sha256(data);
  if (!validManifest(manifest)) throw new Error("Der Phase-2B.5-Backup ist nicht wiederherstellbar.");
  if (expectedHash && backupHash !== expectedHash) throw new Error("Der Phase-2B.5-Backup-Hash stimmt nicht mit dem erwarteten Stand überein.");
  return { backupHash, savedAt: clean(manifest.savedAt), bytes: data.length, restorable: true };
}

function assertNoImplicitNormalization(state, now) {
  if (cleanupStudioState(state, { apply: true, now }).changed) {
    throw new Error("PHASE2B_DESCRIPTION_NORMALIZATION_REQUIRED: Der kanonische Speicherweg würde weitere Katalogdaten normalisieren.");
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

/** Runs one backup-protected, CAS-protected local catalog migration. */
export async function runPhase2BDescriptionSafeCleanup(options = {}) {
  const catalogDirectory = options.catalogDirectory || CATALOG_V2_DIRECTORY;
  const load = options.loadCatalogManifest || loadCatalogManifest;
  const start = options.startCatalogSnapshot || startCatalogSnapshot;
  const commit = options.commitCatalogSnapshot || commitCatalogSnapshot;
  const discard = options.discardCatalogSnapshot || discardCatalogSnapshot;
  const now = options.now || new Date().toISOString();
  const current = await load(catalogDirectory);
  if (!current?.stored || !current.state) throw new Error("Der aktive Inseratkatalog ist nicht verfügbar.");
  assertNoImplicitNormalization(current.state, now);

  const preview = applyPhase2BDescriptionSafeCleanup(current.state, options);
  if (!preview.changed) {
    return { changed: false, idempotent: true, plan: preview.plan, beforeReport: preview.plan.report, afterReport: preview.afterReport };
  }
  assertNoImplicitNormalization(preview.state, now);
  const backup = await createPhase2BDescriptionSafeCleanupCatalogBackup({
    catalogDirectory,
    backupDirectory: options.backupDirectory,
    now,
  });
  const sessionId = `phase2b-description-safe-cleanup-${randomUUID()}`;
  try {
    const snapshot = await start({
      state: preview.state,
      sessionId,
      savedAt: nextSavedAt(current.savedAt, now),
      expectedSavedAt: current.savedAt,
    }, catalogDirectory);
    if (snapshot.missingImageIds.length) {
      throw new Error("PHASE2B_DESCRIPTION_IMAGE_INTEGRITY_FAILED: Der Speicherweg meldet fehlende Bilddateien.");
    }
    await commit(sessionId, catalogDirectory);
  } catch (error) {
    await discard(sessionId, catalogDirectory).catch(() => undefined);
    throw error;
  }
  const persisted = await load(catalogDirectory);
  if (!persisted?.stored || !persisted.state) throw new Error("Der Katalog konnte nach Phase-2B.5 nicht erneut geladen werden.");
  assertPhase2BDescriptionSafeCleanupIntegrity(current.state, persisted.state, preview.plan);
  const persistedCheck = applyPhase2BDescriptionSafeCleanup(persisted.state, options);
  if (persistedCheck.changed || !persistedCheck.idempotent) {
    throw new Error("PHASE2B_DESCRIPTION_IDEMPOTENCE_FAILED: Der zweite Migrationslauf würde weitere Änderungen vornehmen.");
  }
  return {
    changed: true,
    idempotent: false,
    backup,
    plan: preview.plan,
    beforeReport: preview.plan.report,
    afterReport: persistedCheck.afterReport,
    finalPlan: persistedCheck.plan,
    persistedSavedAt: persisted.savedAt,
  };
}

export const PHASE2B_DESCRIPTION_SAFE_CLEANUP_GUARANTEE = Object.freeze({
  usesAi: false,
  triggersUploads: false,
  changesOnlyDescriptions: true,
  migrationSegmentCount: 85,
  protectedHumanSegmentCount: 51,
});
