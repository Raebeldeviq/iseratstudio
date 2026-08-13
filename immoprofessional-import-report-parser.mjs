import { createHash } from "node:crypto";

import { IMMOPROFESSIONAL_FTPS_HOST } from "./ftp-config.mjs";

export const IMMOPROFESSIONAL_IMPORT_REPORT_SUBJECT = "Importbericht OpenImmo XML";
export const IMMOPROFESSIONAL_IMPORT_REPORT_SENDER = "Fabian&Pascal Inseratestudio";
export const IMMOPROFESSIONAL_IMPORT_REPORT_PROVIDER_ID = "30460";
export const IMMOPROFESSIONAL_IMPORT_REPORT_PARSER_VERSION = "1.0.0";

function normalizeNewlines(value) {
  return String(value ?? "").replace(/\r\n?/gu, "\n");
}

function splitHeaderAndBody(raw) {
  const normalized = normalizeNewlines(raw);
  const separator = normalized.indexOf("\n\n");
  if (separator < 0) throw new Error("Die E-Mail besitzt keinen vollständigen Header-/Body-Übergang.");
  return { header: normalized.slice(0, separator), body: normalized.slice(separator + 2) };
}

function decodeMimeWord(match, charset, encoding, content) {
  const bytes = String(encoding).toUpperCase() === "B"
    ? Buffer.from(content, "base64")
    : Buffer.from(content.replace(/_/gu, " ").replace(/=([0-9A-F]{2})/giu, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16))), "binary");
  try {
    return new TextDecoder(String(charset || "utf-8").toLowerCase()).decode(bytes);
  } catch {
    return bytes.toString("utf8");
  }
}

function decodeHeaderValue(value) {
  return String(value || "").replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/giu, decodeMimeWord);
}

export function parseRfc822Headers(headerText) {
  const unfolded = normalizeNewlines(headerText).replace(/\n[\t ]+/gu, " ");
  const headers = new Map();
  for (const line of unfolded.split("\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = decodeHeaderValue(line.slice(separator + 1).trim());
    headers.set(name, [...(headers.get(name) || []), value]);
  }
  return headers;
}

function header(headers, name) {
  return (headers.get(String(name).toLowerCase()) || [""])[0];
}

function headerValues(headers, name) {
  return headers.get(String(name).toLowerCase()) || [];
}

function contentType(value) {
  const source = String(value || "text/plain");
  const type = source.split(";", 1)[0].trim().toLowerCase();
  const parameter = (name) => {
    const match = source.match(new RegExp(`(?:^|;)\\s*${name}\\s*=\\s*(?:"([^"]+)"|([^;\\s]+))`, "iu"));
    return String(match?.[1] || match?.[2] || "");
  };
  return { type, boundary: parameter("boundary"), charset: parameter("charset") || "utf-8" };
}

function decodeTransferBody(body, encoding, charset) {
  const normalizedEncoding = String(encoding || "").trim().toLowerCase();
  let bytes;
  if (normalizedEncoding === "base64") {
    const compact = String(body).replace(/\s/gu, "");
    if (!compact || !/^[a-zA-Z0-9+/]*={0,2}$/u.test(compact)) throw new Error("Der Base64-MIME-Teil ist beschädigt.");
    bytes = Buffer.from(compact, "base64");
  } else if (normalizedEncoding === "quoted-printable") {
    const unfolded = String(body).replace(/=\r?\n/gu, "");
    const binary = unfolded.replace(/=([0-9A-F]{2})/giu, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
    bytes = Buffer.from(binary, "binary");
  } else if (!normalizedEncoding || ["7bit", "8bit", "binary"].includes(normalizedEncoding)) {
    bytes = Buffer.from(String(body), "utf8");
  } else {
    throw new Error(`Unbekannte MIME-Transferkodierung: ${normalizedEncoding}`);
  }
  try {
    return new TextDecoder(String(charset || "utf-8").toLowerCase()).decode(bytes);
  } catch {
    return bytes.toString("utf8");
  }
}

function splitMultipart(body, boundary) {
  if (!boundary) throw new Error("Der Multipart-Mail fehlt die MIME-Grenze.");
  const normalized = normalizeNewlines(body);
  const delimiter = `--${boundary}`;
  const closing = `--${boundary}--`;
  if (!normalized.includes(delimiter) || !normalized.includes(closing)) {
    throw new Error("Die Multipart-MIME-Struktur ist unvollständig.");
  }
  return normalized
    .split(delimiter)
    .slice(1)
    .map((part) => part.replace(/^\n/gu, ""))
    .filter((part) => !part.startsWith("--") && part.trim());
}

function extractMimeText(headerText, bodyText) {
  const headers = parseRfc822Headers(headerText);
  const type = contentType(header(headers, "content-type"));
  if (type.type.startsWith("multipart/")) {
    const contents = splitMultipart(bodyText, type.boundary).map((part) => {
      const split = splitHeaderAndBody(part);
      return extractMimeText(split.header, split.body);
    });
    return {
      plain: contents.map((item) => item.plain).find(Boolean) || "",
      html: contents.map((item) => item.html).find(Boolean) || "",
    };
  }
  const decoded = decodeTransferBody(bodyText, header(headers, "content-transfer-encoding"), type.charset);
  if (type.type === "text/plain") return { plain: decoded, html: "" };
  if (type.type === "text/html") return { plain: "", html: decoded };
  return { plain: "", html: "" };
}

function htmlToText(value) {
  return String(value || "")
    .replace(/<(?:br\s*\/?|\/p|\/div|\/li|\/tr)>/giu, "\n")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, "")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&quot;/giu, "\"")
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&#(\d+);/gu, (_, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/[ \t]+/gu, " ")
    .replace(/\n\s+/gu, "\n")
    .trim();
}

export function zonedLocalToIso(parts, timeZone = "Europe/Berlin") {
  const wanted = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
  let candidate = wanted;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const formattedParts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(candidate));
    const values = Object.fromEntries(formattedParts.map((part) => [part.type, part.value]));
    const represented = Date.UTC(
      Number(values.year), Number(values.month) - 1, Number(values.day),
      Number(values.hour), Number(values.minute), Number(values.second),
    );
    candidate += wanted - represented;
  }
  const iso = new Date(candidate).toISOString();
  const verification = new Intl.DateTimeFormat("de-DE", {
    timeZone,
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(iso));
  const expected = `${String(parts.day).padStart(2, "0")}.${String(parts.month).padStart(2, "0")}.${parts.year}, ${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
  if (verification !== expected) throw new Error("Der Importzeitpunkt ist in Europe/Berlin nicht eindeutig.");
  return iso;
}

function requiredMatch(text, expression, label) {
  const matches = [...String(text).matchAll(expression)];
  if (matches.length !== 1) throw new Error(`${label} fehlt oder ist nicht eindeutig.`);
  return String(matches[0][1] || "").trim();
}

function parseReportBody(text) {
  const importDate = [...String(text).matchAll(/eine Importdatei wurde am\s+(\d{2})\.(\d{2})\.(\d{4})\s+um\s+(\d{2}):(\d{2})\s+Uhr\s+verarbeitet\./giu)];
  if (importDate.length !== 1) throw new Error("Der bestätigte Importzeitpunkt fehlt oder ist nicht eindeutig.");
  const [, day, month, year, hour, minute] = importDate[0];
  const senderSoftware = requiredMatch(text, /^Sendersoftware:\s*(.+)$/gimu, "Sendersoftware");
  const objectCount = Number(requiredMatch(text, /^Anzahl Objekte:\s*(\d+)\s*$/gimu, "Objektanzahl"));
  const providerId = requiredMatch(text, /^Anbieter-ID:\s*(\d+)\s*$/gimu, "Anbieter-ID");
  const providerCompany = requiredMatch(text, /^Firma:\s*(.+)$/gimu, "Anbieterfirma");
  const providerEmail = requiredMatch(text, /^E-Mail:\s*([^\s]+)\s*$/gimu, "Anbieter-E-Mail");
  const successMatches = [...String(text).matchAll(/^-\s*OK:\s*Erfolgreich importiert\s*-\s*Objekt-Nr\.:\s*"(30460-\d{6})"\s*$/gimu)];
  if (successMatches.length !== 1) throw new Error("Die eindeutige Immoprofessional-Erfolgszeile fehlt.");
  return {
    providerImportAt: zonedLocalToIso({
      day: Number(day), month: Number(month), year: Number(year),
      hour: Number(hour), minute: Number(minute),
    }),
    senderSoftware,
    objectCount,
    providerId,
    providerCompany,
    providerEmail,
    externalObjectNumber: successMatches[0][1],
    importResult: "success",
  };
}

function validateTransport(headers, trustedHost) {
  const normalizedHost = String(trustedHost || IMMOPROFESSIONAL_FTPS_HOST).trim().toLowerCase();
  const messageId = header(headers, "message-id").trim();
  const messageIdDomain = messageId.match(/@([^>\s]+)>?$/u)?.[1]?.toLowerCase() || "";
  const receivedTrusted = headerValues(headers, "received").some((value) => value.toLowerCase().includes(normalizedHost));
  const spfPassed = [
    ...headerValues(headers, "authentication-results"),
    ...headerValues(headers, "received-spf"),
  ].some((value) => /\bspf\s*=\s*pass\b|^\s*pass\b/iu.test(value));
  if (messageIdDomain !== normalizedHost && !receivedTrusted) {
    throw new Error("Message-ID und SMTP-Transport lassen sich nicht dem konfigurierten Immoprofessional-Host zuordnen.");
  }
  if (!spfPassed) throw new Error("Die Mail enthält keinen bestätigten SPF=pass-Nachweis.");
  return { messageId, messageIdDomain, receivedTrusted, spfPassed, trustedHost: normalizedHost };
}

export function extractImmoprofessionalReportEnvelope(rawValue, options = {}) {
  const raw = Buffer.isBuffer(rawValue) ? rawValue : Buffer.from(String(rawValue ?? ""), "utf8");
  if (!raw.length) throw new Error("Die Raw-Mail ist leer.");
  const rawText = raw.toString("utf8");
  const split = splitHeaderAndBody(rawText);
  const headers = parseRfc822Headers(split.header);
  const subject = header(headers, "subject");
  if (subject !== IMMOPROFESSIONAL_IMPORT_REPORT_SUBJECT) throw new Error("Der Mailbetreff stimmt nicht exakt mit dem Importbericht-Vertrag überein.");
  const transport = validateTransport(headers, options.trustedHost);
  const mime = extractMimeText(split.header, split.body);
  const bodySource = mime.plain ? "text/plain" : mime.html ? "text/html" : "";
  if (!bodySource) throw new Error("Die Mail enthält keinen auswertbaren Plaintext- oder HTML-Teil.");
  const bodyText = mime.plain || htmlToText(mime.html);
  return {
    subject,
    messageId: transport.messageId,
    rawHash: createHash("sha256").update(raw).digest("hex"),
    bodySource,
    bodyText,
    transport,
  };
}

export function parseImmoprofessionalImportReport(rawValue, options = {}) {
  const envelope = extractImmoprofessionalReportEnvelope(rawValue, options);
  const fields = parseReportBody(envelope.bodyText);
  if (fields.senderSoftware !== IMMOPROFESSIONAL_IMPORT_REPORT_SENDER) throw new Error("Die Sendersoftware ist nicht freigegeben.");
  if (fields.providerId !== IMMOPROFESSIONAL_IMPORT_REPORT_PROVIDER_ID) throw new Error("Die Anbieter-ID ist nicht freigegeben.");
  if (fields.objectCount !== 1) throw new Error("Nur ein bestätigter Einzelobjekt-Import darf automatisch verarbeitet werden.");
  return {
    ...fields,
    subject: envelope.subject,
    messageId: envelope.messageId,
    rawHash: envelope.rawHash,
    bodySource: envelope.bodySource,
    transport: envelope.transport,
    parserVersion: IMMOPROFESSIONAL_IMPORT_REPORT_PARSER_VERSION,
  };
}
