"use client";

import { useMemo } from "react";
import { buildExecutiveReport } from "../lib/executive-report";
import type { OperationalStatus, StudioState } from "../types";

type ExecutiveReportProps = {
  state: StudioState;
  onOpenMember: (userId: string) => void;
};

const STATUS_LABELS: Record<OperationalStatus, string> = {
  current: "Aktuell",
  attention: "Beachten",
  critical: "Kritisch",
};

export default function ExecutiveReport({
  state,
  onOpenMember,
}: ExecutiveReportProps) {
  const report = useMemo(() => buildExecutiveReport(state), [state]);
  const trendMaximum = Math.max(
    1,
    ...report.trend.map((point) => point.uploads + point.failures),
  );

  return (
    <section className="executive-report" aria-labelledby="executive-report-title">
      <header>
        <div>
          <span className="eyebrow">Geschäftsführungs-Reporting</span>
          <h2 id="executive-report-title">Leistung, Aktualität und Portalqualität</h2>
          <p>Kennzahlen berücksichtigen automatisch nur den sichtbaren Unternehmensbereich.</p>
        </div>
        <span className="report-period">Rollierend · 30 Tage</span>
      </header>

      <div className="executive-kpis">
        <article><span>Mitarbeiter</span><b>{report.totals.headcount}</b><small>{report.totals.criticalEmployees} kritisch</small></article>
        <article><span>Aktive Objekte</span><b>{report.totals.activeObjects}</b><small>{report.totals.onlineObjects} online</small></article>
        <article><span>Übertragungen</span><b>{report.totals.uploads30Days}</b><small>letzte 30 Tage</small></article>
        <article className={report.totals.portalErrors ? "attention" : ""}><span>Portalfehler</span><b>{report.totals.portalErrors}</b><small>{report.totals.successRate}% Erfolgsquote</small></article>
        <article className={report.totals.dueActions ? "attention" : ""}><span>Fälligkeiten</span><b>{report.totals.dueActions}</b><small>Aufgaben und Erneuerungen</small></article>
      </div>

      <div className="executive-report-grid">
        <section className="executive-trend">
          <header><h3>Übertragungsverlauf</h3><span>6 Wochen</span></header>
          <div className="trend-bars">
            {report.trend.map((point) => (
              <div key={point.key}>
                <span className="trend-bar-track" title={`${point.uploads} erfolgreich · ${point.failures} fehlerhaft`}>
                  <i
                    className="success"
                    style={{ height: `${Math.max(4, Math.round((point.uploads / trendMaximum) * 100))}%` }}
                  />
                  <i
                    className="failure"
                    style={{ height: `${Math.round((point.failures / trendMaximum) * 100)}%` }}
                  />
                </span>
                <small>{point.label}</small>
              </div>
            ))}
          </div>
          <div className="trend-legend"><span><i className="success" /> erfolgreich</span><span><i className="failure" /> fehlerhaft</span></div>
        </section>

        <section className="executive-units">
          <header><h3>Bereiche und Teams</h3><span>{report.units.length} Einheiten</span></header>
          <div className="executive-table-scroll">
            <table>
              <thead><tr><th>Einheit</th><th>Mitarbeiter</th><th>Objekte</th><th>Online</th><th>Fehler</th><th>Fällig</th><th>Quote</th></tr></thead>
              <tbody>
                {report.units.map((row) => (
                  <tr key={row.unit.id}>
                    <td><b>{row.unit.name}</b><small>{row.unit.type === "company" ? "Unternehmen" : row.unit.type === "division" ? "Bereich" : row.unit.type === "region" ? "Region" : "Team"}</small></td>
                    <td>{row.headcount}{row.criticalEmployees ? <small className="metric-alert">{row.criticalEmployees} kritisch</small> : null}</td>
                    <td>{row.activeObjects}</td>
                    <td>{row.onlineObjects}</td>
                    <td className={row.portalErrors ? "metric-alert" : ""}>{row.portalErrors}</td>
                    <td className={row.dueActions ? "metric-alert" : ""}>{row.dueActions}</td>
                    <td>{row.successRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="executive-employees">
        <header><h3>Mitarbeiterleistung</h3><span>Objektiv aus Arbeits- und Portalereignissen</span></header>
        <div className="executive-table-scroll">
          <table>
            <thead>
              <tr><th>Mitarbeiter</th><th>Status</th><th>Objekte</th><th>Online</th><th>Uploads</th><th>Portalquote</th><th>Termine</th><th>Offen</th><th /></tr>
            </thead>
            <tbody>
              {report.employees.map((row) => (
                <tr key={row.userId}>
                  <td><b>{row.name}</b><small>{row.unitNames.join(", ") || "Kein Bereich"}</small></td>
                  <td><span className={`team-status ${row.status}`}>{STATUS_LABELS[row.status]}</span></td>
                  <td>{row.activeObjects}<small>{row.staleObjects} nicht aktuell</small></td>
                  <td>{row.onlineObjects}</td>
                  <td>{row.uploads30Days}</td>
                  <td className={row.failedOperations30Days ? "metric-alert" : ""}>{row.successRate}%<small>{row.failedOperations30Days} Fehler</small></td>
                  <td>{row.completedAppointments30Days}</td>
                  <td className={row.dueActions ? "metric-alert" : ""}>{row.dueActions}</td>
                  <td><button type="button" onClick={() => onOpenMember(row.userId)}>Objekte öffnen</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
