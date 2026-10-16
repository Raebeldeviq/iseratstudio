function text(value) {
  return String(value ?? "").trim();
}

function normalized(value) {
  return text(value)
    .toLocaleLowerCase("de-DE")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/ß/gu, "ss")
    .replace(/[^a-z0-9]+/gu, "");
}

export function activePostalCodeSummary(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error("Das Blatt „Suchgebiet“ enthält keine Daten.");
  const headers = new Map(rows[0].map((value, index) => [normalized(value), index]));
  const postalCodeIndex = headers.get("postleitzahl") ?? headers.get("plz") ?? -1;
  const activeIndex = headers.get("aktiv") ?? -1;
  if (postalCodeIndex < 0 || activeIndex < 0) {
    throw new Error("Im Blatt „Suchgebiet“ fehlen Postleitzahl oder Aktiv.");
  }

  const activeRows = rows.slice(1).filter((row) => ["ja", "yes", "true", "1"].includes(normalized(row?.[activeIndex])));
  const values = activeRows.map((row) => text(row?.[postalCodeIndex]).padStart(5, "0"));
  const invalidPostalCodes = values.filter((postalCode) => !/^\d{5}$/u.test(postalCode));
  const counts = new Map();
  for (const postalCode of values.filter((value) => /^\d{5}$/u.test(value))) {
    counts.set(postalCode, (counts.get(postalCode) || 0) + 1);
  }
  const duplicatePostalCodes = [...counts.entries()].filter(([, count]) => count > 1).map(([postalCode]) => postalCode).sort();
  return {
    activeRowCount: activeRows.length,
    postalCodes: new Set(counts.keys()),
    invalidPostalCodes,
    duplicatePostalCodes,
  };
}

export function parseActivePostalCodes(rows, options = {}) {
  const summary = activePostalCodeSummary(rows);
  if (summary.invalidPostalCodes.length) {
    throw new Error(`Im Blatt „Suchgebiet“ sind ungültige aktive PLZ enthalten: ${summary.invalidPostalCodes.join(", ")}.`);
  }
  if (summary.duplicatePostalCodes.length) {
    throw new Error(`Im Blatt „Suchgebiet“ sind aktive PLZ doppelt enthalten: ${summary.duplicatePostalCodes.join(", ")}.`);
  }
  const expectedCount = Number(options.expectedCount);
  if (Number.isInteger(expectedCount) && expectedCount > 0 && summary.postalCodes.size !== expectedCount) {
    throw new Error(`Im Blatt „Suchgebiet“ müssen exakt ${expectedCount} aktive, eindeutige PLZ stehen; gefunden wurden ${summary.postalCodes.size}.`);
  }
  return summary.postalCodes;
}
