"use client";

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
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
import { plotAddressSelection, plotListingCountAppearance, selectablePlotIds } from "../../plot-selection.mjs";
import { catalogGeographicLabel, catalogPlotDisposition, filterCatalogPlots, operationalCatalogPlots, resolveActiveCatalogSource, uniqueCatalogPlots } from "../../plot-active-catalog.mjs";
import type { ActiveCatalogPreview, ActiveCatalogSource } from "../../plot-active-catalog.mjs";
import type { StudioState } from "../types";
import { defaultPlotTerritoryVisibility, readPlotTerritoryVisibility, savePlotTerritoryVisibility, togglePlotTerritoryVisibility } from "../../plot-territory-visibility.mjs";
import { generatePoolB, rowFromPlot, rowFromPlotB } from "../../plot-master-sync.mjs";

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
  catalogPolicy?: StudioState["activePlotCatalog"];
  onCatalogPreview: () => Promise<ActiveCatalogPreview>;
  onCatalogConfirm: (token: string) => Promise<void>;
  rotationStatuses: Record<string, { state: string; currentPool: string; nextPool: string; remaining: number; cycle: number }>;
  selectedPlotIds: string[];
  defaultOwner: AddressOwner;
  helperOnline: boolean;
  helperRequest: HelperRequest;
  linkedProjectCounts: Record<string, number>;
  selectionMeta: Record<string, { listingCount: number; regionLabel: string; uploadDate: string }>;
  syncStatus: PlotSyncStatus | null;
  onRetrySource: () => Promise<void>;
  onSelectionChange: (ids: string[]) => void;
  onSave: (plots: PlotRecord[], message: string) => void;
  onDelete: (plot: PlotRecord, removeExcel: boolean) => void;
  onMasterPreview: () => Promise<MasterPreview>;
  onMasterApply: (token: string, decisions: Record<string, string>) => Promise<unknown>;
  onResetListings: (plot: PlotRecord) => void;
  resetDisabled: boolean;
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
  territory?: { available: boolean; postalCodes: string[]; message: string };
  activeCatalog?: ActiveCatalogSource;
  scheduleEnabled?: boolean;
  sourceFound: boolean;
  running: boolean;
  nextScheduledRunAt: string;
  config: { sourcePath: string; intervalDays: number; hour: number; timeZone: string };
  lastRun: PlotSyncRun | null;
  lastSuccessfulRun: PlotSyncRun | null;
};

type MasterPreview = {
  token: string;
  sourcePath: string;
  sourceFound: boolean;
  counts: Record<string, number>;
  items: Array<{ plotId: string; action: string; direction?: string; label: string }>;
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
  catalogPolicy,
  onCatalogPreview,
  onCatalogConfirm,
  rotationStatuses,
  selectedPlotIds,
  defaultOwner,
  helperOnline,
  helperRequest,
  linkedProjectCounts,
  selectionMeta,
  syncStatus,
  onRetrySource,
  onSelectionChange,
  onSave,
  onDelete,
  onMasterPreview,
  onMasterApply,
  onResetListings,
  resetDisabled,
}: Props) {
  const [query, setQuery] = useState("");
  const [catalogPreview, setCatalogPreview] = useState<ActiveCatalogPreview | null>(null);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [showInactiveEditor, setShowInactiveEditor] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [cityFilter, setCityFilter] = useState("");
  const [sortKey, setSortKey] = useState<PlotSortKey>("postalCode");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [draft, setDraft] = useState<PlotRecord | null>(null);
  const [pdfReview, setPdfReview] = useState<PdfReview | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importRows, setImportRows] = useState<PlotImportPreviewRow[]>([]);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [masterPreview, setMasterPreview] = useState<MasterPreview | null>(null);
  const [masterDecisions, setMasterDecisions] = useState<Record<string, string>>({});
  const [masterBusy, setMasterBusy] = useState(false);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PlotRecord | null>(null);
  const [message, setMessage] = useState("");
  const [expandedTerritories, setExpandedTerritories] = useState<Record<string, boolean>>({ ...defaultPlotTerritoryVisibility });
  const [resetTarget, setResetTarget] = useState<{ plot: PlotRecord; listingCount: number } | null>(null);
  const excelInput = useRef<HTMLInputElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        setExpandedTerritories(readPlotTerritoryVisibility(window.localStorage));
      } catch {
        // The browser may deny access to local storage.
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  const toggleTerritory = (territoryId: string) => {
    const next = togglePlotTerritoryVisibility(expandedTerritories, territoryId);
    setExpandedTerritories(next);
    try {
      savePlotTerritoryVisibility(window.localStorage, next);
    } catch {
      // The current view remains usable without browser storage.
    }
  };

  const source = useMemo(() => resolveActiveCatalogSource(helperOnline ? syncStatus?.activeCatalog : null, catalogPolicy?.lastValidSource), [helperOnline, syncStatus, catalogPolicy]);
  const catalogContext = useMemo(() => ({ source, policy: catalogPolicy }), [source, catalogPolicy]);
  const activePlots = useMemo(() => operationalCatalogPlots(plots, catalogContext), [plots, catalogContext]);
  const inactivePlots = useMemo(() => uniqueCatalogPlots(plots).filter(plot => plot.isActive !== false && !activePlots.some(active => active.id === plot.id)), [plots, activePlots]);
  const openCatalogPreview = async () => {
    setCatalogBusy(true);
    try { setCatalogPreview(await onCatalogPreview()); setMessage(""); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Vorschau konnte nicht geladen werden."); }
    finally { setCatalogBusy(false); }
  };
  const confirmCatalog = async () => {
    if (!catalogPreview) return;
    setCatalogBusy(true);
    try { await onCatalogConfirm(catalogPreview.token); setCatalogPreview(null); }
    catch (error) { setCatalogPreview(null); setMessage(error instanceof Error ? error.message : "Bitte die Vorschau erneut öffnen."); }
    finally { setCatalogBusy(false); }
  };
  const selectablePlots = useMemo(() => activePlots.filter((plot) => plotAddressSelection(plot).selectable), [activePlots]);
  const reviewPlots = useMemo(() => (catalogPolicy?.approvedAt ? activePlots : uniqueCatalogPlots(plots)).filter((plot) => !plotAddressSelection(plot).selectable && plot.isActive !== false), [plots, activePlots, catalogPolicy]);
  const displayedPlots = showReview ? reviewPlots : selectablePlots;
  const cityOptions = useMemo(() => [...new Set(activePlots.map((plot) => plot.city).filter(Boolean))].sort((a, b) => a.localeCompare(b, "de")), [activePlots]);
  const visiblePlots = useMemo(() => {
    return filterCatalogPlots(displayedPlots, query, cityFilter);
  }, [displayedPlots, cityFilter, query]);
  const visibleIds = selectablePlotIds(visiblePlots, visiblePlots.map((plot) => plot.id), catalogContext);
  const allVisibleSelected = Boolean(visibleIds.length) && visibleIds.every((id) => selectedPlotIds.includes(id));
  const territorySections = useMemo(() => {
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
    return [
      { id: "inside", label: "Im eigenen Suchgebiet", plots: visiblePlots.filter(plot => catalogPlotDisposition(plot, source, catalogPolicy) === "inside") },
      { id: "outside", label: "Exklusiv / außerhalb des Suchgebietes", plots: visiblePlots.filter(plot => catalogPlotDisposition(plot, source, catalogPolicy) === "outside") },
    ].map((section) => {
      const groups = new Map<string, PlotRecord[]>();
      for (const plot of section.plots) {
        const label = catalogGeographicLabel(plot, source, selectionMeta[plot.id]?.regionLabel || "Nicht zugeordnet");
        groups.set(label, [...(groups.get(label) || []), plot]);
      }
      return { ...section, groups: [...groups.entries()]
        .map(([label, entries]) => ({ label, firstPostalCode: entries.map((plot) => plot.postalCode).sort()[0] || "", plots: entries.sort(compare) }))
        .sort((left, right) => collator.compare(left.firstPostalCode, right.firstPostalCode) || collator.compare(left.label, right.label)) };
    });
  }, [selectionMeta, sortDirection, sortKey, visiblePlots, source, catalogPolicy]);

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
    if (!selectablePlotIds(plots, [plotId], catalogContext).length) return;
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

  const removePlot = (plot: PlotRecord) => setDeleteTarget(plot);

  const openMasterPreview = async () => {
    setMasterBusy(true);
    try {
      const preview = await onMasterPreview();
      setMasterPreview(preview);
      setMasterDecisions({});
      setMessage("Vorschau erstellt. Bitte Änderungen und fehlende Grundstücke prüfen.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Die Master-Vorschau ist fehlgeschlagen."); }
    finally { setMasterBusy(false); }
  };

  const retrySource = async () => {
    setSourceBusy(true);
    try { await onRetrySource(); }
    finally { setSourceBusy(false); }
  };

  const confirmMaster = async () => {
    if (!masterPreview) return;
    setMasterBusy(true);
    try {
      await onMasterApply(masterPreview.token, masterDecisions);
      setMasterPreview(null);
      setMessage("Master-Abgleich abgeschlossen. Bestehende Inserate und Historie wurden nicht entfernt.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Der Master-Abgleich ist fehlgeschlagen."); }
    finally { setMasterBusy(false); }
  };

  const beginListingReset = (plot: PlotRecord) => {
    const listingCount = selectionMeta[plot.id]?.listingCount || 0;
    if (!listingCount || resetDisabled) return;
    setResetTarget({ plot, listingCount });
  };

  const confirmListingReset = () => {
    if (!resetTarget || resetDisabled) return;
    onResetListings(resetTarget.plot);
    setResetTarget(null);
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
          <div><span className="eyebrow">Zentrale Datenbasis und einzige Auswahl</span><h2>{selectablePlots.length} auswählbare Grundstücke · {reviewPlots.length} Prüffälle</h2><small className="section-note">Grundstücke ohne öffentliche Straße bleiben zur Recherche erhalten und sind nicht auswählbar. Bestehende Online-Inserate bleiben erhalten – auch ohne Eintrag in der aktuellen Excel.</small></div>
          <div className="button-row">
            <input ref={excelInput} type="file" accept=".xlsx,.xls" hidden onChange={importExcel} />
            <button className="secondary" disabled={importBusy} onClick={() => excelInput.current?.click()}>{importBusy ? "Excel wird gelesen …" : "Excel importieren"}</button>
            <button className="primary" onClick={() => beginEdit()}>Neues Grundstück</button>
          </div>
        </div>


        {message ? <div className="plot-inline-message" role="status">{message}</div> : null}

        {source?.excelAvailable === false ? <div className="plot-source-warning" role="status">
          <strong>Excel momentan nicht erreichbar</strong>
          <p>Die Grundstücke werden aus dem letzten gespeicherten Stand angezeigt. Änderungen werden momentan nicht mit Excel synchronisiert.</p>
          <button className="secondary" disabled={sourceBusy} onClick={retrySource}>{sourceBusy ? "Wird geprüft …" : "Erneut prüfen"}</button>
        </div> : null}

        <div className="button-row" aria-label="Adressprüfung">
          <button className={!showReview ? 'primary' : 'secondary'} aria-pressed={!showReview} onClick={() => setShowReview(false)}>Auswählbare Grundstücke ({selectablePlots.length})</button>
          <button className={showReview ? 'primary' : 'secondary'} aria-pressed={showReview} onClick={() => setShowReview(true)}>Müssen geprüft werden ({reviewPlots.length})</button>
        </div>
        {showReview ? <p role="note">Nur Recherche und Bearbeitung möglich. Diese Grundstücke werden nicht in „Alle sichtbaren wählen“ übernommen. Bestehende Inserate und ihre Historie bleiben unverändert im Inseratsmanager.</p> : null}

        <div className="plot-toolbar">
          <label className="field"><span>Suche</span><input value={query} placeholder="Straße, PLZ oder Ort" onChange={(event) => setQuery(event.target.value)} /></label>
          <label className="field"><span>Ort filtern</span><select value={cityFilter} onChange={(event) => setCityFilter(event.target.value)}><option value="">Alle Orte</option>{cityOptions.map((city) => <option key={city}>{city}</option>)}</select></label>
          <label className="field"><span>Innerhalb der Gebiete sortieren</span><select value={sortKey} onChange={(event) => setSortKey(event.target.value as PlotSortKey)}><option value="city">Ort</option><option value="postalCode">PLZ</option><option value="plotSizeSqm">Grundstücksgröße</option><option value="purchasePrice">Kaufpreis</option><option value="uploadDate">Upload-Datum</option><option value="listingCount">Inseratsanzahl</option></select></label>
          <button className="secondary plot-sort-direction" onClick={() => setSortDirection((direction) => direction === "asc" ? "desc" : "asc")} aria-label={sortDirection === "asc" ? "Absteigend sortieren" : "Aufsteigend sortieren"}>{sortDirection === "asc" ? "↑ Aufsteigend" : "↓ Absteigend"}</button>
          <div className="plot-selection-summary"><b>{selectedPlotIds.length}</b><span>zentral ausgewählt</span></div>
          <div className="button-row"><button className="secondary" disabled={!visibleIds.length} onClick={toggleAllVisible}>{allVisibleSelected ? "Sichtbare abwählen" : "Alle sichtbaren wählen"}</button><button className="secondary" disabled={!selectedPlotIds.length} onClick={() => onSelectionChange([])}>Auswahl aufheben</button></div>
        </div>

        <p role="note">Alle Grundstücke innerhalb der aktiven PLZ aus „Suchgebiet“ bleiben erhalten, auch ohne Master-Eintrag. Außerhalb werden nur ausdrücklich als exklusiv gespeicherte Grundstücke ausgewählt.</p>
        {!catalogPolicy?.approvedAt ? <div className="plot-import-preview" role="region" aria-label="Einmalige Bereinigung">
          <h3>Aktive Grundstücksauswahl einmalig bereinigen</h3>
          <p>Die bisherige Auswahl bleibt gespeichert. Vor neuen Inseraten bitte die Vorschau prüfen und bestätigen.</p>
          <button className="primary" disabled={!helperOnline || catalogBusy} onClick={openCatalogPreview}>{catalogBusy ? "Vorschau wird geprüft …" : "Bereinigungsvorschau öffnen"}</button>
        </div> : null}
        {catalogPreview ? <div className="plot-import-preview" role="dialog" aria-label="Bereinigungsvorschau">
          <h3>Bereinigung vor dem Bestätigen prüfen</h3>
          <p>{catalogPreview.counts.inside} Grundstücke bleiben im eigenen Suchgebiet · {catalogPreview.counts.outside} bleiben als Exklusiv · {catalogPreview.counts.removed} Grundstücke außerhalb werden aus der aktiven Auswahl ausgeblendet.</p>
          {catalogPreview.counts.insideReview ? <p>Davon bleiben {catalogPreview.counts.insideReview} Grundstücke im Suchgebiet mit offener Adressprüfung erhalten. Für neue Inserate werden sie erst nach der Adressprüfung auswählbar.</p> : null}
          <details><summary>Betroffene Grundstücke ({catalogPreview.removed.length})</summary>{catalogPreview.removed.map(plot => <p key={plot.id}>{formatPlotStreet(plot)} · {plot.postalCode} {plot.city} · {plot.id}</p>)}</details>
          <p>Grundstücksdatensätze, bestehende Inserate, Uploadhistorien und Lösch-Batches bleiben erhalten.</p>
          <div className="button-row"><button className="secondary" disabled={catalogBusy} onClick={() => setCatalogPreview(null)}>Abbrechen</button><button className="primary" disabled={catalogBusy || catalogPreview.confirmed} onClick={confirmCatalog}>Aktive Auswahl einmalig bereinigen</button></div>
        </div> : null}
        <button className="secondary" onClick={() => setShowInactiveEditor(value => !value)}>Nicht aktive Grundstücke bearbeiten</button>
        {showInactiveEditor ? <div className="plot-inactive-editor"><label className="field"><span>Grundstück zur Prüfung oder exklusiven Nutzung öffnen</span><select value="" onChange={event => { const plot = inactivePlots.find(plot => plot.id === event.target.value); if (plot) beginEdit(plot); }}><option value="">Grundstück wählen …</option>{filterCatalogPlots(inactivePlots, query).map(plot => <option value={plot.id} key={plot.id}>{formatPlotStreet(plot) || "Adresse offen"} · {plot.postalCode} {plot.city} · {plot.id}</option>)}</select></label></div> : null}
        <div className="action-bar"><span>Master: KI_Grundstuecke_MASTER.xlsx · Pool A und Pool B</span><button className="primary" disabled={!helperOnline || masterBusy || !catalogPolicy?.approvedAt || !source?.available || source.excelAvailable === false} onClick={openMasterPreview}>{masterBusy ? "Excel wird geprüft …" : "Excel synchronisieren"}</button></div>
        {masterPreview && source?.available && source.excelAvailable !== false ? <div className="content-card plot-import-preview" role="dialog" aria-label="Master-Abgleich prüfen">
          <h3>Änderungen vor dem Synchronisieren</h3>
          <p>{masterPreview.counts.import || 0} neue Grundstücke aus Excel · {masterPreview.counts.export || 0} neue aus Inseratestudio · {masterPreview.counts.update || 0} geändert · {masterPreview.counts["missing-excel"] || 0} fehlen in Excel · {masterPreview.counts.conflict || 0} Konflikte</p>
          {!masterPreview.sourceFound ? <p>Die Master-Datei fehlt noch. Beim Bestätigen wird sie mit Pool A und Pool B angelegt.</p> : null}
          {masterPreview.items.map((item) => <div className="action-bar" key={item.plotId}><span>{item.label} · {item.plotId} · {item.action === "import" ? "Excel → App" : item.action === "export" ? "App → Excel" : item.action === "update" ? `${item.direction === "excel" ? "Excel → App" : "App → Excel"} geändert` : item.action === "delete-excel" ? "Pool A und B entfernen" : item.action === "missing-excel" ? "Fehlt in Excel" : "Konflikt"}</span>
            {item.action === "conflict" ? <select aria-label={`Konflikt ${item.plotId}`} value={masterDecisions[item.plotId] || "keep"} onChange={(event) => setMasterDecisions((current) => ({ ...current, [item.plotId]: event.target.value }))}><option value="keep">Unverändert lassen</option><option value="app">Version Inseratestudio</option><option value="excel">Version Excel</option></select> : null}
            {item.action === "missing-excel" ? <select aria-label={`Fehlendes Grundstück ${item.plotId}`} value={masterDecisions[item.plotId] || "keep"} onChange={(event) => setMasterDecisions((current) => ({ ...current, [item.plotId]: event.target.value }))}><option value="keep">Im Katalog behalten</option><option value="remove-app">Aus Inseratestudio entfernen</option></select> : null}
          </div>)}
          {masterPreview.counts["missing-excel"] > 1 ? <button className="secondary" onClick={() => setMasterDecisions((current) => ({ ...current, ...Object.fromEntries(masterPreview.items.filter((item) => item.action === "missing-excel").map((item) => [item.plotId, "remove-app"])) }))}>Alle fehlenden aus Inseratestudio entfernen</button> : null}
          <div className="action-bar"><span>Keine Portalobjekte, Listings oder Lösch-Batches werden gelöscht.</span><div className="button-row"><button className="secondary" onClick={() => setMasterPreview(null)}>Abbrechen</button><button className="primary" disabled={masterBusy} onClick={confirmMaster}>Synchronisierung bestätigen</button></div></div>
        </div> : null}
        {!source?.available ? <p role="status">Grundstücksbestand wird geladen. Bitte erneut prüfen, falls die Verbindung nicht verfügbar ist.</p> : null}
        <div className="plot-territory-sections">{territorySections.map((territory) => <section className={`plot-territory-section ${territory.id}`} key={territory.id} aria-label={territory.label}>
          <header className="plot-territory-heading">{territory.id === "inside" || territory.id === "outside" ? <h3 className="plot-territory-title"><button type="button" className="plot-territory-toggle" aria-expanded={expandedTerritories[territory.id]} aria-controls={`plot-territory-content-${territory.id}`} onClick={() => toggleTerritory(territory.id)}><span>{territory.label}</span><span className="plot-territory-toggle-meta"><span>{territory.plots.length} Grundstücke</span><span className="plot-territory-chevron" aria-hidden="true">{expandedTerritories[territory.id] ? "▼" : "▶"}</span></span></button></h3> : <><h3>{territory.label}</h3><span>{territory.plots.length} Grundstücke</span></>}</header>
          <div id={`plot-territory-content-${territory.id}`} hidden={(territory.id === "inside" || territory.id === "outside") && !expandedTerritories[territory.id]}>
          {!territory.plots.length ? <p>Keine Grundstücke in diesem Bereich für den aktuellen Filter.</p> : null}
          <div className="plot-region-groups">{territory.groups.map((group) => <section key={group.label}><header><button type="button" className="plot-territory-toggle" aria-expanded={expandedTerritories[`group:${territory.id}:${group.label}`] !== false} aria-controls={`plot-group-${territory.id}-${encodeURIComponent(group.label)}`} onClick={() => toggleTerritory(`group:${territory.id}:${group.label}`)}><b>{group.label}</b><span>{group.plots.length} Grundstücke · {expandedTerritories[`group:${territory.id}:${group.label}`] === false ? "▶" : "▼"}</span></button></header><div id={`plot-group-${territory.id}-${encodeURIComponent(group.label)}`} hidden={expandedTerritories[`group:${territory.id}:${group.label}`] === false}>{group.plots.map((plot) => {
          const listingCount = selectionMeta[plot.id]?.listingCount || 0;
          const appearance = plotListingCountAppearance(listingCount);
          const address = plotAddressSelection(plot);
          return <article className={`plot-selection-card ${appearance.tone}${selectedPlotIds.includes(plot.id) ? " selected" : ""}`} key={plot.id}>
            <label className="plot-selection-main"><input type="checkbox" disabled={!address.selectable} checked={address.selectable && selectedPlotIds.includes(plot.id)} onChange={() => togglePlot(plot.id)} aria-label={`${formatPlotStreet(plot) || 'Adresse offen'} auswählen`} /><span><b>{formatPlotStreet(plot) || "–"}</b><small>{plot.postalCode || "–"} {plot.city || "–"}</small><small>Grundstücks-ID: {plot.id}</small>{plot.addressRotation ? <small>{(() => { const status = rotationStatuses[plot.id]; return status?.state === "incomplete" ? "Adresspool unvollständig" : status?.state === "ready" ? `${status.currentPool ? `Pool ${status.currentPool} abgeschlossen · ` : ""}Pool ${status.nextPool} bereit` : `Pool ${status?.currentPool} · ${status?.remaining}/4 noch offen · nächster Pool ${status?.nextPool} · Zyklus ${status?.cycle}`; })()}</small> : null}{!address.selectable ? <small>{address.reason}</small> : address.houseNumberUnconfirmed ? <small>Hausnummer unbestätigt – vor Veröffentlichung prüfen</small> : null}</span></label>
            <div className="plot-selection-facts"><span><small>Pool A · {formatPlotStreet(plot)}</small><b>{number(plot.plotSizeSqm)} m² · {euro(plot.purchasePrice)}</b></span><span><small>Pool B · {formatPlotStreet(rowFromPlotB(plot)) || "Hausnummer prüfen"}</small><b>{number(rowFromPlotB(plot).plotSizeSqm)} m² · {euro(rowFromPlotB(plot).purchasePrice)}</b><small>{plot.addressRotation?.poolBDetails?.mode === "MANUAL" ? "Pool B manuell" : "Pool B automatisch"}{rowFromPlotB(plot).status ? " · Pool B prüfen" : ""}</small></span></div>
            <em>{listingCount} Inserate{appearance.detail ? <small>{appearance.detail}</small> : null}</em>
            <div className="plot-actions"><button onClick={() => beginEdit(plot)}>Bearbeiten</button><button className="secondary" disabled={resetDisabled || !listingCount} onClick={() => beginListingReset(plot)}>Inserate zurücksetzen</button>{plot.exposeFileReference ? <button onClick={() => openExpose(plot)}>Exposé öffnen</button> : null}{!showReview ? <button className="danger-link" onClick={() => removePlot(plot)}>Löschen</button> : null}</div>
          </article>;
        })}</div></section>)}</div></div>
        </section>)}</div>
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
              <label className="field field-wide plot-exclusive-field"><span><input type="checkbox" checked={draft.exclusiveOutsideTerritory === true} onChange={event => setDraft({ ...draft, exclusiveOutsideTerritory: event.target.checked })} /> Exklusiv / außerhalb des Suchgebietes behalten</span></label>
              <label className="field field-wide"><span>Regionale Grundnotizen · optional</span><textarea rows={3} value={draft.regionalNotes} placeholder="Nur geprüfte Ortsfakten, z. B. seenreich, ruhig, Nähe zu Potsdam" onChange={(event) => setDraft({ ...draft, regionalNotes: event.target.value })} /></label>
            </div>
            <div className="plot-pdf-section"><div><span className="eyebrow">Vermarktungsvariante</span><h3>Pool B</h3><p>Automatisch: +2 m², Hausnummer +2 und +1.350 €. Sonderhausnummern bleiben zur Prüfung offen.</p></div>
              {(() => { const generated = generatePoolB(rowFromPlot(draft)); const b = rowFromPlotB(draft); return <><p>{b.street} {b.houseNumber || "Hausnummer prüfen"}, {b.postalCode} {b.city} · {number(b.plotSizeSqm)} m² · {euro(b.purchasePrice)} · {b.mode === "MANUAL" ? "Pool B manuell" : "Pool B automatisch"}{b.status ? " · Pool B prüfen" : ""}</p>
                <div className="button-row"><button className="secondary" onClick={() => setDraft({ ...draft, addressRotation: { poolA: { street: draft.street, houseNumber: draft.houseNumber, postalCode: draft.postalCode, city: draft.city }, poolB: { street: generated.street, houseNumber: generated.houseNumber, postalCode: generated.postalCode, city: generated.city }, poolBDetails: { plotSizeSqm: generated.plotSizeSqm, purchasePrice: generated.purchasePrice, mode: "AUTO_GENERATED", status: generated.status as "" | "POOL_B_PRÜFEN" }, currentPool: draft.addressRotation?.currentPool || "", cycle: draft.addressRotation?.cycle || 0, listingIds: draft.addressRotation?.listingIds || [], lastUsedA: draft.addressRotation?.lastUsedA || "", lastUsedB: draft.addressRotation?.lastUsedB || "" } })}>Pool B automatisch</button><button className="secondary" onClick={() => setDraft({ ...draft, addressRotation: { poolA: draft.addressRotation?.poolA || null, poolB: { street: b.street, houseNumber: b.houseNumber, postalCode: b.postalCode, city: b.city }, poolBDetails: { plotSizeSqm: b.plotSizeSqm, purchasePrice: b.purchasePrice, mode: "MANUAL", status: b.status as "" | "POOL_B_PRÜFEN" }, currentPool: draft.addressRotation?.currentPool || "", cycle: draft.addressRotation?.cycle || 0, listingIds: draft.addressRotation?.listingIds || [], lastUsedA: draft.addressRotation?.lastUsedA || "", lastUsedB: draft.addressRotation?.lastUsedB || "" } })}>Pool B manuell bearbeiten</button></div>
                {draft.addressRotation?.poolBDetails?.mode === "MANUAL" ? <div className="form-grid two"><label className="field"><span>Straße</span><input value={draft.addressRotation.poolB?.street || ""} onChange={(event) => setDraft({ ...draft, addressRotation: { ...draft.addressRotation!, poolB: { ...draft.addressRotation!.poolB!, street: event.target.value } } })} /></label><label className="field"><span>Hausnummer</span><input value={draft.addressRotation.poolB?.houseNumber || ""} onChange={(event) => setDraft({ ...draft, addressRotation: { ...draft.addressRotation!, poolB: { ...draft.addressRotation!.poolB!, houseNumber: event.target.value }, poolBDetails: { ...draft.addressRotation!.poolBDetails!, status: event.target.value ? "" : "POOL_B_PRÜFEN" } } })} /></label><label className="field"><span>Fläche m²</span><input type="number" min={0} value={draft.addressRotation.poolBDetails.plotSizeSqm} onChange={(event) => setDraft({ ...draft, addressRotation: { ...draft.addressRotation!, poolBDetails: { ...draft.addressRotation!.poolBDetails!, plotSizeSqm: Number(event.target.value) || 0 } } })} /></label><label className="field"><span>Preis €</span><input type="number" min={0} value={draft.addressRotation.poolBDetails.purchasePrice} onChange={(event) => setDraft({ ...draft, addressRotation: { ...draft.addressRotation!, poolBDetails: { ...draft.addressRotation!.poolBDetails!, purchasePrice: Number(event.target.value) || 0 } } })} /></label></div> : null}</>; })()}
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
      {resetTarget ? (
        <div className="plot-editor-backdrop" role="dialog" aria-modal="true" aria-label="Inserate zurücksetzen">
          <div className="plot-editor content-card">
            <div className="section-heading"><div><span className="eyebrow">Lokaler Arbeitsbestand</span><h2>{resetTarget.listingCount} vorbereitete Inserate für {formatPlotStreet(resetTarget.plot)} zurücksetzen?</h2></div></div>
            <p>Das Grundstück bleibt erhalten. Die aktuellen Inseratentwürfe und vorbereiteten Uploadstände werden entfernt. Historische Auditdaten und belegte Fakten bleiben im lokalen Resetarchiv erhalten.</p>
            <div className="action-bar"><span>Es wird kein Portal, FTP-Transfer, Scheduler oder Excel-Abgleich gestartet.</span><div className="button-row"><button className="secondary" disabled={resetDisabled} onClick={() => setResetTarget(null)}>Abbrechen</button><button className="primary" disabled={resetDisabled} onClick={confirmListingReset}>{resetTarget.listingCount} Inserate zurücksetzen</button></div></div>
          </div>
        </div>
      ) : null}
      {deleteTarget ? <div className="plot-editor-backdrop" role="dialog" aria-modal="true" aria-label="Grundstück entfernen"><div className="plot-editor content-card"><h2>Grundstück auch aus der Master-Excel entfernen?</h2><p>{formatPlotStreet(deleteTarget)} · {deleteTarget.id}. Die weitere Nutzung wird beendet. {linkedProjectCounts[deleteTarget.id] || 0} Projekte sowie Listings, Uploadhistorie und Lösch-Batches bleiben erhalten.</p><div className="button-row"><button className="secondary" onClick={() => setDeleteTarget(null)}>Abbrechen</button><button className="secondary" onClick={() => { onDelete(deleteTarget, false); setDeleteTarget(null); }}>Nur aus Inseratestudio entfernen</button><button className="primary" onClick={() => { onDelete(deleteTarget, true); setDeleteTarget(null); }}>Inseratestudio + Excel löschen</button></div><p>Excel-Zeilen werden nach Vorschau und Bestätigung des nächsten Abgleichs entfernt.</p></div></div> : null}
    </section>
  );
}
