export const ACTIVE_HOUSES_PER_PROJECT = 4;
export const PROCESS_LEASE_MS = 15 * 60 * 1000;
export const MAX_LISTING_GROUP_LOGS = 500;
export const MAX_SCHEDULER_LOGS = 500;
export const MAX_UPLOAD_LOGS = 5000;
export const MAX_PROMOTION_USAGE = 5000;

export const LISTING_RULES = Object.freeze({
  activeHousesPerProject: ACTIVE_HOUSES_PER_PROJECT,
  processLeaseMs: PROCESS_LEASE_MS,
  maxListingGroupLogs: MAX_LISTING_GROUP_LOGS,
  maxSchedulerLogs: MAX_SCHEDULER_LOGS,
  maxUploadLogs: MAX_UPLOAD_LOGS,
  maxPromotionUsage: MAX_PROMOTION_USAGE,
  maxUpdatesPerAddressPerDay: 1,
});
