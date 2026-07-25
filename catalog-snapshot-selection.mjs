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

/**
 * Selects the newest snapshot unless a newer browser shell would erase a
 * productive device catalog. A browser snapshot is considered a shell only
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

  const newestSummary = catalogSnapshotSummary(newest);
  const deviceSummary = catalogSnapshotSummary(device);
  const wouldEraseHouseCatalog = newestSummary.preparedHouses === 0
    && deviceSummary.preparedHouses > 0;
  const wouldEraseProjectCatalog = newestSummary.addressedProjects === 0
    && deviceSummary.addressedProjects > 0;

  return wouldEraseHouseCatalog || wouldEraseProjectCatalog ? device : newest;
}
