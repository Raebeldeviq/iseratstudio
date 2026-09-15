import { join } from "node:path";
import { APPLICATION_DATA_DIRECTORY } from "./platform-paths.mjs";

export const PLOT_SYNC_CONFIG = Object.freeze({
  sourcePath: String(process.env.FPI_PLOT_SYNC_SOURCE_PATH || join(
    APPLICATION_DATA_DIRECTORY,
    "inputs",
    "KI_Grundstuecke.xlsx",
  )),
  worksheet: String(process.env.FPI_PLOT_SYNC_WORKSHEET || "Grundstücke"),
  intervalDays: 3,
  hour: 7,
  minute: 0,
  timeZone: "Europe/Berlin",
  statePath: join(APPLICATION_DATA_DIRECTORY, "plot-sync-state.json"),
  logPath: join(APPLICATION_DATA_DIRECTORY, "plot-sync.log"),
  lockPath: join(APPLICATION_DATA_DIRECTORY, "plot-sync.lock"),
});
