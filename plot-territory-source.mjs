import { readFile } from "node:fs/promises";
import { readSheet } from "read-excel-file/node";
import { parseTerritoryPostalCodes } from "./plot-territory.mjs";

// Read a single immutable byte snapshot. No workbook export, catalog write or sync.
export async function loadPlotTerritory(sourcePath, options = {}) {
  try {
    const bytes = await (options.readFile || readFile)(sourcePath);
    const rows = await (options.readSheet || readSheet)(bytes, "Suchgebiet");
    return { available: true, postalCodes: parseTerritoryPostalCodes(rows), message: "" };
  } catch {
    return {
      available: false,
      postalCodes: [],
      message: "Das aktive PLZ-Gebiet aus dem Excel-Blatt „Suchgebiet“ ist nicht lesbar oder ungültig. Es erfolgt keine Zuordnung innerhalb/außerhalb.",
    };
  }
}
