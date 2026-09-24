import { createHash } from "node:crypto";

import {
  LIVING_HAUS_SERIES_ID,
  validateListingClaims,
} from "./listing-claim-policy.mjs";

export const PHASE2B_TREATMENT = Object.freeze({
  SAFE_DETERMINISTIC_REPLACEMENT: "SAFE_DETERMINISTIC_REPLACEMENT",
  REGENERATE_FIELD: "REGENERATE_FIELD",
  MANUAL_REVIEW: "MANUAL_REVIEW",
  NO_ACTION: "NO_ACTION",
});

export const PHASE2B_TEXT_ORIGIN = Object.freeze({
  KNOWN_LEGACY_FIXED_FIELD: "KNOWN_LEGACY_FIXED_FIELD",
  KNOWN_LEGACY_FIXED_CTA: "KNOWN_LEGACY_FIXED_CTA",
  LISTING_ORIGIN_ONLY: "LISTING_ORIGIN_ONLY",
  NOT_DETERMINABLE: "NOT_DETERMINABLE",
});

const ARCHIVED_STATUSES = new Set(["archived", "deleted"]);
const LEGACY_FIXED_FIELD_HASHES = Object.freeze({
  equipment: "1109e3038877e830e2832f028e57daad5319e27ad2472292bf328a2f7f3ced01",
  other: "af41ea039ff6400959622ca3f392ea99e5f64885326d3bbf5ffca82fd6368cc9",
});
export const LEGACY_FIXED_DESCRIPTION_CTA = `Ruf direkt an und sichere dir deine professionelle und transparente Beratung für energieeffizientes Bauen: +49 160 930 87 202.
Nur mit dem richtigen Partner macht Bauen richtig Spaß und führt zu dem gewünschten Ergebnis.`;

function clean(value) {
  return String(value ?? "").trim();
}

function fieldKey(label) {
  return {
    Überschrift: "title",
    Objektbeschreibung: "description",
    Ausstattung: "equipment",
    Lagebeschreibung: "location",
    Sonstiges: "other",
  }[label] || "";
}

function fingerprint(value) {
  return createHash("sha256").update(clean(value)).digest("hex");
}

function activeListing(listing) {
  const status = clean(listing?.status).toLocaleLowerCase("de-DE");
  return Boolean(listing?.id)
    && !clean(listing?.rotationArchivedAt)
    && !ARCHIVED_STATUSES.has(status);
}

function legacyTextOrigin(issue, listing) {
  const key = fieldKey(issue.field);
  const rawText = String(listing?.texts?.[key] ?? "");
  const text = clean(rawText);

  if (key && LEGACY_FIXED_FIELD_HASHES[key] === fingerprint(text)) {
    return {
      code: PHASE2B_TEXT_ORIGIN.KNOWN_LEGACY_FIXED_FIELD,
      label: "Exakt erkannter historischer Standardbaustein im gesamten Feld.",
    };
  }
  const legacyCtaStart = rawText.lastIndexOf(LEGACY_FIXED_DESCRIPTION_CTA);
  if (key === "description"
    && legacyCtaStart >= 0
    && legacyCtaStart + LEGACY_FIXED_DESCRIPTION_CTA.length === rawText.trimEnd().length
    && issue.position >= legacyCtaStart) {
    return {
      code: PHASE2B_TEXT_ORIGIN.KNOWN_LEGACY_FIXED_CTA,
      label: "Exakt erkannter historischer Abschlussbaustein innerhalb der Objektbeschreibung.",
    };
  }

  const listingOrigin = clean(listing?.listingOrigin);
  if (listingOrigin) {
    return {
      code: PHASE2B_TEXT_ORIGIN.LISTING_ORIGIN_ONLY,
      label: `Inseratursprung „${listingOrigin}“ ist hinterlegt; ein feldgenauer Textursprung ist nicht gespeichert.`,
    };
  }
  return {
    code: PHASE2B_TEXT_ORIGIN.NOT_DETERMINABLE,
    label: "Kein belastbarer Inserat- oder feldgenauer Textursprung gespeichert.",
  };
}

function treatmentFor(issue, listing) {
  const origin = legacyTextOrigin(issue, listing);
  if (origin.code === PHASE2B_TEXT_ORIGIN.KNOWN_LEGACY_FIXED_FIELD) {
    return {
      action: PHASE2B_TREATMENT.SAFE_DETERMINISTIC_REPLACEMENT,
      rationale: "Exakt erkannter, früher erzwungener Standardbaustein; die Phase-2A-Ersatzfassung ist bereits festgelegt.",
      origin,
    };
  }
  if (origin.code === PHASE2B_TEXT_ORIGIN.KNOWN_LEGACY_FIXED_CTA) {
    return {
      action: PHASE2B_TREATMENT.SAFE_DETERMINISTIC_REPLACEMENT,
      rationale: "Exakt erkannter, früher erzwungener Abschlussbaustein; nur dieser statische Abschluss kann später ersetzt werden.",
      origin,
    };
  }

  // Die Persistenz unterscheidet derzeit nicht belastbar zwischen manuell
  // verfasstem und individuell nachbearbeitetem Generatorinhalt. Ohne diesen
  // Nachweis ist ein automatisches Überschreiben nicht zulässig.
  return {
    action: PHASE2B_TREATMENT.MANUAL_REVIEW,
    rationale: "Herkunft oder individuelle Bearbeitung des Feldes ist nicht nachweisbar; vor einer Änderung ist eine manuelle Entscheidung nötig.",
    origin,
  };
}

function missingEvidenceFor(issue) {
  const required = {
    GENERIC_ENVIRONMENTAL_CLAIM: "Eine gesetzlich zulässige allgemeine Umweltaussage mit klarer Substantiierung und Darstellung derselben Information im verwendeten Medium.",
    ENVIRONMENTAL_SCOPE_OVERCLAIM: "Ein Nachweis mit passendem Scope für das gesamte Haus, Angebot oder Projekt; ein Bauteil- oder Techniknachweis genügt nicht.",
    GHG_OR_OFFSET_CLAIM: "Ein belastbares Lifecycle-/Klimafaktenmodell einschließlich der dokumentierten Berechnungsgrundlage.",
    FUTURE_ENVIRONMENTAL_PERFORMANCE_CLAIM: "Ein freigegebener, konkret formulierter Planungsfakt ohne Umwelt- oder Leistungsversprechen.",
    UNVERIFIED_PERFORMANCE_OR_COST_CLAIM: "Ein belastbarer, freigegebener Leistungs-, Verbrauchs- oder Kostennachweis für die konkrete Aussage.",
    UNVERIFIED_CERTIFICATION: "Ein verifizierter Zertifizierungsfakt mit passendem Objekt-, Projekt- oder Serien-Scope und textgenauer Formulierung.",
    UNVERIFIED_SUSTAINABILITY_LABEL: "Ein verifizierter Kennzeichenfakt mit passendem Scope, Status und Serien-/Objektbezug.",
    UNVERIFIED_TECHNICAL_CLAIM: "Ein verifizierter technischer Fakt mit Quelle, passendem Scope und Status für die konkret behauptete Technik.",
  };
  return required[issue.category] || "Ein freigegebener, strukturierter Fakt mit passender Quelle, Scope, Status und Evidenzart.";
}

function projectLabel(project) {
  return clean(project?.name)
    || [clean(project?.street), clean(project?.houseNumber), clean(project?.zip), clean(project?.city)].filter(Boolean).join(" ")
    || "Unbenanntes Projekt";
}

function severityCounts(findings) {
  return findings.reduce((counts, finding) => {
    counts[finding.severity] = (counts[finding.severity] || 0) + 1;
    return counts;
  }, { BLOCK: 0, REVIEW: 0 });
}

function countsBy(findings, property) {
  return findings.reduce((counts, finding) => {
    const key = clean(finding[property]) || "UNBEKANNT";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function treatmentCounts(entries, scannedListingCount) {
  const counts = Object.values(PHASE2B_TREATMENT).reduce((result, action) => ({ ...result, [action]: 0 }), {});
  for (const entry of entries) counts[entry.proposedTreatment] += 1;
  counts[PHASE2B_TREATMENT.NO_ACTION] = scannedListingCount - new Set(entries.map((entry) => entry.listingId)).size;
  return counts;
}

function fieldTreatment(findings) {
  const actions = new Set(findings.map((finding) => finding.proposedTreatment));
  if (actions.has(PHASE2B_TREATMENT.MANUAL_REVIEW)) return PHASE2B_TREATMENT.MANUAL_REVIEW;
  if (actions.has(PHASE2B_TREATMENT.REGENERATE_FIELD)) return PHASE2B_TREATMENT.REGENERATE_FIELD;
  return PHASE2B_TREATMENT.SAFE_DETERMINISTIC_REPLACEMENT;
}

function fieldPlans(findings) {
  const grouped = new Map();
  for (const finding of findings) {
    const key = `${finding.listingId}:${finding.field}`;
    const group = grouped.get(key) || [];
    group.push(finding);
    grouped.set(key, group);
  }

  return [...grouped.values()].map((fieldFindings) => {
    const first = fieldFindings[0];
    const proposedTreatment = fieldTreatment(fieldFindings);
    const categories = [...new Set(fieldFindings.map((finding) => finding.category))];
    const excerpts = [...new Set(fieldFindings.map((finding) => finding.excerpt))];
    const safeOnly = fieldFindings.every((finding) => finding.proposedTreatment === PHASE2B_TREATMENT.SAFE_DETERMINISTIC_REPLACEMENT);
    return {
      listingId: first.listingId,
      externalId: first.externalId,
      house: first.house,
      projectId: first.projectId,
      project: first.project,
      field: first.field,
      categories,
      severity: fieldFindings.some((finding) => finding.severity === "BLOCK") ? "BLOCK" : "REVIEW",
      claimCount: fieldFindings.length,
      excerpts: excerpts.slice(0, 3),
      omittedExcerptCount: Math.max(0, excerpts.length - 3),
      textOrigins: [...new Set(fieldFindings.map((finding) => finding.textOrigin.label))],
      proposedTreatment,
      treatmentRationale: safeOnly
        ? first.treatmentRationale
        : "Das Feld enthält mindestens einen nicht eindeutig als statisch nachweisbaren Claim. Deshalb ist für das gesamte Feld eine manuelle Prüfung erforderlich.",
    };
  });
}

/**
 * Pure, read-only classification of persisted listings. It never normalizes,
 * writes, uploads or mutates the input state.
 */
export function scanPhase2BClaims(state = {}, options = {}) {
  const projects = Array.isArray(state?.projects) ? state.projects : [];
  const findings = [];
  const scannedListings = [];

  for (const project of projects) {
    const houses = new Map((Array.isArray(state?.houses) ? state.houses : []).map((house) => [house.id, house]));
    for (const listing of Array.isArray(project?.listings) ? project.listings : []) {
      if (!activeListing(listing)) continue;
      const house = houses.get(listing.templateId);
      const validation = validateListingClaims({
        texts: listing.texts,
        images: house?.images,
        house,
        project,
        listingFacts: listing.listingFacts,
        houseSeries: LIVING_HAUS_SERIES_ID,
      });
      scannedListings.push({
        listingId: clean(listing.id),
        externalId: clean(listing.externalId),
        house: clean(house?.name || listing.templateName),
        project: projectLabel(project),
      });
      for (const issue of validation.issues) {
        const treatment = treatmentFor(issue, listing);
        findings.push({
          listingId: clean(listing.id),
          externalId: clean(listing.externalId),
          house: clean(house?.name || listing.templateName),
          projectId: clean(project?.id),
          project: projectLabel(project),
          field: issue.field,
          foundClaim: issue.excerpt,
          category: issue.category,
          severity: issue.severity,
          excerpt: issue.excerpt,
          position: issue.position,
          reason: issue.reason,
          availableEvidence: issue.evidence,
          missingEvidence: missingEvidenceFor(issue),
          proposedTreatment: treatment.action,
          treatmentRationale: treatment.rationale,
          textOriginCode: treatment.origin.code,
          textOrigin: treatment.origin,
        });
      }
    }
  }

  const affectedListingIds = new Set(findings.map((finding) => finding.listingId));
  const plans = fieldPlans(findings);
  return {
    format: 1,
    readOnly: true,
    scannedAt: clean(options.now) || new Date().toISOString(),
    scannedListingCount: scannedListings.length,
    affectedListingCount: affectedListingIds.size,
    affectedFieldCount: plans.length,
    severityCounts: severityCounts(findings),
    treatmentCounts: treatmentCounts(plans, scannedListings.length),
    findingTreatmentCounts: treatmentCounts(findings, scannedListings.length),
    categoryCounts: countsBy(findings, "category"),
    textOriginCounts: countsBy(findings, "textOriginCode"),
    scannedListings,
    findings,
    fieldPlans: plans,
  };
}

function markdownCell(value) {
  return clean(value).replaceAll("|", "\\|").replace(/\s+/gu, " ");
}

function markdownMultilineCell(value) {
  return markdownCell(value).replaceAll("\n", "<br>");
}

export function formatPhase2BScanMarkdown(report) {
  const summary = [
    ["Gescannt", report.scannedListingCount],
    ["Betroffene Inserate", report.affectedListingCount],
    ["Betroffene Felder", report.affectedFieldCount],
    ["BLOCK-Claim-Treffer", report.severityCounts.BLOCK],
    ["REVIEW-Claim-Treffer", report.severityCounts.REVIEW],
    ...Object.values(PHASE2B_TREATMENT).map((action) => [action, report.treatmentCounts[action]]),
  ];
  const rows = report.fieldPlans.map((plan) => [
    plan.listingId,
    plan.house,
    plan.project,
    plan.field,
    plan.categories.join(", "),
    plan.severity,
    plan.claimCount,
    `${plan.excerpts.join(" / ")}${plan.omittedExcerptCount ? ` (+${plan.omittedExcerptCount} weitere)` : ""}`,
    plan.textOrigins.join(" / "),
    plan.proposedTreatment,
  ]);
  const table = rows.length
    ? [
      "| Interne ID | Haus | Projekt / Adresse | Feld | Kategorien | Severity | Claims | Textausschnitt | Ursprung | Behandlung |",
      "| --- | --- | --- | --- | --- | ---: | ---: | --- | --- | --- |",
      ...rows.map((row) => `| ${row.map(markdownCell).join(" | ")} |`),
    ].join("\n")
    : "Keine betroffenen aktiven Inserate gefunden.";

  const details = report.findings.map((finding) => [
    finding.listingId,
    finding.externalId,
    finding.house,
    finding.project,
    finding.field,
    finding.position + 1,
    finding.excerpt,
    finding.category,
    finding.severity,
    finding.reason,
    finding.availableEvidence,
    finding.missingEvidence,
    finding.textOrigin.label,
    finding.proposedTreatment,
  ]);
  const detailTable = details.length
    ? [
      "| Interne ID | Externe ID | Haus | Projekt / Adresse | Feld | Position | Textausschnitt | Kategorie | Severity | Grund | Vorhandene Evidenz | Fehlende Evidenz | Textursprung | Maßnahmeklasse |",
      "| --- | --- | --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- |",
      ...details.map((row) => `| ${row.map(markdownMultilineCell).join(" | ")} |`),
    ].join("\n")
    : "Keine nicht freigegebenen Claim-Treffer in aktiven Inseraten gefunden.";

  const categoryTable = Object.entries(report.categoryCounts)
    .sort(([, left], [, right]) => right - left)
    .map(([category, count]) => `| ${markdownCell(category)} | ${count} |`)
    .join("\n");

  return `# Phase 2B – Read-only Claim-Scan

Stand: ${markdownCell(report.scannedAt)}

## Zusammenfassung

| Kennzahl | Anzahl |
| --- | ---: |
${summary.map(([label, value]) => `| ${markdownCell(label)} | ${value} |`).join("\n")}

## Konkrete Feldmaßnahmen

${table}

## Detailtabelle – Claim-Treffer

${detailTable}

## Häufigste Ursachen

| Claim-Kategorie | Treffer |
| --- | ---: |
${categoryTable || "| Keine | 0 |"}

Historische Standardbausteine sind nur dort als sicher ersetzbar markiert, wo der vollständige Feldinhalt beziehungsweise der konkrete Abschlussbaustein per Fingerprint erkannt wurde. Bei allen anderen Treffern ist allenfalls der Inseratursprung, nicht jedoch der Ursprung des einzelnen Textfelds gespeichert; diese Felder bleiben deshalb in \`MANUAL_REVIEW\`. Die zentrale Policy lässt sachlich belegte technische Tatsachen, passende DGNB-/QNG-Serienmerkmale und klar gekennzeichnete Projektierungswerte zu; solche Aussagen erscheinen nicht als Treffer.

## Empfehlung

Die Kategorien sind feldbezogen: Bei einem gemischten Feld hat \`MANUAL_REVIEW\` stets Vorrang. Nur Felder mit \`SAFE_DETERMINISTIC_REPLACEMENT\` können in Phase 2B feldgenau durch den bereits freigegebenen Ersatzbaustein ersetzt werden. \`MANUAL_REVIEW\` bleibt bis zu einer belegten Herkunfts- oder Freigabeentscheidung unverändert. Dieser Scan verändert keine Katalog-, Inserat-, Archiv- oder Uploaddaten.`;
}

export const PHASE2B_SCAN_READ_ONLY_GUARANTEE = Object.freeze({
  writesCatalog: false,
  writesListings: false,
  triggersUploads: false,
  regeneratesTexts: false,
});
