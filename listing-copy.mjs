import {
  releasedTitleUsps,
} from "./listing-claim-policy.mjs";
import { parseHouseVariant } from "./image-sequence.mjs";
import { listingLocationLabel } from "./project-location.mjs";

const DESCRIPTION_CTA_START =
  "Du möchtest wissen, ob dieses Haus zu deinen Vorstellungen und deinem Budget passt?";
const DESCRIPTION_FINANCING_START =
  "Neben möglichen Fördermöglichkeiten steht dir mit Living Haus auch das Zuhause-Darlehen";

export const FIXED_DESCRIPTION_FINANCING = `${DESCRIPTION_FINANCING_START} als weitere Finanzierungsoption zur Verfügung. Welche Kombination für dein Bauvorhaben sinnvoll ist, klären wir gemeinsam im persönlichen Gespräch.`;

export const FIXED_DESCRIPTION_CTA = `Du möchtest wissen, ob dieses Haus zu deinen Vorstellungen und deinem Budget passt? Ruf mich direkt unter +49 160 930 87 202 an oder buche dir bequem einen persönlichen Telefontermin:
https://calendly.com/pascal-froehlich-livinghaus/erstinfo-via-telefon

Denn am Ende entscheidet nicht nur das Haus – sondern auch, mit wem du es baust.`;

export const FIXED_DESCRIPTION_ENDING = `${FIXED_DESCRIPTION_FINANCING}

${FIXED_DESCRIPTION_CTA}`;

/**
 * Zentral versionierte Inseratstandards. Die Texte sind keine Generatorausgabe.
 * Ausstattung, Sonstiges, Anmerkung und AGB bewahren manuelle Quellen;
 * Provision und Empfehlung sind ausdrücklich globale Portaltexte.
 */
export const STATIC_COPY_VERSION = 3;

export const STATIC_COPY_FIELD = Object.freeze({
  EQUIPMENT: "equipment",
  OTHER: "other",
  PROVISION: "provision",
  ANNOTATION: "annotation",
  TERMS: "terms",
  RECOMMENDATION: "recommendation",
});

export const STATIC_COPY_FIELDS = Object.freeze(Object.values(STATIC_COPY_FIELD));
export const STATIC_COPY_SOURCE = Object.freeze({ STANDARD: "standard", MANUAL: "manual" });

export const PREVIOUS_FIXED_EQUIPMENT_TEXT = `Bei Living Haus erlebst du Hausbau auf einem neuen Level – einfach, transparent und umfassend begleitet. Viele Leistungen, die du für dein Bauvorhaben benötigst, sind bereits im Leistungsumfang enthalten: von der Bodenplatte und einem umfangreichen Versicherungspaket über Architektur- und Planungsleistungen bis hin zu Grundstücks- und Finanzierungsservice. Hinzu kommt die 18-monatige Festpreisgarantie von Living Haus, die dir zusätzliche Planungssicherheit gibt.

Ein wichtiger Bestandteil deines Living Hauses ist das I-KON-Konzept. Dabei werden verschiedene Komponenten der Haus- und Energietechnik aufeinander abgestimmt: Photovoltaikanlage, Batteriespeicher, Wärmepumpentechnik, Komfortlüftung mit Wärmerückgewinnung und eine entsprechend ausgelegte Gebäudehülle. So entsteht ein abgestimmtes technisches Gesamtkonzept, das die Nutzung selbst erzeugter Energie unterstützt und den Energiebedarf des Hauses berücksichtigt.

Auch im Inneren wird dein Zuhause von Anfang an ganzheitlich geplant. Bei den entsprechend angebotenen Hauskonfigurationen ist die Einbauküche bereits im ausgewiesenen Preis enthalten und wird direkt in die Planung einbezogen. Dadurch werden Haus, Technik und Ausstattung frühzeitig aufeinander abgestimmt.

Wie viel du beim Innenausbau selbst übernehmen möchtest, entscheidest du. Mit dem Zuhause-Paket erhältst du die dafür vorgesehenen Ausbau-Materialien passend zu deinem Haus. Professionelle Ausbau-Coachings und digitale Tutorials unterstützen dich Schritt für Schritt bei der Umsetzung. Alternativ kannst du einen höheren Fertigstellungsgrad wählen und einen größeren Teil der Arbeiten ausführen lassen.

Über die Bau-Cockpit-App kannst du Termine, Baufortschritt und relevante Dokumente zentral verfolgen.

Ein weiterer Bestandteil des Living-Haus-Konzepts ist die DGNB-Zertifizierung. Living Häuser ab der Ausbaustufe Ausbauhaus-Plus können unter Berücksichtigung der vorgesehenen Planungs-, Ausbau- und Bemusterungsanforderungen den DGNB-Gold-Standard erreichen. Dabei bewertet das DGNB-System unter anderem ökologische, ökonomische, soziokulturelle, technische und prozessuale Qualitätskriterien des Gebäudes.

Und während des gesamten Weges begleite ich dich persönlich: Ich, Pascal Fröhlich, bin dein Living Haus Berater für Berlin-Brandenburg. Von der ersten Idee über Grundstück, Finanzierung und Planung bis in die Bauphase hast du einen festen Ansprechpartner, der die einzelnen Schritte mit dir koordiniert und transparent bespricht.

Living Haus verbindet planbaren Hausbau, moderne Haustechnik, individuelle Gestaltungsmöglichkeiten und persönliche Betreuung.

👉 Ruf mich direkt an und vereinbare deine persönliche Beratung: +49 160 930 87 202.`;

export const FIXED_EQUIPMENT_TEXT = `Bei Living Haus bilden konkrete Leistungen den Rahmen für dein Bauvorhaben: Die 18-monatige Festpreisgarantie beginnt mit der Auftragsbestätigung. Das Leistungspaket umfasst eine Bodenplatte, Bauversicherungen sowie Architektur- und Planungsleistungen. Welche Ausführung und welche Leistungen für dein Haus vereinbart werden, ergibt sich aus der individuellen Bau- und Leistungsbeschreibung.

Mit der Bau-Cockpit-App kannst du Termine, den Baufortschritt und wichtige Dokumente an einem Ort verfolgen. Für den Innenausbau stehen das Zuhause-Paket mit passenden Materialien, Ausbau-Coachings und digitale Tutorials zur Verfügung. Umfang und Auswahl werden für dein konkretes Bauvorhaben abgestimmt.

Die HausStatterei bietet Raum, Ausstattungswünsche und Gestaltungsideen zu besprechen. So wird aus vielen einzelnen Entscheidungen Schritt für Schritt ein Haus, das zu deinen Vorstellungen passt.`;

export const FIXED_OTHER_TEXT = `Das hier angebotene Grundstück ist im obigen Preis eingerechnet. Für die Hausplanung/Bauträgerleistung von Living Haus fällt keine zusätzliche Provision an. Die im Inserat ausgewiesene Provision betrifft ausschließlich den reinen Grundstückskauf.

Zusätzliche Baunebenkosten müssen noch hinzugerechnet werden, hierüber beraten wir dich gern.

Wir bieten auch interessante Finanzierungsmöglichkeiten inklusive Beantragung aller Fördermittel!

Die Hausabbildungen und die Bilder der Inneneinrichtung zeigen möglicherweise Extras, die nicht im angegebenen Kaufpreis inbegriffen sind.

Gute Beratung ist der Anfang von Allem. Deshalb analysieren wir gemeinsam mit euch eure Vorstellungen, Wünsche und Bedürfnisse und finden so das für Dich und Deine Familie passende Living Haus.

Interessiert? Kontaktiere mich und vereinbare noch heute einen kostenlosen und unverbindlichen Beratungstermin unter +49160 93087 202`;

export const FACTUAL_BUILDABILITY_NOTE =
  "Die konkrete Bebaubarkeit und Positionierung des Hauses werden im weiteren Planungsverlauf anhand der Grundstücksgegebenheiten und der öffentlich-rechtlichen Vorgaben geprüft und abgestimmt.";

export const FIXED_PROVISION_TEXT =
  "Für den reinen Grundstückskauf fällt eine Provision an. Die Hausplanung/Bauträgerleistung (LivingHaus) ist davon nicht betroffen.";

export const FIXED_ANNOTATION_TEXT =
  "Die von uns bereitgestellten Informationen basieren auf den Daten des Verkäufers. Für deren Genauigkeit und Vollständigkeit übernehmen wir keine Garantie oder Haftung. Ein vorheriger Verkauf kann bereits stattgefunden haben; Fehler sind möglich.";

export const FIXED_TERMS_TEXT =
  "Wir weisen auf unsere Allgemeinen Geschäftsbedingungen hin. Durch weitere Inanspruchnahme unserer Leistungen erklären Sie die Kenntnis und Ihr Einverständnis.";

export const PREVIOUS_FIXED_RECOMMENDATION_TEXT = `Für Sie bieten wir zusammen mit unserem strategischen Partner HEUN-Finanz auch attraktive Finanzierungsoptionen, einschließlich der Antragstellung für alle Förderungen!

Die Hausillustrationen und die Bilder der Innenausstattung können Extras zeigen, die nicht im angegebenen Kaufpreis enthalten sind.

Gute Beratung ist der Anfang von allem. Deshalb analysieren wir gemeinsam mit Ihnen Ihre Ideen, Wünsche und Bedürfnisse und finden das passende Living Haus für Sie und Ihre Familie.
Interessiert? Kontaktieren Sie mich und vereinbaren Sie noch heute ein kostenloses und unverbindliches Beratungsgespräch.`;

export const FIXED_RECOMMENDATION_TEXT = `Gemeinsam mit unserem strategischen Partner HEUN-Finanz bieten wir Ihnen attraktive Finanzierungsmöglichkeiten – einschließlich der Beantragung sämtlicher für Ihr Bauvorhaben infrage kommender Fördermittel.
Die Hausabbildungen und Bilder der Innenausstattung können Sonderausstattungen zeigen, die nicht im angegebenen Kaufpreis enthalten sind.
Eine gute Beratung ist die Grundlage für alles. Deshalb analysieren wir gemeinsam mit Ihnen Ihre Vorstellungen, Wünsche und Bedürfnisse und finden das passende Living Haus für Sie und Ihre Familie.
Interesse geweckt? Kontaktieren Sie mich noch heute und vereinbaren Sie ein kostenloses und unverbindliches Beratungsgespräch.`;

/**
 * The final Phase 2B cleanup intentionally used this former, neutral
 * equipment copy. It remains immutable only as a historical migration
 * reference and for read-only comparison of the existing catalogue. New
 * listings must use the versioned standards above instead.
 */
export const PHASE2B_LEGACY_EQUIPMENT_TEXT = `Die konkrete Ausstattung wird für dieses Hausprojekt in der individuellen Bau- und Leistungsbeschreibung dokumentiert. Sie bildet zusammen mit der Planung und den vertraglichen Vereinbarungen die maßgebliche Grundlage für Umfang, Ausführung und enthaltene Leistungen.

Materialien, Oberflächen, Sanitärausstattung, Küchenplanung und weitere Details werden im Bemusterungs- und Planungsprozess abgestimmt. Abweichungen zwischen Visualisierungen, Grundrissen und der späteren Ausführung sind möglich; verbindlich sind ausschließlich die für das konkrete Projekt vereinbarten Unterlagen.

Technische Anlagen oder energetische Kennwerte werden in diesem Inserat nur genannt, wenn sie für das konkrete Angebot strukturiert belegt und für die jeweilige Aussage freigegeben sind. Bei projektierten Merkmalen bleibt der Planungsstatus ausdrücklich erkennbar.`;

/**
 * Version-zero values are retained solely to identify an unambiguous,
 * system-generated legacy value in the read-only migration preview. They are
 * never written by application start, rotation, export or this module.
 */
export const PREVIOUS_STATIC_COPY = Object.freeze({
  equipment: PHASE2B_LEGACY_EQUIPMENT_TEXT,
  other: `Das angebotene Grundstück und die Hausplanung bilden die Grundlage dieses projektierten Angebots. Maßgeblich für Preis, Leistungsumfang und Zustandekommen eines Vertrags sind die individuellen Vereinbarungen.

Zusätzliche Baunebenkosten sowie grundstücks- und projektbezogene Positionen können hinzukommen. Diese werden im persönlichen Gespräch und in der individuellen Kalkulation erläutert.

Die Hausabbildungen, Grundrisse und Bilder der Inneneinrichtung können beispielhafte Ausstattungen, Möblierungen oder Extras zeigen, die nicht im angegebenen Kaufpreis enthalten sind.

Gerne besprechen wir Ihre Vorstellungen, die Grundstückssituation und die nächsten Schritte in einem persönlichen Beratungstermin.`,
  provision: "Das Grundstück wird über einen Drittanbieter provisionspflichtig verkauft.",
  annotation: "Die von uns gemachten Informationenbezüglich des Grundstückes beruhen auf Angaben des Verkäufers bzw. der Verkäuferin. Für die Richtigkeit und Vollständigkeit der Angaben kann keine Gewähr bzw. Haftung übernommen werden. Ein Zwischenverkauf und Irrtümer sind vorbehalten.",
  terms: FIXED_TERMS_TEXT,
  recommendation: `Das hier angebotene Grundstück ist im obigen Preis eingerechnet.
Zusätzliche Baunebenkosten müssen noch hinzugerechnet werden, hierüber beraten wir gern.
Für Dich bieten wir gemeinsam mit unserem strategischen Partner HEUN-Finanz auch interessante Finanzierungsmöglichkeiten inklusive Beantragung aller Fördermittel!

Die Hausabbildungen und die Bilder der Inneneinrichtung zeigen möglicherweise Extras, die nicht im angegebenen Kaufpreis inbegriffen sind.

Gute Beratung ist der Anfang von Allem. Deshalb analysieren wir gemeinsam mit euch eure Vorstellungen, Wünsche und Bedürfnisse und finden so das für Dich und Deine Familie passende Living Haus.
Interessiert? Kontaktiere mich und vereinbare noch heute einen kostenlosen und unverbindlichen Beratungstermin.`,
});

export const PHASE2B_LEGACY_OTHER_TEXT = PREVIOUS_STATIC_COPY.other;

/** An older central Sonstiges standard found in every current active listing. */
export const PRE_PHASE2B_LEGACY_OTHER_TEXT = `Das hier angebotene Grundstück ist im obigen Preis eingerechnet, es wird ohne zusätzliche Provision an einen Living Haus-Bauherren bereitgestellt.

Zusätzliche Baunebenkosten müssen noch hinzugerechnet werden, hierüber beraten wir dich gern.

Wir bieten auch interessante Finanzierungsmöglichkeiten inklusive Beantragung aller Fördermittel!

Die Hausabbildungen und die Bilder der Inneneinrichtung zeigen möglicherweise Extras, die nicht im angegebenen Kaufpreis inbegriffen sind.

Gute Beratung ist der Anfang von Allem. Deshalb analysieren wir gemeinsam mit euch eure Vorstellungen, Wünsche und Bedürfnisse und finden so das für Dich und Deine Familie passende Living Haus.

Interessiert? Kontaktiere mich und vereinbare noch heute einen kostenlosen und unverbindlichen Beratungstermin unter +49160 93087 202`;

/**
 * Explicit historical system versions accepted by the read-only preview.
 * This is used solely while no persisted source marker exists; a declared
 * manual source always wins, even if its text happens to match a legacy copy.
 */
export const KNOWN_PREVIOUS_STATIC_COPY = Object.freeze({
  equipment: Object.freeze([PREVIOUS_STATIC_COPY.equipment, PREVIOUS_FIXED_EQUIPMENT_TEXT]),
  other: Object.freeze([PREVIOUS_STATIC_COPY.other, PRE_PHASE2B_LEGACY_OTHER_TEXT]),
  provision: Object.freeze([PREVIOUS_STATIC_COPY.provision]),
  annotation: Object.freeze([PREVIOUS_STATIC_COPY.annotation]),
  terms: Object.freeze([PREVIOUS_STATIC_COPY.terms]),
  recommendation: Object.freeze([
    PREVIOUS_STATIC_COPY.recommendation,
    PREVIOUS_FIXED_RECOMMENDATION_TEXT,
  ]),
});

const STANDARD_STATIC_COPY = Object.freeze({
  equipment: FIXED_EQUIPMENT_TEXT,
  other: FIXED_OTHER_TEXT,
  provision: FIXED_PROVISION_TEXT,
  annotation: FIXED_ANNOTATION_TEXT,
  terms: FIXED_TERMS_TEXT,
  recommendation: FIXED_RECOMMENDATION_TEXT,
});

/** Returns fresh values so callers can safely persist a new listing's standards. */
export function createStandardStaticCopy() {
  return { ...STANDARD_STATIC_COPY };
}

export function isCurrentStaticCopyText(field, value) {
  return STATIC_COPY_FIELDS.includes(field)
    && clean(value) === STANDARD_STATIC_COPY[field];
}

export function createStandardStaticCopySources() {
  return Object.fromEntries(STATIC_COPY_FIELDS.map((field) => [field, STATIC_COPY_SOURCE.STANDARD]));
}

export function staticCopySource(value) {
  return value === STATIC_COPY_SOURCE.MANUAL
    ? STATIC_COPY_SOURCE.MANUAL
    : STATIC_COPY_SOURCE.STANDARD;
}

/**
 * Reads a listing's six static fields without mutating it. Legacy text fields
 * are treated as manual, except for the explicitly global provision and
 * recommendation fields that always resolve to the current central standard.
 */
export function resolveListingStaticCopy(listing = {}) {
  const texts = listing?.texts && typeof listing.texts === "object" ? listing.texts : {};
  const stored = listing?.staticTexts && typeof listing.staticTexts === "object" ? listing.staticTexts : {};
  const declaredSources = listing?.staticCopySources && typeof listing.staticCopySources === "object"
    ? listing.staticCopySources
    : {};
  const sourceFor = (field, storedValue) => {
    if (declaredSources[field] === STATIC_COPY_SOURCE.MANUAL) return STATIC_COPY_SOURCE.MANUAL;
    if (declaredSources[field] === STATIC_COPY_SOURCE.STANDARD) return STATIC_COPY_SOURCE.STANDARD;
    return clean(storedValue) ? STATIC_COPY_SOURCE.MANUAL : STATIC_COPY_SOURCE.STANDARD;
  };
  const equipment = clean(texts.equipment);
  const other = clean(texts.other);
  const provision = clean(stored.provision);
  const annotation = clean(stored.annotation);
  const terms = clean(stored.terms);
  const recommendation = clean(stored.recommendation);
  const values = { equipment, other, provision, annotation, terms, recommendation };
  const globallyFixedFields = new Set([STATIC_COPY_FIELD.PROVISION, STATIC_COPY_FIELD.RECOMMENDATION]);
  const sources = Object.fromEntries(STATIC_COPY_FIELDS.map((field) => [
    field,
    globallyFixedFields.has(field) ? STATIC_COPY_SOURCE.STANDARD : sourceFor(field, values[field]),
  ]));
  return {
    values: Object.fromEntries(STATIC_COPY_FIELDS.map((field) => [
      field,
      globallyFixedFields.has(field)
        ? STANDARD_STATIC_COPY[field]
        : sources[field] === STATIC_COPY_SOURCE.MANUAL
        ? values[field]
        : field === STATIC_COPY_FIELD.EQUIPMENT && values[field] === PREVIOUS_FIXED_EQUIPMENT_TEXT
        ? STANDARD_STATIC_COPY[field]
        : values[field] || STANDARD_STATIC_COPY[field],
    ])),
    sources,
    version: Number.isInteger(listing?.staticCopyVersion) ? listing.staticCopyVersion : 0,
  };
}

/** Applies defaults only while creating a new listing. It never normalizes existing records. */
export function initializeListingStaticCopy(listing = {}) {
  const standard = createStandardStaticCopy();
  return {
    ...listing,
    texts: {
      ...(listing.texts || {}),
      equipment: clean(listing?.texts?.equipment) || standard.equipment,
      other: clean(listing?.texts?.other) || standard.other,
    },
    staticTexts: {
      ...(listing.staticTexts || {}),
      provision: clean(listing?.staticTexts?.provision) || standard.provision,
      annotation: clean(listing?.staticTexts?.annotation) || standard.annotation,
      terms: clean(listing?.staticTexts?.terms) || standard.terms,
      recommendation: clean(listing?.staticTexts?.recommendation) || standard.recommendation,
    },
    staticCopySources: {
      ...createStandardStaticCopySources(),
      ...(listing.staticCopySources || {}),
    },
    staticCopyVersion: STATIC_COPY_VERSION,
  };
}

export const IMMOPROFESSIONAL_DEFAULTS = Object.freeze({
  equipmentQuality: "GEHOBEN",
  constructionYear: 2027,
  constructionPhase: "PROJEKTIERT",
  availableFrom: "2027",
  attic: true,
  guestWc: true,
  gardenUse: true,
  underfloorHeating: false,
  electricFuel: false,
  airSourceHeatPump: true,
  kfw40: true,
  kfw55: false,
  energyClass: "A++",
  commissionRequired: false,
  energyCertificateClass: "",
  fittedKitchen: true,
  openKitchen: true,
  shower: true,
  bathtub: true,
  bathroomWindow: true,
  environmentBus: true,
  environmentShopping: true,
});

export const BUNGALOW_HOUSE_MODEL_KEYS = Object.freeze([
  "SOL82",
  "SOL101",
  "SOL107",
  "SOL110",
]);

const BUNGALOW_HOUSE_MODEL_KEY_SET = new Set(BUNGALOW_HOUSE_MODEL_KEYS);

/** Exact central portal mapping: only the four approved SOL/Solution models are bungalows. */
export function portalHouseStructure(house = {}) {
  const modelKey = parseHouseVariant(house?.name)?.modelKey || "";
  const barrierFree = BUNGALOW_HOUSE_MODEL_KEY_SET.has(modelKey);
  return {
    modelKey,
    floors: barrierFree ? 1 : 2,
    barrierFree,
  };
}

export const HOUSE_ENERGY_DEFAULTS = Object.freeze({
  energyClass: "",
  heatingType: "",
  energySource: "",
});

export const IMMOPROFESSIONAL_ENVIRONMENT_OPTIONS = Object.freeze([
  Object.freeze({ key: "environmentBus", label: "Bus" }),
  Object.freeze({ key: "environmentShopping", label: "Einkaufsmöglichkeit" }),
]);

export function isMissingProjectingValue(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLocaleLowerCase("de-DE")
    .replace(/[_-]+/gu, " ")
    .replace(/\s+/gu, " ");
  return !normalized || normalized === "keine angabe";
}

export function fillMissingProjectingDefaults(values = {}) {
  const source = values && typeof values === "object" ? values : {};
  const choice = (key) => isMissingProjectingValue(source[key])
    ? IMMOPROFESSIONAL_DEFAULTS[key]
    : String(source[key]).trim();
  const flag = (key) => typeof source[key] === "boolean"
    ? source[key]
    : IMMOPROFESSIONAL_DEFAULTS[key];

  return {
    ...source,
    // These are global portal targets, not editable listing-specific defaults.
    // Normalization intentionally replaces legacy deviations for existing and
    // future listings while leaving unrelated equipment choices untouched.
    equipmentQuality: IMMOPROFESSIONAL_DEFAULTS.equipmentQuality,
    constructionYear: IMMOPROFESSIONAL_DEFAULTS.constructionYear,
    constructionPhase: IMMOPROFESSIONAL_DEFAULTS.constructionPhase,
    availableFrom: IMMOPROFESSIONAL_DEFAULTS.availableFrom,
    attic: flag("attic"),
    guestWc: flag("guestWc"),
    gardenUse: flag("gardenUse"),
    underfloorHeating: flag("underfloorHeating"),
    electricFuel: flag("electricFuel"),
    airSourceHeatPump: IMMOPROFESSIONAL_DEFAULTS.airSourceHeatPump,
    kfw40: IMMOPROFESSIONAL_DEFAULTS.kfw40,
    kfw55: IMMOPROFESSIONAL_DEFAULTS.kfw55,
    energyClass: IMMOPROFESSIONAL_DEFAULTS.energyClass,
    commissionRequired: IMMOPROFESSIONAL_DEFAULTS.commissionRequired,
    energyCertificateClass: choice("energyCertificateClass"),
    fittedKitchen: flag("fittedKitchen"),
    openKitchen: flag("openKitchen"),
    shower: flag("shower"),
    bathtub: flag("bathtub"),
    bathroomWindow: flag("bathroomWindow"),
    environmentBus: flag("environmentBus"),
    environmentShopping: flag("environmentShopping"),
  };
}

export function projectingEnvironmentLabels(values = {}) {
  const projecting = fillMissingProjectingDefaults(values);
  return IMMOPROFESSIONAL_ENVIRONMENT_OPTIONS
    .filter(({ key }) => projecting[key] === true)
    .map(({ label }) => label);
}

export const LISTING_TITLE_MAX_LENGTH = 220;
export const LISTING_TITLE_MIN_LENGTH = 55;

const HEADLINE_OPENINGS = Object.freeze([
  "Mehr Raum für euer Familienleben",
  "Hier beginnt euer nächstes Kapitel",
  "Ein Zuhause für große Pläne",
  "Wohnen nach euren Vorstellungen",
  "Raum für das, was zählt",
]);

const USP_BENEFIT_OPENINGS = Object.freeze({
  fixed_price_guarantee: ["Planbarer ins eigene Zuhause", "Mit gutem Gefühl ins neue Zuhause"],
  building_insurance: ["Gut abgesichert bauen", "Mehr Sicherheit beim Hausbau"],
  bau_cockpit: ["Gut organisiert zum eigenen Zuhause", "Weniger Baustress auf dem Weg ins Eigenheim"],
  structural_guarantee: ["Mehr Sicherheit beim Hausbau", "Heute planen, langfristig abgesichert bauen"],
  dgnb_series_certification: ["Mit gutem Gefühl ins neue Zuhause", "Auf geprüfte Qualität setzen"],
  ikon_technical_package: ["Technik schon mitgedacht", "Technik für euren Alltag mitdenken"],
});

function hash(value) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function clean(value) {
  return String(value ?? "").trim();
}

const LOCATION_PLANNING_PHRASE = /(?:Bebaubarkeit|Positionierung\s+(?:des\s+Hauses\s+)?(?:wird|werden)|im\s+weiteren\s+(?:Planungs)?verlauf|im\s+(?:persönlichen\s+)?Beratungsgespräch\s+(?:betrachtet|abgestimmt)|später\s+abgestimmt|Konkrete\s+Aussagen\s+zu|ausschließlich\s+aus\s+geprüften\s+Ortsinformationen|Das\s+Grundstück\s+befindet\s+sich|Hier\s+treffen\s+der\s+Wunsch[^.!?]*Anforderungen)/iu;

export function cleanSalesLocationText(value) {
  return clean(value)
    .split(/\n\s*\n/gu)
    .map((paragraph) => paragraph
      .split(/(?<=[.!?])\s+/gu)
      .filter((sentence) => !LOCATION_PLANNING_PHRASE.test(sentence))
      .join(" ")
      .trim())
    .filter(Boolean)
    .join("\n\n");
}

function germanNumber(value, maximumFractionDigits = 0) {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits }).format(finiteNumber(value));
}

export function listingPlace(project = {}) {
  return listingLocationLabel(project);
}

function listingFactContext(house = {}, project = {}, context = {}) {
  return {
    house,
    project,
    houseSeries: context.houseSeries,
    listingFacts: context.listingFacts,
    facts: context.facts,
  };
}

function headlineSeed(house, project, context) {
  return [
    clean(house.id),
    clean(house.name),
    listingPlace(project),
    finiteNumber(house.livingArea),
    finiteNumber(house.rooms),
    clean(context.titleSeed ?? context.listingId ?? context.externalId),
  ].join(":");
}

function selectTitleUsps(context, seed) {
  const available = releasedTitleUsps(context);
  if (!available.length) return [];
  const customerBenefits = available.filter((usp) => [
    "fixed_price_guarantee", "building_insurance", "structural_guarantee",
  ].includes(usp.id));
  const supportingTools = available.filter((usp) => [
    "bau_cockpit", "ikon_technical_package",
  ].includes(usp.id));
  const firstPool = supportingTools.length && hash(`${seed}:tool`) % 5 === 0
    ? supportingTools : customerBenefits.length ? customerBenefits : available;
  const first = firstPool[hash(`${seed}:usp`) % firstPool.length];
  const secondPool = (customerBenefits.length ? customerBenefits : available)
    .filter((usp) => usp.id !== first.id);
  if (!secondPool.length) return [first];
  return [first, secondPool[hash(`${seed}:second-usp`) % secondPool.length]];
}

const TITLE_USP_PAIR_PHRASE = Object.freeze({
  fixed_price_guarantee: "18 Monate Festpreisgarantie",
  building_insurance: "Bauversicherungen inklusive",
  bau_cockpit: "Bau-Cockpit-App",
  structural_guarantee: "30 Jahre Garantie",
  dgnb_series_certification: "DGNB-Serienzertifizierung",
  ikon_technical_package: "I-KON-Technikpaket",
});

function titleFrom(opening, house, project, usps, style) {
  const area = germanNumber(Math.round(finiteNumber(house.livingArea)));
  const rooms = germanNumber(house.rooms, 1);
  const place = listingPlace(project);
  const details = area !== "0" ? `${area} m²` : "Wohnfläche auf Anfrage";
  const roomDetails = rooms !== "0" ? `${rooms} Zimmer` : "Zimmerzahl auf Anfrage";
  const candidates = [
    `${opening} in ${place} – ${details}, ${roomDetails}`,
    `${opening}: ${details}, ${roomDetails} in ${place}`,
    `${place}: ${opening} – ${details}, ${roomDetails}`,
    `${opening} – ${details}, ${roomDetails} in ${place}`,
  ];
  const base = candidates[style % candidates.length];
  if (usps.length === 2) {
    return `${base} – ${TITLE_USP_PAIR_PHRASE[usps[0].id]} & ${TITLE_USP_PAIR_PHRASE[usps[1].id]}`;
  }
  return usps.length ? `${base} – ${TITLE_USP_PAIR_PHRASE[usps[0].id]}` : base;
}

/**
 * Selects a stable, evidence-backed title with at most two USPs. `titleSeed` is optional
 * but lets rotations keep their variation stable per generated version.
 */
export function planListingHeadline(house = {}, project = {}, context = {}) {
  const factContext = listingFactContext(house, project, context);
  const seed = headlineSeed(house, project, context);
  const usps = selectTitleUsps(factContext, seed);
  const style = hash(`${seed}:style`) % 4;
  const benefitOpenings = usps.length ? USP_BENEFIT_OPENINGS[usps[0].id] : HEADLINE_OPENINGS;
  const openings = benefitOpenings.map((_, index) => benefitOpenings[(hash(`${seed}:opening`) + index) % benefitOpenings.length]);
  const variants = openings.flatMap((candidate) =>
    Array.from({ length: 4 }, (_, index) => ({
      opening: candidate,
      title: titleFrom(candidate, house, project, usps, (style + index) % 4),
    })));
  const selected = variants.find((variant) =>
    variant.title.length >= LISTING_TITLE_MIN_LENGTH
    && variant.title.length <= LISTING_TITLE_MAX_LENGTH) || variants[0];
  const title = selected.title;

  return {
    title,
    opening: selected.opening,
    usps,
    availableUsps: releasedTitleUsps(factContext),
    length: title.length,
    maxLength: LISTING_TITLE_MAX_LENGTH,
    withinLengthLimit: title.length <= LISTING_TITLE_MAX_LENGTH,
  };
}

export function buildListingHeadline(house = {}, project = {}, context = {}) {
  return planListingHeadline(house, project, context).title;
}

function descriptionBody(value) {
  let body = clean(value);
  const fixedFinancingIndex = body.indexOf(DESCRIPTION_FINANCING_START);
  const fixedCtaIndex = body.indexOf(DESCRIPTION_CTA_START);
  const fixedEndingIndexes = [fixedFinancingIndex, fixedCtaIndex].filter((index) => index >= 0);
  if (fixedEndingIndexes.length) body = body.slice(0, Math.min(...fixedEndingIndexes)).trim();
  return body
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph && !/(?:Zuhause-Darlehen|Fördermöglichkeiten[^.]*Finanzierungsoption|\+49\s*160\s*930\s*87\s*202|calendly\.com\/pascal-froehlich-livinghaus|kostenlosen?\s+(?:und\s+unverbindlichen\s+)?Beratungstermin|Ruf\s+(?:mich\s+)?direkt|Du möchtest wissen, ob dieses Haus)/iu.test(paragraph))
    .join("\n\n")
    .trim();
}

export function enforceListingCopy(texts = {}, {
  house = {},
  project = {},
  generated = false,
  houseSeries = "",
  listingFacts = [],
  facts = [],
  titleSeed = "",
} = {}) {
  const suppliedDescription = clean(texts.description);
  const body = descriptionBody(suppliedDescription);
  const context = { houseSeries, listingFacts, facts, titleSeed };
  const generatedDescription = body
    ? `${body}\n\n${FIXED_DESCRIPTION_ENDING}`
    : FIXED_DESCRIPTION_ENDING;
  return {
    // A title is initialized for a new listing but is never replaced merely
    // because an AI call, app start or export passes through this helper.
    title: clean(texts.title) || buildListingHeadline(house, project, context),
    description: generated
      ? generatedDescription
      : suppliedDescription || FIXED_DESCRIPTION_ENDING,
    // Equipment and other are initialized once for new listings. Their
    // persisted value wins afterwards; the static-copy source controls any
    // explicit reset in the caller rather than this generic helper.
    equipment: clean(texts.equipment) || FIXED_EQUIPMENT_TEXT,
    location: generated ? cleanSalesLocationText(texts.location) : clean(texts.location),
    other: clean(texts.other) || FIXED_OTHER_TEXT,
  };
}

export function fillMissingListingCopy(texts = {}, fallbackTexts = {}, context = {}) {
  const merged = Object.fromEntries(
    ["title", "description", "equipment", "location", "other"].map((field) => [
      field,
      clean(texts?.[field]) || clean(fallbackTexts?.[field]),
    ]),
  );
  return enforceListingCopy(merged, context);
}
