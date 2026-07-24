"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  addressCatalogCities,
  addressProjectIsComplete,
  filterAddressProjects,
  missingAddressFields,
  paginateAddressProjects,
  projectLastUploadAt,
  type AddressCatalogFilters,
  type AddressCatalogSort,
  type AddressCompletenessFilter,
  type AddressOwnerFilter,
  type AddressUploadFilter,
} from "../lib/address-catalog";
import type { ProjectInput } from "../types";

const DEFAULT_PAGE_SIZE = 25;

type AddressBookTableProps = {
  projects: ProjectInput[];
  activeProjectId: string;
  onOpenProject: (projectId: string) => void;
};

function ownerLabel(project: ProjectInput): string {
  return project.owner === "pascal" ? "Pascal" : "Fabian";
}

function addressLine(project: ProjectInput): string {
  const street = [project.street, project.houseNumber].filter(Boolean).join(" ");
  return street || "Adresse noch unvollständig";
}

function projectDetails(project: ProjectInput): string {
  return project.name;
}

function formatUploadDate(value: string | undefined): string {
  if (!value) return "Noch nie";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Noch nie";
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function AddressBookTable({
  projects,
  activeProjectId,
  onOpenProject,
}: AddressBookTableProps) {
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("");
  const [zip, setZip] = useState("");
  const [owner, setOwner] = useState<AddressOwnerFilter>("all");
  const [completeness, setCompleteness] = useState<AddressCompletenessFilter>("all");
  const [upload, setUpload] = useState<AddressUploadFilter>("all");
  const [sort, setSort] = useState<AddressCatalogSort>("city");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const cities = useMemo(() => addressCatalogCities(projects), [projects]);
  const filteredProjects = useMemo(
    () => filterAddressProjects(
      projects,
      {
        query,
        city,
        zip,
        owner,
        completeness,
        upload,
        sort,
      } satisfies AddressCatalogFilters,
      now,
    ),
    [city, completeness, now, owner, projects, query, sort, upload, zip],
  );
  const paginated = paginateAddressProjects(filteredProjects, page, pageSize);
  const filtersActive = Boolean(
    query
    || city
    || zip
    || owner !== "all"
    || completeness !== "all"
    || upload !== "all"
    || sort !== "city",
  );

  const resetPage = <T,>(setter: (value: T) => void, value: T) => {
    setter(value);
    setPage(1);
  };

  const clearFilters = () => {
    setQuery("");
    setCity("");
    setZip("");
    setOwner("all");
    setCompleteness("all");
    setUpload("all");
    setSort("city");
    setPage(1);
  };

  return (
    <section className="address-catalog" aria-labelledby="address-catalog-title">
      <div className="address-catalog-head">
        <div>
          <span className="eyebrow">Suchbare Adresstabelle</span>
          <h2 id="address-catalog-title">Gespeicherte Grundstücksadressen</h2>
          <p>Ort, PLZ, Benutzer, Vollständigkeit und Uploadstand lassen sich kombinieren.</p>
        </div>
        <div className="address-catalog-count" aria-live="polite">
          <b>{filteredProjects.length}</b>
          <span>von {projects.length} Adressen</span>
        </div>
      </div>

      <div className="address-catalog-filters">
        <label className="address-search">
          <span>Suche</span>
          <input
            type="search"
            value={query}
            placeholder="Projekt, Straße, Ort oder Datum"
            onChange={(event) => resetPage(setQuery, event.target.value)}
          />
        </label>
        <label>
          <span>Ort</span>
          <select value={city} onChange={(event) => resetPage(setCity, event.target.value)}>
            <option value="">Alle Orte</option>
            {cities.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
          </select>
        </label>
        <label>
          <span>PLZ</span>
          <input
            inputMode="numeric"
            value={zip}
            placeholder="z. B. 145"
            onChange={(event) => resetPage(setZip, event.target.value)}
          />
        </label>
        <label>
          <span>Benutzer</span>
          <select
            value={owner}
            onChange={(event) => resetPage(setOwner, event.target.value as AddressOwnerFilter)}
          >
            <option value="all">Fabian &amp; Pascal</option>
            <option value="fabian">Nur Fabian</option>
            <option value="pascal">Nur Pascal</option>
          </select>
        </label>
        <label>
          <span>Vollständigkeit</span>
          <select
            value={completeness}
            onChange={(event) => resetPage(
              setCompleteness,
              event.target.value as AddressCompletenessFilter,
            )}
          >
            <option value="all">Alle Adressen</option>
            <option value="complete">Nur vollständig</option>
            <option value="incomplete">Nur unvollständig</option>
          </select>
        </label>
        <label>
          <span>Letzter Upload</span>
          <select
            value={upload}
            onChange={(event) => resetPage(setUpload, event.target.value as AddressUploadFilter)}
          >
            <option value="all">Alle Uploadstände</option>
            <option value="recent">Innerhalb 7 Tagen</option>
            <option value="older">Älter als 7 Tage</option>
            <option value="never">Noch nie hochgeladen</option>
          </select>
        </label>
        <label>
          <span>Sortierung</span>
          <select
            value={sort}
            onChange={(event) => resetPage(setSort, event.target.value as AddressCatalogSort)}
          >
            <option value="city">Ort und Straße</option>
            <option value="zip">PLZ aufsteigend</option>
            <option value="upload-newest">Neuester Upload zuerst</option>
            <option value="upload-oldest">Ältester Upload zuerst</option>
          </select>
        </label>
        <button
          type="button"
          className="secondary address-filter-reset"
          disabled={!filtersActive}
          onClick={clearFilters}
        >
          Filter zurücksetzen
        </button>
      </div>

      {paginated.items.length ? (
        <div className="address-table-scroll">
          <table className="address-table">
            <thead>
              <tr>
                <th>Benutzer</th>
                <th>Adresse</th>
                <th>PLZ</th>
                <th>Ort</th>
                <th>Fläche</th>
                <th>Vollständigkeit</th>
                <th>Letzter Upload</th>
                <th><span className="sr-only">Aktion</span></th>
              </tr>
            </thead>
            <tbody>
              {paginated.items.map((project) => {
                const complete = addressProjectIsComplete(project);
                const missing = missingAddressFields(project);
                const active = project.id === activeProjectId;
                const lastUploadAt = projectLastUploadAt(project);
                return (
                  <tr className={active ? "active" : ""} key={project.id}>
                    <td>
                      <span className={`address-owner-badge ${project.owner === "pascal" ? "pascal" : "fabian"}`}>
                        {ownerLabel(project)}
                      </span>
                    </td>
                    <td>
                      <strong>{addressLine(project)}</strong>
                      <small>{projectDetails(project)}</small>
                    </td>
                    <td>{project.zip || "–"}</td>
                    <td>
                      <strong>{project.city || "–"}</strong>
                      {project.district ? <small>{project.district}</small> : null}
                    </td>
                    <td>{project.plotArea > 0 ? `${project.plotArea.toLocaleString("de-DE")} m²` : "–"}</td>
                    <td>
                      <span
                        className={`address-completeness ${complete ? "complete" : "incomplete"}`}
                        title={complete ? "Für den Upload vollständig" : `Fehlt: ${missing.join(", ")}`}
                      >
                        {complete ? "Vollständig" : "Unvollständig"}
                      </span>
                      {!complete ? <small>Fehlt: {missing.join(", ")}</small> : null}
                    </td>
                    <td>
                      <time dateTime={lastUploadAt}>
                        {formatUploadDate(lastUploadAt)}
                      </time>
                    </td>
                    <td>
                      <button
                        type="button"
                        className={active ? "primary address-open-button active" : "secondary address-open-button"}
                        onClick={() => onOpenProject(project.id)}
                      >
                        {active ? "Geöffnet" : "Öffnen"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="address-catalog-empty">
          <b>Keine passende Adresse gefunden</b>
          <span>Ändere einen Filter oder setze die Suche zurück.</span>
        </div>
      )}

      <div className="address-catalog-footer">
        <span>
          {paginated.total
            ? `${(paginated.page - 1) * pageSize + 1}–${Math.min(paginated.page * pageSize, paginated.total)} von ${paginated.total}`
            : "0 Treffer"}
        </span>
        <label className="address-page-size">
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
        <div className="button-row" aria-label="Seiten der Adresstabelle">
          <button
            type="button"
            className="secondary"
            disabled={paginated.page <= 1}
            onClick={() => setPage(paginated.page - 1)}
          >
            Zurück
          </button>
          <b>Seite {paginated.page} von {paginated.pageCount}</b>
          <button
            type="button"
            className="secondary"
            disabled={paginated.page >= paginated.pageCount}
            onClick={() => setPage(paginated.page + 1)}
          >
            Weiter
          </button>
        </div>
      </div>
    </section>
  );
}
