import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { posix } from "node:path";
import JSZip from "jszip";
import { readSheet } from "read-excel-file/node";
import { masterRowsForWorkbook, parseMasterRows } from "./plot-master-sync.mjs";

const xml = (value) => String(value ?? "").replace(/&/gu, "&amp;").replace(/</gu, "&lt;")
  .replace(/>/gu, "&gt;").replace(/"/gu, "&quot;").replace(/'/gu, "&apos;");
const columnName = (index) => {
  let number = index + 1;
  let result = "";
  while (number) { number -= 1; result = String.fromCharCode(65 + number % 26) + result; number = Math.floor(number / 26); }
  return result;
};
const sheetXml = (rows) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((row, rowIndex) =>
    `<row r="${rowIndex + 1}">${row.map((value, index) => {
      const ref = `${columnName(index)}${rowIndex + 1}`;
      return typeof value === "number" && Number.isFinite(value)
        ? `<c r="${ref}"><v>${value}</v></c>`
        : `<c r="${ref}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`;
    }).join("")}</row>`).join("")}</sheetData></worksheet>`;

export async function readMasterWorkbook(path) {
  try {
    const bytes = await readFile(path);
    const [a, b] = await Promise.all([readSheet(path, "Pool_A"), readSheet(path, "Pool_B")]);
    const after = await readFile(path);
    if (createHash("sha256").update(bytes).digest("hex") !== createHash("sha256").update(after).digest("hex")) {
      throw new Error("Die Master-Datei wurde während des Lesens geändert. Bitte erneut versuchen.");
    }
    return { bytes, rawA: a, rawB: b, poolA: parseMasterRows(a, "A"), poolB: parseMasterRows(b, "B") };
  } catch (error) {
    if (error?.code === "ENOENT") return { bytes: null, rawA: [], rawB: [], poolA: [], poolB: [] };
    throw error;
  }
}

function worksheetPath(workbookXml, relsXml, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const sheet = workbookXml.match(new RegExp(`<sheet\\b[^>]*name="${escaped}"[^>]*>`, "u"))?.[0]
    || workbookXml.match(new RegExp(`<sheet\\b[^>]*name="${escaped}"[^>]*/>`, "u"))?.[0];
  const relationshipId = sheet?.match(/\br:id="([^"]+)"/u)?.[1];
  const relation = relsXml.match(new RegExp(`<Relationship\\b[^>]*Id="${relationshipId}"[^>]*>`, "u"))?.[0]
    || relsXml.match(new RegExp(`<Relationship\\b[^>]*Id="${relationshipId}"[^>]*/>`, "u"))?.[0];
  const target = relation?.match(/\bTarget="([^"]+)"/u)?.[1];
  if (!target) throw new Error(`Das Blatt ${name} hat keine gültige Excel-Beziehung.`);
  const path = target.startsWith("/") ? target.slice(1) : posix.normalize(posix.join("xl", target));
  if (!path.startsWith("xl/worksheets/")) throw new Error(`Das Blatt ${name} besitzt einen unerwarteten Speicherpfad.`);
  return path;
}

export async function createMasterWorkbook(poolA, poolB, originalA = [], originalB = [], originalBytes = null) {
  if (originalBytes) {
    const zip = await JSZip.loadAsync(originalBytes);
    const workbookXml = await zip.file("xl/workbook.xml")?.async("string");
    const relsXml = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
    if (!workbookXml || !relsXml) throw new Error("Die Excel-Masterdatei ist unvollständig.");
    zip.file(worksheetPath(workbookXml, relsXml, "Pool_A"), sheetXml(masterRowsForWorkbook(poolA, originalA)));
    zip.file(worksheetPath(workbookXml, relsXml, "Pool_B"), sheetXml(masterRowsForWorkbook(poolB, originalB)));
    return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  }
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Pool_A" sheetId="1" r:id="rId1"/><sheet name="Pool_B" sheetId="2" r:id="rId2"/></sheets></workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file("xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`);
  zip.file("xl/worksheets/sheet1.xml", sheetXml(masterRowsForWorkbook(poolA, originalA)));
  zip.file("xl/worksheets/sheet2.xml", sheetXml(masterRowsForWorkbook(poolB, originalB)));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
