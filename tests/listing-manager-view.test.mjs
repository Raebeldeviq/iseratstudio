import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { filterManagedListingsByObjectNumber } from "../listing-manager-view.mjs";

const entries = [
  { project: { id: "a" }, listing: { id: "1", externalId: "30460-132" } },
  { project: { id: "a" }, listing: { id: "2", externalId: "30460-093014" } },
  { project: { id: "b" }, listing: { id: "3", externalId: "30460-093015" } },
  { project: { id: "b" }, listing: { id: "4", externalId: "" } },
];

test("manager search matches full and partial object numbers without changing source order", () => {
  assert.deepEqual(filterManagedListingsByObjectNumber(entries, "30460-132").map((entry) => entry.listing.id), ["1"]);
  assert.deepEqual(filterManagedListingsByObjectNumber(entries, "093014").map((entry) => entry.listing.id), ["2"]);
  assert.deepEqual(filterManagedListingsByObjectNumber(entries, "30460-093").map((entry) => entry.listing.id), ["2", "3"]);
  assert.deepEqual(filterManagedListingsByObjectNumber(entries, " 093 ").map((entry) => entry.listing.id), ["2", "3"]);
  assert.deepEqual(filterManagedListingsByObjectNumber(entries, "999").map((entry) => entry.listing.id), []);
  assert.equal(filterManagedListingsByObjectNumber(entries, ""), entries);
});

test("manager cards keep existing controls in details and auto-open a single search result", async () => {
  const source = await readFile(new URL("../app/InseratStudio.tsx", import.meta.url), "utf8");
  const manager = source.slice(source.indexOf('className="content-card manager-list-card"'), source.indexOf('{tab === "deletion"'));
  assert.match(manager, /placeholder="Objektnummer suchen …"/u);
  assert.match(manager, /setManagerObjectNumberQuery\(event\.target\.value\); setExpandedManagerListingKey\(null\); setCollapsedSingleManagerResultKey\(null\)/u);
  assert.match(source, /singleManagerSearchResult = Boolean\(managerObjectNumberQuery\.trim\(\)\) && visibleManagedListings\.length === 1/u);
  assert.match(manager, /const expanded = \(singleManagerSearchResult && collapsedSingleManagerResultKey !== listingKey\) \|\| expandedManagerListingKey === listingKey/u);
  assert.match(manager, /aria-expanded=\{expanded\}/u);
  assert.match(manager, /\{expanded \? <div id=\{`manager-details-/u);
  const details = manager.slice(manager.indexOf("manager-row-details"));
  for (const label of ["Automatik", "Premium", "Löschen sperren", "Priorität", "Nächstes Haus", "Jetzt aktualisieren", "Nur kopieren"]) {
    assert.ok(details.includes(label), `${label} must remain in expanded details`);
  }
  assert.match(manager, /groupManagerByPlot/u);
});
