import {
  assignListingGroupVariant,
  claimListingOperation,
  recordListingGroupCopy,
  recordListingGroupFailure,
  releaseListingOperation,
  updateListingControl,
  validateListingGroupVariant,
} from "./listing-groups.mjs";
import { fillMissingProjectingDefaults } from "./listing-copy.mjs";
import { objectNumberForListing } from "./listing-object-number.mjs";
import {
  CREATIVE_SELECTION_FORMAT,
  planCreativeHeroSelection,
} from "./listing-creative-selection.mjs";
import { planListingRotation } from "./rotation-service.mjs";
import { WORKFLOW_STATUS } from "./workflow-status.mjs";
import {
  completeListingTexts,
  generateListingTexts,
  totalPrice,
} from "./app/lib/text-generator.ts";

function uid() {
  return globalThis.crypto.randomUUID();
}

export function collectReservedObjectNumbers(state) {
  return new Set((state.projects || []).flatMap((project) => [
    ...(project.listings || []),
    ...(project.listingGroup?.variants || []).flatMap((variant) => variant.listing ? [variant.listing] : []),
  ]).map((listing) => String(listing.externalId || "")).filter(Boolean));
}

function replaceProject(state, updatedProject) {
  return {
    ...state,
    projects: state.projects.map((project) => project.id === updatedProject.id ? updatedProject : project),
  };
}

/**
 * Erstellt genau eine lokale Rotationskopie. Die veröffentlichte Quelle wird
 * weder archiviert noch deaktiviert; sie erhält nur den Verweis auf die
 * ausstehende Kopie. Upload und Importbestätigung sind getrennte Schritte.
 */
export function prepareListingRotationInState(state, projectId, listingId, options = {}) {
  const timestamp = String(options.now || new Date().toISOString());
  const idFactory = options.idFactory || uid;
  const mode = ["full-auto", "copy-without-delete", "prepare-only"].includes(options.mode)
    ? options.mode
    : "prepare-only";
  const rotationPlan = planListingRotation(state, projectId, listingId, {
    now: timestamp,
    explicitHouseId: options.explicitHouseId || "",
    random: options.random,
    seed: options.seed,
    operationToken: options.operationToken,
  });
  if (!rotationPlan.ok) {
    return { state, ok: false, message: rotationPlan.issues.join(" · "), issues: rotationPlan.issues, copy: null };
  }

  const project = rotationPlan.project;
  const sourceListing = rotationPlan.listing;
  const house = rotationPlan.house;
  const sourceVariant = rotationPlan.sourceVariant;
  let group = rotationPlan.group;
  if (!project || !sourceListing || !house || !sourceVariant) {
    const issues = ["Das gewichtete Ersatzhaus oder der Ausgangsplatz ist nicht mehr vorhanden."];
    return { state, ok: false, message: issues[0], issues, copy: null };
  }

  const reservedObjectNumbers = collectReservedObjectNumbers(state);
  const copyId = String(options.copyId || idFactory());
  const externalId = objectNumberForListing(null, copyId, reservedObjectNumbers);
  const version = Math.max(1, Number(sourceListing.version) || 1) + 1;
  const variedTexts = generateListingTexts(house, project, state.provider, version);
  const heroSelection = planCreativeHeroSelection(state, {
    project,
    projectId: project.id,
    sourceListing,
    house,
    now: timestamp,
  });
  if (!heroSelection.ok) {
    const issues = [heroSelection.reason];
    return { state, ok: false, message: issues[0], issues, copy: null };
  }
  const creativeDiagnostics = [...new Set([
    ...(rotationPlan.creativeHouseSelection?.diagnostics || []),
    ...(heroSelection.diagnostics || []),
  ])];
  const copy = {
    ...sourceListing,
    id: copyId,
    externalId,
    templateId: house.id,
    templateName: house.name,
    price: totalPrice(house, project),
    texts: completeListingTexts(
      house,
      project,
      state.provider,
      { ...sourceListing.texts, title: variedTexts.title, description: variedTexts.description },
      version,
    ),
    version,
    projectingSettings: fillMissingProjectingDefaults(sourceListing.projectingSettings),
    listingGroupVariantId: sourceVariant.id,
    listingOrigin: "rotation-copy",
    rotationSourceListingId: sourceListing.id,
    rotationRemovedHouseId: sourceListing.templateId,
    rotationAddedHouseId: house.id,
    heroImageId: heroSelection.heroImageId,
    heroCreativeType: heroSelection.heroType,
    promotionImageId: heroSelection.promotionImageId,
    promotionAssignedAt: heroSelection.promotionImageId ? timestamp : "",
    creativeSelection: {
      format: CREATIVE_SELECTION_FORMAT,
      rotationId: copyId,
      projectId: project.id,
      plotId: String(project.plotId || ""),
      sourceListingId: sourceListing.id,
      houseId: house.id,
      heroType: heroSelection.heroType,
      heroImageId: heroSelection.heroImageId,
      promotionImageId: heroSelection.promotionImageId,
      selectedAt: timestamp,
      houseReason: rotationPlan.creativeHouseSelection?.reason || "Manuell festgelegtes Ersatzhaus.",
      heroReason: heroSelection.reason,
      houseLastUsedAt: rotationPlan.creativeHouseSelection?.globalLastUsedAt || "",
      heroLastUsedAt: heroSelection.globalLastUsedAt || "",
      diagnostics: creativeDiagnostics,
    },
    createdAt: timestamp,
    lastUploadedAt: "",
    nextUpdateAt: "",
    status: WORKFLOW_STATUS.PREPARED,
    statusMessage: "Entwurf wartet auf FTPS-Übertragung",
    uploadError: "",
  };
  const uploadJobId = String(options.uploadJobId
    || options.uploadJobIdFor?.(project, copy)
    || "");

  group = assignListingGroupVariant(group, sourceVariant.id, house, copy, { idFactory, now: timestamp });
  const variant = group.variants.find((item) => item.id === sourceVariant.id);
  const issues = validateListingGroupVariant(variant, house, {
    expectedPrice: totalPrice(house, project),
  });
  if (issues.length) {
    group = recordListingGroupFailure(group, sourceVariant.id, mode, issues, {
      idFactory,
      now: timestamp,
      sourceListing,
      preserveSourcePublication: true,
    }).group;
    return {
      state: replaceProject(state, { ...project, listingGroup: group }),
      ok: false,
      message: issues.join(" · "),
      issues,
      copy: null,
    };
  }

  const operationToken = String(options.operationToken || idFactory());
  group = claimListingOperation(group, sourceListing, operationToken, { idFactory, now: timestamp });
  group = recordListingGroupCopy(group, sourceVariant.id, copy, {
    idFactory,
    now: timestamp,
    mode,
    status: WORKFLOW_STATUS.PREPARED,
    advanceRotation: false,
    sourceStatus: WORKFLOW_STATUS.PUBLISHED,
    sourceStatusMessage: "Veröffentlicht · Rotationskopie wartet auf Importbestätigung",
    sourceListing,
    sourceListingId: sourceListing.id,
    pendingRotationJobId: uploadJobId,
    variation: `Creative-Auswahl: ${house.name} · ${heroSelection.heroType === "action" ? "Aktionsbild" : "Haus-Hero"} · Preis, Fläche, Zimmer, Energieangaben, Grundrisse und Bilder vollständig aus der Zielvariante übernommen.${creativeDiagnostics.length ? ` · ${creativeDiagnostics.join(", ")}` : ""}`,
  }).group;
  group = releaseListingOperation(group, sourceListing, operationToken, { idFactory, now: timestamp });
  group = updateListingControl(group, sourceListing, {
    status: WORKFLOW_STATUS.PUBLISHED,
    statusMessage: "Veröffentlicht · Rotationskopie wartet auf Importbestätigung",
    pendingRotationListingId: copy.id,
    pendingRotationJobId: uploadJobId,
    processLease: null,
  }, { idFactory, now: timestamp });

  const projectListings = [
    ...project.listings.filter((listing) => listing.id !== copy.id),
    copy,
  ];
  return {
    state: replaceProject(state, { ...project, listingGroup: group, listings: projectListings }),
    ok: true,
    message: `${copy.externalId} mit „${copy.templateName}“ wurde für den FTPS-Upload vorbereitet. Die veröffentlichte Quelle bleibt unverändert aktiv.`,
    issues: [],
    copy,
  };
}
