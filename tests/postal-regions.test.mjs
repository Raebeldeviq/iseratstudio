import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  compareProjectsByRegion,
  groupProjectsByRegion,
  resolvePostalRegion,
} from "../app/lib/postal-regions.ts";

test("resolves a PLZ with the matching town and refuses ambiguous guesses", () => {
  const index = {
    "15732": [
      ["schulzendorf", "Brandenburg", "Landkreis Dahme-Spreewald"],
      ["eichwalde", "Brandenburg", "Landkreis Dahme-Spreewald"],
    ],
    "12345": [
      ["musterdorf", "Brandenburg", "Landkreis Nord"],
      ["musterstadt", "Berlin", "Berlin"],
    ],
  };

  assert.deepEqual(resolvePostalRegion(index, "15732", "Schulzendorf"), {
    federalState: "Brandenburg",
    county: "Landkreis Dahme-Spreewald",
  });
  assert.equal(resolvePostalRegion(index, "12345", "Unbekannt"), null);
  assert.equal(resolvePostalRegion(index, "1234", "Schulzendorf"), null);
});

test("groups projects by federal state and county and sorts each group by PLZ", () => {
  const projects = [
    { id: "b", federalState: "Brandenburg", county: "Landkreis Potsdam-Mittelmark", zip: "14513", city: "Teltow", street: "B" },
    { id: "c", federalState: "Berlin", county: "Berlin", zip: "12621", city: "Berlin", street: "C" },
    { id: "a", federalState: "Brandenburg", county: "Landkreis Potsdam-Mittelmark", zip: "14510", city: "Seddiner See", street: "A" },
  ];

  const sorted = [...projects].sort(compareProjectsByRegion);
  assert.deepEqual(sorted.map((project) => project.id), ["c", "a", "b"]);
  const groups = groupProjectsByRegion(projects);
  assert.deepEqual(groups.map((group) => group.label), [
    "Berlin · Berlin",
    "Brandenburg · Landkreis Potsdam-Mittelmark",
  ]);
  assert.deepEqual(groups[1].projects.map((project) => project.zip), ["14510", "14513"]);
});

test("ships the offline GeoNames mapping for the working region", async () => {
  const dataPath = fileURLToPath(new URL("../public/data/de-postal-regions.json", import.meta.url));
  const data = JSON.parse(await readFile(dataPath, "utf8"));

  assert.equal(data.license, "CC BY 4.0");
  assert.deepEqual(resolvePostalRegion(data.regions, "14469", "Potsdam"), {
    federalState: "Brandenburg",
    county: "Kreisfreie Stadt Potsdam",
  });
  assert.deepEqual(resolvePostalRegion(data.regions, "12621", "Berlin"), {
    federalState: "Berlin",
    county: "Berlin, Stadt",
  });
});
