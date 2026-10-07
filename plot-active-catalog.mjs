import { partitionPlotsByTerritory } from "./plot-territory.mjs";
import { plotAddressSelection } from "./plot-selection.mjs";

export function uniqueCatalogPlots(plots = []) {
  return [...new Map(plots.map(plot => [plot.id, plot])).values()];
}

export function catalogSourceReady(source) {
  return source?.available === true && Array.isArray(source.masterPlots)
    && partitionPlotsByTerritory([], source.territory).some(section => section.id === "inside");
}

export function catalogPlotDisposition(plot, source, policy) {
  if (!catalogSourceReady(source)) return "unavailable";
  if (plot.isActive === false || !plotAddressSelection(plot).selectable) return "review";
  const inside = partitionPlotsByTerritory([plot], source.territory)[0].plots.length === 1;
  const member = source.masterPlots.some(row => row.id === plot.id);
  const newPlot = policy?.version === 1 && Array.isArray(policy.legacyPlotIds)
    && !policy.legacyPlotIds.includes(plot.id);
  if (inside && (member || newPlot || plot.keepInActiveCatalog === true || plot.exclusiveOutsideTerritory === true)) return "inside";
  if (!inside && plot.exclusiveOutsideTerritory === true) return "outside";
  return "excluded";
}

export function operationalCatalogPlots(plots, context) {
  if (!context) return uniqueCatalogPlots(plots);
  if (context.policy?.version !== 1 || !context.policy.approvedAt || !catalogSourceReady(context.source)) return [];
  return uniqueCatalogPlots(plots).filter(plot => ["inside", "outside"].includes(catalogPlotDisposition(plot, context.source, context.policy)));
}

export function catalogGeographicLabel(plot, source, fallback = "Nicht zugeordnet") {
  const master = source?.masterPlots?.find(row => row.id === plot.id);
  const region = source?.territory?.regions?.[plot.postalCode] || "";
  const place = [master?.district, plot.city].filter(Boolean).join(" ");
  if (/berlin/iu.test(region + " " + place)) {
    // Display labels only. Suchgebiet still determines all territory membership.
    if (/kladow|gatow/iu.test(place) || plot.postalCode === "14089") return "Berlin – Kladow";
    if (/staaken/iu.test(place) || plot.postalCode === "13591") return "Berlin – Staaken";
    if (/spandau/iu.test(place) || region === "Berlin 8") return "Berlin – Spandau";
    const district = master?.district || plot.city.replace(/^Berlin[\s–-]*/iu, "");
    return district && district !== "Berlin" ? `Berlin – ${district}` : region || "Berlin";
  }
  return region || fallback.replace(/^Brandenburg\s*[·–-]\s*/u, "");
}

export function catalogCleanupPreview(state, source) {
  if (!catalogSourceReady(source)) throw new Error("Master-Datei und Suchgebiet müssen vor der Bereinigung gültig lesbar sein.");
  const plots = uniqueCatalogPlots([...(state.plots || []), ...source.masterPlots.filter(row => !(state.plots || []).some(plot => plot.id === row.id))]);
  const inside = [], outside = [], removed = [], review = [];
  for (const plot of plots) {
    const disposition = catalogPlotDisposition(plot, source, state.activePlotCatalog);
    if (disposition === "inside") inside.push(plot);
    else if (disposition === "outside") outside.push(plot);
    else {
      if ((state.plots || []).some(row => row.id === plot.id && row.isActive !== false)) removed.push(plot);
      if (disposition === "review") review.push(plot);
    }
  }
  return { inside, outside, removed, review, plots };
}

export function approveActivePlotCatalog(state, source, approvedAt) {
  if (state.activePlotCatalog?.approvedAt) throw new Error("Die einmalige Bereinigung wurde bereits bestätigt.");
  const preview = catalogCleanupPreview(state, source);
  const policy = { version: 1, approvedAt, legacyPlotIds: preview.plots.map(plot => plot.id) };
  const context = { source, policy };
  const eligible = new Set(operationalCatalogPlots(preview.plots, context).map(plot => plot.id));
  // Keep every project/listing/history/audit object exactly as received; no normalization or deletion.
  return { ...state, plots: preview.plots, activePlotCatalog: policy,
    selectedPlotIds: (state.selectedPlotIds || []).filter(id => eligible.has(id)) };
}

export function filterCatalogPlots(plots, query = "", city = "") {
  const needle = query.trim().toLocaleLowerCase("de-DE");
  return plots.filter(plot => (!city || plot.city === city) && (!needle ||
    [plot.street, plot.houseNumber, plot.postalCode, plot.city, plot.id].join(" ").toLocaleLowerCase("de-DE").includes(needle)));
}
