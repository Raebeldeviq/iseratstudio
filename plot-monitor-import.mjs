import { createHash, randomUUID } from 'node:crypto';
import { readFile, open, rm } from 'node:fs/promises';
import { readSheet } from 'read-excel-file/node';
import { loadCatalogManifest, startCatalogSnapshot, commitCatalogSnapshot, discardCatalogSnapshot } from './catalog-store.mjs';
import { applyPlotSyncRows, parsePlotSyncRows } from './plot-excel-sync.mjs';
import { parseActivePostalCodes } from './plot-search-area.mjs';
import { assertLocalPlotPath } from './plot-local-paths.mjs';
import { PLOT_SYNC_CONFIG } from './plot-sync-config.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const changed = () => Object.assign(new Error('Excel oder Katalog seit der Vorschau geändert. Vorschau wiederholen.'), {code:'MONITOR_IMPORT_CHANGED',httpStatus:409});

export function createPlotMonitorImportService(options = {}) {
  const sourcePath = options.sourcePath || PLOT_SYNC_CONFIG.sourcePath;
  const bytes = options.readBytes || readFile;
  const sheet = options.readSheet || readSheet;
  const catalog = options.loadCatalog || loadCatalogManifest;
  const stage = options.stageCatalog || startCatalogSnapshot;
  const commit = options.commitCatalog || commitCatalogSnapshot;
  const discard = options.discardCatalog || discardCatalogSnapshot;
  const now = options.now || (()=>new Date().toISOString());
  let running = false;
  async function load() {
    await assertLocalPlotPath(sourcePath);
    const before = hash(await bytes(sourcePath));
    const active = parseActivePostalCodes(await sheet(sourcePath,'Suchgebiet'),{expectedCount:50});
    const rows = parsePlotSyncRows(await sheet(sourcePath,'Grundstücke'));
    if (!rows.length || rows.some(row=>!row.monitorReview)) throw new Error('MONITOR_METADATA_REQUIRED');
    const manifest = await catalog();
    if (!manifest.stored || !manifest.state) throw new Error('MONITOR_CATALOG_MISSING');
    const eligible = rows.filter(row=>active.has(row.postalCode));
    const result = applyPlotSyncRows(manifest.state,eligible,{now:now()});
    result.stats.skipped += rows.length-eligible.length;
    if(hash(await bytes(sourcePath))!==before) throw changed();
    return {before,manifest,result,token:hash(`${before}:${manifest.savedAt}:${hash(JSON.stringify(manifest.state))}`)};
  }
  const summary = data => ({token:data.token,sourceSha256:data.before,activePostalCodeCount:50,
    ...data.result.stats,status:data.result.status,errors:data.result.errors,warnings:data.result.warnings});
  async function preview() { return {...summary(await load()),mutationsPersisted:false}; }
  async function apply(input={}) {
    if(running) throw changed();
    running=true;
    let handle,sessionId;
    const lockPath=`${sourcePath}.monitor-import.lock`;
    try {
      handle=await open(lockPath,'wx',0o600);
      const data=await load();
      if(!input.token || input.token!==data.token) throw changed();
      if(data.result.status==='failed') throw new Error('MONITOR_IMPORT_FAILED');
      sessionId=`monitor_import_${randomUUID().replaceAll('-','_')}`;
      const savedAt=now();
      const staged=await stage({sessionId,savedAt,expectedSavedAt:data.manifest.savedAt||'',state:data.result.state,protectLifecycle:true});
      if(staged.missingImageIds?.length) throw new Error('MONITOR_IMAGES_MISSING');
      if(hash(await bytes(sourcePath))!==data.before) throw changed();
      await commit(sessionId);
      return {...summary(data),mutationsPersisted:true,catalogSavedAt:savedAt};
    } finally {
      try { if(sessionId) await discard(sessionId); }
      finally { if(handle) { await handle.close(); await rm(lockPath); } running=false; }
    }
  }
  return {preview,apply};
}
