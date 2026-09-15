import test from 'node:test';
import assert from 'node:assert/strict';
import {PLOT_SYNC_CONFIG} from '../plot-sync-config.mjs';
import {DEFAULT_MEDIA_LIBRARY_ROOT,DEFAULT_INTERIOR_LIBRARY_ROOT} from '../media-library.mjs';
test('default working inputs and bundled media have no implicit iCloud dependency',()=>{
 if(!process.env.FPI_PLOT_SYNC_SOURCE_PATH) {
  assert.match(PLOT_SYNC_CONFIG.sourcePath,/inputs\/KI_Grundstuecke\.xlsx$/);
  assert.doesNotMatch(PLOT_SYNC_CONFIG.sourcePath,/Mobile Documents|CloudDocs/);
 }
 for(const p of [DEFAULT_MEDIA_LIBRARY_ROOT,DEFAULT_INTERIOR_LIBRARY_ROOT]) assert.doesNotMatch(p,/Mobile Documents|CloudDocs/);
});
