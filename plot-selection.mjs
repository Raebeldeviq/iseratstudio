export function plotListingCountAppearance(value) {
  const count = Math.max(0, Math.trunc(Number(value) || 0));
  return {
    count,
    tone: count >= 4 ? "green" : count > 0 ? "yellow" : "neutral",
    detail: count > 4 ? "Mehr als 4 Inserate vorhanden" : "",
  };
}

/** UI eligibility only. Never archives plots or changes existing listings. */
export function plotAddressSelection(plot) {
  const street = String(plot?.street ?? '').trim();
  const normalized = street.toLocaleLowerCase('de-DE').replace(/ß/gu, 'ss');
  const hidden = /(?:nicht|keine?|ohne).*(?:öffentlich|veröffentlicht|bekannt|angegeben|angabe)|(?:adresse|anschrift|strasse).*(?:anfrage|unbekannt|folgt|fehlt)|auf\s+anfrage|wird.*(?:mitgeteilt|bekanntgegeben)|genaue.*lage.*(?:anfrage|unbekannt)/iu.test(normalized);
  if (!street || hidden || /^(?:[-–—?*x\s]+|unbekannt|k\.?\s*a\.?|n\/?a)$/iu.test(street)
    || /[*?]{2,}/u.test(street) || !/\p{L}/u.test(street)) {
    return {selectable:false, reason:'Keine öffentliche Straße – Adresse muss geprüft werden.', houseNumberUnconfirmed:false};
  }
  if (!/^\d{5}$/u.test(String(plot?.postalCode ?? plot?.zip ?? '').trim()) || !String(plot?.city ?? '').trim()) {
    return {selectable:false, reason:'Postleitzahl oder Ort fehlt – Adresse muss geprüft werden.', houseNumberUnconfirmed:false};
  }
  const embeddedNumber = street.match(/\s+(\d+[a-zA-Z]?(?:\s*[-/]\s*\d+[a-zA-Z]?)?)$/u)?.[1] || '';
  const number = String(plot?.houseNumber ?? '').trim() || embeddedNumber;
  return {selectable:plot?.isActive !== false, reason:plot?.isActive === false ? 'Grundstück ist inaktiv.' : '',
    houseNumberUnconfirmed:!number || /^0+$/u.test(number)};
}

export function selectablePlotIds(plots, requestedIds) {
  const eligible = new Set((plots || []).filter(plot => plotAddressSelection(plot).selectable).map(plot => plot.id));
  return [...new Set((requestedIds || []).filter(id => eligible.has(id)))];
}

export function selectablePlotProjects(plots, projects) {
  const eligible = new Set((plots || []).filter(plot => plotAddressSelection(plot).selectable).map(plot => plot.id));
  return (projects || []).filter(project => project.isActive !== false && (project.plotId
    ? eligible.has(project.plotId) : plotAddressSelection(project).selectable));
}
