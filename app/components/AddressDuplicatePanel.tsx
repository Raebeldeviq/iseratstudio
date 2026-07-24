"use client";

import { useMemo, useState } from "react";
import {
  projectLastUploadAt,
} from "../lib/address-catalog";
import type { AddressDuplicateGroup } from "../lib/address-duplicates";
import type { ProjectInput } from "../types";

type AddressDuplicatePanelProps = {
  projects: ProjectInput[];
  groups: AddressDuplicateGroup[];
  mutationLocked: boolean;
  onOpenProject: (projectId: string) => void;
  onDeleteDuplicates: (keepIdsByGroup: Record<string, string>) => void;
};

function ownerLabel(project: ProjectInput): string {
  return project.owner === "pascal" ? "Pascal" : "Fabian";
}

function addressLabel(project: ProjectInput): string {
  return [
    [project.street, project.houseNumber].filter(Boolean).join(" "),
    [project.zip, project.city].filter(Boolean).join(" "),
  ].filter(Boolean).join(", ");
}

function formatDate(value: string | undefined): string {
  if (!value) return "noch nie hochgeladen";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "noch nie hochgeladen";
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function hasDifferentPropertyData(projects: ProjectInput[]): boolean {
  const values = projects.map((project) => [
    Number(project.plotArea) || 0,
    Number(project.plotPrice) || 0,
    Number(project.additionalCosts) || 0,
    project.district.trim().toLocaleLowerCase("de-DE"),
  ].join("|"));
  return new Set(values).size > 1;
}

export function AddressDuplicatePanel({
  projects,
  groups,
  mutationLocked,
  onOpenProject,
  onDeleteDuplicates,
}: AddressDuplicatePanelProps) {
  const [scanned, setScanned] = useState(false);
  const [keepIds, setKeepIds] = useState<Record<string, string>>({});
  const projectsById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );
  const duplicateCount = groups.reduce(
    (sum, group) => sum + Math.max(0, group.projectIds.length - 1),
    0,
  );

  const scan = () => {
    setKeepIds(Object.fromEntries(
      groups.map((group) => [group.id, group.recommendedKeepId]),
    ));
    setScanned(true);
  };

  const deleteDuplicates = () => {
    const resolvedKeepIds = Object.fromEntries(
      groups.map((group) => [
        group.id,
        group.projectIds.includes(keepIds[group.id])
          ? keepIds[group.id]
          : group.recommendedKeepId,
      ]),
    );
    const confirmed = window.confirm(
      `${duplicateCount} doppelte Grundstücksadresse${duplicateCount === 1 ? "" : "n"} `
      + `aus ${groups.length} Gruppe${groups.length === 1 ? "" : "n"} lokal löschen?\n\n`
      + "Pro Gruppe bleibt das ausgewählte Original vollständig erhalten. "
      + "Gelöscht werden die übrigen lokalen Adressprojekte samt deren Inseratentwürfen. "
      + "Bereits in Immoprofessional vorhandene Objekte werden dadurch nicht gelöscht.",
    );
    if (!confirmed) return;
    onDeleteDuplicates(resolvedKeepIds);
  };

  return (
    <section className="address-duplicate-check" aria-labelledby="address-duplicate-title">
      <div className="address-duplicate-tools">
        <div>
          <span className="eyebrow">Bestandsbereinigung</span>
          <b id="address-duplicate-title">Doppelte Grundstücksadressen finden</b>
          <small>
            Geprüft werden Straße, Hausnummer, PLZ und Ort – auch gemeinsam über
            Fabian und Pascal.
          </small>
        </div>
        <button
          type="button"
          className="secondary"
          onClick={scan}
          data-testid="scan-address-duplicates"
        >
          Adressdubletten prüfen
        </button>
      </div>

      {scanned && !groups.length ? (
        <div className="address-duplicate-empty" role="status">
          <b>Keine Adressdubletten gefunden</b>
          <span>Jede vollständige Grundstücksadresse ist nur einmal gespeichert.</span>
        </div>
      ) : null}

      {scanned && groups.length ? (
        <section
          className="address-duplicate-panel"
          aria-label="Gefundene Adressdubletten"
          data-testid="address-duplicate-results"
        >
          <header>
            <div>
              <span>Adressdubletten</span>
              <strong>
                {duplicateCount} überzählige Adresse{duplicateCount === 1 ? "" : "n"} in{" "}
                {groups.length} Gruppe{groups.length === 1 ? "" : "n"}
              </strong>
              <small>
                Wähle pro Gruppe das Projekt, das vollständig erhalten bleiben soll.
              </small>
            </div>
            <button
              type="button"
              className="address-duplicate-delete-button"
              disabled={mutationLocked || !duplicateCount}
              onClick={deleteDuplicates}
            >
              {duplicateCount} Dublette{duplicateCount === 1 ? "" : "n"} löschen
            </button>
          </header>

          {mutationLocked ? (
            <div className="address-duplicate-locked" role="status">
              Ein Upload- oder Speicherlauf ist aktiv. Prüfen ist möglich; Löschen wird
              danach wieder freigegeben.
            </div>
          ) : null}

          <div className="address-duplicate-groups">
            {groups.map((group, groupIndex) => {
              const groupProjects = group.projectIds
                .map((projectId) => projectsById.get(projectId))
                .filter((project): project is ProjectInput => Boolean(project));
              if (groupProjects.length < 2) return null;
              const keepId = group.projectIds.includes(keepIds[group.id])
                ? keepIds[group.id]
                : group.recommendedKeepId;
              return (
                <fieldset className="address-duplicate-group" key={group.id}>
                  <legend>
                    {groupIndex + 1}. {addressLabel(groupProjects[0])}
                  </legend>
                  {hasDifferentPropertyData(groupProjects) ? (
                    <div className="address-duplicate-warning">
                      Unterschiedliche Grundstücksdaten – bitte das Original bewusst prüfen.
                    </div>
                  ) : null}
                  <div className="address-duplicate-choices">
                    {groupProjects.map((project) => {
                      const kept = project.id === keepId;
                      return (
                        <div
                          className={`address-duplicate-choice${kept ? " kept" : " removing"}`}
                          key={project.id}
                        >
                          <label>
                            <input
                              type="radio"
                              name={`address-duplicate-keeper-${group.id}`}
                              checked={kept}
                              onChange={() => setKeepIds((current) => ({
                                ...current,
                                [group.id]: project.id,
                              }))}
                            />
                            <span>
                              <b>
                                <span className={`address-owner-badge ${project.owner}`}>
                                  {ownerLabel(project)}
                                </span>
                                {project.name}
                              </b>
                              <small>
                                {Number(project.plotArea).toLocaleString("de-DE")} m² ·{" "}
                                {formatCurrency(project.plotPrice)} ·{" "}
                                {project.listings.length} Inserate · letzter Upload{" "}
                                {formatDate(projectLastUploadAt(project))}
                              </small>
                            </span>
                            <em>{kept ? "Original behalten" : "Wird gelöscht"}</em>
                          </label>
                          <button
                            type="button"
                            className="secondary address-duplicate-open"
                            onClick={() => onOpenProject(project.id)}
                          >
                            Öffnen
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </fieldset>
              );
            })}
          </div>
        </section>
      ) : null}
    </section>
  );
}
