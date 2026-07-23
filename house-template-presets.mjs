import { resolveHousePrice } from "./house-price-catalog.mjs";
import { buildRecommendedMediaSequence } from "./image-sequence.mjs";

const DEFAULT_ARCHITECTURE =
  "Ein klar gegliederter Grundriss verbindet offene Gemeinschaftsbereiche mit gut nutzbaren privaten Rückzugsräumen";
const DEFAULT_EQUIPMENT =
  "individuelle Grundrissplanung, moderne Haustechnik, hochwertige Sanitärausstattung und persönliche Bemusterung";

export const HOUSE_TEMPLATE_PRESETS = Object.freeze([
  { key: "sun126-v2", name: "SUN 126 V2", coverFilename: "SUN 126 V2.png", livingArea: 121.74, rooms: 4, bedrooms: 2, bathrooms: 2, floors: 2 },
  { key: "sun130-v2", name: "SUN 130 V2", coverFilename: "SUN 130 V2.png", livingArea: 130.73, rooms: 4, bedrooms: 2, bathrooms: 1, floors: 2 },
  { key: "sun136-v4", name: "SUN 136 V4", coverFilename: "SUN 136 V4.png", livingArea: 135.21, rooms: 4, bedrooms: 3, bathrooms: 2, floors: 2 },
  { key: "sun142-v2", name: "SUN 142 V2", coverFilename: "SUN 142 V2.png", livingArea: 141.60, rooms: 5, bedrooms: 3, bathrooms: 1, floors: 2 },
  { key: "sun143-v4", name: "SUN 143 V4", coverFilename: "SUN 143 V4 .png", livingArea: 143.08, rooms: 5, bedrooms: 3, bathrooms: 1, floors: 2 },
  { key: "sun144-v4", name: "SUN 144 V4 Tag", coverFilename: "SUN 144 V4 Tag.png", livingArea: 143.81, rooms: 5, bedrooms: 3, bathrooms: 1, floors: 2 },
  { key: "sun151-v8", name: "SUN 151 V8", coverFilename: "SUN 151 V8.png", livingArea: 152.24, rooms: 5, bedrooms: 3, bathrooms: 2, floors: 2 },
  { key: "sun154-v3", name: "SUN 154 V3", coverFilename: "SUN 154 V3.png", livingArea: 152.52, rooms: 5, bedrooms: 3, bathrooms: 2, floors: 2 },
  { key: "sun157-v2", name: "SUN 157 V2", coverFilename: "SUN 157 V2.png", livingArea: 153.48, rooms: 6, bedrooms: 3, bathrooms: 2, floors: 2 },
  { key: "sun164-v2", name: "SUN 164 V2", coverFilename: "SUN 164 V2.png", livingArea: 163.97, rooms: 5, bedrooms: 3, bathrooms: 2, floors: 2 },
  { key: "sun165-v2", name: "SUN 165 V2", coverFilename: "Sun 165 V2.png", livingArea: 166.53, rooms: 5, bedrooms: 3, bathrooms: 2, floors: 2 },
  { key: "sun167-v3", name: "SUN 167 V3", coverFilename: "SUN 167 V3.png", livingArea: 167.05, rooms: 5, bedrooms: 3, bathrooms: 2, floors: 2 },
  { key: "sun168-v2", name: "SUN 168 V2", coverFilename: "SUN 168 V2.png", livingArea: 165.20, rooms: 5, bedrooms: 3, bathrooms: 2, floors: 2 },
  { key: "sun210-v2", name: "SUN 210 V2", coverFilename: "SUN 210 V2.png", livingArea: 210.09, rooms: 6, bedrooms: 4, bathrooms: 2, floors: 2 },
  { key: "sol101-v2", name: "SOL 101 V2", coverFilename: "SOL 101 V2.png", livingArea: 100.72, rooms: 3, bedrooms: 2, bathrooms: 1, floors: 1, houseType: "Bungalow" },
  { key: "sol107-v2", name: "SOL 107 V2", coverFilename: "Sol 107 SD.png", livingArea: 106.85, rooms: 4, bedrooms: 3, bathrooms: 1, floors: 1, houseType: "Bungalow" },
  { key: "sol110-v2", name: "SOL 110 V2", coverFilename: "SOL 110 V2.png", livingArea: 110.45, rooms: 4, bedrooms: 3, bathrooms: 1, floors: 1, houseType: "Bungalow" },
  { key: "sun113-v6", name: "SUN 113 V6", coverFilename: "SUN 113 V6.png", livingArea: 113, rooms: 4, bedrooms: 2, bathrooms: 1, floors: 2, priceOpen: true },
]);

function presetCover(definition, mediaItems) {
  return mediaItems.find((item) => item.relativePath === `Haustypen/${definition.coverFilename}`) || null;
}

function presetImage(item) {
  return {
    id: `preset_media_${item.id}`,
    sourceId: item.id,
    name: item.filename,
    mimeType: item.mimeType,
    dataUrl: "",
    caption: item.caption,
    isFloorplan: item.kind === "floorplan",
    role: item.role,
    captionLocked: item.captionLocked,
  };
}

export function buildHouseTemplatePresets(mediaItems, {
  constructionYear = new Date().getFullYear() + 1,
} = {}) {
  if (!Array.isArray(mediaItems) || !mediaItems.length) {
    throw new Error("Die Medienbibliothek ist leer.");
  }

  return HOUSE_TEMPLATE_PRESETS.map((definition) => {
    const cover = presetCover(definition, mediaItems);
    if (!cover) throw new Error(`Titelbild ${definition.coverFilename} fehlt.`);
    const sequence = buildRecommendedMediaSequence(cover.id, mediaItems);
    if (sequence.warnings.length) {
      throw new Error(`${definition.name}: ${sequence.warnings.join(" ")}`);
    }
    const priceMatch = resolveHousePrice([
      definition.name,
      ...sequence.items.map((item) => item.filename),
    ]);
    if (!definition.priceOpen && !priceMatch) {
      throw new Error(`${definition.name}: Kein eindeutiger Hauspreis gefunden.`);
    }

    return {
      id: `preset_house_${definition.key.replaceAll("-", "_")}`,
      name: definition.name,
      houseType: definition.houseType || priceMatch?.houseType || "Einfamilienhaus",
      livingArea: definition.livingArea,
      rooms: definition.rooms,
      bedrooms: definition.bedrooms,
      bathrooms: definition.bathrooms,
      floors: definition.floors,
      housePrice: definition.priceOpen ? 0 : priceMatch.price,
      constructionYear,
      energyDemand: 18,
      energyClass: "A++",
      heatingType: "Fußbodenheizung mit Luft-Wasser-Wärmepumpe",
      energySource: "Umweltwärme und Strom",
      architecture: DEFAULT_ARCHITECTURE,
      equipmentHighlights: DEFAULT_EQUIPMENT,
      useStandardPackage: true,
      images: sequence.items.map(presetImage),
    };
  });
}

export function isEmptyHousePlaceholder(house) {
  const name = String(house?.name || "").trim();
  return Array.isArray(house?.images)
    && house.images.length === 0
    && Number(house?.housePrice || 0) === 0
    && (name === "Zweifamilienhaus – Muster" || /^Haustyp \d+$/.test(name));
}
