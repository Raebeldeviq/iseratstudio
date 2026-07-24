"use client";
/* eslint-disable @next/next/no-img-element */

import { ChangeEvent, useEffect, useRef, useState } from "react";
import { readSheet } from "read-excel-file/browser";
import appPackage from "../package.json";
import { resolveHousePrice } from "../house-price-catalog.mjs";
import { fillMissingProjectingDefaults } from "../listing-copy.mjs";
import {
  captionForImageRole,
  IMAGE_ROLE_LABELS,
  IMAGE_ROLE_VALUES,
  inferImageRole,
  isFixedCaptionRole,
  orderHouseImages,
} from "../image-sequence.mjs";
import { parseAddressWorkbookRows } from "./lib/address-import";
import { APP_VERSION } from "./lib/app-version.mjs";
import {
  headlinesAreTooSimilar,
  removePrivateAddressFromHeadline,
} from "./lib/headline-diversity.js";
import { buildImportPackage } from "./lib/openimmo";
import {
  MAX_PROMOTED_LISTINGS,
  MAX_PROMOTION_IMAGES,
  projectPromotionCount,
  randomPromotionAssignments,
  reconcilePromotionAssignments,
} from "./lib/promotion-images.js";
import { ADDRESS_OWNERS, normalizeProjectOwners, projectOwner } from "./lib/project-owners";
import { totalPrice } from "./lib/text-generator";
import {
  createTotalSyncRun,
  projectIsReadyForTotalSync,
  projectsInTotalSyncScope,
  TOTAL_SYNC_LISTINGS_PER_ADDRESS,
  totalSyncCanResume,
  totalSyncExternalId,
  totalSyncProgress,
} from "./lib/total-sync";
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
  TotalSyncProjectTask,
  TotalSyncRun,
  TotalSyncScope,
} from "./types";

type Tab = "houses" | "project" | "preview" | "settings";
type AiModel = "gpt-5.6-luna" | "gpt-5.6-terra" | "gpt-5.6-sol";
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
const MAX_HOUSE_TEMPLATES = 25;
const MEDIA_KIND_LABELS: Record<MediaLibraryKind, string> = {
  house: "Hausansicht",
  floorplan: "Grundriss",
  interior: "Innenraum",
  location: "Standort",
  marketing: "Anzeige",
};

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
  providerNumber: "",
  company: "Fabian Raebel - Freie Handelsvertretung der Living Fertighaus GmbH",
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
};

const initialState = (): StudioState => ({
  version: 1,
  houses: [newHouse(1)],
  projects: [newProject("fabian")],
  provider: defaultProvider,
  promotionImages: [],
  promotionImage: null,
  promotionImageEnabled: false,
});

function promotionPool(state: StudioState): HouseImage[] {
  if (Array.isArray(state.promotionImages)) return state.promotionImages;
  return state.promotionImage ? [state.promotionImage] : [];
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
      aria-label={`Geöffnete InseratStudio-Version ${APP_VERSION}`}
      title={`Fabian&Pascal Inseratestudio · Version ${APP_VERSION}`}
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
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  suffix?: string;
  min?: number;
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <label className="field field-wide">
      <span>{label}</span>
      <textarea
        value={value}
        rows={rows}
        placeholder={placeholder}
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
      const imageIds = [
        ...manifestData.state.houses.flatMap((house) => house.images.map((image) => image.id)),
        ...promotionPool(manifestData.state).map((image) => image.id),
      ];
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
            dataUrl: dataUrlById.get(image.id) ?? "",
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
  const [tab, setTab] = useState<Tab>("houses");
  const [state, setState] = useState<StudioState>(initialState);
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
  const [aiModel, setAiModel] = useState<AiModel>("gpt-5.6-luna");
  const [generatingAi, setGeneratingAi] = useState(false);
  const [credentialsReady, setCredentialsReady] = useState(false);
  const [credentialSaveLabel, setCredentialSaveLabel] = useState("Verschlüsselter Zugangstresor wird vorbereitet …");
  const [savingHouses, setSavingHouses] = useState(false);
  const [savingAddress, setSavingAddress] = useState(false);
  const [savingCredentials, setSavingCredentials] = useState(false);
  const [importingAddresses, setImportingAddresses] = useState(false);
  const [addressImportReport, setAddressImportReport] = useState<string[]>([]);
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
  const [totalSyncScope, setTotalSyncScope] = useState<TotalSyncScope>("fabian");
  const [totalSyncBusy, setTotalSyncBusy] = useState(false);
  const [totalSyncStopping, setTotalSyncStopping] = useState(false);
  const [totalSyncStatus, setTotalSyncStatus] = useState("");
  const totalSyncStopRequested = useRef(false);

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
    navigator.locks.request(
      "fabian-pascal-inseratestudio-active-tab",
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
        "fabian-pascal-inseratestudio-active-tab",
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
    Promise.allSettled([loadStudioSnapshot(), loadWindowsCatalogSnapshot()])
      .then((results) => {
        const candidates: Array<{
          state: StudioState;
          savedAt: string;
          source: "browser" | "legacy" | "windows";
        }> = [];
        for (const result of results) {
          if (result.status === "fulfilled" && result.value) candidates.push(result.value);
        }
        candidates.sort((left, right) => snapshotTime(right.savedAt) - snapshotTime(left.savedAt));
        const selected = candidates[0];
        const loaded = normalizeProjectOwners(selected?.state ?? initialState());
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
        setSaveLabel(selected?.source === "windows" ? "Aus lokaler Gerätesicherung geladen" : "Doppelt lokal gespeichert");
      })
      .catch(() => setSaveLabel("Lokaler Speicher nicht verfügbar"))
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
            aiModel?: AiModel;
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
        .then(() => setSaveLabel(helperOnline ? "Browser + Gerätesicherung aktuell" : "Lokal im Browser gespeichert"))
        .catch(() => setSaveLabel("Speichern fehlgeschlagen"));
    }, 450);
    return () => window.clearTimeout(timer);
  }, [helperOnline, isPrimaryTab, ready, state]);

  const activeHouses = state.houses.filter((house) => house.archived !== true);
  const activeHouse =
    activeHouses.find((house) => house.id === activeHouseId) ?? activeHouses[0];
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
  const resumableTotalSync = totalSyncCanResume(state.totalSyncRun);
  const totalSyncEffectiveScope = resumableTotalSync && state.totalSyncRun
    ? state.totalSyncRun.scope
    : totalSyncScope;
  const totalSyncScopedProjects = projectsInTotalSyncScope(state.projects, totalSyncEffectiveScope);
  const totalSyncReadyProjects = totalSyncScopedProjects.filter(projectIsReadyForTotalSync);
  const totalSyncSkippedProjects = totalSyncScopedProjects.length - totalSyncReadyProjects.length;
  const totalSyncEligibleHouses = activeHouses.filter((house) => {
    const imageCount = house.images.length;
    return imageCount >= MIN_HOUSE_IMAGES && imageCount <= MAX_HOUSE_IMAGES;
  });
  const totalSyncRunProgress = totalSyncProgress(state.totalSyncRun);

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
        setNotice(`${images.length} feste Bildüberschrift${images.length === 1 ? "" : "en"} aus Pascals Bildfolge wurde${images.length === 1 ? "" : "n"} übernommen.`);
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
      return;
    }
    if (!helperOnline) {
      setNotice("Die iCloud-Medienbibliothek ist verfügbar, sobald der lokale Helfer läuft.");
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
    setNotice("Die Bilder wurden nach Pascals Bildrollen sortiert. Innerhalb der Innenräume bleibt deine gewählte Reihenfolge erhalten.");
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
    setNotice(`${classified} vorhandene Bilder aus allen Haustypen wurden ohne erneuten Upload mit Pascals Bildrollen ergänzt.`);
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
  }): Promise<{ texts: ListingTexts; writingProfile: string }> => {
    const maxAttempts = Math.max(1, input.maxAttempts ?? 1);
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await fetch("http://127.0.0.1:43182/generate-texts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey: openAiKey.trim(),
            model: aiModel,
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
        };
        if (!response.ok || !data.ok || !data.texts || !data.qualityChecked) {
          const error = new Error(
            data.message || `Der KI-Text für „${input.house.name}“ konnte nicht erzeugt werden.`,
          ) as Error & { status?: number };
          error.status = response.status;
          throw error;
        }
        return {
          texts: data.texts,
          writingProfile: data.writingProfile ?? "",
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Die KI-Texte konnten nicht erzeugt werden.");
        const status = (lastError as Error & { status?: number }).status;
        const retryable = status === undefined || status === 422 || status === 429 || status >= 500;
        if (attempt >= maxAttempts || !retryable) throw lastError;
        await new Promise((resolve) => window.setTimeout(resolve, 2500 * attempt));
      }
    }
    throw lastError ?? new Error("Die KI-Texte konnten nicht erzeugt werden.");
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
        ? "Der lokale Textgenerator verwendet noch eine ältere Programmfassung. Bitte das Inseratestudio schließen und erneut über den Startknopf öffnen."
        : "Der lokale Helfer ist nicht erreichbar. Bitte die Anwendung über den Startknopf öffnen.");
      return;
    }

    const projectSnapshot = activeProject;
    const houseSnapshots = [...selectedHouses];
    const selectedHouseNames = houseSnapshots.map((house) => house.name);
    const headlineCycleId = crypto.randomUUID();
    const historicalTitles = Array.from(new Set(
      state.projects.flatMap((project) => (
        project.listings.flatMap((listing) => [
          ...(listing.titleHistory ?? []),
          listing.texts.title,
        ]).map((title) => removePrivateAddressFromHeadline(title, project))
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
      const listings: GeneratedListing[] = generated.map(({
        house,
        index,
        previous,
        texts,
        writingProfile,
      }) => ({
        id: previous?.id ?? uid(),
        externalId:
          previous?.externalId ??
          `FPI-${projectSnapshot.id.slice(0, 8)}-${house.id.slice(0, 6)}-${index + 1}`.toUpperCase(),
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
            ? { ...project, promotionAssignments, listings }
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
    if (!state.provider.providerNumber || !state.provider.company || !state.provider.email) {
      throw new Error("Bitte Anbieternummer, Firma und E-Mail unter Export & Upload ergänzen.");
    }
    return {
      project,
      listings,
      houses: state.houses,
      provider: state.provider,
      promotionImages: promotionPool(state),
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
    await new Promise<{ ok?: boolean; message?: string }>((resolve, reject) => {
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
      request.send(blob);
    });
  };

  const uploadSingleListingPackage = async (input: {
    project: ProjectInput;
    listing: GeneratedListing;
    position: string;
    onStatus: (status: string) => void;
    maxAttempts?: number;
  }): Promise<void> => {
    const result = await buildImportPackage(
      packageInputFor(input.project, [input.listing]),
    );
    const maxAttempts = Math.max(1, input.maxAttempts ?? 1);
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        input.onStatus(`${input.position} · ${input.listing.templateName} wird einzeln übertragen …`);
        await uploadBinaryPackage(result.blob, result.filename, input.position, input.onStatus);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Upload fehlgeschlagen.");
        if (attempt >= maxAttempts) throw lastError;
        input.onStatus(`${input.position} · neuer Uploadversuch ${attempt + 1}/${maxAttempts} …`);
        await new Promise((resolve) => window.setTimeout(resolve, 3000 * attempt));
      }
    }
    throw lastError ?? new Error("Upload fehlgeschlagen.");
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
    if (!ftpUser || !ftpPassword) {
      setNotice("Bitte FTP-Benutzername und Passwort eingeben.");
      return;
    }
    if (!helperOnline) {
      setNotice("Der lokale Upload-Helfer ist nicht erreichbar. Bitte die Anwendung über den Startknopf öffnen.");
      return;
    }
    const confirmed = window.confirm(
      `${activeProject.listings.length} Entwurf${activeProject.listings.length === 1 ? "" : "e"} jetzt an ${ftpHost} übertragen?\n\nDie Weitergabe an Portale ist im Paket deaktiviert. Bitte den Entwurfsstatus nach dem Import trotzdem in Immoprofessional prüfen.`,
    );
    if (!confirmed) return;

    setUploading(true);
    setUploadStatus("Einzelpakete werden vorbereitet …");
    try {
      const input = packageInput();
      for (let index = 0; index < input.listings.length; index += 1) {
        const listing = input.listings[index];
        const position = `${index + 1}/${input.listings.length}`;
        await uploadSingleListingPackage({
          project: input.project,
          listing,
          position,
          onStatus: setUploadStatus,
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
  ): Promise<void> => {
    const savedAt = new Date().toISOString();
    setState(checkpoint);
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
  ): Promise<void> => {
    let workingState = initialState;
    let run = workingState.totalSyncRun;
    if (!run || run.id !== runId) {
      setNotice("Der vorbereitete Totalabgleich wurde nicht gefunden.");
      return;
    }

    totalSyncStopRequested.current = false;
    setTotalSyncStopping(false);
    setTotalSyncBusy(true);
    run = { ...run, status: "running" };
    workingState = { ...workingState, totalSyncRun: run };

    const acceptedTitles = Array.from(new Set(
      workingState.projects.flatMap((project) => (
        project.listings.flatMap((listing) => [
          ...(listing.titleHistory ?? []),
          listing.texts.title,
        ]).map((title) => removePrivateAddressFromHeadline(title, project))
      )).filter(Boolean),
    ));
    let currentProjectId = "";

    const pauseAtCheckpoint = async (message: string): Promise<boolean> => {
      if (!totalSyncStopRequested.current) return false;
      run = { ...run!, status: "paused" };
      workingState = { ...workingState, totalSyncRun: run };
      await saveTotalSyncCheckpoint(workingState, true);
      setTotalSyncStatus("Sicher angehalten");
      setNotice(message);
      return true;
    };

    try {
      await saveTotalSyncCheckpoint(workingState);
      for (let taskIndex = 0; taskIndex < run.tasks.length; taskIndex += 1) {
        let task = run.tasks[taskIndex];
        if (task.uploadedExternalIds.length >= task.houseIds.length) continue;
        currentProjectId = task.projectId;
        let project = workingState.projects.find((item) => item.id === task.projectId);
        if (!project) throw new Error("Eine Adresse des Totalabgleichs wurde nicht mehr gefunden.");
        const houses = task.houseIds.map((houseId) => (
          workingState.houses.find((house) => house.id === houseId)
        ));
        if (houses.some((house) => !house)) {
          throw new Error(`Bei „${project.name}“ fehlt ein zufällig ausgewählter Haustyp.`);
        }
        const selectedTaskHouses = houses as HouseTemplate[];
        const selectedHouseNames = selectedTaskHouses.map((house) => house.name);
        let runListings = project.listings.filter(
          (listing) => listing.totalSyncRunId === run!.id,
        );

        if (!task.generated || runListings.length !== task.houseIds.length) {
          if (await pauseAtCheckpoint("Der Totalabgleich wurde vor der nächsten Adresse sicher angehalten.")) return;
          const previousListings = [...project.listings];
          const generatedListings: GeneratedListing[] = [];
          const headlineCycleId = `${run.id}-${project.id}`;
          const promotionAssignments = randomPromotionAssignments(
            task.houseIds,
            promotionPool(workingState).map((image) => image.id),
            projectPromotionCount(project),
          );

          for (let houseIndex = 0; houseIndex < selectedTaskHouses.length; houseIndex += 1) {
            if (await pauseAtCheckpoint("Der Totalabgleich wurde vor dem nächsten KI-Text sicher angehalten.")) return;
            const house = selectedTaskHouses[houseIndex];
            const previous = previousListings.find((listing) => listing.templateId === house.id);
            const overallPosition = taskIndex * TOTAL_SYNC_LISTINGS_PER_ADDRESS + houseIndex + 1;
            setTotalSyncStatus(
              `${overallPosition}/${run.tasks.length * TOTAL_SYNC_LISTINGS_PER_ADDRESS} · ${project.city} · KI-Texte für ${house.name}`,
            );

            let result: { texts: ListingTexts; writingProfile: string } | null = null;
            for (let diversityAttempt = 1; diversityAttempt <= 3; diversityAttempt += 1) {
              result = await requestListingTexts({
                project,
                house,
                index: houseIndex,
                listingCount: selectedTaskHouses.length,
                selectedHouseNames,
                previous,
                titlesToAvoid: acceptedTitles.slice(-60),
                headlineCycleId,
                maxAttempts: 4,
              });
              const similarTitle = acceptedTitles.find((title) => (
                headlinesAreTooSimilar(result!.texts.title, title)
              ));
              if (!similarTitle) break;
              if (diversityAttempt === 3) {
                throw new Error(`Die KI konnte für „${project.name}“ keine ausreichend neue Überschrift erzeugen.`);
              }
              acceptedTitles.push(similarTitle);
            }
            if (!result) throw new Error(`Der KI-Text für „${house.name}“ fehlt.`);
            acceptedTitles.push(result.texts.title);
            generatedListings.push({
              id: uid(),
              externalId: totalSyncExternalId(run.id, project.id, houseIndex + 1),
              templateId: house.id,
              templateName: house.name,
              promotionImageId: promotionAssignments[house.id],
              price: totalPrice(house, project),
              texts: result.texts,
              writingProfile: result.writingProfile || previous?.writingProfile,
              titleHistory: Array.from(new Set([
                ...(previous?.titleHistory ?? []),
                ...(previous?.texts.title ? [previous.texts.title] : []),
              ])).slice(-40),
              projectingSettings: fillMissingProjectingDefaults(previous?.projectingSettings),
              totalSyncRunId: run.id,
              version: (previous?.version ?? 0) + 1,
            });
          }

          runListings = generatedListings;
          project = {
            ...project,
            selectedHouseIds: [...task.houseIds],
            promotionAssignments,
            listings: generatedListings,
          };
          task = { ...task, generated: true, lastError: undefined };
          run = replaceTotalSyncTask(run, task.projectId, task);
          workingState = {
            ...workingState,
            projects: workingState.projects.map((item) => (
              item.id === project!.id ? project! : item
            )),
            totalSyncRun: run,
          };
          await saveTotalSyncCheckpoint(workingState);
        }

        for (let listingIndex = 0; listingIndex < runListings.length; listingIndex += 1) {
          const listing = runListings[listingIndex];
          if (task.uploadedExternalIds.includes(listing.externalId)) continue;
          if (await pauseAtCheckpoint("Der Totalabgleich wurde vor dem nächsten Einzelupload sicher angehalten.")) return;
          const overallPosition = taskIndex * TOTAL_SYNC_LISTINGS_PER_ADDRESS + listingIndex + 1;
          const position = `${overallPosition}/${run.tasks.length * TOTAL_SYNC_LISTINGS_PER_ADDRESS}`;
          setTotalSyncStatus(`${position} · ${project.city} · ${listing.templateName}`);
          await uploadSingleListingPackage({
            project,
            listing,
            position,
            onStatus: setTotalSyncStatus,
            maxAttempts: 3,
          });

          const uploadedAt = new Date().toISOString();
          task = {
            ...task,
            uploadedExternalIds: [...task.uploadedExternalIds, listing.externalId],
            lastError: undefined,
          };
          run = replaceTotalSyncTask(run, task.projectId, task);
          project = {
            ...project,
            listings: project.listings.map((item) => (
              item.externalId === listing.externalId ? { ...item, uploadedAt } : item
            )),
          };
          workingState = {
            ...workingState,
            projects: workingState.projects.map((item) => (
              item.id === project!.id ? project! : item
            )),
            totalSyncRun: run,
          };
          await saveTotalSyncCheckpoint(workingState);
        }

        project = { ...project, lastTotalSyncAt: new Date().toISOString() };
        run = replaceTotalSyncTask(run, task.projectId, { ...task, lastError: undefined });
        workingState = {
          ...workingState,
          projects: workingState.projects.map((item) => (
            item.id === project!.id ? project! : item
          )),
          totalSyncRun: run,
        };
        await saveTotalSyncCheckpoint(workingState, true);
      }

      run = {
        ...run,
        status: "completed",
        completedAt: new Date().toISOString(),
      };
      workingState = { ...workingState, totalSyncRun: run };
      await saveTotalSyncCheckpoint(workingState, true);
      const progress = totalSyncProgress(run);
      setTotalSyncStatus(`${progress.uploaded}/${progress.total} einzeln übertragen`);
      setNotice(
        `Totalabgleich abgeschlossen: ${progress.uploaded} neue Inserate wurden einzeln an Immoprofessional übertragen.${run.skippedProjectCount ? ` ${run.skippedProjectCount} unvollständige Adressentwürfe wurden nicht verwendet.` : ""}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Der Totalabgleich wurde unterbrochen.";
      if (currentProjectId) {
        run = replaceTotalSyncTask(run, currentProjectId, { lastError: message });
      }
      run = { ...run, status: "paused" };
      workingState = { ...workingState, totalSyncRun: run };
      await saveTotalSyncCheckpoint(workingState, true).catch(() => undefined);
      setTotalSyncStatus("Unterbrochen · kann fortgesetzt werden");
      setNotice(`Der Totalabgleich wurde sicher angehalten: ${message} Bereits übertragene Inserate werden beim Fortsetzen übersprungen.`);
    } finally {
      setTotalSyncBusy(false);
      setTotalSyncStopping(false);
      totalSyncStopRequested.current = false;
    }
  };

  const startOrResumeTotalSync = async () => {
    if (totalSyncBusy) return;
    if (!looksLikeOpenAiApiKey(openAiKey)) {
      setNotice("Bitte zuerst einen gültigen OpenAI API-Schlüssel speichern.");
      return;
    }
    if (!ftpUser || !ftpPassword) {
      setNotice("Bitte zuerst die Immoprofessional-Zugangsdaten speichern.");
      return;
    }
    if (!helperOnline) {
      setNotice(helperNeedsRestart
        ? "Der lokale Helfer muss vor dem Totalabgleich neu gestartet werden."
        : "Der lokale Helfer ist nicht erreichbar.");
      return;
    }
    if (!state.provider.providerNumber || !state.provider.company || !state.provider.email) {
      setNotice("Bitte Anbieternummer, Firma und E-Mail unter Export & Upload ergänzen.");
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
    const insufficientPromotionProject = totalSyncReadyProjects.find(
      (project) => projectPromotionCount(project) > promotionPool(state).length,
    );
    if (insufficientPromotionProject) {
      setNotice(
        `Für „${insufficientPromotionProject.name}“ werden ${projectPromotionCount(insufficientPromotionProject)} unterschiedliche Aktionsbilder benötigt. Bitte den Pool ergänzen oder die Anzahl bei dieser Adresse reduzieren.`,
      );
      return;
    }

    const totalListings = totalSyncReadyProjects.length * TOTAL_SYNC_LISTINGS_PER_ADDRESS;
    const scopeLabel = totalSyncScope === "all"
      ? "Fabian und Pascal"
      : totalSyncScope === "pascal" ? "Pascal" : "Fabian";
    const confirmed = window.confirm(
      `Totalabgleich für ${scopeLabel} starten?\n\n`
      + `${totalSyncReadyProjects.length} vollständige Adressen × ${TOTAL_SYNC_LISTINGS_PER_ADDRESS} zufällige Haustypen = ${totalListings} neue Inserate.\n\n`
      + "Für jedes Inserat werden neue KI-Texte und eine neue Überschrift erzeugt. Anschließend wird jedes Inserat als eigenes Paket nacheinander an Immoprofessional übertragen – niemals als Sammelpaket.\n\n"
      + `${totalSyncSkippedProjects ? `${totalSyncSkippedProjects} unvollständige Adressentwürfe werden übersprungen.\n\n` : ""}`
      + "Bitte erst bestätigen, wenn die bisherigen Anzeigen in Immoprofessional gelöscht wurden. Der Vorgang verwendet OpenAI-Guthaben und kann bei vielen Inseraten mehrere Stunden dauern.",
    );
    if (!confirmed) return;

    const run = createTotalSyncRun({
      projects: state.projects,
      eligibleHouseIds: totalSyncEligibleHouses.map((house) => house.id),
      scope: totalSyncScope,
      runId: uid(),
      createdAt: new Date().toISOString(),
    });
    const nextState = { ...state, totalSyncRun: run };
    await executeTotalSync(nextState, run.id);
  };

  const stopTotalSync = () => {
    totalSyncStopRequested.current = true;
    setTotalSyncStopping(true);
    setTotalSyncStatus("Wird nach dem aktuellen Schritt sicher angehalten …");
  };

  const discardTotalSyncRun = async () => {
    if (!state.totalSyncRun || totalSyncBusy) return;
    if (!window.confirm("Gespeicherten Totalabgleich verwerfen? Bereits zu Immoprofessional übertragene Inserate werden dadurch nicht gelöscht.")) return;
    const nextState = { ...state, totalSyncRun: undefined };
    await saveTotalSyncCheckpoint(nextState, true);
    setTotalSyncStatus("");
    setNotice("Der gespeicherte Totalabgleich wurde verworfen. Bereits übertragene Inserate bleiben in Immoprofessional erhalten.");
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
        const normalized = normalizeProjectOwners(imported);
        const next = normalized.projects.length
          ? normalized
          : { ...normalized, projects: [newProject("fabian")] };
        setState(next);
        selectActiveHouse(next.houses[0]?.id ?? "");
        setActiveProjectId(next.projects[0]?.id ?? "");
        setActiveOwner(projectOwner(next.projects[0]));
        setTotalSyncScope(
          totalSyncCanResume(next.totalSyncRun) && next.totalSyncRun
            ? next.totalSyncRun.scope
            : projectOwner(next.projects[0]),
        );
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
        <AppVersionBadge />
        <div className="loading-mark">F&amp;P</div>
        <h1>Inseratestudio ist bereits geöffnet</h1>
        <p>Bitte nur einen Inseratestudio-Tab verwenden. Schließe den anderen Tab; dieser Tab wird danach automatisch freigeschaltet.</p>
      </main>
    );
  }

  if (isPrimaryTab !== true || !ready || !activeProject || !activeHouse) {
    return (
      <main className="loading-screen">
        <AppVersionBadge />
        <div className="loading-mark">F&amp;P</div>
        <p>Fabian&amp;Pascal Inseratestudio wird vorbereitet …</p>
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
          <div><b>{activeHouses.length}</b><span>von {MAX_HOUSE_TEMPLATES} Haustypen</span></div>
          <div><b>{activeSelectedHouseIds.length}</b><span>ausgewählt</span></div>
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
                  <small className="section-note">Pascals Bildrollen und feste Bildüberschriften sind integriert. Die Position lässt sich weiterhin jederzeit ändern.</small>
                </div>
                <div className="button-row image-heading-actions">
                  <button className="secondary" onClick={toggleMediaLibrary}>
                    {mediaLibraryOpen ? "Medienbibliothek schließen" : "iCloud-Medienbibliothek"}
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
                <section className="media-library" aria-label="iCloud-Medienbibliothek">
                  <div className="media-library-intro">
                    <div>
                      <b>Haus-, Innenraum-, Grundriss- und Vertrauensbilder</b>
                      <span>
                        Pascals feste iCloud-Ordner sind verbunden. Eine passende SUN-/SOL-Hausansicht
                        kann die komplette Bildfolge automatisch zusammenstellen.
                      </span>
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
                    >
                      <option value="">Alle Bildarten</option>
                      <option value="house">Hausansichten</option>
                      <option value="interior">Innenräume</option>
                      <option value="floorplan">Grundrisse</option>
                      <option value="location">Standortanzeigen</option>
                      <option value="marketing">Allgemeine Anzeigen</option>
                    </select>
                    <button className="secondary" type="submit" disabled={mediaLibraryLoading}>
                      Filtern
                    </button>
                  </form>

                  {!mediaLibraryAvailable ? (
                    <div className="media-library-message">
                      Der konfigurierte iCloud-Ordner ist auf diesem Gerät nicht erreichbar. Auf Pascals
                      Mac wird der feste Pfad automatisch verwendet; alternativ lässt er sich über
                      <code>FPI_MEDIA_LIBRARY_ROOT</code> konfigurieren.
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
                            <span className="media-selection-mark">
                              {alreadyImported || selected ? "✓" : "+"}
                            </span>
                            <span className="media-kind">{MEDIA_KIND_LABELS[item.kind]}</span>
                            <strong>{item.caption}</strong>
                            <small>{item.group}</small>
                          </button>
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
                        disabled={mediaLibraryLoading || mediaLibraryPage <= 1}
                        onClick={() => void loadMediaLibrary(mediaLibraryPage - 1)}
                      >
                        Zurück
                      </button>
                      <span>Seite {mediaLibraryPage} von {mediaLibraryPages}</span>
                      <button
                        className="secondary"
                        type="button"
                        disabled={mediaLibraryLoading || mediaLibraryPage >= mediaLibraryPages}
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
                          || importingMedia
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
                          || importingMedia
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
                  {ownerProjects.map((project) => <option key={project.id} value={project.id}>{projectSelectionLabel(project)}</option>)}
                </select>
                <button className="secondary" onClick={addProject}>Neue Adresse</button>
                <button className="primary" disabled={savingAddress} onClick={saveAddressNow}>{savingAddress ? "Wird gespeichert …" : "Adresse speichern"}</button>
              </div>
            </div>
            <div className="form-grid three">
              <Field label="Projektname" value={activeProject.name} onChange={(value) => updateProject({ name: value })} />
              <Field label="Straße" value={activeProject.street} onChange={(value) => updateProject({ street: value })} />
              <Field label="Hausnummer" value={activeProject.houseNumber} onChange={(value) => updateProject({ houseNumber: value })} />
              <Field label="PLZ" value={activeProject.zip} onChange={(value) => updateProject({ zip: value })} />
              <Field label="Ort" value={activeProject.city} onChange={(value) => updateProject({ city: value })} />
              <Field label="Ortsteil" value={activeProject.district} onChange={(value) => updateProject({ district: value })} />
              <Field label="Grundstücksfläche" type="number" min={0} suffix="m²" value={activeProject.plotArea} onChange={(value) => updateProject({ plotArea: Number(value) })} />
              <Field label="Grundstückspreis" type="number" min={0} suffix="€" value={activeProject.plotPrice} onChange={(value) => updateProject({ plotPrice: Number(value) })} />
              <Field label="Berücksichtigte Nebenkosten" type="number" min={0} suffix="€" value={activeProject.additionalCosts} onChange={(value) => updateProject({ additionalCosts: Number(value) })} />
              <TextField label="Geprüfte Lagefakten" value={activeProject.locationFacts} placeholder="z. B. gewachsenes Wohngebiet, ruhige Seitenstraße …" onChange={(value) => updateProject({ locationFacts: value })} />
              <TextField label="Verkehr & Erreichbarkeit" value={activeProject.transportFacts} placeholder="Nur bestätigte Angaben eintragen." onChange={(value) => updateProject({ transportFacts: value })} />
              <TextField label="Familie & Versorgung" value={activeProject.familyFacts} placeholder="Schulen, Kitas, Einkauf – nur geprüfte Fakten." onChange={(value) => updateProject({ familyFacts: value })} />
              <TextField label="Natur & Freizeit" value={activeProject.natureFacts} placeholder="Wald, Seen, Wege oder Freizeitangebote." onChange={(value) => updateProject({ natureFacts: value })} />
              <TextField label="Zusätzliche Hinweise" value={activeProject.notes} onChange={(value) => updateProject({ notes: value })} />
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
                    <button key={house.id} className={selected ? "select-card selected" : "select-card"} onClick={() => toggleHouse(house.id)}>
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
                <span className="eyebrow">Aktionsbilder für diese Adresse</span>
                <h3>Bei wie vielen Häusern einsetzen?</h3>
                <p>Das Studio wählt zufällig die Häuser und möglichst unterschiedliche Aktionsbilder. Die Zuordnung bleibt gespeichert, bis du neu auslost.</p>
              </div>
              <div className="promotion-assignment-controls">
                <label>
                  <span>Anzahl der Inserate</span>
                  <select
                    value={projectPromotionCount(activeProject)}
                    onChange={(event) => setProjectPromotionCount(Number(event.target.value))}
                  >
                    {Array.from({ length: MAX_PROMOTED_LISTINGS + 1 }, (_, count) => (
                      <option
                        key={count}
                        value={count}
                        disabled={count > promotionPool(state).length}
                      >
                        {count === 0 ? "0 · keine Aktionsbilder" : `${count} von 4 Häusern`}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="secondary"
                  disabled={!projectPromotionCount(activeProject) || !activeSelectedHouseIds.length}
                  onClick={rerollProjectPromotions}
                >
                  Neu auslosen
                </button>
              </div>
              {projectPromotionCount(activeProject) > promotionPool(state).length ? (
                <div className="promotion-assignment-warning">
                  Bitte noch {projectPromotionCount(activeProject) - promotionPool(state).length} Aktionsbild{projectPromotionCount(activeProject) - promotionPool(state).length === 1 ? "" : "er"} im Bereich Haustypen ergänzen.
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
                <button className="primary" disabled={generatingAi || totalSyncBusy} onClick={generateAiListings}>{generatingAi ? "KI schreibt und prüft …" : "KI-Überschrift & Texte erzeugen"}</button>
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
                  <button className="primary" disabled={generatingAi || totalSyncBusy} onClick={generateAiListings}>{generatingAi ? "KI schreibt und prüft …" : "KI-Überschrift & Texte neu schreiben"}</button>
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
                      <footer><span>{displayImages.length} Bilder automatisch zugeordnet{listing.promotionImageId ? " · Aktionsbild an Position 1" : ""}</span><span>Weitergabe an Portale: <b>deaktiviert</b></span></footer>
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
                <select value={aiModel} onChange={(event) => setAiModel(event.target.value as AiModel)}>
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
            <p className="security-note">FTP-Benutzername und Passwort bleiben nach einem Upload erhalten. Sie liegen getrennt von Haustypen und Projekten im plattformgeschützten Zugangstresor und werden nicht in eine Inseratstudio-Sicherung aufgenommen.</p>

            <div className="credential-vault-card">
              <div><span className="eyebrow">Lokaler Zugangstresor</span><b>{credentialSaveLabel}</b><small>Windows-DPAPI oder Apple-Schlüsselbund – nur für das angemeldete Benutzerkonto.</small></div>
              <div className="button-row">
                <button className="primary" disabled={savingCredentials || totalSyncBusy} onClick={saveCredentialsNow}>{savingCredentials ? "Schlüssel wird geprüft …" : "Zugangsdaten prüfen & speichern"}</button>
                <button className="secondary" disabled={savingCredentials || totalSyncBusy} onClick={clearSavedCredentials}>Zugangsdaten löschen</button>
              </div>
            </div>

            <div className="total-sync-card">
              <div className="section-heading compact">
                <div>
                  <span className="eyebrow">Totalabgleich · einzeln und fortsetzbar</span>
                  <h2>Alle Adressen neu bestücken</h2>
                  <p>Vier zufällige Haustypen pro vollständiger Adresse, jedes Mal neue KI-Texte und neue Überschriften. Jedes Inserat wird einzeln und streng nacheinander an Immoprofessional übertragen.</p>
                </div>
                <span className={totalSyncBusy ? "status online" : resumableTotalSync ? "status offline" : "status"}>
                  {totalSyncBusy ? "Läuft" : resumableTotalSync ? "Fortsetzung bereit" : state.totalSyncRun?.status === "completed" ? "Letzter Lauf fertig" : "Bereit"}
                </span>
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
                  <div><span>Aktueller Lauf</span><b>{totalSyncRunProgress.uploaded}/{totalSyncRunProgress.total || 0} übertragen</b></div>
                </div>
              </div>

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
                    : uploading || generatingAi || savingCredentials}
                  onClick={totalSyncBusy ? stopTotalSync : startOrResumeTotalSync}
                >
                  {totalSyncBusy
                    ? "Nach aktuellem Schritt anhalten"
                    : resumableTotalSync
                      ? "Totalabgleich fortsetzen"
                      : `Totalabgleich starten · ${totalSyncReadyProjects.length * TOTAL_SYNC_LISTINGS_PER_ADDRESS} Inserate`}
                </button>
                {state.totalSyncRun && !totalSyncBusy ? (
                  <button className="secondary" onClick={discardTotalSyncRun}>Gespeicherten Lauf verwerfen</button>
                ) : null}
              </div>
              <p className="total-sync-warning">
                Vor dem Start die bisherigen Anzeigen in Immoprofessional löschen. Der Lauf erzeugt kostenpflichtige KI-Texte und kann bei sehr vielen Inseraten mehrere Stunden dauern. Die Portalveröffentlichung bleibt ausgeschaltet.
                {totalSyncSkippedProjects ? ` ${totalSyncSkippedProjects} unvollständige Adressentwürfe werden übersprungen.` : ""}
              </p>
            </div>
          </div>

          <aside className="upload-card">
            <span className="eyebrow">Kontrollierter Entwurfsimport</span>
            <h2>{activeProject.listings.length} Inserate bereit</h2>
            <p>Jedes Inserat wird als eigenes OpenImmo-Paket mit den automatisch zugeordneten Bildern übertragen. Adressfreigabe und Weitergabe an Immobilienportale sind deaktiviert.</p>
            <div className="upload-facts">
              <div><span>Projekt</span><b>{activeProject.name}</b></div>
              <div><span>Ziel</span><b>{ftpHost}</b></div>
              <div><span>Format</span><b>OpenImmo 1.2.7 · ZIP</b></div>
              <div><span>Automatik</span><b>Wohngebiet · Gäste-WC · Nutzfläche</b></div>
              <div><span>Veröffentlichung</span><b>manuell in Immoprofessional</b></div>
            </div>
            <button className="primary full" disabled={uploading || totalSyncBusy || !activeProject.listings.length} onClick={uploadPackage}>{uploading ? uploadStatus || "Wird übertragen …" : "Entwürfe zu Immoprofessional laden"}</button>
            <button className="secondary full" disabled={totalSyncBusy || !activeProject.listings.length} onClick={downloadPackage}>Importpaket nur herunterladen</button>
            <p className="first-test">Der erste Upload sollte mit einem einzelnen, nicht veröffentlichten Testobjekt geprüft werden. Immoprofessional kann eigene Importregeln anwenden.</p>
          </aside>

          <div className="content-card backup-card">
            <div><span className="eyebrow">Strikt getrennte Speicherung</span><h3>Fabian&amp;Pascal-Sicherung</h3><p>Haustypen, Bilder und Adressprojekte werden doppelt lokal gespeichert: im Speicher <code>{STORAGE_ID}</code> und als automatische Gerätesicherung. Zugangsdaten sind separat verschlüsselt. deviq und Plotverium werden weder gelesen noch beschrieben.</p></div>
            <div className="button-row"><button className="secondary" onClick={exportCatalog}>Sicherung herunterladen</button><label className="secondary file-label">Sicherung einlesen<input type="file" accept="application/json" onChange={importCatalog} /></label></div>
          </div>
        </section>
      ) : null}
    </main>
  );
}
