import {
  choosePromotionImage,
  choosePromotionListing,
  normalizePromotionLibrary,
} from "./promotion-images.mjs";
import { MAX_UPLOAD_LOGS } from "./listing-rules.mjs";
import { normalizeWorkflowStatus, WORKFLOW_STATUS } from "./workflow-status.mjs";

export const BATCH_UPLOAD_LOG_LIMIT = MAX_UPLOAD_LOGS;
export const ESTIMATED_SECONDS_PER_LISTING = 35;
const ACTIVE_UPLOAD_JOB_IDS = new Set();
const COMPLETED_UPLOAD_JOB_IDS = new Set();
const COMPLETED_JOB_LIMIT = 10_000;

function projectAddress(project) {
  const street = [project.street, project.houseNumber].filter(Boolean).join(" ");
  const place = [project.zip, project.city].filter(Boolean).join(" ");
  return [street, place].filter(Boolean).join(", ") || project.name;
}

export function createUploadJobId(project, listing, promotionImageId = "") {
  return [
    "upload",
    String(project?.id || ""),
    String(listing?.id || ""),
    String(listing?.externalId || ""),
    String(listing?.version || 1),
    String(promotionImageId || "normal"),
  ].join(":");
}

function rememberCompletedJob(jobId) {
  COMPLETED_UPLOAD_JOB_IDS.add(jobId);
  if (COMPLETED_UPLOAD_JOB_IDS.size <= COMPLETED_JOB_LIMIT) return;
  const oldest = COMPLETED_UPLOAD_JOB_IDS.values().next().value;
  if (oldest) COMPLETED_UPLOAD_JOB_IDS.delete(oldest);
}

export function resetBatchJobRegistryForTests() {
  ACTIVE_UPLOAD_JOB_IDS.clear();
  COMPLETED_UPLOAD_JOB_IDS.clear();
}

export function createBatchUploadPlan(state, projectIds, options = {}) {
  const selectedIds = new Set(Array.isArray(projectIds) ? projectIds : []);
  const excludedListingIds = new Set(options.excludedListingIds || []);
  const promotionOverrides = options.promotionOverrides || {};
  const library = normalizePromotionLibrary(state);
  const publishedJobs = new Set((state.uploadHistory || [])
    .filter((log) => {
      const status = normalizeWorkflowStatus(log.status);
      return status === WORKFLOW_STATUS.PUBLISHED
        || status === WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT;
    })
    .map((log) => String(log.jobId || ""))
    .filter(Boolean));
  const plannedListingIds = new Set();
  const plannedExternalIds = new Set();
  const addresses = [];
  for (const project of state.projects || []) {
    if (!selectedIds.has(project.id)) continue;
    const pendingRotationSourceIds = new Set((project.listings || [])
      .filter((listing) => listing.listingOrigin === "rotation-copy" && listing.rotationSourceListingId && !listing.lastUploadedAt)
      .map((listing) => listing.rotationSourceListingId));
    const listings = (project.listings || []).filter((listing) =>
      !excludedListingIds.has(listing.id)
      && !listing.rotationArchivedAt
      && !pendingRotationSourceIds.has(listing.id));
    const override = library.promotionSettings.manualSelection
      ? promotionOverrides[project.id] || {}
      : {};
    const actionImage = choosePromotionImage(library, {
      projectId: project.id,
      imageId: override.imageId,
      random: options.random,
    });
    const actionListing = actionImage
      ? choosePromotionListing({ ...project, listings }, library.promotionUsage, override.listingId)
      : null;
    const skippedReasons = [];
    const items = [];
    for (const listing of listings) {
      const promotionImageId = listing.id === actionListing?.id ? actionImage?.id || "" : "";
      const jobId = createUploadJobId(project, listing, promotionImageId);
      if (plannedListingIds.has(listing.id) || (listing.externalId && plannedExternalIds.has(listing.externalId))) {
        skippedReasons.push("Eine doppelte Inserats- oder Objektnummer wurde aus der Warteschlange entfernt.");
        continue;
      }
      plannedListingIds.add(listing.id);
      if (listing.externalId) plannedExternalIds.add(listing.externalId);
      if (!options.includePublishedJobs && publishedJobs.has(jobId)) {
        skippedReasons.push("Ein bereits erfolgreich abgeschlossener Upload-Job wurde idempotent übersprungen.");
        continue;
      }
      items.push({
        jobId,
        projectId: project.id,
        projectName: project.name,
        address: projectAddress(project),
        listingId: listing.id,
        externalId: listing.externalId,
        templateId: listing.templateId,
        templateName: listing.templateName,
        promotionImageId,
        status: WORKFLOW_STATUS.DRAFT,
        statusMessage: "Bereit",
        error: "",
      });
    }
    addresses.push({
      projectId: project.id,
      projectName: project.name,
      address: projectAddress(project),
      listingCount: items.length,
      houseVariants: items.map((item) => item.templateName),
      promotionImageId: actionImage?.id || "",
      promotionListingId: actionListing?.id || "",
      status: items.length ? WORKFLOW_STATUS.DRAFT : WORKFLOW_STATUS.BLOCKED,
      statusMessage: items.length ? "Bereit" : "Übersprungen",
      error: items.length ? skippedReasons.join(" · ") : skippedReasons.join(" · ") || "Für diese Adresse sind keine ausgewählten Inserate vorhanden.",
      items,
    });
  }
  const totalListings = addresses.reduce((sum, address) => sum + address.items.length, 0);
  return {
    id: String(options.id || globalThis.crypto.randomUUID()),
    createdAt: String(options.now || new Date().toISOString()),
    addresses,
    totalAddresses: addresses.length,
    totalListings,
    estimatedSeconds: totalListings * ESTIMATED_SECONDS_PER_LISTING,
  };
}

export async function runSequentialBatchUpload(plan, worker, hooks = {}) {
  const results = [];
  let processed = 0;
  let successful = 0;
  let failed = 0;
  for (let addressIndex = 0; addressIndex < plan.addresses.length; addressIndex += 1) {
    const address = plan.addresses[addressIndex];
    if (!address.items.length) {
      hooks.onAddressSkipped?.(address, addressIndex);
      continue;
    }
    hooks.onAddressStart?.(address, addressIndex);
    for (let listingIndex = 0; listingIndex < address.items.length; listingIndex += 1) {
      const item = address.items[listingIndex];
      if (ACTIVE_UPLOAD_JOB_IDS.has(item.jobId) || COMPLETED_UPLOAD_JOB_IDS.has(item.jobId)) {
        processed += 1;
        failed += 1;
        const result = {
          ...item,
          ok: false,
          error: ACTIVE_UPLOAD_JOB_IDS.has(item.jobId)
            ? "Dieser Upload-Job wird bereits verarbeitet."
            : "Dieser Upload-Job wurde bereits erfolgreich abgeschlossen.",
          errorCode: ACTIVE_UPLOAD_JOB_IDS.has(item.jobId) ? "DUPLICATE_ACTIVE_JOB" : "JOB_ALREADY_COMPLETED",
        };
        results.push(result);
        hooks.onItemComplete?.({ result, processed, successful, failed });
        continue;
      }
      ACTIVE_UPLOAD_JOB_IDS.add(item.jobId);
      hooks.onItemStart?.({
        address,
        item,
        addressIndex,
        listingIndex,
        processed,
        successful,
        failed,
      });
      try {
        const value = await worker({ address, item, addressIndex, listingIndex });
        processed += 1;
        successful += 1;
        const result = { ...item, ok: true, error: "", value };
        rememberCompletedJob(item.jobId);
        results.push(result);
        hooks.onItemComplete?.({ result, processed, successful, failed });
      } catch (error) {
        processed += 1;
        failed += 1;
        const message = error instanceof Error ? error.message : String(error || "Unbekannter Uploadfehler");
        const result = { ...item, ok: false, error: message };
        results.push(result);
        hooks.onItemComplete?.({ result, processed, successful, failed });
      } finally {
        ACTIVE_UPLOAD_JOB_IDS.delete(item.jobId);
      }
    }
    hooks.onAddressComplete?.(address, addressIndex);
  }
  return {
    planId: plan.id,
    total: plan.totalListings,
    processed,
    successful,
    failed,
    results,
  };
}

export function createBatchUploadLog(project, listing, result, options = {}) {
  const timestamp = String(options.now || new Date().toISOString());
  const intervalDays = Math.max(1, Math.trunc(Number(options.updateIntervalDays) || 12));
  return {
    id: String(options.id || globalThis.crypto.randomUUID()),
    jobId: String(options.jobId || createUploadJobId(project, listing, options.promotionImageId)),
    batchId: String(options.batchId || ""),
    projectId: project.id,
    address: projectAddress(project),
    listingId: listing.id,
    externalId: listing.externalId,
    houseVariant: listing.templateName,
    promotionImageId: String(options.promotionImageId || ""),
    createdAt: String(listing.createdAt || project.createdAt || timestamp),
    updatedAt: timestamp,
    nextUpdatedAt: result.importConfirmed === true
      ? new Date(Date.parse(timestamp) + intervalDays * 86400000).toISOString()
      : "",
    status: result.ok ? WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT : WORKFLOW_STATUS.FAILED,
    statusMessage: result.ok ? "Übertragen · Importbestätigung ausstehend" : "Upload fehlgeschlagen",
    error: result.ok ? "" : String(result.error || "Unbekannter Uploadfehler"),
  };
}
