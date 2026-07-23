import type {
  HouseTemplate,
  ListingTexts,
  ProjectInput,
  ProviderSettings,
} from "../types";
import { enforceListingCopy, fillMissingListingCopy } from "../../listing-copy.mjs";

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
  return fillMissingListingCopy(
    texts,
    fallbackTexts,
    { house, project },
  ) as ListingTexts;
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
  const standardPackage = house.useStandardPackage !== false;

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

  const architecture = house.architecture.trim()
    ? sentence(house.architecture)
    : "Die klare Architektur schafft helle Gemeinschaftsbereiche und gut nutzbare private Rückzugsräume.";

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

  const standardBenefits = standardPackage
    ? joinParagraphs([
        section(
          pick(["Deine Vorteile mit Living Haus", "Rundum gut begleitet mit Living Haus"], seed, 5),
          "",
        ).trim(),
        section(
          "Individuell geplante Traumküche",
          "Die Küche wird passend zum Grundriss geplant. Moderne Küchentechnik, funktionale Arbeitsbereiche und clevere Stauraumlösungen verbinden Design und Alltagstauglichkeit.",
        ),
        section(
          "Digitales Living Haus Bau-Cockpit",
          "Termine, Unterlagen und wichtige Informationen zum Bauprojekt sind jederzeit übersichtlich verfügbar. Auch die Abstimmung mit den Ansprechpartnern erfolgt einfach und transparent.",
        ),
        section(
          "Energieeffizientes I-KON-Konzept",
          "Das Konzept verbindet eine moderne Gebäudehülle mit zeitgemäßer Haustechnik, Photovoltaikanlage und Batteriespeicher. Das Haus ist als Effizienzhaus 40 QNG konzipiert und auf einen niedrigen Energieverbrauch ausgerichtet.",
        ),
        section(
          "Finanzierung individuell abgestimmt",
          "Das Zuhause-Darlehen eröffnet interessante Finanzierungsmöglichkeiten. Gemeinsam wird geprüft, welche Konditionen und Fördermöglichkeiten zur persönlichen Situation und zum Bauvorhaben passen.",
        ),
        section(
          "Hochwertiges Zuhause-Paket",
          "Aufeinander abgestimmte Bodenbeläge, Innentüren und Sanitärelemente bilden eine hochwertige Grundlage für die Gestaltung der neuen Wohnräume.",
        ),
        section(
          "Professionelles DIY-Ausbau-Coaching",
          "Im dreitägigen Ausbau-Coaching zeigen erfahrene Profis praxisnah, wie ausgewählte Innenausbauarbeiten fachgerecht umgesetzt werden. So kannst du dein Zuhause aktiv mitgestalten und das Budget gezielt entlasten.",
        ),
      ])
    : null;

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

  const configuredEquipment = house.equipmentHighlights.trim()
    ? section("Individuelle Ausstattungsmerkmale", sentence(house.equipmentHighlights))
    : "Materialien, Oberflächen und Ausstattungsdetails werden im Rahmen der Bemusterung gemeinsam ausgewählt.";

  const energyParagraph = house.energyDemand
    ? `Für das Projekt ist ein Endenergiebedarf von ${formatNumber(house.energyDemand)} kWh/(m²·a) bei der Energieeffizienzklasse ${house.energyClass || "gemäß Planung"} vorgesehen. Als Wärmeversorgung ist ${house.heatingType || "eine moderne Heiztechnik"}${house.energySource ? ` auf Basis von ${house.energySource}` : ""} geplant. Die endgültigen Werte ergeben sich aus der konkreten Planung und dem Energieausweis.`
    : "Die moderne, auf das Gebäude abgestimmte Haustechnik unterstützt einen energieeffizienten und komfortablen Betrieb. Die endgültigen Energiewerte ergeben sich aus der konkreten Planung und dem Energieausweis.";

  const standardEquipment = standardPackage
    ? joinParagraphs([
        section(
          "Planungssicherheit von Anfang an",
          "Ab dem Tag der Auftragsbestätigung gilt eine 18-monatige Festpreisgarantie. Damit bleibt der vereinbarte Hauspreis in diesem Zeitraum planbar; sinken die maßgeblichen Baupreise, wird der Preis entsprechend angepasst.",
        ),
        "Wichtige Bauversicherungen sind bereits berücksichtigt. Dazu gehören unter anderem Bauherrenhaftpflicht-, Bauleistungs-, Wohngebäude- und Bauhelfer-Unfallversicherung sowie ein Bauträgerfinanzierungsschutz.",
        section(
          "Finanzierung und digitale Projektsteuerung",
          "Das Zuhause-Darlehen bietet – abhängig von den jeweiligen Voraussetzungen – Finanzierungsmöglichkeiten von bis zu 250.000 Euro zu attraktiven Konditionen. Über das Living Haus Bau-Cockpit bleiben Termine, Dokumente und die Kommunikation mit den Ansprechpartnern übersichtlich gebündelt.",
        ),
        section(
          "Nachhaltige und geprüfte Bauqualität",
          "Zur qualitätsorientierten Bauweise gehören die DGNB-Serienzertifizierung in Gold, die QDF-Zertifizierung und eine digitale Hausbauakte. Auf die Grundkonstruktion des Hauses gelten 30 Jahre Garantie; für die weiteren Bauleistungen gilt eine Gewährleistung von fünf Jahren.",
        ),
        section(
          "Moderne und energieeffiziente Haustechnik",
          "Wärmepumpentechnik, Komfortlüftung mit Wärmerückgewinnung sowie die I-KON-Lösung mit Photovoltaikanlage und Batteriespeicher unterstützen ein angenehmes Raumklima und die eigene Stromerzeugung.",
        ),
        section(
          "Hochwertiges Zuhause-Paket",
          "Das Zuhause-Paket umfasst unter anderem hochwertige Bodenbeläge, moderne Innentüren, bodengleiche Duschen mit Echtglasabtrennung, Fliesen im gesamten Erdgeschoss und eine stilvolle Sanitärausstattung. Aluminiumgeschäumte Rollläden unterstützen den sommerlichen Hitzeschutz und die Wärmedämmung im Winter.",
        ),
        section(
          "Planung und Baustelleneinrichtung",
          "Enthalten sind zwei Tage persönliche Ausstattungsberatung in der Haus-Statterei, die Bauantragsplanung durch erfahrene Architekten und ein Bodengutachten. Auch die Organisation von Abfallcontainer, Baustellen-WC, Montagekran und Gerüst ist vorgesehen.",
        ),
        section(
          "Kosten sparen durch Eigenleistung",
          "Das professionelle DIY-Ausbau-Coaching bereitet dich praxisnah auf ausgewählte Arbeiten im Innenausbau vor. So kannst du Eigenleistungen gezielt einbringen und dein persönliches „Wie ich es will“-Fertighaus gestalten.",
        ),
      ])
    : null;

  const locationFacts = [
    sentence(withoutConfiguredStreet(project.locationFacts, project.street)),
    sentence(withoutConfiguredStreet(project.familyFacts, project.street)),
    sentence(withoutConfiguredStreet(project.natureFacts, project.street)),
    sentence(withoutConfiguredStreet(project.transportFacts, project.street)),
  ].filter(Boolean);

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
    locationFacts.length
      ? locationFacts
      : `${place} bietet den Rahmen für ein individuell geplantes Zuhause. Versorgung, Bildung, Arbeitswege und Freizeit lassen sich im persönlichen Beratungsgespräch passend zum eigenen Alltag betrachten.`,
    locationClosing,
    "Die konkrete Bebaubarkeit und Positionierung des Hauses werden im weiteren Planungsverlauf mit den Grundstücksgegebenheiten und den öffentlich-rechtlichen Vorgaben abgestimmt.",
  ].flat());

  const priceNote = project.plotPrice > 0
    ? standardPackage
      ? "Das im Angebotspreis berücksichtigte Grundstück wird einem Living-Haus-Bauherren ohne zusätzliche Käuferprovision zur Verfügung gestellt."
      : "Der konfigurierte Angebotspreis berücksichtigt den eingetragenen Haus- und Grundstückspreis."
    : null;

  const additionalCosts = project.additionalCosts
    ? `In der Kalkulation wurden ${formatNumber(project.additionalCosts)} Euro als konfigurierte Nebenkosten berücksichtigt. Weitere grundstücks- oder projektabhängige Kosten können hinzukommen und werden vor Vertragsabschluss transparent ermittelt.`
    : "Weitere grundstücks- oder projektabhängige Baunebenkosten können hinzukommen. Bei der individuellen Kalkulation unterstützen wir dich gerne.";

  const funding = standardPackage
    ? "Wir bieten passende Finanzierungslösungen an und unterstützen auch bei der Beantragung möglicher Fördermittel."
    : null;

  const imageDisclaimer = "Die dargestellten Haus- und Inneneinrichtungsbilder sowie Grundrisse können beispielhaft sein und Sonderausstattungen, Möblierungen oder Außenanlagen zeigen, die nicht im angegebenen Kaufpreis enthalten sind. Maßgeblich sind die individuell vereinbarte Bau- und Leistungsbeschreibung und die abschließende Planung.";

  const otherContact = provider.phone.trim()
    ? `Haben wir dein Interesse geweckt? Dann vereinbare einen kostenlosen Beratungstermin${contactName ? ` mit ${contactName}` : ""} unter ${provider.phone}.`
    : "Haben wir dein Interesse geweckt? Dann vereinbare einen kostenlosen persönlichen Beratungstermin.";

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
      section(
        "Umfangreiche Ausstattung und Planungssicherheit",
        `Das ${house.name} verbindet eine durchdachte Ausstattung, moderne Energielösungen und persönliche Gestaltungsmöglichkeiten.`,
      ),
      configuredEquipment,
      energyParagraph,
      standardEquipment,
      "Welche Leistungen im konkreten Angebot enthalten sind, wird transparent in der individuellen Bau- und Leistungsbeschreibung festgehalten.",
    ]),
    location,
    other: joinParagraphs([
      priceNote,
      additionalCosts,
      funding,
      imageDisclaimer,
      project.notes.trim() ? sentence(withoutConfiguredStreet(project.notes, project.street)) : null,
      "Gute Beratung ist entscheidend für den Erfolg. Gemeinsam analysieren wir Vorstellungen, Wünsche und Bedürfnisse, damit Haus, Grundstück und Finanzierung zueinander passen.",
      otherContact,
    ]),
  }, { house, project }) as ListingTexts;
}
