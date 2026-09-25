import {
  LIVING_HAUS_SERIES_ID,
  validateListingClaims,
} from "./listing-claim-policy.mjs";
import {
  createStandardStaticCopy,
  KNOWN_PREVIOUS_STATIC_COPY,
  PREVIOUS_STATIC_COPY,
  STATIC_COPY_FIELD,
  STATIC_COPY_FIELDS,
  STATIC_COPY_SOURCE,
  STATIC_COPY_VERSION,
} from "./listing-copy.mjs";

export const LISTING_FIXED_COPY_TREATMENT = Object.freeze({
  ALREADY_CORRECT: "ALREADY_CORRECT",
  STANDARD_REPLACE_SAFE: "STANDARD_REPLACE_SAFE",
  MANUAL_DIFFERENCE: "MANUAL_DIFFERENCE",
});

export const LISTING_FIXED_COPY_READ_ONLY_GUARANTEE = Object.freeze({
  readsCatalogOnce: true,
  writesCatalog: false,
  writesFiles: false,
  triggersUploads: false,
  triggersFtps: false,
  triggersOpenImmoTransfer: false,
});

const ARCHIVED_STATUSES = new Set(["archived", "deleted"]);

const FIELD_LABELS = Object.freeze({
  [STATIC_COPY_FIELD.EQUIPMENT]: "Ausstattung",
  [STATIC_COPY_FIELD.OTHER]: "Sonstiges",
  [STATIC_COPY_FIELD.PROVISION]: "Provision",
  [STATIC_COPY_FIELD.ANNOTATION]: "Anmerkung",
  [STATIC_COPY_FIELD.TERMS]: "Allgemeine Geschäftsbedingungen",
  [STATIC_COPY_FIELD.RECOMMENDATION]: "Freier Textblock für Empfehlungen",
});

const PREVIOUS_PORTAL_DEFAULTS = Object.freeze({
  underfloorHeating: false,
  airSourceHeatPump: false,
  kfw40: false,
  kfw55: false,
  energyClass: "",
  commissionRequired: false,
});

const PORTAL_TARGET = Object.freeze({
  heatingType: "keine Angabe (heizungsart wird im OpenImmo-Export weggelassen)",
  fuelType: "Wärmepumpe",
  energyTypes: ["KFW40", "KFW55"],
  energyClass: "A++ (projektierter Wert, kein individueller Energieausweis)",
  commissionRequired: false,
});

function clean(value) {
  return String(value ?? "").trim();
}

function activeListing(listing = {}) {
  const status = clean(listing.status).toLocaleLowerCase("de-DE");
  return Boolean(clean(listing.id))
    && !clean(listing.rotationArchivedAt)
    && !ARCHIVED_STATUSES.has(status);
}

function sourceFor(listing, field, value) {
  const source = listing?.staticCopySources?.[field];
  if (source === STATIC_COPY_SOURCE.MANUAL || source === STATIC_COPY_SOURCE.STANDARD) return source;
  return clean(value) ? "legacy-unclassified" : "legacy-system-default";
}

function rawStaticValue(listing, field) {
  if (field === STATIC_COPY_FIELD.EQUIPMENT || field === STATIC_COPY_FIELD.OTHER) {
    return clean(listing?.texts?.[field]);
  }
  return clean(listing?.staticTexts?.[field]);
}

function currentStaticField(listing, field, standards) {
  const rawValue = rawStaticValue(listing, field);
  const source = sourceFor(listing, field, rawValue);
  const version = Number.isInteger(listing?.staticCopyVersion) ? listing.staticCopyVersion : 0;
  const sourceIsCurrentStandard = source === STATIC_COPY_SOURCE.STANDARD
    && version >= STATIC_COPY_VERSION;
  const currentText = rawValue || (source === STATIC_COPY_SOURCE.MANUAL
    ? ""
    : sourceIsCurrentStandard
      ? standards[field]
      : PREVIOUS_STATIC_COPY[field]);
  const knownPreviousStandard = KNOWN_PREVIOUS_STATIC_COPY[field]?.includes(currentText) === true;
  // Legacy records had no explicit source. Only an exact match to a frozen,
  // historically versioned system standard is eligible for a later
  // deterministic migration.
  const treatment = source === STATIC_COPY_SOURCE.MANUAL
    ? LISTING_FIXED_COPY_TREATMENT.MANUAL_DIFFERENCE
    : currentText === standards[field]
      ? LISTING_FIXED_COPY_TREATMENT.ALREADY_CORRECT
      : knownPreviousStandard
        ? LISTING_FIXED_COPY_TREATMENT.STANDARD_REPLACE_SAFE
        : LISTING_FIXED_COPY_TREATMENT.MANUAL_DIFFERENCE;
  return {
    field,
    label: FIELD_LABELS[field],
    currentText,
    masterText: standards[field],
    source,
    version,
    storage: rawValue
      ? "persisted"
      : sourceIsCurrentStandard
        ? "implicit-current-standard"
        : "implicit-previous-standard",
    treatment,
  };
}

function previousPortalSource(listing = {}, house = {}) {
  const source = listing?.projectingSettings && typeof listing.projectingSettings === "object"
    ? listing.projectingSettings
    : {};
  const bool = (key) => typeof source[key] === "boolean"
    ? source[key]
    : PREVIOUS_PORTAL_DEFAULTS[key];
  const value = (key) => clean(source[key]);
  return {
    underfloorHeating: bool("underfloorHeating"),
    airSourceHeatPump: bool("airSourceHeatPump"),
    kfw40: bool("kfw40"),
    kfw55: bool("kfw55"),
    energyClass: value("energyClass") || clean(house?.energyClass),
    commissionRequired: bool("commissionRequired"),
  };
}

function portalFields(listing, house) {
  const source = previousPortalSource(listing, house);
  return [
    {
      field: "heatingType",
      label: "Heizungsart",
      currentValue: `Vorheriger Quellwert fussboden=${source.underfloorHeating}`,
      targetValue: PORTAL_TARGET.heatingType,
      treatment: "CENTRAL_EXPORT_MAPPING",
    },
    {
      field: "fuelType",
      label: "Befeuerungsart",
      currentValue: source.airSourceHeatPump ? "Wärmepumpe" : "kein persistierter Wärmepumpenwert",
      targetValue: PORTAL_TARGET.fuelType,
      treatment: source.airSourceHeatPump ? "ALREADY_CORRECT" : "CENTRAL_EXPORT_MAPPING",
    },
    {
      field: "energyTypes",
      label: "Energietyp",
      currentValue: [source.kfw40 && "KFW40", source.kfw55 && "KFW55"].filter(Boolean),
      targetValue: PORTAL_TARGET.energyTypes,
      treatment: source.kfw40 && source.kfw55 ? "ALREADY_CORRECT" : "CENTRAL_EXPORT_MAPPING",
    },
    {
      field: "energyClass",
      label: "Energieklasse",
      currentValue: source.energyClass || "kein persistierter Projektierungswert",
      targetValue: PORTAL_TARGET.energyClass,
      treatment: source.energyClass === "A++" ? "ALREADY_CORRECT" : "CENTRAL_EXPORT_MAPPING",
    },
    {
      field: "commissionRequired",
      label: "Provisionspflichtig",
      currentValue: source.commissionRequired,
      targetValue: PORTAL_TARGET.commissionRequired,
      treatment: source.commissionRequired === PORTAL_TARGET.commissionRequired
        ? "ALREADY_CORRECT"
        : "CENTRAL_EXPORT_MAPPING",
    },
  ];
}

function seriesId(house = {}) {
  return clean(house.seriesId || house.houseSeries) || LIVING_HAUS_SERIES_ID;
}

function masterClaimValidator(project, listing, house, standards) {
  const result = validateListingClaims({
    texts: { equipment: standards.equipment },
    house,
    project,
    listingFacts: listing.listingFacts,
    houseSeries: seriesId(house),
    approvedMasterTextFields: [STATIC_COPY_FIELD.EQUIPMENT],
  });
  return {
    ok: result.ok,
    blockingIssues: result.blockingIssues,
    factKeys: result.facts.map((fact) => fact.key),
  };
}

/**
 * Produces an immutable, field-level migration preview. It does not normalize
 * the state and does not infer a manual origin from an unknown legacy value.
 */
export function planListingFixedCopyPreview(state = {}) {
  const standards = createStandardStaticCopy();
  const houses = new Map((state.houses || []).map((house) => [house.id, house]));
  const listings = [];

  for (const project of state.projects || []) {
    for (const listing of project.listings || []) {
      if (!activeListing(listing)) continue;
      const house = houses.get(listing.templateId) || {};
      const fields = STATIC_COPY_FIELDS.map((field) => currentStaticField(listing, field, standards));
      listings.push({
        projectId: clean(project.id),
        project: clean(project.name),
        listingId: clean(listing.id),
        externalId: clean(listing.externalId),
        houseId: clean(listing.templateId),
        house: clean(house.name),
        fields,
        portalFields: portalFields(listing, house),
        masterClaimValidator: masterClaimValidator(project, listing, house, standards),
      });
    }
  }

  const fields = listings.flatMap((listing) => listing.fields.map((field) => ({
    listingId: listing.listingId,
    externalId: listing.externalId,
    ...field,
  })));
  const migrationCandidates = fields
    .filter((field) => field.treatment === LISTING_FIXED_COPY_TREATMENT.STANDARD_REPLACE_SAFE)
    .map((field) => ({
      listingId: field.listingId,
      externalId: field.externalId,
      field: field.field,
      label: field.label,
      source: field.source,
      version: field.version,
      storage: field.storage,
      treatment: field.treatment,
    }));
  const classification = Object.fromEntries(STATIC_COPY_FIELDS.map((field) => [
    field,
    Object.fromEntries(Object.values(LISTING_FIXED_COPY_TREATMENT).map((treatment) => [
      treatment,
      fields.filter((entry) => entry.field === field && entry.treatment === treatment).length,
    ])),
  ]));

  return {
    readOnly: true,
    guarantee: LISTING_FIXED_COPY_READ_ONLY_GUARANTEE,
    staticCopyVersion: STATIC_COPY_VERSION,
    standards,
    portalTarget: PORTAL_TARGET,
    counts: {
      activeListings: listings.length,
      masterClaimPass: listings.filter((listing) => listing.masterClaimValidator.ok).length,
      masterClaimBlock: listings.filter((listing) => !listing.masterClaimValidator.ok).length,
      migrationCandidates: migrationCandidates.length,
    },
    classification,
    migrationCandidates,
    listings,
  };
}

function shortText(value) {
  return clean(value).replace(/\s+/gu, " ").slice(0, 120);
}

/** Human-readable output retains all current/master values in the JSON report. */
export function formatListingFixedCopyPreviewMarkdown(report) {
  const lines = [
    "# Read-only-Vorschau: feste Inseratfelder",
    "",
    `Aktive Inserate: **${report.counts.activeListings}** · sichere spätere Standardmigrationen: **${report.counts.migrationCandidates}** · Mastertext-Checks: **${report.counts.masterClaimPass} PASS / ${report.counts.masterClaimBlock} BLOCK**.`,
    "",
    "Die vollständigen aktuellen und Mastertexte sind im JSON-Bericht enthalten. Diese Markdown-Ansicht kürzt sie nur zur Lesbarkeit, ohne Daten zu verändern.",
    "",
  ];
  for (const listing of report.listings) {
    lines.push(`## ${listing.externalId || listing.listingId} – ${listing.house || "ohne Hauszuordnung"}`, "");
    lines.push("| Feld | Klassifikation | Quelle | Aktuell | Master |", "| --- | --- | --- | --- | --- |");
    for (const field of listing.fields) {
      const current = shortText(field.currentText).replaceAll("|", "\\|");
      const master = shortText(field.masterText).replaceAll("|", "\\|");
      lines.push(`| ${field.label} | ${field.treatment} | ${field.source} | ${current} | ${master} |`);
    }
    lines.push("", "| Portalwert | Aktuell | Ziel | Behandlung |", "| --- | --- | --- | --- |");
    for (const field of listing.portalFields) {
      lines.push(`| ${field.label} | ${Array.isArray(field.currentValue) ? field.currentValue.join(", ") || "—" : field.currentValue} | ${Array.isArray(field.targetValue) ? field.targetValue.join(", ") : field.targetValue} | ${field.treatment} |`);
    }
    lines.push(`Mastertext-Claim-Validator: **${listing.masterClaimValidator.ok ? "PASS" : "BLOCK"}**.`, "");
  }
  return lines.join("\n");
}
