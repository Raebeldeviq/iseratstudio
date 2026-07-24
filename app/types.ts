export type ImageRole =
  | "promotion"
  | "cover"
  | "kitchen"
  | "bathroom"
  | "bedroom"
  | "kids"
  | "living"
  | "office"
  | "emotion"
  | "floorplan_ground"
  | "floorplan_upper"
  | "floorplan_third"
  | "awards"
  | "trust"
  | "qr"
  | "other";

export type HouseImage = {
  id: string;
  sourceId?: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  caption: string;
  isFloorplan: boolean;
  role?: ImageRole;
  captionLocked?: boolean;
};

export type HouseTemplate = {
  id: string;
  archived?: boolean;
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

export type AddressOwner = "fabian" | "pascal";

export type ProjectInput = {
  id: string;
  owner: AddressOwner;
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
  promotionImageCount?: number;
  promotionAssignments?: Record<string, string>;
  listings: GeneratedListing[];
  createdAt: string;
  lastTotalSyncAt?: string;
};

export type ListingTexts = {
  title: string;
  description: string;
  equipment: string;
  location: string;
  other: string;
};

export type ProjectingSettings = {
  equipmentQuality?: string;
  constructionPhase?: string;
  underfloorHeating?: boolean;
  airSourceHeatPump?: boolean;
  kfw40?: boolean;
  kfw55?: boolean;
  energyClass?: string;
  commissionRequired?: boolean;
  energyCertificateClass?: string;
};

export type GeneratedListing = {
  id: string;
  externalId: string;
  templateId: string;
  templateName: string;
  price: number;
  texts: ListingTexts;
  titleHistory?: string[];
  writingProfile?: string;
  totalSyncRunId?: string;
  uploadedAt?: string;
  promotionImageId?: string;
  projectingSettings?: ProjectingSettings;
  version: number;
};

export type TotalSyncScope = AddressOwner | "all";

export type TotalSyncProjectTask = {
  projectId: string;
  houseIds: string[];
  generated: boolean;
  uploadedExternalIds: string[];
  lastError?: string;
};

export type TotalSyncRun = {
  id: string;
  scope: TotalSyncScope;
  createdAt: string;
  completedAt?: string;
  status: "ready" | "running" | "paused" | "completed";
  skippedProjectCount: number;
  tasks: TotalSyncProjectTask[];
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
  promotionImages: HouseImage[];
  promotionImage?: HouseImage | null;
  promotionImageEnabled?: boolean;
  totalSyncRun?: TotalSyncRun;
};
