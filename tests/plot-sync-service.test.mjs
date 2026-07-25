import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPlotSyncService } from "../plot-sync-service.mjs";

const HEADERS = ["Postleitzahl", "Ort", "Straße", "Größe (m²)", "Preis (€)", "Quelle", "Inseratslink", "Erstmals gefunden", "Zuletzt geprüft", "Status", "Exposé-Dateiname", "Interne ID"];
const ROWS = [HEADERS, ["14469", "Potsdam", "Kirschallee 12", 700, 300000, "Quelle", "https://example.test/1", "", "", "Neu", "", "KI-1"]];

async function fixture(context, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "fpi-plot-sync-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const sourcePath = join(root, "KI_Grundstuecke.xlsx");
  await writeFile(sourcePath, "read-only-source");
  const sourceBefore = await readFile(sourcePath);
  let savedState = null;
  const service = createPlotSyncService({
    config: { sourcePath, statePath: join(root, "state.json"), logPath: join(root, "sync.log"), lockPath: join(root, "sync.lock") },
    readWorkbook: overrides.readWorkbook || (async () => ROWS),
    loadCatalog: async () => ({ stored: true, savedAt: "2026-07-25T08:00:00.000Z", state: { version: 1, plots: [], projects: [], houses: [], provider: {} } }),
    startCatalog: async (input) => { savedState = input.state; return { missingImageIds: [] }; },
    commitCatalog: async () => ({ savedAt: "2026-07-25T10:00:00.000Z" }),
    now: () => "2026-07-25T10:00:00.000Z",
  });
  return { root, sourcePath, sourceBefore, service, savedState: () => savedState };
}

test("dry run and real run preserve the source while only the real run writes the catalog", async (context) => {
  const item = await fixture(context);
  const dry = await item.service.run({ dryRun: true });
  assert.equal(dry.lastRun.created, 1);
  assert.equal(item.savedState(), null);
  const applied = await item.service.run({ dryRun: false });
  assert.equal(applied.lastRun.created, 1);
  assert.equal(item.savedState().plots.length, 1);
  assert.deepEqual(await readFile(item.sourcePath), item.sourceBefore);
  assert.match(applied.nextScheduledRunAt, /^2026-07-28T05:00:00\.000Z$/u);
});

test("missing source is logged without modifying catalog data", async (context) => {
  const item = await fixture(context);
  await rm(item.sourcePath);
  const result = await item.service.run({ dryRun: false });
  assert.equal(result.lastRun.status, "failed");
  assert.equal(result.sourceFound, false);
  assert.equal(item.savedState(), null);
});

test("parallel starts are rejected by the in-process job lock", async (context) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const item = await fixture(context, { readWorkbook: async () => { await gate; return ROWS; } });
  const first = item.service.run({ dryRun: true });
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(() => item.service.run({ dryRun: true }), (error) => error.code === "PLOT_SYNC_LOCKED");
  release();
  await first;
});
