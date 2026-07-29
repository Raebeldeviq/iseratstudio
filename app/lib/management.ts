import type {
  AuditLogEntry,
  BusinessRole,
  CompanyOpeningHours,
  CompanySettings,
  EscalationRules,
  GeneratedListing,
  HouseImage,
  HouseTemplate,
  ListingDetails,
  ListingLifecycleStatus,
  ListingManagement,
  ListingMediaItem,
  ListingObjectCategory,
  ListingParkingSpace,
  ListingPortalState,
  ManagementFileFolder,
  ManagementRole,
  ManagementState,
  ManagementUser,
  OrganizationUnit,
  PortalConfiguration,
  ProjectInput,
  ProviderSettings,
  StudioState,
  VisibilityScope,
} from "../types";
import { allocateProviderExternalIds } from "./external-ids.ts";

const DEFAULT_PORTALS: PortalConfiguration[] = [
  {
    id: "immoscout24",
    name: "ImmoScout24",
    enabled: true,
    quota: 0,
    currentOnline: 0,
    imageLimit: 150,
    captionLimit: 30,
  },
  {
    id: "immowelt",
    name: "Immowelt",
    enabled: true,
    quota: 0,
    currentOnline: 0,
    imageLimit: 50,
    captionLimit: 100,
  },
  {
    id: "kleinanzeigen",
    name: "Kleinanzeigen",
    enabled: true,
    quota: 0,
    currentOnline: 0,
    imageLimit: 20,
    captionLimit: 100,
  },
  {
    id: "livinghaus",
    name: "livinghaus.de",
    enabled: true,
    quota: 0,
    currentOnline: 0,
    imageLimit: 50,
    captionLimit: 100,
  },
];

const WEEKDAYS = [
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag",
];

export const DEFAULT_ESCALATION_RULES: EscalationRules = {
  staleWarningDays: 4,
  staleCriticalDays: 8,
  inactivityWarningDays: 7,
  inactivityCriticalDays: 14,
  renewalWarningDays: 2,
  portalErrorsCritical: true,
};

function defaultVisibilityScope(businessRole: BusinessRole): VisibilityScope {
  if (businessRole === "administrator" || businessRole === "executive") return "organization";
  if (businessRole === "sales-director") return "area";
  if (businessRole === "team-lead") return "team";
  return "self";
}

function uid(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}

function openingHours(): CompanyOpeningHours[] {
  return WEEKDAYS.map((weekday, index) => ({
    weekday,
    enabled: index < 5,
    opensAt: "09:00",
    closesAt: index < 5 ? "17:00" : "13:00",
    pauseFrom: "",
    pauseUntil: "",
  }));
}

function defaultCompany(provider: ProviderSettings): CompanySettings {
  return {
    name: provider.company,
    legalName: provider.company,
    street: "",
    houseNumber: "",
    zip: "",
    city: "",
    country: "Deutschland",
    phone: provider.phone,
    email: provider.email,
    website: "",
    managingDirector: `${provider.firstName} ${provider.lastName}`.trim(),
    taxId: "",
    tradeRegister: "",
    imprint: "",
    terms: "",
    privacyNotice: "",
    openingHours: openingHours(),
  };
}

function defaultUsers(provider: ProviderSettings, now: string): ManagementUser[] {
  return [
    {
      id: "user-fabian",
      name: provider.firstName || "Fabian",
      email: provider.email,
      role: "admin",
      businessRole: "administrator",
      visibilityScope: "organization",
      organizationUnitIds: ["unit-company"],
      customVisibleUserIds: [],
      active: true,
      createdAt: now,
    },
    {
      id: "user-pascal",
      name: "Pascal",
      email: "",
      role: "editor",
      businessRole: "sales-representative",
      visibilityScope: "self",
      organizationUnitIds: ["unit-sales-pascal"],
      managerUserId: "user-fabian",
      customVisibleUserIds: [],
      active: true,
      createdAt: now,
    },
  ];
}

function defaultOrganizationUnits(
  provider: ProviderSettings,
  now: string,
): OrganizationUnit[] {
  return [
    {
      id: "unit-company",
      name: provider.company || "Unternehmen",
      type: "company",
      managerUserId: "user-fabian",
      active: true,
      createdAt: now,
    },
    {
      id: "unit-sales-fabian",
      name: "Vertrieb Fabian",
      type: "region",
      parentId: "unit-company",
      managerUserId: "user-fabian",
      active: true,
      createdAt: now,
    },
    {
      id: "unit-sales-pascal",
      name: "Vertrieb Pascal",
      type: "region",
      parentId: "unit-company",
      managerUserId: "user-pascal",
      active: true,
      createdAt: now,
    },
  ];
}

function defaultFileFolders(
  users: ManagementUser[],
  now: string,
): ManagementFileFolder[] {
  return [
    {
      id: "folder-templates",
      name: "Livinghaus Vorlagen",
      scope: "templates",
      accessUserIds: users.map((user) => user.id),
      createdAt: now,
    },
    {
      id: "folder-public",
      name: "Öffentlich",
      scope: "public",
      accessUserIds: users.map((user) => user.id),
      createdAt: now,
    },
    ...users.map((user) => ({
      id: `folder-personal-${user.id}`,
      name: user.name,
      scope: "personal" as const,
      ownerUserId: user.id,
      accessUserIds: [user.id],
      createdAt: now,
    })),
  ];
}

export function createManagementState(
  provider: ProviderSettings,
  now = new Date().toISOString(),
): ManagementState {
  const users = defaultUsers(provider, now);
  return {
    version: 3,
    currentUserId: users[0].id,
    users,
    organizationUnits: defaultOrganizationUnits(provider, now),
    escalationRules: { ...DEFAULT_ESCALATION_RULES },
    company: defaultCompany(provider),
    portals: DEFAULT_PORTALS.map((portal) => ({ ...portal })),
    auditLog: [],
    importReports: [],
    fileFolders: defaultFileFolders(users, now),
    files: [],
  };
}

function normalizedOpeningHours(
  value: CompanyOpeningHours[] | undefined,
): CompanyOpeningHours[] {
  const byDay = new Map((value ?? []).map((item) => [item.weekday, item]));
  return openingHours().map((fallback) => ({
    ...fallback,
    ...byDay.get(fallback.weekday),
    weekday: fallback.weekday,
  }));
}

function normalizedPortals(
  value: PortalConfiguration[] | undefined,
): PortalConfiguration[] {
  const byId = new Map((value ?? []).map((item) => [item.id, item]));
  return DEFAULT_PORTALS.map((fallback) => ({
    ...fallback,
    ...byId.get(fallback.id),
    id: fallback.id,
    name: byId.get(fallback.id)?.name || fallback.name,
  })).concat(
    (value ?? []).filter((portal) => (
      !DEFAULT_PORTALS.some((fallback) => fallback.id === portal.id)
    )),
  );
}

function sourceImages(
  state: StudioState,
  listing: GeneratedListing,
): HouseImage[] {
  const house = state.houses.find((item) => item.id === listing.templateId);
  if (!house) return [];
  const promotionImages = Array.isArray(state.promotionImages)
    ? state.promotionImages
    : state.promotionImage
      ? [state.promotionImage]
      : [];
  const promotion = listing.promotionImageId
    ? promotionImages.find((image) => image.id === listing.promotionImageId)
    : undefined;
  return promotion
    ? [promotion, ...house.images.filter((image) => image.id !== promotion.id)]
    : house.images;
}

function mediaFromSource(
  listing: GeneratedListing,
  image: HouseImage,
  order: number,
  now: string,
): ListingMediaItem {
  return {
    id: `source-${listing.id}-${image.id}`,
    kind: image.isFloorplan ? "floorplan" : "image",
    name: image.name,
    caption: image.caption || image.name,
    released: true,
    order,
    createdAt: now,
    sourceImageId: image.id,
    mimeType: image.mimeType,
    rotation: 0,
  };
}

function normalizedMedia(
  state: StudioState,
  listing: GeneratedListing,
  existing: ListingMediaItem[] | undefined,
  now: string,
): ListingMediaItem[] {
  const existingBySource = new Map(
    (existing ?? [])
      .filter((item) => item.sourceImageId)
      .map((item) => [item.sourceImageId!, item]),
  );
  const source = sourceImages(state, listing).map((image, index) => ({
    ...mediaFromSource(listing, image, index, now),
    ...existingBySource.get(image.id),
    sourceImageId: image.id,
  }));
  const custom = (existing ?? []).filter((item) => !item.sourceImageId);
  return [...source, ...custom]
    .map((item, index) => ({
      ...item,
      released: item.released !== false,
      order: Number.isFinite(item.order) ? item.order : index,
      rotation: item.rotation ?? 0,
      createdAt: item.createdAt || now,
    }))
    .sort((left, right) => left.order - right.order)
    .map((item, index) => ({ ...item, order: index }));
}

function defaultDetails(
  project: ProjectInput,
  listing: GeneratedListing,
  house: HouseTemplate | undefined,
  provider: ProviderSettings,
): ListingDetails {
  const projecting = listing.projectingSettings ?? {};
  const parkingSpaces: ListingParkingSpace[] = [
    "carport",
    "duplex",
    "outdoor",
    "garage",
    "parking-garage",
    "underground",
  ].map((kind) => ({
    kind: kind as ListingParkingSpace["kind"],
    count: 0,
    price: 0,
  }));
  return {
    objectCategory: "house-purchase",
    marketingType: "purchase",
    objectStatus: "projected",
    objectStatusText: "",
    groupId: "",
    orderNumber: "",
    currency: "EUR",
    is24Placement: "",
    immoweltPlacement: "",
    portalAdditionalBooking: false,
    transferOnSave: true,
    availableFrom: "",
    addressPublished: false,
    googleMapsPublished: false,
    latitude: 0,
    longitude: 0,
    country: "Deutschland",
    street: project.street,
    houseNumber: project.houseNumber,
    zip: project.zip,
    city: project.city,
    district: project.district,
    areaType: "Wohngebiet",
    purchasePrice: listing.price,
    annualLeasePrice: 0,
    livingArea: house?.livingArea ?? 0,
    usableArea: house?.livingArea ?? 0,
    plotArea: project.plotArea,
    cubature: 0,
    rooms: house?.rooms ?? 0,
    bedrooms: house?.bedrooms ?? 0,
    bathrooms: house?.bathrooms ?? 0,
    floors: house?.floors ?? 0,
    floorNumber: 0,
    balconies: 0,
    terraces: 0,
    loggias: 0,
    houseType: house?.houseType ?? listing.templateName,
    apartmentType: "",
    constructionYear: house?.constructionYear ?? new Date().getFullYear(),
    renovationYear: 0,
    condition: "ERSTBEZUG",
    constructionPhase: projecting.constructionPhase ?? "PROJEKTIERT",
    equipmentQuality: projecting.equipmentQuality ?? "GEHOBEN",
    kitchenType: "OFFEN",
    bathroomFeatures: "DUSCHE, WANNE, FENSTER",
    flooring: "",
    heatingType: house?.heatingType ?? "FUSSBODEN",
    energySource: house?.energySource ?? "LUFTWAERMEPUMPE",
    energyType: projecting.kfw40 ? "KFW40" : projecting.kfw55 ? "KFW55" : "",
    parkingTypes: "",
    parkingSpaces,
    view: "",
    surroundings: "",
    furnished: "",
    guestWc: true,
    garden: true,
    attic: true,
    fireplace: false,
    basement: false,
    barrierFree: false,
    seniorFriendly: false,
    sauna: false,
    pool: false,
    conservatory: false,
    airConditioning: false,
    alarmSystem: false,
    elevator: false,
    monument: false,
    rented: false,
    grannyFlat: false,
    nonSmoker: false,
    vacationSuitable: false,
    assistedLiving: false,
    houseMoney: 0,
    monthlyRentIncome: 0,
    buildableSoon: false,
    landUse: "WOHNEN",
    developmentStatus: "",
    buildingLaw: "",
    buildingPermit: false,
    demolitionRequired: false,
    recommendedUse: "",
    divisibleFrom: 0,
    siteOccupancyRatio: 0,
    floorAreaRatio: 0,
    energyCertificateType: "BEDARF",
    energyCertificateValidUntil: "",
    energyClass: projecting.energyClass ?? house?.energyClass ?? "A+",
    endEnergyDemand: house?.energyDemand ?? 0,
    certificateYear: house?.constructionYear ?? new Date().getFullYear(),
    warmWaterIncluded: true,
    commissionRequired: projecting.commissionRequired ?? false,
    commissionText: "",
    contactCompany: provider.company,
    contactFirstName: provider.firstName,
    contactLastName: provider.lastName,
    contactEmail: provider.email,
    contactPhone: provider.phone,
    contactFax: "",
    contactOfficePhone: "",
    contactMobile: "",
    ownerSalutation: "",
    ownerTitle: "",
    ownerCompany: "",
    ownerFirstName: "",
    ownerLastName: "",
    ownerName: "",
    ownerEmail: "",
    ownerPhone: "",
    ownerFax: "",
    ownerOfficePhone: "",
    ownerMobile: "",
    ownerStreet: "",
    ownerZip: "",
    ownerCity: "",
    ownerIsPropertyOwner: false,
    internalNotes: project.notes,
  };
}

function normalizedPortalStates(
  configurations: PortalConfiguration[],
  value: ListingPortalState[] | undefined,
): ListingPortalState[] {
  const byId = new Map((value ?? []).map((item) => [item.portalId, item]));
  return configurations.map((portal) => ({
    portalId: portal.id,
    enabled: portal.enabled,
    status: "not-transferred",
    ...byId.get(portal.id),
  }));
}

export function deriveListingLifecycle(
  management: Pick<ListingManagement, "archivedAt" | "released" | "portals">,
  uploadedAt?: string,
): ListingLifecycleStatus {
  if (management.archivedAt) return "archived";
  if (management.portals.some((portal) => portal.status === "error")) return "error";
  if (management.portals.some((portal) => portal.status === "online")) return "online";
  if (
    uploadedAt
    || management.portals.some((portal) => (
      portal.status === "transferred"
      || portal.status === "delete-requested"
      || portal.status === "deleted"
    ))
  ) return "transferred";
  return management.released ? "ready" : "draft";
}

function normalizeListing(
  state: StudioState,
  project: ProjectInput,
  listing: GeneratedListing,
  portals: PortalConfiguration[],
  now: string,
): GeneratedListing {
  const house = state.houses.find((item) => item.id === listing.templateId);
  const current = listing.management;
  const details = {
    ...defaultDetails(project, listing, house, state.provider),
    ...current?.details,
  };
  const users = state.management?.users ?? [];
  const fallbackAssignee = users.find((user) => (
    project.owner === "pascal"
      ? user.id === "user-pascal"
      : user.id === "user-fabian"
  )) ?? users.find((user) => user.active);
  const assignedUser = users.find((user) => (
    user.id === current?.assignedUserId && user.active
  )) ?? fallbackAssignee;
  const management: ListingManagement = {
    lifecycle: current?.lifecycle ?? (listing.uploadedAt ? "transferred" : "draft"),
    released: current?.released ?? Boolean(listing.uploadedAt),
    createdAt: current?.createdAt ?? project.createdAt ?? now,
    updatedAt: current?.updatedAt ?? listing.uploadedAt ?? project.createdAt ?? now,
    assignedUserId: assignedUser?.id,
    organizationUnitId: current?.organizationUnitId
      ?? assignedUser?.organizationUnitIds[0]
      ?? "unit-company",
    lastReviewedAt: current?.lastReviewedAt,
    nextActionDueAt: current?.nextActionDueAt,
    archivedAt: current?.archivedAt,
    copiedFromId: current?.copiedFromId,
    details,
    media: normalizedMedia(state, listing, current?.media, now),
    appointments: current?.appointments ?? [],
    portals: normalizedPortalStates(portals, current?.portals),
  };
  management.lifecycle = deriveListingLifecycle(management, listing.uploadedAt);
  return { ...listing, management };
}

export function normalizeStudioManagementState(
  state: StudioState,
  now = new Date().toISOString(),
): StudioState {
  const fallback = createManagementState(state.provider, now);
  const current = state.management;
  const organizationUnits = current?.organizationUnits?.length
    ? current.organizationUnits.map((unit) => ({
        ...unit,
        active: unit.active !== false,
        createdAt: unit.createdAt || now,
      }))
    : fallback.organizationUnits;
  const validUnitIds = new Set(organizationUnits.map((unit) => unit.id));
  const users = current?.users?.length
    ? current.users.map((user) => ({
        ...user,
        businessRole: user.businessRole
          ?? (user.role === "admin" ? "administrator" : "sales-representative"),
        visibilityScope: user.visibilityScope
          ?? defaultVisibilityScope(
            user.businessRole
              ?? (user.role === "admin" ? "administrator" : "sales-representative"),
          ),
        organizationUnitIds: (user.organizationUnitIds ?? [])
          .filter((unitId) => validUnitIds.has(unitId))
          .concat(
            (user.organizationUnitIds ?? []).some((unitId) => validUnitIds.has(unitId))
              ? []
              : ["unit-company"],
          ),
        customVisibleUserIds: user.customVisibleUserIds ?? [],
        active: user.active !== false,
        createdAt: user.createdAt || now,
      }))
    : fallback.users;
  const activeUser = users.find((user) => (
    user.id === current?.currentUserId && user.active
  )) ?? users.find((user) => user.active) ?? users[0];
  const portals = normalizedPortals(current?.portals);
  const folderFallbacks = defaultFileFolders(users, now);
  const existingFolders = current?.fileFolders ?? [];
  const fileFolders = [
    ...existingFolders,
    ...folderFallbacks.filter((fallbackFolder) => (
      !existingFolders.some((folder) => (
        folder.id === fallbackFolder.id
        || (
          folder.scope === "personal"
          && folder.ownerUserId === fallbackFolder.ownerUserId
        )
      ))
    )),
  ];
  const management: ManagementState = {
    version: 3,
    currentUserId: activeUser?.id ?? "",
    users,
    organizationUnits,
    escalationRules: {
      ...DEFAULT_ESCALATION_RULES,
      ...current?.escalationRules,
    },
    company: {
      ...fallback.company,
      ...current?.company,
      openingHours: normalizedOpeningHours(current?.company?.openingHours),
    },
    portals,
    auditLog: current?.auditLog ?? [],
    importReports: current?.importReports ?? [],
    fileFolders,
    files: current?.files ?? [],
  };
  const sourceState = { ...state, management };
  return {
    ...sourceState,
    projects: sourceState.projects.map((project) => ({
      ...project,
      listings: project.listings.map((listing) => (
        normalizeListing(sourceState, project, listing, portals, now)
      )),
    })),
  };
}

export function managementPermission(
  role: ManagementRole,
  permission:
    | "edit-listings"
    | "transfer"
    | "delete-remote"
    | "manage-users"
    | "manage-company",
): boolean {
  if (role === "admin") return true;
  if (role === "viewer") return false;
  return permission === "edit-listings" || permission === "transfer";
}

export function currentManagementUser(state: StudioState): ManagementUser | undefined {
  return state.management?.users.find((user) => (
    user.id === state.management?.currentUserId && user.active
  ));
}

export function appendAuditLog(
  state: StudioState,
  entry: Omit<AuditLogEntry, "id" | "at" | "userId">,
  at = new Date().toISOString(),
): StudioState {
  if (!state.management) return state;
  const audit: AuditLogEntry = {
    ...entry,
    id: uid("audit"),
    at,
    userId: state.management.currentUserId,
  };
  return {
    ...state,
    management: {
      ...state.management,
      auditLog: [audit, ...state.management.auditLog].slice(0, 1000),
    },
  };
}

export function mapListing(
  state: StudioState,
  listingId: string,
  update: (
    listing: GeneratedListing,
    project: ProjectInput,
  ) => GeneratedListing,
): StudioState {
  return {
    ...state,
    projects: state.projects.map((project) => ({
      ...project,
      listings: project.listings.map((listing) => (
        listing.id === listingId ? update(listing, project) : listing
      )),
    })),
  };
}

export function findListing(
  state: StudioState,
  listingId: string,
): { project: ProjectInput; listing: GeneratedListing } | undefined {
  for (const project of state.projects) {
    const listing = project.listings.find((item) => item.id === listingId);
    if (listing) return { project, listing };
  }
  return undefined;
}

export type DirectObjectDraft = {
  objectCategory: ListingObjectCategory;
  templateId?: string;
  title: string;
  owner: ProjectInput["owner"];
  assignedUserId: string;
  organizationUnitId: string;
  country: string;
  street: string;
  houseNumber: string;
  zip: string;
  city: string;
  district: string;
  areaType: string;
  addressPublished: boolean;
  googleMapsPublished: boolean;
  purchasePrice: number;
  annualLeasePrice: number;
  livingArea: number;
  usableArea: number;
  plotArea: number;
  rooms: number;
  bedrooms: number;
  bathrooms: number;
  floors: number;
  houseType: string;
  apartmentType: string;
  marketingType: ListingDetails["marketingType"];
  landUse: string;
  developmentStatus: string;
  buildingLaw: string;
  buildableSoon: boolean;
  ownerSalutation: string;
  ownerCompany: string;
  ownerFirstName: string;
  ownerLastName: string;
  ownerEmail: string;
  ownerPhone: string;
  ownerIsPropertyOwner: boolean;
  internalNotes: string;
  released: boolean;
  portalIds: string[];
};

function directCategoryName(category: ListingObjectCategory): string {
  if (category === "apartment-purchase") return "Wohnung Kauf";
  if (category === "land") return "Grundstück";
  return "Haus Kauf";
}

function directTemplate(
  draft: DirectObjectDraft,
  now: string,
): HouseTemplate {
  const name = `Freies Objekt – ${directCategoryName(draft.objectCategory)}`;
  return {
    id: uid("direct-template"),
    archived: true,
    name,
    houseType: draft.houseType || draft.apartmentType || name,
    livingArea: draft.livingArea,
    rooms: draft.rooms,
    bedrooms: draft.bedrooms,
    bathrooms: draft.bathrooms,
    floors: draft.floors,
    housePrice: draft.purchasePrice,
    constructionYear: new Date(now).getFullYear(),
    energyDemand: 0,
    energyClass: "",
    heatingType: "",
    energySource: "",
    architecture: "",
    equipmentHighlights: "",
    useStandardPackage: false,
    images: [],
  };
}

export function createDirectObject(
  inputState: StudioState,
  draft: DirectObjectDraft,
  now = new Date().toISOString(),
): { state: StudioState; listingId: string; externalId: string } {
  const state = normalizeStudioManagementState(inputState, now);
  const listingId = uid("listing");
  const projectId = uid("object");
  const externalId = allocateProviderExternalIds(
    state.provider.providerNumber,
    state.projects.flatMap((project) => (
      project.listings.map((listing) => listing.externalId)
    )),
    1,
  )[0];
  const selectedTemplate = draft.objectCategory === "house-purchase"
    ? state.houses.find((house) => (
        house.id === draft.templateId && house.archived !== true
      ))
    : undefined;
  const generatedTemplate = selectedTemplate
    ? undefined
    : directTemplate(draft, now);
  const template = selectedTemplate ?? generatedTemplate!;
  const project: ProjectInput = {
    id: projectId,
    owner: draft.owner,
    name: draft.city.trim()
      ? `${directCategoryName(draft.objectCategory)} · ${draft.city.trim()}`
      : `${directCategoryName(draft.objectCategory)} · ${externalId}`,
    street: draft.street.trim(),
    houseNumber: draft.houseNumber.trim(),
    zip: draft.zip.trim(),
    city: draft.city.trim(),
    district: draft.district.trim(),
    plotArea: draft.plotArea,
    plotPrice: draft.objectCategory === "land" ? draft.purchasePrice : 0,
    additionalCosts: 0,
    locationFacts: "",
    transportFacts: "",
    familyFacts: "",
    natureFacts: "",
    notes: draft.internalNotes.trim(),
    selectedHouseIds: [template.id],
    listings: [{
      id: listingId,
      externalId,
      templateId: template.id,
      templateName: template.name,
      price: draft.purchasePrice || draft.annualLeasePrice,
      texts: {
        title: draft.title.trim(),
        description: "",
        equipment: "",
        location: "",
        other: "",
        commission: "",
        disclaimer: "Die von uns gemachten Informationen beruhen auf Angaben des Verkäufers bzw. der Verkäuferin. Für die Richtigkeit und Vollständigkeit der Angaben kann keine Gewähr bzw. Haftung übernommen werden. Ein Zwischenverkauf und Irrtümer sind vorbehalten.",
        terms: "",
        recommendation: "",
      },
      version: 1,
    }],
    createdAt: now,
  };
  let next = normalizeStudioManagementState({
    ...state,
    houses: generatedTemplate ? [...state.houses, generatedTemplate] : state.houses,
    projects: [...state.projects, project],
  }, now);
  next = mapListing(next, listingId, (listing) => {
    if (!listing.management) return listing;
    const selectedPortalIds = new Set(draft.portalIds);
    const details: ListingDetails = {
      ...listing.management.details,
      objectCategory: draft.objectCategory,
      marketingType: draft.marketingType,
      country: draft.country.trim() || "Deutschland",
      street: draft.street.trim(),
      houseNumber: draft.houseNumber.trim(),
      zip: draft.zip.trim(),
      city: draft.city.trim(),
      district: draft.district.trim(),
      areaType: draft.areaType,
      addressPublished: draft.addressPublished,
      googleMapsPublished: draft.googleMapsPublished,
      purchasePrice: draft.purchasePrice,
      annualLeasePrice: draft.annualLeasePrice,
      livingArea: draft.livingArea || template.livingArea,
      usableArea: draft.usableArea,
      plotArea: draft.plotArea,
      rooms: draft.rooms || template.rooms,
      bedrooms: draft.bedrooms || template.bedrooms,
      bathrooms: draft.bathrooms || template.bathrooms,
      floors: draft.floors || template.floors,
      houseType: draft.houseType || template.houseType,
      apartmentType: draft.apartmentType,
      landUse: draft.landUse,
      developmentStatus: draft.developmentStatus,
      buildingLaw: draft.buildingLaw,
      buildableSoon: draft.buildableSoon,
      ownerSalutation: draft.ownerSalutation,
      ownerCompany: draft.ownerCompany.trim(),
      ownerFirstName: draft.ownerFirstName.trim(),
      ownerLastName: draft.ownerLastName.trim(),
      ownerName: [
        draft.ownerFirstName.trim(),
        draft.ownerLastName.trim(),
      ].filter(Boolean).join(" ") || draft.ownerCompany.trim(),
      ownerEmail: draft.ownerEmail.trim(),
      ownerPhone: draft.ownerPhone.trim(),
      ownerIsPropertyOwner: draft.ownerIsPropertyOwner,
      internalNotes: draft.internalNotes.trim(),
    };
    const management: ListingManagement = {
      ...listing.management,
      released: draft.released,
      updatedAt: now,
      assignedUserId: draft.assignedUserId || state.management?.currentUserId,
      organizationUnitId: draft.organizationUnitId
        || state.management?.users.find((user) => (
          user.id === (draft.assignedUserId || state.management?.currentUserId)
        ))?.organizationUnitIds[0]
        || "unit-company",
      details,
      portals: listing.management.portals.map((portal) => ({
        ...portal,
        enabled: selectedPortalIds.has(portal.portalId),
        status: "not-transferred",
        message: undefined,
      })),
    };
    return {
      ...listing,
      price: draft.purchasePrice || draft.annualLeasePrice,
      management: {
        ...management,
        lifecycle: deriveListingLifecycle(management),
      },
    };
  });
  next = appendAuditLog(next, {
    action: "Objekt angelegt",
    targetType: "listing",
    targetId: listingId,
    description: `${externalId} · ${directCategoryName(draft.objectCategory)} · ${draft.title.trim()}`,
  }, now);
  return { state: next, listingId, externalId };
}

export function resolveListingMediaDataUrl(
  state: StudioState,
  listing: GeneratedListing,
  media: ListingMediaItem,
): string {
  if (media.dataUrl) return media.dataUrl;
  if (!media.sourceImageId) return "";
  const images = [
    ...state.houses.flatMap((house) => house.images),
    ...(state.promotionImages ?? []),
    ...(state.promotionImage ? [state.promotionImage] : []),
  ];
  return images.find((image) => image.id === media.sourceImageId)?.dataUrl ?? "";
}

export function listingMediaAsHouseImages(
  state: StudioState,
  listing: GeneratedListing,
): HouseImage[] {
  return (listing.management?.media ?? [])
    .filter((media) => (
      media.released
      && (media.kind === "image" || media.kind === "floorplan")
    ))
    .sort((left, right) => left.order - right.order)
    .map((media) => ({
      id: media.id,
      sourceId: media.sourceImageId,
      name: media.name,
      mimeType: media.mimeType || "image/jpeg",
      dataUrl: resolveListingMediaDataUrl(state, listing, media),
      caption: media.caption,
      isFloorplan: media.kind === "floorplan",
    }))
    .filter((image) => Boolean(image.dataUrl));
}

export function createListingMediaItem(
  kind: ListingMediaItem["kind"],
  input: {
    name: string;
    caption?: string;
    mimeType?: string;
    dataUrl?: string;
    url?: string;
  },
  order: number,
  now = new Date().toISOString(),
): ListingMediaItem {
  return {
    id: uid("media"),
    kind,
    name: input.name,
    caption: input.caption || input.name,
    released: true,
    order,
    createdAt: now,
    mimeType: input.mimeType,
    dataUrl: input.dataUrl,
    url: input.url,
    rotation: 0,
  };
}

export function createManagementUser(
  name: string,
  email: string,
  role: ManagementRole,
  now = new Date().toISOString(),
): ManagementUser {
  const businessRole: BusinessRole = role === "admin"
    ? "administrator"
    : "sales-representative";
  return {
    id: uid("user"),
    name,
    email,
    role,
    businessRole,
    visibilityScope: defaultVisibilityScope(businessRole),
    organizationUnitIds: ["unit-company"],
    customVisibleUserIds: [],
    active: true,
    createdAt: now,
  };
}

export function defaultPortalConfigurations(): PortalConfiguration[] {
  return DEFAULT_PORTALS.map((portal) => ({ ...portal }));
}
