import assert from "node:assert/strict";
import test from "node:test";

import { APP_VERSION } from "../app/lib/app-version.mjs";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renders the isolated Fabian&Pascal studio shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>Fabian(?:&|&amp;)Pascal Inseratestudio<\/title>/i);
  assert.match(html, /Fabian(?:&|&amp;)Pascal Inseratestudio wird vorbereitet/i);
  assert.ok(html.includes(`Geöffnete InseratStudio-Version ${APP_VERSION}`));
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});
