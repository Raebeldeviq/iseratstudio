import { normalizePromotionLibrary } from "./promotion-images.mjs";

export const CREATIVE_SELECTION_FORMAT = 1;
export const CREATIVE_VARIATION_EXHAUSTED = "CREATIVE_VARIATION_EXHAUSTED";
export const CREATIVE_HOUSE_HISTORY_WINDOW = 16;
export const CREATIVE_HERO_HISTORY_WINDOW = 16;
export const CREATIVE_ACTION_INTERVAL = 4;

const SUPPORTED_HERO_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function text(value) {
  return String(value ?? "").trim();
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))];
}

function timestampFor(listing) {
  return text(listing?.creativeSelection?.selectedAt || listing?.createdAt || listing?.transferredAt || listing?.lastUploadedAt);
}

function chronological(left, right) {
  const leftAt = Date.parse(left.selectedAt || "");
  const rightAt = Date.parse(right.selectedAt || "");
  const timeOrder = (Number.isFinite(leftAt) ? leftAt : 0) - (Number.isFinite(rightAt) ? rightAt : 0);
  return timeOrder
    || left.projectId.localeCompare(right.projectId)
    || left.listingId.localeCompare(right.listingId);
}

function defaultHouseHeroImage(house) {
  return (house?.images || []).find((image) =>
    image?.isFloorplan !== true
    && text(image?.role) === "cover"
    && SUPPORTED_HERO_IMAGE_TYPES.has(text(image?.mimeType)))
    || null;
}

export function creativeSelectionHistory(state) {
  const houses = new Map((state?.houses || []).map((house) => [text(house.id), house]));
  return (state?.projects || []).flatMap((project) => (project.listings || []).flatMap((listing) => {
    if (listing?.listingOrigin !== "rotation-copy") return [];
    const houseId = text(listing.creativeSelection?.houseId || listing.rotationAddedHouseId || listing.templateId);
    if (!houseId) return [];
    const promotionImageId = text(listing.creativeSelection?.promotionImageId || listing.promotionImageId);
    const inferredHouseHero = defaultHouseHeroImage(houses.get(houseId));
    const heroImageId = text(
      listing.creativeSelection?.heroImageId
      || listing.heroImageId
      || promotionImageId
      || inferredHouseHero?.id,
    );
    return [{
      projectId: text(project.id),
      plotId: text(project.plotId),
      listingId: text(listing.id),
      externalId: text(listing.externalId),
      houseId,
      heroType: promotionImageId ? "action" : "house",
      heroImageId,
      promotionImageId,
      selectedAt: timestampFor(listing),
    }];
  })).sort(chronological);
}

function lastUse(entries, key, value, projectId = "") {
  return [...entries].reverse().find((entry) =>
    entry[key] === value && (!projectId || entry.projectId === projectId))?.selectedAt || "";
}

function recentCount(entries, key, value, windowSize, projectId = "") {
  return entries
    .filter((entry) => !projectId || entry.projectId === projectId)
    .slice(-windowSize)
    .filter((entry) => entry[key] === value).length;
}

function usageFor(distribution, houseId) {
  return (distribution?.houseUsage || []).find((usage) => text(usage.houseId) === houseId) || {};
}

/**
 * Deterministische LRU-/Score-Auswahl. Ein direkter Hausrepeat bleibt nur dann
 * zulässig, wenn kein anderer fachlich freigegebener Kandidat vorhanden ist.
 */
export function planCreativeHouseSelection(state, input = {}) {
  const projectId = text(input.projectId);
  const sourceHouseId = text(input.sourceHouseId);
  const candidates = uniqueStrings(input.candidateHouseIds);
  if (!candidates.length) {
    return {
      ok: false,
      houseId: "",
      reason: "Kein fachlich zulässiges Haus steht für die Creative-Auswahl bereit.",
      diagnostics: [CREATIVE_VARIATION_EXHAUSTED],
    };
  }
  const history = creativeSelectionHistory(state);
  const projectHistory = history.filter((entry) => entry.projectId === projectId);
  const globalLastHouseId = history.at(-1)?.houseId || "";
  const projectLastHouseId = projectHistory.at(-1)?.houseId || "";
  const hasAlternativeToSource = candidates.some((houseId) => houseId !== sourceHouseId);
  const ranked = candidates.map((houseId) => {
    const storedUsage = usageFor(input.distribution || state?.houseDistribution, houseId);
    return {
      houseId,
      directSourceRepeat: hasAlternativeToSource && houseId === sourceHouseId ? 1 : 0,
      directProjectRepeat: candidates.length > 1 && houseId === projectLastHouseId ? 1 : 0,
      directGlobalRepeat: candidates.length > 1 && houseId === globalLastHouseId ? 1 : 0,
      projectRecentCount: recentCount(projectHistory, "houseId", houseId, CREATIVE_HOUSE_HISTORY_WINDOW),
      globalRecentCount: recentCount(history, "houseId", houseId, CREATIVE_HOUSE_HISTORY_WINDOW),
      projectLastUsedAt: lastUse(projectHistory, "houseId", houseId),
      globalLastUsedAt: lastUse(history, "houseId", houseId),
      persistedUseCount: Math.max(0, Number(storedUsage.totalUses) || 0),
      persistedLastUsedAt: text(storedUsage.lastUsedAt),
    };
  }).sort((left, right) =>
    left.directSourceRepeat - right.directSourceRepeat
    || left.directProjectRepeat - right.directProjectRepeat
    || left.projectRecentCount - right.projectRecentCount
    || left.directGlobalRepeat - right.directGlobalRepeat
    || left.globalRecentCount - right.globalRecentCount
    || left.persistedUseCount - right.persistedUseCount
    || Date.parse(left.projectLastUsedAt || "1970-01-01") - Date.parse(right.projectLastUsedAt || "1970-01-01")
    || Date.parse(left.globalLastUsedAt || left.persistedLastUsedAt || "1970-01-01")
      - Date.parse(right.globalLastUsedAt || right.persistedLastUsedAt || "1970-01-01")
    || left.houseId.localeCompare(right.houseId));
  const selected = ranked[0];
  const variationExhausted = candidates.length === 1;
  return {
    ok: true,
    ...selected,
    candidateCount: candidates.length,
    variationExhausted,
    diagnostics: variationExhausted ? [CREATIVE_VARIATION_EXHAUSTED] : [],
    reason: variationExhausted
      ? "Nur ein zulässiges Haus verfügbar; sicherer Fallback ohne Blockierung."
      : `LRU-Auswahl aus ${candidates.length} Häusern: direkte Wiederholung vermieden, Grundstücks- und globale Nutzung gewichtet.`,
  };
}

export function eligibleHouseHeroImages(house) {
  const supported = (house?.images || []).filter((image) =>
    image?.isFloorplan !== true
    && SUPPORTED_HERO_IMAGE_TYPES.has(text(image?.mimeType)));
  return supported.filter((image) => text(image?.role) === "cover" || image?.eligibleForListingHero === true);
}

export function eligiblePromotionHeroImages(state) {
  const library = normalizePromotionLibrary(state);
  if (!library.promotionSettings.enabled || !library.promotionSettings.automaticRotation) return [];
  return library.promotionImages.filter((image) =>
    image.active !== false
    && image.eligibleForListingHero !== false
    && text(image.role) === "promotion"
    && image.isFloorplan !== true
    && SUPPORTED_HERO_IMAGE_TYPES.has(text(image.mimeType)));
}

function rankHeroImages(entries, images, projectId) {
  const globalLastImageId = entries.at(-1)?.heroImageId || "";
  const projectEntries = entries.filter((entry) => entry.projectId === projectId);
  const projectLastImageId = projectEntries.at(-1)?.heroImageId || "";
  return [...images].map((image) => ({
    image,
    directProjectRepeat: images.length > 1 && text(image.id) === projectLastImageId ? 1 : 0,
    directGlobalRepeat: images.length > 1 && text(image.id) === globalLastImageId ? 1 : 0,
    projectRecentCount: recentCount(projectEntries, "heroImageId", text(image.id), CREATIVE_HERO_HISTORY_WINDOW),
    globalRecentCount: recentCount(entries, "heroImageId", text(image.id), CREATIVE_HERO_HISTORY_WINDOW),
    projectLastUsedAt: lastUse(projectEntries, "heroImageId", text(image.id)),
    globalLastUsedAt: lastUse(entries, "heroImageId", text(image.id)),
  })).sort((left, right) =>
    left.directProjectRepeat - right.directProjectRepeat
    || left.projectRecentCount - right.projectRecentCount
    || left.directGlobalRepeat - right.directGlobalRepeat
    || left.globalRecentCount - right.globalRecentCount
    || Date.parse(left.projectLastUsedAt || "1970-01-01") - Date.parse(right.projectLastUsedAt || "1970-01-01")
    || Date.parse(left.globalLastUsedAt || "1970-01-01") - Date.parse(right.globalLastUsedAt || "1970-01-01")
    || Number(right.image.priority || 0) - Number(left.image.priority || 0)
    || Number(left.image.order || 0) - Number(right.image.order || 0)
    || text(left.image.id).localeCompare(text(right.image.id)));
}

/**
 * Die Hausidentität ist zu diesem Zeitpunkt bereits fest. Das Hero kann nur
 * die Präsentation variieren und verändert keine Haus-, Preis- oder Textdaten.
 */
export function planCreativeHeroSelection(state, input = {}) {
  const projectId = text(input.projectId || input.project?.id);
  const house = input.house;
  const history = creativeSelectionHistory(state);
  const standardImages = eligibleHouseHeroImages(house);
  const actionImages = eligiblePromotionHeroImages(state);
  const rotationOrdinal = history.length + 1;
  const actionDue = actionImages.length > 0 && rotationOrdinal % CREATIVE_ACTION_INTERVAL === 0;
  const candidates = actionDue ? actionImages : standardImages;
  const ranked = rankHeroImages(history, candidates, projectId);
  const selected = ranked[0] || null;
  if (!selected) {
    return {
      ok: false,
      heroType: "house",
      heroImageId: "",
      promotionImageId: "",
      reason: "Kein zulässiges Hero-Bild vorhanden.",
      diagnostics: [CREATIVE_VARIATION_EXHAUSTED],
    };
  }
  const heroType = actionDue ? "action" : "house";
  const variationExhausted = standardImages.length + actionImages.length <= 1;
  return {
    ok: true,
    heroType,
    heroImageId: text(selected.image.id),
    heroImageName: text(selected.image.name),
    promotionImageId: heroType === "action" ? text(selected.image.id) : "",
    actionDue,
    rotationOrdinal,
    candidateCount: candidates.length,
    projectLastUsedAt: selected.projectLastUsedAt,
    globalLastUsedAt: selected.globalLastUsedAt,
    variationExhausted,
    diagnostics: variationExhausted ? [CREATIVE_VARIATION_EXHAUSTED] : [],
    reason: heroType === "action"
      ? `Freigegebenes Aktionsbild im deterministischen ${CREATIVE_ACTION_INTERVAL}er-Takt; LRU innerhalb des Aktionsbildpools.`
      : `Haus-Hero per LRU aus ${standardImages.length} ausdrücklich geeigneten Bild${standardImages.length === 1 ? "" : "ern"}.`,
  };
}
