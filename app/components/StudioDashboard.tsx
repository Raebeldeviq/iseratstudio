"use client";

import { useMemo } from "react";
import type { ManagementRole, StudioState } from "../types";
import type { RenewalScheduleEntry } from "../lib/renewal-schedule";
import { deriveListingLifecycle } from "../lib/management";
import {
  leadershipAccess,
  visibleUserIds,
} from "../lib/organization";
import TeamOverview from "./TeamOverview";
import ExecutiveReport from "./ExecutiveReport";

type StudioDashboardProps = {
  state: StudioState;
  role: ManagementRole;
  canUseLibrary: boolean;
  canUseWork: boolean;
  renewalEntries: RenewalScheduleEntry[];
  openJobCount: number;
  onCreateObject: () => void;
  onOpenObjects: () => void;
  onOpenListing: (listingId: string) => void;
  onOpenRenewals: () => void;
  onOpenJobs: () => void;
  onOpenLibrary: () => void;
  onOpenMember: (userId: string) => void;
};

const LIFECYCLE_LABELS = {
  draft: "Entwurf",
  ready: "Bereit",
  transferred: "Übertragen",
  online: "Online",
  error: "Fehler",
  archived: "Archiviert",
} as const;

function formatDate(value: string | undefined): string {
  if (!value) return "Noch nicht gespeichert";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Datum unbekannt";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function StudioDashboard({
  state,
  role,
  canUseLibrary,
  canUseWork,
  renewalEntries,
  openJobCount,
  onCreateObject,
  onOpenObjects,
  onOpenListing,
  onOpenRenewals,
  onOpenJobs,
  onOpenLibrary,
  onOpenMember,
}: StudioDashboardProps) {
  const currentUser = state.management?.users.find((user) => (
    user.id === state.management?.currentUserId
  ));
  const allowedUserIds = useMemo(() => (
    state.management && currentUser
      ? visibleUserIds(state.management, currentUser.id)
      : new Set<string>()
  ), [currentUser, state.management]);
  const rows = useMemo(() => (
    state.projects.flatMap((project) => (
      project.listings.flatMap((listing) => (
        listing.management
        && listing.management.assignedUserId
        && allowedUserIds.has(listing.management.assignedUserId)
          ? [{
              project,
              listing,
              management: listing.management,
              lifecycle: deriveListingLifecycle(listing.management, listing.uploadedAt),
            }]
          : []
      ))
    ))
  ), [allowedUserIds, state.projects]);

  const activeRows = rows.filter((row) => !row.management.archivedAt);
  const drafts = activeRows.filter((row) => row.lifecycle === "draft");
  const errors = activeRows.filter((row) => (
    row.lifecycle === "error"
    || row.management.portals.some((portal) => portal.status === "error")
  ));
  const online = activeRows.filter((row) => row.lifecycle === "online");
  const dueRenewals = renewalEntries.filter((entry) => (
    entry.status === "today" || entry.status === "overdue" || entry.untracked
  ));
  const openTaskCount = drafts.length + (
    canUseWork ? errors.length + dueRenewals.length + openJobCount : 0
  );
  const recent = [...activeRows]
    .sort((left, right) => (
      new Date(right.management.updatedAt).getTime()
      - new Date(left.management.updatedAt).getTime()
    ))
    .slice(0, 6);
  const canEdit = role !== "viewer";

  return (
    <section className="studio-dashboard" aria-labelledby="dashboard-title">
      <header className="dashboard-hero">
        <div>
          <span className="eyebrow">Arbeitsübersicht</span>
          <h1 id="dashboard-title">Was ist als Nächstes zu tun?</h1>
          <p>Objekte, Portalzustände und offene Aufgaben an einem Ort – priorisiert statt verteilt.</p>
        </div>
        {canEdit ? (
          <button type="button" className="primary dashboard-primary" onClick={onCreateObject}>
            + Neues Objekt
          </button>
        ) : (
          <span className="dashboard-role-note">Nur-Lese-Ansicht</span>
        )}
      </header>

      <div className="dashboard-metrics" aria-label="Kennzahlen">
        <button type="button" onClick={onOpenObjects}>
          <span>Objekte</span><b>{activeRows.length}</b><small>{online.length} online</small>
        </button>
        <button type="button" onClick={onOpenObjects}>
          <span>Entwürfe</span><b>{drafts.length}</b><small>weiter bearbeiten</small>
        </button>
        <button type="button" disabled={!canUseWork} className={errors.length ? "attention" : ""} onClick={onOpenJobs}>
          <span>Fehler</span><b>{errors.length + openJobCount}</b><small>prüfen und beheben</small>
        </button>
        <button type="button" disabled={!canUseWork} className={dueRenewals.length ? "attention" : ""} onClick={onOpenRenewals}>
          <span>Fällige Erneuerungen</span><b>{dueRenewals.length}</b><small>heute oder überfällig</small>
        </button>
      </div>

      <div className="dashboard-grid">
        <section className="dashboard-card dashboard-tasks">
          <header>
            <div><span className="eyebrow">Priorisiert</span><h2>Offene Aufgaben</h2></div>
            <span>{openTaskCount} offen</span>
          </header>
          <div className="dashboard-task-list">
            {canEdit ? (
              <button type="button" onClick={onCreateObject}>
                <i className="task-icon create">+</i>
                <span><b>Neues Objekt anlegen</b><small>Geführt von den Grunddaten bis zur Veröffentlichung</small></span>
                <strong>Starten</strong>
              </button>
            ) : null}
            {drafts.length ? (
              <button type="button" onClick={onOpenObjects}>
                <i className="task-icon draft">{drafts.length}</i>
                <span><b>Entwürfe vervollständigen</b><small>Pflichtfelder, Medien und Texte fertigstellen</small></span>
                <strong>Öffnen</strong>
              </button>
            ) : null}
            {canUseWork && (errors.length || openJobCount) ? (
              <button type="button" onClick={onOpenJobs}>
                <i className="task-icon error">!</i>
                <span><b>Übertragungsfehler prüfen</b><small>{errors.length} Portalfehler · {openJobCount} offene Aufträge</small></span>
                <strong>Prüfen</strong>
              </button>
            ) : null}
            {canUseWork && dueRenewals.length ? (
              <button type="button" onClick={onOpenRenewals}>
                <i className="task-icon due">7</i>
                <span><b>Inserate erneuern</b><small>{dueRenewals.length} Adressen sind heute fällig oder überfällig</small></span>
                <strong>Planen</strong>
              </button>
            ) : null}
            {openTaskCount === 0 ? (
              <div className="dashboard-empty">
                <b>Alles erledigt</b>
                <span>Aktuell gibt es keine dringenden Aufgaben.</span>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="dashboard-card dashboard-portals">
          <header><div><span className="eyebrow">Live-Status</span><h2>Portale</h2></div></header>
          <div>
            {(state.management?.portals ?? []).map((portal) => {
              const portalRows = activeRows.flatMap((row) => (
                row.management.portals.filter((item) => item.portalId === portal.id)
              ));
              const portalOnline = portalRows.filter((item) => item.status === "online").length;
              const portalErrors = portalRows.filter((item) => item.status === "error").length;
              return (
                <article key={portal.id}>
                  <i className={portalErrors ? "error" : portal.enabled ? "online" : "offline"} />
                  <span><b>{portal.name}</b><small>{portalErrors ? `${portalErrors} Fehler` : `${portalOnline} online`}</small></span>
                  <strong>{portal.enabled ? "Verbunden" : "Inaktiv"}</strong>
                </article>
              );
            })}
          </div>
        </aside>

        {leadershipAccess(currentUser) || (state.management?.users.length ?? 0) > 1 ? (
          <>
            <TeamOverview state={state} onOpenMember={onOpenMember} />
            <ExecutiveReport state={state} onOpenMember={onOpenMember} />
          </>
        ) : null}

        <section className="dashboard-card dashboard-recent">
          <header>
            <div><span className="eyebrow">Zuletzt bearbeitet</span><h2>Objekte</h2></div>
            <button type="button" onClick={onOpenObjects}>Alle anzeigen</button>
          </header>
          <div className="dashboard-object-list">
            {recent.map(({ project, listing, management, lifecycle }) => (
              <button type="button" key={listing.id} onClick={() => onOpenListing(listing.id)}>
                <span className={`lifecycle-badge ${lifecycle}`}>{LIFECYCLE_LABELS[lifecycle]}</span>
                <span>
                  <b>{listing.texts.title || listing.templateName}</b>
                  <small>{listing.externalId} · {management.details.zip} {management.details.city || project.city}</small>
                </span>
                <time>{formatDate(management.updatedAt)}</time>
              </button>
            ))}
            {!recent.length ? (
              <div className="dashboard-empty">
                <b>Noch keine Objektakten</b>
                <span>Lege das erste Objekt über den geführten Prozess an.</span>
              </div>
            ) : null}
          </div>
        </section>

        {canUseLibrary || canUseWork ? (
        <aside className="dashboard-card dashboard-shortcuts">
          <header><div><span className="eyebrow">Direktzugriff</span><h2>Werkzeuge</h2></div></header>
          {canUseLibrary ? <button type="button" onClick={onOpenLibrary}><span>Vorlagen & Medien</span><strong>Haustypen verwalten</strong></button> : null}
          {canUseWork ? <button type="button" onClick={onOpenRenewals}><span>7-Tage-Zentrale</span><strong>Erneuerungen planen</strong></button> : null}
          {canUseWork ? <button type="button" onClick={onOpenJobs}><span>Auftragszentrale</span><strong>Läufe und Fehler prüfen</strong></button> : null}
        </aside>
        ) : null}
      </div>
    </section>
  );
}
