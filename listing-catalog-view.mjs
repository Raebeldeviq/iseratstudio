import { assertSmartRefillTransition } from "./smart-refill.mjs";
import { normalizeWorkflowStatus, WORKFLOW_STATUS } from './workflow-status.mjs';
import { isHvObjectNumber } from './object-number-sequence.mjs';

export function isDraftListing(listing) {
  return normalizeWorkflowStatus(listing?.status) === WORKFLOW_STATUS.DRAFT;
}

function conflict(id) {
  const error = new Error(`Inserat ${id}: widersprüchliche Katalogversionen. Vor dem Speichern ist eine beleggestützte Bereinigung erforderlich.`);
  error.code = 'CATALOG_LISTING_CONFLICT';
  return error;
}

const LIFECYCLE_EVIDENCE_FIELDS = Object.freeze([
  'lastUploadedAt',
  'transferredAt',
  'importConfirmedAt',
  'importReportId',
  'rotationArchivedAt',
  'deletedAt',
  'legacyProviderVerifiedAt',
  'legacyReconciliationId',
]);

function canMigrateDraftObjectNumber(previous, listing, options) {
  if (options?.allowDraftObjectNumberMigration !== true) return false;
  if (!isDraftListing(previous) || !isDraftListing(listing)) return false;
  if (!/^FPI-/u.test(String(previous.externalId || '')) || !isHvObjectNumber(listing.externalId)) return false;
  if (previous.id !== listing.id || previous.templateId !== listing.templateId) return false;
  if (previous.listingOrigin !== listing.listingOrigin) return false;
  if (LIFECYCLE_EVIDENCE_FIELDS.some((field) => Boolean(previous[field]) || Boolean(listing[field]))) return false;
  return !(options.uploadHistory || []).some((entry) => entry?.listingId === previous.id);
}

// A UI projection must never replace lifecycle state with a reduced variant copy.
export function mergeListingCollection(existing = [], updates = [], options = {}) {
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
    const migratesDraftObjectNumber = previous
      && previous.externalId !== listing.externalId
      && canMigrateDraftObjectNumber(previous, listing, options);
    if (previous
      && previous.externalId !== listing.externalId
      && !migratesDraftObjectNumber) throw conflict(listing.id);
    byId.set(listing.id, previous && !isDraftListing(previous)
      ? previous
      : {
          ...previous,
          ...listing,
          ...(migratesDraftObjectNumber ? {
            objectNumberMigration: {
              kind: 'legacy-draft-object-number-migration-v1',
              previousExternalId: previous.externalId,
              externalId: listing.externalId,
              evidence: 'draft-without-lifecycle-or-upload-history',
            },
          } : {}),
        });
  }
  return [...byId.values()];
}

export function assertBrowserCatalogTransition(current, next) {
  assertSmartRefillTransition(current, next);
  if (current?.catalogRepairReview && JSON.stringify(current.catalogRepairReview) !== JSON.stringify(next?.catalogRepairReview)) throw conflict('Produktionsfreigabe');
  const protectedFields = ['externalId','listingOrigin','status','version','rotationSourceListingId',
    'addressSnapshot',
    'lastUploadedAt','transferredAt','importConfirmedAt','importReportId','supersededByListingId',
    'replacementConfirmedAt','externalDeletionPending','productionDeleteState','deletedAt',
    'confirmationSource','legacyProviderVerifiedAt','legacyReconciliationId','manualReconciliation',
    'objectNumberMigration'];
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
