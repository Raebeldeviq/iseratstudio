/**
 * Zentrale EmpCo-/UWG-Claim-Policy für alle Inserattexte.
 *
 * Die Policy trennt die Erkennung einer Aussage von ihrer Freigabe. Sie
 * verwendet deshalb keine pauschale Themen-Blacklist: Konkrete technische
 * Angaben bleiben bei passender, strukturierter Evidenz zulässig.
 */

export const CLAIM_CATEGORY = Object.freeze({
  GENERIC_ENVIRONMENTAL_CLAIM: "GENERIC_ENVIRONMENTAL_CLAIM",
  ENVIRONMENTAL_SCOPE_OVERCLAIM: "ENVIRONMENTAL_SCOPE_OVERCLAIM",
  UNVERIFIED_CERTIFICATION: "UNVERIFIED_CERTIFICATION",
  UNVERIFIED_SUSTAINABILITY_LABEL: "UNVERIFIED_SUSTAINABILITY_LABEL",
  FUTURE_ENVIRONMENTAL_PERFORMANCE_CLAIM: "FUTURE_ENVIRONMENTAL_PERFORMANCE_CLAIM",
  GHG_OR_OFFSET_CLAIM: "GHG_OR_OFFSET_CLAIM",
  UNVERIFIED_TECHNICAL_CLAIM: "UNVERIFIED_TECHNICAL_CLAIM",
  UNVERIFIED_PERFORMANCE_OR_COST_CLAIM: "UNVERIFIED_PERFORMANCE_OR_COST_CLAIM",
});

export const CLAIM_SEVERITY = Object.freeze({
  BLOCK: "BLOCK",
  REVIEW: "REVIEW",
});

export const FACT_SCOPE = Object.freeze({
  COMPONENT: "component",
  TECHNICAL_SYSTEM: "technical_system",
  TECHNICAL_PACKAGE: "technical_package",
  HOUSE: "house",
  HOUSE_SERIES: "house_series",
  PROJECT: "project",
  MANUFACTURER: "manufacturer",
  COMPANY: "company",
});

export const FACT_STATUS = Object.freeze({
  VERIFIED: "verified",
  CONTRACT_INCLUDED: "contract_included",
  PLANNED: "planned",
  GUARANTEED: "guaranteed",
  PLANNING_CERTIFICATE: "planning_certificate",
  CERTIFIED: "certified",
  OPTIONAL: "optional",
  UNKNOWN: "unknown",
});

/**
 * Fachliche Herkunft eines Inseratfakts. `source` kann weiterhin eine
 * menschenlesbare Nachweisbezeichnung enthalten; `sourceKind` hält die
 * maschinenlesbare Einordnung fest. Ist `source` selbst einer dieser Werte,
 * wird sie ohne weitere Konvertierung als Quelle verwendet.
 */
export const FACT_SOURCE = Object.freeze({
  PROJECT: "project",
  HOUSE_TEMPLATE: "house_template",
  VERIFIED_SERIES: "verified_series",
  VERIFIED_MANUFACTURER: "verified_manufacturer",
  OPTIONAL_PACKAGE: "optional_package",
  LEGACY_DEFAULT: "legacy_default",
  UNKNOWN: "unknown",
});

export const FACT_EVIDENCE_KIND = Object.freeze({
  PROJECTED_HOUSE_VALUE: "projected_house_value",
  ENERGY_CERTIFICATE: "energy_certificate",
  QNG_SERIES_GUARANTEE: "qng_series_guarantee",
  QNG_PLANNING_CERTIFICATE: "qng_planning_certificate",
  QNG_INDIVIDUAL_CERTIFICATE: "qng_individual_certificate",
});

export const LIVING_HAUS_SERIES_ID = "livinghaus";
export const LIVING_HAUS_IKON_TECHNICAL_PACKAGE_ID = "livinghaus-ikon-standard";

export const QNG_GUARANTEE_TITLE = "QNG-Siegel garantiert";
export const QNG_GUARANTEE_SENTENCE = "Für dieses projektierte Haus ist das QNG-Siegel serienmäßig garantiert.";

/**
 * Die folgenden Fakten sind ausdrücklich freigegebene Living-Haus-
 * Serienfakten. Sie werden ausschließlich bei einem explizit als Living Haus
 * gekennzeichneten Hauskontext vererbt; sie sind keine Hersteller-Defaults.
 */
export const VERIFIED_LIVING_HAUS_SERIES_FACTS = Object.freeze([
  Object.freeze({
    key: "certification",
    value: "DGNB-Serienzertifizierung",
    source: FACT_SOURCE.VERIFIED_SERIES,
    scope: FACT_SCOPE.HOUSE_SERIES,
    status: FACT_STATUS.VERIFIED,
    verified: true,
    seriesId: LIVING_HAUS_SERIES_ID,
    evidenceReference: "Verifizierte Living-Haus-Serienfreigabe: DGNB",
  }),
  Object.freeze({
    key: "qng_guarantee",
    value: "QNG-Siegel garantiert",
    source: FACT_SOURCE.VERIFIED_SERIES,
    sourceKind: FACT_SOURCE.VERIFIED_SERIES,
    scope: FACT_SCOPE.PROJECT,
    sourceScope: FACT_SCOPE.HOUSE_SERIES,
    projectScope: FACT_SCOPE.PROJECT,
    status: FACT_STATUS.GUARANTEED,
    verified: true,
    seriesId: LIVING_HAUS_SERIES_ID,
    evidenceKind: FACT_EVIDENCE_KIND.QNG_SERIES_GUARANTEE,
    evidenceReference: "Verifizierte Living-Haus-Serienfreigabe: QNG-Garantie für projektierte Häuser",
  }),
]);

/**
 * Verifizierte technische Bestandteile des I-KON-Pakets. Sie werden niemals
 * global vererbt, sondern ausschließlich bei einem expliziten Paketmarker an
 * der konkreten Hausvorlage verwendet.
 */
export const VERIFIED_LIVING_HAUS_IKON_TECHNICAL_PACKAGE_FACTS = Object.freeze([
  Object.freeze({
    key: "photovoltaic",
    value: "Photovoltaikanlage",
    source: FACT_SOURCE.OPTIONAL_PACKAGE,
    scope: FACT_SCOPE.TECHNICAL_PACKAGE,
    status: FACT_STATUS.VERIFIED,
    verified: true,
    packageId: LIVING_HAUS_IKON_TECHNICAL_PACKAGE_ID,
    evidenceReference: "Verifizierte Living-Haus-/I-KON-Technikpaketfreigabe: Photovoltaikanlage",
  }),
  Object.freeze({
    key: "battery_storage",
    value: "Batteriespeicher",
    source: FACT_SOURCE.OPTIONAL_PACKAGE,
    scope: FACT_SCOPE.TECHNICAL_PACKAGE,
    status: FACT_STATUS.VERIFIED,
    verified: true,
    packageId: LIVING_HAUS_IKON_TECHNICAL_PACKAGE_ID,
    evidenceReference: "Verifizierte Living-Haus-/I-KON-Technikpaketfreigabe: Batteriespeicher",
  }),
  Object.freeze({
    key: "heat_pump",
    value: "Wärmepumpe",
    source: FACT_SOURCE.OPTIONAL_PACKAGE,
    scope: FACT_SCOPE.TECHNICAL_PACKAGE,
    status: FACT_STATUS.VERIFIED,
    verified: true,
    packageId: LIVING_HAUS_IKON_TECHNICAL_PACKAGE_ID,
    evidenceReference: "Verifizierte Living-Haus-/I-KON-Technikpaketfreigabe: Wärmepumpe",
  }),
  Object.freeze({
    key: "ventilation",
    value: "Lüftungsanlage",
    source: FACT_SOURCE.OPTIONAL_PACKAGE,
    scope: FACT_SCOPE.TECHNICAL_PACKAGE,
    status: FACT_STATUS.VERIFIED,
    verified: true,
    packageId: LIVING_HAUS_IKON_TECHNICAL_PACKAGE_ID,
    evidenceReference: "Verifizierte Living-Haus-/I-KON-Technikpaketfreigabe: Lüftungsanlage",
  }),
]);

const VALID_SCOPES = new Set(Object.values(FACT_SCOPE));
const VALID_STATUSES = new Set(Object.values(FACT_STATUS));
const VALID_SOURCES = new Set(Object.values(FACT_SOURCE));

const FACT_KEY_ALIASES = Object.freeze({
  heat_pump: "heat_pump",
  heatpump: "heat_pump",
  waermepumpe: "heat_pump",
  heating_type: "heat_pump",
  underfloor_heating: "underfloor_heating",
  floor_heating: "underfloor_heating",
  fussbodenheizung: "underfloor_heating",
  photovoltaic: "photovoltaic",
  photovoltaic_system: "photovoltaic",
  pv: "photovoltaic",
  solar: "photovoltaic",
  battery_storage: "battery_storage",
  batteriespeicher: "battery_storage",
  ventilation: "ventilation",
  ventilation_system: "ventilation",
  lueftung: "ventilation",
  heat_recovery: "heat_recovery",
  waermerueckgewinnung: "heat_recovery",
  energy_demand: "energy_demand",
  endenergiebedarf: "energy_demand",
  energy_class: "energy_class",
  energieeffizienzklasse: "energy_class",
  u_value: "u_value",
  u_wert: "u_value",
  efficiency_house_standard: "efficiency_house_standard",
  effizienzhaus: "efficiency_house_standard",
  kfw_standard: "efficiency_house_standard",
  certification: "certification",
  zertifizierung: "certification",
  sustainability_label: "sustainability_label",
  nachhaltigkeitssiegel: "sustainability_label",
  qng: "sustainability_label",
  qng_project_basis: "qng_project_basis",
  qng_projektierungsgrundlage: "qng_project_basis",
  qng_guarantee: "qng_guarantee",
  qng_garantie: "qng_guarantee",
  qng_planning_certificate: "qng_planning_certificate",
  qng_planungszertifikat: "qng_planning_certificate",
  qng_certified: "qng_certified",
  qng_zertifiziert: "qng_certified",
  manufacturer_quality: "manufacturer_quality",
  herstellerqualitaet: "manufacturer_quality",
});

const TECHNICAL_PATTERNS = Object.freeze([
  { key: "heat_pump", pattern: /\b(?:luft[-\s]?wasser[-\s]?)?wärmepumpe\b/giu },
  { key: "underfloor_heating", pattern: /\bfußbodenheizung\b/giu },
  { key: "photovoltaic", pattern: /\b(?:photovoltaik(?:anlage)?|pv[-\s]?anlage)\b/giu },
  { key: "battery_storage", pattern: /\bbatteriespeicher\b/giu },
  { key: "ventilation", pattern: /\b(?:komfort[-\s]?)?lüftungsanlage\b|\bkomfortlüftung\b/giu },
  { key: "heat_recovery", pattern: /\bwärmerückgewinnung\b/giu },
  { key: "energy_demand", pattern: /\b(?:endenergiebedarf\s*(?:von)?\s*)?\d{1,3}(?:[.,]\d+)?\s*kwh\s*\/\s*\(?m²\s*(?:·|\*)\s*a\)?\b/giu },
  { key: "energy_class", pattern: /\benergieeffizienzklasse\s*(?:a\+\+\+?|a\+?|[a-g])\b/giu },
  { key: "u_value", pattern: /\bu[-\s]?wert(?:e)?\s*(?:von)?\s*\d+(?:[.,]\d+)?\b/giu },
  { key: "efficiency_house_standard", pattern: /\b(?:effizienzhaus|kfw)\s*[- ]?\d{1,3}\b/giu },
]);

const GENERIC_ENVIRONMENTAL_PATTERNS = Object.freeze([
  /\bnachhaltig(?:e[rmns]?|er|es|en)?\b/giu,
  /\bnachhaltigkeit\b/giu,
  /\bsustainable\b/giu,
  /\bumweltfreundlich(?:e[rmns]?|er|es|en)?\b/giu,
  /\bumweltschonend(?:e[rmns]?|er|es|en)?\b/giu,
  /\bklimafreundlich(?:e[rmns]?|er|es|en)?\b/giu,
  /\bökologisch(?:e[rmns]?|er|es|en)?\b/giu,
  /\bumweltverträglich(?:e[rmns]?|er|es|en)?\b/giu,
  /\bressourcenschonend(?:e[rmns]?|er|es|en)?\b/giu,
  /\benergieeffizient(?:e[rmns]?|er|es|en)?\b/giu,
  /\bbesonders\s+energieeffizient(?:e[rmns]?|er|es|en)?\b/giu,
  /\benergiesparend(?:e[rmns]?|er|es|en)?\b/giu,
  /\bgrünes?\s+(?:wohnen|haus|eigenheim|zuhause)\b/giu,
  /\bverantwortungsvoll(?:e[rmns]?|er|es|en)?\s+(?:wohnen|bauen|haus|technik)\b/giu,
]);

const GHG_PATTERNS = Object.freeze([
  /\bklimaneutral(?:e[rmns]?|er|es|en)?\b/giu,
  /\bco[₂2][-\s]?neutral(?:e[rmns]?|er|es|en)?\b/giu,
  /\bcarbon\s+neutral\b/giu,
  /\bnet\s*zero\b/giu,
  /\bklimapositiv(?:e[rmns]?|er|es|en)?\b/giu,
  /\bco[₂2][-\s]?kompensiert(?:e[rmns]?|er|es|en)?\b/giu,
  /\bklimakompensiert(?:e[rmns]?|er|es|en)?\b/giu,
  /\breduziert(?:er|e|en)?\s+co[₂2][-\s]?fußabdruck\b/giu,
]);

const FUTURE_ENVIRONMENT_PATTERNS = Object.freeze([
  /\b(?:wird|werden|künftig|zukünftig|in\s+zukunft|geplant)\b[^.!?]{0,90}\b(?:nachhaltig|energieeffizient|klimafreundlich|umweltfreundlich|emissionsarm|klimaneutral)\b/giu,
]);

const PERFORMANCE_OR_COST_PATTERNS = Object.freeze([
  /\bdauerhaft\s+niedrig(?:e[rmns]?|er|es|en)?\s+energiekosten\b/giu,
  /\bbesonders\s+niedrig(?:e[rmns]?|er|es|en)?\s+(?:energie|betriebs)kosten\b/giu,
  /\bniedrig(?:e[rmns]?|er|es|en)?\s+energieverbrauch\b/giu,
  /\bideal\s+gedämmt(?:e[rmns]?|er|es|en)?\b/giu,
  /\bhöchste\s+energieeffizienz\b/giu,
  /\bspart?\s+(?:erheblich\s+)?energiekosten\b/giu,
  /\bzukunftssicher(?:e[rmns]?|er|es|en)?\s+technik\b/giu,
  /\b(?:niedrige|geringe)\s+betriebskosten\b/giu,
]);

const CERTIFICATION_PATTERN = /\b(?:dgnb|qdf|zertifizier(?:t|ung|bar)|zertifikat|qualitätssiegel)\b/giu;
const SUSTAINABILITY_LABEL_PATTERN = /\b(?:qng|nachhaltigkeitssiegel|umweltsiegel)\b/giu;

function clean(value) {
  return String(value ?? "").trim();
}

function token(value) {
  return clean(value)
    .toLocaleLowerCase("de-DE")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
}

function normalizedFactKey(value) {
  const normalized = token(value);
  return FACT_KEY_ALIASES[normalized] || normalized;
}

function normalizedFactSource(value) {
  const normalized = token(value);
  return VALID_SOURCES.has(normalized) ? normalized : FACT_SOURCE.UNKNOWN;
}

function factSourceKind(raw = {}) {
  const declaredKind = raw.sourceKind ?? raw.sourceType ?? raw.factSource ?? raw.source;
  const normalizedKind = normalizedFactSource(declaredKind);
  if (normalizedKind !== FACT_SOURCE.UNKNOWN) return normalizedKind;

  // Bestehende Fakten speicherten in `source` eine konkrete Dokumentbezeichnung.
  // Das ist fachlich ein projektbezogener Nachweis, solange er nicht ausdrücklich
  // als Legacy- oder unbekannter Wert gekennzeichnet ist.
  return clean(raw.source) ? FACT_SOURCE.PROJECT : FACT_SOURCE.UNKNOWN;
}

function energyEvidenceKind(raw = {}) {
  return token(raw.evidenceKind ?? raw.dataKind ?? raw.valueKind);
}

function configuredHouseSeries(input = {}) {
  return token(input.houseSeries ?? input.house?.seriesId ?? input.house?.houseSeries);
}

function configuredTechnicalPackage(input = {}) {
  return token(input.technicalPackage ?? input.house?.technicalPackage ?? input.house?.technicalPackageId);
}

function configuredManufacturer(input = {}) {
  return token(input.manufacturer ?? input.manufacturerId ?? input.house?.manufacturer ?? input.house?.manufacturerId);
}

/** Matches the persisted I-KON package marker without exposing token normalization to callers. */
export function isLivingHausIKonTechnicalPackage(value) {
  return token(value) === token(LIVING_HAUS_IKON_TECHNICAL_PACKAGE_ID);
}

function normalizedFact(raw = {}) {
  return {
    key: normalizedFactKey(raw.key ?? raw.type ?? raw.factKey),
    value: raw.value,
    source: clean(raw.source),
    sourceKind: factSourceKind(raw),
    scope: token(raw.scope),
    status: token(raw.status),
    verified: raw.verified === true,
    evidenceReference: clean(raw.evidenceReference),
    evidenceKind: energyEvidenceKind(raw),
    sourceScope: token(raw.sourceScope ?? raw.originScope),
    projectScope: token(raw.projectScope ?? raw.appliesToScope),
    seriesId: token(raw.seriesId ?? raw.houseSeries ?? raw.appliesToSeries),
    packageId: token(raw.packageId ?? raw.technicalPackage ?? raw.appliesToPackage),
    manufacturerId: token(raw.manufacturerId ?? raw.manufacturer ?? raw.appliesToManufacturer),
    validFrom: clean(raw.validFrom),
    validUntil: clean(raw.validUntil),
    approvedForListing: raw.approvedForListing !== false,
  };
}

function isApplicableVerifiedSeriesFact(fact, input = {}) {
  return fact.sourceKind === FACT_SOURCE.VERIFIED_SERIES
    && fact.scope === FACT_SCOPE.HOUSE_SERIES
    && fact.status === FACT_STATUS.VERIFIED
    && Boolean(fact.seriesId)
    && fact.seriesId === configuredHouseSeries(input);
}

function isApplicableQngGuaranteeFact(fact, input = {}) {
  return fact.key === "qng_guarantee"
    && fact.sourceKind === FACT_SOURCE.VERIFIED_SERIES
    && fact.scope === FACT_SCOPE.PROJECT
    && fact.sourceScope === FACT_SCOPE.HOUSE_SERIES
    && fact.projectScope === FACT_SCOPE.PROJECT
    && fact.status === FACT_STATUS.GUARANTEED
    && fact.evidenceKind === FACT_EVIDENCE_KIND.QNG_SERIES_GUARANTEE
    && fact.verified === true
    && Boolean(fact.seriesId)
    && fact.seriesId === configuredHouseSeries(input);
}

function isApplicableVerifiedTechnicalPackageFact(fact, input = {}) {
  return fact.sourceKind === FACT_SOURCE.OPTIONAL_PACKAGE
    && fact.scope === FACT_SCOPE.TECHNICAL_PACKAGE
    && fact.status === FACT_STATUS.VERIFIED
    && Boolean(fact.packageId)
    && fact.packageId === configuredTechnicalPackage(input);
}

function isApplicableVerifiedManufacturerFact(fact, input = {}) {
  return fact.sourceKind === FACT_SOURCE.VERIFIED_MANUFACTURER
    && fact.scope === FACT_SCOPE.MANUFACTURER
    && fact.status === FACT_STATUS.VERIFIED
    && Boolean(fact.manufacturerId)
    && fact.manufacturerId === configuredManufacturer(input);
}

function projectedTemplateEnergyFacts(input = {}) {
  const house = input.house;
  if (!house || typeof house !== "object") return [];

  const energyDemand = Number(house.energyDemand);
  if (!Number.isFinite(energyDemand) || energyDemand <= 0) return [];

  return [normalizedFact({
    key: "energy_demand",
    value: energyDemand,
    source: FACT_SOURCE.HOUSE_TEMPLATE,
    scope: FACT_SCOPE.HOUSE,
    status: FACT_STATUS.PLANNED,
    verified: true,
    evidenceKind: FACT_EVIDENCE_KIND.PROJECTED_HOUSE_VALUE,
    evidenceReference: "Fester Projektierungswert der verwendeten Hausvorlage",
  })];
}

function energyFactPriority(fact) {
  if (fact.evidenceKind === FACT_EVIDENCE_KIND.ENERGY_CERTIFICATE) return 3;
  if (fact.evidenceKind === FACT_EVIDENCE_KIND.PROJECTED_HOUSE_VALUE) return 2;
  return 1;
}

function resolveEnergyFactPrecedence(facts) {
  const energyKeys = new Set(["energy_demand", "energy_class"]);
  const retained = facts.filter((fact) => !energyKeys.has(fact.key));

  for (const key of energyKeys) {
    const candidates = facts.filter((fact) => fact.key === key);
    if (!candidates.length) continue;
    const highestPriority = Math.max(...candidates.map(energyFactPriority));
    const preferred = candidates.filter((fact) => energyFactPriority(fact) === highestPriority);
    const distinctValues = new Set(preferred.map((fact) => clean(fact.value).toLocaleLowerCase("de-DE")));

    // Gleichrangige, abweichende Klassen bzw. Kennwerte werden nicht erraten.
    // Ein tatsächlicher Energieausweis verdrängt hingegen immer den Planwert.
    if (distinctValues.size === 1) retained.push(preferred[0]);
  }
  return retained;
}

function uniqueFacts(facts) {
  const seen = new Set();
  return facts.filter((fact) => {
    const fingerprint = [
      fact.key,
      clean(fact.value),
      fact.sourceKind,
      fact.scope,
      fact.status,
      fact.evidenceKind,
      fact.sourceScope,
      fact.projectScope,
      fact.seriesId,
      fact.packageId,
      fact.manufacturerId,
    ].join("|");
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  });
}

function matchAll(pattern, value) {
  pattern.lastIndex = 0;
  return [...value.matchAll(pattern)];
}

function excerpt(value, index, length) {
  const start = Math.max(0, index - 45);
  const end = Math.min(value.length, index + Math.max(length, 1) + 95);
  return value.slice(start, end).trim();
}

function sentenceAt(value, index) {
  const before = value.slice(0, index);
  const start = Math.max(0, before.lastIndexOf(".") + 1, before.lastIndexOf("!") + 1, before.lastIndexOf("?") + 1);
  const after = value.slice(index);
  const ending = after.search(/[.!?]/u);
  return value.slice(start, ending < 0 ? value.length : index + ending + 1).trim();
}

function makeIssue({ field, value, match, category, reason, evidence = "Keine passende Evidenz hinterlegt.", severity = CLAIM_SEVERITY.BLOCK }) {
  const index = Number.isInteger(match?.index) ? match.index : 0;
  const matched = clean(match?.[0]);
  return {
    field,
    excerpt: excerpt(value, index, matched.length),
    position: index,
    category,
    reason,
    evidence,
    severity,
  };
}

function sourceFacts(input = {}) {
  const candidates = [
    input.listingFacts,
    input.facts,
    input.listing?.listingFacts,
    input.house?.listingFacts,
    input.house?.complianceFacts,
    input.project?.listingFacts,
    input.project?.complianceFacts,
  ];
  return candidates.flatMap((candidate) => Array.isArray(candidate) ? candidate : []);
}

/**
 * Enthält nur ausdrücklich belegte Fakten sowie zwei eng begrenzte Ableitungen:
 * freigegebene Serienfakten für die passende Hausserie und den festen
 * Projektierungswert für den Energiebedarf der konkreten Hausvorlage.
 */
export function collectListingFacts(input = {}) {
  const declaredFacts = sourceFacts(input)
    .filter((raw) => raw && typeof raw === "object")
    .map(normalizedFact)
    .filter((fact) => fact.key)
    .filter((fact) => {
      if (fact.key === "qng_guarantee") return isApplicableQngGuaranteeFact(fact, input);
      if (fact.sourceKind === FACT_SOURCE.VERIFIED_SERIES) return isApplicableVerifiedSeriesFact(fact, input);
      if (fact.sourceKind === FACT_SOURCE.OPTIONAL_PACKAGE && fact.scope === FACT_SCOPE.TECHNICAL_PACKAGE) {
        return isApplicableVerifiedTechnicalPackageFact(fact, input);
      }
      if (fact.sourceKind === FACT_SOURCE.VERIFIED_MANUFACTURER) {
        return isApplicableVerifiedManufacturerFact(fact, input);
      }
      return true;
    });
  const inheritedSeriesFacts = configuredHouseSeries(input) === LIVING_HAUS_SERIES_ID
    ? VERIFIED_LIVING_HAUS_SERIES_FACTS.map(normalizedFact)
    : [];
  const inheritedTechnicalPackageFacts = isLivingHausIKonTechnicalPackage(configuredTechnicalPackage(input))
    ? VERIFIED_LIVING_HAUS_IKON_TECHNICAL_PACKAGE_FACTS.map(normalizedFact)
    : [];

  return uniqueFacts(resolveEnergyFactPrecedence([
    ...declaredFacts,
    ...inheritedSeriesFacts,
    ...inheritedTechnicalPackageFacts,
    ...projectedTemplateEnergyFacts(input),
  ]));
}

export function factHasRequiredEvidence(fact) {
  return Boolean(
    clean(fact?.value)
    && clean(fact?.source)
    && VALID_SCOPES.has(fact?.scope)
    && VALID_STATUSES.has(fact?.status)
    && fact?.verified === true
    && fact?.approvedForListing !== false
    && fact?.sourceKind !== FACT_SOURCE.LEGACY_DEFAULT
    && fact?.sourceKind !== FACT_SOURCE.UNKNOWN,
  );
}

function factEvidence(fact) {
  if (!fact) return "Keine passende Evidenz hinterlegt.";
  const parts = [
    clean(fact.source) && `Quelle: ${fact.source}`,
    fact.scope && `Scope: ${fact.scope}`,
    fact.status && `Status: ${fact.status}`,
    fact.evidenceReference && `Nachweis: ${fact.evidenceReference}`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Passender Fakt ohne vollständige Evidenzmetadaten.";
}

function statusDisclosed(text, status) {
  if (status === FACT_STATUS.PLANNED) return /\b(?:geplant(?:e[rmns]?)?|vorgesehen|planung|planungsstand|projektiert(?:e[rmns]?)?|soll)\b/iu.test(text);
  if (status === FACT_STATUS.GUARANTEED) return /\bgarantiert\b/iu.test(text);
  if (status === FACT_STATUS.PLANNING_CERTIFICATE) return /\bplanungszertifikat\b/iu.test(text);
  if (status === FACT_STATUS.CERTIFIED) return /\bzertifiziert\b|\bzertifikat\b/iu.test(text);
  if (status === FACT_STATUS.OPTIONAL) return /\b(?:optional|wahlweise|gegen\s+mehrpreis)\b/iu.test(text);
  return status === FACT_STATUS.VERIFIED || status === FACT_STATUS.CONTRACT_INCLUDED;
}

function factMatchesTechnicalKey(fact, key) {
  const value = clean(fact.value).toLocaleLowerCase("de-DE");
  if (!value) return false;
  if (key === "heat_pump") return /wärmepumpe/iu.test(value);
  if (key === "underfloor_heating") return /fußbodenheizung/iu.test(value) || /^(?:true|ja)$/iu.test(value);
  if (key === "photovoltaic") return /photovoltaik|pv/iu.test(value);
  if (key === "battery_storage") return /batteriespeicher/iu.test(value);
  if (key === "ventilation") return /lüftung/iu.test(value);
  if (key === "heat_recovery") return /wärmerückgewinnung/iu.test(value);
  if (key === "energy_demand") return /kwh|endenergiebedarf|^\d+(?:[.,]\d+)?$/iu.test(value);
  if (key === "energy_class") return /^(?:a(?:\+){0,3}|[b-g])$/iu.test(value);
  if (key === "u_value") return /\d+(?:[.,]\d+)?/u.test(value);
  if (key === "efficiency_house_standard") return /(?:effizienzhaus|kfw)\s*[- ]?\d+/iu.test(value);
  return false;
}

function technicalDesignationMatchesStatement(fact, key, statement) {
  const value = clean(fact.value).toLocaleLowerCase("de-DE");
  const text = clean(statement).toLocaleLowerCase("de-DE");
  if (key === "ventilation" && /komfortlüftung/u.test(text)) return /komfortlüftung/u.test(value);
  if (key === "heat_pump" && /luft[-\s]?wasser/u.test(text)) return /luft[-\s]?wasser/u.test(value);
  return true;
}

function usableTechnicalFact(facts, key, statement) {
  return facts.find((fact) => (
    factMatchesTechnicalKey(fact, key)
    && factHasRequiredEvidence(fact)
    && fact.status !== FACT_STATUS.UNKNOWN
    && statusDisclosed(statement, fact.status)
    && technicalDesignationMatchesStatement(fact, key, statement)
  ));
}

function qdfManufacturerFact(fact) {
  return fact.key === "manufacturer_quality"
    && fact.sourceKind === FACT_SOURCE.VERIFIED_MANUFACTURER
    && fact.scope === FACT_SCOPE.MANUFACTURER
    && /\bqdf\b/iu.test(clean(fact.value));
}

function qngGuaranteeFact(fact) {
  return fact.key === "qng_guarantee"
    && fact.sourceKind === FACT_SOURCE.VERIFIED_SERIES
    && fact.scope === FACT_SCOPE.PROJECT
    && fact.sourceScope === FACT_SCOPE.HOUSE_SERIES
    && fact.projectScope === FACT_SCOPE.PROJECT
    && fact.status === FACT_STATUS.GUARANTEED
    && fact.evidenceKind === FACT_EVIDENCE_KIND.QNG_SERIES_GUARANTEE
    && factHasRequiredEvidence(fact);
}

function qngPlanningCertificateFact(fact) {
  return fact.key === "qng_planning_certificate"
    && fact.scope === FACT_SCOPE.PROJECT
    && fact.status === FACT_STATUS.PLANNING_CERTIFICATE
    && fact.evidenceKind === FACT_EVIDENCE_KIND.QNG_PLANNING_CERTIFICATE
    && factHasRequiredEvidence(fact);
}

function qngCertifiedFact(fact) {
  return fact.key === "qng_certified"
    && [FACT_SCOPE.HOUSE, FACT_SCOPE.PROJECT].includes(fact.scope)
    && fact.status === FACT_STATUS.CERTIFIED
    && fact.evidenceKind === FACT_EVIDENCE_KIND.QNG_INDIVIDUAL_CERTIFICATE
    && factHasRequiredEvidence(fact);
}

function exactQngGuaranteeStatement(statement) {
  const value = clean(statement).replace(/\s+/gu, " ");
  return value === QNG_GUARANTEE_SENTENCE
    || value === QNG_GUARANTEE_TITLE
    || value === "QNG-Siegel serienmäßig garantiert"
    || value.endsWith(` – ${QNG_GUARANTEE_TITLE}`);
}

function relevantCertificationFact(facts, key, marker) {
  return facts.find((fact) => {
    if (!factHasRequiredEvidence(fact)) return false;
    if (marker === "qdf") return qdfManufacturerFact(fact);
    if (key === "sustainability_label" && marker === "qng") {
      return qngGuaranteeFact(fact)
        || qngPlanningCertificateFact(fact)
        || qngCertifiedFact(fact)
        || (fact.key === "qng_project_basis" && /\bqng\b/iu.test(clean(fact.value)));
    }
    return fact.key === key
      && (["zertifikat", "zertifizierung", "zertifiziert", "qualitätssiegel"].includes(marker)
        || clean(fact.value).toLocaleLowerCase("de-DE").includes(marker));
  });
}

function certificationDesignationMatchesStatement(statement, fact, marker) {
  const value = clean(fact?.value).toLocaleLowerCase("de-DE");
  const text = clean(statement).toLocaleLowerCase("de-DE");
  if (marker === "dgnb") {
    const claimedLevel = text.match(/\bdgnb\b[^.!?]{0,80}\b(gold|silber|platin)\b/iu)?.[1]?.toLocaleLowerCase("de-DE");
    return /\bdgnb\b/iu.test(value) && (!claimedLevel || new RegExp(`\\b${claimedLevel}\\b`, "iu").test(value));
  }
  if (marker === "qdf") return /\bqdf\b/iu.test(value);
  if (marker === "qng") return /\bqng\b/iu.test(value);
  return true;
}

function certificationIsAccurate(statement, fact, marker) {
  if (!fact || !statusDisclosed(statement, fact.status)) return false;
  if (!certificationDesignationMatchesStatement(statement, fact, marker)) return false;
  if (marker === "qng" && qngGuaranteeFact(fact)) return exactQngGuaranteeStatement(statement);
  if (marker === "qng" && qngPlanningCertificateFact(fact)) {
    return /\bqng[-\s]?planungszertifikat\b/iu.test(statement);
  }
  if (marker === "qng" && qngCertifiedFact(fact)) {
    return /\bqng[-\s]?zertifiziert\b/iu.test(statement);
  }
  const seriesStatement = /\b(?:hausserie|serien(?:merkmal|zertifizierung|zertifiziert)?)\b/iu.test(statement);
  if (fact.scope === FACT_SCOPE.HOUSE_SERIES) return seriesStatement;
  if (fact.scope === FACT_SCOPE.MANUFACTURER) {
    return fact.sourceKind === FACT_SOURCE.VERIFIED_MANUFACTURER
      && /\bhersteller\b/iu.test(statement)
      && marker === "qdf";
  }
  if (fact.scope === FACT_SCOPE.HOUSE || fact.scope === FACT_SCOPE.PROJECT) return true;
  return false;
}

function collectTextFields(input = {}) {
  const result = [];
  const texts = input.texts || input.listing?.texts || {};
  const labels = {
    title: "Überschrift",
    description: "Objektbeschreibung",
    equipment: "Ausstattung",
    location: "Lagebeschreibung",
    other: "Sonstiges",
  };
  for (const [key, label] of Object.entries(labels)) {
    if (clean(texts[key])) result.push({ field: label, value: clean(texts[key]) });
  }

  const addCollection = (entries, field) => {
    if (Array.isArray(entries)) {
      entries.forEach((entry, index) => {
        if (clean(entry)) result.push({ field: `${field} ${index + 1}`, value: clean(entry) });
      });
    } else if (clean(entries)) {
      result.push({ field, value: clean(entries) });
    }
  };
  addCollection(input.highlights, "Highlight");
  addCollection(input.ctaTexts, "CTA");
  addCollection(input.advertisingTexts, "OpenImmo-Werbetext");

  const images = input.images || input.house?.images || [];
  if (Array.isArray(images)) {
    images.forEach((image, index) => {
      const identity = clean(image?.id) || String(index + 1);
      if (clean(image?.caption)) result.push({ field: `Bildunterschrift ${identity}`, value: clean(image.caption) });
      if (!clean(image?.caption) && clean(image?.name)) result.push({ field: `Bildtitel ${identity}`, value: clean(image.name) });
    });
  }
  return result;
}

function scopeOverclaimIssues(field, value, facts) {
  const lowerScopeFacts = facts.filter((fact) => (
    factHasRequiredEvidence(fact)
    && (fact.scope === FACT_SCOPE.COMPONENT || fact.scope === FACT_SCOPE.TECHNICAL_SYSTEM)
  ));
  if (!lowerScopeFacts.length) return [];
  const claimedWhole = /\b(?:haus|eigenheim|zuhause|wohnen|angebot|objekt|projekt|unternehmen)\b/iu;
  const matches = [
    ...GENERIC_ENVIRONMENTAL_PATTERNS.flatMap((pattern) => matchAll(pattern, value)),
    ...GHG_PATTERNS.flatMap((pattern) => matchAll(pattern, value)),
  ];
  return matches
    .filter((match) => claimedWhole.test(sentenceAt(value, match.index)))
    .map((match) => makeIssue({
      field,
      value,
      match,
      category: CLAIM_CATEGORY.ENVIRONMENTAL_SCOPE_OVERCLAIM,
      reason: "Ein Merkmal einer technischen Anlage oder eines Bauteils wird als Eigenschaft des gesamten Hauses, Angebots oder Projekts dargestellt.",
      evidence: `Vorhanden sind nur niedrigere Scopes: ${lowerScopeFacts.map((fact) => factEvidence(fact)).join(" | ")}`,
    }));
}

/**
 * Validates every advertising text that can reach persistence or OpenImmo.
 * Manual text is never changed; callers decide whether a BLOCK stops their
 * operation.
 */
export function validateListingClaims(input = {}) {
  const facts = collectListingFacts(input);
  const issues = [];
  for (const { field, value } of collectTextFields(input)) {
    for (const match of GHG_PATTERNS.flatMap((pattern) => matchAll(pattern, value))) {
      issues.push(makeIssue({
        field,
        value,
        match,
        category: CLAIM_CATEGORY.GHG_OR_OFFSET_CLAIM,
        reason: "Klima-, CO₂- oder Kompensationswirkung wird in Phase 2A ohne Lifecycle-/Klimafaktenmodell nicht freigegeben.",
      }));
    }
    for (const match of FUTURE_ENVIRONMENT_PATTERNS.flatMap((pattern) => matchAll(pattern, value))) {
      issues.push(makeIssue({
        field,
        value,
        match,
        category: CLAIM_CATEGORY.FUTURE_ENVIRONMENTAL_PERFORMANCE_CLAIM,
        reason: "Eine geplante technische Eigenschaft darf nicht in ein zukünftiges Umwelt- oder Energieversprechen überführt werden.",
      }));
    }
    for (const match of GENERIC_ENVIRONMENTAL_PATTERNS.flatMap((pattern) => matchAll(pattern, value))) {
      issues.push(makeIssue({
        field,
        value,
        match,
        category: CLAIM_CATEGORY.GENERIC_ENVIRONMENTAL_CLAIM,
        reason: "Allgemeine Umwelt-, Nachhaltigkeits- oder Energieaussagen werden in Phase 2A nicht automatisch freigegeben.",
      }));
    }
    for (const match of PERFORMANCE_OR_COST_PATTERNS.flatMap((pattern) => matchAll(pattern, value))) {
      issues.push(makeIssue({
        field,
        value,
        match,
        category: CLAIM_CATEGORY.UNVERIFIED_PERFORMANCE_OR_COST_CLAIM,
        reason: "Die Kosten-, Verbrauchs- oder Leistungswirkung ist nicht als konkrete, belastbare Aussage hinterlegt.",
      }));
    }

    for (const match of matchAll(CERTIFICATION_PATTERN, value)) {
      const statement = sentenceAt(value, match.index);
      const genericMarker = match[0].toLocaleLowerCase("de-DE").replace(/zertifizier.*$/u, "").trim() || "dgnb";
      const marker = /\bqng\b/iu.test(statement) ? "qng" : genericMarker;
      const factKey = marker === "qng" ? "sustainability_label" : "certification";
      const fact = relevantCertificationFact(facts, factKey, marker);
      if (!certificationIsAccurate(statement, fact, marker)) {
        issues.push(makeIssue({
          field,
          value,
          match,
          category: CLAIM_CATEGORY.UNVERIFIED_CERTIFICATION,
          reason: "Zertifizierung, Hausserie, Planungsstatus und konkretes Objekt dürfen nicht gleichgesetzt werden.",
          evidence: factEvidence(fact),
        }));
      }
    }
    for (const match of matchAll(SUSTAINABILITY_LABEL_PATTERN, value)) {
      const marker = match[0].toLocaleLowerCase("de-DE");
      const fact = relevantCertificationFact(facts, "sustainability_label", marker);
      if (!certificationIsAccurate(sentenceAt(value, match.index), fact, marker)) {
        issues.push(makeIssue({
          field,
          value,
          match,
          category: CLAIM_CATEGORY.UNVERIFIED_SUSTAINABILITY_LABEL,
          reason: "Ein Nachhaltigkeits- oder Umweltkennzeichen ist nicht mit der passenden Objekt-, Projekt- oder Serienreichweite belegt.",
          evidence: factEvidence(fact),
        }));
      }
    }
    for (const { key, pattern } of TECHNICAL_PATTERNS) {
      for (const match of matchAll(pattern, value)) {
        const statement = sentenceAt(value, match.index);
        const fact = usableTechnicalFact(facts, key, statement);
        if (!fact) {
          issues.push(makeIssue({
            field,
            value,
            match,
            category: CLAIM_CATEGORY.UNVERIFIED_TECHNICAL_CLAIM,
            reason: "Für diese konkrete technische Aussage fehlt ein verifizierter Fakt mit Quelle, Scope und passendem Status.",
            evidence: factEvidence(facts.find((candidate) => factMatchesTechnicalKey(candidate, key))),
          }));
        }
      }
    }
    issues.push(...scopeOverclaimIssues(field, value, facts));
  }

  const deduplicated = [];
  const known = new Set();
  for (const issue of issues) {
    const id = `${issue.field}:${issue.category}:${issue.position}`;
    if (known.has(id)) continue;
    known.add(id);
    deduplicated.push(issue);
  }
  return {
    facts,
    issues: deduplicated,
    blockingIssues: deduplicated.filter((issue) => issue.severity === CLAIM_SEVERITY.BLOCK),
    ok: !deduplicated.some((issue) => issue.severity === CLAIM_SEVERITY.BLOCK),
  };
}

export function formatClaimIssue(issue) {
  return `Im Feld „${issue.field}“ wurde eine nicht freigegebene Aussage gefunden: „${issue.excerpt}“ (${issue.category}).`;
}

export function assertListingClaimsCompliant(input = {}, prefix = "Export blockiert") {
  const result = validateListingClaims(input);
  if (result.blockingIssues.length) {
    const error = new Error(`${prefix}: ${formatClaimIssue(result.blockingIssues[0])}`);
    error.code = "LISTING_CLAIM_VALIDATION_FAILED";
    error.claimIssues = result.blockingIssues;
    throw error;
  }
  return result;
}

/**
 * Returns only declared, project-usable facts for a generator or prompt.
 * Global defaults and unsourced legacy fields never appear here.
 */
export function releasedListingFacts(input = {}) {
  return collectListingFacts(input).filter((fact) => (
    factHasRequiredEvidence(fact)
    && [FACT_STATUS.VERIFIED, FACT_STATUS.CONTRACT_INCLUDED, FACT_STATUS.PLANNED, FACT_STATUS.GUARANTEED, FACT_STATUS.PLANNING_CERTIFICATE, FACT_STATUS.CERTIFIED].includes(fact.status)
    && (
      TECHNICAL_PATTERNS.some(({ key }) => factMatchesTechnicalKey(fact, key))
      || fact.key === "certification"
      || fact.key === "qng_project_basis"
      || fact.key === "qng_guarantee"
      || fact.key === "qng_planning_certificate"
      || fact.key === "qng_certified"
      || fact.key === "manufacturer_quality"
    )
  ));
}

export function releasedTechnicalFacts(input = {}) {
  return releasedListingFacts(input).filter((fact) =>
    TECHNICAL_PATTERNS.some(({ key }) => factMatchesTechnicalKey(fact, key)));
}

export function seriesFactSentences(input = {}) {
  return releasedListingFacts(input).flatMap((fact) => {
    if (fact.sourceKind !== FACT_SOURCE.VERIFIED_SERIES || fact.scope !== FACT_SCOPE.HOUSE_SERIES) return [];
    if (fact.key === "certification" && /dgnb/iu.test(clean(fact.value))) {
      return ["Das projektierte Haus gehört zu einer Hausserie mit verifizierter DGNB-Serienzertifizierung."];
    }
    if (fact.key === "qng_project_basis" && /qng/iu.test(clean(fact.value))) {
      return ["Für die Hausserie ist eine verifizierte QNG-Projektierungsgrundlage dokumentiert."];
    }
    return [];
  });
}

/** Returns the sole centrally managed QNG wording for a guaranteed future project status. */
export function qngGuaranteeSentence(input = {}) {
  return releasedListingFacts(input).some(qngGuaranteeFact)
    ? QNG_GUARANTEE_SENTENCE
    : "";
}

/** Returns the sole centrally managed compact title marker for QNG guarantees. */
export function qngGuaranteeTitle(input = {}) {
  return releasedListingFacts(input).some(qngGuaranteeFact)
    ? QNG_GUARANTEE_TITLE
    : "";
}

export function technicalFactSentences(input = {}) {
  return releasedTechnicalFacts(input).flatMap((fact) => {
    const planned = fact.status === FACT_STATUS.PLANNED;
    const value = clean(fact.value);
    const plannedSentence = (subject) => `In der derzeitigen Planung ist ${subject} vorgesehen.`;
    if (factMatchesTechnicalKey(fact, "heat_pump")) return [planned ? plannedSentence(`eine ${value}`) : `Die Wärmeversorgung erfolgt über ${value}.`];
    if (factMatchesTechnicalKey(fact, "underfloor_heating")) return [planned ? plannedSentence("eine Fußbodenheizung") : "Eine Fußbodenheizung ist Bestandteil der Ausstattung."];
    if (factMatchesTechnicalKey(fact, "photovoltaic")) return [planned ? plannedSentence(`eine ${value}`) : `Eine ${value} ist Bestandteil des Leistungsumfangs.`];
    if (factMatchesTechnicalKey(fact, "battery_storage")) return [planned ? plannedSentence("ein Batteriespeicher") : "Ein Batteriespeicher ist Bestandteil des Leistungsumfangs."];
    if (factMatchesTechnicalKey(fact, "ventilation")) return [planned ? plannedSentence(`eine ${value}`) : `Eine ${value} ist Bestandteil der Ausstattung.`];
    if (factMatchesTechnicalKey(fact, "heat_recovery")) return [planned ? plannedSentence("eine Wärmerückgewinnung") : "Eine Wärmerückgewinnung ist Bestandteil der Ausstattung."];
    if (factMatchesTechnicalKey(fact, "energy_demand")) {
      const demand = /kwh/iu.test(value) ? value : `${value} kWh/(m²·a)`;
      if (fact.evidenceKind === FACT_EVIDENCE_KIND.ENERGY_CERTIFICATE) {
        return [`Der vorliegende Energieausweis weist einen Endenergiebedarf von ${demand} aus.`];
      }
      return [planned ? `Für die derzeitige Planung ist ein Endenergiebedarf von ${demand} vorgesehen.` : `Der dokumentierte Endenergiebedarf beträgt ${demand}.`];
    }
    if (factMatchesTechnicalKey(fact, "energy_class")) {
      if (fact.evidenceKind === FACT_EVIDENCE_KIND.ENERGY_CERTIFICATE) {
        return [`Der vorliegende Energieausweis weist die Energieeffizienzklasse ${value} aus.`];
      }
      return [planned ? `Für die derzeitige Planung ist die Energieeffizienzklasse ${value} vorgesehen.` : `Die dokumentierte Energieeffizienzklasse lautet ${value}.`];
    }
    if (factMatchesTechnicalKey(fact, "u_value")) return [planned ? `Für die derzeitige Planung ist ein U-Wert von ${value} vorgesehen.` : `Der dokumentierte U-Wert beträgt ${value}.`];
    if (factMatchesTechnicalKey(fact, "efficiency_house_standard")) return [planned ? `Der aktuelle Planungsstand sieht den Standard ${value} vor.` : `Der dokumentierte Standard lautet ${value}.`];
    return [];
  });
}

/** Returns one exact, package-scoped technical sentence for released I-KON components. */
export function technicalPackageFactSentence(input = {}, requestedKeys = []) {
  const keys = requestedKeys.length
    ? [...new Set(requestedKeys)]
    : ["photovoltaic", "battery_storage", "heat_pump", "ventilation"];
  const facts = releasedTechnicalFacts(input).filter((fact) => (
    fact.sourceKind === FACT_SOURCE.OPTIONAL_PACKAGE
    && fact.scope === FACT_SCOPE.TECHNICAL_PACKAGE
    && isLivingHausIKonTechnicalPackage(fact.packageId)
  ));
  const values = keys.map((key) => facts.find((fact) => fact.key === key)?.value).map(clean);
  if (values.some((value) => !value)) return "";
  const list = values.length === 1
    ? values[0]
    : values.length === 2
      ? `${values[0]} und ${values[1]}`
      : `${values.slice(0, -1).join(", ")} und ${values.at(-1)}`;
  return `Das I-KON-Technikpaket umfasst ${list}.`;
}
