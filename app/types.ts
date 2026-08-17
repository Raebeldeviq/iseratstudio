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

export type WorkflowStatus =
  | "draft"
  | "prepared"
  | "scheduled"
  | "processing"
  | "published"
  | "transferred_pending_import"
  | "blocked"
  | "failed"
  | "archived"
  | "deleted";

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
  eligibleForListingHero?: boolean;
};

export type PromotionImageAsset = HouseImage & {
  active: boolean;
  priority: number;
  order: number;
  lastUsedAt: string;
  usageCount: number;
  lastProjectId?: string;
  lastHouseId?: string;
  lastListingId?: string;
};

export type PromotionSettings = {
  enabled: boolean;
  automaticRotation: boolean;
  randomSelection: boolean;
  manualSelection: boolean;
  manualImageId: string;
};

export type PromotionUsage = {
  id: string;
  projectId: string;
  listingId: string;
  externalId: string;
  houseId?: string;
  imageId: string;
  usedAt: string;
  mode: "create" | "update";
};

export type HouseUsageStat = {
  houseId: string;
  totalUses: number;
  lastUsedAt: string;
  projectIds: string[];
  activeProjectIds: string[];
  usedAt: string[];
};

export type HouseCombinationUsage = {
  key: string;
  houseIds: string[];
  totalUses: number;
  lastUsedAt: string;
  lastProjectId: string;
  usedAt: string[];
};

export type ProjectHouseDistribution = {
  projectId: string;
  activeHouseIds: string[];
  previewHouseIds: string[];
  previousCombination: string;
  combinationHistory: string[];
  lastRemovedHouseId: string;
  lastAddedHouseId: string;
  pinnedHouseIds: string[];
  excludedHouseIds: string[];
  updatedAt: string;
};

export type HouseDistributionSettings = {
  usageWindowDays: number;
  candidateTrials: number;
  weights: {
    base: number;
    totalUsePenalty: number;
    recentUsePenalty: number;
    activeProjectPenalty: number;
    neverUsedOnProjectBonus: number;
    inactiveBonus: number;
    agePerDayBonus: number;
    ageBonusLimit: number;
    lastRemovedPenalty: number;
    combinationUsePenalty: number;
    projectHistoryPenalty: number;
    simultaneousOverlapPenalty: number;
  };
};

export type HouseDistributionState = {
  schemaVersion: 1;
  poolHouseIds: string[];
  settings: HouseDistributionSettings;
  houseUsage: HouseUsageStat[];
  combinationUsage: HouseCombinationUsage[];
  projects: ProjectHouseDistribution[];
  updatedAt: string;
};

export type HouseTemplate = {
  id: string;
  approved?: boolean;
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

export type PlotRecord = {
  id: string;
  street: string;
  houseNumber: string;
  postalCode: string;
  city: string;
  plotSizeSqm: number;
  purchasePrice: number;
  regionalNotes: string;
  sourceInternalId: string;
  listingUrl: string;
  sourceName: string;
  sourceStatus: string;
  sourceFirstSeenAt: string;
  sourceLastCheckedAt: string;
  sourceExposeFilename: string;
  syncedAt: string;
  owner?: AddressOwner;
  exposeFileReference: string;
  exposeFilename: string;
  exposeUploadedAt: string;
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
};

export type ProjectInput = {
  id: string;
  plotId?: string;
  isActive?: boolean;
  owner: AddressOwner;
  name: string;
  street: string;
  houseNumber: string;
  zip: string;
  city: string;
  district: string;
  federalState?: string;
  county?: string;
  plotArea: number;
  plotPrice: number;
  additionalCosts: number;
  locationFacts: string;
  transportFacts: string;
  familyFacts: string;
  natureFacts: string;
  selectedHouseIds: string[];
  listings: GeneratedListing[];
  listingGroup?: ListingGroup;
  createdAt: string;
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
  attic?: boolean;
  guestWc?: boolean;
  gardenUse?: boolean;
  underfloorHeating?: boolean;
  electricFuel?: boolean;
  airSourceHeatPump?: boolean;
  kfw40?: boolean;
  kfw55?: boolean;
  energyClass?: string;
  commissionRequired?: boolean;
  energyCertificateClass?: string;
  fittedKitchen?: boolean;
  openKitchen?: boolean;
  shower?: boolean;
  bathtub?: boolean;
  bathroomWindow?: boolean;
  environmentBus?: boolean;
  environmentShopping?: boolean;
};

export type GeneratedListing = {
  id: string;
  externalId: string;
  templateId: string;
  templateName: string;
  price: number;
  texts: ListingTexts;
  version: number;
  projectingSettings?: ProjectingSettings;
  listingGroupVariantId?: string;
  listingOrigin?: "group-source" | "rotation-copy";
  rotationSourceListingId?: string;
  rotationRemovedHouseId?: string;
  rotationAddedHouseId?: string;
  rotationArchivedAt?: string;
  createdAt?: string;
  promotionImageId?: string;
  promotionAssignedAt?: string;
  heroImageId?: string;
  heroCreativeType?: "house" | "action";
  creativeSelection?: {
    format: 1;
    rotationId: string;
    projectId: string;
    plotId: string;
    sourceListingId: string;
    houseId: string;
    heroType: "house" | "action";
    heroImageId: string;
    promotionImageId: string;
    selectedAt: string;
    houseReason: string;
    heroReason: string;
    houseLastUsedAt: string;
    heroLastUsedAt: string;
    diagnostics: string[];
  };
  lastUploadedAt?: string;
  transferredAt?: string;
  nextUpdateAt?: string;
  status?: WorkflowStatus;
  statusMessage?: string;
  uploadError?: string;
  importConfirmedAt?: string;
  importReportId?: string;
  supersededByListingId?: string;
  replacementConfirmedAt?: string;
  externalDeletionPending?: boolean;
};

export type ListingGroupVariantRole = "variant" | "primary" | "alternative";

export type HouseVariantImageReference = {
  id: string;
  name: string;
  caption: string;
  mimeType: string;
  isFloorplan: boolean;
  role: string;
};

export type HouseVariantSnapshot = Omit<HouseTemplate, "images" | "approved"> & {
  images: HouseVariantImageReference[];
};

export type ListingGroupVariant = {
  id: string;
  projectId: string;
  role: ListingGroupVariantRole;
  order: number;
  templateId: string;
  templateName: string;
  active: boolean;
  approved: boolean;
  houseSnapshot: HouseVariantSnapshot | null;
  listing: GeneratedListing | null;
  createdAt: string;
  updatedAt: string;
};

export type ListingGroupAutomation = {
  automaticUpdateEnabled: boolean;
  updateIntervalDays: number;
  automaticRecreationEnabled: boolean;
  automaticDeletionEnabled: false;
  rotationEnabled: boolean;
  maxUpdatesPerDay: number;
  lastUpdatedAt: string;
  nextUpdatedAt: string;
};

export type ListingUpdateMode =
  | "full-auto"
  | "copy-without-delete"
  | "prepare-only"
  | "blocked";

export type ListingAutomationControl = {
  listingId: string;
  externalId: string;
  projectId: string;
  variantId: string;
  automaticUpdateEnabled: boolean;
  automaticDeletionEnabled: boolean;
  premiumPlacement: boolean;
  manualLock: boolean;
  lockedUntil: string;
  lockReason: string;
  lastUpdatedAt: string;
  nextUpdatedAt: string;
  lastAttemptAt: string;
  lastSuccessAt: string;
  lastError: string;
  status: WorkflowStatus;
  statusMessage: string;
  userPriority: number;
  updateMode: ListingUpdateMode;
  schedulerSelectionId: string;
  schedulerSelectedAt: string;
  pendingRotationListingId?: string;
  pendingRotationJobId?: string;
  processLease: { token: string; startedAt: string } | null;
};

export type ListingGroupLog = {
  id: string;
  timestamp: string;
  projectId: string;
  oldExternalId: string;
  newExternalId: string;
  oldVariantId: string;
  oldVariantName: string;
  newVariantId: string;
  newVariantName: string;
  mode: string;
  deletionAllowed: boolean;
  premiumLockActive: boolean;
  checkResult: string;
  variation: string;
  error: string;
  processStatus: WorkflowStatus;
  message: string;
};

export type ListingGroup = {
  id: string;
  projectId: string;
  variants: ListingGroupVariant[];
  automation: ListingGroupAutomation;
  listingControls: ListingAutomationControl[];
  logs: ListingGroupLog[];
  rotationCounter: number;
  lastStatus: WorkflowStatus;
  lastStatusMessage: string;
  lastError: string;
  createdAt: string;
  updatedAt: string;
};

export type SchedulerSettings = {
  enabled: boolean;
  paused: boolean;
  mode: ListingUpdateMode;
  maxUpdatesPerDay: number;
  maxUpdatesPerAddressPerDay: number;
  minimumSpacingHours: number;
  initialWaitDays: number;
  updateIntervalDays: number;
  allowedWeekdays: number[];
  startTime: string;
  endTime: string;
};

export type SchedulerRunLog = {
  id: string;
  timestamp: string;
  startedAt?: string;
  endedAt?: string;
  trigger?: string;
  operatingMode?: "off" | "canary" | "active";
  operatingModeFallbackReason?: string;
  mode: ListingUpdateMode | "dry-run";
  selectedListingIds: string[];
  completedListingIds: string[];
  failedListingIds: string[];
  resumedListingIds?: string[];
  dueCount?: number;
  selectedCount?: number;
  skippedCount?: number;
  skippedListings?: Array<{
    projectId: string;
    listingId: string;
    externalId?: string;
    reason: string;
  }>;
  errorCount?: number;
  abortReason?: string;
  status: WorkflowStatus;
  statusMessage: string;
  error: string;
};

export type ListingScheduler = {
  settings: SchedulerSettings;
  runs: SchedulerRunLog[];
  lastRunAt: string;
  nextRunAt: string;
  lastStatus: WorkflowStatus;
  lastStatusMessage: string;
  lastError: string;
};

export type ProviderSettings = {
  providerNumber: string;
  company: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
};

export type BatchUploadLog = {
  id: string;
  jobId: string;
  batchId: string;
  projectId: string;
  address: string;
  listingId: string;
  externalId: string;
  houseVariant: string;
  promotionImageId: string;
  createdAt: string;
  updatedAt: string;
  nextUpdatedAt: string;
  status: WorkflowStatus;
  statusMessage: string;
  error: string;
};

export type ImportReportRecord = {
  reportId: string;
  messageId: string;
  rawHash: string;
  receivedAt: string;
  processedAt: string;
  providerImportAt: string;
  subject: string;
  channel: "email";
  senderSoftware: string;
  objectCount: number;
  providerId: string;
  providerCompany: string;
  providerEmail: string;
  externalObjectNumber: string;
  importResult: "success" | "failure" | "unknown";
  matchedListingId: string;
  matchedUploadJobId: string;
  sourceListingId: string;
  projectId: string;
  parserVersion: string;
  processingStatus:
    | "confirmed"
    | "confirmed_mail_move_pending"
    | "confirmed_mail_moved"
    | "mail_move_requested"
    | "mail_move_ambiguous"
    | "mail_move_unresolved"
    | "mail_move_manual_review_required";
  mailAccount: string;
  mailAccountId?: string;
  mailTransportId: string;
  mailSourceFolder?: string;
  /** Historical read compatibility; new reports do not have a mail post-state. */
  mailFolderAfterProcessing?: string;
  mailMovedAt?: string;
};

export type ImportReportReview = {
  reviewId: string;
  messageId: string;
  rawHash: string;
  receivedAt: string;
  externalObjectNumber: string;
  reason: string;
  processingStatus: "review_required";
  updatedAt: string;
};

export type StudioState = {
  version: 1;
  dataSchemaVersion?: number;
  plotSchemaVersion?: number;
  houses: HouseTemplate[];
  plots?: PlotRecord[];
  selectedPlotIds?: string[];
  projects: ProjectInput[];
  provider: ProviderSettings;
  promotionImage: HouseImage | null;
  promotionImageEnabled: boolean;
  promotionImages?: PromotionImageAsset[];
  promotionSettings?: PromotionSettings;
  promotionUsage?: PromotionUsage[];
  uploadHistory?: BatchUploadLog[];
  importReports?: ImportReportRecord[];
  importReportReviews?: ImportReportReview[];
  mailImportReportStatus?: {
    status: string;
    message: string;
    updatedAt: string;
    externalObjectNumber?: string;
    reportId?: string;
  };
  scheduler?: ListingScheduler;
  houseDistribution?: HouseDistributionState;
};
