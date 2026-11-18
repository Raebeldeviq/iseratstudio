import { assertBrowserCatalogTransition } from "./listing-catalog-view.mjs";

function text(value) {
  return String(value ?? "").trim();
}

function snapshotTime(value) {
  const timestamp = Date.parse(text(value));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function preparedHouseCount(state) {
  return (Array.isArray(state?.houses) ? state.houses : []).filter((house) =>
    Number(house?.housePrice) > 0
      || (Array.isArray(house?.images) && house.images.length > 0),
  ).length;
}

function addressedProjectCount(state) {
  return (Array.isArray(state?.projects) ? state.projects : []).filter((project) =>
    [project?.street, project?.houseNumber, project?.postalCode ?? project?.zip, project?.city]
      .some((value) => text(value)),
  ).length;
}

export function catalogSnapshotSummary(snapshot) {
  return {
    preparedHouses: preparedHouseCount(snapshot?.state),
    addressedProjects: addressedProjectCount(snapshot?.state),
  };
}

export function hasCatalogLifecycleConflict(candidate, device) {
  if (!candidate?.state || !device?.state || candidate.source === "device") return false;
  try {
    assertBrowserCatalogTransition(device.state, candidate.state);
    return false;
  } catch {
    return true;
  }
}

// A completed transfer can update the helper while earlier browser saves are
// still pending. Settle those first, then persist exactly the authoritative state.
export async function loadCatalogAfterUpload({ pendingSave, loadDeviceSnapshot, saveBrowserSnapshot, normalize = state => state }) {
  await Promise.resolve(pendingSave).catch(() => undefined);
  const snapshot = await loadDeviceSnapshot();
  if (!snapshot) {
    throw new Error("Die Transfers wurden protokolliert, aber der autoritative lokale Katalog konnte nicht neu geladen werden. Ein erneuter Lauf überspringt bereits übertragene Jobs.");
  }
  const state = normalize(snapshot.state);
  await saveBrowserSnapshot(state, snapshot.savedAt);
  return { ...snapshot, state };
}

/**
 * Selects the newest snapshot that preserves the device lifecycle evidence.
 * A browser snapshot is considered a shell only
 * for a catalog area that contains no prepared record at all. This keeps
 * normal edits timestamp-driven while protecting against a fresh browser
 * profile overwriting the durable macOS catalog.
 */
export function selectCatalogSnapshot(candidates = []) {
  const available = candidates
    .filter((candidate) => candidate?.state?.version === 1)
    .sort((left, right) => snapshotTime(right.savedAt) - snapshotTime(left.savedAt));
  const newest = available[0] || null;
  const device = available.find((candidate) => candidate.source === "device") || null;
  if (!newest || !device || newest === device || newest.source === "device") return newest;
  // A reconciled persistent catalog must not be replaced by an old browser cache.
  if (Number(device.state?.catalogIntegrityRevision || 0) > Number(newest.state?.catalogIntegrityRevision || 0)) return device;
  // A newer cache timestamp cannot roll back a proven transfer, deletion or
  // reservation. The caller backs up the rejected cache before adopting device.
  if (hasCatalogLifecycleConflict(newest, device)) return device;

  const newestSummary = catalogSnapshotSummary(newest);
  const deviceSummary = catalogSnapshotSummary(device);
  const deviceHasNewerSchema = Number(device.state?.dataSchemaVersion || 0) > Number(newest.state?.dataSchemaVersion || 0);
  const wouldEraseHouseCatalog = newestSummary.preparedHouses === 0
    && deviceSummary.preparedHouses > 0;
  const wouldEraseProjectCatalog = newestSummary.addressedProjects === 0
    && deviceSummary.addressedProjects > 0;

  return deviceHasNewerSchema || wouldEraseHouseCatalog || wouldEraseProjectCatalog ? device : newest;
}
