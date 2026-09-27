import { normalizeWorkflowStatus, WORKFLOW_STATUS } from "./workflow-status.mjs";

const BATCH_ELIGIBLE_STATUSES = new Set([
  WORKFLOW_STATUS.DRAFT,
  WORKFLOW_STATUS.PREPARED,
]);

export function isActiveWorkingListing(listing) {
  if (!listing || typeof listing !== "object") return false;
  if (listing.rotationArchivedAt || listing.listingResetAt) return false;
  const status = normalizeWorkflowStatus(listing.status, WORKFLOW_STATUS.DRAFT);
  return ![
    WORKFLOW_STATUS.PUBLISHED,
    WORKFLOW_STATUS.FAILED,
    WORKFLOW_STATUS.ARCHIVED,
    WORKFLOW_STATUS.DELETED,
  ].includes(status);
}

export function activeWorkingListings(project) {
  return (project?.listings || []).filter(isActiveWorkingListing);
}

export function activeWorkingVariants(group) {
  return (group?.variants || []).filter((variant) =>
    variant?.active === true
    && Boolean(variant.templateId)
    && isActiveWorkingListing(variant.listing));
}

export function isBatchEligibleListing(listing) {
  return isActiveWorkingListing(listing)
    && BATCH_ELIGIBLE_STATUSES.has(
      normalizeWorkflowStatus(listing?.status, WORKFLOW_STATUS.DRAFT),
    );
}

export function batchEligibleListings(project) {
  return (project?.listings || []).filter(isBatchEligibleListing);
}

export function activeWorkingListingCount(project, group = project?.listingGroup) {
  return Math.max(
    activeWorkingListings(project).length,
    activeWorkingVariants(group).length,
  );
}
