import type { StudioState, GeneratedListing } from './app/types';
import type { RefillPlan, RefillCycle } from './smart-refill.mjs';
export type PreparedRefillRow = { listing: GeneratedListing; cycle: RefillCycle; addressLabel: string; archiveCount: number };
export function preparedRefillRows(state: StudioState, plan: RefillPlan): PreparedRefillRow[];
export function filterPreparedRefillRows(rows: PreparedRefillRow[], query?: string): PreparedRefillRow[];
export function selectFilteredRefillIds(selectedIds: string[], rows: PreparedRefillRow[]): string[];
export function requireRefillUploadSelection(pendingIds: string[], selectedIds: unknown): string[];
