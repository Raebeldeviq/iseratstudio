import type { AddressOwner, PlotRecord, ProjectInput, StudioState } from "./app/types";

export const PLOT_RECORD_SCHEMA_VERSION: 1;

export function plotAddressKey(value: unknown): string;
export function formatPlotStreet(value: unknown): string;
export function normalizePlotRecord(value: unknown, options?: { now?: string; fallbackId?: string }): PlotRecord;
export function createPlotRecord(input?: Partial<PlotRecord>, options?: { now?: string; createId?: () => string }): PlotRecord;
export function plotFromProject(project: Partial<ProjectInput>, options?: { now?: string; id?: string }): PlotRecord;
export function applyPlotToProject(project: ProjectInput, plot: PlotRecord): ProjectInput;
export function patchPlotFromProject(plot: PlotRecord, project: Partial<ProjectInput>, now?: string): PlotRecord;
export function createProjectFromPlot(plot: PlotRecord, options?: { now?: string; createId?: () => string; owner?: AddressOwner }): ProjectInput;
export function normalizePlotState<T extends StudioState>(state: T, options?: { now?: string }): T & Required<Pick<StudioState, "plots" | "plotSchemaVersion">>;
export function replacePlotRecord(plots: readonly PlotRecord[], record: PlotRecord, now?: string): PlotRecord[];
export function archivePlotRecord(plots: readonly PlotRecord[], plotId: string, now?: string): PlotRecord[];
