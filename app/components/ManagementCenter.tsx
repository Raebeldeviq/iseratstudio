"use client";

import Image from "next/image";
import {
  useMemo,
  useState,
} from "react";
import type {
  ChangeEvent,
  Dispatch,
  SetStateAction,
} from "react";
import JSZip from "jszip";
import type {
  AuditLogEntry,
  CompanySettings,
  GeneratedListing,
  ImportReportRecord,
  ListingAppointment,
  ListingDetails,
  ListingLifecycleStatus,
  ListingManagement,
  ListingMediaItem,
  ListingMediaKind,
  ListingPortalStatus,
  ManagementRole,
  ManagementUser,
  PortalConfiguration,
  ProjectInput,
  StudioState,
} from "../types";
import {
  appendAuditLog,
  createListingMediaItem,
  createManagementUser,
  currentManagementUser,
  deriveListingLifecycle,
  findListing,
  managementPermission,
  mapListing,
  resolveListingMediaDataUrl,
} from "../lib/management";
import {
  applyImportReport,
  parseImportReport,
} from "../lib/import-reports";
import {
  buildExposePdf,
  type ExposePdfOptions,
} from "../lib/expose-pdf";
import { allocateProviderExternalIds } from "../lib/external-ids";

type ManagementSection = "objects" | "portals" | "reports" | "company" | "users" | "audit";
type EditorTab =
  | "object"
  | "address"
  | "base"
  | "features"
  | "energy"
  | "texts"
  | "appointments"
  | "export";
type ArchiveFilter = "active" | "archived" | "all";
type ReleaseFilter = "all" | "released" | "not-released";
type SortKey =
  | "updated-desc"
  | "updated-asc"
  | "created-desc"
  | "external-id"
  | "city"
  | "price"
  | "living-area"
  | "rooms";

type ListingRow = {
  project: ProjectInput;
  listing: GeneratedListing;
  management: ListingManagement;
};

type ManagementCenterProps = {
  state: StudioState;
  setState: Dispatch<SetStateAction<StudioState>>;
  uploadAvailable: boolean;
  busy: boolean;
  onTransferListing: (listingId: string) => Promise<void>;
  onDeleteListings: (listingIds: string[]) => Promise<void>;
  notify: (message: string) => void;
};

const LIFECYCLE_LABELS: Record<ListingLifecycleStatus, string> = {
  draft: "Entwurf",
  ready: "Freigegeben",
  transferred: "Übertragen",
  online: "Online",
  error: "Fehler",
  archived: "Archiviert",
};

const PORTAL_STATUS_LABELS: Record<ListingPortalStatus, string> = {
  "not-transferred": "Nicht übertragen",
  queued: "Vorgemerkt",
  transferred: "Übertragen",
  online: "Online",
  error: "Fehler",
  "delete-requested": "Löschung gesendet",
  deleted: "Gelöscht",
};

const ROLE_LABELS: Record<ManagementRole, string> = {
  admin: "Administration",
  editor: "Bearbeitung",
  viewer: "Nur lesen",
};

const MEDIA_KIND_LABELS: Record<ListingMediaKind, string> = {
  image: "Bild",
  floorplan: "Grundriss",
  document: "Dokument",
  video: "Video",
  link: "Link",
  tour: "3D-Tour",
};

const EDITOR_TABS: Array<[EditorTab, string]> = [
  ["object", "Objektdaten"],
  ["address", "Adresse"],
  ["base", "Basis"],
  ["features", "Ausstattung"],
  ["energy", "Energie"],
  ["texts", "Beschreibungen"],
  ["appointments", "Termine"],
  ["export", "Export"],
];

function uid(prefix: string): string {
  const random = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}

function formatDate(value: string | undefined, withTime = false): string {
  if (!value) return "–";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" as const } : {}),
  }).format(date);
}

function euro(value: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

function fileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function nextLifecycle(listing: GeneratedListing): ListingLifecycleStatus {
  if (!listing.management) return listing.uploadedAt ? "transferred" : "draft";
  return deriveListingLifecycle(listing.management, listing.uploadedAt);
}

function withUpdatedManagement(
  listing: GeneratedListing,
  patch: Partial<ListingManagement>,
  at = new Date().toISOString(),
): GeneratedListing {
  if (!listing.management) return listing;
  const management = {
    ...listing.management,
    ...patch,
    updatedAt: at,
  };
  return {
    ...listing,
    management: {
      ...management,
      lifecycle: deriveListingLifecycle(management, listing.uploadedAt),
    },
  };
}

function Field(props: {
  label: string;
  value: string | number;
  type?: "text" | "number" | "email" | "date" | "datetime-local" | "time" | "url";
  disabled?: boolean;
  min?: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="management-field">
      <span>{props.label}</span>
      <input
        type={props.type ?? "text"}
        value={props.value}
        min={props.min}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  );
}

function TextArea(props: {
  label: string;
  value: string;
  rows?: number;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="management-field management-field-wide">
      <span>{props.label}</span>
      <textarea
        rows={props.rows ?? 5}
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  );
}

function SelectField(props: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="management-field">
      <span>{props.label}</span>
      <select
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.value)}
      >
        {props.options.map(([value, label]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
    </label>
  );
}

function Toggle(props: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="management-toggle">
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      <span>{props.label}</span>
    </label>
  );
}

function readNumber(value: string): number {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

async function rotatedImageDataUrl(dataUrl: string): Promise<string> {
  const image = document.createElement("img");
  image.decoding = "async";
  image.src = dataUrl;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalHeight;
  canvas.height = image.naturalWidth;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Bildbearbeitung ist in diesem Browser nicht verfügbar.");
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(Math.PI / 2);
  context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
  return canvas.toDataURL("image/jpeg", 0.92);
}

function listingRows(state: StudioState): ListingRow[] {
  return state.projects.flatMap((project) => (
    project.listings.flatMap((listing) => (
      listing.management
        ? [{ project, listing, management: listing.management }]
        : []
    ))
  ));
}

export default function ManagementCenter({
  state,
  setState,
  uploadAvailable,
  busy,
  onTransferListing,
  onDeleteListings,
  notify,
}: ManagementCenterProps) {
  const management = state.management;
  const [section, setSection] = useState<ManagementSection>("objects");
  const [activeListingId, setActiveListingId] = useState("");
  const [editorTab, setEditorTab] = useState<EditorTab>("object");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [archiveFilter, setArchiveFilter] = useState<ArchiveFilter>("active");
  const [releaseFilter, setReleaseFilter] = useState<ReleaseFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("updated-desc");
  const [mediaLinkKind, setMediaLinkKind] = useState<ListingMediaKind>("video");
  const [mediaLinkUrl, setMediaLinkUrl] = useState("");
  const [mediaLinkCaption, setMediaLinkCaption] = useState("");
  const [appointmentDraft, setAppointmentDraft] = useState({
    title: "Besichtigung",
    startsAt: "",
    endsAt: "",
    location: "",
    contactName: "",
    contactEmail: "",
    notes: "",
  });
  const [reportBusy, setReportBusy] = useState(false);
  const [exposeBusy, setExposeBusy] = useState(false);
  const [exposeOptions, setExposeOptions] = useState<ExposePdfOptions>({
    includeContact: true,
    includeAddress: false,
    includeImages: true,
    includeLogo: true,
    includePageNumbers: true,
    includeColors: true,
    firstPageOnly: false,
  });
  const [newUser, setNewUser] = useState({
    name: "",
    email: "",
    role: "editor" as ManagementRole,
  });
  const [auditQuery, setAuditQuery] = useState("");

  const rows = useMemo(() => listingRows(state), [state]);
  const currentUser = currentManagementUser(state);
  const canEdit = currentUser
    ? managementPermission(currentUser.role, "edit-listings")
    : false;
  const canTransfer = currentUser
    ? managementPermission(currentUser.role, "transfer")
    : false;
  const canDeleteRemote = currentUser
    ? managementPermission(currentUser.role, "delete-remote")
    : false;
  const canManageUsers = currentUser
    ? managementPermission(currentUser.role, "manage-users")
    : false;
  const canManageCompany = currentUser
    ? managementPermission(currentUser.role, "manage-company")
    : false;

  const visibleRows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("de-DE");
    const filtered = rows.filter(({ project, listing, management: listingManagement }) => {
      const archived = Boolean(listingManagement.archivedAt);
      if (archiveFilter === "active" && archived) return false;
      if (archiveFilter === "archived" && !archived) return false;
      if (releaseFilter === "released" && !listingManagement.released) return false;
      if (releaseFilter === "not-released" && listingManagement.released) return false;
      if (!normalizedQuery) return true;
      return [
        listing.externalId,
        listing.texts.title,
        listing.templateName,
        project.name,
        listingManagement.details.city,
        listingManagement.details.zip,
        listingManagement.details.orderNumber,
      ].some((value) => String(value).toLocaleLowerCase("de-DE").includes(normalizedQuery));
    });
    return filtered.sort((left, right) => {
      if (sortKey === "updated-asc") {
        return left.management.updatedAt.localeCompare(right.management.updatedAt);
      }
      if (sortKey === "created-desc") {
        return right.management.createdAt.localeCompare(left.management.createdAt);
      }
      if (sortKey === "external-id") {
        return left.listing.externalId.localeCompare(right.listing.externalId, "de", { numeric: true });
      }
      if (sortKey === "city") {
        return left.management.details.city.localeCompare(right.management.details.city, "de");
      }
      if (sortKey === "price") {
        return right.management.details.purchasePrice - left.management.details.purchasePrice;
      }
      if (sortKey === "living-area") {
        return right.management.details.livingArea - left.management.details.livingArea;
      }
      if (sortKey === "rooms") {
        return right.management.details.rooms - left.management.details.rooms;
      }
      return right.management.updatedAt.localeCompare(left.management.updatedAt);
    });
  }, [archiveFilter, query, releaseFilter, rows, sortKey]);

  if (!management) {
    return (
      <section className="management-shell">
        <div className="management-empty">Die Immobilienverwaltung wird vorbereitet …</div>
      </section>
    );
  }

  const activeEntry = activeListingId
    ? findListing(state, activeListingId)
    : undefined;
  const activeListing = activeEntry?.listing;
  const activeProject = activeEntry?.project;
  const activeDetails = activeListing?.management?.details;

  const record = (
    current: StudioState,
    action: string,
    targetType: AuditLogEntry["targetType"],
    targetId: string,
    description: string,
  ): StudioState => appendAuditLog(current, {
    action,
    targetType,
    targetId,
    description,
  });

  const updateListing = (
    listingId: string,
    update: (listing: GeneratedListing, project: ProjectInput) => GeneratedListing,
  ) => {
    if (!canEdit) return;
    setState((current) => mapListing(current, listingId, update));
  };

  const updateActiveManagement = (patch: Partial<ListingManagement>) => {
    if (!activeListing) return;
    updateListing(activeListing.id, (listing) => withUpdatedManagement(listing, patch));
  };

  const updateDetails = (patch: Partial<ListingDetails>) => {
    if (!activeListing?.management) return;
    updateActiveManagement({
      details: { ...activeListing.management.details, ...patch },
    });
  };

  const updateTexts = (patch: Partial<GeneratedListing["texts"]>) => {
    if (!activeListing) return;
    updateListing(activeListing.id, (listing) => ({
      ...listing,
      texts: { ...listing.texts, ...patch },
      management: listing.management
        ? { ...listing.management, updatedAt: new Date().toISOString() }
        : listing.management,
    }));
  };

  const selectAllVisible = (checked: boolean) => {
    setSelectedIds(checked ? visibleRows.map((row) => row.listing.id) : []);
  };

  const selectedIdSet = new Set(selectedIds);
  const selectedRows = rows.filter((row) => selectedIdSet.has(row.listing.id));

  const bulkLifecycle = (
    action: "release" | "unrelease" | "archive" | "restore",
  ) => {
    if (!canEdit || !selectedIds.length) return;
    const at = new Date().toISOString();
    setState((current) => {
      let next = current;
      selectedIds.forEach((listingId) => {
        next = mapListing(next, listingId, (listing) => {
          if (!listing.management) return listing;
          const patch: Partial<ListingManagement> = action === "archive"
            ? { archivedAt: at, released: false }
            : action === "restore"
              ? { archivedAt: undefined }
              : { released: action === "release" };
          return withUpdatedManagement(listing, patch, at);
        });
      });
      return record(
        next,
        action === "archive"
          ? "Objekte archiviert"
          : action === "restore"
            ? "Objekte wiederhergestellt"
            : action === "release"
              ? "Objekte freigegeben"
              : "Freigabe entfernt",
        "listing",
        selectedIds.join(","),
        `${selectedIds.length} Objekt${selectedIds.length === 1 ? "" : "e"} bearbeitet`,
      );
    });
    if (action === "archive" && archiveFilter === "active") setSelectedIds([]);
  };

  const copySelected = () => {
    if (!canEdit || !selectedRows.length) return;
    const at = new Date().toISOString();
    setState((current) => {
      const ids = allocateProviderExternalIds(
        current.provider.providerNumber,
        current.projects.flatMap((project) => project.listings.map((listing) => listing.externalId)),
        selectedRows.length,
      );
      let index = 0;
      const projects = current.projects.map((project) => {
        const copies = project.listings
          .filter((listing) => selectedIds.includes(listing.id))
          .map((listing) => {
            const copyId = uid("listing");
            const managementCopy = listing.management
              ? {
                  ...listing.management,
                  lifecycle: "draft" as const,
                  released: false,
                  createdAt: at,
                  updatedAt: at,
                  archivedAt: undefined,
                  copiedFromId: listing.id,
                  media: listing.management.media.map((media) => ({
                    ...media,
                    id: media.sourceImageId
                      ? `source-${copyId}-${media.sourceImageId}`
                      : uid("media"),
                  })),
                  appointments: [],
                  portals: listing.management.portals.map((portal) => ({
                    portalId: portal.portalId,
                    enabled: portal.enabled,
                    status: "not-transferred" as const,
                  })),
                }
              : undefined;
            const copy: GeneratedListing = {
              ...listing,
              id: copyId,
              externalId: ids[index],
              uploadedAt: undefined,
              totalSyncRunId: undefined,
              version: 1,
              texts: {
                ...listing.texts,
                title: `${listing.texts.title} – Kopie`,
              },
              management: managementCopy,
            };
            index += 1;
            return copy;
          });
        return copies.length
          ? { ...project, listings: [...project.listings, ...copies] }
          : project;
      });
      return record(
        { ...current, projects },
        "Objekte kopiert",
        "listing",
        selectedIds.join(","),
        `${selectedRows.length} neue Entwürfe mit eigenen Objekt-IDs angelegt`,
      );
    });
    notify(`${selectedRows.length} Objekt${selectedRows.length === 1 ? "" : "e"} wurden als neue Entwürfe kopiert.`);
  };

  const deleteLocalSelected = () => {
    if (!canEdit || !selectedRows.length) return;
    const onlyArchived = selectedRows.every((row) => Boolean(row.management.archivedAt));
    if (!onlyArchived) {
      notify("Lokales Löschen ist nur für archivierte Objekte möglich.");
      return;
    }
    if (!window.confirm(
      `${selectedRows.length} archivierte Objekt${selectedRows.length === 1 ? "" : "e"} dauerhaft lokal löschen?\n\nDie Übertragung auf Portalen wird dadurch nicht gelöscht.`,
    )) return;
    setState((current) => {
      const projects = current.projects.map((project) => ({
        ...project,
        listings: project.listings.filter((listing) => !selectedIds.includes(listing.id)),
      }));
      return record(
        { ...current, projects },
        "Archivierte Objekte lokal gelöscht",
        "listing",
        selectedIds.join(","),
        `${selectedRows.length} archivierte Objekte dauerhaft entfernt`,
      );
    });
    setSelectedIds([]);
    setActiveListingId("");
  };

  const addFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!activeListing?.management || !canEdit) return;
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (!files.length) return;
    try {
      const additions = await Promise.all(files.map(async (file, index) => (
        createListingMediaItem(
          file.type.startsWith("image/") ? "image" : "document",
          {
            name: file.name,
            caption: file.name.replace(/\.[^.]+$/, ""),
            mimeType: file.type,
            dataUrl: await fileDataUrl(file),
          },
          activeListing.management!.media.length + index,
        )
      )));
      updateActiveManagement({
        media: [...activeListing.management.media, ...additions],
      });
      setState((current) => record(
        current,
        "Medien hinzugefügt",
        "media",
        activeListing.id,
        `${additions.length} Datei${additions.length === 1 ? "" : "en"} ergänzt`,
      ));
    } catch {
      notify("Mindestens eine Datei konnte nicht gelesen werden.");
    }
  };

  const addLinkMedia = () => {
    if (!activeListing?.management || !canEdit || !mediaLinkUrl.trim()) return;
    const media = createListingMediaItem(
      mediaLinkKind,
      {
        name: mediaLinkCaption.trim() || mediaLinkUrl.trim(),
        caption: mediaLinkCaption.trim() || MEDIA_KIND_LABELS[mediaLinkKind],
        url: mediaLinkUrl.trim(),
      },
      activeListing.management.media.length,
    );
    updateActiveManagement({ media: [...activeListing.management.media, media] });
    setMediaLinkUrl("");
    setMediaLinkCaption("");
    setState((current) => record(
      current,
      "Verknüpfung hinzugefügt",
      "media",
      media.id,
      `${MEDIA_KIND_LABELS[mediaLinkKind]} ergänzt`,
    ));
  };

  const updateMedia = (mediaId: string, patch: Partial<ListingMediaItem>) => {
    if (!activeListing?.management) return;
    updateActiveManagement({
      media: activeListing.management.media.map((media) => (
        media.id === mediaId ? { ...media, ...patch } : media
      )),
    });
  };

  const removeMedia = (mediaId: string) => {
    if (!activeListing?.management || !canEdit) return;
    const media = activeListing.management.media.find((item) => item.id === mediaId);
    if (!media || !window.confirm(`„${media.caption || media.name}“ aus diesem Objekt entfernen?`)) return;
    updateActiveManagement({
      media: activeListing.management.media
        .filter((item) => item.id !== mediaId)
        .map((item, index) => ({ ...item, order: index })),
    });
  };

  const moveMedia = (mediaId: string, direction: -1 | 1) => {
    if (!activeListing?.management || !canEdit) return;
    const ordered = [...activeListing.management.media].sort((left, right) => left.order - right.order);
    const index = ordered.findIndex((media) => media.id === mediaId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    updateActiveManagement({
      media: ordered.map((media, mediaIndex) => ({ ...media, order: mediaIndex })),
    });
  };

  const rotateMedia = async (media: ListingMediaItem) => {
    if (!activeListing || !canEdit) return;
    const dataUrl = resolveListingMediaDataUrl(state, activeListing, media);
    if (!dataUrl) {
      notify("Das Bild ist lokal nicht verfügbar.");
      return;
    }
    try {
      updateMedia(media.id, {
        dataUrl: await rotatedImageDataUrl(dataUrl),
        mimeType: "image/jpeg",
        rotation: 0,
      });
    } catch (error) {
      notify(error instanceof Error ? error.message : "Das Bild konnte nicht gedreht werden.");
    }
  };

  const downloadMediaZip = async () => {
    if (!activeListing?.management) return;
    const zip = new JSZip();
    let count = 0;
    activeListing.management.media
      .filter((media) => (
        media.released && (media.kind === "image" || media.kind === "floorplan")
      ))
      .forEach((media, index) => {
        const dataUrl = resolveListingMediaDataUrl(state, activeListing, media);
        const base64 = dataUrl.split(",")[1];
        if (!base64) return;
        const extension = media.mimeType?.includes("png")
          ? "png"
          : media.mimeType?.includes("webp")
            ? "webp"
            : "jpg";
        zip.file(
          `${String(index + 1).padStart(2, "0")}-${media.caption.replace(/[^a-zA-Z0-9äöüÄÖÜß]+/g, "-")}.${extension}`,
          base64,
          { base64: true },
        );
        count += 1;
      });
    if (!count) {
      notify("Für dieses Objekt sind keine freigegebenen Bilder vorhanden.");
      return;
    }
    downloadBlob(
      await zip.generateAsync({ type: "blob", compression: "DEFLATE" }),
      `bilder-${activeListing.externalId}.zip`,
    );
  };

  const generateExpose = async () => {
    if (!activeListing || !activeProject || !management) return;
    setExposeBusy(true);
    try {
      const images = (activeListing.management?.media ?? [])
        .filter((media) => (
          media.released && (media.kind === "image" || media.kind === "floorplan")
        ))
        .sort((left, right) => left.order - right.order)
        .map((media) => ({
          dataUrl: resolveListingMediaDataUrl(state, activeListing, media),
          caption: media.caption,
        }))
        .filter((image) => Boolean(image.dataUrl));
      const result = await buildExposePdf({
        listing: activeListing,
        project: activeProject,
        company: management.company,
        images,
        options: exposeOptions,
      });
      downloadBlob(result.blob, result.filename);
      setState((current) => record(
        current,
        "Exposé erstellt",
        "listing",
        activeListing.id,
        result.filename,
      ));
    } catch (error) {
      notify(error instanceof Error ? error.message : "Das Exposé konnte nicht erstellt werden.");
    } finally {
      setExposeBusy(false);
    }
  };

  const addAppointment = () => {
    if (!activeListing?.management || !canEdit) return;
    if (!appointmentDraft.title.trim() || !appointmentDraft.startsAt) {
      notify("Bitte mindestens Titel und Startzeit des Termins eintragen.");
      return;
    }
    const start = new Date(appointmentDraft.startsAt);
    const fallbackEnd = new Date(start.getTime() + 60 * 60 * 1000);
    const appointment: ListingAppointment = {
      id: uid("appointment"),
      title: appointmentDraft.title.trim(),
      startsAt: start.toISOString(),
      endsAt: appointmentDraft.endsAt
        ? new Date(appointmentDraft.endsAt).toISOString()
        : fallbackEnd.toISOString(),
      location: appointmentDraft.location.trim(),
      contactName: appointmentDraft.contactName.trim(),
      contactEmail: appointmentDraft.contactEmail.trim(),
      notes: appointmentDraft.notes.trim(),
      status: "planned",
      createdAt: new Date().toISOString(),
    };
    updateActiveManagement({
      appointments: [...activeListing.management.appointments, appointment],
    });
    setAppointmentDraft({
      title: "Besichtigung",
      startsAt: "",
      endsAt: "",
      location: "",
      contactName: "",
      contactEmail: "",
      notes: "",
    });
    setState((current) => record(
      current,
      "Termin angelegt",
      "appointment",
      appointment.id,
      `${appointment.title} am ${formatDate(appointment.startsAt, true)}`,
    ));
  };

  const updateAppointment = (appointmentId: string, patch: Partial<ListingAppointment>) => {
    if (!activeListing?.management || !canEdit) return;
    updateActiveManagement({
      appointments: activeListing.management.appointments.map((appointment) => (
        appointment.id === appointmentId ? { ...appointment, ...patch } : appointment
      )),
    });
  };

  const removeAppointment = (appointmentId: string) => {
    if (!activeListing?.management || !canEdit) return;
    updateActiveManagement({
      appointments: activeListing.management.appointments.filter((item) => item.id !== appointmentId),
    });
  };

  const downloadAppointment = (appointment: ListingAppointment) => {
    const stamp = (value: string) => new Date(value)
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
    const escape = (value: string) => value
      .replaceAll("\\", "\\\\")
      .replaceAll("\n", "\\n")
      .replaceAll(",", "\\,")
      .replaceAll(";", "\\;");
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Fabian Pascal//InseratStudio//DE",
      "BEGIN:VEVENT",
      `UID:${appointment.id}@inseratstudio.local`,
      `DTSTAMP:${stamp(new Date().toISOString())}`,
      `DTSTART:${stamp(appointment.startsAt)}`,
      `DTEND:${stamp(appointment.endsAt)}`,
      `SUMMARY:${escape(appointment.title)}`,
      `LOCATION:${escape(appointment.location)}`,
      `DESCRIPTION:${escape(appointment.notes)}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    downloadBlob(new Blob([ics], { type: "text/calendar;charset=utf-8" }), `${appointment.title}.ics`);
  };

  const transferActive = async () => {
    if (!activeListing || !canTransfer || busy) return;
    await onTransferListing(activeListing.id);
  };

  const deleteRemoteSelected = async () => {
    if (!selectedIds.length || !canDeleteRemote || busy) return;
    if (!window.confirm(
      `${selectedIds.length} OpenImmo-Löschauftrag${selectedIds.length === 1 ? "" : "e"} wirklich an Immoprofessional übertragen?\n\nDie Löschung wird erst durch einen späteren Importbericht bestätigt.`,
    )) return;
    await onDeleteListings(selectedIds);
  };

  const importReportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setReportBusy(true);
    try {
      const content = await file.text();
      const events = parseImportReport(content, management.portals);
      if (!events.length) {
        notify("Im Bericht wurden keine Objekt-IDs mit Statusinformationen gefunden.");
        return;
      }
      const result = applyImportReport(state, file.name, events);
      setState(result.state);
      notify(`${result.matchedCount} von ${events.length} Berichtseinträgen wurden Objekten zugeordnet.`);
    } catch {
      notify("Der Importbericht konnte nicht gelesen werden.");
    } finally {
      setReportBusy(false);
    }
  };

  const updatePortalConfig = (portalId: string, patch: Partial<PortalConfiguration>) => {
    if (!canManageCompany) return;
    setState((current) => current.management
      ? {
          ...current,
          projects: patch.enabled === undefined
            ? current.projects
            : current.projects.map((project) => ({
                ...project,
                listings: project.listings.map((listing) => (
                  listing.management
                    ? {
                        ...listing,
                        management: {
                          ...listing.management,
                          portals: listing.management.portals.map((portal) => (
                            portal.portalId === portalId
                              ? { ...portal, enabled: patch.enabled! }
                              : portal
                          )),
                          updatedAt: new Date().toISOString(),
                        },
                      }
                    : listing
                )),
              })),
          management: {
            ...current.management,
            portals: current.management.portals.map((portal) => (
              portal.id === portalId ? { ...portal, ...patch } : portal
            )),
          },
        }
      : current);
  };

  const updateCompany = (patch: Partial<CompanySettings>) => {
    if (!canManageCompany) return;
    setState((current) => current.management
      ? {
          ...current,
          management: {
            ...current.management,
            company: { ...current.management.company, ...patch },
          },
        }
      : current);
  };

  const addUser = () => {
    if (!canManageUsers || !newUser.name.trim()) return;
    const user = createManagementUser(newUser.name.trim(), newUser.email.trim(), newUser.role);
    setState((current) => {
      if (!current.management) return current;
      return record(
        {
          ...current,
          management: {
            ...current.management,
            users: [...current.management.users, user],
          },
        },
        "Benutzer angelegt",
        "user",
        user.id,
        `${user.name} – ${ROLE_LABELS[user.role]}`,
      );
    });
    setNewUser({ name: "", email: "", role: "editor" });
  };

  const updateUser = (userId: string, patch: Partial<ManagementUser>) => {
    if (!canManageUsers) return;
    setState((current) => {
      if (!current.management) return current;
      const users = current.management.users.map((user) => (
        user.id === userId ? { ...user, ...patch } : user
      ));
      const activeAdmins = users.filter((user) => user.active && user.role === "admin");
      if (!activeAdmins.length) {
        notify("Mindestens ein aktiver Administrator muss erhalten bleiben.");
        return current;
      }
      return {
        ...current,
        management: {
          ...current.management,
          users,
          currentUserId: users.some((user) => (
            user.id === current.management?.currentUserId && user.active
          ))
            ? current.management.currentUserId
            : activeAdmins[0].id,
        },
      };
    });
  };

  const switchUser = (userId: string) => {
    const user = management.users.find((item) => item.id === userId && item.active);
    if (!user) return;
    const at = new Date().toISOString();
    setState((current) => {
      if (!current.management) return current;
      const next = {
        ...current,
        management: {
          ...current.management,
          currentUserId: user.id,
          users: current.management.users.map((item) => (
            item.id === user.id ? { ...item, lastActiveAt: at } : item
          )),
        },
      };
      return appendAuditLog(next, {
        action: "Benutzer gewechselt",
        targetType: "user",
        targetId: user.id,
        description: `${user.name} arbeitet jetzt mit der Rolle ${ROLE_LABELS[user.role]}`,
      }, at);
    });
  };

  const auditEntries = management.auditLog.filter((entry) => {
    const normalized = auditQuery.trim().toLocaleLowerCase("de-DE");
    if (!normalized) return true;
    const user = management.users.find((item) => item.id === entry.userId);
    return [
      entry.action,
      entry.description,
      entry.targetId,
      user?.name,
    ].some((value) => String(value ?? "").toLocaleLowerCase("de-DE").includes(normalized));
  });

  return (
    <section className="management-shell">
      <header className="management-header">
        <div>
          <span className="eyebrow">Immobilienverwaltung</span>
          <h2>Objekte, Portale und Organisation</h2>
          <p>{rows.length} Objekte · {rows.filter((row) => row.management.lifecycle === "online").length} online · {rows.filter((row) => row.management.archivedAt).length} archiviert</p>
        </div>
        <label className="management-user-switch">
          <span>Aktiver Benutzer</span>
          <select value={management.currentUserId} onChange={(event) => switchUser(event.target.value)}>
            {management.users.filter((user) => user.active).map((user) => (
              <option key={user.id} value={user.id}>{user.name} · {ROLE_LABELS[user.role]}</option>
            ))}
          </select>
        </label>
      </header>

      <nav className="management-nav" aria-label="Immobilienverwaltung">
        {([
          ["objects", "Objektzentrale"],
          ["portals", "Portale"],
          ["reports", "Importberichte"],
          ["company", "Firmendaten"],
          ["users", "Benutzer"],
          ["audit", "Aktivitäten"],
        ] as Array<[ManagementSection, string]>).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={section === id ? "active" : ""}
            onClick={() => setSection(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {section === "objects" ? (
        <div className="management-object-workspace">
          <div className="management-toolbar">
            <input
              type="search"
              value={query}
              placeholder="Objekt-ID, Titel, Adresse oder Haustyp suchen"
              aria-label="Objekte durchsuchen"
              onChange={(event) => setQuery(event.target.value)}
            />
            <select value={archiveFilter} aria-label="Archivfilter" onChange={(event) => setArchiveFilter(event.target.value as ArchiveFilter)}>
              <option value="active">Aktive Objekte</option>
              <option value="archived">Archiv</option>
              <option value="all">Alle Objekte</option>
            </select>
            <select value={releaseFilter} aria-label="Freigabefilter" onChange={(event) => setReleaseFilter(event.target.value as ReleaseFilter)}>
              <option value="all">Alle Freigaben</option>
              <option value="released">Freigegeben</option>
              <option value="not-released">Nicht freigegeben</option>
            </select>
            <select value={sortKey} aria-label="Objekte sortieren" onChange={(event) => setSortKey(event.target.value as SortKey)}>
              <option value="updated-desc">Zuletzt geändert</option>
              <option value="updated-asc">Älteste Änderung</option>
              <option value="created-desc">Neu eingestellt</option>
              <option value="external-id">Objekt-ID</option>
              <option value="city">Ort</option>
              <option value="price">Preis</option>
              <option value="living-area">Wohnfläche</option>
              <option value="rooms">Zimmer</option>
            </select>
          </div>

          <div className="management-bulkbar">
            <span>{selectedIds.length} ausgewählt</span>
            <button type="button" disabled={!canEdit || !selectedIds.length} onClick={() => bulkLifecycle("release")}>Freigeben</button>
            <button type="button" disabled={!canEdit || !selectedIds.length} onClick={() => bulkLifecycle("unrelease")}>Freigabe entfernen</button>
            <button type="button" disabled={!canEdit || !selectedIds.length} onClick={copySelected}>Kopieren</button>
            <button type="button" disabled={!canEdit || !selectedIds.length} onClick={() => bulkLifecycle("archive")}>Archivieren</button>
            <button type="button" disabled={!canEdit || !selectedIds.length} onClick={() => bulkLifecycle("restore")}>Wiederherstellen</button>
            <button type="button" className="danger" disabled={!canDeleteRemote || !selectedIds.length || busy || !uploadAvailable} onClick={deleteRemoteSelected}>Löschauftrag senden</button>
            <button type="button" className="danger ghost" disabled={!canEdit || !selectedIds.length} onClick={deleteLocalSelected}>Lokal löschen</button>
          </div>

          <div className="management-table-wrap">
            <table className="management-object-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={visibleRows.length > 0 && visibleRows.every((row) => selectedIds.includes(row.listing.id))}
                      aria-label="Alle sichtbaren Objekte auswählen"
                      onChange={(event) => selectAllVisible(event.target.checked)}
                    />
                  </th>
                  <th>Status</th>
                  <th>Objekt</th>
                  <th>Ort</th>
                  <th>Kennzahlen</th>
                  <th>Freigabe</th>
                  <th>Geändert</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibleRows.map(({ project, listing, management: listingManagement }) => (
                  <tr key={listing.id} className={activeListingId === listing.id ? "active" : ""}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(listing.id)}
                        aria-label={`${listing.externalId} auswählen`}
                        onChange={(event) => setSelectedIds((selected) => (
                          event.target.checked
                            ? [...new Set([...selected, listing.id])]
                            : selected.filter((id) => id !== listing.id)
                        ))}
                      />
                    </td>
                    <td><span className={`lifecycle-badge ${nextLifecycle(listing)}`}>{LIFECYCLE_LABELS[nextLifecycle(listing)]}</span></td>
                    <td>
                      <button
                        type="button"
                        className="management-object-link"
                        onClick={() => {
                          setActiveListingId(listing.id);
                          setEditorTab("object");
                        }}
                      >
                        <b>{listing.texts.title || listing.templateName}</b>
                        <span>{listing.externalId} · {project.name}</span>
                      </button>
                    </td>
                    <td>{listingManagement.details.zip} {listingManagement.details.city}<small>{listingManagement.details.district}</small></td>
                    <td>{euro(listingManagement.details.purchasePrice)}<small>{listingManagement.details.livingArea} m² · {listingManagement.details.rooms} Zi.</small></td>
                    <td>{listingManagement.released ? "Ja" : "Nein"}</td>
                    <td>{formatDate(listingManagement.updatedAt, true)}</td>
                    <td>
                      <button
                        type="button"
                        className="compact-action"
                        onClick={() => setActiveListingId(listing.id)}
                      >
                        Bearbeiten
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visibleRows.length ? (
              <div className="management-empty">Keine Objekte entsprechen den gewählten Filtern.</div>
            ) : null}
          </div>

          {activeListing && activeProject && activeListing.management && activeDetails ? (
            <article className="management-editor">
              <header className="management-editor-header">
                <div>
                  <span className={`lifecycle-badge ${nextLifecycle(activeListing)}`}>{LIFECYCLE_LABELS[nextLifecycle(activeListing)]}</span>
                  <h3>{activeListing.texts.title || activeListing.templateName}</h3>
                  <p>{activeListing.externalId} · {activeProject.name}</p>
                </div>
                <div className="management-editor-actions">
                  <button type="button" onClick={generateExpose} disabled={exposeBusy}>{exposeBusy ? "PDF wird erstellt …" : "Exposé-PDF"}</button>
                  <button type="button" className="primary" onClick={transferActive} disabled={!canTransfer || busy || !uploadAvailable}>
                    {uploadAvailable ? "An Immoprofessional übertragen" : "Upload-Helfer offline"}
                  </button>
                  <button type="button" aria-label="Editor schließen" onClick={() => setActiveListingId("")}>×</button>
                </div>
              </header>

              <nav className="management-editor-tabs" aria-label="Objektbereiche">
                {EDITOR_TABS.map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={editorTab === id ? "active" : ""}
                    onClick={() => setEditorTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </nav>

              <div className="management-editor-body">
                {editorTab === "object" ? (
                  <>
                    <div className="management-form-grid three">
                      <Field label="Objekt-ID" value={activeListing.externalId} disabled onChange={() => undefined} />
                      <SelectField
                        label="Objektstatus"
                        value={activeDetails.objectStatus}
                        disabled={!canEdit}
                        options={[
                          ["projected", "Projektierung"],
                          ["in-construction", "Im Bau"],
                          ["complete", "Fertiggestellt"],
                        ]}
                        onChange={(value) => updateDetails({ objectStatus: value as ListingDetails["objectStatus"] })}
                      />
                      <Field label="Gruppen-ID" value={activeDetails.groupId} disabled={!canEdit} onChange={(value) => updateDetails({ groupId: value })} />
                      <Field label="Auftragsnummer" value={activeDetails.orderNumber} disabled={!canEdit} onChange={(value) => updateDetails({ orderNumber: value })} />
                      <SelectField label="Währung" value={activeDetails.currency} disabled={!canEdit} options={[["EUR", "EUR"], ["CHF", "CHF"], ["USD", "USD"]]} onChange={(value) => updateDetails({ currency: value as ListingDetails["currency"] })} />
                      <Field label="Verfügbar ab" type="date" value={activeDetails.availableFrom} disabled={!canEdit} onChange={(value) => updateDetails({ availableFrom: value })} />
                    </div>
                    <TextArea label="Interne Hinweise" value={activeDetails.internalNotes} disabled={!canEdit} onChange={(value) => updateDetails({ internalNotes: value })} />
                    <div className="management-checkbox-grid">
                      <Toggle label="Objekt freigeben" checked={activeListing.management.released} disabled={!canEdit} onChange={(released) => updateActiveManagement({ released })} />
                      <Toggle label="Adresse veröffentlichen" checked={activeDetails.addressPublished} disabled={!canEdit} onChange={(addressPublished) => updateDetails({ addressPublished })} />
                      <Toggle label="Google Maps freigeben" checked={activeDetails.googleMapsPublished} disabled={!canEdit} onChange={(googleMapsPublished) => updateDetails({ googleMapsPublished })} />
                    </div>
                  </>
                ) : null}

                {editorTab === "address" ? (
                  <>
                    <h3>Objektadresse</h3>
                    <div className="management-form-grid three">
                      <Field label="Land" value={activeDetails.country} disabled={!canEdit} onChange={(value) => updateDetails({ country: value })} />
                      <Field label="Straße" value={activeDetails.street} disabled={!canEdit} onChange={(value) => updateDetails({ street: value })} />
                      <Field label="Hausnummer" value={activeDetails.houseNumber} disabled={!canEdit} onChange={(value) => updateDetails({ houseNumber: value })} />
                      <Field label="PLZ" value={activeDetails.zip} disabled={!canEdit} onChange={(value) => updateDetails({ zip: value })} />
                      <Field label="Ort" value={activeDetails.city} disabled={!canEdit} onChange={(value) => updateDetails({ city: value })} />
                      <Field label="Ortsteil" value={activeDetails.district} disabled={!canEdit} onChange={(value) => updateDetails({ district: value })} />
                    </div>
                    <h3>Ansprechpartner und Eigentümer</h3>
                    <div className="management-form-grid three">
                      <Field label="Kontakt-Firma" value={activeDetails.contactCompany} disabled={!canEdit} onChange={(value) => updateDetails({ contactCompany: value })} />
                      <Field label="Kontakt-Vorname" value={activeDetails.contactFirstName} disabled={!canEdit} onChange={(value) => updateDetails({ contactFirstName: value })} />
                      <Field label="Kontakt-Nachname" value={activeDetails.contactLastName} disabled={!canEdit} onChange={(value) => updateDetails({ contactLastName: value })} />
                      <Field label="Kontakt-E-Mail" type="email" value={activeDetails.contactEmail} disabled={!canEdit} onChange={(value) => updateDetails({ contactEmail: value })} />
                      <Field label="Kontakt-Telefon" value={activeDetails.contactPhone} disabled={!canEdit} onChange={(value) => updateDetails({ contactPhone: value })} />
                      <Field label="Eigentümer" value={activeDetails.ownerName} disabled={!canEdit} onChange={(value) => updateDetails({ ownerName: value })} />
                      <Field label="Eigentümer-E-Mail" type="email" value={activeDetails.ownerEmail} disabled={!canEdit} onChange={(value) => updateDetails({ ownerEmail: value })} />
                    </div>
                  </>
                ) : null}

                {editorTab === "base" ? (
                  <div className="management-form-grid four">
                    <Field label="Kaufpreis" type="number" min={0} value={activeDetails.purchasePrice} disabled={!canEdit} onChange={(value) => updateDetails({ purchasePrice: readNumber(value) })} />
                    <Field label="Wohnfläche m²" type="number" min={0} value={activeDetails.livingArea} disabled={!canEdit} onChange={(value) => updateDetails({ livingArea: readNumber(value) })} />
                    <Field label="Nutzfläche m²" type="number" min={0} value={activeDetails.usableArea} disabled={!canEdit} onChange={(value) => updateDetails({ usableArea: readNumber(value) })} />
                    <Field label="Grundstück m²" type="number" min={0} value={activeDetails.plotArea} disabled={!canEdit} onChange={(value) => updateDetails({ plotArea: readNumber(value) })} />
                    <Field label="Zimmer" type="number" min={0} value={activeDetails.rooms} disabled={!canEdit} onChange={(value) => updateDetails({ rooms: readNumber(value) })} />
                    <Field label="Schlafzimmer" type="number" min={0} value={activeDetails.bedrooms} disabled={!canEdit} onChange={(value) => updateDetails({ bedrooms: readNumber(value) })} />
                    <Field label="Badezimmer" type="number" min={0} value={activeDetails.bathrooms} disabled={!canEdit} onChange={(value) => updateDetails({ bathrooms: readNumber(value) })} />
                    <Field label="Etagen" type="number" min={0} value={activeDetails.floors} disabled={!canEdit} onChange={(value) => updateDetails({ floors: readNumber(value) })} />
                    <Field label="Balkone" type="number" min={0} value={activeDetails.balconies} disabled={!canEdit} onChange={(value) => updateDetails({ balconies: readNumber(value) })} />
                    <Field label="Terrassen" type="number" min={0} value={activeDetails.terraces} disabled={!canEdit} onChange={(value) => updateDetails({ terraces: readNumber(value) })} />
                    <Field label="Haustyp" value={activeDetails.houseType} disabled={!canEdit} onChange={(value) => updateDetails({ houseType: value })} />
                    <Field label="Baujahr" type="number" min={1800} value={activeDetails.constructionYear} disabled={!canEdit} onChange={(value) => updateDetails({ constructionYear: readNumber(value) })} />
                    <Field label="Sanierungsjahr" type="number" min={0} value={activeDetails.renovationYear} disabled={!canEdit} onChange={(value) => updateDetails({ renovationYear: readNumber(value) })} />
                    <SelectField
                      label="Zustand"
                      value={activeDetails.condition}
                      disabled={!canEdit}
                      options={[
                        ["ERSTBEZUG", "Erstbezug"],
                        ["NEUWERTIG", "Neuwertig"],
                        ["PROJEKTIERT", "Projektiert"],
                        ["ROHBAU", "Rohbau"],
                        ["GEPFLEGT", "Gepflegt"],
                        ["MODERNISIERT", "Modernisiert"],
                        ["TEIL_VOLLRENOVIERT", "Teil-/vollrenoviert"],
                        ["TEIL_SANIERT", "Teilsaniert"],
                        ["VOLL_SANIERT", "Vollsaniert"],
                        ["SANIERUNGSBEDUERFTIG", "Sanierungsbedürftig"],
                        ["BAUFAELLIG", "Baufällig"],
                        ["ENTKERNT", "Entkernt"],
                        ["ABRISSOBJEKT", "Abrissobjekt"],
                        ["NACH_VEREINBARUNG", "Nach Vereinbarung"],
                      ]}
                      onChange={(condition) => updateDetails({ condition })}
                    />
                    <Field label="Bauphase" value={activeDetails.constructionPhase} disabled={!canEdit} onChange={(value) => updateDetails({ constructionPhase: value })} />
                  </div>
                ) : null}

                {editorTab === "features" ? (
                  <>
                    <div className="management-form-grid three">
                      <SelectField
                        label="Ausstattungsqualität"
                        value={activeDetails.equipmentQuality}
                        disabled={!canEdit}
                        options={[["STANDARD", "Standard"], ["GEHOBEN", "Gehoben"], ["LUXUS", "Luxus"]]}
                        onChange={(equipmentQuality) => updateDetails({ equipmentQuality })}
                      />
                      <Field label="Küchenart" value={activeDetails.kitchenType} disabled={!canEdit} onChange={(value) => updateDetails({ kitchenType: value })} />
                      <Field label="Bad-Ausstattung" value={activeDetails.bathroomFeatures} disabled={!canEdit} onChange={(value) => updateDetails({ bathroomFeatures: value })} />
                      <Field label="Bodenbeläge" value={activeDetails.flooring} disabled={!canEdit} onChange={(value) => updateDetails({ flooring: value })} />
                      <Field label="Heizungsart" value={activeDetails.heatingType} disabled={!canEdit} onChange={(value) => updateDetails({ heatingType: value })} />
                      <Field label="Energieträger" value={activeDetails.energySource} disabled={!canEdit} onChange={(value) => updateDetails({ energySource: value })} />
                      <Field label="Stellplätze" value={activeDetails.parkingTypes} disabled={!canEdit} onChange={(value) => updateDetails({ parkingTypes: value })} />
                      <Field label="Ausblick" value={activeDetails.view} disabled={!canEdit} onChange={(value) => updateDetails({ view: value })} />
                    </div>
                    <div className="management-checkbox-grid">
                      {([
                        ["guestWc", "Gäste-WC"],
                        ["garden", "Garten"],
                        ["attic", "Dachboden"],
                        ["fireplace", "Kamin"],
                        ["basement", "Keller"],
                        ["barrierFree", "Barrierefrei"],
                        ["seniorFriendly", "Seniorengerecht"],
                        ["sauna", "Sauna"],
                        ["pool", "Pool"],
                        ["conservatory", "Wintergarten"],
                        ["airConditioning", "Klimaanlage"],
                        ["alarmSystem", "Alarmanlage"],
                        ["elevator", "Aufzug"],
                        ["monument", "Denkmalschutz"],
                        ["rented", "Vermietet"],
                      ] as Array<[keyof ListingDetails, string]>).map(([key, label]) => (
                        <Toggle
                          key={key}
                          label={label}
                          checked={Boolean(activeDetails[key])}
                          disabled={!canEdit}
                          onChange={(checked) => updateDetails({ [key]: checked } as Partial<ListingDetails>)}
                        />
                      ))}
                    </div>
                  </>
                ) : null}

                {editorTab === "energy" ? (
                  <>
                    <div className="management-form-grid three">
                      <SelectField
                        label="Ausweisart"
                        value={activeDetails.energyCertificateType}
                        disabled={!canEdit}
                        options={[["BEDARF", "Bedarfsausweis"], ["VERBRAUCH", "Verbrauchsausweis"]]}
                        onChange={(energyCertificateType) => updateDetails({ energyCertificateType })}
                      />
                      <Field label="Gültig bis" type="date" value={activeDetails.energyCertificateValidUntil} disabled={!canEdit} onChange={(value) => updateDetails({ energyCertificateValidUntil: value })} />
                      <Field label="Energieklasse" value={activeDetails.energyClass} disabled={!canEdit} onChange={(value) => updateDetails({ energyClass: value })} />
                      <Field label="Endenergiebedarf" type="number" min={0} value={activeDetails.endEnergyDemand} disabled={!canEdit} onChange={(value) => updateDetails({ endEnergyDemand: readNumber(value) })} />
                      <Field label="Ausweisjahr" type="number" min={1900} value={activeDetails.certificateYear} disabled={!canEdit} onChange={(value) => updateDetails({ certificateYear: readNumber(value) })} />
                      <Field label="Provision" value={activeDetails.commissionText} disabled={!canEdit} onChange={(value) => updateDetails({ commissionText: value })} />
                    </div>
                    <div className="management-checkbox-grid">
                      <Toggle label="Warmwasser enthalten" checked={activeDetails.warmWaterIncluded} disabled={!canEdit} onChange={(warmWaterIncluded) => updateDetails({ warmWaterIncluded })} />
                      <Toggle label="Provisionspflichtig" checked={activeDetails.commissionRequired} disabled={!canEdit} onChange={(commissionRequired) => updateDetails({ commissionRequired })} />
                    </div>
                  </>
                ) : null}

                {editorTab === "texts" ? (
                  <div className="management-form-grid">
                    <TextArea label="Überschrift" rows={2} value={activeListing.texts.title} disabled={!canEdit} onChange={(title) => updateTexts({ title })} />
                    <TextArea label="Objektbeschreibung" rows={8} value={activeListing.texts.description} disabled={!canEdit} onChange={(description) => updateTexts({ description })} />
                    <TextArea label="Ausstattung" rows={8} value={activeListing.texts.equipment} disabled={!canEdit} onChange={(equipment) => updateTexts({ equipment })} />
                    <TextArea label="Lage" rows={7} value={activeListing.texts.location} disabled={!canEdit} onChange={(location) => updateTexts({ location })} />
                    <TextArea label="Sonstiges" rows={7} value={activeListing.texts.other} disabled={!canEdit} onChange={(other) => updateTexts({ other })} />
                  </div>
                ) : null}

                {editorTab === "appointments" ? (
                  <div className="management-appointments">
                    <div className="appointment-form">
                      <div className="management-form-grid three">
                        <Field label="Titel" value={appointmentDraft.title} disabled={!canEdit} onChange={(value) => setAppointmentDraft((current) => ({ ...current, title: value }))} />
                        <Field label="Beginn" type="datetime-local" value={appointmentDraft.startsAt} disabled={!canEdit} onChange={(value) => setAppointmentDraft((current) => ({ ...current, startsAt: value }))} />
                        <Field label="Ende" type="datetime-local" value={appointmentDraft.endsAt} disabled={!canEdit} onChange={(value) => setAppointmentDraft((current) => ({ ...current, endsAt: value }))} />
                        <Field label="Ort" value={appointmentDraft.location} disabled={!canEdit} onChange={(value) => setAppointmentDraft((current) => ({ ...current, location: value }))} />
                        <Field label="Kontakt" value={appointmentDraft.contactName} disabled={!canEdit} onChange={(value) => setAppointmentDraft((current) => ({ ...current, contactName: value }))} />
                        <Field label="Kontakt-E-Mail" type="email" value={appointmentDraft.contactEmail} disabled={!canEdit} onChange={(value) => setAppointmentDraft((current) => ({ ...current, contactEmail: value }))} />
                      </div>
                      <TextArea label="Notizen" rows={3} value={appointmentDraft.notes} disabled={!canEdit} onChange={(value) => setAppointmentDraft((current) => ({ ...current, notes: value }))} />
                      <button type="button" className="primary" disabled={!canEdit} onClick={addAppointment}>Termin anlegen</button>
                    </div>
                    <div className="appointment-list">
                      {activeListing.management.appointments
                        .slice()
                        .sort((left, right) => left.startsAt.localeCompare(right.startsAt))
                        .map((appointment) => (
                          <article key={appointment.id}>
                            <div>
                              <span className={`appointment-status ${appointment.status}`}>{appointment.status === "planned" ? "Geplant" : appointment.status === "completed" ? "Erledigt" : "Abgesagt"}</span>
                              <h4>{appointment.title}</h4>
                              <p>{formatDate(appointment.startsAt, true)} bis {formatDate(appointment.endsAt, true)}</p>
                              <small>{appointment.location}{appointment.contactName ? ` · ${appointment.contactName}` : ""}</small>
                            </div>
                            <div>
                              <select value={appointment.status} disabled={!canEdit} onChange={(event) => updateAppointment(appointment.id, { status: event.target.value as ListingAppointment["status"] })}>
                                <option value="planned">Geplant</option>
                                <option value="completed">Erledigt</option>
                                <option value="cancelled">Abgesagt</option>
                              </select>
                              <button type="button" onClick={() => downloadAppointment(appointment)}>Kalenderdatei</button>
                              <button type="button" className="danger ghost" disabled={!canEdit} onClick={() => removeAppointment(appointment.id)}>Entfernen</button>
                            </div>
                          </article>
                        ))}
                      {!activeListing.management.appointments.length ? (
                        <div className="management-empty">Noch keine Termine für dieses Objekt.</div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {editorTab === "export" ? (
                  <div className="management-export-grid">
                    <section>
                      <h4>Portalfreigabe</h4>
                      <p>Die Portalzustände werden nach der FTP-Übertragung und über eingelesene Importberichte fortgeschrieben.</p>
                      <div className="portal-state-list">
                        {activeListing.management.portals.map((portalState) => {
                          const portal = management.portals.find((item) => item.id === portalState.portalId);
                          return (
                            <article key={portalState.portalId}>
                              <Toggle
                                label={portal?.name ?? portalState.portalId}
                                checked={portalState.enabled}
                                disabled={!canEdit}
                                onChange={(enabled) => updateActiveManagement({
                                  portals: activeListing.management!.portals.map((item) => (
                                    item.portalId === portalState.portalId ? { ...item, enabled } : item
                                  )),
                                })}
                              />
                              <span className={`portal-status ${portalState.status}`}>{PORTAL_STATUS_LABELS[portalState.status]}</span>
                              <small>{portalState.message || `Letzte Übertragung: ${formatDate(portalState.lastTransferAt, true)}`}</small>
                            </article>
                          );
                        })}
                      </div>
                    </section>
                    <section className="expose-options">
                      <h4>Exposé-Einstellungen</h4>
                      <Toggle label="Kontaktdaten" checked={exposeOptions.includeContact} onChange={(includeContact) => setExposeOptions((current) => ({ ...current, includeContact }))} />
                      <Toggle label="Vollständige Adresse" checked={exposeOptions.includeAddress} onChange={(includeAddress) => setExposeOptions((current) => ({ ...current, includeAddress }))} />
                      <Toggle label="Freigegebene Bilder" checked={exposeOptions.includeImages} onChange={(includeImages) => setExposeOptions((current) => ({ ...current, includeImages }))} />
                      <Toggle label="Firmenname als Logo" checked={exposeOptions.includeLogo} onChange={(includeLogo) => setExposeOptions((current) => ({ ...current, includeLogo }))} />
                      <Toggle label="Seitenzahlen" checked={exposeOptions.includePageNumbers} onChange={(includePageNumbers) => setExposeOptions((current) => ({ ...current, includePageNumbers }))} />
                      <Toggle label="Akzentfarben" checked={exposeOptions.includeColors} onChange={(includeColors) => setExposeOptions((current) => ({ ...current, includeColors }))} />
                      <Toggle label="Nur Titelseite" checked={exposeOptions.firstPageOnly} onChange={(firstPageOnly) => setExposeOptions((current) => ({ ...current, firstPageOnly }))} />
                      <button type="button" className="primary" disabled={exposeBusy} onClick={generateExpose}>Exposé herunterladen</button>
                    </section>
                  </div>
                ) : null}

                <section className="management-media-section">
                  <header>
                    <div>
                      <h4>Medien und Informationsmaterial</h4>
                      <p>Bilder, Grundrisse, Dokumente, Videos, Links und virtuelle Touren werden objektbezogen verwaltet.</p>
                    </div>
                    <div>
                      <label className={`upload-button${canEdit ? "" : " disabled"}`}>
                        Dateien hinzufügen
                        <input type="file" multiple accept="image/*,.pdf,.doc,.docx" disabled={!canEdit} onChange={addFiles} />
                      </label>
                      <button type="button" onClick={downloadMediaZip}>Bilder als ZIP</button>
                    </div>
                  </header>

                  <div className="media-link-form">
                    <SelectField
                      label="Art"
                      value={mediaLinkKind}
                      disabled={!canEdit}
                      options={[["video", "Video"], ["link", "Link"], ["tour", "3D-Tour"]]}
                      onChange={(value) => setMediaLinkKind(value as ListingMediaKind)}
                    />
                    <Field label="Bezeichnung" value={mediaLinkCaption} disabled={!canEdit} onChange={setMediaLinkCaption} />
                    <Field label="URL" type="url" value={mediaLinkUrl} disabled={!canEdit} onChange={setMediaLinkUrl} />
                    <button type="button" className="primary" disabled={!canEdit || !mediaLinkUrl.trim()} onClick={addLinkMedia}>Verknüpfung hinzufügen</button>
                  </div>

                  <div className="management-media-list">
                    {activeListing.management.media
                      .slice()
                      .sort((left, right) => left.order - right.order)
                      .map((media) => {
                        const dataUrl = resolveListingMediaDataUrl(state, activeListing, media);
                        const isImage = media.kind === "image" || media.kind === "floorplan";
                        return (
                          <article key={media.id}>
                            <div className="management-media-preview">
                              {isImage && dataUrl ? (
                                <Image
                                  src={dataUrl}
                                  alt={media.caption || media.name}
                                  width={160}
                                  height={110}
                                  sizes="160px"
                                  unoptimized
                                />
                              ) : (
                                <span>{MEDIA_KIND_LABELS[media.kind]}</span>
                              )}
                            </div>
                            <div className="management-media-meta">
                              <select
                                value={media.kind}
                                disabled={!canEdit}
                                onChange={(event) => updateMedia(media.id, { kind: event.target.value as ListingMediaKind })}
                              >
                                {Object.entries(MEDIA_KIND_LABELS).map(([value, label]) => (
                                  <option key={value} value={value}>{label}</option>
                                ))}
                              </select>
                              <input
                                value={media.caption}
                                disabled={!canEdit}
                                aria-label="Medienbeschreibung"
                                onChange={(event) => updateMedia(media.id, { caption: event.target.value })}
                              />
                              <small>{media.name}{media.url ? ` · ${media.url}` : ""}</small>
                            </div>
                            <div className="management-media-actions">
                              <Toggle label="Freigegeben" checked={media.released} disabled={!canEdit} onChange={(released) => updateMedia(media.id, { released })} />
                              <button type="button" disabled={!canEdit || media.order === 0} onClick={() => moveMedia(media.id, -1)}>↑</button>
                              <button type="button" disabled={!canEdit || media.order === activeListing.management!.media.length - 1} onClick={() => moveMedia(media.id, 1)}>↓</button>
                              {isImage ? <button type="button" disabled={!canEdit} onClick={() => rotateMedia(media)}>Drehen</button> : null}
                              {media.url ? <a href={media.url} target="_blank" rel="noreferrer">Öffnen</a> : null}
                              {media.dataUrl && media.kind === "document" ? <a href={media.dataUrl} download={media.name}>Download</a> : null}
                              <button type="button" className="danger ghost" disabled={!canEdit} onClick={() => removeMedia(media.id)}>Entfernen</button>
                            </div>
                          </article>
                        );
                      })}
                  </div>
                </section>
              </div>
            </article>
          ) : null}
        </div>
      ) : null}

      {section === "portals" ? (
        <div className="management-panel">
          <header>
            <div>
              <span className="eyebrow">Exportschnittstellen</span>
              <h3>Portalübersicht</h3>
              <p>Kontingente und lokale Statuswerte werden durch Importberichte aktualisiert.</p>
            </div>
          </header>
          <div className="portal-config-grid">
            {management.portals.map((portal) => (
              <article key={portal.id}>
                <div className="portal-config-heading">
                  <div><span className={`portal-dot${portal.enabled ? " online" : ""}`} /><h4>{portal.name}</h4></div>
                  <Toggle label="Aktiv" checked={portal.enabled} disabled={!canManageCompany} onChange={(enabled) => updatePortalConfig(portal.id, { enabled })} />
                </div>
                <div className="portal-metrics">
                  <div><span>Online</span><b>{portal.currentOnline}</b></div>
                  <div><span>Kontingent</span><b>{portal.quota || "∞"}</b></div>
                  <div><span>Bilderlimit</span><b>{portal.imageLimit}</b></div>
                  <div><span>Textlimit Bild</span><b>{portal.captionLimit}</b></div>
                </div>
                <div className="management-form-grid two">
                  <Field label="Kontingent (0 = unbegrenzt)" type="number" min={0} value={portal.quota} disabled={!canManageCompany} onChange={(value) => updatePortalConfig(portal.id, { quota: readNumber(value) })} />
                  <Field label="Maximale Bilder" type="number" min={1} value={portal.imageLimit} disabled={!canManageCompany} onChange={(value) => updatePortalConfig(portal.id, { imageLimit: readNumber(value) })} />
                  <Field label="Max. Zeichen Bildtext" type="number" min={1} value={portal.captionLimit} disabled={!canManageCompany} onChange={(value) => updatePortalConfig(portal.id, { captionLimit: readNumber(value) })} />
                </div>
                <small>Letzter Berichtsabgleich: {formatDate(portal.lastSyncAt, true)}</small>
              </article>
            ))}
          </div>
          <div className="portal-object-matrix">
            <h4>Status je Objekt</h4>
            <table>
              <thead>
                <tr><th>Objekt</th>{management.portals.map((portal) => <th key={portal.id}>{portal.name}</th>)}</tr>
              </thead>
              <tbody>
                {rows.filter((row) => !row.management.archivedAt).map((row) => (
                  <tr key={row.listing.id}>
                    <td><b>{row.listing.externalId}</b><small>{row.listing.texts.title}</small></td>
                    {management.portals.map((portal) => {
                      const status = row.management.portals.find((item) => item.portalId === portal.id);
                      return <td key={portal.id}><span className={`portal-status ${status?.status ?? "not-transferred"}`}>{PORTAL_STATUS_LABELS[status?.status ?? "not-transferred"]}</span></td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {section === "reports" ? (
        <div className="management-panel">
          <header>
            <div>
              <span className="eyebrow">Rückmeldungen</span>
              <h3>Immoprofessional-Importberichte</h3>
              <p>XML-, CSV-, JSON- und Textberichte werden anhand der Objekt-ID zugeordnet.</p>
            </div>
            <label className={`upload-button${reportBusy ? " disabled" : ""}`}>
              {reportBusy ? "Bericht wird verarbeitet …" : "Importbericht einlesen"}
              <input type="file" accept=".xml,.csv,.json,.txt,.log" disabled={reportBusy} onChange={importReportFile} />
            </label>
          </header>
          <div className="report-list">
            {management.importReports.map((report: ImportReportRecord) => (
              <details key={report.id}>
                <summary>
                  <div><b>{report.filename}</b><span>{formatDate(report.importedAt, true)}</span></div>
                  <strong>{report.matchedCount}/{report.eventCount} zugeordnet</strong>
                </summary>
                <table>
                  <thead><tr><th>Objekt-ID</th><th>Portal</th><th>Status</th><th>Meldung</th></tr></thead>
                  <tbody>
                    {report.events.map((event, index) => (
                      <tr key={`${event.externalId}-${event.portalId}-${index}`}>
                        <td>{event.externalId}</td>
                        <td>{management.portals.find((portal) => portal.id === event.portalId)?.name ?? "Alle aktiven"}</td>
                        <td><span className={`portal-status ${event.status}`}>{PORTAL_STATUS_LABELS[event.status]}</span></td>
                        <td>{event.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            ))}
            {!management.importReports.length ? (
              <div className="management-empty">Noch kein Importbericht eingelesen.</div>
            ) : null}
          </div>
        </div>
      ) : null}

      {section === "company" ? (
        <div className="management-panel">
          <header>
            <div>
              <span className="eyebrow">Basisdaten</span>
              <h3>Firmendaten und Impressum</h3>
              <p>Diese Angaben werden für Exposés und Ansprechpartner verwendet.</p>
            </div>
            {!canManageCompany ? <span className="permission-note">Nur Administration</span> : null}
          </header>
          <div className="management-form-grid three">
            <Field label="Firmenname" value={management.company.name} disabled={!canManageCompany} onChange={(value) => updateCompany({ name: value })} />
            <Field label="Rechtlicher Name" value={management.company.legalName} disabled={!canManageCompany} onChange={(value) => updateCompany({ legalName: value })} />
            <Field label="Geschäftsführung" value={management.company.managingDirector} disabled={!canManageCompany} onChange={(value) => updateCompany({ managingDirector: value })} />
            <Field label="Straße" value={management.company.street} disabled={!canManageCompany} onChange={(value) => updateCompany({ street: value })} />
            <Field label="Hausnummer" value={management.company.houseNumber} disabled={!canManageCompany} onChange={(value) => updateCompany({ houseNumber: value })} />
            <Field label="PLZ" value={management.company.zip} disabled={!canManageCompany} onChange={(value) => updateCompany({ zip: value })} />
            <Field label="Ort" value={management.company.city} disabled={!canManageCompany} onChange={(value) => updateCompany({ city: value })} />
            <Field label="Land" value={management.company.country} disabled={!canManageCompany} onChange={(value) => updateCompany({ country: value })} />
            <Field label="Telefon" value={management.company.phone} disabled={!canManageCompany} onChange={(value) => updateCompany({ phone: value })} />
            <Field label="E-Mail" type="email" value={management.company.email} disabled={!canManageCompany} onChange={(value) => updateCompany({ email: value })} />
            <Field label="Website" type="url" value={management.company.website} disabled={!canManageCompany} onChange={(value) => updateCompany({ website: value })} />
            <Field label="Steuernummer/USt-ID" value={management.company.taxId} disabled={!canManageCompany} onChange={(value) => updateCompany({ taxId: value })} />
            <Field label="Handelsregister" value={management.company.tradeRegister} disabled={!canManageCompany} onChange={(value) => updateCompany({ tradeRegister: value })} />
          </div>
          <div className="management-form-grid">
            <TextArea label="Impressum" rows={6} value={management.company.imprint} disabled={!canManageCompany} onChange={(value) => updateCompany({ imprint: value })} />
            <TextArea label="Allgemeine Geschäftsbedingungen" rows={8} value={management.company.terms} disabled={!canManageCompany} onChange={(value) => updateCompany({ terms: value })} />
            <TextArea label="Datenschutz-/Cookie-Hinweis" rows={6} value={management.company.privacyNotice} disabled={!canManageCompany} onChange={(value) => updateCompany({ privacyNotice: value })} />
          </div>
          <section className="opening-hours">
            <h4>Öffnungszeiten</h4>
            {management.company.openingHours.map((hours, index) => (
              <div key={hours.weekday}>
                <Toggle
                  label={hours.weekday}
                  checked={hours.enabled}
                  disabled={!canManageCompany}
                  onChange={(enabled) => updateCompany({
                    openingHours: management.company.openingHours.map((item, itemIndex) => (
                      itemIndex === index ? { ...item, enabled } : item
                    )),
                  })}
                />
                <input type="time" value={hours.opensAt} disabled={!canManageCompany || !hours.enabled} onChange={(event) => updateCompany({ openingHours: management.company.openingHours.map((item, itemIndex) => itemIndex === index ? { ...item, opensAt: event.target.value } : item) })} />
                <span>bis</span>
                <input type="time" value={hours.closesAt} disabled={!canManageCompany || !hours.enabled} onChange={(event) => updateCompany({ openingHours: management.company.openingHours.map((item, itemIndex) => itemIndex === index ? { ...item, closesAt: event.target.value } : item) })} />
                <span>Pause</span>
                <input type="time" value={hours.pauseFrom} disabled={!canManageCompany || !hours.enabled} onChange={(event) => updateCompany({ openingHours: management.company.openingHours.map((item, itemIndex) => itemIndex === index ? { ...item, pauseFrom: event.target.value } : item) })} />
                <span>bis</span>
                <input type="time" value={hours.pauseUntil} disabled={!canManageCompany || !hours.enabled} onChange={(event) => updateCompany({ openingHours: management.company.openingHours.map((item, itemIndex) => itemIndex === index ? { ...item, pauseUntil: event.target.value } : item) })} />
              </div>
            ))}
          </section>
        </div>
      ) : null}

      {section === "users" ? (
        <div className="management-panel">
          <header>
            <div>
              <span className="eyebrow">Berechtigungen</span>
              <h3>Benutzerverwaltung</h3>
              <p>Bearbeiter dürfen Objekte und Uploads verwalten; Löschaufträge, Benutzer und Firmendaten bleiben der Administration vorbehalten.</p>
            </div>
          </header>
          <div className="user-list">
            {management.users.map((user) => (
              <article key={user.id} className={user.active ? "" : "inactive"}>
                <div className="user-avatar">{user.name.slice(0, 2).toUpperCase()}</div>
                <div>
                  <input value={user.name} disabled={!canManageUsers} aria-label="Benutzername" onChange={(event) => updateUser(user.id, { name: event.target.value })} />
                  <input value={user.email} disabled={!canManageUsers} type="email" aria-label="Benutzer-E-Mail" placeholder="E-Mail" onChange={(event) => updateUser(user.id, { email: event.target.value })} />
                  <small>Letzte Aktivität: {formatDate(user.lastActiveAt, true)}</small>
                </div>
                <select value={user.role} disabled={!canManageUsers} onChange={(event) => updateUser(user.id, { role: event.target.value as ManagementRole })}>
                  <option value="admin">Administration</option>
                  <option value="editor">Bearbeitung</option>
                  <option value="viewer">Nur lesen</option>
                </select>
                <Toggle label={user.active ? "Aktiv" : "Inaktiv"} checked={user.active} disabled={!canManageUsers || user.id === management.currentUserId} onChange={(active) => updateUser(user.id, { active })} />
              </article>
            ))}
          </div>
          <div className="new-user-form">
            <h4>Benutzer anlegen</h4>
            <Field label="Name" value={newUser.name} disabled={!canManageUsers} onChange={(name) => setNewUser((current) => ({ ...current, name }))} />
            <Field label="E-Mail" type="email" value={newUser.email} disabled={!canManageUsers} onChange={(email) => setNewUser((current) => ({ ...current, email }))} />
            <SelectField label="Rolle" value={newUser.role} disabled={!canManageUsers} options={[["admin", "Administration"], ["editor", "Bearbeitung"], ["viewer", "Nur lesen"]]} onChange={(role) => setNewUser((current) => ({ ...current, role: role as ManagementRole }))} />
            <button type="button" className="primary" disabled={!canManageUsers || !newUser.name.trim()} onClick={addUser}>Benutzer anlegen</button>
          </div>
        </div>
      ) : null}

      {section === "audit" ? (
        <div className="management-panel">
          <header>
            <div>
              <span className="eyebrow">Nachvollziehbarkeit</span>
              <h3>Aktivitätsprotokoll</h3>
              <p>Bis zu 1.000 Verwaltungsaktionen werden lokal mit Benutzer und Zeitpunkt gespeichert.</p>
            </div>
            <input type="search" placeholder="Aktivitäten durchsuchen" value={auditQuery} onChange={(event) => setAuditQuery(event.target.value)} />
          </header>
          <div className="audit-list">
            {auditEntries.map((entry) => {
              const user = management.users.find((item) => item.id === entry.userId);
              return (
                <article key={entry.id}>
                  <time>{formatDate(entry.at, true)}</time>
                  <div><b>{entry.action}</b><span>{entry.description}</span></div>
                  <strong>{user?.name ?? "Unbekannt"}</strong>
                  <small>{entry.targetType} · {entry.targetId}</small>
                </article>
              );
            })}
            {!auditEntries.length ? <div className="management-empty">Keine passenden Aktivitäten.</div> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
