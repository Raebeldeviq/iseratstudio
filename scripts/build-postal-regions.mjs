import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";

function normalizePlace(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("de-DE")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");
}

const sourcePath = resolve(process.argv[2] || "");
const outputPath = resolve(process.argv[3] || "public/data/de-postal-regions.json");
if (!process.argv[2]) {
  throw new Error("Aufruf: node scripts/build-postal-regions.mjs /pfad/zu/DE.txt [ausgabe.json]");
}

const source = await readFile(sourcePath, "utf8");
const regions = new Map();

source.split(/\r?\n/u).forEach((line) => {
  if (!line) return;
  const columns = line.split("\t");
  const zip = columns[1]?.trim() ?? "";
  const place = normalizePlace(columns[2]);
  const federalState = columns[3]?.trim() ?? "";
  const county = (columns[7] || columns[5] || "").trim();
  const accuracy = columns[11]?.trim() ?? "";
  if (!/^\d{5}$/.test(zip) || !place || !federalState || !/^[1-6]$/.test(accuracy)) return;
  const entry = [place, federalState, county];
  const existing = regions.get(zip) ?? new Map();
  existing.set(entry.join("\u0000"), entry);
  regions.set(zip, existing);
});

const sortedRegions = Object.fromEntries(
  [...regions.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "de-DE", { numeric: true }))
    .map(([zip, entries]) => [
      zip,
      [...entries.values()].sort((left, right) => left.join("|").localeCompare(right.join("|"), "de-DE")),
    ]),
);

const output = {
  source: "GeoNames Postal Code Dataset for Germany",
  sourceUrl: "https://download.geonames.org/export/zip/DE.zip",
  license: "CC BY 4.0",
  generatedAt: new Date().toISOString().slice(0, 10),
  regions: sortedRegions,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output)}\n`, "utf8");
process.stdout.write(`${Object.keys(sortedRegions).length} PLZ-Zuordnungen nach ${outputPath} geschrieben.\n`);
