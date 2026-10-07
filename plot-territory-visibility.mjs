export const PLOT_TERRITORY_VISIBILITY_KEY = "inseratstudio.plotTerritoryVisibility.v1";

export const defaultPlotTerritoryVisibility = Object.freeze({ inside: true, outside: true });

export function readPlotTerritoryVisibility(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(PLOT_TERRITORY_VISIBILITY_KEY) || "null");
    return {
      inside: saved?.inside !== false,
      outside: saved?.outside !== false,
      ...Object.fromEntries(Object.entries(saved || {}).filter(([key, value]) => key.startsWith("group:") && typeof value === "boolean")),
    };
  } catch {
    return { ...defaultPlotTerritoryVisibility };
  }
}

export function togglePlotTerritoryVisibility(current, territoryId) {
  if (territoryId !== "inside" && territoryId !== "outside" && !territoryId.startsWith("group:")) return current;
  return { ...current, [territoryId]: current[territoryId] === false };
}

export function savePlotTerritoryVisibility(storage, visibility) {
  try {
    storage?.setItem(PLOT_TERRITORY_VISIBILITY_KEY, JSON.stringify(visibility));
  } catch {
    // Browser storage can be unavailable; the current view still works.
  }
}
