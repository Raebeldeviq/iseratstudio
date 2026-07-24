import type { AddressOwner, ProjectInput } from "../types";

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
  | "natureFacts"
  | "notes";

export type AddressImportResult = {
  projects: ProjectInput[];
  projectUpdates: Array<{
    id: string;
    changes: Partial<Pick<ProjectInput, "plotArea" | "plotPrice" | "additionalCosts">>;
  }>;
  errors: string[];
  duplicateCount: number;
};

export type AddressReplacementResult = {
  projects: ProjectInput[];
  errors: string[];
  preservedProjectCount: number;
  newProjectCount: number;
  removedProjectCount: number;
};

const HEADER_ALIASES: Record<AddressColumn, string[]> = {
  owner: ["benutzer", "bearbeiter", "eigentumer", "owner"],
  name: ["projektname", "projekt", "bezeichnung", "name"],
  street: ["strasse", "straße"],
  houseNumber: ["hausnummer", "hausnr", "nr"],
  zip: ["plz", "postleitzahl"],
  city: ["ort", "stadt"],
  district: ["ortsteil", "stadtteil"],
  plotArea: [
    "grundstucksflachem2",
    "grundstucksflachem",
    "grundstucksflache",
    "grundstuecksflaeche",
    "flache",
  ],
  plotPrice: ["grundstuckspreis", "grundstueckspreis", "kaufpreisgrundstuck"],
  additionalCosts: ["nebenkosten", "zusatzkosten"],
  locationFacts: ["lagefakten", "lage"],
  transportFacts: ["verkehrerreichbarkeit", "verkehr", "erreichbarkeit"],
  familyFacts: ["familieversorgung", "familie", "versorgung"],
  natureFacts: ["naturfreizeit", "natur", "freizeit"],
  notes: ["hinweise", "notizen", "bemerkungen"],
};

function normalize(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("de-DE")
    .normalize("NFD")
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

function locationKey(
  project: Pick<ProjectInput, "owner" | "street" | "zip" | "city">,
): string {
  return [project.owner, project.street, project.zip, project.city]
    .map(normalize)
    .join("|");
}

function projectNameKey(project: Pick<ProjectInput, "owner" | "name">): string {
  return [project.owner, project.name].map(normalize).join("|");
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

export function parseAddressWorkbookRows(
  rows: readonly (readonly unknown[])[],
  existingProjects: readonly ProjectInput[],
  createId: () => string,
): AddressImportResult {
  const headerIndex = rows.findIndex((row) => hasRequiredColumns(columnMap(row)));
  if (headerIndex < 0) {
    return {
      projects: [],
      projectUpdates: [],
      duplicateCount: 0,
      errors: ["Keine passende Kopfzeile gefunden. Benötigt werden Benutzer, Straße, PLZ und Ort."],
    };
  }

  const columns = columnMap(rows[headerIndex]);
  const existingProjectsByKey = new Map(
    existingProjects.map((project) => [addressKey(project), { ...project }]),
  );
  const projectUpdatesById = new Map<
    string,
    Partial<Pick<ProjectInput, "plotArea" | "plotPrice" | "additionalCosts">>
  >();
  const projects: ProjectInput[] = [];
  const errors: string[] = [];
  let duplicateCount = 0;
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
    const plotAreaCell = cell(row, "plotArea");
    const plotPriceCell = cell(row, "plotPrice");
    const additionalCostsCell = cell(row, "additionalCosts");
    const project: ProjectInput = {
      id: createId(),
      owner,
      name: text(cell(row, "name")) || defaultName,
      street,
      houseNumber,
      zip,
      city,
      district: text(cell(row, "district")),
      plotArea: parseGermanNumber(plotAreaCell),
      plotPrice: parseGermanNumber(plotPriceCell),
      additionalCosts: parseGermanNumber(additionalCostsCell),
      locationFacts: text(cell(row, "locationFacts")),
      transportFacts: text(cell(row, "transportFacts")),
      familyFacts: text(cell(row, "familyFacts")),
      natureFacts: text(cell(row, "natureFacts")),
      notes: text(cell(row, "notes")),
      selectedHouseIds: [],
      listings: [],
      createdAt: new Date().toISOString(),
    };
    const key = addressKey(project);
    const existingProject = existingProjectsByKey.get(key);
    if (existingProject) {
      const changes: Partial<
        Pick<ProjectInput, "plotArea" | "plotPrice" | "additionalCosts">
      > = {};
      if (text(plotAreaCell) !== "" && project.plotArea !== existingProject.plotArea) {
        changes.plotArea = project.plotArea;
      }
      if (text(plotPriceCell) !== "" && project.plotPrice !== existingProject.plotPrice) {
        changes.plotPrice = project.plotPrice;
      }
      if (
        text(additionalCostsCell) !== ""
        && project.additionalCosts !== existingProject.additionalCosts
      ) {
        changes.additionalCosts = project.additionalCosts;
      }
      if (Object.keys(changes).length) {
        projectUpdatesById.set(existingProject.id, {
          ...projectUpdatesById.get(existingProject.id),
          ...changes,
        });
        Object.assign(existingProject, changes);
      } else {
        duplicateCount += 1;
      }
      return;
    }
    existingProjectsByKey.set(key, project);
    projects.push(project);
  });

  return {
    projects,
    projectUpdates: [...projectUpdatesById.entries()].map(([id, changes]) => ({
      id,
      changes,
    })),
    errors,
    duplicateCount,
  };
}

export function replaceAddressWorkbookRows(
  rows: readonly (readonly unknown[])[],
  existingProjects: readonly ProjectInput[],
  createId: () => string,
): AddressReplacementResult {
  const headerIndex = rows.findIndex((row) => hasRequiredColumns(columnMap(row)));
  if (headerIndex < 0) {
    return {
      projects: [],
      errors: ["Keine passende Kopfzeile gefunden. Benötigt werden Benutzer, Straße, PLZ und Ort."],
      preservedProjectCount: 0,
      newProjectCount: 0,
      removedProjectCount: existingProjects.length,
    };
  }

  const columns = columnMap(rows[headerIndex]);
  const cell = (row: readonly unknown[], column: AddressColumn): unknown => {
    const index = columns[column];
    return index === undefined ? "" : row[index];
  };
  const unusedExistingIds = new Set(existingProjects.map((project) => project.id));
  const existingByName = new Map<string, ProjectInput[]>();
  const existingByAddress = new Map<string, ProjectInput[]>();
  const existingByLocation = new Map<string, ProjectInput[]>();
  const append = (
    map: Map<string, ProjectInput[]>,
    key: string,
    project: ProjectInput,
  ) => map.set(key, [...(map.get(key) ?? []), project]);
  existingProjects.forEach((project) => {
    append(existingByName, projectNameKey(project), project);
    append(existingByAddress, addressKey(project), project);
    append(existingByLocation, locationKey(project), project);
  });

  const errors: string[] = [];
  const projects: ProjectInput[] = [];
  let preservedProjectCount = 0;
  let newProjectCount = 0;
  const uniqueUnusedMatch = (
    candidates: readonly ProjectInput[] | undefined,
  ): ProjectInput | null => {
    const unused = (candidates ?? []).filter((project) => unusedExistingIds.has(project.id));
    return unused.length === 1 ? unused[0] : null;
  };

  rows.slice(headerIndex + 1).forEach((row, relativeIndex) => {
    const excelRow = headerIndex + relativeIndex + 2;
    if (row.every((value) => text(value) === "")) return;

    const owner = ownerFromCell(cell(row, "owner"));
    if (!owner) {
      errors.push(`Zeile ${excelRow}: Benutzer muss Fabian oder Pascal sein.`);
      return;
    }

    const street = text(cell(row, "street"));
    const houseNumber = text(cell(row, "houseNumber"));
    const zip = postalCode(cell(row, "zip"));
    const city = text(cell(row, "city"));
    const suppliedName = text(cell(row, "name"));
    const defaultName = [[street, houseNumber].filter(Boolean).join(" "), [zip, city].filter(Boolean).join(" ")]
      .filter(Boolean)
      .join(", ");
    const name = suppliedName || defaultName || `Neues Adressprojekt ${excelRow}`;
    const incoming: ProjectInput = {
      id: createId(),
      owner,
      name,
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
      notes: text(cell(row, "notes")),
      selectedHouseIds: [],
      listings: [],
      createdAt: new Date().toISOString(),
    };

    const existing = uniqueUnusedMatch(existingByName.get(projectNameKey(incoming)))
      ?? uniqueUnusedMatch(existingByAddress.get(addressKey(incoming)))
      ?? uniqueUnusedMatch(existingByLocation.get(locationKey(incoming)));
    if (existing) {
      unusedExistingIds.delete(existing.id);
      projects.push({
        ...existing,
        ...incoming,
        id: existing.id,
        selectedHouseIds: existing.selectedHouseIds,
        listings: existing.listings,
        createdAt: existing.createdAt,
      });
      preservedProjectCount += 1;
      return;
    }

    projects.push(incoming);
    newProjectCount += 1;
  });

  return {
    projects,
    errors,
    preservedProjectCount,
    newProjectCount,
    removedProjectCount: unusedExistingIds.size,
  };
}
