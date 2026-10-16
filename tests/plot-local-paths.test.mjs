import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertLocalPlotPath, LOCAL_PLOT_DIRECTORY } from '../plot-local-paths.mjs';
import { previewLocalPlotInquiries } from '../plot-inquiry-preview.mjs';

test('local defaults never refer to iCloud, Documents, or Desktop', async () => {
  assert.match(LOCAL_PLOT_DIRECTORY, /Application Support/);
  await assertLocalPlotPath(LOCAL_PLOT_DIRECTORY);
});

test('cloud roots and symlink aliases fail closed, including absent descendants', async t => {
  const root = await mkdtemp(join(tmpdir(), 'local-plot-path-'));
  t.after(() => rm(root, {recursive:true,force:true}));
  const home = join(root,'home');
  for (const sub of ['Documents','Desktop','Library/Mobile Documents','Library/CloudStorage']) {
    const cloud = join(home,sub);
    await mkdir(cloud,{recursive:true});
    await assert.rejects(assertLocalPlotPath(join(cloud,'missing','test.xlsx'), home), /CLOUD_PATH_FORBIDDEN/);
  }
  const alias=join(root,'alias');
  await symlink(join(home,'Library/Mobile Documents'),alias);
  await assert.rejects(assertLocalPlotPath(join(alias,'missing','test.xlsx'),home), /CLOUD_PATH_FORBIDDEN/);
  assert.equal(await assertLocalPlotPath(join(root,'local','test.xlsx'),home),join(root,'local','test.xlsx'));
});

const area = [['Postleitzahl','Aktiv'],...Array.from({length:50},(_,i)=>[String(10000+i),'Ja'])];
const headers = ['Postleitzahl','Ort','Straße','Größe (m²)','Preis (€)','Quelle','Inseratslink','Erstmals gefunden','Zuletzt geprüft','Status','Exposé-Dateiname','Interne ID'];
function previewOptions(overrides={}) {
  return {sourcePath:join(tmpdir(),'synthetic-local-plots.xlsx'),
    readBytes:async()=>Buffer.from('synthetic fixture only'),
    readWorkbook:async(_path,sheet)=>sheet==='Suchgebiet'?area:[headers],
    loadCatalog:async()=>({stored:true,state:{plots:[],projects:[],houses:[]}}),
    createWorkflow:()=>({preview:async()=>({preview:true,mutationsPersisted:false})}),
    ...overrides};
}

test('preview reads explicitly named sheets and only invokes read-only workflow', async()=>{
  const sheets=[];
  const result=await previewLocalPlotInquiries(previewOptions({readWorkbook:async(_path,sheet)=>{
    sheets.push(sheet); return sheet==='Suchgebiet'?area:[headers];
  }}));
  assert.deepEqual(sheets,['Suchgebiet','Grundstücke']);
  assert.equal(result.activePostalCodeCount,50);
  assert.equal(result.mutationsPersisted,false);
  assert.equal(result.inquiries.mutationsPersisted,false);
});

test('preview rejects a changed source and incomplete search area', async()=>{
  let reads=0;
  await assert.rejects(previewLocalPlotInquiries(previewOptions({readBytes:async()=>Buffer.from(String(reads++))})),/SOURCE_CHANGED_DURING_READ/);
  await assert.rejects(previewLocalPlotInquiries(previewOptions({readWorkbook:async()=>area.slice(0,3)})),/exakt 50/);
});
