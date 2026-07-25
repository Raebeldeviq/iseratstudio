import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const SPACE = /\s+/gu;

function clean(value) {
  return String(value ?? "").replace(SPACE, " ").trim();
}

function germanNumber(value) {
  const raw = clean(value).replace(/[^0-9,.-]/gu, "");
  if (!raw) return 0;
  const normalized = raw.includes(",")
    ? raw.replace(/\./gu, "").replace(",", ".")
    : raw.replace(/(?<=\d)\.(?=\d{3}(?:\D|$))/gu, "");
  const number = Number(normalized);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function matchFirst(text, expressions) {
  for (const expression of expressions) {
    const match = text.match(expression);
    if (match?.[1]) return clean(match[1]);
  }
  return "";
}

function cleanCity(value) {
  return clean(value)
    .replace(/\s+(?:Deutschland|Brandenburg|Berlin)$/iu, "")
    .replace(/[|,;].*$/u, "")
    .trim();
}

function splitStreet(value) {
  const cleaned = clean(value).replace(/^[,;:\-\s]+|[,;:\-\s]+$/gu, "");
  const match = cleaned.match(/^(.+?)\s+(\d+[a-zA-Z]?(?:\s*[-/]\s*\d+[a-zA-Z]?)?)$/u);
  if (!match) return { street: cleaned, houseNumber: "" };
  return { street: clean(match[1]), houseNumber: clean(match[2]) };
}

function compactTrackedText(value) {
  const source = String(value ?? "");
  if (!source.trim()) return source;
  if (/[a-zäöü]/u.test(source)) return clean(source);
  const withoutTracking = source.replace(/(?<=[\p{Lu}ÄÖÜẞß0-9€.,-])\s+(?=[\p{Lu}ÄÖÜẞß0-9€.,-])/gu, "");
  return clean(withoutTracking);
}

export function extractPlotFieldsFromText(input) {
  const lines = String(input ?? "")
    .split(/\r?\n/gu)
    .map(clean)
    .filter(Boolean);
  const joined = lines.join("\n");

  const priceText = matchFirst(joined, [
    /(?:Kaufpreis|Grundst(?:ü|ue)ckspreis|Angebotspreis)\s*(?::|\||-)?\s*([0-9][0-9.\s]*(?:,[0-9]{1,2})?)\s*(?:,-\s*)?(?:€|EUR)/iu,
    /(?:Kaufpreis|Grundst(?:ü|ue)ckspreis|Angebotspreis)\s*(?::|\||-)?\s*(?:€|EUR)\s*([0-9][0-9.\s]*(?:,[0-9]{1,2})?)/iu,
  ]);
  const areaText = matchFirst(joined, [
    /(?:Grundst(?:ü|ue)cksfl(?:ä|ae)che|Grundst(?:ü|ue)cksgr(?:ö|oe)(?:ß|ss)e|Grundst(?:ü|ue)ck)\s*(?::|\||-)?\s*(?:ca\.?\s*)?([0-9][0-9.\s]*(?:,[0-9]{1,2})?)\s*m(?:²|2)/iu,
    /(?:Fl(?:ä|ae)che)\s*(?::|\||-)?\s*(?:ca\.?\s*)?([0-9][0-9.\s]*(?:,[0-9]{1,2})?)\s*m(?:²|2)/iu,
  ]);

  let postalCode = "";
  let city = "";
  for (const line of lines) {
    const labeled = line.match(/(?:PLZ|Postleitzahl)\s*(?::|\||-)?\s*(\d{5})(?:\s+(.+))?$/iu);
    if (labeled) {
      postalCode = labeled[1];
      city = cleanCity(labeled[2]);
      break;
    }
  }
  if (!postalCode) {
    for (const line of lines) {
      const address = line.match(/\b(\d{5})\s+([A-ZÄÖÜ][\p{L} .'-]{1,50})$/u);
      if (address) {
        postalCode = address[1];
        city = cleanCity(address[2]);
        break;
      }
    }
  }
  if (!city) {
    city = cleanCity(matchFirst(joined, [/(?:Ort|Stadt)\s*(?::|\||-)\s*([^\n]{2,60})/iu]));
  }

  let streetWithNumber = matchFirst(joined, [
    /(?:Stra(?:ß|ss)e(?:\s*(?:\/|und)\s*Hausnummer)?|Anschrift|Adresse)\s*(?::|\||-)\s*([^\n]{3,100})/iu,
    /(?:Stra(?:ß|ss)e(?:\s*(?:\/|und)\s*Hausnummer)?|Anschrift|Adresse)\s+([\p{L}][^\n]{2,80})/iu,
  ]);
  if (streetWithNumber) streetWithNumber = streetWithNumber.replace(/\b\d{5}\b.*$/u, "").trim();
  if (!streetWithNumber) {
    const suffix = /\b(?:stra(?:ß|ss)e|weg|allee|chaussee|platz|damm|ring|ufer|steig|gasse|pfad|promenade)\b/iu;
    const candidate = lines.find((line) => suffix.test(line) && /\d+[a-zA-Z]?(?:\s|$)/u.test(line));
    streetWithNumber = candidate || "";
  }
  const streetParts = splitStreet(streetWithNumber);

  const purchasePrice = germanNumber(priceText);
  const plotSizeSqm = germanNumber(areaText);
  return {
    street: streetParts.street,
    houseNumber: streetParts.houseNumber,
    postalCode,
    city,
    plotSizeSqm,
    purchasePrice,
    reviewRequired: {
      street: !streetParts.street,
      postalCode: !/^\d{5}$/u.test(postalCode),
      city: !city,
      plotSizeSqm: !plotSizeSqm,
      purchasePrice: !purchasePrice,
    },
  };
}

async function pageText(page) {
  const content = await page.getTextContent();
  const sourceItems = content.items
    .filter((item) => typeof item?.str === "string" && item.str.length)
    .map((item) => ({
      value: String(item.str),
      x: Number(item.transform?.[4] || 0),
      y: Number(item.transform?.[5] || 0),
      width: Number(item.width || 0),
    }))
    .sort((left, right) => Math.abs(right.y - left.y) > 2 ? right.y - left.y : left.x - right.x);
  const items = sourceItems.filter((item, index) => !sourceItems.slice(Math.max(0, index - 3), index).some((previous) =>
    previous.value === item.value
    && Math.abs(previous.x - item.x) <= 1.5
    && Math.abs(previous.y - item.y) <= 1.5));
  const lines = [];
  for (const item of items) {
    const current = lines.at(-1);
    if (!current || Math.abs(current.y - item.y) > 2) lines.push({ y: item.y, items: [item] });
    else current.items.push(item);
  }
  return lines.map((line) => clean(line.items.map((item) => {
    if (!item.value.trim()) return item.width >= 3.5 ? " " : "";
    return compactTrackedText(item.value);
  }).join(""))).filter(Boolean).join("\n");
}

export async function extractPlotFieldsFromPdf(pdfBytes, options = {}) {
  const data = new Uint8Array(pdfBytes);
  const loadingTask = getDocument({ data, disableWorker: true, isEvalSupported: false, useSystemFonts: true, verbosity: 0 });
  const document = await loadingTask.promise;
  const pageCount = document.numPages;
  const maximumPages = Math.min(pageCount, Number(options.maximumPages) || 100);
  const pages = [];
  try {
    for (let pageNumber = 1; pageNumber <= maximumPages; pageNumber += 1) {
      pages.push(await pageText(await document.getPage(pageNumber)));
    }
  } finally {
    if (typeof document.cleanup === "function") await document.cleanup();
    if (typeof loadingTask.destroy === "function") await loadingTask.destroy();
  }
  return {
    pageCount,
    fields: extractPlotFieldsFromText(pages.join("\n")),
  };
}
