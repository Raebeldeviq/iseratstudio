import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createInitialStudioState} from '../studio-defaults.mjs';
import {normalizeListingGroup, listingControl} from '../listing-groups.mjs';
import {refillPoolFingerprint, adoptApprovedRefillPools, planSmartRefill, createSmartRefillUploadPlan} from '../smart-refill.mjs';
import {preparedRefillRows, filterPreparedRefillRows, selectFilteredRefillIds} from '../smart-refill-selection.mjs';
import {runSequentialBatchUpload, resetBatchJobRegistryForTests} from '../batch-upload.mjs';
import {createManualBatchResumptionPlan, reconcileCompletedManualBatchTransferInState} from '../manual-batch-upload.mjs';
import {replanDeleteBatchesForUpload, assertDeleteBatchUploadReady, addCalendarDays} from '../delete-batches.mjs';
import {createUploadJobLedger} from '../upload-job-ledger.mjs';

const at='2026-10-11T12:00:00Z';
function fixture(count=90){
 let s={...createInitialStudioState(),projects:[],plots:[],deleteBatches:[],uploadHistory:[],listingResetHistory:[],smartRefill:{version:2,credits:[],cycles:[],poolApprovals:[],cancellations:[]}};
 for(let i=0;i<count;i++){
  const a={street:'Teststraße',houseNumber:String(i+1),postalCode:'14469',city:'Potsdam',plotSizeSqm:600,purchasePrice:180000};
  const b={...a,houseNumber:String(i+101),plotSizeSqm:602,purchasePrice:181350};
  const plot={...a,id:`plot-${i}`,isActive:true,addressRotation:{poolA:a,poolB:b,poolBDetails:{plotSizeSqm:602,purchasePrice:181350}}};
  const p={id:`p-${i}`,plotId:plot.id,name:`Grundstück ${i}`,street:a.street,houseNumber:a.houseNumber,zip:a.postalCode,city:a.city,plotArea:600,plotPrice:180000,isActive:true,listings:[]};
  const position=i%4+1,old={id:`source-${i}`,externalId:`30460-${i+1}`,templateId:'old-house',templateName:'Alt',status:'deleted',externalDeletionPending:false,deletedAt:at,addressSnapshot:{plotId:plot.id,pool:'A',housePosition:position,address:a}};
  const batchId=`new-${i}`,due=addCalendarDays('2026-10-11',position+8);
  const credit={id:`credit-${i}`,batchId:`source-batch-${i}`,projectId:p.id,listingId:old.id,externalId:old.externalId,deletedAt:at};
  const next={id:`next-${i}`,externalId:`30460-${String(i+100).padStart(3,'0')}001`,templateId:'new-house',templateName:'Neu',version:1,status:'draft',rotationSourceListingId:old.id,refillSourceCreditId:credit.id,texts:{title:'Test'},addressSnapshot:{plotId:plot.id,pool:'B',cycle:1,housePosition:position,address:b,batchId,plannedDeletionDate:due}};
  p.listings=[old,next];p.listingGroup=normalizeListingGroup({schemaVersion:2,variants:[],listingControls:[{listingId:old.id,externalId:old.externalId,status:'deleted'}]},p.id,{now:at});
  s.plots.push(plot);s.projects.push(p);s.smartRefill.credits.push(credit);
  s.smartRefill.cycles.push({id:`cycle-${i}`,kind:'listing-replacement',plotId:plot.id,projectId:p.id,pool:'B',sourcePool:'A',sourceListingId:old.id,sourceExternalId:old.externalId,sourceHouseId:old.templateId,sourceHouseName:old.templateName,housePosition:position,cycle:1,fingerprint:refillPoolFingerprint(plot,'B'),listingIds:[next.id],creditIds:[credit.id],preparedAt:at});
  s.deleteBatches.push({id:batchId,number:i+100,cycle:1,completedAt:'',plannedDeletionDate:due,entries:[{batchId,listingId:next.id,projectId:p.id,externalId:next.externalId,index:1,housePosition:position,uploadDate:'2026-10-11',plannedDeletionDate:due,status:'planned',deletedAt:''}]});
 }
 return adoptApprovedRefillPools(s,at);
}
const ids=n=>Array.from({length:n},(_,i)=>`next-${i}`);
const scope=(s,selected)=>createSmartRefillUploadPlan(s,{selectedListingIds:selected});

test('empty, missing, unknown, and duplicate selections cannot open an upload queue',()=>{
 const s=fixture();for(const selected of [undefined,[],['unknown'],['next-0','next-0']])assert.throws(()=>scope(s,selected));
});
test('one and four selections produce exactly those IDs out of ninety prepared listings',()=>{
 const s=fixture(),before=structuredClone(s);for(const n of [1,4])assert.deepEqual(scope(s,ids(n)).plan.addresses.flatMap(a=>a.items.map(i=>i.listingId)),ids(n));assert.deepEqual(s,before);
});
test('search preserves hidden selections and bulk selection skips archive conflicts',()=>{
 const s=fixture(4);s.listingResetHistory=[{id:'archive',plotId:'plot-1',projectId:'p-1',listings:[{id:'archived-transfer',status:'transferred_pending_import'}]}];
 const rows=preparedRefillRows(s,planSmartRefill(s));assert.equal(rows[1].archiveCount,1);
 assert.deepEqual(filterPreparedRefillRows(rows,'30460-100001').map(r=>r.listing.id),['next-0']);
 assert.equal(filterPreparedRefillRows(rows,'Teststraße 101').length,1);
 assert.deepEqual(selectFilteredRefillIds(['next-3'],filterPreparedRefillRows(rows,'30460-100001')),['next-3','next-0']);
 assert.deepEqual(selectFilteredRefillIds([],rows),['next-0','next-2','next-3']);
 assert.deepEqual(selectFilteredRefillIds(['next-1'],rows),['next-1','next-0','next-2','next-3']);
});
test('corrected and deleted archives do not produce stale conflict hints',()=>{
 const s=fixture(1);s.listingResetHistory=[{plotId:'plot-0',listings:[{id:'a',status:'transferred_pending_import',inventoryCorrection:{active:true}},{id:'b',status:'deleted',transferredAt:at},{id:'c',status:'draft'}]}];
 assert.equal(preparedRefillRows(s,planSmartRefill(s))[0].archiveCount,0);
});
test('resumption cannot broaden the selection inside the same selected projects',()=>{
 const s=fixture(1);s.projects[0].listings.push({id:'unselected-draft',externalId:'30460-999001',status:'draft',version:1});
 const selected=scope(s,['next-0']);const resumed=createManualBatchResumptionPlan(s,selected.projectIds,{jobs:[]},{excludedListingIds:selected.excludedListingIds});
 assert.deepEqual(resumed.plan.addresses[0].items.map(i=>i.listingId),['next-0']);
});
test('queue rejects broadened or duplicated IDs before any simulated FTPS request',async()=>{
 const s=fixture(4),plan=scope(s,ids(4)).plan;let requests=0;
 await assert.rejects(runSequentialBatchUpload(plan,async()=>requests++,{allowedListingIds:['next-0']}),/überschreitet/u);
 const duplicate=structuredClone(scope(s,['next-0']).plan);duplicate.addresses[0].items.push(duplicate.addresses[0].items[0]);
 await assert.rejects(runSequentialBatchUpload(duplicate,async()=>requests++,{allowedListingIds:['next-0']}),/überschreitet/u);assert.equal(requests,0);
});
test('four simulated completed transfers preserve all eighty-six other successors and deleted sources',async()=>{
 resetBatchJobRegistryForTests();let s=fixture();const before=structuredClone(s),selected=scope(s,ids(4));
 const r=await runSequentialBatchUpload(selected.plan,async({item})=>{
  s=reconcileCompletedManualBatchTransferInState(s,{...item,ledgerStatus:'transferred_pending_import',transferredAt:at});
 },{allowedListingIds:ids(4)});
 assert.equal(r.successful,4);assert.equal(s.uploadHistory.length,4);assert.equal(planSmartRefill(s).preparedListingIds.length,86);
 for(let i=0;i<90;i++){assert.deepEqual(s.projects[i].listings[0],before.projects[i].listings[0]);if(i>=4)assert.deepEqual(s.projects[i],before.projects[i]);}
 assert.deepEqual(s.smartRefill,before.smartRefill);assert.deepEqual(s.listingResetHistory,before.listingResetHistory);
 for(let i=0;i<4;i++){assert.equal(s.projects[i].listings[1].status,'transferred_pending_import');assert.equal(s.projects[i].listings[1].importConfirmedAt,undefined);assert.equal(listingControl(s.projects[i].listingGroup,s.projects[i].listings[0]).status,'deleted');assert.equal(s.uploadHistory[i].address,`Teststraße ${i+101} 14469 Potsdam`);}
});
test('concurrent and repeated clicks never perform duplicate FTPS transfers',async()=>{
 resetBatchJobRegistryForTests();const plan=scope(fixture(1),ids(1)).plan;let calls=0,release;
 const wait=new Promise(resolve=>{release=resolve;});const first=runSequentialBatchUpload(plan,async()=>{calls++;await wait;},{allowedListingIds:ids(1)});
 const second=await runSequentialBatchUpload(plan,async()=>calls++,{allowedListingIds:ids(1)});assert.equal(second.failed,1);release();await first;
 const third=await runSequentialBatchUpload(plan,async()=>calls++,{allowedListingIds:ids(1)});assert.equal(third.failed,1);assert.equal(calls,1);
});
test('stored refill variant receives the completed status without reactivating its source',()=>{
 let s=fixture(1);const p=s.projects[0],copy=p.listings[1];p.listingGroup.variants=[{id:'variant',projectId:p.id,role:'variant',order:1,active:true,approved:true,templateId:copy.templateId,templateName:copy.templateName,houseSnapshot:{name:copy.templateName},listing:copy,createdAt:at,updatedAt:at}];
 const item=scope(s,['next-0']).plan.addresses[0].items[0];s=reconcileCompletedManualBatchTransferInState(s,{...item,ledgerStatus:'transferred_pending_import',transferredAt:at});
 assert.equal(s.projects[0].listingGroup.variants[0].listing.status,'transferred_pending_import');assert.equal(s.projects[0].listings[0].status,'deleted');
});
test('failed FTPS item is isolated; completed items are protected during retry and restart',async context=>{
 resetBatchJobRegistryForTests();const directory=await mkdtemp(join(tmpdir(),'selective-refill-ledger-'));context.after(()=>rm(directory,{recursive:true,force:true}));
 const ledger=createUploadJobLedger(join(directory,'jobs.json'));let s=fixture(4);const selected=scope(s,ids(4));
 const result=await runSequentialBatchUpload(selected.plan,async({item})=>{await ledger.claim(item,{now:at});if(item.listingId==='next-1'){await ledger.fail({...item,message:'simulierter FTPS-Fehler'});throw new Error('simulierter FTPS-Fehler');}const completed=await ledger.complete(item,{now:at});s=reconcileCompletedManualBatchTransferInState(s,{...item,ledgerStatus:completed.status,transferredAt:at});},{allowedListingIds:ids(4)});
 assert.equal(result.successful,3);assert.equal(result.failed,1);assert.equal(s.uploadHistory.length,3);assert.equal(s.projects[1].listings[1].status,'draft');
 assert.throws(()=>scope(s,['next-0']),/bereits übertragen/u);
 const restored=JSON.parse(JSON.stringify(s)),remaining=scope(restored,['next-1']);const resumed=createManualBatchResumptionPlan(restored,remaining.projectIds,await ledger.read(),{excludedListingIds:remaining.excludedListingIds});assert.deepEqual(resumed.plan.addresses.flatMap(a=>a.items.map(i=>i.listingId)),['next-1']);
 const done=selected.plan.addresses[0].items[0];assert.equal(reconcileCompletedManualBatchTransferInState(s,{...done,ledgerStatus:'transferred_pending_import',transferredAt:at}),s);
});
test('actual upload-day replan changes only selected successors and preserves +9/+10/+11/+12',()=>{
 let s=fixture();const before=structuredClone(s);s=replanDeleteBatchesForUpload(s,ids(4),'2026-10-15');
 for(let i=0;i<4;i++){const l=s.projects[i].listings[1];assert.equal(l.addressSnapshot.plannedDeletionDate,addCalendarDays('2026-10-15',i+9));assert.doesNotThrow(()=>assertDeleteBatchUploadReady(s,l,'2026-10-15'));assert.deepEqual(s.projects[i].listings[0],before.projects[i].listings[0]);}
 for(let i=4;i<90;i++)assert.deepEqual(s.projects[i],before.projects[i]);
 assert.deepEqual(s.smartRefill,before.smartRefill);assert.deepEqual(s.uploadHistory,before.uploadHistory);assert.equal(scope(s,ids(4)).plan.totalListings,4);
});
test('rendered selector starts empty with disabled upload, labeled checkboxes and archive hints',async()=>{
 const ts=await import('typescript'),{createElement}=await import('react'),{renderToStaticMarkup}=await import('react-dom/server');
 const url=new URL('../app/components/SmartRefillPanel.tsx',import.meta.url);const source=await readFile(url,'utf8');const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const resolved=compiled.replace(/from (["'])([^"']+)\1/g,(_,q,spec)=>`from ${JSON.stringify(spec.startsWith('.')?new URL(spec,url).href:import.meta.resolve(spec))}`);
 const {default:Component}=await import('data:text/javascript;base64,'+Buffer.from(resolved).toString('base64'));
 const s=fixture(2);s.listingResetHistory=[{plotId:'plot-1',listings:[{status:'transferred_pending_import'}]}];const html=renderToStaticMarkup(createElement(Component,{state:s,plan:planSmartRefill(s),online:true,busy:false,uploading:false,onCheck(){},onPrepare(){},onUpload(){},onApprove(){}}));
 assert.equal((html.match(/type="checkbox"/g)||[]).length,2);assert.doesNotMatch(html,/ checked/u);assert.match(html,/disabled="">0 ausgewählte Inserate hochladen/u);assert.match(html,/Archivbestand prüfen/u);assert.match(html,/Objektnummer oder Adresse/u);assert.match(html,/Abbrechen/u);assert.match(html,/Upload starten/u);
});
