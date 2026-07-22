export type HouseImage = {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  caption: string;
  isFloorplan: boolean;
};

export type HouseTemplate = {
  id: string;
  name: string;
  houseType: string;
  livingArea: number;
  rooms: number;
  bedrooms: number;
  bathrooms: number;
  floors: number;
  housePrice: number;
  constructionYear: number;
  energyDemand: number;
  energyClass: string;
  heatingType: string;
  energySource: string;
  architecture: string;
  equipmentHighlights: string;
  useStandardPackage: boolean;
  images: HouseImage[];
};

export type ProjectInput = {
  id: string;
  name: string;
  street: string;
  houseNumber: string;
  zip: string;
  city: string;
  district: string;
  plotArea: number;
  plotPrice: number;
  additionalCosts: number;
  locationFacts: string;
  transportFacts: string;
  familyFacts: string;
  natureFacts: string;
  notes: string;
  selectedHouseIds: string[];
  listings: GeneratedListing[];
  createdAt: string;
};

export type ListingTexts = {
  title: string;
  description: string;
  equipment: string;
  location: string;
  other: string;
};

export type GeneratedListing = {
  id: string;
  externalId: string;
  templateId: string;
  templateName: string;
  price: number;
  texts: ListingTexts;
  version: number;
};

export type ProviderSettings = {
  providerNumber: string;
  company: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
};

export type StudioState = {
  version: 1;
  houses: HouseTemplate[];
  projects: ProjectInput[];
  provider: ProviderSettings;
};
