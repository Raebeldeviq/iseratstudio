import assert from 'node:assert/strict';
import test from 'node:test';
import { assertBrowserCatalogTransition, assertCatalogProductionReady, mergeListingCollection } from '../listing-catalog-view.mjs';

const listing = { id:'listing-1', externalId:'TEST-1', status:'published', listingOrigin:'rotation-copy',
  importConfirmedAt:'2026-09-01T10:00:00Z', supersededByListingId:'listing-2', externalDeletionPending:true,
  creativeSelection:{heroImageId:'hero-1'}, texts:{title:'Original'}, version:2 };

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
