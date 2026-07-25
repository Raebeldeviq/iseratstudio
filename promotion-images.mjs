import { MAX_PROMOTION_USAGE } from "./listing-rules.mjs";

export const PROMOTION_USAGE_LIMIT = MAX_PROMOTION_USAGE;

export const PROMOTION_SETTINGS_DEFAULTS = Object.freeze({
  enabled: false,
  automaticRotation: true,
  randomSelection: false,
  manualSelection: false,
  manualImageId: "",
});

function finiteInteger(value, fallback = 0) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizedAsset(image, index) {
  return {
    ...image,
    id: String(image?.id || globalThis.crypto.randomUUID()),
    name: String(image?.name || `Aktionsbild ${index + 1}`),
    caption: String(image?.caption || "Aktuelles Angebot für dein neues Zuhause"),
    mimeType: String(image?.mimeType || "image/jpeg"),
    dataUrl: String(image?.dataUrl || ""),
    isFloorplan: false,
    role: "promotion",
    captionLocked: false,
    active: image?.active !== false,
    priority: finiteInteger(image?.priority, 0),
    order: index + 1,
    lastUsedAt: String(image?.lastUsedAt || ""),
    usageCount: Math.max(0, finiteInteger(image?.usageCount, 0)),
    lastProjectId: String(image?.lastProjectId || ""),
    lastHouseId: String(image?.lastHouseId || ""),
    lastListingId: String(image?.lastListingId || ""),
  };
}

export function normalizePromotionLibrary(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const storedImages = Array.isArray(source.promotionImages)
    ? source.promotionImages
    : source.promotionImage
      ? [source.promotionImage]
      : [];
  const promotionImages = storedImages.map(normalizedAsset);
  const promotionSettings = {
    ...PROMOTION_SETTINGS_DEFAULTS,
    ...(source.promotionSettings && typeof source.promotionSettings === "object"
      ? source.promotionSettings
      : {}),
    enabled: source.promotionSettings?.enabled === true
      || (source.promotionSettings?.enabled === undefined && source.promotionImageEnabled === true),
    automaticRotation: source.promotionSettings?.automaticRotation !== false,
    randomSelection: source.promotionSettings?.randomSelection === true,
    manualSelection: source.promotionSettings?.manualSelection === true,
    manualImageId: String(source.promotionSettings?.manualImageId || ""),
  };
  if (!promotionImages.some((image) => image.active)) promotionSettings.enabled = false;
  const promotionUsage = Array.isArray(source.promotionUsage)
    ? source.promotionUsage.slice(-PROMOTION_USAGE_LIMIT).map((usage) => ({
        id: String(usage?.id || globalThis.crypto.randomUUID()),
        projectId: String(usage?.projectId || ""),
        listingId: String(usage?.listingId || ""),
        externalId: String(usage?.externalId || ""),
        houseId: String(usage?.houseId || ""),
        imageId: String(usage?.imageId || ""),
        usedAt: String(usage?.usedAt || ""),
        mode: usage?.mode === "update" ? "update" : "create",
      }))
    : [];
  const primary = promotionImages[0] || null;
  return {
    promotionImages,
    promotionSettings,
    promotionUsage,
    // Kompatibilität für ältere Sicherungen und Exportpfade.
    promotionImage: primary,
    promotionImageEnabled: promotionSettings.enabled && Boolean(primary),
  };
}

function orderedActiveImages(images) {
  return images
    .filter((image) => image.active !== false)
    .sort((left, right) =>
      Number(right.priority || 0) - Number(left.priority || 0)
      || Number(left.usageCount || 0) - Number(right.usageCount || 0)
      || Number(left.order || 0) - Number(right.order || 0)
      || left.id.localeCompare(right.id));
}

export function choosePromotionImage(libraryValue, options = {}) {
  const library = normalizePromotionLibrary(libraryValue);
  if (!library.promotionSettings.enabled) return null;
  const active = orderedActiveImages(library.promotionImages);
  if (!active.length) return null;
  const explicitId = String(options.imageId || library.promotionSettings.manualImageId || "");
  if (explicitId) {
    const explicit = active.find((image) => image.id === explicitId);
    if (explicit) return explicit;
  }
  const projectUsage = library.promotionUsage
    .filter((usage) => !options.projectId || usage.projectId === options.projectId)
    .sort((left, right) => Date.parse(right.usedAt || "") - Date.parse(left.usedAt || ""));
  const lastImageId = projectUsage[0]?.imageId || "";
  const candidates = library.promotionSettings.automaticRotation && active.length > 1
    ? active.filter((image) => image.id !== lastImageId)
    : active;
  if (library.promotionSettings.randomSelection && candidates.length > 1) {
    if (typeof options.random === "function") {
      return candidates[Math.min(candidates.length - 1, Math.floor(options.random() * candidates.length))];
    }
    const seed = `${options.projectId || "global"}:${library.promotionUsage.length}:${candidates.map((image) => image.id).join(":")}`;
    let hash = 2166136261;
    for (let index = 0; index < seed.length; index += 1) {
      hash ^= seed.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return candidates[(hash >>> 0) % candidates.length];
  }
  return candidates[0] || active[0];
}

export function choosePromotionListing(project, usage = [], explicitListingId = "") {
  const listings = Array.isArray(project?.listings) ? project.listings : [];
  if (!listings.length) return null;
  const explicit = listings.find((listing) => listing.id === explicitListingId);
  if (explicit) return explicit;
  const projectUsage = usage
    .filter((entry) => entry.projectId === project.id)
    .sort((left, right) => Date.parse(right.usedAt || "") - Date.parse(left.usedAt || ""));
  const lastListingId = projectUsage[0]?.listingId || "";
  return listings.find((listing) => listing.id !== lastListingId) || listings[0];
}

export function enforceSinglePromotionAssignment(projectValue, listingId, imageId, options = {}) {
  const project = projectValue && typeof projectValue === "object" ? projectValue : {};
  const targetListingId = String(listingId || "");
  const targetImageId = String(imageId || "");
  const assignedAt = String(options.now || new Date().toISOString());
  const updateListing = (listing) => {
    if (!listing || typeof listing !== "object") return listing;
    if (listing.id === targetListingId && targetImageId) {
      return { ...listing, promotionImageId: targetImageId, promotionAssignedAt: assignedAt };
    }
    if (!listing.promotionImageId && !listing.promotionAssignedAt) return listing;
    const withoutAssignment = { ...listing };
    delete withoutAssignment.promotionImageId;
    delete withoutAssignment.promotionAssignedAt;
    return withoutAssignment;
  };
  const listings = (project.listings || []).map(updateListing);
  const listingGroup = project.listingGroup && typeof project.listingGroup === "object"
    ? {
        ...project.listingGroup,
        variants: (project.listingGroup.variants || []).map((variant) => ({
          ...variant,
          listing: variant.listing ? updateListing(variant.listing) : variant.listing,
        })),
      }
    : project.listingGroup;
  return { ...project, listings, ...(listingGroup ? { listingGroup } : {}) };
}

export function recordPromotionUsage(libraryValue, assignment, options = {}) {
  if (!assignment?.imageId || !assignment?.listingId || !assignment?.projectId) {
    return normalizePromotionLibrary(libraryValue);
  }
  const library = normalizePromotionLibrary(libraryValue);
  const usedAt = String(options.now || new Date().toISOString());
  const record = {
    id: String(options.id || globalThis.crypto.randomUUID()),
    projectId: String(assignment.projectId),
    listingId: String(assignment.listingId),
    externalId: String(assignment.externalId || ""),
    houseId: String(assignment.houseId || ""),
    imageId: String(assignment.imageId),
    usedAt,
    mode: assignment.mode === "update" ? "update" : "create",
  };
  const promotionImages = library.promotionImages.map((image) => image.id === record.imageId
    ? {
        ...image,
        lastUsedAt: usedAt,
        usageCount: image.usageCount + 1,
        lastProjectId: record.projectId,
        lastHouseId: record.houseId,
        lastListingId: record.listingId,
      }
    : image);
  return {
    ...library,
    promotionImages,
    promotionUsage: [...library.promotionUsage, record].slice(-PROMOTION_USAGE_LIMIT),
    promotionImage: promotionImages[0] || null,
    promotionImageEnabled: library.promotionSettings.enabled && Boolean(promotionImages[0]),
  };
}
