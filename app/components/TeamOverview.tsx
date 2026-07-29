"use client";

import { useMemo, useState } from "react";
import type { OperationalStatus, StudioState } from "../types";
import {
  buildStaffOperationalMetrics,
  BUSINESS_ROLE_LABELS,
} from "../lib/organization";

type TeamOverviewProps = {
  state: StudioState;
  onOpenMember: (userId: string) => void;
};

const STATUS_LABELS: Record<OperationalStatus, string> = {
  current: "Aktuell",
  attention: "Handlungsbedarf",
  critical: "Kritisch",
};

function formatDate(value: string | undefined): string {
  if (!value) return "Keine Aktivität";
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

export default function TeamOverview({
  state,
  onOpenMember,
}: TeamOverviewProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | OperationalStatus>("all");
  const metrics = useMemo(() => buildStaffOperationalMetrics(state), [state]);
  const units = state.management?.organizationUnits ?? [];
  const filtered = metrics.filter((entry) => {
    if (status !== "all" && entry.status !== status) return false;
    const normalized = query.trim().toLocaleLowerCase("de-DE");
    if (!normalized) return true;
    const unitNames = units
      .filter((unit) => entry.user.organizationUnitIds.includes(unit.id))
      .map((unit) => unit.name);
    return [
      entry.user.name,
      entry.user.email,
      BUSINESS_ROLE_LABELS[entry.user.businessRole],
      ...unitNames,
    ].some((value) => value.toLocaleLowerCase("de-DE").includes(normalized));
  });
  const critical = metrics.filter((entry) => entry.status === "critical").length;
  const attention = metrics.filter((entry) => entry.status === "attention").length;
  const current = metrics.filter((entry) => entry.status === "current").length;

  return (
    <section className="team-overview" aria-labelledby="team-overview-title">
      <header>
        <div>
          <span className="eyebrow">Führungsübersicht</span>
          <h2 id="team-overview-title">Mitarbeiterstatus und Aktualität</h2>
          <p>Der sichtbare Bereich richtet sich automatisch nach Rolle, Team und Vorgesetztenstruktur.</p>
        </div>
        <div className="team-status-summary" aria-label="Mitarbeiterstatus">
          <span className="current"><b>{current}</b> aktuell</span>
          <span className="attention"><b>{attention}</b> beachten</span>
          <span className="critical"><b>{critical}</b> kritisch</span>
        </div>
      </header>

      <div className="team-toolbar">
        <input
          type="search"
          value={query}
          placeholder="Mitarbeiter, Funktion oder Bereich suchen"
          aria-label="Mitarbeiter durchsuchen"
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          value={status}
          aria-label="Status filtern"
          onChange={(event) => setStatus(event.target.value as typeof status)}
        >
          <option value="all">Alle Status</option>
          <option value="critical">Kritisch</option>
          <option value="attention">Handlungsbedarf</option>
          <option value="current">Aktuell</option>
        </select>
      </div>

      <div className="team-table-wrap">
        <table className="team-table">
          <thead>
            <tr>
              <th>Mitarbeiter</th>
              <th>Status</th>
              <th>Objekte</th>
              <th>Entwürfe</th>
              <th>Fehler</th>
              <th>Fälligkeiten</th>
              <th>Letzte Objektänderung</th>
              <th>Letzte Aktivität</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((entry) => {
              const unitNames = units
                .filter((unit) => entry.user.organizationUnitIds.includes(unit.id))
                .map((unit) => unit.name)
                .join(", ");
              return (
                <tr key={entry.user.id}>
                  <td>
                    <div className="team-person">
                      <span>{entry.user.name.slice(0, 2).toUpperCase()}</span>
                      <div>
                        <b>{entry.user.name}</b>
                        <small>{BUSINESS_ROLE_LABELS[entry.user.businessRole]} · {unitNames || "Kein Bereich"}</small>
                      </div>
                    </div>
                  </td>
                  <td><span className={`team-status ${entry.status}`}>{STATUS_LABELS[entry.status]}</span></td>
                  <td><b>{entry.activeObjects}</b><small>{entry.online} online</small></td>
                  <td>{entry.drafts}</td>
                  <td className={entry.portalErrors ? "metric-alert" : ""}>{entry.portalErrors}</td>
                  <td className={entry.dueActions || entry.dueRenewals ? "metric-alert" : ""}>
                    {entry.dueActions + entry.dueRenewals}
                    <small>{entry.staleObjects} nicht aktuell</small>
                  </td>
                  <td>{formatDate(entry.lastObjectUpdateAt)}</td>
                  <td>{formatDate(entry.lastActivityAt)}</td>
                  <td>
                    <button type="button" onClick={() => onOpenMember(entry.user.id)}>
                      Bereich öffnen
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!filtered.length ? (
          <div className="dashboard-empty">
            <b>Keine Mitarbeiter gefunden</b>
            <span>Passe Suche oder Statusfilter an.</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
