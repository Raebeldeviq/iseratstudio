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

function treatmentFor(issue, listing) {
  const key = fieldKey(issue.field);
  const rawText = String(listing?.texts?.[key] ?? "");
  const text = clean(rawText);

  if (key && LEGACY_FIXED_FIELD_HASHES[key] === fingerprint(text)) {
    return {
      action: PHASE2B_TREATMENT.SAFE_DETERMINISTIC_REPLACEMENT,
      rationale: "Exakt erkannter, früher erzwungener Standardbaustein; die Phase-2A-Ersatzfassung ist bereits festgelegt.",
    };
  }
  const legacyCtaStart = rawText.lastIndexOf(LEGACY_FIXED_DESCRIPTION_CTA);
  if (key === "description"
    && legacyCtaStart >= 0
    && legacyCtaStart + LEGACY_FIXED_DESCRIPTION_CTA.length === rawText.trimEnd().length
    && issue.position >= legacyCtaStart) {
    return {
      action: PHASE2B_TREATMENT.SAFE_DETERMINISTIC_REPLACEMENT,
      rationale: "Exakt erkannter, früher erzwungener Abschlussbaustein; nur dieser statische Abschluss kann später ersetzt werden.",
    };
  }

  // Die Persistenz unterscheidet derzeit nicht belastbar zwischen manuell
  // verfasstem und individuell nachbearbeitetem Generatorinhalt. Ohne diesen
  // Nachweis ist ein automatisches Überschreiben nicht zulässig.
  return {
    action: PHASE2B_TREATMENT.MANUAL_REVIEW,
    rationale: "Herkunft oder individuelle Bearbeitung des Feldes ist nicht nachweisbar; vor einer Änderung ist eine manuelle Entscheidung nötig.",
  };
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
          proposedTreatment: treatment.action,
          treatmentRationale: treatment.rationale,
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
    scannedListings,
    findings,
    fieldPlans: plans,
  };
}

function markdownCell(value) {
  return clean(value).replaceAll("|", "\\|").replace(/\s+/gu, " ");
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
    plan.proposedTreatment,
  ]);
  const table = rows.length
    ? [
      "| Interne ID | Haus | Projekt | Feld | Kategorien | Severity | Claims | Textausschnitt | Behandlung |",
      "| --- | --- | --- | --- | --- | ---: | ---: | --- | --- |",
      ...rows.map((row) => `| ${row.map(markdownCell).join(" | ")} |`),
    ].join("\n")
    : "Keine betroffenen aktiven Inserate gefunden.";

  return `# Phase 2B – Read-only Claim-Scan

Stand: ${markdownCell(report.scannedAt)}

## Zusammenfassung

| Kennzahl | Anzahl |
| --- | ---: |
${summary.map(([label, value]) => `| ${markdownCell(label)} | ${value} |`).join("\n")}

## Konkrete Feldmaßnahmen

${table}

## Empfehlung

Die Kategorien sind feldbezogen: Bei einem gemischten Feld hat \`MANUAL_REVIEW\` stets Vorrang. Nur Felder mit \`SAFE_DETERMINISTIC_REPLACEMENT\` können in Phase 2B feldgenau durch den bereits freigegebenen Ersatzbaustein ersetzt werden. \`MANUAL_REVIEW\` bleibt bis zu einer belegten Herkunfts- oder Freigabeentscheidung unverändert. Dieser Scan verändert keine Katalog-, Inserat-, Archiv- oder Uploaddaten.`;
}

export const PHASE2B_SCAN_READ_ONLY_GUARANTEE = Object.freeze({
  writesCatalog: false,
  writesListings: false,
  triggersUploads: false,
  regeneratesTexts: false,
});
