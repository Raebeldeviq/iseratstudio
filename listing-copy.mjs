const DESCRIPTION_CTA_START =
  "Ruf direkt an und sichere dir deine professionelle und transparente Beratung für energieeffizientes Bauen:";

function clean(value) {
  return String(value ?? "").trim();
}

function providerName(provider = {}) {
  return `${clean(provider.firstName)} ${clean(provider.lastName)}`.trim();
}

function providerPhone(provider = {}) {
  return clean(provider.phone);
}

function advisorSentence(provider = {}) {
  const name = providerName(provider);
  return name
    ? `Ich, ${name}, begleite dich persönlich von der ersten Idee bis zum Einzug.`
    : "Dein persönlicher Berater begleitet dich von der ersten Idee bis zum Einzug.";
}

function contactSentence(provider = {}) {
  const phone = providerPhone(provider);
  return phone
    ? `Ruf direkt an und sichere dir deine professionelle und transparente Beratung für energieeffizientes Bauen: ${phone}.`
    : "Vereinbare jetzt deine professionelle und transparente Beratung für energieeffizientes Bauen.";
}

export function fixedDescriptionCta(provider = {}) {
  return `${contactSentence(provider)}
Nur mit dem richtigen Partner macht Bauen richtig Spaß und führt zum gewünschten Ergebnis.`;
}

export function fixedEquipmentText(provider = {}) {
  return `Bei Living Haus erlebst du Hausbau auf einem neuen Level – transparent, planbar und rundum begleitet. Du erhältst die wesentlichen Bausteine für dein Bauvorhaben aus einer Hand: von der Bodenplatte und den Bauherren-Versicherungen über Architektur- und Planungsleistungen bis zum Grundstücks- und Finanzierungsservice. Welche Leistungen im konkreten Angebot enthalten sind, wird verbindlich in der individuellen Bau- und Leistungsbeschreibung festgehalten.

Das I-KON-Prinzip verbindet Energieeffizienz, Komfort und moderne Technik. Photovoltaikanlage, Batteriespeicher, Wärmepumpenheizung mit Komfortlüftung und Wärmerückgewinnung sowie eine leistungsfähige Gebäudehülle werden passend zur konkreten Planung abgestimmt. Das unterstützt niedrige Energiekosten, ein angenehmes Wohnklima und eine zukunftsfähige technische Ausstattung.

Auch im Inneren wird dein Zuhause auf deinen Alltag abgestimmt. Die Küche wird passend zum Grundriss geplant; Ausführung und Leistungsumfang richten sich nach der konkreten Vereinbarung. So greifen Raumplanung, Funktion und Gestaltung sinnvoll ineinander.

Ob du selbst mit anpacken möchtest oder mehr Leistungen vergeben willst, entscheidest du passend zu Zeit, Budget und handwerklicher Erfahrung. Das Zuhause-Paket, professionelle Ausbau-Coachings und digitale Tutorials unterstützen dich bei ausgewählten Eigenleistungen.

Mit dem digitalen Bau-Cockpit behältst du Termine, Baufortschritt und Dokumente im Blick. Zertifizierungen und Qualitätsnachweise werden entsprechend der konkreten Planung und Leistungsbeschreibung berücksichtigt.

${advisorSentence(provider)} Du erhältst eine ehrliche, nachvollziehbare Beratung und einen festen Ansprechpartner für dein Projekt.

Living Haus steht für Komfort, Planungssicherheit und persönliche Begleitung. ${contactSentence(provider)}`;
}

export function fixedOtherText(provider = {}) {
  return `Das angebotene Grundstück ist im ausgewiesenen Gesamtpreis berücksichtigt. Ob beim Grundstückskauf eine Provision anfällt, ergibt sich aus dem konkreten Grundstücksangebot und den Vereinbarungen mit dem jeweiligen Anbieter.

Zusätzliche grundstücks- oder projektabhängige Baunebenkosten können hinzukommen. Hierzu beraten wir dich transparent im Rahmen der individuellen Kalkulation.

Wir prüfen gemeinsam mit dir passende Finanzierungsmöglichkeiten und unterstützen bei der Einordnung möglicher Förderprogramme. Eine Förderzusage ist damit nicht verbunden.

Die Hausabbildungen, Bilder der Inneneinrichtung und Grundrisse können Sonderausstattungen, Möblierungen oder Außenanlagen zeigen, die nicht im angegebenen Kaufpreis enthalten sind. Maßgeblich sind die individuelle Planung sowie die vereinbarte Bau- und Leistungsbeschreibung.

Gute Beratung ist der Anfang von allem. Gemeinsam analysieren wir Vorstellungen, Wünsche und Bedürfnisse, damit Haus, Grundstück und Finanzierung zusammenpassen.

${contactSentence(provider)}`;
}

export const FIXED_PROVISION_TEXT =
  "Das Grundstück wird über einen Drittanbieter angeboten. Eine mögliche Provisionspflicht ergibt sich aus dem konkreten Grundstücksangebot.";

export const FIXED_ANNOTATION_TEXT =
  "Die Informationen zum Grundstück beruhen auf Angaben des Verkäufers beziehungsweise der Verkäuferin. Für Richtigkeit und Vollständigkeit kann keine Gewähr oder Haftung übernommen werden. Zwischenverkauf und Irrtümer bleiben vorbehalten.";

export const FIXED_TERMS_TEXT =
  "Wir weisen auf unsere Allgemeinen Geschäftsbedingungen hin. Durch die weitere Inanspruchnahme unserer Leistungen erklären Sie deren Kenntnis und Ihr Einverständnis.";

export const FIXED_RECOMMENDATION_TEXT =
  "Haus, Grundstück und Finanzierung werden im persönlichen Beratungsgespräch gemeinsam betrachtet. Zusätzliche Baunebenkosten und mögliche Förderprogramme werden dabei transparent eingeordnet. Maßgeblich sind die individuelle Planung, die konkreten Grundstücksbedingungen und die vereinbarte Bau- und Leistungsbeschreibung.";

function descriptionBody(value) {
  let body = clean(value);
  const fixedCtaIndex = body.indexOf(DESCRIPTION_CTA_START);
  if (fixedCtaIndex >= 0) body = body.slice(0, fixedCtaIndex).trim();
  return body
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => (
      paragraph
      && !/(?:kostenlosen?\s+(?:und\s+unverbindlichen\s+)?Beratungstermin|Ruf\s+(?:mich\s+)?direkt|professionelle und transparente Beratung für energieeffizientes Bauen)/iu.test(paragraph)
    ))
    .join("\n\n")
    .trim();
}

export function enforceListingCopy(texts = {}, { provider = {} } = {}) {
  const body = descriptionBody(texts.description);
  const cta = fixedDescriptionCta(provider);
  return {
    title: clean(texts.title),
    description: body ? `${body}\n\n${cta}` : cta,
    equipment: fixedEquipmentText(provider),
    location: clean(texts.location),
    other: fixedOtherText(provider),
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
