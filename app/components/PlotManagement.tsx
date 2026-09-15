"use client";

import { ChangeEvent, DragEvent, useMemo, useRef, useState } from "react";
import { readSheet } from "read-excel-file/browser";
import {
  applyPlotImportPreview,
  parsePlotWorkbookRows,
  type PlotImportAction,
  type PlotImportPreviewRow,
} from "../lib/address-import";
import {
  createPlotRecord,
  formatPlotStreet,
  normalizePlotRecord,
  replacePlotRecord,
} from "../../plot-records.mjs";
import type { AddressOwner, PlotRecord } from "../types";
import { plotListingCountAppearance } from "../../plot-selection.mjs";

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const MAX_PDF_BYTES = 30 * 1024 * 1024;

type HelperRequest = (path: string, init?: RequestInit) => Promise<Response>;

type PdfFields = {
  street: string;
  houseNumber: string;
  postalCode: string;
  city: string;
  plotSizeSqm: number;
  purchasePrice: number;
  reviewRequired: Record<"street" | "postalCode" | "city" | "plotSizeSqm" | "purchasePrice", boolean>;
};

type PdfReview = {
  temporaryReference: string;
  filename: string;
  pageCount: number;
  fields: PdfFields;
  accepted: Record<"street" | "postalCode" | "city" | "plotSizeSqm" | "purchasePrice", boolean>;
};

type Props = {
  plots: PlotRecord[];
  selectedPlotIds: string[];
  defaultOwner: AddressOwner;
  helperOnline: boolean;
  helperRequest: HelperRequest;
  linkedProjectCounts: Record<string, number>;
  selectionMeta: Record<string, { listingCount: number; regionLabel: string; uploadDate: string }>;
  syncStatus: PlotSyncStatus | null;
  syncBusy: boolean;
  onSelectionChange: (ids: string[]) => void;
  onSave: (plots: PlotRecord[], message: string) => void;
  onDelete: (plot: PlotRecord) => void;
  onSync: (dryRun: boolean) => void;
  onScheduleChange: (enabled: boolean) => void;
};

type PlotSortKey = "city" | "postalCode" | "plotSizeSqm" | "purchasePrice" | "uploadDate" | "listingCount";

type PlotSyncRun = {
  startedAt: string;
  status: string;
  dryRun: boolean;
  rowsRead: number;
  created: number;
  updated: number;
  deactivated: number;
  skipped: number;
  failed: number;
  duplicatesPrevented: number;
  message: string;
  errors?: Array<{ excelRow: number; reason: string }>;
  warnings?: Array<{ excelRow: number; reason: string }>;
};

type PlotSyncStatus = {
  scheduleEnabled?: boolean;
  sourceFound: boolean;
  running: boolean;
  nextScheduledRunAt: string;
  config: { sourcePath: string; intervalDays: number; hour: number; timeZone: string };
  lastRun: PlotSyncRun | null;
  lastSuccessfulRun: PlotSyncRun | null;
};

function euro(value: number): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value || 0);
}

function number(value: number): string {
  return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(value || 0);
}

function date(value: string): string {
  if (!value) return "–";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "–" : parsed.toLocaleDateString("de-DE");
}

function splitStreetLine(value: string): { street: string; houseNumber: string } {
  const cleaned = value.trim();
  const match = cleaned.match(/^(.+?)\s+(\d+[a-zA-Z]?(?:\s*[-/]\s*\d+[a-zA-Z]?)?)$/u);
  return match
    ? { street: match[1].trim(), houseNumber: match[2].trim() }
    : { street: cleaned, houseNumber: "" };
}

function emptyPlot(owner: AddressOwner): PlotRecord {
  return createPlotRecord({ owner }, { createId: () => crypto.randomUUID() }) as PlotRecord;
}

async function responseJson<T>(response: Response): Promise<T> {
  const data = await response.json() as T & { message?: string; ok?: boolean };
  if (!response.ok || data.ok === false) throw new Error(data.message || "Die lokale Anfrage ist fehlgeschlagen.");
  return data;
}

export default function PlotManagement({
  plots,
  selectedPlotIds,
  defaultOwner,
  helperOnline,
  helperRequest,
  linkedProjectCounts,
  selectionMeta,
  syncStatus,
  syncBusy,
  onSelectionChange,
  onSave,
  onDelete,
  onSync,
  onScheduleChange,
}: Props) {
  const [logOpen, setLogOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [sortKey, setSortKey] = useState<PlotSortKey>("city");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [draft, setDraft] = useState<PlotRecord | null>(null);
  const [pdfReview, setPdfReview] = useState<PdfReview | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importRows, setImportRows] = useState<PlotImportPreviewRow[]>([]);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const excelInput = useRef<HTMLInputElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);

  const activePlots = useMemo(() => plots.filter((plot) => plot.isActive !== false), [plots]);
  const cityOptions = useMemo(() => [...new Set(activePlots.map((plot) => plot.city).filter(Boolean))].sort((a, b) => a.localeCompare(b, "de")), [activePlots]);
  const visiblePlots = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("de-DE");
    return activePlots.filter((plot) => {
      if (cityFilter && plot.city !== cityFilter) return false;
      if (!needle) return true;
      return [formatPlotStreet(plot), plot.postalCode, plot.city]
        .join(" ")
        .toLocaleLowerCase("de-DE")
        .includes(needle);
    });
  }, [activePlots, cityFilter, query]);
  const visibleIds = visiblePlots.map((plot) => plot.id);
  const allVisibleSelected = Boolean(visibleIds.length) && visibleIds.every((id) => selectedPlotIds.includes(id));
  const selectionGroups = useMemo(() => {
    const collator = new Intl.Collator("de-DE", { numeric: true, sensitivity: "base" });
    const compare = (left: PlotRecord, right: PlotRecord) => {
      const leftMeta = selectionMeta[left.id] || { listingCount: 0, uploadDate: "" };
      const rightMeta = selectionMeta[right.id] || { listingCount: 0, uploadDate: "" };
      const numeric = sortKey === "plotSizeSqm"
        ? left.plotSizeSqm - right.plotSizeSqm
        : sortKey === "purchasePrice"
          ? left.purchasePrice - right.purchasePrice
          : sortKey === "listingCount"
            ? leftMeta.listingCount - rightMeta.listingCount
            : sortKey === "uploadDate"
              ? (Date.parse(leftMeta.uploadDate) || 0) - (Date.parse(rightMeta.uploadDate) || 0)
              : collator.compare(sortKey === "city" ? left.city : left.postalCode, sortKey === "city" ? right.city : right.postalCode);
      const ordered = numeric || collator.compare([left.city, left.postalCode, formatPlotStreet(left)].join(" "), [right.city, right.postalCode, formatPlotStreet(right)].join(" "));
      return sortDirection === "asc" ? ordered : -ordered;
    };
    const groups = new Map<string, PlotRecord[]>();
    for (const plot of visiblePlots) {
      const label = selectionMeta[plot.id]?.regionLabel || "Nicht zugeordnet";
      groups.set(label, [...(groups.get(label) || []), plot]);
    }
    return [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right, "de"))
      .map(([label, entries]) => ({
        label,
        plots: entries.sort(compare),
      }));
  }, [selectionMeta, sortDirection, sortKey, visiblePlots]);
  const displayedSyncRun = syncStatus?.lastSuccessfulRun || syncStatus?.lastRun;

  const beginEdit = (plot?: PlotRecord) => {
    setDraft(plot ? normalizePlotRecord(plot, { fallbackId: plot.id }) as PlotRecord : emptyPlot(defaultOwner));
    setPdfReview(null);
    setMessage("");
  };

  const closeEditor = async () => {
    if (pdfReview?.temporaryReference) {
      await helperRequest("/plot-exposes/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference: pdfReview.temporaryReference, pending: true }),
      }).catch(() => undefined);
    }
    setDraft(null);
    setPdfReview(null);
  };

  const togglePlot = (plotId: string) => {
    onSelectionChange(selectedPlotIds.includes(plotId)
      ? selectedPlotIds.filter((id) => id !== plotId)
      : [...selectedPlotIds, plotId]);
  };

  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      onSelectionChange(selectedPlotIds.filter((id) => !visibleIds.includes(id)));
      return;
    }
    onSelectionChange([...new Set([...selectedPlotIds, ...visibleIds])]);
  };

  const analyzePdf = async (file: File) => {
    if (!draft) return;
    if (!helperOnline) {
      setMessage("Der lokale Helfer muss für die geschützte PDF-Ablage gestartet sein.");
      return;
    }
    if (file.type !== "application/pdf" && !file.name.toLocaleLowerCase("de-DE").endsWith(".pdf")) {
      setMessage("Bitte ausschließlich eine PDF-Datei auswählen.");
      return;
    }
    if (!file.size || file.size > MAX_PDF_BYTES) {
      setMessage("Das Exposé ist leer oder größer als 30 MB.");
      return;
    }
    setPdfBusy(true);
    setMessage("");
    try {
      if (pdfReview?.temporaryReference) {
        await helperRequest("/plot-exposes/archive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reference: pdfReview.temporaryReference, pending: true }),
        }).catch(() => undefined);
      }
      const response = await helperRequest("/plot-exposes/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/pdf",
          "X-FPI-Filename": encodeURIComponent(file.name),
        },
        body: file,
      });
      const result = await responseJson<{
        temporaryReference: string;
        filename: string;
        pageCount: number;
        fields: PdfFields;
      }>(response);
      setPdfReview({
        ...result,
        accepted: {
          street: Boolean(result.fields.street),
          postalCode: Boolean(result.fields.postalCode),
          city: Boolean(result.fields.city),
          plotSizeSqm: Boolean(result.fields.plotSizeSqm),
          purchasePrice: Boolean(result.fields.purchasePrice),
        },
      });
      setMessage(`${result.pageCount} PDF-Seite${result.pageCount === 1 ? "" : "n"} lokal ausgelesen. Bitte die fünf Werte prüfen.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Das PDF konnte nicht ausgelesen werden.");
    } finally {
      setPdfBusy(false);
      if (pdfInput.current) pdfInput.current.value = "";
    }
  };

  const applyPdfValues = () => {
    if (!draft || !pdfReview) return;
    const fields = pdfReview.fields;
    setDraft({
      ...draft,
      ...(pdfReview.accepted.street ? { street: fields.street, houseNumber: fields.houseNumber } : {}),
      ...(pdfReview.accepted.postalCode ? { postalCode: fields.postalCode } : {}),
      ...(pdfReview.accepted.city ? { city: fields.city } : {}),
      ...(pdfReview.accepted.plotSizeSqm ? { plotSizeSqm: Number(fields.plotSizeSqm) || 0 } : {}),
      ...(pdfReview.accepted.purchasePrice ? { purchasePrice: Number(fields.purchasePrice) || 0 } : {}),
    });
    setMessage("Die ausgewählten Werte wurden in das Formular übernommen. Speichern bestätigt Grundstück und Exposé.");
  };

  const saveDraft = async () => {
    if (!draft) return;
    if (!draft.street.trim() || !/^\d{5}$/u.test(draft.postalCode) || !draft.city.trim()) {
      setMessage("Bitte Straße, fünfstellige PLZ und Ort vollständig eintragen.");
      return;
    }
    setPdfBusy(true);
    try {
      let next = normalizePlotRecord({ ...draft, updatedAt: new Date().toISOString() }, { fallbackId: draft.id }) as PlotRecord;
      const previous = plots.find((plot) => plot.id === draft.id);
      if (pdfReview) {
        const response = await helperRequest("/plot-exposes/commit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            temporaryReference: pdfReview.temporaryReference,
            plotId: draft.id,
            filename: pdfReview.filename,
          }),
        });
        const stored = await responseJson<{ reference: string; filename: string; uploadedAt: string }>(response);
        next = {
          ...next,
          exposeFileReference: stored.reference,
          exposeFilename: stored.filename,
          exposeUploadedAt: stored.uploadedAt,
        };
      }
      onSave(replacePlotRecord(plots, next) as PlotRecord[], previous ? "Grundstück wurde aktualisiert." : "Neues Grundstück wurde gespeichert.");
      if (pdfReview && previous?.exposeFileReference && previous.exposeFileReference !== next.exposeFileReference) {
        helperRequest("/plot-exposes/archive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reference: previous.exposeFileReference }),
        }).catch(() => undefined);
      }
      setDraft(null);
      setPdfReview(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Das Grundstück konnte nicht gespeichert werden.");
    } finally {
      setPdfBusy(false);
    }
  };

  const openExpose = async (plot: PlotRecord) => {
    const previewWindow = window.open("about:blank", "_blank");
    if (!previewWindow) {
      setMessage("Das Browserfenster für das Exposé wurde blockiert. Bitte Pop-ups für die lokale App erlauben.");
      return;
    }
    previewWindow.opener = null;
    try {
      const response = await helperRequest(`/plot-exposes/file?reference=${encodeURIComponent(plot.exposeFileReference)}`);
      if (!response.ok) {
        const data = await response.json() as { message?: string };
        throw new Error(data.message || "Das Exposé konnte nicht geöffnet werden.");
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      previewWindow.location.replace(objectUrl);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (error) {
      previewWindow.close();
      setMessage(error instanceof Error ? error.message : "Das Exposé konnte nicht geöffnet werden.");
    }
  };

  const removeExpose = async (plot: PlotRecord) => {
    if (!window.confirm(`Soll das Exposé „${plot.exposeFilename}“ wirklich vom Grundstück entfernt werden?`)) return;
    const next = { ...plot, exposeFileReference: "", exposeFilename: "", exposeUploadedAt: "", updatedAt: new Date().toISOString() };
    onSave(replacePlotRecord(plots, next) as PlotRecord[], "Exposé wurde vom Grundstück entfernt.");
    if (draft?.id === plot.id) setDraft(next);
    await helperRequest("/plot-exposes/archive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reference: plot.exposeFileReference }),
    }).catch(() => setMessage("Die Verknüpfung wurde entfernt; die lokale Archivierung der Datei ist noch offen."));
  };

  const removePlot = (plot: PlotRecord) => {
    const links = linkedProjectCounts[plot.id] || 0;
    const warning = links
      ? `Mit diesem Grundstück sind ${links} interne Arbeitsstände verknüpft. Grundstück, Arbeitsstände und interne Folgebeziehungen werden vollständig gelöscht. Bereits veröffentlichte externe Inserate bleiben unberührt. Fortfahren?`
      : "Soll dieses Grundstück wirklich vollständig aus der App gelöscht werden? Externe Inserate bleiben unberührt.";
    if (!window.confirm(warning)) return;
    onDelete(plot);
  };

  const importExcel = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setMessage("Die Excel-Datei ist größer als 10 MB.");
      return;
    }
    setImportBusy(true);
    setMessage("");
    try {
      const rows = await readSheet(file);
      const preview = parsePlotWorkbookRows(rows, plots, () => crypto.randomUUID(), defaultOwner);
      setImportRows(preview.rows);
      setImportErrors(preview.errors);
      setMessage(preview.rows.length ? `${preview.rows.length} Excel-Zeilen erkannt. Bitte Vorschau und Dublettenentscheidungen prüfen.` : preview.errors[0] || "Keine Grundstücke erkannt.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Die Excel-Datei konnte nicht gelesen werden.");
    } finally {
      setImportBusy(false);
    }
  };

  const updateImportRow = (id: string, patch: Partial<PlotImportPreviewRow>) => {
    setImportRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  };

  const confirmImport = () => {
    const result = applyPlotImportPreview(plots, importRows);
    onSave(result.plots, `${result.created} Grundstücke angelegt, ${result.updated} aktualisiert, ${result.skipped} übersprungen.`);
    setImportRows([]);
    setImportErrors([]);
  };

  const pdfReviewRows: Array<{ key: keyof PdfReview["accepted"]; label: string; value: string }> = pdfReview ? [
    { key: "street", label: "Straße", value: formatPlotStreet(pdfReview.fields) },
    { key: "postalCode", label: "Postleitzahl", value: pdfReview.fields.postalCode },
    { key: "city", label: "Ort", value: pdfReview.fields.city },
    { key: "plotSizeSqm", label: "Grundstücksgröße in m²", value: pdfReview.fields.plotSizeSqm ? String(pdfReview.fields.plotSizeSqm) : "" },
    { key: "purchasePrice", label: "Kaufpreis in €", value: pdfReview.fields.purchasePrice ? String(pdfReview.fields.purchasePrice) : "" },
  ] : [];

  return (
    <section className="workspace plot-workspace">
      <div className="content-card plot-management-card">
        <div className="section-heading">
          <div><span className="eyebrow">Zentrale Datenbasis und einzige Auswahl</span><h2>{activePlots.length} Grundstücke</h2><small className="section-note">Bearbeitung, Mehrfachauswahl und Exposés befinden sich ausschließlich hier. Änderungen gelten direkt für alle nachfolgenden Schritte.</small></div>
          <div className="button-row">
            <input ref={excelInput} type="file" accept=".xlsx,.xls" hidden onChange={importExcel} />
            <button className="secondary" disabled={importBusy} onClick={() => excelInput.current?.click()}>{importBusy ? "Excel wird gelesen …" : "Excel importieren"}</button>
            <button className="primary" onClick={() => beginEdit()}>Neues Grundstück</button>
          </div>
        </div>

        <section className="plot-sync-card" aria-label="Automatischer Grundstücksabgleich">
          <div><span className="eyebrow">Excel-Abgleich · {syncStatus?.scheduleEnabled ? 'Zeitplan aktiv: alle 3 Tage um 07:00 Uhr' : 'Automatik pausiert'}</span><b>{syncStatus?.sourceFound ? "Quelldatei gefunden" : "Quelldatei nicht gefunden"}</b><small>{syncStatus?.config.sourcePath || "Status wird vom lokalen Helfer geladen …"}</small><button className="secondary" disabled={!helperOnline || syncBusy} onClick={() => onScheduleChange(!syncStatus?.scheduleEnabled)}>{syncStatus?.scheduleEnabled ? 'Zeitplan pausieren' : 'Zeitplan aktivieren'}</button></div>
          <dl>
            <div><dt>Letzter Erfolg</dt><dd>{syncStatus?.lastSuccessfulRun ? new Date(syncStatus.lastSuccessfulRun.startedAt).toLocaleString("de-DE") : "–"}</dd></div>
            <div><dt>Nächster Lauf</dt><dd>{syncStatus?.nextScheduledRunAt ? new Date(syncStatus.nextScheduledRunAt).toLocaleString("de-DE") : "–"}</dd></div>
            <div><dt>Neu / aktualisiert</dt><dd>{displayedSyncRun ? `${displayedSyncRun.created} / ${displayedSyncRun.updated}` : "–"}</dd></div>
            <div><dt>Deaktiviert / Fehler</dt><dd>{displayedSyncRun ? `${displayedSyncRun.deactivated} / ${displayedSyncRun.failed}` : "–"}</dd></div>
          </dl>
          <div className="button-row"><button className="secondary" disabled={!helperOnline || syncBusy} onClick={() => onSync(true)}>Dry-Run</button><button className="primary" disabled={!helperOnline || syncBusy} onClick={() => onSync(false)}>{syncBusy ? "Abgleich läuft …" : "Jetzt synchronisieren"}</button><button className="secondary" disabled={!syncStatus?.lastRun} onClick={() => setLogOpen((open) => !open)}>Letztes Protokoll öffnen</button></div>
          {logOpen && syncStatus?.lastRun ? <div className="plot-sync-log"><b>{syncStatus.lastRun.message}</b><span>{syncStatus.lastRun.rowsRead} gelesen · {syncStatus.lastRun.created} neu · {syncStatus.lastRun.updated} aktualisiert · {syncStatus.lastRun.deactivated} deaktiviert · {syncStatus.lastRun.skipped} übersprungen · {syncStatus.lastRun.duplicatesPrevented} Dubletten verhindert · {syncStatus.lastRun.failed} fehlerhaft</span>{syncStatus.lastRun.errors?.length ? <ul>{syncStatus.lastRun.errors.map((error, index) => <li key={`${error.excelRow}-${index}`}>Zeile {error.excelRow || "–"}: {error.reason}</li>)}</ul> : null}</div> : null}
        </section>

        {message ? <div className="plot-inline-message" role="status">{message}</div> : null}

        <div className="plot-toolbar">
          <label className="field"><span>Suche</span><input value={query} placeholder="Straße, PLZ oder Ort" onChange={(event) => setQuery(event.target.value)} /></label>
          <label className="field"><span>Ort filtern</span><select value={cityFilter} onChange={(event) => setCityFilter(event.target.value)}><option value="">Alle Orte</option>{cityOptions.map((city) => <option key={city}>{city}</option>)}</select></label>
          <label className="field"><span>Innerhalb der Gebiete sortieren</span><select value={sortKey} onChange={(event) => setSortKey(event.target.value as PlotSortKey)}><option value="city">Ort</option><option value="postalCode">PLZ</option><option value="plotSizeSqm">Grundstücksgröße</option><option value="purchasePrice">Kaufpreis</option><option value="uploadDate">Upload-Datum</option><option value="listingCount">Inseratsanzahl</option></select></label>
          <button className="secondary plot-sort-direction" onClick={() => setSortDirection((direction) => direction === "asc" ? "desc" : "asc")} aria-label={sortDirection === "asc" ? "Absteigend sortieren" : "Aufsteigend sortieren"}>{sortDirection === "asc" ? "↑ Aufsteigend" : "↓ Absteigend"}</button>
          <div className="plot-selection-summary"><b>{selectedPlotIds.length}</b><span>zentral ausgewählt</span></div>
          <div className="button-row"><button className="secondary" disabled={!visibleIds.length} onClick={toggleAllVisible}>{allVisibleSelected ? "Sichtbare abwählen" : "Alle sichtbaren wählen"}</button><button className="secondary" disabled={!selectedPlotIds.length} onClick={() => onSelectionChange([])}>Auswahl aufheben</button></div>
        </div>

        <div className="plot-region-groups">{selectionGroups.map((group) => <section key={group.label}><header><b>{group.label}</b><span>{group.plots.length} Grundstücke</span></header><div>{group.plots.map((plot) => {
          const listingCount = selectionMeta[plot.id]?.listingCount || 0;
          const uploadDate = selectionMeta[plot.id]?.uploadDate || "";
          const appearance = plotListingCountAppearance(listingCount);
          return <article className={`plot-selection-card ${appearance.tone}${selectedPlotIds.includes(plot.id) ? " selected" : ""}`} key={plot.id}>
            <label className="plot-selection-main"><input type="checkbox" checked={selectedPlotIds.includes(plot.id)} onChange={() => togglePlot(plot.id)} /><span><b>{formatPlotStreet(plot) || "–"}</b><small>{plot.postalCode || "–"} {plot.city || "–"}</small></span></label>
            <div className="plot-selection-facts"><span><small>Grundstück</small><b>{plot.plotSizeSqm ? `${number(plot.plotSizeSqm)} m²` : "–"}</b></span><span><small>Kaufpreis</small><b>{plot.purchasePrice ? euro(plot.purchasePrice) : "–"}</b></span><span><small>Plattform-Upload</small><b>{uploadDate ? date(uploadDate) : "Noch nicht hochgeladen"}</b></span></div>
            <em>{listingCount} Inserate{appearance.detail ? <small>{appearance.detail}</small> : null}</em>
            <div className="plot-actions"><button onClick={() => beginEdit(plot)}>Bearbeiten</button>{plot.exposeFileReference ? <button onClick={() => openExpose(plot)}>Exposé öffnen</button> : null}<button className="danger-link" onClick={() => removePlot(plot)}>Löschen</button></div>
          </article>;
        })}</div></section>)}</div>
        {!visiblePlots.length ? <div className="empty-state"><b>Keine Grundstücke gefunden</b><span>Importiere eine Excel-Datei oder lege ein Grundstück manuell an.</span></div> : null}
      </div>

      {importRows.length ? (
        <div className="content-card plot-import-preview">
          <div className="section-heading"><div><span className="eyebrow">Vor dem Speichern prüfen</span><h2>Excel-Importvorschau</h2></div><button className="secondary" onClick={() => { setImportRows([]); setImportErrors([]); }}>Abbrechen</button></div>
          {importErrors.length ? <details><summary>{importErrors.length} unvollständige Zeilen</summary><ul>{importErrors.map((error) => <li key={error}>{error}</li>)}</ul></details> : null}
          <div className="plot-import-table">
            <div className="plot-import-head"><span>Import</span><span>Zeile</span><span>Adresse</span><span>Größe</span><span>Preis</span><span>Status / Entscheidung</span></div>
            {importRows.map((row) => <div className={`plot-import-row ${row.status}`} key={row.id}>
              <input type="checkbox" disabled={row.status === "invalid"} checked={row.selected} onChange={(event) => updateImportRow(row.id, { selected: event.target.checked })} />
              <span>{row.excelRow}</span><b>{formatPlotStreet(row.plot)}, {row.plot.postalCode} {row.plot.city}</b><span>{row.plot.plotSizeSqm ? `${number(row.plot.plotSizeSqm)} m²` : "–"}</span><span>{row.plot.purchasePrice ? euro(row.plot.purchasePrice) : "–"}</span>
              {row.status === "duplicate" ? <label><span>Mögliche Dublette</span><select value={row.action} onChange={(event) => updateImportRow(row.id, { action: event.target.value as PlotImportAction })}><option value="skip">Überspringen</option><option value="update">Bestehenden Datensatz aktualisieren</option><option value="create">Trotzdem neu anlegen</option></select></label> : row.status === "invalid" ? <span className="plot-error">{row.issues.join(", ")}</span> : <span className="plot-ok">Neu anlegen</span>}
            </div>)}
          </div>
          <div className="action-bar"><span>Bestehende Datensätze werden nur bei ausdrücklich gewählter Aktualisierung ergänzt.</span><button className="primary" onClick={confirmImport}>Ausgewählte Grundstücke importieren</button></div>
        </div>
      ) : null}

      {draft ? (
        <div className="plot-editor-backdrop" role="dialog" aria-modal="true" aria-label="Grundstück bearbeiten">
          <div className="plot-editor content-card">
            <div className="section-heading"><div><span className="eyebrow">{plots.some((plot) => plot.id === draft.id) ? "Grundstück bearbeiten" : "Neuer Datensatz"}</span><h2>{formatPlotStreet(draft) || "Neues Grundstück"}</h2></div><button className="secondary" onClick={closeEditor}>Schließen</button></div>
            <div className="form-grid two">
              <label className="field field-wide"><span>Straße und Hausnummer</span><input value={formatPlotStreet(draft)} onChange={(event) => setDraft({ ...draft, ...splitStreetLine(event.target.value) })} /></label>
              <label className="field"><span>Postleitzahl</span><input inputMode="numeric" maxLength={5} value={draft.postalCode} onChange={(event) => setDraft({ ...draft, postalCode: event.target.value.replace(/\D/gu, "").slice(0, 5) })} /></label>
              <label className="field"><span>Ort</span><input value={draft.city} onChange={(event) => setDraft({ ...draft, city: event.target.value })} /></label>
              <label className="field"><span>Grundstücksgröße</span><div className="input-shell"><input type="number" min={0} value={draft.plotSizeSqm || ""} onChange={(event) => setDraft({ ...draft, plotSizeSqm: Number(event.target.value) || 0 })} /><i>m²</i></div></label>
              <label className="field"><span>Kaufpreis</span><div className="input-shell"><input type="number" min={0} value={draft.purchasePrice || ""} onChange={(event) => setDraft({ ...draft, purchasePrice: Number(event.target.value) || 0 })} /><i>€</i></div></label>
              <label className="field field-wide"><span>Regionale Grundnotizen · optional</span><textarea rows={3} value={draft.regionalNotes} placeholder="Nur geprüfte Ortsfakten, z. B. seenreich, ruhig, Nähe zu Potsdam" onChange={(event) => setDraft({ ...draft, regionalNotes: event.target.value })} /></label>
            </div>

            <div className="plot-pdf-section">
              <div><span className="eyebrow">Interne PDF-Ablage</span><h3>Grundstücksexposé</h3><p>Ausgelesen werden ausschließlich Straße, PLZ, Ort, Grundstücksgröße und Kaufpreis. Keine Bilder, Maklerdaten oder Bebaubarkeitsanalyse.</p></div>
              {draft.exposeFileReference ? <div className="plot-existing-pdf"><div><b>{draft.exposeFilename}</b><small>hochgeladen {date(draft.exposeUploadedAt)}</small></div><div className="button-row"><button className="secondary" onClick={() => openExpose(draft)}>Exposé öffnen</button><button className="secondary" onClick={() => pdfInput.current?.click()}>Exposé ersetzen</button><button className="danger-link" onClick={() => removeExpose(draft)}>Exposé entfernen</button></div></div> : null}
              <input ref={pdfInput} type="file" accept="application/pdf,.pdf" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) analyzePdf(file); }} />
              <div className="plot-pdf-drop" onDragOver={(event: DragEvent<HTMLDivElement>) => event.preventDefault()} onDrop={(event: DragEvent<HTMLDivElement>) => { event.preventDefault(); const file = event.dataTransfer.files?.[0]; if (file) analyzePdf(file); }}>
                <b>{pdfBusy ? "PDF wird lokal verarbeitet …" : pdfReview ? pdfReview.filename : "PDF hier ablegen"}</b><span>{pdfReview ? `${pdfReview.pageCount} Seite${pdfReview.pageCount === 1 ? "" : "n"} · Prüfansicht unten` : "oder Datei auswählen"}</span><button className="secondary" disabled={pdfBusy || !helperOnline} onClick={() => pdfInput.current?.click()}>PDF auswählen</button>
              </div>
            </div>

            {pdfReview ? <div className="plot-pdf-review"><div className="section-heading compact"><div><span className="eyebrow">Keine automatische Übernahme</span><h3>Erkannte Werte prüfen</h3></div><button className="secondary" onClick={() => setPdfReview({ ...pdfReview, accepted: { street: true, postalCode: true, city: true, plotSizeSqm: true, purchasePrice: true } })}>Alle auswählen</button></div>{pdfReviewRows.map((row) => <label className={pdfReview.fields.reviewRequired[row.key] ? "needs-review" : ""} key={row.key}><input type="checkbox" checked={pdfReview.accepted[row.key]} disabled={!row.value} onChange={(event) => setPdfReview({ ...pdfReview, accepted: { ...pdfReview.accepted, [row.key]: event.target.checked } })} /><span>{row.label}</span><input value={row.value} placeholder="Prüfung erforderlich" onChange={(event) => {
                const value = event.target.value;
                const fields = { ...pdfReview.fields };
                if (row.key === "street") Object.assign(fields, splitStreetLine(value));
                else if (row.key === "plotSizeSqm" || row.key === "purchasePrice") fields[row.key] = Number(value.replace(/[^0-9,.-]/gu, "").replace(/\./gu, "").replace(",", ".")) || 0;
                else fields[row.key] = value;
                setPdfReview({ ...pdfReview, fields, accepted: { ...pdfReview.accepted, [row.key]: Boolean(value) } });
              }} /><small>{pdfReview.fields.reviewRequired[row.key] ? "Prüfung erforderlich" : "erkannt"}</small></label>)}<div className="button-row"><button className="secondary" onClick={() => setPdfReview({ ...pdfReview, accepted: { street: false, postalCode: false, city: false, plotSizeSqm: false, purchasePrice: false } })}>Alle verwerfen</button><button className="primary" onClick={applyPdfValues}>Ausgewählte Werte übernehmen</button></div></div> : null}

            {message ? <div className="plot-inline-message" role="status">{message}</div> : null}
            <div className="action-bar"><span>Änderungen werden zentral gespeichert und an alle verknüpften Inseratsarbeitsstände weitergereicht.</span><div className="button-row"><button className="secondary" onClick={closeEditor}>Abbrechen</button><button className="primary" disabled={pdfBusy} onClick={saveDraft}>Grundstück speichern</button></div></div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
