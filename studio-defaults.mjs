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
    name: index === 1 ? "Zweifamilienhaus – Muster" : `Haustyp ${index}`,
    houseType: index === 1 ? "Zweifamilienhaus" : "Einfamilienhaus",
    livingArea: index === 1 ? 242 : 150,
    rooms: index === 1 ? 8 : 5,
    bedrooms: index === 1 ? 6 : 3,
    bathrooms: index === 1 ? 4 : 2,
    floors: 2,
    housePrice: 0,
    constructionYear: new Date().getFullYear() + 1,
    energyDemand: 18,
    energyClass: "A++",
    heatingType: "Fußbodenheizung mit Luft-Wasser-Wärmepumpe",
    energySource: "Umweltwärme und Strom",
    architecture: DEFAULT_ARCHITECTURE,
    equipmentHighlights: DEFAULT_EQUIPMENT,
    useStandardPackage: true,
    images: [],
  };
}

export function createEmptyProject(owner = "fabian") {
  return {
    id: uid(),
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
    notes: "",
    selectedHouseIds: [],
    listings: [],
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
  return {
    version: 1,
    houses: houses || [createEmptyHouse(1)],
    projects: [createEmptyProject("fabian")],
    provider: createDefaultProvider(),
    promotionImage: null,
    promotionImageEnabled: false,
  };
}
