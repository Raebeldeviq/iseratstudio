import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { readSheet } from 'read-excel-file/node';
import { loadCatalogManifest } from './catalog-store.mjs';
import { applyPlotSyncRows, parsePlotSyncRows } from './plot-excel-sync.mjs';
import { PLOT_SYNC_CONFIG } from './plot-sync-config.mjs';
import { parseActivePostalCodes } from './plot-search-area.mjs';
import { createPlotInquiryWorkflow } from './plot-inquiry-workflow.mjs';
import { assertLocalPlotPath } from './plot-local-paths.mjs';

export async function previewLocalPlotInquiries(options = {}) {
  const sourcePath = await assertLocalPlotPath(options.sourcePath || PLOT_SYNC_CONFIG.sourcePath);
  const readBytes = options.readBytes || readFile;
  const readWorkbook = options.readWorkbook || readSheet;
  const hash = async () => createHash('sha256').update(await readBytes(sourcePath)).digest('hex');
  const before = await hash();
  const active = parseActivePostalCodes(await readWorkbook(sourcePath, 'Suchgebiet'), {expectedCount:50});
  const rows = parsePlotSyncRows(await readWorkbook(sourcePath, PLOT_SYNC_CONFIG.worksheet));
  const manifest = await (options.loadCatalog || loadCatalogManifest)();
  if (!manifest.stored || !manifest.state) throw new Error('Lokaler Katalog fehlt.');
  const projected = applyPlotSyncRows(manifest.state, rows, {now:new Date().toISOString()});
  const factory = options.createWorkflow || createPlotInquiryWorkflow;
  const inquiries = await factory({
    loadCatalog: async () => ({...manifest, state:projected.state}),
    loadActivePostalCodes: async () => active,
  }).preview();
  if (await hash() !== before) throw new Error('SOURCE_CHANGED_DURING_READ');
  return {mode:'read-only-preview',mutationsPersisted:false,sourcePath,sourceSha256:before,
    activePostalCodeCount:active.size,plotSync:{...projected.stats,status:projected.status,errors:projected.errors,warnings:projected.warnings},inquiries};
}
