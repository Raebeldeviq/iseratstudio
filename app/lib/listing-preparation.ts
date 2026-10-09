import { assignNewInteriorListings } from "../../interior-sets.mjs";
import { isDraftListing, mergeListingCollection } from "../../listing-catalog-view.mjs";
import { initializeListingStaticCopy, fillMissingProjectingDefaults } from "../../listing-copy.mjs";
import { normalizeWorkflowStatus, WORKFLOW_STATUS } from "../../workflow-status.mjs";
import { isHvObjectNumber } from "../../object-number-sequence.mjs";
import { commitHouseDistributionPreviews, HOUSES_PER_PROJECT } from "../../house-distribution.mjs";
import { allocateDeleteBatchNumber, linkDeleteBatchListings } from "../../delete-batches.mjs";
import { addressRotationStatus, snapshotAddressRotation } from "../../address-rotation.mjs";
import { normalizeListingGroup, addListingGroupVariant, setListingGroupVariantActive, assignListingGroupVariant } from "../../listing-groups.mjs";
import { latestResetListingFacts } from "../../plot-listing-reset.mjs";
import { completeListingTexts, totalPrice } from "./text-generator.ts";
import type { GeneratedListing, HouseTemplate, ProjectInput, ProviderSettings, HouseDistributionState, ListingGroup, StudioState } from "../types";
const uid = () => crypto.randomUUID();
export function createVariantListing(
  house: HouseTemplate,
  project: ProjectInput,
  provider: ProviderSettings,
  variantId: string,
  order: number,
  previous?: GeneratedListing | null,
  allocatedExternalId = "",
  preservedListingFacts: GeneratedListing["listingFacts"] = [],
): GeneratedListing {
  // Bestehende Texte bleiben Bestandsdaten. Eine Neugenerierung erfolgt nur
  // auf ausdrückliche Nutzeraktion und nie während der Normalisierung.
  if (previous && !isDraftListing(previous)) return { ...previous };
  const version = Math.max(1, previous?.version || 1);
  const persistedExternalId = String(previous?.externalId || "").trim();
  const externalId = isHvObjectNumber(persistedExternalId)
    ? persistedExternalId
    : String(allocatedExternalId || "").trim();
  if (!isHvObjectNumber(externalId)) {
    throw new Error("Für das neue Inserat fehlt eine gültige externe Objektnummer 30460-N.");
  }
  return initializeListingStaticCopy({
    ...previous,
    id: previous?.id || uid(),
    externalId,
    templateId: house.id,
    templateName: house.name,
    price: totalPrice(house, project),
    listingFacts: previous?.listingFacts || preservedListingFacts,
    texts: completeListingTexts(
      house,
      project,
      provider,
      previous?.texts,
      version,
    ),
    version,
    status: normalizeWorkflowStatus(previous?.status, WORKFLOW_STATUS.DRAFT),
    statusMessage: previous?.statusMessage || "Entwurf",
    projectingSettings: fillMissingProjectingDefaults(previous?.projectingSettings),
    listingGroupVariantId: variantId,
    listingOrigin: previous?.listingOrigin || "group-source",
  }) as GeneratedListing;
}

export function existingOrAllocatedExternalId(
  previous: GeneratedListing | null | undefined,
  allocate: (position: number, projectId: string) => string,
  position: number,
  projectId: string,
): string {
  const existing = String(previous?.externalId || "").trim();
  if (previous && !isDraftListing(previous)) return existing;
  return isHvObjectNumber(existing) ? existing : allocate(position, projectId);
}


export function prepareProjectListings(
  state: StudioState,
  projectIds: string[],
  distribution: HouseDistributionState,
  enrich: (project: ProjectInput) => ProjectInput = project => project,
  options: { initialPoolAOnly?: boolean; now?: string } = {},
) {
  const committed = commitHouseDistributionPreviews(
    distribution,
    state.houses,
    state.projects,
    projectIds,
  );
  if (!committed.ok) {
    throw new Error(`Vorbereitung blockiert: ${committed.issues.join(" · ")}`);
  }
  let stateWithObjectNumbers = state;
  const allocateExternalId = (position: number, projectId: string) => {
    const allocation = allocateDeleteBatchNumber(stateWithObjectNumbers, { housePosition: position, projectId });
    stateWithObjectNumbers = allocation.state as StudioState;
    return allocation.externalId;
  };
  const issues: string[] = [];
  let preparedListings = 0;
  const projects = state.projects.map((project) => {
    if (!projectIds.includes(project.id)) return project;
    const rotationStatus = project.plotId ? addressRotationStatus(state, project.plotId, options) : null;
    const rotationPlot = rotationStatus && rotationStatus.state === "ready"
      ? state.plots?.find((plot) => plot.id === project.plotId) : null;
    const rotationAddress = rotationStatus?.nextPool === "B"
      ? rotationPlot?.addressRotation?.poolB : rotationPlot?.addressRotation?.poolA;
    const projectForCycle = rotationAddress
      ? enrich({ ...project, street: rotationAddress.street, houseNumber: rotationAddress.houseNumber,
        zip: rotationAddress.postalCode, city: rotationAddress.city, district: "", federalState: "", county: "" })
      : project;
    let group = normalizeListingGroup(project.listingGroup, project.id) as ListingGroup;
    const templateIds = committed.distribution.projects
      .find((record: { projectId: string }) => record.projectId === project.id)
      ?.activeHouseIds || [];
    if (templateIds.length !== HOUSES_PER_PROJECT) {
      issues.push(`${project.name}: keine vollständige Vierer-Kombination`);
      return project;
    }
    while (group.variants.length < HOUSES_PER_PROJECT) {
      group = addListingGroupVariant(group) as ListingGroup;
    }
    for (let index = HOUSES_PER_PROJECT; index < group.variants.length; index += 1) {
      group = setListingGroupVariantActive(group, group.variants[index].id, false) as ListingGroup;
    }
    for (let index = 0; index < HOUSES_PER_PROJECT; index += 1) {
      const house = state.houses.find((item) => item.id === templateIds[index] && item.approved !== false);
      if (!house) {
        issues.push(`${project.name}: Haustyp ${templateIds[index]} fehlt oder ist nicht freigegeben`);
        continue;
      }
      const variant = group.variants[index];
      const previous = rotationAddress ? null : project.listings.find((listing) =>
        listing.templateId === house.id && listing.listingOrigin !== "rotation-copy")
        || (variant.templateId === house.id ? variant.listing : null)
        || null;
      group = assignListingGroupVariant(
        group,
        index + 1,
        house,
        createVariantListing(
          house,
          projectForCycle,
          state.provider,
          variant.id,
          index + 1,
          previous,
          existingOrAllocatedExternalId(previous, allocateExternalId, index + 1, project.id),
          latestResetListingFacts(state, project.id, house.id),
        ),
      ) as ListingGroup;
    }
    const sourceListings = group.variants
      .filter((variant) => variant.active && variant.listing)
      .slice(0, HOUSES_PER_PROJECT)
      .map((variant) => variant.listing as GeneratedListing);
    const mergedListings = mergeListingCollection(project.listings, sourceListings);
    preparedListings += sourceListings.length;
    return {
      ...projectForCycle,
      selectedHouseIds: group.variants
        .filter((variant) => variant.active && variant.templateId)
        .slice(0, HOUSES_PER_PROJECT)
        .map((variant) => variant.templateId),
      listings: mergedListings,
      listingGroup: group,
    };
  });
  let preparedState = linkDeleteBatchListings({
    ...stateWithObjectNumbers,
    projects,
    houseDistribution: committed.distribution as HouseDistributionState,
  }) as StudioState;
  for (const projectId of projectIds) {
    const project = preparedState.projects.find((item) => item.id === projectId);
    if (!project?.plotId || !preparedState.plots?.find((plot) => plot.id === project.plotId)?.addressRotation) continue;
    const activeListings = project.listingGroup?.variants.filter((variant) => variant.active && variant.listing)
      .slice(0, HOUSES_PER_PROJECT).map((variant) => variant.listing as GeneratedListing) || [];
    const cycle = snapshotAddressRotation(preparedState, project.plotId, activeListings, options.now, options);
    const byId = new Map<string, GeneratedListing>(cycle.listings.map((listing: GeneratedListing) => [listing.id, listing]));
    preparedState = {
      ...preparedState,
      plots: preparedState.plots?.map((plot) => plot.id === project.plotId ? { ...plot, addressRotation: cycle.rotation } : plot),
      projects: preparedState.projects.map((item) => item.id !== projectId ? item : {
        ...item,
        listings: item.listings.map((listing) => byId.get(listing.id) || listing),
        listingGroup: item.listingGroup ? { ...item.listingGroup,
          variants: item.listingGroup.variants.map((variant) => variant.listing && byId.has(variant.listing.id)
            ? { ...variant, listing: byId.get(variant.listing.id) as GeneratedListing } : variant) } : item.listingGroup,
      }),
    };
  }
  if (issues.length) throw new Error(issues.join(" · "));
  return { state: assignNewInteriorListings(state, preparedState) as StudioState, preparedListings, issues };
}
