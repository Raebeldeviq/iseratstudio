"use client";
import type { GeneratedListing } from "../types";

type Props = { listing: GeneratedListing; disabled: boolean; onCorrect: (action: "exclude" | "restore") => void };

export default function InventoryCorrectionActions({ listing, disabled, onCorrect }: Props) {
  const correction = listing.inventoryCorrection;
  const historical = correction?.active === true;
  const date = (value: string) => new Date(value).toLocaleString("de-DE");
  return <div className="inventory-correction">
    {historical ? <p role="status"><b>HISTORISCH / NICHT IM PORTAL</b><br />{correction.reason} · {date(correction.correctedAt)}</p> : null}
    <details><summary>Bestand korrigieren</summary>
      <p>Objekt {listing.externalId || "ohne Objektnummer"} · Inserats-ID: {listing.id}</p>
      <p>Ändert nur den internen Bestand. Keine Portalaktion, keine zusätzlichen Nachschubplätze.</p>
      <div className="button-row">
        <button type="button" className="secondary" disabled={disabled || historical} onClick={() => onCorrect("exclude")}>Nicht im Portal vorhanden / Duplikat</button>
        <button type="button" className="secondary" disabled={disabled || !historical} onClick={() => onCorrect("restore")}>Korrektur rückgängig machen</button>
      </div>
      {correction?.history.length ? <ol aria-label="Korrekturverlauf">{correction.history.map((entry, index) => <li key={index}>{date(entry.at)} · {entry.externalId} · {entry.reason}</li>)}</ol> : null}
    </details>
  </div>;
}
