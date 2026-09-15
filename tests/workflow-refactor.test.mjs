import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const studioSource = await readFile(new URL("../app/InseratStudio.tsx", import.meta.url), "utf8");
const plotSource = await readFile(new URL("../app/components/PlotManagement.tsx", import.meta.url), "utf8");
const stylesSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const helperSource = await readFile(new URL("../local-upload-server.mjs", import.meta.url), "utf8");
const schedulerServiceSource = await readFile(new URL("../listing-rotation-scheduler-service.mjs", import.meta.url), "utf8");

test("uses the five-step workflow without a project tab", () => {
  const navigation = studioSource.slice(
    studioSource.indexOf('<nav className="step-nav"'),
    studioSource.indexOf("</nav>", studioSource.indexOf('<nav className="step-nav"')),
  );
  assert.match(navigation, /01.+Grundstücke & Auswahl/s);
  assert.match(navigation, /02.+Haustypen/s);
  assert.match(navigation, /03.+Texte & Vorschau/s);
  assert.match(navigation, /04.+Inseratsmanager/s);
  assert.match(navigation, /05.+Export & Upload/s);
  assert.doesNotMatch(navigation, /Projektierung/);
  assert.doesNotMatch(studioSource, /tab === "project"/);
});

test("keeps the only plot selection beside the shared house pool", () => {
  assert.doesNotMatch(plotSource, /onHandOff|An Projektierung übergeben|plot-view-switch/);
  assert.match(plotSource, /zentral ausgewählt/);
  assert.match(studioSource, /centralHousePoolPanel/);
  assert.match(studioSource, /selectedPlotIds\.flatMap/);
  // Working selection must not hide the global catalog/history in the manager.
  assert.match(studioSource, /managedListings = state\.projects\.flatMap/);
  assert.doesNotMatch(studioSource, /runSafeLocalScheduler/);
  assert.doesNotMatch(schedulerServiceSource, /selectedPlotIds/);
  assert.match(helperSource, /listingRotationSchedulerService\.run/);
  assert.doesNotMatch(studioSource, /selectedBatchProjectIds/);
  assert.doesNotMatch(stylesSource, /plot-view-switch|batch-address-groups|listing-variant-row|listing-group-management/);
});

test("offers all requested plot and listing sort criteria", () => {
  for (const label of ["Ort", "PLZ", "Grundstücksgröße", "Kaufpreis", "Upload-Datum", "Inseratsanzahl"]) {
    assert.match(plotSource, new RegExp(`>${label}<`));
  }
  for (const label of ["Ort", "Upload-Datum", "Letzte Aktualisierung", "Nächste Aktualisierung", "Health Score", "Status"]) {
    assert.match(studioSource, new RegExp(`>${label}<`));
  }
  assert.match(studioSource, /Nach Grundstück gruppieren/);
});

test("sorts the house library alphabetically in the rendered list", () => {
  assert.match(studioSource, /state\.houses\]\.sort\(\(left, right\) => left\.name\.localeCompare\(right\.name/);
});

test("keeps every listing text function in step three", () => {
  const preview = studioSource.slice(
    studioSource.indexOf('{tab === "preview"'),
    studioSource.indexOf('{tab === "manager"'),
  );
  for (const label of ["Überschrift", "Kurztext", "Objektbeschreibung", "Ausstattung", "Lage", "Energie", "Portalvorschau", "Haus- &amp; Lagetexte neu schreiben"]) {
    assert.match(preview, new RegExp(label));
  }
});
