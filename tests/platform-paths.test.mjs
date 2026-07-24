import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  APP_DIRECTORY_NAME,
  applicationDataDirectory,
} from "../platform-paths.mjs";

test("uses platform-specific private application data folders", () => {
  assert.equal(
    applicationDataDirectory("darwin"),
    join(homedir(), "Library", "Application Support", APP_DIRECTORY_NAME),
  );
  assert.equal(
    applicationDataDirectory("win32"),
    join(
      process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"),
      APP_DIRECTORY_NAME,
    ),
  );
});

test("contains the native macOS Keychain helper", async () => {
  const source = await readFile(new URL("../macos-keychain.swift", import.meta.url), "utf8");
  assert.match(source, /SecItemUpdate/);
  assert.match(source, /SecItemCopyMatching/);
  assert.match(source, /SecItemDelete/);
  assert.match(source, /kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly/);
});
