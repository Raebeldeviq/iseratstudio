import { createListingGroup } from "./listing-groups.mjs";

export const PLOT_RECORD_SCHEMA_VERSION = 1;

function text(value) {
  return String(value ?? "").trim();
}

function normalizedText(value) {
  return text(value)
    .toLocaleLowerCase("de-DE")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/gu, "");
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function postalCode(value) {
  const valueText = text(value);
  return /^\d{1,4}$/.test(valueText) ? valueText.padStart(5, "0") : valueText;
}

function safeIsoDate(value, fallback) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

export function plotAddressKey(value) {
  const key = [
    value?.street,
    value?.houseNumber,
    value?.postalCode ?? value?.zip,
    value?.city,
  ].map(normalizedText).join("|");
  return key === "|||" ? "" : key;
}

export function formatPlotStreet(plot) {
  return [text(plot?.street), text(plot?.houseNumber)].filter(Boolean).join(" ");
}

export function normalizePlotRecord(value, options = {}) {
  const now = String(options.now || new Date().toISOString());
  const fallbackId = text(options.fallbackId) || `plot-${globalThis.crypto.randomUUID()}`;
  const exposeFileReference = text(value?.exposeFileReference ?? value?.expose_file_reference);
  const exposeFilename = text(value?.exposeFilename ?? value?.expose_filename);
  const exposeUploadedAt = text(value?.exposeUploadedAt ?? value?.expose_uploaded_at);
  return {
    id: text(value?.id) || fallbackId,
    street: text(value?.street),
    houseNumber: text(value?.houseNumber ?? value?.house_number),
    postalCode: postalCode(value?.postalCode ?? value?.postal_code ?? value?.zip),
    city: text(value?.city),
    plotSizeSqm: positiveNumber(value?.plotSizeSqm ?? value?.plot_size_sqm ?? value?.plotArea),
    purchasePrice: positiveNumber(value?.purchasePrice ?? value?.purchase_price ?? value?.plotPrice),
    regionalNotes: text(value?.regionalNotes ?? value?.regional_notes),
    owner: value?.owner === "pascal" ? "pascal" : value?.owner === "fabian" ? "fabian" : undefined,
    exposeFileReference,
    exposeFilename: exposeFileReference ? exposeFilename : "",
    exposeUploadedAt: exposeFileReference && exposeUploadedAt ? safeIsoDate(exposeUploadedAt, now) : "",
    createdAt: safeIsoDate(value?.createdAt ?? value?.created_at, now),
    updatedAt: safeIsoDate(value?.updatedAt ?? value?.updated_at, now),
    isActive: value?.isActive !== false && value?.is_active !== false,
  };
}

export function createPlotRecord(input = {}, options = {}) {
  const now = String(options.now || new Date().toISOString());
  const createId = typeof options.createId === "function"
    ? options.createId
    : () => globalThis.crypto.randomUUID();
  return normalizePlotRecord({
    ...input,
    id: text(input.id) || createId(),
    createdAt: now,
    updatedAt: now,
    isActive: true,
  }, { now });
}

export function plotFromProject(project, options = {}) {
  const now = String(options.now || new Date().toISOString());
  return normalizePlotRecord({
    id: text(options.id) || text(project?.plotId) || `plot-${text(project?.id)}`,
    street: project?.street,
    houseNumber: project?.houseNumber,
    postalCode: project?.zip,
    city: project?.city,
    plotSizeSqm: project?.plotArea,
    purchasePrice: project?.plotPrice,
    regionalNotes: project?.locationFacts,
    owner: project?.owner,
    createdAt: project?.createdAt,
    updatedAt: project?.updatedAt || project?.createdAt,
    isActive: true,
  }, { now, fallbackId: `plot-${text(project?.id) || "legacy"}` });
}

export function applyPlotToProject(project, plot) {
  if (!plot) return project;
  const address = formatPlotStreet(plot);
  return {
    ...project,
    plotId: plot.id,
    street: plot.street,
    houseNumber: plot.houseNumber,
    zip: plot.postalCode,
    city: plot.city,
    plotArea: plot.plotSizeSqm,
    plotPrice: plot.purchasePrice,
    name: text(project?.name) || `${address}, ${plot.postalCode} ${plot.city}`.trim(),
  };
}

export function patchPlotFromProject(plot, project, now = new Date().toISOString()) {
  return normalizePlotRecord({
    ...plot,
    street: project?.street,
    houseNumber: project?.houseNumber,
    postalCode: project?.zip,
    city: project?.city,
    plotSizeSqm: project?.plotArea,
    purchasePrice: project?.plotPrice,
    owner: project?.owner,
    updatedAt: now,
  }, { now, fallbackId: plot?.id });
}

export function createProjectFromPlot(plot, options = {}) {
  const now = String(options.now || new Date().toISOString());
  const createId = typeof options.createId === "function"
    ? options.createId
    : () => globalThis.crypto.randomUUID();
  const id = createId();
  const street = formatPlotStreet(plot);
  return {
    id,
    plotId: plot.id,
    owner: plot.owner === "pascal" ? "pascal" : options.owner === "pascal" ? "pascal" : "fabian",
    name: `${street}, ${plot.postalCode} ${plot.city}`.trim(),
    street: plot.street,
    houseNumber: plot.houseNumber,
    zip: plot.postalCode,
    city: plot.city,
    district: "",
    federalState: "",
    county: "",
    plotArea: plot.plotSizeSqm,
    plotPrice: plot.purchasePrice,
    additionalCosts: 0,
    locationFacts: plot.regionalNotes,
    transportFacts: "",
    familyFacts: "",
    natureFacts: "",
    selectedHouseIds: [],
    listings: [],
    listingGroup: createListingGroup(id),
    createdAt: now,
  };
}

export function normalizePlotState(state, options = {}) {
  const now = String(options.now || new Date().toISOString());
  const sourcePlots = Array.isArray(state?.plots) ? state.plots : [];
  const plots = sourcePlots.map((plot, index) => normalizePlotRecord(plot, {
    now,
    fallbackId: `plot-migrated-${index + 1}`,
  }));
  const plotById = new Map(plots.map((plot) => [plot.id, plot]));
  const plotByAddress = new Map();
  for (const plot of plots) {
    const key = plotAddressKey(plot);
    if (key && !plotByAddress.has(key)) plotByAddress.set(key, plot);
  }

  const projects = (Array.isArray(state?.projects) ? state.projects : []).map((project) => {
    const projectKey = plotAddressKey(project);
    let plot = plotById.get(text(project?.plotId));
    if (!plot && projectKey) plot = plotByAddress.get(projectKey);
    if (!plot && projectKey) {
      plot = plotFromProject(project, { now, id: `plot-${text(project?.id) || plots.length + 1}` });
      plots.push(plot);
      plotById.set(plot.id, plot);
      plotByAddress.set(projectKey, plot);
    }
    return plot ? applyPlotToProject(project, plot) : project;
  });

  return {
    ...state,
    plotSchemaVersion: PLOT_RECORD_SCHEMA_VERSION,
    plots,
    projects,
  };
}

export function replacePlotRecord(plots, record, now = new Date().toISOString()) {
  const normalized = normalizePlotRecord({ ...record, updatedAt: now }, { now, fallbackId: record?.id });
  const found = (plots || []).some((plot) => plot.id === normalized.id);
  return found
    ? (plots || []).map((plot) => plot.id === normalized.id ? normalized : plot)
    : [...(plots || []), normalized];
}

export function archivePlotRecord(plots, plotId, now = new Date().toISOString()) {
  return (plots || []).map((plot) => plot.id === plotId
    ? normalizePlotRecord({ ...plot, isActive: false, updatedAt: now }, { now, fallbackId: plot.id })
    : plot);
}
