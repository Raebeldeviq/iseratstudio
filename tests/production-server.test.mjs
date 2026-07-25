import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createProductionServer,
  PRODUCTION_HEALTH_BODY,
  PRODUCTION_HEALTH_PATH,
  resolveStaticFile,
} from "../production-server.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("resolves the built app and its hashed client assets without loading Vite", async () => {
  const serverUrl = new URL("../dist/server/ssr/index.js", import.meta.url);
  serverUrl.searchParams.set("production-server-test", `${process.pid}-${Date.now()}`);
  const { default: application } = await import(serverUrl.href);
  const server = createProductionServer({ projectRoot, application });
  assert.equal(typeof server.listen, "function");
  const response = await application.fetch(new Request("http://127.0.0.1/"));
  assert.equal(response.status, 200);
  const html = await response.text();
  const assetPath = html.match(/(?:src|href)="([^"]+\.(?:js|css))"/)?.[1];
  assert.ok(assetPath);
  const asset = await resolveStaticFile(projectRoot, assetPath);
  assert.ok(asset.includes("/dist/client/assets/"));
  assert.ok((await readFile(asset)).byteLength > 100);
  assert.equal(await resolveStaticFile(projectRoot, "/../../package.json"), "");
  assert.equal(PRODUCTION_HEALTH_PATH, "/__fpi_health");
  assert.equal(PRODUCTION_HEALTH_BODY, "fabian-pascal-inseratestudio");
});
