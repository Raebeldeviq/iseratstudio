import { normalizePlotRecord, normalizePlotState } from "./plot-records.mjs";

const HEADERS = ["plotId", "Straße", "Hausnummer", "PLZ", "Ort", "Grundstücksfläche m²", "Grundstückspreis €", "PoolBModus", "PoolBStatus"];
const cell = (value) => String(value ?? "").trim();
const normalizeHeader = (value) => cell(value).toLocaleLowerCase("de-DE").normalize("NFD")
  .replace(/[\u0300-\u036f]/gu, "").replace(/ß/gu, "ss").replace(/[^a-z0-9]/gu, "");
const number = (value) => {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : NaN;
  const raw = cell(value).replace(/[^0-9,.-]/gu, "");
  if (!raw) return 0;
  const germanThousands = /^\d{1,3}(?:\.\d{3})+$/u.test(raw);
  const parsed = Number(raw.includes(",") ? raw.replace(/\./gu, "").replace(",", ".")
    : germanThousands ? raw.replace(/\./gu, "") : raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : NaN;
};

export function parseMasterRows(rows, pool) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const headers = rows[0].map(normalizeHeader);
  const index = (...names) => names.map(normalizeHeader).map((name) => headers.indexOf(name)).find((item) => item >= 0);
  const columns = {
    plotId: index("plotId", "Grundstücks-ID"), street: index("Straße", "Strasse"),
    houseNumber: index("Hausnummer", "Hausnr"), postalCode: index("PLZ", "Postleitzahl"),
    city: index("Ort", "Stadt"), size: index("Grundstücksfläche m²", "Größe (m²)"),
    price: index("Grundstückspreis €", "Preis (€)"), mode: index("PoolBModus"), status: index("PoolBStatus"),
  };
  for (const field of ["plotId", "street", "houseNumber", "postalCode", "city", "size", "price"]) {
    if (columns[field] === undefined) throw new Error(`Pool_${pool}: Pflichtspalte ${field} fehlt.`);
  }
  const seen = new Set();
  return rows.slice(1).flatMap((cells, offset) => {
    if (!cells.some((value) => cell(value))) return [];
    const get = (field) => cell(cells[columns[field]]);
    const plotId = get("plotId");
    const postalCode = get("postalCode").padStart(5, "0");
    const size = number(cells[columns.size]);
    const price = number(cells[columns.price]);
    if (!plotId || !get("street") || !/^\d{5}$/u.test(postalCode) || !get("city")
      || !Number.isFinite(size) || !Number.isFinite(price)) {
      throw new Error(`Pool_${pool}, Zeile ${offset + 2}: ID, Adresse, Fläche oder Preis ungültig.`);
    }
    if (seen.has(plotId)) throw new Error(`Pool_${pool}: doppelte plotId ${plotId}.`);
    seen.add(plotId);
    return [{ plotId, street: get("street"), houseNumber: get("houseNumber"), postalCode,
      city: get("city"), plotSizeSqm: size, purchasePrice: price,
      mode: pool === "B" && get("mode") === "MANUAL" ? "MANUAL" : "AUTO_GENERATED",
      status: pool === "B" && (get("status") === "POOL_B_PRÜFEN" || !get("houseNumber")) ? "POOL_B_PRÜFEN" : "" }];
  });
}

export function rowFromPlot(plot) {
  return { plotId: plot.id, street: cell(plot.street), houseNumber: cell(plot.houseNumber),
    postalCode: cell(plot.postalCode), city: cell(plot.city),
    plotSizeSqm: number(plot.plotSizeSqm), purchasePrice: number(plot.purchasePrice), mode: "AUTO_GENERATED", status: "" };
}

export function generatePoolB(a) {
  const numeric = /^\d+$/u.test(cell(a.houseNumber));
  return { ...a, houseNumber: numeric ? String(BigInt(a.houseNumber) + 2n) : "",
    plotSizeSqm: a.plotSizeSqm + 2, purchasePrice: a.purchasePrice + 1350,
    mode: "AUTO_GENERATED", status: numeric ? "" : "POOL_B_PRÜFEN" };
}

export function rowFromPlotB(plot, a = rowFromPlot(plot)) {
  const details = plot.addressRotation?.poolBDetails;
  const address = plot.addressRotation?.poolB;
  const generated = generatePoolB(a);
  if (!address) return generated;
  const legacySource = plot.addressRotation?.poolA;
  const legacyGenerated = legacySource ? generatePoolB({ ...a, ...legacySource }) : generated;
  const manualLegacy = !details && ["street", "houseNumber", "postalCode", "city"]
    .some((field) => cell(address[field]) !== cell(legacyGenerated[field]));
  return { plotId: plot.id, street: cell(address.street), houseNumber: cell(address.houseNumber),
    postalCode: cell(address.postalCode), city: cell(address.city),
    plotSizeSqm: details ? number(details.plotSizeSqm) : generated.plotSizeSqm,
    purchasePrice: details ? number(details.purchasePrice) : generated.purchasePrice,
    mode: details?.mode || (manualLegacy ? "MANUAL" : "AUTO_GENERATED"),
    status: details?.status || (!address.houseNumber ? "POOL_B_PRÜFEN" : "") };
}

const fingerprint = (row) => row ? JSON.stringify([row.plotId, row.street, row.houseNumber, row.postalCode,
  row.city, row.plotSizeSqm, row.purchasePrice, row.mode, row.status]) : "";

export function applyMasterRowsToPlot(plot, a, b, syncedAt) {
  const existing = plot || normalizePlotRecord({ id: a.plotId, createdAt: syncedAt, updatedAt: syncedAt }, { now: syncedAt });
  const next = normalizePlotRecord({ ...existing, street: a.street, houseNumber: a.houseNumber,
    postalCode: a.postalCode, city: a.city, plotSizeSqm: a.plotSizeSqm, purchasePrice: a.purchasePrice,
    isActive: true, updatedAt: syncedAt,
    addressRotation: { ...(existing.addressRotation || {}), poolA: {
      street: a.street, houseNumber: a.houseNumber, postalCode: a.postalCode, city: a.city,
    }, poolB: { street: b.street, houseNumber: b.houseNumber, postalCode: b.postalCode, city: b.city },
    poolBDetails: { plotSizeSqm: b.plotSizeSqm, purchasePrice: b.purchasePrice, mode: b.mode, status: b.status },
    currentPool: existing.addressRotation?.currentPool || "", cycle: existing.addressRotation?.cycle || 0,
    listingIds: existing.addressRotation?.listingIds || [], lastUsedA: existing.addressRotation?.lastUsedA || "",
    lastUsedB: existing.addressRotation?.lastUsedB || "" },
    masterSync: { a: fingerprint(a), b: fingerprint(b), syncedAt },
  }, { now: syncedAt, fallbackId: a.plotId });
  return next;
}

function classify(a, b, baseline) {
  if (a === b) return "equal";
  if (!baseline) return "conflict";
  if (a === baseline) return "excel";
  if (b === baseline) return "app";
  return "conflict";
}

export function reconcileMaster(state, excelA, excelB, choices = {}, now = new Date().toISOString()) {
  const aMap = new Map(excelA.map((row) => [row.plotId, row]));
  const bMap = new Map(excelB.map((row) => [row.plotId, row]));
  for (const id of bMap.keys()) if (!aMap.has(id)) throw new Error(`Pool_B enthält ${id} ohne Pool_A. Bitte die Excel-Datei korrigieren.`);
  const plots = new Map((state.plots || []).map((plot) => [plot.id, plot]));
  const ids = [...new Set([...plots.keys(), ...aMap.keys()])].sort();
  const items = [];
  const nextPlots = new Map(plots);
  const nextA = new Map(aMap);
  const nextB = new Map(bMap);
  for (const id of ids) {
    const plot = plots.get(id);
    const aExcel = aMap.get(id);
    const bExcel = bMap.get(id);
    if (plot?.isActive === false) {
      if (plot.masterSync?.excelDeleteRequested && aExcel) {
        items.push({ plotId: id, action: "delete-excel", label: `${aExcel.street} ${aExcel.houseNumber}` });
        nextA.delete(id); nextB.delete(id);
        nextPlots.set(id, { ...plot, masterSync: { ...plot.masterSync, excelDeleteRequested: false, a: "", b: "", syncedAt: now } });
      }
      continue;
    }
    if (!plot && aExcel) {
      const b = bExcel || generatePoolB(aExcel);
      items.push({ plotId: id, action: "import", label: `${aExcel.street} ${aExcel.houseNumber}` });
      nextB.set(id, b);
      nextPlots.set(id, applyMasterRowsToPlot(null, aExcel, b, now));
      continue;
    }
    if (!plot) continue;
    if (!aExcel) {
      if (plot.masterSync?.a) {
        items.push({ plotId: id, action: "missing-excel", label: `${plot.street} ${plot.houseNumber}` });
        if (choices[id] === "remove-app") nextPlots.set(id, { ...plot, isActive: false,
          masterSync: { ...plot.masterSync, appOnlyRemoved: true, excelDeleteRequested: false } });
      } else {
        const a = rowFromPlot(plot); const b = rowFromPlotB(plot, a);
        items.push({ plotId: id, action: "export", label: `${plot.street} ${plot.houseNumber}` });
        nextA.set(id, a); nextB.set(id, b);
        nextPlots.set(id, applyMasterRowsToPlot(plot, a, b, now));
      }
      continue;
    }
    const aApp = rowFromPlot(plot);
    const aDirection = classify(fingerprint(aApp), fingerprint(aExcel), plot.masterSync?.a);
    const bApp = rowFromPlotB(plot, aApp);
    const bDirection = bExcel ? classify(fingerprint(bApp), fingerprint(bExcel), plot.masterSync?.b) : "app";
    const crossChanged = (aDirection === "app" && bDirection === "excel")
      || (aDirection === "excel" && bDirection === "app");
    const hasConflict = aDirection === "conflict" || bDirection === "conflict" || crossChanged;
    if (hasConflict) {
      items.push({ plotId: id, action: "conflict", label: `${plot.street} ${plot.houseNumber}` });
      if (!choices[id] || choices[id] === "keep") continue;
    } else if (aDirection !== "equal" || bDirection !== "equal" || !bExcel) {
      items.push({ plotId: id, action: "update", direction: aDirection === "equal" ? bDirection : aDirection,
        label: `${plot.street} ${plot.houseNumber}` });
    }
    const direction = hasConflict ? choices[id] : aDirection;
    const a = direction === "excel" ? aExcel : aApp;
    let b;
    if (!bExcel) b = generatePoolB(a);
    else if (hasConflict && choices[id] === "excel") {
      const changedExcelB = bDirection === "excel" || bDirection === "conflict";
      b = bExcel.mode === "MANUAL" ? bExcel
        : changedExcelB && fingerprint(bExcel) !== fingerprint(generatePoolB(aExcel))
          ? { ...bExcel, mode: "MANUAL" } : generatePoolB(a);
    } else if (!hasConflict && bDirection === "excel") b = fingerprint(bExcel) === fingerprint(generatePoolB(aExcel))
      ? generatePoolB(a) : { ...bExcel, mode: "MANUAL" };
    else if (bApp.mode === "MANUAL") b = bApp;
    else b = generatePoolB(a);
    if (!bExcel || fingerprint(b) !== fingerprint(bExcel)) nextB.set(id, b);
    if (fingerprint(a) !== fingerprint(aExcel)) nextA.set(id, a);
    if (aDirection !== "equal" || !bExcel || fingerprint(b) !== fingerprint(bExcel)
      || fingerprint(b) !== fingerprint(bApp)) nextPlots.set(id, applyMasterRowsToPlot(plot, a, b, now));
    else if (!plot.masterSync?.a || !plot.masterSync?.b) nextPlots.set(id, applyMasterRowsToPlot(plot, a, b, now));
  }
  const nextState = normalizePlotState({ ...state, plots: [...nextPlots.values()] }, { now });
  return { items, state: nextState, poolA: [...nextA.values()], poolB: [...nextB.values()] };
}

export function masterRowsForWorkbook(rows, originalRows = []) {
  const header = originalRows.length ? [...originalRows[0]] : [...HEADERS];
  const names = header.map(normalizeHeader);
  const aliases = [["plotid", "grundstucksid"], ["strasse"], ["hausnummer", "hausnr"], ["plz", "postleitzahl"],
    ["ort", "stadt"], ["grundstucksflachem2", "grossem2"], ["grundstuckspreis", "preis"], ["poolbmodus"], ["poolbstatus"]];
  const indexes = HEADERS.map((name, field) => {
    let index = names.findIndex((value) => aliases[field].includes(value));
    if (index < 0) { index = header.length; header.push(name); names.push(normalizeHeader(name)); }
    return index;
  });
  const originalIdColumn = indexes[0];
  const byId = new Map(originalRows.slice(1).map((row) => [cell(row[originalIdColumn]), row]));
  return [header, ...rows.map((row) => {
    const values = [...(byId.get(row.plotId) || [])];
    [row.plotId, row.street, row.houseNumber, row.postalCode, row.city, row.plotSizeSqm,
      row.purchasePrice, row.mode, row.status].forEach((value, field) => { values[indexes[field]] = value; });
    return values;
  })];
}
