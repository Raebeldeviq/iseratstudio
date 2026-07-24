import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  BUNDLED_INTERIOR_LIBRARY_ROOT,
  BUNDLED_MEDIA_LIBRARY_ROOT,
  clearMediaLibraryCache,
  getMediaLibraryItem,
  queryMediaLibrary,
  recommendedMediaSequence,
} from "../media-library.mjs";

test("ships the complete integrated image library", async () => {
  const library = await queryMediaLibrary({
    root: BUNDLED_MEDIA_LIBRARY_ROOT,
    interiorRoot: BUNDLED_INTERIOR_LIBRARY_ROOT,
    pageSize: 1,
  });
  assert.equal(library.available, true);
  assert.equal(library.libraryTotal, 665);
  assert.ok(library.groups.some((group) => group.name === "Inneneinrichtung"));
  assert.ok(library.groups.some((group) => group.name === "Haustypen · Übersicht"));
});

test("indexes, classifies and filters the labeled media library", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "fpi-media-library-"));
  context.after(async () => {
    clearMediaLibraryCache();
    await rm(root, { recursive: true, force: true });
  });

  await mkdir(join(root, "Haustypen", "Sunshine", "Sun 144", "Grundrisse"), { recursive: true });
  await mkdir(join(root, "Borkheide"), { recursive: true });
  await writeFile(join(root, "Haustypen", "Sunshine", "Sun 144", "SUN 144 V4 Tag.png"), "house");
  await writeFile(join(root, "Haustypen", "Sunshine", "Sun 144", "Grundrisse", "SUN_144_V6_KAT_EG.jpg"), "floorplan");
  await writeFile(join(root, "Haustypen", "Sunshine", "Sun 144", "SUN_144_SD2_V4_OG.jpg"), "floorplan-direct");
  await writeFile(join(root, "Borkheide", "Borkheide Startbild.png"), "location");
  await writeFile(join(root, "Nicht unterstützt.tif"), "tiff");

  const complete = await queryMediaLibrary({ root, pageSize: 20 });
  assert.equal(complete.available, true);
  assert.equal(complete.libraryTotal, 4);
  assert.equal(complete.groups.find((group) => group.name === "Sunshine · Sun 144")?.count, 3);
  assert.equal(complete.items.find((item) => item.filename === "SUN 144 V4 Tag.png")?.brandedCover, true);

  const floorplans = await queryMediaLibrary({ root, kind: "floorplan" });
  assert.equal(floorplans.total, 2);
  assert.ok(floorplans.items.some((item) => item.caption === "SUN 144 V6 KAT EG"));
  assert.ok(floorplans.items.some((item) => item.caption === "SUN 144 SD2 V4 OG"));
  assert.ok(floorplans.items.every((item) => item.houseModel === "Sun 144"));

  const locations = await queryMediaLibrary({ root, query: "Borkheide" });
  assert.equal(locations.total, 1);
  assert.equal(locations.items[0].kind, "location");
  assert.equal((await getMediaLibraryItem(locations.items[0].id, root))?.filename, "Borkheide Startbild.png");
});

test("reports a missing library without crashing the app", async () => {
  const result = await queryMediaLibrary({ root: join(tmpdir(), "definitely-missing-fpi-media-library") });
  assert.equal(result.available, false);
  assert.deepEqual(result.items, []);
});

test("combines the advertisement and interior libraries with explicit roles", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "fpi-media-library-"));
  const interiorRoot = await mkdtemp(join(tmpdir(), "fpi-interior-library-"));
  context.after(async () => {
    clearMediaLibraryCache();
    await rm(root, { recursive: true, force: true });
    await rm(interiorRoot, { recursive: true, force: true });
  });

  await writeFile(join(root, "Dein Spa.png"), "bathroom");
  await writeFile(join(interiorRoot, "Deine Ruhezone.jpeg"), "bedroom");

  const complete = await queryMediaLibrary({ root, interiorRoot, pageSize: 20 });
  assert.equal(complete.libraryTotal, 2);
  assert.equal(complete.groups.find((group) => group.name === "Inneneinrichtung")?.count, 1);
  assert.equal(complete.items.find((item) => item.filename === "Dein Spa.png")?.role, "bathroom");
  assert.equal(complete.items.find((item) => item.filename === "Dein Spa.png")?.kind, "interior");
  assert.equal(complete.items.find((item) => item.filename === "Deine Ruhezone.jpeg")?.role, "bedroom");
  assert.equal(complete.items.find((item) => item.filename === "Deine Ruhezone.jpeg")?.kind, "interior");
});

test("returns the model price with a complete recommended sequence", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "fpi-priced-media-library-"));
  context.after(async () => {
    clearMediaLibraryCache();
    await rm(root, { recursive: true, force: true });
  });

  await mkdir(join(root, "Haustypen", "Sunshine", "Sun 126", "Grundrisse"), { recursive: true });
  const files = [
    ["Haustypen/SUN 126 V2.png", "cover"],
    ["Haustypen/Sunshine/Sun 126/Grundrisse/SUN_126_SD_V2_EG.jpg", "ground"],
    ["Haustypen/Sunshine/Sun 126/Grundrisse/SUN_126_SD_V2_DG.jpg", "upper"],
    ["Deine 5_ Küche.jpeg", "kitchen"],
    ["Dein Spa.png", "bathroom"],
    ["Deine Ruhezone.jpeg", "bedroom"],
    ["Der Entwicklungsraum.jpeg", "kids"],
    ["Setz dich und Ruh dich aus.jpeg", "living"],
    ["Work-Life Balance.jpg", "office"],
    ["Hier beginnt dein Zuhause.png", "emotion"],
    ["Ausgezeichnet gebaut.png", "awards"],
    ["Bestens Beraten.jpg", "trust"],
    ["Jetzt Starten!.png", "qr"],
  ];
  await Promise.all(files.map(([path, contents]) => writeFile(join(root, path), contents)));

  const library = await queryMediaLibrary({ root, query: "SUN 126 V2", kind: "house" });
  const result = await recommendedMediaSequence(library.items[0].id, root);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.items.length, 13);
  assert.deepEqual(result.priceMatch, {
    key: "SUN126",
    label: "SUN 126",
    price: 365_073,
    houseType: "Einfamilienhaus",
  });
});
