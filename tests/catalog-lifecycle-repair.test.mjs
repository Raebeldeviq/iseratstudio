import assert from 'node:assert/strict';
import test from 'node:test';
import {planCatalogLifecycleRepair} from '../catalog-lifecycle-repair.mjs';
const listing={id:'b',externalId:'TEST-B',listingOrigin:'rotation-copy',rotationSourceListingId:'a',status:'published',texts:{title:'Original'},version:2};
const state=()=>({projects:[{id:'p',listings:[{...listing,listingOrigin:'group-source',rotationSourceListingId:undefined},listing],listingGroup:{variants:[{active:true,listing}],listingControls:[{listingId:'b',status:'published'}]}}]});
const proof=()=>({productionDelete:{jobs:[{status:'delete_confirmed',projectId:'p',sourceListingId:'b',externalObjectNumber:'TEST-B',deleteJobId:'delete-b',reportMessageId:'synthetic-report',reportHash:'a'.repeat(64),confirmedAt:'2026-09-02T12:00:00Z',providerProcessedAt:'2026-09-02T11:59:00Z'}]}});
test('repair restores only the positively confirmed target and is idempotent',()=>{
 const input=state();const evidence=proof();const before=structuredClone(input);const evidenceBefore=structuredClone(evidence);
 const plan=planCatalogLifecycleRepair(input,evidence,'2026-09-14T12:00:00Z');
 assert.deepEqual(plan.summary,{duplicatesRemoved:1,deletedRestored:1,unresolved:0});
 assert.equal(plan.state.projects[0].listings[0].status,'deleted');
 assert.equal(plan.state.projects[0].listingGroup.variants[0].active,false);
 assert.deepEqual(input,before);assert.deepEqual(evidence,evidenceBefore);
 assert.deepEqual(planCatalogLifecycleRepair(plan.state,evidence,'2026-09-14T13:00:00Z').state,plan.state);
});
test('ambiguous content, incomplete proof and identity mismatch all fail closed',()=>{
 const input=state();input.projects[0].listings[0].texts={title:'Changed'};
 assert.throws(()=>planCatalogLifecycleRepair(input,proof(),''),/NOT_RECONCILABLE/);
 const incomplete=proof();delete incomplete.productionDelete.jobs[0].reportHash;
 assert.throws(()=>planCatalogLifecycleRepair(state(),incomplete,''),/EVIDENCE_INCOMPLETE/);
 const wrong=proof();wrong.productionDelete.jobs[0].externalObjectNumber='OTHER';
 assert.throws(()=>planCatalogLifecycleRepair(state(),wrong,''),/IDENTITY/);
});
test('no external confirmation is inferred from a successful transfer',()=>{
 const evidence=proof();evidence.productionDelete.jobs[0].status='delete_pending_confirmation';
 assert.equal(planCatalogLifecycleRepair(state(),evidence,'').state.projects[0].listings[0].status,'published');
});
