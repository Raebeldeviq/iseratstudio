import {
  qngGuaranteeSentence,
  releasedTitleUsps,
  TITLE_USP_ID,
} from "./listing-claim-policy.mjs";

const DESCRIPTION_CTA_START =
  "Ruf direkt an und vereinbare deine persönliche Beratung zu Hausplanung und Grundstück:";

export const FIXED_DESCRIPTION_CTA = `Ruf direkt an und vereinbare deine persönliche Beratung zu Hausplanung und Grundstück: +49 160 930 87 202.
Gemeinsam besprechen wir den aktuellen Planungsstand, mögliche Ausstattungsoptionen und die nächsten Schritte.`;

export const FIXED_EQUIPMENT_TEXT = `Die konkrete Ausstattung wird für dieses Hausprojekt in der individuellen Bau- und Leistungsbeschreibung dokumentiert. Sie bildet zusammen mit der Planung und den vertraglichen Vereinbarungen die maßgebliche Grundlage für Umfang, Ausführung und enthaltene Leistungen.

Materialien, Oberflächen, Sanitärausstattung, Küchenplanung und weitere Details werden im Bemusterungs- und Planungsprozess abgestimmt. Abweichungen zwischen Visualisierungen, Grundrissen und der späteren Ausführung sind möglich; verbindlich sind ausschließlich die für das konkrete Projekt vereinbarten Unterlagen.

Technische Anlagen oder energetische Kennwerte werden in diesem Inserat nur genannt, wenn sie für das konkrete Angebot strukturiert belegt und für die jeweilige Aussage freigegeben sind. Bei projektierten Merkmalen bleibt der Planungsstatus ausdrücklich erkennbar.`;

export const FIXED_OTHER_TEXT = `Das angebotene Grundstück und die Hausplanung bilden die Grundlage dieses projektierten Angebots. Maßgeblich für Preis, Leistungsumfang und Zustandekommen eines Vertrags sind die individuellen Vereinbarungen.

Zusätzliche Baunebenkosten sowie grundstücks- und projektbezogene Positionen können hinzukommen. Diese werden im persönlichen Gespräch und in der individuellen Kalkulation erläutert.

Die Hausabbildungen, Grundrisse und Bilder der Inneneinrichtung können beispielhafte Ausstattungen, Möblierungen oder Extras zeigen, die nicht im angegebenen Kaufpreis enthalten sind.

Gerne besprechen wir Ihre Vorstellungen, die Grundstückssituation und die nächsten Schritte in einem persönlichen Beratungstermin.`;

export const FACTUAL_BUILDABILITY_NOTE =
  "Die konkrete Bebaubarkeit und Positionierung des Hauses werden im weiteren Planungsverlauf anhand der Grundstücksgegebenheiten und der öffentlich-rechtlichen Vorgaben geprüft und abgestimmt.";

export const FIXED_PROVISION_TEXT =
  "Das Grundstück wird über einen Drittanbieter provisionspflichtig verkauft.";

export const FIXED_ANNOTATION_TEXT =
  "Die von uns gemachten Informationenbezüglich des Grundstückes beruhen auf Angaben des Verkäufers bzw. der Verkäuferin. Für die Richtigkeit und Vollständigkeit der Angaben kann keine Gewähr bzw. Haftung übernommen werden. Ein Zwischenverkauf und Irrtümer sind vorbehalten.";

export const FIXED_TERMS_TEXT =
  "Wir weisen auf unsere Allgemeinen Geschäftsbedingungen hin. Durch weitere Inanspruchnahme unserer Leistungen erklären Sie die Kenntnis und Ihr Einverständnis.";

export const FIXED_RECOMMENDATION_TEXT = `Das hier angebotene Grundstück ist im obigen Preis eingerechnet.
Zusätzliche Baunebenkosten müssen noch hinzugerechnet werden, hierüber beraten wir gern.
Für Dich bieten wir gemeinsam mit unserem strategischen Partner HEUN-Finanz auch interessante Finanzierungsmöglichkeiten inklusive Beantragung aller Fördermittel!

Die Hausabbildungen und die Bilder der Inneneinrichtung zeigen möglicherweise Extras, die nicht im angegebenen Kaufpreis inbegriffen sind.

Gute Beratung ist der Anfang von Allem. Deshalb analysieren wir gemeinsam mit euch eure Vorstellungen, Wünsche und Bedürfnisse und finden so das für Dich und Deine Familie passende Living Haus.
Interessiert? Kontaktiere mich und vereinbare noch heute einen kostenlosen und unverbindlichen Beratungstermin.`;

export const IMMOPROFESSIONAL_DEFAULTS = Object.freeze({
  equipmentQuality: "GEHOBEN",
  constructionPhase: "PROJEKTIERT",
  attic: true,
  guestWc: true,
  gardenUse: true,
  underfloorHeating: false,
  electricFuel: false,
  airSourceHeatPump: false,
  kfw40: false,
  kfw55: false,
  energyClass: "",
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
    equipmentQuality: choice("equipmentQuality"),
    constructionPhase: choice("constructionPhase"),
    attic: flag("attic"),
    guestWc: flag("guestWc"),
    gardenUse: flag("gardenUse"),
    underfloorHeating: flag("underfloorHeating"),
    electricFuel: flag("electricFuel"),
    airSourceHeatPump: flag("airSourceHeatPump"),
    kfw40: flag("kfw40"),
    kfw55: flag("kfw55"),
    energyClass: choice("energyClass"),
    commissionRequired: flag("commissionRequired"),
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
    .filter((paragraph) => paragraph && !/(?:\+49\s*160\s*930\s*87\s*202|kostenlosen?\s+(?:und\s+unverbindlichen\s+)?Beratungstermin|Ruf\s+(?:mich\s+)?direkt)/iu.test(paragraph))
    .join("\n\n")
    .trim();
}

function appendQngGuarantee(description, house, project, context) {
  const sentence = qngGuaranteeSentence(listingFactContext(house, project, context));
  if (!sentence || description.includes(sentence)) return description;
  return description ? `${description}\n\n${sentence}` : sentence;
}

export function enforceListingCopy(texts = {}, {
  house = {},
  project = {},
  generated = false,
  allowGeneratedEquipment = false,
  houseSeries = "",
  listingFacts = [],
  facts = [],
  titleSeed = "",
} = {}) {
  const suppliedDescription = clean(texts.description);
  const body = descriptionBody(suppliedDescription);
  const context = { houseSeries, listingFacts, facts, titleSeed };
  const descriptionWithQngGuarantee = appendQngGuarantee(body, house, project, context);
  const generatedDescription = descriptionWithQngGuarantee
    ? `${descriptionWithQngGuarantee}\n\n${FIXED_DESCRIPTION_CTA}`
    : FIXED_DESCRIPTION_CTA;
  return {
    title: generated ? buildListingHeadline(house, project, context) : clean(texts.title) || buildListingHeadline(house, project, context),
    description: generated
      ? generatedDescription
      : suppliedDescription || FIXED_DESCRIPTION_CTA,
    equipment: generated && allowGeneratedEquipment && clean(texts.equipment)
      ? clean(texts.equipment)
      : generated
        ? FIXED_EQUIPMENT_TEXT
        : clean(texts.equipment) || FIXED_EQUIPMENT_TEXT,
    location: generated ? cleanSalesLocationText(texts.location) : clean(texts.location),
    other: generated ? FIXED_OTHER_TEXT : clean(texts.other) || FIXED_OTHER_TEXT,
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
