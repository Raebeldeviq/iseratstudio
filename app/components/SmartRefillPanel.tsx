"use client";
import { useEffect, useRef, useState } from 'react';
import { preparedRefillRows, filterPreparedRefillRows, selectFilteredRefillIds } from '../../smart-refill-selection.mjs';
import type { RefillPlan, RefillPool } from "../../smart-refill.mjs";
import type { StudioState } from "../types";

type Props = {
  plan: RefillPlan; state: StudioState; busy: boolean; online: boolean; uploading: boolean;
  onCheck: () => void; onPrepare: () => void; onUpload: (listingIds: string[]) => void;
  onApprove: (plotId: string, pool: RefillPool) => void;
};

export default function SmartRefillPanel({ plan, state, busy, online, uploading, onCheck, onPrepare, onUpload, onApprove }: Props) {
  const disabled = busy || uploading || !online;
  const [search, setSearch] = useState('');
  const [selection, setSelection] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState<string[] | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const rows = preparedRefillRows(state, plan);
  const filtered = filterPreparedRefillRows(rows, search);
  const selected = selection.filter(id => rows.some(row => row.listing.id === id));
  const hiddenSelected = selected.filter(id => !filtered.some(row => row.listing.id === id)).length;
  useEffect(() => {
    if (confirmation && !dialog.current?.open) dialog.current?.showModal();
    else if (!confirmation && dialog.current?.open) dialog.current.close();
  }, [confirmation]);
  const formatPrice = (value: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value);
  return <div className="content-card smart-refill-panel" aria-busy={busy || uploading}>
    <div className="section-heading"><div><h2>Nachschub &amp; Rotation</h2><small>Eine bestätigte Löschung → ein Nachfolger desselben Grundstücks. Pool und Haustyp wechseln pro Inserat.</small></div></div>
    <div className="refill-summary">
      <span><b>{plan.free}</b> freie Plätze</span><span><b>{plan.readyCount}</b> Nachfolger bereit</span>
      <span><b>{plan.preparedListingIds.length}</b> vorbereitet</span><span><b>{plan.remaining}</b> Plätze noch nicht belegbar</span>
      <span><b>{plan.availablePlotCount}</b> Grundstücke verfügbar</span><span><b>{plan.activeCount}</b> aktiv bzw. übertragen</span>
    </div>
    <p className="section-note">{plan.released} Plätze seit Einführung freigegeben · {plan.reserved} dauerhaft dem ursprünglichen Inserat zugeordnet. Vorbereitete Inserate werden erst nach Ihrem Sammelupload übertragen.</p>
    <div className="button-row">
      <button className="secondary" disabled={disabled} onClick={onCheck}>Nachschub prüfen</button>
      <button className="primary" disabled={disabled || !plan.readyCount} onClick={onPrepare}>Inserate vorbereiten</button>
    </div>
    {!online ? <p role="status">Für gespeicherte Vorbereitung und Upload ist der lokale Helfer erforderlich.</p> : null}
    {plan.candidates.length ? <details><summary>{plan.candidates.length} mögliche Nachfolger für {plan.availablePlotCount} Grundstücke</summary><div className="refill-details">
      {plan.candidates.map(candidate => <div key={candidate.creditId}><b>{candidate.label}</b>
        <span>{candidate.sourceExternalId} · Pool {candidate.sourcePool} → Pool {candidate.pool}</span>
        <span>{candidate.sourceHouseName || candidate.sourceHouseId} → {candidate.houseName}</span>
        <small>{candidate.facts.street} {candidate.facts.houseNumber}, {candidate.facts.postalCode} {candidate.facts.city} · {candidate.facts.plotSizeSqm} m² · {formatPrice(candidate.facts.purchasePrice)} · Hausposition {candidate.housePosition}</small>
      </div>)}
    </div></details> : null}
    {rows.length ? <details open><summary>Kurze Vorschau · {rows.length} vorbereitete Nachfolger</summary>
      <div className="refill-selection-controls">
        <label>Vorbereitete Inserate suchen<input type="search" value={search} placeholder="Objektnummer oder Adresse" onChange={event => setSearch(event.target.value)} /></label>
        <div className="button-row">
          <button className="secondary" disabled={disabled || !filtered.some(row => !row.archiveCount)} onClick={() => setSelection(selectFilteredRefillIds(selected, filtered))}>Alle gefilterten Treffer auswählen</button>
          <button className="secondary" disabled={disabled || !selected.length} onClick={() => setSelection([])}>Auswahl aufheben</button>
        </div>
        <p role="status">{rows.length} vorbereitet · <b>{selected.length} ausgewählt</b> · {rows.length - selected.length} nicht ausgewählt{hiddenSelected ? ` · ${hiddenSelected} ausgewählt außerhalb der Suche` : ''}</p>
        {selected.length ? <details><summary>Auswahl anzeigen · {selected.length}</summary><ul>{rows.filter(row => selected.includes(row.listing.id)).map(row => <li key={row.listing.id}>{row.listing.externalId} · {row.addressLabel}{row.archiveCount ? ' · Archivbestand prüfen' : ''}</li>)}</ul></details> : null}
        <small>Die Sammelauswahl überspringt „Archivbestand prüfen“. Diese Inserate können bewusst einzeln ausgewählt werden.</small>
        <button className="primary" disabled={disabled || !selected.length} onClick={() => setConfirmation([...selected])}>{selected.length} ausgewählte Inserate hochladen</button>
      </div>
      <div className="refill-details">
        {!filtered.length ? <p>Keine vorbereiteten Inserate für diese Suche.</p> : null}
        {filtered.map(({ listing, cycle, addressLabel, archiveCount }) => <div className="refill-selectable-row" key={listing.id}>
          <input type="checkbox" aria-label={`${listing.externalId} · ${addressLabel}${archiveCount ? ' · Archivbestand prüfen' : ''}`} checked={selected.includes(listing.id)} disabled={disabled}
            onChange={event => setSelection(event.target.checked ? [...selected, listing.id] : selected.filter(id => id !== listing.id))} />
          <div><b>{listing.externalId} · {addressLabel}</b>
            {archiveCount ? <small className="refill-archive-warning">Archivbestand prüfen · {archiveCount} frühere Einträge</small> : null}
            <span>{cycle.sourceExternalId} → {listing.externalId} · Pool {cycle.sourcePool} → Pool {cycle.pool}</span>
            <span>{cycle.sourceHouseName || cycle.sourceHouseId} → {listing.templateName}</span>
            <small>Innenraum-Set {listing.interiorSet || 'Hausbilder'} · Hausposition {listing.addressSnapshot?.housePosition} · Löschung geplant: {listing.addressSnapshot?.plannedDeletionDate}</small>
            <small>{listing.texts?.title}</small>
          </div>
        </div>)}
      </div>
    </details> : null}
    <dialog ref={dialog} className="refill-upload-dialog" aria-labelledby="refill-upload-title" onCancel={event => { event.preventDefault(); setConfirmation(null); }}>
      <h3 id="refill-upload-title">Sie möchten {confirmation?.length || 0} Inserate hochladen.</h3>
      <ul>{(confirmation || []).map(id => { const row = rows.find(item => item.listing.id === id); return <li key={id}>{row?.listing.externalId || 'Nicht mehr vorbereitet'}{row?.archiveCount ? ' · Archivbestand prüfen' : ''}</li>; })}</ul>
      <div className="button-row"><button className="secondary" onClick={() => setConfirmation(null)}>Abbrechen</button>
        <button className="primary" disabled={disabled || !confirmation?.length} onClick={() => { const ids = confirmation ? [...confirmation] : []; setConfirmation(null); onUpload(ids); }}>Upload starten</button></div>
    </dialog>
    {plan.blocked.length ? <details><summary>{plan.blocked.length} Nachfolger derzeit nicht bereit</summary><div className="refill-details">
      {plan.blocked.map(candidate => <div key={candidate.creditId}><b>{candidate.label}</b><span>{candidate.sourceExternalId} · Pool {candidate.pool} · {candidate.reason}</span>
        {candidate.reason === "Pooldaten fachlich freigeben" ? <><small>{candidate.facts.street} {candidate.facts.houseNumber}, {candidate.facts.postalCode} {candidate.facts.city} · {candidate.facts.plotSizeSqm} m² · {formatPrice(candidate.facts.purchasePrice)}</small><button className="secondary" disabled={disabled} onClick={() => onApprove(candidate.plotId, candidate.pool)}>Diese Pooldaten fachlich freigeben</button></> : null}
      </div>)}
    </div></details> : null}
  </div>;
}
