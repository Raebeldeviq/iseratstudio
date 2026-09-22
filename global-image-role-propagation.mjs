import { inferImageRole, orderHouseImages } from "./image-sequence.mjs";

/**
 * Roles whose complete image card is intentionally shared across every house
 * template. This is deliberately a closed list: adding another role requires
 * an explicit product decision.
 */
export const GLOBAL_IMAGE_ROLES = Object.freeze([
  "emotion",
  "awards",
  "trust",
  "qr",
]);

export function isGlobalImageRole(role) {
  return GLOBAL_IMAGE_ROLES.includes(role);
}

function imageRole(image) {
  return inferImageRole(image);
}

/**
 * Replaces one global role in every supplied house template with the selected
 * source card. The card retains its asset ID, so the catalog's image store can
 * reuse the existing binary instead of creating per-house copies.
 *
 * The image position is the ordered image array. Reusing orderHouseImages is
 * important here because fixed roles do not have independently editable
 * positions in the studio; the canonical ordering prevents collisions while
 * preserving the chosen order of interior images.
 */
export function propagateGlobalImageRole(houses, { sourceHouseId, sourceImageId }) {
  if (!Array.isArray(houses) || houses.length === 0) {
    throw new Error("Es sind keine Haustypen für die globale Bildübernahme vorhanden.");
  }

  const sourceHouse = houses.find((house) => house.id === sourceHouseId);
  if (!sourceHouse) throw new Error("Der Quell-Haustyp wurde nicht gefunden.");

  const sourceImage = sourceHouse.images.find((image) => image.id === sourceImageId);
  if (!sourceImage) throw new Error("Die ausgewählte Bildkarte wurde nicht gefunden.");

  const role = imageRole(sourceImage);
  if (!isGlobalImageRole(role)) {
    throw new Error("Diese Bildrolle darf nicht auf alle Haustypen angewendet werden.");
  }

  // Make the role explicit even for an older, filename-inferred source card.
  // All other business fields and the asset reference remain unchanged.
  const sourceCard = { ...sourceImage, role };

  return {
    role,
    targetHouseCount: houses.length,
    houses: houses.map((house) => {
      // Removing every prior occurrence first guarantees one card per global
      // role, including in catalogs that contain an old duplicate.
      const imagesWithoutRole = house.images.filter((image) => imageRole(image) !== role);
      return {
        ...house,
        images: orderHouseImages([...imagesWithoutRole, { ...sourceCard }]),
      };
    }),
  };
}
