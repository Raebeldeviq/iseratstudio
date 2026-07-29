import { homedir } from "node:os";
import { join } from "node:path";

export const APP_DIRECTORY_NAME = "Fabian-Pascal Inseratestudio";

export function applicationDataDirectory(platform = process.platform) {
  if (platform === "darwin") {
    return join(homedir(), "Library", "Application Support", APP_DIRECTORY_NAME);
  }
  if (platform === "win32") {
    return join(
      process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"),
      APP_DIRECTORY_NAME,
    );
  }
  return join(
    process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"),
    APP_DIRECTORY_NAME,
  );
}

export const APPLICATION_DATA_DIRECTORY = applicationDataDirectory();
