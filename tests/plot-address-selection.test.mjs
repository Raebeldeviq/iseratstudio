import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { plotAddressSelection, selectablePlotIds, selectablePlotProjects } from '../plot-selection.mjs';

const plot = (id, street, extra={}) => ({id, street, houseNumber:'4', postalCode:'12345', city:'Testort', isActive:true,...extra});

test('unknown, masked, absent and non-public streets cannot be selected', () => {
  for (const street of ['', 'Adresse nicht öffentlich angegeben', 'Adresse auf Anfrage', 'Straße unbekannt', 'Keine Angabe', 'Auf Anfrage', '***', 'Unbekannt', '---', 'Straße wird auf Anfrage mitgeteilt']) {
    assert.equal(plotAddressSelection(plot('hidden',street)).selectable,false,street);
  }
  assert.equal(plotAddressSelection(plot('missing-postal','Teststraße',{postalCode:''})).selectable,false);
  assert.equal(plotAddressSelection(plot('missing-city','Teststraße',{city:''})).selectable,false);
  assert.equal(plotAddressSelection(plot('inactive','Teststraße',{isActive:false})).selectable,false);
});

test('a public street remains selectable; zero or absent house numbers have an explicit warning',()=>{
  assert.deepEqual(plotAddressSelection(plot('real','Teststraße')),{selectable:true,reason:'',houseNumberUnconfirmed:false});
  for (const houseNumber of ['0','']) assert.equal(plotAddressSelection(plot('review','Teststraße',{houseNumber})).houseNumberUnconfirmed,true);
  assert.equal(plotAddressSelection(plot('embedded','Teststraße 0',{houseNumber:''})).houseNumberUnconfirmed,true);
  assert.equal(plotAddressSelection(plot('embedded','Teststraße 12a',{houseNumber:''})).houseNumberUnconfirmed,false);
});

test('select-all and persisted selections exclude review, inactive, missing and duplicate IDs',()=>{
  const plots=[plot('ready','Teststraße'),plot('hidden','Adresse nicht öffentlich angegeben'),plot('inactive','Andere Straße',{isActive:false})];
  assert.deepEqual(selectablePlotIds(plots,['hidden','ready','ready','unknown','inactive']),['ready']);
  assert.deepEqual(selectablePlotIds(plots,plots.map(p=>p.id)),['ready']);
});

test('no fallback resurrects hidden or dangling projects when every saved selection is blocked',()=>{
  const plots=[plot('hidden','Auf Anfrage')];
  const projects=[{id:'linked',plotId:'hidden',street:'Old stale public street',zip:'12345',city:'Testort'},
    {id:'dangling',plotId:'absent',street:'Teststraße',zip:'12345',city:'Testort'},
    {id:'legacy-hidden',street:'Auf Anfrage',zip:'12345',city:'Testort'}];
  assert.deepEqual(selectablePlotProjects(plots,projects),[]);
  assert.equal(selectablePlotProjects([], [{id:'legacy-public',street:'Teststraße',zip:'12345',city:'Testort'}]).length,1);
});

test('selection changes never delete or rewrite published listings, even without an Excel entry',()=>{
  const state={plots:[plot('hidden','Auf Anfrage'),plot('public-not-in-excel','Teststraße')],
    selectedPlotIds:['hidden'],projects:[
      {id:'p-hidden',plotId:'hidden',listings:[{id:'live-hidden',status:'published',externalId:'TEST-1',lastUploadedAt:'2026-09-01T00:00:00Z'}]},
      {id:'p-retained',plotId:'public-not-in-excel',listings:[{id:'live-retained',status:'published',externalId:'TEST-2'}]},
    ],scheduler:{runs:[{id:'historical-run'}]},uploadHistory:[{id:'history'}]};
  const before=structuredClone(state);
  assert.deepEqual(selectablePlotIds(state.plots,state.selectedPlotIds),[]);
  assert.deepEqual(selectablePlotProjects(state.plots,state.projects).map(p=>p.id),['p-retained']);
  assert.deepEqual(state,before);
  assert.equal(state.projects.flatMap(p=>p.listings).filter(l=>l.status==='published').length,2);
});

test('rendered normal selection hides non-public cards and labels house-number placeholders',async()=>{
  const ts=await import('typescript');
  const {createElement}=await import('react');
  const {renderToStaticMarkup}=await import('react-dom/server');
  const componentUrl=new URL('../app/components/PlotManagement.tsx',import.meta.url);
  const source=await readFile(componentUrl,'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
  const resolved=compiled.replace(/from (["'])([^"']+)\1/g,(_match,_quote,specifier)=>{
    const location=specifier.startsWith('.')?new URL(specifier+(specifier==='../lib/address-import'?'.ts':''),componentUrl).href:import.meta.resolve(specifier);
    return `from ${JSON.stringify(location)}`;
  });
  const {default:Component}=await import('data:text/javascript;base64,'+Buffer.from(resolved).toString('base64'));
  const html=renderToStaticMarkup(createElement(Component,{
    plots:[plot('ready','Sichtbare Teststraße',{houseNumber:'0'}),plot('hidden','Adresse nicht öffentlich angegeben')],
    selectedPlotIds:[],defaultOwner:'pascal',helperOnline:false,helperRequest:()=>{throw new Error('No requests during render');},
    linkedProjectCounts:{hidden:1},selectionMeta:{hidden:{listingCount:1,regionLabel:'Test',uploadDate:''}},
    syncStatus:null,syncBusy:false,onSelectionChange:()=>{},onSave:()=>{},onDelete:()=>{throw new Error('No deletion');},onSync:()=>{},onScheduleChange:()=>{},
  }));
  assert.match(html,/Sichtbare Teststraße/);
  assert.match(html,/Hausnummer unbestätigt/);
  assert.match(html,/Müssen geprüft werden/);
  assert.doesNotMatch(html,/Adresse nicht öffentlich angegeben/);
  assert.equal((html.match(/type="checkbox"/g)||[]).length,1);
});
