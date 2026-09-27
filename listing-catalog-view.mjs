import { normalizeWorkflowStatus, WORKFLOW_STATUS } from './workflow-status.mjs';

export function isDraftListing(listing) {
  return normalizeWorkflowStatus(listing?.status) === WORKFLOW_STATUS.DRAFT;
}

function conflict(id) {
  const error = new Error(`Inserat ${id}: widersprüchliche Katalogversionen. Vor dem Speichern ist eine beleggestützte Bereinigung erforderlich.`);
  error.code = 'CATALOG_LISTING_CONFLICT';
  return error;
}

// A UI projection must never replace lifecycle state with a reduced variant copy.
export function mergeListingCollection(existing = [], updates = []) {
  const byId = new Map();
  for (const listing of existing) {
    if (!listing?.id) throw conflict('ohne ID');
    const previous = byId.get(listing.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(listing)) throw conflict(listing.id);
    byId.set(listing.id, listing);
  }
  for (const listing of updates) {
    if (!listing?.id) throw conflict('ohne ID');
    const previous = byId.get(listing.id);
    if (previous && previous.externalId !== listing.externalId) throw conflict(listing.id);
    byId.set(listing.id, previous && !isDraftListing(previous)
      ? previous
      : { ...previous, ...listing });
  }
  return [...byId.values()];
}

export function assertBrowserCatalogTransition(current, next) {
  if (current?.catalogRepairReview && JSON.stringify(current.catalogRepairReview) !== JSON.stringify(next?.catalogRepairReview)) throw conflict('Produktionsfreigabe');
  const protectedFields = ['externalId','listingOrigin','status','version','rotationSourceListingId',
    'lastUploadedAt','transferredAt','importConfirmedAt','importReportId','supersededByListingId',
    'replacementConfirmedAt','externalDeletionPending','productionDeleteState','deletedAt',
    'confirmationSource','legacyProviderVerifiedAt','legacyReconciliationId','manualReconciliation'];
  const archivedListing = (projectId, listingId) => (next?.listingResetHistory || [])
    .filter(archive => archive?.kind === 'plot-listing-reset' && archive.projectId === projectId)
    .flatMap(archive => archive.listings || [])
    .find(listing => listing?.id === listingId);
  for (const archive of current?.listingResetHistory || []) {
    const replacement = (next?.listingResetHistory || []).find(candidate => candidate?.id === archive?.id);
    if (!replacement || JSON.stringify(replacement) !== JSON.stringify(archive)) throw conflict(`Resetarchiv ${archive?.id || 'ohne ID'}`);
  }
  for (const project of current?.projects || []) {
    const incoming = next?.projects?.find(item => item.id === project.id);
    const unique = mergeListingCollection(incoming?.listings || []);
    for (const listing of project.listings || []) {
      if (isDraftListing(listing)) continue;
      const replacement = unique.find(item => item.id === listing.id);
      const retained = replacement || archivedListing(project.id, listing.id);
      if (!retained || protectedFields.some(field => JSON.stringify(listing[field]) !== JSON.stringify(retained[field]))) {
        throw conflict(listing.id);
      }
    }
  }
}

export function assertCatalogProductionReady(state) {
  if (state?.catalogRepairReview && (state.catalogRepairReview.automaticProductionAllowed !== true || state.catalogRepairReview.unresolved?.length)) {
    const error = new Error('Der Katalog enthält ungeklärte historische Vorgänge. Upload und Löschung bleiben bis zur beleggestützten Freigabe gesperrt.');
    error.code = 'CATALOG_REPAIR_REVIEW_REQUIRED';
    throw error;
  }
}
