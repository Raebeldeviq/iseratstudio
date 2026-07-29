import type {
  AuditLogEntry,
  CompanyOpeningHours,
  CompanySettings,
  GeneratedListing,
  HouseImage,
  HouseTemplate,
  ListingDetails,
  ListingLifecycleStatus,
  ListingManagement,
  ListingMediaItem,
  ListingPortalState,
  ManagementRole,
  ManagementState,
  ManagementUser,
  PortalConfiguration,
  ProjectInput,
  ProviderSettings,
  StudioState,
} from "../types";

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
      active: true,
      createdAt: now,
    },
    {
      id: "user-pascal",
      name: "Pascal",
      email: "",
      role: "editor",
      active: true,
      createdAt: now,
    },
  ];
}

export function createManagementState(
  provider: ProviderSettings,
  now = new Date().toISOString(),
): ManagementState {
  const users = defaultUsers(provider, now);
  return {
    version: 1,
    currentUserId: users[0].id,
    users,
    company: defaultCompany(provider),
    portals: DEFAULT_PORTALS.map((portal) => ({ ...portal })),
    auditLog: [],
    importReports: [],
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
  return {
    objectStatus: "projected",
    groupId: "",
    orderNumber: "",
    currency: "EUR",
    availableFrom: "",
    addressPublished: false,
    googleMapsPublished: false,
    country: "Deutschland",
    street: project.street,
    houseNumber: project.houseNumber,
    zip: project.zip,
    city: project.city,
    district: project.district,
    purchasePrice: listing.price,
    livingArea: house?.livingArea ?? 0,
    usableArea: house?.livingArea ?? 0,
    plotArea: project.plotArea,
    rooms: house?.rooms ?? 0,
    bedrooms: house?.bedrooms ?? 0,
    bathrooms: house?.bathrooms ?? 0,
    floors: house?.floors ?? 0,
    balconies: 0,
    terraces: 0,
    houseType: house?.houseType ?? listing.templateName,
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
    parkingTypes: "",
    view: "",
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
    ownerName: "",
    ownerEmail: "",
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
  const management: ListingManagement = {
    lifecycle: current?.lifecycle ?? (listing.uploadedAt ? "transferred" : "draft"),
    released: current?.released ?? Boolean(listing.uploadedAt),
    createdAt: current?.createdAt ?? project.createdAt ?? now,
    updatedAt: current?.updatedAt ?? listing.uploadedAt ?? project.createdAt ?? now,
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
  const users = current?.users?.length
    ? current.users.map((user) => ({
        ...user,
        active: user.active !== false,
        createdAt: user.createdAt || now,
      }))
    : fallback.users;
  const activeUser = users.find((user) => (
    user.id === current?.currentUserId && user.active
  )) ?? users.find((user) => user.active) ?? users[0];
  const portals = normalizedPortals(current?.portals);
  const management: ManagementState = {
    version: 1,
    currentUserId: activeUser?.id ?? "",
    users,
    company: {
      ...fallback.company,
      ...current?.company,
      openingHours: normalizedOpeningHours(current?.company?.openingHours),
    },
    portals,
    auditLog: current?.auditLog ?? [],
    importReports: current?.importReports ?? [],
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
  return {
    id: uid("user"),
    name,
    email,
    role,
    active: true,
    createdAt: now,
  };
}

export function defaultPortalConfigurations(): PortalConfiguration[] {
  return DEFAULT_PORTALS.map((portal) => ({ ...portal }));
}
