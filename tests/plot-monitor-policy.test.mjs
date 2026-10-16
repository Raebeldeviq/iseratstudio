import assert from 'node:assert/strict';
import test from 'node:test';
import {readActiveSources,validatePayload,sourceCoverage,assessOffer,freshness,nextAction} from '../Grundstuecksmonitor/policy.mjs';
const now='2026-10-16T10:00:00.000Z';
const activePostalCodes=new Set(['14469']);
const offer=()=>({postalCode:'14469',city:'Musterstadt',street:'Musterweg 12',sizeSqm:700,priceEur:280000,
  source:'Musterquelle',listingUrl:'https://example.test/offer/123',internalId:'123',available:true,
  availabilityEvidence:'Wohnbaugrundstück ist verfügbar',checkedAt:now,evidenceUrl:'https://example.test/offer/123',
  providerName:'Muster Immobilien GmbH',providerEvidenceUrl:'https://example.test/impressum',offerType:'residential_plot',
  brwEurPerSqm:300,brwEvidenceUrl:'https://example.test/brw',locationType:'urban',
  buildabilityBasis:'b_plan',buildabilityEvidenceUrl:'https://example.test/b-plan'});
const assess=o=>assessOffer({...offer(),...o},{activePostalCodes,now});

test('only fully evidenced offers enter the working list',()=>{
  assert.equal(assess({}).decision,'accepted');
  for(const [field,value,reason] of [['street','Musterweg 0','complete_address_missing'],
    ['brwEurPerSqm',undefined,'brw_or_location_unverified'],['buildabilityBasis',undefined,'buildability_evidence_missing'],
    ['providerName','','provider_unverified'],['checkedAt','2026-09-01T10:00:00Z','detail_evidence_missing_or_stale']]) {
    const result=assess({[field]:value});assert.equal(result.decision,'review');assert.ok(result.reasons.includes(reason));
  }
  assert.equal(assess({listingUrl:'https://example.test/',evidenceUrl:'https://example.test/'}).decision,'review');
});
test('size, absolute price, BRW and excluded offer types are enforced',()=>{
  for(const overrides of [{sizeSqm:349},{sizeSqm:1401},{priceEur:800000},{brwEurPerSqm:200},
    {offerType:'leasehold'},{offerType:'existing_building'},{providerName:'Muster Fertighaus GmbH'}]) assert.equal(assess(overrides).decision,'rejected');
  assert.equal(assess({brwEurPerSqm:200,locationType:'rural'}).decision,'accepted');
  assert.equal(assess({postalCode:'99999'}).decision,'rejected');
});
test('offline status requires affirmative matching evidence, not HTTP errors or negation',()=>{
  assert.equal(assess({available:false,availabilityState:'sold',availabilityEvidence:'Dieses Angebot ist verkauft.'}).decision,'accepted');
  for(const proof of ['HTTP 403 Zugriff gesperrt','Das Grundstück ist nicht verkauft.','not yet sold']) assert.equal(assess({available:false,availabilityState:'sold',availabilityEvidence:proof}).decision,'review');
});
test('registry coverage separates unavailable, skipped, missing and unsupported claims',()=>{
  const sources=readActiveSources([['Quelle','Aktiv','Start-/Alarm-URL','Typ','Zulässiger Zugriff'],
    ['A','Ja','https://example.test','Makler','Detailseite'],['B','Ja','https://example.org','Makler','Detailseite'],
    ['C','Nein','','','']]);
  const c=sourceCoverage(sources,[{name:'A',status:'ok',checkedAt:now,method:'detail_pages',note:'Detailseite gelesen',evidenceUrls:['https://example.test/offer/1']},
    {name:'B',status:'blocked'}],now);
  assert.equal(c.complete,false);assert.equal(c.counts.successful,1);assert.equal(c.counts.blocked,1);
  assert.equal(sourceCoverage(sources,[],now).counts.not_checked,2);
  assert.equal(sourceCoverage(sources,[{name:'A',status:'ok'}],now).counts.unverified,1);
  assert.throws(()=>sourceCoverage(sources,[{name:'A'},{name:'A'}],now),/DUPLICATE/);
});
test('dynamic source completeness requires every active postal code',()=>{
  const sources=[{id:'a',name:'A',type:'Dynamische Websuche'}];
  const check={name:'A',status:'ok',checkedAt:now,method:'public_search',note:'Suchergebnisse gelesen',evidenceUrls:['https://example.test/results']};
  assert.equal(sourceCoverage(sources,[check],now,activePostalCodes).complete,false);
  assert.equal(sourceCoverage(sources,[{...check,searchedPostalCodes:['14469']}],now,activePostalCodes).complete,true);
});
test('invalid boolean/empty payload fails before a mutation',()=>{
  assert.throws(()=>validatePayload({}),/INVALID_RUN_INPUT/);
  assert.throws(()=>validatePayload({sourceChecks:[],offers:[{...offer(),available:'false'}]}),/INVALID_OFFER/);
  assert.equal(validatePayload({sourceChecks:[],offers:[offer()]}).offers.length,1);
});
test('freshness uses verified date rather than import time, and review has a next action',()=>{
  assert.equal(freshness('2026-09-17',now),'Veraltet – erneut prüfen');
  assert.equal(freshness(now,now),'Aktuell online bestätigt');
  assert.equal(freshness(new Date('2026-10-16T12:00:00Z'),now),'Aktuell online bestätigt');
  assert.equal(freshness(new Date('2026-10-17T12:00:00Z'),now),'Ungeprüft');
  assert.equal(freshness(null,now),'Ungeprüft');
  assert.match(nextAction(['complete_address_missing']),/Adresse/);
});
