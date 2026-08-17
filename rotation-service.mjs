import {
  houseDataIssues,
  HOUSES_PER_PROJECT,
  normalizeHouseDistribution,
  validateHousePool,
} from "./house-distribution.mjs";
import { planCreativeHouseSelection } from "./listing-creative-selection.mjs";
import { listingControl, normalizeListingGroup } from "./listing-groups.mjs";
import { PROCESS_LEASE_MS } from "./listing-rules.mjs";
import { WORKFLOW_STATUS } from "./workflow-status.mjs";

function nowIso() {
  return new Date().toISOString();
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean))];
}

export function listingRotationBlockReasons(groupValue, listing, at = nowIso(), options = {}) {
  const group = options.normalized === true
    ? groupValue
    : normalizeListingGroup(groupValue, groupValue?.projectId || listing?.projectId || "", { now: at });
  const control = listingControl(group, listing);
  const reasons = [];
  if (group.automation.rotationEnabled === false) reasons.push("Die Variantenrotation ist für diese Adresse deaktiviert.");
  if (!control.automaticUpdateEnabled) reasons.push("Automatische Aktualisierung ist für dieses Inserat deaktiviert.");
  if (control.status === WORKFLOW_STATUS.PREPARED) reasons.push("Ein vorbereiteter Entwurf wartet noch auf den bestätigten Upload.");
  if (control.updateMode === "blocked") reasons.push("Das Inserat ist im Modus „Gesperrt“.");
  if (control.premiumPlacement) reasons.push("Premium-Sperre aktiv.");
  if (control.manualLock) reasons.push("Manuelle Sperre aktiv.");
  if (listing?.rotationArchivedAt) reasons.push("Das Inserat wurde durch eine erfolgreiche Rotation intern archiviert.");
  if (control.lockedUntil && Date.parse(control.lockedUntil) > Date.parse(at)) reasons.push("Zeitlich befristete Sperre aktiv.");
  const leaseAt = Date.parse(control.processLease?.startedAt || "");
  if (
    control.processLease?.token
    && control.processLease.token !== String(options.operationToken || "")
    && Number.isFinite(leaseAt)
    && Date.parse(at) - leaseAt < PROCESS_LEASE_MS
  ) reasons.push("Das Inserat wird bereits verarbeitet.");
  if (!group.variants.some((variant) => variant.id === listing?.listingGroupVariantId && variant.active)) {
    reasons.push("Der aktive Ausgangsplatz des Inserats ist nicht mehr vorhanden.");
  }
  return [...new Set(reasons)];
}

export function listingRotationPoolBlockReasons(
  distribution,
  distributionValidation,
  project,
  group,
  listing,
) {
  const issues = [];
  const activeHouseIds = group.variants
    .filter((variant) => variant.active && variant.templateId)
    .map((variant) => String(variant.templateId));
  if (activeHouseIds.length > HOUSES_PER_PROJECT) {
    issues.push(`Für diese Adresse sind mehr als ${HOUSES_PER_PROJECT} Häuser aktiv.`);
  }
  if (uniqueStrings(activeHouseIds).length !== activeHouseIds.length) {
    issues.push("Der aktive Hauspool dieser Adresse enthält doppelte Häuser.");
  }
  if (!group.variants.some((variant) => variant.id === listing.listingGroupVariantId)) {
    issues.push("Der Ausgangsplatz des Inserats ist nicht mehr vorhanden.");
  }
  const projectDistribution = distribution.projects.find((record) => record.projectId === project.id);
  if (!projectDistribution) {
    issues.push("Für diese Adresse fehlt der zentrale Verteilungsstand.");
  }
  if (!distributionValidation.ok) issues.push(...distributionValidation.issues);
  if (projectDistribution && distributionValidation.ok) {
    const remaining = projectDistribution.activeHouseIds.filter((id) => id !== listing.templateId);
    const hasCandidate = distributionValidation.eligibleHouseIds.some((id) =>
      !remaining.includes(id)
      && !projectDistribution.excludedHouseIds.includes(id));
    if (!hasCandidate) issues.push("Im Hauspool ist kein zulässiges Ersatzhaus verfügbar.");
  }
  return [...new Set(issues)];
}

export function planListingRotation(state, projectId, listingId, options = {}) {
  const at = String(options.now || nowIso());
  const project = options.project || (state?.projects || []).find((item) => item.id === projectId);
  if (!project) return { ok: false, issues: ["Die Adresse ist nicht mehr vorhanden."], houseId: "", house: null };
  const listing = options.listing || (project.listings || []).find((item) => item.id === listingId);
  if (!listing) return { ok: false, issues: ["Das Inserat ist nicht mehr vorhanden."], houseId: "", house: null, project };
  const group = options.group || normalizeListingGroup(project.listingGroup, project.id, { now: at });
  const control = listingControl(group, listing);
  const sourceVariant = group.variants.find((variant) => variant.id === listing.listingGroupVariantId) || null;
  const distribution = options.distribution
    || normalizeHouseDistribution(state.houseDistribution, state.houses || [], state.projects || []);
  const distributionValidation = options.distributionValidation
    || validateHousePool(distribution, state.houses || [], { projects: state.projects || [], normalized: true });
  const projectDistribution = distribution.projects.find((record) => record.projectId === project.id);
  const issues = [
    ...listingRotationBlockReasons(group, listing, at, {
      normalized: true,
      operationToken: options.operationToken,
    }),
    ...listingRotationPoolBlockReasons(distribution, distributionValidation, project, group, listing),
  ];

  let houseId = String(options.explicitHouseId || "");
  let combination = [];
  let creativeHouseSelection = null;
  if (!issues.length && houseId) {
    const remaining = (projectDistribution?.activeHouseIds || [])
      .filter((id) => id !== listing.templateId);
    if (!distribution.poolHouseIds.includes(houseId)) {
      issues.push("Das manuell gewählte Haus gehört nicht zum freigegebenen Hauspool.");
    }
    if (houseId === listing.templateId || remaining.includes(houseId)) {
      issues.push("Das manuell gewählte Haus ist auf diesem Grundstück bereits aktiv.");
    }
    combination = [...remaining, houseId];
  } else if (!issues.length) {
    const remaining = (projectDistribution?.activeHouseIds || [])
      .filter((id) => id !== listing.templateId)
      .slice(0, HOUSES_PER_PROJECT - 1);
    const candidateHouseIds = distributionValidation.eligibleHouseIds.filter((id) =>
      !remaining.includes(id)
      && !projectDistribution?.excludedHouseIds.includes(id));
    creativeHouseSelection = planCreativeHouseSelection(state, {
      projectId: project.id,
      sourceHouseId: listing.templateId,
      candidateHouseIds,
      distribution,
      now: at,
    });
    if (!creativeHouseSelection.ok) issues.push(creativeHouseSelection.reason);
    houseId = creativeHouseSelection.houseId;
    combination = houseId ? [...remaining, houseId] : remaining;
  }

  const house = (state.houses || []).find((item) => item.id === houseId) || null;
  if (!issues.length) {
    if (!house) issues.push("Das ausgewählte Ersatzhaus ist nicht mehr vorhanden.");
    else issues.push(...houseDataIssues(house).map((issue) => `Ersatzhaus: ${issue}.`));
  }
  return {
    ok: issues.length === 0,
    issues: [...new Set(issues)],
    project,
    listing,
    group,
    control,
    sourceVariant,
    distribution,
    distributionValidation,
    houseId,
    house,
    combination,
    creativeHouseSelection,
  };
}
