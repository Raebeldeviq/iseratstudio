"use client";
import type { RefillPlan, RefillPool } from "../../smart-refill.mjs";
import type { StudioState } from "../types";

type Props = {
  plan: RefillPlan; state: StudioState; busy: boolean; online: boolean; uploading: boolean;
  onCheck: () => void; onPrepare: () => void; onUpload: () => void;
  onApprove: (plotId: string, pool: RefillPool) => void;
};

export default function SmartRefillPanel({ plan, state, busy, online, uploading, onCheck, onPrepare, onUpload, onApprove }: Props) {
  const disabled = busy || uploading || !online;
  const formatPrice = (value: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value);
  return <div className="content-card smart-refill-panel" aria-busy={busy || uploading}>
    <div className="section-heading"><div><h2>Nachschub &amp; Rotation</h2><small>Bestätigte Löschungen geben Plätze frei. Neue Zyklen werden in Vierergruppen vorbereitet.</small></div></div>
    <div className="refill-summary">
      <span><b>{plan.free}</b> freie Plätze</span><span><b>{plan.readyCount}</b> Inserate vorbereitbar</span>
      <span><b>{plan.preparedListingIds.length}</b> vorbereitet</span><span><b>{plan.remaining}</b> Plätze noch nicht belegbar</span>
      <span><b>{plan.availablePlotCount}</b> Grundstücke verfügbar</span><span><b>{plan.activeCount}</b> aktiv bzw. übertragen</span>
    </div>
    <p className="section-note">{plan.released} Plätze seit Einführung freigegeben · {plan.reserved} dauerhaft zugeordnet. FTPS-Erfolg bestätigt keinen Portalimport; Portalhaken werden weiterhin manuell gesetzt.</p>
    <div className="button-row">
      <button className="secondary" disabled={disabled} onClick={onCheck}>Nachschub prüfen</button>
      <button className="primary" disabled={disabled || !plan.readyCount} onClick={onPrepare}>Inserate vorbereiten</button>
      <button className="primary" disabled={disabled || !plan.preparedListingIds.length} onClick={onUpload}>Vorbereitete Inserate hochladen</button>
    </div>
    {!online ? <p role="status">Für gespeicherte Vorbereitung und Upload ist der lokale Helfer erforderlich.</p> : null}
    {plan.candidates.length ? <details><summary>{plan.candidates.length} ausgewählte Grundstücke</summary><div className="refill-details">
      {plan.candidates.map(candidate => <div key={candidate.plotId}><b>{candidate.label}</b><span>Pool {candidate.pool} bereit · Zyklus {candidate.cycle} · 4 Inserate</span><small>{candidate.facts.street} {candidate.facts.houseNumber} · {candidate.facts.plotSizeSqm} m² · {formatPrice(candidate.facts.purchasePrice)}</small></div>)}
    </div></details> : null}
    {plan.preparedListingIds.length ? <details open><summary>Kurze Vorschau · {plan.preparedListingIds.length} vorbereitete Inserate</summary><div className="refill-details">
      {plan.cycles.filter(cycle => cycle.listingIds.some(id => plan.preparedListingIds.includes(id))).map(cycle => {
        const project = state.projects.find(item => item.id === cycle.projectId);
        return <div key={cycle.id}><b>{project?.name} · Pool {cycle.pool} · Zyklus {cycle.cycle}</b>
          {cycle.listingIds.filter(id => plan.preparedListingIds.includes(id)).map(id => {
            const listing = project?.listings.find(item => item.id === id);
            return <span key={id}>{listing?.externalId} · {listing?.templateName} · {listing?.texts?.title}</span>;
          })}</div>;
      })}
    </div></details> : null}
    {plan.blocked.length ? <details><summary>{plan.blocked.length} Grundstücke derzeit nicht bereit</summary><div className="refill-details">
      {plan.blocked.map(candidate => <div key={candidate.plotId}><b>{candidate.label}</b><span>Pool {candidate.pool} · {candidate.reason}</span>
        {candidate.reason === "Pooldaten fachlich freigeben" ? <><small>{candidate.facts.street} {candidate.facts.houseNumber}, {candidate.facts.postalCode} {candidate.facts.city} · {candidate.facts.plotSizeSqm} m² · {formatPrice(candidate.facts.purchasePrice)}</small><button className="secondary" disabled={disabled} onClick={() => onApprove(candidate.plotId, candidate.pool)}>Diese Pooldaten fachlich freigeben</button></> : null}
      </div>)}
    </div></details> : null}
  </div>;
}
