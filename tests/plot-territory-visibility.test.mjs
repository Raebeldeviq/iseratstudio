import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  defaultPlotTerritoryVisibility,
  PLOT_TERRITORY_VISIBILITY_KEY,
  readPlotTerritoryVisibility,
  savePlotTerritoryVisibility,
  togglePlotTerritoryVisibility,
} from "../plot-territory-visibility.mjs";

test("both plot territories can be opened and closed independently", () => {
  const bothOpen = { ...defaultPlotTerritoryVisibility };
  const insideClosed = togglePlotTerritoryVisibility(bothOpen, "inside");
  assert.deepEqual(insideClosed, { inside: false, outside: true });
  assert.deepEqual(togglePlotTerritoryVisibility(insideClosed, "outside"), { inside: false, outside: false });
  assert.deepEqual(togglePlotTerritoryVisibility(bothOpen, "outside"), { inside: true, outside: false });
  assert.deepEqual(togglePlotTerritoryVisibility(insideClosed, "inside"), bothOpen);
  assert.deepEqual(bothOpen, { inside: true, outside: true });
});

test("each territory state survives a browser storage round trip", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  for (const inside of [true, false]) {
    for (const outside of [true, false]) {
      const visibility = { inside, outside };
      savePlotTerritoryVisibility(storage, visibility);
      assert.deepEqual(readPlotTerritoryVisibility(storage), visibility);
    }
  }
  assert.equal(values.has(PLOT_TERRITORY_VISIBILITY_KEY), true);
});

test("missing, invalid or blocked storage leaves both territories open", () => {
  assert.deepEqual(readPlotTerritoryVisibility(null), { inside: true, outside: true });
  assert.deepEqual(readPlotTerritoryVisibility({ getItem: () => "not JSON" }), { inside: true, outside: true });
  assert.deepEqual(readPlotTerritoryVisibility({ getItem: () => { throw new Error("blocked"); } }), { inside: true, outside: true });
  assert.doesNotThrow(() => savePlotTerritoryVisibility({ setItem: () => { throw new Error("blocked"); } }, { inside: false, outside: true }));
});

test("section headers keep the current count and accessible toggle visible", () => {
  const component = readFileSync(new URL("../app/components/PlotManagement.tsx", import.meta.url), "utf8");
  assert.match(component, /<h3 className="plot-territory-title"><button/u);
  assert.match(component, /className="plot-territory-toggle" aria-expanded=/u);
  assert.match(component, /aria-controls=\{`plot-territory-content-\$\{territory\.id\}`\}/u);
  assert.match(component, /<span>\{territory\.plots\.length\} Grundstücke<\/span>/u);
  assert.match(component, /hidden=\{\(territory\.id === "inside" \|\| territory\.id === "outside"\)/u);
});
