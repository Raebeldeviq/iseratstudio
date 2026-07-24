import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  clearMediaLibraryCache,
  DEFAULT_INTERIOR_LIBRARY_ROOT,
  DEFAULT_MEDIA_LIBRARY_ROOT,
  getMediaLibraryItem,
  queryMediaLibrary,
  recommendedMediaSequence,
} from "../media-library.mjs";

test("keeps Pascal's two configured iCloud media roots", () => {
  assert.equal(
    DEFAULT_MEDIA_LIBRARY_ROOT,
    process.env.FPI_MEDIA_LIBRARY_ROOT
      || "/Users/pascalfrohlich/Library/Mobile Documents/com~apple~CloudDocs/Life Business-System/01_HANDELSVERTRETUNG/03_MARKETING/04_ANZEIGEN",
  );
  assert.equal(
    DEFAULT_INTERIOR_LIBRARY_ROOT,
    process.env.FPI_INTERIOR_LIBRARY_ROOT
      || "/Users/pascalfrohlich/Library/Mobile Documents/com~apple~CloudDocs/Life Business-System/01_HANDELSVERTRETUNG/03_MARKETING/01_RENDERING/Inneneinrichtung",
  );
});

test("indexes, classifies and filters the media library", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "fpi-media-library-"));
  context.after(async () => {
    clearMediaLibraryCache();
    await rm(root, { recursive: true, force: true });
  });

  await mkdir(join(root, "Haustypen", "Sunshine", "Sun 144", "Grundrisse"), {
    recursive: true,
  });
  await mkdir(join(root, "Borkheide"), { recursive: true });
  await writeFile(
    join(root, "Haustypen", "Sunshine", "Sun 144", "SUN 144 V4 Tag.png"),
    "house",
  );
  await writeFile(
    join(root, "Haustypen", "Sunshine", "Sun 144", "Grundrisse", "SUN_144_V4_EG.jpg"),
    "floorplan",
  );
  await writeFile(join(root, "Borkheide", "Borkheide Startbild.png"), "location");
  await writeFile(join(root, "Nicht unterstützt.tif"), "tiff");

  const complete = await queryMediaLibrary({ root, pageSize: 20 });
  assert.equal(complete.available, true);
  assert.equal(complete.libraryTotal, 3);
  assert.equal(
    complete.groups.find((group) => group.name === "Sunshine · Sun 144")?.count,
    2,
  );
  assert.equal(
    complete.items.find((item) => item.filename === "SUN 144 V4 Tag.png")?.brandedCover,
    true,
  );

  const locations = await queryMediaLibrary({ root, query: "Borkheide" });
  assert.equal(locations.total, 1);
  assert.equal(locations.items[0].kind, "location");
  assert.equal(
    (await getMediaLibraryItem(locations.items[0].id, root))?.filename,
    "Borkheide Startbild.png",
  );
});

test("reports a missing library without crashing the app", async () => {
  const result = await queryMediaLibrary({
    root: join(tmpdir(), "definitely-missing-fpi-media-library"),
  });
  assert.equal(result.available, false);
  assert.deepEqual(result.items, []);
});

test("builds a complete versionspecific image sequence", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "fpi-media-sequence-"));
  context.after(async () => {
    clearMediaLibraryCache();
    await rm(root, { recursive: true, force: true });
  });

  await mkdir(join(root, "Haustypen", "Sunshine", "Sun 126", "Grundrisse"), {
    recursive: true,
  });
  const files = [
    ["Haustypen/SUN 126 V2.png", "cover"],
    ["Haustypen/Sunshine/Sun 126/Grundrisse/SUN_126_SD_V2_EG.jpg", "ground"],
    ["Haustypen/Sunshine/Sun 126/Grundrisse/SUN_126_SD_V2_DG.jpg", "upper"],
    ["Deine 5 Küche.jpeg", "kitchen"],
    ["Dein Spa.png", "bathroom"],
    ["Deine Ruhezone.jpeg", "bedroom"],
    ["Raum zum Wachsen.jpeg", "kids"],
    ["Wohnzimmer.jpeg", "living"],
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
  assert.equal(result.items[0].role, "cover");
  assert.equal(result.items.at(-1).role, "qr");
  assert.deepEqual(result.priceMatch, {
    key: "SUN126",
    label: "SUN 126",
    price: 365_073,
    houseType: "Einfamilienhaus",
  });
});
