import JSZip from "jszip";

import type {
  GeneratedListing,
  HouseTemplate,
  ProjectInput,
  StudioState,
} from "../types";
import {
  projectResponsibleUserId,
  responsibilityLabel,
} from "./responsibility.ts";

type CellValue = string | number | boolean | Date | null | undefined;

type WorkbookCell = {
  value?: CellValue;
  formula?: string;
  cachedValue?: number;
  style?: number;
};

type WorksheetSpec = {
  name: string;
  rows: WorkbookCell[][];
  widths: number[];
  freezeRows?: number;
  autoFilter?: boolean;
  mergedCells?: string[];
};

export type InventoryExportResult = {
  blob: Blob;
  filename: string;
  addressCount: number;
  listingCount: number;
  houseCount: number;
  activeHouseCount: number;
  archivedHouseCount: number;
};

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_EXCEL_TEXT_LENGTH = 32_767;

const STYLE = {
  default: 0,
  title: 1,
  header: 2,
  integer: 3,
  decimal: 4,
  currency: 5,
  date: 6,
  wrapped: 7,
  metricLabel: 8,
  metricValue: 9,
  note: 10,
  year: 11,
} as const;

function xmlEscape(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function safeText(value: unknown): string {
  return String(value ?? "").slice(0, MAX_EXCEL_TEXT_LENGTH);
}

function excelColumn(index: number): string {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function excelSerial(date: Date): number {
  return date.getTime() / 86_400_000 + 25_569;
}

function dateText(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-") + ` ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function validDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : dateText(date);
}

function ownerId(project: ProjectInput): string {
  return projectResponsibleUserId(project) ?? "";
}

function ownerName(state: StudioState, project: ProjectInput): string {
  return responsibilityLabel(state.management, ownerId(project));
}

function workbookCellXml(cell: WorkbookCell, rowIndex: number, columnIndex: number): string {
  const reference = `${excelColumn(columnIndex)}${rowIndex + 1}`;
  const style = cell.style ?? STYLE.default;
  const styleAttribute = style ? ` s="${style}"` : "";

  if (cell.formula) {
    const cachedValue = Number.isFinite(cell.cachedValue) ? cell.cachedValue : 0;
    return `<c r="${reference}"${styleAttribute}><f>${xmlEscape(cell.formula)}</f><v>${cachedValue}</v></c>`;
  }

  if (cell.value === null || cell.value === undefined || cell.value === "") {
    return `<c r="${reference}"${styleAttribute}/>`;
  }

  if (cell.value instanceof Date) {
    return `<c r="${reference}"${styleAttribute}><v>${excelSerial(cell.value)}</v></c>`;
  }

  if (typeof cell.value === "number") {
    const number = Number.isFinite(cell.value) ? cell.value : 0;
    return `<c r="${reference}"${styleAttribute}><v>${number}</v></c>`;
  }

  if (typeof cell.value === "boolean") {
    return `<c r="${reference}"${styleAttribute} t="b"><v>${cell.value ? 1 : 0}</v></c>`;
  }

  const text = safeText(cell.value);
  const preserveSpace = /^\s|\s$|\n/.test(text) ? ' xml:space="preserve"' : "";
  return `<c r="${reference}"${styleAttribute} t="inlineStr"><is><t${preserveSpace}>${xmlEscape(text)}</t></is></c>`;
}

function worksheetXml(sheet: WorksheetSpec): string {
  const maxColumns = Math.max(sheet.widths.length, ...sheet.rows.map((row) => row.length), 1);
  const maxRows = Math.max(sheet.rows.length, 1);
  const columns = sheet.widths.map((width, index) => (
    `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`
  )).join("");
  const rows = sheet.rows.map((row, rowIndex) => {
    const cells = Array.from({ length: maxColumns }, (_, columnIndex) => (
      workbookCellXml(row[columnIndex] ?? {}, rowIndex, columnIndex)
    )).join("");
    const height = rowIndex === 0 ? ' ht="26" customHeight="1"' : "";
    return `<row r="${rowIndex + 1}"${height}>${cells}</row>`;
  }).join("");
  const frozenPane = sheet.freezeRows
    ? `<pane ySplit="${sheet.freezeRows}" topLeftCell="A${sheet.freezeRows + 1}" activePane="bottomLeft" state="frozen"/>`
    : "";
  const filterRange = sheet.autoFilter && sheet.rows.length
    ? `<autoFilter ref="A1:${excelColumn(maxColumns - 1)}${maxRows}"/>`
    : "";
  const mergedCells = sheet.mergedCells?.length
    ? `<mergeCells count="${sheet.mergedCells.length}">${sheet.mergedCells.map((range) => `<mergeCell ref="${range}"/>`).join("")}</mergeCells>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${excelColumn(maxColumns - 1)}${maxRows}"/>
  <sheetViews><sheetView workbookViewId="0" showGridLines="0">${frozenPane}</sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${columns}</cols>
  <sheetData>${rows}</sheetData>
  ${filterRange}
  ${mergedCells}
  <pageMargins left="0.35" right="0.35" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
</worksheet>`;
}

function stylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="2">
    <numFmt numFmtId="164" formatCode="dd.mm.yyyy hh:mm"/>
    <numFmt numFmtId="165" formatCode="#,##0 [$€-407]"/>
  </numFmts>
  <fonts count="3">
    <font><sz val="10"/><name val="Aptos"/></font>
    <font><b/><sz val="18"/><color rgb="FFFFFFFF"/><name val="Aptos Display"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font>
  </fonts>
  <fills count="5">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF153A32"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFB8F23C"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEAF4E5"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left/><right/><top/><bottom style="thin"><color rgb="FFDCE4DE"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="12">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment horizontal="right"/></xf>
    <xf numFmtId="4" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment horizontal="right"/></xf>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment horizontal="right"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1"><alignment vertical="center"/></xf>
    <xf numFmtId="3" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyNumberFormat="1" applyBorder="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="1" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment horizontal="right"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function workbookXml(sheets: WorksheetSpec[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="14000"/></bookViews>
  <sheets>${sheets.map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets>
  <calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1"/>
</workbook>`;
}

function workbookRelationshipsXml(sheets: WorksheetSpec[]): string {
  const sheetRelationships = sheets.map((_, index) => (
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
  )).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheetRelationships}
  <Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function contentTypesXml(sheetCount: number): string {
  const sheets = Array.from({ length: sheetCount }, (_, index) => (
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  )).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  ${sheets}
</Types>`;
}

function sheetHeader(values: string[]): WorkbookCell[] {
  return values.map((value) => ({ value, style: STYLE.header }));
}

function selectedHouseNames(project: ProjectInput, housesById: Map<string, HouseTemplate>): string {
  return project.selectedHouseIds
    .map((id) => housesById.get(id)?.name)
    .filter((name): name is string => Boolean(name))
    .join(", ");
}

function addressRows(state: StudioState): WorkbookCell[][] {
  const housesById = new Map(state.houses.map((house) => [house.id, house]));
  const projects = [...state.projects].sort((left, right) => (
    ownerId(left).localeCompare(ownerId(right), "de")
    || left.city.localeCompare(right.city, "de")
    || left.street.localeCompare(right.street, "de")
    || left.houseNumber.localeCompare(right.houseNumber, "de", { numeric: true })
  ));
  return [
    sheetHeader([
      "Benutzer",
      "Projektname",
      "Straße",
      "Hausnummer",
      "PLZ",
      "Ort",
      "Ortsteil",
      "Grundstücksfläche m²",
      "Grundstückspreis €",
      "Nebenkosten €",
      "Lagefakten",
      "Verkehr & Erreichbarkeit",
      "Familie & Versorgung",
      "Natur & Freizeit",
      "Hinweise",
      "Gewählte Haustypen",
      "Anzahl Inserate",
      "Erstellt am",
      "Letzter Totalabgleich",
    ]),
    ...projects.map((project) => [
      { value: ownerName(state, project) },
      { value: project.name },
      { value: project.street },
      { value: project.houseNumber },
      { value: project.zip },
      { value: project.city },
      { value: project.district },
      { value: project.plotArea, style: STYLE.decimal },
      { value: project.plotPrice, style: STYLE.currency },
      { value: project.additionalCosts, style: STYLE.currency },
      { value: project.locationFacts, style: STYLE.wrapped },
      { value: project.transportFacts, style: STYLE.wrapped },
      { value: project.familyFacts, style: STYLE.wrapped },
      { value: project.natureFacts, style: STYLE.wrapped },
      { value: project.notes, style: STYLE.wrapped },
      { value: selectedHouseNames(project, housesById), style: STYLE.wrapped },
      { value: project.listings.length, style: STYLE.integer },
      { value: validDate(project.createdAt), style: STYLE.date },
      { value: validDate(project.lastTotalSyncAt), style: STYLE.date },
    ]),
  ];
}

function listingRows(state: StudioState): WorkbookCell[][] {
  const projects = [...state.projects].sort((left, right) => (
    left.city.localeCompare(right.city, "de")
    || left.street.localeCompare(right.street, "de")
  ));
  const rows: WorkbookCell[][] = [sheetHeader([
    "Benutzer",
    "Projektname",
    "Straße",
    "Hausnummer",
    "PLZ",
    "Ort",
    "Ortsteil",
    "Objekt-ID",
    "Haustyp",
    "Gesamtpreis €",
    "Überschrift",
    "Objektbeschreibung",
    "Ausstattung",
    "Lage",
    "Weitere Angaben",
    "Status",
    "Übertragen am",
    "Version",
  ])];
  projects.forEach((project) => {
    project.listings.forEach((listing: GeneratedListing) => {
      rows.push([
        { value: ownerName(state, project) },
        { value: project.name },
        { value: project.street },
        { value: project.houseNumber },
        { value: project.zip },
        { value: project.city },
        { value: project.district },
        { value: listing.externalId },
        { value: listing.templateName },
        { value: listing.price, style: STYLE.currency },
        { value: listing.texts.title, style: STYLE.wrapped },
        { value: listing.texts.description, style: STYLE.wrapped },
        { value: listing.texts.equipment, style: STYLE.wrapped },
        { value: listing.texts.location, style: STYLE.wrapped },
        { value: listing.texts.other, style: STYLE.wrapped },
        { value: listing.uploadedAt ? "Übertragen" : "Entwurf" },
        { value: validDate(listing.uploadedAt), style: STYLE.date },
        { value: listing.version, style: STYLE.integer },
      ]);
    });
  });
  return rows;
}

function houseRows(state: StudioState): WorkbookCell[][] {
  const houses = [...state.houses].sort((left, right) => (
    Number(Boolean(left.archived)) - Number(Boolean(right.archived))
    || left.name.localeCompare(right.name, "de", { numeric: true })
  ));
  return [
    sheetHeader([
      "Status",
      "Haustyp",
      "Objektart",
      "Hauspreis €",
      "Wohnfläche m²",
      "Zimmer",
      "Schlafzimmer",
      "Badezimmer",
      "Etagen",
      "Baujahr geplant",
      "Endenergiebedarf",
      "Energieklasse",
      "Heizungsart",
      "Energieträger",
      "Architektur & Grundriss",
      "Ausstattungsmerkmale",
      "Anzahl Bilder",
    ]),
    ...houses.map((house) => [
      { value: house.archived ? "Archiviert" : "Aktiv" },
      { value: house.name },
      { value: house.houseType },
      { value: house.housePrice, style: STYLE.currency },
      { value: house.livingArea, style: STYLE.decimal },
      { value: house.rooms, style: STYLE.decimal },
      { value: house.bedrooms, style: STYLE.integer },
      { value: house.bathrooms, style: STYLE.integer },
      { value: house.floors, style: STYLE.integer },
      { value: house.constructionYear, style: STYLE.year },
      { value: house.energyDemand, style: STYLE.decimal },
      { value: house.energyClass },
      { value: house.heatingType, style: STYLE.wrapped },
      { value: house.energySource, style: STYLE.wrapped },
      { value: house.architecture, style: STYLE.wrapped },
      { value: house.equipmentHighlights, style: STYLE.wrapped },
      { value: house.images.length, style: STYLE.integer },
    ]),
  ];
}

function summaryRows(state: StudioState, addressCount: number, listingCount: number): WorkbookCell[][] {
  const uploadedCount = state.projects.reduce(
    (sum, project) => sum + project.listings.filter((listing) => Boolean(listing.uploadedAt)).length,
    0,
  );
  const activeHouseCount = state.houses.filter((house) => !house.archived).length;
  const archivedHouseCount = state.houses.length - activeHouseCount;
  const addressEnd = Math.max(addressCount + 1, 2);
  const listingEnd = Math.max(listingCount + 1, 2);
  const houseEnd = Math.max(state.houses.length + 1, 2);
  return [
    [{ value: "Inserate Studio – Bestandsübersicht", style: STYLE.title }, {}, {}, {}],
    [{ value: "Exportiert am", style: STYLE.metricLabel }, { value: dateText(new Date()), style: STYLE.date }, {}, {}],
    [{ value: "Die Datei enthält keine Zugangsdaten und keine Bilddateien.", style: STYLE.note }, {}, {}, {}],
    [{}, {}, {}, {}],
    [{ value: "Kennzahl", style: STYLE.header }, { value: "Bestand", style: STYLE.header }, {}, {}],
    [
      { value: "Grundstücksadressen gesamt", style: STYLE.metricLabel },
      { formula: `COUNTA('Adressbestand'!A2:A${addressEnd})`, cachedValue: addressCount, style: STYLE.metricValue },
    ],
    [
      { value: "Mitarbeiter mit Adressen", style: STYLE.metricLabel },
      {
        value: new Set(state.projects.map(ownerId).filter(Boolean)).size,
        style: STYLE.metricValue,
      },
    ],
    [
      { value: "Inserate gesamt", style: STYLE.metricLabel },
      { formula: `COUNTA('Inseratbestand'!A2:A${listingEnd})`, cachedValue: listingCount, style: STYLE.metricValue },
    ],
    [
      { value: "Davon übertragen", style: STYLE.metricLabel },
      {
        formula: `COUNTIF('Inseratbestand'!P2:P${listingEnd},"Übertragen")`,
        cachedValue: uploadedCount,
        style: STYLE.metricValue,
      },
    ],
    [
      { value: "Aktive Haustypen", style: STYLE.metricLabel },
      {
        formula: `COUNTIF('Haustypen'!A2:A${houseEnd},"Aktiv")`,
        cachedValue: activeHouseCount,
        style: STYLE.metricValue,
      },
    ],
    [
      { value: "Archivierte Haustypen", style: STYLE.metricLabel },
      {
        formula: `COUNTIF('Haustypen'!A2:A${houseEnd},"Archiviert")`,
        cachedValue: archivedHouseCount,
        style: STYLE.metricValue,
      },
    ],
    [
      { value: "Aktionsbilder", style: STYLE.metricLabel },
      { value: state.promotionImages.length, style: STYLE.metricValue },
    ],
  ];
}

function buildSheets(state: StudioState): WorksheetSpec[] {
  const addresses = addressRows(state);
  const listings = listingRows(state);
  const houses = houseRows(state);
  const addressCount = addresses.length - 1;
  const listingCount = listings.length - 1;
  return [
    {
      name: "Adressbestand",
      rows: addresses,
      widths: [12, 28, 24, 12, 10, 22, 18, 18, 18, 16, 34, 34, 34, 34, 34, 36, 14, 19, 19],
      freezeRows: 1,
      autoFilter: true,
    },
    {
      name: "Übersicht",
      rows: summaryRows(state, addressCount, listingCount),
      widths: [32, 18, 18, 18],
      mergedCells: ["A1:D1", "A3:D3"],
    },
    {
      name: "Inseratbestand",
      rows: listings,
      widths: [12, 26, 23, 12, 10, 21, 18, 24, 20, 18, 36, 60, 55, 50, 50, 14, 19, 10],
      freezeRows: 1,
      autoFilter: true,
    },
    {
      name: "Haustypen",
      rows: houses,
      widths: [14, 22, 20, 18, 16, 12, 15, 13, 10, 18, 19, 15, 36, 28, 50, 50, 14],
      freezeRows: 1,
      autoFilter: true,
    },
  ];
}

export async function buildInventoryWorkbook(state: StudioState): Promise<InventoryExportResult> {
  const sheets = buildSheets(state);
  const zip = new JSZip();
  const exportedAt = new Date();
  const activeHouseCount = state.houses.filter((house) => !house.archived).length;

  zip.file("[Content_Types].xml", contentTypesXml(sheets.length));
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`);
  zip.file("docProps/app.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Inserate Studio</Application>
  <AppVersion>1.0</AppVersion>
</Properties>`);
  zip.file("docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Inserate Studio – Bestand</dc:title>
  <dc:creator>Inserate Studio</dc:creator>
  <dcterms:created xsi:type="dcterms:W3CDTF">${exportedAt.toISOString()}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${exportedAt.toISOString()}</dcterms:modified>
</cp:coreProperties>`);
  zip.file("xl/workbook.xml", workbookXml(sheets));
  zip.file("xl/_rels/workbook.xml.rels", workbookRelationshipsXml(sheets));
  zip.file("xl/styles.xml", stylesXml());
  sheets.forEach((sheet, index) => {
    zip.file(`xl/worksheets/sheet${index + 1}.xml`, worksheetXml(sheet));
  });

  const bytes = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    mimeType: XLSX_MIME,
  });
  const date = exportedAt.toISOString().slice(0, 10);
  return {
    blob: new Blob([bytes.buffer as ArrayBuffer], { type: XLSX_MIME }),
    filename: `Inserate-Studio-Bestand-${date}.xlsx`,
    addressCount: state.projects.length,
    listingCount: state.projects.reduce((sum, project) => sum + project.listings.length, 0),
    houseCount: state.houses.length,
    activeHouseCount,
    archivedHouseCount: state.houses.length - activeHouseCount,
  };
}
