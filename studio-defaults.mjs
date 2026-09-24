import { normalizeHouseDistribution } from "./house-distribution.mjs";
import { createListingGroup } from "./listing-groups.mjs";
import { HOUSE_ENERGY_DEFAULTS } from "./listing-copy.mjs";
import { createListingScheduler } from "./listing-scheduler.mjs";

const DEFAULT_ARCHITECTURE =
  "Ein klar gegliederter Grundriss verbindet offene Gemeinschaftsbereiche mit gut nutzbaren privaten Rückzugsräumen";
const DEFAULT_EQUIPMENT =
  "individuelle Grundrissplanung, moderne Haustechnik, hochwertige Sanitärausstattung und persönliche Bemusterung";

function uid() {
  return globalThis.crypto.randomUUID();
}

export function createEmptyHouse(index = 1) {
  return {
    id: uid(),
    approved: true,
    seriesId: "livinghaus",
    name: index === 1 ? "Zweifamilienhaus – Muster" : `Haustyp ${index}`,
    houseType: index === 1 ? "Zweifamilienhaus" : "Einfamilienhaus",
    livingArea: index === 1 ? 242 : 150,
    rooms: index === 1 ? 8 : 5,
    bedrooms: index === 1 ? 6 : 3,
    bathrooms: index === 1 ? 4 : 2,
    floors: 2,
    housePrice: 0,
    constructionYear: new Date().getFullYear() + 1,
    // Kein technischer Kennwert ist ohne Quelle, Scope, Status und Verifikation
    // ein Inseratfakt. Neue Vorlagen starten daher ohne Energiedefault.
    energyDemand: 0,
    ...HOUSE_ENERGY_DEFAULTS,
    architecture: DEFAULT_ARCHITECTURE,
    equipmentHighlights: DEFAULT_EQUIPMENT,
    useStandardPackage: true,
    listingFacts: [],
    images: [],
  };
}

export function createEmptyProject(owner = "fabian") {
  const id = uid();
  return {
    id,
    owner,
    name: `Neues Adressprojekt ${new Date().toLocaleDateString("de-DE")}`,
    street: "",
    houseNumber: "",
    zip: "",
    city: "",
    district: "",
    federalState: "",
    county: "",
    plotArea: 0,
    plotPrice: 0,
    additionalCosts: 0,
    locationFacts: "",
    transportFacts: "",
    familyFacts: "",
    natureFacts: "",
    selectedHouseIds: [],
    listings: [],
    listingGroup: createListingGroup(id),
    createdAt: new Date().toISOString(),
  };
}

export function createDefaultProvider() {
  return {
    providerNumber: "",
    company: "Fabian Raebel - Freie Handelsvertretung der Living Fertighaus GmbH",
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
  };
}

export function createInitialStudioState({ houses } = {}) {
  const initialHouses = houses || [createEmptyHouse(1)];
  const initialProjects = [createEmptyProject("fabian")];
  return {
    version: 1,
    houses: initialHouses,
    plots: [],
    projects: initialProjects,
    provider: createDefaultProvider(),
    promotionImage: null,
    promotionImageEnabled: false,
    promotionImages: [],
    promotionSettings: {
      enabled: false,
      automaticRotation: true,
      randomSelection: false,
      manualSelection: false,
      manualImageId: "",
    },
    promotionUsage: [],
    uploadHistory: [],
    scheduler: createListingScheduler(),
    houseDistribution: normalizeHouseDistribution({}, initialHouses, initialProjects),
  };
}
