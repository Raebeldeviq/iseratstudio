"use client";
type Props = { selectedCount: number; selectableCount: number; disabled: boolean; onSelectAll: () => void; onClear: () => void; onRemove: () => void };
export default function ManagerBulkActions({ selectedCount, selectableCount, disabled, onSelectAll, onClear, onRemove }: Props) {
  return <div className="manager-bulk-controls">
    <button type="button" className="secondary" disabled={disabled || !selectableCount} onClick={onSelectAll}>Alle gefilterten Treffer auswählen</button>
    <small>Nur eindeutig historische oder inaktive Einträge sind auswählbar.</small>
    {selectedCount > 0 ? <div className="manager-bulk-selection" role="region" aria-label="Sammelbereinigung">
      <b role="status">{selectedCount} ausgewählte Inserate</b>
      <button type="button" className="secondary" disabled={disabled} onClick={onClear}>Auswahl aufheben</button>
      <button type="button" className="primary" disabled={disabled} onClick={onRemove}>{selectedCount} ausgewählte Inserate entfernen</button>
    </div> : null}
  </div>;
}
