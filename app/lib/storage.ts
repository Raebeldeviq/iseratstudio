import type { StudioState } from "../types";

const DB_NAME = "fabian-pascal-inseratestudio-v1";
const STORE_NAME = "fabian-pascal-state";
const LEGACY_DB_NAME = "livinghaus-inseratstudio-v1";
const LEGACY_STORE_NAME = "livinghaus-state";
const STATE_KEY = "primary";

export const STORAGE_ID = `${DB_NAME}/${STORE_NAME}`;

export type StudioSnapshot = {
  state: StudioState;
  savedAt: string;
  source: "browser" | "legacy";
};

type StoredEnvelope = {
  format: 1;
  savedAt: string;
  state: StudioState;
};

function openDatabase(databaseName: string, storeName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function readRecord(databaseName: string, storeName: string): Promise<unknown> {
  return openDatabase(databaseName, storeName).then((db) => new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).get(STATE_KEY);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  }));
}

function decodeRecord(value: unknown): { state: StudioState; savedAt: string } | null {
  const envelope = value as Partial<StoredEnvelope> | undefined;
  if (
    envelope?.format === 1
    && typeof envelope.savedAt === "string"
    && envelope.state?.version === 1
    && Array.isArray(envelope.state.houses)
  ) {
    return { state: envelope.state, savedAt: envelope.savedAt };
  }
  const legacyState = value as StudioState | undefined;
  if (legacyState?.version === 1 && Array.isArray(legacyState.houses)) {
    return { state: legacyState, savedAt: "" };
  }
  return null;
}

export async function loadStudioSnapshot(): Promise<StudioSnapshot | null> {
  const current = decodeRecord(await readRecord(DB_NAME, STORE_NAME));
  if (current) return { ...current, source: "browser" };

  const legacy = decodeRecord(await readRecord(LEGACY_DB_NAME, LEGACY_STORE_NAME));
  if (!legacy) return null;
  const savedAt = new Date().toISOString();
  await saveStudioState(legacy.state, savedAt);
  return { state: legacy.state, savedAt, source: "legacy" };
}

export async function loadStudioState(): Promise<StudioState | null> {
  return (await loadStudioSnapshot())?.state ?? null;
}

export async function saveStudioState(
  state: StudioState,
  savedAt = new Date().toISOString(),
): Promise<void> {
  const db = await openDatabase(DB_NAME, STORE_NAME);
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const envelope: StoredEnvelope = { format: 1, savedAt, state };
    transaction.objectStore(STORE_NAME).put(envelope, STATE_KEY);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function clearStudioState(): Promise<void> {
  const db = await openDatabase(DB_NAME, STORE_NAME);
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(STATE_KEY);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
  });
}
