"use client";

import type {
  BusinessRole,
  ManagementRole,
  ManagementUser,
  StudioState,
  VisibilityScope,
} from "../types";

export type CloudSession = {
  id: string;
  email: string;
  name: string;
  role: ManagementRole;
  businessRole?: BusinessRole;
  visibilityScope?: VisibilityScope;
  organizationUnitIds?: string[];
};

export type CloudWorkspaceSnapshot = {
  state: StudioState;
  revision: number;
  savedAt: string;
  savedBy: string;
  session: CloudSession;
};

type CloudWorkspaceResponse = {
  error?: string;
  session?: CloudSession;
  workspace?: {
    state: StudioState;
    revision: number;
    savedAt: string;
    savedBy: string;
  } | null;
  conflict?: {
    state: StudioState;
    revision: number;
    savedAt: string;
  };
};

type AssetCarrier = {
  name?: string;
  mimeType?: string;
  dataUrl?: string;
  storageKey?: string;
  assetFingerprint?: string;
};

export class CloudWorkspaceError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export class CloudWorkspaceConflictError extends CloudWorkspaceError {
  constructor(
    message: string,
    public readonly latestRevision: number,
  ) {
    super(message, 409);
  }
}

function clonedState(state: StudioState): StudioState {
  return structuredClone(state);
}

function assetCarriers(state: StudioState): AssetCarrier[] {
  return [
    ...state.houses.flatMap((house) => house.images),
    ...(state.promotionImages ?? []),
    ...(state.promotionImage ? [state.promotionImage] : []),
    ...state.projects.flatMap((project) => (
      project.listings.flatMap((listing) => listing.management?.media ?? [])
    )),
    ...(state.management?.files ?? []),
  ];
}

async function responsePayload(response: Response): Promise<CloudWorkspaceResponse> {
  return response.json().catch(() => ({})) as Promise<CloudWorkspaceResponse>;
}

async function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function digestHex(buffer: ArrayBuffer): Promise<string> {
  return crypto.subtle.digest("SHA-256", buffer).then((digest) => (
    Array.from(new Uint8Array(digest))
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("")
  ));
}

async function uploadAsset(
  blob: Blob,
  fingerprint: string,
  carrier: AssetCarrier,
): Promise<string> {
  const response = await fetch("/api/assets", {
    method: "POST",
    headers: {
      "Content-Type": carrier.mimeType || blob.type || "application/octet-stream",
      "x-asset-fingerprint": fingerprint,
      "x-asset-name": encodeURIComponent(carrier.name || "Datei"),
    },
    body: blob,
  });
  const payload = await response.json().catch(() => ({})) as {
    error?: string;
    asset?: { storageKey?: string };
  };
  const storageKey = payload.asset?.storageKey;
  if (!response.ok || !storageKey) {
    throw new CloudWorkspaceError(
      payload.error || "Eine Datei konnte nicht zentral gespeichert werden.",
      response.status,
    );
  }
  return storageKey;
}

async function externalizeAssets(
  source: StudioState,
  onProgress?: (message: string) => void,
): Promise<{ state: StudioState; localDataByKey: Map<string, string> }> {
  const state = clonedState(source);
  const carriers = assetCarriers(state);
  const localDataByKey = new Map<string, string>();
  const uploadsByFingerprint = new Map<string, Promise<string>>();
  let processed = 0;
  let cursor = 0;

  for (const carrier of carriers) {
    const dataUrl = carrier.dataUrl?.trim() ?? "";
    if (!dataUrl.startsWith("data:")) {
      if (carrier.storageKey) carrier.dataUrl = "";
    }
  }
  const mediaCarriers = carriers.filter((carrier) => carrier.dataUrl?.trim().startsWith("data:"));

  const workers = Array.from(
    { length: Math.min(5, mediaCarriers.length) },
    async () => {
      while (cursor < mediaCarriers.length) {
        const carrier = mediaCarriers[cursor];
        cursor += 1;
        const dataUrl = carrier.dataUrl!.trim();
        const blob = await fetch(dataUrl).then((response) => response.blob());
        const fingerprint = await digestHex(await blob.arrayBuffer());
        let storageKey = carrier.storageKey;
        if (!storageKey || carrier.assetFingerprint !== fingerprint) {
          let upload = uploadsByFingerprint.get(fingerprint);
          if (!upload) {
            upload = uploadAsset(blob, fingerprint, carrier);
            uploadsByFingerprint.set(fingerprint, upload);
          }
          storageKey = await upload;
        }

        carrier.storageKey = storageKey;
        carrier.assetFingerprint = fingerprint;
        carrier.dataUrl = "";
        localDataByKey.set(storageKey, dataUrl);
        processed += 1;
        if (
          processed === 1
          || processed % 10 === 0
          || processed === mediaCarriers.length
        ) {
          onProgress?.(`${processed}/${mediaCarriers.length} Medien für die Cloud vorbereitet`);
        }
      }
    },
  );
  await Promise.all(workers);

  return { state, localDataByKey };
}

async function hydrateAssets(
  source: StudioState,
  knownData = new Map<string, string>(),
  onProgress?: (message: string) => void,
): Promise<StudioState> {
  const state = clonedState(source);
  const carriers = assetCarriers(state);
  const keys = Array.from(new Set(
    carriers.map((carrier) => carrier.storageKey).filter(Boolean) as string[],
  ));
  const dataByKey = new Map(knownData);
  let completed = 0;
  let cursor = 0;

  const workers = Array.from({ length: Math.min(6, keys.length) }, async () => {
    while (cursor < keys.length) {
      const key = keys[cursor];
      cursor += 1;
      if (!dataByKey.has(key)) {
        const response = await fetch(`/api/assets?key=${encodeURIComponent(key)}`);
        if (!response.ok) {
          const payload = await response.json().catch(() => ({})) as { error?: string };
          throw new CloudWorkspaceError(
            payload.error || "Eine zentrale Datei konnte nicht geladen werden.",
            response.status,
          );
        }
        dataByKey.set(key, await blobDataUrl(await response.blob()));
      }
      completed += 1;
      if (completed === 1 || completed % 10 === 0 || completed === keys.length) {
        onProgress?.(`${completed}/${keys.length} Cloud-Dateien geladen`);
      }
    }
  });
  await Promise.all(workers);

  for (const carrier of carriers) {
    if (carrier.storageKey) {
      carrier.dataUrl = dataByKey.get(carrier.storageKey) ?? "";
    }
  }
  return state;
}

export async function loadCloudWorkspace(
  onProgress?: (message: string) => void,
): Promise<{ snapshot: CloudWorkspaceSnapshot | null; session: CloudSession }> {
  const response = await fetch("/api/workspace", {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const payload = await responsePayload(response);
  if (!response.ok || !payload.session) {
    throw new CloudWorkspaceError(
      payload.error || "Der gemeinsame Arbeitsbereich ist nicht erreichbar.",
      response.status,
    );
  }
  if (!payload.workspace) return { snapshot: null, session: payload.session };

  onProgress?.("Gemeinsamer Arbeitsstand wird geladen");
  return {
    session: payload.session,
    snapshot: {
      ...payload.workspace,
      state: await hydrateAssets(payload.workspace.state, new Map(), onProgress),
      session: payload.session,
    },
  };
}

export async function saveCloudWorkspace(
  source: StudioState,
  baseRevision: number,
  options: {
    force?: boolean;
    onProgress?: (message: string) => void;
  } = {},
): Promise<CloudWorkspaceSnapshot> {
  const prepared = await externalizeAssets(source, options.onProgress);
  const response = await fetch("/api/workspace", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      state: prepared.state,
      baseRevision,
      force: options.force === true,
    }),
  });
  const payload = await responsePayload(response);
  if (response.status === 409) {
    throw new CloudWorkspaceConflictError(
      payload.error || "Es liegt eine neuere Cloud-Version vor.",
      payload.conflict?.revision ?? baseRevision,
    );
  }
  if (!response.ok || !payload.workspace || !payload.session) {
    throw new CloudWorkspaceError(
      payload.error || "Der gemeinsame Arbeitsstand konnte nicht gespeichert werden.",
      response.status,
    );
  }

  return {
    ...payload.workspace,
    state: await hydrateAssets(
      payload.workspace.state,
      prepared.localDataByKey,
      options.onProgress,
    ),
    session: payload.session,
  };
}

export function bindSessionToState(
  source: StudioState,
  session: CloudSession,
): StudioState {
  if (!source.management) return source;
  const state = clonedState(source);
  const management = state.management!;
  const normalizedEmail = session.email.trim().toLowerCase();
  let user = management.users.find((candidate) => (
    candidate.email.trim().toLowerCase() === normalizedEmail
  ));

  if (!user && session.role === "admin") {
    user = management.users.find((candidate) => (
      candidate.role === "admin" && !candidate.email.trim()
    ));
  }
  if (!user) {
    const createdAt = new Date().toISOString();
    user = {
      id: `user-${session.id}`,
      name: session.name,
      email: normalizedEmail,
      role: session.role,
      businessRole: session.businessRole
        ?? (session.role === "admin" ? "administrator" : "sales-representative"),
      visibilityScope: session.visibilityScope
        ?? (session.role === "admin" ? "organization" : "self"),
      organizationUnitIds: session.organizationUnitIds?.length
        ? session.organizationUnitIds
        : ["unit-company"],
      customVisibleUserIds: [],
      active: true,
      createdAt,
    } satisfies ManagementUser;
    management.users.push(user);
    management.fileFolders.push({
      id: `folder-personal-${user.id}`,
      name: user.name,
      scope: "personal",
      ownerUserId: user.id,
      accessUserIds: [user.id],
      createdAt,
    });
  }

  user.name = session.name || user.name;
  user.email = normalizedEmail;
  user.role = session.role;
  if (session.businessRole) user.businessRole = session.businessRole;
  if (session.visibilityScope) user.visibilityScope = session.visibilityScope;
  if (session.organizationUnitIds?.length) {
    user.organizationUnitIds = session.organizationUnitIds;
  }
  user.active = true;
  user.lastActiveAt = new Date().toISOString();
  management.currentUserId = user.id;
  return state;
}

export function mergeCloudAssetReferences(
  localState: StudioState,
  cloudState: StudioState,
): StudioState {
  const localCarriers = assetCarriers(localState);
  const cloudCarriers = assetCarriers(cloudState);
  const changed = localCarriers.some((carrier, index) => (
    carrier.storageKey !== cloudCarriers[index]?.storageKey
    || carrier.assetFingerprint !== cloudCarriers[index]?.assetFingerprint
  ));
  if (!changed) return localState;

  const merged = clonedState(localState);
  assetCarriers(merged).forEach((carrier, index) => {
    carrier.storageKey = cloudCarriers[index]?.storageKey;
    carrier.assetFingerprint = cloudCarriers[index]?.assetFingerprint;
  });
  return merged;
}

export const CLOUD_STORAGE_LABEL = "Gemeinsamer Cloud-Arbeitsbereich";
