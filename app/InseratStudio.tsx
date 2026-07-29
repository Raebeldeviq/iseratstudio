"use client";
/* eslint-disable @next/next/no-img-element */

import { ChangeEvent, useEffect, useRef, useState } from "react";
import { readSheet } from "read-excel-file/browser";
import appPackage from "../package.json";
import { AddressBookTable } from "./components/AddressBookTable";
import { PreflightPanel } from "./components/PreflightPanel";
import { SevenDayWorkCenter } from "./components/SevenDayWorkCenter";
import { UploadJobCenter } from "./components/UploadJobCenter";
import ManagementCenter from "./components/ManagementCenter";
import StudioDashboard from "./components/StudioDashboard";
import {
  housePriceCatalogEntries,
  resolveHousePrice,
} from "../house-price-catalog.mjs";
import { applyConfirmedHouseModelDetails } from "../house-template-presets.mjs";
import { fillMissingProjectingDefaults } from "../listing-copy.mjs";
import {
  captionForImageRole,
  IMAGE_ROLE_LABELS,
  IMAGE_ROLE_VALUES,
  inferImageRole,
  isFixedCaptionRole,
  orderHouseImages,
} from "../image-sequence.mjs";
import {
  parseAddressWorkbookRows,
  replaceAddressWorkbookRows,
} from "./lib/address-import";
import { findAddressDuplicateGroups } from "./lib/address-duplicates";
import { APP_VERSION } from "./lib/app-version.mjs";
import {
  headlinesAreTooSimilar,
  removePrivateAddressFromHeadline,
} from "./lib/headline-diversity.js";
import { buildInventoryWorkbook } from "./lib/inventory-export";
import {
  allocateProviderExternalIds,
  isProviderExternalId,
  migrateDraftExternalIds,
} from "./lib/external-ids";
import {
  appendJobAttempt,
  buildUploadRunHistoryEntry,
  interruptedRun,
  jobShouldRun,
  normalizeJobCenterState,
  replaceTotalSyncListingJob,
  runCompletionStatus,
  runJobProgress,
  upsertUploadRunHistory,
} from "./lib/job-center";
import { buildDeletePackage, buildImportPackage } from "./lib/openimmo";
import {
  appendAuditLog,
  currentManagementUser,
  deriveListingLifecycle,
  findListing,
  mapListing,
  normalizeStudioManagementState,
} from "./lib/management";
import { BUSINESS_ROLE_LABELS } from "./lib/organization";
import {
  MAX_PROMOTED_LISTINGS,
  MAX_PROMOTION_IMAGES,
  projectPromotionCount,
  randomPromotionAssignments,
  reconcilePromotionAssignments,
} from "./lib/promotion-images.js";
import {
  buildPreflightReport,
  houseIsReadyForUpload,
} from "./lib/preflight";
import {
  bindSessionToState,
  CLOUD_STORAGE_LABEL,
  CloudWorkspaceConflictError,
  CloudWorkspaceError,
  loadCloudWorkspace,
  mergeCloudAssetReferences,
  saveCloudWorkspace,
  type CloudSession,
} from "./lib/cloud-workspace";
import { runBoundedProductionPipeline } from "./lib/production-pipeline";
import { ADDRESS_OWNERS, normalizeProjectOwners, projectOwner } from "./lib/project-owners";
import { buildRenewalSchedule } from "./lib/renewal-schedule";
import { totalPrice } from "./lib/text-generator";
import {
  createTotalSyncRun,
  projectIsReadyForTotalSync,
  protectedProjectLocationMatches,
  projectsInTotalSyncScope,
  TOTAL_SYNC_LISTINGS_PER_ADDRESS,
  totalSyncCanResume,
  totalSyncProgress,
} from "./lib/total-sync";
import { loadStudioSnapshot, saveStudioState, STORAGE_ID } from "./lib/storage";
import type {
  AddressOwner,
  AiModelId,
  AiTokenUsage,
  GeneratedListing,
  HouseImage,
  HouseTemplate,
  ImageRole,
  ListingTexts,
  ProjectInput,
  ProviderSettings,
  StudioState,
  TotalSyncAttemptMode,
  TotalSyncListingJob,
  TotalSyncProjectTask,
  TotalSyncRun,
  TotalSyncScope,
  ManagementRole,
} from "./types";

type Tab = "overview" | "management" | "houses" | "project" | "preview" | "renewal" | "jobs" | "settings";
type MainSection = "overview" | "objects" | "library" | "work" | "administration";
type AdminView = "organization" | "connections";
type MediaLibraryKind = "house" | "floorplan" | "interior" | "location" | "marketing";

type MediaLibraryItem = {
  id: string;
  relativePath: string;
  filename: string;
  caption: string;
  mimeType: string;
  collection: string;
  family: string;
  houseModel: string;
  group: string;
  kind: MediaLibraryKind;
  role?: ImageRole;
  captionLocked?: boolean;
  brandedCover?: boolean;
  managed?: boolean;
  bytes?: number;
  referenceCount?: number;
  imageUrl: string;
};

function mainSectionForTab(tab: Tab): MainSection {
  if (tab === "overview") return "overview";
  if (tab === "management" || tab === "project" || tab === "preview") return "objects";
  if (tab === "houses") return "library";
  if (tab === "renewal" || tab === "jobs") return "work";
  return "administration";
}

function saveStatus(
  label: string,
  conflictRevision: number | null,
): { tone: "saving" | "saved" | "conflict" | "offline" | "error"; label: string } {
  const normalized = label.toLocaleLowerCase("de-DE");
  if (conflictRevision !== null || normalized.includes("konflikt")) {
    return { tone: "conflict", label: "Speicherkonflikt" };
  }
  if (
    normalized.includes("wird")
    || normalized.includes("werden")
    || normalized.includes("vorbereitet")
  ) {
    return { tone: "saving", label: "Wird gespeichert …" };
  }
  if (
    normalized.includes("fehlgeschlagen")
    || normalized.includes("konnte nicht")
    || normalized.includes("fehler")
  ) {
    return { tone: "error", label: "Speichern nicht möglich" };
  }
  if (normalized.includes("lokal") || normalized.includes("browser")) {
    return { tone: "offline", label: "Nur lokal gespeichert" };
  }
  return { tone: "saved", label: "Alles gespeichert" };
}

type MediaLibraryGroup = { name: string; count: number };
type MediaLibraryDuplicateGroup = {
  id: string;
  group: string;
  kind: MediaLibraryKind;
  bytes: number;
  itemCount: number;
  duplicateCount: number;
  recommendedKeepId: string;
  redundantBytes: number;
  physicallyReclaimableBytes: number;
  items: MediaLibraryItem[];
};

const MIN_HOUSE_IMAGES = 4;
const MAX_HOUSE_IMAGES = 14;
const MAX_HOUSE_TEMPLATES = 25;
const FIXED_HV_PROVIDER_NUMBER = "30435";
const HOUSE_PRICE_ENTRIES = housePriceCatalogEntries();
const MEDIA_KIND_LABELS: Record<MediaLibraryKind, string> = {
  house: "Hausansicht",
  floorplan: "Grundriss",
  interior: "Innenraum",
  location: "Standort",
  marketing: "Anzeige",
};

type UploadFailureOutcome = "failed" | "unknown";

class ListingUploadError extends Error {
  outcome: UploadFailureOutcome;

  constructor(message: string, outcome: UploadFailureOutcome) {
    super(message);
    this.name = "ListingUploadError";
    this.outcome = outcome;
  }
}

type AiUsageError = Error & {
  status?: number;
  aiUsage?: AiTokenUsage;
  stopped?: boolean;
};

function emptyAiUsage(model: AiModelId): AiTokenUsage {
  return {
    model,
    inputTokens: 0,
    outputTokens: 0,
    requestCount: 0,
  };
}

function mergeAiUsage(
  current: AiTokenUsage,
  value: Partial<AiTokenUsage> | undefined,
): AiTokenUsage {
  if (!value) return current;
  const nonNegativeInteger = (candidate: unknown): number => {
    const number = Number(candidate);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
  };
  return {
    model: current.model,
    inputTokens: current.inputTokens + nonNegativeInteger(value.inputTokens),
    outputTokens: current.outputTokens + nonNegativeInteger(value.outputTokens),
    requestCount: current.requestCount + nonNegativeInteger(value.requestCount),
  };
}

function looksLikeOpenAiApiKey(value: string): boolean {
  return /^sk-[a-zA-Z0-9_-]{20,}$/.test(value.trim());
}

const uid = () => crypto.randomUUID();

const newHouse = (index = 1): HouseTemplate => ({
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
  energyClass: "A+",
  heatingType: "Wärmepumpe mit Fußbodenheizung",
  energySource: "Umweltwärme und Strom",
  architecture:
    "Ein klar gegliederter Grundriss verbindet offene Gemeinschaftsbereiche mit gut nutzbaren privaten Rückzugsräumen",
  equipmentHighlights:
    "individuelle Grundrissplanung, moderne Haustechnik, hochwertige Sanitärausstattung und persönliche Bemusterung",
  useStandardPackage: true,
  images: [],
});

const newProject = (owner: AddressOwner): ProjectInput => ({
  id: uid(),
  owner,
  name: `Neues Adressprojekt ${new Date().toLocaleDateString("de-DE")}`,
  street: "",
  houseNumber: "",
  zip: "",
  city: "",
  district: "",
  plotArea: 0,
  plotPrice: 0,
  additionalCosts: 0,
  locationFacts: "",
  transportFacts: "",
  familyFacts: "",
  natureFacts: "",
  notes: "",
  selectedHouseIds: [],
  promotionImageCount: 0,
  promotionAssignments: {},
  listings: [],
  createdAt: new Date().toISOString(),
});

const defaultProvider: ProviderSettings = {
  providerNumber: FIXED_HV_PROVIDER_NUMBER,
  company: "Fabian Raebel - Freie Handelsvertretung der Living Fertighaus GmbH",
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
};

const initialState = (): StudioState => normalizeStudioManagementState({
  version: 1,
  houses: [newHouse(1)],
  projects: [newProject("fabian")],
  provider: defaultProvider,
  promotionImages: [],
  promotionImage: null,
  promotionImageEnabled: false,
  portalPublicationEnabled: false,
  uploadRunHistory: [],
});

function promotionPool(state: StudioState): HouseImage[] {
  if (Array.isArray(state.promotionImages)) return state.promotionImages;
  return state.promotionImage ? [state.promotionImage] : [];
}

function collectedStateExternalIds(state: StudioState): string[] {
  return [
    ...state.projects.flatMap((project) => [
      ...project.listings.map((listing) => listing.externalId),
      ...(project.renewalHistory ?? []).flatMap((cycle) => [
        ...cycle.previousExternalIds,
        ...cycle.externalIds,
      ]),
    ]),
    ...(state.totalSyncRun?.tasks.flatMap((task) => [
      ...(task.listingJobs ?? []).map((job) => job.externalId),
      ...task.uploadedExternalIds,
      ...(task.previousExternalIds ?? []),
    ]) ?? []),
    ...(state.uploadRunHistory ?? []).flatMap((run) => (
      run.listings.map((listing) => listing.externalId)
    )),
  ].filter(Boolean);
}

function effectiveListingImages(
  state: StudioState,
  house: HouseTemplate,
  listing?: GeneratedListing,
): HouseImage[] {
  const promotionImage = listing?.promotionImageId
    ? promotionPool(state).find((image) => image.id === listing.promotionImageId)
    : undefined;
  if (!promotionImage) return house.images;
  return [
    { ...promotionImage, role: "promotion" as const },
    ...house.images.filter((image) => image.id !== promotionImage.id),
  ].slice(0, MAX_HOUSE_IMAGES);
}

function AppVersionBadge() {
  return (
    <div
      className="app-version-badge"
      aria-label={`Geöffnete Inserate-Studio-Version ${APP_VERSION}`}
      title={`Inserate Studio · Version ${APP_VERSION}`}
    >
      v{APP_VERSION}
    </div>
  );
}

function euro(value: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function mediaBytes(value: number): string {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString("de-DE", {
    maximumFractionDigits: 1,
  })} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("de-DE", {
    maximumFractionDigits: 1,
  })} MB`;
}

function projectSelectionLabel(project: ProjectInput): string {
  const street = [project.street, project.houseNumber].filter(Boolean).join(" ");
  const place = [project.zip, project.city].filter(Boolean).join(" ");
  const address = [street, place].filter(Boolean).join(", ");
  return address ? `${project.name} · ${address}` : project.name;
}

function collectedProjectHeadlineHistory(project: ProjectInput): string[] {
  return Array.from(new Set([
    ...(project.headlineHistory ?? []),
    ...project.listings.flatMap((listing) => [
      ...(listing.titleHistory ?? []),
      listing.texts.title,
    ]),
  ].filter(Boolean))).slice(-160);
}

function localImageCaption(filename: string, isFloorplan: boolean, index: number): string {
  const normalized = filename.toLocaleLowerCase("de-DE")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
  if (isFloorplan || /grundriss|floorplan|geschoss/.test(normalized)) return "Durchdacht geplant für ein Zuhause mit Zukunft";
  if (/aussen|fassade|haus|eingang|front/.test(normalized)) return "Ein Zuhause, das schon beim Ankommen begeistert";
  if (/wohn|living|lounge/.test(normalized)) return "Licht und Weite für gemeinsame Lieblingsmomente";
  if (/kueche|kitchen/.test(normalized)) return "Hier beginnt Genuss und gelebte Gemeinsamkeit";
  if (/essen|dining/.test(normalized)) return "Ein Platz für Gespräche, Genuss und Nähe";
  if (/bad|bath|dusche/.test(normalized)) return "Entspannte Momente in persönlicher Wohlfühlatmosphäre";
  if (/schlaf|bedroom/.test(normalized)) return "Ein ruhiger Rückzugsort zum Ankommen und Auftanken";
  if (/kind|kinder/.test(normalized)) return "Freiraum für kleine Ideen und große Zukunftspläne";
  if (/buero|office|arbeit/.test(normalized)) return "Raum für konzentriertes Arbeiten und neue Ideen";
  if (/garten|terrasse|outdoor/.test(normalized)) return "Draußen sein und das eigene Zuhause genießen";
  const fallbacks = [
    "Ein besonderer Eindruck, der Lust auf Zuhause macht",
    "Wohnen mit Atmosphäre und Raum für das eigene Leben",
    "Ein schöner Blick auf das zukünftige Zuhause",
    "Hier bekommen persönliche Wohnideen ihren eigenen Raum",
  ];
  return fallbacks[index % fallbacks.length];
}

function prepareImageForCaptioning(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const maximumDimension = 1024;
        const scale = Math.min(1, maximumDimension / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) return resolve(dataUrl);
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      } catch {
        resolve(dataUrl);
      }
    };
    image.onerror = () => resolve(dataUrl);
    image.src = dataUrl;
  });
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  suffix,
  min,
  disabled = false,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  suffix?: string;
  min?: number;
  disabled?: boolean;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="input-shell">
        <input
          type={type}
          value={value}
          min={min}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        {suffix ? <small>{suffix}</small> : null}
      </div>
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  rows = 4,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
}) {
  return (
    <label className="field field-wide">
      <span>{label}</span>
      <textarea
        value={value}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function blobBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function runWithConcurrency<T>(
  items: T[],
  worker: (item: T) => Promise<void>,
  concurrency = 3,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await worker(item);
    }
  });
  await Promise.all(workers);
}

function catalogWithoutImageData(state: StudioState): StudioState {
  return {
    ...state,
    promotionImages: promotionPool(state).map((image) => ({ ...image, dataUrl: "" })),
    promotionImage: state.promotionImage
      ? { ...state.promotionImage, dataUrl: "" }
      : null,
    houses: state.houses.map((house) => ({
      ...house,
      images: house.images.map((image) => ({ ...image, dataUrl: "" })),
    })),
  };
}

async function saveWindowsCatalogSnapshot(state: StudioState, savedAt: string): Promise<void> {
  const sessionId = uid();
  const allImages = [
    ...state.houses.flatMap((house) => house.images),
    ...promotionPool(state),
  ];
  const imageById = new Map(allImages.map((image) => [image.id, image]));
  const startResponse = await fetch("http://127.0.0.1:43182/catalog-v2/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, savedAt, state: catalogWithoutImageData(state) }),
  });
  const startData = (await startResponse.json()) as {
    ok?: boolean;
    message?: string;
    missingImageIds?: string[];
  };
  if (!startResponse.ok || !startData.ok || !Array.isArray(startData.missingImageIds)) {
    throw new Error(startData.message || "Gerätesicherung konnte nicht vorbereitet werden.");
  }

  await runWithConcurrency(startData.missingImageIds, async (imageId) => {
    const image = imageById.get(imageId);
    if (!image) throw new Error("Ein Bild der Gerätesicherung wurde nicht gefunden.");
    const imageBlob = await fetch(image.dataUrl).then((response) => response.blob());
    const uploadResponse = await fetch(
      `http://127.0.0.1:43182/catalog-v2/image?sessionId=${encodeURIComponent(sessionId)}&imageId=${encodeURIComponent(image.id)}`,
      {
        method: "POST",
        headers: { "Content-Type": image.mimeType || "application/octet-stream" },
        body: imageBlob,
      },
    );
    const uploadData = (await uploadResponse.json()) as { ok?: boolean; message?: string };
    if (!uploadResponse.ok || !uploadData.ok) {
      throw new Error(uploadData.message || `Bild ${image.name} konnte nicht gesichert werden.`);
    }
  });

  const commitResponse = await fetch("http://127.0.0.1:43182/catalog-v2/commit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  const commitData = (await commitResponse.json()) as { ok?: boolean; message?: string };
  if (!commitResponse.ok || !commitData.ok) {
    throw new Error(commitData.message || "Gerätesicherung konnte nicht abgeschlossen werden.");
  }
}

let windowsCatalogSaveQueue: Promise<void> = Promise.resolve();

function queueWindowsCatalogSnapshot(state: StudioState, savedAt: string): Promise<void> {
  const nextSave = windowsCatalogSaveQueue
    .catch(() => undefined)
    .then(() => saveWindowsCatalogSnapshot(state, savedAt));
  windowsCatalogSaveQueue = nextSave;
  return nextSave;
}

async function loadWindowsCatalogSnapshot(): Promise<{
  state: StudioState;
  savedAt: string;
  source: "windows";
} | null> {
  try {
    const manifestResponse = await fetch("http://127.0.0.1:43182/catalog-v2/manifest");
    const manifestData = (await manifestResponse.json()) as {
      ok?: boolean;
      stored?: boolean;
      savedAt?: string;
      state?: StudioState;
    };
    if (manifestResponse.ok && manifestData.ok && manifestData.stored && manifestData.state && manifestData.savedAt) {
      const imageIds = [...new Set([
        ...manifestData.state.houses
          .filter((house) => house.archived !== true)
          .flatMap((house) => house.images.map((image) => image.id)),
        ...promotionPool(manifestData.state).map((image) => image.id),
      ])];
      const dataUrlById = new Map<string, string>();
      await runWithConcurrency(imageIds, async (imageId) => {
        const imageResponse = await fetch(`http://127.0.0.1:43182/catalog-v2/image?imageId=${encodeURIComponent(imageId)}`);
        if (!imageResponse.ok) throw new Error("Ein Bild der Gerätesicherung konnte nicht geladen werden.");
        dataUrlById.set(imageId, await blobDataUrl(await imageResponse.blob()));
      });
      const state: StudioState = {
        ...manifestData.state,
        promotionImages: promotionPool(manifestData.state).map((image) => ({
          ...image,
          dataUrl: dataUrlById.get(image.id) ?? "",
        })),
        promotionImage: manifestData.state.promotionImage
          ? {
              ...manifestData.state.promotionImage,
              dataUrl: dataUrlById.get(manifestData.state.promotionImage.id) ?? "",
            }
          : null,
        houses: manifestData.state.houses.map((house) => ({
          ...house,
          images: house.images.map((image) => ({
            ...image,
            dataUrl: house.archived === true
              ? ""
              : dataUrlById.get(image.id) ?? "",
          })),
        })),
      };
      return { state, savedAt: manifestData.savedAt, source: "windows" };
    }
  } catch {
    // Die bisherige Ein-Datei-Sicherung bleibt als einmaliger Rückfall erhalten.
  }

  const response = await fetch("http://127.0.0.1:43182/catalog");
  const data = (await response.json()) as {
    ok?: boolean;
    stored?: boolean;
    savedAt?: string;
    state?: StudioState;
  };
  if (!response.ok || !data.ok || !data.stored || !data.state || !data.savedAt) return null;
  return { state: data.state, savedAt: data.savedAt, source: "windows" };
}

function snapshotTime(value: string): number {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

export default function InseratStudio() {
  const [tab, setTab] = useState<Tab>("overview");
  const [adminView, setAdminView] = useState<AdminView>("organization");
  const [managementCreateRequest, setManagementCreateRequest] = useState(0);
  const [requestedListingId, setRequestedListingId] = useState("");
  const [requestedAssigneeId, setRequestedAssigneeId] = useState("");
  const [state, setState] = useState<StudioState>(initialState);
  const [cloudSession, setCloudSession] = useState<CloudSession | null>(null);
  const [cloudAccessError, setCloudAccessError] = useState("");
  const [cloudConflictRevision, setCloudConflictRevision] = useState<number | null>(null);
  const cloudRevisionRef = useRef(0);
  const cloudQueueRef = useRef<Promise<void>>(Promise.resolve());
  const latestStateRef = useRef(state);
  latestStateRef.current = state;
  const currentManagementAccount = currentManagementUser(state);
  const currentRole: ManagementRole =
    cloudSession?.role ?? currentManagementAccount?.role ?? "viewer";
  const managementReadOnly = currentRole === "viewer";
  const canAdminister = currentRole === "admin";
  const currentBusinessRole = cloudSession?.businessRole
    ?? currentManagementAccount?.businessRole
    ?? (currentRole === "admin" ? "administrator" : "sales-representative");
  const canUseLibrary = canAdminister || currentBusinessRole === "backoffice";
  const canUseWork = canAdminister || [
    "executive",
    "sales-director",
    "team-lead",
    "backoffice",
  ].includes(currentBusinessRole);
  const canUseBatchObjectTools = canAdminister || [
    "executive",
    "sales-director",
    "team-lead",
    "backoffice",
  ].includes(currentBusinessRole);
  const [ready, setReady] = useState(false);
  const [saveLabel, setSaveLabel] = useState("Lokaler Speicher wird vorbereitet …");
  const [activeHouseId, setActiveHouseId] = useState("");
  const [activeProjectId, setActiveProjectId] = useState("");
  const [activeOwner, setActiveOwner] = useState<AddressOwner>("fabian");
  const [notice, setNotice] = useState<string | null>(null);
  const [ftpHost, setFtpHost] = useState("fabianraebel.livinghaus.info");
  const [ftpUser, setFtpUser] = useState("");
  const [ftpPassword, setFtpPassword] = useState("");
  const [ftpPath, setFtpPath] = useState("/");
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [helperOnline, setHelperOnline] = useState(false);
  const [helperNeedsRestart, setHelperNeedsRestart] = useState(false);
  const [openAiKey, setOpenAiKey] = useState("");
  const [aiModel, setAiModel] = useState<AiModelId>("gpt-5.6-luna");
  const [generatingAi, setGeneratingAi] = useState(false);
  const [credentialsReady, setCredentialsReady] = useState(false);
  const [credentialSaveLabel, setCredentialSaveLabel] = useState("Verschlüsselter Zugangstresor wird vorbereitet …");
  const [savingHouses, setSavingHouses] = useState(false);
  const [savingAddress, setSavingAddress] = useState(false);
  const [savingCredentials, setSavingCredentials] = useState(false);
  const [importingAddresses, setImportingAddresses] = useState(false);
  const [replacingAddresses, setReplacingAddresses] = useState(false);
  const [exportingInventory, setExportingInventory] = useState(false);
  const [addressImportReport, setAddressImportReport] = useState<string[]>([]);
  const [addressCenterOpen, setAddressCenterOpen] = useState(true);
  const [captioningImageIds, setCaptioningImageIds] = useState<string[]>([]);
  const [replacingAllImageCaptions, setReplacingAllImageCaptions] = useState(false);
  const [openAiKeyVerified, setOpenAiKeyVerified] = useState(false);
  const [isPrimaryTab, setIsPrimaryTab] = useState<boolean | null>(null);
  const [promotionPoolOpen, setPromotionPoolOpen] = useState(false);
  const [mediaLibraryOpen, setMediaLibraryOpen] = useState(false);
  const [mediaLibraryItems, setMediaLibraryItems] = useState<MediaLibraryItem[]>([]);
  const [mediaLibraryGroups, setMediaLibraryGroups] = useState<MediaLibraryGroup[]>([]);
  const [mediaLibraryQuery, setMediaLibraryQuery] = useState("");
  const [mediaLibraryGroup, setMediaLibraryGroup] = useState("");
  const [mediaLibraryKind, setMediaLibraryKind] = useState<"" | MediaLibraryKind>("");
  const [mediaLibraryPage, setMediaLibraryPage] = useState(1);
  const [mediaLibraryPages, setMediaLibraryPages] = useState(1);
  const [mediaLibraryTotal, setMediaLibraryTotal] = useState(0);
  const [mediaLibraryAvailable, setMediaLibraryAvailable] = useState(true);
  const [mediaLibraryLoading, setMediaLibraryLoading] = useState(false);
  const [mediaLibraryError, setMediaLibraryError] = useState("");
  const [selectedMediaItems, setSelectedMediaItems] = useState<MediaLibraryItem[]>([]);
  const [importingMedia, setImportingMedia] = useState(false);
  const [addingMediaLibraryItems, setAddingMediaLibraryItems] = useState(false);
  const [deletingMediaItemIds, setDeletingMediaItemIds] = useState<string[]>([]);
  const [mediaLibraryUploadKind, setMediaLibraryUploadKind] = useState<MediaLibraryKind>("house");
  const [mediaLibraryUploadGroup, setMediaLibraryUploadGroup] = useState("");
  const [mediaLibraryMutationStatus, setMediaLibraryMutationStatus] = useState("");
  const [mediaDuplicateGroups, setMediaDuplicateGroups] = useState<MediaLibraryDuplicateGroup[]>([]);
  const [mediaDuplicateKeepIds, setMediaDuplicateKeepIds] = useState<Record<string, string>>({});
  const [scanningMediaDuplicates, setScanningMediaDuplicates] = useState(false);
  const [deletingMediaDuplicates, setDeletingMediaDuplicates] = useState(false);
  const [totalSyncScope, setTotalSyncScope] = useState<TotalSyncScope>("fabian");
  const [totalSyncPromotionCount, setTotalSyncPromotionCount] = useState(0);
  const [totalSyncBusy, setTotalSyncBusy] = useState(false);
  const [totalSyncStopping, setTotalSyncStopping] = useState(false);
  const [totalSyncStatus, setTotalSyncStatus] = useState("");
  const [renewalScope, setRenewalScope] = useState<TotalSyncScope>("all");
  const [renewalPromotionCount, setRenewalPromotionCount] = useState(1);
  const [selectedRenewalProjectIds, setSelectedRenewalProjectIds] = useState<string[]>([]);
  const [renewalNow, setRenewalNow] = useState(() => new Date());
  const totalSyncStopRequested = useRef(false);
  const addressEditorRef = useRef<HTMLDivElement>(null);

  const selectWorkspaceTab = (nextTab: Tab) => {
    if (managementReadOnly && !["overview", "management"].includes(nextTab)) {
      setNotice("In der Nur-Lese-Rolle sind Übersicht und Objektbestand verfügbar.");
      return;
    }
    if (!canAdminister && nextTab === "settings") {
      setNotice("Die Administration ist ausschließlich für Administratoren sichtbar.");
      return;
    }
    if (!canUseLibrary && nextTab === "houses") {
      setNotice("Vorlagen und globale Medien werden ausschließlich durch Backoffice oder Administration verwaltet.");
      return;
    }
    if (!canUseWork && (nextTab === "renewal" || nextTab === "jobs")) {
      setNotice("Auftrags- und Erneuerungszentralen sind für Führung, Backoffice und Administration verfügbar.");
      return;
    }
    if (!canUseBatchObjectTools && (nextTab === "project" || nextTab === "preview")) {
      setNotice("Die Sammelwerkzeuge sind für Führung, Backoffice und Administration vorgesehen.");
      return;
    }
    if (nextTab === "renewal") setRenewalNow(new Date());
    if (nextTab === "management") {
      setState((current) => normalizeStudioManagementState(current));
    }
    setManagementCreateRequest(0);
    setRequestedListingId("");
    setRequestedAssigneeId("");
    setTab(nextTab);
  };

  const openObjectCenter = () => {
    setRequestedListingId("");
    setRequestedAssigneeId("");
    selectWorkspaceTab("management");
  };

  const openObjectCreation = () => {
    if (managementReadOnly) {
      setNotice("In der Nur-Lese-Rolle können keine Objekte angelegt werden.");
      return;
    }
    setState((current) => normalizeStudioManagementState(current));
    setRequestedListingId("");
    setRequestedAssigneeId("");
    setManagementCreateRequest((request) => request + 1);
    setTab("management");
  };

  const openManagementListing = (listingId: string) => {
    setState((current) => normalizeStudioManagementState(current));
    setRequestedListingId(listingId);
    setRequestedAssigneeId("");
    setTab("management");
  };

  const openMemberObjects = (userId: string) => {
    setState((current) => normalizeStudioManagementState(current));
    setRequestedListingId("");
    setRequestedAssigneeId(userId);
    setManagementCreateRequest(0);
    setTab("management");
  };

  const selectActiveHouse = (houseId: string) => {
    setSelectedMediaItems([]);
    setActiveHouseId(houseId);
  };

  useEffect(() => {
    let releaseLock: (() => void) | undefined;
    let cancelled = false;

    if (!navigator.locks) {
      const fallbackTimer = window.setTimeout(() => setIsPrimaryTab(true), 0);
      return () => window.clearTimeout(fallbackTimer);
    }

    const lockLifetime = new Promise<void>((resolve) => { releaseLock = resolve; });
    let acquiredImmediately = false;
    const lockFallbackTimer = window.setTimeout(() => {
      if (!cancelled) setIsPrimaryTab(true);
    }, 3000);
    navigator.locks.request(
      "fabian-pascal-inseratestudio-active-tab",
      { ifAvailable: true, mode: "exclusive" },
      async (lock) => {
        if (cancelled) return;
        window.clearTimeout(lockFallbackTimer);
        if (!lock) {
          setIsPrimaryTab(false);
          return;
        }
        acquiredImmediately = true;
        setIsPrimaryTab(true);
        await lockLifetime;
      },
    ).then(() => {
      if (cancelled || acquiredImmediately) return;
      return navigator.locks.request(
        "fabian-pascal-inseratestudio-active-tab",
        { mode: "exclusive" },
        async () => {
          if (cancelled) return;
          setIsPrimaryTab(true);
          await lockLifetime;
        },
      );
    }).catch(() => {
      window.clearTimeout(lockFallbackTimer);
      if (!cancelled) setIsPrimaryTab(true);
    });

    return () => {
      cancelled = true;
      window.clearTimeout(lockFallbackTimer);
      releaseLock?.();
    };
  }, []);

  useEffect(() => {
    Promise.allSettled([
      loadCloudWorkspace((message) => setSaveLabel(message)),
      loadStudioSnapshot(),
      loadWindowsCatalogSnapshot(),
    ])
      .then((results) => {
        const cloudResult = results[0];
        const cloud = cloudResult.status === "fulfilled" ? cloudResult.value : null;
        if (
          cloudResult.status === "rejected"
          && cloudResult.reason instanceof CloudWorkspaceError
          && (cloudResult.reason.status === 401 || cloudResult.reason.status === 403)
        ) {
          setCloudAccessError(cloudResult.reason.message);
        }
        if (cloud) {
          setCloudSession(cloud.session);
          cloudRevisionRef.current = cloud.snapshot?.revision ?? 0;
        }
        const candidates: Array<{
          state: StudioState;
          savedAt: string;
          source: "browser" | "legacy" | "windows" | "cloud";
        }> = [];
        if (cloud?.snapshot) {
          candidates.push({
            state: cloud.snapshot.state,
            savedAt: cloud.snapshot.savedAt,
            source: "cloud",
          });
        }
        for (const result of [results[1], results[2]]) {
          if (result.status === "fulfilled" && result.value) candidates.push(result.value);
        }
        const cloudCandidate = candidates.find((candidate) => candidate.source === "cloud");
        candidates.sort((left, right) => snapshotTime(right.savedAt) - snapshotTime(left.savedAt));
        const selected = cloudCandidate ?? candidates[0];
        const houseCatalog = cloudCandidate ? undefined : candidates
          .filter((candidate) => Boolean(candidate.state.houseCatalogVersion))
          .sort((left, right) => (
            snapshotTime(right.state.houseCatalogUpdatedAt ?? right.savedAt)
            - snapshotTime(left.state.houseCatalogUpdatedAt ?? left.savedAt)
          ))[0];
        const selectedState = selected?.state ?? initialState();
        const stateWithCurrentHouseCatalog = houseCatalog
          ? {
              ...selectedState,
              houseCatalogVersion: houseCatalog.state.houseCatalogVersion,
              houseCatalogUpdatedAt: houseCatalog.state.houseCatalogUpdatedAt,
              houses: houseCatalog.state.houses,
            }
          : selectedState;
        const normalizedBase = normalizeJobCenterState(
          normalizeProjectOwners(stateWithCurrentHouseCatalog),
        );
        const normalized = {
          ...normalizedBase,
          provider: {
            ...normalizedBase.provider,
            providerNumber: FIXED_HV_PROVIDER_NUMBER,
          },
        };
        const migratedExternalIds = migrateDraftExternalIds(
          normalized.projects,
          normalized.provider.providerNumber,
          collectedStateExternalIds(normalized),
        );
        const normalizedManagement = normalizeStudioManagementState({
          ...normalized,
          projects: migratedExternalIds.projects,
          houses: normalized.houses.map(applyConfirmedHouseModelDetails),
        });
        const loaded = cloud?.session
          ? bindSessionToState(normalizedManagement, cloud.session)
          : normalizedManagement;
        const next = loaded.projects.length
          ? loaded
          : { ...loaded, projects: [newProject("fabian")] };
        setState(next);
        selectActiveHouse(next.houses[0]?.id ?? "");
        setActiveProjectId(next.projects[0]?.id ?? "");
        setActiveOwner(projectOwner(next.projects[0]));
        setTotalSyncScope(
          totalSyncCanResume(next.totalSyncRun) && next.totalSyncRun
            ? next.totalSyncRun.scope
            : projectOwner(next.projects[0]),
        );
        setTotalSyncPromotionCount(
          totalSyncCanResume(next.totalSyncRun) && next.totalSyncRun
            ? next.totalSyncRun.promotionImageCount ?? 0
            : 0,
        );
        if (next.totalSyncRun?.kind === "seven-day") {
          setRenewalScope(next.totalSyncRun.scope);
          setRenewalPromotionCount(next.totalSyncRun.promotionImageCount ?? 0);
          setSelectedRenewalProjectIds(next.totalSyncRun.tasks.map((task) => task.projectId));
        }
        setSaveLabel(
          migratedExternalIds.changedCount
            ? `${migratedExternalIds.changedCount} Entwurfs-Objekt-ID${migratedExternalIds.changedCount === 1 ? "" : "s"} auf ${FIXED_HV_PROVIDER_NUMBER}-… umgestellt`
            : selected?.source === "cloud"
              ? `Cloud-Stand geladen · Version ${cloudRevisionRef.current}`
              : cloud?.session
                ? "Lokaler Bestand wird sicher in die Cloud übernommen"
                : selected?.source === "windows"
                  ? "Aus lokaler Gerätesicherung geladen"
                  : "Doppelt lokal gespeichert",
        );
      })
      .catch(() => setSaveLabel("Arbeitsbereich konnte nicht geladen werden"))
      .finally(() => setReady(true));

    const checkHelper = () => {
      fetch("http://127.0.0.1:43182/health")
        .then(async (response) => {
          const data = response.ok
            ? await response.json().catch(() => ({})) as { service?: string; version?: string }
            : {};
          const correctService = data.service === "fabian-pascal-helper";
          const correctVersion = data.version === appPackage.version;
          setHelperOnline(response.ok && correctService && correctVersion);
          setHelperNeedsRestart(response.ok && correctService && !correctVersion);
        })
        .catch(() => {
          setHelperOnline(false);
          setHelperNeedsRestart(false);
        });
    };
    checkHelper();
    const healthTimer = window.setInterval(checkHelper, 5000);
    return () => window.clearInterval(healthTimer);
  }, []);

  useEffect(() => {
    if (!helperOnline || credentialsReady) return;
    let cancelled = false;
    fetch("http://127.0.0.1:43182/credentials")
      .then(async (response) => {
        const data = (await response.json()) as {
          ok?: boolean;
          stored?: boolean;
          message?: string;
          credentials?: {
            openAiKey?: string;
            aiModel?: AiModelId;
            ftpHost?: string;
            ftpUser?: string;
            ftpPassword?: string;
            ftpPath?: string;
          };
        };
        if (!response.ok || !data.ok) throw new Error(data.message || "Zugangstresor konnte nicht geöffnet werden.");
        if (cancelled) return;
        if (data.stored && data.credentials) {
          const storedOpenAiKey = data.credentials.openAiKey ?? "";
          setOpenAiKey(storedOpenAiKey);
          setOpenAiKeyVerified(looksLikeOpenAiApiKey(storedOpenAiKey));
          const storedModel = data.credentials.aiModel;
          setAiModel(
            storedModel === "gpt-5.6-terra" || storedModel === "gpt-5.6-sol"
              ? storedModel
              : "gpt-5.6-luna",
          );
          setFtpHost(data.credentials.ftpHost || "fabianraebel.livinghaus.info");
          setFtpUser(data.credentials.ftpUser ?? "");
          setFtpPassword(data.credentials.ftpPassword ?? "");
          setFtpPath(data.credentials.ftpPath || "/");
          setCredentialSaveLabel("Zugangsdaten wurden verschlüsselt geladen");
        } else {
          setCredentialSaveLabel("Neue Zugangsdaten werden automatisch verschlüsselt gespeichert");
        }
        setCredentialsReady(true);
      })
      .catch(() => {
        if (!cancelled) setCredentialSaveLabel("Verschlüsselter Zugangstresor ist derzeit nicht verfügbar");
      });
    return () => { cancelled = true; };
  }, [credentialsReady, helperOnline]);

  useEffect(() => {
    if (!credentialsReady || !helperOnline || isPrimaryTab !== true) return;
    const keyNeedsAttention = Boolean(openAiKey.trim())
      && (!looksLikeOpenAiApiKey(openAiKey) || !openAiKeyVerified);
    const timer = window.setTimeout(() => {
      if (keyNeedsAttention) {
        setCredentialSaveLabel(looksLikeOpenAiApiKey(openAiKey)
          ? "Neuen OpenAI-Schlüssel bitte prüfen und speichern"
          : "Gespeicherter Wert ist kein OpenAI API-Schlüssel");
        return;
      }
      fetch("http://127.0.0.1:43182/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credentials: {
            openAiKey,
            aiModel,
            ftpHost,
            ftpUser,
            ftpPassword,
            ftpPath,
          },
        }),
      })
        .then(async (response) => {
          const data = (await response.json()) as { ok?: boolean; message?: string };
          if (!response.ok || !data.ok) throw new Error(data.message || "Speichern fehlgeschlagen.");
          setCredentialSaveLabel("Zugangsdaten sind verschlüsselt gespeichert");
        })
        .catch(() => setCredentialSaveLabel("Zugangsdaten konnten nicht gespeichert werden"));
    }, keyNeedsAttention ? 0 : 700);
    return () => window.clearTimeout(timer);
  }, [aiModel, credentialsReady, ftpHost, ftpPassword, ftpPath, ftpUser, helperOnline, isPrimaryTab, openAiKey, openAiKeyVerified]);

  useEffect(() => {
    if (!ready || isPrimaryTab !== true) return;
    const timer = window.setTimeout(() => {
      const savedAt = new Date().toISOString();
      const saves: Promise<unknown>[] = [saveStudioState(state, savedAt)];
      if (helperOnline) {
        saves.push(queueWindowsCatalogSnapshot(state, savedAt));
      }
      Promise.all(saves)
        .then(() => {
          if (!cloudSession) {
            setSaveLabel(helperOnline ? "Browser + Gerätesicherung aktuell" : "Lokal im Browser gespeichert");
          }
        })
        .catch(() => setSaveLabel("Speichern fehlgeschlagen"));

      if (cloudSession && cloudSession.role !== "viewer" && cloudConflictRevision === null) {
        cloudQueueRef.current = cloudQueueRef.current
          .catch(() => undefined)
          .then(async () => {
            if (latestStateRef.current !== state || cloudConflictRevision !== null) return;
            setSaveLabel("Änderungen werden zentral gespeichert …");
            const snapshot = await saveCloudWorkspace(state, cloudRevisionRef.current, {
              onProgress: setSaveLabel,
            });
            cloudRevisionRef.current = snapshot.revision;
            if (latestStateRef.current === state) {
              const merged = mergeCloudAssetReferences(state, snapshot.state);
              if (merged !== state) setState(merged);
            }
            setSaveLabel(`Cloud aktuell · Version ${snapshot.revision}`);
          })
          .catch((error) => {
            if (error instanceof CloudWorkspaceConflictError) {
              setCloudConflictRevision(error.latestRevision);
              setSaveLabel("Speicherkonflikt erkannt");
              return;
            }
            const message = error instanceof CloudWorkspaceError
              ? error.message
              : "Cloud-Speicherung fehlgeschlagen";
            setSaveLabel(message);
          });
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [cloudConflictRevision, cloudSession, helperOnline, isPrimaryTab, ready, state]);

  const loadCurrentCloudVersion = async () => {
    try {
      setSaveLabel("Neueste Cloud-Version wird geladen …");
      const cloud = await loadCloudWorkspace(setSaveLabel);
      if (!cloud.snapshot) return;
      const normalized = normalizeStudioManagementState(cloud.snapshot.state);
      const next = bindSessionToState(normalized, cloud.session);
      cloudRevisionRef.current = cloud.snapshot.revision;
      setCloudSession(cloud.session);
      setCloudConflictRevision(null);
      setState(next);
      selectActiveHouse(next.houses.find((house) => !house.archived)?.id ?? "");
      setActiveProjectId(next.projects[0]?.id ?? "");
      setSaveLabel(`Cloud-Stand geladen · Version ${cloud.snapshot.revision}`);
    } catch (error) {
      setSaveLabel(error instanceof Error ? error.message : "Cloud-Version konnte nicht geladen werden");
    }
  };

  const overwriteCloudVersion = async () => {
    try {
      setSaveLabel("Eigene Version wird zentral gesichert …");
      const snapshot = await saveCloudWorkspace(
        state,
        cloudConflictRevision ?? cloudRevisionRef.current,
        { force: true, onProgress: setSaveLabel },
      );
      cloudRevisionRef.current = snapshot.revision;
      setCloudConflictRevision(null);
      const merged = mergeCloudAssetReferences(state, snapshot.state);
      if (merged !== state) setState(merged);
      setSaveLabel(`Cloud aktuell · Version ${snapshot.revision}`);
    } catch (error) {
      setSaveLabel(error instanceof Error ? error.message : "Cloud-Version konnte nicht gespeichert werden");
    }
  };

  useEffect(() => {
    if (tab !== "renewal") return;
    const timer = window.setInterval(() => setRenewalNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, [tab]);

  const activeHouses = state.houses.filter((house) => house.archived !== true);
  const activeHouse =
    activeHouses.find((house) => house.id === activeHouseId) ?? activeHouses[0];
  const mediaLibraryBusy = (
    mediaLibraryLoading
    || importingMedia
    || addingMediaLibraryItems
    || scanningMediaDuplicates
    || deletingMediaDuplicates
    || deletingMediaItemIds.length > 0
  );
  const mediaDuplicateDeleteItems = mediaDuplicateGroups.flatMap((group) => {
    const keepId = mediaDuplicateKeepIds[group.id] || group.recommendedKeepId;
    return group.items.filter((item) => item.id !== keepId);
  });
  const mediaDuplicateDeleteIds = mediaDuplicateDeleteItems.map((item) => item.id);
  const mediaDuplicateReferencedCount = mediaDuplicateDeleteItems.reduce(
    (sum, item) => sum + (item.referenceCount || 0),
    0,
  );
  const mediaDuplicateManagedCount = mediaDuplicateDeleteItems.filter(
    (item) => item.managed,
  ).length;
  const mediaDuplicateManagedBytes = mediaDuplicateDeleteItems.reduce(
    (sum, item) => sum + (item.managed ? item.bytes || 0 : 0),
    0,
  );
  const activeHousePriceMatch = resolveHousePrice([
    activeHouse.name,
    ...activeHouse.images.map((image) => image.name),
  ]);
  const ownerProjects = state.projects.filter(
    (project) => projectOwner(project) === activeOwner,
  );
  const activeProject =
    ownerProjects.find((project) => project.id === activeProjectId) ??
    ownerProjects[0];

  const activeHouseIds = new Set(activeHouses.map((house) => house.id));
  const activeSelectedHouseIds = activeProject?.selectedHouseIds.filter(
    (houseId) => activeHouseIds.has(houseId),
  ) ?? [];
  const selectedHouses = activeHouses.filter((house) =>
    activeSelectedHouseIds.includes(house.id),
  );
  const activePromotionCount = projectPromotionCount(activeProject);
  const resumableTotalSync = totalSyncCanResume(state.totalSyncRun);
  const activeRunKind = state.totalSyncRun?.kind ?? "total-sync";
  const activeRunIsSevenDay = activeRunKind === "seven-day";
  const totalSyncEffectiveScope = resumableTotalSync && state.totalSyncRun
    ? state.totalSyncRun.scope
    : totalSyncScope;
  const totalSyncEffectivePromotionCount = resumableTotalSync && state.totalSyncRun
    ? state.totalSyncRun.promotionImageCount ?? 0
    : totalSyncPromotionCount;
  const portalPublicationEnabled = state.portalPublicationEnabled === true;
  const totalSyncEffectivePortalPublication = resumableTotalSync && state.totalSyncRun
    ? state.totalSyncRun.portalPublicationEnabled === true
    : portalPublicationEnabled;
  const totalSyncScopedProjects = projectsInTotalSyncScope(state.projects, totalSyncEffectiveScope);
  const configuredTotalSyncReadyProjects = totalSyncScopedProjects.filter(projectIsReadyForTotalSync);
  const totalSyncReadyProjects = resumableTotalSync && state.totalSyncRun
    ? state.projects.filter((project) => (
        state.totalSyncRun!.tasks.some((task) => task.projectId === project.id)
      ))
    : configuredTotalSyncReadyProjects;
  const totalSyncSkippedProjects = resumableTotalSync && state.totalSyncRun
    ? state.totalSyncRun.skippedProjectCount
    : totalSyncScopedProjects.length - configuredTotalSyncReadyProjects.length;
  const totalSyncEligibleHouses = activeHouses.filter((house) => (
    houseIsReadyForUpload(house, MIN_HOUSE_IMAGES, MAX_HOUSE_IMAGES)
  ));
  const totalSyncRunProgress = totalSyncProgress(state.totalSyncRun);
  const renewalScopedProjects = projectsInTotalSyncScope(state.projects, renewalScope);
  const renewalReadyProjects = renewalScopedProjects.filter(projectIsReadyForTotalSync);
  const renewalEntries = buildRenewalSchedule(
    renewalReadyProjects,
    renewalNow,
    renewalScope,
  );
  const activeMainSection = mainSectionForTab(tab);
  const visibleSaveStatus = saveStatus(saveLabel, cloudConflictRevision);
  const openJobCount = state.totalSyncRun?.tasks.reduce((count, task) => (
    count + (task.listingJobs ?? []).filter((job) => job.status !== "uploaded").length
  ), 0) ?? 0;
  const renewalIncompleteProjectCount = renewalScopedProjects.length - renewalReadyProjects.length;
  const renewalEffectivePromotionCount = resumableTotalSync
    && activeRunIsSevenDay
    && state.totalSyncRun
    ? state.totalSyncRun.promotionImageCount ?? 0
    : Math.min(renewalPromotionCount, promotionPool(state).length, TOTAL_SYNC_LISTINGS_PER_ADDRESS);
  const renewalPreviousExternalIds = Object.fromEntries(
    (activeRunIsSevenDay ? state.totalSyncRun?.tasks ?? [] : []).map((task) => [
      task.projectId,
      task.previousExternalIds ?? [],
    ]),
  );
  const addressEditingLocked = totalSyncBusy || resumableTotalSync;
  const addressDuplicateGroups = findAddressDuplicateGroups(state.projects);
  const addressDuplicateMutationLocked = (
    addressEditingLocked
    || uploading
    || generatingAi
    || importingAddresses
    || replacingAddresses
    || savingAddress
  );
  const preflightCredentials = {
    credentialsReady,
    ftpHost,
    ftpUser,
    ftpPassword,
    helperOnline,
    helperNeedsRestart,
    openAiKeyValid: looksLikeOpenAiApiKey(openAiKey),
    openAiKeyVerified,
  };
  const promotionImages = promotionPool(state);
  const housesById = new Map(state.houses.map((house) => [house.id, house]));
  const housesForIds = (houseIds: Iterable<string>): HouseTemplate[] => {
    const ids = new Set(houseIds);
    return [...ids]
      .map((houseId) => housesById.get(houseId))
      .filter((house): house is HouseTemplate => Boolean(house));
  };
  const manualPreflightHouses = housesForIds(
    activeProject?.listings.map((listing) => listing.templateId) ?? [],
  );
  const manualPreflightReport = buildPreflightReport({
    mode: "manual-upload",
    projects: activeProject ? [activeProject] : [],
    allProjects: state.projects,
    houses: manualPreflightHouses,
    provider: state.provider,
    credentials: preflightCredentials,
    requireOpenAi: false,
    minHouseImages: MIN_HOUSE_IMAGES,
    maxHouseImages: MAX_HOUSE_IMAGES,
    promotionImages,
    checkListings: true,
    minimumListingCount: 1,
  });
  const preparedRunTasks = state.totalSyncRun?.tasks ?? [];
  const preparedRunProjectIds = preparedRunTasks.map((task) => task.projectId);
  const preparedPendingTasks = preparedRunTasks.filter(
    (task) => (task.listingJobs?.length
      ? task.listingJobs.some((job) => job.status !== "uploaded")
      : task.uploadedExternalIds.length < task.houseIds.length),
  );
  const preparedPendingProjectIds = preparedPendingTasks.map((task) => task.projectId);
  const preparedRunHouseIds = preparedPendingTasks.flatMap((task) => task.houseIds);
  const totalSyncPreflightProjects = resumableTotalSync
    ? state.projects.filter((project) => preparedRunProjectIds.includes(project.id))
    : totalSyncScopedProjects;
  const totalSyncPreflightHouses = resumableTotalSync
    ? housesForIds(preparedRunHouseIds)
    : activeHouses;
  const totalSyncPreflightReport = buildPreflightReport({
    mode: resumableTotalSync && activeRunIsSevenDay ? "seven-day" : "total-sync",
    projects: totalSyncPreflightProjects,
    allProjects: state.projects,
    houses: totalSyncPreflightHouses,
    provider: state.provider,
    credentials: preflightCredentials,
    requireOpenAi: true,
    minHouseImages: MIN_HOUSE_IMAGES,
    maxHouseImages: MAX_HOUSE_IMAGES,
    libraryMode: !resumableTotalSync,
    requiredReadyHouseCount: resumableTotalSync ? 0 : TOTAL_SYNC_LISTINGS_PER_ADDRESS,
    requiredPromotionImageCount: resumableTotalSync
      ? preparedPendingTasks.length ? totalSyncEffectivePromotionCount : 0
      : totalSyncEffectivePromotionCount,
    promotionImages,
    checkListings: resumableTotalSync,
    listingRunId: resumableTotalSync ? state.totalSyncRun?.id : undefined,
    listingProjectIds: resumableTotalSync ? preparedPendingProjectIds : undefined,
    expectedProjectIds: resumableTotalSync ? preparedRunProjectIds : undefined,
    expectedHouseIds: resumableTotalSync ? preparedRunHouseIds : undefined,
  });
  const renewalTargetProjectIds = resumableTotalSync && activeRunIsSevenDay
    ? preparedRunProjectIds
    : selectedRenewalProjectIds;
  const renewalTargetProjects = state.projects.filter(
    (project) => renewalTargetProjectIds.includes(project.id),
  );
  const buildSevenDayPreflight = (
    projects: ProjectInput[],
    preparedRun = false,
  ) => buildPreflightReport({
    mode: "seven-day",
    projects,
    allProjects: state.projects,
    houses: preparedRun ? housesForIds(preparedRunHouseIds) : activeHouses,
    provider: state.provider,
    credentials: preflightCredentials,
    requireOpenAi: true,
    minHouseImages: MIN_HOUSE_IMAGES,
    maxHouseImages: MAX_HOUSE_IMAGES,
    libraryMode: !preparedRun,
    requiredReadyHouseCount: preparedRun ? 0 : TOTAL_SYNC_LISTINGS_PER_ADDRESS,
    requiredPromotionImageCount: preparedRun
      ? preparedPendingTasks.length ? renewalEffectivePromotionCount : 0
      : renewalEffectivePromotionCount,
    promotionImages,
    checkListings: preparedRun,
    listingRunId: preparedRun ? state.totalSyncRun?.id : undefined,
    listingProjectIds: preparedRun ? preparedPendingProjectIds : undefined,
    expectedProjectIds: preparedRun ? preparedRunProjectIds : undefined,
    expectedHouseIds: preparedRun ? preparedRunHouseIds : undefined,
    replacementExclusionsByProject: preparedRun
      ? undefined
      : Object.fromEntries(projects.map((project) => [
          project.id,
          Array.from(new Set([
            ...project.selectedHouseIds,
            ...project.listings.map((listing) => listing.templateId),
          ])),
        ])),
  });
  const renewalPreflightReport = buildSevenDayPreflight(
    renewalTargetProjects,
    resumableTotalSync && activeRunIsSevenDay,
  );

  const saveHousesNow = async () => {
    const savedAt = new Date().toISOString();
    const imageCount = activeHouses.reduce((sum, house) => sum + house.images.length, 0)
      + promotionPool(state).length;
    setSavingHouses(true);
    try {
      await saveStudioState(state, savedAt);
      if (helperOnline) {
        await queueWindowsCatalogSnapshot(state, savedAt);
        setSaveLabel("Browser + Gerätesicherung aktuell");
        setNotice(`${activeHouses.length} Haustypen mit ${imageCount} Bildern wurden sicher gespeichert.`);
      } else {
        setSaveLabel("Lokal im Browser gespeichert");
        setNotice(`${activeHouses.length} Haustypen mit ${imageCount} Bildern wurden im Browser gespeichert. Die Gerätesicherung wird ergänzt, sobald der lokale Helfer erreichbar ist.`);
      }
    } catch (error) {
      setSaveLabel("Speichern fehlgeschlagen");
      setNotice(error instanceof Error ? error.message : "Haustypen und Bilder konnten nicht gespeichert werden.");
    } finally {
      setSavingHouses(false);
    }
  };

  const saveAddressNow = async () => {
    if (!activeProject) return;
    const savedAt = new Date().toISOString();
    setSavingAddress(true);
    try {
      await saveStudioState(state, savedAt);
      if (helperOnline) {
        await queueWindowsCatalogSnapshot(state, savedAt);
        setSaveLabel("Browser + Gerätesicherung aktuell");
      } else {
        setSaveLabel("Lokal im Browser gespeichert");
      }
      const ownerLabel = activeOwner === "pascal" ? "Pascal" : "Fabian";
      setNotice(`Die Grundstücksadresse „${activeProject.name}“ wurde für ${ownerLabel} gespeichert und kann wieder ausgewählt werden.`);
    } catch (error) {
      setSaveLabel("Speichern fehlgeschlagen");
      setNotice(error instanceof Error ? error.message : "Die Grundstücksadresse konnte nicht gespeichert werden.");
    } finally {
      setSavingAddress(false);
    }
  };

  const updateHouse = (patch: Partial<HouseTemplate>) => {
    if (!activeHouse) return;
    setState((current) => ({
      ...current,
      houses: current.houses.map((house) =>
        house.id === activeHouse.id ? { ...house, ...patch } : house,
      ),
    }));
  };

  const updateProject = (patch: Partial<ProjectInput>) => {
    if (!activeProject) return;
    setState((current) => ({
      ...current,
      projects: current.projects.map((project) =>
        project.id === activeProject.id ? { ...project, ...patch } : project,
      ),
    }));
  };

  const addHouse = () => {
    if (activeHouses.length >= MAX_HOUSE_TEMPLATES) {
      setNotice(`Es sind bereits ${MAX_HOUSE_TEMPLATES} Haustypen angelegt.`);
      return;
    }
    const house = newHouse(activeHouses.length + 1);
    setState((current) => ({ ...current, houses: [...current.houses, house] }));
    selectActiveHouse(house.id);
  };

  const removeHouse = () => {
    if (!activeHouse || activeHouses.length === 1) return;
    if (!window.confirm(`Haustyp „${activeHouse.name}“ wirklich lokal löschen?`)) return;
    const houses = state.houses.filter((house) => house.id !== activeHouse.id);
    setState((current) => ({
      ...current,
      houses,
      projects: current.projects.map((project) => ({
        ...project,
        selectedHouseIds: project.selectedHouseIds.filter(
          (id) => id !== activeHouse.id,
        ),
        promotionAssignments: Object.fromEntries(
          Object.entries(project.promotionAssignments ?? {}).filter(
            ([houseId]) => houseId !== activeHouse.id,
          ),
        ),
        listings: project.listings.filter(
          (listing) => listing.templateId !== activeHouse.id,
        ),
      })),
    }));
    selectActiveHouse(houses.find((house) => house.archived !== true)?.id ?? "");
  };

  const replaceHouseImageCaptions = (houseId: string, captionById: Map<string, string>) => {
    setState((current) => ({
      ...current,
      houses: current.houses.map((house) => house.id === houseId ? {
        ...house,
        images: house.images.map((image) => captionById.has(image.id)
          && !image.captionLocked
          ? { ...image, caption: captionById.get(image.id) ?? image.caption }
          : image),
      } : house),
    }));
  };

  const createAutomaticImageCaptions = async (
    house: HouseTemplate,
    images: HouseImage[],
    announce = true,
  ): Promise<"ai" | "local"> => {
    const editableImages = images.filter((image) => !image.captionLocked);
    if (!editableImages.length) {
      if (announce && images.length) {
        setNotice(`${images.length} feste Bildüberschrift${images.length === 1 ? "" : "en"} aus der hinterlegten Bildfolge wurde${images.length === 1 ? "" : "n"} übernommen.`);
      }
      return "local";
    }
    const imageIds = editableImages.map((image) => image.id);
    replaceHouseImageCaptions(
      house.id,
      new Map(editableImages.map((image, index) => [
        image.id,
        localImageCaption(image.name, image.isFloorplan, index),
      ])),
    );

    if (!helperOnline || !looksLikeOpenAiApiKey(openAiKey)) {
      if (announce) setNotice(looksLikeOpenAiApiKey(openAiKey)
        ? `${editableImages.length} variable Bildtexte wurden automatisch lokal erstellt und können bearbeitet werden.`
        : `${editableImages.length} variable Bildtexte wurden lokal erstellt. Für die KI-Bildanalyse bitte einen gültigen OpenAI-Schlüssel einfügen.`);
      return "local";
    }

    setCaptioningImageIds((current) => [...new Set([...current, ...imageIds])]);
    try {
      const preparedImages = await Promise.all(editableImages.map(async (image) => ({
        id: image.id,
        name: image.name,
        isFloorplan: image.isFloorplan,
        dataUrl: await prepareImageForCaptioning(image.dataUrl),
      })));
      const response = await fetch("http://127.0.0.1:43182/generate-image-captions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: openAiKey.trim(),
          model: aiModel,
          house: { name: house.name, houseType: house.houseType },
          images: preparedImages,
        }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        message?: string;
        captions?: Array<{ id: string; caption: string }>;
      };
      if (!response.ok || !data.ok || !Array.isArray(data.captions)) {
        throw new Error(data.message || "Die automatischen Bildtexte konnten nicht erstellt werden.");
      }
      const captionById = new Map(data.captions.map((item) => [item.id, item.caption]));
      replaceHouseImageCaptions(house.id, captionById);
      if (announce) setNotice(`${editableImages.length} kurze, passende Bildtexte wurden automatisch erstellt.`);
      return "ai";
    } catch (error) {
      if (announce) setNotice(`${editableImages.length} lokale Bildtexte wurden erstellt. ${error instanceof Error ? error.message : "Die KI-Verfeinerung war nicht verfügbar."}`);
      return "local";
    } finally {
      setCaptioningImageIds((current) => current.filter((id) => !imageIds.includes(id)));
    }
  };

  const replaceAllExistingImageCaptions = async () => {
    if (!looksLikeOpenAiApiKey(openAiKey)) {
      setTab("settings");
      setNotice("Bitte zuerst einen gültigen OpenAI API-Schlüssel einfügen und über „Zugangsdaten prüfen & speichern“ bestätigen.");
      return;
    }
    const housesWithImages = activeHouses
      .map((house) => ({ ...house, images: house.images.filter((image) => !image.captionLocked) }))
      .filter((house) => house.images.length > 0);
    const totalImages = housesWithImages.reduce((sum, house) => sum + house.images.length, 0);
    if (!totalImages) {
      setNotice("Es sind noch keine vorhandenen Bilder gespeichert.");
      return;
    }

    setReplacingAllImageCaptions(true);
    let aiImageCount = 0;
    try {
      for (const house of housesWithImages) {
        setNotice(`Vorhandene Bildtexte für „${house.name}“ werden erneuert …`);
        const result = await createAutomaticImageCaptions(house, house.images, false);
        if (result === "ai") aiImageCount += house.images.length;
      }
      if (aiImageCount === totalImages) {
        setNotice(`Alle ${totalImages} vorhandenen Bildtexte wurden passend zu den Motiven neu erstellt.`);
      } else if (aiImageCount > 0) {
        setNotice(`${aiImageCount} Bildtexte wurden mit KI und ${totalImages - aiImageCount} automatisch lokal erneuert.`);
      } else {
        setNotice(`Alle ${totalImages} vorhandenen Bildtexte wurden automatisch lokal ersetzt.`);
      }
    } finally {
      setReplacingAllImageCaptions(false);
    }
  };

  const loadMediaLibrary = async (targetPage = 1) => {
    setMediaLibraryLoading(true);
    setMediaLibraryError("");
    try {
      const parameters = new URLSearchParams({
        page: String(targetPage),
        pageSize: "36",
      });
      if (mediaLibraryQuery.trim()) parameters.set("query", mediaLibraryQuery.trim());
      if (mediaLibraryGroup) parameters.set("group", mediaLibraryGroup);
      if (mediaLibraryKind) parameters.set("kind", mediaLibraryKind);
      const response = await fetch(
        `http://127.0.0.1:43182/media-library?${parameters.toString()}`,
      );
      const data = (await response.json()) as {
        ok?: boolean;
        available?: boolean;
        message?: string;
        total?: number;
        page?: number;
        pages?: number;
        groups?: MediaLibraryGroup[];
        items?: MediaLibraryItem[];
      };
      if (!response.ok || !data.ok) {
        throw new Error(data.message || "Die Medienbibliothek konnte nicht geladen werden.");
      }
      setMediaLibraryAvailable(data.available !== false);
      setMediaLibraryItems(Array.isArray(data.items) ? data.items : []);
      setMediaLibraryGroups(Array.isArray(data.groups) ? data.groups : []);
      setMediaLibraryTotal(Number(data.total) || 0);
      setMediaLibraryPage(Number(data.page) || 1);
      setMediaLibraryPages(Number(data.pages) || 1);
    } catch (error) {
      setMediaLibraryItems([]);
      setMediaLibraryError(
        error instanceof Error
          ? error.message
          : "Die Medienbibliothek konnte nicht geladen werden.",
      );
    } finally {
      setMediaLibraryLoading(false);
    }
  };

  const toggleMediaLibrary = async () => {
    if (mediaLibraryOpen) {
      setMediaLibraryOpen(false);
      setMediaDuplicateGroups([]);
      setMediaDuplicateKeepIds({});
      return;
    }
    if (!helperOnline) {
      setNotice("Die iCloud-Medienbibliothek ist verfügbar, sobald der lokale Helfer läuft.");
      return;
    }
    setMediaLibraryOpen(true);
    await loadMediaLibrary(1);
  };

  const scanMediaLibraryDuplicates = async () => {
    setScanningMediaDuplicates(true);
    setMediaLibraryMutationStatus(
      "Die Medienbibliothek wird bytegenau auf Dubletten geprüft …",
    );
    try {
      const response = await fetch("http://127.0.0.1:43182/media-library/duplicates");
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        groupCount?: number;
        duplicateCount?: number;
        groups?: MediaLibraryDuplicateGroup[];
      };
      if (!response.ok || !data.ok) {
        throw new Error(data.message || "Die Dublettenprüfung konnte nicht abgeschlossen werden.");
      }
      const groups = Array.isArray(data.groups) ? data.groups : [];
      setMediaDuplicateGroups(groups);
      setMediaDuplicateKeepIds(Object.fromEntries(
        groups.map((group) => [group.id, group.recommendedKeepId]),
      ));
      const status = groups.length
        ? `${Number(data.duplicateCount) || 0} Dubletten in ${groups.length} Gruppen gefunden. Pro Gruppe bleibt das markierte Original erhalten.`
        : "Keine bytegenau identischen Dubletten innerhalb derselben Bildart und Gruppe gefunden.";
      setMediaLibraryMutationStatus(status);
      setNotice(status);
    } catch (error) {
      setMediaDuplicateGroups([]);
      setMediaDuplicateKeepIds({});
      const status = error instanceof Error
        ? error.message
        : "Die Dublettenprüfung konnte nicht abgeschlossen werden.";
      setMediaLibraryMutationStatus(status);
      setNotice(status);
    } finally {
      setScanningMediaDuplicates(false);
    }
  };

  const toggleMediaSelection = (item: MediaLibraryItem) => {
    if (!activeHouse) return;
    if (selectedMediaItems.some((selected) => selected.id === item.id)) {
      setSelectedMediaItems((current) => current.filter((selected) => selected.id !== item.id));
      return;
    }
    if (item.kind !== "house" && activeHouse.images.some((image) => image.sourceId === item.id)) {
      setNotice("Dieses Bild ist dem Haustyp bereits zugeordnet.");
      return;
    }
    const remaining = MAX_HOUSE_IMAGES - activeHouse.images.length;
    if (item.kind !== "house" && selectedMediaItems.length >= remaining) {
      setNotice(`Für diesen Haustyp können noch ${Math.max(0, remaining)} Bilder übernommen werden.`);
      return;
    }
    setSelectedMediaItems((current) => [...current, item]);
  };

  const downloadMediaItems = async (items: MediaLibraryItem[]) => {
    const results = await Promise.allSettled(items.map(async (item): Promise<HouseImage> => {
      const response = await fetch(item.imageUrl, {
        cache: "no-store",
        signal: AbortSignal.timeout(50_000),
      });
      if (!response.ok) throw new Error(`${item.filename} konnte nicht aus iCloud geladen werden.`);
      const blob = await response.blob();
      const role = (item.role || inferImageRole(item)) as ImageRole;
      return {
        id: uid(),
        sourceId: item.id,
        name: item.filename,
        mimeType: item.mimeType || blob.type || "image/jpeg",
        dataUrl: await blobDataUrl(blob),
        caption: captionForImageRole(role, item.filename, item.caption),
        captionLocked: item.captionLocked === true || isFixedCaptionRole(role),
        isFloorplan: role.startsWith("floorplan"),
        role,
      };
    }));
    const successful = results.filter(
      (result): result is PromiseFulfilledResult<HouseImage> => result.status === "fulfilled",
    );
    return {
      images: successful.map((result) => result.value),
      failed: results.length - successful.length,
    };
  };

  const importSelectedMedia = async () => {
    if (!activeHouse || !selectedMediaItems.length) return;
    const houseId = activeHouse.id;
    const existingSourceIds = new Set(
      activeHouse.images.map((image) => image.sourceId).filter(Boolean),
    );
    const candidates = selectedMediaItems
      .filter((item) => !existingSourceIds.has(item.id))
      .slice(0, MAX_HOUSE_IMAGES - activeHouse.images.length);
    if (!candidates.length) {
      setNotice("Die ausgewählten Bilder sind bereits zugeordnet oder das Bilderlimit ist erreicht.");
      return;
    }

    setImportingMedia(true);
    try {
      const { images: imported, failed } = await downloadMediaItems(candidates);
      if (imported.length) {
        setState((current) => ({
          ...current,
          houses: current.houses.map((house) => {
            if (house.id !== houseId) return house;
            const sourceIds = new Set(
              house.images.map((image) => image.sourceId).filter(Boolean),
            );
            const additions = imported
              .filter((image) => !sourceIds.has(image.sourceId))
              .slice(0, MAX_HOUSE_IMAGES - house.images.length);
            return {
              ...house,
              images: orderHouseImages([...house.images, ...additions]) as HouseImage[],
            };
          }),
        }));
      }
      setSelectedMediaItems([]);
      setNotice(
        failed
          ? `${imported.length} Bilder wurden übernommen; ${failed} iCloud-Dateien konnten noch nicht geladen werden.`
          : `${imported.length} beschriftete Bilder wurden aus der iCloud-Medienbibliothek übernommen.`,
      );
    } finally {
      setImportingMedia(false);
    }
  };

  const addMediaLibraryFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []).filter((file) => (
      ["image/jpeg", "image/png", "image/webp"].includes(file.type)
    ));
    if (!files.length) {
      setMediaLibraryMutationStatus("Bitte JPEG-, PNG- oder WebP-Bilder auswählen.");
      input.value = "";
      return;
    }

    setAddingMediaLibraryItems(true);
    setMediaLibraryMutationStatus(`${files.length} Bilder werden dauerhaft hinzugefügt …`);
    let added = 0;
    const failures: string[] = [];
    try {
      for (const [index, file] of files.entries()) {
        setMediaLibraryMutationStatus(
          `Bild ${index + 1} von ${files.length} wird dauerhaft hinzugefügt …`,
        );
        try {
          const response = await fetch("http://127.0.0.1:43182/media-library/image", {
            method: "POST",
            headers: {
              "Content-Type": file.type,
              "X-FPI-Media-Filename": encodeURIComponent(file.name),
              "X-FPI-Media-Kind": mediaLibraryUploadKind,
              "X-FPI-Media-Group": encodeURIComponent(mediaLibraryUploadGroup.trim()),
            },
            body: file,
          });
          const data = (await response.json().catch(() => ({}))) as {
            ok?: boolean;
            message?: string;
          };
          if (!response.ok || !data.ok) {
            throw new Error(data.message || "Das Bild konnte nicht gespeichert werden.");
          }
          added += 1;
        } catch (error) {
          failures.push(
            `${file.name}: ${error instanceof Error ? error.message : "Speichern fehlgeschlagen."}`,
          );
        }
      }

      if (added > 0) {
        setMediaDuplicateGroups([]);
        setMediaDuplicateKeepIds({});
      }
      await loadMediaLibrary(mediaLibraryPage);
      const status = failures.length
        ? `${added} von ${files.length} Bildern wurden hinzugefügt. ${failures.length} konnten nicht gespeichert werden.`
        : `${added} Bilder wurden dauerhaft in der Medienbibliothek gespeichert.`;
      setMediaLibraryMutationStatus(status);
      setNotice(status);
    } finally {
      input.value = "";
      setAddingMediaLibraryItems(false);
    }
  };

  const deleteMediaLibraryItem = async (item: MediaLibraryItem) => {
    const confirmed = window.confirm(
      `„${item.caption || item.filename}“ wirklich dauerhaft aus der Medienbibliothek löschen?\n\n`
      + "Die Bibliotheksquelle wird dauerhaft entfernt. Bereits in Haustypen übernommene Kopien bleiben erhalten.",
    );
    if (!confirmed) return;

    setDeletingMediaItemIds((current) => [...current, item.id]);
    setMediaLibraryMutationStatus(`„${item.caption || item.filename}“ wird dauerhaft gelöscht …`);
    try {
      const response = await fetch(
        `http://127.0.0.1:43182/media-library/image?id=${encodeURIComponent(item.id)}&force=1`,
        { method: "DELETE" },
      );
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
      };
      if (!response.ok || !data.ok) {
        throw new Error(data.message || "Das Bild konnte nicht gelöscht werden.");
      }

      setSelectedMediaItems((current) => (
        current.filter((selectedItem) => selectedItem.id !== item.id)
      ));
      setMediaDuplicateGroups([]);
      setMediaDuplicateKeepIds({});
      await loadMediaLibrary(mediaLibraryPage);
      const status = `„${item.caption || item.filename}“ wurde dauerhaft aus der Medienbibliothek gelöscht. Vorhandene Haustypkopien bleiben erhalten.`;
      setMediaLibraryMutationStatus(status);
      setNotice(status);
    } catch (error) {
      const status = error instanceof Error
        ? error.message
        : "Das Bild konnte nicht gelöscht werden.";
      setMediaLibraryMutationStatus(status);
      setNotice(status);
    } finally {
      setDeletingMediaItemIds((current) => current.filter((id) => id !== item.id));
    }
  };

  const cleanupMediaLibraryDuplicates = async () => {
    if (!mediaDuplicateDeleteIds.length) return;
    const hiddenCount = mediaDuplicateDeleteIds.length - mediaDuplicateManagedCount;
    const referenceNote = mediaDuplicateReferencedCount
      ? `\n${mediaDuplicateReferencedCount} vorhandene Haustyp-Zuordnungen bleiben als eigenständige Kopien erhalten.`
      : "";
    const confirmed = window.confirm(
      `${mediaDuplicateDeleteIds.length} Dubletten aus ${mediaDuplicateGroups.length} Gruppen dauerhaft bereinigen?\n\n`
      + "In jeder Gruppe bleibt genau das markierte Original erhalten.\n"
      + `${mediaDuplicateManagedCount} eigene Dateien werden endgültig gelöscht`
      + `${hiddenCount ? `, ${hiddenCount} integrierte Quellen dauerhaft ausgeblendet` : ""}.`
      + referenceNote,
    );
    if (!confirmed) return;

    setDeletingMediaDuplicates(true);
    setDeletingMediaItemIds(mediaDuplicateDeleteIds);
    setMediaLibraryMutationStatus(
      `${mediaDuplicateDeleteIds.length} Dubletten werden sicher bereinigt …`,
    );
    try {
      const response = await fetch(
        "http://127.0.0.1:43182/media-library/deduplicate?force=1",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deleteIds: mediaDuplicateDeleteIds }),
        },
      );
      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        deletedCount?: number;
        hiddenCount?: number;
      };
      if (!response.ok || !data.ok) {
        throw new Error(data.message || "Die Dubletten konnten nicht bereinigt werden.");
      }

      const deletedIds = new Set(mediaDuplicateDeleteIds);
      setSelectedMediaItems((current) => (
        current.filter((item) => !deletedIds.has(item.id))
      ));
      await loadMediaLibrary(mediaLibraryPage);
      await scanMediaLibraryDuplicates();
      const status = `${mediaDuplicateDeleteIds.length} Dubletten wurden dauerhaft bereinigt. `
        + `${Number(data.deletedCount) || 0} eigene Dateien gelöscht, `
        + `${Number(data.hiddenCount) || 0} integrierte Quellen ausgeblendet.`;
      setMediaLibraryMutationStatus(status);
      setNotice(status);
    } catch (error) {
      const status = error instanceof Error
        ? error.message
        : "Die Dubletten konnten nicht bereinigt werden.";
      setMediaLibraryMutationStatus(status);
      setNotice(status);
    } finally {
      setDeletingMediaItemIds([]);
      setDeletingMediaDuplicates(false);
    }
  };

  const buildAutomaticImageSequence = async () => {
    if (!activeHouse) return;
    const cover = selectedMediaItems.length === 1 && selectedMediaItems[0].kind === "house"
      ? selectedMediaItems[0]
      : null;
    if (!cover) {
      setNotice("Bitte genau eine versionsbezeichnete SUN- oder SOL-Hausansicht auswählen.");
      return;
    }
    if (
      activeHouse.images.length
      && !window.confirm(
        `Die bisherige Bildfolge für „${activeHouse.name}“ durch die automatisch zusammengestellte Folge ersetzen?`,
      )
    ) {
      return;
    }

    setImportingMedia(true);
    try {
      const response = await fetch(
        `http://127.0.0.1:43182/media-library/sequence?coverId=${encodeURIComponent(cover.id)}`,
      );
      const data = (await response.json()) as {
        ok?: boolean;
        message?: string;
        warnings?: string[];
        items?: MediaLibraryItem[];
      };
      if (!response.ok || !data.ok || !Array.isArray(data.items)) {
        throw new Error(data.message || "Die automatische Bildfolge konnte nicht erstellt werden.");
      }
      const warnings = Array.isArray(data.warnings) ? data.warnings : [];
      if (warnings.length) {
        setNotice(`Bildfolge nicht übernommen: ${warnings.join(" ")}`);
        return;
      }
      if (data.items.length > MAX_HOUSE_IMAGES) {
        setNotice(
          `Die vollständige Standardfolge enthält ${data.items.length} Bilder und überschreitet das Limit von ${MAX_HOUSE_IMAGES}.`,
        );
        return;
      }
      const { images, failed } = await downloadMediaItems(data.items);
      if (failed || images.length !== data.items.length) {
        setNotice(
          `${failed || data.items.length - images.length} iCloud-Bilder konnten nicht geladen werden. Die vorhandene Bildfolge wurde nicht verändert.`,
        );
        return;
      }
      const houseId = activeHouse.id;
      setState((current) => ({
        ...current,
        houses: current.houses.map((house) => (
          house.id === houseId
            ? { ...house, images: orderHouseImages(images) as HouseImage[] }
            : house
        )),
      }));
      setSelectedMediaItems([]);
      setNotice(
        `${images.length} iCloud-Bilder wurden versionsgenau zusammengestellt. Hausdaten, Preis und Adressen blieben unverändert.`,
      );
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Die automatische Bildfolge konnte nicht erstellt werden.",
      );
    } finally {
      setImportingMedia(false);
    }
  };

  const addPromotionImages = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const availableSlots = MAX_PROMOTION_IMAGES - promotionPool(state).length;
    const files = Array.from(input.files ?? [])
      .filter((file) => ["image/jpeg", "image/png", "image/webp"].includes(file.type))
      .slice(0, Math.max(0, availableSlots));
    input.value = "";

    if (!files.length) {
      setNotice(
        availableSlots <= 0
          ? `Der Aktionsbild-Pool ist mit ${MAX_PROMOTION_IMAGES} Bildern vollständig.`
          : "Bitte JPEG-, PNG- oder WebP-Bilder auswählen.",
      );
      return;
    }

    try {
      const images = await Promise.all(
        files.map((file) => new Promise<HouseImage>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve({
            id: uid(),
            name: file.name,
            mimeType: file.type || "image/jpeg",
            dataUrl: String(reader.result),
            caption: "Aktuelles Angebot für dein neues Zuhause",
            isFloorplan: false,
            role: "promotion",
            captionLocked: false,
          });
          reader.onerror = () => reject(new Error(`${file.name} konnte nicht gelesen werden.`));
          reader.readAsDataURL(file);
        })),
      );
      setState((current) => ({
        ...current,
        promotionImages: [...promotionPool(current), ...images].slice(0, MAX_PROMOTION_IMAGES),
        promotionImage: null,
        promotionImageEnabled: false,
      }));
      setNotice(`${images.length} Aktionsbild${images.length === 1 ? "" : "er"} wurden gespeichert.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Die Aktionsbilder konnten nicht gelesen werden.");
    }
  };

  const updatePromotionImage = (imageId: string, patch: Partial<HouseImage>) => {
    setState((current) => ({
      ...current,
      promotionImages: promotionPool(current).map((image) => (
        image.id === imageId ? { ...image, ...patch } : image
      )),
    }));
  };

  const removePromotionImage = (imageId: string) => {
    setState((current) => {
      const promotionImages = promotionPool(current).filter((image) => image.id !== imageId);
      const promotionImageIds = promotionImages.map((image) => image.id);
      return {
        ...current,
        promotionImages,
        promotionImage: null,
        promotionImageEnabled: false,
        projects: current.projects.map((project) => {
          const currentActiveHouseIds = new Set(
            current.houses
              .filter((house) => house.archived !== true)
              .map((house) => house.id),
          );
          const selectedHouseIds = project.selectedHouseIds.filter(
            (houseId) => currentActiveHouseIds.has(houseId),
          );
          const promotionImageCount = Math.min(
            projectPromotionCount(project),
            promotionImages.length,
          );
          const promotionAssignments = reconcilePromotionAssignments(
            selectedHouseIds,
            promotionImageIds,
            promotionImageCount,
            project.promotionAssignments,
          );
          return {
            ...project,
            promotionImageCount,
            promotionAssignments,
            listings: project.listings.map((listing) => ({
              ...listing,
              promotionImageId: promotionAssignments[listing.templateId],
            })),
          };
        }),
      };
    });
    setNotice("Das Aktionsbild wurde entfernt und betroffene Adressen wurden neu zugeordnet.");
  };

  const addImages = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!activeHouse) return;
    const remaining = MAX_HOUSE_IMAGES - activeHouse.images.length;
    const files = Array.from(event.target.files ?? []).slice(0, remaining);
    const images: HouseImage[] = await Promise.all(
      files.map(
        (file, index) =>
          new Promise<HouseImage>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const isFloorplan = /grundriss|floor/i.test(file.name);
              const role = inferImageRole({ filename: file.name, isFloorplan }) as ImageRole;
              const captionLocked = isFixedCaptionRole(role);
              resolve({
                id: uid(),
                name: file.name,
                mimeType: file.type || "image/jpeg",
                dataUrl: String(reader.result),
                caption: captionLocked
                  ? captionForImageRole(role, file.name)
                  : localImageCaption(file.name, isFloorplan, index),
                isFloorplan: role.startsWith("floorplan"),
                role,
                captionLocked,
              });
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          }),
      ),
    );
    updateHouse({ images: [...activeHouse.images, ...images] });
    event.target.value = "";
    await createAutomaticImageCaptions(activeHouse, images);
  };

  const updateImage = (id: string, patch: Partial<HouseImage>) => {
    if (!activeHouse) return;
    updateHouse({
      images: activeHouse.images.map((image) =>
        image.id === id ? { ...image, ...patch } : image,
      ),
    });
  };

  const updateImageRole = (id: string, role: ImageRole) => {
    if (!activeHouse) return;
    updateHouse({
      images: activeHouse.images.map((image) => {
        if (image.id !== id) return image;
        const captionLocked = isFixedCaptionRole(role);
        return {
          ...image,
          role,
          isFloorplan: role.startsWith("floorplan"),
          captionLocked,
          caption: captionForImageRole(role, image.name, image.caption),
        };
      }),
    });
  };

  const normalizeImageSequence = () => {
    if (!activeHouse) return;
    updateHouse({ images: orderHouseImages(activeHouse.images) as HouseImage[] });
    setNotice("Die Bilder wurden nach den hinterlegten Bildrollen sortiert. Innerhalb der Innenräume bleibt deine gewählte Reihenfolge erhalten.");
  };

  const classifyExistingImages = () => {
    let classified = 0;
    setState((current) => ({
      ...current,
      houses: current.houses.map((house) => ({
        ...house,
        images: house.images.map((image, index) => {
          if (image.role) return image;
          const inferred = inferImageRole({
            filename: image.name,
            isFloorplan: image.isFloorplan,
          }) as ImageRole;
          const role = inferred === "other" && index === 0 ? "cover" : inferred;
          const captionLocked = isFixedCaptionRole(role);
          classified += 1;
          return {
            ...image,
            role,
            isFloorplan: role.startsWith("floorplan"),
            captionLocked,
            caption: captionForImageRole(role, image.name, image.caption),
          };
        }),
      })),
    }));
    setNotice(`${classified} vorhandene Bilder aus allen Haustypen wurden ohne erneuten Upload mit den hinterlegten Bildrollen ergänzt.`);
  };

  const moveImage = (id: string, targetIndex: number) => {
    if (!activeHouse) return;
    const currentIndex = activeHouse.images.findIndex((image) => image.id === id);
    if (
      currentIndex < 0
      || targetIndex < 0
      || targetIndex >= activeHouse.images.length
      || currentIndex === targetIndex
    ) return;
    const images = [...activeHouse.images];
    const [movedImage] = images.splice(currentIndex, 1);
    images.splice(targetIndex, 0, movedImage);
    updateHouse({ images });
  };

  const selectOwner = (owner: AddressOwner) => {
    const existingProject = state.projects.find(
      (project) => projectOwner(project) === owner,
    );
    setActiveOwner(owner);
    if (!resumableTotalSync && !totalSyncBusy) setTotalSyncScope(owner);
    if (existingProject) {
      setActiveProjectId(existingProject.id);
      return;
    }
    const project = newProject(owner);
    setState((current) => ({
      ...current,
      projects: [project, ...current.projects],
    }));
    setActiveProjectId(project.id);
    setNotice(`Der Adressbereich für ${owner === "pascal" ? "Pascal" : "Fabian"} wurde angelegt.`);
  };

  const addProject = () => {
    const project = newProject(activeOwner);
    setState((current) => ({
      ...current,
      projects: [project, ...current.projects],
    }));
    setActiveProjectId(project.id);
  };

  const openAddressProject = (projectId: string) => {
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) return;
    const owner = projectOwner(project);
    setActiveOwner(owner);
    setActiveProjectId(project.id);
    if (!resumableTotalSync && !totalSyncBusy) setTotalSyncScope(owner);
    setNotice(`„${projectSelectionLabel(project)}“ ist jetzt zur Bearbeitung geöffnet.`);
    window.requestAnimationFrame(() => {
      addressEditorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const deleteAddressDuplicates = (keepIdsByGroup: Record<string, string>) => {
    if (addressDuplicateMutationLocked) {
      setNotice("Adressdubletten können erst nach dem laufenden Upload- oder Speichervorgang gelöscht werden.");
      return;
    }

    const currentGroups = findAddressDuplicateGroups(state.projects);
    const deleteIds = new Set<string>();
    let keptProjectForActiveDuplicate: ProjectInput | undefined;

    for (const group of currentGroups) {
      const requestedKeepId = keepIdsByGroup[group.id] || group.recommendedKeepId;
      if (!group.projectIds.includes(requestedKeepId)) {
        setNotice("Die Adressdubletten haben sich geändert. Bitte die Prüfung erneut starten.");
        return;
      }
      if (group.projectIds.includes(activeProjectId)) {
        keptProjectForActiveDuplicate = state.projects.find(
          (project) => project.id === requestedKeepId,
        );
      }
      group.projectIds.forEach((projectId) => {
        if (projectId !== requestedKeepId) deleteIds.add(projectId);
      });
    }

    if (!deleteIds.size) {
      setNotice("Es sind keine doppelten Grundstücksadressen zum Löschen vorhanden.");
      return;
    }

    const remainingProjects = state.projects.filter((project) => !deleteIds.has(project.id));
    if (!remainingProjects.length) {
      setNotice("Die Bereinigung wurde abgebrochen, weil mindestens eine Adresse erhalten bleiben muss.");
      return;
    }

    const nextState = {
      ...state,
      projects: remainingProjects,
    };
    setState(nextState);
    setSelectedRenewalProjectIds((current) => (
      current.filter((projectId) => !deleteIds.has(projectId))
    ));

    if (deleteIds.has(activeProjectId)) {
      const nextActiveProject = keptProjectForActiveDuplicate ?? remainingProjects[0];
      setActiveProjectId(nextActiveProject.id);
      setActiveOwner(projectOwner(nextActiveProject));
      if (!resumableTotalSync && !totalSyncBusy) {
        setTotalSyncScope(projectOwner(nextActiveProject));
      }
    }

    const savedAt = new Date().toISOString();
    const saves: Promise<unknown>[] = [saveStudioState(nextState, savedAt)];
    if (helperOnline) saves.push(queueWindowsCatalogSnapshot(nextState, savedAt));
    setSaveLabel("Bereinigter Adressbestand wird doppelt gespeichert …");
    void Promise.all(saves)
      .then(() => setSaveLabel(
        helperOnline ? "Browser + Gerätesicherung aktuell" : "Lokal im Browser gespeichert",
      ))
      .catch(() => setSaveLabel("Speichern fehlgeschlagen"));
    setNotice(
      `${deleteIds.size} Adressdublette${deleteIds.size === 1 ? "" : "n"} wurde${deleteIds.size === 1 ? "" : "n"} gelöscht. `
      + `${currentGroups.length} Original${currentGroups.length === 1 ? "" : "e"} blieb${currentGroups.length === 1 ? "" : "en"} vollständig erhalten.`,
    );
  };

  const importAddressesFromExcel = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    setImportingAddresses(true);
    setAddressImportReport([]);
    try {
      const rows = await readSheet(file);
      const result = parseAddressWorkbookRows(rows, state.projects, uid);
      setAddressImportReport(result.errors.slice(0, 8));
      if (!result.projects.length && !result.projectUpdates.length) {
        const details = [
          result.duplicateCount ? `${result.duplicateCount} bereits gespeichert` : "",
          result.errors.length ? `${result.errors.length} fehlerhaft` : "",
        ].filter(Boolean).join(", ");
        setNotice(details
          ? `Keine neue Adresse importiert: ${details}.`
          : "Die Excel-Datei enthält keine importierbaren Adressen.");
        return;
      }
      const updatesById = new Map(
        result.projectUpdates.map((update) => [update.id, update.changes]),
      );
      setState((current) => ({
        ...current,
        projects: [
          ...result.projects,
          ...current.projects.map((project) => ({
            ...project,
            ...updatesById.get(project.id),
          })),
        ],
      }));
      const firstProject = result.projects[0]
        ?? state.projects.find((project) => project.id === result.projectUpdates[0]?.id);
      if (firstProject) {
        setActiveOwner(firstProject.owner);
        setActiveProjectId(firstProject.id);
        if (!resumableTotalSync) setTotalSyncScope(firstProject.owner);
      }
      const details = [
        result.duplicateCount ? `${result.duplicateCount} Dubletten übersprungen` : "",
        result.errors.length ? `${result.errors.length} fehlerhafte Zeilen übersprungen` : "",
      ].filter(Boolean).join(" · ");
      const completedActions = [
        result.projects.length
          ? `${result.projects.length} Adressen aus Excel importiert`
          : "",
        result.projectUpdates.length
          ? `${result.projectUpdates.length} gespeicherte Adressen aktualisiert`
          : "",
      ].filter(Boolean).join(" · ");
      setNotice(`${completedActions} und lokal gespeichert${details ? ` · ${details}` : ""}.`);
    } catch (error) {
      setNotice(error instanceof Error
        ? `Excel-Import fehlgeschlagen: ${error.message}`
        : "Die Excel-Datei konnte nicht gelesen werden.");
    } finally {
      input.value = "";
      setImportingAddresses(false);
    }
  };

  const replaceAddressesFromExcel = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    setReplacingAddresses(true);
    setAddressImportReport([]);
    try {
      const rows = await readSheet(file);
      const result = replaceAddressWorkbookRows(rows, state.projects, uid);
      setAddressImportReport(result.errors.slice(0, 8));
      if (!result.projects.length) {
        setNotice(result.errors[0] ?? "Die Excel-Datei enthält keinen ersetzbaren Adressbestand.");
        return;
      }
      const confirmed = window.confirm(
        `${result.projects.length} Adressen aus „${file.name}“ ersetzen den bisherigen Bestand `
        + `mit ${state.projects.length} Adressen vollständig.\n\n`
        + `${result.preservedProjectCount} bestehende Projekte behalten ihre IDs, Inserate und Verläufe. `
        + `${result.newProjectCount} Projekte kommen neu hinzu; ${result.removedProjectCount} bisherige Projekte werden entfernt.\n\n`
        + "Haustypen, Bilder, Preislisten und Zugangsdaten bleiben unverändert. Jetzt ersetzen?",
      );
      if (!confirmed) {
        setNotice("Bestandsersetzung abgebrochen. Es wurde nichts verändert.");
        return;
      }

      const firstProject = result.projects[0];
      setState((current) => ({
        ...current,
        projects: result.projects,
      }));
      setActiveOwner(firstProject.owner);
      setActiveProjectId(firstProject.id);
      if (!resumableTotalSync) setTotalSyncScope(firstProject.owner);
      const details = [
        `${result.preservedProjectCount} mit Verlauf erhalten`,
        result.newProjectCount ? `${result.newProjectCount} neu` : "",
        result.removedProjectCount ? `${result.removedProjectCount} entfernt` : "",
        result.errors.length ? `${result.errors.length} fehlerhafte Zeilen ausgelassen` : "",
      ].filter(Boolean).join(" · ");
      setNotice(`${result.projects.length} Adressen vollständig ersetzt und lokal gespeichert · ${details}.`);
    } catch (error) {
      setNotice(error instanceof Error
        ? `Bestandsersetzung fehlgeschlagen: ${error.message}`
        : "Die Excel-Datei konnte nicht gelesen werden.");
    } finally {
      input.value = "";
      setReplacingAddresses(false);
    }
  };

  const downloadInventoryExcel = async () => {
    setExportingInventory(true);
    try {
      const result = await buildInventoryWorkbook(state);
      downloadBlob(result.blob, result.filename);
      setNotice(
        `Excel-Bestand heruntergeladen: ${result.addressCount} Adressen, `
        + `${result.listingCount} Inserate und ${result.activeHouseCount} aktive Haustypen`
        + `${result.archivedHouseCount ? ` (${result.archivedHouseCount} archiviert)` : ""}.`,
      );
    } catch (error) {
      setNotice(error instanceof Error
        ? `Excel-Download fehlgeschlagen: ${error.message}`
        : "Der Bestand konnte nicht als Excel-Datei erstellt werden.");
    } finally {
      setExportingInventory(false);
    }
  };

  const toggleHouse = (houseId: string) => {
    if (!activeProject) return;
    const selected = activeSelectedHouseIds.includes(houseId);
    if (!selected && activeSelectedHouseIds.length >= 4) {
      setNotice("Pro Adresse können maximal vier Haustypen gewählt werden.");
      return;
    }
    const archivedSelectedHouseIds = activeProject.selectedHouseIds.filter(
      (id) => !activeHouseIds.has(id),
    );
    const nextActiveHouseIds = selected
      ? activeSelectedHouseIds.filter((id) => id !== houseId)
      : [...activeSelectedHouseIds, houseId];
    const selectedHouseIds = [...archivedSelectedHouseIds, ...nextActiveHouseIds];
    const promotionAssignments = reconcilePromotionAssignments(
      nextActiveHouseIds,
      promotionPool(state).map((image) => image.id),
      projectPromotionCount(activeProject),
      activeProject.promotionAssignments,
    );
    updateProject({
      selectedHouseIds,
      promotionAssignments,
      listings: activeProject.listings
        .filter((listing) => selected ? listing.templateId !== houseId : true)
        .map((listing) => ({
          ...listing,
          promotionImageId: promotionAssignments[listing.templateId],
        })),
    });
  };

  const setProjectPromotionCount = (requestedCount: number) => {
    if (!activeProject) return;
    const promotionImageCount = Math.max(
      0,
      Math.min(MAX_PROMOTED_LISTINGS, requestedCount, promotionPool(state).length),
    );
    const promotionAssignments = reconcilePromotionAssignments(
      activeSelectedHouseIds,
      promotionPool(state).map((image) => image.id),
      promotionImageCount,
      activeProject.promotionAssignments,
    );
    updateProject({
      promotionImageCount,
      promotionAssignments,
      listings: activeProject.listings.map((listing) => ({
        ...listing,
        promotionImageId: promotionAssignments[listing.templateId],
      })),
    });
    setNotice(promotionImageCount === 0
      ? "Für diese Adresse werden keine Aktionsbilder eingesetzt. Die Auswahl ist gespeichert."
      : `${promotionImageCount} von 4 Inseraten erhalten bei dieser Adresse ein Aktionsbild auf Position 1. Die Auswahl ist gespeichert.`);
  };

  const rerollProjectPromotions = () => {
    if (!activeProject) return;
    const promotionAssignments = randomPromotionAssignments(
      activeSelectedHouseIds,
      promotionPool(state).map((image) => image.id),
      projectPromotionCount(activeProject),
    );
    updateProject({
      promotionAssignments,
      listings: activeProject.listings.map((listing) => ({
        ...listing,
        promotionImageId: promotionAssignments[listing.templateId],
      })),
    });
    setNotice("Die Aktionsbilder wurden für diese Adresse neu ausgelost und gespeichert.");
  };

  const requestListingTexts = async (input: {
    project: ProjectInput;
    house: HouseTemplate;
    index: number;
    listingCount: number;
    selectedHouseNames: string[];
    previous: GeneratedListing | undefined;
    titlesToAvoid: string[];
    headlineCycleId: string;
    maxAttempts?: number;
    model?: AiModelId;
    shouldStop?: () => boolean;
  }): Promise<{
    texts: ListingTexts;
    writingProfile: string;
    aiUsage: AiTokenUsage;
  }> => {
    const maxAttempts = Math.max(1, input.maxAttempts ?? 1);
    const requestModel = input.model ?? aiModel;
    let accumulatedUsage = emptyAiUsage(requestModel);
    let lastError: AiUsageError | null = null;
    const stoppedError = (): AiUsageError => {
      const error = new Error(
        "Die KI-Texterstellung wurde vor der nächsten kostenpflichtigen Anfrage sicher angehalten.",
      ) as AiUsageError;
      error.stopped = true;
      error.aiUsage = accumulatedUsage;
      return error;
    };
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (input.shouldStop?.()) throw stoppedError();
      try {
        const response = await fetch("http://127.0.0.1:43182/generate-texts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey: openAiKey.trim(),
            model: requestModel,
            house: {
              name: input.house.name,
              houseType: input.house.houseType,
              livingArea: input.house.livingArea,
              rooms: input.house.rooms,
              bedrooms: input.house.bedrooms,
              bathrooms: input.house.bathrooms,
              floors: input.house.floors,
              housePrice: input.house.housePrice,
              constructionYear: input.house.constructionYear,
              energyDemand: input.house.energyDemand,
              energyClass: input.house.energyClass,
              heatingType: input.house.heatingType,
              energySource: input.house.energySource,
              architecture: input.house.architecture,
              equipmentHighlights: input.house.equipmentHighlights,
              useStandardPackage: input.house.useStandardPackage,
            },
            project: {
              name: input.project.name,
              street: input.project.street,
              houseNumber: input.project.houseNumber,
              zip: input.project.zip,
              city: input.project.city,
              district: input.project.district,
              plotArea: input.project.plotArea,
              plotPrice: input.project.plotPrice,
              additionalCosts: input.project.additionalCosts,
              locationFacts: input.project.locationFacts,
              transportFacts: input.project.transportFacts,
              familyFacts: input.project.familyFacts,
              natureFacts: input.project.natureFacts,
              notes: input.project.notes,
            },
            provider: {
              company: state.provider.company,
              firstName: state.provider.firstName,
              lastName: state.provider.lastName,
              phone: state.provider.phone,
            },
            previousTexts: input.previous?.texts,
            previousWritingProfile: input.previous?.writingProfile,
            titlesToAvoid: input.titlesToAvoid,
            headlineCycleId: input.headlineCycleId,
            listingPosition: input.index + 1,
            listingCount: input.listingCount,
            selectedHouseNames: input.selectedHouseNames,
            variationId: crypto.randomUUID(),
          }),
        });
        const data = (await response.json()) as {
          ok?: boolean;
          message?: string;
          texts?: ListingTexts;
          writingProfile?: string;
          qualityChecked?: boolean;
          usage?: Partial<AiTokenUsage>;
        };
        accumulatedUsage = mergeAiUsage(accumulatedUsage, data.usage);
        if (!response.ok || !data.ok || !data.texts || !data.qualityChecked) {
          const error = new Error(
            data.message || `Der KI-Text für „${input.house.name}“ konnte nicht erzeugt werden.`,
          ) as AiUsageError;
          error.status = response.status;
          error.aiUsage = accumulatedUsage;
          throw error;
        }
        return {
          texts: data.texts,
          writingProfile: data.writingProfile ?? "",
          aiUsage: accumulatedUsage,
        };
      } catch (error) {
        lastError = error instanceof Error
          ? error as AiUsageError
          : new Error("Die KI-Texte konnten nicht erzeugt werden.") as AiUsageError;
        lastError.aiUsage = accumulatedUsage;
        const status = lastError.status;
        const retryable = status === undefined || status === 422 || status === 429 || status >= 500;
        if (attempt >= maxAttempts || !retryable) throw lastError;
        if (input.shouldStop?.()) throw stoppedError();
        await new Promise((resolve) => window.setTimeout(resolve, 2500 * attempt));
      }
    }
    const error = lastError
      ?? new Error("Die KI-Texte konnten nicht erzeugt werden.") as AiUsageError;
    error.aiUsage = accumulatedUsage;
    throw error;
  };

  const generationInputIsValid = () => {
    if (!activeProject || selectedHouses.length === 0) {
      setNotice("Bitte zuerst mindestens einen Haustyp auswählen.");
      return false;
    }
    if (!activeProject.city || !activeProject.zip || !activeProject.street || !activeProject.plotArea) {
      setNotice("Für das Projekt benötigen wir Straße, PLZ, Ort und Grundstücksfläche. Straße, Hausnummer und PLZ werden nicht in die KI-Texte übernommen.");
      return false;
    }
    return true;
  };

  const generateAiListings = async () => {
    if (!generationInputIsValid() || !activeProject) return;
    if (projectPromotionCount(activeProject) > promotionPool(state).length) {
      setNotice("Für die gewählte Anzahl werden mehr unterschiedliche Aktionsbilder benötigt. Bitte den Aktionsbild-Pool ergänzen oder die Anzahl reduzieren.");
      return;
    }
    if (!looksLikeOpenAiApiKey(openAiKey)) {
      setTab("settings");
      setNotice("Bitte unter Export & Upload einen vollständigen OpenAI API-Schlüssel einfügen, der mit sk- beginnt, und anschließend prüfen und speichern.");
      return;
    }
    if (!helperOnline) {
      setNotice(helperNeedsRestart
        ? "Der lokale Textgenerator verwendet noch eine ältere Programmfassung. Bitte Inserate Studio schließen und erneut über den Startknopf öffnen."
        : "Der lokale Helfer ist nicht erreichbar. Bitte die Anwendung über den Startknopf öffnen.");
      return;
    }

    const projectSnapshot = activeProject;
    const houseSnapshots = [...selectedHouses];
    const selectedHouseNames = houseSnapshots.map((house) => house.name);
    const headlineCycleId = crypto.randomUUID();
    const historicalTitles = Array.from(new Set(
      state.projects.flatMap((project) => (
        collectedProjectHeadlineHistory(project)
          .map((title) => removePrivateAddressFromHeadline(title, project))
      )).filter(Boolean),
    )).slice(-60);
    setGeneratingAi(true);
    setNotice(`Qualitätsmodus arbeitet: ${houseSnapshots.length} Inserat${houseSnapshots.length === 1 ? "" : "e"} erhalten neue Überschriften und lebendige, unterschiedlich aufgebaute Anzeigentexte …`);

    try {
      const generated = await Promise.all(
        houseSnapshots.map(async (house, index) => {
          const previous = projectSnapshot.listings.find(
            (listing) => listing.templateId === house.id,
          );
          const result = await requestListingTexts({
            project: projectSnapshot,
            house,
            index,
            listingCount: houseSnapshots.length,
            selectedHouseNames,
            previous,
            titlesToAvoid: historicalTitles,
            headlineCycleId,
          });
          return {
            house,
            index,
            previous,
            texts: result.texts,
            writingProfile: result.writingProfile,
          };
        }),
      );

      const acceptedTitles = [...historicalTitles];
      for (const generatedListing of generated) {
        if (acceptedTitles.some((title) => (
          headlinesAreTooSimilar(generatedListing.texts.title, title)
        ))) {
          const replacement = await requestListingTexts({
            project: projectSnapshot,
            house: generatedListing.house,
            index: generatedListing.index,
            listingCount: houseSnapshots.length,
            selectedHouseNames,
            previous: generatedListing.previous,
            titlesToAvoid: acceptedTitles,
            headlineCycleId,
          });
          generatedListing.texts = replacement.texts;
          generatedListing.writingProfile = replacement.writingProfile;
        }
        acceptedTitles.push(generatedListing.texts.title);
      }

      const promotionAssignments = reconcilePromotionAssignments(
        houseSnapshots.map((house) => house.id),
        promotionPool(state).map((image) => image.id),
        projectPromotionCount(projectSnapshot),
        projectSnapshot.promotionAssignments,
      );
      const providerNumber = FIXED_HV_PROVIDER_NUMBER;
      const listingsNeedingNewExternalId = generated.filter(({ previous }) => (
        !previous
        || Boolean(previous.uploadedAt)
        || !isProviderExternalId(previous.externalId, providerNumber)
      )).length;
      const allocatedExternalIds = allocateProviderExternalIds(
        providerNumber,
        collectedStateExternalIds(state),
        listingsNeedingNewExternalId,
      );
      let nextExternalIdIndex = 0;
      const listings: GeneratedListing[] = generated.map(({
        house,
        previous,
        texts,
        writingProfile,
      }) => ({
        id: previous?.id ?? uid(),
        externalId: previous
          && !previous.uploadedAt
          && isProviderExternalId(previous.externalId, providerNumber)
          ? previous.externalId.trim().toUpperCase()
          : allocatedExternalIds[nextExternalIdIndex++],
        templateId: house.id,
        templateName: house.name,
        promotionImageId: promotionAssignments[house.id],
        price: totalPrice(house, projectSnapshot),
        texts,
        writingProfile: writingProfile || previous?.writingProfile,
        titleHistory: Array.from(new Set([
          ...(previous?.titleHistory ?? []),
          ...(previous?.texts.title ? [previous.texts.title] : []),
        ])).slice(-40),
        projectingSettings: fillMissingProjectingDefaults(previous?.projectingSettings),
        version: (previous?.version ?? 0) + 1,
      }));

      setState((current) => ({
        ...current,
        projects: current.projects.map((project) =>
          project.id === projectSnapshot.id
            ? {
                ...project,
                headlineHistory: collectedProjectHeadlineHistory(projectSnapshot),
                promotionAssignments,
                listings,
              }
            : project,
        ),
      }));
      setActiveProjectId(projectSnapshot.id);
      setTab("preview");
      setNotice(`${listings.length} hochwertige KI-Inserat${listings.length === 1 ? "" : "e"} wurden mit neuen Überschriften, interessanten Einstiegen und abwechslungsreichen Textprofilen erstellt und lokal geprüft.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Die KI-Texte konnten nicht erzeugt werden.");
    } finally {
      setGeneratingAi(false);
    }
  };

  const updateListing = (listingId: string, patch: Partial<GeneratedListing>) => {
    if (!activeProject) return;
    updateProject({
      listings: activeProject.listings.map((listing) =>
        listing.id === listingId ? { ...listing, ...patch } : listing,
      ),
    });
  };

  const updateListingText = (
    listingId: string,
    field: keyof GeneratedListing["texts"],
    value: string,
  ) => {
    const listing = activeProject?.listings.find((item) => item.id === listingId);
    if (!listing) return;
    updateListing(listingId, {
      texts: { ...listing.texts, [field]: value },
    });
  };

  const packageInputFor = (
    project: ProjectInput,
    listings: GeneratedListing[] = project.listings,
    publishToPortals = portalPublicationEnabled,
  ) => {
    if (listings.length === 0) {
      throw new Error("Es wurden noch keine Inserate erzeugt.");
    }
    const invalidImageCounts = listings
      .map((listing) => state.houses.find((house) => house.id === listing.templateId))
      .filter(
        (house) =>
          !house
          || house.images.length < MIN_HOUSE_IMAGES
          || house.images.length > MAX_HOUSE_IMAGES,
      )
      .map((house) => house ? `${house.name} (${house.images.length} Bilder)` : "Unbekannter Haustyp");
    if (invalidImageCounts.length) {
      throw new Error(
        `Für den Import werden pro Haustyp mindestens ${MIN_HOUSE_IMAGES} und maximal ${MAX_HOUSE_IMAGES} Bilder benötigt: ${invalidImageCounts.join(", ")}.`,
      );
    }
    if (
      !state.provider.company
      || !state.provider.email
    ) {
      throw new Error("Bitte Firma und E-Mail unter Export & Upload ergänzen.");
    }
    const providerNumber = FIXED_HV_PROVIDER_NUMBER;
    const invalidExternalIds = listings.filter(
      (listing) => !isProviderExternalId(listing.externalId, providerNumber),
    );
    const belongsToResumableLegacyRun = Boolean(
      state.totalSyncRun
      && totalSyncCanResume(state.totalSyncRun)
      && invalidExternalIds.length
      && listings.every((listing) => listing.totalSyncRunId === state.totalSyncRun?.id),
    );
    if (invalidExternalIds.length && !belongsToResumableLegacyRun) {
      throw new Error(
        `Die Objekt-ID muss mit deiner HV-/Anbieternummer beginnen (${providerNumber}-…). Bitte die KI-Texte und Inserate einmal neu erzeugen.`,
      );
    }
    return {
      project,
      listings,
      houses: state.houses,
      provider: state.provider,
      promotionImages: promotionPool(state),
      portalPublicationEnabled: publishToPortals,
    };
  };

  const packageInput = () => {
    if (!activeProject) throw new Error("Es wurde keine Grundstücksadresse ausgewählt.");
    return packageInputFor(activeProject);
  };

  const uploadBinaryPackage = async (
    blob: Blob,
    filename: string,
    position: string,
    onStatus: (status: string) => void,
  ): Promise<void> => {
    await new Promise<{
      ok?: boolean;
      message?: string;
      outcome?: UploadFailureOutcome;
    }>((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open("POST", "http://127.0.0.1:43182/upload-binary");
      request.setRequestHeader("Content-Type", "application/zip");
      request.setRequestHeader("X-FPI-Filename", encodeURIComponent(filename));
      request.setRequestHeader("X-FPI-Ftp-Host", encodeURIComponent(ftpHost));
      request.setRequestHeader("X-FPI-Ftp-User", encodeURIComponent(ftpUser));
      request.setRequestHeader("X-FPI-Ftp-Password", encodeURIComponent(ftpPassword));
      request.setRequestHeader("X-FPI-Ftp-Path", encodeURIComponent(ftpPath));
      request.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          const percentage = Math.min(100, Math.round((event.loaded / event.total) * 100));
          onStatus(percentage < 100
            ? `${position} · ZIP lokal: ${percentage} %`
            : `${position} · FTP-Transfer läuft …`);
        }
      };
      request.onerror = () => reject(new ListingUploadError(
        `Paket ${position}: Die Verbindung zum Upload-Helfer wurde während der Übertragung unterbrochen. Bitte den Eingang in Immoprofessional prüfen.`,
        "unknown",
      ));
      request.onabort = () => reject(new ListingUploadError(
        `Paket ${position}: Die Übertragung wurde ohne Bestätigung abgebrochen. Bitte den Eingang in Immoprofessional prüfen.`,
        "unknown",
      ));
      request.onload = () => {
        let responseData: {
          ok?: boolean;
          message?: string;
          outcome?: UploadFailureOutcome;
        } = {};
        try {
          responseData = JSON.parse(request.responseText) as {
            ok?: boolean;
            message?: string;
            outcome?: UploadFailureOutcome;
          };
        } catch {
          reject(new ListingUploadError(
            `Paket ${position}: Der Upload-Helfer hat nach der Übertragung keine lesbare Bestätigung gesendet. Bitte den Eingang in Immoprofessional prüfen.`,
            "unknown",
          ));
          return;
        }
        if (request.status < 200 || request.status >= 300 || !responseData.ok) {
          reject(new ListingUploadError(
            `Paket ${position}: ${responseData.message || `Upload fehlgeschlagen (HTTP ${request.status}).`}`,
            responseData.outcome === "unknown" ? "unknown" : "failed",
          ));
          return;
        }
        resolve(responseData);
      };
      request.send(blob);
    });
  };

  const uploadSingleListingPackage = async (input: {
    project: ProjectInput;
    listing: GeneratedListing;
    position: string;
    onStatus: (status: string) => void;
    portalPublicationEnabled?: boolean;
  }): Promise<void> => {
    const result = await buildImportPackage(
      packageInputFor(
        input.project,
        [input.listing],
        input.portalPublicationEnabled === true,
      ),
    );
    input.onStatus(`${input.position} · ${input.listing.templateName} wird einzeln übertragen …`);
    await uploadBinaryPackage(result.blob, result.filename, input.position, input.onStatus);
  };

  const transferManagementListing = async (listingId: string): Promise<void> => {
    const entry = findListing(state, listingId);
    if (!entry) {
      setNotice("Das ausgewählte Objekt wurde nicht gefunden.");
      return;
    }
    if (!helperOnline || !ftpUser || !ftpPassword) {
      setNotice("Bitte zuerst den lokalen Upload-Helfer starten und die FTP-Zugangsdaten unter Upload speichern.");
      return;
    }
    if (uploading || totalSyncBusy) {
      setNotice("Bitte zuerst die laufende Übertragung abschließen.");
      return;
    }
    setUploading(true);
    setUploadStatus(`${entry.listing.externalId} wird vorbereitet …`);
    try {
      const publishToPortals = Boolean(
        entry.listing.management?.released
        && entry.listing.management.portals.some((portal) => portal.enabled),
      );
      await uploadSingleListingPackage({
        project: entry.project,
        listing: entry.listing,
        position: `Objekt ${entry.listing.externalId}`,
        onStatus: setUploadStatus,
        portalPublicationEnabled: publishToPortals,
      });
      const uploadedAt = new Date().toISOString();
      setState((current) => {
        let next = mapListing(current, listingId, (listing) => {
          if (!listing.management) return { ...listing, uploadedAt };
          const management = {
            ...listing.management,
            updatedAt: uploadedAt,
            portals: listing.management.portals.map((portal) => (
              portal.enabled
                ? {
                    ...portal,
                    status: "transferred" as const,
                    lastTransferAt: uploadedAt,
                    message: "OpenImmo-Paket erfolgreich an Immoprofessional übertragen; Portalbestätigung steht aus.",
                  }
                : portal
            )),
          };
          return {
            ...listing,
            uploadedAt,
            management: {
              ...management,
              lifecycle: deriveListingLifecycle(management, uploadedAt),
            },
          };
        });
        next = appendAuditLog(next, {
          action: "Objekt übertragen",
          targetType: "listing",
          targetId: listingId,
          description: `${entry.listing.externalId} erfolgreich an Immoprofessional übertragen`,
        }, uploadedAt);
        return next;
      });
      setNotice(
        publishToPortals
          ? `${entry.listing.externalId} wurde übertragen und zur Portalweitergabe freigegeben. Bitte den Importbericht einlesen.`
          : `${entry.listing.externalId} wurde als nicht freigegebenes Objekt an Immoprofessional übertragen.`,
      );
    } catch (error) {
      const failedAt = new Date().toISOString();
      setState((current) => mapListing(current, listingId, (listing) => {
        if (!listing.management) return listing;
        const management = {
          ...listing.management,
          updatedAt: failedAt,
          portals: listing.management.portals.map((portal) => (
            portal.enabled
              ? {
                  ...portal,
                  status: "error" as const,
                  lastReportAt: failedAt,
                  message: error instanceof Error ? error.message : "Übertragung fehlgeschlagen.",
                }
              : portal
          )),
        };
        return {
          ...listing,
          management: {
            ...management,
            lifecycle: deriveListingLifecycle(management, listing.uploadedAt),
          },
        };
      }));
      setNotice(error instanceof Error ? error.message : "Das Objekt konnte nicht übertragen werden.");
    } finally {
      setUploading(false);
      setUploadStatus("");
    }
  };

  const deleteManagementListings = async (listingIds: string[]): Promise<void> => {
    const entries = listingIds
      .map((listingId) => findListing(state, listingId))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
    if (!entries.length) {
      setNotice("Für den Löschauftrag wurden keine gültigen Objekte gefunden.");
      return;
    }
    if (!helperOnline || !ftpUser || !ftpPassword) {
      setNotice("Bitte zuerst den lokalen Upload-Helfer starten und die FTP-Zugangsdaten unter Upload speichern.");
      return;
    }
    if (uploading || totalSyncBusy) {
      setNotice("Bitte zuerst die laufende Übertragung abschließen.");
      return;
    }
    setUploading(true);
    setUploadStatus("OpenImmo-Löschauftrag wird vorbereitet …");
    try {
      const result = await buildDeletePackage({
        externalIds: entries.map((entry) => entry.listing.externalId),
        provider: state.provider,
      });
      await uploadBinaryPackage(
        result.blob,
        result.filename,
        `${entries.length} Löschauftrag${entries.length === 1 ? "" : "e"}`,
        setUploadStatus,
      );
      const requestedAt = new Date().toISOString();
      setState((current) => {
        let next = current;
        entries.forEach(({ listing }) => {
          next = mapListing(next, listing.id, (currentListing) => {
            if (!currentListing.management) return currentListing;
            const management = {
              ...currentListing.management,
              released: false,
              updatedAt: requestedAt,
              portals: currentListing.management.portals.map((portal) => (
                portal.enabled
                  ? {
                      ...portal,
                      status: "delete-requested" as const,
                      lastTransferAt: requestedAt,
                      message: "OpenImmo-Löschauftrag übertragen; Bestätigung durch Importbericht steht aus.",
                    }
                  : portal
              )),
            };
            return {
              ...currentListing,
              management: {
                ...management,
                lifecycle: deriveListingLifecycle(management, currentListing.uploadedAt),
              },
            };
          });
        });
        return appendAuditLog(next, {
          action: "Löschauftrag übertragen",
          targetType: "listing",
          targetId: entries.map((entry) => entry.listing.id).join(","),
          description: `${entries.length} OpenImmo-DELETE-Auftrag${entries.length === 1 ? "" : "e"} an Immoprofessional übertragen`,
        }, requestedAt);
      });
      setNotice(`${entries.length} Löschauftrag${entries.length === 1 ? "" : "e"} wurden übertragen. Die Bestätigung erfolgt über den Importbericht.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Der Löschauftrag konnte nicht übertragen werden.");
    } finally {
      setUploading(false);
      setUploadStatus("");
    }
  };

  const downloadPackage = async () => {
    try {
      const result = await buildImportPackage(packageInput());
      if (helperOnline) {
        const response = await fetch("http://127.0.0.1:43182/save-package", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: result.filename,
            archiveBase64: await blobBase64(result.blob),
          }),
        });
        const data = (await response.json()) as { ok?: boolean; message?: string };
        if (!response.ok || !data.ok) throw new Error(data.message || "Speichern fehlgeschlagen.");
        setNotice(data.message || `Importpaket „${result.filename}“ wurde im Downloadordner gespeichert.`);
      } else {
        downloadBlob(result.blob, result.filename);
        setNotice(`Importpaket „${result.filename}“ wurde über den Browser heruntergeladen.`);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Importpaket konnte nicht erstellt werden.");
    }
  };

  const uploadPackage = async () => {
    if (!activeProject) return;
    if (!manualPreflightReport.canStart) {
      setNotice(
        manualPreflightReport.targetCount
          ? `Die Vorabprüfung sperrt den Upload: ${manualPreflightReport.blockerCount} Blocker müssen zuerst behoben werden.`
          : "Die Vorabprüfung benötigt zuerst eine Zieladresse.",
      );
      return;
    }
    if (!ftpUser || !ftpPassword) {
      setNotice("Bitte FTP-Benutzername und Passwort eingeben.");
      return;
    }
    if (!helperOnline) {
      setNotice("Der lokale Upload-Helfer ist nicht erreichbar. Bitte die Anwendung über den Startknopf öffnen.");
      return;
    }
    const confirmed = window.confirm(
      `${activeProject.listings.length} Inserat${activeProject.listings.length === 1 ? "" : "e"} jetzt an ${ftpHost} übertragen?\n\n`
      + (portalPublicationEnabled
        ? "AUTOMATISCHE PORTALVERÖFFENTLICHUNG IST AKTIV. Immoprofessional darf die Inserate nach dem Import an alle dort für das Objekt verbundenen Portale übertragen. Die genaue Objektadresse bleibt verborgen."
        : "Die Weitergabe an Portale ist im Paket deaktiviert. Die Inserate landen als nicht freigegebene Objekte in Immoprofessional."),
    );
    if (!confirmed) return;

    setUploading(true);
    setUploadStatus("Einzelpakete werden vorbereitet …");
    try {
      const input = packageInput();
      let workingState = state;
      const successfulUploadTimes: string[] = [];
      for (let index = 0; index < input.listings.length; index += 1) {
        const listing = input.listings[index];
        const position = `${index + 1}/${input.listings.length}`;
        await uploadSingleListingPackage({
          project: input.project,
          listing,
          position,
          onStatus: setUploadStatus,
          portalPublicationEnabled,
        });
        const uploadedAt = new Date().toISOString();
        successfulUploadTimes.push(uploadedAt);
        workingState = {
          ...workingState,
          projects: workingState.projects.map((project) => (
            project.id === input.project.id
              ? {
                  ...project,
                  listings: project.listings.map((item) => (
                    item.externalId === listing.externalId
                      ? { ...item, uploadedAt }
                      : item
                  )),
                }
              : project
          )),
        };
        setState(workingState);
        await saveStudioState(workingState, uploadedAt);
      }
      if (input.listings.length === TOTAL_SYNC_LISTINGS_PER_ADDRESS) {
        const renewedAt = successfulUploadTimes.slice().sort()[0];
        const completedAt = successfulUploadTimes.slice().sort().at(-1) ?? renewedAt;
        workingState = {
          ...workingState,
          projects: workingState.projects.map((project) => (
            project.id === input.project.id
              ? {
                  ...project,
                  lastRenewedAt: renewedAt,
                  renewalHistory: [
                    ...(project.renewalHistory ?? []),
                    {
                      runId: `manual-${crypto.randomUUID()}`,
                      renewedAt,
                      completedAt,
                      previousExternalIds: [],
                      externalIds: input.listings.map((listing) => listing.externalId),
                      houseIds: input.listings.map((listing) => listing.templateId),
                    },
                  ].slice(-52),
                }
              : project
          )),
        };
        setState(workingState);
        await saveStudioState(workingState, completedAt);
        if (helperOnline) {
          await queueWindowsCatalogSnapshot(workingState, completedAt).catch(() => undefined);
        }
      }
      setNotice(
        `${input.listings.length} getrennte Inseratpakete wurden an Immoprofessional übertragen. `
        + (portalPublicationEnabled
          ? "Die Portalweitergabe ist freigegeben. Bitte den Importbericht und den Onlinestatus des ersten Testobjekts prüfen."
          : "Die Portalweitergabe ist deaktiviert."),
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Upload fehlgeschlagen.");
    } finally {
      setUploading(false);
      setUploadStatus("");
    }
  };

  const replaceTotalSyncTask = (
    run: TotalSyncRun,
    projectId: string,
    patch: Partial<TotalSyncProjectTask>,
  ): TotalSyncRun => ({
    ...run,
    tasks: run.tasks.map((task) => (
      task.projectId === projectId ? { ...task, ...patch } : task
    )),
  });

  const saveTotalSyncCheckpoint = async (
    checkpoint: StudioState,
    includeWindowsBackup = false,
    updateInterface = true,
  ): Promise<void> => {
    const savedAt = new Date().toISOString();
    if (updateInterface) setState(checkpoint);
    await saveStudioState(checkpoint, savedAt);
    if (includeWindowsBackup && helperOnline) {
      try {
        await queueWindowsCatalogSnapshot(checkpoint, savedAt);
        setSaveLabel("Browser + Gerätesicherung aktuell");
      } catch {
        setSaveLabel("Fortschritt im Browser gespeichert");
      }
    }
  };

  const executeTotalSync = async (
    initialState: StudioState,
    runId: string,
    mode: TotalSyncAttemptMode = "continue",
  ): Promise<void> => {
    let workingState = normalizeJobCenterState(initialState);
    let run = workingState.totalSyncRun;
    if (!run || run.id !== runId) {
      setNotice("Der vorbereitete Totalabgleich wurde nicht gefunden.");
      return;
    }

    const attemptStartedAt = new Date().toISOString();
    const runAiModel = run.aiModel ?? aiModel;
    const progressBeforeAttempt = runJobProgress(run);
    totalSyncStopRequested.current = false;
    setTotalSyncStopping(false);
    setTotalSyncBusy(true);
    run = {
      ...run,
      status: "running",
      startedAt: run.startedAt ?? attemptStartedAt,
      updatedAt: attemptStartedAt,
      completedAt: undefined,
      aiModel: runAiModel,
      attempts: [
        ...(run.attempts ?? []),
        {
          startedAt: attemptStartedAt,
          mode,
          uploadedCount: 0,
          failedCount: 0,
        },
      ],
    };
    workingState = { ...workingState, totalSyncRun: run };
    let checkpointTail: Promise<void> = Promise.resolve();
    const saveRunCheckpoint = async (
      includeWindowsBackup = false,
    ): Promise<void> => {
      const snapshot = workingState;
      setState(snapshot);
      const operation = checkpointTail
        .catch(() => undefined)
        .then(() => saveTotalSyncCheckpoint(
          snapshot,
          includeWindowsBackup,
          false,
        ));
      checkpointTail = operation.catch(() => undefined);
      await operation;
    };

    const acceptedTitles = Array.from(new Set(
      workingState.projects.flatMap((project) => (
        collectedProjectHeadlineHistory(project)
          .map((title) => removePrivateAddressFromHeadline(title, project))
      )).filter(Boolean),
    ));

    const installRun = (nextRun: TotalSyncRun) => {
      run = nextRun;
      workingState = { ...workingState, totalSyncRun: run };
    };

    const installProject = (nextProject: ProjectInput) => {
      workingState = {
        ...workingState,
        projects: workingState.projects.map((project) => (
          project.id === nextProject.id ? nextProject : project
        )),
        totalSyncRun: run,
      };
    };

    const patchTask = (
      task: TotalSyncProjectTask,
      patch: Partial<TotalSyncProjectTask>,
    ): TotalSyncProjectTask => {
      const nextTask = { ...task, ...patch };
      installRun(replaceTotalSyncTask(run!, task.projectId, nextTask));
      return nextTask;
    };

    const patchJob = (
      task: TotalSyncProjectTask,
      externalId: string,
      patch: Partial<TotalSyncListingJob>,
    ): TotalSyncProjectTask => {
      const listingJobs = (task.listingJobs ?? []).map((job) => (
        job.externalId === externalId ? { ...job, ...patch } : job
      ));
      const uploadedExternalIds = Array.from(new Set([
        ...task.uploadedExternalIds,
        ...listingJobs
          .filter((job) => job.status === "uploaded")
          .map((job) => job.externalId),
      ]));
      const unresolved = listingJobs.find((job) => (
        job.status === "failed" || job.status === "unknown"
      ));
      return patchTask(task, {
        listingJobs,
        uploadedExternalIds,
        lastError: unresolved?.lastError,
      });
    };

    const taskFor = (projectId: string): TotalSyncProjectTask => (
      run!.tasks.find((task) => task.projectId === projectId)!
    );

    const finishRunAttempt = (
      nextRun: TotalSyncRun,
      completedAt: string,
    ): TotalSyncRun => {
      const progress = runJobProgress(nextRun);
      const attempts = [...(nextRun.attempts ?? [])];
      const attemptIndex = attempts.findLastIndex(
        (attempt) => attempt.startedAt === attemptStartedAt,
      );
      if (attemptIndex >= 0) {
        attempts[attemptIndex] = {
          ...attempts[attemptIndex],
          completedAt,
          uploadedCount: Math.max(0, progress.uploaded - progressBeforeAttempt.uploaded),
          failedCount: progress.failed,
        };
      }
      return { ...nextRun, attempts, updatedAt: completedAt };
    };

    const pauseAtCheckpoint = async (message: string): Promise<boolean> => {
      if (!totalSyncStopRequested.current) return false;
      const pausedAt = new Date().toISOString();
      installRun(finishRunAttempt({ ...run!, status: "paused" }, pausedAt));
      await saveRunCheckpoint(true);
      setTotalSyncStatus("Sicher angehalten");
      setNotice(message);
      return true;
    };

    const finalizeProjectForRun = (
      project: ProjectInput,
      task: TotalSyncProjectTask,
    ): ProjectInput => {
      if (!protectedProjectLocationMatches(project, task.protectedLocation)) {
        throw new Error(
          `Die echte Adresse oder Grundstücksfläche von „${project.name}“ wurde nach Vorbereitung des Laufs verändert. Der Lauf wurde zum Schutz der Grundstücksdaten angehalten.`,
        );
      }
      const runListings = project.listings.filter(
        (listing) => listing.totalSyncRunId === run!.id,
      );
      const uploadedTimes = runListings
        .map((listing) => listing.uploadedAt)
        .filter((value): value is string => Boolean(value))
        .sort();
      if (
        runListings.length !== task.houseIds.length
        || uploadedTimes.length !== task.houseIds.length
      ) {
        throw new Error(
          `Die Erneuerung für „${project.name}“ ist noch nicht vollständig protokolliert und wird nicht als abgeschlossen markiert.`,
        );
      }
      const renewedAt = uploadedTimes[0];
      const completedAt = uploadedTimes.at(-1) ?? renewedAt;
      const existingHistory = project.renewalHistory ?? [];
      const hasHistoryEntry = existingHistory.some((entry) => entry.runId === run!.id);
      return {
        ...project,
        selectedHouseIds: [...task.houseIds],
        promotionAssignments: task.promotionAssignments ?? project.promotionAssignments,
        listings: runListings,
        lastRenewedAt: renewedAt,
        lastTotalSyncAt: completedAt,
        renewalHistory: hasHistoryEntry
          ? existingHistory
          : [
              ...existingHistory,
              {
                runId: run!.id,
                renewedAt,
                completedAt,
                previousExternalIds: task.previousExternalIds ?? [],
                externalIds: runListings.map((listing) => listing.externalId),
                houseIds: [...task.houseIds],
              },
            ].slice(-52),
      };
    };

    try {
      await saveRunCheckpoint();
      for (let taskIndex = 0; taskIndex < run.tasks.length; taskIndex += 1) {
        let task = taskFor(run.tasks[taskIndex].projectId);
        let project = workingState.projects.find((item) => item.id === task.projectId);
        const runnableJobs = () => (
          (task.listingJobs ?? []).filter((job) => jobShouldRun(job, mode))
        );
        const markRunnableJobsFailed = async (
          message: string,
          stage: "validation" | "generation" | "upload" = "validation",
        ) => {
          for (const job of runnableJobs()) {
            const failedAt = new Date().toISOString();
            task = patchJob(task, job.externalId, {
              status: "failed",
              lastStage: stage,
              lastAttemptAt: failedAt,
              lastError: message,
              attempts: appendJobAttempt(job, {
                stage,
                startedAt: failedAt,
                completedAt: failedAt,
                succeeded: false,
                message,
              }),
            });
          }
          task = patchTask(task, { lastError: message });
          await saveRunCheckpoint();
        };

        if (!project) {
          await markRunnableJobsFailed(
            "Die gespeicherte Grundstücksadresse wurde nicht mehr gefunden.",
          );
          continue;
        }

        if (!protectedProjectLocationMatches(project, task.protectedLocation)) {
          await markRunnableJobsFailed(
            `Die geschützten Adress- oder Grundstücksdaten von „${project.name}“ wurden nach Vorbereitung des Laufs verändert.`,
          );
          continue;
        }

        if (
          (task.listingJobs?.length ?? 0) > 0
          && task.listingJobs!.every((job) => job.status === "uploaded")
        ) {
          try {
            project = finalizeProjectForRun(project, task);
            const completedAt = project.lastTotalSyncAt ?? new Date().toISOString();
            task = patchTask(task, { lastError: undefined, completedAt });
            installProject(project);
            await saveRunCheckpoint(true);
          } catch (error) {
            const message = error instanceof Error
              ? error.message
              : `„${project.name}“ konnte lokal nicht abgeschlossen werden.`;
            task = patchTask(task, { lastError: message });
            await saveRunCheckpoint();
          }
          continue;
        }

        const selectedTaskHouses = task.houseIds
          .map((houseId) => workingState.houses.find((house) => house.id === houseId))
          .filter((house): house is HouseTemplate => Boolean(house));
        const selectedHouseNames = selectedTaskHouses.map((house) => house.name);
        const headlineCycleId = `${run.id}-${project.id}`;

        if (!task.promotionAssignments) {
          const promotionImageIds = promotionPool(workingState).map((image) => image.id);
          const previousPromotionImageIds = new Set(
            Object.values(project.promotionAssignments ?? {}),
          );
          const freshPromotionImageIds = promotionImageIds.filter(
            (imageId) => !previousPromotionImageIds.has(imageId),
          );
          const requestedPromotionCount = run.promotionImageCount ?? 0;
          const promotionAssignments = randomPromotionAssignments(
            task.houseIds,
            run.kind === "seven-day"
              && freshPromotionImageIds.length >= requestedPromotionCount
              ? freshPromotionImageIds
              : promotionImageIds,
            requestedPromotionCount,
          );
          task = patchTask(task, { promotionAssignments });
          await saveRunCheckpoint();
        }

        const plannedExternalIds = (task.listingJobs ?? [])
          .filter((job) => jobShouldRun(job, mode))
          .map((job) => job.externalId);
        let pipelineFatalError: unknown;
        const pipelineResult = await runBoundedProductionPipeline({
          items: plannedExternalIds,
          shouldStop: () => (
            totalSyncStopRequested.current || pipelineFatalError !== undefined
          ),
          produce: async (externalId) => {
            try {
              let latestTask = taskFor(task.projectId);
              let latestJob = latestTask.listingJobs?.find(
                (item) => item.externalId === externalId,
              );
              const latestProject = workingState.projects.find(
                (item) => item.id === latestTask.projectId,
              );
              if (!latestJob || !latestProject) {
                throw new Error("Der vorbereitete Inseratauftrag wurde nicht mehr gefunden.");
              }
              const existingListing = latestProject.listings.find(
                (item) => (
                  item.totalSyncRunId === run!.id
                  && item.externalId === latestJob!.externalId
                ),
              );
              if (existingListing) return true;

              const house = workingState.houses.find(
                (item) => item.id === latestJob!.houseId,
              );
              if (!house) {
                const message = `Der Haustyp ${latestJob.houseId} für „${latestProject.name}“ wurde nicht gefunden.`;
                const failedAt = new Date().toISOString();
                latestTask = patchJob(latestTask, latestJob.externalId, {
                  status: "failed",
                  lastStage: "validation",
                  lastAttemptAt: failedAt,
                  lastError: message,
                  attempts: appendJobAttempt(latestJob, {
                    stage: "validation",
                    startedAt: failedAt,
                    completedAt: failedAt,
                    succeeded: false,
                    message,
                  }),
                });
                await saveRunCheckpoint();
                return false;
              }

              const generationStartedAt = new Date().toISOString();
              latestTask = patchJob(latestTask, latestJob.externalId, {
                status: "generating",
                lastStage: "generation",
                lastAttemptAt: generationStartedAt,
                lastError: undefined,
                attempts: appendJobAttempt(latestJob, {
                  stage: "generation",
                  startedAt: generationStartedAt,
                }),
              });
              await saveRunCheckpoint();
              const overallPosition = taskIndex * TOTAL_SYNC_LISTINGS_PER_ADDRESS
                + latestJob.slot;
              setTotalSyncStatus(
                `${overallPosition}/${run!.tasks.length * TOTAL_SYNC_LISTINGS_PER_ADDRESS} · ${latestProject.city} · KI-Texte für ${house.name}`,
              );

              const previousListingsForRequest = latestProject.listings.filter(
                (listing) => listing.totalSyncRunId !== run!.id,
              );
              const previous = previousListingsForRequest.find(
                (item) => item.templateId === house.id,
              );
              let accumulatedUsage = mergeAiUsage(
                emptyAiUsage(runAiModel),
                latestJob.aiUsage,
              );
              let result: {
                texts: ListingTexts;
                writingProfile: string;
                aiUsage: AiTokenUsage;
              } | null = null;
              try {
                for (
                  let diversityAttempt = 1;
                  diversityAttempt <= 3;
                  diversityAttempt += 1
                ) {
                  const candidate = await requestListingTexts({
                    project: latestProject,
                    house,
                    index: latestJob.slot - 1,
                    listingCount: latestTask.houseIds.length,
                    selectedHouseNames,
                    previous,
                    titlesToAvoid: acceptedTitles.slice(-60),
                    headlineCycleId,
                    maxAttempts: 4,
                    model: runAiModel,
                    shouldStop: () => totalSyncStopRequested.current,
                  });
                  accumulatedUsage = mergeAiUsage(
                    accumulatedUsage,
                    candidate.aiUsage,
                  );
                  const similarTitle = acceptedTitles.some((title) => (
                    headlinesAreTooSimilar(candidate.texts.title, title)
                  ));
                  if (!similarTitle) {
                    acceptedTitles.push(candidate.texts.title);
                    result = candidate;
                    break;
                  }
                  if (diversityAttempt === 3) {
                    throw new Error(
                      `Die KI konnte für „${latestProject.name}“ keine ausreichend neue Überschrift erzeugen.`,
                    );
                  }
                }
                if (!result) {
                  throw new Error(`Der KI-Text für „${house.name}“ fehlt.`);
                }
              } catch (error) {
                accumulatedUsage = mergeAiUsage(
                  accumulatedUsage,
                  (error as AiUsageError).aiUsage,
                );
                if ((error as AiUsageError).stopped) {
                  const stoppedAt = new Date().toISOString();
                  latestTask = taskFor(task.projectId);
                  latestJob = latestTask.listingJobs?.find(
                    (item) => item.externalId === externalId,
                  );
                  if (!latestJob) throw error;
                  patchJob(latestTask, latestJob.externalId, {
                    status: "pending",
                    lastStage: "generation",
                    lastAttemptAt: stoppedAt,
                    lastError: undefined,
                    aiUsage: accumulatedUsage,
                    attempts: appendJobAttempt(latestJob, {
                      stage: "generation",
                      startedAt: generationStartedAt,
                      completedAt: stoppedAt,
                      message: "Vor der nächsten KI-Anfrage sicher angehalten.",
                    }),
                  });
                  await saveRunCheckpoint();
                  return false;
                }
                const message = error instanceof Error
                  ? error.message
                  : `Der KI-Text für „${house.name}“ konnte nicht erzeugt werden.`;
                const failedAt = new Date().toISOString();
                latestTask = taskFor(task.projectId);
                latestJob = latestTask.listingJobs?.find(
                  (item) => item.externalId === externalId,
                );
                if (!latestJob) throw new Error(message);
                patchJob(latestTask, latestJob.externalId, {
                  status: "failed",
                  lastStage: "generation",
                  lastAttemptAt: failedAt,
                  lastError: message,
                  aiUsage: accumulatedUsage,
                  attempts: appendJobAttempt(latestJob, {
                    stage: "generation",
                    startedAt: generationStartedAt,
                    completedAt: failedAt,
                    succeeded: false,
                    message,
                  }),
                });
                await saveRunCheckpoint();
                return false;
              }

              const currentProject = workingState.projects.find(
                (item) => item.id === latestTask.projectId,
              );
              latestTask = taskFor(task.projectId);
              latestJob = latestTask.listingJobs?.find(
                (item) => item.externalId === externalId,
              );
              if (!currentProject || !latestJob) {
                throw new Error("Der Inseratauftrag wurde während der Texterstellung verändert.");
              }
              if (!protectedProjectLocationMatches(
                currentProject,
                latestTask.protectedLocation,
              )) {
                const message = `Die geschützten Grundstücksdaten von „${currentProject.name}“ wurden während der Texterstellung verändert.`;
                const failedAt = new Date().toISOString();
                patchJob(latestTask, latestJob.externalId, {
                  status: "failed",
                  lastStage: "validation",
                  lastAttemptAt: failedAt,
                  lastError: message,
                  aiUsage: accumulatedUsage,
                  attempts: appendJobAttempt(latestJob, {
                    stage: "validation",
                    startedAt: failedAt,
                    completedAt: failedAt,
                    succeeded: false,
                    message,
                  }),
                });
                await saveRunCheckpoint();
                return false;
              }

              const currentPreviousListings = currentProject.listings.filter(
                (listing) => listing.totalSyncRunId !== run!.id,
              );
              const currentRunListings = currentProject.listings.filter(
                (listing) => listing.totalSyncRunId === run!.id,
              );
              const currentPrevious = currentPreviousListings.find(
                (item) => item.templateId === house.id,
              );
              const nextVersion = Math.max(
                0,
                ...currentPreviousListings.map((listing) => listing.version),
              ) + 1;
              const listing: GeneratedListing = {
                id: uid(),
                externalId: latestJob.externalId,
                templateId: house.id,
                templateName: house.name,
                promotionImageId: latestTask.promotionAssignments?.[house.id],
                price: totalPrice(house, currentProject),
                texts: result.texts,
                writingProfile: result.writingProfile
                  || currentPrevious?.writingProfile,
                titleHistory: Array.from(new Set([
                  ...(currentPrevious?.titleHistory ?? []),
                  ...(currentPrevious?.texts.title
                    ? [currentPrevious.texts.title]
                    : []),
                ])).slice(-40),
                projectingSettings: fillMissingProjectingDefaults(
                  currentPrevious?.projectingSettings,
                ),
                totalSyncRunId: run!.id,
                version: currentPrevious
                  ? currentPrevious.version + 1
                  : nextVersion,
              };
              const mergedRunListings = [
                ...currentRunListings.filter(
                  (item) => item.externalId !== listing.externalId,
                ),
                listing,
              ].sort((left, right) => (
                left.externalId.localeCompare(right.externalId)
              ));
              installProject({
                ...currentProject,
                headlineHistory: collectedProjectHeadlineHistory(currentProject),
                listings: [
                  ...currentPreviousListings,
                  ...mergedRunListings,
                ],
              });
              const generatedAt = new Date().toISOString();
              latestTask = taskFor(task.projectId);
              latestJob = latestTask.listingJobs!.find(
                (item) => item.externalId === externalId,
              )!;
              latestTask = patchJob(latestTask, latestJob.externalId, {
                status: "ready",
                lastStage: "generation",
                lastAttemptAt: generatedAt,
                lastError: undefined,
                aiUsage: accumulatedUsage,
                attempts: appendJobAttempt(latestJob, {
                  stage: "generation",
                  startedAt: generationStartedAt,
                  completedAt: generatedAt,
                  succeeded: true,
                }),
              });
              const latestProjectAfterMerge = workingState.projects.find(
                (item) => item.id === latestTask.projectId,
              );
              patchTask(latestTask, {
                generated: latestTask.listingJobs!.every((item) => (
                  latestProjectAfterMerge?.listings.some(
                    (runListing) => (
                      runListing.totalSyncRunId === run!.id
                      && runListing.externalId === item.externalId
                    ),
                  )
                )),
              });
              await saveRunCheckpoint();
              return true;
            } catch (error) {
              pipelineFatalError = error;
              throw error;
            }
          },
          consume: async (outcome) => {
            try {
              if (outcome.status === "producer-failed") {
                throw outcome.error;
              }
              if (!outcome.value) return;

              const externalId = outcome.item;
              let latestTask = taskFor(task.projectId);
              let latestJob = latestTask.listingJobs?.find(
                (item) => item.externalId === externalId,
              );
              let latestProject = workingState.projects.find(
                (item) => item.id === latestTask.projectId,
              );
              let listing = latestProject?.listings.find((item) => (
                item.totalSyncRunId === run!.id
                && item.externalId === externalId
              ));
              if (
                !latestJob
                || !latestProject
                || !listing
                || latestJob.status === "uploaded"
                || latestJob.status === "unknown"
              ) return;

              const packageStartedAt = new Date().toISOString();
              let packageResult: Awaited<ReturnType<typeof buildImportPackage>>;
              try {
                packageResult = await buildImportPackage({
                  project: latestProject,
                  listings: [listing],
                  houses: workingState.houses,
                  provider: workingState.provider,
                  promotionImages: promotionPool(workingState),
                  portalPublicationEnabled: run!.portalPublicationEnabled === true,
                });
              } catch (error) {
                const message = error instanceof Error
                  ? error.message
                  : `Das Paket ${externalId} konnte nicht erstellt werden.`;
                const failedAt = new Date().toISOString();
                latestTask = taskFor(task.projectId);
                latestJob = latestTask.listingJobs?.find(
                  (item) => item.externalId === externalId,
                );
                if (!latestJob) throw error;
                patchJob(latestTask, externalId, {
                  status: "failed",
                  lastStage: "upload",
                  lastAttemptAt: failedAt,
                  lastError: message,
                  attempts: appendJobAttempt(latestJob, {
                    stage: "upload",
                    startedAt: packageStartedAt,
                    completedAt: failedAt,
                    succeeded: false,
                    message,
                  }),
                });
                await saveRunCheckpoint();
                return;
              }
              if (totalSyncStopRequested.current) return;

              latestTask = taskFor(task.projectId);
              latestJob = latestTask.listingJobs!.find(
                (item) => item.externalId === externalId,
              )!;
              latestProject = workingState.projects.find(
                (item) => item.id === latestTask.projectId,
              );
              listing = latestProject?.listings.find((item) => (
                item.totalSyncRunId === run!.id
                && item.externalId === externalId
              ));
              if (!latestProject || !listing) {
                throw new Error(`Das Inserat ${externalId} wurde vor dem Upload nicht mehr gefunden.`);
              }
              if (!protectedProjectLocationMatches(
                latestProject,
                latestTask.protectedLocation,
              )) {
                throw new Error(
                  `Die geschützten Grundstücksdaten von „${latestProject.name}“ wurden vor dem Upload verändert.`,
                );
              }

              const uploadStartedAt = packageStartedAt;
              const jobBeforeUpload = latestJob;
              latestTask = patchJob(latestTask, externalId, {
                status: "uploading",
                lastStage: "upload",
                lastAttemptAt: uploadStartedAt,
                lastError: undefined,
                attempts: appendJobAttempt(latestJob, {
                  stage: "upload",
                  startedAt: uploadStartedAt,
                }),
              });
              try {
                await saveRunCheckpoint();
              } catch (error) {
                patchJob(latestTask, externalId, jobBeforeUpload);
                throw error;
              }
              const overallPosition = taskIndex * TOTAL_SYNC_LISTINGS_PER_ADDRESS
                + latestJob.slot;
              const position = `${overallPosition}/${run!.tasks.length * TOTAL_SYNC_LISTINGS_PER_ADDRESS}`;
              setTotalSyncStatus(
                `${position} · ${latestProject.city} · ${listing.templateName}`,
              );

              try {
                setTotalSyncStatus(
                  `${position} · ${listing.templateName} wird einzeln übertragen …`,
                );
                await uploadBinaryPackage(
                  packageResult.blob,
                  packageResult.filename,
                  position,
                  setTotalSyncStatus,
                );
              } catch (error) {
                const message = error instanceof Error
                  ? error.message
                  : `Das Inserat ${externalId} konnte nicht übertragen werden.`;
                const failedAt = new Date().toISOString();
                const uploadOutcome: UploadFailureOutcome = error instanceof ListingUploadError
                  ? error.outcome
                  : "failed";
                latestTask = taskFor(task.projectId);
                latestJob = latestTask.listingJobs!.find(
                  (item) => item.externalId === externalId,
                )!;
                patchJob(latestTask, externalId, {
                  status: uploadOutcome,
                  lastStage: "upload",
                  lastAttemptAt: failedAt,
                  lastError: message,
                  attempts: appendJobAttempt(latestJob, {
                    stage: "upload",
                    startedAt: uploadStartedAt,
                    completedAt: failedAt,
                    succeeded: uploadOutcome === "failed" ? false : undefined,
                    message,
                  }),
                });
                await saveRunCheckpoint();
                return;
              }

              const uploadedAt = new Date().toISOString();
              latestProject = workingState.projects.find(
                (item) => item.id === task.projectId,
              );
              if (!latestProject) {
                throw new Error("Die Grundstücksadresse fehlt nach dem Upload.");
              }
              installProject({
                ...latestProject,
                listings: latestProject.listings.map((item) => (
                  item.externalId === externalId
                    ? { ...item, uploadedAt }
                    : item
                )),
              });
              latestTask = taskFor(task.projectId);
              latestJob = latestTask.listingJobs!.find(
                (item) => item.externalId === externalId,
              )!;
              patchJob(latestTask, externalId, {
                status: "uploaded",
                lastStage: "upload",
                lastAttemptAt: uploadedAt,
                uploadedAt,
                lastError: undefined,
                attempts: appendJobAttempt(latestJob, {
                  stage: "upload",
                  startedAt: uploadStartedAt,
                  completedAt: uploadedAt,
                  succeeded: true,
                }),
              });
              await saveRunCheckpoint();
            } catch (error) {
              pipelineFatalError = error;
              throw error;
            }
          },
        });
        if (pipelineFatalError !== undefined) throw pipelineFatalError;
        if (pipelineResult.stopped) {
          if (await pauseAtCheckpoint(
            "Der Lauf wurde nach den bereits gestarteten KI-Texten und dem aktuellen Einzelupload sicher angehalten.",
          )) return;
        }

        task = taskFor(task.projectId);
        project = workingState.projects.find((item) => item.id === task.projectId);
        if (
          project
          && (task.listingJobs?.length ?? 0) > 0
          && task.listingJobs!.every((job) => job.status === "uploaded")
        ) {
          try {
            project = finalizeProjectForRun(project, task);
            const completedAt = project.lastTotalSyncAt ?? new Date().toISOString();
            task = patchTask(task, { lastError: undefined, completedAt });
            installProject(project);
            await saveRunCheckpoint(true);
          } catch (error) {
            const message = error instanceof Error
              ? error.message
              : `„${project.name}“ konnte lokal nicht abgeschlossen werden.`;
            task = patchTask(task, { lastError: message });
            await saveRunCheckpoint();
          }
        }
      }

      const completedAt = new Date().toISOString();
      const progress = runJobProgress(run);
      const finalStatus = runCompletionStatus(run);
      run = finishRunAttempt({
        ...run,
        status: finalStatus,
        completedAt: finalStatus === "paused" ? undefined : completedAt,
      }, completedAt);
      const nextHistory = finalStatus === "paused"
        ? workingState.uploadRunHistory
        : upsertUploadRunHistory(
            workingState.uploadRunHistory,
            buildUploadRunHistoryEntry(
              run,
              workingState.projects,
              workingState.houses,
              finalStatus,
              completedAt,
            ),
          );
      workingState = {
        ...workingState,
        totalSyncRun: run,
        uploadRunHistory: nextHistory,
      };
      await saveRunCheckpoint(true);
      setTotalSyncStatus(
        finalStatus === "completed-with-errors"
          ? `${progress.uploaded} erfolgreich · ${progress.failed} fehlgeschlagen · ${progress.unknown} zu prüfen`
          : `${progress.uploaded}/${progress.total} einzeln übertragen`,
      );
      if (run.kind === "seven-day" && finalStatus === "completed") {
        setSelectedRenewalProjectIds([]);
      }
      if (finalStatus === "completed-with-errors") {
        setNotice(
          `${run.kind === "seven-day" ? "7-Tage-Erneuerung" : "Totalabgleich"} beendet: ${progress.uploaded} Inserate waren erfolgreich, ${progress.failed} sind fehlgeschlagen${progress.unknown ? ` und ${progress.unknown} müssen in Immoprofessional geprüft werden` : ""}. Alle anderen Adressen wurden weiterverarbeitet. Im Auftragszentrum kannst du nur die Fehler erneut übertragen.`,
        );
      } else if (finalStatus === "paused") {
        setNotice("Der Lauf bleibt mit offenen Inseraten sicher gespeichert und kann fortgesetzt werden.");
      } else {
        setNotice(
          `${run.kind === "seven-day" ? "7-Tage-Erneuerung" : "Totalabgleich"} abgeschlossen: ${progress.uploaded} neue Inserate wurden einzeln an Immoprofessional übertragen.`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Der Totalabgleich wurde unterbrochen.";
      const stoppedAt = new Date().toISOString();
      run = finishRunAttempt(
        { ...interruptedRun(run), status: "paused" },
        stoppedAt,
      );
      workingState = { ...workingState, totalSyncRun: run };
      await saveRunCheckpoint(true).catch(() => undefined);
      setTotalSyncStatus("Sicherheitsstopp · kann fortgesetzt werden");
      setNotice(
        `Der Lauf wurde wegen eines übergeordneten Fehlers sicher angehalten: ${message} Erfolgreiche Inserate werden nicht erneut übertragen.`,
      );
    } finally {
      setTotalSyncBusy(false);
      setTotalSyncStopping(false);
      totalSyncStopRequested.current = false;
    }
  };

  const automatedUploadReadinessError = (): string | null => {
    if (!looksLikeOpenAiApiKey(openAiKey)) {
      return "Bitte zuerst einen gültigen OpenAI API-Schlüssel speichern.";
    }
    if (!ftpUser || !ftpPassword) {
      return "Bitte zuerst die Immoprofessional-Zugangsdaten speichern.";
    }
    if (!helperOnline) {
      return helperNeedsRestart
        ? "Der lokale Helfer muss vor dem Totalabgleich neu gestartet werden."
        : "Der lokale Helfer ist nicht erreichbar.";
    }
    if (
      !state.provider.company
      || !state.provider.email
    ) {
      return "Bitte Firma und E-Mail unter Export & Upload ergänzen.";
    }
    return null;
  };

  const startOrResumeTotalSync = async () => {
    if (totalSyncBusy) return;
    if (!totalSyncPreflightReport.canStart) {
      setNotice(
        totalSyncPreflightReport.targetCount
          ? `Die Vorabprüfung sperrt den Start: ${totalSyncPreflightReport.blockerCount} Blocker müssen zuerst behoben werden.`
          : "Im gewählten Adressbuch wurde keine Zieladresse für die Vorabprüfung gefunden.",
      );
      return;
    }
    const readinessError = automatedUploadReadinessError();
    if (readinessError) {
      setNotice(readinessError);
      return;
    }

    if (resumableTotalSync && state.totalSyncRun) {
      await executeTotalSync(state, state.totalSyncRun.id);
      return;
    }
    if (totalSyncEligibleHouses.length < TOTAL_SYNC_LISTINGS_PER_ADDRESS) {
      setNotice(
        `Für den Totalabgleich werden mindestens ${TOTAL_SYNC_LISTINGS_PER_ADDRESS} Haustypen mit jeweils ${MIN_HOUSE_IMAGES} bis ${MAX_HOUSE_IMAGES} Bildern benötigt. Aktuell sind ${totalSyncEligibleHouses.length} geeignet.`,
      );
      return;
    }
    if (!totalSyncReadyProjects.length) {
      setNotice("Für den gewählten Benutzer wurde keine vollständige Grundstücksadresse gefunden.");
      return;
    }
    if (totalSyncPromotionCount > promotionPool(state).length) {
      setNotice(
        `Für ${totalSyncPromotionCount} Aktionsbilder pro Adresse werden mindestens ${totalSyncPromotionCount} unterschiedliche Bilder im zentralen Pool benötigt.`,
      );
      return;
    }

    const totalListings = totalSyncReadyProjects.length * TOTAL_SYNC_LISTINGS_PER_ADDRESS;
    const scopeLabel = totalSyncScope === "all"
      ? "Fabian und Pascal"
      : totalSyncScope === "pascal" ? "Pascal" : "Fabian";
    const confirmed = window.confirm(
      `Totalabgleich für ${scopeLabel} starten?\n\n`
      + `${totalSyncReadyProjects.length} vollständige Adressen × ${TOTAL_SYNC_LISTINGS_PER_ADDRESS} Haustypen = ${totalListings} neue Inserate. Pro Adresse werden mindestens ein Einfamilienhaus, ein Bungalow und ein Zweifamilienhaus ausgelost; der vierte Haustyp wird zusätzlich zufällig gewählt.\n\n`
      + `${totalSyncPromotionCount === 0
        ? "Die Inserate werden ohne Aktionsbilder erstellt."
        : `${totalSyncPromotionCount} von 4 Inseraten jeder Adresse erhalten ein zufälliges Aktionsbild auf Position 1.`}\n\n`
      + `${portalPublicationEnabled
        ? "AUTOMATISCHE PORTALVERÖFFENTLICHUNG IST AKTIV. Alle neuen Inserate dürfen nach dem Import an die in Immoprofessional verbundenen Portale übertragen werden. Die genaue Adresse bleibt verborgen."
        : "Die Portalveröffentlichung bleibt deaktiviert; die Inserate werden nur in Immoprofessional importiert."}\n\n`
      + "Für jedes Inserat werden neue KI-Texte und eine neue Überschrift erzeugt. Anschließend wird jedes Inserat als eigenes Paket nacheinander an Immoprofessional übertragen – niemals als Sammelpaket.\n\n"
      + `${totalSyncSkippedProjects ? `${totalSyncSkippedProjects} unvollständige Adressentwürfe werden übersprungen.\n\n` : ""}`
      + "Bitte erst bestätigen, wenn die bisherigen Anzeigen in Immoprofessional gelöscht wurden. Der Vorgang verwendet OpenAI-Guthaben und kann bei vielen Inseraten mehrere Stunden dauern.",
    );
    if (!confirmed) return;

    const run = createTotalSyncRun({
      projects: state.projects,
      eligibleHouses: totalSyncEligibleHouses.map((house) => ({
        id: house.id,
        houseType: house.houseType,
      })),
      scope: totalSyncScope,
      providerNumber: FIXED_HV_PROVIDER_NUMBER,
      existingExternalIds: collectedStateExternalIds(state),
      promotionImageCount: totalSyncPromotionCount,
      portalPublicationEnabled,
      aiModel,
      runId: uid(),
      createdAt: new Date().toISOString(),
    });
    const nextState = { ...state, totalSyncRun: run };
    await executeTotalSync(nextState, run.id);
  };

  const changeRenewalScope = (scope: TotalSyncScope) => {
    if (totalSyncBusy || resumableTotalSync) return;
    setRenewalScope(scope);
    setSelectedRenewalProjectIds([]);
  };

  const toggleRenewalProject = (projectId: string) => {
    if (totalSyncBusy || resumableTotalSync) return;
    setSelectedRenewalProjectIds((current) => (
      current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId]
    ));
  };

  const selectRenewalProjects = (projectIds: string[]) => {
    if (totalSyncBusy || resumableTotalSync) return;
    setSelectedRenewalProjectIds(Array.from(new Set(projectIds)));
  };

  const clearRenewalSelection = () => {
    if (totalSyncBusy || resumableTotalSync) return;
    setSelectedRenewalProjectIds([]);
  };

  const openRenewalProject = (projectId: string) => {
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) return;
    setActiveOwner(projectOwner(project));
    setActiveProjectId(project.id);
    setTab("project");
    setNotice(
      addressEditingLocked
        ? `„${project.name}“ ist geöffnet. Die Grundstücksdaten bleiben bis zum Abschluss des gespeicherten Uploadlaufs geschützt.`
        : `„${project.name}“ wurde aus der 7-Tage-Zentrale geöffnet.`,
    );
  };

  const startSevenDayRenewal = async (
    explicitProjectIds?: string[],
  ): Promise<void> => {
    if (totalSyncBusy) return;
    if (resumableTotalSync && state.totalSyncRun) {
      if (!activeRunIsSevenDay) {
        setNotice("Bitte zuerst den gespeicherten Totalabgleich abschließen oder verwerfen.");
        return;
      }
      if (!renewalPreflightReport.canStart) {
        setNotice(
          `Die Vorabprüfung sperrt die Fortsetzung: ${renewalPreflightReport.blockerCount} Blocker müssen zuerst behoben werden.`,
        );
        return;
      }
      await executeTotalSync(state, state.totalSyncRun.id);
      return;
    }

    const requestedIds = Array.from(new Set(
      explicitProjectIds?.length ? explicitProjectIds : selectedRenewalProjectIds,
    ));
    const requestedProjects = state.projects.filter(
      (project) => requestedIds.includes(project.id),
    );
    if (!requestedProjects.length) {
      setNotice("Bitte zuerst mindestens eine Grundstücksadresse auswählen.");
      return;
    }
    const requestedPreflight = buildSevenDayPreflight(requestedProjects);
    if (!requestedPreflight.canStart) {
      setSelectedRenewalProjectIds(requestedIds);
      setNotice(
        `Die Vorabprüfung sperrt die Erneuerung: ${requestedPreflight.blockerCount} Blocker müssen zuerst behoben werden.`,
      );
      return;
    }

    const readinessError = automatedUploadReadinessError();
    if (readinessError) {
      setNotice(readinessError);
      return;
    }
    if (totalSyncEligibleHouses.length < TOTAL_SYNC_LISTINGS_PER_ADDRESS) {
      setNotice(
        `Für die 7-Tage-Erneuerung werden mindestens ${TOTAL_SYNC_LISTINGS_PER_ADDRESS} geeignete Haustypen mit jeweils ${MIN_HOUSE_IMAGES} bis ${MAX_HOUSE_IMAGES} Bildern benötigt.`,
      );
      return;
    }
    if (renewalEffectivePromotionCount > promotionPool(state).length) {
      setNotice("Für die gewählte Anzahl fehlen Aktionsbilder im zentralen Pool.");
      return;
    }

    const selectedProjects = requestedProjects.filter(projectIsReadyForTotalSync);
    if (!selectedProjects.length) {
      setNotice("Bitte zuerst mindestens eine vollständige Grundstücksadresse auswählen.");
      return;
    }

    const insufficientReplacement = selectedProjects.find((project) => {
      const previousHouseIds = new Set([
        ...project.selectedHouseIds,
        ...project.listings.map((listing) => listing.templateId),
      ]);
      return totalSyncEligibleHouses.filter((house) => !previousHouseIds.has(house.id)).length
        < TOTAL_SYNC_LISTINGS_PER_ADDRESS;
    });
    if (insufficientReplacement) {
      setNotice(
        `Für „${insufficientReplacement.name}“ stehen nicht vier vollständig neue Haustypen mit passenden Bildern zur Verfügung.`,
      );
      return;
    }

    const totalListings = selectedProjects.length * TOTAL_SYNC_LISTINGS_PER_ADDRESS;
    const previousObjectCount = selectedProjects.reduce(
      (sum, project) => sum + project.listings.length,
      0,
    );
    const confirmed = window.confirm(
      `7-Tage-Erneuerung für ${selectedProjects.length} Adresse${selectedProjects.length === 1 ? "" : "n"} starten?\n\n`
      + `${totalListings} neue Inserate werden einzeln erstellt und übertragen. Jede Adresse erhält vier andere Haustypen, neue Haus- und Aktionsbilder, neue KI-Texte, neue Überschriften und vier neue Objekt-IDs.\n\n`
      + "GESCHÜTZT UND UNVERÄNDERT: Projektname, Straße, Hausnummer, PLZ, Ort, Ortsteil, Grundstücksfläche, Grundstückspreis, Nebenkosten und geprüfte Lageangaben.\n\n"
      + `${portalPublicationEnabled
        ? "AUTOMATISCHE PORTALVERÖFFENTLICHUNG IST AKTIV."
        : "Die Inserate werden nur in Immoprofessional importiert."}\n\n`
      + `${previousObjectCount} bisherige Objekt-ID${previousObjectCount === 1 ? "" : "s"} sind in den ausgewählten Adressen gespeichert. `
      + "Neue Objekt-IDs löschen alte Anzeigen nicht automatisch.\n\n"
      + "Bitte nur bestätigen, wenn die bisherigen Anzeigen dieser Adressen in Immoprofessional gelöscht wurden. Der Vorgang verwendet OpenAI-Guthaben.",
    );
    if (!confirmed) return;

    try {
      const run = createTotalSyncRun({
        projects: state.projects,
        eligibleHouses: totalSyncEligibleHouses.map((house) => ({
          id: house.id,
          houseType: house.houseType,
        })),
        scope: renewalScope,
        providerNumber: FIXED_HV_PROVIDER_NUMBER,
        existingExternalIds: collectedStateExternalIds(state),
        projectIds: selectedProjects.map((project) => project.id),
        kind: "seven-day",
        promotionImageCount: renewalEffectivePromotionCount,
        portalPublicationEnabled,
        aiModel,
        runId: uid(),
        createdAt: new Date().toISOString(),
      });
      setSelectedRenewalProjectIds(selectedProjects.map((project) => project.id));
      const nextState = { ...state, totalSyncRun: run };
      await executeTotalSync(nextState, run.id);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Die 7-Tage-Erneuerung konnte nicht vorbereitet werden.");
    }
  };

  const stopTotalSync = () => {
    totalSyncStopRequested.current = true;
    setTotalSyncStopping(true);
    setTotalSyncStatus("Wird nach den laufenden KI- und Uploadschritten sicher angehalten …");
  };

  const discardTotalSyncRun = async () => {
    if (!state.totalSyncRun || totalSyncBusy) return;
    const currentRun = state.totalSyncRun;
    const runLabel = currentRun.kind === "seven-day"
      ? "7-Tage-Erneuerung"
      : "Totalabgleich";
    const progress = runJobProgress(currentRun);
    const unresolved = progress.pending + progress.ready + progress.active
      + progress.failed + progress.unknown;
    if (!window.confirm(
      `Gespeicherte ${runLabel} archivieren und schließen?\n\n`
      + `${progress.uploaded} Inserate sind erfolgreich. ${unresolved} Inserate sind noch offen, fehlgeschlagen oder ungeklärt.\n\n`
      + (unresolved
        ? "WICHTIG: Nach dem Schließen können diese offenen Inserate aus der Historie nicht mehr erneut übertragen werden.\n\n"
        : "")
      + "Bereits zu Immoprofessional übertragene Inserate werden dadurch nicht gelöscht.",
    )) return;
    setTotalSyncPromotionCount(currentRun.promotionImageCount ?? 0);
    if (currentRun.kind === "seven-day") {
      setRenewalPromotionCount(currentRun.promotionImageCount ?? 0);
    }
    const archivedAt = new Date().toISOString();
    const historyStatus = currentRun.status === "completed"
      ? "completed"
      : currentRun.status === "completed-with-errors"
        ? "completed-with-errors"
        : "discarded";
    const historyEntry = buildUploadRunHistoryEntry(
      currentRun,
      state.projects,
      state.houses,
      historyStatus,
      archivedAt,
    );
    const nextState = {
      ...state,
      totalSyncRun: undefined,
      uploadRunHistory: upsertUploadRunHistory(
        state.uploadRunHistory,
        historyEntry,
      ),
    };
    await saveTotalSyncCheckpoint(nextState, true);
    setTotalSyncStatus("");
    setNotice(`Die gespeicherte ${runLabel} wurde im Auftragszentrum archiviert und geschlossen. Bereits übertragene Inserate bleiben in Immoprofessional erhalten.`);
  };

  const retryFailedJobs = async () => {
    if (!state.totalSyncRun || totalSyncBusy) return;
    const progress = runJobProgress(state.totalSyncRun);
    if (!progress.failed) {
      setNotice("Im aktuellen Lauf gibt es keine fehlgeschlagenen Inserate.");
      return;
    }
    const readinessError = automatedUploadReadinessError();
    if (readinessError) {
      setNotice(readinessError);
      return;
    }
    await executeTotalSync(state, state.totalSyncRun.id, "failed-only");
  };

  const continueOpenJobs = async () => {
    if (!state.totalSyncRun || totalSyncBusy) return;
    const readinessError = automatedUploadReadinessError();
    if (readinessError) {
      setNotice(readinessError);
      return;
    }
    await executeTotalSync(state, state.totalSyncRun.id, "continue");
  };

  const markUnknownJobFailed = async (
    projectId: string,
    externalId: string,
  ) => {
    if (!state.totalSyncRun || totalSyncBusy) return;
    if (!window.confirm(
      `Objekt ${externalId} wirklich zur Wiederholung freigeben?\n\n`
      + "Bitte nur bestätigen, wenn du in Immoprofessional geprüft hast, dass dieses Objekt dort NICHT angekommen ist. Andernfalls könnte eine doppelte Anzeige entstehen.",
    )) return;
    const changedAt = new Date().toISOString();
    const message = "Nach manueller Prüfung in Immoprofessional zur Wiederholung freigegeben.";
    let nextRun = replaceTotalSyncListingJob(
      state.totalSyncRun,
      projectId,
      externalId,
      {
        status: "failed",
        lastStage: "upload",
        lastAttemptAt: changedAt,
        lastError: message,
      },
    );
    const changedTask = nextRun.tasks.find((task) => task.projectId === projectId);
    if (changedTask) {
      nextRun = replaceTotalSyncTask(nextRun, projectId, {
        ...changedTask,
        lastError: message,
      });
    }
    const nextStatus = runCompletionStatus(nextRun);
    nextRun = {
      ...nextRun,
      status: nextStatus,
      updatedAt: changedAt,
      completedAt: nextStatus === "paused" ? undefined : changedAt,
    };
    const nextState = {
      ...state,
      totalSyncRun: nextRun,
      uploadRunHistory: nextStatus === "paused"
        ? state.uploadRunHistory
        : upsertUploadRunHistory(
            state.uploadRunHistory,
            buildUploadRunHistoryEntry(
              nextRun,
              state.projects,
              state.houses,
              "completed-with-errors",
              changedAt,
            ),
          ),
    };
    await saveTotalSyncCheckpoint(nextState, true);
    setNotice(`Objekt ${externalId} ist jetzt als fehlgeschlagen markiert und kann gezielt erneut übertragen werden.`);
  };

  const openJobProject = (projectId: string) => {
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) {
      setNotice("Die zu diesem Auftrag gespeicherte Adresse ist nicht mehr vorhanden.");
      return;
    }
    setActiveOwner(projectOwner(project));
    setActiveProjectId(project.id);
    setTab("project");
    setNotice(
      `„${project.name}“ wurde aus dem Auftragszentrum geöffnet.${addressEditingLocked ? " Die geschützten Grundstücksdaten bleiben bis zum Abschluss des Laufs gesperrt." : ""}`,
    );
  };

  const handleRenewalPrimaryAction = () => {
    if (totalSyncBusy) {
      stopTotalSync();
      return;
    }
    void startSevenDayRenewal();
  };

  const handleRenewalOne = (projectId: string) => {
    void startSevenDayRenewal([projectId]);
  };

  const handleDiscardRenewalRun = () => {
    void discardTotalSyncRun();
  };

  const changePortalPublication = (enabled: boolean) => {
    if (totalSyncBusy || uploading || resumableTotalSync) {
      setNotice("Der Veröffentlichungsmodus kann erst nach Abschluss oder Verwerfen des gespeicherten Uploadlaufs geändert werden.");
      return;
    }
    if (enabled && !window.confirm(
      "Automatische Portalveröffentlichung aktivieren?\n\n"
      + "Neue Uploads dürfen nach dem Import von Immoprofessional automatisch an alle dort für das Objekt verbundenen Portale übertragen werden. "
      + "Die genaue Objektadresse bleibt weiterhin verborgen.\n\n"
      + "Bitte zuerst genau ein Testinserat übertragen und dessen Onlinestatus prüfen.",
    )) return;
    setState((current) => ({ ...current, portalPublicationEnabled: enabled }));
    setNotice(enabled
      ? "Automatische Portalveröffentlichung ist aktiviert und wird gespeichert. Der nächste Upload darf nach dem Import online gestellt werden."
      : "Portalveröffentlichung ist deaktiviert. Neue Uploads werden nur in Immoprofessional importiert.");
  };

  const clearSavedCredentials = async () => {
    if (!helperOnline) {
      setNotice("Der lokale Helfer ist nicht erreichbar.");
      return;
    }
    try {
      setCredentialsReady(false);
      const response = await fetch("http://127.0.0.1:43182/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear: true }),
      });
      const data = (await response.json()) as { ok?: boolean; message?: string };
      if (!response.ok || !data.ok) throw new Error(data.message || "Löschen fehlgeschlagen.");
      setOpenAiKey("");
      setOpenAiKeyVerified(false);
      setFtpUser("");
      setFtpPassword("");
      setCredentialSaveLabel("Gespeicherte Zugangsdaten wurden entfernt");
      setNotice("OpenAI- und Immoprofessional-Zugangsdaten wurden aus dem verschlüsselten Gerätetresor entfernt.");
    } catch (error) {
      setCredentialsReady(true);
      setNotice(error instanceof Error ? error.message : "Zugangsdaten konnten nicht gelöscht werden.");
    }
  };

  const saveCredentialsNow = async () => {
    if (!helperOnline) {
      setNotice("Der lokale Helfer ist nicht erreichbar.");
      return;
    }
    setSavingCredentials(true);
    try {
      if (openAiKey.trim()) {
        if (!looksLikeOpenAiApiKey(openAiKey)) {
          throw new Error("Der eingegebene Wert ist kein OpenAI API-Schlüssel. Bitte den vollständigen Schlüssel einfügen; er beginnt mit sk-.");
        }
        const validationResponse = await fetch("http://127.0.0.1:43182/validate-openai-key", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey: openAiKey.trim() }),
        });
        const validationData = (await validationResponse.json()) as { ok?: boolean; valid?: boolean; message?: string };
        if (!validationResponse.ok || !validationData.ok || !validationData.valid) {
          throw new Error(validationData.message || "OpenAI konnte den API-Schlüssel nicht bestätigen.");
        }
      }
      const response = await fetch("http://127.0.0.1:43182/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credentials: {
            openAiKey,
            aiModel,
            ftpHost,
            ftpUser,
            ftpPassword,
            ftpPath,
          },
        }),
      });
      const data = (await response.json()) as { ok?: boolean; message?: string };
      if (!response.ok || !data.ok) throw new Error(data.message || "Speichern fehlgeschlagen.");
      setCredentialsReady(true);
      setOpenAiKeyVerified(Boolean(openAiKey.trim()));
      setCredentialSaveLabel(openAiKey.trim() ? "OpenAI-Schlüssel geprüft und verschlüsselt gespeichert" : "Zugangsdaten sind verschlüsselt gespeichert");
      setNotice(openAiKey.trim()
        ? "Der OpenAI API-Schlüssel wurde erfolgreich geprüft. Überschrift und alle vier Inserattexte werden gemeinsam von der KI erzeugt."
        : "Die Immoprofessional-Zugangsdaten wurden verschlüsselt gespeichert.");
    } catch (error) {
      setCredentialSaveLabel("Zugangsdaten konnten nicht gespeichert werden");
      setNotice(error instanceof Error ? error.message : "Zugangsdaten konnten nicht gespeichert werden.");
    } finally {
      setSavingCredentials(false);
    }
  };

  const exportCatalog = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: "application/json",
    });
    downloadBlob(blob, `inserate-studio-sicherung-${new Date().toISOString().slice(0, 10)}.json`);
  };

  const importCatalog = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(String(reader.result)) as StudioState;
        if (imported.version !== 1 || !Array.isArray(imported.houses)) {
          throw new Error("Unbekanntes Sicherungsformat.");
        }
        const normalizedBase = normalizeJobCenterState(normalizeProjectOwners(imported));
        const normalized = {
          ...normalizedBase,
          provider: {
            ...normalizedBase.provider,
            providerNumber: FIXED_HV_PROVIDER_NUMBER,
          },
        };
        const migratedExternalIds = migrateDraftExternalIds(
          normalized.projects,
          FIXED_HV_PROVIDER_NUMBER,
          collectedStateExternalIds(normalized),
        );
        const importedWithHvIds = normalizeStudioManagementState({
          ...normalized,
          projects: migratedExternalIds.projects,
        });
        const next = importedWithHvIds.projects.length
          ? importedWithHvIds
          : { ...importedWithHvIds, projects: [newProject("fabian")] };
        setState(next);
        selectActiveHouse(next.houses[0]?.id ?? "");
        setActiveProjectId(next.projects[0]?.id ?? "");
        setActiveOwner(projectOwner(next.projects[0]));
        setTotalSyncScope(
          totalSyncCanResume(next.totalSyncRun) && next.totalSyncRun
            ? next.totalSyncRun.scope
            : projectOwner(next.projects[0]),
        );
        setTotalSyncPromotionCount(
          totalSyncCanResume(next.totalSyncRun) && next.totalSyncRun
            ? next.totalSyncRun.promotionImageCount ?? 0
            : 0,
        );
        if (next.totalSyncRun?.kind === "seven-day") {
          setRenewalScope(next.totalSyncRun.scope);
          setRenewalPromotionCount(next.totalSyncRun.promotionImageCount ?? 0);
          setSelectedRenewalProjectIds(next.totalSyncRun.tasks.map((task) => task.projectId));
        } else {
          setSelectedRenewalProjectIds([]);
        }
        setNotice(
          migratedExternalIds.changedCount
            ? `Inserate-Studio-Sicherung wurde eingelesen; ${migratedExternalIds.changedCount} Entwurfs-Objekt-ID${migratedExternalIds.changedCount === 1 ? "" : "s"} wurden auf ${FIXED_HV_PROVIDER_NUMBER}-… umgestellt.`
            : "Inserate-Studio-Sicherung wurde lokal eingelesen.",
        );
      } catch {
        setNotice("Die ausgewählte Datei ist keine gültige Inserate-Studio-Sicherung.");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  if (cloudAccessError) {
    return (
      <main className="loading-screen access-denied-screen">
        <AppVersionBadge />
        <div className="loading-mark">IS</div>
        <h1>Zugriff noch nicht freigeschaltet</h1>
        <p>{cloudAccessError}</p>
        <a className="primary" href="/signout-with-chatgpt?return_to=%2F">
          Mit einem anderen Konto anmelden
        </a>
      </main>
    );
  }

  if (isPrimaryTab === false) {
    return (
      <main className="loading-screen duplicate-tab-screen">
        <AppVersionBadge />
        <div className="loading-mark">IS</div>
        <h1>Inserate Studio ist bereits geöffnet</h1>
        <p>Bitte nur einen Inserate-Studio-Tab verwenden. Schließe den anderen Tab; dieser Tab wird danach automatisch freigeschaltet.</p>
      </main>
    );
  }

  if (isPrimaryTab !== true || !ready || !activeProject || !activeHouse) {
    return (
      <main className="loading-screen">
        <AppVersionBadge />
        <div className="loading-mark">IS</div>
        <p>Inserate Studio wird vorbereitet …</p>
      </main>
    );
  }

  return (
    <main className="studio-shell">
      <AppVersionBadge />
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">IS</div>
          <div>
            <strong>Inserate Studio</strong>
            <span>AI-gestützte Objektverwaltung</span>
          </div>
        </div>
        <div className="topbar-account">
          <div
            className={`storage-pill ${visibleSaveStatus.tone}`}
            title={`${saveLabel} · ${cloudSession ? CLOUD_STORAGE_LABEL : `${STORAGE_ID} · lokale Rückfallebene`}`}
          >
            <i />
            <span>
              <b>{visibleSaveStatus.label}</b>
              <small>{saveLabel}</small>
            </span>
          </div>
          {cloudSession ? (
            <div className="session-pill">
              <span>{cloudSession.name}</span>
              <small>
                {cloudSession.role === "admin"
                  ? "Administration"
                  : cloudSession.role === "editor"
                    ? "Bearbeitung"
                    : "Nur lesen"}
                {` · ${BUSINESS_ROLE_LABELS[currentBusinessRole]}`}
              </small>
              <a href="/signout-with-chatgpt?return_to=%2F">Abmelden</a>
            </div>
          ) : null}
        </div>
      </header>

      <nav className="main-navigation" aria-label="Hauptnavigation">
        {([
          ["overview", "Übersicht", "Aufgaben und Status"],
          ["management", "Objekte", "Objektbestand und Anlage"],
          ["houses", "Vorlagen & Medien", "Haustypen und Medienbibliothek"],
          ["renewal", "Aufträge", "Erneuerungen, Läufe und Fehler"],
          ["settings", "Administration", "Organisation und Schnittstellen"],
        ] as Array<[Tab, string, string]>)
          .filter(([id]) => {
            if (id === "settings") return canAdminister;
            if (managementReadOnly) return id === "overview" || id === "management";
            if (id === "houses") return canUseLibrary;
            if (id === "renewal") return canUseWork;
            return true;
          })
          .map(([id, label, description]) => (
          <button
            type="button"
            key={id}
            className={mainSectionForTab(id) === activeMainSection ? "active" : ""}
            aria-current={mainSectionForTab(id) === activeMainSection ? "page" : undefined}
            title={description}
            onClick={() => selectWorkspaceTab(id)}
          >
            <span>{label}</span>
            <small>{description}</small>
          </button>
        ))}
      </nav>

      {activeMainSection === "objects" && !managementReadOnly && canUseBatchObjectTools ? (
        <nav className="context-navigation" aria-label="Objektwerkzeuge">
          {([
            ["management", "Objektbestand"],
            ["project", "Grundstück + 4 Inserate"],
            ["preview", "Textentwürfe"],
          ] as Array<[Tab, string]>).map(([id, label]) => (
            <button type="button" key={id} className={tab === id ? "active" : ""} onClick={() => selectWorkspaceTab(id)}>{label}</button>
          ))}
        </nav>
      ) : null}

      {activeMainSection === "work" ? (
        <nav className="context-navigation" aria-label="Auftragswerkzeuge">
          <button type="button" className={tab === "renewal" ? "active" : ""} onClick={() => selectWorkspaceTab("renewal")}>7-Tage-Zentrale</button>
          <button type="button" className={tab === "jobs" ? "active" : ""} onClick={() => selectWorkspaceTab("jobs")}>Läufe & Fehler</button>
        </nav>
      ) : null}

      {activeMainSection === "administration" ? (
        <nav className="context-navigation" aria-label="Administration">
          <button type="button" className={adminView === "organization" ? "active" : ""} onClick={() => setAdminView("organization")}>Organisation & Benutzer</button>
          <button type="button" className={adminView === "connections" ? "active" : ""} onClick={() => setAdminView("connections")}>Schnittstellen & Sicherung</button>
        </nav>
      ) : null}

      {activeMainSection !== "overview" ? (
        <section className="section-context-header">
          <div>
            <span className="eyebrow">
              {activeMainSection === "objects"
                ? "Objektarbeit"
                : activeMainSection === "library"
                  ? "Inhaltsbibliothek"
                  : activeMainSection === "work"
                    ? "Automatisierung"
                    : "Systemverwaltung"}
            </span>
            <h1>
              {activeMainSection === "objects"
                ? "Objekte sinnvoll vom Entwurf bis zum Portal führen"
                : activeMainSection === "library"
                  ? "Vorlagen und Medien zentral vorbereiten"
                  : activeMainSection === "work"
                    ? "Aufträge, Erneuerungen und Fehler im Blick behalten"
                    : "Inserate Studio sicher verwalten"}
            </h1>
          </div>
          {activeMainSection === "objects" && !managementReadOnly ? (
            <button type="button" className="primary" onClick={openObjectCreation}>+ Neues Objekt</button>
          ) : null}
        </section>
      ) : null}

      {notice ? (
        <div className="notice" role="status">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} aria-label="Hinweis schließen">×</button>
        </div>
      ) : null}

      {cloudConflictRevision !== null ? (
        <div className="notice cloud-conflict" role="alert">
          <span>
            Auf einem anderen Gerät wurde inzwischen eine neuere Version gespeichert.
            Deine lokale Fassung bleibt erhalten, bis du dich entscheidest.
          </span>
          <div className="button-row">
            <button className="secondary" type="button" onClick={() => void loadCurrentCloudVersion()}>
              Neueste Cloud-Version laden
            </button>
            <button className="danger" type="button" onClick={() => void overwriteCloudVersion()}>
              Meine Fassung übernehmen
            </button>
          </div>
        </div>
      ) : null}

      {tab === "overview" ? (
        <StudioDashboard
          state={state}
          role={currentRole}
          renewalEntries={renewalEntries}
          openJobCount={openJobCount}
          onCreateObject={openObjectCreation}
          onOpenObjects={openObjectCenter}
          onOpenListing={openManagementListing}
          onOpenRenewals={() => selectWorkspaceTab("renewal")}
          onOpenJobs={() => selectWorkspaceTab("jobs")}
          onOpenLibrary={() => selectWorkspaceTab("houses")}
          onOpenMember={openMemberObjects}
          canUseLibrary={canUseLibrary}
          canUseWork={canUseWork}
        />
      ) : null}

      {tab === "management" ? (
        <ManagementCenter
          key={`objects-${managementCreateRequest}-${requestedListingId}-${requestedAssigneeId}`}
          state={state}
          setState={setState}
          uploadAvailable={helperOnline && Boolean(ftpUser && ftpPassword)}
          busy={uploading || totalSyncBusy}
          onTransferListing={transferManagementListing}
          onDeleteListings={deleteManagementListings}
          notify={setNotice}
          authenticatedUser={cloudSession}
          mode="objects"
          createRequestId={managementCreateRequest}
          requestedListingId={requestedListingId}
          requestedAssigneeId={requestedAssigneeId}
        />
      ) : null}

      {tab === "houses" ? (
        <>
        <section className={`workspace promotion-card ${promotionPoolOpen ? "expanded" : "collapsed"}`}>
          <div className="promotion-copy">
            <span className="eyebrow">Zentraler Aktionsbild-Pool</span>
            <h2>Bis zu {MAX_PROMOTION_IMAGES} Aktionsbilder</h2>
            <p>Bei jeder Adresse entscheidest du, ob 0 bis 4 Inserate ein zufällig ausgewähltes Aktionsbild erhalten. Es steht im Export immer auf Position 1; die Hausvorlagen bleiben unverändert.</p>
          </div>
          <div className="promotion-pool-header">
            <b>{promotionPool(state).length}/{MAX_PROMOTION_IMAGES} gespeichert</b>
            <button
              className="secondary promotion-pool-toggle"
              type="button"
              aria-expanded={promotionPoolOpen}
              aria-controls="promotion-pool-content"
              onClick={() => setPromotionPoolOpen((open) => !open)}
            >
              {promotionPoolOpen ? "Aktionspool schließen" : "Aktionspool öffnen"}
            </button>
          </div>
          {promotionPoolOpen ? (
            <div className="promotion-pool-content" id="promotion-pool-content">
              <div className="button-row promotion-pool-actions">
                <label className={`secondary file-label${promotionPool(state).length >= MAX_PROMOTION_IMAGES ? " disabled" : ""}`}>
                  Aktionsbilder hinzufügen
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    disabled={promotionPool(state).length >= MAX_PROMOTION_IMAGES}
                    onChange={addPromotionImages}
                  />
                </label>
                <button className="primary" disabled={savingHouses} onClick={saveHousesNow}>
                  {savingHouses ? "Wird gespeichert …" : "Aktionsbild-Pool speichern"}
                </button>
              </div>
              {promotionPool(state).length ? (
                <div className="promotion-pool-grid">
                  {promotionPool(state).map((image, index) => (
                    <article className="promotion-pool-item" key={image.id}>
                      <div className="promotion-pool-image">
                        <span>{index + 1}</span>
                        <img src={image.dataUrl} alt={image.caption || image.name} />
                      </div>
                      <label className="image-caption">
                        <span>Bildtext im Inserat</span>
                        <input
                          value={image.caption}
                          onChange={(event) => updatePromotionImage(image.id, { caption: event.target.value })}
                        />
                      </label>
                      <button className="text-danger" onClick={() => removePromotionImage(image.id)}>Entfernen</button>
                    </article>
                  ))}
                </div>
              ) : (
                <label className="promotion-upload">
                  <span>+</span>
                  <b>Aktionsbilder einfügen</b>
                  <small>Mehrfachauswahl möglich · JPEG, PNG oder WebP</small>
                  <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={addPromotionImages} />
                </label>
              )}
            </div>
          ) : null}
        </section>
        <section className="workspace integrated-catalog-card">
          <details>
            <summary>
              <span>
                <span className="eyebrow">Direkt in der App</span>
                <b>Vollständige hinterlegte Preisliste</b>
              </span>
              <strong>{HOUSE_PRICE_ENTRIES.length} Hauspreise</strong>
            </summary>
            <div className="integrated-price-grid">
              {HOUSE_PRICE_ENTRIES.map((entry) => (
                <div key={entry.key}>
                  <span>{entry.houseType}</span>
                  <b>{entry.label}</b>
                  <strong>{euro(entry.price)}</strong>
                </div>
              ))}
            </div>
          </details>
        </section>
        <section className="workspace two-column">
          <aside className="rail-card">
            <div className="section-heading compact">
              <div><span className="eyebrow">Hausbibliothek</span><h2>Deine {MAX_HOUSE_TEMPLATES} Haustypen</h2></div>
              <button className="icon-button" onClick={addHouse} aria-label="Haustyp hinzufügen">+</button>
            </div>
            <div className="house-list">
              {activeHouses.map((house, index) => (
                <button
                  key={house.id}
                  className={house.id === activeHouse.id ? "house-row active" : "house-row"}
                  onClick={() => selectActiveHouse(house.id)}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div><strong>{house.name}</strong><small>{house.livingArea} m² · {house.images.length}/{MAX_HOUSE_IMAGES} Bilder · mindestens {MIN_HOUSE_IMAGES}</small></div>
                </button>
              ))}
            </div>
            <button className="primary full house-save-button" disabled={savingHouses} onClick={saveHousesNow}>{savingHouses ? "Wird gespeichert …" : "Haustypen & Bilder speichern"}</button>
            <small className="rail-save-status">{saveLabel}</small>
            <button className="secondary full" onClick={addHouse}>Haustyp hinzufügen</button>
          </aside>

          <div className="content-card">
            <div className="section-heading">
              <div><span className="eyebrow">Vorlage bearbeiten</span><h2>{activeHouse.name}</h2></div>
              <button className="text-danger" onClick={removeHouse}>Vorlage löschen</button>
            </div>
            <div className="form-grid three">
              <Field label="Name des Haustyps" value={activeHouse.name} onChange={(value) => updateHouse({ name: value })} />
              <Field label="Objektart" value={activeHouse.houseType} onChange={(value) => updateHouse({ houseType: value })} />
              <Field label="Hauspreis" type="number" min={0} value={activeHouse.housePrice} suffix="€" onChange={(value) => updateHouse({ housePrice: Number(value) })} />
              <Field label="Wohnfläche" type="number" min={0} value={activeHouse.livingArea} suffix="m²" onChange={(value) => updateHouse({ livingArea: Number(value) })} />
              <Field label="Zimmer" type="number" min={0} value={activeHouse.rooms} onChange={(value) => updateHouse({ rooms: Number(value) })} />
              <Field label="Etagen" type="number" min={0} value={activeHouse.floors} onChange={(value) => updateHouse({ floors: Number(value) })} />
              <Field label="Schlafzimmer" type="number" min={0} value={activeHouse.bedrooms} onChange={(value) => updateHouse({ bedrooms: Number(value) })} />
              <Field label="Badezimmer" type="number" min={0} value={activeHouse.bathrooms} onChange={(value) => updateHouse({ bathrooms: Number(value) })} />
              <Field label="Baujahr geplant" type="number" value={activeHouse.constructionYear} onChange={(value) => updateHouse({ constructionYear: Number(value) })} />
              <Field label="Endenergiebedarf" type="number" min={0} value={activeHouse.energyDemand} suffix="kWh/(m²·a)" onChange={(value) => updateHouse({ energyDemand: Number(value) })} />
              <Field label="Energieklasse" value={activeHouse.energyClass} onChange={(value) => updateHouse({ energyClass: value })} />
              <Field label="Heizungsart" value={activeHouse.heatingType} onChange={(value) => updateHouse({ heatingType: value })} />
              <TextField label="Architektur & Grundriss" rows={3} value={activeHouse.architecture} onChange={(value) => updateHouse({ architecture: value })} />
              <TextField label="Ausstattungsmerkmale" rows={3} value={activeHouse.equipmentHighlights} onChange={(value) => updateHouse({ equipmentHighlights: value })} />
              <label className="standard-package field-wide">
                <input
                  type="checkbox"
                  checked={activeHouse.useStandardPackage !== false}
                  onChange={(event) => updateHouse({ useStandardPackage: event.target.checked })}
                />
                <span>
                  <b>Standardbausteine aus den Exposé-Vorlagen verwenden</b>
                  <small>Traumküche, Bau-Cockpit, I-KON, Zuhause-Darlehen, Zuhause-Paket, DIY-Coaching sowie die beschriebenen Garantie- und Serviceleistungen. Vor dem Import je Haustyp prüfen.</small>
                </span>
              </label>
            </div>
            {activeHousePriceMatch ? (
              <div className="price-catalog-card">
                <div>
                  <span className="eyebrow">Preisliste</span>
                  <b>{activeHousePriceMatch.label}: {euro(activeHousePriceMatch.price)}</b>
                  <small>
                    {activeHouse.housePrice === activeHousePriceMatch.price
                      ? "Der gespeicherte Hauspreis entspricht der hinterlegten Preisliste."
                      : `Der vorhandene Hauspreis ${euro(activeHouse.housePrice)} bleibt bestehen, bis du die Übernahme bestätigst.`}
                  </small>
                </div>
                {activeHouse.housePrice !== activeHousePriceMatch.price ? (
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => {
                      updateHouse({ housePrice: activeHousePriceMatch.price });
                      setNotice(
                        `${activeHousePriceMatch.label}: ${euro(activeHousePriceMatch.price)} wurde bewusst aus der Preisliste übernommen.`,
                      );
                    }}
                  >
                    Preis übernehmen
                  </button>
                ) : (
                  <span className="status online">Preis aktuell</span>
                )}
              </div>
            ) : null}

            <div className="image-section">
              <div className="section-heading compact">
                <div>
                  <span className="eyebrow">Bildrollen &amp; Reihenfolge</span>
                  <h3>{MIN_HOUSE_IMAGES} bis {MAX_HOUSE_IMAGES} Bilder je Haustyp</h3>
                  <small className="section-note">Die hinterlegten Bildrollen und festen Bildüberschriften sind integriert. Die Position lässt sich weiterhin jederzeit ändern.</small>
                </div>
                <div className="button-row image-heading-actions">
                  <button className="secondary" onClick={toggleMediaLibrary}>
                    {mediaLibraryOpen ? "Medienbibliothek schließen" : "Integrierte Medienbibliothek"}
                  </button>
                  <button
                    className="secondary"
                    disabled={!activeHouse.images.some((image) => !image.role)}
                    onClick={classifyExistingImages}
                  >
                    Vorhandene Bilder zuordnen
                  </button>
                  <button
                    className="secondary"
                    disabled={!activeHouse.images.some((image) => image.role && image.role !== "other")}
                    onClick={normalizeImageSequence}
                  >
                    Nach Bildrollen sortieren
                  </button>
                  <button
                    className="secondary"
                    disabled={replacingAllImageCaptions || captioningImageIds.length > 0 || !activeHouses.some((house) => house.images.length > 0)}
                    onClick={replaceAllExistingImageCaptions}
                  >
                    {replacingAllImageCaptions ? "Vorhandene Bildtexte werden erneuert …" : "Alle vorhandenen Bildtexte erneuern"}
                  </button>
                  <label className={activeHouse.images.length >= MAX_HOUSE_IMAGES ? "upload-button disabled" : "upload-button"}>
                    Bilder auswählen
                    <input type="file" accept="image/*" multiple disabled={activeHouse.images.length >= MAX_HOUSE_IMAGES} onChange={addImages} />
                  </label>
                </div>
              </div>
              {mediaLibraryOpen ? (
                <section
                  className="media-library"
                  aria-label="Integrierte Medienbibliothek"
                  aria-busy={mediaLibraryBusy}
                >
                  <div className="media-library-intro">
                    <div>
                      <b>Haus-, Innenraum-, Grundriss- und Vertrauensbilder</b>
                        <span>Alle hinterlegten Haus-, Innenraum-, Grundriss-, Standort- und Vertrauensbilder sind direkt in der App verfügbar. Eine passende SUN-/SOL-Hausansicht kann die komplette Bildfolge automatisch zusammenstellen.</span>
                    </div>
                    <strong>{mediaLibraryTotal} Treffer</strong>
                  </div>
                  <div className="media-library-management">
                    <label className="media-library-management-field">
                      <span>Neue Bilder als</span>
                      <select
                        value={mediaLibraryUploadKind}
                        disabled={mediaLibraryBusy}
                        onChange={(event) => (
                          setMediaLibraryUploadKind(event.target.value as MediaLibraryKind)
                        )}
                        aria-label="Bildart für neue Medien"
                      >
                        <option value="house">Hausansicht</option>
                        <option value="floorplan">Grundriss</option>
                        <option value="interior">Innenraum</option>
                        <option value="location">Standort</option>
                        <option value="marketing">Allgemeine Anzeige</option>
                      </select>
                    </label>
                    <label className="media-library-management-field">
                      <span>Gruppe (optional)</span>
                      <input
                        value={mediaLibraryUploadGroup}
                        disabled={mediaLibraryBusy}
                        maxLength={80}
                        placeholder="z. B. SUN 144 oder Küchen"
                        onChange={(event) => setMediaLibraryUploadGroup(event.target.value)}
                      />
                    </label>
                    <label
                      className={mediaLibraryBusy ? "upload-button disabled" : "upload-button"}
                      aria-disabled={mediaLibraryBusy}
                    >
                      {addingMediaLibraryItems ? "Bilder werden hinzugefügt …" : "Neue Bilder hinzufügen"}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        multiple
                        disabled={mediaLibraryBusy}
                        onChange={addMediaLibraryFiles}
                      />
                    </label>
                  </div>
                  <div className="media-duplicate-tools">
                    <div>
                      <b>Dubletten sicher bereinigen</b>
                      <span>
                        Findet bytegenau identische Bilder innerhalb derselben Bildart und Gruppe.
                        Vor dem Löschen wählst du pro Gruppe das Original aus.
                      </span>
                    </div>
                    <button
                      className="secondary"
                      type="button"
                      disabled={mediaLibraryBusy}
                      onClick={() => void scanMediaLibraryDuplicates()}
                    >
                      {scanningMediaDuplicates ? "Dubletten werden geprüft …" : "Dubletten prüfen"}
                    </button>
                  </div>
                  {mediaLibraryMutationStatus ? (
                    <div className="media-library-status" role="status" aria-live="polite">
                      {mediaLibraryMutationStatus}
                    </div>
                  ) : null}
                  {mediaDuplicateGroups.length ? (
                    <section
                      className="media-duplicate-panel"
                      aria-label="Gefundene Mediendubletten"
                    >
                      <header>
                        <div>
                          <span>Dublettenprüfung</span>
                          <strong>
                            {mediaDuplicateDeleteIds.length} überzählige Bilder in{" "}
                            {mediaDuplicateGroups.length} Gruppen
                          </strong>
                          <small>
                            {mediaDuplicateManagedCount} eigene Dateien ·{" "}
                            {mediaBytes(mediaDuplicateManagedBytes)} physisch löschbar
                            {mediaDuplicateReferencedCount
                              ? ` · ${mediaDuplicateReferencedCount} bestehende Zuordnungen bleiben erhalten`
                              : ""}
                          </small>
                        </div>
                        <button
                          className="media-duplicate-delete-button"
                          type="button"
                          disabled={mediaLibraryBusy || !mediaDuplicateDeleteIds.length}
                          onClick={() => void cleanupMediaLibraryDuplicates()}
                        >
                          {deletingMediaDuplicates
                            ? "Dubletten werden bereinigt …"
                            : `${mediaDuplicateDeleteIds.length} Dubletten löschen`}
                        </button>
                      </header>
                      <div className="media-duplicate-groups">
                        {mediaDuplicateGroups.map((group, groupIndex) => {
                          const keepId = (
                            mediaDuplicateKeepIds[group.id] || group.recommendedKeepId
                          );
                          return (
                            <fieldset className="media-duplicate-group" key={group.id}>
                              <legend>
                                Gruppe {groupIndex + 1}: {MEDIA_KIND_LABELS[group.kind]} ·{" "}
                                {group.group} · {group.items.length} identische Bilder
                              </legend>
                              <div className="media-duplicate-preview">
                                <img
                                  src={group.items[0].imageUrl}
                                  alt=""
                                  loading="lazy"
                                />
                                <span>
                                  Identischer Bildinhalt · je {mediaBytes(group.bytes)}
                                </span>
                              </div>
                              <div className="media-duplicate-choices">
                                {group.items.map((item) => {
                                  const kept = item.id === keepId;
                                  return (
                                    <label
                                      className={`media-duplicate-choice${kept ? " kept" : " removing"}`}
                                      key={item.id}
                                    >
                                      <input
                                        type="radio"
                                        name={`duplicate-keeper-${group.id}`}
                                        checked={kept}
                                        disabled={mediaLibraryBusy}
                                        onChange={() => setMediaDuplicateKeepIds((current) => ({
                                          ...current,
                                          [group.id]: item.id,
                                        }))}
                                      />
                                      <span>
                                        <b>{item.filename}</b>
                                        <small title={item.relativePath}>
                                          {item.managed ? "Eigenes Bild" : "Integrierte Quelle"}
                                          {item.referenceCount
                                            ? ` · ${item.referenceCount}× verwendet`
                                            : " · nicht verwendet"}
                                          {" · "}{item.relativePath}
                                        </small>
                                      </span>
                                      <em>{kept ? "Original bleibt" : "wird gelöscht"}</em>
                                    </label>
                                  );
                                })}
                              </div>
                            </fieldset>
                          );
                        })}
                      </div>
                    </section>
                  ) : null}
                  <form
                    className="media-library-toolbar"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void loadMediaLibrary(1);
                    }}
                  >
                    <input
                      value={mediaLibraryQuery}
                      onChange={(event) => setMediaLibraryQuery(event.target.value)}
                      placeholder="Suche, z. B. Sun 144, Küche oder Borkheide"
                      aria-label="Medien durchsuchen"
                      disabled={mediaLibraryBusy}
                    />
                    <select
                      value={mediaLibraryGroup}
                      onChange={(event) => setMediaLibraryGroup(event.target.value)}
                      aria-label="Bildgruppe filtern"
                      disabled={mediaLibraryBusy}
                    >
                      <option value="">Alle Gruppen</option>
                      {mediaLibraryGroups.map((group) => (
                        <option key={group.name} value={group.name}>
                          {group.name} ({group.count})
                        </option>
                      ))}
                    </select>
                    <select
                      value={mediaLibraryKind}
                      onChange={(event) => (
                        setMediaLibraryKind(event.target.value as "" | MediaLibraryKind)
                      )}
                      aria-label="Bildart filtern"
                      disabled={mediaLibraryBusy}
                    >
                      <option value="">Alle Bildarten</option>
                      <option value="house">Hausansichten</option>
                      <option value="interior">Innenräume</option>
                      <option value="floorplan">Grundrisse</option>
                      <option value="location">Standortanzeigen</option>
                      <option value="marketing">Allgemeine Anzeigen</option>
                    </select>
                    <button className="secondary" type="submit" disabled={mediaLibraryBusy}>
                      Filtern
                    </button>
                  </form>

                  {!mediaLibraryAvailable ? (
                    <div className="media-library-message">
                      Die integrierten Medien sind nicht erreichbar. Bitte im App-Ordner <code>git lfs pull</code> ausführen oder einen externen Pfad über <code>FPI_MEDIA_LIBRARY_ROOT</code> konfigurieren.
                    </div>
                  ) : mediaLibraryError ? (
                    <div className="media-library-message error">{mediaLibraryError}</div>
                  ) : mediaLibraryLoading ? (
                    <div className="media-library-message">Medien werden indexiert …</div>
                  ) : mediaLibraryItems.length ? (
                    <div className="media-library-grid">
                      {mediaLibraryItems.map((item) => {
                        const selected = selectedMediaItems.some(
                          (selectedItem) => selectedItem.id === item.id,
                        );
                        const alreadyImported = activeHouse.images.some(
                          (image) => image.sourceId === item.id,
                        );
                        const deleting = deletingMediaItemIds.includes(item.id);
                        return (
                          <article
                            key={item.id}
                            className={`media-library-card${selected ? " selected" : ""}${alreadyImported ? " imported" : ""}${deleting ? " deleting" : ""}`}
                            title={item.relativePath}
                          >
                            <button
                              className="media-library-select"
                              type="button"
                              onClick={() => toggleMediaSelection(item)}
                              disabled={mediaLibraryBusy || (alreadyImported && item.kind !== "house")}
                              aria-pressed={selected}
                              aria-label={`${item.caption} auswählen`}
                            >
                              <img src={item.imageUrl} alt="" loading="lazy" />
                              <span className="media-selection-mark" aria-hidden="true">
                                {alreadyImported || selected ? "✓" : "+"}
                              </span>
                              <span className="media-kind">{MEDIA_KIND_LABELS[item.kind]}</span>
                              <strong>{item.caption}</strong>
                              <small>{item.group}</small>
                            </button>
                            <button
                              className="media-library-delete"
                              type="button"
                              disabled={mediaLibraryBusy}
                              onClick={() => void deleteMediaLibraryItem(item)}
                              aria-label={`${item.caption} dauerhaft aus der Medienbibliothek löschen`}
                              title="Dauerhaft aus der Medienbibliothek löschen"
                            >
                              <span aria-hidden="true">×</span>
                            </button>
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="media-library-message">
                      Für diese Filter wurden keine Bilder gefunden.
                    </div>
                  )}

                  <div className="media-library-footer">
                    <div className="media-pagination">
                      <button
                        className="secondary"
                        type="button"
                        disabled={mediaLibraryBusy || mediaLibraryPage <= 1}
                        onClick={() => void loadMediaLibrary(mediaLibraryPage - 1)}
                      >
                        Zurück
                      </button>
                      <span>Seite {mediaLibraryPage} von {mediaLibraryPages}</span>
                      <button
                        className="secondary"
                        type="button"
                        disabled={mediaLibraryBusy || mediaLibraryPage >= mediaLibraryPages}
                        onClick={() => void loadMediaLibrary(mediaLibraryPage + 1)}
                      >
                        Weiter
                      </button>
                    </div>
                    <div className="button-row">
                      <button
                        className="secondary"
                        type="button"
                        disabled={
                          selectedMediaItems.length !== 1
                          || selectedMediaItems[0]?.kind !== "house"
                          || mediaLibraryBusy
                        }
                        onClick={buildAutomaticImageSequence}
                      >
                        {importingMedia ? "Bildfolge wird geladen …" : "Komplette Bildfolge erstellen"}
                      </button>
                      <button
                        className="primary"
                        type="button"
                        disabled={
                          !selectedMediaItems.length
                          || mediaLibraryBusy
                          || activeHouse.images.length >= MAX_HOUSE_IMAGES
                        }
                        onClick={importSelectedMedia}
                      >
                        {importingMedia
                          ? "iCloud-Bilder werden übernommen …"
                          : `${selectedMediaItems.length} ausgewählte Bilder übernehmen`}
                      </button>
                    </div>
                  </div>
                </section>
              ) : null}
              {activeHouse.images.length ? (
                <div className="image-grid">
                  {activeHouse.images.map((image, index) => (
                    <article className="image-card" key={image.id}>
                      <img src={image.dataUrl} alt={image.caption} />
                      <div className="image-order">{String(index + 1).padStart(2, "0")}</div>
                      <label className="image-caption">
                        <span>{image.captionLocked ? "Feste Bildüberschrift" : captioningImageIds.includes(image.id) ? "Passender Bildtext wird verfeinert …" : "Variabler Bildtext"}</span>
                        <input disabled={image.captionLocked} value={image.caption} onChange={(event) => updateImage(image.id, { caption: event.target.value })} aria-label={`Bildbeschreibung ${index + 1}`} />
                      </label>
                      <div className="image-position">
                        <label>
                          <span>Position</span>
                          <select
                            value={index}
                            onChange={(event) => moveImage(image.id, Number(event.target.value))}
                            aria-label={`Position für Bild ${index + 1}`}
                          >
                            {activeHouse.images.map((_, position) => (
                              <option key={position} value={position}>{String(position + 1).padStart(2, "0")}</option>
                            ))}
                          </select>
                        </label>
                        {index === 0 ? <b>Titelbild</b> : null}
                      </div>
                      <label className="image-role-select">
                        <span>Bildrolle</span>
                        <select
                          value={inferImageRole({
                            filename: image.name,
                            role: image.role,
                            isFloorplan: image.isFloorplan,
                          })}
                          onChange={(event) => updateImageRole(image.id, event.target.value as ImageRole)}
                          aria-label={`Bildrolle für Bild ${index + 1}`}
                        >
                          {IMAGE_ROLE_VALUES.filter((role) => role !== "promotion").map((role) => (
                            <option key={role} value={role}>{IMAGE_ROLE_LABELS[role as keyof typeof IMAGE_ROLE_LABELS]}</option>
                          ))}
                        </select>
                      </label>
                      <label className="check-line">
                        <input
                          type="checkbox"
                          checked={image.isFloorplan}
                          onChange={(event) => updateImageRole(
                            image.id,
                            event.target.checked
                              ? "floorplan_ground"
                              : image.role?.startsWith("floorplan")
                                ? "other"
                                : image.role ?? "other",
                          )}
                        />
                        Grundriss
                      </label>
                      <button className="text-danger" onClick={() => updateHouse({ images: activeHouse.images.filter((item) => item.id !== image.id) })}>Entfernen</button>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-state"><b>Noch keine Bilder</b><span>Außenansicht, Innenräume und Grundrisse werden später automatisch diesem Haustyp zugeordnet.</span></div>
              )}
            </div>
          </div>
        </section>
        </>
      ) : null}

      {tab === "project" ? (
        <section className="workspace">
          <div className="content-card">
            <details
              className="address-center"
              open={addressCenterOpen}
              onToggle={(event) => setAddressCenterOpen(event.currentTarget.open)}
            >
              <summary>
                <span className="address-center-summary-copy">
                  <span className="eyebrow">Adresszentrale</span>
                  <strong>Adressbücher, Excel und gespeicherte Grundstücke</strong>
                  <small>
                    Fabian und Pascal verwalten · {state.projects.length} Adressen gespeichert
                  </small>
                </span>
                <span className="address-center-summary-meta">
                  {addressEditingLocked ? <em>Daten geschützt</em> : null}
                  {addressDuplicateGroups.length ? (
                    <em>
                      {addressDuplicateGroups.length} Adressdublette
                      {addressDuplicateGroups.length === 1 ? "" : "n"}
                    </em>
                  ) : null}
                  <b>{addressCenterOpen ? "Zuklappen" : "Aufklappen"}</b>
                  <span className="address-center-chevron" aria-hidden="true">⌄</span>
                </span>
              </summary>
              <div className="address-center-body">
                <div className="address-owner-panel">
              <div>
                <span className="eyebrow">Getrennte Adressbücher</span>
                <h2>Wer bearbeitet diese Grundstücksadresse?</h2>
                <p>Fabian und Pascal sehen jeweils ihre eigenen gespeicherten Adressen und können sie jederzeit wieder auswählen.</p>
              </div>
              <div className="owner-switch" role="group" aria-label="Benutzer für Grundstücksadressen wählen">
                {ADDRESS_OWNERS.map((owner) => (
                  <button
                    key={owner.id}
                    className={activeOwner === owner.id ? "active" : ""}
                    onClick={() => selectOwner(owner.id)}
                    aria-pressed={activeOwner === owner.id}
                  >
                    <span>{owner.label.slice(0, 1)}</span>
                    <b>{owner.label}</b>
                    <small>{state.projects.filter((project) => projectOwner(project) === owner.id).length} gespeichert</small>
                  </button>
                ))}
              </div>
            </div>
            <div className="address-import-bar">
              <div>
                <b>Mehrere Adressen aus Excel übernehmen</b>
                <span>Eine Zeile pro Grundstück. Die Spalte Benutzer ordnet jede Adresse automatisch Fabian oder Pascal zu.</span>
              </div>
              <div className="button-row">
                <button
                  className="secondary"
                  disabled={exportingInventory}
                  onClick={downloadInventoryExcel}
                >
                  {exportingInventory ? "Bestand wird erstellt …" : "Bestand als Excel herunterladen"}
                </button>
                <a className="secondary" href="/Inserate-Studio-Adressimport-Vorlage.xlsx" download>Excel-Vorlage herunterladen</a>
                <label className={`primary file-label${importingAddresses ? " disabled" : ""}`}>
                  {importingAddresses ? "Excel wird eingelesen …" : "Excel-Adressen importieren"}
                  <input
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    disabled={importingAddresses || replacingAddresses || addressEditingLocked}
                    onChange={importAddressesFromExcel}
                  />
                </label>
                <label className={`secondary file-label${replacingAddresses ? " disabled" : ""}`}>
                  {replacingAddresses ? "Bestand wird ersetzt …" : "Bestand vollständig ersetzen"}
                  <input
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    disabled={importingAddresses || replacingAddresses || addressEditingLocked}
                    onChange={replaceAddressesFromExcel}
                  />
                </label>
              </div>
            </div>
            {addressImportReport.length ? (
              <div className="address-import-report" role="status">
                <b>Nicht übernommene Zeilen</b>
                {addressImportReport.map((message) => <span key={message}>{message}</span>)}
              </div>
            ) : null}
            {addressEditingLocked ? (
              <div className="protected-address-note" role="status">
                <b>Grundstücksdaten geschützt</b>
                <span>
                  Während des gespeicherten Uploadlaufs bleiben Adresse, Grundstücksfläche,
                  Preise und Lageangaben unverändert. Nach Abschluss oder Verwerfen können sie wieder bearbeitet werden.
                </span>
              </div>
            ) : null}
                <AddressBookTable
                  projects={state.projects}
                  activeProjectId={activeProject.id}
                  duplicateGroups={addressDuplicateGroups}
                  duplicateMutationLocked={addressDuplicateMutationLocked}
                  onOpenProject={openAddressProject}
                  onDeleteDuplicates={deleteAddressDuplicates}
                />
              </div>
            </details>
            <div className="section-heading address-editor-heading" ref={addressEditorRef}>
              <div>
                <span className="eyebrow">Geöffnete Adresse · {activeOwner === "pascal" ? "Pascal" : "Fabian"}</span>
                <h2>{projectSelectionLabel(activeProject)}</h2>
              </div>
              <div className="button-row">
                <button className="secondary" disabled={addressEditingLocked} onClick={addProject}>Neue Adresse</button>
                <button className="primary" disabled={savingAddress || addressEditingLocked} onClick={saveAddressNow}>{savingAddress ? "Wird gespeichert …" : "Adresse speichern"}</button>
              </div>
            </div>
            <div className="promotion-count-panel">
              <div className="promotion-count-copy">
                <span className="eyebrow">Aktionsbilder für diese Adresse</span>
                <h3>Wie viele der vier Inserate bekommen ein Aktionsbild?</h3>
                <p>Wähle hier 0, 1, 2, 3 oder 4. Pro gewähltem Inserat wird ein zufälliges Aktionsbild auf Position 1 gesetzt und für diese Grundstücksadresse gespeichert.</p>
              </div>
              <div
                className="promotion-count-buttons"
                role="group"
                aria-label="Anzahl der Aktionsbilder für diese Adresse"
              >
                {Array.from({ length: MAX_PROMOTED_LISTINGS + 1 }, (_, count) => {
                  const selected = activePromotionCount === count;
                  const disabled = addressEditingLocked || count > promotionPool(state).length;
                  return (
                    <button
                      type="button"
                      key={count}
                      className={selected ? "selected" : ""}
                      aria-pressed={selected}
                      aria-label={count === 0
                        ? "Keine Aktionsbilder für die vier Inserate"
                        : `${count} Aktionsbild${count === 1 ? "" : "er"} für die vier Inserate`}
                      disabled={disabled}
                      title={disabled ? `Dafür werden mindestens ${count} Bilder im Aktionspool benötigt.` : undefined}
                      onClick={() => setProjectPromotionCount(count)}
                    >
                      <span>{count}</span>
                      <b>{count === 0 ? "Keine" : count === 4 ? "Alle vier" : `${count} von 4`}</b>
                      {selected ? <small>Ausgewählt</small> : null}
                    </button>
                  );
                })}
              </div>
              <div className="promotion-count-summary">
                <strong>
                  {activePromotionCount === 0
                    ? "Aktuell ohne Aktionsbild"
                    : `Aktuell: ${activePromotionCount} von 4 Inseraten mit Aktionsbild`}
                </strong>
                <span>{promotionPool(state).length} Aktionsbilder stehen im zentralen Pool zur Verfügung.</span>
              </div>
            </div>
            <div className="form-grid three">
              <Field disabled={addressEditingLocked} label="Projektname" value={activeProject.name} onChange={(value) => updateProject({ name: value })} />
              <Field disabled={addressEditingLocked} label="Straße" value={activeProject.street} onChange={(value) => updateProject({ street: value })} />
              <Field disabled={addressEditingLocked} label="Hausnummer" value={activeProject.houseNumber} onChange={(value) => updateProject({ houseNumber: value })} />
              <Field disabled={addressEditingLocked} label="PLZ" value={activeProject.zip} onChange={(value) => updateProject({ zip: value })} />
              <Field disabled={addressEditingLocked} label="Ort" value={activeProject.city} onChange={(value) => updateProject({ city: value })} />
              <Field disabled={addressEditingLocked} label="Ortsteil" value={activeProject.district} onChange={(value) => updateProject({ district: value })} />
              <Field disabled={addressEditingLocked} label="Grundstücksfläche" type="number" min={0} suffix="m²" value={activeProject.plotArea} onChange={(value) => updateProject({ plotArea: Number(value) })} />
              <Field disabled={addressEditingLocked} label="Grundstückspreis" type="number" min={0} suffix="€" value={activeProject.plotPrice} onChange={(value) => updateProject({ plotPrice: Number(value) })} />
              <Field disabled={addressEditingLocked} label="Berücksichtigte Nebenkosten" type="number" min={0} suffix="€" value={activeProject.additionalCosts} onChange={(value) => updateProject({ additionalCosts: Number(value) })} />
              <TextField disabled={addressEditingLocked} label="Geprüfte Lagefakten" value={activeProject.locationFacts} placeholder="z. B. gewachsenes Wohngebiet, ruhige Seitenstraße …" onChange={(value) => updateProject({ locationFacts: value })} />
              <TextField disabled={addressEditingLocked} label="Verkehr & Erreichbarkeit" value={activeProject.transportFacts} placeholder="Nur bestätigte Angaben eintragen." onChange={(value) => updateProject({ transportFacts: value })} />
              <TextField disabled={addressEditingLocked} label="Familie & Versorgung" value={activeProject.familyFacts} placeholder="Schulen, Kitas, Einkauf – nur geprüfte Fakten." onChange={(value) => updateProject({ familyFacts: value })} />
              <TextField disabled={addressEditingLocked} label="Natur & Freizeit" value={activeProject.natureFacts} placeholder="Wald, Seen, Wege oder Freizeitangebote." onChange={(value) => updateProject({ natureFacts: value })} />
              <TextField disabled={addressEditingLocked} label="Zusätzliche Hinweise" value={activeProject.notes} onChange={(value) => updateProject({ notes: value })} />
            </div>

            <div className="selection-section">
              <div className="section-heading compact">
                <div><span className="eyebrow">Maximal vier auswählen</span><h3>Welche Häuser passen zu dieser Adresse?</h3></div>
                <b>{activeSelectedHouseIds.length}/4</b>
              </div>
              <div className="selection-grid">
                {activeHouses.map((house) => {
                  const selected = activeProject.selectedHouseIds.includes(house.id);
                  const displayImage = house.images[0];
                  return (
                    <button disabled={addressEditingLocked} key={house.id} className={selected ? "select-card selected" : "select-card"} onClick={() => toggleHouse(house.id)}>
                      <span className="selection-check">{selected ? "✓" : "+"}</span>
                      {displayImage ? <img src={displayImage.dataUrl} alt={displayImage.caption} /> : <div className="image-placeholder">F&amp;P</div>}
                      <div><strong>{house.name}</strong><small>{house.livingArea} m² · {house.rooms} Zimmer</small><b>{euro(totalPrice(house, activeProject))}</b></div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="promotion-assignment-panel">
              <div className="promotion-assignment-copy">
                <span className="eyebrow">Gespeicherte Zuordnung</span>
                <h3>Welche Häuser erhalten die Aktionsbilder?</h3>
                <p>{activePromotionCount === 0
                  ? "Für diese Adresse sind derzeit keine Aktionsbilder ausgewählt."
                  : `Das Studio ordnet ${activePromotionCount} Aktionsbild${activePromotionCount === 1 ? "" : "er"} zufällig den ausgewählten Häusern zu.`
                }</p>
              </div>
              <div className="promotion-assignment-controls">
                <button
                  className="secondary"
                  disabled={addressEditingLocked || !activePromotionCount || !activeSelectedHouseIds.length}
                  onClick={rerollProjectPromotions}
                >
                  Aktionsbilder neu auslosen
                </button>
              </div>
              {activePromotionCount > promotionPool(state).length ? (
                <div className="promotion-assignment-warning">
                  Bitte noch {activePromotionCount - promotionPool(state).length} Aktionsbild{activePromotionCount - promotionPool(state).length === 1 ? "" : "er"} im Bereich Haustypen ergänzen.
                </div>
              ) : null}
              <div className="promotion-assignment-list">
                {selectedHouses.map((house) => {
                  const imageId = activeProject.promotionAssignments?.[house.id];
                  const image = promotionPool(state).find((item) => item.id === imageId);
                  return (
                    <div className={image ? "assigned" : ""} key={house.id}>
                      {image
                        ? <img src={image.dataUrl} alt={image.caption || image.name} />
                        : <span className="promotion-none">–</span>}
                      <span>
                        <b>{house.name}</b>
                        <small>{image ? `Aktionsbild: ${image.caption || image.name}` : "Eigenes Hausbild an Position 1"}</small>
                      </span>
                    </div>
                  );
                })}
                {!selectedHouses.length ? <small>Nach der Hausauswahl erscheint hier die gespeicherte Zuordnung.</small> : null}
              </div>
            </div>
            <div className="action-bar">
              <div><b>Bereit für neue KI-Texte?</b><span>Die KI erzeugt jedes Mal eine andere, moderne Überschrift und vier lebendige Textblöcke mit interessanten Einstiegen, klarer Struktur und einer eigenen Erzählrichtung je Inserat. Als Ortsbezug sind nur Ort und Ortsteil erlaubt.</span></div>
              <div className="button-row action-buttons">
                <button className="primary" disabled={generatingAi || addressEditingLocked} onClick={generateAiListings}>{generatingAi ? "KI schreibt und prüft …" : "KI-Überschrift & Texte erzeugen"}</button>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {tab === "preview" ? (
        <section className="workspace">
          <div className="content-card">
              <div className="section-heading">
                <div><span className="eyebrow">Prüfen und bearbeiten</span><h2>{activeProject.listings.length || "Keine"} Inseratentwürfe</h2></div>
                <div className="button-row">
                  <button className="primary" disabled={generatingAi || addressEditingLocked} onClick={generateAiListings}>{generatingAi ? "KI schreibt und prüft …" : "KI-Überschrift & Texte neu schreiben"}</button>
              </div>
            </div>
            {activeProject.listings.length ? (
              <div className="listing-stack">
                {activeProject.listings.map((listing) => {
                  const house = state.houses.find((item) => item.id === listing.templateId);
                  const displayImages = house ? effectiveListingImages(state, house, listing) : [];
                  const displayImage = displayImages[0];
                  return (
                    <article className="listing-card" key={listing.id}>
                      <header>
                        <div className="listing-thumb">
                          {displayImage ? <img src={displayImage.dataUrl} alt={displayImage.caption} /> : <span>F&amp;P</span>}
                        </div>
                        <div><span className="eyebrow">KI-Überschrift · Version {listing.version}</span><h3>{listing.texts.title}</h3><p>{listing.templateName} · {house?.livingArea} m² · {house?.rooms} Zimmer · {activeProject.city}</p></div>
                        <div className="price-tag"><span>Angebotspreis</span><b>{euro(listing.price)}</b></div>
                      </header>
                      <div className="listing-fields">
                        <TextField label="Überschrift" rows={2} value={listing.texts.title} onChange={(value) => updateListingText(listing.id, "title", value)} />
                        <TextField label="1 · Objektbeschreibung" rows={8} value={listing.texts.description} onChange={(value) => updateListingText(listing.id, "description", value)} />
                        <TextField label="2 · Ausstattung" rows={8} value={listing.texts.equipment} onChange={(value) => updateListingText(listing.id, "equipment", value)} />
                        <TextField label="3 · Lage" rows={7} value={listing.texts.location} onChange={(value) => updateListingText(listing.id, "location", value)} />
                        <TextField label="4 · Sonstiges" rows={7} value={listing.texts.other} onChange={(value) => updateListingText(listing.id, "other", value)} />
                      </div>
                      <footer>
                        <span>Objekt-ID: <b>{listing.externalId}</b></span>
                        <span>{displayImages.length} Bilder automatisch zugeordnet{listing.promotionImageId ? " · Aktionsbild an Position 1" : ""}</span>
                        <span>Weitergabe an Portale: <b>{portalPublicationEnabled ? "automatisch nach Import" : "deaktiviert"}</b></span>
                      </footer>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state large"><b>Noch keine Entwürfe</b><span>Erfasse eine Adresse, wähle bis zu vier Haustypen und erzeuge anschließend die Texte.</span><button className="primary" onClick={() => setTab("project")}>Zur Adresseingabe</button></div>
            )}
          </div>
        </section>
      ) : null}

      {tab === "renewal" ? (
        <SevenDayWorkCenter
          entries={renewalEntries}
          incompleteProjectCount={renewalIncompleteProjectCount}
          ownerScope={renewalScope}
          selectedProjectIds={selectedRenewalProjectIds}
          previousExternalIdsByProject={renewalPreviousExternalIds}
          promotionImageCount={renewalEffectivePromotionCount}
          availablePromotionImages={Math.min(
            TOTAL_SYNC_LISTINGS_PER_ADDRESS,
            promotionPool(state).length,
          )}
          portalPublicationEnabled={
            resumableTotalSync && activeRunIsSevenDay && state.totalSyncRun
              ? state.totalSyncRun.portalPublicationEnabled === true
              : portalPublicationEnabled
          }
          activeRunKind={state.totalSyncRun?.kind}
          runResumable={resumableTotalSync}
          busy={totalSyncBusy}
          stopping={totalSyncStopping}
          progress={totalSyncRunProgress}
          runStatus={totalSyncStatus}
          runError={state.totalSyncRun?.tasks.find((task) => task.lastError)?.lastError}
          preflightReport={renewalPreflightReport}
          onOwnerScopeChange={changeRenewalScope}
          onPromotionImageCountChange={setRenewalPromotionCount}
          onToggleProject={toggleRenewalProject}
          onSelectProjects={selectRenewalProjects}
          onClearSelection={clearRenewalSelection}
          onOpenProject={openRenewalProject}
          onRenewOne={handleRenewalOne}
          onPrimaryAction={handleRenewalPrimaryAction}
          onDiscardRun={handleDiscardRenewalRun}
        />
      ) : null}

      {tab === "jobs" ? (
        <UploadJobCenter
          run={state.totalSyncRun}
          history={state.uploadRunHistory ?? []}
          projects={state.projects}
          houses={state.houses}
          fallbackAiModel={aiModel}
          busy={totalSyncBusy}
          stopping={totalSyncStopping}
          statusText={totalSyncStatus}
          onRetryFailed={() => void retryFailedJobs()}
          onContinue={() => void continueOpenJobs()}
          onStop={stopTotalSync}
          onDiscard={() => void discardTotalSyncRun()}
          onOpenProject={openJobProject}
          onMarkUnknownFailed={(projectId, externalId) => (
            void markUnknownJobFailed(projectId, externalId)
          )}
        />
      ) : null}

      {tab === "settings" && adminView === "organization" ? (
        <ManagementCenter
          key="administration"
          state={state}
          setState={setState}
          uploadAvailable={helperOnline && Boolean(ftpUser && ftpPassword)}
          busy={uploading || totalSyncBusy}
          onTransferListing={transferManagementListing}
          onDeleteListings={deleteManagementListings}
          notify={setNotice}
          authenticatedUser={cloudSession}
          mode="administration"
        />
      ) : null}

      {tab === "settings" && adminView === "connections" ? (
        <>
          <section className="workspace two-column settings-layout">
          <div className="content-card">
            <div className="section-heading"><div><span className="eyebrow">OpenImmo-Absender</span><h2>Anbieterdaten</h2></div></div>
            <div className="form-grid two">
              <Field disabled label="HV-/Anbieternummer (fest)" value={FIXED_HV_PROVIDER_NUMBER} onChange={() => undefined} />
              <Field label="Firma" value={state.provider.company} onChange={(value) => setState((current) => ({ ...current, provider: { ...current.provider, company: value } }))} />
              <Field label="Vorname" value={state.provider.firstName} onChange={(value) => setState((current) => ({ ...current, provider: { ...current.provider, firstName: value } }))} />
              <Field label="Nachname" value={state.provider.lastName} onChange={(value) => setState((current) => ({ ...current, provider: { ...current.provider, lastName: value } }))} />
              <Field label="E-Mail" type="email" value={state.provider.email} onChange={(value) => setState((current) => ({ ...current, provider: { ...current.provider, email: value } }))} />
              <Field label="Telefon" value={state.provider.phone} onChange={(value) => setState((current) => ({ ...current, provider: { ...current.provider, phone: value } }))} />
            </div>

            <div className="divider" />
            <div className="section-heading"><div><span className="eyebrow">Qualitätsmodus · verschlüsselt gespeichert</span><h2>KI-Textgenerator</h2></div><span className={helperOnline ? "status online" : "status offline"}>{helperOnline ? "Generator bereit" : helperNeedsRestart ? "Generator neu starten" : "Lokaler Helfer offline"}</span></div>
            <div className="form-grid two">
              <label className="field">
                <span>OpenAI API-Schlüssel</span>
                <div className="input-shell">
                  <input
                    type="password"
                    value={openAiKey}
                    placeholder="sk-…"
                    onChange={(event) => {
                      setOpenAiKey(event.target.value);
                      setOpenAiKeyVerified(false);
                    }}
                  />
                </div>
                <small className={openAiKey.trim() && !looksLikeOpenAiApiKey(openAiKey) ? "key-status invalid" : "key-status"}>
                  {!openAiKey.trim()
                    ? "Noch kein Schlüssel eingetragen."
                    : !looksLikeOpenAiApiKey(openAiKey)
                      ? "Kein OpenAI API-Schlüssel: Der vollständige Schlüssel beginnt mit sk-."
                      : openAiKeyVerified
                        ? "Schlüssel erkannt und verschlüsselt gespeichert."
                        : "Format erkannt – bitte unten prüfen und speichern."}
                </small>
              </label>
              <label className="field">
                <span>Qualitätsprofil</span>
                <select
                  value={aiModel}
                  disabled={totalSyncBusy || Boolean(
                    resumableTotalSync && state.totalSyncRun?.aiModel,
                  )}
                  onChange={(event) => setAiModel(event.target.value as AiModelId)}
                >
                  <option value="gpt-5.6-luna">Günstige Empfehlung · GPT-5.6 Luna</option>
                  <option value="gpt-5.6-terra">Mehr Qualitätsreserve · GPT-5.6 Terra</option>
                  <option value="gpt-5.6-sol">Maximale Textqualität · GPT-5.6 Sol</option>
                </select>
              </label>
            </div>
            <p className="security-note">Der Schlüssel wird vor dem Speichern direkt bei OpenAI geprüft und anschließend für dein Benutzerkonto verschlüsselt: unter Windows mit DPAPI, unter macOS im Apple-Schlüsselbund. Die KI erzeugt eine moderne, gegenüber früheren Fassungen neue Überschrift sowie vier abwechslungsreiche Textblöcke mit eigenem Erzählprofil. An die Text-KI werden weder Straße, Hausnummer noch PLZ übergeben; in den Inserattexten sind nur Ort und Ortsteil als konkrete Ortsangaben erlaubt.</p>

            <div className="divider" />
            <div className="section-heading"><div><span className="eyebrow">Verschlüsselt auf diesem Gerät</span><h2>Immoprofessional-Zugang</h2></div><span className={helperOnline ? "status online" : "status offline"}>{helperOnline ? "Upload bereit" : "Upload-Helfer offline"}</span></div>
            <div className="form-grid two">
              <Field label="FTP-Host" value={ftpHost} onChange={setFtpHost} />
              <Field label="Zielordner" value={ftpPath} onChange={setFtpPath} />
              <Field label="FTP-Benutzername" value={ftpUser} onChange={setFtpUser} />
              <Field label="FTP-Passwort" type="password" value={ftpPassword} onChange={setFtpPassword} />
            </div>
            <p className="security-note">FTP-Benutzername und Passwort bleiben nach einem Upload erhalten. Sie liegen getrennt von Haustypen und Projekten im plattformgeschützten Zugangstresor und werden nicht in eine Inserate-Studio-Sicherung aufgenommen.</p>

            <div className="credential-vault-card">
              <div><span className="eyebrow">Lokaler Zugangstresor</span><b>{credentialSaveLabel}</b><small>Windows-DPAPI oder Apple-Schlüsselbund – nur für das angemeldete Benutzerkonto.</small></div>
              <div className="button-row">
                <button className="primary" disabled={savingCredentials || totalSyncBusy} onClick={saveCredentialsNow}>{savingCredentials ? "Schlüssel wird geprüft …" : "Zugangsdaten prüfen & speichern"}</button>
                <button className="secondary" disabled={savingCredentials || totalSyncBusy} onClick={clearSavedCredentials}>Zugangsdaten löschen</button>
              </div>
            </div>

            <div className={`portal-publication-card${portalPublicationEnabled ? " enabled" : ""}`}>
              <div>
                <span className="eyebrow">Portalveröffentlichung</span>
                <h3>{portalPublicationEnabled ? "Automatisch online stellen ist aktiv" : "Nur in Immoprofessional importieren"}</h3>
                <p>
                  Bei aktivierter Veröffentlichung dürfen neue OpenImmo-Importe automatisch an alle in Immoprofessional für das Objekt verbundenen Portale weitergegeben werden.
                  Die genaue Objektadresse bleibt unabhängig davon verborgen.
                </p>
                <small>
                  {resumableTotalSync
                    ? `Der gespeicherte ${activeRunIsSevenDay ? "7-Tage-Lauf" : "Totalabgleich"} bleibt fest auf „${totalSyncEffectivePortalPublication ? "automatisch online" : "nur Import"}“.`
                    : "Immoprofessional entscheidet anhand seiner dort gespeicherten Portalzuordnung über ImmoScout24, Immowelt, Kleinanzeigen und weitere Ziele."}
                </small>
              </div>
              <div className="publication-mode-buttons" role="group" aria-label="Portalveröffentlichung wählen">
                <button
                  type="button"
                  className={!portalPublicationEnabled ? "selected" : ""}
                  aria-pressed={!portalPublicationEnabled}
                  disabled={totalSyncBusy || uploading || resumableTotalSync}
                  onClick={() => changePortalPublication(false)}
                >
                  <b>Nur Import</b>
                  <span>nicht automatisch online</span>
                </button>
                <button
                  type="button"
                  className={portalPublicationEnabled ? "selected publish" : "publish"}
                  aria-pressed={portalPublicationEnabled}
                  disabled={totalSyncBusy || uploading || resumableTotalSync}
                  onClick={() => changePortalPublication(true)}
                >
                  <b>Automatisch online</b>
                  <span>alle verbundenen Portale</span>
                </button>
              </div>
            </div>

            <div className="total-sync-card">
              <div className="section-heading compact">
                <div>
                  <span className="eyebrow">{activeRunIsSevenDay && resumableTotalSync ? "7-Tage-Erneuerung · einzeln und fortsetzbar" : "Totalabgleich · einzeln und fortsetzbar"}</span>
                  <h2>{activeRunIsSevenDay && resumableTotalSync ? "Ausgewählte fällige Adressen erneuern" : "Alle Adressen neu bestücken"}</h2>
                  <p>
                    {activeRunIsSevenDay && resumableTotalSync
                      ? "Dieser gespeicherte Lauf erneuert nur die in der 7-Tage-Zentrale ausgewählten Adressen. Die echten Grundstücksdaten bleiben geschützt."
                      : "Pro vollständiger Adresse werden ein Einfamilienhaus, ein Bungalow, ein Zweifamilienhaus und ein vierter zufälliger Haustyp ausgelost. Dazu entstehen jedes Mal neue KI-Texte und Überschriften. Jedes Inserat wird einzeln und streng nacheinander an Immoprofessional übertragen."}
                  </p>
                </div>
                <span className={totalSyncBusy ? "status online" : resumableTotalSync ? "status offline" : "status"}>
                  {totalSyncBusy ? "Läuft" : resumableTotalSync ? "Fortsetzung bereit" : state.totalSyncRun?.status === "completed" ? "Letzter Lauf fertig" : "Bereit"}
                </span>
              </div>

              <div className="total-sync-promotion-panel">
                <div>
                  <span className="eyebrow">Aktionsbilder im Totalabgleich</span>
                  <h3>Wie viele der vier Inserate pro Adresse bekommen ein Aktionsbild?</h3>
                  <p>Diese Auswahl gilt einheitlich für alle vollständigen Adressen des neuen Totalabgleichs und bleibt bei Pause oder Fortsetzen fest gespeichert.</p>
                </div>
                <div
                  className="promotion-count-buttons"
                  role="group"
                  aria-label="Aktionsbilder je Adresse im Totalabgleich"
                >
                  {Array.from({ length: TOTAL_SYNC_LISTINGS_PER_ADDRESS + 1 }, (_, count) => {
                    const selected = totalSyncEffectivePromotionCount === count;
                    const disabled = totalSyncBusy
                      || resumableTotalSync
                      || count > promotionPool(state).length;
                    return (
                      <button
                        type="button"
                        key={count}
                        className={selected ? "selected" : ""}
                        aria-pressed={selected}
                        aria-label={count === 0
                          ? "Keine Aktionsbilder je Adresse im Totalabgleich"
                          : `${count} Aktionsbild${count === 1 ? "" : "er"} je Adresse im Totalabgleich`}
                        disabled={disabled}
                        title={count > promotionPool(state).length
                          ? `Dafür werden mindestens ${count} Bilder im Aktionspool benötigt.`
                          : resumableTotalSync ? "Die Auswahl ist im gespeicherten Lauf fest hinterlegt." : undefined}
                        onClick={() => setTotalSyncPromotionCount(count)}
                      >
                        <span>{count}</span>
                        <b>{count === 0 ? "Keine" : count === 4 ? "Alle vier" : `${count} von 4`}</b>
                        {selected ? <small>Ausgewählt</small> : null}
                      </button>
                    );
                  })}
                </div>
                <div className="promotion-count-summary">
                  <strong>
                    {totalSyncEffectivePromotionCount === 0
                      ? "Totalabgleich ohne Aktionsbilder"
                      : `${totalSyncEffectivePromotionCount} von 4 Inseraten je Adresse mit Aktionsbild`}
                  </strong>
                  <span>{resumableTotalSync
                    ? "Diese Einstellung gehört fest zum gespeicherten Lauf."
                    : `${promotionPool(state).length} Aktionsbilder stehen im Pool bereit.`}
                  </span>
                </div>
              </div>

              <div className="total-sync-controls">
                <label className="field">
                  <span>Welche Adressbücher?</span>
                  <select
                    value={resumableTotalSync && state.totalSyncRun ? state.totalSyncRun.scope : totalSyncScope}
                    disabled={totalSyncBusy || resumableTotalSync}
                    onChange={(event) => setTotalSyncScope(event.target.value as TotalSyncScope)}
                  >
                    <option value="fabian">Nur Fabian</option>
                    <option value="pascal">Nur Pascal</option>
                    <option value="all">Fabian und Pascal</option>
                  </select>
                </label>
                <div className="total-sync-metrics">
                  <div><span>Vollständige Adressen</span><b>{totalSyncReadyProjects.length}</b></div>
                  <div><span>Geeignete Haustypen</span><b>{totalSyncEligibleHouses.length}</b></div>
                  <div><span>Geplant</span><b>{totalSyncReadyProjects.length * TOTAL_SYNC_LISTINGS_PER_ADDRESS} Inserate</b></div>
                  <div><span>Aktionsbilder</span><b>{totalSyncEffectivePromotionCount} je Adresse</b></div>
                  <div><span>Portalstatus</span><b>{totalSyncEffectivePortalPublication ? "automatisch online" : "nur Import"}</b></div>
                  <div><span>Aktueller Lauf</span><b>{totalSyncRunProgress.uploaded}/{totalSyncRunProgress.total || 0} übertragen</b></div>
                </div>
              </div>

              <PreflightPanel
                report={totalSyncPreflightReport}
                title={resumableTotalSync && activeRunIsSevenDay
                  ? "Vorabprüfung der gespeicherten 7-Tage-Erneuerung"
                  : "Vorabprüfung des Totalabgleichs"}
                description="Flächen, Preise, Hausnummern, Haus- und Aktionsbilder, Zugangsdaten sowie Dubletten werden gemeinsam geprüft."
              />

              {state.totalSyncRun ? (
                <div className="total-sync-progress" role="status" aria-live="polite">
                  <div>
                    <b>{totalSyncStatus || `${totalSyncRunProgress.uploaded}/${totalSyncRunProgress.total} einzeln übertragen`}</b>
                    <span>{totalSyncRunProgress.completedProjects}/{state.totalSyncRun.tasks.length} Adressen abgeschlossen</span>
                  </div>
                  <div className="progress-track" aria-label="Fortschritt Totalabgleich">
                    <span style={{ width: `${totalSyncRunProgress.total ? Math.round((totalSyncRunProgress.uploaded / totalSyncRunProgress.total) * 100) : 0}%` }} />
                  </div>
                  {state.totalSyncRun.tasks.find((task) => task.lastError)?.lastError ? (
                    <small>{state.totalSyncRun.tasks.find((task) => task.lastError)?.lastError}</small>
                  ) : null}
                </div>
              ) : null}

              <div className="button-row total-sync-actions">
                <button
                  className="primary"
                  disabled={totalSyncBusy
                    ? totalSyncStopping
                    : uploading
                      || generatingAi
                      || savingCredentials
                      || !totalSyncPreflightReport.canStart}
                  onClick={totalSyncBusy ? stopTotalSync : startOrResumeTotalSync}
                >
                  {totalSyncBusy
                    ? "Nach aktuellem Schritt anhalten"
                    : !totalSyncPreflightReport.canStart
                      ? totalSyncPreflightReport.targetCount
                        ? `Start gesperrt · ${totalSyncPreflightReport.blockerCount} Blocker`
                        : "Start gesperrt · keine Zieladresse"
                    : resumableTotalSync
                      ? activeRunIsSevenDay ? "7-Tage-Erneuerung fortsetzen" : "Totalabgleich fortsetzen"
                      : `Totalabgleich starten · ${totalSyncReadyProjects.length * TOTAL_SYNC_LISTINGS_PER_ADDRESS} Inserate`}
                </button>
                {state.totalSyncRun && !totalSyncBusy ? (
                  <button className="secondary" onClick={discardTotalSyncRun}>Gespeicherten Lauf verwerfen</button>
                ) : null}
              </div>
              <p className="total-sync-warning">
                Vor dem Start die bisherigen Anzeigen in Immoprofessional löschen. Der Lauf erzeugt kostenpflichtige KI-Texte und kann bei sehr vielen Inseraten mehrere Stunden dauern.
                {totalSyncEffectivePortalPublication
                  ? " Die automatische Portalveröffentlichung ist für diesen Lauf aktiv."
                  : " Die Portalveröffentlichung bleibt ausgeschaltet."}
                {totalSyncSkippedProjects ? ` ${totalSyncSkippedProjects} unvollständige Adressentwürfe werden übersprungen.` : ""}
              </p>
            </div>
          </div>

          <aside className="upload-card">
            <span className="eyebrow">{portalPublicationEnabled ? "Direkte Portalveröffentlichung" : "Kontrollierter Entwurfsimport"}</span>
            <h2>{activeProject.listings.length} Inserate bereit</h2>
            <p>
              Jedes Inserat wird als eigenes OpenImmo-Paket mit den automatisch zugeordneten Bildern übertragen.
              Die genaue Adresse bleibt verborgen; die Portalweitergabe ist {portalPublicationEnabled ? "freigegeben" : "deaktiviert"}.
            </p>
            <div className="upload-facts">
              <div><span>Projekt</span><b>{activeProject.name}</b></div>
              <div><span>Ziel</span><b>{ftpHost}</b></div>
              <div><span>Format</span><b>OpenImmo 1.2.7 · ZIP</b></div>
              <div><span>Automatik</span><b>Wohngebiet · Gäste-WC · Nutzfläche</b></div>
              <div><span>Veröffentlichung</span><b>{portalPublicationEnabled ? "automatisch über Immoprofessional" : "manuell in Immoprofessional"}</b></div>
            </div>
            <PreflightPanel
              report={manualPreflightReport}
              title="Vorabprüfung Einzelupload"
              description="Geprüft werden dieses Grundstück, seine fertigen Inserate, Bilder, Preise, Zugangsdaten und Dubletten."
              compact
            />
            <button
              className="primary full"
              disabled={
                uploading
                || totalSyncBusy
                || !activeProject.listings.length
                || !manualPreflightReport.canStart
              }
              onClick={uploadPackage}
            >
              {uploading
                ? uploadStatus || "Wird übertragen …"
                : !manualPreflightReport.canStart
                  ? manualPreflightReport.targetCount
                    ? `Start gesperrt · ${manualPreflightReport.blockerCount} Blocker`
                    : "Start gesperrt · keine Zieladresse"
                : portalPublicationEnabled ? "Inserate automatisch online stellen" : "Entwürfe zu Immoprofessional laden"}
            </button>
            <button className="secondary full" disabled={totalSyncBusy || !activeProject.listings.length} onClick={downloadPackage}>Importpaket nur herunterladen</button>
            <p className="first-test">
              {portalPublicationEnabled
                ? "Bitte zuerst genau ein Testinserat übertragen und anschließend Importbericht, Portalzuordnung, Onlinestatus und verborgene Adresse prüfen."
                : "Der erste Upload sollte mit einem einzelnen, nicht veröffentlichten Testobjekt geprüft werden. Immoprofessional kann eigene Importregeln anwenden."}
            </p>
          </aside>

          </section>

          <section className="workspace content-card backup-card settings-backup-card">
            <div><span className="eyebrow">Strikt getrennte Speicherung</span><h3>Fabian&amp;Pascal-Sicherung</h3><p>Haustypen, Bilder und Adressprojekte werden doppelt lokal gespeichert: im Speicher <code>{STORAGE_ID}</code> und als automatische Gerätesicherung. Zugangsdaten sind separat verschlüsselt. deviq und Plotverium werden weder gelesen noch beschrieben.</p></div>
            <div className="button-row"><button className="secondary" onClick={exportCatalog}>Sicherung herunterladen</button><label className="secondary file-label">Sicherung einlesen<input type="file" accept="application/json" onChange={importCatalog} /></label></div>
          </section>
        </>
      ) : null}
    </main>
  );
}
