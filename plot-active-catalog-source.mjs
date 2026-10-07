import JSZip from "jszip";
import { homedir } from "node:os";
import { join } from "node:path";
import { readMasterWorkbook } from "./plot-master-workbook.mjs";
import { applyMasterRowsToPlot, generatePoolB } from "./plot-master-sync.mjs";
import { loadPlotTerritory } from "./plot-territory-source.mjs";
import { PLOT_SYNC_CONFIG } from "./plot-sync-config.mjs";

export const PLOT_MASTER_PATH = process.env.FPI_PLOT_MASTER_PATH || join(homedir(), "Library", "Mobile Documents", "com~apple~CloudDocs", "Life Business-System", "01_HANDELSVERTRETUNG", "02_GRUNDSTUECKE", "09_KI-GESUCHT", "KI_Grundstuecke_MASTER.xlsx");

export async function loadActivePlotCatalogSource(options = {}) {
  const path = options.path || PLOT_MASTER_PATH;
  try {
    const workbook = await (options.readWorkbook || readMasterWorkbook)(path);
    if (!workbook.bytes) throw new Error("Master fehlt");
    let territory = await (options.loadTerritory || loadPlotTerritory)(path);
    // The current master has Pool_A/B only. Reuse the existing Suchgebiet source, never a second list.
    const archive = await JSZip.loadAsync(workbook.bytes);
    const workbookXml = await archive.file("xl/workbook.xml")?.async("string");
    const hasTerritory = /<sheet\b[^>]*name="Suchgebiet"/u.test(workbookXml || "");
    if (!territory.available && !hasTerritory) territory = await (options.loadTerritory || loadPlotTerritory)(options.territoryPath || PLOT_SYNC_CONFIG.sourcePath);
    if (!territory.available) throw new Error("Suchgebiet fehlt");
    const b = new Map(workbook.poolB.map(row => [row.plotId, row]));
    const masterPlots = workbook.poolA.filter(row => row.sourceStatus !== "Nicht mehr vorhanden")
      .map(row => ({ ...applyMasterRowsToPlot(null, row, b.get(row.plotId) || generatePoolB(row), "2000-01-01T00:00:00.000Z"),
        district: row.district || "", sourceStatus: row.sourceStatus || "" }));
    return { available: true, sourcePath: path, territory, masterPlots, message: "" };
  } catch {
    return { available: false, sourcePath: path, territory: null, masterPlots: [],
      message: "Master-Datei oder vorhandenes Suchgebiet sind nicht gültig lesbar. Die Auswahl für neue Inserate wartet auf den Datenabgleich." };
  }
}
