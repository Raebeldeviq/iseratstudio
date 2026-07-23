import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const serverUrl = new URL("../dist/server/ssr/index.js", import.meta.url);
  serverUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: server } = await import(serverUrl.href);
  return server.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
  );
}

test("renders the isolated Fabian&Pascal studio shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>Fabian(?:&|&amp;)Pascal Inseratestudio<\/title>/i);
  assert.match(html, /Fabian(?:&|&amp;)Pascal Inseratestudio wird vorbereitet/i);
  assert.match(html, /Geöffnete InseratStudio-Version 0\.9\.4/i);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});
