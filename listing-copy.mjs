import {
  releasedTitleUsps,
  TITLE_USP_ID,
} from "./listing-claim-policy.mjs";

const DESCRIPTION_CTA_START =
  "Du möchtest wissen, ob dieses Haus zu deinen Vorstellungen und deinem Budget passt?";

export const FIXED_DESCRIPTION_CTA = `Du möchtest wissen, ob dieses Haus zu deinen Vorstellungen und deinem Budget passt? Ruf mich direkt unter +49 160 930 87 202 an oder buche dir bequem einen persönlichen Telefontermin:
https://calendly.com/pascal-froehlich-livinghaus/erstinfo-via-telefon

Denn am Ende entscheidet nicht nur das Haus – sondern auch, mit wem du es baust.`;

/**
 * Zentral versionierte Inseratstandards. Die Texte sind keine Generatorausgabe:
 * Neue Inserate erhalten sie einmalig, bestehende manuelle Werte werden nur
 * durch eine bewusste feldweise Rücksetzung ersetzt.
 */
export const STATIC_COPY_VERSION = 1;

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

export const FIXED_EQUIPMENT_TEXT = `Bei Living Haus erlebst du Hausbau auf einem neuen Level – einfach, transparent und umfassend begleitet. Viele Leistungen, die du für dein Bauvorhaben benötigst, sind bereits im Leistungsumfang enthalten: von der Bodenplatte und einem umfangreichen Versicherungspaket über Architektur- und Planungsleistungen bis hin zu Grundstücks- und Finanzierungsservice. Hinzu kommt die 18-monatige Festpreisgarantie von Living Haus, die dir zusätzliche Planungssicherheit gibt.

Ein wichtiger Bestandteil deines Living Hauses ist das I-KON-Konzept. Dabei werden verschiedene Komponenten der Haus- und Energietechnik aufeinander abgestimmt: Photovoltaikanlage, Batteriespeicher, Wärmepumpentechnik, Komfortlüftung mit Wärmerückgewinnung und eine entsprechend ausgelegte Gebäudehülle. So entsteht ein abgestimmtes technisches Gesamtkonzept, das die Nutzung selbst erzeugter Energie unterstützt und den Energiebedarf des Hauses berücksichtigt.

Auch im Inneren wird dein Zuhause von Anfang an ganzheitlich geplant. Bei den entsprechend angebotenen Hauskonfigurationen ist die Einbauküche bereits im ausgewiesenen Preis enthalten und wird direkt in die Planung einbezogen. Dadurch werden Haus, Technik und Ausstattung frühzeitig aufeinander abgestimmt.

Wie viel du beim Innenausbau selbst übernehmen möchtest, entscheidest du. Mit dem Zuhause-Paket erhältst du die dafür vorgesehenen Ausbau-Materialien passend zu deinem Haus. Professionelle Ausbau-Coachings und digitale Tutorials unterstützen dich Schritt für Schritt bei der Umsetzung. Alternativ kannst du einen höheren Fertigstellungsgrad wählen und einen größeren Teil der Arbeiten ausführen lassen.

Über die Bau-Cockpit-App kannst du Termine, Baufortschritt und relevante Dokumente zentral verfolgen.

Ein weiterer Bestandteil des Living-Haus-Konzepts ist die DGNB-Zertifizierung. Living Häuser ab der Ausbaustufe Ausbauhaus-Plus können unter Berücksichtigung der vorgesehenen Planungs-, Ausbau- und Bemusterungsanforderungen den DGNB-Gold-Standard erreichen. Dabei bewertet das DGNB-System unter anderem ökologische, ökonomische, soziokulturelle, technische und prozessuale Qualitätskriterien des Gebäudes.

Und während des gesamten Weges begleite ich dich persönlich: Ich, Pascal Fröhlich, bin dein Living Haus Berater für Berlin-Brandenburg. Von der ersten Idee über Grundstück, Finanzierung und Planung bis in die Bauphase hast du einen festen Ansprechpartner, der die einzelnen Schritte mit dir koordiniert und transparent bespricht.

Living Haus verbindet planbaren Hausbau, moderne Haustechnik, individuelle Gestaltungsmöglichkeiten und persönliche Betreuung.

👉 Ruf mich direkt an und vereinbare deine persönliche Beratung: +49 160 930 87 202.`;

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

export const FIXED_RECOMMENDATION_TEXT = `Für Sie bieten wir zusammen mit unserem strategischen Partner HEUN-Finanz auch attraktive Finanzierungsoptionen, einschließlich der Antragstellung für alle Förderungen!

Die Hausillustrationen und die Bilder der Innenausstattung können Extras zeigen, die nicht im angegebenen Kaufpreis enthalten sind.

Gute Beratung ist der Anfang von allem. Deshalb analysieren wir gemeinsam mit Ihnen Ihre Ideen, Wünsche und Bedürfnisse und finden das passende Living Haus für Sie und Ihre Familie.
Interessiert? Kontaktieren Sie mich und vereinbaren Sie noch heute ein kostenloses und unverbindliches Beratungsgespräch.`;

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
  equipment: Object.freeze([PREVIOUS_STATIC_COPY.equipment]),
  other: Object.freeze([PREVIOUS_STATIC_COPY.other, PRE_PHASE2B_LEGACY_OTHER_TEXT]),
  provision: Object.freeze([PREVIOUS_STATIC_COPY.provision]),
  annotation: Object.freeze([PREVIOUS_STATIC_COPY.annotation]),
  terms: Object.freeze([PREVIOUS_STATIC_COPY.terms]),
  recommendation: Object.freeze([PREVIOUS_STATIC_COPY.recommendation]),
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
 * are deliberately treated as manual so an application start or export can
 * never replace an unclassified existing value.
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
  const sources = Object.fromEntries(STATIC_COPY_FIELDS.map((field) => [field, sourceFor(field, values[field])]));
  return {
    values: Object.fromEntries(STATIC_COPY_FIELDS.map((field) => [
      field,
      sources[field] === STATIC_COPY_SOURCE.MANUAL
        ? values[field]
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
  kfw55: true,
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
  "Sicher wohnen",
  "Entspannt wohnen",
  "Endlich ankommen",
  "Hier zuhause sein",
  "Mehr Raum fürs Leben",
  "Platz fürs Familienleben",
  "Zuhause beginnt hier",
  "Euer neues Zuhause",
  "Zeit für die eigenen vier Wände",
  "Wohnen, wie es zu euch passt",
]);

const TITLE_USP_PAIR_PREFERENCES = Object.freeze([
  Object.freeze({ ids: [TITLE_USP_ID.QNG_GUARANTEE, TITLE_USP_ID.DGNB_SERIES_CERTIFICATION], weight: 5 }),
  Object.freeze({ ids: [TITLE_USP_ID.QNG_GUARANTEE, TITLE_USP_ID.IKON_TECHNICAL_PACKAGE], weight: 3 }),
  Object.freeze({ ids: [TITLE_USP_ID.DGNB_SERIES_CERTIFICATION, TITLE_USP_ID.IKON_TECHNICAL_PACKAGE], weight: 2 }),
]);

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

const LOCATION_PLANNING_PHRASE = /(?:Bebaubarkeit|Positionierung\s+(?:des\s+Hauses\s+)?(?:wird|werden)|im\s+weiteren\s+(?:Planungs)?verlauf|im\s+(?:persönlichen\s+)?Beratungsgespräch\s+(?:betrachtet|abgestimmt)|später\s+abgestimmt)/iu;

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
  return clean(project.district) || clean(project.city) || "deinem Wunschort";
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

function pickWeightedPair(pairs, seed) {
  const weight = pairs.reduce((sum, pair) => sum + pair.weight, 0);
  if (!weight) return undefined;
  let position = hash(`${seed}:usp-pair`) % weight;
  for (const pair of pairs) {
    if (position < pair.weight) return pair;
    position -= pair.weight;
  }
  return pairs.at(-1);
}

function selectTitleUsps(context, seed) {
  const available = releasedTitleUsps(context);
  const byId = new Map(available.map((usp) => [usp.id, usp]));
  const selectablePairs = TITLE_USP_PAIR_PREFERENCES
    .filter((pair) => pair.ids.every((id) => byId.has(id)));
  const selectedPair = pickWeightedPair(selectablePairs, seed);
  if (selectedPair) return selectedPair.ids.map((id) => byId.get(id));
  return available.slice().sort((left, right) => left.priority - right.priority).slice(0, 2);
}

function titleFrom(opening, house, project, usps) {
  const area = germanNumber(Math.round(finiteNumber(house.livingArea)));
  const rooms = germanNumber(house.rooms, 1);
  const base = `${opening} in ${listingPlace(project)}: ${area} m², ${rooms} Zimmer`;
  return usps.length ? `${base} – ${usps.map((usp) => usp.label).join(" & ")}` : base;
}

/**
 * Selects a stable, evidence-backed two-USP title. `titleSeed` is optional
 * but lets rotations keep their variation stable per generated version.
 */
export function planListingHeadline(house = {}, project = {}, context = {}) {
  const factContext = listingFactContext(house, project, context);
  const seed = headlineSeed(house, project, context);
  const usps = selectTitleUsps(factContext, seed);
  const opening = HEADLINE_OPENINGS[hash(`${seed}:opening`) % HEADLINE_OPENINGS.length];
  let selectedOpening = opening;
  let selectedUsps = usps;
  let title = titleFrom(selectedOpening, house, project, selectedUsps);

  if (title.length < LISTING_TITLE_MIN_LENGTH) {
    const longerOpenings = HEADLINE_OPENINGS
      .filter((candidate) => titleFrom(candidate, house, project, selectedUsps).length >= LISTING_TITLE_MIN_LENGTH)
      .sort((left, right) => left.length - right.length || left.localeCompare(right, "de-DE"));
    if (longerOpenings.length) {
      selectedOpening = longerOpenings[hash(`${seed}:long-opening`) % longerOpenings.length];
      title = titleFrom(selectedOpening, house, project, selectedUsps);
    }
  }
  if (title.length > LISTING_TITLE_MAX_LENGTH) {
    const shorterOpenings = HEADLINE_OPENINGS
      .filter((candidate) => candidate.length < selectedOpening.length)
      .sort((left, right) => left.length - right.length || left.localeCompare(right, "de-DE"));
    if (shorterOpenings.length) {
      selectedOpening = shorterOpenings[hash(`${seed}:short-opening`) % shorterOpenings.length];
      title = titleFrom(selectedOpening, house, project, selectedUsps);
    }
  }
  if (title.length > LISTING_TITLE_MAX_LENGTH && selectedUsps.length === 2) {
    selectedUsps = selectedUsps.slice(0, 1);
    title = titleFrom(selectedOpening, house, project, selectedUsps);
  }

  return {
    title,
    opening: selectedOpening,
    usps: selectedUsps,
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
  const fixedCtaIndex = body.indexOf(DESCRIPTION_CTA_START);
  if (fixedCtaIndex >= 0) body = body.slice(0, fixedCtaIndex).trim();
  return body
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph && !/(?:\+49\s*160\s*930\s*87\s*202|calendly\.com\/pascal-froehlich-livinghaus|kostenlosen?\s+(?:und\s+unverbindlichen\s+)?Beratungstermin|Ruf\s+(?:mich\s+)?direkt|Du möchtest wissen, ob dieses Haus)/iu.test(paragraph))
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
    ? `${body}\n\n${FIXED_DESCRIPTION_CTA}`
    : FIXED_DESCRIPTION_CTA;
  return {
    // A title is initialized for a new listing but is never replaced merely
    // because an AI call, app start or export passes through this helper.
    title: clean(texts.title) || buildListingHeadline(house, project, context),
    description: generated
      ? generatedDescription
      : suppliedDescription || FIXED_DESCRIPTION_CTA,
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
