import { access, mkdir, rename, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

export const HELPER_LAUNCH_AGENT_LABEL = "com.fabianpascal.inseratstudio.helper";
export const UI_LAUNCH_AGENT_LABEL = "com.fabianpascal.inseratstudio.ui";

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function helperLaunchAgentPath(homeDirectory = homedir()) {
  return join(homeDirectory, "Library", "LaunchAgents", `${HELPER_LAUNCH_AGENT_LABEL}.plist`);
}

export function uiLaunchAgentPath(homeDirectory = homedir()) {
  return join(homeDirectory, "Library", "LaunchAgents", `${UI_LAUNCH_AGENT_LABEL}.plist`);
}

export function helperRuntimeWorkingDirectory(homeDirectory = homedir()) {
  return join(
    homeDirectory,
    "Library",
    "Application Support",
    "Fabian-Pascal Inseratestudio",
    "helper-runtime-context",
  );
}

function buildLaunchAgentPlist(options) {
  const homeDirectory = resolve(String(options?.homeDirectory || homedir()));
  const projectRoot = resolve(String(options?.projectRoot || ""));
  const nodePath = resolve(String(options?.nodePath || ""));
  const workingDirectory = resolve(String(options?.workingDirectory || helperRuntimeWorkingDirectory(homeDirectory)));
  const entrypoint = resolve(String(options?.entrypoint || ""));
  const label = String(options?.label || "").trim();
  const standardOutPath = resolve(String(options?.standardOutPath || ""));
  const standardErrorPath = resolve(String(options?.standardErrorPath || ""));
  if (!label || ![projectRoot, nodePath, workingDirectory, entrypoint, standardOutPath, standardErrorPath].every(isAbsolute)) {
    throw new Error("LaunchAgent-Pfade müssen absolut sein.");
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(nodePath)}</string>
    <string>${xml(entrypoint)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(workingDirectory)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>LimitLoadToSessionType</key>
  <string>Aqua</string>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${xml(standardOutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(standardErrorPath)}</string>
</dict>
</plist>
`;
}

export function buildHelperLaunchAgentPlist(options) {
  const homeDirectory = resolve(String(options?.homeDirectory || homedir()));
  const projectRoot = resolve(String(options?.projectRoot || ""));
  return buildLaunchAgentPlist({
    ...options,
    homeDirectory,
    projectRoot,
    label: HELPER_LAUNCH_AGENT_LABEL,
    entrypoint: join(projectRoot, "local-helper-launcher.mjs"),
    standardOutPath: options?.standardOutPath || join(homeDirectory, "Library", "Logs", "Fabian-Pascal Inseratestudio", "helper.out.log"),
    standardErrorPath: options?.standardErrorPath || join(homeDirectory, "Library", "Logs", "Fabian-Pascal Inseratestudio", "helper.err.log"),
  });
}

export function buildUiLaunchAgentPlist(options) {
  const homeDirectory = resolve(String(options?.homeDirectory || homedir()));
  const projectRoot = resolve(String(options?.projectRoot || ""));
  return buildLaunchAgentPlist({
    ...options,
    homeDirectory,
    projectRoot,
    label: UI_LAUNCH_AGENT_LABEL,
    entrypoint: join(projectRoot, "production-server.mjs"),
    standardOutPath: options?.standardOutPath || join(homeDirectory, "Library", "Logs", "Fabian-Pascal Inseratestudio", "ui.out.log"),
    standardErrorPath: options?.standardErrorPath || join(homeDirectory, "Library", "Logs", "Fabian-Pascal Inseratestudio", "ui.err.log"),
  });
}

async function writeLaunchAgent(path, plist) {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, plist, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, path);
}

export async function installHelperLaunchAgent(options = {}) {
  const homeDirectory = resolve(String(options.homeDirectory || homedir()));
  const projectRoot = resolve(String(options.projectRoot || process.cwd()));
  const preferredNodePath = join(homeDirectory, ".local", "bin", "node");
  const nodePath = resolve(String(options.nodePath || preferredNodePath));
  const workingDirectory = resolve(String(options.workingDirectory || helperRuntimeWorkingDirectory(homeDirectory)));
  const logsDirectory = join(homeDirectory, "Library", "Logs", "Fabian-Pascal Inseratestudio");
  const destination = resolve(String(options.destination || helperLaunchAgentPath(homeDirectory)));
  const uiDestination = resolve(String(options.uiDestination || uiLaunchAgentPath(homeDirectory)));
  await access(join(projectRoot, "local-helper-launcher.mjs"), constants.R_OK);
  await access(join(projectRoot, "local-upload-server.mjs"), constants.R_OK);
  await access(join(projectRoot, "production-server.mjs"), constants.R_OK);
  await access(nodePath, constants.X_OK);
  await mkdir(workingDirectory, { recursive: true });
  await mkdir(logsDirectory, { recursive: true });
  await mkdir(dirname(destination), { recursive: true });
  const plist = buildHelperLaunchAgentPlist({
    homeDirectory,
    projectRoot,
    nodePath,
    workingDirectory,
  });
  const uiPlist = buildUiLaunchAgentPlist({
    homeDirectory,
    projectRoot,
    nodePath,
    workingDirectory,
  });
  await writeLaunchAgent(destination, plist);
  await writeLaunchAgent(uiDestination, uiPlist);
  return {
    label: HELPER_LAUNCH_AGENT_LABEL,
    path: destination,
    projectRoot,
    workingDirectory,
    nodePath,
    ui: { label: UI_LAUNCH_AGENT_LABEL, path: uiDestination },
  };
}
