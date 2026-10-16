import assert from "node:assert/strict";
import test from "node:test";
import { activePostalCodeSummary, parseActivePostalCodes } from "../plot-search-area.mjs";

test("active search area accepts only unique valid rows marked Ja", () => {
  const rows = [
    ["Postleitzahl", "Region", "Aktiv"],
    ["13581", "Berlin", "Ja"],
    ["13583", "Berlin", "Nein"],
    [14469, "Potsdam", "Ja"],
  ];
  assert.deepEqual([...parseActivePostalCodes(rows, { expectedCount: 2 })], ["13581", "14469"]);
  assert.deepEqual(activePostalCodeSummary(rows), {
    activeRowCount: 2,
    postalCodes: new Set(["13581", "14469"]),
    invalidPostalCodes: [],
    duplicatePostalCodes: [],
  });
});

test("duplicate, invalid, or incomplete active search areas fail closed", () => {
  assert.throws(() => parseActivePostalCodes([
    ["PLZ", "Aktiv"],
    ["13581", "Ja"],
    ["13581", "Ja"],
  ], { expectedCount: 2 }), /doppelt/u);
  assert.throws(() => parseActivePostalCodes([
    ["PLZ", "Aktiv"],
    ["ABCDE", "Ja"],
  ]), /ungültige aktive PLZ/u);
  assert.throws(() => parseActivePostalCodes([
    ["PLZ", "Aktiv"],
    ["13581", "Ja"],
  ], { expectedCount: 50 }), /exakt 50/u);
});
