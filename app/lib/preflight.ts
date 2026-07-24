import type {
  GeneratedListing,
  HouseImage,
  HouseTemplate,
  ProjectInput,
  ProviderSettings,
} from "../types";
import { findAddressDuplicateGroups } from "./address-duplicates";
import { missingRequiredTotalSyncHouseTypes } from "./total-sync";

export type PreflightMode = "manual-upload" | "total-sync" | "seven-day";
export type PreflightSeverity = "blocker" | "warning";
export type PreflightCategoryId =
  | "areas"
  | "prices"
  | "house-numbers"
  | "images"
  | "credentials"
  | "duplicates";

export type PreflightItem = {
  id: string;
  severity: PreflightSeverity;
  label: string;
  detail?: string;
  entityId?: string;
};

export type PreflightCategory = {
  id: PreflightCategoryId;
  title: string;
  description: string;
  items: PreflightItem[];
  blockerCount: number;
  warningCount: number;
  status: "ready" | PreflightSeverity;
};

export type PreflightReport = {
  mode: PreflightMode;
  targetCount: number;
  categories: PreflightCategory[];
  blockerCount: number;
  warningCount: number;
  canStart: boolean;
};

type CredentialCheck = {
  credentialsReady: boolean;
  ftpHost: string;
  ftpUser: string;
  ftpPassword: string;
  helperOnline: boolean;
  helperNeedsRestart?: boolean;
  openAiKeyValid?: boolean;
  openAiKeyVerified?: boolean;
};

export type PreflightInput = {
  mode: PreflightMode;
  projects: ProjectInput[];
  allProjects: ProjectInput[];
  houses: HouseTemplate[];
  provider: ProviderSettings;
  credentials: CredentialCheck;
  requireOpenAi: boolean;
  minHouseImages: number;
  maxHouseImages: number;
  libraryMode?: boolean;
  requiredReadyHouseCount?: number;
  requiredPromotionImageCount?: number;
  promotionImages?: HouseImage[];
  checkListings?: boolean;
  listingRunId?: string;
  listingProjectIds?: string[];
  minimumListingCount?: number;
  expectedProjectIds?: string[];
  expectedHouseIds?: string[];
  replacementExclusionsByProject?: Record<string, string[]>;
};

const CATEGORY_META: Record<
  PreflightCategoryId,
  { title: string; description: string }
> = {
  areas: {
    title: "Flächen",
    description: "Jede Zieladresse benötigt eine Grundstücksfläche größer als 0 m².",
  },
  prices: {
    title: "Preise",
    description: "Grundstück, verwendete Häuser und fertige Inserate benötigen einen Preis.",
  },
  "house-numbers": {
    title: "Hausnummern & Adressen",
    description: "Straße, Hausnummer, PLZ und Ort müssen vollständig sein.",
  },
  images: {
    title: "Bilder",
    description: "Verwendete Haustypen benötigen vollständige und lesbare Bilddateien.",
  },
  credentials: {
    title: "Zugangsdaten",
    description: "Immoprofessional, Anbieterangaben und gegebenenfalls OpenAI müssen bereit sein.",
  },
  duplicates: {
    title: "Dubletten",
    description: "Gleiche echte Adressen oder Objekt-IDs werden benutzerübergreifend erkannt.",
  },
};

const CATEGORY_ORDER: PreflightCategoryId[] = [
  "areas",
  "prices",
  "house-numbers",
  "images",
  "credentials",
  "duplicates",
];

function finitePositive(value: number): boolean {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

function ownerLabel(project: ProjectInput): string {
  return project.owner === "pascal" ? "Pascal" : "Fabian";
}

function projectAddress(project: ProjectInput): string {
  const street = [project.street, project.houseNumber].filter(Boolean).join(" ");
  const place = [project.zip, project.city].filter(Boolean).join(" ");
  return [street, place].filter(Boolean).join(", ") || project.name;
}

function projectLabel(project: ProjectInput): string {
  return `${ownerLabel(project)} · ${project.name || projectAddress(project)}`;
}

const IMAGE_USABILITY_CACHE = new WeakMap<
  HouseImage,
  {
    dataUrl: string;
    id: string;
    mimeType: string;
    usable: boolean;
  }
>();

function imageLooksUsable(image: HouseImage): boolean {
  const cached = IMAGE_USABILITY_CACHE.get(image);
  if (
    cached
    && cached.dataUrl === image.dataUrl
    && cached.id === image.id
    && cached.mimeType === image.mimeType
  ) return cached.usable;

  const dataUrl = image.dataUrl.trim();
  const payload = (dataUrl.split(",")[1] ?? "").replace(/\s/g, "");
  let decodable = false;
  if (payload && payload.length % 4 !== 1 && /^[a-z0-9+/]*={0,2}$/i.test(payload)) {
    try {
      decodable = globalThis.atob(payload).length > 0;
    } catch {
      decodable = false;
    }
  }
  const usable = Boolean(
    image.id.trim()
    && image.mimeType.trim().toLocaleLowerCase("de-DE").startsWith("image/")
    && /^data:image\/[a-z0-9.+-]+;base64,/i.test(dataUrl)
    && decodable
  );
  IMAGE_USABILITY_CACHE.set(image, {
    dataUrl: image.dataUrl,
    id: image.id,
    mimeType: image.mimeType,
    usable,
  });
  return usable;
}

export function houseIsReadyForUpload(
  house: HouseTemplate,
  minHouseImages: number,
  maxHouseImages: number,
): boolean {
  return finitePositive(house.livingArea)
    && finitePositive(house.housePrice)
    && house.images.length >= minHouseImages
    && house.images.length <= maxHouseImages
    && house.images.every(imageLooksUsable);
}

function duplicateGroups<T>(
  values: T[],
  keyFor: (value: T) => string | undefined,
): T[][] {
  const groups = new Map<string, T[]>();
  values.forEach((value) => {
    const key = keyFor(value);
    if (!key) return;
    groups.set(key, [...(groups.get(key) ?? []), value]);
  });
  return [...groups.values()].filter((group) => group.length > 1);
}

function listingExternalId(listing: GeneratedListing): string | undefined {
  const value = listing.externalId.trim().toLocaleUpperCase("de-DE");
  return value || undefined;
}

function makeItem(
  category: PreflightCategoryId,
  code: string,
  severity: PreflightSeverity,
  label: string,
  detail?: string,
  entityId?: string,
): PreflightItem {
  return {
    id: `${category}:${code}`,
    severity,
    label,
    detail,
    entityId,
  };
}

function categoryResult(
  id: PreflightCategoryId,
  items: PreflightItem[],
): PreflightCategory {
  const blockerCount = items.filter((item) => item.severity === "blocker").length;
  const warningCount = items.length - blockerCount;
  return {
    id,
    ...CATEGORY_META[id],
    items,
    blockerCount,
    warningCount,
    status: blockerCount ? "blocker" : warningCount ? "warning" : "ready",
  };
}

export function buildPreflightReport(input: PreflightInput): PreflightReport {
  const issues = new Map<PreflightCategoryId, PreflightItem[]>(
    CATEGORY_ORDER.map((category) => [category, []]),
  );
  const add = (category: PreflightCategoryId, item: PreflightItem) => {
    issues.get(category)!.push(item);
  };
  const expectedProjectIds = Array.from(new Set(
    input.expectedProjectIds ?? input.projects.map((project) => project.id),
  ));
  const expectedHouseIds = Array.from(new Set(input.expectedHouseIds ?? []));
  const targetProjectIds = new Set(expectedProjectIds);
  const presentProjectIds = new Set(input.projects.map((project) => project.id));
  const presentHouseIds = new Set(input.houses.map((house) => house.id));

  expectedProjectIds
    .filter((projectId) => !presentProjectIds.has(projectId))
    .forEach((projectId) => {
      add("areas", makeItem(
        "areas",
        `${projectId}:missing-project`,
        "blocker",
        "Gespeicherte Zieladresse fehlt",
        `Das Projekt ${projectId} gehört zum vorbereiteten Lauf, ist im Adressbuch aber nicht mehr vorhanden.`,
        projectId,
      ));
    });

  expectedHouseIds
    .filter((houseId) => !presentHouseIds.has(houseId))
    .forEach((houseId) => {
      add("images", makeItem(
        "images",
        `${houseId}:missing-house`,
        "blocker",
        "Gespeicherter Haustyp fehlt",
        `Der Haustyp ${houseId} gehört zum vorbereiteten Lauf, ist in der Hausbibliothek aber nicht mehr vorhanden.`,
        houseId,
      ));
    });

  input.projects.forEach((project) => {
    const label = projectLabel(project);
    if (!finitePositive(project.plotArea)) {
      add("areas", makeItem(
        "areas",
        `${project.id}:plot-area`,
        "blocker",
        label,
        `${projectAddress(project)} · Grundstücksfläche fehlt oder ist 0 m².`,
        project.id,
      ));
    }
    if (!finitePositive(project.plotPrice)) {
      add("prices", makeItem(
        "prices",
        `${project.id}:plot-price`,
        "blocker",
        label,
        `${projectAddress(project)} · Grundstückspreis fehlt oder ist 0 €.`,
        project.id,
      ));
    }
    if (!project.houseNumber.trim()) {
      add("house-numbers", makeItem(
        "house-numbers",
        `${project.id}:house-number`,
        "blocker",
        label,
        `${project.street || "Straße unbekannt"}, ${project.zip} ${project.city} · Hausnummer fehlt.`,
        project.id,
      ));
    }
    const missingAddressFields = [
      !project.street.trim() ? "Straße" : "",
      !project.zip.trim() ? "PLZ" : "",
      !project.city.trim() ? "Ort" : "",
    ].filter(Boolean);
    if (missingAddressFields.length) {
      add("house-numbers", makeItem(
        "house-numbers",
        `${project.id}:address-fields`,
        "blocker",
        label,
        `Weitere Adressangaben fehlen: ${missingAddressFields.join(", ")}.`,
        project.id,
      ));
    }
  });

  const readyHouses = [...new Map(
    input.houses
      .filter((house) => (
        houseIsReadyForUpload(house, input.minHouseImages, input.maxHouseImages)
      ))
      .map((house) => [house.id, house] as const),
  ).values()];
  const houseIssueSeverity: PreflightSeverity = input.libraryMode ? "warning" : "blocker";

  input.houses.forEach((house) => {
    if (!finitePositive(house.livingArea)) {
      add("areas", makeItem(
        "areas",
        `${house.id}:living-area`,
        houseIssueSeverity,
        house.name,
        input.libraryMode
          ? "Wohnfläche fehlt; dieser Haustyp wird für den neuen Lauf nicht verwendet."
          : "Wohnfläche fehlt oder ist 0 m².",
        house.id,
      ));
    }
    if (!finitePositive(house.housePrice)) {
      add("prices", makeItem(
        "prices",
        `${house.id}:house-price`,
        houseIssueSeverity,
        house.name,
        input.libraryMode
          ? "Hauspreis fehlt; dieser Haustyp wird für den neuen Lauf nicht verwendet."
          : "Hauspreis fehlt oder ist 0 €.",
        house.id,
      ));
    }
    const invalidImages = house.images.filter((image) => !imageLooksUsable(image));
    if (
      house.images.length < input.minHouseImages
      || house.images.length > input.maxHouseImages
      || invalidImages.length
    ) {
      const reasons = [
        house.images.length < input.minHouseImages
          ? `nur ${house.images.length} statt mindestens ${input.minHouseImages} Bilder`
          : "",
        house.images.length > input.maxHouseImages
          ? `${house.images.length} statt höchstens ${input.maxHouseImages} Bilder`
          : "",
        invalidImages.length
          ? `${invalidImages.length} Bilddatei${invalidImages.length === 1 ? "" : "en"} fehlt oder ist nicht lesbar`
          : "",
      ].filter(Boolean);
      add("images", makeItem(
        "images",
        `${house.id}:images`,
        houseIssueSeverity,
        house.name,
        `${reasons.join(" · ")}${input.libraryMode ? "; dieser Haustyp wird nicht verwendet." : "."}`,
        house.id,
      ));
    }
  });

  const requiredReadyHouseCount = Math.max(0, input.requiredReadyHouseCount ?? 0);
  if (requiredReadyHouseCount && readyHouses.length < requiredReadyHouseCount) {
    add("images", makeItem(
      "images",
      "ready-house-count",
      "blocker",
      "Zu wenige vollständig geeignete Haustypen",
      `Benötigt werden ${requiredReadyHouseCount}; vollständig mit Preis und Bildern sind ${readyHouses.length}.`,
    ));
  }
  if (input.mode === "total-sync" && input.libraryMode) {
    const missingHouseTypes = missingRequiredTotalSyncHouseTypes(readyHouses);
    if (missingHouseTypes.length) {
      add("images", makeItem(
        "images",
        "required-house-type-mix",
        "blocker",
        "Pflichtmischung der vier Haustypen",
        `Pro Adresse werden mindestens ein Einfamilienhaus, ein Bungalow und ein Zweifamilienhaus benötigt. Es fehlt: ${missingHouseTypes.join(", ")}.`,
      ));
    }
  }

  Object.entries(input.replacementExclusionsByProject ?? {}).forEach(
    ([projectId, excludedHouseIds]) => {
      const project = input.projects.find((item) => item.id === projectId);
      if (!project) return;
      const excluded = new Set(excludedHouseIds);
      const replacements = readyHouses.filter((house) => !excluded.has(house.id));
      if (replacements.length >= requiredReadyHouseCount) return;
      add("images", makeItem(
        "images",
        `${projectId}:replacement-houses`,
        "blocker",
        projectLabel(project),
        `Nur ${replacements.length} neue geeignete Haustypen verfügbar; benötigt werden ${requiredReadyHouseCount}.`,
        project.id,
      ));
    },
  );

  const promotionImages = input.promotionImages ?? [];
  const requiredPromotionImages = Math.max(0, input.requiredPromotionImageCount ?? 0);
  const usablePromotionImages = promotionImages.filter(imageLooksUsable);
  if (requiredPromotionImages > usablePromotionImages.length) {
    add("images", makeItem(
      "images",
      "promotion-images",
      "blocker",
      "Aktionsbilder",
      `Gewählt: ${requiredPromotionImages}; vollständig verfügbar: ${usablePromotionImages.length}.`,
    ));
  }

  if (input.checkListings) {
    const housesById = new Map(input.houses.map((house) => [house.id, house]));
    const promotionImagesById = new Map(
      promotionImages.map((image) => [image.id, image]),
    );
    const listingProjectIds = new Set(
      input.listingProjectIds ?? input.projects.map((project) => project.id),
    );
    const listingsWithProjects = input.projects.flatMap((project) => (
      listingProjectIds.has(project.id)
        ? project.listings
            .filter((listing) => (
              input.listingRunId
                ? listing.totalSyncRunId === input.listingRunId
                : true
            ))
            .map((listing) => ({ project, listing }))
        : []
    ));
    const minimumListingCount = Math.max(0, input.minimumListingCount ?? 0);
    input.projects
      .filter((project) => listingProjectIds.has(project.id))
      .forEach((project) => {
        const listingCount = listingsWithProjects.filter(
          (item) => item.project.id === project.id,
        ).length;
        if (listingCount >= minimumListingCount) return;
        add("images", makeItem(
          "images",
          `${project.id}:listing-count`,
          "blocker",
          projectLabel(project),
          `Es ${minimumListingCount === 1 ? "wurde noch kein fertiges Inserat" : `wurden nur ${listingCount} statt ${minimumListingCount} Inserate`} erzeugt.`,
          project.id,
        ));
      });

    listingsWithProjects.forEach(({ project, listing }) => {
      if (!finitePositive(listing.price)) {
        add("prices", makeItem(
          "prices",
          `${project.id}:${listing.id}:listing-price`,
          "blocker",
          `${projectLabel(project)} · ${listing.templateName}`,
          "Der gespeicherte Inseratpreis fehlt oder ist 0 €.",
          project.id,
        ));
      }
      if (!housesById.has(listing.templateId)) {
        add("images", makeItem(
          "images",
          `${project.id}:${listing.id}:missing-house`,
          "blocker",
          `${projectLabel(project)} · ${listing.templateName}`,
          "Der zugehörige Haustyp wurde nicht gefunden.",
          project.id,
        ));
      }
      if (listing.promotionImageId) {
        const promotionImage = promotionImagesById.get(listing.promotionImageId);
        if (!promotionImage || !imageLooksUsable(promotionImage)) {
          add("images", makeItem(
            "images",
            `${project.id}:${listing.id}:promotion-image`,
            "blocker",
            `${projectLabel(project)} · ${listing.templateName}`,
            "Das zugeordnete Aktionsbild fehlt oder ist nicht lesbar.",
            project.id,
          ));
        }
      }
    });
  }

  const credentials = input.credentials;
  if (!credentials.credentialsReady) {
    add("credentials", makeItem(
      "credentials",
      "vault",
      "blocker",
      "Zugangstresor wird noch geladen",
      "Bitte warten, bis die verschlüsselten Zugangsdaten geladen wurden.",
    ));
  }
  if (!credentials.ftpHost.trim()) {
    add("credentials", makeItem(
      "credentials",
      "ftp-host",
      "blocker",
      "FTP-Host fehlt",
    ));
  }
  if (!credentials.ftpUser.trim()) {
    add("credentials", makeItem(
      "credentials",
      "ftp-user",
      "blocker",
      "FTP-Benutzername fehlt",
    ));
  }
  if (!credentials.ftpPassword.trim()) {
    add("credentials", makeItem(
      "credentials",
      "ftp-password",
      "blocker",
      "FTP-Passwort fehlt",
    ));
  }
  if (!credentials.helperOnline) {
    add("credentials", makeItem(
      "credentials",
      "helper",
      "blocker",
      credentials.helperNeedsRestart
        ? "Lokaler Helfer muss neu gestartet werden"
        : "Lokaler Upload-Helfer ist nicht erreichbar",
    ));
  }
  if (!input.provider.providerNumber.trim()) {
    add("credentials", makeItem(
      "credentials",
      "provider-number",
      "blocker",
      "Anbieternummer fehlt",
    ));
  }
  if (!input.provider.company.trim()) {
    add("credentials", makeItem(
      "credentials",
      "provider-company",
      "blocker",
      "Firma fehlt",
    ));
  }
  const email = input.provider.email.trim();
  if (!email) {
    add("credentials", makeItem(
      "credentials",
      "provider-email",
      "blocker",
      "Anbieter-E-Mail fehlt",
    ));
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    add("credentials", makeItem(
      "credentials",
      "provider-email-invalid",
      "blocker",
      "Anbieter-E-Mail ist ungültig",
    ));
  }
  if (input.requireOpenAi) {
    if (!credentials.openAiKeyValid) {
      add("credentials", makeItem(
        "credentials",
        "openai-key",
        "blocker",
        "OpenAI API-Schlüssel fehlt oder hat ein ungültiges Format",
      ));
    } else if (!credentials.openAiKeyVerified) {
      add("credentials", makeItem(
        "credentials",
        "openai-key-unverified",
        "blocker",
        "OpenAI API-Schlüssel wurde noch nicht bestätigt",
        "Bitte Zugangsdaten prüfen und speichern.",
      ));
    }
  }

  findAddressDuplicateGroups(input.allProjects).forEach((duplicateGroup, index) => {
    const group = duplicateGroup.projectIds
      .map((projectId) => input.allProjects.find((project) => project.id === projectId))
      .filter((project): project is ProjectInput => Boolean(project));
    if (group.length < 2) return;
    const touchesTarget = group.some((project) => targetProjectIds.has(project.id));
    add("duplicates", makeItem(
      "duplicates",
      `address:${index}:${group.map((project) => project.id).sort().join(":")}`,
      touchesTarget ? "blocker" : "warning",
      projectAddress(group[0]),
      group.map((project) => projectLabel(project)).join(" · "),
      group.find((project) => targetProjectIds.has(project.id))?.id,
    ));
  });

  const listingsWithProjects = input.allProjects.flatMap((project) => (
    project.listings.map((listing) => ({ project, listing }))
  ));
  duplicateGroups(
    listingsWithProjects,
    ({ listing }) => listingExternalId(listing),
  ).forEach((group, index) => {
    const touchesTarget = group.some(({ project }) => targetProjectIds.has(project.id));
    add("duplicates", makeItem(
      "duplicates",
      `object-id:${index}:${group.map(({ listing }) => listing.id).sort().join(":")}`,
      touchesTarget ? "blocker" : "warning",
      `Objekt-ID ${group[0].listing.externalId}`,
      group.map(({ project }) => projectLabel(project)).join(" · "),
      group.find(({ project }) => targetProjectIds.has(project.id))?.project.id,
    ));
  });

  const categories = CATEGORY_ORDER.map((category) => (
    categoryResult(category, issues.get(category)!)
  ));
  const blockerCount = categories.reduce((sum, category) => sum + category.blockerCount, 0);
  const warningCount = categories.reduce((sum, category) => sum + category.warningCount, 0);
  return {
    mode: input.mode,
    targetCount: expectedProjectIds.length,
    categories,
    blockerCount,
    warningCount,
    canStart: expectedProjectIds.length > 0 && blockerCount === 0,
  };
}
