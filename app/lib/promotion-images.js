export const MAX_PROMOTION_IMAGES = 25;
export const MAX_PROMOTED_LISTINGS = 4;

/**
 * @typedef {Record<string, string>} PromotionAssignments
 */

/**
 * @param {number} value
 * @param {number} maximum
 */
function normalizedCount(value, maximum) {
  return Math.min(
    MAX_PROMOTED_LISTINGS,
    Math.max(0, Math.min(maximum, Math.floor(Number(value) || 0))),
  );
}

/**
 * @template T
 * @param {T[]} values
 * @param {() => number} random
 * @returns {T[]}
 */
function shuffled(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(
      Math.min(0.999999999, Math.max(0, random())) * (index + 1),
    );
    [result[index], result[randomIndex]] = [result[randomIndex], result[index]];
  }
  return result;
}

/**
 * @param {string[]} houseIds
 * @param {string[]} promotionImageIds
 * @param {number} requestedCount
 * @param {() => number} [random]
 * @returns {PromotionAssignments}
 */
export function randomPromotionAssignments(
  houseIds,
  promotionImageIds,
  requestedCount,
  random = Math.random,
) {
  const uniqueHouseIds = Array.from(new Set(houseIds.filter(Boolean)));
  const uniqueImageIds = Array.from(new Set(promotionImageIds.filter(Boolean)));
  const count = normalizedCount(
    requestedCount,
    Math.min(uniqueHouseIds.length, uniqueImageIds.length),
  );
  const selectedHouses = shuffled(uniqueHouseIds, random).slice(0, count);
  const selectedImages = shuffled(uniqueImageIds, random).slice(0, count);
  return Object.fromEntries(
    selectedHouses.map((houseId, index) => [houseId, selectedImages[index]]),
  );
}

/**
 * @param {string[]} houseIds
 * @param {string[]} promotionImageIds
 * @param {number} requestedCount
 * @param {PromotionAssignments} [current]
 * @param {() => number} [random]
 * @returns {PromotionAssignments}
 */
export function reconcilePromotionAssignments(
  houseIds,
  promotionImageIds,
  requestedCount,
  current = {},
  random = Math.random,
) {
  const validHouseIds = Array.from(new Set(houseIds.filter(Boolean)));
  const validImageIds = new Set(promotionImageIds.filter(Boolean));
  const count = normalizedCount(
    requestedCount,
    Math.min(validHouseIds.length, validImageIds.size),
  );
  /** @type {PromotionAssignments} */
  const preserved = {};
  const usedImageIds = new Set();
  for (const houseId of validHouseIds) {
    const imageId = current[houseId];
    if (
      Object.keys(preserved).length < count
      && imageId
      && validImageIds.has(imageId)
      && !usedImageIds.has(imageId)
    ) {
      preserved[houseId] = imageId;
      usedImageIds.add(imageId);
    }
  }
  if (Object.keys(preserved).length >= count) return preserved;

  const missingCount = count - Object.keys(preserved).length;
  const additions = randomPromotionAssignments(
    validHouseIds.filter((houseId) => !(houseId in preserved)),
    [...validImageIds].filter((imageId) => !usedImageIds.has(imageId)),
    missingCount,
    random,
  );
  return { ...preserved, ...additions };
}

/**
 * @param {Partial<import("../types").ProjectInput>} project
 */
export function projectPromotionCount(project) {
  return Math.min(
    MAX_PROMOTED_LISTINGS,
    Math.max(0, Math.floor(Number(project.promotionImageCount) || 0)),
  );
}
