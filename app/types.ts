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
  management?: ListingManagement;
  version: number;
};

export type ListingLifecycleStatus =
  | "draft"
  | "ready"
  | "transferred"
  | "online"
  | "error"
  | "archived";

export type ListingPortalStatus =
  | "not-transferred"
  | "queued"
  | "transferred"
  | "online"
  | "error"
  | "delete-requested"
  | "deleted";

export type ListingPortalState = {
  portalId: string;
  enabled: boolean;
  status: ListingPortalStatus;
  lastTransferAt?: string;
  lastReportAt?: string;
  message?: string;
};

export type ListingMediaKind =
  | "image"
  | "floorplan"
  | "document"
  | "video"
  | "link"
  | "tour";

export type ListingMediaItem = {
  id: string;
  kind: ListingMediaKind;
  name: string;
  caption: string;
  released: boolean;
  order: number;
  createdAt: string;
  sourceImageId?: string;
  mimeType?: string;
  dataUrl?: string;
  url?: string;
  rotation?: 0 | 90 | 180 | 270;
};

export type ListingAppointmentStatus = "planned" | "completed" | "cancelled";

export type ListingAppointment = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  location: string;
  contactName: string;
  contactEmail: string;
  notes: string;
  status: ListingAppointmentStatus;
  createdAt: string;
};

export type ListingDetails = {
  objectStatus: "projected" | "in-construction" | "complete";
  groupId: string;
  orderNumber: string;
  currency: "EUR" | "CHF" | "USD";
  availableFrom: string;
  addressPublished: boolean;
  googleMapsPublished: boolean;
  country: string;
  street: string;
  houseNumber: string;
  zip: string;
  city: string;
  district: string;
  purchasePrice: number;
  livingArea: number;
  usableArea: number;
  plotArea: number;
  rooms: number;
  bedrooms: number;
  bathrooms: number;
  floors: number;
  balconies: number;
  terraces: number;
  houseType: string;
  constructionYear: number;
  renovationYear: number;
  condition: string;
  constructionPhase: string;
  equipmentQuality: string;
  kitchenType: string;
  bathroomFeatures: string;
  flooring: string;
  heatingType: string;
  energySource: string;
  parkingTypes: string;
  view: string;
  guestWc: boolean;
  garden: boolean;
  attic: boolean;
  fireplace: boolean;
  basement: boolean;
  barrierFree: boolean;
  seniorFriendly: boolean;
  sauna: boolean;
  pool: boolean;
  conservatory: boolean;
  airConditioning: boolean;
  alarmSystem: boolean;
  elevator: boolean;
  monument: boolean;
  rented: boolean;
  energyCertificateType: string;
  energyCertificateValidUntil: string;
  energyClass: string;
  endEnergyDemand: number;
  certificateYear: number;
  warmWaterIncluded: boolean;
  commissionRequired: boolean;
  commissionText: string;
  contactCompany: string;
  contactFirstName: string;
  contactLastName: string;
  contactEmail: string;
  contactPhone: string;
  ownerName: string;
  ownerEmail: string;
  internalNotes: string;
};

export type ListingManagement = {
  lifecycle: ListingLifecycleStatus;
  released: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  copiedFromId?: string;
  details: ListingDetails;
  media: ListingMediaItem[];
  appointments: ListingAppointment[];
  portals: ListingPortalState[];
};

export type ManagementRole = "admin" | "editor" | "viewer";

export type ManagementUser = {
  id: string;
  name: string;
  email: string;
  role: ManagementRole;
  active: boolean;
  createdAt: string;
  lastActiveAt?: string;
};

export type CompanyOpeningHours = {
  weekday: string;
  enabled: boolean;
  opensAt: string;
  closesAt: string;
  pauseFrom: string;
  pauseUntil: string;
};

export type CompanySettings = {
  name: string;
  legalName: string;
  street: string;
  houseNumber: string;
  zip: string;
  city: string;
  country: string;
  phone: string;
  email: string;
  website: string;
  managingDirector: string;
  taxId: string;
  tradeRegister: string;
  imprint: string;
  terms: string;
  privacyNotice: string;
  openingHours: CompanyOpeningHours[];
};

export type PortalConfiguration = {
  id: string;
  name: string;
  enabled: boolean;
  quota: number;
  currentOnline: number;
  imageLimit: number;
  captionLimit: number;
  lastSyncAt?: string;
};

export type ImportReportEvent = {
  externalId: string;
  portalId?: string;
  status: ListingPortalStatus;
  message: string;
};

export type ImportReportRecord = {
  id: string;
  filename: string;
  importedAt: string;
  eventCount: number;
  matchedCount: number;
  events: ImportReportEvent[];
};

export type AuditLogEntry = {
  id: string;
  at: string;
  userId: string;
  action: string;
  targetType: "listing" | "media" | "appointment" | "portal" | "report" | "user" | "company";
  targetId: string;
  description: string;
};

export type ManagementState = {
  version: 1;
  currentUserId: string;
  users: ManagementUser[];
  company: CompanySettings;
  portals: PortalConfiguration[];
  auditLog: AuditLogEntry[];
  importReports: ImportReportRecord[];
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
  providerNumber?: string;
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
  management?: ManagementState;
  totalSyncRun?: TotalSyncRun;
  uploadRunHistory?: UploadRunHistoryEntry[];
};
