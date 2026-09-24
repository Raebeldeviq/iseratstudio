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
  isLivingHausIKonTechnicalPackage,
  LIVING_HAUS_IKON_TECHNICAL_PACKAGE_ID,
  LIVING_HAUS_SERIES_ID,
  technicalPackageFactSentence,
  validateListingClaims,
} from "./listing-claim-policy.mjs";
import { APPLICATION_DATA_DIRECTORY } from "./platform-paths.mjs";
import {
  analyzePhase2BDescriptions,
  DESCRIPTION_ACTION,
} from "./phase2b-description-analysis.mjs";
import { PHASE2B_TREATMENT, scanPhase2BClaims } from "./phase2b-claim-scan.mjs";

export const PHASE2B_IKON_TECHNICAL_FACTS_BACKUP_DIRECTORY = join(
  APPLICATION_DATA_DIRECTORY,
  "phase2b-ikon-technical-facts-backups",
);

export const PHASE2B_IKON_TECHNICAL_FACTS_INITIAL_SCOPE = Object.freeze({
  activeListings: 44,
  affectedFields: 51,
  blockClaims: 119,
  descriptionFields: 44,
  descriptionClaims: 105,
  technicalHeadlineFields: 7,
  technicalClaims: 14,
});

export const PHASE2B_IKON_TECHNICAL_FACTS_FINAL_SCOPE = Object.freeze({
  activeListings: 44,
  affectedFields: 1,
  blockClaims: 1,
  descriptionFields: 1,
  descriptionClaims: 1,
  technicalHeadlineFields: 0,
  technicalClaims: 0,
});

export const PHASE2B_IKON_TECHNICAL_FACTS_EXPECTED = Object.freeze({
  ikonSegments: 44,
  heatingVentilationSegments: 6,
  technicalTitles: 7,
  certificationSegments: 1,
  houseTemplates: 18,
});

const CLUSTER = Object.freeze({
  IKON: "I_KON_TECHNIK_BAUSTEIN",
  HEATING_VENTILATION: "HEIZUNG_LUEFTUNG_BAUSTEIN",
  CERTIFICATION: "ZERTIFIZIERUNG_BAUSTEIN",
});

const TITLE_PREVIOUS = "Wärmepumpe und Komfortlüftung";
const TITLE_REPLACEMENT = "Wärmepumpe und Lüftungsanlage";

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

function claimResult(context, texts) {
  return validateListingClaims({
    texts,
    images: context.house.images,
    house: context.house,
    project: context.project,
    listingFacts: context.listing.listingFacts,
    houseSeries: LIVING_HAUS_SERIES_ID,
  });
}

function descriptionBlocks(context, description) {
  return claimResult(context, { ...context.listing.texts, description }).blockingIssues
    .filter((issue) => issue.field === "Objektbeschreibung");
}

function titleBlocks(context, title) {
  return claimResult(context, { ...context.listing.texts, title }).blockingIssues
    .filter((issue) => issue.field === "Überschrift");
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

function option(options, key, fallback) {
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

function requiredPackageFacts(context) {
  const facts = collectListingFacts({
    listingFacts: context.listing.listingFacts,
    house: context.house,
    project: context.project,
  }).filter((fact) => (
    fact.sourceKind === FACT_SOURCE.OPTIONAL_PACKAGE
    && fact.scope === FACT_SCOPE.TECHNICAL_PACKAGE
    && fact.status === FACT_STATUS.VERIFIED
    && fact.verified === true
    && isLivingHausIKonTechnicalPackage(fact.packageId)
    && clean(fact.evidenceReference)
  ));
  const expectedKeys = ["photovoltaic", "battery_storage", "heat_pump", "ventilation"];
  if (expectedKeys.some((key) => !facts.some((fact) => fact.key === key))) {
    throw new Error(`PHASE2B_IKON_FACT_EVIDENCE_MISSING: ${context.listing.id} verfügt nicht über alle vier verifizierten I-KON-Paketfakten.`);
  }
  return facts;
}

function packageSentence(context, keys) {
  requiredPackageFacts(context);
  const sentence = technicalPackageFactSentence({
    listingFacts: context.listing.listingFacts,
    house: context.house,
    project: context.project,
  }, keys);
  if (!sentence) throw new Error(`PHASE2B_IKON_SENTENCE_MISSING: ${context.listing.id} liefert keine vollständige Paket-Sachinformation.`);
  if (descriptionBlocks(context, sentence).length) {
    throw new Error(`PHASE2B_IKON_POLICY_FAILED: Die I-KON-Paketsachinformation ist nicht policy-konform.`);
  }
  return sentence;
}

function applyExactReplacement(text, previous, replacement, code) {
  if (literalOccurrences(text, previous) !== 1) {
    throw new Error(`${code}: Die freigegebene Passage ist nicht exakt einmal vorhanden.`);
  }
  return text.replace(previous, replacement);
}

function activeContexts(state) {
  const contexts = [];
  for (const project of state?.projects || []) {
    for (const listing of project?.listings || []) {
      if (!activeListing(project, listing)) continue;
      contexts.push(listingContext(state, project.id, listing.id));
    }
  }
  return contexts;
}

function modelTechnicalPackage(state, contexts, expectedHouseTemplates) {
  const houseIds = [...new Set(contexts.map((context) => context.house.id))];
  if (houseIds.length !== expectedHouseTemplates) {
    throw new Error(`PHASE2B_IKON_HOUSE_SCOPE_MISMATCH: Erwartet ${expectedHouseTemplates} verwendete Hausvorlagen, gefunden ${houseIds.length}.`);
  }
  const nextState = structuredClone(state);
  const markers = [];
  for (const houseId of houseIds) {
    const sourceHouse = (state.houses || []).find((house) => house.id === houseId);
    const house = (nextState.houses || []).find((candidate) => candidate.id === houseId);
    if (!sourceHouse || !house || sourceHouse.useStandardPackage !== true) {
      throw new Error(`PHASE2B_IKON_PACKAGE_CONTEXT_MISSING: Die Hausvorlage ${houseId} ist nicht als verwendetes I-KON-Standardpaket markiert.`);
    }
    if (clean(sourceHouse.technicalPackage)) {
      throw new Error(`PHASE2B_IKON_PACKAGE_ALREADY_SET: Die Hausvorlage ${houseId} hat bereits einen technischen Paketmarker.`);
    }
    house.technicalPackage = LIVING_HAUS_IKON_TECHNICAL_PACKAGE_ID;
    markers.push({ houseId, previousValue: clean(sourceHouse.technicalPackage), value: house.technicalPackage });
  }
  return { state: nextState, markers };
}

function assertTechnicalPackageMarkers(state, expectedHouseTemplates, expectedActiveListings) {
  const contexts = activeContexts(state);
  const houseIds = [...new Set(contexts.map((context) => context.house.id))];
  if (contexts.length !== expectedActiveListings || houseIds.length !== expectedHouseTemplates) {
    throw new Error("PHASE2B_IKON_FINAL_PACKAGE_SCOPE_MISMATCH: Der aktive I-KON-Hauskontext ist nicht vollständig vorhanden.");
  }
  for (const houseId of houseIds) {
    const house = (state.houses || []).find((candidate) => candidate.id === houseId);
    if (house?.technicalPackage !== LIVING_HAUS_IKON_TECHNICAL_PACKAGE_ID) {
      throw new Error(`PHASE2B_IKON_FINAL_PACKAGE_MARKER_MISSING: ${houseId} ist nicht mit dem verifizierten I-KON-Paket verknüpft.`);
    }
  }
  const unexpected = (state.houses || []).filter((house) => (
    clean(house.technicalPackage) && !houseIds.includes(house.id)
  ));
  if (unexpected.length) throw new Error("PHASE2B_IKON_FINAL_PACKAGE_SCOPE_MISMATCH: Ein nicht aktiver Hauskontext trägt unzulässig einen I-KON-Paketmarker.");
  return contexts;
}

function exactTargets(analysis, report) {
  const ikon = analysis.entries.filter((entry) => entry.cluster === CLUSTER.IKON && entry.action === DESCRIPTION_ACTION.HUMAN_DECISION);
  const heatingVentilation = analysis.entries.filter((entry) => (
    entry.cluster === CLUSTER.HEATING_VENTILATION && entry.action === DESCRIPTION_ACTION.HUMAN_DECISION
  ));
  const certification = analysis.entries.filter((entry) => (
    entry.cluster === CLUSTER.CERTIFICATION && entry.action === DESCRIPTION_ACTION.HUMAN_DECISION
  ));
  const technicalTitles = report.fieldPlans.filter((plan) => (
    plan.field === "Überschrift"
    && plan.proposedTreatment === PHASE2B_TREATMENT.MANUAL_REVIEW
    && plan.categories.includes(CLAIM_CATEGORY.UNVERIFIED_TECHNICAL_CLAIM)
  ));
  return { ikon, heatingVentilation, certification, technicalTitles };
}

function assertExecutableTargets(analysis, report, options) {
  const expected = option(options, "expectedCounts", PHASE2B_IKON_TECHNICAL_FACTS_EXPECTED);
  const targets = exactTargets(analysis, report);
  if (targets.ikon.length !== expected.ikonSegments
    || targets.heatingVentilation.length !== expected.heatingVentilationSegments
    || targets.certification.length !== expected.certificationSegments
    || targets.technicalTitles.length !== expected.technicalTitles
    || analysis.entries.length !== (
      expected.ikonSegments + expected.heatingVentilationSegments + expected.certificationSegments
    )
    || analysis.actionCounts.HUMAN_DECISION !== analysis.entries.length
    || analysis.actionCounts.SAFE_REMOVE !== 0
    || analysis.actionCounts.SAFE_FACT_REPLACEMENT !== 0
    || analysis.actionCounts.SAFE_PARTIAL_REMOVE !== 0
    || analysis.actionCounts.REWRITE_SENTENCE !== 0
    || analysis.actionCounts.REWRITE_PARAGRAPH !== 0) {
    throw new Error("PHASE2B_IKON_SCOPE_MISMATCH: Der technische Restbestand entspricht nicht exakt den 44/6/1/7-Freigaben.");
  }
  return targets;
}

function certificationSnapshots(state, entries) {
  return entries.map((entry) => {
    const context = listingContext(state, entry.projectId, entry.listingId);
    const description = String(context.listing.texts?.description ?? "");
    const occurrences = literalOccurrences(description, entry.sentence);
    if (occurrences !== 1) throw new Error(`PHASE2B_IKON_CERTIFICATION_SCOPE_CHANGED: ${entry.listingId} enthält den Zertifizierungssatz nicht exakt einmal.`);
    return {
      listingId: entry.listingId,
      externalId: entry.externalId,
      projectId: entry.projectId,
      sentence: entry.sentence,
      hash: sha256(entry.sentence),
      occurrences,
    };
  });
}

function onlyCertificationBlocks(context, description, snapshots) {
  for (const issue of descriptionBlocks(context, description)) {
    const protectedMatch = snapshots.some((snapshot) => {
      const start = description.indexOf(snapshot.sentence);
      return start >= 0 && issue.position >= start && issue.position < start + snapshot.sentence.length;
    });
    if (!protectedMatch) {
      throw new Error(`PHASE2B_IKON_NEW_CLAIM: ${context.listing.id} enthält nach der technischen Bereinigung einen neuen BLOCK-Treffer.`);
    }
  }
}

function buildDescriptionChanges(state, modelledState, targets, snapshots) {
  const entries = [...targets.ikon, ...targets.heatingVentilation];
  const grouped = entries.reduce((groups, entry) => {
    const key = `${entry.projectId}:${entry.listingId}`;
    const group = groups.get(key) || [];
    group.push(entry);
    groups.set(key, group);
    return groups;
  }, new Map());
  const snapshotsByListing = snapshots.reduce((groups, snapshot) => {
    const key = `${snapshot.projectId}:${snapshot.listingId}`;
    const group = groups.get(key) || [];
    group.push(snapshot);
    groups.set(key, group);
    return groups;
  }, new Map());
  return [...grouped.values()].map((group) => {
    const first = group[0];
    const beforeContext = listingContext(state, first.projectId, first.listingId);
    const context = listingContext(modelledState, first.projectId, first.listingId);
    const previousText = String(beforeContext.listing.texts?.description ?? "");
    let replacementText = previousText;
    const segments = [];
    for (const entry of [...group].sort((left, right) => left.paragraph - right.paragraph)) {
      const componentKeys = entry.cluster === CLUSTER.IKON
        ? ["photovoltaic", "battery_storage", "heat_pump", "ventilation"]
        : ["heat_pump", "ventilation"];
      const replacement = packageSentence(context, componentKeys);
      replacementText = applyExactReplacement(replacementText, entry.sentence, replacement, "PHASE2B_IKON_DESCRIPTION_SCOPE_CHANGED");
      segments.push({
        listingId: entry.listingId,
        externalId: entry.externalId,
        projectId: entry.projectId,
        paragraph: entry.paragraph,
        cluster: entry.cluster,
        previousText: entry.sentence,
        previousHash: sha256(entry.sentence),
        replacementText: replacement,
        replacementHash: sha256(replacement),
        componentKeys,
      });
    }
    if (!replacementText || /\n{3,}/u.test(replacementText)) {
      throw new Error(`PHASE2B_IKON_DESCRIPTION_FORMAT_FAILED: ${first.listingId} hätte eine unzulässige Absatzstruktur.`);
    }
    onlyCertificationBlocks(context, replacementText, snapshotsByListing.get(`${first.projectId}:${first.listingId}`) || []);
    return {
      kind: "description",
      listingId: first.listingId,
      externalId: first.externalId,
      projectId: first.projectId,
      previousText,
      replacementText,
      previousHash: sha256(previousText),
      replacementHash: sha256(replacementText),
      segments,
    };
  });
}

function buildTitleChanges(state, modelledState, plans) {
  return plans.map((plan) => {
    const beforeContext = listingContext(state, plan.projectId, plan.listingId);
    const context = listingContext(modelledState, plan.projectId, plan.listingId);
    requiredPackageFacts(context);
    const previousText = String(beforeContext.listing.texts?.title ?? "");
    const replacementText = applyExactReplacement(previousText, TITLE_PREVIOUS, TITLE_REPLACEMENT, "PHASE2B_IKON_TITLE_SCOPE_CHANGED");
    if (titleBlocks(context, replacementText).length) {
      throw new Error(`PHASE2B_IKON_TITLE_POLICY_FAILED: ${plan.listingId} bleibt nach der minimalen Technikbezeichnungs-Ersetzung blockiert.`);
    }
    return {
      kind: "title",
      listingId: plan.listingId,
      externalId: plan.externalId,
      projectId: plan.projectId,
      previousText,
      replacementText,
      previousHash: sha256(previousText),
      replacementHash: sha256(replacementText),
      previousTechnicalPhraseHash: sha256(TITLE_PREVIOUS),
      replacementTechnicalPhraseHash: sha256(TITLE_REPLACEMENT),
    };
  });
}

function setDescription(state, change) {
  const context = listingContext(state, change.projectId, change.listingId);
  if (String(context.listing.texts?.description ?? "") !== change.previousText) {
    throw new Error(`PHASE2B_IKON_DESCRIPTION_SCOPE_CHANGED: ${change.listingId} wurde seit der Planung verändert.`);
  }
  context.listing.texts = { ...context.listing.texts, description: change.replacementText };
}

function setTitle(state, change) {
  const context = listingContext(state, change.projectId, change.listingId);
  if (String(context.listing.texts?.title ?? "") !== change.previousText) {
    throw new Error(`PHASE2B_IKON_TITLE_SCOPE_CHANGED: ${change.listingId} wurde seit der Planung verändert.`);
  }
  context.listing.texts = { ...context.listing.texts, title: change.replacementText };
}

function assertFinalAnalysis(state, report, options) {
  const finalScope = option(options, "expectedFinalScope", PHASE2B_IKON_TECHNICAL_FACTS_FINAL_SCOPE);
  const analysis = analysisForScope(state, report, finalScope, options);
  const expected = option(options, "expectedCounts", PHASE2B_IKON_TECHNICAL_FACTS_EXPECTED);
  if (analysis.entries.length !== expected.certificationSegments
    || analysis.entries[0]?.cluster !== CLUSTER.CERTIFICATION
    || analysis.entries[0]?.action !== DESCRIPTION_ACTION.HUMAN_DECISION
    || analysis.actionCounts.HUMAN_DECISION !== expected.certificationSegments
    || analysis.clusters.some((cluster) => [CLUSTER.IKON, CLUSTER.HEATING_VENTILATION].includes(cluster.cluster))) {
    throw new Error("PHASE2B_IKON_POSTCHECK_FAILED: Technische Resttexte oder ein unerwarteter Rest-Scope sind verblieben.");
  }
  return analysis;
}

function idempotentPlan(state, report, options) {
  const expected = option(options, "expectedCounts", PHASE2B_IKON_TECHNICAL_FACTS_EXPECTED);
  const finalScope = option(options, "expectedFinalScope", PHASE2B_IKON_TECHNICAL_FACTS_FINAL_SCOPE);
  assertTechnicalPackageMarkers(state, expected.houseTemplates, finalScope.activeListings);
  const analysis = assertFinalAnalysis(state, report, options);
  return {
    changed: false,
    idempotent: true,
    report,
    analysis,
    scope: analysis.scope,
    descriptionChanges: [],
    titleChanges: [],
    packageMarkers: [],
    certificationSnapshots: certificationSnapshots(state, analysis.entries),
  };
}

/** Plans only the released I-KON technical package facts and exact residual text replacements. */
export function planPhase2BIKonTechnicalFactsCleanup(state, options = {}) {
  const report = scan(state, options);
  const currentScope = analysisScope(report);
  const finalScope = option(options, "expectedFinalScope", PHASE2B_IKON_TECHNICAL_FACTS_FINAL_SCOPE);
  if (sameScope(currentScope, finalScope)) return idempotentPlan(state, report, options);

  const initialScope = option(options, "expectedInitialScope", PHASE2B_IKON_TECHNICAL_FACTS_INITIAL_SCOPE);
  const analysis = analysisForScope(state, report, initialScope, options);
  const targets = assertExecutableTargets(analysis, report, options);
  const expected = option(options, "expectedCounts", PHASE2B_IKON_TECHNICAL_FACTS_EXPECTED);
  const contexts = activeContexts(state);
  if (contexts.length !== initialScope.activeListings) {
    throw new Error("PHASE2B_IKON_ACTIVE_SCOPE_MISMATCH: Die Anzahl aktiver Inserate hat sich zwischen Scan und Faktenmodell geändert.");
  }
  const targetListingIds = new Set(targets.ikon.map((entry) => entry.listingId));
  if (targetListingIds.size !== contexts.length || contexts.some((context) => !targetListingIds.has(context.listing.id))) {
    throw new Error("PHASE2B_IKON_CONTEXT_SCOPE_MISMATCH: Nicht jeder aktive Kontext ist exakt durch einen I-KON-Technikbaustein belegt.");
  }
  const modelled = modelTechnicalPackage(state, contexts, expected.houseTemplates);
  for (const context of activeContexts(modelled.state)) requiredPackageFacts(context);
  const certification = certificationSnapshots(state, targets.certification);
  const descriptionChanges = buildDescriptionChanges(state, modelled.state, targets, certification);
  const titleChanges = buildTitleChanges(state, modelled.state, targets.technicalTitles);
  if (descriptionChanges.flatMap((change) => change.segments).length !== (
    expected.ikonSegments + expected.heatingVentilationSegments
  ) || titleChanges.length !== expected.technicalTitles) {
    throw new Error("PHASE2B_IKON_CHANGESET_MISMATCH: Die Anzahl freigegebener Techniksegmente oder Titel stimmt nicht exakt überein.");
  }
  return {
    changed: true,
    idempotent: false,
    report,
    analysis,
    scope: analysis.scope,
    targets,
    packageMarkers: modelled.markers,
    descriptionChanges,
    titleChanges,
    certificationSnapshots: certification,
  };
}

export function assertPhase2BIKonTechnicalFactsCleanupIntegrity(before, after, plan) {
  for (const snapshot of plan.certificationSnapshots) {
    const context = listingContext(after, snapshot.projectId, snapshot.listingId);
    const description = String(context.listing.texts?.description ?? "");
    if (sha256(snapshot.sentence) !== snapshot.hash
      || literalOccurrences(description, snapshot.sentence) !== snapshot.occurrences) {
      throw new Error(`PHASE2B_IKON_CERTIFICATION_CHANGED: Der geschützte Zertifizierungssatz in ${snapshot.listingId} wurde verändert.`);
    }
  }
  const comparable = structuredClone(after);
  for (const change of plan.descriptionChanges) {
    const context = listingContext(comparable, change.projectId, change.listingId);
    context.listing.texts = { ...context.listing.texts, description: change.previousText };
  }
  for (const change of plan.titleChanges) {
    const context = listingContext(comparable, change.projectId, change.listingId);
    context.listing.texts = { ...context.listing.texts, title: change.previousText };
  }
  for (const marker of plan.packageMarkers) {
    const house = (comparable.houses || []).find((candidate) => candidate.id === marker.houseId);
    if (!house) throw new Error(`PHASE2B_IKON_HOUSE_SCOPE_CHANGED: ${marker.houseId} fehlt nach der Migration.`);
    if (marker.previousValue) house.technicalPackage = marker.previousValue;
    else delete house.technicalPackage;
  }
  if (!isDeepStrictEqual(before, comparable)) {
    throw new Error("PHASE2B_IKON_INTEGRITY_FAILED: Außerhalb der freigegebenen Paketmarker, Beschreibungen und Titel wurden Daten verändert.");
  }
  return true;
}

/** Pure deterministic migration with no generator, upload or portal dependency. */
export function applyPhase2BIKonTechnicalFactsCleanup(state, options = {}) {
  const plan = planPhase2BIKonTechnicalFactsCleanup(state, options);
  if (plan.idempotent) return { state, plan, changed: false, idempotent: true, afterReport: plan.report };

  const nextState = structuredClone(state);
  for (const marker of plan.packageMarkers) {
    const house = (nextState.houses || []).find((candidate) => candidate.id === marker.houseId);
    if (!house || clean(house.technicalPackage)) {
      throw new Error(`PHASE2B_IKON_PACKAGE_SCOPE_CHANGED: ${marker.houseId} wurde seit der Planung verändert.`);
    }
    house.technicalPackage = marker.value;
  }
  for (const change of plan.descriptionChanges) setDescription(nextState, change);
  for (const change of plan.titleChanges) setTitle(nextState, change);
  assertPhase2BIKonTechnicalFactsCleanupIntegrity(state, nextState, plan);
  const afterReport = scan(nextState, options);
  const finalPlan = idempotentPlan(nextState, afterReport, options);
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

export async function createPhase2BIKonTechnicalFactsCatalogBackup(options = {}) {
  const catalogDirectory = options.catalogDirectory || CATALOG_V2_DIRECTORY;
  const backupDirectory = options.backupDirectory || PHASE2B_IKON_TECHNICAL_FACTS_BACKUP_DIRECTORY;
  const now = options.now || new Date().toISOString();
  const manifestPath = join(catalogDirectory, "manifest.json");
  const source = await readFile(manifestPath);
  const manifest = JSON.parse(source.toString("utf8"));
  if (!validManifest(manifest)) throw new Error("Der aktive Katalog kann nicht als gültiger Phase-2B.6-Backup bestätigt werden.");
  const createdAt = new Date(now).toISOString();
  const backupPath = join(backupDirectory, `manifest.pre-phase2b-ikon-technical-facts-${safeTimestamp(createdAt)}.json`);
  await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
  await copyFile(manifestPath, backupPath, fileSystemConstants.COPYFILE_EXCL);
  const backup = await readFile(backupPath);
  const manifestHash = sha256(source);
  const backupHash = sha256(backup);
  if (manifestHash !== backupHash) throw new Error("Der Phase-2B.6-Backup stimmt nicht bytegenau mit dem aktiven Manifest überein.");
  return { catalogDirectory, manifestPath, backupPath, createdAt, savedAt: clean(manifest.savedAt), manifestHash, backupHash, bytes: source.length };
}

export async function verifyPhase2BIKonTechnicalFactsCatalogBackup(backupPath, expectedHash = "") {
  const data = await readFile(backupPath);
  const manifest = JSON.parse(data.toString("utf8"));
  const backupHash = sha256(data);
  if (!validManifest(manifest)) throw new Error("Der Phase-2B.6-Backup ist nicht wiederherstellbar.");
  if (expectedHash && backupHash !== expectedHash) throw new Error("Der Phase-2B.6-Backup-Hash stimmt nicht mit dem erwarteten Stand überein.");
  return { backupHash, savedAt: clean(manifest.savedAt), bytes: data.length, restorable: true };
}

function assertNoImplicitNormalization(state, now) {
  if (cleanupStudioState(state, { apply: true, now }).changed) {
    throw new Error("PHASE2B_IKON_NORMALIZATION_REQUIRED: Der kanonische Speicherweg würde weitere Katalogdaten normalisieren.");
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

/** Executes one backup-protected, CAS-protected local Phase-2B.6 migration. */
export async function runPhase2BIKonTechnicalFactsCleanup(options = {}) {
  const catalogDirectory = options.catalogDirectory || CATALOG_V2_DIRECTORY;
  const load = options.loadCatalogManifest || loadCatalogManifest;
  const start = options.startCatalogSnapshot || startCatalogSnapshot;
  const commit = options.commitCatalogSnapshot || commitCatalogSnapshot;
  const discard = options.discardCatalogSnapshot || discardCatalogSnapshot;
  const now = options.now || new Date().toISOString();
  const current = await load(catalogDirectory);
  if (!current?.stored || !current.state) throw new Error("Der aktive Inseratkatalog ist nicht verfügbar.");
  assertNoImplicitNormalization(current.state, now);

  const preview = applyPhase2BIKonTechnicalFactsCleanup(current.state, options);
  if (!preview.changed) return { changed: false, idempotent: true, plan: preview.plan, beforeReport: preview.plan.report, afterReport: preview.afterReport };
  assertNoImplicitNormalization(preview.state, now);
  const backup = await createPhase2BIKonTechnicalFactsCatalogBackup({ catalogDirectory, backupDirectory: options.backupDirectory, now });
  const sessionId = `phase2b-ikon-technical-facts-${randomUUID()}`;
  try {
    const snapshot = await start({
      state: preview.state,
      sessionId,
      savedAt: nextSavedAt(current.savedAt, now),
      expectedSavedAt: current.savedAt,
    }, catalogDirectory);
    if (snapshot.missingImageIds.length) throw new Error("PHASE2B_IKON_IMAGE_INTEGRITY_FAILED: Der Speicherweg meldet fehlende Bilddateien.");
    await commit(sessionId, catalogDirectory);
  } catch (error) {
    await discard(sessionId, catalogDirectory).catch(() => undefined);
    throw error;
  }
  const persisted = await load(catalogDirectory);
  if (!persisted?.stored || !persisted.state) throw new Error("Der Katalog konnte nach Phase-2B.6 nicht erneut geladen werden.");
  assertPhase2BIKonTechnicalFactsCleanupIntegrity(current.state, persisted.state, preview.plan);
  const persistedCheck = applyPhase2BIKonTechnicalFactsCleanup(persisted.state, options);
  if (persistedCheck.changed || !persistedCheck.idempotent) {
    throw new Error("PHASE2B_IKON_IDEMPOTENCE_FAILED: Der zweite Migrationslauf würde weitere Änderungen vornehmen.");
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

export const PHASE2B_IKON_TECHNICAL_FACTS_GUARANTEE = Object.freeze({
  usesAi: false,
  triggersUploads: false,
  technicalPackageId: LIVING_HAUS_IKON_TECHNICAL_PACKAGE_ID,
  modeledFactKeys: ["photovoltaic", "battery_storage", "heat_pump", "ventilation"],
});
