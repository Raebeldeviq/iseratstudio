import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { APPLICATION_DATA_DIRECTORY } from "./platform-paths.mjs";

const KEYCHAIN_SERVICE = "de.fabian-pascal.inseratstudio.credentials";
const KEYCHAIN_ACCOUNT = userInfo().username;
const KEYCHAIN_HELPER_PATH = fileURLToPath(new URL("./macos-keychain.swift", import.meta.url));

export const CREDENTIAL_VAULT_PATH = join(
  APPLICATION_DATA_DIRECTORY,
  process.platform === "darwin" ? "credentials.keychain" : "credentials.dpapi",
);
const LEGACY_CREDENTIAL_VAULT_PATH = join(
  process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"),
  "LivingHaus Inseratstudio",
  "credentials.dpapi",
);

const PROTECT_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$plainText = [Console]::In.ReadToEnd()
$plainBytes = [Text.Encoding]::UTF8.GetBytes($plainText)
$protectedBytes = [Security.Cryptography.ProtectedData]::Protect(
  $plainBytes,
  $null,
  [Security.Cryptography.DataProtectionScope]::CurrentUser
)
[Console]::Out.Write([Convert]::ToBase64String($protectedBytes))
`;

const UNPROTECT_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$protectedText = [Console]::In.ReadToEnd().Trim()
$protectedBytes = [Convert]::FromBase64String($protectedText)
$plainBytes = [Security.Cryptography.ProtectedData]::Unprotect(
  $protectedBytes,
  $null,
  [Security.Cryptography.DataProtectionScope]::CurrentUser
)
[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plainBytes))
`;

function runProcess(executable, args, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    let errorOutput = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { errorOutput += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(output.trim());
      else reject(new Error(errorOutput.trim() || "Der lokale Zugangstresor konnte nicht geöffnet werden."));
    });
    child.stdin.end(input, "utf8");
  });
}

function runPowerShell(script, input) {
  return runProcess(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    input,
  );
}

function clean(value, maximum = 500) {
  return String(value ?? "").trim().slice(0, maximum);
}

export function normalizeCredentials(input = {}) {
  const supportedModels = new Set(["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"]);
  const model = supportedModels.has(input.aiModel) ? input.aiModel : "gpt-5.6-luna";
  return {
    openAiKey: clean(input.openAiKey, 400),
    aiModel: model,
    ftpHost: clean(input.ftpHost, 240) || "fabianraebel.livinghaus.info",
    ftpUser: clean(input.ftpUser, 240),
    ftpPassword: clean(input.ftpPassword, 500),
    ftpPath: clean(input.ftpPath, 500) || "/",
  };
}

export function looksLikeOpenAiApiKey(value) {
  return /^sk-[a-zA-Z0-9_-]{20,}$/.test(clean(value, 400));
}

function keychainService(vaultPath) {
  return vaultPath === CREDENTIAL_VAULT_PATH
    ? KEYCHAIN_SERVICE
    : `${KEYCHAIN_SERVICE}.${Buffer.from(vaultPath).toString("base64url").slice(0, 80)}`;
}

async function saveMacKeychain(credentials, vaultPath) {
  await runProcess("/usr/bin/swift", [
    KEYCHAIN_HELPER_PATH,
    "save",
    keychainService(vaultPath),
    KEYCHAIN_ACCOUNT,
    "device-only",
  ], JSON.stringify(credentials));
}

async function loadMacKeychain(vaultPath) {
  const value = await runProcess("/usr/bin/swift", [
    KEYCHAIN_HELPER_PATH,
    "load",
    keychainService(vaultPath),
    KEYCHAIN_ACCOUNT,
    "device-only",
  ]);
  return value || null;
}

async function clearMacKeychain(vaultPath) {
  await runProcess("/usr/bin/swift", [
    KEYCHAIN_HELPER_PATH,
    "delete",
    keychainService(vaultPath),
    KEYCHAIN_ACCOUNT,
    "device-only",
  ]);
}

export async function saveCredentialVault(credentials, vaultPath = CREDENTIAL_VAULT_PATH) {
  const normalized = normalizeCredentials(credentials);
  if (normalized.openAiKey && !looksLikeOpenAiApiKey(normalized.openAiKey)) {
    throw new Error("Der OpenAI API-Schlüssel muss mit sk- beginnen und vollständig eingefügt werden.");
  }
  if (process.platform === "darwin") {
    await saveMacKeychain(normalized, vaultPath);
    return normalized;
  }
  if (process.platform !== "win32") {
    throw new Error("Der Zugangstresor wird derzeit auf macOS und Windows unterstützt.");
  }
  const protectedText = await runPowerShell(PROTECT_SCRIPT, JSON.stringify(normalized));
  await mkdir(dirname(vaultPath), { recursive: true });
  await writeFile(vaultPath, protectedText, { encoding: "utf8", mode: 0o600 });
  return normalized;
}

export async function loadCredentialVault(vaultPath = CREDENTIAL_VAULT_PATH) {
  if (process.platform === "darwin") {
    const plainText = await loadMacKeychain(vaultPath);
    if (!plainText) return { stored: false, credentials: normalizeCredentials() };
    return {
      stored: true,
      credentials: normalizeCredentials(JSON.parse(plainText)),
    };
  }
  if (process.platform !== "win32") {
    return { stored: false, credentials: normalizeCredentials() };
  }

  let protectedText;
  try {
    protectedText = await readFile(vaultPath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      if (vaultPath === CREDENTIAL_VAULT_PATH) {
        try {
          const legacy = await loadCredentialVault(LEGACY_CREDENTIAL_VAULT_PATH);
          if (legacy.stored) {
            await saveCredentialVault(legacy.credentials, CREDENTIAL_VAULT_PATH);
            return legacy;
          }
        } catch {
          // Ein nicht lesbarer Alttresor darf den neuen, leeren Tresor nicht blockieren.
        }
      }
      return { stored: false, credentials: normalizeCredentials() };
    }
    throw error;
  }
  const plainText = await runPowerShell(UNPROTECT_SCRIPT, protectedText);
  return {
    stored: true,
    credentials: normalizeCredentials(JSON.parse(plainText)),
  };
}

export async function clearCredentialVault(vaultPath = CREDENTIAL_VAULT_PATH) {
  if (process.platform === "darwin") {
    await clearMacKeychain(vaultPath);
    return;
  }
  await rm(vaultPath, { force: true });
  if (vaultPath === CREDENTIAL_VAULT_PATH && process.platform === "win32") {
    await rm(LEGACY_CREDENTIAL_VAULT_PATH, { force: true });
  }
}
