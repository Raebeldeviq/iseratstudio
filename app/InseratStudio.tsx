"use client";
/* eslint-disable @next/next/no-img-element */

import { ChangeEvent, useEffect, useState } from "react";
import { readSheet } from "read-excel-file/browser";
import {
  captionForImageRole,
  INTERIOR_IMAGE_ROLES,
  IMAGE_ROLE_LABELS,
  IMAGE_ROLE_VALUES,
  imageSequenceIssues,
  inferImageRole,
  isFixedCaptionRole,
  orderHouseImages,
  parseHouseVariant,
  TITLE_IMAGE_CAPTIONS,
} from "../image-sequence.mjs";
import { housePriceCatalogEntries, resolveHousePrice } from "../house-price-catalog.mjs";
import { applyConfirmedHouseModelDetails } from "../house-template-presets.mjs";
import {
  createDefaultProvider,
  createEmptyHouse,
  createEmptyProject,
  createInitialStudioState,
} from "../studio-defaults.mjs";
import { IMMOPROFESSIONAL_FTPS_HOST } from "../ftp-config.mjs";
import {
  fillMissingProjectingDefaults,
  fillMissingListingCopy,
  FIXED_ANNOTATION_TEXT,
  FIXED_DESCRIPTION_CTA,
  FIXED_EQUIPMENT_TEXT,
  FIXED_OTHER_TEXT,
  FIXED_PROVISION_TEXT,
  FIXED_RECOMMENDATION_TEXT,
  FIXED_TERMS_TEXT,
  IMMOPROFESSIONAL_DEFAULTS,
  isMissingProjectingValue,
} from "../listing-copy.mjs";
import { parseAddressWorkbookRows } from "./lib/address-import";
import { APP_VERSION } from "./lib/app-version.mjs";
import { buildImportPackage } from "./lib/openimmo";
import {
  compareProjectsByRegion,
  enrichProjectWithPostalRegion,
  groupProjectsByRegion,
  loadPostalRegionIndex,
  projectRegionLabel,
} from "./lib/postal-regions";
import { ADDRESS_OWNERS, normalizeProjectOwners, projectOwner } from "./lib/project-owners";
import { completeListingTexts, generateListingTexts, totalPrice } from "./lib/text-generator";
import { loadStudioSnapshot, saveStudioState, STORAGE_ID } from "./lib/storage";
import type {
  AddressOwner,
  GeneratedListing,
  HouseImage,
  HouseTemplate,
  ImageRole,
  ListingTexts,
  ProjectInput,
  ProviderSettings,
  StudioState,
} from "./types";

type Tab = "houses" | "project" | "preview" | "settings";
type AiModel = "gpt-5.6-luna" | "gpt-5.6-terra" | "gpt-5.6-sol";
type FtpSecurity = "explicit" | "implicit" | "none";
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
  imageUrl: string;
};

type MediaLibraryGroup = { name: string; count: number };

const MIN_HOUSE_IMAGES = 4;
const MAX_HOUSE_IMAGES = 14;
const MAX_HOUSE_TEMPLATES = 18;
const MAX_ADDRESS_IMPORT_BYTES = 10 * 1024 * 1024;
const MAX_PROMOTION_IMAGE_BYTES = 25 * 1024 * 1024;
const HELPER_BASE_URL = "http://127.0.0.1:43182";
const HOUSE_PRICE_ENTRIES = housePriceCatalogEntries();

const MEDIA_KIND_LABELS: Record<MediaLibraryKind, string> = {
  house: "Hausansicht",
  floorplan: "Grundriss",
  interior: "Innenraum",
  location: "Standort",
  marketing: "Anzeige",
};

function helperSessionToken(): string {
  if (typeof window === "undefined") return "";
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const fragmentToken = fragment.get("session");
  if (fragmentToken) {
    window.sessionStorage.setItem("fpi-helper-session", fragmentToken);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    return fragmentToken;
  }
  return window.sessionStorage.getItem("fpi-helper-session") || "";
}

function helperFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("X-FPI-Session", helperSessionToken());
  return fetch(`${HELPER_BASE_URL}${path}`, { ...init, headers });
}

function looksLikeOpenAiApiKey(value: string): boolean {
  return /^sk-[a-zA-Z0-9_-]{20,}$/.test(value.trim());
}

const uid = () => crypto.randomUUID();
const newHouse = (index = 1): HouseTemplate => createEmptyHouse(index) as HouseTemplate;
const newProject = (owner: AddressOwner = "fabian"): ProjectInput => createEmptyProject(owner) as ProjectInput;
const defaultProvider = createDefaultProvider() as ProviderSettings;
const initialState = (): StudioState => createInitialStudioState() as StudioState;

function normalizeMandatoryListingStandards(state: StudioState): StudioState {
  const houses = state.houses.map((storedHouse) => {
    const house = applyConfirmedHouseModelDetails(storedHouse);
    return {
      ...house,
      energyClass: isMissingProjectingValue(house.energyClass)
        ? IMMOPROFESSIONAL_DEFAULTS.energyClass
        : house.energyClass,
      heatingType: isMissingProjectingValue(house.heatingType)
        ? "Fußbodenheizung mit Luft-Wasser-Wärmepumpe"
        : house.heatingType,
      energySource: isMissingProjectingValue(house.energySource)
        ? "Umweltwärme und Strom"
        : house.energySource,
    };
  });
  const houseById = new Map(houses.map((house) => [house.id, house]));
  return {
    ...state,
    houses,
    projects: state.projects.map((project) => ({
      ...project,
      listings: project.listings.map((listing) => {
        const house = houseById.get(listing.templateId);
        if (!house) return listing;
        const fallbackTexts = generateListingTexts(
          house,
          project,
          state.provider,
          listing.version || 1,
        );
        return {
          ...listing,
          projectingSettings: fillMissingProjectingDefaults(listing.projectingSettings),
          texts: fillMissingListingCopy(
            listing.texts,
            fallbackTexts,
            { house, project },
          ) as ListingTexts,
        };
      }),
    })),
  };
}

function effectiveHouseImages(state: StudioState, house: HouseTemplate): HouseImage[] {
  const orderedImages = orderHouseImages(house.images);
  if (!state.promotionImageEnabled || !state.promotionImage) return orderedImages;
  return [
    { ...state.promotionImage, role: "promotion" },
    ...orderedImages.filter((image) => image.id !== state.promotionImage?.id),
  ];
}

function euro(value: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function projectSelectionLabel(project: ProjectInput): string {
  const street = [project.street, project.houseNumber].filter(Boolean).join(" ");
  const place = [project.zip, project.city].filter(Boolean).join(" ");
  const address = [street, place].filter(Boolean).join(", ");
  return address ? `${project.name} · ${address}` : project.name;
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
  readOnly = false,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  suffix?: string;
  min?: number;
  readOnly?: boolean;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="input-shell">
        <input
          type={type}
          value={value}
          min={min}
          readOnly={readOnly}
          placeholder={placeholder}
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
  readOnly = false,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  rows?: number;
  readOnly?: boolean;
}) {
  return (
    <label className="field field-wide">
      <span>{label}</span>
      <textarea
        value={value}
        rows={rows}
        readOnly={readOnly}
        placeholder={placeholder}
        onChange={(event) => onChange?.(event.target.value)}
      />
    </label>
  );
}

function AppVersionBadge() {
  return (
    <div
      className="app-version-badge"
      aria-label={`Geöffnete InseratStudio-Version ${APP_VERSION}`}
      title={`Fabian&Pascal Inseratestudio · Version ${APP_VERSION}`}
    >
      v{APP_VERSION}
    </div>
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
    promotionImage: state.promotionImage
      ? { ...state.promotionImage, dataUrl: "" }
      : null,
    houses: state.houses.map((house) => ({
      ...house,
      images: house.images.map((image) => ({ ...image, dataUrl: "" })),
    })),
  };
}

async function saveDeviceCatalogSnapshot(
  state: StudioState,
  savedAt: string,
  expectedSavedAt: string,
): Promise<void> {
  const sessionId = uid();
  const allImages = [
    ...state.houses.flatMap((house) => house.images),
    ...(state.promotionImage ? [state.promotionImage] : []),
  ];
  const imageById = new Map(allImages.map((image) => [image.id, image]));
  const startResponse = await helperFetch("/catalog-v2/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      savedAt,
      expectedSavedAt,
      state: catalogWithoutImageData(state),
    }),
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
    const uploadResponse = await helperFetch(
      `/catalog-v2/image?sessionId=${encodeURIComponent(sessionId)}&imageId=${encodeURIComponent(image.id)}`,
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

  const commitResponse = await helperFetch("/catalog-v2/commit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  const commitData = (await commitResponse.json()) as { ok?: boolean; message?: string };
  if (!commitResponse.ok || !commitData.ok) {
    throw new Error(commitData.message || "Gerätesicherung konnte nicht abgeschlossen werden.");
  }
}

let deviceCatalogSaveQueue: Promise<void> = Promise.resolve();
let knownDeviceCatalogSavedAt = "";

function queueDeviceCatalogSnapshot(state: StudioState, savedAt: string): Promise<void> {
  const nextSave = deviceCatalogSaveQueue
    .catch(() => undefined)
    .then(() => saveDeviceCatalogSnapshot(state, savedAt, knownDeviceCatalogSavedAt))
    .then(() => { knownDeviceCatalogSavedAt = savedAt; });
  deviceCatalogSaveQueue = nextSave;
  return nextSave;
}

async function loadDeviceCatalogSnapshot(): Promise<{
  state: StudioState;
  savedAt: string;
  source: "device";
} | null> {
  let v2ManifestFound = false;
  try {
    const manifestResponse = await helperFetch("/catalog-v2/manifest");
    const manifestData = (await manifestResponse.json()) as {
      ok?: boolean;
      stored?: boolean;
      savedAt?: string;
      state?: StudioState;
    };
    if (manifestResponse.ok && manifestData.ok && manifestData.stored && manifestData.state && manifestData.savedAt) {
      v2ManifestFound = true;
      const imageIds = [...new Set([
        ...manifestData.state.houses.flatMap((house) => house.images.map((image) => image.id)),
        ...(manifestData.state.promotionImage ? [manifestData.state.promotionImage.id] : []),
      ])];
      const dataUrlById = new Map<string, string>();
      await runWithConcurrency(imageIds, async (imageId) => {
        const imageResponse = await helperFetch(`/catalog-v2/image?imageId=${encodeURIComponent(imageId)}`);
        if (!imageResponse.ok) throw new Error("Ein Bild der Gerätesicherung konnte nicht geladen werden.");
        dataUrlById.set(imageId, await blobDataUrl(await imageResponse.blob()));
      });
      const state: StudioState = {
        ...manifestData.state,
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
            dataUrl: dataUrlById.get(image.id) ?? "",
          })),
        })),
      };
      return { state, savedAt: manifestData.savedAt, source: "device" };
    }
  } catch (error) {
    if (v2ManifestFound) throw error;
    // Die bisherige Ein-Datei-Sicherung bleibt als einmaliger Rückfall erhalten.
  }

  const response = await helperFetch("/catalog");
  const data = (await response.json()) as {
    ok?: boolean;
    stored?: boolean;
    savedAt?: string;
    state?: StudioState;
  };
  if (!response.ok || !data.ok || !data.stored || !data.state || !data.savedAt) return null;
  return { state: data.state, savedAt: data.savedAt, source: "device" };
}

function snapshotTime(value: string): number {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

export default function InseratStudio() {
  const [tab, setTab] = useState<Tab>("houses");
  const [state, setState] = useState<StudioState>(initialState);
  const [ready, setReady] = useState(false);
  const [saveLabel, setSaveLabel] = useState("Lokaler Speicher wird vorbereitet …");
  const [activeHouseId, setActiveHouseId] = useState("");
  const [activeProjectId, setActiveProjectId] = useState("");
  const [activeOwner, setActiveOwner] = useState<AddressOwner>("fabian");
  const [notice, setNotice] = useState<string | null>(null);
  const [ftpHost, setFtpHost] = useState(IMMOPROFESSIONAL_FTPS_HOST);
  const [ftpUser, setFtpUser] = useState("");
  const [ftpPassword, setFtpPassword] = useState("");
  const [ftpPath, setFtpPath] = useState("/");
  const [ftpSecure, setFtpSecure] = useState<FtpSecurity>("explicit");
  const [hasStoredOpenAiKey, setHasStoredOpenAiKey] = useState(false);
  const [hasStoredFtpCredentials, setHasStoredFtpCredentials] = useState(false);
  const [excludedUploadIds, setExcludedUploadIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [helperOnline, setHelperOnline] = useState(false);
  const [openAiKey, setOpenAiKey] = useState("");
  const [aiModel, setAiModel] = useState<AiModel>("gpt-5.6-luna");
  const [generatingAi, setGeneratingAi] = useState(false);
  const [credentialsReady, setCredentialsReady] = useState(false);
  const [credentialSaveLabel, setCredentialSaveLabel] = useState("Verschlüsselter Zugangstresor wird vorbereitet …");
  const [savingHouses, setSavingHouses] = useState(false);
  const [savingAddress, setSavingAddress] = useState(false);
  const [savingCredentials, setSavingCredentials] = useState(false);
  const [captioningImageIds, setCaptioningImageIds] = useState<string[]>([]);
  const [replacingAllImageCaptions, setReplacingAllImageCaptions] = useState(false);
  const [openAiKeyVerified, setOpenAiKeyVerified] = useState(false);
  const [isPrimaryTab, setIsPrimaryTab] = useState<boolean | null>(null);
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
  const [importingAddresses, setImportingAddresses] = useState(false);
  const [addressImportReport, setAddressImportReport] = useState<string[]>([]);

  useEffect(() => {
    let releaseLock: (() => void) | undefined;
    let cancelled = false;

    if (!navigator.locks) {
      const fallbackTimer = window.setTimeout(() => setIsPrimaryTab(true), 0);
      return () => window.clearTimeout(fallbackTimer);
    }

    const lockLifetime = new Promise<void>((resolve) => { releaseLock = resolve; });
    let acquiredImmediately = false;
    navigator.locks.request(
      "fabian-pascal-inseratestudio-active-tab-v2",
      { ifAvailable: true, mode: "exclusive" },
      async (lock) => {
        if (cancelled) return;
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
        "fabian-pascal-inseratestudio-active-tab-v2",
        { mode: "exclusive" },
        async () => {
          if (cancelled) return;
          setIsPrimaryTab(true);
          await lockLifetime;
        },
      );
    }).catch(() => {
      if (!cancelled) setIsPrimaryTab(true);
    });

    return () => {
      cancelled = true;
      releaseLock?.();
    };
  }, []);

  useEffect(() => {
    Promise.allSettled([loadStudioSnapshot(), loadDeviceCatalogSnapshot()])
      .then((results) => {
        const candidates: Array<{
          state: StudioState;
          savedAt: string;
          source: "browser" | "legacy" | "device";
        }> = [];
        for (const result of results) {
          if (result.status === "fulfilled" && result.value) candidates.push(result.value);
        }
        candidates.sort((left, right) => snapshotTime(right.savedAt) - snapshotTime(left.savedAt));
        knownDeviceCatalogSavedAt = candidates.find((candidate) => candidate.source === "device")?.savedAt ?? "";
        const selected = candidates[0];
        const loaded = normalizeMandatoryListingStandards(
          normalizeProjectOwners(selected?.state ?? initialState()),
        );
        const next = loaded.projects.length
          ? loaded
          : { ...loaded, projects: [newProject("fabian")] };
        setState(next);
        setActiveHouseId(next.houses[0]?.id ?? "");
        setActiveProjectId(next.projects[0]?.id ?? "");
        setActiveOwner(projectOwner(next.projects[0]));
        setSaveLabel(selected?.source === "device" ? "Aus lokaler macOS-Sicherung geladen" : "Doppelt lokal gespeichert");
      })
      .catch(() => setSaveLabel("Lokaler Speicher nicht verfügbar"))
      .finally(() => setReady(true));

    const checkHelper = () => {
      helperFetch("/health")
        .then((response) => setHelperOnline(response.ok))
        .catch(() => setHelperOnline(false));
    };
    checkHelper();
    const healthTimer = window.setInterval(checkHelper, 5000);
    return () => window.clearInterval(healthTimer);
  }, []);

  useEffect(() => {
    if (!helperOnline || credentialsReady) return;
    let cancelled = false;
    helperFetch("/credentials")
      .then(async (response) => {
        const data = (await response.json()) as {
          ok?: boolean;
          stored?: boolean;
          message?: string;
          credentials?: {
            aiModel?: AiModel;
            ftpHost?: string;
            ftpUser?: string;
            ftpPath?: string;
            ftpSecure?: FtpSecurity;
            hasOpenAiKey?: boolean;
            hasFtpCredentials?: boolean;
          };
        };
        if (!response.ok || !data.ok) throw new Error(data.message || "Zugangstresor konnte nicht geöffnet werden.");
        if (cancelled) return;
        if (data.stored && data.credentials) {
          setHasStoredOpenAiKey(Boolean(data.credentials.hasOpenAiKey));
          setOpenAiKey("");
          setOpenAiKeyVerified(Boolean(data.credentials.hasOpenAiKey));
          const storedModel = data.credentials.aiModel;
          setAiModel(
            storedModel === "gpt-5.6-terra" || storedModel === "gpt-5.6-sol"
              ? storedModel
              : "gpt-5.6-luna",
          );
          setFtpHost(data.credentials.ftpHost || IMMOPROFESSIONAL_FTPS_HOST);
          setFtpUser(data.credentials.ftpUser ?? "");
          setFtpPassword("");
          setFtpPath(data.credentials.ftpPath || "/");
          setFtpSecure(data.credentials.ftpSecure || "explicit");
          setHasStoredFtpCredentials(Boolean(data.credentials.hasFtpCredentials));
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
    if (!ready || isPrimaryTab !== true) return;
    const timer = window.setTimeout(() => {
      const savedAt = new Date().toISOString();
      const saves: Promise<unknown>[] = [saveStudioState(state, savedAt)];
      if (helperOnline) {
        saves.push(queueDeviceCatalogSnapshot(state, savedAt));
      }
      Promise.all(saves)
        .then(() => setSaveLabel(helperOnline ? "Browser + macOS-Sicherung aktuell" : "Lokal im Browser gespeichert"))
        .catch(() => setSaveLabel("Speichern fehlgeschlagen"));
    }, 450);
    return () => window.clearTimeout(timer);
  }, [helperOnline, isPrimaryTab, ready, state]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void loadPostalRegionIndex()
      .then((index) => {
        if (cancelled) return;
        setState((current) => {
          let changed = false;
          const projects = current.projects.map((project) => {
            const enriched = enrichProjectWithPostalRegion(project, index);
            if (
              enriched.federalState !== (project.federalState ?? "")
              || enriched.county !== (project.county ?? "")
            ) {
              changed = true;
              return enriched;
            }
            return project;
          });
          return changed ? { ...current, projects } : current;
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [ready]);

  const activeHouse =
    state.houses.find((house) => house.id === activeHouseId) ?? state.houses[0];
  const activeHousePriceMatch = activeHouse
    ? resolveHousePrice([
        activeHouse.name,
        ...activeHouse.images.map((image) => image.name),
      ])
    : null;
  const activeImageSequence = activeHouse ? effectiveHouseImages(state, activeHouse) : [];
  const activeImageSequenceIssues = activeHouse
      ? imageSequenceIssues(activeImageSequence, {
        requiresUpperFloor: activeHouse.floors > 1,
        requiresThirdFloor: activeHouse.floors > 2,
        maximumImages: MAX_HOUSE_IMAGES,
      })
    : [];
  const ownerProjects = state.projects
    .filter((project) => projectOwner(project) === activeOwner)
    .sort(compareProjectsByRegion);
  const ownerProjectGroups = groupProjectsByRegion(ownerProjects);
  const activeProject =
    ownerProjects.find((project) => project.id === activeProjectId) ??
    ownerProjects[0];

  const selectedHouses = state.houses.filter((house) =>
    activeProject?.selectedHouseIds.includes(house.id),
  );
  const secondStepTextPreviews = activeProject
    ? selectedHouses.map((house) => {
        const listing = activeProject.listings.find((item) => item.templateId === house.id);
        return {
          house,
          texts: completeListingTexts(
            house,
            activeProject,
            state.provider,
            listing?.texts,
            listing?.version || 1,
          ),
        };
      })
    : [];
  const selectedUploadIds = activeProject?.listings
    .map((listing) => listing.id)
    .filter((id) => !excludedUploadIds.includes(id)) ?? [];

  const saveHousesNow = async () => {
    const savedAt = new Date().toISOString();
    const imageCount = state.houses.reduce((sum, house) => sum + house.images.length, 0)
      + (state.promotionImage ? 1 : 0);
    setSavingHouses(true);
    try {
      await saveStudioState(state, savedAt);
      if (helperOnline) {
        await queueDeviceCatalogSnapshot(state, savedAt);
        setSaveLabel("Browser + macOS-Sicherung aktuell");
        setNotice(`${state.houses.length} Haustypen mit ${imageCount} Bildern wurden sicher gespeichert.`);
      } else {
        setSaveLabel("Lokal im Browser gespeichert");
        setNotice(`${state.houses.length} Haustypen mit ${imageCount} Bildern wurden im Browser gespeichert. Die macOS-Sicherung wird ergänzt, sobald der lokale Helfer erreichbar ist.`);
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
        await queueDeviceCatalogSnapshot(state, savedAt);
        setSaveLabel("Browser + macOS-Sicherung aktuell");
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

  const applyCatalogHousePrice = () => {
    if (!activeHouse || !activeHousePriceMatch) return;
    updateHouse({
      housePrice: activeHousePriceMatch.price,
      houseType: activeHousePriceMatch.houseType,
    });
    setNotice(`${activeHousePriceMatch.label}: ${euro(activeHousePriceMatch.price)} und Objektart „${activeHousePriceMatch.houseType}“ wurden aus der hinterlegten Preisliste übernommen.`);
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
    if (state.houses.length >= MAX_HOUSE_TEMPLATES) {
      setNotice(`Es sind bereits ${MAX_HOUSE_TEMPLATES} Haustypen angelegt.`);
      return;
    }
    const house = newHouse(state.houses.length + 1);
    setState((current) => ({ ...current, houses: [...current.houses, house] }));
    setActiveHouseId(house.id);
  };

  const removeHouse = () => {
    if (!activeHouse || state.houses.length === 1) return;
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
        listings: project.listings.filter(
          (listing) => listing.templateId !== activeHouse.id,
        ),
      })),
    }));
    setActiveHouseId(houses[0]?.id ?? "");
  };

  const replaceHouseImageCaptions = (houseId: string, captionById: Map<string, string>) => {
    setState((current) => ({
      ...current,
      houses: current.houses.map((house) => house.id === houseId ? {
        ...house,
        images: house.images.map((image) => captionById.has(image.id)
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
      if (announce) setNotice("Die festen Bildüberschriften bleiben unverändert.");
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

    if (!helperOnline || !hasStoredOpenAiKey) {
      if (announce) setNotice(hasStoredOpenAiKey
        ? `${editableImages.length} variable Bildtexte wurden automatisch lokal erstellt. Feste Überschriften blieben unverändert.`
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
      const response = await helperFetch("/generate-image-captions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
      if (announce) setNotice(`${editableImages.length} variable Bildtexte wurden automatisch erstellt. Feste Überschriften blieben unverändert.`);
      return "ai";
    } catch (error) {
      if (announce) setNotice(`${images.length} lokale Bildtexte wurden erstellt. ${error instanceof Error ? error.message : "Die KI-Verfeinerung war nicht verfügbar."}`);
      return "local";
    } finally {
      setCaptioningImageIds((current) => current.filter((id) => !imageIds.includes(id)));
    }
  };

  const replaceAllExistingImageCaptions = async () => {
    if (!hasStoredOpenAiKey) {
      setTab("settings");
      setNotice("Bitte zuerst einen gültigen OpenAI API-Schlüssel einfügen und über „Zugangsdaten prüfen & speichern“ bestätigen.");
      return;
    }
    const housesWithImages = state.houses
      .map((house) => ({ ...house, images: house.images.filter((image) => !image.captionLocked) }))
      .filter((house) => house.images.length > 0);
    const totalImages = housesWithImages.reduce((sum, house) => sum + house.images.length, 0);
    if (!totalImages) {
      setNotice("Es sind keine variablen Bildtexte vorhanden. Die festen Überschriften bleiben geschützt.");
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
      const response = await helperFetch(`/media-library?${parameters.toString()}`);
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
      setMediaLibraryError(error instanceof Error ? error.message : "Die Medienbibliothek konnte nicht geladen werden.");
    } finally {
      setMediaLibraryLoading(false);
    }
  };

  const toggleMediaLibrary = async () => {
    if (mediaLibraryOpen) {
      setMediaLibraryOpen(false);
      return;
    }
    if (!helperOnline) {
      setNotice("Die integrierte Medienbibliothek ist verfügbar, sobald die App über den macOS-Startknopf geöffnet wurde.");
      return;
    }
    setMediaLibraryOpen(true);
    await loadMediaLibrary(1);
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
      if (!response.ok) throw new Error(`${item.filename} konnte nicht aus der Medienbibliothek geladen werden.`);
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
    return {
      images: results
        .filter((result): result is PromiseFulfilledResult<HouseImage> => result.status === "fulfilled")
        .map((result) => result.value),
      failed: results.length - results.filter((result) => result.status === "fulfilled").length,
    };
  };

  const importSelectedMedia = async () => {
    if (!activeHouse || !selectedMediaItems.length) return;
    const houseId = activeHouse.id;
    const existingSourceIds = new Set(activeHouse.images.map((image) => image.sourceId).filter(Boolean));
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
            const sourceIds = new Set(house.images.map((image) => image.sourceId).filter(Boolean));
            const additions = imported
              .filter((image) => !sourceIds.has(image.sourceId))
              .slice(0, MAX_HOUSE_IMAGES - house.images.length);
            return { ...house, images: orderHouseImages([...house.images, ...additions]) };
          }),
        }));
      }
      setSelectedMediaItems([]);
      setNotice(failed
        ? `${imported.length} Bilder wurden übernommen; ${failed} Mediendateien konnten noch nicht geladen werden. Bitte Git LFS beziehungsweise den konfigurierten Medienpfad prüfen.`
        : `${imported.length} beschriftete Bilder wurden aus der integrierten Medienbibliothek übernommen.`);
    } finally {
      setImportingMedia(false);
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
    if (activeHouse.images.length && !window.confirm(`Die bisherige Bildfolge für „${activeHouse.name}“ durch die automatisch zusammengestellte Folge ersetzen?`)) return;

    setImportingMedia(true);
    try {
      const response = await helperFetch(`/media-library/sequence?coverId=${encodeURIComponent(cover.id)}`);
      const data = (await response.json()) as {
        ok?: boolean;
        message?: string;
        warnings?: string[];
        priceMatch?: { key: string; label: string; price: number; houseType: string } | null;
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
        setNotice(`Die vollständige Standardfolge enthält ${data.items.length} Bilder und überschreitet das Limit von ${MAX_HOUSE_IMAGES}.`);
        return;
      }
      const { images, failed } = await downloadMediaItems(data.items);
      if (failed || images.length !== data.items.length) {
        setNotice(`${failed || data.items.length - images.length} Medienbilder konnten nicht geladen werden. Die vorhandene Bildfolge wurde nicht verändert.`);
        return;
      }
      const houseId = activeHouse.id;
      const houseVariant = parseHouseVariant(cover.filename);
      const floorplanCount = images.filter((image) => image.role?.startsWith("floorplan")).length;
      const normalizedHouseName = cover.filename.replace(/\.[^.]+$/, "").trim();
      const priceMatch = data.priceMatch || resolveHousePrice([
        cover.filename,
        ...images.map((image) => image.name),
      ]);
      setState((current) => ({
        ...current,
        houses: current.houses.map((house) => house.id === houseId
          ? {
              ...house,
              name: !house.images.length && /muster|^haustyp\s+\d+$/i.test(house.name)
                ? normalizedHouseName
                : house.name,
              floors: houseVariant?.family === "SOL" && ["82", "101", "107", "110"].includes(houseVariant.model)
                ? 1
                : Math.max(2, Math.min(3, floorplanCount)),
              housePrice: priceMatch?.price ?? house.housePrice,
              houseType: priceMatch?.houseType ?? house.houseType,
              images: orderHouseImages(images),
            }
          : house),
      }));
      setSelectedMediaItems([]);
      const actionWarning = state.promotionImageEnabled && state.promotionImage && images.length === MAX_HOUSE_IMAGES
        ? " Das aktive Aktionsbild würde das Portal-Limit überschreiten; bitte vor dem Export deaktivieren oder eine dritte Etage entfernen."
        : "";
      const priceNotice = priceMatch
        ? ` ${priceMatch.label} wurde unabhängig von der Bildversion mit ${euro(priceMatch.price)} hinterlegt.`
        : " Für dieses Modell ist kein eindeutiger Preis in der hinterlegten Liste vorhanden; der bisherige Hauspreis bleibt unverändert.";
      setNotice(`${images.length} Bilder wurden versionsgenau zusammengestellt und mit festen Bildrollen gespeichert.${priceNotice}${actionWarning}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Die automatische Bildfolge konnte nicht erstellt werden.");
    } finally {
      setImportingMedia(false);
    }
  };

  const addImages = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!activeHouse) return;
    const remaining = MAX_HOUSE_IMAGES - activeHouse.images.length;
    const selectedFiles = Array.from(event.target.files ?? []);
    const files = selectedFiles
      .filter((file) => ["image/jpeg", "image/png", "image/webp"].includes(file.type))
      .slice(0, remaining);
    if (!files.length) {
      event.target.value = "";
      setNotice("Bitte Bilder im Format JPEG, PNG oder WebP auswählen.");
      return;
    }
    if (files.length < selectedFiles.length) {
      setNotice("Nicht unterstützte oder überzählige Bilder wurden ausgelassen. Erlaubt sind JPEG, PNG und WebP bis maximal 14 Bilder.");
    }
    const images: HouseImage[] = await Promise.all(
      files.map(
        (file, index) =>
          new Promise<HouseImage>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const isFloorplan = /grundriss|floor/i.test(file.name);
              const role = inferImageRole({ filename: file.name, isFloorplan }) as ImageRole;
              resolve({
                id: uid(),
                name: file.name,
                mimeType: file.type || "image/jpeg",
                dataUrl: String(reader.result),
                caption: isFixedCaptionRole(role)
                  ? captionForImageRole(role, file.name)
                  : localImageCaption(file.name, isFloorplan, index),
                captionLocked: isFixedCaptionRole(role),
                isFloorplan: role.startsWith("floorplan"),
                role,
              });
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          }),
      ),
    );
    updateHouse({ images: orderHouseImages([...activeHouse.images, ...images]) });
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
      images: orderHouseImages(activeHouse.images.map((image) => {
        if (image.id !== id) return image;
        const captionLocked = isFixedCaptionRole(role);
        return {
          ...image,
          role,
          isFloorplan: role.startsWith("floorplan"),
          captionLocked,
          caption: captionForImageRole(role, image.name, image.caption),
        };
      })),
    });
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
    const currentRole = inferImageRole(activeHouse.images[currentIndex]);
    const targetRole = inferImageRole(activeHouse.images[targetIndex]);
    const roleAware = activeHouse.images.some((image) => Boolean(image.role));
    if (roleAware && (!INTERIOR_IMAGE_ROLES.includes(currentRole) || !INTERIOR_IMAGE_ROLES.includes(targetRole))) {
      setNotice("Nur die sechs Innenraumbilder können untereinander verschoben werden. Die übrigen Rollen haben feste Positionen.");
      return;
    }
    const images = [...activeHouse.images];
    const [movedImage] = images.splice(currentIndex, 1);
    images.splice(targetIndex, 0, movedImage);
    updateHouse({ images });
  };

  const normalizeImageSequence = () => {
    if (!activeHouse) return;
    updateHouse({ images: orderHouseImages(activeHouse.images) });
    setNotice("Die festen Bildrollen wurden sortiert; die gewählte Reihenfolge der Innenräume blieb erhalten.");
  };

  const addPromotionImage = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      input.value = "";
      setNotice("Das Aktionsbild muss als JPEG, PNG oder WebP vorliegen.");
      return;
    }
    if (file.size > MAX_PROMOTION_IMAGE_BYTES) {
      input.value = "";
      setNotice("Das Aktionsbild darf maximal 25 MB groß sein.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const promotionImage: HouseImage = {
        id: uid(),
        name: file.name,
        mimeType: file.type,
        dataUrl: String(reader.result),
        caption: "Aktuelles Angebot für dein neues Zuhause",
        isFloorplan: false,
        role: "promotion",
        captionLocked: false,
      };
      setState((current) => ({
        ...current,
        promotionImage,
        promotionImageEnabled: true,
      }));
      setNotice("Das Aktionsbild wurde eingefügt und als Anzeigebild für alle Haustypen aktiviert.");
    };
    reader.onerror = () => setNotice("Das Aktionsbild konnte nicht gelesen werden.");
    reader.readAsDataURL(file);
    input.value = "";
  };

  const removePromotionImage = () => {
    setState((current) => ({
      ...current,
      promotionImage: null,
      promotionImageEnabled: false,
    }));
    setNotice("Das Aktionsbild wurde entfernt. Jeder Haustyp verwendet wieder sein eigenes Titelbild.");
  };

  const selectOwner = (owner: AddressOwner) => {
    const existingProject = state.projects.find(
      (project) => projectOwner(project) === owner,
    );
    setActiveOwner(owner);
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

  const importAddressesFromExcel = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > MAX_ADDRESS_IMPORT_BYTES) {
      input.value = "";
      setNotice("Die Excel-Datei darf maximal 10 MB groß sein.");
      return;
    }
    setImportingAddresses(true);
    setAddressImportReport([]);
    try {
      const rows = await readSheet(file);
      const postalRegionIndex = await loadPostalRegionIndex();
      const result = parseAddressWorkbookRows(rows, state.projects, uid, postalRegionIndex);
      setAddressImportReport(result.errors.slice(0, 8));
      if (!result.projects.length) {
        const details = [
          result.duplicateCount ? `${result.duplicateCount} bereits gespeichert` : "",
          result.errors.length ? `${result.errors.length} fehlerhaft` : "",
        ].filter(Boolean).join(", ");
        setNotice(details
          ? `Keine neue Adresse importiert: ${details}.`
          : "Die Excel-Datei enthält keine importierbaren Adressen.");
        return;
      }
      const importedProjects = [...result.projects].sort(compareProjectsByRegion);
      const nextState: StudioState = {
        ...state,
        projects: [...importedProjects, ...state.projects],
      };
      setState(nextState);
      const firstProject = importedProjects[0];
      setActiveOwner(firstProject.owner);
      setActiveProjectId(firstProject.id);
      const savedAt = new Date().toISOString();
      await saveStudioState(nextState, savedAt);
      if (helperOnline) await queueDeviceCatalogSnapshot(nextState, savedAt);
      const details = [
        `${new Set(importedProjects.map(projectRegionLabel)).size} Regionsgruppen`,
        result.duplicateCount ? `${result.duplicateCount} Dubletten übersprungen` : "",
        result.errors.length ? `${result.errors.length} fehlerhafte Zeilen übersprungen` : "",
        result.unresolvedRegionCount ? `${result.unresolvedRegionCount} PLZ nicht eindeutig zugeordnet` : "",
      ].filter(Boolean).join(" · ");
      setNotice(`${result.projects.length} Adressen aus Excel importiert, nach Bundesland/Landkreis und PLZ sortiert und lokal gespeichert${details ? ` · ${details}` : ""}.`);
    } catch (error) {
      setNotice(error instanceof Error
        ? `Excel-Import fehlgeschlagen: ${error.message}`
        : "Die Excel-Datei konnte nicht gelesen werden.");
    } finally {
      input.value = "";
      setImportingAddresses(false);
    }
  };

  const toggleHouse = (houseId: string) => {
    if (!activeProject) return;
    const selected = activeProject.selectedHouseIds.includes(houseId);
    if (!selected && activeProject.selectedHouseIds.length >= 4) {
      setNotice("Pro Adresse können maximal vier Haustypen gewählt werden.");
      return;
    }
    updateProject({
      selectedHouseIds: selected
        ? activeProject.selectedHouseIds.filter((id) => id !== houseId)
        : [...activeProject.selectedHouseIds, houseId],
      listings: activeProject.listings.filter((listing) =>
        selected ? listing.templateId !== houseId : true,
      ),
    });
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
    if (!hasStoredOpenAiKey) {
      setTab("settings");
      setNotice("Bitte unter Export & Upload einen vollständigen OpenAI API-Schlüssel einfügen, der mit sk- beginnt, und anschließend prüfen und speichern.");
      return;
    }
    if (!helperOnline) {
      setNotice("Der lokale Helfer ist nicht erreichbar. Bitte die Anwendung über den Startknopf öffnen.");
      return;
    }

    const projectSnapshot = activeProject;
    const houseSnapshots = [...selectedHouses];
    const selectedHouseNames = houseSnapshots.map((house) => house.name);
    setGeneratingAi(true);
    setNotice(`Qualitätsmodus arbeitet: ${houseSnapshots.length} Inserat${houseSnapshots.length === 1 ? "" : "e"} werden individuell geschrieben und geprüft …`);

    try {
      const generated = await Promise.all(
        houseSnapshots.map(async (house, index) => {
          const previous = projectSnapshot.listings.find(
            (listing) => listing.templateId === house.id,
          );
          const response = await helperFetch("/generate-texts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: aiModel,
              house: {
                name: house.name,
                houseType: house.houseType,
                livingArea: house.livingArea,
                rooms: house.rooms,
                bedrooms: house.bedrooms,
                bathrooms: house.bathrooms,
                floors: house.floors,
                housePrice: house.housePrice,
                constructionYear: house.constructionYear,
                energyDemand: house.energyDemand,
                energyClass: IMMOPROFESSIONAL_DEFAULTS.energyClass,
                heatingType: "Fußbodenheizung mit Luft-Wasser-Wärmepumpe",
                energySource: "Umweltwärme und Strom",
                architecture: house.architecture,
                equipmentHighlights: house.equipmentHighlights,
                useStandardPackage: house.useStandardPackage,
              },
              project: {
                name: projectSnapshot.name,
                street: projectSnapshot.street,
                houseNumber: projectSnapshot.houseNumber,
                zip: projectSnapshot.zip,
                city: projectSnapshot.city,
                district: projectSnapshot.district,
                plotArea: projectSnapshot.plotArea,
                plotPrice: projectSnapshot.plotPrice,
                additionalCosts: projectSnapshot.additionalCosts,
                locationFacts: projectSnapshot.locationFacts,
                transportFacts: projectSnapshot.transportFacts,
                familyFacts: projectSnapshot.familyFacts,
                natureFacts: projectSnapshot.natureFacts,
                notes: projectSnapshot.notes,
              },
              provider: {
                company: state.provider.company,
                firstName: state.provider.firstName,
                lastName: state.provider.lastName,
                phone: state.provider.phone,
              },
              previousTexts: previous?.texts,
              listingPosition: index + 1,
              listingCount: houseSnapshots.length,
              selectedHouseNames,
              variationId: crypto.randomUUID(),
            }),
          });
          const data = (await response.json()) as {
            ok?: boolean;
            message?: string;
            texts?: ListingTexts;
            qualityChecked?: boolean;
          };
          if (!response.ok || !data.ok || !data.texts || !data.qualityChecked) {
            throw new Error(data.message || `Der KI-Text für „${house.name}“ konnte nicht erzeugt werden.`);
          }
          const version = (previous?.version ?? 0) + 1;
          const texts = completeListingTexts(
            house,
            projectSnapshot,
            state.provider,
            data.texts,
            version,
          );
          return { house, index, previous, texts, version };
        }),
      );

      const listings: GeneratedListing[] = generated.map(({ house, index, previous, texts, version }) => ({
        id: previous?.id ?? uid(),
        externalId:
          previous?.externalId ??
          `FPI-${projectSnapshot.id.slice(0, 8)}-${house.id.slice(0, 6)}-${index + 1}`.toUpperCase(),
        templateId: house.id,
        templateName: house.name,
        price: totalPrice(house, projectSnapshot),
        texts,
        version,
        projectingSettings: fillMissingProjectingDefaults(previous?.projectingSettings),
      }));

      setState((current) => ({
        ...current,
        projects: current.projects.map((project) =>
          project.id === projectSnapshot.id ? { ...project, listings } : project,
        ),
      }));
      setActiveProjectId(projectSnapshot.id);
      setTab("preview");
      setNotice(`${listings.length} Haus- und Lagetext${listings.length === 1 ? " wurde" : "e wurden"} individuell geschrieben und lokal geprüft. Alle vorgeschriebenen Felder blieben unverändert vorbefüllt.`);
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

  const packageInput = (listings = activeProject?.listings ?? []) => {
    if (!activeProject || listings.length === 0) {
      throw new Error("Es wurden noch keine Inserate erzeugt.");
    }
    const invalidImageCounts = listings
      .map((listing) => state.houses.find((house) => house.id === listing.templateId))
      .filter(
        (house) =>
          !house
          || effectiveHouseImages(state, house).length < MIN_HOUSE_IMAGES
          || effectiveHouseImages(state, house).length > MAX_HOUSE_IMAGES,
      )
      .map((house) => house ? `${house.name} (${effectiveHouseImages(state, house).length} Bilder)` : "Unbekannter Haustyp");
    if (invalidImageCounts.length) {
      throw new Error(
        `Für den Import werden pro Haustyp mindestens ${MIN_HOUSE_IMAGES} und maximal ${MAX_HOUSE_IMAGES} Bilder benötigt: ${invalidImageCounts.join(", ")}.`,
      );
    }
    const invalidSequences = listings.flatMap((listing) => {
      const house = state.houses.find((item) => item.id === listing.templateId);
      if (!house) return [];
      return imageSequenceIssues(effectiveHouseImages(state, house), {
        requiresUpperFloor: house.floors > 1,
        requiresThirdFloor: house.floors > 2,
        maximumImages: MAX_HOUSE_IMAGES,
      }).map((issue) => `${house.name}: ${issue}`);
    });
    if (invalidSequences.length) {
      throw new Error(`Die Bildfolge ist noch nicht exportbereit: ${invalidSequences.join(" ")}`);
    }
    if (!state.provider.providerNumber || !state.provider.company || !state.provider.email) {
      throw new Error("Bitte Anbieternummer, Firma und E-Mail unter Export & Upload ergänzen.");
    }
    const completedListings = listings.map((listing) => {
      const house = state.houses.find((item) => item.id === listing.templateId);
      if (!house) return listing;
      return {
        ...listing,
        texts: completeListingTexts(
          house,
          activeProject,
          state.provider,
          listing.texts,
          listing.version || 1,
        ),
      };
    });
    return {
      project: activeProject,
      listings: completedListings,
      houses: state.houses,
      provider: state.provider,
      promotionImage: state.promotionImage,
      promotionImageEnabled: state.promotionImageEnabled,
    };
  };

  const downloadPackage = async () => {
    try {
      const result = await buildImportPackage(packageInput());
      if (helperOnline) {
        const response = await helperFetch("/save-package", {
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
    const selectedListings = activeProject.listings.filter((listing) => selectedUploadIds.includes(listing.id));
    if (!selectedListings.length) {
      setNotice("Bitte mindestens ein Inserat für den Upload auswählen.");
      return;
    }
    if (!hasStoredFtpCredentials) {
      setNotice("Bitte den Immoprofessional-Zugang zuerst prüfen und im macOS-Schlüsselbund speichern.");
      return;
    }
    if (!helperOnline) {
      setNotice("Der lokale Upload-Helfer ist nicht erreichbar. Bitte die Anwendung über den Startknopf öffnen.");
      return;
    }
    const confirmed = window.confirm(
      `${selectedListings.length} ausgewählte${selectedListings.length === 1 ? "n Entwurf" : " Entwürfe"} jetzt an ${ftpHost} übertragen?\n\nDie Weitergabe an Portale ist im Paket deaktiviert. Bitte den Entwurfsstatus nach dem Import trotzdem in Immoprofessional prüfen.${ftpSecure === "none" ? "\n\nWARNUNG: Der Transport ist unverschlüsselt konfiguriert." : ""}`,
    );
    if (!confirmed) return;

    setUploading(true);
    setUploadStatus("Einzelpakete werden vorbereitet …");
    try {
      const input = packageInput(selectedListings);
      for (let index = 0; index < input.listings.length; index += 1) {
        const listing = input.listings[index];
        const position = `${index + 1}/${input.listings.length}`;
        setUploadStatus(`${position} · ${listing.templateName} wird gepackt …`);
        const result = await buildImportPackage({ ...input, listings: [listing] });
        setUploadStatus(`${position} · ZIP wird lokal übergeben …`);
        await new Promise<{ ok?: boolean; message?: string }>((resolve, reject) => {
          const request = new XMLHttpRequest();
          request.open("POST", "http://127.0.0.1:43182/upload-binary");
          request.setRequestHeader("Content-Type", "application/zip");
          request.setRequestHeader("X-FPI-Filename", encodeURIComponent(result.filename));
          request.setRequestHeader("X-FPI-Session", helperSessionToken());
          request.upload.onprogress = (event) => {
            if (event.lengthComputable && event.total > 0) {
              const percentage = Math.min(100, Math.round((event.loaded / event.total) * 100));
              setUploadStatus(percentage < 100
                ? `${position} · ZIP lokal: ${percentage} %`
                : `${position} · FTP-Transfer läuft …`);
            }
          };
          request.onerror = () => reject(new Error(`Paket ${position}: Der lokale Upload-Helfer hat die Verbindung unterbrochen.`));
          request.onload = () => {
            let responseData: { ok?: boolean; message?: string } = {};
            try {
              responseData = JSON.parse(request.responseText) as { ok?: boolean; message?: string };
            } catch {
              reject(new Error(`Paket ${position}: Der Upload-Helfer hat keine lesbare Antwort gesendet.`));
              return;
            }
            if (request.status < 200 || request.status >= 300 || !responseData.ok) {
              reject(new Error(`Paket ${position}: ${responseData.message || `Upload fehlgeschlagen (HTTP ${request.status}).`}`));
              return;
            }
            resolve(responseData);
          };
          request.send(result.blob);
        });
      }
      setNotice(`${input.listings.length} getrennte Inseratpakete wurden an Immoprofessional übertragen. Bitte den Importbericht und den Entwurfsstatus prüfen.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Upload fehlgeschlagen.");
    } finally {
      setUploading(false);
      setUploadStatus("");
    }
  };

  const clearSavedCredentials = async () => {
    if (!helperOnline) {
      setNotice("Der lokale Helfer ist nicht erreichbar.");
      return;
    }
    try {
      setCredentialsReady(false);
      const response = await helperFetch("/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear: true }),
      });
      const data = (await response.json()) as { ok?: boolean; message?: string };
      if (!response.ok || !data.ok) throw new Error(data.message || "Löschen fehlgeschlagen.");
      setOpenAiKey("");
      setOpenAiKeyVerified(false);
      setHasStoredOpenAiKey(false);
      setFtpUser("");
      setFtpPassword("");
      setHasStoredFtpCredentials(false);
      setCredentialSaveLabel("Gespeicherte Zugangsdaten wurden entfernt");
      setNotice("OpenAI- und Immoprofessional-Zugangsdaten wurden aus dem macOS-Schlüsselbund entfernt.");
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
      if (ftpUser.trim() && !ftpPassword && !hasStoredFtpCredentials) {
        throw new Error("Bitte das Immoprofessional-Passwort eingeben, damit der Zugang geprüft werden kann.");
      }
      if (openAiKey.trim()) {
        if (!looksLikeOpenAiApiKey(openAiKey)) {
          throw new Error("Der eingegebene Wert ist kein OpenAI API-Schlüssel. Bitte den vollständigen Schlüssel einfügen; er beginnt mit sk-.");
        }
        const validationResponse = await helperFetch("/validate-openai-key", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey: openAiKey.trim() }),
        });
        const validationData = (await validationResponse.json()) as { ok?: boolean; valid?: boolean; message?: string };
        if (!validationResponse.ok || !validationData.ok || !validationData.valid) {
          throw new Error(validationData.message || "OpenAI konnte den API-Schlüssel nicht bestätigen.");
        }
      }
      const response = await helperFetch("/credentials", {
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
            ftpSecure,
          },
        }),
      });
      const data = (await response.json()) as { ok?: boolean; message?: string; ftpValidated?: boolean };
      if (!response.ok || !data.ok) throw new Error(data.message || "Speichern fehlgeschlagen.");
      setCredentialsReady(true);
      setOpenAiKeyVerified(Boolean(openAiKey.trim()) || hasStoredOpenAiKey);
      setHasStoredOpenAiKey(Boolean(openAiKey.trim()) || hasStoredOpenAiKey);
      setHasStoredFtpCredentials(Boolean(ftpUser && (ftpPassword || hasStoredFtpCredentials)));
      setOpenAiKey("");
      setFtpPassword("");
      setCredentialSaveLabel(openAiKey.trim() ? "OpenAI-Schlüssel geprüft und im Schlüsselbund gespeichert" : "Zugangsdaten sind im Schlüsselbund gespeichert");
      setNotice(data.ftpValidated
        ? "Der Immoprofessional-Zugang und das FTPS-Zertifikat wurden geprüft; die Zugangsdaten liegen im macOS-Schlüsselbund."
        : openAiKey.trim()
          ? "Der OpenAI API-Schlüssel wurde erfolgreich geprüft und im macOS-Schlüsselbund gespeichert."
          : "Die Einstellungen wurden im macOS-Schlüsselbund aktualisiert.");
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
    downloadBlob(blob, `fabian-pascal-inseratstudio-sicherung-${new Date().toISOString().slice(0, 10)}.json`);
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
        const normalized = normalizeMandatoryListingStandards(normalizeProjectOwners(imported));
        const next = normalized.projects.length
          ? normalized
          : { ...normalized, projects: [newProject("fabian")] };
        setState(next);
        setActiveHouseId(next.houses[0]?.id ?? "");
        setActiveProjectId(next.projects[0]?.id ?? "");
        setActiveOwner(projectOwner(next.projects[0]));
        setNotice("Fabian&Pascal-Sicherung wurde lokal eingelesen.");
      } catch {
        setNotice("Die ausgewählte Datei ist keine gültige Fabian&Pascal-Sicherung.");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  if (isPrimaryTab === false) {
    return (
      <main className="loading-screen duplicate-tab-screen">
        <div className="loading-mark">F&amp;P</div>
        <h1>Inseratestudio ist bereits geöffnet</h1>
        <p>Bitte nur einen Inseratestudio-Tab verwenden. Schließe den anderen Tab; dieser Tab wird danach automatisch freigeschaltet.</p>
        <AppVersionBadge />
      </main>
    );
  }

  if (isPrimaryTab !== true || !ready || !activeProject || !activeHouse) {
    return (
      <main className="loading-screen">
        <div className="loading-mark">F&amp;P</div>
        <p>Fabian&amp;Pascal Inseratestudio wird vorbereitet …</p>
        <AppVersionBadge />
      </main>
    );
  }

  return (
    <main className="studio-shell">
      <AppVersionBadge />
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">F&amp;P</div>
          <div>
            <strong>Fabian&amp;Pascal Inseratestudio</strong>
            <span>Lokaler Arbeitsbereich</span>
          </div>
        </div>
        <div className="storage-pill" title={STORAGE_ID}>
          <i /> {saveLabel}
        </div>
      </header>

      <section className="hero-panel">
        <div>
          <span className="eyebrow">Vom Grundstück zum fertigen Entwurf</span>
          <h1>Vier Inserate. Eine Adresse. Volle Kontrolle.</h1>
          <p>
            Adresse erfassen, vier Haustypen wählen, Texte prüfen und erst dann als
            Entwurf zu Immoprofessional übertragen.
          </p>
        </div>
        <div className="workflow-summary">
          <div><b>{state.houses.length}</b><span>von {MAX_HOUSE_TEMPLATES} Haustypen</span></div>
          <div><b>{activeProject.selectedHouseIds.length}</b><span>ausgewählt</span></div>
          <div><b>{activeProject.listings.length}</b><span>Entwürfe</span></div>
        </div>
      </section>

      <nav className="step-nav" aria-label="Arbeitsbereiche">
        {([
          ["houses", "01", "Haustypen"],
          ["project", "02", "Adresse & Auswahl"],
          ["preview", "03", "Texte & Vorschau"],
          ["settings", "04", "Export & Upload"],
        ] as Array<[Tab, string, string]>).map(([id, number, label]) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
            <span>{number}</span>{label}
          </button>
        ))}
      </nav>

      {notice ? (
        <div className="notice" role="status">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} aria-label="Hinweis schließen">×</button>
        </div>
      ) : null}

      {tab === "houses" ? (
        <>
        <section className="workspace promotion-card">
          <div className="promotion-copy">
            <span className="eyebrow">Zentrales Anzeigebild</span>
            <h2>Aktionsbild für alle Haustypen</h2>
            <p>Standardmodus: Das Haus steht an Position 1. Aktionsmodus: Das Aktionsbild steht an Position 1 und das Haus direkt dahinter. Die gespeicherten Hausfolgen bleiben unverändert.</p>
          </div>
          {state.promotionImage ? (
            <div className="promotion-editor">
              <img src={state.promotionImage.dataUrl} alt={state.promotionImage.caption} />
              <div>
                <label className="image-caption">
                  <span>Bildtext im Inserat</span>
                  <input
                    value={state.promotionImage.caption}
                    onChange={(event) => setState((current) => ({
                      ...current,
                      promotionImage: current.promotionImage
                        ? { ...current.promotionImage, caption: event.target.value }
                        : null,
                    }))}
                  />
                </label>
                <label className="promotion-toggle">
                  <input
                    type="checkbox"
                    checked={state.promotionImageEnabled}
                    onChange={(event) => setState((current) => ({
                      ...current,
                      promotionImageEnabled: event.target.checked,
                    }))}
                  />
                  <span><b>Aktionsmodus verwenden</b><small>Das Aktionsbild wird Bild 1, die Hausansicht Bild 2. Bei mehr als 14 Gesamtbildern blockiert die Exportprüfung.</small></span>
                </label>
                <div className="button-row">
                  <label className="secondary file-label">Aktionsbild ersetzen<input type="file" accept="image/jpeg,image/png,image/webp" onChange={addPromotionImage} /></label>
                  <button className="primary" disabled={savingHouses} onClick={saveHousesNow}>{savingHouses ? "Wird gespeichert …" : "Aktionsbild speichern"}</button>
                  <button className="text-danger" onClick={removePromotionImage}>Aktionsbild entfernen</button>
                </div>
              </div>
            </div>
          ) : (
            <label className="promotion-upload">
              <span>+</span>
              <b>Aktionsbild einfügen</b>
              <small>JPEG, PNG oder WebP auswählen</small>
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={addPromotionImage} />
            </label>
          )}
        </section>
        <section className="workspace integrated-catalog-card">
          <details>
            <summary>
              <span><span className="eyebrow">Direkt in der App</span><b>Vollständige hinterlegte Preisliste</b></span>
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
              {state.houses.map((house, index) => (
                <button
                  key={house.id}
                  className={house.id === activeHouse.id ? "house-row active" : "house-row"}
                  onClick={() => {
                    setActiveHouseId(house.id);
                    setSelectedMediaItems([]);
                  }}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div><strong>{house.name}</strong><small>{house.livingArea} m² · {house.housePrice > 0 ? euro(house.housePrice) : "Preis offen"} · {house.images.length}/{MAX_HOUSE_IMAGES} Bilder</small></div>
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
              {activeHousePriceMatch ? (
                <div className={`price-catalog-status field-wide${activeHouse.housePrice === activeHousePriceMatch.price && activeHouse.houseType === activeHousePriceMatch.houseType ? " current" : ""}`}>
                  <span>
                    <b>Hinterlegte Preisliste: {activeHousePriceMatch.label}</b>
                    <small>{euro(activeHousePriceMatch.price)} · {activeHousePriceMatch.houseType} · Bildversionen V1, V2 usw. ändern den Preis nicht.</small>
                  </span>
                  <button
                    className="secondary"
                    type="button"
                    disabled={activeHouse.housePrice === activeHousePriceMatch.price && activeHouse.houseType === activeHousePriceMatch.houseType}
                    onClick={applyCatalogHousePrice}
                  >
                    {activeHouse.housePrice === activeHousePriceMatch.price && activeHouse.houseType === activeHousePriceMatch.houseType ? "Preis aktuell" : "Preis übernehmen"}
                  </button>
                </div>
              ) : null}
              <Field label="Wohnfläche" type="number" min={0} value={activeHouse.livingArea} suffix="m²" onChange={(value) => updateHouse({ livingArea: Number(value) })} />
              <Field label="Zimmer" type="number" min={0} value={activeHouse.rooms} onChange={(value) => updateHouse({ rooms: Number(value) })} />
              <Field label="Etagen" type="number" min={0} value={activeHouse.floors} onChange={(value) => updateHouse({ floors: Number(value) })} />
              <Field label="Schlafzimmer" type="number" min={0} value={activeHouse.bedrooms} onChange={(value) => updateHouse({ bedrooms: Number(value) })} />
              <Field label="Badezimmer" type="number" min={0} value={activeHouse.bathrooms} onChange={(value) => updateHouse({ bathrooms: Number(value) })} />
              <Field label="Baujahr geplant" type="number" value={activeHouse.constructionYear} onChange={(value) => updateHouse({ constructionYear: Number(value) })} />
              <Field label="Endenergiebedarf" type="number" min={0} value={activeHouse.energyDemand} suffix="kWh/(m²·a)" onChange={(value) => updateHouse({ energyDemand: Number(value) })} />
              <Field label="Energieklasse (fest)" value={IMMOPROFESSIONAL_DEFAULTS.energyClass} readOnly onChange={() => undefined} />
              <Field label="Heizungsart (fest)" value="Fußbodenheizung mit Luft-Wasser-Wärmepumpe" readOnly onChange={() => undefined} />
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

            <div className="image-section">
              <div className="section-heading compact">
                <div>
                  <span className="eyebrow">Automatische Bildauswahl</span>
                  <h3>{MIN_HOUSE_IMAGES} bis {MAX_HOUSE_IMAGES} Bilder je Haustyp</h3>
                  <small className="section-note">Haus, sechs Innenräume, emotionaler Catch, versionsgenaue Grundrisse, Auszeichnung, Vertrauen und QR-Abschluss.</small>
                </div>
                <div className="button-row image-heading-actions">
                  <button className="secondary" onClick={toggleMediaLibrary}>
                    {mediaLibraryOpen ? "Medienbibliothek schließen" : "Integrierte Medienbibliothek"}
                  </button>
                  <button
                    className="secondary"
                    disabled={replacingAllImageCaptions || captioningImageIds.length > 0 || !state.houses.some((house) => house.images.length > 0)}
                    onClick={replaceAllExistingImageCaptions}
                  >
                    {replacingAllImageCaptions ? "Vorhandene Bildtexte werden erneuert …" : "Alle vorhandenen Bildtexte erneuern"}
                  </button>
                  <label className={activeHouse.images.length >= MAX_HOUSE_IMAGES ? "upload-button disabled" : "upload-button"}>
                    Bilder auswählen
                    <input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={activeHouse.images.length >= MAX_HOUSE_IMAGES} onChange={addImages} />
                  </label>
                </div>
              </div>
              {mediaLibraryOpen ? (
                <section className="media-library" aria-label="Integrierte Medienbibliothek">
                  <div className="media-library-intro">
                    <div>
                      <b>Haus-, Innenraum-, Grundriss- und Vertrauensbilder</b>
                      <span>Alle hinterlegten Haus-, Innenraum-, Grundriss-, Standort- und Vertrauensbilder sind direkt in der App verfügbar.</span>
                    </div>
                    <strong>{mediaLibraryTotal} Treffer</strong>
                  </div>
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
                    />
                    <select
                      value={mediaLibraryGroup}
                      onChange={(event) => setMediaLibraryGroup(event.target.value)}
                      aria-label="Bildgruppe filtern"
                    >
                      <option value="">Alle Gruppen</option>
                      {mediaLibraryGroups.map((group) => (
                        <option key={group.name} value={group.name}>{group.name} ({group.count})</option>
                      ))}
                    </select>
                    <select
                      value={mediaLibraryKind}
                      onChange={(event) => setMediaLibraryKind(event.target.value as "" | MediaLibraryKind)}
                      aria-label="Bildart filtern"
                    >
                      <option value="">Alle Bildarten</option>
                      <option value="house">Hausansichten</option>
                      <option value="interior">Innenräume</option>
                      <option value="floorplan">Grundrisse</option>
                      <option value="location">Standortanzeigen</option>
                      <option value="marketing">Allgemeine Anzeigen</option>
                    </select>
                    <button className="secondary" type="submit" disabled={mediaLibraryLoading}>Filtern</button>
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
                        const selected = selectedMediaItems.some((selectedItem) => selectedItem.id === item.id);
                        const alreadyImported = activeHouse.images.some((image) => image.sourceId === item.id);
                        return (
                          <button
                            type="button"
                            key={item.id}
                            className={`media-library-card${selected ? " selected" : ""}${alreadyImported ? " imported" : ""}`}
                            onClick={() => toggleMediaSelection(item)}
                            disabled={alreadyImported && item.kind !== "house"}
                            aria-pressed={selected}
                            title={item.relativePath}
                          >
                            <img src={item.imageUrl} alt={item.caption} loading="lazy" />
                            <span className="media-selection-mark">{alreadyImported ? "✓" : selected ? "✓" : "+"}</span>
                            <span className="media-kind">{MEDIA_KIND_LABELS[item.kind]}</span>
                            <strong>{item.caption}</strong>
                            <small>{item.group}</small>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="media-library-message">Für diese Filter wurden keine Bilder gefunden.</div>
                  )}

                  <div className="media-library-footer">
                    <div className="media-pagination">
                      <button className="secondary" type="button" disabled={mediaLibraryLoading || mediaLibraryPage <= 1} onClick={() => void loadMediaLibrary(mediaLibraryPage - 1)}>Zurück</button>
                      <span>Seite {mediaLibraryPage} von {mediaLibraryPages}</span>
                      <button className="secondary" type="button" disabled={mediaLibraryLoading || mediaLibraryPage >= mediaLibraryPages} onClick={() => void loadMediaLibrary(mediaLibraryPage + 1)}>Weiter</button>
                    </div>
                    <div className="button-row">
                      <button
                        className="secondary"
                        type="button"
                        disabled={selectedMediaItems.length !== 1 || selectedMediaItems[0]?.kind !== "house" || importingMedia}
                        onClick={buildAutomaticImageSequence}
                      >
                        {importingMedia ? "Bildfolge wird geladen …" : "Komplette Bildfolge erstellen"}
                      </button>
                      <button
                        className="primary"
                        type="button"
                        disabled={!selectedMediaItems.length || importingMedia || activeHouse.images.length >= MAX_HOUSE_IMAGES}
                        onClick={importSelectedMedia}
                      >
                        {importingMedia ? "Bilder werden übernommen …" : `${selectedMediaItems.length} ausgewählte Bilder übernehmen`}
                      </button>
                    </div>
                  </div>
                </section>
              ) : null}
              {activeHouse.images.some((image) => Boolean(image.role)) ? (
                <div className={`sequence-status ${activeImageSequenceIssues.length ? "warning" : "ready"}`}>
                  <div>
                    <b>{activeImageSequenceIssues.length ? "Bildfolge noch nicht exportbereit" : "Bildfolge vollständig und korrekt sortiert"}</b>
                    <span>{activeImageSequenceIssues.length
                      ? activeImageSequenceIssues.join(" ")
                      : `${activeImageSequence.length} Bilder${state.promotionImageEnabled && state.promotionImage ? " im Aktionsmodus" : " im Standardmodus"}.`}</span>
                  </div>
                  <button className="secondary" type="button" onClick={normalizeImageSequence}>Nach Rollen sortieren</button>
                </div>
              ) : null}
              {activeHouse.images.length ? (
                <div className="image-grid">
                  {activeHouse.images.map((image, index) => {
                    const role = inferImageRole(image) as ImageRole;
                    const roleAware = activeHouse.images.some((item) => Boolean(item.role));
                    const canMove = !roleAware || INTERIOR_IMAGE_ROLES.includes(role);
                    return (
                    <article className={`image-card role-${role}`} key={image.id}>
                      <img src={image.dataUrl} alt={image.caption} />
                      <div className="image-order">{String(index + 1 + (state.promotionImageEnabled && state.promotionImage ? 1 : 0)).padStart(2, "0")}</div>
                      <label className="image-caption">
                        <span>{image.captionLocked ? "Feste Bildüberschrift" : captioningImageIds.includes(image.id) ? "Passender Bildtext wird verfeinert …" : "Variable Bildüberschrift"}</span>
                        {role === "cover" ? (
                          <select value={image.caption} onChange={(event) => updateImage(image.id, { caption: event.target.value })} aria-label="Überschrift des Haus-Titelbilds">
                            {TITLE_IMAGE_CAPTIONS.map((caption) => <option key={caption} value={caption}>{caption}</option>)}
                          </select>
                        ) : (
                          <input disabled={image.captionLocked} value={image.caption} onChange={(event) => updateImage(image.id, { caption: event.target.value })} aria-label={`Bildbeschreibung ${index + 1}`} />
                        )}
                      </label>
                      <div className="image-position">
                        <label>
                          <span>Position</span>
                          <select
                            value={index}
                            disabled={!canMove}
                            onChange={(event) => moveImage(image.id, Number(event.target.value))}
                            aria-label={`Position für Bild ${index + 1}`}
                          >
                            {activeHouse.images.map((targetImage, position) => ({ targetImage, position }))
                              .filter(({ targetImage }) => !roleAware || INTERIOR_IMAGE_ROLES.includes(inferImageRole(targetImage)))
                              .map(({ position }) => (
                              <option key={position} value={position}>{String(position + 1 + (state.promotionImageEnabled && state.promotionImage ? 1 : 0)).padStart(2, "0")}</option>
                            ))}
                          </select>
                        </label>
                        <b>{IMAGE_ROLE_LABELS[role]}</b>
                      </div>
                      <label className="image-role-select">
                        <span>Bildrolle</span>
                        <select value={role} onChange={(event) => updateImageRole(image.id, event.target.value as ImageRole)}>
                          {IMAGE_ROLE_VALUES.filter((value) => value !== "promotion").map((value) => (
                            <option key={value} value={value}>{IMAGE_ROLE_LABELS[value as ImageRole]}</option>
                          ))}
                        </select>
                      </label>
                      <button className="text-danger" onClick={() => updateHouse({ images: activeHouse.images.filter((item) => item.id !== image.id) })}>Entfernen</button>
                    </article>
                    );
                  })}
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
            <div className="address-owner-panel">
              <div>
                <span className="eyebrow">Getrennte Adressbücher</span>
                <h2>Wer bearbeitet diese Grundstücksadresse?</h2>
                <p>Fabian und Pascal verwalten jeweils ihre eigenen gespeicherten Adressen und können sie jederzeit erneut auswählen.</p>
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
                <span>Eine Zeile pro Grundstück. Benutzer, Bundesland und Landkreis werden automatisch zugeordnet; die Adressen erscheinen nach PLZ sortiert.</span>
              </div>
              <div className="button-row">
                <a className="secondary" href="/Fabian-Pascal-Adressimport-Vorlage.xlsx" download>Excel-Vorlage herunterladen</a>
                <label className={`primary file-label${importingAddresses ? " disabled" : ""}`}>
                  {importingAddresses ? "Excel wird eingelesen …" : "Excel-Adressen importieren"}
                  <input
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    disabled={importingAddresses}
                    onChange={importAddressesFromExcel}
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
            <div className="section-heading">
              <div><span className="eyebrow">Adressbuch {activeOwner === "pascal" ? "Pascal" : "Fabian"}</span><h2>Grundstück speichern &amp; wiederverwenden</h2></div>
              <div className="button-row">
                <select value={activeProject.id} onChange={(event) => setActiveProjectId(event.target.value)} aria-label="Gespeicherte Grundstücksadresse wählen">
                  {ownerProjectGroups.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.projects.map((project) => <option key={project.id} value={project.id}>{projectSelectionLabel(project)}</option>)}
                    </optgroup>
                  ))}
                </select>
                <button className="secondary" onClick={addProject}>Neue Adresse</button>
                <button className="primary" disabled={savingAddress} onClick={saveAddressNow}>{savingAddress ? "Wird gespeichert …" : "Adresse speichern"}</button>
              </div>
            </div>
            <div className="form-grid three">
              <Field label="Projektname" value={activeProject.name} onChange={(value) => updateProject({ name: value })} />
              <Field label="Straße" value={activeProject.street} onChange={(value) => updateProject({ street: value })} />
              <Field label="Hausnummer" value={activeProject.houseNumber} onChange={(value) => updateProject({ houseNumber: value })} />
              <Field label="PLZ" value={activeProject.zip} onChange={(value) => updateProject({ zip: value, federalState: "", county: "" })} />
              <Field label="Ort" value={activeProject.city} onChange={(value) => updateProject({ city: value, federalState: "", county: "" })} />
              <Field label="Ortsteil" value={activeProject.district} onChange={(value) => updateProject({ district: value })} />
              <Field label="Bundesland · aus Excel-PLZ" value={activeProject.federalState || "Nicht zugeordnet"} readOnly onChange={() => undefined} />
              <Field label="Landkreis · aus Excel-PLZ" value={activeProject.county || "Nicht zugeordnet"} readOnly onChange={() => undefined} />
              <Field label="Grundstücksfläche" type="number" min={0} suffix="m²" value={activeProject.plotArea} onChange={(value) => updateProject({ plotArea: Number(value) })} />
              <Field label="Grundstückspreis" type="number" min={0} suffix="€" value={activeProject.plotPrice} onChange={(value) => updateProject({ plotPrice: Number(value) })} />
              <Field label="Berücksichtigte Nebenkosten" type="number" min={0} suffix="€" value={activeProject.additionalCosts} onChange={(value) => updateProject({ additionalCosts: Number(value) })} />
            </div>

            <div className="fixed-project-copy">
              <div className="section-heading compact">
                <div>
                  <span className="eyebrow">Bereits im Inserat integriert</span>
                  <h3>Vorgeschriebene Texte</h3>
                  <small className="section-note">Diese Felder sind vollständig vorbefüllt und werden weder von der KI neu geschrieben noch beim Export leer gelassen.</small>
                </div>
                <b className="fixed-copy-badge">automatisch befüllt</b>
              </div>
              <div className="fixed-copy-fields">
                <TextField label="Fester Abschluss der Objektbeschreibung" rows={4} value={FIXED_DESCRIPTION_CTA} readOnly />
                <TextField label="Ausstattung" rows={12} value={FIXED_EQUIPMENT_TEXT} readOnly />
                <TextField label="Sonstiges" rows={9} value={FIXED_OTHER_TEXT} readOnly />
                <TextField label="Provision" rows={3} value={FIXED_PROVISION_TEXT} readOnly />
                <TextField label="Anmerkung" rows={5} value={FIXED_ANNOTATION_TEXT} readOnly />
                <TextField label="Allgemeine Geschäftsbedingungen" rows={4} value={FIXED_TERMS_TEXT} readOnly />
                <TextField label="Freier Textblock für Empfehlungen" rows={9} value={FIXED_RECOMMENDATION_TEXT} readOnly />
              </div>
            </div>

            <details className="optional-project-facts">
              <summary>
                <span>Optionale geprüfte Zusatzinformationen für den Lagetext</span>
                <small>Nur öffnen, wenn zum vorgeprüften Grundstück weitere belastbare Angaben vorliegen.</small>
              </summary>
              <div className="optional-project-facts-grid">
                <TextField label="Geprüfte Lagefakten" value={activeProject.locationFacts} placeholder="z. B. gewachsenes Wohngebiet, ruhige Seitenstraße …" onChange={(value) => updateProject({ locationFacts: value })} />
                <TextField label="Verkehr & Erreichbarkeit" value={activeProject.transportFacts} placeholder="Nur bestätigte Angaben eintragen." onChange={(value) => updateProject({ transportFacts: value })} />
                <TextField label="Familie & Versorgung" value={activeProject.familyFacts} placeholder="Schulen, Kitas, Einkauf – nur geprüfte Fakten." onChange={(value) => updateProject({ familyFacts: value })} />
                <TextField label="Natur & Freizeit" value={activeProject.natureFacts} placeholder="Wald, Seen, Wege oder Freizeitangebote." onChange={(value) => updateProject({ natureFacts: value })} />
                <TextField label="Zusätzliche Hinweise" value={activeProject.notes} onChange={(value) => updateProject({ notes: value })} />
              </div>
            </details>

            <div className="selection-section">
              <div className="section-heading compact">
                <div><span className="eyebrow">Maximal vier auswählen</span><h3>Welche Häuser passen zu dieser Adresse?</h3></div>
                <b>{activeProject.selectedHouseIds.length}/4</b>
              </div>
              <div className="selection-grid">
                {state.houses.map((house) => {
                  const selected = activeProject.selectedHouseIds.includes(house.id);
                  const displayImage = effectiveHouseImages(state, house)[0];
                  return (
                    <button key={house.id} className={selected ? "select-card selected" : "select-card"} onClick={() => toggleHouse(house.id)}>
                      <span className="selection-check">{selected ? "✓" : "+"}</span>
                      {displayImage ? <img src={displayImage.dataUrl} alt={displayImage.caption} /> : <div className="image-placeholder">F&amp;P</div>}
                      <div><strong>{house.name}</strong><small>{house.livingArea} m² · {house.rooms} Zimmer</small><b>{euro(totalPrice(house, activeProject))}</b></div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="project-text-preview">
              <div className="section-heading compact">
                <div>
                  <span className="eyebrow">Bereits vorbefüllt</span>
                  <h3>Nur Haus und Lage werden individuell</h3>
                  <small className="section-note">Nach der Hausauswahl siehst du hier sofort Überschrift, Hausbeschreibung und Lagetext. Nur diese beiden Fließtexte werden anschließend durch die KI verfeinert.</small>
                </div>
                <b>{secondStepTextPreviews.length} Vorschau{secondStepTextPreviews.length === 1 ? "" : "en"}</b>
              </div>
              {secondStepTextPreviews.length ? (
                <div className="project-copy-list">
                  {secondStepTextPreviews.map(({ house, texts }, index) => (
                    <details className="project-copy-item" key={house.id} open={index === 0}>
                      <summary>
                        <span>{house.name}</span>
                        <b>{texts.title}</b>
                      </summary>
                      <div className="project-copy-fields">
                        <TextField label="Überschrift" rows={2} value={texts.title} readOnly />
                        <TextField label="Objektbeschreibung · wird hausbezogen verfeinert" rows={9} value={texts.description} readOnly />
                        <TextField label="Lage · wird ortsbezogen verfeinert" rows={9} value={texts.location} readOnly />
                      </div>
                    </details>
                  ))}
                </div>
              ) : (
                <div className="empty-state compact"><b>Noch keine Textvorschau</b><span>Wähle mindestens einen Haustyp aus; danach erscheinen die vorbefüllten Texte direkt hier im zweiten Schritt.</span></div>
              )}
            </div>
            <div className="action-bar">
              <div><b>Bereit für neue Inserattexte?</b><span>Die App kombiniert einen emotionalen Checklisten-Vorteil mit Ort, gerundeter Wohnfläche und Zimmerzahl. Objektbeschreibung und Lage werden individuell geschrieben; die vorgeschriebenen Textblöcke bleiben geschützt.</span></div>
              <div className="button-row action-buttons">
                <button className="primary" disabled={generatingAi} onClick={generateAiListings}>{generatingAi ? "Haus & Lage werden geschrieben …" : "Nur Haus- & Lagetexte erzeugen"}</button>
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
                  <button className="primary" disabled={generatingAi} onClick={generateAiListings}>{generatingAi ? "Haus & Lage werden geschrieben …" : "Haus- & Lagetexte neu schreiben"}</button>
              </div>
            </div>
            {activeProject.listings.length ? (
              <div className="listing-stack">
                {activeProject.listings.map((listing) => {
                  const house = state.houses.find((item) => item.id === listing.templateId);
                  const displayImages = house ? effectiveHouseImages(state, house) : [];
                  const displayImage = displayImages[0];
                  return (
                    <article className="listing-card" key={listing.id}>
                      <header>
                        <div className="listing-thumb">
                          {displayImage ? <img src={displayImage.dataUrl} alt={displayImage.caption} /> : <span>F&amp;P</span>}
                        </div>
                        <div><span className="eyebrow">Inserat-Überschrift · Version {listing.version}</span><h3>{listing.texts.title}</h3><p>{listing.templateName} · {house?.livingArea} m² · {house?.rooms} Zimmer · {activeProject.city}</p></div>
                        <div className="price-tag"><span>Angebotspreis</span><b>{euro(listing.price)}</b></div>
                      </header>
                      <div className="listing-fields">
                        <TextField label="Überschrift · unverändert aus Schritt 2" rows={2} value={listing.texts.title} readOnly />
                        <TextField label="1 · Objektbeschreibung" rows={8} value={listing.texts.description} onChange={(value) => updateListingText(listing.id, "description", value)} />
                        <TextField label="2 · Ausstattung · fest" rows={8} value={listing.texts.equipment} readOnly />
                        <TextField label="3 · Lage" rows={7} value={listing.texts.location} onChange={(value) => updateListingText(listing.id, "location", value)} />
                        <TextField label="4 · Sonstiges · fest" rows={7} value={listing.texts.other} readOnly />
                        <TextField label="5 · Provision · fest" rows={2} value={FIXED_PROVISION_TEXT} readOnly />
                        <TextField label="6 · Anmerkung · fest" rows={4} value={FIXED_ANNOTATION_TEXT} readOnly />
                        <TextField label="7 · Allgemeine Geschäftsbedingungen · fest" rows={3} value={FIXED_TERMS_TEXT} readOnly />
                        <TextField label="8 · Freier Textblock für Empfehlungen · fest" rows={7} value={FIXED_RECOMMENDATION_TEXT} readOnly />
                      </div>
                      <footer><span>{displayImages.length} Bilder automatisch zugeordnet{state.promotionImageEnabled && state.promotionImage ? " · Aktionsbild an Position 1" : ""}</span><span>Weitergabe an Portale: <b>deaktiviert</b></span></footer>
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

      {tab === "settings" ? (
        <section className="workspace two-column settings-layout">
          <div className="content-card">
            <div className="section-heading"><div><span className="eyebrow">OpenImmo-Absender</span><h2>Anbieterdaten</h2></div></div>
            <div className="form-grid two">
              <Field label="Anbieternummer" value={state.provider.providerNumber} onChange={(value) => setState((current) => ({ ...current, provider: { ...current.provider, providerNumber: value } }))} />
              <Field label="Firma" value={state.provider.company} onChange={(value) => setState((current) => ({ ...current, provider: { ...current.provider, company: value } }))} />
              <Field label="Vorname" value={state.provider.firstName} onChange={(value) => setState((current) => ({ ...current, provider: { ...current.provider, firstName: value } }))} />
              <Field label="Nachname" value={state.provider.lastName} onChange={(value) => setState((current) => ({ ...current, provider: { ...current.provider, lastName: value } }))} />
              <Field label="E-Mail" type="email" value={state.provider.email} onChange={(value) => setState((current) => ({ ...current, provider: { ...current.provider, email: value } }))} />
              <Field label="Telefon" value={state.provider.phone} onChange={(value) => setState((current) => ({ ...current, provider: { ...current.provider, phone: value } }))} />
            </div>

            <div className="divider" />
            <div className="section-heading"><div><span className="eyebrow">Qualitätsmodus · verschlüsselt gespeichert</span><h2>KI-Textgenerator</h2></div><span className={helperOnline ? "status online" : "status offline"}>{helperOnline ? "Generator bereit" : "Lokaler Helfer offline"}</span></div>
            <div className="form-grid two">
              <label className="field">
                <span>OpenAI API-Schlüssel</span>
                <div className="input-shell">
                  <input
                    type="password"
                    value={openAiKey}
                    placeholder={hasStoredOpenAiKey ? "Im macOS-Schlüsselbund gespeichert" : "sk-…"}
                    onChange={(event) => {
                      setOpenAiKey(event.target.value);
                      setOpenAiKeyVerified(false);
                    }}
                  />
                </div>
                <small className={openAiKey.trim() && !looksLikeOpenAiApiKey(openAiKey) ? "key-status invalid" : "key-status"}>
                  {!openAiKey.trim()
                    ? hasStoredOpenAiKey ? "Schlüssel ist im macOS-Schlüsselbund gespeichert." : "Noch kein Schlüssel eingetragen."
                    : !looksLikeOpenAiApiKey(openAiKey)
                      ? "Kein OpenAI API-Schlüssel: Der vollständige Schlüssel beginnt mit sk-."
                      : openAiKeyVerified
                        ? "Schlüssel erkannt und verschlüsselt gespeichert."
                        : "Format erkannt – bitte unten prüfen und speichern."}
                </small>
              </label>
              <label className="field">
                <span>Qualitätsprofil</span>
                <select value={aiModel} onChange={(event) => setAiModel(event.target.value as AiModel)}>
                  <option value="gpt-5.6-luna">Günstige Empfehlung · GPT-5.6 Luna</option>
                  <option value="gpt-5.6-terra">Mehr Qualitätsreserve · GPT-5.6 Terra</option>
                  <option value="gpt-5.6-sol">Maximale Textqualität · GPT-5.6 Sol</option>
                </select>
              </label>
            </div>
            <p className="security-note">Der Schlüssel wird vor dem Speichern direkt bei OpenAI geprüft und anschließend im macOS-Schlüsselbund geschützt. Nach dem Speichern wird er nicht mehr an die Browseroberfläche zurückgegeben. Die App erstellt die Überschrift aus Checklisten-Vorteilen, Ort, gerundeter Wohnfläche und Zimmerzahl. An die Text-KI werden weder Straße, Hausnummer noch PLZ übergeben.</p>

            <div className="divider" />
            <div className="section-heading"><div><span className="eyebrow">Verschlüsselt auf diesem Gerät</span><h2>Immoprofessional-Zugang</h2></div><span className={helperOnline ? "status online" : "status offline"}>{helperOnline ? "Upload bereit" : "Upload-Helfer offline"}</span></div>
            <div className="form-grid two">
              <Field label="FTP-Host" value={ftpHost} onChange={setFtpHost} />
              <Field label="Zielordner" value={ftpPath} onChange={setFtpPath} />
              <Field label="FTP-Benutzername" value={ftpUser} onChange={setFtpUser} />
              <Field label="FTP-Passwort" type="password" value={ftpPassword} onChange={setFtpPassword} />
              <label className="field">
                <span>Transportverschlüsselung</span>
                <select value={ftpSecure} onChange={(event) => setFtpSecure(event.target.value as FtpSecurity)}>
                  <option value="explicit">Explizites FTPS · Zertifikat prüfen</option>
                  <option value="implicit">Implizites FTPS · Zertifikat prüfen</option>
                  <option value="none">Unverschlüsseltes FTP · nur falls zwingend</option>
                </select>
              </label>
            </div>
            <p className="security-note">{hasStoredFtpCredentials ? "Der Zugang ist im macOS-Schlüsselbund gespeichert. Ein leeres Passwortfeld behält das bestehende Passwort." : "Benutzername und Passwort werden erst nach dem Speichern für Uploads freigeschaltet."} Der zertifikatskonforme Standardhost ist <code>{IMMOPROFESSIONAL_FTPS_HOST}</code>. Frühere LivingHaus-Aliase werden automatisch darauf umgestellt. FTPS prüft weiterhin Zertifikatskette und Hostnamen.</p>

            <div className="credential-vault-card">
              <div><span className="eyebrow">macOS-Schlüsselbund</span><b>{credentialSaveLabel}</b><small>Geschützt für das aktuell angemeldete macOS-Benutzerkonto.</small></div>
              <div className="button-row">
                <button className="primary" disabled={savingCredentials} onClick={saveCredentialsNow}>{savingCredentials ? "Schlüssel wird geprüft …" : "Zugangsdaten prüfen & speichern"}</button>
                <button className="secondary" disabled={savingCredentials} onClick={clearSavedCredentials}>Zugangsdaten löschen</button>
              </div>
            </div>
          </div>

          <aside className="upload-card">
            <span className="eyebrow">Kontrollierter Entwurfsimport</span>
            <h2>{selectedUploadIds.length} von {activeProject.listings.length} ausgewählt</h2>
            <p>Wähle ausdrücklich aus, welche Inserate als getrennte OpenImmo-Pakete übertragen werden. Adressfreigabe und Portalweitergabe bleiben deaktiviert.</p>
            <div className="upload-selection" aria-label="Inserate für den Upload auswählen">
              {activeProject.listings.map((listing) => (
                <label key={listing.id}>
                  <input
                    type="checkbox"
                    checked={selectedUploadIds.includes(listing.id)}
                    onChange={(event) => setExcludedUploadIds((current) => event.target.checked
                      ? current.filter((id) => id !== listing.id)
                      : [...new Set([...current, listing.id])])}
                  />
                  <span>{listing.templateName}</span>
                </label>
              ))}
            </div>
            <div className="upload-facts">
              <div><span>Projekt</span><b>{activeProject.name}</b></div>
              <div><span>Ziel</span><b>{ftpHost}</b></div>
              <div><span>Format</span><b>OpenImmo 1.2.7 · ZIP</b></div>
              <div><span>Transport</span><b>{ftpSecure === "none" ? "FTP · unverschlüsselt" : "FTPS · Zertifikat geprüft"}</b></div>
              <div><span>Automatik</span><b>A++ · KFW40/55 · Wärmepumpe · Pflichtausstattung</b></div>
              <div><span>Veröffentlichung</span><b>manuell in Immoprofessional</b></div>
            </div>
            <button className="primary full" disabled={uploading || !selectedUploadIds.length} onClick={uploadPackage}>{uploading ? uploadStatus || "Wird übertragen …" : "Auswahl zu Immoprofessional laden"}</button>
            <button className="secondary full" disabled={!activeProject.listings.length} onClick={downloadPackage}>Importpaket nur herunterladen</button>
            <p className="first-test">Der erste Upload sollte mit einem einzelnen, nicht veröffentlichten Testobjekt geprüft werden. Immoprofessional kann eigene Importregeln anwenden.</p>
          </aside>

          <div className="content-card backup-card">
            <div><span className="eyebrow">Strikt getrennte Speicherung</span><h3>Fabian&amp;Pascal-Sicherung</h3><p>Haustypen, Bilder und Adressprojekte werden doppelt lokal gespeichert: im Speicher <code>{STORAGE_ID}</code> und unter <code>~/Library/Application Support</code>. Zugangsdaten liegen separat im macOS-Schlüsselbund. deviq und Plotverium werden weder gelesen noch beschrieben.</p></div>
            <div className="button-row"><button className="secondary" onClick={exportCatalog}>Sicherung herunterladen</button><label className="secondary file-label">Sicherung einlesen<input type="file" accept="application/json" onChange={importCatalog} /></label></div>
          </div>
        </section>
      ) : null}
    </main>
  );
}
