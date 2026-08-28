import {
  extractImmoprofessionalReportEnvelope,
  IMMOPROFESSIONAL_IMPORT_REPORT_PROVIDER_ID,
  IMMOPROFESSIONAL_IMPORT_REPORT_SENDER,
  zonedLocalToIso,
} from "./immoprofessional-import-report-parser.mjs";
import { DELETE_CANARY_TARGET } from "./immoprofessional-delete-canary.mjs";
import {
  isValidatedRegression85NonExportedConfirmationContext,
  REGRESSION_85_NON_EXPORTED_CONFIRMATION_TYPE,
} from "./regression-85-non-exported-delete-confirmation.mjs";

export const IMMOPROFESSIONAL_DELETE_REPORT_PARSER_VERSION = "1.1.0";
export const IMMOPROFESSIONAL_EXCHANGE_DELETE_CONFIRMATION_TYPE = "provider_object_and_exchange_delete_confirmed";
export const LIVE_CANARY_DELETE_REPORT_TARGETS = Object.freeze([
  "30460-930980",
  "30460-142086",
  "30460-132376",
]);

function uniqueMatch(text, expression, label) {
  const matches = [...String(text).matchAll(expression)];
  if (matches.length !== 1) throw new Error(`${label} fehlt oder ist nicht eindeutig.`);
  return String(matches[0][1] || "").trim();
}

function parseProcessedAt(text) {
  const matches = [...String(text).matchAll(/eine Importdatei wurde am\s+(\d{2})\.(\d{2})\.(\d{4})\s+um\s+(\d{2}):(\d{2})\s+Uhr\s+verarbeitet\./giu)];
  if (matches.length !== 1) throw new Error("Der Löschbericht enthält keinen eindeutigen Verarbeitungszeitpunkt.");
  const [, day, month, year, hour, minute] = matches[0];
  return zonedLocalToIso({
    day: Number(day),
    month: Number(month),
    year: Number(year),
    hour: Number(hour),
    minute: Number(minute),
  });
}

function parseDeleteBody(text, expectedTarget, confirmationContext) {
  const body = String(text || "")
    .replace(/Ã¶/gu, "ö")
    .replace(/Ã–/gu, "Ö");
  const senderSoftware = uniqueMatch(body, /^Sendersoftware:\s*(.+)$/gimu, "Sendersoftware");
  const objectCount = Number(uniqueMatch(body, /^Anzahl Objekte:\s*(\d+)\s*$/gimu, "Objektanzahl"));
  const providerId = uniqueMatch(body, /^Anbieter-ID:\s*(\d+)\s*$/gimu, "Anbieter-ID");
  const okMatches = [...body.matchAll(/^\s*-?\s*OK:\s*Objekt-Nr\.\s*:\s*"(30460-\d{6})"\s*$/gimu)];
  if (okMatches.length !== 1) throw new Error("Der Löschbericht enthält keine eindeutige OK-Objektzeile.");
  const positiveDeleteMatches = [...body.matchAll(/^\s*-?\s*Erfolgreich\s+gelöscht\s*-?\s*$/gimu)];
  if (positiveDeleteMatches.length !== 1) throw new Error("Der Löschbericht bestätigt die erfolgreiche Löschung nicht eindeutig.");
  const errorOrWarningLines = body.match(/^\s*-?\s*(?:Fehler|Warnung)\s*:.+$/gimu) || [];
  if (errorOrWarningLines.length) throw new Error("Der Löschbericht enthält einen Fehler- oder Warnstatus.");
  const exchangeMatches = [...body.matchAll(/Das Objekt\s+"(30460-\d{6})"\s+wurde aus der Börse\s+"([^"]+)"\s+gelöscht\./giu)];
  const allObjectNumbers = [...new Set(body.match(/30460-\d{6}/gu) || [])];
  const exchangeTargets = [...new Set(exchangeMatches.map((match) => match[1]))];
  const externalObjectNumber = okMatches[0][1];
  if (
    externalObjectNumber !== expectedTarget
    || allObjectNumbers.length !== 1
    || allObjectNumbers[0] !== expectedTarget
  ) {
    throw new Error("Der Löschbericht lässt sich nicht exklusiv der erwarteten alten Objektnummer zuordnen.");
  }
  if (senderSoftware !== IMMOPROFESSIONAL_IMPORT_REPORT_SENDER) throw new Error("Die Sendersoftware ist nicht freigegeben.");
  if (providerId !== IMMOPROFESSIONAL_IMPORT_REPORT_PROVIDER_ID) throw new Error("Die Anbieter-ID ist nicht freigegeben.");
  if (objectCount !== 1) throw new Error("Nur ein bestätigter Einzelobjekt-Delete darf verarbeitet werden.");
  const nonExported = isValidatedRegression85NonExportedConfirmationContext(confirmationContext, expectedTarget);
  if (exchangeMatches.length) {
    if (exchangeTargets.length !== 1 || exchangeTargets[0] !== expectedTarget) {
      throw new Error("Der Löschbericht lässt sich nicht exklusiv der erwarteten alten Objektnummer zuordnen.");
    }
    if (nonExported) {
      throw new Error("Der Börsen-Löschnachweis widerspricht der persistierten Never-exported-Provenienz.");
    }
  } else if (!nonExported) {
    throw new Error("Der Löschbericht enthält keinen eindeutigen Börsen-Löschnachweis.");
  }
  const confirmationType = nonExported
    ? REGRESSION_85_NON_EXPORTED_CONFIRMATION_TYPE
    : IMMOPROFESSIONAL_EXCHANGE_DELETE_CONFIRMATION_TYPE;
  return {
    providerProcessedAt: parseProcessedAt(body),
    senderSoftware,
    objectCount,
    providerId,
    externalObjectNumber,
    deleteResult: "success",
    statusLine: "Erfolgreich gelöscht -",
    deletedFromExchanges: exchangeMatches.map((match) => String(match[2]).trim()),
    confirmationType,
    targetWasNeverPortalExported: nonExported,
    confirmationEvidence: nonExported ? {
      scopeHash: confirmationContext.scopeHash,
      scopeEvidenceHash: confirmationContext.scopeEvidenceHash,
      classificationFingerprint: confirmationContext.classificationFingerprint,
      attestationHash: confirmationContext.attestationHash,
      scopeItemId: confirmationContext.scopeItemId,
      classificationEvidenceHash: confirmationContext.classificationEvidenceHash,
      portalStatuses: confirmationContext.portalStatuses,
    } : null,
    errors: [],
    warnings: [],
  };
}

export function parseImmoprofessionalDeleteReport(rawValue, options = {}) {
  const expectedTarget = String(options.expectedTarget || DELETE_CANARY_TARGET).trim();
  if (!/^30460-\d{6}$/u.test(expectedTarget)) {
    throw new Error("Der Löschberichtparser benötigt eine syntaktisch gültige erwartete Immoprofessional-Objektnummer.");
  }
  const envelope = extractImmoprofessionalReportEnvelope(rawValue, options);
  if (!envelope.messageId) throw new Error("Der Löschbericht besitzt keine eindeutige Message-ID.");
  const fields = parseDeleteBody(envelope.bodyText, expectedTarget, options.confirmationContext);
  return {
    ...fields,
    subject: envelope.subject,
    messageId: envelope.messageId,
    rawHash: envelope.rawHash,
    bodySource: envelope.bodySource,
    transport: envelope.transport,
    parserVersion: IMMOPROFESSIONAL_DELETE_REPORT_PARSER_VERSION,
  };
}
