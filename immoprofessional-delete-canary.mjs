import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";

import JSZip from "jszip";

import { APP_VERSION } from "./app/lib/app-version.mjs";

export const DELETE_CANARY_CONTRACT_VERSION = "1";
export const DELETE_CANARY_TARGET = "30460-287191";
export const DELETE_CANARY_PROVIDER = "immoprofessional";
export const DELETE_CANARY_PROVIDER_ID = "30460";
export const DELETE_CANARY_PROTECTED_TARGETS = Object.freeze([
  "30460-032963",
  "30460-810978",
]);
export const DELETE_CANARY_MODES = Object.freeze(["off", "canary"]);
export const DELETE_CANARY_LEDGER_FORMAT = 1;
export const DELETE_CANARY_MODE_FORMAT = 1;
export const DELETE_CANARY_PROCESS_LEASE_MS = 5 * 60 * 1000;

export const DELETE_CANARY_STATUS = Object.freeze({
  PREPARED: "delete_prepared",
  PROCESSING: "delete_processing",
  TRANSFERRED: "delete_transferred",
  TRANSFER_UNCERTAIN: "delete_transfer_uncertain",
  PENDING_CONFIRMATION: "delete_pending_confirmation",
  CONFIRMED: "delete_confirmed",
  OBSERVED_REMOVED: "delete_observed_removed",
  TRANSFER_FAILED: "delete_transfer_failed",
  CONFIRMATION_CONFLICT: "delete_confirmation_conflict",
});

function canaryError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function clean(value, maximum = 500) {
  return String(value ?? "").trim().slice(0, maximum);
}

function xml(value) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeMessage(value, maximum = 500) {
  return clean(value, maximum * 2)
    .replace(/\bsk-[a-zA-Z0-9_-]{12,}\b/gu, "[REDACTED]")
    .replace(/\bBearer\s+[a-zA-Z0-9._~+\/-]+=*/giu, "Bearer [REDACTED]")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/giu, "$1[REDACTED]@")
    .replace(/\b(password|passwort|token|secret|api.?key)\s*[=:]\s*[^\s,;]+/giu, "$1=[REDACTED]")
    .slice(0, maximum);
}

function exactTarget(value) {
  return clean(value, 40);
}

export function assertAuthorizedDeleteTarget(requestedTarget, authorizedTarget = DELETE_CANARY_TARGET) {
  const requested = exactTarget(requestedTarget);
  const authorized = exactTarget(authorizedTarget);
  if (
    requested !== DELETE_CANARY_TARGET
    || authorized !== DELETE_CANARY_TARGET
    || requested !== authorized
    || DELETE_CANARY_PROTECTED_TARGETS.includes(requested)
  ) {
    throw canaryError(
      "DELETE_REPLACEMENT_GUARD_VIOLATION",
      "Der Delete-Canary darf ausschließlich die exakt autorisierte Objektnummer adressieren.",
    );
  }
  return requested;
}

export function assertSingleDeleteTarget(targets, authorizedTarget = DELETE_CANARY_TARGET) {
  if (!Array.isArray(targets) || targets.length !== 1) {
    throw canaryError("DELETE_CANARY_TARGET_COUNT_INVALID", "Der Delete-Canary benötigt exakt ein Ziel.");
  }
  return assertAuthorizedDeleteTarget(targets[0], authorizedTarget);
}

export function normalizeDeleteCanaryMode(value, fallbackReason = "") {
  const source = value && typeof value === "object" ? value : null;
  const rawMode = clean(source?.mode, 20).toLowerCase();
  const targets = Array.isArray(source?.externalObjectNumbers)
    ? [...new Set(source.externalObjectNumbers.map(exactTarget).filter(Boolean))]
    : [];
  if (!source || Number(source.format) !== DELETE_CANARY_MODE_FORMAT) {
    return {
      format: DELETE_CANARY_MODE_FORMAT,
      mode: "off",
      externalObjectNumbers: [],
      updatedAt: clean(source?.updatedAt, 50),
      valid: false,
      fallbackReason: fallbackReason || "Delete-Betriebsmodus fehlt oder besitzt ein unbekanntes Format; fail-closed auf off.",
    };
  }
  if (!DELETE_CANARY_MODES.includes(rawMode)) {
    return {
      format: DELETE_CANARY_MODE_FORMAT,
      mode: "off",
      externalObjectNumbers: [],
      updatedAt: clean(source.updatedAt, 50),
      valid: false,
      fallbackReason: `Unbekannter Delete-Betriebsmodus „${rawMode || "leer"}“; fail-closed auf off.`,
    };
  }
  if (rawMode === "canary") {
    try {
      assertSingleDeleteTarget(targets);
    } catch (error) {
      return {
        format: DELETE_CANARY_MODE_FORMAT,
        mode: "off",
        externalObjectNumbers: [],
        updatedAt: clean(source.updatedAt, 50),
        valid: false,
        fallbackReason: safeMessage(error?.message || "Canary-Ziel ist ungültig."),
      };
    }
  }
  return {
    format: DELETE_CANARY_MODE_FORMAT,
    mode: rawMode,
    externalObjectNumbers: rawMode === "canary" ? targets : [],
    updatedAt: clean(source.updatedAt, 50),
    valid: true,
    fallbackReason: "",
  };
}

async function atomicJsonWrite(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(JSON.stringify(value, null, 2), "utf8");
    await handle.close();
    handle = null;
    await rename(temporaryPath, path);
  } finally {
    await handle?.close();
    await rm(temporaryPath, { force: true });
  }
}

export function createDeleteCanaryModeStore(path, options = {}) {
  const now = options.now || (() => new Date().toISOString());
  return {
    async load() {
      try {
        return normalizeDeleteCanaryMode(JSON.parse(await readFile(path, "utf8")));
      } catch (error) {
        return normalizeDeleteCanaryMode(null, error?.code === "ENOENT"
          ? "Delete-Betriebsmodus fehlt; fail-closed auf off."
          : "Delete-Betriebsmodus ist beschädigt oder nicht lesbar; fail-closed auf off.");
      }
    },
    async save(input) {
      const mode = clean(input?.mode, 20).toLowerCase();
      if (!DELETE_CANARY_MODES.includes(mode)) {
        throw canaryError("DELETE_MODE_UNSUPPORTED", "Erlaubte Delete-Betriebsmodi sind ausschließlich off und canary.");
      }
      const externalObjectNumbers = mode === "canary"
        ? [assertSingleDeleteTarget(input?.externalObjectNumbers)]
        : [];
      const value = {
        format: DELETE_CANARY_MODE_FORMAT,
        mode,
        externalObjectNumbers,
        updatedAt: clean(input?.updatedAt, 50) || now(),
      };
      await atomicJsonWrite(path, value);
      return normalizeDeleteCanaryMode(value);
    },
  };
}

export function assertDeleteCanaryMode(mode, target = DELETE_CANARY_TARGET) {
  if (mode?.mode !== "canary" || mode?.valid !== true) {
    throw canaryError("DELETE_CANARY_MODE_OFF", "Der Delete-Canary-Betriebsmodus ist nicht aktiv.");
  }
  assertSingleDeleteTarget(mode.externalObjectNumbers);
  assertAuthorizedDeleteTarget(target);
  if (mode.externalObjectNumbers[0] !== target) {
    throw canaryError("DELETE_CANARY_TARGET_MISMATCH", "Der Delete-Canary-Modus enthält nicht das angeforderte Ziel.");
  }
}

function mapHouseType(value) {
  const normalized = clean(value, 100).toLowerCase();
  if (normalized.includes("bungalow")) return "BUNGALOW";
  if (normalized.includes("stadt")) return "STADTHAUS";
  if (normalized.includes("doppel")) return "DOPPELHAUSHAELFTE";
  return "EINFAMILIENHAUS";
}

export function resolveDeleteCanarySnapshot(state, target = DELETE_CANARY_TARGET) {
  assertAuthorizedDeleteTarget(target);
  const matches = [];
  for (const project of state?.projects || []) {
    for (const listing of project?.listings || []) {
      if (exactTarget(listing?.externalId) === target) matches.push({ project, listing });
    }
  }
  if (matches.length !== 1) {
    throw canaryError(
      matches.length ? "DELETE_CANARY_TARGET_AMBIGUOUS" : "DELETE_CANARY_NEEDS_VALID_PAYLOAD_SOURCE",
      matches.length
        ? "Das Canary-Objekt ist im lokalen Katalog nicht eindeutig."
        : "Für das Canary-Objekt fehlt ein korrekter lokaler Objektsnapshot.",
    );
  }
  const { project, listing } = matches[0];
  const house = (state?.houses || []).find((entry) => entry.id === listing.templateId);
  const provider = state?.provider || {};
  if (
    !house
    || clean(provider.providerNumber) !== DELETE_CANARY_PROVIDER_ID
    || !clean(provider.company)
    || !clean(provider.email)
    || !clean(provider.lastName || provider.company)
    || !clean(project.zip)
    || !clean(project.city)
    || clean(listing.status).toLowerCase() !== "published"
  ) {
    throw canaryError(
      "DELETE_CANARY_NEEDS_VALID_PAYLOAD_SOURCE",
      "Der lokale Canary-Snapshot enthält nicht alle für einen schema-validen Delete notwendigen Originaldaten.",
    );
  }
  return {
    operation: "manual_external_delete_canary",
    provider: DELETE_CANARY_PROVIDER,
    providerId: DELETE_CANARY_PROVIDER_ID,
    externalObjectNumber: target,
    authorizedByUser: true,
    testOnly: true,
    sourceListingId: clean(listing.id, 200) || null,
    projectId: clean(project.id, 200),
    listingStatus: clean(listing.status, 40),
    templateName: clean(listing.templateName, 200),
    houseType: mapHouseType(house.houseType),
    zip: clean(project.zip, 20),
    city: clean(project.city, 160),
    providerCompany: clean(provider.company, 300),
    providerEmail: clean(provider.email, 300),
    providerName: clean(provider.lastName || provider.company, 200),
  };
}

export function createDeleteCanaryJobIdentity(target = DELETE_CANARY_TARGET) {
  assertAuthorizedDeleteTarget(target);
  const canonical = [
    `contractVersion=${DELETE_CANARY_CONTRACT_VERSION}`,
    `provider=${DELETE_CANARY_PROVIDER}`,
    `providerId=${DELETE_CANARY_PROVIDER_ID}`,
    "operation=DELETE",
    `externalObjectNumber=${target}`,
    "canary=true",
  ].join("\n");
  const idempotencyKey = sha256(canonical);
  return {
    deleteJobId: `delete-canary:${idempotencyKey}`,
    idempotencyKey,
    canonical,
  };
}

function compactTimestamp(value) {
  return new Date(value).toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");
}

export async function buildImmoprofessionalDeletePayload(snapshot, options = {}) {
  const target = assertAuthorizedDeleteTarget(snapshot?.externalObjectNumber);
  if (
    snapshot?.sourceListingId == null
    || clean(snapshot.providerId) !== DELETE_CANARY_PROVIDER_ID
    || clean(snapshot.provider) !== DELETE_CANARY_PROVIDER
  ) {
    throw canaryError("DELETE_CANARY_NEEDS_VALID_PAYLOAD_SOURCE", "Der Delete-Payload besitzt keinen eindeutigen lokalen Quellsnapshot.");
  }
  const preparedAt = new Date(options.preparedAt || new Date().toISOString()).toISOString();
  const date = preparedAt.slice(0, 10);
  const timestamp = compactTimestamp(preparedAt);
  const xmlFilename = `delete-${target}-${timestamp}.xml`;
  const payloadFilename = `delete-${target}-${timestamp}.zip`;
  const xmlText = `<?xml version="1.0" encoding="UTF-8"?>
<openimmo>
  <uebertragung art="OFFLINE" umfang="TEIL" modus="DELETE" version="1.2.7" sendersoftware="Fabian&amp;Pascal Inseratestudio" senderversion="${xml(APP_VERSION)}" techn_email="${xml(snapshot.providerEmail)}" regi_id="${DELETE_CANARY_PROVIDER_ID}" timestamp="${preparedAt}" />
  <anbieter>
    <anbieternr>${DELETE_CANARY_PROVIDER_ID}</anbieternr>
    <firma>${xml(snapshot.providerCompany)}</firma>
    <openimmo_anid>${DELETE_CANARY_PROVIDER_ID}</openimmo_anid>
    <immobilie>
      <objektkategorie>
        <nutzungsart WOHNEN="true" GEWERBE="false" />
        <vermarktungsart KAUF="true" MIETE_PACHT="false" />
        <objektart><haus haustyp="${xml(snapshot.houseType)}" /></objektart>
      </objektkategorie>
      <geo><plz>${xml(snapshot.zip)}</plz><ort>${xml(snapshot.city)}</ort></geo>
      <kontaktperson><email_zentrale>${xml(snapshot.providerEmail)}</email_zentrale><name>${xml(snapshot.providerName)}</name></kontaktperson>
      <verwaltung_techn>
        <objektnr_extern>${target}</objektnr_extern>
        <aktion aktionart="DELETE" />
        <openimmo_obid>${target}</openimmo_obid>
        <kennung_ursprung>${target}</kennung_ursprung>
        <stand_vom>${date}</stand_vom>
      </verwaltung_techn>
    </immobilie>
  </anbieter>
</openimmo>`;
  validateDeleteXmlInvariants(xmlText, target);
  const zip = new JSZip();
  zip.file(xmlFilename, xmlText, { date: new Date(preparedAt), createFolders: false });
  const archive = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
    platform: "UNIX",
  });
  await validateDeleteArchive(archive, { xmlFilename, xmlText });
  return {
    preparedAt,
    payloadFilename,
    xmlFilename,
    xmlText,
    archive,
    payloadSha256: sha256(archive),
    payloadSize: archive.length,
    xmlSha256: sha256(xmlText),
    openImmoVersion: "1.2.7",
  };
}

function countMatches(value, expression) {
  return [...String(value).matchAll(expression)].length;
}

export function validateDeleteXmlInvariants(xmlText, target = DELETE_CANARY_TARGET) {
  assertAuthorizedDeleteTarget(target);
  const checks = {
    objectCount: countMatches(xmlText, /<immobilie(?:\s|>)/gu),
    deleteCount: countMatches(xmlText, /<aktion\s+aktionart="DELETE"\s*\/>/gu),
    providerId: /<anbieternr>30460<\/anbieternr>/u.test(xmlText) && /regi_id="30460"/u.test(xmlText),
    openimmoObid: new RegExp(`<openimmo_obid>${target}<\\/openimmo_obid>`, "u").test(xmlText),
    originId: new RegExp(`<kennung_ursprung>${target}<\\/kennung_ursprung>`, "u").test(xmlText),
    externalId: new RegExp(`<objektnr_extern>${target}<\\/objektnr_extern>`, "u").test(xmlText),
    mode: /<uebertragung\b[^>]*\bmodus="DELETE"/u.test(xmlText),
    scope: /<uebertragung\b[^>]*\bumfang="TEIL"/u.test(xmlText),
    noChange: !/aktionart="CHANGE"/u.test(xmlText),
  };
  const objectNumbers = [...new Set(String(xmlText).match(/30460-\d{6}/gu) || [])];
  if (
    checks.objectCount !== 1
    || checks.deleteCount !== 1
    || !checks.providerId
    || !checks.openimmoObid
    || !checks.originId
    || !checks.externalId
    || !checks.mode
    || !checks.scope
    || !checks.noChange
    || objectNumbers.length !== 1
    || objectNumbers[0] !== target
    || DELETE_CANARY_PROTECTED_TARGETS.some((value) => String(xmlText).includes(value))
  ) {
    throw canaryError("DELETE_PAYLOAD_INVARIANT_VIOLATION", "Der Delete-Payload verletzt die feste Einzelziel-Sicherheitsgrenze.");
  }
  return { ...checks, objectNumbers };
}

export async function validateDeleteArchive(archive, expected) {
  let zip;
  try {
    zip = await JSZip.loadAsync(archive, { checkCRC32: true });
  } catch {
    throw canaryError("DELETE_PAYLOAD_ZIP_INVALID", "Das Delete-Paket ist kein gültiges ZIP-Archiv.");
  }
  const files = Object.values(zip.files).filter((entry) => !entry.dir);
  if (files.length !== 1 || files[0].name !== expected.xmlFilename || files[0].name.includes("/")) {
    throw canaryError("DELETE_PAYLOAD_ZIP_INVALID", "Das Delete-Paket muss exakt eine XML-Datei im ZIP-Wurzelverzeichnis enthalten.");
  }
  const xmlText = await files[0].async("string");
  if (xmlText !== expected.xmlText) {
    throw canaryError("DELETE_PAYLOAD_ZIP_INVALID", "Die XML-Datei im ZIP entspricht nicht dem validierten Payload.");
  }
  return { fileCount: 1, xmlFilename: files[0].name };
}

export async function validateDeleteXmlAgainstSchema(xmlText, schemaPath, options = {}) {
  const spawn = options.spawn;
  if (typeof spawn !== "function") {
    throw canaryError("DELETE_SCHEMA_VALIDATOR_MISSING", "Für die XSD-Prüfung fehlt der explizite xmllint-Adapter.");
  }
  const result = await spawn({ xmlText, schemaPath });
  if (!result?.ok) {
    throw canaryError("DELETE_PAYLOAD_SCHEMA_REJECTED_LOCALLY", safeMessage(result?.message || "Der Delete-Payload ist nicht schema-valide."));
  }
  return { ok: true, schemaPath: clean(schemaPath, 1000) };
}

function emptyLedger() {
  return { format: DELETE_CANARY_LEDGER_FORMAT, jobs: [] };
}

async function readLedger(path) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (parsed?.format !== DELETE_CANARY_LEDGER_FORMAT || !Array.isArray(parsed.jobs)) {
      throw canaryError("DELETE_LEDGER_CORRUPT", "Das Delete-Jobledger ist beschädigt.");
    }
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") return emptyLedger();
    if (error?.code === "DELETE_LEDGER_CORRUPT") throw error;
    throw canaryError("DELETE_LEDGER_CORRUPT", "Das Delete-Jobledger ist beschädigt oder nicht lesbar.");
  }
}

async function acquireFileLock(lockPath, leaseMs, nowMs) {
  await mkdir(dirname(lockPath), { recursive: true });
  try {
    return await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const details = await stat(lockPath).catch(() => null);
    if (!details || nowMs - details.mtimeMs <= leaseMs) {
      throw canaryError("DELETE_LEDGER_LOCKED", "Das Delete-Jobledger wird bereits von einem anderen Prozess verarbeitet.");
    }
    await rm(lockPath, { force: true });
    return open(lockPath, "wx", 0o600);
  }
}

export function createDeleteCanaryLedger(path, options = {}) {
  const leaseMs = Number(options.leaseMs) > 0 ? Number(options.leaseMs) : DELETE_CANARY_PROCESS_LEASE_MS;
  const lockPath = `${path}.lock`;

  async function mutate(mutator, nowValue = new Date().toISOString()) {
    const now = new Date(nowValue).toISOString();
    const lock = await acquireFileLock(lockPath, leaseMs, Date.parse(now));
    try {
      const ledger = await readLedger(path);
      const result = await mutator(ledger, now);
      if (result.changed) await atomicJsonWrite(path, result.ledger);
      return result.value;
    } finally {
      await lock.close();
      await rm(lockPath, { force: true });
    }
  }

  function findJob(ledger, jobId) {
    const job = ledger.jobs.find((entry) => entry.deleteJobId === jobId);
    if (!job) throw canaryError("DELETE_JOB_NOT_FOUND", "Der Delete-Job ist nicht vorhanden.");
    return job;
  }

  function replaceJob(ledger, job) {
    return { ...ledger, jobs: [...ledger.jobs.filter((entry) => entry.deleteJobId !== job.deleteJobId), job] };
  }

  function assertCas(job, expectedUpdatedAt) {
    if (clean(expectedUpdatedAt, 50) !== clean(job.updatedAt, 50)) {
      throw canaryError("DELETE_JOB_CAS_CONFLICT", "Der Delete-Job wurde zwischenzeitlich verändert.");
    }
  }

  return {
    read() {
      return readLedger(path);
    },
    prepare(input, nowValue) {
      return mutate((ledger, now) => {
        const existing = ledger.jobs.find((entry) => entry.deleteJobId === input.deleteJobId);
        if (existing) return { changed: false, ledger, value: existing };
        const job = {
          deleteJobId: clean(input.deleteJobId, 200),
          operation: "manual_external_delete_canary",
          provider: DELETE_CANARY_PROVIDER,
          providerId: DELETE_CANARY_PROVIDER_ID,
          externalObjectNumber: assertAuthorizedDeleteTarget(input.externalObjectNumber),
          sourceListingId: input.sourceListingId == null ? null : clean(input.sourceListingId, 200),
          createdAt: now,
          preparedAt: clean(input.preparedAt, 50) || now,
          transferStartedAt: "",
          transferCompletedAt: "",
          confirmationReceivedAt: "",
          updatedAt: now,
          status: DELETE_CANARY_STATUS.PREPARED,
          attempt: 0,
          idempotencyKey: clean(input.idempotencyKey, 128),
          payloadFilename: clean(input.payloadFilename, 240),
          payloadSha256: clean(input.payloadSha256, 128),
          payloadSize: Number(input.payloadSize) || 0,
          transportTarget: clean(input.transportTarget || "/", 500),
          providerReportMessageId: "",
          providerReportHash: "",
          providerResult: "",
          canary: true,
          claimToken: "",
          leaseExpiresAt: "",
          errorCode: "",
          message: "",
        };
        return { changed: true, ledger: replaceJob(ledger, job), value: job };
      }, nowValue);
    },
    claim(jobId, input = {}, nowValue) {
      return mutate((ledger, now) => {
        const current = findJob(ledger, jobId);
        assertCas(current, input.expectedUpdatedAt);
        if ([
          DELETE_CANARY_STATUS.TRANSFERRED,
          DELETE_CANARY_STATUS.PENDING_CONFIRMATION,
          DELETE_CANARY_STATUS.CONFIRMED,
          DELETE_CANARY_STATUS.OBSERVED_REMOVED,
          DELETE_CANARY_STATUS.TRANSFER_UNCERTAIN,
        ].includes(current.status)) {
          throw canaryError("DELETE_JOB_ALREADY_TRANSFERRED", "Der Delete-Job wurde bereits übertragen und darf nicht wiederholt werden.");
        }
        if (current.status === DELETE_CANARY_STATUS.TRANSFER_FAILED) {
          throw canaryError("DELETE_JOB_RETRY_NOT_AUTHORIZED", "Für einen weiteren Delete-Versuch fehlt eine neue ausdrückliche Freigabe.");
        }
        if (
          current.status === DELETE_CANARY_STATUS.PROCESSING
          && Date.parse(current.leaseExpiresAt || "") > Date.parse(now)
        ) {
          throw canaryError("DELETE_JOB_ALREADY_CLAIMED", "Der Delete-Job besitzt bereits einen aktiven Prozess-Claim.");
        }
        const token = clean(input.claimToken || randomUUID(), 200);
        const job = {
          ...current,
          status: DELETE_CANARY_STATUS.PROCESSING,
          attempt: Number(current.attempt || 0) + 1,
          transferStartedAt: now,
          updatedAt: now,
          claimToken: token,
          leaseExpiresAt: new Date(Date.parse(now) + leaseMs).toISOString(),
          errorCode: "",
          message: "",
        };
        return { changed: true, ledger: replaceJob(ledger, job), value: job };
      }, nowValue);
    },
    markTransferred(jobId, input = {}, nowValue) {
      return mutate((ledger, now) => {
        const current = findJob(ledger, jobId);
        assertCas(current, input.expectedUpdatedAt);
        if (current.status !== DELETE_CANARY_STATUS.PROCESSING || current.claimToken !== input.claimToken) {
          throw canaryError("DELETE_JOB_CLAIM_MISMATCH", "Der Delete-Transfer besitzt keinen gültigen Prozess-Claim.");
        }
        const job = {
          ...current,
          status: DELETE_CANARY_STATUS.TRANSFERRED,
          transferCompletedAt: now,
          updatedAt: now,
          claimToken: "",
          leaseExpiresAt: "",
        };
        return { changed: true, ledger: replaceJob(ledger, job), value: job };
      }, nowValue);
    },
    markPendingConfirmation(jobId, input = {}, nowValue) {
      return mutate((ledger, now) => {
        const current = findJob(ledger, jobId);
        assertCas(current, input.expectedUpdatedAt);
        if (current.status !== DELETE_CANARY_STATUS.TRANSFERRED) {
          throw canaryError("DELETE_JOB_STATUS_INVALID", "Nur ein übertragener Delete darf auf Bestätigung warten.");
        }
        const job = { ...current, status: DELETE_CANARY_STATUS.PENDING_CONFIRMATION, updatedAt: now };
        return { changed: true, ledger: replaceJob(ledger, job), value: job };
      }, nowValue);
    },
    confirm(jobId, input = {}, nowValue) {
      return mutate((ledger, now) => {
        const current = findJob(ledger, jobId);
        const target = assertAuthorizedDeleteTarget(input.externalObjectNumber);
        const messageId = clean(input.providerReportMessageId, 500);
        const reportHash = clean(input.providerReportHash, 128).toLowerCase();
        const providerResult = clean(input.providerResult, 80).toLowerCase();
        if (current.externalObjectNumber !== target) {
          throw canaryError("DELETE_CONFIRMATION_TARGET_MISMATCH", "Der Löschbericht gehört nicht zum offenen Canary-Deletejob.");
        }
        if (!messageId || !/^[a-f0-9]{64}$/u.test(reportHash) || providerResult !== "success") {
          throw canaryError("DELETE_CONFIRMATION_INVALID", "Der Löschbericht erfüllt den positiven Bestätigungsvertrag nicht.");
        }
        if (current.status === DELETE_CANARY_STATUS.CONFIRMED) {
          if (
            current.providerReportMessageId === messageId
            && current.providerReportHash === reportHash
            && current.providerResult === providerResult
          ) return { changed: false, ledger, value: current };
          throw canaryError("DELETE_CONFIRMATION_AMBIGUOUS", "Der bereits bestätigte Deletejob erhielt einen abweichenden Bericht.");
        }
        if (current.status !== DELETE_CANARY_STATUS.PENDING_CONFIRMATION) {
          throw canaryError("DELETE_JOB_STATUS_INVALID", "Nur ein auf Providerbestätigung wartender Deletejob darf bestätigt werden.");
        }
        const job = {
          ...current,
          status: DELETE_CANARY_STATUS.CONFIRMED,
          confirmationReceivedAt: now,
          updatedAt: now,
          providerReportMessageId: messageId,
          providerReportHash: reportHash,
          providerResult,
          providerProcessedAt: clean(input.providerProcessedAt, 50),
          errorCode: "",
          message: "Immoprofessional hat die erfolgreiche Löschung des exakten Canary-Objekts maschinell bestätigt.",
        };
        return { changed: true, ledger: replaceJob(ledger, job), value: job };
      }, nowValue);
    },
    markTransferFailed(jobId, input = {}, nowValue) {
      return mutate((ledger, now) => {
        const current = findJob(ledger, jobId);
        if (input.expectedUpdatedAt) assertCas(current, input.expectedUpdatedAt);
        if (current.status !== DELETE_CANARY_STATUS.PROCESSING || current.claimToken !== input.claimToken) {
          throw canaryError("DELETE_JOB_CLAIM_MISMATCH", "Der fehlgeschlagene Transfer besitzt keinen gültigen Prozess-Claim.");
        }
        const job = {
          ...current,
          status: DELETE_CANARY_STATUS.TRANSFER_FAILED,
          updatedAt: now,
          claimToken: "",
          leaseExpiresAt: "",
          errorCode: clean(input.errorCode || "DELETE_TRANSFER_FAILED", 100),
          message: safeMessage(input.message || "Der Delete-Transfer ist fehlgeschlagen."),
        };
        return { changed: true, ledger: replaceJob(ledger, job), value: job };
      }, nowValue);
    },
    markTransferUncertain(jobId, input = {}, nowValue) {
      return mutate((ledger, now) => {
        const current = findJob(ledger, jobId);
        if (input.expectedUpdatedAt) assertCas(current, input.expectedUpdatedAt);
        if (![DELETE_CANARY_STATUS.PROCESSING, DELETE_CANARY_STATUS.TRANSFERRED].includes(current.status)) {
          throw canaryError("DELETE_JOB_STATUS_INVALID", "Der Delete-Job kann nicht als unklarer Transfer markiert werden.");
        }
        const job = {
          ...current,
          status: DELETE_CANARY_STATUS.TRANSFER_UNCERTAIN,
          transferCompletedAt: current.transferCompletedAt || now,
          updatedAt: now,
          claimToken: "",
          leaseExpiresAt: "",
          errorCode: clean(input.errorCode || "DELETE_TRANSFER_STATE_UNCERTAIN", 100),
          message: safeMessage(input.message || "Der Delete-Transfer war erfolgreich, aber sein lokaler Abschlussstatus ist unklar."),
        };
        return { changed: true, ledger: replaceJob(ledger, job), value: job };
      }, nowValue);
    },
  };
}

export function createDeleteCanaryPreflight(snapshot, payload, identity, transportTarget = "/") {
  const invariants = validateDeleteXmlInvariants(payload.xmlText, snapshot.externalObjectNumber);
  return {
    heading: "DELETE CANARY PRE-FLIGHT",
    target: snapshot.externalObjectNumber,
    provider: DELETE_CANARY_PROVIDER_ID,
    operation: "DELETE",
    mode: "canary",
    payloadObjectCount: invariants.objectCount,
    payloadDeleteCount: invariants.deleteCount,
    openimmoObid: snapshot.externalObjectNumber,
    kennungUrsprung: snapshot.externalObjectNumber,
    protectedObjects: [...DELETE_CANARY_PROTECTED_TARGETS],
    allowedDeleteTransfers: 1,
    deleteJobId: identity.deleteJobId,
    idempotencyKey: identity.idempotencyKey,
    payloadFilename: payload.payloadFilename,
    xmlFilename: payload.xmlFilename,
    payloadSize: payload.payloadSize,
    payloadSha256: payload.payloadSha256,
    openImmoVersion: payload.openImmoVersion,
    transportTarget: clean(transportTarget, 500) || "/",
  };
}

export async function prepareDeleteCanary(input) {
  const target = assertAuthorizedDeleteTarget(input.target, input.authorizedTarget);
  const mode = await input.modeStore.load();
  assertDeleteCanaryMode(mode, target);
  const snapshot = resolveDeleteCanarySnapshot(input.state, target);
  const identity = createDeleteCanaryJobIdentity(target);
  const ledger = await input.ledger.read();
  const existing = ledger.jobs.find((entry) => entry.deleteJobId === identity.deleteJobId);
  if (existing && [
    DELETE_CANARY_STATUS.TRANSFERRED,
    DELETE_CANARY_STATUS.PENDING_CONFIRMATION,
    DELETE_CANARY_STATUS.CONFIRMED,
    DELETE_CANARY_STATUS.OBSERVED_REMOVED,
    DELETE_CANARY_STATUS.TRANSFER_UNCERTAIN,
  ].includes(existing.status)) {
    throw canaryError("DELETE_JOB_ALREADY_TRANSFERRED", "Der identische Delete-Canary wurde bereits übertragen.");
  }
  if (existing?.status === DELETE_CANARY_STATUS.TRANSFER_FAILED) {
    throw canaryError("DELETE_JOB_RETRY_NOT_AUTHORIZED", "Ein weiterer Delete-Versuch benötigt eine neue ausdrückliche Freigabe.");
  }
  const preparedAt = existing?.preparedAt || input.now?.() || new Date().toISOString();
  const payload = await buildImmoprofessionalDeletePayload(snapshot, { preparedAt });
  await validateDeleteXmlAgainstSchema(payload.xmlText, input.schemaPath, { spawn: input.schemaValidator });
  if (existing && (
    existing.payloadSha256 !== payload.payloadSha256
    || existing.payloadFilename !== payload.payloadFilename
    || Number(existing.payloadSize) !== payload.payloadSize
  )) {
    throw canaryError("DELETE_PREPARED_PAYLOAD_MISMATCH", "Der vorbereitete Delete-Payload ist nicht deterministisch reproduzierbar.");
  }
  const preflight = createDeleteCanaryPreflight(snapshot, payload, identity, input.transportTarget);
  return { target, mode, snapshot, identity, payload, preflight, existing };
}

export async function executeDeleteCanary(input) {
  const prepared = await prepareDeleteCanary(input);
  const preparedJob = await input.ledger.prepare({
    ...prepared.identity,
    externalObjectNumber: prepared.target,
    sourceListingId: prepared.snapshot.sourceListingId,
    preparedAt: prepared.payload.preparedAt,
    payloadFilename: prepared.payload.payloadFilename,
    payloadSha256: prepared.payload.payloadSha256,
    payloadSize: prepared.payload.payloadSize,
    transportTarget: input.transportTarget,
  }, input.now?.());
  const claimToken = input.claimToken || randomUUID();
  let claimed = await input.ledger.claim(prepared.identity.deleteJobId, {
    expectedUpdatedAt: preparedJob.updatedAt,
    claimToken,
  }, input.now?.());
  let uploadCompleted = false;
  try {
    const modeImmediatelyBeforeTransfer = await input.modeStore.load();
    assertDeleteCanaryMode(modeImmediatelyBeforeTransfer, prepared.target);
    validateDeleteXmlInvariants(prepared.payload.xmlText, prepared.target);
    await input.onPreflight?.(prepared.preflight);
    const transport = await input.upload({
      archive: prepared.payload.archive,
      filename: prepared.payload.payloadFilename,
      target: prepared.target,
      preflight: prepared.preflight,
    });
    uploadCompleted = true;
    claimed = await input.ledger.markTransferred(prepared.identity.deleteJobId, {
      expectedUpdatedAt: claimed.updatedAt,
      claimToken,
    }, transport?.completedAt || input.now?.());
    const pending = await input.ledger.markPendingConfirmation(prepared.identity.deleteJobId, {
      expectedUpdatedAt: claimed.updatedAt,
    }, input.now?.());
    return { ...prepared, job: pending, transport };
  } catch (error) {
    if (uploadCompleted) {
      await input.ledger.markTransferUncertain(prepared.identity.deleteJobId, {
        expectedUpdatedAt: claimed.updatedAt,
        errorCode: error?.code || "DELETE_TRANSFER_STATE_UNCERTAIN",
        message: error instanceof Error ? error.message : "Der Delete-Transferstatus ist unklar.",
      }, input.now?.()).catch(() => undefined);
    } else {
      await input.ledger.markTransferFailed(prepared.identity.deleteJobId, {
        expectedUpdatedAt: claimed.updatedAt,
        claimToken,
        errorCode: error?.code || "DELETE_TRANSFER_FAILED",
        message: error instanceof Error ? error.message : "Der Delete-Transfer ist fehlgeschlagen.",
      }, input.now?.()).catch(() => undefined);
    }
    throw error;
  }
}
