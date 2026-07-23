import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  clearCredentialVault,
  loadCredentialVault,
  normalizeCredentials,
  publicCredentialStatus,
  saveCredentialVault,
} from "../credential-vault.mjs";

test("normalizes only the supported local credentials", () => {
  assert.deepEqual(normalizeCredentials({
    openAiKey: "  sk-test  ",
    aiModel: "invalid",
    ftpHost: " example.test ",
    ftpUser: " user ",
    ftpPassword: " secret ",
    ftpPath: " /inbox ",
    unrelated: "must not be stored",
  }), {
    openAiKey: "sk-test",
    aiModel: "gpt-5.6-luna",
    ftpHost: "example.test",
    ftpUser: "user",
    ftpPassword: "secret",
    ftpPath: "/inbox",
    ftpSecure: "explicit",
  });
});

test("migrates legacy LivingHaus aliases to the certificate-compatible FTPS host", () => {
  for (const ftpHost of [
    "fabianraebel.livinghaus.info",
    "pascalfroehlich.livinghaus.info",
    "PASCALFROEHLICH.LIVINGHAUS.INFO.",
  ]) {
    assert.equal(normalizeCredentials({ ftpHost }).ftpHost, "server22.immoprofessional.eu");
  }
  assert.equal(normalizeCredentials({}).ftpHost, "server22.immoprofessional.eu");
  assert.equal(normalizeCredentials({ ftpHost: "other.example.test" }).ftpHost, "other.example.test");
});

test("exposes only non-secret credential status to the browser", () => {
  const status = publicCredentialStatus({
    openAiKey: "sk-local-test-value-1234567890",
    ftpUser: "fabian",
    ftpPassword: "password-only-for-test",
    ftpSecure: "implicit",
  });
  assert.equal(status.hasOpenAiKey, true);
  assert.equal(status.hasFtpCredentials, true);
  assert.equal(status.ftpSecure, "implicit");
  assert.equal("openAiKey" in status, false);
  assert.equal("ftpPassword" in status, false);
});

test("accepts all three GPT-5.6 quality profiles", () => {
  for (const aiModel of ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"]) {
    assert.equal(normalizeCredentials({ aiModel }).aiModel, aiModel);
  }
});

test("round-trips credentials through Windows user encryption", { skip: process.platform !== "win32" }, async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "livinghaus-vault-test-"));
  const vaultPath = join(directory, "credentials.dpapi");
  context.after(() => rm(directory, { recursive: true, force: true }));

  const credentials = {
    openAiKey: "sk-local-test-value-1234567890",
    aiModel: "gpt-5.6-terra",
    ftpHost: "ftp.example.test",
    ftpUser: "fabian",
    ftpPassword: "password-only-for-test",
    ftpPath: "/openimmo",
    ftpSecure: "explicit",
  };
  await saveCredentialVault(credentials, vaultPath);
  const encryptedFile = await readFile(vaultPath, "utf8");
  assert.doesNotMatch(encryptedFile, /sk-local-test-value-1234567890|password-only-for-test/);

  const loaded = await loadCredentialVault(vaultPath);
  assert.equal(loaded.stored, true);
  assert.deepEqual(loaded.credentials, credentials);

  await clearCredentialVault(vaultPath);
  assert.equal((await loadCredentialVault(vaultPath)).stored, false);
});
