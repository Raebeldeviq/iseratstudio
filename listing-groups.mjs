import {
  fillMissingProjectingDefaults,
  IMMOPROFESSIONAL_DEFAULTS,
} from "./listing-copy.mjs";
import {
  ACTIVE_HOUSES_PER_PROJECT,
  MAX_LISTING_GROUP_LOGS,
  PROCESS_LEASE_MS,
} from "./listing-rules.mjs";
import {
  normalizeWorkflowStatus,
  workflowStatusMessage,
  WORKFLOW_STATUS,
} from "./workflow-status.mjs";

export const DEFAULT_LISTING_VARIANT_COUNT = ACTIVE_HOUSES_PER_PROJECT;
export const LISTING_GROUP_LOG_LIMIT = MAX_LISTING_GROUP_LOGS;
export const LISTING_GROUP_LEASE_MS = PROCESS_LEASE_MS;

// Nur noch Alt-Exporte dürfen diese Namen importieren. Sie sind keine Grenzen.
export const LISTING_GROUP_PRIMARY_COUNT = DEFAULT_LISTING_VARIANT_COUNT;
export const LISTING_GROUP_ALTERNATIVE_COUNT = 0;
export const LISTING_GROUP_VARIANT_COUNT = DEFAULT_LISTING_VARIANT_COUNT;

export const LISTING_GROUP_AUTOMATION_DEFAULTS = Object.freeze({
  automaticUpdateEnabled: false,
  updateIntervalDays: 12,
  automaticRecreationEnabled: true,
  automaticDeletionEnabled: false,
  rotationEnabled: true,
  maxUpdatesPerDay: 1,
  lastUpdatedAt: "",
  nextUpdatedAt: "",
});

const REQUIRED_PROJECTING_DEFAULT_KEYS = Object.freeze([
  "equipmentQuality", "constructionPhase", "attic", "guestWc", "gardenUse",
  "underfloorHeating", "electricFuel", "airSourceHeatPump", "kfw40", "kfw55",
  "energyClass", "commissionRequired", "energyCertificateClass", "fittedKitchen",
  "openKitchen", "shower", "bathtub", "bathroomWindow", "environmentBus",
  "environmentShopping",
]);

function uid() {
  return globalThis.crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

function positiveInteger(value, fallback) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function finiteInteger(value, fallback = 0) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function emptyVariant(projectId, order, idFactory, timestamp) {
  return {
    id: idFactory(),
    projectId,
    role: "variant",
    order,
    templateId: "",
    templateName: "",
    active: false,
    approved: false,
    houseSnapshot: null,
    listing: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function orderVariants(variants, timestamp) {
  return variants.map((variant, index) => ({
    ...variant,
    role: "variant",
    order: index + 1,
    updatedAt: variant.updatedAt || timestamp,
  }));
}

export function createListingGroup(projectId, options = {}) {
  const idFactory = options.idFactory || uid;
  const timestamp = options.now || nowIso();
  const suggestedCount = positiveInteger(
    options.suggestedVariantCount,
    DEFAULT_LISTING_VARIANT_COUNT,
  );
  const group = {
    schemaVersion: 2,
    id: idFactory(),
    projectId,
    variants: Array.from(
      { length: suggestedCount },
      (_, index) => emptyVariant(projectId, index + 1, idFactory, timestamp),
    ),
    automation: { ...LISTING_GROUP_AUTOMATION_DEFAULTS },
    listingControls: [],
    logs: [],
    rotationCounter: 0,
    lastStatus: WORKFLOW_STATUS.DRAFT,
    lastStatusMessage: "Noch nicht ausgeführt",
    lastError: "",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return group;
}

export function normalizeListingGroup(value, projectId, options = {}) {
  const idFactory = options.idFactory || uid;
  const timestamp = options.now || nowIso();
  const source = value && typeof value === "object" ? value : {};
  const sourceWithoutLegacyLease = { ...source };
  delete sourceWithoutLegacyLease.processLease;
  const storedVariants = Array.isArray(source.variants) ? source.variants : [];
  const isDynamic = Number(source.schemaVersion) >= 2;
  const migratedVariants = isDynamic
    ? storedVariants
    : storedVariants.filter((variant) => variant?.templateId && variant?.houseSnapshot && variant?.listing);
  const baseVariants = migratedVariants.map((stored, index) => {
    const fallback = emptyVariant(projectId, index + 1, idFactory, timestamp);
    const assigned = Boolean(stored?.templateId && stored?.houseSnapshot && stored?.listing);
    return {
      ...fallback,
      ...(stored && typeof stored === "object" ? stored : {}),
      id: String(stored?.id || fallback.id),
      projectId,
      role: "variant",
      order: index + 1,
      templateId: assigned ? String(stored.templateId) : "",
      templateName: assigned ? String(stored.templateName || stored.houseSnapshot?.name || "") : "",
      active: assigned && stored.active !== false,
      approved: assigned && stored.approved !== false,
      houseSnapshot: assigned ? stored.houseSnapshot : null,
      listing: assigned ? {
        ...stored.listing,
        listingGroupVariantId: String(stored.id || fallback.id),
        createdAt: String(stored.listing.createdAt || stored.createdAt || timestamp),
        projectingSettings: fillMissingProjectingDefaults(stored.listing.projectingSettings),
      } : null,
      createdAt: String(stored?.createdAt || fallback.createdAt),
      updatedAt: String(stored?.updatedAt || timestamp),
    };
  });
  if (!isDynamic) {
    while (baseVariants.length < DEFAULT_LISTING_VARIANT_COUNT) {
      baseVariants.push(emptyVariant(projectId, baseVariants.length + 1, idFactory, timestamp));
    }
  }
  const storedAutomation = source.automation && typeof source.automation === "object"
    ? source.automation
    : {};
  const currentAutomation = { ...storedAutomation };
  delete currentAutomation.lastUsedVariantId;
  delete currentAutomation.nextVariantId;
  const automation = {
    ...LISTING_GROUP_AUTOMATION_DEFAULTS,
    ...currentAutomation,
    updateIntervalDays: positiveInteger(source.automation?.updateIntervalDays, 12),
    maxUpdatesPerDay: positiveInteger(source.automation?.maxUpdatesPerDay, 1),
    automaticDeletionEnabled: false,
  };
  const normalized = {
    ...sourceWithoutLegacyLease,
    schemaVersion: 2,
    id: String(source.id || idFactory()),
    projectId,
    variants: orderVariants(baseVariants, timestamp),
    automation,
    listingControls: Array.isArray(source.listingControls)
      ? source.listingControls.map((control) => normalizeStoredControl(control, projectId))
      : [],
    logs: Array.isArray(source.logs) ? source.logs.slice(-LISTING_GROUP_LOG_LIMIT).map((log) => ({
      ...log,
      processStatus: normalizeWorkflowStatus(log?.processStatus, WORKFLOW_STATUS.DRAFT),
      message: workflowStatusMessage(log?.processStatus, log?.message),
    })) : [],
    rotationCounter: Math.max(0, finiteInteger(source.rotationCounter)),
    lastStatus: normalizeWorkflowStatus(source.lastStatus, WORKFLOW_STATUS.DRAFT),
    lastStatusMessage: workflowStatusMessage(source.lastStatus, source.lastStatusMessage),
    lastError: String(source.lastError || ""),
    createdAt: String(source.createdAt || timestamp),
    updatedAt: timestamp,
  };
  return normalized;
}

export function addListingGroupVariant(groupValue, options = {}) {
  const timestamp = options.now || nowIso();
  const idFactory = options.idFactory || uid;
  const group = normalizeListingGroup(groupValue, groupValue.projectId, { idFactory, now: timestamp });
  const added = emptyVariant(group.projectId, group.variants.length + 1, idFactory, timestamp);
  const variants = [...group.variants];
  const afterIndex = options.afterVariantId
    ? variants.findIndex((variant) => variant.id === options.afterVariantId)
    : -1;
  variants.splice(afterIndex >= 0 ? afterIndex + 1 : variants.length, 0, added);
  return { ...group, variants: orderVariants(variants, timestamp), updatedAt: timestamp };
}

export function removeListingGroupVariant(groupValue, variantId, options = {}) {
  const timestamp = options.now || nowIso();
  const group = normalizeListingGroup(groupValue, groupValue.projectId, { idFactory: options.idFactory, now: timestamp });
  const removed = group.variants.find((variant) => variant.id === variantId);
  if (!removed) return group;
  const referencedByCopies = group.listingControls.some((control) =>
    control.variantId === variantId && control.listingId !== removed.listing?.id);
  if (referencedByCopies && !options.force) {
    throw new Error("Diese Variante wird von bestehenden Inseraten verwendet und kann nur deaktiviert werden.");
  }
  return {
    ...group,
    variants: orderVariants(group.variants.filter((variant) => variant.id !== variantId), timestamp),
    listingControls: group.listingControls.filter((control) => control.listingId !== removed.listing?.id),
    updatedAt: timestamp,
  };
}

export function createHouseVariantSnapshot(house) {
  if (!house || typeof house !== "object" || !house.id) {
    throw new Error("Für die Inseratsvariante fehlt ein gültiger Haustyp.");
  }
  if (house.approved === false) {
    throw new Error(`Der Haustyp „${house.name || house.id}“ ist nicht freigegeben.`);
  }
  return {
    id: String(house.id), name: String(house.name || ""), houseType: String(house.houseType || ""),
    livingArea: Number(house.livingArea) || 0, rooms: Number(house.rooms) || 0,
    bedrooms: Number(house.bedrooms) || 0, bathrooms: Number(house.bathrooms) || 0,
    floors: Number(house.floors) || 0, housePrice: Number(house.housePrice) || 0,
    constructionYear: Number(house.constructionYear) || 0,
    energyDemand: Number(house.energyDemand) || 0, energyClass: String(house.energyClass || ""),
    heatingType: String(house.heatingType || ""), energySource: String(house.energySource || ""),
    architecture: String(house.architecture || ""), equipmentHighlights: String(house.equipmentHighlights || ""),
    useStandardPackage: house.useStandardPackage !== false,
    images: Array.isArray(house.images) ? house.images.map((image) => ({
      id: String(image.id || ""), name: String(image.name || ""), caption: String(image.caption || ""),
      mimeType: String(image.mimeType || ""), isFloorplan: image.isFloorplan === true,
      role: String(image.role || "other"),
    })) : [],
  };
}

function variantIndex(group, variantReference) {
  if (typeof variantReference === "string") {
    return group.variants.findIndex((variant) => variant.id === variantReference);
  }
  return Math.trunc(Number(variantReference)) - 1;
}

export function assignListingGroupVariant(groupValue, variantReference, house, listing, options = {}) {
  const timestamp = options.now || nowIso();
  const group = normalizeListingGroup(groupValue, groupValue.projectId, { idFactory: options.idFactory, now: timestamp });
  const index = variantIndex(group, variantReference);
  if (index < 0 || index >= group.variants.length) throw new Error("Die Inseratsvariante ist nicht vorhanden.");
  if (!listing || typeof listing !== "object") throw new Error("Für die Inseratsvariante fehlen die vollständigen Inseratsdaten.");
  const current = group.variants[index];
  const normalizedListing = {
    ...listing,
    templateId: house.id,
    templateName: house.name,
    listingGroupVariantId: current.id,
    listingOrigin: listing.listingOrigin || "group-source",
    createdAt: String(listing.createdAt || current.createdAt || timestamp),
    projectingSettings: fillMissingProjectingDefaults(listing.projectingSettings),
  };
  const variants = group.variants.map((variant, variantIndexValue) => variantIndexValue === index ? {
    ...variant,
    templateId: house.id,
    templateName: house.name,
    active: options.active !== false,
    approved: true,
    houseSnapshot: createHouseVariantSnapshot(house),
    listing: normalizedListing,
    updatedAt: timestamp,
  } : variant);
  const updated = { ...group, variants, updatedAt: timestamp };
  return updateListingControl(updated, normalizedListing, {
    variantId: current.id,
  }, { idFactory: options.idFactory, now: timestamp });
}

export function clearListingGroupVariant(groupValue, variantReference, options = {}) {
  const timestamp = options.now || nowIso();
  const group = normalizeListingGroup(groupValue, groupValue.projectId, { idFactory: options.idFactory, now: timestamp });
  const index = variantIndex(group, variantReference);
  if (index < 0 || index >= group.variants.length) return group;
  const current = group.variants[index];
  const cleared = { ...emptyVariant(group.projectId, index + 1, options.idFactory || uid, timestamp), id: current.id, createdAt: current.createdAt };
  return {
    ...group,
    variants: group.variants.map((variant, currentIndex) => currentIndex === index ? cleared : variant),
    listingControls: group.listingControls.filter((control) => control.listingId !== current.listing?.id),
    updatedAt: timestamp,
  };
}

export function setListingGroupVariantActive(groupValue, variantId, active, options = {}) {
  const timestamp = options.now || nowIso();
  const group = normalizeListingGroup(groupValue, groupValue.projectId, { idFactory: options.idFactory, now: timestamp });
  return {
    ...group,
    variants: group.variants.map((variant) => variant.id === variantId && variant.templateId
      ? { ...variant, active: Boolean(active), updatedAt: timestamp }
      : variant),
    updatedAt: timestamp,
  };
}

export function moveListingGroupVariant(groupValue, variantId, direction, options = {}) {
  const timestamp = options.now || nowIso();
  const group = normalizeListingGroup(groupValue, groupValue.projectId, { idFactory: options.idFactory, now: timestamp });
  const index = group.variants.findIndex((variant) => variant.id === variantId);
  const targetIndex = index + (direction === "up" ? -1 : 1);
  if (index < 0 || targetIndex < 0 || targetIndex >= group.variants.length) return group;
  const variants = [...group.variants];
  [variants[index], variants[targetIndex]] = [variants[targetIndex], variants[index]];
  return { ...group, variants: orderVariants(variants, timestamp), updatedAt: timestamp };
}

export function replaceListingGroupVariantListing(groupValue, variantId, listing, options = {}) {
  const timestamp = options.now || nowIso();
  const group = normalizeListingGroup(groupValue, groupValue.projectId, { idFactory: options.idFactory, now: timestamp });
  return {
    ...group,
    variants: group.variants.map((variant) => variant.id === variantId ? {
      ...variant,
      listing: {
        ...listing,
        templateId: variant.templateId,
        templateName: variant.templateName,
        listingGroupVariantId: variant.id,
        createdAt: String(listing.createdAt || variant.listing?.createdAt || timestamp),
        projectingSettings: fillMissingProjectingDefaults(listing.projectingSettings),
      },
      updatedAt: timestamp,
    } : variant),
    updatedAt: timestamp,
  };
}

function valuesEqual(left, right) {
  return typeof right === "number" ? Number(left) === right : left === right;
}

export function validateListingGroupVariant(variant, house, options = {}) {
  const issues = [];
  if (!variant?.templateId || !variant.houseSnapshot || !variant.listing) return ["Die Variante ist nicht vollständig zugeordnet."];
  if (!house || house.id !== variant.templateId) return ["Der zugeordnete Haustyp ist nicht mehr im freigegebenen Hauskatalog vorhanden."];
  if (house.approved === false) issues.push("Der Haustyp ist nicht freigegeben.");
  const currentSnapshot = createHouseVariantSnapshot({ ...house, approved: true });
  for (const key of [
    "id", "name", "houseType", "livingArea", "rooms", "bedrooms", "bathrooms", "floors",
    "housePrice", "constructionYear", "energyDemand", "energyClass", "heatingType", "energySource",
    "architecture", "equipmentHighlights", "useStandardPackage",
  ]) {
    if (!valuesEqual(variant.houseSnapshot[key], currentSnapshot[key])) issues.push(`Die gespeicherten Hausdaten sind bei „${key}“ nicht mehr aktuell.`);
  }
  const storedImages = (variant.houseSnapshot.images || []).map((image) => image.id);
  const currentImages = currentSnapshot.images.map((image) => image.id);
  if (storedImages.length < 4) issues.push("Der Variante sind weniger als vier Hausbilder zugeordnet.");
  if (JSON.stringify(storedImages) !== JSON.stringify(currentImages)) issues.push("Die gespeicherte Bildfolge stimmt nicht mehr mit dem Haustyp überein.");
  if (variant.listing.templateId !== house.id || variant.listing.templateName !== house.name) issues.push("Inserat und Haustyp sind nicht konsistent verknüpft.");
  if (Number.isFinite(options.expectedPrice) && Number(variant.listing.price) !== Number(options.expectedPrice)) issues.push("Der Inseratspreis passt nicht zur ausgewählten Hausvariante und zum Grundstück.");
  for (const field of ["title", "description", "equipment", "location", "other"]) {
    if (!String(variant.listing.texts?.[field] || "").trim()) issues.push(`Das Textfeld „${field}“ ist leer.`);
  }
  const settings = variant.listing.projectingSettings || {};
  for (const key of REQUIRED_PROJECTING_DEFAULT_KEYS) {
    if (settings[key] !== IMMOPROFESSIONAL_DEFAULTS[key]) issues.push(`Der feste Projektierungswert „${key}“ ist nicht vollständig gesetzt.`);
  }
  return [...new Set(issues)];
}

export function updateListingGroupAutomation(groupValue, patch, options = {}) {
  const timestamp = options.now || nowIso();
  const group = normalizeListingGroup(groupValue, groupValue.projectId, { idFactory: options.idFactory, now: timestamp });
  const automation = {
    ...group.automation,
    ...patch,
    updateIntervalDays: positiveInteger(patch.updateIntervalDays ?? group.automation.updateIntervalDays, 12),
    maxUpdatesPerDay: positiveInteger(patch.maxUpdatesPerDay ?? group.automation.maxUpdatesPerDay, 1),
    automaticDeletionEnabled: false,
  };
  return { ...group, automation, updatedAt: timestamp };
}

function normalizeStoredControl(stored, projectId) {
  return {
    listingId: String(stored?.listingId || ""), externalId: String(stored?.externalId || ""),
    projectId, variantId: String(stored?.variantId || ""), automaticUpdateEnabled: stored?.automaticUpdateEnabled !== false,
    automaticDeletionEnabled: false,
    premiumPlacement: stored?.premiumPlacement === true, manualLock: stored?.manualLock === true,
    lockedUntil: String(stored?.lockedUntil || ""), lockReason: String(stored?.lockReason || ""),
    lastUpdatedAt: String(stored?.lastUpdatedAt || ""), nextUpdatedAt: String(stored?.nextUpdatedAt || ""),
    lastAttemptAt: String(stored?.lastAttemptAt || ""), lastSuccessAt: String(stored?.lastSuccessAt || stored?.lastUpdatedAt || ""),
    lastError: String(stored?.lastError || ""),
    status: normalizeWorkflowStatus(stored?.status, WORKFLOW_STATUS.DRAFT),
    statusMessage: workflowStatusMessage(stored?.status, stored?.statusMessage),
    userPriority: Math.max(-100, Math.min(100, finiteInteger(stored?.userPriority))),
    updateMode: ["full-auto", "copy-without-delete", "prepare-only", "blocked"].includes(stored?.updateMode)
      ? stored.updateMode : "prepare-only",
    schedulerSelectionId: String(stored?.schedulerSelectionId || ""),
    schedulerSelectedAt: String(stored?.schedulerSelectedAt || ""),
    pendingRotationListingId: String(stored?.pendingRotationListingId || ""),
    pendingRotationJobId: String(stored?.pendingRotationJobId || ""),
    processLease: stored?.processLease && typeof stored.processLease === "object" ? stored.processLease : null,
  };
}

export function listingControl(groupValue, listing) {
  const stored = (groupValue?.listingControls || []).find((control) => control.listingId === listing.id);
  const normalized = normalizeStoredControl({
    listingId: listing.id,
    externalId: listing.externalId,
    variantId: listing.listingGroupVariantId || "",
    ...(stored || {}),
  }, groupValue.projectId);
  return normalized;
}

export function updateListingControl(groupValue, listing, patch, options = {}) {
  const timestamp = options.now || nowIso();
  const group = normalizeListingGroup(groupValue, groupValue.projectId, { idFactory: options.idFactory, now: timestamp });
  const updated = normalizeStoredControl({
    ...listingControl(group, listing), ...patch,
    listingId: listing.id, externalId: listing.externalId, projectId: group.projectId,
    variantId: patch.variantId ?? listing.listingGroupVariantId ?? "",
  }, group.projectId);
  return { ...group, listingControls: [...group.listingControls.filter((control) => control.listingId !== listing.id), updated], updatedAt: timestamp };
}

export function listingDeletionBlockReasons(groupValue, listing, at = nowIso(), checks = {}) {
  const control = listingControl(groupValue, listing);
  const reasons = [];
  if (!control.automaticDeletionEnabled) reasons.push("Automatisches Löschen ist für dieses Inserat deaktiviert.");
  if (control.updateMode !== "full-auto") reasons.push("Der Aktualisierungsmodus erlaubt keine Löschung.");
  if (control.premiumPlacement) reasons.push("Für das Inserat ist eine Premium-Sperre aktiv.");
  if (control.manualLock) reasons.push("Für das Inserat ist eine manuelle Sperre aktiv.");
  if (control.lockedUntil && Date.parse(control.lockedUntil) > Date.parse(at)) reasons.push(`Das Inserat ist bis ${control.lockedUntil} gesperrt.`);
  if (!checks.newListingCreated) reasons.push("Die neue Anzeige wurde noch nicht erfolgreich erstellt.");
  if (!checks.newExternalId) reasons.push("Eine neue Objektnummer wurde noch nicht bestätigt.");
  if (!checks.validationPassed) reasons.push("Die Pflicht- und Variantenprüfung wurde noch nicht vollständig bestanden.");
  return reasons;
}

function appendLog(group, log) {
  return {
    ...group,
    logs: [...group.logs, log].slice(-LISTING_GROUP_LOG_LIMIT),
    lastStatus: log.processStatus,
    lastStatusMessage: log.message,
    lastError: log.error,
    updatedAt: log.timestamp,
  };
}

function operationLog(group, variant, options) {
  const sourceListing = options.sourceListing || null;
  const sourceVariant = group.variants.find((item) => item.id === sourceListing?.listingGroupVariantId);
  return {
    id: options.idFactory(), timestamp: options.now, projectId: group.projectId,
    oldExternalId: sourceListing?.externalId || "", newExternalId: options.newListing?.externalId || "",
    oldVariantId: sourceVariant?.id || "", oldVariantName: sourceVariant?.templateName || sourceListing?.templateName || "",
    newVariantId: variant?.id || "", newVariantName: variant?.templateName || "", mode: options.mode,
    deletionAllowed: options.deletionAllowed === true, premiumLockActive: options.premiumLockActive === true,
    checkResult: options.issues.length ? options.issues.join(" · ") : "Alle Prüfungen bestanden.",
    variation: options.variation || "Nur zulässige Texte und Reihenfolgen dürfen variieren; alle Sachdaten bleiben an die Hausvariante gekoppelt.",
    error: options.issues.join(" · "),
    processStatus: options.issues.length
      ? WORKFLOW_STATUS.FAILED
      : normalizeWorkflowStatus(options.status, WORKFLOW_STATUS.PREPARED),
    message: options.issues.length
      ? "Fehlgeschlagen"
      : workflowStatusMessage(options.status),
  };
}

export function recordListingGroupCopy(groupValue, variantId, newListing, options = {}) {
  const timestamp = options.now || nowIso();
  const idFactory = options.idFactory || uid;
  let group = normalizeListingGroup(groupValue, groupValue.projectId, { idFactory, now: timestamp });
  const variant = group.variants.find((item) => item.id === variantId);
  if (!variant) throw new Error("Die kopierte Hausvariante gehört nicht zu dieser Inseratsgruppe.");
  const sourceListingId = options.sourceListingId || newListing.rotationSourceListingId || newListing.id;
  const sourceListing = options.sourceListing
    || group.variants.map((item) => item.listing).find((listing) => listing?.id === sourceListingId)
    || { ...newListing, id: sourceListingId };
  const advanceRotation = options.advanceRotation !== false;
  const nextDate = new Date(Date.parse(timestamp) + group.automation.updateIntervalDays * 86400000).toISOString();
  if (advanceRotation) {
    group = updateListingControl(group, sourceListing, {
      lastAttemptAt: timestamp, lastSuccessAt: timestamp, lastUpdatedAt: timestamp, nextUpdatedAt: nextDate,
      lastError: "",
      status: WORKFLOW_STATUS.PUBLISHED,
      statusMessage: options.statusMessage || workflowStatusMessage(options.status || WORKFLOW_STATUS.PUBLISHED),
      schedulerSelectionId: "", schedulerSelectedAt: "",
      pendingRotationListingId: "", pendingRotationJobId: "", processLease: null,
    }, { idFactory, now: timestamp });
  } else {
    group = updateListingControl(group, sourceListing, {
      lastAttemptAt: timestamp,
      status: normalizeWorkflowStatus(options.sourceStatus, WORKFLOW_STATUS.PUBLISHED),
      statusMessage: options.sourceStatusMessage || "Veröffentlicht · Rotationskopie wartet auf Importbestätigung",
      lastError: "",
      schedulerSelectionId: "",
      schedulerSelectedAt: "",
      pendingRotationListingId: newListing.id,
      pendingRotationJobId: String(options.pendingRotationJobId || ""),
      processLease: null,
    }, { idFactory, now: timestamp });
  }
  group = updateListingControl(group, newListing, {
    automaticUpdateEnabled: advanceRotation,
    status: advanceRotation ? WORKFLOW_STATUS.PUBLISHED : WORKFLOW_STATUS.PREPARED,
    statusMessage: advanceRotation
      ? options.statusMessage || workflowStatusMessage(options.status || WORKFLOW_STATUS.PUBLISHED)
      : "Entwurf wartet auf Upload",
    ...(advanceRotation ? { lastUpdatedAt: timestamp, lastSuccessAt: timestamp, nextUpdatedAt: nextDate } : {}),
  }, { idFactory, now: timestamp });
  group = { ...group, rotationCounter: group.rotationCounter + (advanceRotation ? 1 : 0), updatedAt: timestamp };
  const log = operationLog(group, variant, {
    idFactory, now: timestamp, mode: options.mode || "copy-without-delete", issues: [],
    status: advanceRotation ? WORKFLOW_STATUS.PUBLISHED : WORKFLOW_STATUS.PREPARED,
    newListing, sourceListing,
    variation: options.variation, premiumLockActive: false, deletionAllowed: options.deletionAllowed === true,
  });
  log.message = options.statusMessage || workflowStatusMessage(
    options.status || (advanceRotation ? WORKFLOW_STATUS.PUBLISHED : WORKFLOW_STATUS.PREPARED),
  );
  return { group: appendLog(group, log), log };
}

export function recordListingGroupFailure(groupValue, variantId, mode, issues, options = {}) {
  const timestamp = options.now || nowIso();
  const idFactory = options.idFactory || uid;
  let group = normalizeListingGroup(groupValue, groupValue.projectId, { idFactory, now: timestamp });
  const variant = group.variants.find((item) => item.id === variantId) || null;
  if (options.sourceListing) {
    group = updateListingControl(group, options.sourceListing, {
      lastAttemptAt: timestamp,
      lastError: issues.join(" · "),
      status: options.preserveSourcePublication === true
        ? WORKFLOW_STATUS.PUBLISHED
        : WORKFLOW_STATUS.FAILED,
      statusMessage: options.preserveSourcePublication === true
        ? "Veröffentlicht · Rotation fehlgeschlagen"
        : "Fehlgeschlagen",
      schedulerSelectionId: "", schedulerSelectedAt: "", processLease: null,
    }, { idFactory, now: timestamp });
  }
  const log = operationLog(group, variant, { idFactory, now: timestamp, mode, issues, status: WORKFLOW_STATUS.FAILED, sourceListing: options.sourceListing });
  return { group: appendLog(group, log), log };
}

export function claimListingOperation(groupValue, listing, token, options = {}) {
  const timestamp = options.now || nowIso();
  const group = normalizeListingGroup(groupValue, groupValue.projectId, { idFactory: options.idFactory, now: timestamp });
  const control = listingControl(group, listing);
  const startedAt = Date.parse(control.processLease?.startedAt || "");
  if (control.processLease?.token && control.processLease.token !== token && Number.isFinite(startedAt) && Date.parse(timestamp) - startedAt < LISTING_GROUP_LEASE_MS) {
    throw new Error("Dieses Inserat wird bereits in einem anderen Vorgang verarbeitet.");
  }
  return updateListingControl(group, listing, {
    processLease: { token, startedAt: timestamp },
    lastAttemptAt: timestamp,
    status: WORKFLOW_STATUS.PROCESSING,
    statusMessage: "Wird verarbeitet",
  }, { idFactory: options.idFactory, now: timestamp });
}

export function releaseListingOperation(groupValue, listing, token, options = {}) {
  const control = listingControl(groupValue, listing);
  if (control.processLease?.token && control.processLease.token !== token) return groupValue;
  return updateListingControl(groupValue, listing, { processLease: null }, options);
}
