// Display-only territory membership. Never controls publication or deletion.
const text = (value) => String(value ?? "").trim();
const header = (value) => text(value).toLocaleLowerCase("de-DE").replace(/\s+/gu, "");

export function parseTerritoryPostalCodes(rows) {
  if (!Array.isArray(rows) || !Array.isArray(rows[0])) throw new Error("Suchgebiet fehlt.");
  const headers = rows[0].map(header);
  const zipIndex = headers.findIndex((value) => value === "postleitzahl" || value === "plz");
  const activeIndex = headers.indexOf("aktiv");
  if (zipIndex < 0 || activeIndex < 0) throw new Error("Suchgebiet benötigt PLZ und Aktiv.");
  const codes = new Set();
  for (const row of rows.slice(1)) {
    if (!Array.isArray(row) || row.every((value) => !text(value))) continue;
    const active = header(row[activeIndex]);
    if (["", "nein", "no", "false", "0"].includes(active)) continue;
    if (!["ja", "yes", "true", "1"].includes(active)) throw new Error("Unklarer Aktivwert im Suchgebiet.");
    const raw = row[zipIndex];
    const code = typeof raw === "number" && Number.isInteger(raw) && raw >= 0
      ? String(raw).padStart(5, "0") : text(raw);
    if (!/^\d{5}$/u.test(code) || codes.has(code)) throw new Error("Ungültige oder doppelte aktive PLZ.");
    codes.add(code);
  }
  if (!codes.size) throw new Error("Keine aktiven PLZ im Suchgebiet.");
  return [...codes].sort();
}

/** @template T @param {T[]} plots @param {{available?: boolean, postalCodes?: string[]}|null|undefined} territory */
export function partitionPlotsByTerritory(plots, territory) {
  const codes = territory?.postalCodes;
  const available = territory?.available === true && Array.isArray(codes) && codes.length > 0
    && codes.every((code) => typeof code === "string" && /^\d{5}$/u.test(code))
    && new Set(codes).size === codes.length;
  const active = new Set(available ? codes : []);
  const sections = [
    { id: "inside", label: "Im eigenen PLZ-Gebiet", plots: /** @type {T[]} */ ([]) },
    { id: "outside", label: "Außerhalb des eigenen PLZ-Gebiets", plots: /** @type {T[]} */ ([]) },
    { id: "unknown", label: "Gebietszuordnung nicht verfügbar", plots: /** @type {T[]} */ ([]) },
  ];
  for (const plot of plots) {
    const zip = text(plot?.postalCode);
    const index = !available || !/^\d{5}$/u.test(zip) ? 2 : active.has(zip) ? 0 : 1;
    sections[index].plots.push(plot);
  }
  return available ? sections.filter((section) => section.id !== "unknown" || section.plots.length) : [sections[2]];
}
