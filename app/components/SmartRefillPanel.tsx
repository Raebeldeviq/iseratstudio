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
      <button className="primary" disabled={disabled || !plan.preparedListingIds.length} onClick={onUpload}>Vorbereitete Inserate hochladen</button>
    </div>
    {!online ? <p role="status">Für gespeicherte Vorbereitung und Upload ist der lokale Helfer erforderlich.</p> : null}
    {plan.candidates.length ? <details><summary>{plan.candidates.length} mögliche Nachfolger für {plan.availablePlotCount} Grundstücke</summary><div className="refill-details">
      {plan.candidates.map(candidate => <div key={candidate.creditId}><b>{candidate.label}</b>
        <span>{candidate.sourceExternalId} · Pool {candidate.sourcePool} → Pool {candidate.pool}</span>
        <span>{candidate.sourceHouseName || candidate.sourceHouseId} → {candidate.houseName}</span>
        <small>{candidate.facts.street} {candidate.facts.houseNumber}, {candidate.facts.postalCode} {candidate.facts.city} · {candidate.facts.plotSizeSqm} m² · {formatPrice(candidate.facts.purchasePrice)} · Hausposition {candidate.housePosition}</small>
      </div>)}
    </div></details> : null}
    {plan.preparedListingIds.length ? <details open><summary>Kurze Vorschau · {plan.preparedListingIds.length} vorbereitete Nachfolger</summary><div className="refill-details">
      {plan.cycles.filter(cycle => cycle.listingIds.some(id => plan.preparedListingIds.includes(id))).map(cycle => {
        const project = state.projects.find(item => item.id === cycle.projectId);
        const plot = state.plots?.find(item => item.id === cycle.plotId);
        return <div key={cycle.id}><b>{plot ? `${plot.street} ${plot.houseNumber}, ${plot.city}` : project?.name}</b>
          <span>{cycle.sourceExternalId} → {project?.listings.find(item => item.id === cycle.listingIds[0])?.externalId} · Pool {cycle.sourcePool} → Pool {cycle.pool}</span>
          {cycle.listingIds.filter(id => plan.preparedListingIds.includes(id)).map(id => {
            const listing = project?.listings.find(item => item.id === id);
            const snapshot = listing?.addressSnapshot;
            return <span key={id}>{cycle.sourceHouseName || cycle.sourceHouseId} → {listing?.templateName}
              <small>{snapshot?.address.street} {snapshot?.address.houseNumber}, {snapshot?.address.postalCode} {snapshot?.address.city} · Innenraum-Set {listing?.interiorSet || "Hausbilder"} · Hausposition {snapshot?.housePosition} · Löschung geplant: {snapshot?.plannedDeletionDate}</small>
              <small>{listing?.texts?.title}</small></span>;
          })}</div>;
      })}
    </div></details> : null}
    {plan.blocked.length ? <details><summary>{plan.blocked.length} Nachfolger derzeit nicht bereit</summary><div className="refill-details">
      {plan.blocked.map(candidate => <div key={candidate.creditId}><b>{candidate.label}</b><span>{candidate.sourceExternalId} · Pool {candidate.pool} · {candidate.reason}</span>
        {candidate.reason === "Pooldaten fachlich freigeben" ? <><small>{candidate.facts.street} {candidate.facts.houseNumber}, {candidate.facts.postalCode} {candidate.facts.city} · {candidate.facts.plotSizeSqm} m² · {formatPrice(candidate.facts.purchasePrice)}</small><button className="secondary" disabled={disabled} onClick={() => onApprove(candidate.plotId, candidate.pool)}>Diese Pooldaten fachlich freigeben</button></> : null}
      </div>)}
    </div></details> : null}
  </div>;
}
