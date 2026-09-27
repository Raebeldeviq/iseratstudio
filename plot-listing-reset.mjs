import { createListingGroup, normalizeListingGroup } from "./listing-groups.mjs";
import { activeWorkingListingCount } from "./active-listings.mjs";

function text(value) {
  return String(value ?? "").trim();
}

function clone(value) {
  return structuredClone(value);
}

export function latestResetListingFacts(state, projectIdValue, templateIdValue) {
  const projectId = text(projectIdValue);
  const templateId = text(templateIdValue);
  if (!projectId || !templateId) return [];
  const history = Array.isArray(state?.listingResetHistory) ? state.listingResetHistory : [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const archive = history[index];
    if (text(archive?.projectId) !== projectId) continue;
    const listing = [...(archive?.listings || [])]
      .reverse()
      .find((candidate) => text(candidate?.templateId) === templateId
        && Array.isArray(candidate?.listingFacts)
        && candidate.listingFacts.length > 0);
    if (listing) return clone(listing.listingFacts);
  }
  return [];
}

function resetHouseDistribution(distribution, projectIds, now) {
  if (!distribution || typeof distribution !== "object") return distribution;
  const ids = new Set(projectIds);
  return {
    ...distribution,
    projects: (distribution.projects || []).map((record) => ids.has(text(record?.projectId))
      ? {
          ...record,
          activeHouseIds: [],
          previewHouseIds: [],
          pinnedHouseIds: [],
          excludedHouseIds: [],
          updatedAt: now,
        }
      : record),
    updatedAt: now,
  };
}

export function resetPlotListings(state, plotIdValue, options = {}) {
  const plotId = text(plotIdValue);
  if (!plotId) throw new Error("Für den Inserat-Reset fehlt die Grundstücks-ID.");
  const plot = (state?.plots || []).find((candidate) => text(candidate?.id) === plotId);
  if (!plot) throw new Error("Das Grundstück für den Inserat-Reset wurde nicht gefunden.");

  const now = String(options.now || new Date().toISOString());
  const idFactory = options.idFactory || (() => globalThis.crypto.randomUUID());
  const linkedProjects = (state?.projects || []).filter((project) => text(project?.plotId) === plotId);
  const archived = [];
  const resetListingIds = [];
  const resetProjectIds = [];
  let activeListingCount = 0;

  const projects = (state?.projects || []).map((project) => {
    if (text(project?.plotId) !== plotId) return project;
    const listingGroup = normalizeListingGroup(project.listingGroup, project.id, { now });
    const listings = Array.isArray(project.listings) ? project.listings : [];
    const hasWorkingState = listings.length > 0
      || listingGroup.variants.some((variant) => variant?.active || variant?.listing)
      || listingGroup.listingControls.length > 0;
    if (!hasWorkingState) return project;

    const resetId = idFactory();
    activeListingCount += activeWorkingListingCount(project, listingGroup);
    resetListingIds.push(...listings.map((listing) => text(listing?.id)).filter(Boolean));
    resetProjectIds.push(project.id);
    archived.push({
      id: resetId,
      kind: "plot-listing-reset",
      resetAt: now,
      plotId,
      projectId: project.id,
      listingCount: listings.length,
      listingIds: listings.map((listing) => text(listing?.id)).filter(Boolean),
      listings: clone(listings),
      listingGroup: clone(listingGroup),
    });

    return {
      ...project,
      selectedHouseIds: [],
      listings: [],
      listingGroup: createListingGroup(project.id, { now, idFactory }),
    };
  });

  if (!archived.length) {
    return {
      state,
      changed: false,
      plot,
      linkedProjectCount: linkedProjects.length,
      activeListingCount: 0,
      resetListingIds: [],
      archiveIds: [],
    };
  }

  return {
    state: {
      ...state,
      projects,
      listingResetHistory: [...(state?.listingResetHistory || []), ...archived],
      houseDistribution: resetHouseDistribution(state?.houseDistribution, resetProjectIds, now),
    },
    changed: true,
    plot,
    linkedProjectCount: linkedProjects.length,
    activeListingCount,
    resetListingIds: [...new Set(resetListingIds)],
    archiveIds: archived.map((entry) => entry.id),
  };
}
