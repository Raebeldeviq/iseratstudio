import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { assertBrowserCatalogTransition, assertCatalogProductionReady, mergeListingCollection } from '../listing-catalog-view.mjs';

const listing = { id:'listing-1', externalId:'TEST-1', status:'published', listingOrigin:'rotation-copy',
  importConfirmedAt:'2026-09-01T10:00:00Z', supersededByListingId:'listing-2', externalDeletionPending:true,
  creativeSelection:{heroImageId:'hero-1'}, texts:{title:'Original'}, version:2 };

test('manager integrates the full persisted catalog independently of the UI selection', async () => {
  const source = await readFile(new URL('../app/InseratStudio.tsx', import.meta.url), 'utf8');
  assert.match(source, /const managedListings = state\.projects\.flatMap/);
  assert.doesNotMatch(source, /const managedListings = selectedWorkflowProjects/);
  assert.match(source, /Zeitplan konfiguriert · Helper-Freigabe erforderlich/);
  assert.doesNotMatch(source, /ein Fehler stoppt niemals andere Inserate/);
});

test('active variant cannot duplicate a rotation copy or remove lifecycle provenance', () => {
  const result=mergeListingCollection([listing], [{id:listing.id, externalId:listing.externalId, listingOrigin:'group-source',status:'published'}]);
  assert.deepEqual(result,[listing]);
});
test('view roundtrip retains terminal listings and inactive source history', () => {
  const deleted={...listing,status:'deleted'};
  const other={id:'listing-2',externalId:'TEST-2',status:'published'};
  const result=mergeListingCollection([deleted,other],[listing,other]);
  assert.deepEqual(result,[deleted,other]);
  assert.deepEqual(mergeListingCollection(result,result),result);
});
test('new drafts and intentional draft edits remain available',()=>{
  const draft={...listing,status:'draft'};
  const changed={...draft,texts:{title:'Edited'}};
  assert.deepEqual(mergeListingCollection([draft],[changed]),[changed]);
  assert.deepEqual(mergeListingCollection([],[draft]),[draft]);
});
test('conflicting stored duplicates fail closed without changing input',()=>{
  const source=[listing,{...listing,status:'deleted'}];const before=structuredClone(source);
  assert.throws(()=>mergeListingCollection(source),{code:'CATALOG_LISTING_CONFLICT'});
  assert.deepEqual(source,before);
});
test('identical stored duplicates are collapsed and external identity cannot change',()=>{
  assert.deepEqual(mergeListingCollection([listing,structuredClone(listing)]),[listing]);
  assert.throws(()=>mergeListingCollection([listing],[{...listing,externalId:'OTHER'}]),{code:'CATALOG_LISTING_CONFLICT'});
});

test('legacy object number is migrated only for an untransferred draft with explicit reconciliation evidence',()=>{
  const legacyDraft={...listing,status:'draft',externalId:'FPI-PROJECT-V1-LEGACY',listingOrigin:'group-source',importConfirmedAt:'',
    templateId:'house-1',listingFacts:[{key:'energy_class',value:'A+',verified:true,evidenceKind:'energy_certificate'}],
    texts:{title:'Freigegebener Text'},promotionImageId:'image-1'};
  const migrated={...legacyDraft,externalId:'30460-70'};
  const result=mergeListingCollection([legacyDraft],[migrated],{
    allowDraftObjectNumberMigration:true,
    uploadHistory:[],
  });
  assert.equal(result[0].externalId,'30460-70');
  assert.deepEqual(result[0].objectNumberMigration,{
    kind:'legacy-draft-object-number-migration-v1',
    previousExternalId:'FPI-PROJECT-V1-LEGACY',
    externalId:'30460-70',
    evidence:'draft-without-lifecycle-or-upload-history',
  });
  assert.deepEqual(result[0].listingFacts,legacyDraft.listingFacts);
  assert.deepEqual(result[0].texts,legacyDraft.texts);
  assert.equal(result[0].promotionImageId,'image-1');
});

test('draft object number migration remains fail closed with lifecycle or upload evidence',()=>{
  const legacyDraft={...listing,status:'draft',externalId:'FPI-PROJECT-V1-LEGACY',listingOrigin:'group-source',templateId:'house-1',importConfirmedAt:''};
  const migrated={...legacyDraft,externalId:'30460-70'};
  const options={allowDraftObjectNumberMigration:true,uploadHistory:[{listingId:legacyDraft.id,status:'draft'}]};
  assert.throws(()=>mergeListingCollection([legacyDraft],[migrated],options),{code:'CATALOG_LISTING_CONFLICT'});
  assert.throws(()=>mergeListingCollection([{...legacyDraft,transferredAt:'2026-09-27T12:00:00Z'}],[migrated],{
    allowDraftObjectNumberMigration:true,
    uploadHistory:[],
  }),{code:'CATALOG_LISTING_CONFLICT'});
  assert.throws(()=>mergeListingCollection([legacyDraft],[{...migrated,templateId:'other-house'}],{
    allowDraftObjectNumberMigration:true,
    uploadHistory:[],
  }),{code:'CATALOG_LISTING_CONFLICT'});
});

test('stale browser saves cannot erase a lifecycle or resurrect a deleted listing',()=>{
 const current={projects:[{id:'project',listings:[{...listing,status:'deleted'}]}]};
 assert.throws(()=>assertBrowserCatalogTransition(current,{projects:[]}),{code:'CATALOG_LISTING_CONFLICT'});
 assert.throws(()=>assertBrowserCatalogTransition(current,{projects:[{id:'project',listings:[listing]}]}),{code:'CATALOG_LISTING_CONFLICT'});
 assert.doesNotThrow(()=>assertBrowserCatalogTransition(current,structuredClone(current)));
});

test('unresolved catalog repair blocks production and cannot be cleared by browser saves',()=>{
 const state={projects:[],catalogRepairReview:{automaticProductionAllowed:false,unresolved:[{id:'missing'}]}};
 assert.throws(()=>assertCatalogProductionReady(state),{code:'CATALOG_REPAIR_REVIEW_REQUIRED'});
 assert.throws(()=>assertBrowserCatalogTransition(state,{projects:[]}),{code:'CATALOG_LISTING_CONFLICT'});
 assert.throws(()=>assertCatalogProductionReady({...state,catalogRepairReview:{automaticProductionAllowed:true,unresolved:[{}]}}),{code:'CATALOG_REPAIR_REVIEW_REQUIRED'});
 assert.doesNotThrow(()=>assertCatalogProductionReady({projects:[]}));
 assert.doesNotThrow(()=>assertCatalogProductionReady({catalogRepairReview:{automaticProductionAllowed:true,unresolved:[]}}));
});
