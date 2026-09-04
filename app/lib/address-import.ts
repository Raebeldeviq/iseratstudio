import type { AddressOwner, ListingGroup, PlotRecord, ProjectInput } from "../types";
import { createListingGroup } from "../../listing-groups.mjs";
import {
  createPlotRecord,
  normalizePlotRecord,
  plotAddressKey,
  replacePlotRecord,
} from "../../plot-records.mjs";
import {
  enrichProjectWithPostalRegion,
  type PostalRegionIndex,
} from "./postal-regions.ts";

type AddressColumn =
  | "owner"
  | "name"
  | "street"
  | "houseNumber"
  | "zip"
  | "city"
  | "district"
  | "plotArea"
  | "plotPrice"
  | "additionalCosts"
  | "locationFacts"
  | "transportFacts"
  | "familyFacts"
  | "natureFacts";

export type AddressImportResult = {
  projects: ProjectInput[];
  errors: string[];
  duplicateCount: number;
  unresolvedRegionCount: number;
};

export type PlotImportAction = "create" | "update" | "skip";

export type PlotImportPreviewRow = {
  id: string;
  excelRow: number;
  selected: boolean;
  status: "valid" | "duplicate" | "invalid";
  issues: string[];
  action: PlotImportAction;
  duplicatePlotId: string;
  providedFields: Array<"street" | "houseNumber" | "postalCode" | "city" | "plotSizeSqm" | "purchasePrice" | "regionalNotes" | "owner">;
  plot: PlotRecord;
};

export type PlotImportPreview = {
  rows: PlotImportPreviewRow[];
  errors: string[];
};

const HEADER_ALIASES: Record<AddressColumn, string[]> = {
  owner: ["benutzer", "bearbeiter", "eigentumer", "owner"],
  name: ["projektname", "projekt", "bezeichnung", "name"],
  street: ["strasse", "straße"],
  houseNumber: ["hausnummer", "hausnr", "nr"],
  zip: ["plz", "postleitzahl"],
  city: ["ort", "stadt"],
  district: ["ortsteil", "stadtteil"],
  plotArea: ["grundstucksflachem2", "grundstucksflache", "grundstuecksflaeche", "flache"],
  plotPrice: ["grundstuckspreis", "grundstueckspreis", "kaufpreisgrundstuck"],
  additionalCosts: ["nebenkosten", "zusatzkosten"],
  locationFacts: ["lagefakten", "lage"],
  transportFacts: ["verkehrerreichbarkeit", "verkehr", "erreichbarkeit"],
  familyFacts: ["familieversorgung", "familie", "versorgung"],
  natureFacts: ["naturfreizeit", "natur", "freizeit"],
};

function normalize(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("de-DE")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");
}

function text(value: unknown): string {
  if (value instanceof Date) return value.toLocaleDateString("de-DE");
  return String(value ?? "").trim();
}

export function parseGermanNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const raw = text(value).replace(/[^0-9,.-]/g, "");
  if (!raw) return 0;
  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw.replace(/(?<=\d)\.(?=\d{3}(?:\D|$))/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function postalCode(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value)).padStart(5, "0");
  }
  const valueText = text(value);
  return /^\d{1,4}$/.test(valueText) ? valueText.padStart(5, "0") : valueText;
}

function ownerFromCell(value: unknown): AddressOwner | null {
  const valueText = normalize(value);
  if (valueText === "fabian") return "fabian";
  if (valueText === "pascal") return "pascal";
  return null;
}

function addressKey(project: Pick<ProjectInput, "owner" | "street" | "houseNumber" | "zip" | "city">): string {
  return [project.owner, project.street, project.houseNumber, project.zip, project.city]
    .map(normalize)
    .join("|");
}

function columnMap(row: readonly unknown[]): Partial<Record<AddressColumn, number>> {
  const result: Partial<Record<AddressColumn, number>> = {};
  row.forEach((cell, index) => {
    const header = normalize(cell);
    (Object.entries(HEADER_ALIASES) as Array<[AddressColumn, string[]]>).forEach(([column, aliases]) => {
      if (result[column] === undefined && aliases.map(normalize).includes(header)) result[column] = index;
    });
  });
  return result;
}

function hasRequiredColumns(columns: Partial<Record<AddressColumn, number>>): boolean {
  return columns.owner !== undefined
    && columns.street !== undefined
    && columns.zip !== undefined
    && columns.city !== undefined;
}

function hasPlotRequiredColumns(columns: Partial<Record<AddressColumn, number>>): boolean {
  return columns.street !== undefined
    && columns.zip !== undefined
    && columns.city !== undefined;
}

export function parsePlotWorkbookRows(
  rows: readonly (readonly unknown[])[],
  existingPlots: readonly PlotRecord[],
  createId: () => string,
  defaultOwner: AddressOwner = "fabian",
): PlotImportPreview {
  const headerIndex = rows.findIndex((row) => hasPlotRequiredColumns(columnMap(row)));
  if (headerIndex < 0) {
    return {
      rows: [],
      errors: ["Keine passende Kopfzeile gefunden. Benötigt werden Straße, PLZ und Ort."],
    };
  }

  const columns = columnMap(rows[headerIndex]);
  const knownByAddress = new Map(
    existingPlots
      .filter((plot) => plot.isActive !== false)
      .map((plot) => [plotAddressKey(plot), plot] as const)
      .filter(([key]) => Boolean(key)),
  );
  const previewRows: PlotImportPreviewRow[] = [];
  const errors: string[] = [];
  const cell = (row: readonly unknown[], column: AddressColumn): unknown => {
    const index = columns[column];
    return index === undefined ? "" : row[index];
  };

  rows.slice(headerIndex + 1).forEach((row, relativeIndex) => {
    const excelRow = headerIndex + relativeIndex + 2;
    if (row.every((value) => text(value) === "")) return;
    const id = createId();
    const street = text(cell(row, "street"));
    const houseNumber = text(cell(row, "houseNumber"));
    const postalCodeValue = postalCode(cell(row, "zip"));
    const city = text(cell(row, "city"));
    const issues: string[] = [];
    if (!street) issues.push("Straße fehlt");
    if (!postalCodeValue || !/^\d{5}$/.test(postalCodeValue)) issues.push("Gültige fünfstellige PLZ fehlt");
    if (!city) issues.push("Ort fehlt");

    const owner = ownerFromCell(cell(row, "owner")) || defaultOwner;
    const plot = createPlotRecord({
      id,
      street,
      houseNumber,
      postalCode: postalCodeValue,
      city,
      plotSizeSqm: parseGermanNumber(cell(row, "plotArea")),
      purchasePrice: parseGermanNumber(cell(row, "plotPrice")),
      regionalNotes: text(cell(row, "locationFacts")),
      owner,
    }, { createId: () => id }) as PlotRecord;
    const providedFields = ([
      ["street", cell(row, "street")],
      ["houseNumber", cell(row, "houseNumber")],
      ["postalCode", cell(row, "zip")],
      ["city", cell(row, "city")],
      ["plotSizeSqm", cell(row, "plotArea")],
      ["purchasePrice", cell(row, "plotPrice")],
      ["regionalNotes", cell(row, "locationFacts")],
      ["owner", cell(row, "owner")],
    ] as const).filter(([, value]) => text(value) !== "").map(([field]) => field);
    const duplicate = issues.length ? undefined : knownByAddress.get(plotAddressKey(plot));
    const status = issues.length ? "invalid" : duplicate ? "duplicate" : "valid";
    previewRows.push({
      id: `excel-${excelRow}-${id}`,
      excelRow,
      selected: status !== "invalid",
      status,
      issues,
      action: duplicate ? "skip" : "create",
      duplicatePlotId: duplicate?.id || "",
      providedFields,
      plot,
    });
    if (issues.length) errors.push(`Zeile ${excelRow}: ${issues.join(", ")}.`);
    if (!issues.length) knownByAddress.set(plotAddressKey(plot), plot);
  });

  return { rows: previewRows, errors };
}

export function applyPlotImportPreview(
  existingPlots: readonly PlotRecord[],
  previewRows: readonly PlotImportPreviewRow[],
  now = new Date().toISOString(),
): { plots: PlotRecord[]; created: number; updated: number; skipped: number } {
  let plots = [...existingPlots];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const row of previewRows) {
    if (!row.selected || row.status === "invalid" || row.action === "skip") {
      skipped += 1;
      continue;
    }
    if (row.action === "update" && row.duplicatePlotId) {
      const current = plots.find((plot) => plot.id === row.duplicatePlotId);
      if (!current) {
        skipped += 1;
        continue;
      }
      const patch = Object.fromEntries(row.providedFields.map((field) => [field, row.plot[field]]));
      plots = replacePlotRecord(plots, normalizePlotRecord({
        ...current,
        ...patch,
        id: current.id,
        createdAt: current.createdAt,
        updatedAt: now,
        exposeFileReference: current.exposeFileReference,
        exposeFilename: current.exposeFilename,
        exposeUploadedAt: current.exposeUploadedAt,
        isActive: current.isActive,
      }, { now, fallbackId: current.id }), now);
      updated += 1;
      continue;
    }
    plots = replacePlotRecord(plots, normalizePlotRecord({
      ...row.plot,
      createdAt: now,
      updatedAt: now,
      isActive: true,
    }, { now, fallbackId: row.plot.id }), now);
    created += 1;
  }
  return { plots, created, updated, skipped };
}

export function parseAddressWorkbookRows(
  rows: readonly (readonly unknown[])[],
  existingProjects: readonly ProjectInput[],
  createId: () => string,
  postalRegionIndex: PostalRegionIndex = {},
): AddressImportResult {
  const headerIndex = rows.findIndex((row) => hasRequiredColumns(columnMap(row)));
  if (headerIndex < 0) {
    return {
      projects: [],
      duplicateCount: 0,
      unresolvedRegionCount: 0,
      errors: ["Keine passende Kopfzeile gefunden. Benötigt werden Benutzer, Straße, PLZ und Ort."],
    };
  }

  const columns = columnMap(rows[headerIndex]);
  const existingKeys = new Set(existingProjects.map(addressKey));
  const projects: ProjectInput[] = [];
  const errors: string[] = [];
  let duplicateCount = 0;
  let unresolvedRegionCount = 0;
  const cell = (row: readonly unknown[], column: AddressColumn): unknown => {
    const index = columns[column];
    return index === undefined ? "" : row[index];
  };

  rows.slice(headerIndex + 1).forEach((row, relativeIndex) => {
    const excelRow = headerIndex + relativeIndex + 2;
    if (row.every((value) => text(value) === "")) return;

    const owner = ownerFromCell(cell(row, "owner"));
    const street = text(cell(row, "street"));
    const zip = postalCode(cell(row, "zip"));
    const city = text(cell(row, "city"));
    if (!owner || !street || !zip || !city) {
      errors.push(`Zeile ${excelRow}: Benutzer (Fabian/Pascal), Straße, PLZ oder Ort fehlt.`);
      return;
    }

    const houseNumber = text(cell(row, "houseNumber"));
    const defaultName = [[street, houseNumber].filter(Boolean).join(" "), [zip, city].join(" ")]
      .filter(Boolean)
      .join(", ");
    const projectId = createId();
    const project = enrichProjectWithPostalRegion({
      id: projectId,
      owner,
      name: text(cell(row, "name")) || defaultName,
      street,
      houseNumber,
      zip,
      city,
      district: text(cell(row, "district")),
      plotArea: parseGermanNumber(cell(row, "plotArea")),
      plotPrice: parseGermanNumber(cell(row, "plotPrice")),
      additionalCosts: parseGermanNumber(cell(row, "additionalCosts")),
      locationFacts: text(cell(row, "locationFacts")),
      transportFacts: text(cell(row, "transportFacts")),
      familyFacts: text(cell(row, "familyFacts")),
      natureFacts: text(cell(row, "natureFacts")),
      selectedHouseIds: [],
      listings: [],
      listingGroup: createListingGroup(projectId) as ListingGroup,
      createdAt: new Date().toISOString(),
    }, postalRegionIndex);
    if (!project.federalState || !project.county) unresolvedRegionCount += 1;
    const key = addressKey(project);
    if (existingKeys.has(key)) {
      duplicateCount += 1;
      return;
    }
    existingKeys.add(key);
    projects.push(project);
  });

  return { projects, errors, duplicateCount, unresolvedRegionCount };
}
