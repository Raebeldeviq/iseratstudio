"use client";

import { useEffect, useState } from "react";
import { runJobProgress } from "../lib/job-center";
import {
  estimateProductionPipeline,
  PIPELINE_CONCURRENCY,
  PIPELINE_ESTIMATE_STATUS_LABELS,
  PIPELINE_PRICE_SNAPSHOT_DATE,
} from "../lib/pipeline-estimate";
import type {
  AddressOwner,
  AiModelId,
  HouseTemplate,
  ProjectInput,
  TotalSyncListingStatus,
  TotalSyncRun,
  UploadRunHistoryEntry,
} from "../types";

type StatusFilter = "all" | "open" | "uploaded" | "failed" | "unknown";
type OwnerFilter = "all" | AddressOwner;

type UploadJobCenterProps = {
  run?: TotalSyncRun;
  history: UploadRunHistoryEntry[];
  projects: ProjectInput[];
  houses: HouseTemplate[];
  fallbackAiModel: AiModelId;
  busy: boolean;
  stopping: boolean;
  statusText: string;
  onRetryFailed: () => void;
  onContinue: () => void;
  onStop: () => void;
  onDiscard: () => void;
  onOpenProject: (projectId: string) => void;
  onMarkUnknownFailed: (projectId: string, externalId: string) => void;
};

const STATUS_LABELS: Record<TotalSyncListingStatus, string> = {
  pending: "Wartend",
  generating: "Text wird erzeugt",
  ready: "Upload bereit",
  uploading: "Wird übertragen",
  uploaded: "Erfolgreich",
  failed: "Fehlgeschlagen",
  unknown: "Eingang prüfen",
};

const STATUS_ORDER: Record<TotalSyncListingStatus, number> = {
  failed: 0,
  unknown: 1,
  uploading: 2,
  generating: 3,
  ready: 4,
  pending: 5,
  uploaded: 6,
};

function dateTime(value: string | undefined): string {
  if (!value) return "–";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "–";
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function runKindLabel(kind: string | undefined): string {
  return kind === "seven-day" ? "7-Tage-Erneuerung" : "Totalabgleich";
}

function runStatusLabel(status: string | undefined): string {
  if (status === "running") return "Läuft";
  if (status === "paused") return "Pausiert";
  if (status === "completed") return "Abgeschlossen";
  if (status === "completed-with-errors") return "Mit Fehlern beendet";
  if (status === "discarded") return "Verworfen";
  return "Vorbereitet";
}

export function UploadJobCenter({
  run,
  history,
  projects,
  houses,
  fallbackAiModel,
  busy,
  stopping,
  statusText,
  onRetryFailed,
  onContinue,
  onStop,
  onDiscard,
  onOpenProject,
  onMarkUnknownFailed,
}: UploadJobCenterProps) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>("all");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!busy) return undefined;
    const timer = window.setInterval(() => setNowMs(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [busy]);
  const progress = runJobProgress(run);
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const houseById = new Map(houses.map((house) => [house.id, house]));
  const rows = (run?.tasks ?? []).flatMap((task) => (
    (task.listingJobs ?? []).map((job) => {
      const project = projectById.get(task.projectId);
      const house = houseById.get(job.houseId);
      return {
        ...job,
        projectId: task.projectId,
        projectName: project?.name || task.protectedLocation?.name || task.projectId,
        owner: project?.owner || task.protectedLocation?.owner || "fabian",
        street: project?.street || task.protectedLocation?.street || "",
        houseNumber: project?.houseNumber || task.protectedLocation?.houseNumber || "",
        zip: project?.zip || task.protectedLocation?.zip || "",
        city: project?.city || task.protectedLocation?.city || "",
        houseName: house?.name
          || project?.listings.find((listing) => listing.externalId === job.externalId)?.templateName
          || job.houseId,
      };
    })
  ));
  const normalizedQuery = query.trim().toLocaleLowerCase("de-DE");
  const filteredRows = rows
    .filter((row) => {
      const statusMatches = statusFilter === "all"
        || (statusFilter === "open"
          ? row.status === "pending"
            || row.status === "generating"
            || row.status === "ready"
            || row.status === "uploading"
          : row.status === statusFilter);
      const ownerMatches = ownerFilter === "all" || row.owner === ownerFilter;
      const queryMatches = !normalizedQuery || [
        row.projectName,
        row.street,
        row.houseNumber,
        row.zip,
        row.city,
        row.externalId,
        row.houseName,
      ].join(" ").toLocaleLowerCase("de-DE").includes(normalizedQuery);
      return statusMatches && ownerMatches && queryMatches;
    })
    .sort((left, right) => (
      STATUS_ORDER[left.status] - STATUS_ORDER[right.status]
      || left.projectName.localeCompare(right.projectName, "de")
      || left.slot - right.slot
    ));
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visibleRows = filteredRows.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize,
  );
  const hasFinalizationWork = Boolean(run && run.status !== "completed" && run.tasks.some((task) => (
    !task.completedAt
    && (task.listingJobs?.length ?? 0) > 0
    && task.listingJobs!.every((job) => job.status === "uploaded")
  )));
  const hasOpenJobs = progress.pending + progress.ready + progress.active > 0
    || hasFinalizationWork
    || Boolean(run?.tasks.some((task) => task.lastError && progress.failed === 0));
  const allJobs = (run?.tasks ?? []).flatMap((task) => task.listingJobs ?? []);
  const completedDuration = (
    startedAt: string,
    completedAt: string | undefined,
  ): number | null => {
    if (!completedAt) return null;
    const duration = new Date(completedAt).getTime() - new Date(startedAt).getTime();
    return Number.isFinite(duration) && duration > 0 ? duration : null;
  };
  const generationDurations = allJobs.flatMap((job) => (
    job.attempts
      .filter((attempt) => attempt.stage === "generation")
      .map((attempt) => completedDuration(attempt.startedAt, attempt.completedAt))
      .filter((duration): duration is number => duration !== null)
  ));
  const uploadDurations = allJobs.flatMap((job) => (
    job.attempts
      .filter((attempt) => attempt.stage === "upload")
      .map((attempt) => completedDuration(attempt.startedAt, attempt.completedAt))
      .filter((duration): duration is number => duration !== null)
  ));
  const currentAttempt = run?.status === "running"
    ? [...(run.attempts ?? [])].reverse().find((attempt) => !attempt.completedAt)
    : undefined;
  const currentAttemptStartedMs = currentAttempt
    ? new Date(currentAttempt.startedAt).getTime()
    : Number.NaN;
  const touchedDuringCurrentAttempt = (
    lastAttemptAt: string | undefined,
  ): boolean => {
    if (!currentAttempt || !lastAttemptAt) return false;
    const attemptMs = new Date(lastAttemptAt).getTime();
    return Number.isFinite(attemptMs)
      && Number.isFinite(currentAttemptStartedMs)
      && attemptMs >= currentAttemptStartedMs;
  };
  const jobBelongsToCurrentWork = (
    job: (typeof allJobs)[number],
  ): boolean => {
    if (!currentAttempt) {
      return job.status !== "uploaded" && job.status !== "unknown";
    }
    if (job.status === "generating" || job.status === "uploading") return true;
    if (job.status === "failed") {
      return !touchedDuringCurrentAttempt(job.lastAttemptAt);
    }
    if (currentAttempt.mode === "failed-only") {
      return job.status === "ready"
        && touchedDuringCurrentAttempt(job.lastAttemptAt);
    }
    return job.status === "pending" || job.status === "ready";
  };
  const remainingBatches = (run?.tasks ?? []).map((task) => {
    const project = projectById.get(task.projectId);
    const runListingIds = new Set(
      project?.listings
        .filter((listing) => listing.totalSyncRunId === run?.id)
        .map((listing) => listing.externalId) ?? [],
    );
    const jobs = (task.listingJobs ?? []).filter(jobBelongsToCurrentWork);
    return {
      remainingGenerations: jobs.filter(
        (job) => !runListingIds.has(job.externalId),
      ).length,
      remainingUploads: jobs.length,
    };
  }).filter((batch) => (
    batch.remainingGenerations > 0 || batch.remainingUploads > 0
  ));
  const remainingGenerationCount = remainingBatches.reduce(
    (sum, batch) => sum + batch.remainingGenerations,
    0,
  );
  const remainingUploadCount = remainingBatches.reduce(
    (sum, batch) => sum + batch.remainingUploads,
    0,
  );
  const tokenUsageRecords = allJobs.flatMap(
    (job) => job.aiUsage ? [job.aiUsage] : [],
  );
  const measuredTokenUsageRecords = tokenUsageRecords.filter((usage) => (
    usage.requestCount > 0 && usage.inputTokens + usage.outputTokens > 0
  ));
  const referenceNowMs = Math.max(
    nowMs,
    Number.isFinite(currentAttemptStartedMs) ? currentAttemptStartedMs : 0,
  );
  const activeElapsedMs = (stage: "generation" | "upload"): number => (
    Math.max(
      0,
      ...allJobs
        .filter((job) => (
          stage === "generation"
            ? job.status === "generating"
            : job.status === "uploading"
        ))
        .flatMap((job) => {
          const attempt = [...job.attempts].reverse().find((item) => (
            item.stage === stage && !item.completedAt
          ));
          if (!attempt) return [];
          const startedAtMs = new Date(attempt.startedAt).getTime();
          return Number.isFinite(startedAtMs)
            ? [Math.max(0, referenceNowMs - startedAtMs)]
            : [];
        }),
    )
  );
  const pipelineEstimate = estimateProductionPipeline({
    model: run?.aiModel ?? fallbackAiModel,
    tokenUsage: tokenUsageRecords,
    generationDurationsMs: generationDurations,
    uploadDurationsMs: uploadDurations,
    remainingGenerations: remainingGenerationCount,
    remainingUploads: remainingUploadCount,
    batches: remainingBatches,
    activeGenerationElapsedMs: activeElapsedMs("generation"),
    activeUploadElapsedMs: activeElapsedMs("upload"),
  });
  const generatingCount = allJobs.filter((job) => job.status === "generating").length;
  const uploadingCount = allJobs.filter((job) => job.status === "uploading").length;
  const readyCount = allJobs.filter((job) => job.status === "ready").length;
  const generationQueueCount = Math.max(
    0,
    remainingGenerationCount - generatingCount,
  );
  const estimateIsReliable = generationDurations.length >= 3
    && uploadDurations.length >= 3
    && measuredTokenUsageRecords.length >= 3;
  const estimatedWorkRemains = remainingGenerationCount > 0
    || remainingUploadCount > 0;
  const effectiveModel = run?.aiModel ?? fallbackAiModel;
  const modelLabel = effectiveModel === "gpt-5.6-sol"
    ? "Sol"
    : effectiveModel === "gpt-5.6-terra"
      ? "Terra"
      : effectiveModel === "gpt-5.6-luna"
        ? "Luna"
        : "Luna";

  return (
    <section className="workspace job-center">
      <div className="content-card job-center-intro">
        <div>
          <span className="eyebrow">Auftrags- und Fehlerzentrum</span>
          <h2>Jedes Inserat im Blick</h2>
          <p>
            Ein einzelner Fehler stoppt keine andere Adresse. Erfolgreiche
            Objekt-IDs bleiben geschützt und werden bei einer Wiederholung
            nicht erneut übertragen.
          </p>
        </div>
        <div className="job-center-safety">
          <b>Einzeln gespeichert</b>
          <span>Status, Versuche, Fehlermeldung und letzter Zeitpunkt bleiben in der Gerätesicherung erhalten.</span>
        </div>
      </div>

      <div className="job-metrics" aria-label="Inseratstatus des aktuellen Laufs">
        <div className="pending"><span>Wartend</span><b>{progress.pending + progress.ready}</b></div>
        <div className="active"><span>In Bearbeitung</span><b>{progress.active}</b></div>
        <div className="uploaded"><span>Erfolgreich</span><b>{progress.uploaded}</b></div>
        <div className="failed"><span>Fehlgeschlagen</span><b>{progress.failed}</b></div>
        <div className="unknown"><span>Zu prüfen</span><b>{progress.unknown}</b></div>
      </div>

      <div className="content-card job-current-run">
        <header>
          <div>
            <span className="eyebrow">Aktueller Auftrag</span>
            <h3>{run ? `${runKindLabel(run.kind)} · ${runStatusLabel(run.status)}` : "Kein Lauf vorbereitet"}</h3>
            <p>
              {run
                ? `${run.tasks.length} Adressen · ${progress.total} Inserate · gestartet ${dateTime(run.startedAt || run.createdAt)}`
                : "Sobald ein Totalabgleich oder eine 7-Tage-Erneuerung startet, erscheinen hier alle Inserate einzeln."}
            </p>
          </div>
          {run ? (
            <span className={`job-run-status ${run.status}`}>
              {runStatusLabel(run.status)}
            </span>
          ) : null}
        </header>

        {run ? (
          <>
            <div className="job-progress-summary">
              <div>
                <b>{statusText || `${progress.handled}/${progress.total} bearbeitet`}</b>
                <span>{progress.uploaded} erfolgreich · {progress.failed} fehlgeschlagen · {progress.unknown} zu prüfen</span>
              </div>
              <div
                className="progress-track"
                role="progressbar"
                aria-label="Bearbeitungsfortschritt des Uploadlaufs"
                aria-valuemin={0}
                aria-valuemax={progress.total}
                aria-valuenow={progress.handled}
                aria-valuetext={`${progress.handled} von ${progress.total} Inseraten bearbeitet`}
              >
                <span style={{ width: `${progress.total ? Math.round((progress.handled / progress.total) * 100) : 0}%` }} />
              </div>
              <div className="pipeline-live-card" aria-label="Produktionspipeline">
                <div className="pipeline-capacity">
                  <div>
                    <span>KI-Texte</span>
                    <b>{generatingCount}/{PIPELINE_CONCURRENCY.generation} aktiv</b>
                    <small>{generationQueueCount} warten</small>
                  </div>
                  <div>
                    <span>Upload</span>
                    <b>{uploadingCount}/{PIPELINE_CONCURRENCY.upload} aktiv</b>
                    <small>{readyCount} bereit</small>
                  </div>
                </div>
                <div className="pipeline-estimates">
                  <div>
                    <span>Restzeit</span>
                    <b>
                      {run.status !== "running" && estimatedWorkRemains
                        ? `${pipelineEstimate.time.formattedRemaining} nach Fortsetzung`
                        : pipelineEstimate.time.formattedRemaining}
                    </b>
                  </div>
                  <div>
                    <span>KI-Kosten</span>
                    <b>
                      {measuredTokenUsageRecords.length
                        ? `${pipelineEstimate.cost.formattedCompleted} bisher`
                        : "noch keine Tokenmessung"}
                      {pipelineEstimate.cost.projectedTotalUsd !== null
                        && (measuredTokenUsageRecords.length || estimatedWorkRemains)
                        ? ` · ca. ${pipelineEstimate.cost.formattedProjectedTotal} gesamt`
                        : ""}
                      {` · ${modelLabel}`}
                    </b>
                  </div>
                </div>
                <details className="pipeline-estimate-details">
                  <summary>Wie wird geschätzt?</summary>
                  <p>
                    Zwei KI-Texte werden gleichzeitig vorbereitet; Immoprofessional
                    erhält weiterhin exakt ein Inserat nach dem anderen. Restzeit
                    und Kosten verwenden die gemessenen Laufzeiten und die von
                    OpenAI gemeldeten Ein- und Ausgabetokens.
                  </p>
                  <p>
                    {PIPELINE_ESTIMATE_STATUS_LABELS[pipelineEstimate.status]}
                    {" · "}
                    {generationDurations.length} Text- und {uploadDurations.length} Uploadmessungen
                    {estimateIsReliable ? "" : " · mit Sicherheitswerten, bis mindestens drei Messungen vorliegen"}
                    {` · API-Preise vom ${new Intl.DateTimeFormat("de-DE").format(new Date(`${PIPELINE_PRICE_SNAPSHOT_DATE}T00:00:00Z`))}`}
                    {progress.unknown ? ` · ${progress.unknown} ungeklärte Eingänge sind nicht in der Automatik-Restzeit enthalten` : ""}.
                  </p>
                </details>
              </div>
            </div>

            <div className="job-primary-actions">
              {busy ? (
                <button
                  type="button"
                  className="primary"
                  disabled={stopping}
                  onClick={onStop}
                >
                  {stopping ? "Wird sicher angehalten …" : "Nach laufenden Schritten anhalten"}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="primary"
                    disabled={progress.failed === 0}
                    onClick={onRetryFailed}
                  >
                    Nur fehlgeschlagene erneut übertragen · {progress.failed}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={!hasOpenJobs}
                    onClick={onContinue}
                  >
                    Offene Aufträge fortsetzen
                  </button>
                  <button type="button" className="secondary" onClick={onDiscard}>
                    Lauf archivieren und schließen
                  </button>
                </>
              )}
            </div>
            {progress.unknown ? (
              <p className="job-unknown-warning">
                {progress.unknown} Upload{progress.unknown === 1 ? "" : "s"} wurden
                während der Übertragung unterbrochen. Bitte zuerst in
                Immoprofessional prüfen und erst danach einzeln zur Wiederholung
                freigeben.
              </p>
            ) : null}
          </>
        ) : null}
      </div>

      {run ? (
        <div className="content-card job-table-card">
          <div className="job-table-toolbar">
            <label className="field job-search">
              <span>Inserate durchsuchen</span>
              <input
                type="search"
                value={query}
                placeholder="Adresse, Ort, Objekt-ID oder Haustyp"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
              />
            </label>
            <label className="field">
              <span>Status</span>
              <select
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(event.target.value as StatusFilter);
                  setPage(1);
                }}
              >
                <option value="all">Alle Status</option>
                <option value="open">Offen</option>
                <option value="uploaded">Erfolgreich</option>
                <option value="failed">Fehlgeschlagen</option>
                <option value="unknown">Eingang prüfen</option>
              </select>
            </label>
            <label className="field">
              <span>Benutzer</span>
              <select
                value={ownerFilter}
                onChange={(event) => {
                  setOwnerFilter(event.target.value as OwnerFilter);
                  setPage(1);
                }}
              >
                <option value="all">Fabian und Pascal</option>
                <option value="fabian">Fabian</option>
                <option value="pascal">Pascal</option>
              </select>
            </label>
            <label className="field">
              <span>Zeilen</span>
              <select
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPage(1);
                }}
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </label>
          </div>

          <div className="job-table-scroll">
            <table className="job-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Adresse</th>
                  <th>Haustyp und Objekt-ID</th>
                  <th>Schritt</th>
                  <th>Protokoll</th>
                  <th>Letzte Aktivität</th>
                  <th>Aktion</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={`${row.projectId}:${row.externalId}`} className={`job-row ${row.status}`}>
                    <td><span className={`job-status ${row.status}`}>{STATUS_LABELS[row.status]}</span></td>
                    <td>
                      <b>{row.projectName}</b>
                      <span>
                        {[row.street, row.houseNumber].filter(Boolean).join(" ") || "Straße fehlt"}
                        {" · "}
                        {[row.zip, row.city].filter(Boolean).join(" ") || "Ort fehlt"}
                      </span>
                      <span>{row.owner === "pascal" ? "Pascal" : "Fabian"}</span>
                    </td>
                    <td>
                      <b>{row.houseName}</b>
                      <code>{row.externalId}</code>
                    </td>
                    <td>
                      <span>{row.lastStage === "generation"
                        ? "KI-Texte"
                        : row.lastStage === "validation"
                          ? "Vorbereitung"
                          : row.lastStage === "upload" ? "Übertragung" : "Noch nicht begonnen"}
                      </span>
                      {row.lastError ? (
                        <details>
                          <summary>Fehler anzeigen</summary>
                          <small>{row.lastError}</small>
                        </details>
                      ) : null}
                    </td>
                    <td>{row.attempts.length} Schritt{row.attempts.length === 1 ? "" : "e"}</td>
                    <td>{dateTime(row.uploadedAt || row.lastAttemptAt)}</td>
                    <td>
                      <button
                        type="button"
                        className="table-action"
                        onClick={() => onOpenProject(row.projectId)}
                      >
                        Adresse öffnen
                      </button>
                      {row.status === "unknown" ? (
                        <button
                          type="button"
                          className="table-action danger"
                          disabled={busy}
                          onClick={() => onMarkUnknownFailed(row.projectId, row.externalId)}
                        >
                          Nach Prüfung erneut zulassen
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visibleRows.length ? (
              <div className="job-table-empty">Für diesen Filter wurden keine Inserate gefunden.</div>
            ) : null}
          </div>

          <div className="job-pagination">
            <span>{filteredRows.length} Inserate · Seite {safePage} von {totalPages}</span>
            <div>
              <button type="button" className="secondary" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>Zurück</button>
              <button type="button" className="secondary" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>Weiter</button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="content-card job-history">
        <header>
          <div>
            <span className="eyebrow">Laufhistorie</span>
            <h3>{history.length} gespeicherte Läufe</h3>
            <p>Die letzten 30 Läufe bleiben ohne Bilddateien und Zugangsdaten als leichtes Protokoll erhalten.</p>
          </div>
        </header>
        {history.length ? (
          <div className="job-history-list">
            {history.map((entry) => {
              const uploaded = entry.listings.filter((listing) => listing.status === "uploaded").length;
              const failed = entry.listings.filter((listing) => listing.status === "failed").length;
              const unknown = entry.listings.filter((listing) => listing.status === "unknown").length;
              return (
                <details key={entry.id} className={`job-history-entry ${entry.status}`}>
                  <summary>
                    <span>
                      <b>{runKindLabel(entry.kind)} · {dateTime(entry.createdAt)}</b>
                      <small>{entry.listings.length} Inserate · {entry.attempts.length} Durchlauf{entry.attempts.length === 1 ? "" : "e"}</small>
                    </span>
                    <span>
                      <strong>{uploaded} erfolgreich</strong>
                      {failed ? <em>{failed} Fehler</em> : null}
                      {unknown ? <em>{unknown} ungeklärt</em> : null}
                      <i>{runStatusLabel(entry.status)}</i>
                    </span>
                  </summary>
                  <div className="job-history-details">
                    <span>Portalmodus: <b>{entry.portalPublicationEnabled ? "automatisch online" : "nur Import"}</b></span>
                    <span>Abschluss: <b>{dateTime(entry.completedAt || entry.updatedAt)}</b></span>
                    {entry.listings.some((listing) => listing.lastError) ? (
                      <div>
                        <b>Fehler dieses Laufs</b>
                        {entry.listings
                          .filter((listing) => listing.lastError)
                          .slice(0, 20)
                          .map((listing) => (
                            <small key={`${entry.id}:${listing.id}`}>
                              {listing.projectName} · {listing.externalId}: {listing.lastError}
                            </small>
                          ))}
                        {entry.listings.filter((listing) => listing.lastError).length > 20 ? (
                          <small>
                            Weitere {entry.listings.filter((listing) => listing.lastError).length - 20} Fehler
                            {entry.id === run?.id
                              ? " sind im aktuellen Lauf über Suche und Filter auffindbar."
                              : " werden im kompakten Verlauf aus Leistungsgründen nicht einzeln aufgeklappt."}
                          </small>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </details>
              );
            })}
          </div>
        ) : (
          <div className="job-history-empty">Noch keine abgeschlossenen oder archivierten Läufe gespeichert.</div>
        )}
      </div>
    </section>
  );
}
