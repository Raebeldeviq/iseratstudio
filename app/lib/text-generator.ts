import type {
  HouseTemplate,
  ListingTexts,
  ProjectInput,
  ProviderSettings,
} from "../types";
import { enforceListingCopy, fillMissingListingCopy } from "../../listing-copy.mjs";
import {
  LIVING_HAUS_SERIES_ID,
  releasedTechnicalFacts,
} from "../../listing-claim-policy.mjs";

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function pick<T>(items: T[], seed: string, offset = 0): T {
  return items[(hash(`${seed}:${offset}`) + offset) % items.length];
}

function joinParagraphs(values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join("\n\n");
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(value);
}

function customerFacingHouseName(value: string): string {
  return value
    .replace(/\b(?:V\d+|Tag|Nacht)\b/giu, " ")
    .replace(/\s{2,}/gu, " ")
    .trim();
}

function hasReleasedComfortVentilation(house: HouseTemplate): boolean {
  return releasedTechnicalFacts({
    house,
    listingFacts: house.listingFacts,
    houseSeries: LIVING_HAUS_SERIES_ID,
  }).some((fact) => fact.key === "ventilation" && fact.verified === true);
}

export function totalPrice(house: HouseTemplate, project: ProjectInput): number {
  return Math.max(0, house.housePrice + project.plotPrice + project.additionalCosts);
}

export function completeListingTexts(
  house: HouseTemplate,
  project: ProjectInput,
  provider: ProviderSettings,
  texts?: Partial<ListingTexts>,
  version = 1,
  titleSeed = "",
): ListingTexts {
  const resolvedTitleSeed = titleSeed || `${house.id}:${project.id}:${version}`;
  const fallbackTexts = generateListingTexts(house, project, provider, version, resolvedTitleSeed);
  const completed = fillMissingListingCopy(
    texts,
    fallbackTexts,
    {
      house,
      project,
      generated: true,
      houseSeries: LIVING_HAUS_SERIES_ID,
      listingFacts: house.listingFacts,
      titleSeed: resolvedTitleSeed,
    },
  ) as ListingTexts;
  // Claim validation is intentionally enforced at the final export boundary.
  // A text regeneration must never use a fallback that silently replaces an
  // existing title or one of the static fields. `hasOwnProperty` matters here:
  // an explicitly emptied manual field must remain empty and cause the normal
  // export validation to block, rather than being silently refilled.
  const preserveExplicit = (field: "title" | "equipment" | "other") => (
    texts && Object.prototype.hasOwnProperty.call(texts, field)
      ? String(texts[field] ?? "")
      : completed[field]
  );
  return {
    ...completed,
    title: preserveExplicit("title"),
    equipment: preserveExplicit("equipment"),
    other: preserveExplicit("other"),
  };
}

export function generateListingTexts(
  house: HouseTemplate,
  project: ProjectInput,
  _provider: ProviderSettings,
  version = 1,
  titleSeed = "",
): ListingTexts {
  const seed = `${house.id}:${project.street}:${project.houseNumber}:${project.zip}:${version}`;
  const place = project.district.trim() && project.city.trim()
    ? `${project.district.trim()} in ${project.city.trim()}`
    : project.district.trim()
      || project.city.trim()
      || "deinem Wunschort";
  const houseName = customerFacingHouseName(house.name);
  const houseType = house.houseType.trim() || "Einfamilienhaus";
  const houseReference = houseName ? `${houseName} als ${houseType}` : houseType;
  const rooms = house.rooms > 0 ? `${formatNumber(house.rooms)} Zimmer` : "mehreren gut nutzbaren Räumen";
  const livingArea = house.livingArea > 0 ? `rund ${formatNumber(house.livingArea)} m² Wohnfläche` : "viel Raum für den Alltag";
  const plotArea = project.plotArea > 0
    ? `ca. ${formatNumber(project.plotArea)} m² Grundstücksfläche`
    : "dem ausgewählten Grundstück";
  const bedroomSentence = house.bedrooms > 0
    ? `${formatNumber(house.bedrooms)} Schlafzimmer schaffen Platz für Familie und persönliche Rückzugsorte.`
    : "Die Räume lassen sich auf unterschiedliche Lebensphasen und Bedürfnisse ausrichten.";
  const bathroomSentence = house.bathrooms > 0
    ? house.bathrooms === 1
      ? "Ein Badezimmer unterstützt einen entspannten Start in den Tag."
      : `${formatNumber(house.bathrooms)} Badezimmer unterstützen einen entspannten Start in den Tag.`
    : "Die Aufteilung schafft klare Bereiche für gemeinsames Leben und private Momente.";
  const floorSentence = house.floors > 1
    ? `Auf ${formatNumber(house.floors)} Ebenen entstehen kurze Wege und eine klare Trennung zwischen gemeinsamer Zeit und Rückzug.`
    : "Auf einer Ebene verbindet die Raumaufteilung gemeinsames Leben mit gut nutzbaren privaten Bereichen.";
  const comfortVentilation = hasReleasedComfortVentilation(house)
    ? "Für diesen Entwurf ist eine Komfortlüftung mit Wärmerückgewinnung vorgesehen. Sie unterstützt den regelmäßigen Luftaustausch, ohne dass dafür dauerhaft Fenster geöffnet bleiben müssen. Als konkretes Ausstattungsmerkmal fügt sie sich in ein Hauskonzept ein, das sich an den Bedürfnissen des Alltags orientiert."
    : "Die Planung konzentriert sich auf Räume, die den Alltag flexibel und angenehm begleiten können. Sie geben Raum für persönliche Ideen, die mit der Zeit wachsen und das Zuhause unverwechselbar machen.";

  const descriptionOpening = pick(
    [
      `Dieses projektierte ${houseReference} in ${place} ist für Menschen gedacht, die sich ein Zuhause mit Raum für Nähe, Alltag und persönliche Ideen wünschen.`,
      `Ein Zuhause, das gemeinsames Leben und eigene Rückzugsorte zusammenbringt: Mit diesem projektierten ${houseReference} in ${place} entsteht ein stimmiger Rahmen für die nächste Lebensphase.`,
      `Wer in ${place} ein Haus sucht, das den Familienalltag ebenso aufnimmt wie ruhige persönliche Momente, findet mit diesem projektierten ${houseReference} eine überzeugende Grundlage.`,
    ],
    seed,
    2,
  );

  const livingParagraph = pick(
    [
      `Mit ${livingArea} und ${rooms} bietet der Grundriss die Basis für ein lebendiges Familienleben. Wohnen, Essen und Zusammensein können den Mittelpunkt bilden, während weitere Räume Platz für Kinder, Gäste oder konzentriertes Arbeiten von zu Hause eröffnen. ${bedroomSentence} ${bathroomSentence}`,
      `${livingArea} und ${rooms} geben dem Haus einen vielseitigen Rahmen. Der Grundriss kann gemeinsame Abende, den Familienalltag und persönliche Rückzugsorte miteinander verbinden. ${bedroomSentence} ${bathroomSentence}`,
      `Der Grundriss ist auf ein Zuhause mit vielen Facetten ausgerichtet: ${livingArea} und ${rooms} lassen Raum für gemeinsame Zeit, individuelle Wünsche und Veränderungen im Alltag. ${bedroomSentence} ${bathroomSentence}`,
    ],
    seed,
    3,
  );

  const plotParagraph = pick(
    [
      `Auch außerhalb des Hauses bleibt Platz für eigene Vorstellungen: ${plotArea} schaffen eine Grundlage, um das Zuhause und seinen Außenbereich passend zum Leben in ${place} zu denken.`,
      `Das Angebot verbindet Haus und ${plotArea}. So entsteht eine solide Basis, um Wohnen und Außenbereich auf die persönlichen Wünsche in ${place} abzustimmen.`,
      `Mit ${plotArea} erhält das Hauskonzept einen passenden äußeren Rahmen. Hier kann ein Zuhause wachsen, das den Alltag in ${place} aufnimmt und Raum für neue Gewohnheiten lässt.`,
    ],
    seed,
    4,
  );

  const outlook = pick(
    [
      `${floorSentence} So entsteht ein Zuhause, das den Familienalltag ebenso selbstverständlich begleitet wie ruhige Momente für dich selbst. Dabei bietet der Entwurf Raum für vertraute Abläufe, spontane Begegnungen und die kleinen Momente, die aus vier Wänden einen persönlichen Lebensmittelpunkt machen.`,
      `${floorSentence} Das schafft einen stimmigen Rahmen für gemeinsame Erinnerungen und die kleinen Rituale, die ein Zuhause persönlich machen. Dabei bleibt Platz für vertraute Abläufe, spontane Begegnungen und die kleinen Momente, die aus vier Wänden einen persönlichen Lebensmittelpunkt machen.`,
      `${floorSentence} So findet der Alltag seinen Platz, ohne dass gemeinsame Zeit und persönliche Rückzugsmöglichkeiten zu kurz kommen. Dabei entsteht Raum für vertraute Abläufe, spontane Begegnungen und die kleinen Momente, die aus vier Wänden einen persönlichen Lebensmittelpunkt machen.`,
    ],
    seed,
    5,
  );

  const locationOpening = pick(
    [
      `Das geplante Zuhause befindet sich in ${place}. Der Standort bildet den passenden Rahmen für einen neuen Lebensmittelpunkt und verbindet das Grundstück mit den Wegen des täglichen Lebens.`,
      `Das Grundstück liegt in ${place}. Hier treffen der Wunsch nach einem eigenen Zuhause und die Anforderungen an Alltag, Familie und Freizeit aufeinander.`,
      `${place} bildet den Standort für dieses Hausprojekt und schafft eine gute Ausgangsbasis für die individuelle Planung des neuen Zuhauses.`,
    ],
    seed,
    7,
  );

  const locationClosing = pick(
    [
      `Insgesamt bietet ${place} eine interessante Grundlage für alle, die ihren Lebensmittelpunkt passend zu Familie, Beruf und Freizeit gestalten möchten.`,
      `Damit verbindet der Standort in ${place} das geplante Eigenheim mit den persönlichen Anforderungen an den neuen Wohnort.`,
      `So entsteht in ${place} ein Hausprojekt, bei dem Grundstück, Alltag und Zukunftsplanung sinnvoll zusammengedacht werden können.`,
    ],
    seed,
    8,
  );

  const location = joinParagraphs([
    locationOpening,
    `Das Grundstück befindet sich in ${place}. Konkrete Aussagen zu Versorgung, Bildung, Freizeit und Verkehr werden ausschließlich aus geprüften Ortsinformationen ergänzt.`,
    locationClosing,
  ].flat());

  return enforceListingCopy({
    // The dedicated headline planner owns title rotation and its evidence
    // checks. An empty value asks enforceListingCopy to initialize that plan.
    title: "",
    description: joinParagraphs([
      descriptionOpening,
      livingParagraph,
      plotParagraph,
      comfortVentilation,
      outlook,
    ]),
    // Statische Felder bleiben bewusst leer: enforceListingCopy initialisiert
    // sie ausschließlich für neue Inserate mit dem zentralen Mastertext.
    equipment: "",
    location,
    other: "",
  }, {
    house,
    project,
    generated: true,
    houseSeries: LIVING_HAUS_SERIES_ID,
    listingFacts: house.listingFacts,
    titleSeed: titleSeed || seed,
  }) as ListingTexts;
}
