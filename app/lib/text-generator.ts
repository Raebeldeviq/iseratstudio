import type {
  HouseTemplate,
  ListingTexts,
  ProjectInput,
  ProviderSettings,
} from "../types";
import { enforceListingCopy, fillMissingListingCopy } from "../../listing-copy.mjs";
import {
  LIVING_HAUS_SERIES_ID,
  seriesFactSentences,
  technicalFactSentences,
  validateListingClaims,
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

function sentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function withoutConfiguredStreet(value: string, street: string): string {
  const configuredStreet = street.trim();
  if (!configuredStreet) return value;
  const escaped = configuredStreet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value.replace(new RegExp(escaped, "giu"), "").replace(/\s{2,}/g, " ").trim();
}

function joinParagraphs(values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join("\n\n");
}

function section(title: string, body: string): string {
  return `${title}\n${body}`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(value);
}

function providerName(provider: ProviderSettings): string {
  return `${provider.firstName} ${provider.lastName}`.trim();
}

function releasedEquipmentStatements(house: HouseTemplate, project: ProjectInput): string[] {
  const context = { house, project, houseSeries: LIVING_HAUS_SERIES_ID };
  return [
    ...technicalFactSentences(context),
    ...seriesFactSentences(context),
  ];
}

function appendReleasedEquipmentStatements(equipment: string, house: HouseTemplate, project: ProjectInput): string {
  const missingStatements = releasedEquipmentStatements(house, project)
    .filter((statement) => !equipment.includes(statement));
  return missingStatements.length
    ? joinParagraphs([equipment, ...missingStatements])
    : equipment;
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
): ListingTexts {
  const fallbackTexts = generateListingTexts(house, project, provider, version);
  const completed = fillMissingListingCopy(
    texts,
    fallbackTexts,
    { house, project, generated: true, allowGeneratedEquipment: true },
  ) as ListingTexts;
  const completedWithReleasedFacts = {
    ...completed,
    equipment: appendReleasedEquipmentStatements(completed.equipment, house, project),
  };
  const claimValidation = validateListingClaims({
    texts: completedWithReleasedFacts,
    house,
    project,
    houseSeries: LIVING_HAUS_SERIES_ID,
  });
  if (!claimValidation.blockingIssues.length) return completedWithReleasedFacts;

  // Nur automatische Erzeugung erreicht diesen Pfad. Der sichere
  // deterministische Fallback wird vor einer Speicherung erneut geprüft.
  return enforceListingCopy(fallbackTexts, {
    house,
    project,
    generated: true,
    allowGeneratedEquipment: true,
  }) as ListingTexts;
}

export function generateListingTexts(
  house: HouseTemplate,
  project: ProjectInput,
  provider: ProviderSettings,
  version = 1,
): ListingTexts {
  const seed = `${house.id}:${project.street}:${project.houseNumber}:${project.zip}:${version}`;
  const place = project.district.trim()
    ? `${project.city}-${project.district}`
    : project.city || "deinem Wunschort";
  const rooms = `${formatNumber(house.rooms)} Zimmer`;
  const livingArea = `${formatNumber(house.livingArea)} m² Wohnfläche`;
  const plotArea = project.plotArea
    ? `${formatNumber(project.plotArea)} m² großen Grundstück`
    : "ausgewählten Grundstück";

  const title = pick(
    [
      "Mehr Raum für euer Familienleben",
      `Dein neues Zuhause in ${place}`,
      "Großzügig wohnen und entspannt ankommen",
      "Zukunft beginnt im eigenen Zuhause",
      "Platz für Familie, Arbeit und Leben",
      "Wohnen mit Weitblick und Freiraum",
      house.floors <= 1
        ? "Ebenerdig ins neue Zuhause"
        : "Zwei Ebenen für neue Lebenspläne",
      `${formatNumber(house.livingArea)} m² für neue Lebenspläne`,
    ],
    seed,
    1,
  );

  const descriptionOpening = pick(
    [
      `Auf einem ca. ${plotArea} in ${place} ist dieses moderne ${house.houseType || "Einfamilienhaus"} von Living Haus vorgesehen. ${rooms} und rund ${livingArea} schaffen den passenden Raum für Familie, Gäste und Homeoffice.`,
      `Dieses projektierte ${house.houseType || "Haus"} von Living Haus bietet auf einem ca. ${plotArea} in ${place} ein modernes Zuhause mit ${rooms} und rund ${livingArea}.`,
      `Mit dem ${house.name} entsteht auf einem ca. ${plotArea} in ${place} ein durchdachtes Zuhause. Der Entwurf verbindet ${livingArea}, ${rooms} und eine klare Architektur zu einem stimmigen Gesamtkonzept.`,
      `Wer in ${place} den Schritt ins eigene Zuhause plant, findet mit dem ${house.name} eine überzeugende Grundlage: rund ${livingArea}, ${rooms} und ein ca. ${formatNumber(project.plotArea)} m² großes Grundstück.`,
    ],
    seed,
    2,
  );

  const architecture = "Die Raumaufteilung verbindet Gemeinschaftsbereiche mit gut nutzbaren privaten Rückzugsräumen.";

  const descriptionMiddle = pick(
    [
      `Auf ${house.floors || 2} Ebenen entstehen helle Wohnbereiche, kurze Wege und komfortable Rückzugsräume. Mit ${house.bedrooms || "mehreren"} Schlafzimmern und ${house.bathrooms || "komfortablen"} Badezimmern lässt sich der Alltag ebenso angenehm organisieren wie das Arbeiten von zu Hause.`,
      `Der Grundriss verteilt Wohnen, Kochen und Rückzug klar auf ${house.floors || 2} Etagen. ${house.bedrooms || "Mehrere"} Schlafzimmer und ${house.bathrooms || "großzügige"} Badezimmer sorgen dafür, dass das Haus auch langfristig flexibel nutzbar bleibt.`,
      `Großzügige Gemeinschaftsflächen treffen auf private Rückzugsorte. So unterstützt das Konzept mit ${house.bedrooms || "mehreren"} Schlafzimmern und ${house.bathrooms || "mehreren"} Badezimmern sowohl lebendige Familienmomente als auch Ruhe und Konzentration.`,
    ],
    seed,
    3,
  );

  const flexibility = pick(
    [
      "Der Grundriss kann innerhalb der technischen und baurechtlichen Möglichkeiten an deine Wünsche, deinen Alltag und deine Zukunftspläne angepasst werden.",
      "Raumaufteilung, Zimmergrößen und Ausstattungsdetails lassen sich im Rahmen der technischen und baurechtlichen Voraussetzungen individuell weiterentwickeln.",
      "Gemeinsam stimmen wir das Hauskonzept auf Grundstück, Budget und persönliche Vorstellungen ab – damit aus dem Entwurf dein Zuhause wird.",
    ],
    seed,
    4,
  );

  // Serien- und Standardpaketinformationen werden nicht zu Objektfakten
  // erhoben. Sie benötigen künftig einen eigenen Evidenzdatensatz.
  const standardBenefits = null;

  const descriptionClosing = pick(
    [
      `Living Haus begleitet dich von der ersten Beratung über die individuelle Planung bis zur Umsetzung deines neuen Zuhauses in ${place}.`,
      `Von der Planung bis zum Einzug bleibt das Projekt auf deine Wünsche ausgerichtet – für ein Zuhause in ${place}, das wirklich zu dir passt.`,
      `So wird aus einem Hausentwurf Schritt für Schritt dein persönliches Zuhause in ${place}.`,
    ],
    seed,
    6,
  );

  const contactName = providerName(provider);
  const descriptionContact = provider.phone.trim()
    ? section(
        "Persönliche Beratung vereinbaren",
        `Ruf ${contactName ? `${contactName} ` : "mich "}direkt unter ${provider.phone} an und lass dich persönlich zu Grundstück, Hausplanung, Ausstattung und Finanzierung beraten.`,
      )
    : "Gerne besprechen wir Grundstück, Hausplanung, Ausstattung und Finanzierung in einem persönlichen Beratungstermin.";

  const releasedTechnicalStatements = releasedEquipmentStatements(house, project);

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
    title,
    description: joinParagraphs([
      descriptionOpening,
      architecture,
      descriptionMiddle,
      flexibility,
      standardBenefits,
      descriptionClosing,
      descriptionContact,
      "Das Haus ist projektiert. Individuelle Anpassungen sind von den technischen, planerischen und baurechtlichen Voraussetzungen abhängig.",
    ]),
    equipment: joinParagraphs([
      section("Ausstattung und Planung", `Die Ausstattung des ${house.name} wird im weiteren Planungsprozess für das konkrete Angebot festgelegt.`),
      ...releasedTechnicalStatements,
      "Materialien, Oberflächen, Sanitärdetails und weitere Ausstattungsoptionen werden im Bemusterungsprozess abgestimmt. Visualisierungen und Grundrisse können beispielhafte Darstellungen enthalten. Verbindlich sind die für das konkrete Projekt vereinbarten Unterlagen.",
      "Welche Leistungen im konkreten Angebot enthalten sind, wird transparent in der individuellen Bau- und Leistungsbeschreibung festgehalten.",
    ]),
    location,
    other: joinParagraphs([
      "Das Angebot beschreibt ein projektiertes Haus. Maßgeblich für Preis, Umfang und Ausführung sind die individuellen Vereinbarungen und die Bau- und Leistungsbeschreibung.",
      "Hausabbildungen, Grundrisse und Innenansichten können beispielhafte Ausstattungen oder Möblierungen zeigen. Diese sind nicht automatisch Bestandteil des Angebots.",
      "Grundstücks- und projektbezogene Nebenkosten können hinzukommen und werden im Rahmen der individuellen Kalkulation erläutert.",
    ]),
  }, { house, project, generated: true, allowGeneratedEquipment: true }) as ListingTexts;
}
