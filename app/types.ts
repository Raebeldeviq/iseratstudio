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
  lastRenewedAt?: string;
  headlineHistory?: string[];
  renewalHistory?: RenewalCycleRecord[];
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

export type TotalSyncRunKind = "total-sync" | "seven-day";
export type TotalSyncListingStatus =
  | "pending"
  | "generating"
  | "ready"
  | "uploading"
  | "uploaded"
  | "failed"
  | "unknown";
export type TotalSyncFailureStage = "generation" | "upload" | "validation";
export type TotalSyncAttemptMode = "continue" | "failed-only";

export type AiModelId = "gpt-5.6-luna" | "gpt-5.6-terra" | "gpt-5.6-sol";

export type AiTokenUsage = {
  model: AiModelId;
  inputTokens: number;
  outputTokens: number;
  requestCount: number;
};

export type ProtectedProjectLocation = {
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
  createdAt: string;
};

export type RenewalCycleRecord = {
  runId: string;
  renewedAt: string;
  completedAt: string;
  previousExternalIds: string[];
  externalIds: string[];
  houseIds: string[];
};

export type TotalSyncListingAttempt = {
  stage: TotalSyncFailureStage;
  startedAt: string;
  completedAt?: string;
  succeeded?: boolean;
  message?: string;
};

export type TotalSyncListingJob = {
  id: string;
  externalId: string;
  houseId: string;
  slot: number;
  status: TotalSyncListingStatus;
  attempts: TotalSyncListingAttempt[];
  lastStage?: TotalSyncFailureStage;
  lastAttemptAt?: string;
  uploadedAt?: string;
  lastError?: string;
  aiUsage?: AiTokenUsage;
};

export type TotalSyncProjectTask = {
  projectId: string;
  houseIds: string[];
  generated: boolean;
  uploadedExternalIds: string[];
  listingJobs?: TotalSyncListingJob[];
  promotionAssignments?: Record<string, string>;
  completedAt?: string;
  previousExternalIds?: string[];
  protectedLocation?: ProtectedProjectLocation;
  lastError?: string;
};

export type TotalSyncRunAttempt = {
  startedAt: string;
  completedAt?: string;
  mode: TotalSyncAttemptMode;
  uploadedCount: number;
  failedCount: number;
};

export type TotalSyncRun = {
  id: string;
  kind?: TotalSyncRunKind;
  scope: TotalSyncScope;
  promotionImageCount?: number;
  portalPublicationEnabled?: boolean;
  aiModel?: AiModelId;
  createdAt: string;
  startedAt?: string;
  updatedAt?: string;
  completedAt?: string;
  status: "ready" | "running" | "paused" | "completed-with-errors" | "completed";
  skippedProjectCount: number;
  attempts?: TotalSyncRunAttempt[];
  tasks: TotalSyncProjectTask[];
};

export type UploadRunHistoryListing = {
  id: string;
  projectId: string;
  projectName: string;
  owner: AddressOwner;
  city: string;
  externalId: string;
  houseId: string;
  houseName: string;
  status: TotalSyncListingStatus;
  attemptCount: number;
  lastStage?: TotalSyncFailureStage;
  lastAttemptAt?: string;
  uploadedAt?: string;
  lastError?: string;
  aiUsage?: AiTokenUsage;
};

export type UploadRunHistoryEntry = {
  id: string;
  kind: TotalSyncRunKind;
  scope: TotalSyncScope;
  status: "completed" | "completed-with-errors" | "discarded";
  portalPublicationEnabled: boolean;
  aiModel?: AiModelId;
  createdAt: string;
  startedAt?: string;
  updatedAt: string;
  completedAt?: string;
  skippedProjectCount: number;
  attempts: TotalSyncRunAttempt[];
  listings: UploadRunHistoryListing[];
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
  houseCatalogVersion?: string;
  houseCatalogUpdatedAt?: string;
  houses: HouseTemplate[];
  projects: ProjectInput[];
  provider: ProviderSettings;
  promotionImages: HouseImage[];
  promotionImage?: HouseImage | null;
  promotionImageEnabled?: boolean;
  portalPublicationEnabled?: boolean;
  totalSyncRun?: TotalSyncRun;
  uploadRunHistory?: UploadRunHistoryEntry[];
};
