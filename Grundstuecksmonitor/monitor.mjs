import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";
import JSZip from "jszip";
import { LOCAL_PLOT_DIRECTORY, assertLocalPlotPath } from '../plot-local-paths.mjs';
import { parseActivePostalCodes } from '../plot-search-area.mjs';
import { readActiveSources, validatePayload, sourceCoverage, assessOffer, freshness, nextAction, reasonText, reviewReasonFromLegacy, META_HEADERS, publicUrl } from './policy.mjs';

const DEFAULT_TARGET_DIR = LOCAL_PLOT_DIRECTORY;
const HEADERS = [
  "Postleitzahl",
  "Ort",
  "Straße",
  "Größe (m²)",
  "Preis (€)",
  "Quelle",
  "Inseratslink",
  "Erstmals gefunden",
  "Zuletzt geprüft",
  "Status",
  "Exposé-Dateiname",
  "Interne ID",
];
const STATUS = new Set(["Neu", "Vorhanden", "Nicht mehr vorhanden"]);
const OFFLINE_EVIDENCE =
  /\b(entfernt|verkauft|reserviert|deaktiviert|nicht mehr verfügbar|offline|removed|sold|reserved|deactivated|not available)\b/i;

function parseArgs(argv) {
  const args = {
    input: "",
    preflight: false,
    plan: false,
    dryRun: false,
    targetDir: process.env.GRUNDSTUECKSMONITOR_TARGET_DIR || DEFAULT_TARGET_DIR,
  };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--input" && argv[i + 1]) args.input = argv[++i];
    else if (argv[i] === "--target-dir" && argv[i + 1]) args.targetDir = argv[++i];
    else if (argv[i] === "--preflight") args.preflight = true;
    else if (argv[i] === "--plan") args.plan = true;
    else if (argv[i] === "--dry-run") args.dryRun = true;
    else if (argv[i] === "--help") {
      console.log(
        "Aufruf: run_monitor.command --preflight | --plan | --input /lokaler/pfad/lauf.json [--dry-run] [--target-dir /lokaler/zielordner]",
      );
      process.exit(0);
    } else {
      throw new Error(`Unbekannter Parameter: ${argv[i]}`);
    }
  }
  if (!args.input && !args.preflight && !args.plan) throw new Error("Pflichtparameter --input fehlt.");
  return args;
}

function berlinParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

function runStamp(date = new Date()) {
  const p = berlinParts(date);
  return `${p.year}-${p.month}-${p.day}_${p.hour}${p.minute}${p.second}-${String(date.getMilliseconds()).padStart(3,'0')}-${process.pid}`;
}

function isoDay(date = new Date()) {
  const p = berlinParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

function dateAtNoonUtc(iso) {
  if (iso instanceof Date) return new Date(iso.getTime());
  if (typeof iso === "number" && Number.isFinite(iso)) {
    return new Date(Date.UTC(1899, 11, 30) + iso * 86400000);
  }
  const match = String(iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/straße/g, "strasse")
    .replace(/[^a-z0-9]/g, "");
}

function zip(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.padStart(5, "0").slice(-5);
}

function number(value) {
  if (typeof value === "number") return value;
  const cleaned = String(value ?? "")
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function safeFilePart(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ß/g, "ss")
    .replace(/[\/:\\?*"<>|]/g, "-")
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9._-]/g, "")
    .replace(/_+/g, "_")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, 80);
}

function hasHouseNumber(street) {
  return /\s\d+[a-zA-Z]?(?:\s*[-/]\s*\d+[a-zA-Z]?)?$/u.test(String(street ?? "").trim());
}

function rowObject(values, formulas = []) {
  return {
    postalCode: zip(values[0]),
    city: String(values[1] ?? ""),
    street: String(values[2] ?? ""),
    sizeSqm: number(values[3]),
    priceEur: number(values[4]),
    source: String(values[5] ?? ""),
    listingUrl: String(values[6] ?? ""),
    firstFound: dateAtNoonUtc(values[7]),
    lastChecked: dateAtNoonUtc(values[8]),
    status: STATUS.has(String(values[9])) ? String(values[9]) : "Vorhanden",
    exposeFilename: String(values[10] ?? ""),
    internalId: String(values[11] ?? ""),
    extraValues: values.slice(12),
    extraFormulas: formulas.slice(12),
  };
}

function toRow(record) {
  return [
    record.postalCode,
    record.city,
    record.street,
    record.sizeSqm,
    record.priceEur,
    record.source,
    record.listingUrl,
    record.firstFound,
    record.lastChecked,
    record.status,
    record.exposeFilename,
    record.internalId,
  ];
}

function columnLabel(index) {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function dateValue(date) {
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
}

function statusFor(firstFound, today) {
  const ageDays = Math.floor((dateValue(today) - dateValue(firstFound)) / 86400000);
  return ageDays <= 7 ? "Neu" : "Vorhanden";
}

function findMatch(records, offer) {
  const byStableId = records.findIndex(
    (row) =>
      (offer.internalId && normalize(row.internalId) === normalize(offer.internalId)) ||
      (offer.listingUrl && normalize(row.listingUrl) === normalize(offer.listingUrl)),
  );
  if (byStableId >= 0) return byStableId;

  if (offer.street) {
    return records.findIndex(
      (row) =>
        row.postalCode === offer.postalCode &&
        normalize(row.city) === normalize(offer.city) &&
        normalize(row.street) === normalize(offer.street) &&
        Math.abs(row.sizeSqm - offer.sizeSqm) < 1,
    );
  }

  return records.findIndex(
    (row) =>
      row.postalCode === offer.postalCode &&
      normalize(row.city) === normalize(offer.city) &&
      Math.abs(row.sizeSqm - offer.sizeSqm) < 1 &&
      Math.abs(row.priceEur - offer.priceEur) < 1 &&
      normalize(row.source) === normalize(offer.source),
  );
}

async function sha256(file) {
  const bytes = await fs.readFile(file);
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function xmlAttribute(value) {
  return String(value).replace(/&/gu, "&amp;").replace(/"/gu, "&quot;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
}

async function alignListingHyperlinks(file, records) {
  const archive = await JSZip.loadAsync(await fs.readFile(file));
  const sheetPath = "xl/worksheets/sheet1.xml";
  const relationshipsPath = "xl/worksheets/_rels/sheet1.xml.rels";
  const sheetEntry = archive.file(sheetPath);
  const relationshipsEntry = archive.file(relationshipsPath);
  if (!sheetEntry) throw new Error("Hyperlink-Prüfung fehlgeschlagen: Grundstücksblatt fehlt.");
  let sheetXml = await sheetEntry.async("string");
  let relationshipsXml = relationshipsEntry ? await relationshipsEntry.async("string") : '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  const prefix=sheetXml.match(/<([A-Za-z0-9_]+:)?worksheet\b/u)?.[1]||'';
  const hyperlinkBlock = /<(?:[A-Za-z0-9_]+:)?hyperlinks>[\s\S]*?<\/(?:[A-Za-z0-9_]+:)?hyperlinks>/u;
  const cells = [];
  const relationships = [];
  for (const [index, record] of records.entries()) {
    if (!/^https?:\/\//iu.test(record.listingUrl)) throw new Error(`Inseratslink fehlt in Zeile ${index + 2}.`);
    const id = `rIdPlotLink${index + 2}`;
    cells.push(`<${prefix}hyperlink ref="G${index + 2}" r:id="${id}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" />`);
    relationships.push(`<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xmlAttribute(record.listingUrl)}" TargetMode="External" Id="${id}" />`);
  }
  const hyperlinks=`<${prefix}hyperlinks>${cells.join('')}</${prefix}hyperlinks>`;
  if(hyperlinkBlock.test(sheetXml)) sheetXml=sheetXml.replace(hyperlinkBlock,hyperlinks);
  else {
    const anchor=sheetXml.match(/<(?:[A-Za-z0-9_]+:)?(?:printOptions|pageMargins|pageSetup|headerFooter|rowBreaks|colBreaks|drawing|tableParts|extLst)\b/u)?.index;
    if(anchor!==undefined) sheetXml=sheetXml.slice(0,anchor)+hyperlinks+sheetXml.slice(anchor);
    else sheetXml=sheetXml.replace(/<\/(?:[A-Za-z0-9_]+:)?worksheet>/u,`${hyperlinks}$&`);
  }
  relationshipsXml = relationshipsXml.replace(/<Relationship\b[^>]*\/>/gu, (entry) =>
    /\bType="[^"]*\/hyperlink"/u.test(entry) ? "" : entry,
  );
  if (!relationshipsXml.includes("</Relationships>")) throw new Error("Hyperlink-Prüfung fehlgeschlagen: Beziehungsdatei ungültig.");
  relationshipsXml = relationshipsXml.replace("</Relationships>", `${relationships.join("")}</Relationships>`);
  archive.file(sheetPath, sheetXml);
  archive.file(relationshipsPath, relationshipsXml);
  await fs.writeFile(file, await archive.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}

async function downloadPdf(url, destination, log) {
  if (!publicUrl(url)) throw new Error('PUBLIC_PDF_URL_REQUIRED');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: controller.signal,
      headers: { "user-agent": "Grundstuecksmonitor/1.0 (+lokaler Marketingworkflow)" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (Number(response.headers.get('content-length'))>25*1024*1024) throw new Error('PDF_TOO_LARGE');
    const chunks=[]; let size=0;
    for await (const chunk of response.body) {
      size+=chunk.length;
      if(size>25*1024*1024) throw new Error('PDF_TOO_LARGE');
      chunks.push(chunk);
    }
    const bytes = new Uint8Array(Buffer.concat(chunks));
    const contentType = response.headers.get("content-type") ?? "";
    const isPdf =
      contentType.toLowerCase().includes("application/pdf") &&
      Buffer.from(bytes.slice(0, 5)).toString("ascii") === "%PDF-";
    if (!isPdf) throw new Error(`Kein echtes PDF (Content-Type: ${contentType || "unbekannt"})`);
    const tmp = `${destination}.download-${process.pid}`;
    await fs.writeFile(tmp, bytes, { flag: "wx" });
    try {
      const existing = await sha256(destination);
      const incoming = await sha256(tmp);
      if (existing === incoming) {
        await fs.unlink(tmp);
        log(`Exposé unverändert, nicht erneut gespeichert: ${path.basename(destination)}`);
        return { downloaded: false, unchanged: true };
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await fs.rename(tmp, destination);
    log(`Exposé gespeichert: ${path.basename(destination)}`);
    return { downloaded: true, unchanged: false };
  } finally {
    clearTimeout(timeout);
  }
}

async function acquireLock(lockPath) {
  try {
    return await fs.open(lockPath, "wx");
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const stat = await fs.stat(lockPath);
    if (Date.now() - stat.mtimeMs > 6 * 60 * 60 * 1000) {
      const stalePath = `${lockPath}.stale-${runStamp()}`;
      await fs.rename(lockPath, stalePath);
      return fs.open(lockPath, "wx");
    }
    throw new Error(`Lauf bereits aktiv: ${lockPath}`);
  }
}

async function validateWorkbook(file, expectedRows, validationDir) {
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(file));
  const sheet = workbook.worksheets.getItem("Grundstücke");
  const headerValues = sheet.getRange("A1:L1").values[0];
  if (JSON.stringify(headerValues) !== JSON.stringify(HEADERS)) {
    throw new Error("Validierung fehlgeschlagen: Spaltenreihenfolge ist beschädigt.");
  }
  const data = sheet.getRange(`A2:L${Math.max(2, expectedRows + 1)}`).values;
  const populated = data.filter((row) => row.some((cell) => cell !== null && cell !== ""));
  if (populated.length !== expectedRows) {
    throw new Error(
      `Validierung fehlgeschlagen: ${populated.length} statt ${expectedRows} Datenzeilen.`,
    );
  }
  const errors = await workbook.inspect({
    kind: "match",
    searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
    options: { useRegex: true, maxResults: 100 },
    summary: "Formelfehlerprüfung",
  });
  if (
    !/No records matched|Cell search matched 0 entries|^\s*$/m.test(
      errors.ndjson ?? "",
    )
  ) {
    throw new Error(`Validierung fehlgeschlagen: Formelfehler erkannt.\n${errors.ndjson}`);
  }
  await fs.mkdir(validationDir, { recursive: true });
  for (const sheetName of ["Grundstücke", "Suchgebiet", "Regeln"]) {
    const preview = await workbook.render({
      sheetName,
      autoCrop: "all",
      scale: 1,
      format: "png",
    });
    await fs.writeFile(
      path.join(validationDir, `${safeFilePart(sheetName)}.png`),
      new Uint8Array(await preview.arrayBuffer()),
    );
  }
  return workbook.inspect({
    kind: "table",
    sheetId: "Grundstücke",
    range: `A1:L${Math.min(expectedRows + 1, 30)}`,
    include: "values,formulas",
    maxChars: 12000,
    tableMaxRows: 30,
    tableMaxCols: 12,
  });
}

const args = parseArgs(process.argv);
const startedAt = new Date();
const stamp = runStamp(startedAt);
const targetDir = await assertLocalPlotPath(args.targetDir);
const workbookPath = path.join(targetDir, "KI_Grundstuecke.xlsx");
const exposesDir = path.join(targetDir, "Exposes");
const logsDir = path.join(targetDir, "Logs");
const backupsDir = path.join(targetDir, "Backups");
const validationDir = path.join(logsDir, `${stamp}_Validierung`);
const lockPath = path.join(targetDir, ".grundstuecksmonitor.lock");
const logPath = path.join(logsDir, `${stamp}.log`);
for (const destination of [workbookPath, exposesDir, logsDir, backupsDir]) await assertLocalPlotPath(destination);
if (args.preflight || args.plan) {
  const before = crypto.createHash('sha256').update(await fs.readFile(workbookPath)).digest('hex');
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(workbookPath));
  const active = parseActivePostalCodes(workbook.worksheets.getItem('Suchgebiet').getUsedRange().values, {expectedCount:50});
  const rows = workbook.worksheets.getItem('Grundstücke').getUsedRange().values.slice(1).filter(row => row.some(v=>v!==null && v!==''));
  const sources = readActiveSources(workbook.worksheets.getItem('Quellen').getUsedRange().values);
  const reviewRows=workbook.worksheets.getItem('Müssen geprüft werden').getUsedRange().values.filter(r=>r.some(v=>v!==null&&v!==''));
  const after = crypto.createHash('sha256').update(await fs.readFile(workbookPath)).digest('hex');
  if (before !== after) throw new Error('SOURCE_CHANGED_DURING_READ');
  console.log(JSON.stringify({mode:args.plan?'read-only-plan':'read-only-preflight',workbookPath,sourceSha256:before,activePostalCodeCount:active.size,plotRows:rows.length,reviewRows:Math.max(0,reviewRows.length-1),activeSources:sources.length,mutationsPersisted:false,
    ...(args.plan?{sources,activePostalCodes:[...active],existingDetails:[...rows,...reviewRows.slice(1)].map(r=>({postalCode:zip(r[0]),url:String(r[6]??''),internalId:String(r[11]??'')})).filter(r=>active.has(r.postalCode)&&/^https?:/u.test(r.url))}:{} )}));
  process.exit(0);
}
await assertLocalPlotPath(path.resolve(args.input));
const logLines = [];
const log = (message) => {
  const line = `[${new Date().toISOString()}] ${message}`;
  logLines.push(line);
  console.log(line);
};

if (!args.dryRun) {
  await fs.mkdir(targetDir, { recursive: true });
  await fs.mkdir(exposesDir, { recursive: true });
  await fs.mkdir(logsDir, { recursive: true });
  await fs.mkdir(backupsDir, { recursive: true });
}
const lockHandle = args.dryRun ? null : await acquireLock(lockPath);
let completed = false;
const stats = {
  sourcesChecked: 0,
  offersFound: 0,
  newOffers: 0,
  updatedOffers: 0,
  stillAvailable: 0,
  unavailable: 0,
  exposesDownloaded: 0,
  skipped: 0,
  errors: 0,
  reviewed: 0,
  rejected: 0,
};
let coverage;
const priceChanges=[];
const reviewUpdates=[];
const resolvedOffers=[];
let sourceHash='';

try {
  await lockHandle?.writeFile(
    JSON.stringify({ pid: process.pid, startedAt: startedAt.toISOString(), input: args.input }),
  );
  log(`Startzeit: ${startedAt.toISOString()} (Zeitzone Europe/Berlin)`);
  log(`Zielordner: ${targetDir}`);

  const payload = validatePayload(JSON.parse(await fs.readFile(path.resolve(args.input), "utf8")));
  const sourceChecks = Array.isArray(payload.sourceChecks) ? payload.sourceChecks : [];
  const offers = Array.isArray(payload.offers) ? payload.offers : [];
  for (const source of sourceChecks) {
    log(`Quelle gemeldet ${source.status}: ${source.name}${source.note ? ` – ${source.note}` : ""}`);
    if (source.status === "error") stats.errors += 1;
  }

  sourceHash=await sha256(workbookPath);
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(workbookPath));
  const sources=readActiveSources(workbook.worksheets.getItem('Quellen').getUsedRange().values);
  coverage=sourceCoverage(sources,sourceChecks,startedAt.toISOString());
  stats.sourcesChecked=coverage.counts.successful;
  const builderRows=workbook.worksheets.getItem('Hausbaufirmen').getUsedRange().values;
  const houseBuilders=builderRows.slice(1).filter(r=>String(r[1]).toLowerCase()==='ja').map(r=>String(r[0]));
  const listingSheet = workbook.worksheets.getItem("Grundstücke");
  if (workbook.worksheets.getItemAt(0).name !== "Grundstücke") {
    throw new Error("Grundstücksblatt ist nicht das erste Tabellenblatt; Hyperlinks können nicht sicher zugeordnet werden.");
  }
  const areaSheet = workbook.worksheets.getItem("Suchgebiet");

  const areaValues = areaSheet.getUsedRange().values;
  const activePostalCodes = parseActivePostalCodes(areaValues, {expectedCount:50});
  coverage=sourceCoverage(sources,sourceChecks,startedAt.toISOString(),activePostalCodes);
  stats.sourcesChecked=coverage.counts.successful;
  log(`Aktive Postleitzahlen: ${activePostalCodes.size}`);

  const usedRange = listingSheet.getUsedRange();
  const existingValues = usedRange.values;
  const existingFormulas = usedRange.formulasR1C1;
  if (JSON.stringify(existingValues[0]?.slice(0, 12)) !== JSON.stringify(HEADERS)) {
    throw new Error("Spaltenreihenfolge der Grundstücksliste ist beschädigt.");
  }
  const headers=[...(existingValues[0]||HEADERS)];
  for(const header of META_HEADERS) if(!headers.includes(header)) headers.push(header);
  const extraColumnCount = Math.max(0, headers.length - 12);
  const setMeta=(record,header,value)=>{
    const index=headers.indexOf(header)-12;
    record.extraValues ||= [];
    record.extraValues[index]=value;
    record.extraFormulas ||= [];
    record.extraFormulas[index]='';
  };
  const records = existingValues.slice(1).flatMap((values, index) => {
    if (!values.some((cell) => cell !== null && cell !== "")) return [];
    const record = rowObject(values, existingFormulas[index + 1] ?? []);
    if (!record.internalId && !record.listingUrl) {
      throw new Error(`Grundstück in Zeile ${index + 2} ohne Interne ID und Inseratslink: Schreibvorgang abgebrochen.`);
    }
    return [record];
  });
  log(`Bestehende Datensätze vor Lauf: ${records.length}`);

  const today = dateAtNoonUtc(isoDay(startedAt));
  for (const raw of offers) {
    try {
      if(activePostalCodes.has(raw.postalCode)) stats.offersFound++;
      const assessment=assessOffer(raw,{activePostalCodes,houseBuilders,now:startedAt.toISOString()});
      if(assessment.decision!=='accepted') {
        if(assessment.decision==='rejected') stats.rejected++;
        else stats.reviewed++;
        reviewUpdates.push({offer:raw,...assessment,nextAction:nextAction(assessment.reasons)});
        continue;
      }
      const offer = {
        postalCode: zip(raw.postalCode),
        city: String(raw.city ?? "").trim(),
        street: String(raw.street ?? "").trim(),
        sizeSqm: number(raw.sizeSqm),
        priceEur: number(raw.priceEur),
        source: String(raw.source ?? "").trim(),
        listingUrl: String(raw.listingUrl ?? "").trim(),
        internalId: String(raw.internalId ?? "").trim(),
        available: raw.available,
        availabilityEvidence: String(raw.availabilityEvidence ?? "").trim(),
        exposeUrl: String(raw.exposeUrl ?? "").trim(),
      };
      if (!activePostalCodes.has(offer.postalCode)) {
        stats.skipped += 1;
        log(`Übersprungen – PLZ nicht aktiv: ${offer.internalId || offer.listingUrl}`);
        continue;
      }
      if (
        !offer.city ||
        !offer.street ||
        !Number.isFinite(offer.sizeSqm) ||
        offer.sizeSqm <= 0 ||
        !Number.isFinite(offer.priceEur) ||
        offer.priceEur <= 0 ||
        !offer.source ||
        !/^https?:\/\//i.test(offer.listingUrl) ||
        (!offer.internalId && !offer.listingUrl)
      ) {
        stats.skipped += 1;
        log(`Übersprungen – Pflichtfelder unvollständig: ${offer.internalId || offer.listingUrl}`);
        continue;
      }
      if (!offer.available && !OFFLINE_EVIDENCE.test(offer.availabilityEvidence)) {
        stats.skipped += 1;
        log(
          `Übersprungen – Offline-Status nicht belastbar belegt: ${offer.internalId || offer.listingUrl}`,
        );
        continue;
      }

      const matchIndex = findMatch(records, offer);
      const existing = matchIndex >= 0 ? records[matchIndex] : null;
      const record = existing ?? {
        postalCode: offer.postalCode,
        city: offer.city,
        street: offer.street,
        sizeSqm: offer.sizeSqm,
        priceEur: offer.priceEur,
        source: offer.source,
        listingUrl: offer.listingUrl,
        firstFound: today,
        lastChecked: today,
        status: "Neu",
        exposeFilename: "",
        internalId: offer.internalId,
      };

      if (existing) {
        const street = hasHouseNumber(existing.street) && !hasHouseNumber(offer.street)
          ? existing.street
          : offer.street;
        const changed =
          existing.priceEur !== offer.priceEur ||
          existing.sizeSqm !== offer.sizeSqm ||
          normalize(existing.street) !== normalize(street) ||
          normalize(existing.city) !== normalize(offer.city);
        if (record.priceEur!==offer.priceEur) priceChanges.push({internalId:record.internalId||offer.internalId,listingUrl:record.listingUrl,previousPriceEur:record.priceEur,priceEur:offer.priceEur,checkedAt:raw.checkedAt});
        record.postalCode = offer.postalCode;
        record.city = offer.city;
        record.street = street;
        record.sizeSqm = offer.sizeSqm;
        record.priceEur = offer.priceEur;
        record.source = offer.source;
        record.listingUrl = offer.listingUrl;
        record.internalId = offer.internalId || record.internalId;
        record.lastChecked = today;
        if (changed) stats.updatedOffers += 1;
        else stats.stillAvailable += offer.available ? 1 : 0;
      } else {
        records.push(record);
        stats.newOffers += 1;
      }

      record.status = offer.available
        ? statusFor(record.firstFound, today)
        : "Nicht mehr vorhanden";
      if (!offer.available) stats.unavailable += 1;
      resolvedOffers.push({...offer,checkedAt:raw.checkedAt});
      setMeta(record,'Fachprüfung',offer.available?'Nachweise vollständig':'Offline belegt');
      setMeta(record,'Prüfgründe','');
      setMeta(record,'Letzter Prüfversuch',new Date(raw.checkedAt));
      if(headers.includes('Anbieter') && raw.providerName) setMeta(record,'Anbieter',raw.providerName);

      if (!args.dryRun && offer.available && offer.exposeUrl) {
        const exposeName = [
          safeFilePart(record.postalCode),
          safeFilePart(record.city),
          safeFilePart(record.street || "ohne_Strasse"),
          safeFilePart(record.internalId),
        ]
          .filter(Boolean)
          .join("_")
          .concat(".pdf");
        try {
          const result = await downloadPdf(
            offer.exposeUrl,
            path.join(exposesDir, exposeName),
            log,
          );
          record.exposeFilename = exposeName;
          if (result.downloaded) stats.exposesDownloaded += 1;
        } catch (error) {
          stats.errors += 1;
          log(`Exposé-Fehler ${offer.exposeUrl}: ${error.message}`);
        }
      }
    } catch (error) {
      stats.errors += 1;
      log(`Angebotsfehler – Lauf wird fortgesetzt: ${error.message}`);
    }
  }

  for (const record of records) {
    if (record.status !== "Nicht mehr vorhanden") {
      record.status = statusFor(record.firstFound, today);
    }
    setMeta(record,'Aktualität',freshness(record.lastChecked,startedAt.toISOString(),record.status!=='Nicht mehr vorhanden'));
    const review=reviewUpdates.find(r=>(r.offer.internalId&&r.offer.internalId===record.internalId)||r.offer.listingUrl===record.listingUrl);
    if(review) {
      setMeta(record,'Fachprüfung',review.decision==='rejected'?'Ausschluss prüfen – Bestand geschützt':'Prüfung erforderlich');
      setMeta(record,'Prüfgründe',review.reasons.map(reasonText).join('; '));
      setMeta(record,'Letzter Prüfversuch',new Date(startedAt));
    } else if(!record.extraValues?.[headers.indexOf('Fachprüfung')-12]) setMeta(record,'Fachprüfung','Bestand – Nachweise erneut prüfen');
  }
  const statusRank = { Neu: 0, Vorhanden: 1, "Nicht mehr vorhanden": 2 };
  records.sort((a, b) => {
    const statusDiff = statusRank[a.status] - statusRank[b.status];
    if (statusDiff) return statusDiff;
    const relevantA = a.status === "Neu" ? a.firstFound : a.lastChecked;
    const relevantB = b.status === "Neu" ? b.firstFound : b.lastChecked;
    return dateValue(relevantB) - dateValue(relevantA);
  });

  listingSheet.getRange("A1:L1").values = [HEADERS];
  listingSheet.getRange(`A1:${columnLabel(headers.length-1)}1`).values=[headers];
  const firstMeta=headers.indexOf(META_HEADERS[0]);
  listingSheet.getRange(`${columnLabel(firstMeta)}1:${columnLabel(headers.length-1)}1`).format={fill:'#1F4E78',font:{bold:true,color:'#FFFFFF'},wrapText:true};
  listingSheet.getRange(`${columnLabel(firstMeta)}:${columnLabel(headers.length-1)}`).format.columnWidth=32;
  listingSheet.getRange("A2:L10000").clear({ applyTo: "contents" });
  if (extraColumnCount > 0) {
    const lastExtraColumn = columnLabel(11 + extraColumnCount);
    listingSheet.getRange(`M2:${lastExtraColumn}10000`).clear({ applyTo: "contents" });
  }
  if (records.length > 0) {
    listingSheet.getRange(`A2:L${records.length + 1}`).values = records.map(toRow);
    if (extraColumnCount > 0) {
      const lastExtraColumn = columnLabel(11 + extraColumnCount);
      listingSheet.getRange(`M2:${lastExtraColumn}${records.length + 1}`).values = records.map((record) =>
        Array.from({ length: extraColumnCount }, (_, index) => record.extraValues?.[index] ?? null),
      );
      for (const [recordIndex, record] of records.entries()) {
        for (const [extraIndex, formula] of (record.extraFormulas ?? []).entries()) {
          if (typeof formula === "string" && formula.startsWith("=")) {
            listingSheet.getCell(recordIndex + 1, extraIndex + 12).formulasR1C1 = [[formula]];
          }
        }
      }
    }
  }
  listingSheet.getRange("A2:A10000").setNumberFormat("@");
  listingSheet.getRange("D2:D10000").setNumberFormat("#,##0");
  listingSheet.getRange("E2:E10000").setNumberFormat('#,##0" €"');
  listingSheet.getRange("H2:I10000").setNumberFormat("yyyy-mm-dd");
  listingSheet.getRange("J2:J10000").dataValidation = {
    rule: { type: "list", values: ["Neu", "Vorhanden", "Nicht mehr vorhanden"] },
  };
  listingSheet.getRange("G:G").format.columnWidth = 48;
  listingSheet.getRange("K:K").format.columnWidth = 38;
  listingSheet.getRange("L:L").format.columnWidth = 44;
  if (records.length > 0) {
    listingSheet.getRange(`A2:L${records.length + 1}`).format.rowHeightPx = 48;
    listingSheet.getRange(`A2:L${records.length + 1}`).format.verticalAlignment = "center";
    listingSheet.getRange(`G2:G${records.length + 1}`).format.wrapText = true;
    listingSheet.getRange(`K2:L${records.length + 1}`).format.wrapText = true;
  }
  const dataRange = listingSheet.getRange("A2:L10000");
  dataRange.conditionalFormats.deleteAll();
  dataRange.conditionalFormats.addCustom('=$J2="Neu"', {
    fill: "#C6EFCE",
    font: { color: "#006100" },
  });
  dataRange.conditionalFormats.addCustom('=$J2="Vorhanden"', {
    fill: "#FFEB9C",
    font: { color: "#9C6500" },
  });
  dataRange.conditionalFormats.addCustom('=$J2="Nicht mehr vorhanden"', {
    fill: "#FFC7CE",
    font: { color: "#9C0006" },
  });
  areaSheet.getRange("A2:A1000").setNumberFormat("@");
  areaSheet.getRange("D2:D1000").dataValidation = {
    rule: { type: "list", values: ["Ja", "Nein"] },
  };

  // Keep existing review rows and add a concrete next action. No deletion of historical cases.
  const reviewSheet=workbook.worksheets.getItem('Müssen geprüft werden');
  const reviewValues=reviewSheet.getUsedRange().values;
  const reviewHeaders=reviewValues[0]?.length ? [...reviewValues[0]] : [...HEADERS,'Anbieter','Prüfgrund','Ursprungszeile'];
  for(const h of ['Nächster Schritt','Letzter Prüfversuch']) if(!reviewHeaders.includes(h)) reviewHeaders.push(h);
  const reviewRecords=reviewValues.slice(1).filter(r=>r.some(v=>v!==null&&v!=='' )).map(r=>[...r]);
  for(const row of reviewRecords) {
    const reasons=reviewReasonFromLegacy(row[reviewHeaders.indexOf('Prüfgrund')]);
    row[reviewHeaders.indexOf('Nächster Schritt')] ||= nextAction(activePostalCodes.has(zip(row[0]))?reasons:['outside_search_area']);
    const resolved=resolvedOffers.find(o=>(o.internalId&&o.internalId===row[11])||o.listingUrl===row[6]);
    if(resolved) {
      row[reviewHeaders.indexOf('Prüfgrund')]=resolved.available?'Nachweise vollständig – in Grundstücksliste übernommen':'Nicht mehr vorhanden – offline belegt';
      row[reviewHeaders.indexOf('Nächster Schritt')]='Abgeschlossen – Historie erhalten';
      row[reviewHeaders.indexOf('Letzter Prüfversuch')]=new Date(resolved.checkedAt);
    }
  }
  for(const review of reviewUpdates) {
    const offer=review.offer;
    const existing=reviewRecords.find(r=>(offer.internalId&&r[11]===offer.internalId)||r[6]===offer.listingUrl);
    const row=existing || [offer.postalCode,offer.city,offer.street||'',offer.sizeSqm,offer.priceEur,offer.source,offer.listingUrl,today,null,'Vorhanden','',offer.internalId,offer.providerName||''];
    row[reviewHeaders.indexOf('Prüfgrund')]=review.reasons.map(reasonText).join('; ');
    row[reviewHeaders.indexOf('Nächster Schritt')]=review.nextAction;
    row[reviewHeaders.indexOf('Letzter Prüfversuch')]=new Date(startedAt);
    if(!existing) reviewRecords.push(row);
  }
  reviewSheet.getRange(`A1:${columnLabel(reviewHeaders.length-1)}${reviewRecords.length+1}`).values=[reviewHeaders,...reviewRecords.map(r=>Array.from({length:reviewHeaders.length},(_,i)=>r[i]??null))];
  reviewSheet.getRange(`A1:${columnLabel(reviewHeaders.length-1)}${reviewRecords.length+1}`).format.wrapText=true;
  const actionColumn=columnLabel(reviewHeaders.indexOf('Nächster Schritt'));
  const attemptColumn=columnLabel(reviewHeaders.indexOf('Letzter Prüfversuch'));
  reviewSheet.getRange(`${actionColumn}:${actionColumn}`).format.columnWidth=62;
  reviewSheet.getRange(`${attemptColumn}:${attemptColumn}`).format.columnWidth=22;
  reviewSheet.getRange(`${actionColumn}1:${attemptColumn}1`).format={fill:'#833C0C',font:{bold:true,color:'#FFFFFF'},wrapText:true};
  reviewSheet.getRange(`${attemptColumn}2:${attemptColumn}${Math.max(2,reviewRecords.length+1)}`).setNumberFormat('yyyy-mm-dd hh:mm');
  const attemptMainColumn=columnLabel(headers.indexOf('Letzter Prüfversuch'));
  listingSheet.getRange(`${attemptMainColumn}2:${attemptMainColumn}${Math.max(2,records.length+1)}`).setNumberFormat('yyyy-mm-dd hh:mm');

  const sourceSheet=workbook.worksheets.getItem('Quellen');
  const sourceValues=sourceSheet.getUsedRange().values;
  for(let i=1;i<sourceValues.length;i++) {
    const item=coverage.items.find(s=>s.name===String(sourceValues[i][0]??''));
    if(!item) continue;
    if(item.checkedAt) sourceSheet.getCell(i,5).values=[[new Date(item.checkedAt)]];
    sourceSheet.getCell(i,6).values=[[`${item.status}: ${item.note||'Kein aktueller Prüfnachweis'}`]];
  }
  // Recompute this view from the current list; old summary counts must not survive a run.
  const plzSheet=workbook.worksheets.getItem('PLZ-Angebote');
  let covered=0;
  const plzRows=[...activePostalCodes].sort().map(postalCode=>{
    const candidates=records.filter(r=>r.postalCode===postalCode&&r.status!=='Nicht mehr vorhanden');
    const current=candidates.filter(r=>freshness(r.lastChecked,startedAt.toISOString())==='Aktuell online bestätigt');
    const record=current[0]||candidates[0];
    if(current.length) covered++;
    const region=areaValues.find(r=>zip(r[0])===postalCode)?.[1]||'';
    return [postalCode,region,record?.street||'',record?.sizeSqm||null,record?.priceEur||null,
      record?.source||'',record?.listingUrl||'',current.length?'Aktueller Detailnachweis':'Bestand ungeprüft',
      current.length?'Aktuell belegt':'Recherchebedarf',`${candidates.length} gespeichert, ${current.length} aktuell belegt`];
  });
  plzSheet.getRange('C3:D3').values=[[covered,activePostalCodes.size-covered]];
  plzSheet.getRange('A3:B3').values=[['PLZ aktuell belegt','PLZ mit Recherchebedarf']];
  plzSheet.getRange(`A5:J${plzRows.length+4}`).values=plzRows;
  plzSheet.getRange('A:A').setNumberFormat('@');

  const summary={mode:args.dryRun?'read-only-simulation':'monitor-run',mutationsPersisted:!args.dryRun,
    startedAt:startedAt.toISOString(),sourceSha256:sourceHash,coverage:coverage.counts,
    coverageComplete:coverage.complete,unknownSourceChecks:coverage.unknownChecks,
    stats,reviewRows:reviewRecords.length,priceChanges:priceChanges.length,
    status:coverage.complete&&stats.errors===0?'complete':'partial'};
  if(args.dryRun) {
    if(await sha256(workbookPath)!==sourceHash) throw new Error('SOURCE_CHANGED_DURING_READ');
    completed=true;
    console.log(JSON.stringify(summary));
  } else {

  const tempWorkbook = path.join(targetDir, `.KI_Grundstuecke.${stamp}.tmp.xlsx`);
  workbook.recalculate();
  const output = await SpreadsheetFile.exportXlsx(workbook);
  await output.save(tempWorkbook);
  await alignListingHyperlinks(tempWorkbook, records);
  const tmpHandle = await fs.open(tempWorkbook, "r");
  await tmpHandle.sync();
  await tmpHandle.close();

  const inspection = await validateWorkbook(tempWorkbook, records.length, validationDir);
  log(`Validierung erfolgreich: ${records.length} Datensätze.`);
  log(`Prüfbereich: ${inspection.ndjson.replace(/\s+/g, " ").slice(0, 800)}`);

  const backupPath = path.join(backupsDir, `KI_Grundstuecke_${stamp}.xlsx`);
  if(await sha256(workbookPath)!==sourceHash) throw new Error('SOURCE_CHANGED_BEFORE_COMMIT');
  await fs.copyFile(workbookPath, backupPath, fs.constants.COPYFILE_EXCL);
  log(`Sicherung erstellt: ${backupPath}`);
  await fs.rename(tempWorkbook, workbookPath);
  log(`Arbeitsmappe atomisch ersetzt: ${workbookPath}`);
  await fs.writeFile(path.join(logsDir,`${stamp}_report.json`),JSON.stringify({...summary,coverageDetails:coverage.items,priceHistory:priceChanges},null,2),{mode:0o600,flag:'wx'});

  completed = true;
  console.log(JSON.stringify(summary));
  }
} catch (error) {
  stats.errors += 1;
  log(`ABBRUCH: ${error.stack || error.message}`);
  throw error;
} finally {
  const endedAt = new Date();
  log(`Endzeit: ${endedAt.toISOString()}`);
  log(`Geprüfte Quellen: ${stats.sourcesChecked}`);
  log(`Gefundene Angebote: ${stats.offersFound}`);
  log(`Neue Grundstücke: ${stats.newOffers}`);
  log(`Aktualisierte Grundstücke: ${stats.updatedOffers}`);
  log(`Weiterhin vorhanden: ${stats.stillAvailable}`);
  log(`Nicht mehr vorhanden: ${stats.unavailable}`);
  log(`Heruntergeladene Exposés: ${stats.exposesDownloaded}`);
  log(`Übersprungen: ${stats.skipped}`);
  log(`Fehler: ${stats.errors}`);
  log(`Laufstatus: ${completed ? (coverage?.complete&&stats.errors===0?'VOLLSTÄNDIG':'TEILSTAND') : "FEHLGESCHLAGEN"}`);
  if(!args.dryRun) {
    try {await fs.writeFile(logPath, `${logLines.join("\n")}\n`, {encoding:'utf8',mode:0o600});}
    finally {await lockHandle?.close(); await fs.unlink(lockPath).catch(() => {});}
  }
}
