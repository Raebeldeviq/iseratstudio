import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPlotMonitorImportService } from '../plot-monitor-import.mjs';

async function fixture(t, {review='Prüfung erforderlich', mutate=false, missingImages=false}={}) {
  const dir=await mkdtemp(join(tmpdir(),'monitor-import-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  let reads=0,staged=0,committed=0,discarded=0;
  const service=createPlotMonitorImportService({sourcePath:join(dir,'book.xlsx'),
    now:()=> '2026-10-16T10:00:00Z',
    readBytes:async()=>Buffer.from(mutate && ++reads>1?'changed':'original'),
    readSheet:async(_,name)=>name==='Suchgebiet'
      ? [['PLZ','Ort','Region','Aktiv'],...Array.from({length:50},(_,i)=>[String(14000+i),'Test','Test','Ja'])]
      : [['Postleitzahl','Ort','Straße','Größe (m²)','Preis (€)','Quelle','Inseratslink','Erstmals gefunden','Zuletzt geprüft','Status','Exposé-Dateiname','Interne ID','Fachprüfung'],
        ['14000','Test','Teststraße 3',600,100000,'Test','https://example.test/plot','2026-10-16','2026-10-16','Vorhanden','','id',review]],
    loadCatalog:async()=>({stored:true,savedAt:'before',state:{plots:[],projects:[]}}),
    stageCatalog:async value=>{assert.equal(value.protectLifecycle,true); staged++;return {missingImageIds:missingImages?['missing']:[]};},
    commitCatalog:async()=>{committed++;},discardCatalog:async()=>{discarded++;}});
  return {service,counts:()=>({staged,committed,discarded})};
}
test('preview reads only and keeps incomplete evidence out of catalog',async t=>{
  const f=await fixture(t);const p=await f.service.preview();assert.equal(p.skipped,1);assert.equal(p.created,0);assert.equal(p.mutationsPersisted,false);assert.equal(f.counts().staged,0);
});
test('reviewed import requires current preview and protects lifecycle',async t=>{
  const f=await fixture(t,{review:'Nachweise vollständig'});const p=await f.service.preview();assert.equal(p.created,1);
  await assert.rejects(f.service.apply({token:'stale'}),/Vorschau/);assert.equal(f.counts().staged,0);
  const result=await f.service.apply({token:p.token});assert.equal(result.mutationsPersisted,true);assert.equal(f.counts().committed,1);assert.equal(f.counts().discarded,1);
});
test('missing monitor metadata cannot use the legacy import path',async t=>{
  const f=await fixture(t,{review:''});await assert.rejects(f.service.preview(),/METADATA_REQUIRED/);assert.equal(f.counts().staged,0);
});
test('simultaneous workbook edits stop before staging',async t=>{
  const f=await fixture(t,{mutate:true});await assert.rejects(f.service.preview(),/Vorschau/);assert.equal(f.counts().staged,0);
});
test('missing images abort and discard staged catalog',async t=>{
  const f=await fixture(t,{review:'Nachweise vollständig',missingImages:true});const p=await f.service.preview();await assert.rejects(f.service.apply({token:p.token}),/IMAGES_MISSING/);assert.equal(f.counts().committed,0);assert.equal(f.counts().discarded,1);
});
