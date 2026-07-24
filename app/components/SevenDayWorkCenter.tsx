"use client";

import {
  formatRenewalDate,
  type RenewalScheduleEntry,
  type RenewalStatus,
} from "../lib/renewal-schedule";
import type { PreflightReport } from "../lib/preflight";
import { PreflightPanel } from "./PreflightPanel";
import type {
  TotalSyncRunKind,
  TotalSyncScope,
} from "../types";

const STATUS_GROUPS: Array<{
  id: RenewalStatus;
  title: string;
  description: string;
}> = [
  {
    id: "today",
    title: "Heute fällig",
    description: "Diese Adressen sollten heute erneuert oder erstmals sauber datiert werden.",
  },
  {
    id: "upcoming",
    title: "Demnächst",
    description: "Diese Adressen werden innerhalb ihres nächsten Sieben-Tage-Zyklus fällig.",
  },
  {
    id: "overdue",
    title: "Überfällig",
    description: "Der gespeicherte Erneuerungstermin liegt bereits vor dem heutigen Tag.",
  },
];

type Progress = {
  total: number;
  uploaded: number;
  completedProjects: number;
};

type SevenDayWorkCenterProps = {
  entries: RenewalScheduleEntry[];
  incompleteProjectCount: number;
  ownerScope: TotalSyncScope;
  selectedProjectIds: string[];
  previousExternalIdsByProject: Record<string, string[]>;
  promotionImageCount: number;
  availablePromotionImages: number;
  portalPublicationEnabled: boolean;
  activeRunKind?: TotalSyncRunKind;
  runResumable: boolean;
  busy: boolean;
  stopping: boolean;
  progress: Progress;
  runStatus: string;
  runError?: string;
  preflightReport: PreflightReport;
  onOwnerScopeChange: (scope: TotalSyncScope) => void;
  onPromotionImageCountChange: (count: number) => void;
  onToggleProject: (projectId: string) => void;
  onSelectProjects: (projectIds: string[]) => void;
  onClearSelection: () => void;
  onOpenProject: (projectId: string) => void;
  onRenewOne: (projectId: string) => void;
  onPrimaryAction: () => void;
  onDiscardRun: () => void;
};

function ownerLabel(owner: string): string {
  return owner === "pascal" ? "Pascal" : "Fabian";
}

function addressLabel(entry: RenewalScheduleEntry): string {
  const { project } = entry;
  return [
    [project.street, project.houseNumber].filter(Boolean).join(" "),
    [project.zip, project.city].filter(Boolean).join(" "),
  ].filter(Boolean).join(", ");
}

function deadlineLabel(entry: RenewalScheduleEntry): string {
  if (entry.untracked) return "Uploaddatum fehlt";
  if (entry.status === "overdue") {
    const days = Math.abs(entry.daysUntilDue);
    return `${days} Tag${days === 1 ? "" : "e"} überfällig`;
  }
  if (entry.status === "today") return "heute";
  return `in ${entry.daysUntilDue} Tag${entry.daysUntilDue === 1 ? "" : "en"}`;
}

export function SevenDayWorkCenter({
  entries,
  incompleteProjectCount,
  ownerScope,
  selectedProjectIds,
  previousExternalIdsByProject,
  promotionImageCount,
  availablePromotionImages,
  portalPublicationEnabled,
  activeRunKind,
  runResumable,
  busy,
  stopping,
  progress,
  runStatus,
  runError,
  preflightReport,
  onOwnerScopeChange,
  onPromotionImageCountChange,
  onToggleProject,
  onSelectProjects,
  onClearSelection,
  onOpenProject,
  onRenewOne,
  onPrimaryAction,
  onDiscardRun,
}: SevenDayWorkCenterProps) {
  const selectedSet = new Set(selectedProjectIds);
  const counts = {
    today: entries.filter((entry) => entry.status === "today").length,
    upcoming: entries.filter((entry) => entry.status === "upcoming").length,
    overdue: entries.filter((entry) => entry.status === "overdue").length,
  };
  const untrackedCount = entries.filter((entry) => entry.untracked).length;
  const dueProjectIds = entries
    .filter((entry) => entry.status === "today" || entry.status === "overdue")
    .map((entry) => entry.project.id);
  const isRenewalRun = activeRunKind === "seven-day";
  const blockedByOtherRun = runResumable && !isRenewalRun;
  const selectionLocked = busy || runResumable;
  const plannedListings = selectedProjectIds.length * 4;

  return (
    <section className="workspace renewal-center">
      <div className="content-card renewal-intro">
        <div>
          <span className="eyebrow">7-Tage-Arbeitszentrale</span>
          <h2>Fällige Grundstücksadressen direkt erneuern</h2>
          <p>
            Für jede ausgewählte Adresse entstehen vier neue Inserate mit vier neuen Haustypen,
            neuen Bildern, neuen KI-Texten, neuen Überschriften und neuen Objekt-IDs.
          </p>
        </div>
        <div className="renewal-safety">
          <b>Adresse und Fläche bleiben geschützt</b>
          <span>
            Straße, Hausnummer, PLZ, Ort, Ortsteil, Grundstücksfläche, Grundstückspreis
            und Nebenkosten werden im Lauf nicht verändert.
          </span>
        </div>
      </div>

      <div className="renewal-metrics" aria-label="Fälligkeiten im gewählten Adressbuch">
        {STATUS_GROUPS.map((group) => (
          <div className={`renewal-metric ${group.id}`} key={group.id}>
            <span>{group.title}</span>
            <b>{counts[group.id]}</b>
            <small>{group.id === "today" && untrackedCount
              ? `${untrackedCount} davon ohne verlässliches Uploaddatum`
              : group.description}
            </small>
          </div>
        ))}
      </div>

      <div className="content-card renewal-toolbar">
        <div>
          <span className="eyebrow">Adressbücher</span>
          <div className="renewal-owner-buttons" role="group" aria-label="Adressbuch für die 7-Tage-Zentrale">
            {([
              ["fabian", "Fabian"],
              ["pascal", "Pascal"],
              ["all", "Beide"],
            ] as Array<[TotalSyncScope, string]>).map(([scope, label]) => (
              <button
                type="button"
                key={scope}
                className={ownerScope === scope ? "selected" : ""}
                aria-pressed={ownerScope === scope}
                disabled={selectionLocked}
                onClick={() => onOwnerScopeChange(scope)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="eyebrow">Aktionsbilder je Adresse</span>
          <div className="renewal-promotion-buttons" role="group" aria-label="Aktionsbilder für die 7-Tage-Erneuerung">
            {Array.from({ length: 5 }, (_, count) => (
              <button
                type="button"
                key={count}
                className={promotionImageCount === count ? "selected" : ""}
                aria-pressed={promotionImageCount === count}
                disabled={selectionLocked || count > availablePromotionImages}
                onClick={() => onPromotionImageCountChange(count)}
                title={count > availablePromotionImages
                  ? `Dafür werden mindestens ${count} Aktionsbilder benötigt.`
                  : undefined}
              >
                {count}
              </button>
            ))}
          </div>
        </div>

        <div className="renewal-selection-actions">
          <span className="eyebrow">Schnellauswahl</span>
          <div className="button-row">
            <button
              type="button"
              className="primary"
              disabled={selectionLocked || dueProjectIds.length === 0}
              onClick={() => onSelectProjects(dueProjectIds)}
            >
              Alle fälligen auswählen
            </button>
            <button
              type="button"
              className="secondary"
              disabled={selectionLocked || selectedProjectIds.length === 0}
              onClick={onClearSelection}
            >
              Auswahl aufheben
            </button>
          </div>
        </div>
      </div>

      {untrackedCount ? (
        <div className="renewal-legacy-note" role="note">
          <b>{untrackedCount} Altadresse{untrackedCount === 1 ? "" : "n"} ohne eindeutiges Uploaddatum</b>
          <span>
            Diese Adressen stehen bewusst unter „Heute fällig“. Nach der ersten vollständigen
            Erneuerung läuft ihr Sieben-Tage-Zähler automatisch und zuverlässig.
          </span>
        </div>
      ) : null}

      {blockedByOtherRun ? (
        <div className="renewal-run-blocker" role="status">
          Ein anderer fortsetzbarer Uploadlauf ist gespeichert. Bitte diesen zuerst unter
          „Export &amp; Upload“ abschließen oder verwerfen.
        </div>
      ) : null}

      <div className="renewal-groups">
        {STATUS_GROUPS.map((group) => {
          const groupEntries = entries.filter((entry) => entry.status === group.id);
          return (
            <section className={`renewal-group ${group.id}`} key={group.id}>
              <header>
                <div>
                  <span className="eyebrow">{groupEntries.length} Adressen</span>
                  <h3>{group.title}</h3>
                  <p>{group.description}</p>
                </div>
                <button
                  type="button"
                  className="secondary"
                  disabled={selectionLocked || groupEntries.length === 0}
                  onClick={() => onSelectProjects(groupEntries.map((entry) => entry.project.id))}
                >
                  Gruppe auswählen
                </button>
              </header>

              {groupEntries.length ? (
                <div className="renewal-address-list">
                  {groupEntries.map((entry) => {
                    const selected = selectedSet.has(entry.project.id);
                    const objectIds = previousExternalIdsByProject[entry.project.id]
                      ?? entry.project.listings.map((listing) => listing.externalId);
                    return (
                      <article className={selected ? "renewal-address selected" : "renewal-address"} key={entry.project.id}>
                        <label className="renewal-check">
                          <input
                            type="checkbox"
                            checked={selected}
                            disabled={selectionLocked}
                            onChange={() => onToggleProject(entry.project.id)}
                            aria-label={`${entry.project.name} für die 7-Tage-Erneuerung auswählen`}
                          />
                          <span />
                        </label>
                        <div className="renewal-address-main">
                          <div className="renewal-address-title">
                            <span className={`renewal-owner ${entry.project.owner}`}>
                              {ownerLabel(entry.project.owner)}
                            </span>
                            {entry.untracked ? <span className="renewal-unknown">Uploaddatum fehlt</span> : null}
                            <b>{entry.project.name}</b>
                          </div>
                          <strong>{addressLabel(entry)}</strong>
                          <small>
                            {entry.project.plotArea.toLocaleString("de-DE")} m² Grundstück
                            {objectIds.length ? ` · ${objectIds.length} bisherige Objekt-ID${objectIds.length === 1 ? "" : "s"}` : " · keine bisherige Objekt-ID gespeichert"}
                          </small>
                          {objectIds.length ? (
                            <details>
                              <summary>Bisherige Objekt-IDs anzeigen</summary>
                              <span>{objectIds.join(" · ")}</span>
                            </details>
                          ) : null}
                        </div>
                        <div className="renewal-dates">
                          <span>Letzte Erneuerung</span>
                          <b>{formatRenewalDate(entry.lastRenewedAt)}</b>
                          <span>Nächste Fälligkeit</span>
                          <b>{entry.untracked ? "heute prüfen" : formatRenewalDate(entry.dueDate)}</b>
                          <small>{deadlineLabel(entry)}</small>
                        </div>
                        <div className="renewal-row-actions">
                          <button type="button" className="secondary" onClick={() => onOpenProject(entry.project.id)}>
                            Adresse öffnen
                          </button>
                          <button
                            type="button"
                            className="primary"
                            disabled={selectionLocked || blockedByOtherRun}
                            onClick={() => onRenewOne(entry.project.id)}
                          >
                            Jetzt erneuern
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="renewal-empty">In diesem Bereich gibt es aktuell keine Adressen.</div>
              )}
            </section>
          );
        })}
      </div>

      <PreflightPanel
        report={preflightReport}
        title="Vorabprüfung der 7-Tage-Erneuerung"
        description="Geprüft werden die ausgewählten Adressen, vier neue Haustypen, Bilder, Preise, Zugänge und Dubletten."
      />

      <div className="content-card renewal-action-panel">
        <div>
          <span className="eyebrow">Kontrollierter Erneuerungslauf</span>
          <h3>
            {runResumable && isRenewalRun
              ? `${progress.uploaded}/${progress.total} Inserate übertragen`
              : `${selectedProjectIds.length} Adressen · ${plannedListings} neue Inserate`}
          </h3>
          <p>
            Portalmodus: <b>{portalPublicationEnabled ? "automatisch online" : "nur Import"}</b>.
            Jedes Inserat wird einzeln übertragen; ein unterbrochener Lauf kann sicher fortgesetzt werden.
          </p>
        </div>

        {runResumable && isRenewalRun ? (
          <div className="renewal-progress" role="status" aria-live="polite">
            <div>
              <b>{runStatus || `${progress.uploaded}/${progress.total} einzeln übertragen`}</b>
              <span>{progress.completedProjects} Adressen abgeschlossen</span>
            </div>
            <div className="progress-track" aria-label="Fortschritt der 7-Tage-Erneuerung">
              <span style={{ width: `${progress.total ? Math.round((progress.uploaded / progress.total) * 100) : 0}%` }} />
            </div>
            {runError ? <small>{runError}</small> : null}
          </div>
        ) : null}

        <div className="renewal-final-actions">
          <button
            type="button"
            className="primary"
            disabled={
              blockedByOtherRun
              || (!busy && !preflightReport.canStart)
              || (busy ? stopping : !runResumable && selectedProjectIds.length === 0)
            }
            onClick={onPrimaryAction}
          >
            {busy
              ? "Nach aktuellem Schritt anhalten"
              : !preflightReport.canStart
                ? preflightReport.targetCount
                  ? `Start gesperrt · ${preflightReport.blockerCount} Blocker`
                  : "Start gesperrt · keine Adresse ausgewählt"
              : runResumable && isRenewalRun
                ? "7-Tage-Lauf fortsetzen"
                : `Auswahl erneuern · ${plannedListings} Inserate`}
          </button>
          {runResumable && isRenewalRun && !busy ? (
            <button type="button" className="secondary" onClick={onDiscardRun}>
              Gespeicherten Lauf verwerfen
            </button>
          ) : null}
        </div>

        <p className="renewal-warning">
          Vor dem Start müssen die bisherigen Objekt-IDs der ausgewählten Adressen in
          Immoprofessional gelöscht sein. Neue Objekt-IDs entfernen alte Onlineanzeigen nicht automatisch.
        </p>
        {incompleteProjectCount ? (
          <small className="renewal-incomplete">
            {incompleteProjectCount} unvollständige Adressentwürfe erscheinen hier nicht.
          </small>
        ) : null}
      </div>
    </section>
  );
}
