import { INTERIOR_IMAGE_ROLES, inferImageRole, orderHouseImages } from './image-sequence.mjs';
/** @type {readonly ("A" | "B" | "C")[]} */
export const INTERIOR_SET_IDS = Object.freeze(['A', 'B', 'C']);
/** @type {readonly ("living" | "kids" | "bedroom" | "kitchen" | "bathroom" | "office")[]} */
export const INTERIOR_SET_ROLES = Object.freeze(['living', 'kids', 'bedroom', 'kitchen', 'bathroom', 'office']);
export function interiorSetStatus(state, setId) {
  const assets = new Map((state.interiorAssets || []).map(image => [image.id, image]));
  const roles = state.interiorSets?.[setId] || {};
  const missing = INTERIOR_SET_ROLES.filter(role => !assets.has(roles[role]) || inferImageRole(assets.get(roles[role])) !== role);
  return { complete: INTERIOR_SET_IDS.includes(setId) && missing.length === 0, missing };
}
export function assignInteriorSet(state, listing) {
  if (listing.interiorSet) return { state, listing };
  const cursor = INTERIOR_SET_IDS.indexOf(state.interiorRotationLastSet);
  const setId = Array.from({length: 3}, (_, offset) => INTERIOR_SET_IDS[(cursor + offset + 1) % 3])
    .find(id => interiorSetStatus(state, id).complete);
  if (!setId) return { state, listing };
  return {
    state: { ...state, interiorRotationLastSet: setId },
    listing: { ...listing, interiorSet: setId, interiorSetSource: 'automatic', interiorAssetIds: { ...state.interiorSets[setId] } },
  };
}
// Only explicit generation transitions use this helper; loading old catalogs never assigns sets.
export function assignNewInteriorListings(previous, next) {
  const existing = new Set((previous.projects || []).flatMap(project => [
    ...(project.listings || []), ...(project.listingGroup?.variants || []).map(variant => variant.listing).filter(Boolean),
  ]).map(listing => listing.id));
  let allocationState = next;
  const assigned = new Map();
  const assign = listing => {
    if (!listing || existing.has(listing.id)) return listing;
    if (!assigned.has(listing.id)) {
      // A genuinely new copy gets its own rotation slot even if its source had a set.
      const { interiorSet: _set, interiorSetSource: _source, interiorAssetIds: _assets, ...fresh } = listing;
      void _set; void _source; void _assets;
      const result = assignInteriorSet(allocationState, fresh);
      allocationState = result.state;
      assigned.set(listing.id, result.listing);
    }
    return assigned.get(listing.id);
  };
  const projects = next.projects.map(project => ({ ...project,
    listings: project.listings.map(assign),
    ...(project.listingGroup ? { listingGroup: { ...project.listingGroup,
      variants: project.listingGroup.variants.map(variant => ({...variant, listing: assign(variant.listing)})),
    }} : {}),
  }));
  return { ...allocationState, projects };
}
export function listingInteriorImages(state, house, listing) {
  if (!listing?.interiorSet) return orderHouseImages(house.images);
  if (!INTERIOR_SET_IDS.includes(listing.interiorSet)) throw new Error('Ungültiges Innenraum-Set.');
  const assets = new Map((state.interiorAssets || []).map(image => [image.id, image]));
  const interiors = INTERIOR_SET_ROLES.map(role => {
    const image = assets.get(listing.interiorAssetIds?.[role]);
    if (!image || inferImageRole(image) !== role) throw new Error(`Innenraum-Set ${listing.interiorSet}: ${role} fehlt. Bitte die gespeicherte Zuordnung prüfen.`);
    return image;
  });
  return orderHouseImages([...house.images.filter(image => !INTERIOR_IMAGE_ROLES.includes(inferImageRole(image))), ...interiors]);
}
