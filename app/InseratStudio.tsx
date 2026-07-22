"use client";
/* eslint-disable @next/next/no-img-element */

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { buildImportPackage } from "./lib/openimmo";
import { totalPrice } from "./lib/text-generator";
import { loadStudioSnapshot, saveStudioState, STORAGE_ID } from "./lib/storage";
import type {
  GeneratedListing,
  HouseImage,
  HouseTemplate,
  ListingTexts,
  ProjectInput,
  ProviderSettings,
  StudioState,
} from "./types";

type Tab = "houses" | "project" | "preview" | "settings";
type AiModel = "gpt-5.6-luna" | "gpt-5.6-terra" | "gpt-5.6-sol";

const MIN_HOUSE_IMAGES = 4;
const MAX_HOUSE_IMAGES = 14;

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

const newProject = (): ProjectInput => ({
  id: uid(),
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
  projects: [newProject()],
  provider: defaultProvider,
});

function euro(value: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value || 0);
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
    houses: state.houses.map((house) => ({
      ...house,
      images: house.images.map((image) => ({ ...image, dataUrl: "" })),
    })),
  };
}

async function saveWindowsCatalogSnapshot(state: StudioState, savedAt: string): Promise<void> {
  const sessionId = uid();
  const allImages = state.houses.flatMap((house) => house.images);
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
    throw new Error(startData.message || "Windows-Sicherung konnte nicht vorbereitet werden.");
  }

  await runWithConcurrency(startData.missingImageIds, async (imageId) => {
    const image = imageById.get(imageId);
    if (!image) throw new Error("Ein Bild der Windows-Sicherung wurde nicht gefunden.");
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
    throw new Error(commitData.message || "Windows-Sicherung konnte nicht abgeschlossen werden.");
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
      const imageIds = manifestData.state.houses.flatMap((house) => house.images.map((image) => image.id));
      const dataUrlById = new Map<string, string>();
      await runWithConcurrency(imageIds, async (imageId) => {
        const imageResponse = await fetch(`http://127.0.0.1:43182/catalog-v2/image?imageId=${encodeURIComponent(imageId)}`);
        if (!imageResponse.ok) throw new Error("Ein Bild der Windows-Sicherung konnte nicht geladen werden.");
        dataUrlById.set(imageId, await blobDataUrl(await imageResponse.blob()));
      });
      const state: StudioState = {
        ...manifestData.state,
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
  const [notice, setNotice] = useState<string | null>(null);
  const [ftpHost, setFtpHost] = useState("fabianraebel.livinghaus.info");
  const [ftpUser, setFtpUser] = useState("");
  const [ftpPassword, setFtpPassword] = useState("");
  const [ftpPath, setFtpPath] = useState("/");
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [helperOnline, setHelperOnline] = useState(false);
  const [openAiKey, setOpenAiKey] = useState("");
  const [aiModel, setAiModel] = useState<AiModel>("gpt-5.6-luna");
  const [generatingAi, setGeneratingAi] = useState(false);
  const [credentialsReady, setCredentialsReady] = useState(false);
  const [credentialSaveLabel, setCredentialSaveLabel] = useState("Verschlüsselter Zugangstresor wird vorbereitet …");
  const [savingHouses, setSavingHouses] = useState(false);
  const [savingCredentials, setSavingCredentials] = useState(false);
  const [captioningImageIds, setCaptioningImageIds] = useState<string[]>([]);
  const [replacingAllImageCaptions, setReplacingAllImageCaptions] = useState(false);
  const [openAiKeyVerified, setOpenAiKeyVerified] = useState(false);
  const [isPrimaryTab, setIsPrimaryTab] = useState<boolean | null>(null);

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
        const next = selected?.state ?? initialState();
        setState(next);
        setActiveHouseId(next.houses[0]?.id ?? "");
        setActiveProjectId(next.projects[0]?.id ?? "");
        setSaveLabel(selected?.source === "windows" ? "Aus lokaler Windows-Sicherung geladen" : "Doppelt lokal gespeichert");
      })
      .catch(() => setSaveLabel("Lokaler Speicher nicht verfügbar"))
      .finally(() => setReady(true));

    const checkHelper = () => {
      fetch("http://127.0.0.1:43182/health")
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
        .then(() => setSaveLabel(helperOnline ? "Browser + Windows-Sicherung aktuell" : "Lokal im Browser gespeichert"))
        .catch(() => setSaveLabel("Speichern fehlgeschlagen"));
    }, 450);
    return () => window.clearTimeout(timer);
  }, [helperOnline, isPrimaryTab, ready, state]);

  const activeHouse =
    state.houses.find((house) => house.id === activeHouseId) ?? state.houses[0];
  const activeProject =
    state.projects.find((project) => project.id === activeProjectId) ??
    state.projects[0];

  const selectedHouses = useMemo(
    () =>
      state.houses.filter((house) =>
        activeProject?.selectedHouseIds.includes(house.id),
      ),
    [activeProject, state.houses],
  );

  const saveHousesNow = async () => {
    const savedAt = new Date().toISOString();
    const imageCount = state.houses.reduce((sum, house) => sum + house.images.length, 0);
    setSavingHouses(true);
    try {
      await saveStudioState(state, savedAt);
      if (helperOnline) {
        await queueWindowsCatalogSnapshot(state, savedAt);
        setSaveLabel("Browser + Windows-Sicherung aktuell");
        setNotice(`${state.houses.length} Haustypen mit ${imageCount} Bildern wurden sicher gespeichert.`);
      } else {
        setSaveLabel("Lokal im Browser gespeichert");
        setNotice(`${state.houses.length} Haustypen mit ${imageCount} Bildern wurden im Browser gespeichert. Die Windows-Sicherung wird ergänzt, sobald der lokale Helfer erreichbar ist.`);
      }
    } catch (error) {
      setSaveLabel("Speichern fehlgeschlagen");
      setNotice(error instanceof Error ? error.message : "Haustypen und Bilder konnten nicht gespeichert werden.");
    } finally {
      setSavingHouses(false);
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
    if (state.houses.length >= 12) {
      setNotice("Es sind bereits zwölf Haustypen angelegt.");
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
    if (!images.length) return "local";
    const imageIds = images.map((image) => image.id);
    replaceHouseImageCaptions(
      house.id,
      new Map(images.map((image, index) => [
        image.id,
        localImageCaption(image.name, image.isFloorplan, index),
      ])),
    );

    if (!helperOnline || !looksLikeOpenAiApiKey(openAiKey)) {
      if (announce) setNotice(looksLikeOpenAiApiKey(openAiKey)
        ? `${images.length} kurze Bildtexte wurden automatisch lokal erstellt und können bearbeitet werden.`
        : `${images.length} lokale Bildtexte wurden erstellt. Für die KI-Bildanalyse bitte einen gültigen OpenAI-Schlüssel einfügen.`);
      return "local";
    }

    setCaptioningImageIds((current) => [...new Set([...current, ...imageIds])]);
    try {
      const preparedImages = await Promise.all(images.map(async (image) => ({
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
      if (announce) setNotice(`${images.length} kurze, passende Bildtexte wurden automatisch erstellt.`);
      return "ai";
    } catch (error) {
      if (announce) setNotice(`${images.length} lokale Bildtexte wurden erstellt. ${error instanceof Error ? error.message : "Die KI-Verfeinerung war nicht verfügbar."}`);
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
    const housesWithImages = state.houses.filter((house) => house.images.length > 0);
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

  const addImages = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!activeHouse) return;
    const remaining = MAX_HOUSE_IMAGES - activeHouse.images.length;
    const files = Array.from(event.target.files ?? []).slice(0, remaining);
    const images: HouseImage[] = await Promise.all(
      files.map(
        (file, index) =>
          new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const isFloorplan = /grundriss|floor/i.test(file.name);
              resolve({
                id: uid(),
                name: file.name,
                mimeType: file.type || "image/jpeg",
                dataUrl: String(reader.result),
                caption: localImageCaption(file.name, isFloorplan, index),
                isFloorplan,
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

  const addProject = () => {
    const project = newProject();
    setState((current) => ({
      ...current,
      projects: [project, ...current.projects],
    }));
    setActiveProjectId(project.id);
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
    if (!looksLikeOpenAiApiKey(openAiKey)) {
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
          const response = await fetch("http://127.0.0.1:43182/generate-texts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              apiKey: openAiKey.trim(),
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
                energyClass: house.energyClass,
                heatingType: house.heatingType,
                energySource: house.energySource,
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
          return { house, index, previous, texts: data.texts };
        }),
      );

      const listings: GeneratedListing[] = generated.map(({ house, index, previous, texts }) => ({
        id: previous?.id ?? uid(),
        externalId:
          previous?.externalId ??
          `FPI-${projectSnapshot.id.slice(0, 8)}-${house.id.slice(0, 6)}-${index + 1}`.toUpperCase(),
        templateId: house.id,
        templateName: house.name,
        price: totalPrice(house, projectSnapshot),
        texts,
        version: (previous?.version ?? 0) + 1,
      }));

      setState((current) => ({
        ...current,
        projects: current.projects.map((project) =>
          project.id === projectSnapshot.id ? { ...project, listings } : project,
        ),
      }));
      setActiveProjectId(projectSnapshot.id);
      setTab("preview");
      setNotice(`${listings.length} hochwertige KI-Inserat${listings.length === 1 ? "" : "e"} wurden vollständig neu geschrieben und lokal qualitätsgeprüft.`);
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

  const packageInput = () => {
    if (!activeProject || activeProject.listings.length === 0) {
      throw new Error("Es wurden noch keine Inserate erzeugt.");
    }
    const invalidImageCounts = activeProject.listings
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
      project: activeProject,
      listings: activeProject.listings,
      houses: state.houses,
      provider: state.provider,
    };
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
        setUploadStatus(`${position} · ${listing.templateName} wird gepackt …`);
        const result = await buildImportPackage({ ...input, listings: [listing] });
        setUploadStatus(`${position} · ZIP wird lokal übergeben …`);
        await new Promise<{ ok?: boolean; message?: string }>((resolve, reject) => {
          const request = new XMLHttpRequest();
          request.open("POST", "http://127.0.0.1:43182/upload-binary");
          request.setRequestHeader("Content-Type", "application/zip");
          request.setRequestHeader("X-FPI-Filename", encodeURIComponent(result.filename));
          request.setRequestHeader("X-FPI-Ftp-Host", encodeURIComponent(ftpHost));
          request.setRequestHeader("X-FPI-Ftp-User", encodeURIComponent(ftpUser));
          request.setRequestHeader("X-FPI-Ftp-Password", encodeURIComponent(ftpPassword));
          request.setRequestHeader("X-FPI-Ftp-Path", encodeURIComponent(ftpPath));
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
      setNotice("OpenAI- und Immoprofessional-Zugangsdaten wurden aus dem verschlüsselten Windows-Tresor entfernt.");
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
        setState(imported);
        setActiveHouseId(imported.houses[0]?.id ?? "");
        setActiveProjectId(imported.projects[0]?.id ?? "");
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
      </main>
    );
  }

  if (isPrimaryTab !== true || !ready || !activeProject || !activeHouse) {
    return (
      <main className="loading-screen">
        <div className="loading-mark">F&amp;P</div>
        <p>Fabian&amp;Pascal Inseratestudio wird vorbereitet …</p>
      </main>
    );
  }

  return (
    <main className="studio-shell">
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
          <div><b>{state.houses.length}</b><span>von 12 Haustypen</span></div>
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
        <section className="workspace two-column">
          <aside className="rail-card">
            <div className="section-heading compact">
              <div><span className="eyebrow">Hausbibliothek</span><h2>Deine 12 Haustypen</h2></div>
              <button className="icon-button" onClick={addHouse} aria-label="Haustyp hinzufügen">+</button>
            </div>
            <div className="house-list">
              {state.houses.map((house, index) => (
                <button
                  key={house.id}
                  className={house.id === activeHouse.id ? "house-row active" : "house-row"}
                  onClick={() => setActiveHouseId(house.id)}
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

            <div className="image-section">
              <div className="section-heading compact">
                <div>
                  <span className="eyebrow">Automatische Bildauswahl</span>
                  <h3>{MIN_HOUSE_IMAGES} bis {MAX_HOUSE_IMAGES} Bilder je Haustyp</h3>
                  <small className="section-note">Die Position lässt sich jederzeit ändern. Bild 1 wird als Titelbild exportiert.</small>
                </div>
                <div className="button-row image-heading-actions">
                  <button
                    className="secondary"
                    disabled={replacingAllImageCaptions || captioningImageIds.length > 0 || !state.houses.some((house) => house.images.length > 0)}
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
              {activeHouse.images.length ? (
                <div className="image-grid">
                  {activeHouse.images.map((image, index) => (
                    <article className="image-card" key={image.id}>
                      <img src={image.dataUrl} alt={image.caption} />
                      <div className="image-order">{String(index + 1).padStart(2, "0")}</div>
                      <label className="image-caption">
                        <span>{captioningImageIds.includes(image.id) ? "Passender Bildtext wird verfeinert …" : "Automatischer Bildtext"}</span>
                        <input value={image.caption} onChange={(event) => updateImage(image.id, { caption: event.target.value })} aria-label={`Bildbeschreibung ${index + 1}`} />
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
                      <label className="check-line"><input type="checkbox" checked={image.isFloorplan} onChange={(event) => updateImage(image.id, { isFloorplan: event.target.checked })} />Grundriss</label>
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
      ) : null}

      {tab === "project" ? (
        <section className="workspace">
          <div className="content-card">
            <div className="section-heading">
              <div><span className="eyebrow">Adressprojekt</span><h2>Grundstück einmal erfassen</h2></div>
              <div className="button-row">
                <select value={activeProject.id} onChange={(event) => setActiveProjectId(event.target.value)} aria-label="Adressprojekt wählen">
                  {state.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
                <button className="secondary" onClick={addProject}>Neue Adresse</button>
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
                <b>{activeProject.selectedHouseIds.length}/4</b>
              </div>
              <div className="selection-grid">
                {state.houses.map((house) => {
                  const selected = activeProject.selectedHouseIds.includes(house.id);
                  return (
                    <button key={house.id} className={selected ? "select-card selected" : "select-card"} onClick={() => toggleHouse(house.id)}>
                      <span className="selection-check">{selected ? "✓" : "+"}</span>
                      {house.images[0] ? <img src={house.images[0].dataUrl} alt="" /> : <div className="image-placeholder">F&amp;P</div>}
                      <div><strong>{house.name}</strong><small>{house.livingArea} m² · {house.rooms} Zimmer</small><b>{euro(totalPrice(house, activeProject))}</b></div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="action-bar">
              <div><b>Bereit für neue KI-Texte?</b><span>Die KI erzeugt die Überschrift und vier eigenständige Textblöcke. Als Ortsbezug sind nur Ort und Ortsteil erlaubt.</span></div>
              <div className="button-row action-buttons">
                <button className="primary" disabled={generatingAi} onClick={generateAiListings}>{generatingAi ? "KI schreibt und prüft …" : "KI-Überschrift & Texte erzeugen"}</button>
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
                  <button className="primary" disabled={generatingAi} onClick={generateAiListings}>{generatingAi ? "KI schreibt und prüft …" : "KI-Überschrift & Texte neu schreiben"}</button>
              </div>
            </div>
            {activeProject.listings.length ? (
              <div className="listing-stack">
                {activeProject.listings.map((listing) => {
                  const house = state.houses.find((item) => item.id === listing.templateId);
                  return (
                    <article className="listing-card" key={listing.id}>
                      <header>
                        <div className="listing-thumb">
                          {house?.images[0] ? <img src={house.images[0].dataUrl} alt="" /> : <span>F&amp;P</span>}
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
                      <footer><span>{house?.images.length ?? 0} Bilder automatisch zugeordnet</span><span>Weitergabe an Portale: <b>deaktiviert</b></span></footer>
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
            <p className="security-note">Der Schlüssel wird vor dem Speichern direkt bei OpenAI geprüft und anschließend für dein Windows-Benutzerkonto verschlüsselt. Die KI erzeugt Überschrift und vier Textblöcke gemeinsam. An die Text-KI werden weder Straße, Hausnummer noch PLZ übergeben; in den Inserattexten sind nur Ort und Ortsteil als konkrete Ortsangaben erlaubt.</p>

            <div className="divider" />
            <div className="section-heading"><div><span className="eyebrow">Verschlüsselt auf diesem Gerät</span><h2>Immoprofessional-Zugang</h2></div><span className={helperOnline ? "status online" : "status offline"}>{helperOnline ? "Upload bereit" : "Upload-Helfer offline"}</span></div>
            <div className="form-grid two">
              <Field label="FTP-Host" value={ftpHost} onChange={setFtpHost} />
              <Field label="Zielordner" value={ftpPath} onChange={setFtpPath} />
              <Field label="FTP-Benutzername" value={ftpUser} onChange={setFtpUser} />
              <Field label="FTP-Passwort" type="password" value={ftpPassword} onChange={setFtpPassword} />
            </div>
            <p className="security-note">FTP-Benutzername und Passwort bleiben nach einem Upload erhalten. Sie liegen getrennt von Haustypen und Projekten im Windows-verschlüsselten Zugangstresor und werden nicht in eine Inseratstudio-Sicherung aufgenommen.</p>

            <div className="credential-vault-card">
              <div><span className="eyebrow">Lokaler Zugangstresor</span><b>{credentialSaveLabel}</b><small>Geschützt für das aktuell angemeldete Windows-Benutzerkonto.</small></div>
              <div className="button-row">
                <button className="primary" disabled={savingCredentials} onClick={saveCredentialsNow}>{savingCredentials ? "Schlüssel wird geprüft …" : "Zugangsdaten prüfen & speichern"}</button>
                <button className="secondary" disabled={savingCredentials} onClick={clearSavedCredentials}>Zugangsdaten löschen</button>
              </div>
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
            <button className="primary full" disabled={uploading || !activeProject.listings.length} onClick={uploadPackage}>{uploading ? uploadStatus || "Wird übertragen …" : "Entwürfe zu Immoprofessional laden"}</button>
            <button className="secondary full" disabled={!activeProject.listings.length} onClick={downloadPackage}>Importpaket nur herunterladen</button>
            <p className="first-test">Der erste Upload sollte mit einem einzelnen, nicht veröffentlichten Testobjekt geprüft werden. Immoprofessional kann eigene Importregeln anwenden.</p>
          </aside>

          <div className="content-card backup-card">
            <div><span className="eyebrow">Strikt getrennte Speicherung</span><h3>Fabian&amp;Pascal-Sicherung</h3><p>Haustypen, Bilder und Adressprojekte werden doppelt lokal gespeichert: im Speicher <code>{STORAGE_ID}</code> und als automatische Windows-Sicherung. Zugangsdaten sind separat verschlüsselt. deviq und Plotverium werden weder gelesen noch beschrieben.</p></div>
            <div className="button-row"><button className="secondary" onClick={exportCatalog}>Sicherung herunterladen</button><label className="secondary file-label">Sicherung einlesen<input type="file" accept="application/json" onChange={importCatalog} /></label></div>
          </div>
        </section>
      ) : null}
    </main>
  );
}
