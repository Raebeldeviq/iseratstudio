import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { LOCAL_EXPOSE_DIRECTORY, assertLocalPlotPath } from './plot-local-paths.mjs';
import { readSheet } from "read-excel-file/node";
import {
  commitCatalogSnapshot,
  loadCatalogManifest,
  startCatalogSnapshot,
} from "./catalog-store.mjs";
import {
  analyzePlotExpose,
  archivePlotExpose,
  commitPlotExpose,
  MAX_PLOT_EXPOSE_BYTES,
} from "./plot-expose-store.mjs";
import { normalizePlotState as normalizeCatalogPlotState } from "./plot-records.mjs";
import { PLOT_SYNC_CONFIG } from "./plot-sync-config.mjs";
import { parseActivePostalCodes } from "./plot-search-area.mjs";
import { APPLICATION_DATA_DIRECTORY } from "./platform-paths.mjs";

export { parseActivePostalCodes } from "./plot-search-area.mjs";

export const INQUIRY_STATUS = Object.freeze({
  AWAITING_APPROVAL: "awaiting_inquiry_approval",
  READY_TO_SEND: "ready_to_send",
  DISPATCHING: "dispatching",
  WAITING_FOR_BROKER: "waiting_for_broker",
  LEGAL_REVIEW_REQUIRED: "legal_review_required",
  READY_FOR_EXPOSE: "ready_for_expose",
  COMPLETED: "completed",
  BLOCKED: "blocked",
  FAILED: "failed",
  ARCHIVED: "archived",
});

export const DEFAULT_COMMERCIAL_INQUIRY_TEMPLATE = [
  "{salutation}",
  "",
  "Ihr Immobilienangebot hat mein Interesse geweckt. Bitte senden Sie mir das vollständige Exposé sowie alle weiteren verfügbaren Unterlagen zur Immobilie zu.",
  "",
  "Vielen Dank im Voraus.",
  "",
  "Herzliche Grüße",
  "",
  "Pascal Fröhlich",
].join("\n");

export const PLOT_SEARCH_POLICY = Object.freeze({
  minimumSizeSqm: 350,
  maximumSizeSqm: 1400,
  minimumPricePerSqm: 30,
  maximumPricePerSqm: 1100,
  ruralBrwMultiplier: 2,
  urbanBrwMultiplier: 1.5,
});

export const PLOT_INQUIRY_QUEUE_POLICY = Object.freeze({
  maximumActiveItems: 20,
  maximumItemsPerPostalCode: 3,
  unprocessedTtlMs: 2 * 24 * 60 * 60 * 1000,
});

const IMMOSCOUT_PROFILE_VISIBILITY_ALLOWLIST_ENTRY = Object.freeze({
  policyId: "immoscout-profile-visibility-v1",
  listingHost: "immobilienscout24.de",
  controlType: "checkbox",
  controlName: "sendUserProfile",
  label: "Anbieter:in darf dein Profil sehen",
  mayBeEnabled: true,
  requiresCurrentDispatchAuthorization: true,
});

export const PORTAL_CONTROL_FIELD_POLICY = Object.freeze({
  version: 1,
  allowlisted: Object.freeze([IMMOSCOUT_PROFILE_VISIBILITY_ALLOWLIST_ENTRY]),
  defaultForOtherControls: "leave_disabled_and_require_review_if_enabled",
});

const PERMANENT_ARCHIVE_REASONS = new Set([
  "expired_unprocessed",
  "manual_dismissed",
]);

const GENERIC_LISTING_SOURCE_NAMES = new Set([
  "immobilienscout24",
  "immoscout24",
  "immowelt",
  "mapio",
  "thinkimmo",
  "kip",
  "kippotsdammittelmark",
  "sparkassenimmobilien",
  "kleinanzeigen",
  "kleinanzeigenimmobilien",
  "ohnemakler",
  "ohnemaklernet",
]);

export const DEFAULT_HOUSE_BUILDER_NAMES = Object.freeze([
  "Living Haus",
  "allkauf haus",
  "massa haus",
  "OKAL",
  "Hanse Haus",
  "FingerHaus",
  "WeberHaus",
  "Bien-Zenker",
  "Schwabenhaus",
  "ScanHaus Marlow",
  "Town & Country Haus",
  "Heinz von Heiden",
  "Kern-Haus",
  "KAMPA",
  "Danhaus",
  "Rensch-Haus",
  "Gussek Haus",
  "Dan-Wood",
]);

const DEFAULT_EXPOSE_INBOX = process.env.FPI_PLOT_EXPOSE_INBOX || LOCAL_EXPOSE_DIRECTORY;
const LOCK_STALE_MS = 30 * 60 * 1000;
const HISTORY_LIMIT = 100;

function text(value) {
  return String(value ?? "").trim();
}

function normalized(value) {
  return text(value)
    .toLocaleLowerCase("de-DE")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/ß/gu, "ss")
    .replace(/[^a-z0-9]+/gu, "");
}

export function parseExcludedHouseBuilders(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error("Das Blatt „Hausbaufirmen“ enthält keine Daten.");
  const headers = new Map(rows[0].map((value, index) => [normalized(value), index]));
  const nameIndex = headers.get("namefirma") ?? headers.get("firma") ?? headers.get("name") ?? -1;
  const activeIndex = headers.get("aktiv") ?? -1;
  if (nameIndex < 0 || activeIndex < 0) throw new Error("Im Blatt „Hausbaufirmen“ fehlen Name/Firma oder Aktiv.");
  return new Set(rows.slice(1).flatMap((row) => {
    const active = normalized(row?.[activeIndex]);
    const name = text(row?.[nameIndex]);
    return ["ja", "yes", "true", "1"].includes(active) && name ? [name] : [];
  }));
}

function listingHostname(value) {
  try {
    return new URL(text(value)).hostname;
  } catch {
    return "";
  }
}

export function isGenericListingSourceName(value) {
  const key = normalized(value);
  return GENERIC_LISTING_SOURCE_NAMES.has(key)
    || /^(?:immobilienscout|immoscout|immowelt|mapio|thinkimmo|kip|kleinanzeigen|ohnemakler)/u.test(key);
}

export function providerNameFromPlot(plot) {
  const explicit = text(plot?.sourceProviderName);
  if (explicit) return explicit;
  const sourceName = text(plot?.sourceName);
  if (!sourceName || isGenericListingSourceName(sourceName)) return "";
  if (/(?:immobilien|makler|bank|sparkasse|volksbank|gmbh|ag|kg|ohg|e\.g\.)/iu.test(sourceName)) return sourceName;
  const sourceKey = normalized(sourceName);
  const hostKey = normalized(listingHostname(plot?.listingUrl).replace(/^www\./u, ""));
  return sourceKey.length >= 5 && hostKey.includes(sourceKey) ? sourceName : "";
}

export function houseBuilderOfferEvidence(plot, excludedNames = DEFAULT_HOUSE_BUILDER_NAMES) {
  const providerText = [
    plot?.sourceProviderName,
    plot?.providerName,
    plot?.offererName,
    plot?.sellerName,
    plot?.contactCompany,
    plot?.sourceName,
    listingHostname(plot?.listingUrl),
  ].map(text).filter(Boolean).join(" | ");
  const normalizedProvider = normalized(providerText);
  const configuredNames = [...new Set([
    ...DEFAULT_HOUSE_BUILDER_NAMES,
    ...(excludedNames == null ? [] : excludedNames),
  ])]
    .map((name) => ({ name: text(name), key: normalized(name) }))
    .filter(({ key }) => key.length >= 4);
  const configuredMatch = configuredNames.find(({ key }) => normalizedProvider.includes(key));
  if (configuredMatch) return { excluded: true, reason: "configured_house_builder", match: configuredMatch.name };

  const genericProviderPattern = /(?:fertighaus|hausbau|massivhaus|hausmanufaktur|bauunternehmen|baufirma|hausanbieter|bauträger|bautraeger|wohnungsbau|projektbau)/iu;
  const genericMatch = providerText.match(genericProviderPattern)?.[0] || "";
  if (genericMatch) return { excluded: true, reason: "house_builder_provider_signal", match: genericMatch };

  const listingTitle = text(plot?.sourceListingTitle || plot?.listingTitle || plot?.title);
  const combinedOfferPattern = /(?:grundstück|grundstueck|bauplatz).{0,60}(?:mit|inklusive|inkl\.).{0,50}(?:haus|hausbau)|(?:haus|neubau).{0,50}(?:mit|inklusive|inkl\.).{0,60}(?:grundstück|grundstueck|bauplatz)|projektiert\w*.{0,30}(?:haus|neubau)/iu;
  const titleMatch = listingTitle.match(combinedOfferPattern)?.[0] || "";
  if (titleMatch) return { excluded: true, reason: "combined_house_plot_offer", match: titleMatch };
  return { excluded: false, reason: "", match: "" };
}

export function isHouseBuilderOffer(plot, excludedNames = DEFAULT_HOUSE_BUILDER_NAMES) {
  return houseBuilderOfferEvidence(plot, excludedNames).excluded;
}

function safeIso(value, fallback = "") {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function addressFor(plot) {
  const street = text(plot.street);
  const houseNumber = text(plot.houseNumber);
  const streetLine = houseNumber
    ? `${street} ${houseNumber}`.trim()
    : street.replace(/(\p{L})(\d+[a-zA-Z]?)$/u, "$1 $2");
  return [streetLine, plot.postalCode, plot.city].map(text).filter(Boolean).join(" ");
}

function salutationFor(plot) {
  const explicit = text(plot?.recipientSalutation || plot?.contactSalutation);
  return explicit || "Guten Tag liebes Team,";
}

// Retain the monitor's address gate without changing the application's catalog schema.
export function hasCompletePlotAddress(plot) {
  const street = text(plot?.street);
  const houseNumber = text(plot?.houseNumber);
  const embeddedHouseNumber = /(?:^|\s)\d+\s*[a-zA-Z]?(?:\s*[-/]\s*\d+\s*[a-zA-Z]?)?\s*$/u.test(street);
  const hiddenAddress = /(?:adresse|anschrift).*(?:nicht|keine).*(?:öffentlich|angegeben)|nicht\s+öffentlich\s+angegeben|auf\s+anfrage/iu.test(street);
  const zip = text(plot?.postalCode ?? plot?.postal_code ?? plot?.zip).padStart(5, '0');
  return Boolean(street && !hiddenAddress && (houseNumber || embeddedHouseNumber)
    && /^\d{5}$/u.test(zip) && text(plot?.city));
}
const hasCompleteCatalogAddress = hasCompletePlotAddress;

// The standalone inquiry workflow carries broker evidence not represented by
// the current application's smaller plot schema. Keep it local to this adapter.
function normalizePlotState(state, options) {
  const normalized = normalizeCatalogPlotState(state, options);
  const originals = new Map((state?.plots || []).map(plot => [plot.id, plot]));
  return {...normalized, plots:normalized.plots.map(plot => {
    const original = originals.get(plot.id);
    return {...plot,
      sourceProviderName:text(original?.sourceProviderName ?? original?.source_provider_name ?? original?.providerName ?? original?.offererName ?? original?.anbieter),
      sourceListingTitle:text(original?.sourceListingTitle ?? original?.source_listing_title ?? original?.listingTitle ?? original?.title),
      addressResearchRequired:!hasCompletePlotAddress(plot),
    };
  })};
}

function compatibleLocationValue(leftValue, rightValue) {
  const left = normalized(leftValue);
  const right = normalized(rightValue);
  return !left || !right || left === right || left.includes(right) || right.includes(left);
}

export function mergeExposeFieldsIntoPlot(plot, fields = {}) {
  const next = { ...plot };
  const extractedAddressComplete = hasCompleteCatalogAddress(fields);
  if (!hasCompleteCatalogAddress(next) && extractedAddressComplete) {
    if (next.postalCode && fields.postalCode && text(next.postalCode) !== text(fields.postalCode)) {
      return {
        plot: next,
        readyForCatalog: false,
        appliedAddress: false,
        note: `Exposé-PLZ ${text(fields.postalCode)} widerspricht der gespeicherten PLZ ${text(next.postalCode)}.`,
      };
    }
    if (next.city && fields.city && !compatibleLocationValue(next.city, fields.city)) {
      return {
        plot: next,
        readyForCatalog: false,
        appliedAddress: false,
        note: `Exposé-Ort „${text(fields.city)}“ widerspricht dem gespeicherten Ort „${text(next.city)}“.`,
      };
    }
    next.street = text(fields.street);
    next.houseNumber = text(fields.houseNumber);
    next.postalCode = text(next.postalCode) || text(fields.postalCode);
    next.city = text(next.city) || text(fields.city);
  }
  if (!(Number(next.plotSizeSqm) > 0) && Number(fields.plotSizeSqm) > 0) next.plotSizeSqm = Number(fields.plotSizeSqm);
  if (!(Number(next.purchasePrice) > 0) && Number(fields.purchasePrice) > 0) next.purchasePrice = Number(fields.purchasePrice);
  const readyForCatalog = hasCompleteCatalogAddress(next);
  return {
    plot: next,
    readyForCatalog,
    appliedAddress: readyForCatalog && !hasCompleteCatalogAddress(plot),
    note: readyForCatalog
      ? "Vollständige Grundstücksdaten liegen vor; der Datensatz wurde in die Grundstücksliste übernommen."
      : "Das Exposé wurde gespeichert, enthält aber noch keine belastbare vollständige Adresse. Manuelle Prüfung erforderlich.",
  };
}

export function maximumPricePerSqmForBrw(brwValue, locationType = "urban") {
  const brw = Number(brwValue);
  if (!Number.isFinite(brw) || brw <= 0) return PLOT_SEARCH_POLICY.maximumPricePerSqm;
  const multiplier = locationType === "rural"
    ? PLOT_SEARCH_POLICY.ruralBrwMultiplier
    : PLOT_SEARCH_POLICY.urbanBrwMultiplier;
  return Math.min(PLOT_SEARCH_POLICY.maximumPricePerSqm, brw * multiplier);
}

export function isPlotWithinSearchPrice(plot, options = {}) {
  const size = Number(plot?.plotSizeSqm);
  const purchasePrice = Number(plot?.purchasePrice);
  if (!Number.isFinite(size) || size <= 0 || !Number.isFinite(purchasePrice) || purchasePrice <= 0) return false;
  const pricePerSqm = purchasePrice / size;
  const maximum = maximumPricePerSqmForBrw(options.brw, options.locationType);
  return pricePerSqm >= PLOT_SEARCH_POLICY.minimumPricePerSqm && pricePerSqm <= maximum;
}

function renderTemplate(template, plot) {
  return String(template || DEFAULT_COMMERCIAL_INQUIRY_TEMPLATE)
    .replaceAll("{salutation}", salutationFor(plot))
    .replaceAll("{address}", addressFor(plot) || "aus dem Inserat")
    .replaceAll("{reference}", text(plot.sourceInternalId) || text(plot.id));
}

function replaceMessageSalutation(message, salutation) {
  const lines = String(message || "").split("\n");
  lines[0] = salutation;
  return lines.join("\n");
}

export function dispatchAuthorizationHashFor(item) {
  const authorizedFields = [
    text(item?.plotId),
    text(item?.sourceInternalId),
    text(item?.listingUrl),
    text(item?.sourceName),
    text(item?.sourceProviderName),
    text(item?.postalCode),
    text(item?.city),
    text(item?.address),
    Number(item?.plotSizeSqm) || 0,
    Number(item?.purchasePrice) || 0,
    text(item?.recipientSalutation),
    text(item?.inquiryMessage),
  ];
  return createHash("sha256").update(JSON.stringify(authorizedFields)).digest("hex");
}

function hasCurrentDispatchAuthorization(item) {
  return Boolean(item?.approvedAt)
    && text(item?.dispatchAuthorizationHash) === dispatchAuthorizationHashFor(item);
}

function portalControlLabel(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

export function evaluatePortalControlFields(item, controls = []) {
  if (!Array.isArray(controls)) throw new Error("Portal-Kontrollfelder müssen als Liste übergeben werden.");
  const dispatchStatusAllowsEvaluation = [
    INQUIRY_STATUS.READY_TO_SEND,
    INQUIRY_STATUS.DISPATCHING,
    INQUIRY_STATUS.LEGAL_REVIEW_REQUIRED,
  ].includes(item?.status);
  const currentDispatchAuthorization = dispatchStatusAllowsEvaluation && hasCurrentDispatchAuthorization(item);
  const isImmoScout = immoScoutUrl(item?.listingUrl);
  const allowlisted = [];
  const mustRemainDisabled = [];
  const blockingControls = [];

  for (const control of controls) {
    const normalizedControl = {
      type: text(control?.type).toLocaleLowerCase("de-DE"),
      name: text(control?.name),
      label: portalControlLabel(control?.label),
      checked: control?.checked === true,
    };
    const isAllowlistedProfileVisibility = isImmoScout
      && currentDispatchAuthorization
      && normalizedControl.type === IMMOSCOUT_PROFILE_VISIBILITY_ALLOWLIST_ENTRY.controlType
      && normalizedControl.name === IMMOSCOUT_PROFILE_VISIBILITY_ALLOWLIST_ENTRY.controlName
      && normalizedControl.label === IMMOSCOUT_PROFILE_VISIBILITY_ALLOWLIST_ENTRY.label;

    if (isAllowlistedProfileVisibility) {
      allowlisted.push({
        ...normalizedControl,
        policyId: IMMOSCOUT_PROFILE_VISIBILITY_ALLOWLIST_ENTRY.policyId,
        mayBeEnabled: true,
      });
      continue;
    }

    const protectedControl = {
      ...normalizedControl,
      reason: normalizedControl.label || normalizedControl.name || "Unbekanntes zusätzliches Kontrollfeld",
    };
    mustRemainDisabled.push(protectedControl);
    if (normalizedControl.checked) blockingControls.push(protectedControl);
  }

  return {
    policyVersion: PORTAL_CONTROL_FIELD_POLICY.version,
    currentDispatchAuthorization,
    allowlisted,
    mustRemainDisabled,
    blockingControls,
    legalReviewRequired: blockingControls.length > 0,
  };
}

function immoScoutUrl(value) {
  try {
    const url = new URL(text(value));
    const host = url.hostname.toLocaleLowerCase("de-DE");
    return url.protocol === "https:" && (host === "immobilienscout24.de" || host.endsWith(".immobilienscout24.de"));
  } catch {
    return false;
  }
}

function concreteDetailUrl(plot) {
  try {
    const url = new URL(text(plot?.listingUrl));
    if (url.protocol !== "https:") return false;
    const path = decodeURIComponent(url.pathname).toLocaleLowerCase("de-DE");
    if (!path || path === "/" || /\/(?:suche|search|ergebnis|results)(?:\/|$)/u.test(path)) return false;
    const sourceTokens = text(plot?.sourceInternalId)
      .toLocaleLowerCase("de-DE")
      .split(/[^a-z0-9]+/gu)
      .filter((token) => token.length >= 5);
    const normalizedUrl = `${url.hostname}${path}`.toLocaleLowerCase("de-DE").replace(/[^a-z0-9]+/gu, "");
    return /\/(?:expose|exposé|immobilie|objekt|angebot|detail|webexpose)(?:\/|$)/u.test(path)
      || sourceTokens.some((token) => normalizedUrl.includes(token));
  } catch {
    return false;
  }
}

export function isEligibleInquiryPlot(plot, options = {}) {
  if (!plot || plot.isActive === false || text(plot.sourceStatus) === "Nicht mehr vorhanden") return false;
  if (isHouseBuilderOffer(plot, options.excludedHouseBuilders)) return false;
  const size = Number(plot.plotSizeSqm);
  if (!Number.isFinite(size) || size < PLOT_SEARCH_POLICY.minimumSizeSqm || size > PLOT_SEARCH_POLICY.maximumSizeSqm) return false;
  if (!isPlotWithinSearchPrice(plot, {
    brw: options.brw ?? plot.brwEurPerSqm,
    locationType: options.locationType ?? plot.locationType,
  })) return false;
  if (hasCompletePlotAddress(plot)) return false;
  return concreteDetailUrl(plot);
}

export function isEligibleImmoScoutPlot(plot) {
  return immoScoutUrl(plot?.listingUrl) && isEligibleInquiryPlot(plot);
}

export function classifyBrokerContent(value) {
  const content = text(value);
  const reasons = [];
  const rules = [
    [/\bmaklervertrag\b/iu, "Maklervertrag"],
    [/\b(?:käufer|kaeufer)?provision\b|\bcourtage\b/iu, "Provision oder Courtage"],
    [/widerrufsrecht|widerrufsbelehrung/iu, "Widerrufsrecht"],
    [/\bvorzeitig(?:e[snmr]?)?\s+(?:erlöschen|erloeschen|verlust)\b|\bverzicht\b.{0,80}\bwiderruf/iu, "vorzeitiges Erlöschen oder Verzicht"],
    [/(?:dienstleistung|leistung).{0,100}(?:sofort|vor ablauf|beginnen|beginn)|sofortig\w*\s+beginn/iu, "sofortiger Leistungsbeginn"],
    [/\bwertersatz\b/iu, "Wertersatz"],
    [/\b(?:agb|allgemeine geschäftsbedingungen|allgemeine geschaeftsbedingungen)\b/iu, "AGB"],
  ];
  for (const [pattern, label] of rules) {
    if (pattern.test(content)) reasons.push(label);
  }
  const exposeMentioned = /expos(?:é|e)|\.pdf/iu.test(content);
  return {
    legalReviewRequired: reasons.length > 0,
    reasons: [...new Set(reasons)],
    exposeMentioned,
  };
}

function emptyState(now) {
  return {
    version: 1,
    updatedAt: now,
    profile: {
      accountRole: "commercial",
      brand: "Living Haus",
      senderDisplayName: "Pascal Fröhlich",
      inquiryTemplate: DEFAULT_COMMERCIAL_INQUIRY_TEMPLATE,
    },
    items: [],
    history: [],
  };
}

function normalizeItem(value, now) {
  const status = Object.values(INQUIRY_STATUS).includes(value?.status)
    ? value.status
    : INQUIRY_STATUS.AWAITING_APPROVAL;
  const item = {
    id: text(value?.id) || `plot-inquiry-${randomUUID()}`,
    plotId: text(value?.plotId),
    sourceInternalId: text(value?.sourceInternalId),
    listingUrl: text(value?.listingUrl),
    sourceName: text(value?.sourceName),
    sourceProviderName: text(value?.sourceProviderName),
    providerReviewRequired: value?.providerReviewRequired === true,
    postalCode: text(value?.postalCode),
    city: text(value?.city),
    address: text(value?.address),
    plotSizeSqm: Number.isFinite(Number(value?.plotSizeSqm)) ? Number(value.plotSizeSqm) : 0,
    purchasePrice: Number.isFinite(Number(value?.purchasePrice)) ? Number(value.purchasePrice) : 0,
    recipientSalutation: text(value?.recipientSalutation) || "Guten Tag liebes Team,",
    inquiryMessage: text(value?.inquiryMessage),
    status,
    discoveredAt: safeIso(value?.discoveredAt, now),
    updatedAt: safeIso(value?.updatedAt, now),
    approvedAt: safeIso(value?.approvedAt),
    dispatchAuthorizationHash: text(value?.dispatchAuthorizationHash),
    dispatchStartedAt: safeIso(value?.dispatchStartedAt),
    dispatchAttemptId: text(value?.dispatchAttemptId),
    sentAt: safeIso(value?.sentAt),
    responseReceivedAt: safeIso(value?.responseReceivedAt),
    brokerMessageId: text(value?.brokerMessageId),
    brokerSummary: text(value?.brokerSummary).slice(0, 1000),
    legalReasons: Array.isArray(value?.legalReasons) ? value.legalReasons.map(text).filter(Boolean).slice(0, 20) : [],
    legalDecision: value?.legalDecision === "approved" || value?.legalDecision === "rejected" ? value.legalDecision : "",
    legalDecisionAt: safeIso(value?.legalDecisionAt),
    exposeFilename: text(value?.exposeFilename),
    exposeFileReference: text(value?.exposeFileReference),
    exposeReceivedAt: safeIso(value?.exposeReceivedAt),
    expiredAt: safeIso(value?.expiredAt),
    archiveReason: text(value?.archiveReason),
    lastError: text(value?.lastError).slice(0, 1000),
    transferNote: text(value?.transferNote).slice(0, 1000),
  };
  if (
    [INQUIRY_STATUS.READY_TO_SEND, INQUIRY_STATUS.DISPATCHING].includes(item.status)
    && item.approvedAt
    && !item.dispatchAuthorizationHash
  ) {
    item.dispatchAuthorizationHash = dispatchAuthorizationHashFor(item);
  }
  // Version 0.20.0 setzte eine rechtlich freigegebene, aber noch nicht
  // versendete Anfrage irrtümlich auf „Exposé abrufbereit“. Solche Einträge
  // werden beim Laden sicher in den bereits autorisierten Versand zurückgeführt.
  if (
    item.status === INQUIRY_STATUS.READY_FOR_EXPOSE
    && item.legalDecision === "approved"
    && !item.sentAt
    && hasCurrentDispatchAuthorization(item)
  ) {
    item.status = INQUIRY_STATUS.READY_TO_SEND;
    item.dispatchStartedAt = "";
    item.dispatchAttemptId = "";
    item.transferNote = "Rechtliche Versandfreigabe liegt vor; Anfrage wartet auf den Portalversand.";
  }
  return item;
}

function normalizeState(value, now) {
  const base = emptyState(now);
  return {
    ...base,
    ...(value && typeof value === "object" ? value : {}),
    version: 1,
    updatedAt: safeIso(value?.updatedAt, now),
    profile: {
      ...base.profile,
      ...(value?.profile && typeof value.profile === "object" ? value.profile : {}),
      accountRole: "commercial",
      brand: "Living Haus",
      senderDisplayName: "Pascal Fröhlich",
      inquiryTemplate: DEFAULT_COMMERCIAL_INQUIRY_TEMPLATE,
    },
    items: (Array.isArray(value?.items) ? value.items : []).map((item) => normalizeItem(item, now)),
    history: (Array.isArray(value?.history) ? value.history : []).slice(-HISTORY_LIMIT),
  };
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = join(dirname(path), `plot-inquiry-${process.pid}-${Date.now()}.tmp`);
  try {
    await writeFile(temporaryPath, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

function summarize(state) {
  const counts = Object.fromEntries(Object.values(INQUIRY_STATUS).map((status) => [status, 0]));
  for (const item of state.items) counts[item.status] = (counts[item.status] || 0) + 1;
  const activeItems = state.items.filter((item) => item.status !== INQUIRY_STATUS.ARCHIVED);
  const beforeDispatch = activeItems.filter((item) => !item.sentAt && [
    INQUIRY_STATUS.AWAITING_APPROVAL,
    INQUIRY_STATUS.READY_TO_SEND,
    INQUIRY_STATUS.DISPATCHING,
    INQUIRY_STATUS.LEGAL_REVIEW_REQUIRED,
    INQUIRY_STATUS.FAILED,
  ].includes(item.status)).length;
  const documentReview = activeItems.filter((item) => item.sentAt && [
    INQUIRY_STATUS.LEGAL_REVIEW_REQUIRED,
    INQUIRY_STATUS.READY_FOR_EXPOSE,
  ].includes(item.status)).length;
  const clarification = activeItems.filter((item) => (
    item.status === INQUIRY_STATUS.BLOCKED
    || (!item.sentAt && item.status === INQUIRY_STATUS.READY_FOR_EXPOSE)
    || (item.sentAt && item.status === INQUIRY_STATUS.FAILED)
  )).length;
  return {
    ...state,
    queuePolicy: PLOT_INQUIRY_QUEUE_POLICY,
    portalControlFieldPolicy: PORTAL_CONTROL_FIELD_POLICY,
    counts,
    actionable: {
      inquiryApprovals: counts[INQUIRY_STATUS.AWAITING_APPROVAL] || 0,
      readyToSend: counts[INQUIRY_STATUS.READY_TO_SEND] || 0,
      dispatching: counts[INQUIRY_STATUS.DISPATCHING] || 0,
      legalReviews: counts[INQUIRY_STATUS.LEGAL_REVIEW_REQUIRED] || 0,
      exposeImports: counts[INQUIRY_STATUS.READY_FOR_EXPOSE] || 0,
      toRequest: beforeDispatch,
      awaitingResponse: counts[INQUIRY_STATUS.WAITING_FOR_BROKER] || 0,
      documentReview,
      clarification,
      completed: counts[INQUIRY_STATUS.COMPLETED] || 0,
    },
  };
}

function areaScopeSummary(state, activePostalCodes) {
  const outside = state.items.filter((item) => !activePostalCodes.has(text(item.postalCode)));
  const inside = state.items.filter((item) => activePostalCodes.has(text(item.postalCode)));
  const isOpen = (item) => ![INQUIRY_STATUS.ARCHIVED, INQUIRY_STATUS.COMPLETED].includes(item.status);
  const capacityStatuses = new Set([
    INQUIRY_STATUS.AWAITING_APPROVAL,
    INQUIRY_STATUS.READY_TO_SEND,
    INQUIRY_STATUS.DISPATCHING,
    INQUIRY_STATUS.WAITING_FOR_BROKER,
    INQUIRY_STATUS.LEGAL_REVIEW_REQUIRED,
    INQUIRY_STATUS.READY_FOR_EXPOSE,
  ]);
  const capacityItems = inside.filter((item) => capacityStatuses.has(item.status));
  const capacityByPostalCode = Object.fromEntries([...capacityItems.reduce((counts, item) => {
    counts.set(item.postalCode, (counts.get(item.postalCode) || 0) + 1);
    return counts;
  }, new Map())].sort());
  return {
    openInNewArea: inside.filter(isOpen).length,
    historicalOutsideArea: outside.length,
    openOutsideArea: outside.filter(isOpen).length,
    protectedOutsideArea: outside.filter((item) => item.sentAt || [
      INQUIRY_STATUS.COMPLETED,
      INQUIRY_STATUS.LEGAL_REVIEW_REQUIRED,
      INQUIRY_STATUS.WAITING_FOR_BROKER,
      INQUIRY_STATUS.READY_FOR_EXPOSE,
      INQUIRY_STATUS.BLOCKED,
    ].includes(item.status)).length,
    awaitingOrApprovedOutsideArea: outside.filter((item) => [
      INQUIRY_STATUS.AWAITING_APPROVAL,
      INQUIRY_STATUS.READY_TO_SEND,
    ].includes(item.status)).length,
    activeCapacityUse: capacityItems.length,
    activeCapacityByPostalCode: capacityByPostalCode,
    capacityWithinLimits: capacityItems.length <= PLOT_INQUIRY_QUEUE_POLICY.maximumActiveItems
      && Object.values(capacityByPostalCode).every((count) => count <= PLOT_INQUIRY_QUEUE_POLICY.maximumItemsPerPostalCode),
  };
}

function historyEntry(event, details, now) {
  return { id: randomUUID(), event, at: now, ...details };
}

export function createPlotInquiryWorkflow(options = {}) {
  const config = {
    statePath: options.statePath || join(APPLICATION_DATA_DIRECTORY, "plot-inquiry-workflow.json"),
    lockPath: options.lockPath || join(APPLICATION_DATA_DIRECTORY, "plot-inquiry-workflow.lock"),
    exposeInbox: options.exposeInbox || DEFAULT_EXPOSE_INBOX,
    expectedActivePostalCodeCount: options.expectedActivePostalCodeCount ?? 50,
  };
  const dependencies = {
    now: options.now || (() => new Date().toISOString()),
    loadCatalog: options.loadCatalog || (() => loadCatalogManifest()),
    loadActivePostalCodes: options.loadActivePostalCodes || (async () => parseActivePostalCodes(
      await readSheet(await assertLocalPlotPath(PLOT_SYNC_CONFIG.sourcePath), "Suchgebiet"),
      { expectedCount: config.expectedActivePostalCodeCount },
    )),
    loadExcludedHouseBuilders: options.loadExcludedHouseBuilders || (async () => parseExcludedHouseBuilders(
      await readSheet(await assertLocalPlotPath(PLOT_SYNC_CONFIG.sourcePath), "Hausbaufirmen"),
    )),
    startCatalog: options.startCatalog || ((input) => startCatalogSnapshot(input)),
    commitCatalog: options.commitCatalog || ((sessionId) => commitCatalogSnapshot(sessionId)),
    analyzeExpose: options.analyzeExpose || ((input) => analyzePlotExpose(input)),
    commitExpose: options.commitExpose || ((input) => commitPlotExpose(input)),
    archiveExpose: options.archiveExpose || ((reference) => archivePlotExpose(reference)),
  };

  async function loadValidatedActivePostalCodes() {
    const activePostalCodes = await dependencies.loadActivePostalCodes();
    if (!(activePostalCodes instanceof Set) || !activePostalCodes.size) {
      throw new Error("Im Blatt „Suchgebiet“ wurden keine aktiven Postleitzahlen gefunden.");
    }
    if (config.expectedActivePostalCodeCount > 0 && activePostalCodes.size !== config.expectedActivePostalCodeCount) {
      throw new Error(`Im Blatt „Suchgebiet“ müssen exakt ${config.expectedActivePostalCodeCount} aktive, eindeutige PLZ stehen; gefunden wurden ${activePostalCodes.size}.`);
    }
    return activePostalCodes;
  }

  async function acquireLock() {
    await mkdir(dirname(config.lockPath), { recursive: true });
    try {
      const handle = await open(config.lockPath, "wx", 0o600);
      await handle.writeFile(JSON.stringify({ processId: process.pid, startedAt: dependencies.now() }));
      await handle.close();
      return async () => rm(config.lockPath, { force: true });
    } catch (error) {
      if (!error || typeof error !== "object" || error.code !== "EEXIST") throw error;
      const info = await stat(config.lockPath).catch(() => null);
      if (info && Date.now() - info.mtimeMs > LOCK_STALE_MS) {
        await rm(config.lockPath, { force: true });
        return acquireLock();
      }
      const locked = new Error("Der Anfrage-Workflow wird bereits aktualisiert.");
      locked.code = "PLOT_INQUIRY_LOCKED";
      locked.httpStatus = 409;
      throw locked;
    }
  }

  async function load() {
    const now = dependencies.now();
    return normalizeState(await readJson(config.statePath, emptyState(now)), now);
  }

  async function save(state) {
    const normalized = normalizeState({ ...state, updatedAt: dependencies.now() }, dependencies.now());
    await atomicJson(config.statePath, normalized);
    return normalized;
  }

  async function mutate(mutator, options = {}) {
    if (options.dryRun === true) {
      return summarize(await mutator(await load()));
    }
    const release = await acquireLock();
    try {
      return summarize(await save(await mutator(await load())));
    } finally {
      await release();
    }
  }

  async function sync(options = {}) {
    const dryRun = options.dryRun === true;
    const manifest = await dependencies.loadCatalog();
    if (!manifest.stored || !manifest.state) throw new Error("Der lokale App-Katalog wurde nicht gefunden.");
    const normalizedCatalog = normalizePlotState(manifest.state);
    const activePostalCodes = await loadValidatedActivePostalCodes();
    const excludedHouseBuilders = await dependencies.loadExcludedHouseBuilders();
    const currentState = dryRun ? await load() : null;
    const result = await mutate((state) => {
      const now = dependencies.now();
      const nowMs = Date.parse(now);
      const profileTemplate = text(state.profile.inquiryTemplate) || DEFAULT_COMMERCIAL_INQUIRY_TEMPLATE;
      const existing = new Map(state.items.map((item) => [item.plotId, item]));
      const plotById = new Map(normalizedCatalog.plots.map((plot) => [plot.id, plot]));
      const eligiblePlots = normalizedCatalog.plots.filter((plot) => (
        activePostalCodes.has(text(plot.postalCode)) && isEligibleInquiryPlot(plot, { excludedHouseBuilders })
      ));
      const eligibleIds = new Set(eligiblePlots.map((plot) => plot.id));
      const archive = (item, reason, event = "archived") => {
        if (item.status === INQUIRY_STATUS.ARCHIVED && item.archiveReason === reason) return;
        item.status = INQUIRY_STATUS.ARCHIVED;
        item.archiveReason = reason;
        item.updatedAt = now;
        if (reason === "expired_unprocessed") item.expiredAt = now;
        state.history.push(historyEntry(event, { plotId: item.plotId, inquiryId: item.id, reason }, now));
      };

      for (const item of state.items) {
        const plot = plotById.get(item.plotId);
        const effectivePostalCode = text(plot?.postalCode || item.postalCode);
        if (!activePostalCodes.has(effectivePostalCode)) {
          if ([INQUIRY_STATUS.AWAITING_APPROVAL, INQUIRY_STATUS.READY_TO_SEND].includes(item.status)) {
            archive(item, "outside_search_grid");
          }
          continue;
        }
        if (plot) {
          const previousStatus = item.status;
          const mutableMessage = [INQUIRY_STATUS.AWAITING_APPROVAL, INQUIRY_STATUS.ARCHIVED].includes(item.status);
          Object.assign(item, {
            sourceInternalId: text(plot.sourceInternalId),
            listingUrl: text(plot.listingUrl),
            sourceName: text(plot.sourceName),
            sourceProviderName: providerNameFromPlot(plot),
            providerReviewRequired: !providerNameFromPlot(plot),
            postalCode: text(plot.postalCode),
            city: text(plot.city),
            address: addressFor(plot),
            plotSizeSqm: Number(plot.plotSizeSqm) || 0,
            purchasePrice: Number(plot.purchasePrice) || 0,
            inquiryMessage: mutableMessage
              ? renderTemplate(profileTemplate, { ...plot, recipientSalutation: item.recipientSalutation })
              : item.inquiryMessage,
            updatedAt: now,
          });
          if (previousStatus === INQUIRY_STATUS.READY_TO_SEND && !hasCurrentDispatchAuthorization(item)) {
            item.status = INQUIRY_STATUS.AWAITING_APPROVAL;
            item.approvedAt = "";
            item.dispatchAuthorizationHash = "";
            item.dispatchStartedAt = "";
            item.dispatchAttemptId = "";
            state.history.push(historyEntry("dispatch-authorization-invalidated", {
              plotId: item.plotId,
              inquiryId: item.id,
              reason: "listing_changed_after_approval",
            }, now));
          }
        }
        if ([INQUIRY_STATUS.AWAITING_APPROVAL, INQUIRY_STATUS.READY_TO_SEND].includes(item.status) && !eligibleIds.has(item.plotId)) {
          archive(item, plot && isHouseBuilderOffer(plot, excludedHouseBuilders) ? "house_builder_offer" : "outside_search_grid");
          continue;
        }
        const discoveredAt = Date.parse(item.discoveredAt);
        if (
          item.status === INQUIRY_STATUS.AWAITING_APPROVAL
          && Number.isFinite(nowMs)
          && Number.isFinite(discoveredAt)
          && nowMs - discoveredAt >= PLOT_INQUIRY_QUEUE_POLICY.unprocessedTtlMs
        ) {
          archive(item, "expired_unprocessed", "expired-unprocessed");
        }
      }

      const reservedStatuses = new Set([
        INQUIRY_STATUS.READY_TO_SEND,
        INQUIRY_STATUS.DISPATCHING,
        INQUIRY_STATUS.WAITING_FOR_BROKER,
        INQUIRY_STATUS.LEGAL_REVIEW_REQUIRED,
        INQUIRY_STATUS.READY_FOR_EXPOSE,
      ]);
      const selected = new Set();
      const postalCounts = new Map();
      let activeCount = 0;
      for (const item of state.items) {
        if (!activePostalCodes.has(text(item.postalCode)) || !reservedStatuses.has(item.status)) continue;
        selected.add(item.plotId);
        activeCount += 1;
        postalCounts.set(item.postalCode, (postalCounts.get(item.postalCode) || 0) + 1);
      }

      const freshness = (plot) => Math.max(
        Date.parse(text(plot.sourceFirstSeenAt)) || 0,
        Date.parse(text(plot.createdAt)) || 0,
        Date.parse(text(plot.updatedAt)) || 0,
      );
      const candidates = eligiblePlots
        .filter((plot) => {
          const item = existing.get(plot.id);
          return !item || item.status === INQUIRY_STATUS.AWAITING_APPROVAL
            || (item.status === INQUIRY_STATUS.ARCHIVED && !PERMANENT_ARCHIVE_REASONS.has(item.archiveReason));
        })
        .sort((left, right) => {
          const leftItem = existing.get(left.id);
          const rightItem = existing.get(right.id);
          const leftRank = leftItem?.status === INQUIRY_STATUS.AWAITING_APPROVAL ? 0 : 1;
          const rightRank = rightItem?.status === INQUIRY_STATUS.AWAITING_APPROVAL ? 0 : 1;
          return leftRank - rightRank || freshness(right) - freshness(left) || text(left.id).localeCompare(text(right.id), "de-DE");
        });

      for (const plot of candidates) {
        const postalCode = text(plot.postalCode);
        if (activeCount >= PLOT_INQUIRY_QUEUE_POLICY.maximumActiveItems) break;
        if ((postalCounts.get(postalCode) || 0) >= PLOT_INQUIRY_QUEUE_POLICY.maximumItemsPerPostalCode) continue;
        let item = existing.get(plot.id);
        if (!item) {
          item = normalizeItem({
            id: `plot-inquiry-${plot.id}`,
            plotId: plot.id,
            sourceInternalId: plot.sourceInternalId,
            listingUrl: plot.listingUrl,
            sourceName: plot.sourceName,
            sourceProviderName: providerNameFromPlot(plot),
            providerReviewRequired: !providerNameFromPlot(plot),
            postalCode,
            city: plot.city,
            address: addressFor(plot),
            plotSizeSqm: plot.plotSizeSqm,
            purchasePrice: plot.purchasePrice,
            recipientSalutation: salutationFor(plot),
            inquiryMessage: renderTemplate(profileTemplate, plot),
            status: INQUIRY_STATUS.AWAITING_APPROVAL,
            discoveredAt: now,
            updatedAt: now,
          }, now);
          state.items.push(item);
          existing.set(plot.id, item);
          state.history.push(historyEntry("queued", { plotId: plot.id, inquiryId: item.id }, now));
        } else if (item.status === INQUIRY_STATUS.ARCHIVED) {
          item.status = INQUIRY_STATUS.AWAITING_APPROVAL;
          item.discoveredAt = now;
          item.expiredAt = "";
          item.archiveReason = "";
          item.inquiryMessage = renderTemplate(profileTemplate, { ...plot, recipientSalutation: item.recipientSalutation });
          item.updatedAt = now;
          state.history.push(historyEntry("requeued", { plotId: plot.id, inquiryId: item.id }, now));
        }
        selected.add(plot.id);
        activeCount += 1;
        postalCounts.set(postalCode, (postalCounts.get(postalCode) || 0) + 1);
      }

      for (const item of state.items) {
        if (item.status === INQUIRY_STATUS.AWAITING_APPROVAL && !selected.has(item.plotId)) {
          archive(item, "queue_capacity");
        }
      }
      state.history = state.history.slice(-HISTORY_LIMIT);
      return state;
    }, { dryRun });
    if (!dryRun) return result;
    return {
      preview: true,
      mutationsPersisted: false,
      activePostalCodeCount: activePostalCodes.size,
      activePostalCodes: [...activePostalCodes].sort(),
      queuePolicy: PLOT_INQUIRY_QUEUE_POLICY,
      current: areaScopeSummary(currentState, activePostalCodes),
      projected: areaScopeSummary(result, activePostalCodes),
      projectedCounts: result.counts,
      projectedActionable: result.actionable,
    };
  }

  async function preview() {
    return sync({ dryRun: true });
  }

  async function status({ synchronize = false } = {}) {
    return synchronize ? sync() : summarize(await load());
  }

  async function approveInquiries(plotIds) {
    const ids = new Set((Array.isArray(plotIds) ? plotIds : []).map(text).filter(Boolean));
    if (!ids.size) throw new Error("Es wurden keine Grundstücksanfragen ausgewählt.");
    const activePostalCodes = await loadValidatedActivePostalCodes();
    return mutate((state) => {
      const now = dependencies.now();
      let changed = 0;
      let outsideSelected = false;
      for (const item of state.items) {
        if (ids.has(item.plotId) && !activePostalCodes.has(text(item.postalCode))) outsideSelected = true;
        if (
          !ids.has(item.plotId)
          || item.status !== INQUIRY_STATUS.AWAITING_APPROVAL
          || !activePostalCodes.has(text(item.postalCode))
          || item.providerReviewRequired
          || !text(item.sourceProviderName)
        ) continue;
        item.status = INQUIRY_STATUS.READY_TO_SEND;
        item.approvedAt = now;
        item.dispatchAuthorizationHash = dispatchAuthorizationHashFor(item);
        item.dispatchStartedAt = "";
        item.dispatchAttemptId = "";
        item.updatedAt = now;
        item.lastError = "";
        changed += 1;
        state.history.push(historyEntry("inquiry-approved", { plotId: item.plotId, inquiryId: item.id }, now));
      }
      if (!changed && outsideSelected) throw new Error("Die ausgewählte PLZ gehört nicht mehr zum aktiven Suchgebiet; eine Freigabe ist gesperrt.");
      if (!changed) throw new Error("Vor der Freigabe muss der tatsächliche Inseratersteller eindeutig ermittelt sein.");
      return state;
    });
  }

  async function claimDispatch(plotIdValue) {
    const plotId = text(plotIdValue);
    if (!plotId) throw new Error("Für den Versandauftrag fehlt die Grundstücks-ID.");
    const activePostalCodes = await loadValidatedActivePostalCodes();
    return mutate((state) => {
      const now = dependencies.now();
      const item = state.items.find((entry) => entry.plotId === plotId);
      if (!item || item.status !== INQUIRY_STATUS.READY_TO_SEND) {
        throw new Error("Diese Anfrage ist nicht zum automatischen Versand freigegeben.");
      }
      if (!activePostalCodes.has(text(item.postalCode))) {
        throw new Error("Die PLZ dieser Anfrage gehört nicht mehr zum aktiven Suchgebiet; ein Versand ist gesperrt.");
      }
      if (!hasCurrentDispatchAuthorization(item)) {
        throw new Error("Die geprüften Anfragedaten wurden nach der Freigabe verändert. Bitte erneut in der App prüfen.");
      }
      item.status = INQUIRY_STATUS.DISPATCHING;
      item.dispatchStartedAt = now;
      item.dispatchAttemptId = randomUUID();
      item.updatedAt = now;
      item.lastError = "";
      state.history.push(historyEntry("dispatch-started", {
        plotId: item.plotId,
        inquiryId: item.id,
        dispatchAttemptId: item.dispatchAttemptId,
      }, now));
      return state;
    });
  }

  async function dismissInquiries(plotIds) {
    const ids = new Set((Array.isArray(plotIds) ? plotIds : []).map(text).filter(Boolean));
    if (!ids.size) throw new Error("Es wurden keine Grundstücksanfragen zum Entfernen ausgewählt.");
    const dismissibleStatuses = new Set([
      INQUIRY_STATUS.AWAITING_APPROVAL,
      INQUIRY_STATUS.READY_TO_SEND,
      INQUIRY_STATUS.FAILED,
    ]);
    await mutate((state) => {
      const now = dependencies.now();
      let changed = 0;
      for (const item of state.items) {
        if (!ids.has(item.plotId) || !dismissibleStatuses.has(item.status)) continue;
        item.status = INQUIRY_STATUS.ARCHIVED;
        item.archiveReason = "manual_dismissed";
        item.updatedAt = now;
        item.lastError = "";
        changed += 1;
        state.history.push(historyEntry("inquiry-dismissed", {
          plotId: item.plotId,
          inquiryId: item.id,
          reason: "manual_dismissed",
        }, now));
      }
      if (!changed) throw new Error("Diese Anfrage kann nach dem Versand nicht mehr aus der Freigabeliste entfernt werden.");
      state.history = state.history.slice(-HISTORY_LIMIT);
      return state;
    });
    return sync();
  }

  async function legalDecision(plotId, decision) {
    const normalizedDecision = decision === "approved" ? "approved" : decision === "rejected" ? "rejected" : "";
    if (!normalizedDecision) throw new Error("Die rechtliche Entscheidung ist ungültig.");
    return mutate((state) => {
      const now = dependencies.now();
      const item = state.items.find((entry) => entry.plotId === text(plotId));
      if (!item || item.status !== INQUIRY_STATUS.LEGAL_REVIEW_REQUIRED) {
        throw new Error("Für dieses Grundstück liegt keine offene rechtliche Freigabe vor.");
      }
      item.legalDecision = normalizedDecision;
      item.legalDecisionAt = now;
      item.updatedAt = now;
      const afterBrokerResponse = Boolean(item.sentAt);
      item.status = normalizedDecision === "approved"
        ? (afterBrokerResponse ? INQUIRY_STATUS.READY_FOR_EXPOSE : INQUIRY_STATUS.READY_TO_SEND)
        : INQUIRY_STATUS.BLOCKED;
      if (normalizedDecision === "approved" && !afterBrokerResponse) {
        item.dispatchStartedAt = "";
        item.dispatchAttemptId = "";
        item.lastError = "";
        item.transferNote = "Rechtliche Versandfreigabe liegt vor; Anfrage wartet auf den Portalversand.";
      }
      state.history.push(historyEntry(`legal-${normalizedDecision}`, {
        plotId: item.plotId,
        inquiryId: item.id,
        phase: afterBrokerResponse ? "broker_response" : "dispatch",
      }, now));
      return state;
    });
  }

  async function identifyProvider(plotIdValue, providerNameValue) {
    const plotId = text(plotIdValue);
    const providerName = text(providerNameValue);
    if (!plotId) throw new Error("Die Grundstücks-ID für den Inseratersteller fehlt.");
    if (!providerName || providerName.length > 180 || /[\r\n]/u.test(providerName)) {
      throw new Error("Der Inseratersteller muss als eindeutiger Firmen- oder Personenname angegeben werden.");
    }
    if (isGenericListingSourceName(providerName) || /^https?:\/\//iu.test(providerName)) {
      throw new Error("Das Portal ist nur die Quelle und darf nicht als Inseratersteller gespeichert werden.");
    }

    const currentState = await load();
    const inquiry = currentState.items.find((entry) => entry.plotId === plotId);
    if (!inquiry) throw new Error("Die Grundstücksanfrage wurde nicht gefunden.");

    const manifest = await dependencies.loadCatalog();
    if (!manifest.stored || !manifest.state) throw new Error("Der lokale App-Katalog wurde nicht gefunden.");
    const catalog = normalizePlotState(manifest.state);
    if (!catalog.plots.some((plot) => plot.id === plotId)) throw new Error("Das zugehörige Grundstück wurde im App-Katalog nicht gefunden.");
    const now = dependencies.now();
    const updatedCatalog = {
      ...catalog,
      plots: catalog.plots.map((plot) => plot.id === plotId ? {
        ...plot,
        sourceProviderName: providerName,
        updatedAt: now,
      } : plot),
    };
    const sessionId = `plot_inquiry_provider_${randomUUID().replaceAll("-", "_")}`;
    const snapshot = await dependencies.startCatalog({
      sessionId,
      savedAt: now,
      expectedSavedAt: manifest.savedAt || "",
      state: updatedCatalog,
    });
    if (snapshot.missingImageIds?.length) throw new Error("Der App-Katalog enthält nicht verfügbare Bilddateien.");
    await dependencies.commitCatalog(sessionId);

    const houseBuilder = isHouseBuilderOffer({ ...inquiry, sourceProviderName: providerName });
    const result = await mutate((state) => {
      const item = state.items.find((entry) => entry.plotId === plotId);
      if (!item) throw new Error("Die Grundstücksanfrage wurde nicht gefunden.");
      const providerChangedAfterApproval = item.status === INQUIRY_STATUS.READY_TO_SEND
        && item.sourceProviderName !== providerName;
      item.sourceProviderName = providerName;
      item.providerReviewRequired = false;
      item.updatedAt = now;
      item.lastError = "";
      state.history.push(historyEntry("provider-identified", {
        plotId,
        inquiryId: item.id,
        providerName,
      }, now));
      if (providerChangedAfterApproval) {
        item.status = INQUIRY_STATUS.AWAITING_APPROVAL;
        item.approvedAt = "";
        item.dispatchAuthorizationHash = "";
        state.history.push(historyEntry("dispatch-authorization-invalidated", {
          plotId,
          inquiryId: item.id,
          reason: "provider_changed_after_approval",
        }, now));
      }
      if (houseBuilder && [INQUIRY_STATUS.AWAITING_APPROVAL, INQUIRY_STATUS.READY_TO_SEND].includes(item.status)) {
        item.status = INQUIRY_STATUS.ARCHIVED;
        item.archiveReason = "house_builder_offer";
        state.history.push(historyEntry("house-builder-provider-identified", {
          plotId,
          inquiryId: item.id,
          providerName,
        }, now));
      }
      return state;
    });
    return houseBuilder ? sync() : result;
  }

  async function recordEvent(input) {
    const plotId = text(input?.plotId);
    const event = text(input?.event);
    if (!plotId || !event) throw new Error("Grundstücks-ID und Ereignis sind erforderlich.");
    if (event === "provider_identified") return identifyProvider(plotId, input?.providerName);
    return mutate((state) => {
      const now = dependencies.now();
      const item = state.items.find((entry) => entry.plotId === plotId);
      if (!item) throw new Error("Die Grundstücksanfrage wurde nicht gefunden.");
      if (event === "recipient_identified") {
        if (item.status !== INQUIRY_STATUS.AWAITING_APPROVAL) {
          throw new Error("Die Anrede kann nach der Versandfreigabe nicht mehr verändert werden.");
        }
        const salutation = text(input.salutation);
        if (!/^Guten Tag .+,$/u.test(salutation) || salutation.length > 160 || /[\r\n]/u.test(salutation)) {
          throw new Error("Die Anrede muss vollständig als „Guten Tag …,“ angegeben werden.");
        }
        item.recipientSalutation = salutation;
        item.inquiryMessage = replaceMessageSalutation(item.inquiryMessage, salutation);
      } else if (event === "inquiry_sent") {
        if (item.status !== INQUIRY_STATUS.DISPATCHING) throw new Error("Für die Anfrage wurde kein eindeutiger Versandversuch gestartet.");
        if (!text(input.dispatchAttemptId) || text(input.dispatchAttemptId) !== item.dispatchAttemptId) {
          throw new Error("Der Versandnachweis gehört nicht zum aktuellen Versandversuch.");
        }
        item.status = INQUIRY_STATUS.WAITING_FOR_BROKER;
        item.sentAt = safeIso(input.sentAt, now);
      } else if (event === "broker_response") {
        const classification = classifyBrokerContent(`${input.summary || ""}\n${input.content || ""}`);
        item.responseReceivedAt = safeIso(input.receivedAt, now);
        item.brokerMessageId = text(input.messageId);
        item.brokerSummary = text(input.summary || input.content).slice(0, 1000);
        item.legalReasons = classification.reasons;
        item.status = classification.legalReviewRequired
          ? INQUIRY_STATUS.LEGAL_REVIEW_REQUIRED
          : INQUIRY_STATUS.READY_FOR_EXPOSE;
      } else if (event === "legal_review_required") {
        const classification = classifyBrokerContent(`${input.summary || ""}\n${input.content || ""}`);
        item.legalReasons = classification.reasons.length ? classification.reasons : ["Manuelle Vertragsprüfung erforderlich"];
        item.brokerSummary = text(input.summary || input.content).slice(0, 1000);
        item.status = INQUIRY_STATUS.LEGAL_REVIEW_REQUIRED;
      } else if (event === "portal_control_allowlisted") {
        const control = {
          type: text(input.controlType) || "checkbox",
          name: text(input.controlName),
          label: portalControlLabel(input.label),
          checked: input.checked !== false,
        };
        const decision = evaluatePortalControlFields(item, [control]);
        if (decision.allowlisted.length !== 1 || decision.legalReviewRequired) {
          throw new Error("Das Portal-Kontrollfeld ist nicht durch die enge Profilfreigabe-Allowlist gedeckt.");
        }
        item.updatedAt = now;
        item.transferNote = "Die dauerhafte Allowlist für die ImmoScout24-Profilfreigabe wurde angewendet; andere Kontrollfelder bleiben deaktiviert.";
        state.history.push(historyEntry("portal-control-allowlisted", {
          plotId: item.plotId,
          inquiryId: item.id,
          policyId: decision.allowlisted[0].policyId,
          controlName: decision.allowlisted[0].name,
          label: decision.allowlisted[0].label,
        }, now));
        return state;
      } else if (event === "failed") {
        if (item.status === INQUIRY_STATUS.DISPATCHING && text(input.dispatchAttemptId) !== item.dispatchAttemptId) {
          throw new Error("Die Fehlermeldung gehört nicht zum aktuellen Versandversuch.");
        }
        item.status = INQUIRY_STATUS.FAILED;
        item.lastError = text(input.message || "Unbekannter Fehler").slice(0, 1000);
      } else if (event === "dispatch_uncertain") {
        if (item.status !== INQUIRY_STATUS.DISPATCHING || text(input.dispatchAttemptId) !== item.dispatchAttemptId) {
          throw new Error("Der unklare Versandstatus gehört nicht zum aktuellen Versandversuch.");
        }
        item.status = INQUIRY_STATUS.BLOCKED;
        item.lastError = text(input.message || "Der externe Versand konnte nicht eindeutig bestätigt werden.").slice(0, 1000);
      } else if (event === "blocked") {
        item.status = INQUIRY_STATUS.BLOCKED;
        item.lastError = text(input.message).slice(0, 1000);
      } else {
        throw new Error(`Unbekanntes Anfrageereignis: ${event}`);
      }
      item.updatedAt = now;
      state.history.push(historyEntry(event, { plotId: item.plotId, inquiryId: item.id }, now));
      return state;
    });
  }

  async function attachExpose(plotIdValue, sourcePathValue) {
    const plotId = text(plotIdValue);
    const requestedSource = resolve(text(sourcePathValue));
    if (!plotId || !text(sourcePathValue)) throw new Error("Grundstücks-ID und Exposé-Datei sind erforderlich.");
    const allowedRoot = await realpath(config.exposeInbox).catch(() => resolve(config.exposeInbox));
    await assertLocalPlotPath(config.exposeInbox);
    const sourcePath = await realpath(requestedSource);
    if (sourcePath !== allowedRoot && !sourcePath.startsWith(`${allowedRoot}${sep}`)) {
      throw new Error("Die Exposé-Datei liegt außerhalb des freigegebenen Eingangsordners.");
    }
    const sourceStat = await stat(sourcePath);
    if (!sourceStat.isFile() || sourceStat.size <= 0 || sourceStat.size > MAX_PLOT_EXPOSE_BYTES) {
      throw new Error("Das Exposé ist leer, ungültig oder größer als 30 MB.");
    }
    const data = await readFile(sourcePath);
    const analyzed = await dependencies.analyzeExpose({ data, filename: basename(sourcePath) });
    let committed;
    let catalogReady = false;
    let transferNote = "";
    let catalogAddress = "";
    try {
      committed = await dependencies.commitExpose({
        temporaryReference: analyzed.temporaryReference,
        plotId,
        filename: analyzed.filename,
      });
      const manifest = await dependencies.loadCatalog();
      if (!manifest.stored || !manifest.state) throw new Error("Der lokale App-Katalog wurde nicht gefunden.");
      const catalog = normalizePlotState(manifest.state);
      if (!catalog.plots.some((plot) => plot.id === plotId)) throw new Error("Das zugehörige Grundstück wurde im App-Katalog nicht gefunden.");
      const now = dependencies.now();
      const originalPlot = catalog.plots.find((plot) => plot.id === plotId);
      const merged = mergeExposeFieldsIntoPlot(originalPlot, analyzed.fields);
      const state = {
        ...catalog,
        plots: catalog.plots.map((plot) => plot.id === plotId ? {
          ...merged.plot,
          exposeFileReference: committed.reference,
          exposeFilename: committed.filename,
          exposeUploadedAt: committed.uploadedAt || now,
          sourceExposeFilename: committed.filename,
          updatedAt: now,
        } : plot),
      };
      const sessionId = `plot_inquiry_expose_${randomUUID().replaceAll("-", "_")}`;
      const snapshot = await dependencies.startCatalog({
        sessionId,
        savedAt: now,
        expectedSavedAt: manifest.savedAt || "",
        state,
      });
      if (snapshot.missingImageIds?.length) throw new Error("Der App-Katalog enthält nicht verfügbare Bilddateien.");
      await dependencies.commitCatalog(sessionId);
      catalogReady = merged.readyForCatalog;
      transferNote = merged.note;
      catalogAddress = merged.readyForCatalog
        ? addressFor(merged.plot)
        : "";
    } catch (error) {
      if (committed?.reference) await dependencies.archiveExpose(committed.reference).catch(() => undefined);
      throw error;
    }
    return mutate((state) => {
      const now = dependencies.now();
      const item = state.items.find((entry) => entry.plotId === plotId);
      if (!item) throw new Error("Die Grundstücksanfrage wurde nicht gefunden.");
      item.exposeFilename = committed.filename;
      item.exposeFileReference = committed.reference;
      item.exposeReceivedAt = committed.uploadedAt || now;
      item.status = catalogReady ? INQUIRY_STATUS.COMPLETED : INQUIRY_STATUS.READY_FOR_EXPOSE;
      item.address = catalogAddress || item.address;
      item.updatedAt = now;
      item.lastError = "";
      item.transferNote = transferNote;
      state.history.push(historyEntry(catalogReady ? "expose-attached" : "expose-review-required", {
        plotId,
        inquiryId: item.id,
        filename: committed.filename,
      }, now));
      return state;
    });
  }

  return {
    config,
    status,
    sync,
    preview,
    approveInquiries,
    claimDispatch,
    dismissInquiries,
    legalDecision,
    identifyProvider,
    recordEvent,
    attachExpose,
  };
}
