import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { INTERIOR_SET_IDS, INTERIOR_SET_ROLES, interiorSetStatus, assignInteriorSet, assignNewInteriorListings, listingInteriorImages } from '../interior-sets.mjs';
import { startCatalogSnapshot, saveCatalogImage, commitCatalogSnapshot, loadCatalogManifest, loadCatalogImage } from '../catalog-store.mjs';
function fixture() {
  const interiorAssets = INTERIOR_SET_IDS.flatMap(set => INTERIOR_SET_ROLES.map(role => ({id: `${set}-${role}`, role, name: `${set}-${role}.jpg`, mimeType: 'image/jpeg', dataUrl: 'data:image/jpeg;base64,YQ==', caption: role, isFloorplan: false})));
  const interiorSets = Object.fromEntries(INTERIOR_SET_IDS.map(set => [set, Object.fromEntries(INTERIOR_SET_ROLES.map(role => [role, `${set}-${role}`]))]));
  return {version: 1, provider: {}, houses: [], projects: [], interiorAssets, interiorSets};
}
for (const set of INTERIOR_SET_IDS) test(`set ${set} requires all six correct assets`, () => {
  const state = fixture(); assert.equal(interiorSetStatus(state,set).complete,true);
  delete state.interiorSets[set].office;
  assert.deepEqual(interiorSetStatus(state,set),{complete:false,missing:['office']});
});
test('rotation A B C A skips incomplete sets and resumes deterministically', () => {
  let state = fixture();
  const sequence = [];
  for(let i=0;i<4;i++) {const result=assignInteriorSet(state,{id:String(i)});state=result.state;sequence.push(result.listing.interiorSet);}
  assert.deepEqual(sequence,['A','B','C','A']);
  delete state.interiorSets.B.office;
  const next=assignInteriorSet(state,{id:'next'});assert.equal(next.listing.interiorSet,'C');
  next.state.interiorSets.B.office='B-office';
  assert.equal(assignInteriorSet(next.state,{id:'last'}).listing.interiorSet,'A');
});
test('assignment survives serialization, regeneration and asset replacement', () => {
  const {state,listing}=assignInteriorSet(fixture(),{id:'new'});
  state.interiorSets.A.office='B-office';
  const restored=JSON.parse(JSON.stringify({state,listing}));
  assert.deepEqual(assignInteriorSet(restored.state,restored.listing).listing,listing);
  assert.equal(listingInteriorImages(restored.state,{images:[]},restored.listing)[5].id,'A-office');
});
test('new generation leaves old listings unchanged and synchronizes variant references', () => {
  const state=fixture();const old={id:'old'};state.projects=[{id:'p',listings:[old]}];
  const fresh={id:'fresh'};const next={...state,projects:[{id:'p',listings:[old,fresh],listingGroup:{variants:[{listing:fresh}]}}]};
  const result=assignNewInteriorListings(state,next);
  assert.equal(result.projects[0].listings[0],old);
  assert.equal(result.projects[0].listings[1].interiorSet,'A');
  assert.equal(result.projects[0].listingGroup.variants[0].listing,result.projects[0].listings[1]);
  assert.deepEqual(assignNewInteriorListings(result,result),result);
});
test('new copies advance rotation independently of source sets', () => {
  const initial=assignInteriorSet(fixture(),{id:'source'});initial.state.projects=[{id:'p',listings:[initial.listing]}];
  const result=assignNewInteriorListings(initial.state,{...initial.state,projects:[{id:'p',listings:[initial.listing,{...initial.listing,id:'copy'}]}]});
  assert.equal(result.projects[0].listings[1].interiorSet,'B');assert.equal(initial.listing.interiorSet,'A');
});
test('set images stay in one block and existing image roles keep their order', () => {
  const {state,listing}=assignInteriorSet({...fixture(),interiorRotationLastSet:'A'},{id:'b'});
  const roles=['qr','cover','kitchen','emotion','floorplan_ground','awards','trust'];
  const house={images:roles.map(role=>({id:role,role}))};
  const images=listingInteriorImages(state,house,listing);
  assert.deepEqual(images.map(x=>x.role),['cover',...INTERIOR_SET_ROLES,'emotion','floorplan_ground','awards','trust','qr']);
  assert.ok(images.slice(1,7).every(x=>x.id.startsWith('B-')));
  assert.equal(listingInteriorImages(state,house,{id:'legacy'}).find(x=>x.role==='kitchen').id,'kitchen');
  state.interiorAssets=state.interiorAssets.filter(x=>x.id!=='B-office');assert.throws(()=>listingInteriorImages(state,house,listing),/fehlt/);
});
test('no complete set does not silently assign a partial set', () => {
  const state=fixture();state.interiorSets={};const listing={id:'new'};
  assert.equal(assignInteriorSet(state,listing).listing,listing);
});
test('catalog stores global assets once and keeps listing references on reload', async () => {
  const root=await mkdtemp(join(tmpdir(),'interior-sets-'));
  try {
    let state=fixture();const a=assignInteriorSet(state,{id:'one'});state=a.state;
    const b=assignInteriorSet(state,{id:'two'});state=b.state;
    state.projects=[{id:'p',listings:[a.listing,b.listing,{...a.listing,id:'shared'}]}];
    await startCatalogSnapshot({state,sessionId:'test',savedAt:'2026-09-30T12:00:00Z',expectedSavedAt:''},root);
    for(const image of state.interiorAssets) await saveCatalogImage({sessionId:'test',imageId:image.id,data:Buffer.from('a')},root);
    await commitCatalogSnapshot('test',root);
    const loaded=await loadCatalogManifest(root);
    assert.deepEqual(loaded.state.projects[0].listings.map(({id, interiorSet, interiorAssetIds}) => ({id, interiorSet, interiorAssetIds})),state.projects[0].listings.map(({id, interiorSet, interiorAssetIds}) => ({id, interiorSet, interiorAssetIds})));
    assert.ok(loaded.state.interiorAssets.every(x=>x.dataUrl===''));
    assert.equal((await readdir(join(root,'images'))).length,18);
    assert.ok(await loadCatalogImage('A-office',root));
  } finally {await rm(root,{recursive:true,force:true});}
});

test('new prepared drafts prefer the complete global set while saved drafts retain legacy images', () => {
  const state = fixture();
  const legacy = { id: 'saved-draft', status: 'draft' };
  state.projects = [{ id: 'p', listings: [legacy] }];
  const house = { images: ['cover', ...INTERIOR_SET_ROLES, 'floorplan_ground', 'emotion', 'awards', 'trust', 'qr'].map(role => ({ id: `legacy-${role}`, role })) };
  const next = assignNewInteriorListings(state, { ...state, projects: [{ id: 'p', listings: [legacy, { id: 'new-prepared-draft', status: 'draft' }] }] });
  const [old, fresh] = next.projects[0].listings;
  assert.equal(old, legacy);
  assert.equal(fresh.interiorSet, 'A');
  const sequence = listingInteriorImages(next, house, fresh);
  assert.equal(sequence.filter(image => INTERIOR_SET_ROLES.includes(image.role)).length, 6);
  assert.ok(sequence.filter(image => INTERIOR_SET_ROLES.includes(image.role)).every(image => image.id.startsWith('A-')));
  assert.ok(sequence.filter(image => !INTERIOR_SET_ROLES.includes(image.role)).every(image => house.images.includes(image)));
  assert.ok(listingInteriorImages(next, house, old).some(image => image.id === 'legacy-office'));
});
