import { applyPlotToProject, normalizePlotRecord, normalizePlotState, plotAddressKey } from "./plot-records.mjs";

export const PLOT_SYNC_STATUSES = Object.freeze({
  NEW: "Neu",
  EXISTING: "Vorhanden",
  INACTIVE: "Nicht mehr vorhanden",
});

const HEADER_ALIASES = Object.freeze({
  postalCode: ["postleitzahl", "plz"],
  city: ["ort", "stadt"],
  streetLine: ["strasse", "straße", "adresse"],
  plotSizeSqm: ["grossem2", "großem2", "grundstucksgrosse", "grundstücksgröße", "grundstucksflache", "grundstücksfläche"],
  purchasePrice: ["preise", "preis", "kaufpreise", "kaufpreis"],
  sourceName: ["quelle"],
  listingUrl: ["inseratslink", "link", "url"],
  sourceFirstSeenAt: ["erstmalsgefunden"],
  sourceLastCheckedAt: ["zuletztgepruft", "zuletztgeprüft"],
  sourceStatus: ["status"],
  sourceExposeFilename: ["exposedateiname", "exposédateiname"],
  sourceInternalId: ["interneid", "interne-id", "id"],
});

function text(value) {
  return String(value ?? "").trim();
}

function headerKey(value) {
  return text(value)
    .toLocaleLowerCase("de-DE")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/€/gu, "e")
    .replace(/²/gu, "2")
    .replace(/[^a-z0-9-]+/gu, "");
}

function normalizedText(value) {
  return text(value)
    .toLocaleLowerCase("de-DE")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/ß/gu, "ss")
    .replace(/\bstr(?:asse)?\b/gu, "strasse")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

export function normalizeListingUrl(value) {
  const raw = text(value);
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//iu.test(raw) ? raw : `https://${raw}`);
    const path = url.pathname.replace(/\/+$/u, "") || "/";
    return `${url.protocol.toLocaleLowerCase("de-DE")}//${url.host.toLocaleLowerCase("de-DE")}${path}`;
  } catch {
    return raw.split(/[?#]/u)[0].replace(/\/+$/u, "").toLocaleLowerCase("de-DE");
  }
}

export function normalizeSourceInternalId(value) {
  return normalizedText(value).replace(/\s+/gu, "");
}

export function splitStreetLine(value) {
  const cleaned = text(value).replace(/\s+/gu, " ");
  const match = cleaned.match(/^(.+?)\s+(\d+[a-zA-Z]?(?:\s*[-/]\s*\d+[a-zA-Z]?)?)$/u);
  return match ? { street: match[1].trim(), houseNumber: match[2].replace(/\s+/gu, "") } : { street: cleaned, houseNumber: "" };
}

function numeric(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  const raw = text(value);
  if (!raw) return 0;
  const cleaned = raw
    .replace(/[€m²\s]/giu, "")
    .replace(/\.(?=\d{3}(?:\D|$))/gu, "")
    .replace(",", ".")
    .replace(/[^0-9.-]/gu, "");
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : NaN;
}

function dateValue(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  return text(value);
}

function statusValue(value) {
  const normalized = normalizedText(value);
  if (normalized === "neu") return PLOT_SYNC_STATUSES.NEW;
  if (normalized === "vorhanden") return PLOT_SYNC_STATUSES.EXISTING;
  if (normalized === "nicht mehr vorhanden") return PLOT_SYNC_STATUSES.INACTIVE;
  return "";
}

function indexHeaders(headerRow) {
  const source = new Map((Array.isArray(headerRow) ? headerRow : []).map((value, index) => [headerKey(value), index]));
  const indexes = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const index = aliases.map(headerKey).map((alias) => source.get(alias)).find((value) => value !== undefined);
    indexes[field] = index ?? -1;
  }
  const missing = ["postalCode", "city", "streetLine", "sourceStatus"].filter((field) => indexes[field] < 0);
  if (missing.length) {
    const labels = { postalCode: "Postleitzahl", city: "Ort", streetLine: "Straße", sourceStatus: "Status" };
    throw new Error(`Pflichtspalten fehlen: ${missing.map((field) => labels[field]).join(", ")}.`);
  }
  return indexes;
}

function cell(row, indexes, field) {
  return indexes[field] >= 0 ? row[indexes[field]] : "";
}

export function parsePlotSyncRows(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error("Die Excel-Datei enthält kein Tabellenblatt mit Daten.");
  const indexes = indexHeaders(rows[0]);
  return rows.slice(1).flatMap((row, index) => {
    if (!Array.isArray(row) || row.every((value) => text(value) === "")) return [];
    const street = splitStreetLine(cell(row, indexes, "streetLine"));
    const postalCode = text(cell(row, indexes, "postalCode"));
    return [{
      excelRow: index + 2,
      street: street.street,
      houseNumber: street.houseNumber,
      postalCode: postalCode ? postalCode.padStart(5, "0") : "",
      city: text(cell(row, indexes, "city")),
      plotSizeSqm: numeric(cell(row, indexes, "plotSizeSqm")),
      purchasePrice: numeric(cell(row, indexes, "purchasePrice")),
      sourceName: text(cell(row, indexes, "sourceName")),
      listingUrl: text(cell(row, indexes, "listingUrl")),
      sourceFirstSeenAt: dateValue(cell(row, indexes, "sourceFirstSeenAt")),
      sourceLastCheckedAt: dateValue(cell(row, indexes, "sourceLastCheckedAt")),
      sourceStatusRaw: text(cell(row, indexes, "sourceStatus")),
      sourceStatus: statusValue(cell(row, indexes, "sourceStatus")),
      sourceExposeFilename: text(cell(row, indexes, "sourceExposeFilename")),
      sourceInternalId: text(cell(row, indexes, "sourceInternalId")),
    }];
  });
}

function stableId(value) {
  let hash = 2166136261;
  for (const char of text(value)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `plot-sync-${(hash >>> 0).toString(36)}`;
}

function valuesByKey(values, keyFor) {
  const map = new Map();
  for (const value of values) {
    const key = keyFor(value);
    if (!key) continue;
    const matches = map.get(key) || [];
    matches.push(value);
    map.set(key, matches);
  }
  return map;
}

function sourceAddressKey(row) {
  return plotAddressKey({ ...row, postalCode: row.postalCode });
}

function rowError(row, reason) {
  return { excelRow: row.excelRow, sourceInternalId: row.sourceInternalId, listingUrl: row.listingUrl, reason };
}

function identityForNew(row) {
  return normalizeSourceInternalId(row.sourceInternalId)
    || normalizeListingUrl(row.listingUrl)
    || sourceAddressKey(row)
    || `row-${row.excelRow}`;
}

function updatePlotFromRow(plot, row, now, active) {
  return normalizePlotRecord({
    ...plot,
    street: row.street || plot.street,
    houseNumber: row.street ? row.houseNumber : plot.houseNumber,
    postalCode: row.postalCode || plot.postalCode,
    city: row.city || plot.city,
    plotSizeSqm: row.plotSizeSqm > 0 ? row.plotSizeSqm : plot.plotSizeSqm,
    purchasePrice: row.purchasePrice > 0 ? row.purchasePrice : plot.purchasePrice,
    sourceInternalId: row.sourceInternalId || plot.sourceInternalId,
    listingUrl: row.listingUrl || plot.listingUrl,
    sourceName: row.sourceName || plot.sourceName,
    sourceStatus: row.sourceStatus,
    sourceFirstSeenAt: row.sourceFirstSeenAt || plot.sourceFirstSeenAt,
    sourceLastCheckedAt: row.sourceLastCheckedAt || plot.sourceLastCheckedAt,
    sourceExposeFilename: row.sourceExposeFilename || plot.sourceExposeFilename,
    syncedAt: now,
    updatedAt: now,
    isActive: active,
  }, { now, fallbackId: plot.id });
}

export function applyPlotSyncRows(stateValue, rows, options = {}) {
  const startedAt = String(options.now || new Date().toISOString());
  const normalizedState = normalizePlotState(stateValue, { now: startedAt });
  let plots = [...(normalizedState.plots || [])];
  let projects = [...(normalizedState.projects || [])];
  const stats = { rowsRead: rows.length, created: 0, updated: 0, deactivated: 0, skipped: 0, duplicatesPrevented: 0, failed: 0 };
  const errors = [];
  const warnings = [];
  const sourceIdCounts = valuesByKey(rows, (row) => normalizeSourceInternalId(row.sourceInternalId));
  const sourceUrlCounts = valuesByKey(rows, (row) => normalizeListingUrl(row.listingUrl));

  for (const row of rows) {
    if (!row.sourceStatus) {
      errors.push(rowError(row, `Unbekannter Status „${row.sourceStatusRaw || "leer"}“.`));
      stats.failed += 1;
      continue;
    }
    const sourceId = normalizeSourceInternalId(row.sourceInternalId);
    const sourceUrl = normalizeListingUrl(row.listingUrl);
    if (sourceId && sourceIdCounts.get(sourceId)?.length > 1) {
      errors.push(rowError(row, "Die interne ID kommt in der Quelldatei mehrfach vor."));
      stats.failed += 1;
      stats.duplicatesPrevented += 1;
      continue;
    }
    if (sourceUrl && sourceUrlCounts.get(sourceUrl)?.length > 1) {
      errors.push(rowError(row, "Der normalisierte Inseratslink kommt in der Quelldatei mehrfach vor."));
      stats.failed += 1;
      stats.duplicatesPrevented += 1;
      continue;
    }
    if (Number.isNaN(row.plotSizeSqm) || row.plotSizeSqm < 0) {
      errors.push(rowError(row, "Die Grundstücksgröße ist ungültig."));
      stats.failed += 1;
      continue;
    }
    if (Number.isNaN(row.purchasePrice) || row.purchasePrice < 0) {
      errors.push(rowError(row, "Der Kaufpreis ist ungültig."));
      stats.failed += 1;
      continue;
    }

    const byInternalId = valuesByKey(plots, (plot) => normalizeSourceInternalId(plot.sourceInternalId));
    const byListingUrl = valuesByKey(plots, (plot) => normalizeListingUrl(plot.listingUrl));
    const byAddress = valuesByKey(plots, plotAddressKey);
    let matches = sourceId ? byInternalId.get(sourceId) || [] : [];
    let matchedBy = sourceId && matches.length ? "interner ID" : "";
    if (!matches.length && sourceUrl) {
      matches = byListingUrl.get(sourceUrl) || [];
      if (matches.length) matchedBy = "Inseratslink";
    }
    if (!sourceId && !sourceUrl) {
      const address = sourceAddressKey(row);
      matches = address ? byAddress.get(address) || [] : [];
      if (matches.length) matchedBy = "Adresse";
    }
    if (matches.length > 1) {
      errors.push(rowError(row, `Keine sichere Zusammenführung möglich: ${matches.length} Treffer über ${matchedBy}.`));
      stats.failed += 1;
      stats.duplicatesPrevented += 1;
      continue;
    }
    const match = matches[0] || null;

    if (row.sourceStatus === PLOT_SYNC_STATUSES.INACTIVE) {
      if (!match) {
        stats.skipped += 1;
        continue;
      }
      const activeListings = projects
        .filter((project) => project.plotId === match.id)
        .flatMap((project) => project.listings || [])
        .filter((listing) => !listing.rotationArchivedAt);
      if (activeListings.length) warnings.push({ excelRow: row.excelRow, plotId: match.id, reason: `${activeListings.length} bestehende Inserate wurden nicht gelöscht.` });
      const updated = updatePlotFromRow(match, row, startedAt, false);
      plots = plots.map((plot) => plot.id === match.id ? updated : plot);
      projects = projects.map((project) => project.plotId === match.id ? applyPlotToProject(project, updated) : project);
      stats.deactivated += match.isActive === false ? 0 : 1;
      stats.updated += match.isActive === false ? 1 : 0;
      continue;
    }

    if (row.sourceStatus === PLOT_SYNC_STATUSES.NEW && match) {
      stats.skipped += 1;
      stats.duplicatesPrevented += 1;
      continue;
    }
    if (!match && (!row.street || !row.houseNumber || !/^\d{5}$/u.test(row.postalCode) || !row.city)) {
      errors.push(rowError(row, "Für ein neues Grundstück ist die vollständige Adresse einschließlich Hausnummer erforderlich."));
      stats.failed += 1;
      continue;
    }
    if (!match && (!(row.plotSizeSqm > 0) || !(row.purchasePrice > 0))) {
      errors.push(rowError(row, "Für ein neues Grundstück müssen Größe und Kaufpreis größer als null sein."));
      stats.failed += 1;
      continue;
    }
    if (match) {
      const updated = updatePlotFromRow(match, row, startedAt, true);
      plots = plots.map((plot) => plot.id === match.id ? updated : plot);
      projects = projects.map((project) => project.plotId === match.id ? applyPlotToProject(project, updated) : project);
      stats.updated += 1;
    } else {
      const idBase = stableId(identityForNew(row));
      let id = idBase;
      let suffix = 2;
      while (plots.some((plot) => plot.id === id)) id = `${idBase}-${suffix++}`;
      plots.push(normalizePlotRecord({
        ...row,
        id,
        isActive: true,
        createdAt: startedAt,
        updatedAt: startedAt,
        syncedAt: startedAt,
      }, { now: startedAt, fallbackId: id }));
      stats.created += 1;
    }
  }

  return {
    state: normalizePlotState({ ...normalizedState, plots, projects }, { now: startedAt }),
    stats,
    errors,
    warnings,
    status: errors.length === rows.length && rows.length ? "failed" : errors.length ? "partial" : "success",
    startedAt,
  };
}
