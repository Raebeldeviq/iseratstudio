"use client";

import type {
  PreflightCategory,
  PreflightReport,
} from "../lib/preflight";

type PreflightPanelProps = {
  report: PreflightReport;
  title?: string;
  description?: string;
  compact?: boolean;
};

function categoryStatus(category: PreflightCategory): string {
  if (category.blockerCount) {
    return `${category.blockerCount} Blocker`;
  }
  if (category.warningCount) {
    return `${category.warningCount} Hinweis${category.warningCount === 1 ? "" : "e"}`;
  }
  return "Bereit";
}

export function PreflightPanel({
  report,
  title = "Vorabprüfung",
  description = "Alle Pflichtangaben werden unmittelbar vor dem Start erneut geprüft.",
  compact = false,
}: PreflightPanelProps) {
  const state = !report.targetCount
    ? "empty"
    : report.canStart ? "ready" : "blocked";
  const headline = !report.targetCount
    ? "Noch keine Zieladresse ausgewählt"
    : report.canStart
      ? report.warningCount
        ? `Startklar · ${report.warningCount} Hinweis${report.warningCount === 1 ? "" : "e"}`
        : "Startklar · alle Prüfungen bestanden"
      : `Start gesperrt · ${report.blockerCount} Blocker`;

  return (
    <section className={`preflight-panel ${state}${compact ? " compact" : ""}`} aria-labelledby={`preflight-${report.mode}`}>
      <header>
        <div>
          <span className="eyebrow">{title}</span>
          <h3 id={`preflight-${report.mode}`} aria-live="polite">{headline}</h3>
          <p>{description}</p>
        </div>
        <div className="preflight-total">
          <b>{report.targetCount}</b>
          <span>Zieladresse{report.targetCount === 1 ? "" : "n"}</span>
        </div>
      </header>

      <div className="preflight-categories">
        {report.categories.map((category) => (
          <details
            className={`preflight-category ${category.status}`}
            open={category.blockerCount > 0}
            key={category.id}
          >
            <summary>
              <span>
                <b>{category.title}</b>
                <small>{category.description}</small>
              </span>
              <strong>{categoryStatus(category)}</strong>
            </summary>
            {category.items.length ? (
              <div className="preflight-items">
                {category.items.map((item) => (
                  <div className={`preflight-item ${item.severity}`} key={item.id}>
                    <span aria-hidden="true">{item.severity === "blocker" ? "!" : "i"}</span>
                    <div>
                      <b>{item.label}</b>
                      {item.detail ? <small>{item.detail}</small> : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="preflight-ready-line">Keine fehlenden Angaben gefunden.</div>
            )}
          </details>
        ))}
      </div>
    </section>
  );
}
