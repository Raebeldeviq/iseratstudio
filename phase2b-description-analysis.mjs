import {
  CLAIM_CATEGORY,
  collectListingFacts,
  FACT_SCOPE,
  FACT_STATUS,
  LIVING_HAUS_SERIES_ID,
} from "./listing-claim-policy.mjs";
import { PHASE2B_TREATMENT, scanPhase2BClaims } from "./phase2b-claim-scan.mjs";

export const DESCRIPTION_ACTION = Object.freeze({
  SAFE_REMOVE: "SAFE_REMOVE",
  SAFE_FACT_REPLACEMENT: "SAFE_FACT_REPLACEMENT",
  SAFE_PARTIAL_REMOVE: "SAFE_PARTIAL_REMOVE",
  REWRITE_SENTENCE: "REWRITE_SENTENCE",
  REWRITE_PARAGRAPH: "REWRITE_PARAGRAPH",
  HUMAN_DECISION: "HUMAN_DECISION",
});

export const DESCRIPTION_OUTCOME = Object.freeze({
  DETERMINISTICALLY_FIXABLE: "DETERMINISTICALLY_FIXABLE",
  PARTIAL_REWRITE_REQUIRED: "PARTIAL_REWRITE_REQUIRED",
  HUMAN_DECISION_REQUIRED: "HUMAN_DECISION_REQUIRED",
});

const DEFAULT_SCOPE = Object.freeze({
  activeListings: 44,
  affectedFields: 51,
  blockClaims: 288,
  descriptionFields: 44,
  descriptionClaims: 274,
  technicalHeadlineFields: 7,
  technicalClaims: 14,
});

function clean(value) {
  return String(value ?? "").trim();
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
    throw new Error(`Das Analyse-Inserat ${listingId} ist nicht mehr aktiv oder seine Hausvorlage fehlt.`);
  }
  return { project, listing, house };
}

function paragraphSpans(text) {
  const result = [];
  const separator = /\n\s*\n/gu;
  let start = 0;
  let match;
  while ((match = separator.exec(text))) {
    const value = text.slice(start, match.index);
    if (clean(value)) result.push({ start, end: match.index, text: value });
    start = match.index + match[0].length;
  }
  const value = text.slice(start);
  if (clean(value)) result.push({ start, end: text.length, text: value });
  return result;
}

function lineSentenceSpans(paragraph) {
  const result = [];
  let lineStart = paragraph.start;
  const lines = paragraph.text.split("\n");
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const lineOffset = line.search(/\S/u);
    if (lineOffset >= 0) {
      const lineText = line.slice(lineOffset);
      const heading = !/[.!?…]\s*$/u.test(lineText) && lineIndex < lines.length - 1;
      if (heading) {
        result.push({ start: lineStart + lineOffset, end: lineStart + line.length, text: lineText.trim(), kind: "heading" });
      } else {
        const sentencePattern = /[^.!?…]+(?:[.!?…]+(?=\s|$)|$)/gu;
        for (const match of lineText.matchAll(sentencePattern)) {
          const sentenceOffset = match[0].search(/\S/u);
          if (sentenceOffset < 0) continue;
          result.push({
            start: lineStart + lineOffset + match.index + sentenceOffset,
            end: lineStart + lineOffset + match.index + match[0].length,
            text: match[0].trim(),
            kind: "sentence",
          });
        }
      }
    }
    lineStart += line.length + 1;
  }
  return result;
}

function descriptionSegments(text) {
  return paragraphSpans(text).flatMap((paragraph, index) => lineSentenceSpans(paragraph).map((segment) => ({
    ...segment,
    paragraphIndex: index + 1,
    paragraphText: paragraph.text.trim(),
  })));
}

function normalizedText(value) {
  return clean(value)
    .toLocaleLowerCase("de-DE")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:m²|m2|zimmer|kwh(?:\s*pro\s*quadratmeter\s*und\s*jahr)?)?\b/gu, "{zahl}")
    .replace(/\s+/gu, " ")
    .replace(/[,:;.!?…()–-]+/gu, " ")
    .trim();
}

function clusterKey(segment) {
  const text = normalizedText(segment.sentence ?? segment.text);
  if (/energieeffizientes? i kon konzept/u.test(text)) return "I_KON_UMWELT_HEADLINE";
  if (/das konzept verbindet/u.test(text) && /photovoltaik|batteriespeicher/u.test(text)) return "I_KON_TECHNIK_BAUSTEIN";
  if (/i kon konzept/u.test(text) && /photovoltaik|batteriespeicher/u.test(text)) return "I_KON_TECHNIK_BAUSTEIN";
  if (/effizienzhaus \{zahl\} qng/u.test(text) || /effizienzhaus \{zahl\}/u.test(text) && /qng/u.test(text)) return "EFFIZIENZHAUS_QNG_BAUSTEIN";
  if (/endenergiebedarf|energiebedarf/u.test(text) && /energieeffizienzklasse/u.test(text)) return "ENERGIEKENNWERT_BAUSTEIN";
  if (/warmepumpe|komfortluftung|warmeruckgewinnung/u.test(text)) return "HEIZUNG_LUEFTUNG_BAUSTEIN";
  if (/dgnb/u.test(text)) return "ZERTIFIZIERUNG_BAUSTEIN";
  return `TEXT:${text}`;
}

function causeFor(categories) {
  const values = new Set(categories);
  if (values.size > 1) return "MIXED";
  if (values.has(CLAIM_CATEGORY.GENERIC_ENVIRONMENTAL_CLAIM)) return "GENERIC_ENVIRONMENTAL";
  if (values.has(CLAIM_CATEGORY.UNVERIFIED_PERFORMANCE_OR_COST_CLAIM)) return "PERFORMANCE_COST";
  if (values.has(CLAIM_CATEGORY.UNVERIFIED_CERTIFICATION)
    || values.has(CLAIM_CATEGORY.UNVERIFIED_SUSTAINABILITY_LABEL)) return "CERTIFICATION_SCOPE";
  if (values.has(CLAIM_CATEGORY.UNVERIFIED_TECHNICAL_CLAIM)) return "UNVERIFIED_TECHNICAL";
  return "MIXED";
}

function factualContext(context) {
  return collectListingFacts({
    listingFacts: context.listing.listingFacts,
    house: context.house,
    project: context.project,
    houseSeries: LIVING_HAUS_SERIES_ID,
  });
}

function projectedDemandFact(facts, text) {
  const demand = facts.find((fact) => (
    fact.key === "energy_demand"
    && fact.status === FACT_STATUS.PLANNED
    && fact.scope === FACT_SCOPE.HOUSE
    && fact.verified === true
  ));
  if (!demand) return undefined;
  const amount = String(demand.value).replace(".", ",");
  return text.replaceAll(".", ",").includes(amount) ? demand : undefined;
}

function originFor(segment, clusterOccurrenceCount) {
  const originCodes = new Set(segment.findings.map((finding) => finding.textOriginCode));
  if (originCodes.has("KNOWN_LEGACY_FIXED_FIELD") || originCodes.has("KNOWN_LEGACY_FIXED_CTA")) return "HISTORISCHER_STANDARDBAUSTEIN";
  if (clusterOccurrenceCount >= 3) return "DETERMINISTISCHER_GENERATOR_INFERIERT";
  return "UNBEKANNT";
}

function classify(segment, facts) {
  const text = segment.sentence ?? segment.text;
  const lower = normalizedText(text);
  const categories = new Set(segment.categories);
  const demandFact = projectedDemandFact(facts, text);

  if (/effizienzhaus/u.test(lower) && /qng/u.test(lower)) {
    return {
      action: DESCRIPTION_ACTION.SAFE_REMOVE,
      reason: "Die bisherige QNG-Formulierung enthält keinen hinreichend präzisen, freigegebenen Serien-, Projektierungs- oder Objektnachweis und wird nicht ersetzt.",
      safeFacts: [],
    };
  }
  if (/energieeffizientes? i kon konzept/u.test(lower)
    && categories.size === 1
    && categories.has(CLAIM_CATEGORY.GENERIC_ENVIRONMENTAL_CLAIM)) {
    return {
      action: DESCRIPTION_ACTION.SAFE_REMOVE,
      reason: "Reine wiederkehrende Umwelt-/Marketingüberschrift ohne belegte Sachinformation.",
      safeFacts: [],
    };
  }
  if (((/i kon konzept/u.test(lower) || /das konzept verbindet/u.test(lower))
      && /photovoltaik|batteriespeicher/u.test(lower))
    || /warmepumpe|komfortluftung|warmeruckgewinnung/u.test(lower)) {
    return {
      action: DESCRIPTION_ACTION.HUMAN_DECISION,
      reason: "Die Passage enthält konkrete, aber nicht strukturierte Technikangaben. Alte Vorlagen- oder Defaulttexte sind kein Ersatznachweis.",
      safeFacts: [],
    };
  }
  if (demandFact && /energieeffizienzklasse/u.test(lower)) {
    return {
      action: DESCRIPTION_ACTION.SAFE_PARTIAL_REMOVE,
      reason: "Der belegte projektierte Endenergiebedarf kann bleiben; die nicht als Faktenmodell freigegebene Energieeffizienzklasse ist klar abtrennbar.",
      safeFacts: [`Projektierter Endenergiebedarf ${demandFact.value} kWh/(m²·a)`],
    };
  }
  if (categories.has(CLAIM_CATEGORY.UNVERIFIED_CERTIFICATION)) {
    return {
      action: DESCRIPTION_ACTION.HUMAN_DECISION,
      reason: "Zertifizierungsangaben sind mit weiteren Leistungs-/Qualitätsaussagen verbunden und benötigen eine fachliche Scope-Entscheidung.",
      safeFacts: [],
    };
  }
  if (categories.has(CLAIM_CATEGORY.GENERIC_ENVIRONMENTAL_CLAIM)
    && !categories.has(CLAIM_CATEGORY.UNVERIFIED_TECHNICAL_CLAIM)) {
    return {
      action: DESCRIPTION_ACTION.SAFE_REMOVE,
      reason: "Reine allgemeine Umwelt- oder Werbeaussage ohne verifizierte Sachinformation.",
      safeFacts: [],
    };
  }
  return {
    action: DESCRIPTION_ACTION.HUMAN_DECISION,
    reason: "Der Satz enthält nicht belegte oder fachlich gemischte Angaben, die ohne Inhaltsentscheidung nicht automatisiert geändert werden dürfen.",
    safeFacts: [],
  };
}

function actionCounts(entries) {
  return Object.values(DESCRIPTION_ACTION).reduce((counts, action) => ({
    ...counts,
    [action]: entries.filter((entry) => entry.action === action).length,
  }), {});
}

function outcomeFor(entries) {
  if (entries.some((entry) => entry.action === DESCRIPTION_ACTION.HUMAN_DECISION)) return DESCRIPTION_OUTCOME.HUMAN_DECISION_REQUIRED;
  if (entries.some((entry) => [DESCRIPTION_ACTION.REWRITE_SENTENCE, DESCRIPTION_ACTION.REWRITE_PARAGRAPH].includes(entry.action))) {
    return DESCRIPTION_OUTCOME.PARTIAL_REWRITE_REQUIRED;
  }
  return DESCRIPTION_OUTCOME.DETERMINISTICALLY_FIXABLE;
}

function outcomeCounts(fields) {
  return Object.values(DESCRIPTION_OUTCOME).reduce((counts, outcome) => ({
    ...counts,
    [outcome]: fields.filter((field) => field.outcome === outcome).length,
  }), {});
}

function scopeCounts(report) {
  const descriptionPlans = report.fieldPlans.filter((plan) => plan.field === "Objektbeschreibung");
  const descriptionFindings = report.findings.filter((finding) => (
    finding.field === "Objektbeschreibung" && finding.severity === "BLOCK"
  ));
  const technicalTitlePlans = report.fieldPlans.filter((plan) => (
    plan.field === "Überschrift"
    && plan.proposedTreatment === PHASE2B_TREATMENT.MANUAL_REVIEW
    && plan.categories.includes(CLAIM_CATEGORY.UNVERIFIED_TECHNICAL_CLAIM)
  ));
  const technicalFindings = report.findings.filter((finding) => (
    finding.field === "Überschrift"
    && finding.category === CLAIM_CATEGORY.UNVERIFIED_TECHNICAL_CLAIM
    && finding.severity === "BLOCK"
  ));
  return {
    activeListings: report.scannedListingCount,
    affectedFields: report.affectedFieldCount,
    blockClaims: report.severityCounts.BLOCK,
    descriptionFields: descriptionPlans.length,
    descriptionClaims: descriptionFindings.length,
    technicalHeadlineFields: technicalTitlePlans.length,
    technicalClaims: technicalFindings.length,
  };
}

export function assertPhase2BDescriptionAuditScope(report, expected = {}) {
  const actual = scopeCounts(report);
  const wanted = { ...DEFAULT_SCOPE, ...expected };
  for (const [key, value] of Object.entries(wanted)) {
    if (actual[key] !== value) {
      throw new Error(`PHASE2B_DESCRIPTION_AUDIT_SCOPE_MISMATCH: ${key} erwartet ${value}, gefunden ${actual[key]}.`);
    }
  }
  return actual;
}

/** Pure read-only analysis. It does not mutate the supplied catalog state. */
export function analyzePhase2BDescriptions(state, options = {}) {
  const scan = options.scan || scanPhase2BClaims;
  const report = scan(state, options.scanOptions);
  const scope = assertPhase2BDescriptionAuditScope(report, options.expectedScope);
  const rawEntries = [];
  for (const plan of report.fieldPlans.filter((entry) => entry.field === "Objektbeschreibung")) {
    const context = listingContext(state, plan.projectId, plan.listingId);
    const text = String(context.listing.texts?.description ?? "");
    const findings = report.findings.filter((finding) => (
      finding.listingId === plan.listingId
      && finding.field === "Objektbeschreibung"
      && finding.severity === "BLOCK"
    ));
    for (const segment of descriptionSegments(text)) {
      const segmentFindings = findings.filter((finding) => (
        finding.position >= segment.start && finding.position < segment.end
      ));
      if (!segmentFindings.length) continue;
      rawEntries.push({
        listingId: plan.listingId,
        externalId: plan.externalId,
        projectId: plan.projectId,
        paragraph: segment.paragraphIndex,
        paragraphText: segment.paragraphText,
        sentence: segment.text,
        kind: segment.kind,
        categories: [...new Set(segmentFindings.map((finding) => finding.category))],
        blockCount: segmentFindings.length,
        findings: segmentFindings,
        facts: factualContext(context),
      });
    }
  }
  const clusterFrequency = rawEntries.reduce((counts, entry) => {
    const key = clusterKey(entry);
    counts.set(key, (counts.get(key) || 0) + 1);
    return counts;
  }, new Map());
  const entries = rawEntries.map((entry) => {
    const cluster = clusterKey(entry);
    const classification = classify(entry, entry.facts);
    return {
      ...entry,
      cluster,
      cause: causeFor(entry.categories),
      origin: originFor(entry, clusterFrequency.get(cluster) || 0),
      action: classification.action,
      actionReason: classification.reason,
      safeFacts: classification.safeFacts,
      facts: undefined,
    };
  });
  const clusters = [...entries.reduce((grouped, entry) => {
    const group = grouped.get(entry.cluster) || {
      cluster: entry.cluster,
      occurrences: 0,
      listingCount: new Set(),
      claimCount: 0,
      categories: new Set(),
      causes: new Set(),
      actions: new Set(),
      origins: new Set(),
      examples: [],
    };
    group.occurrences += 1;
    group.listingCount.add(entry.listingId);
    group.claimCount += entry.blockCount;
    entry.categories.forEach((category) => group.categories.add(category));
    group.causes.add(entry.cause);
    group.actions.add(entry.action);
    group.origins.add(entry.origin);
    if (group.examples.length < 3) group.examples.push(entry.sentence);
    grouped.set(entry.cluster, group);
    return grouped;
  }, new Map()).values()].map((group) => ({
    ...group,
    listingCount: group.listingCount.size,
    categories: [...group.categories],
    causes: [...group.causes],
    actions: [...group.actions],
    origins: [...group.origins],
  })).sort((left, right) => right.occurrences - left.occurrences || right.claimCount - left.claimCount);
  const fields = [...entries.reduce((grouped, entry) => {
    const field = grouped.get(entry.listingId) || {
      listingId: entry.listingId,
      externalId: entry.externalId,
      entries: [],
    };
    field.entries.push(entry);
    grouped.set(entry.listingId, field);
    return grouped;
  }, new Map()).values()].map((field) => ({ ...field, outcome: outcomeFor(field.entries) }));
  return {
    format: 1,
    readOnly: true,
    report,
    scope,
    entries,
    clusters,
    fields,
    actionCounts: actionCounts(entries),
    outcomeCounts: outcomeCounts(fields),
    technicalHeadlines: report.fieldPlans.filter((plan) => (
      plan.field === "Überschrift"
      && plan.categories.includes(CLAIM_CATEGORY.UNVERIFIED_TECHNICAL_CLAIM)
    )).map((plan) => ({ listingId: plan.listingId, externalId: plan.externalId, field: plan.field })),
  };
}

function markdown(value) {
  return clean(value).replaceAll("|", "\\|").replace(/\s+/gu, " ");
}

export function formatPhase2BDescriptionAnalysisMarkdown(analysis) {
  const clusterRows = analysis.clusters.map((cluster) => `| ${[
    cluster.cluster,
    cluster.occurrences,
    cluster.claimCount,
    cluster.causes.join(", "),
    cluster.actions.join(", "),
    cluster.origins.join(", "),
    cluster.examples[0],
  ].map(markdown).join(" | ")} |`).join("\n");
  const actionRows = Object.entries(analysis.actionCounts)
    .map(([action, count]) => `| ${action} | ${count} |`).join("\n");
  const outcomeRows = Object.entries(analysis.outcomeCounts)
    .map(([outcome, count]) => `| ${outcome} | ${count} |`).join("\n");
  return `# Phase 2B.4 – Read-only-Analyse Objektbeschreibungen

## Bestand

| Kennzahl | Anzahl |
| --- | ---: |
| Aktive Inserate | ${analysis.scope.activeListings} |
| Betroffene Felder gesamt | ${analysis.scope.affectedFields} |
| BLOCK-Treffer gesamt | ${analysis.scope.blockClaims} |
| Betroffene Objektbeschreibungen | ${analysis.scope.descriptionFields} |
| Beschreibung-BLOCK-Treffer | ${analysis.scope.descriptionClaims} |
| Techniküberschriften | ${analysis.scope.technicalHeadlineFields} |
| Technik-BLOCK-Treffer | ${analysis.scope.technicalClaims} |

## Cluster

| Cluster | Sätze / Segmente | BLOCK | Ursache | Empfohlene Klasse | Ursprung | Beispiel |
| --- | ---: | ---: | --- | --- | --- | --- |
${clusterRows}

## Maßnahmenverteilung

| Maßnahme | Anzahl Sätze |
| --- | ---: |
${actionRows}

## Inseratverteilung

| Ergebnis | Anzahl Inserate |
| --- | ---: |
${outcomeRows}

Die Analyse ist vollständig read-only. Sie erzeugt keine Texte, führt keine
Migration aus und verändert weder Katalog noch Inserate, Archive, Snapshots oder
Uploaddaten.`;
}

export const PHASE2B_DESCRIPTION_ANALYSIS_READ_ONLY_GUARANTEE = Object.freeze({
  writesCatalog: false,
  writesListings: false,
  triggersUploads: false,
  generatesTexts: false,
});
