// Pure checks shared by the launcher, workbook update and regression tests.
const DAY = 86400000;
const text = value => String(value ?? '').trim();
const key = value => text(value).normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/ß/gu, 'ss').replace(/[^a-z0-9]/gu, '');
const iso = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/u.test(value) && Number.isFinite(Date.parse(value));

export const POLICY = Object.freeze({minimumSize:350, maximumSize:1400, minimumPricePerSqm:30,
  maximumPricePerSqm:1100, freshDays:7, maximumEvidenceAgeMs:DAY});
export const META_HEADERS = Object.freeze(['Aktualität','Fachprüfung','Prüfgründe','Letzter Prüfversuch']);

export function readActiveSources(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('SOURCE_REGISTER_MISSING');
  const headers = rows[0].map(key);
  const at = name => headers.indexOf(key(name));
  const n=at('Quelle'), a=at('Aktiv'), u=at('Start-/Alarm-URL'), t=at('Typ'), m=at('Zulässiger Zugriff');
  if ([n,a,u].some(i=>i<0)) throw new Error('SOURCE_REGISTER_HEADERS');
  const sources = rows.slice(1).filter(r=>key(r[a])==='ja').map(r=>({id:key(r[n]),name:text(r[n]),url:text(r[u]),type:text(r[t]),access:text(r[m])}));
  if (!sources.length || sources.some(s=>!s.id) || new Set(sources.map(s=>s.id)).size!==sources.length) throw new Error('SOURCE_REGISTER_INVALID');
  return sources;
}

export function validatePayload(value) {
  if (!value || typeof value!=='object' || !Array.isArray(value.sourceChecks) || !Array.isArray(value.offers)) throw new Error('INVALID_RUN_INPUT: sourceChecks und offers müssen Arrays sein.');
  const statuses = new Set(['ok','error','skipped','blocked']);
  for (const check of value.sourceChecks) {
    if (!check || !text(check.name) || !statuses.has(check.status)) throw new Error('INVALID_SOURCE_CHECK');
  }
  for (const offer of value.offers) {
    if (!offer || typeof offer.available!=='boolean' || !/^\d{5}$/u.test(text(offer.postalCode)) || !text(offer.city)
      || typeof offer.sizeSqm!=='number' || !Number.isFinite(offer.sizeSqm) || offer.sizeSqm<=0
      || typeof offer.priceEur!=='number' || !Number.isFinite(offer.priceEur) || offer.priceEur<=0
      || !text(offer.source) || !publicUrl(offer.listingUrl) || !text(offer.internalId)) throw new Error('INVALID_OFFER_INPUT');
  }
  return value;
}

export function publicUrl(value) {
  try {
    const u=new URL(value);
    return ['https:','http:'].includes(u.protocol) && !u.username && !u.password
      && !/^(?:localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|\[|.*\.local$)/iu.test(u.hostname);
  } catch {return false;}
}

export function concreteDetailUrl(value) {
  if(!publicUrl(value)) return false;
  const pathname=new URL(value).pathname;
  return !/^\/(?:[a-z]{2}\/?)?$/iu.test(pathname)
    && !/^\/(?:immobilien|angebote|grundstuecke|grundstücke|suche)\/?$/iu.test(pathname);
}

export function sourceCoverage(sources, checks, now=new Date().toISOString(), activePostalCodes=new Set()) {
  const seen=new Map();
  for (const check of checks) {
    const id=key(check.name);
    if (seen.has(id)) throw new Error('DUPLICATE_SOURCE_CHECK');
    seen.set(id,check);
  }
  const activeIds=new Set(sources.map(s=>s.id));
  const items=sources.map(s=>{
    const c=seen.get(s.id);
    let status=c?.status || 'not_checked';
    if (status==='ok' && (!iso(c.checkedAt) || Date.parse(c.checkedAt)>Date.parse(now)+300000
      || Date.parse(now)-Date.parse(c.checkedAt)>POLICY.maximumEvidenceAgeMs
      || !['detail_pages','public_search','notification','feed'].includes(c.method) || !text(c.note)
      || !Array.isArray(c.evidenceUrls) || !c.evidenceUrls.length || !c.evidenceUrls.every(publicUrl))) status='unverified';
    if(status==='ok' && /dynamisch/iu.test(s.type) && [...activePostalCodes].some(p=>!c.searchedPostalCodes?.includes(p))) status='unverified';
    return {...s,status,checkedAt:iso(c?.checkedAt)?c.checkedAt:'',method:text(c?.method),note:text(c?.note)};
  });
  const counts={expected:sources.length,successful:0,blocked:0,error:0,skipped:0,not_checked:0,unverified:0};
  for(const item of items) counts[item.status==='ok'?'successful':item.status]++;
  return {counts,items,unknownChecks:checks.filter(c=>!activeIds.has(key(c.name))).map(c=>text(c.name)),complete:counts.successful===counts.expected};
}

export function freshness(lastChecked, now=new Date().toISOString(), available=true) {
  const time=lastChecked instanceof Date?lastChecked.getTime():Date.parse(lastChecked);
  if (!Number.isFinite(time)) return 'Ungeprüft';
  // Excel stores calendar dates at noon UTC, not actual observation times.
  const day=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
  const age=(Date.parse(day(now))-Date.parse(day(time)))/DAY;
  if(age<0) return 'Ungeprüft';
  if (age>POLICY.freshDays) return 'Veraltet – erneut prüfen';
  return available?'Aktuell online bestätigt':'Aktuell nicht verfügbar bestätigt';
}

export function assessOffer(offer,{activePostalCodes,houseBuilders=[],now=new Date().toISOString()}={}) {
  const reasons=[];
  const rejected=[];
  if (!activePostalCodes?.has(text(offer.postalCode))) rejected.push('outside_search_area');
  if (offer.sizeSqm<POLICY.minimumSize || offer.sizeSqm>POLICY.maximumSize) rejected.push('size_outside_policy');
  const pricePerSqm=offer.priceEur/offer.sizeSqm;
  if (pricePerSqm<POLICY.minimumPricePerSqm || pricePerSqm>POLICY.maximumPricePerSqm) rejected.push('price_outside_policy');
  const detailEvidence=concreteDetailUrl(offer.listingUrl) && iso(offer.checkedAt) && Date.parse(offer.checkedAt)<=Date.parse(now)+300000
    && Date.parse(now)-Date.parse(offer.checkedAt)<=POLICY.maximumEvidenceAgeMs
    && text(offer.evidenceUrl)===text(offer.listingUrl) && text(offer.availabilityEvidence).length>=8;
  if (!detailEvidence) reasons.push('detail_evidence_missing_or_stale');
  // An inaccessible page cannot be treated as sold. Require a structured state and matching affirmative text.
  if (!offer.available) {
    const matches={sold:/\b(?:verkauft|sold)\b/iu,reserved:/\b(?:reserviert|reserved)\b/iu,
      removed:/\b(?:entfernt|deaktiviert|removed|deactivated|offline|nicht mehr verfügbar|not available)\b/iu};
    const proof=text(offer.availabilityEvidence);
    const negated=/\b(?:nicht|not|never|kein\w*)\s+(?:\w+\s+){0,2}(?:verkauft|sold|reserviert|reserved|entfernt|removed|deaktiviert|deactivated|offline)\b/iu.test(proof);
    if (!matches[offer.availabilityState]?.test(proof) || negated) reasons.push('offline_evidence_not_explicit');
    return {decision:rejected.length?'rejected':reasons.length?'review':'accepted',reasons:[...rejected,...reasons],pricePerSqm,detailEvidence};
  }
  const provider=text(offer.providerName);
  if (!provider || !publicUrl(offer.providerEvidenceUrl)) reasons.push('provider_unverified');
  const builder=houseBuilders.some(n=>key(n).length>=4 && key(provider).includes(key(n)))
    || /(?:fertighaus|hausbau|massivhaus|bauträger|bautraeger|projektbau|bauunternehmen)/iu.test(provider);
  if (builder || offer.offerType==='house_and_plot') rejected.push('house_builder_or_combined_offer');
  const excluded=new Set(['leasehold','lease','leisure','agricultural','forest','commercial','existing_building','demolition']);
  if (excluded.has(offer.offerType)) rejected.push('excluded_offer_type');
  else if (offer.offerType!=='residential_plot') reasons.push('residential_plot_not_verified');
  if (!(offer.brwEurPerSqm>0) || !publicUrl(offer.brwEvidenceUrl) || !['urban','rural'].includes(offer.locationType)) reasons.push('brw_or_location_unverified');
  else if (pricePerSqm>Math.min(POLICY.maximumPricePerSqm,offer.brwEurPerSqm*(offer.locationType==='rural'?2:1.5))) rejected.push('price_exceeds_brw_policy');
  if (!['b_plan','section_34'].includes(offer.buildabilityBasis) || !publicUrl(offer.buildabilityEvidenceUrl)) reasons.push('buildability_evidence_missing');
  if (!/\s[1-9]\d*[a-zA-Z]?(?:\s*[-/]\s*[1-9]\d*[a-zA-Z]?)?$/u.test(text(offer.street))) reasons.push('complete_address_missing');
  return {decision:rejected.length?'rejected':reasons.length?'review':'accepted',reasons:[...rejected,...reasons],pricePerSqm,detailEvidence};
}

export function nextAction(reasons=[]) {
  if (reasons.includes('outside_search_area')) return 'Außerhalb Suchgebiet – nur Historie erhalten';
  if (reasons.includes('detail_evidence_missing_or_stale')) return 'Konkrete öffentliche Detailseite erneut lesen';
  if (reasons.includes('provider_unverified')) return 'Tatsächlichen Inseratersteller anhand öffentlicher Quelle bestätigen';
  if (reasons.includes('complete_address_missing')) return 'Öffentliche Detailseite oder vorhandenes Exposé auf vollständige Adresse prüfen';
  if (reasons.includes('brw_or_location_unverified')) return 'Bodenrichtwert und Lageart mit Quelle nachtragen';
  if (reasons.includes('buildability_evidence_missing')) return 'Bebauungsplan oder §-34-Nachweis belegen';
  return 'Angebot anhand Prüfgründen fachlich beurteilen';
}

export function reasonText(reason) {
  return ({outside_search_area:'Außerhalb des aktiven Suchgebiets',size_outside_policy:'Größe außerhalb 350–1.400 m²',
    price_outside_policy:'Preis außerhalb 30–1.100 €/m²',detail_evidence_missing_or_stale:'Aktueller Beleg der konkreten Detailseite fehlt',
    offline_evidence_not_explicit:'Nichtverfügbarkeit nicht ausdrücklich belegt',provider_unverified:'Tatsächlicher Anbieter nicht belegt',
    house_builder_or_combined_offer:'Hausbaufirma oder kombiniertes Haus-Grundstück-Angebot',excluded_offer_type:'Ausgeschlossene Grundstücksart',
    residential_plot_not_verified:'Eigenständiges Wohnbaugrundstück nicht belegt',brw_or_location_unverified:'Bodenrichtwert oder Lageart nicht belegt',
    price_exceeds_brw_policy:'Preis über der lageabhängigen Bodenrichtwertgrenze',buildability_evidence_missing:'Bebauungsplan oder §-34-Nachweis fehlt',
    complete_address_missing:'Vollständige Anschrift einschließlich Hausnummer fehlt',legacy_review_required:'Bestehender Prüffall offen'})[reason] || 'Fachliche Prüfung erforderlich';
}

export function reviewReasonFromLegacy(value) {
  if (/hausnummer\s*0/iu.test(text(value))) return ['complete_address_missing'];
  if (/adresse|anschrift|hausnummer/iu.test(text(value))) return ['complete_address_missing'];
  return ['legacy_review_required'];
}
