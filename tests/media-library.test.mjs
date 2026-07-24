import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  BUNDLED_INTERIOR_LIBRARY_ROOT,
  BUNDLED_MEDIA_LIBRARY_ROOT,
  clearMediaLibraryCache,
  DEFAULT_INTERIOR_LIBRARY_ROOT,
  DEFAULT_MEDIA_LIBRARY_ROOT,
  deleteMediaLibraryDuplicateItems,
  deleteMediaLibraryImage,
  findMediaLibraryDuplicates,
  getMediaLibraryItem,
  queryMediaLibrary,
  recommendedMediaSequence,
  saveMediaLibraryImage,
} from "../media-library.mjs";

const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("png-payload"),
]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0x02, 0x03]);
const WEBP_BYTES = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0x04, 0x00, 0x00, 0x00]),
  Buffer.from("WEBP"),
  Buffer.from("data"),
]);

test("uses the integrated media roots while retaining optional overrides", () => {
  assert.equal(
    DEFAULT_MEDIA_LIBRARY_ROOT,
    process.env.FPI_MEDIA_LIBRARY_ROOT || BUNDLED_MEDIA_LIBRARY_ROOT,
  );
  assert.equal(
    DEFAULT_INTERIOR_LIBRARY_ROOT,
    process.env.FPI_INTERIOR_LIBRARY_ROOT || BUNDLED_INTERIOR_LIBRARY_ROOT,
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

test("stores JPEG, PNG and WebP images persistently in the managed overlay", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "fpi-managed-media-"));
  const root = join(directory, "bundled");
  const managedRoot = join(directory, "managed");
  const tombstonePath = join(directory, "tombstones.json");
  await mkdir(root);
  context.after(async () => {
    clearMediaLibraryCache();
    await rm(directory, { recursive: true, force: true });
  });

  const fixtures = [
    { filename: "Hausansicht.jpg", mimeType: "image/jpeg", data: JPEG_BYTES, kind: "house" },
    { filename: "Deine Küche.png", mimeType: "image/png", data: PNG_BYTES, kind: "interior" },
    { filename: "Lagebild.webp", mimeType: "image/webp", data: WEBP_BYTES, kind: "location" },
  ];
  const saved = [];
  for (const fixture of fixtures) {
    saved.push(await saveMediaLibraryImage(
      { ...fixture, group: "Eigene Kampagne" },
      { managedRoot },
    ));
  }

  assert.deepEqual(saved.map((entry) => entry.item.filename), fixtures.map((entry) => entry.filename));
  assert.ok(saved.every((entry) => entry.item.managed === true));
  assert.ok(saved.every((entry) => entry.item.deletable === true));
  assert.deepEqual(
    await Promise.all(saved.map((entry) => readFile(entry.item.absolutePath))),
    fixtures.map((entry) => entry.data),
  );

  const firstQuery = await queryMediaLibrary({
    root,
    managedRoot,
    tombstonePath,
    pageSize: 20,
  });
  assert.equal(firstQuery.libraryTotal, 3);
  assert.deepEqual(
    firstQuery.items.map((item) => item.filename).sort(),
    fixtures.map((entry) => entry.filename).sort(),
  );

  clearMediaLibraryCache();
  const afterRestart = await queryMediaLibrary({
    root,
    managedRoot,
    tombstonePath,
    pageSize: 20,
  });
  assert.equal(afterRestart.libraryTotal, 3);
});

test("never overwrites managed images with the same display filename", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "fpi-managed-duplicates-"));
  const managedRoot = join(directory, "managed");
  context.after(async () => {
    clearMediaLibraryCache();
    await rm(directory, { recursive: true, force: true });
  });

  const first = await saveMediaLibraryImage({
    filename: "Ansicht.png",
    mimeType: "image/png",
    data: PNG_BYTES,
    kind: "house",
    group: "Neue Häuser",
  }, { managedRoot });
  const secondBytes = Buffer.concat([PNG_BYTES, Buffer.from("second")]);
  const second = await saveMediaLibraryImage({
    filename: "Ansicht.png",
    mimeType: "image/png",
    data: secondBytes,
    kind: "house",
    group: "Neue Häuser",
  }, { managedRoot });

  assert.equal(first.item.filename, "Ansicht.png");
  assert.equal(second.item.filename, "Ansicht.png");
  assert.notEqual(first.item.id, second.item.id);
  assert.notEqual(first.item.absolutePath, second.item.absolutePath);
  assert.deepEqual(await readFile(first.item.absolutePath), PNG_BYTES);
  assert.deepEqual(await readFile(second.item.absolutePath), secondBytes);
});

test("finds exact SHA-256 duplicates only within the same media kind and group", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "fpi-media-duplicate-scan-"));
  const root = join(directory, "bundled");
  const managedRoot = join(directory, "managed");
  const tombstonePath = join(directory, "tombstones.json");
  const bundledDuplicatePath = join(root, "Kampagne", "Bestandsbild.png");
  const sameLengthDifferentBytes = Buffer.concat([
    PNG_BYTES.subarray(0, 8),
    Buffer.from("png-payloae"),
  ]);
  await mkdir(join(root, "Kampagne"), { recursive: true });
  await writeFile(bundledDuplicatePath, PNG_BYTES);
  context.after(async () => {
    clearMediaLibraryCache();
    await rm(directory, { recursive: true, force: true });
  });

  const managedDuplicates = [];
  for (const filename of ["Kopie mit anderem Namen.png", "Noch eine Kopie.png"]) {
    managedDuplicates.push(await saveMediaLibraryImage({
      filename,
      mimeType: "image/png",
      data: PNG_BYTES,
      kind: "location",
      group: "Kampagne",
    }, { managedRoot }));
  }
  await saveMediaLibraryImage({
    filename: "Gleiche Länge, andere Bytes.png",
    mimeType: "image/png",
    data: sameLengthDifferentBytes,
    kind: "location",
    group: "Kampagne",
  }, { managedRoot });
  await saveMediaLibraryImage({
    filename: "Gleiche Bytes, andere Gruppe.png",
    mimeType: "image/png",
    data: PNG_BYTES,
    kind: "location",
    group: "Andere Kampagne",
  }, { managedRoot });
  await saveMediaLibraryImage({
    filename: "Gleiche Bytes, andere Bildart.png",
    mimeType: "image/png",
    data: PNG_BYTES,
    kind: "marketing",
    group: "Kampagne",
  }, { managedRoot });

  assert.equal(sameLengthDifferentBytes.length, PNG_BYTES.length);
  const indexed = await queryMediaLibrary({
    root,
    managedRoot,
    tombstonePath,
    pageSize: 20,
  });
  const bundledDuplicate = indexed.items.find(
    (item) => item.filename === "Bestandsbild.png",
  );
  assert.ok(bundledDuplicate);

  const result = await findMediaLibraryDuplicates({
    root,
    managedRoot,
    tombstonePath,
  });
  assert.equal(result.groupCount, 1);
  assert.equal(result.duplicateCount, 2);
  assert.equal(result.affectedItemCount, 3);
  assert.equal(result.physicallyReclaimableBytes, PNG_BYTES.length * 2);
  assert.equal(result.groups.length, 1);

  const group = result.groups[0];
  const expectedContentHash = createHash("sha256").update(PNG_BYTES).digest("hex");
  assert.equal(typeof group.id, "string");
  assert.ok(group.id.length > 0);
  assert.equal(group.items.length, 3);
  assert.equal(group.recommendedKeepId, bundledDuplicate.id);
  assert.deepEqual(
    new Set(group.items.map((item) => item.id)),
    new Set([
      bundledDuplicate.id,
      ...managedDuplicates.map((entry) => entry.item.id),
    ]),
  );
  assert.ok(group.items.every((item) => item.bytes === PNG_BYTES.length));
  assert.ok(group.items.every((item) => item.referenceCount === 0));
  assert.ok(group.items.every((item) => item.contentHash === expectedContentHash));

  const referencedManagedId = managedDuplicates[0].item.id;
  for (const referenceCounts of [
    new Map([[referencedManagedId, 3]]),
    { [referencedManagedId]: 3 },
  ]) {
    const withReferences = await findMediaLibraryDuplicates({
      root,
      managedRoot,
      tombstonePath,
      referenceCounts,
    });
    assert.equal(withReferences.groups[0].recommendedKeepId, referencedManagedId);
    assert.equal(
      withReferences.groups[0].items.find((item) => item.id === referencedManagedId)
        ?.referenceCount,
      3,
    );
    assert.ok(
      withReferences.groups[0].items
        .filter((item) => item.id !== referencedManagedId)
        .every((item) => item.referenceCount === 0),
    );
  }

  clearMediaLibraryCache();
  const afterRestart = await findMediaLibraryDuplicates({
    root,
    managedRoot,
    tombstonePath,
  });
  assert.deepEqual(
    afterRestart.groups.map((entry) => ({
      id: entry.id,
      recommendedKeepId: entry.recommendedKeepId,
      itemIds: entry.items.map((item) => item.id),
    })),
    result.groups.map((entry) => ({
      id: entry.id,
      recommendedKeepId: entry.recommendedKeepId,
      itemIds: entry.items.map((item) => item.id),
    })),
  );
});

test("bulk duplicate cleanup unlinks managed copies, tombstones bundled copies and deduplicates ids", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "fpi-media-duplicate-delete-"));
  const root = join(directory, "bundled");
  const managedRoot = join(directory, "managed");
  const tombstonePath = join(directory, "tombstones.json");
  const bundledPaths = [
    join(root, "Kampagne", "A Original.png"),
    join(root, "Kampagne", "B Archivkopie.png"),
  ];
  await mkdir(join(root, "Kampagne"), { recursive: true });
  await Promise.all(bundledPaths.map((path) => writeFile(path, PNG_BYTES)));
  context.after(async () => {
    clearMediaLibraryCache();
    await rm(directory, { recursive: true, force: true });
  });

  const managedCopies = [];
  for (const filename of ["C Eigene Kopie.png", "D Zweite eigene Kopie.png"]) {
    managedCopies.push(await saveMediaLibraryImage({
      filename,
      mimeType: "image/png",
      data: PNG_BYTES,
      kind: "location",
      group: "Kampagne",
    }, { managedRoot }));
  }
  await saveMediaLibraryImage({
    filename: "Einzelbild.png",
    mimeType: "image/png",
    data: Buffer.concat([PNG_BYTES, Buffer.from("unique")]),
    kind: "location",
    group: "Kampagne",
  }, { managedRoot });

  // Populate the index cache before the mutation to verify immediate invalidation.
  await queryMediaLibrary({
    root,
    managedRoot,
    tombstonePath,
    pageSize: 20,
  });
  const before = await findMediaLibraryDuplicates({
    root,
    managedRoot,
    tombstonePath,
  });
  assert.equal(before.groupCount, 1);
  assert.equal(before.groups[0].items.length, 4);

  const group = before.groups[0];
  const deleteIds = group.items
    .filter((item) => item.id !== group.recommendedKeepId)
    .map((item) => item.id);
  const indexedBeforeDelete = await queryMediaLibrary({
    root,
    managedRoot,
    tombstonePath,
    pageSize: 20,
  });
  const indexedById = new Map(indexedBeforeDelete.items.map((item) => [item.id, item]));
  const managedDeleteItems = deleteIds
    .map((id) => indexedById.get(id))
    .filter((item) => item?.managed === true);
  const bundledDeleteItems = deleteIds
    .map((id) => indexedById.get(id))
    .filter((item) => item && item.managed !== true);
  assert.equal(managedDeleteItems.length, 2);
  assert.equal(bundledDeleteItems.length, 1);

  await deleteMediaLibraryDuplicateItems(
    [...deleteIds, deleteIds[0]],
    {
      root,
      managedRoot,
      tombstonePath,
    },
  );

  for (const item of managedDeleteItems) {
    await assert.rejects(stat(item.absolutePath), { code: "ENOENT" });
  }
  for (const item of bundledDeleteItems) {
    assert.deepEqual(await readFile(item.absolutePath), PNG_BYTES);
  }
  const keepItem = indexedById.get(group.recommendedKeepId);
  assert.ok(keepItem);
  assert.deepEqual(await readFile(keepItem.absolutePath), PNG_BYTES);

  const tombstones = JSON.parse(await readFile(tombstonePath, "utf8"));
  assert.deepEqual(
    tombstones.hiddenIds,
    bundledDeleteItems.map((item) => item.id).sort(),
  );
  const afterDelete = await queryMediaLibrary({
    root,
    managedRoot,
    tombstonePath,
    pageSize: 20,
  });
  assert.equal(afterDelete.items.some((item) => item.id === group.recommendedKeepId), true);
  assert.ok(deleteIds.every((id) => !afterDelete.items.some((item) => item.id === id)));
  assert.equal((await findMediaLibraryDuplicates({
    root,
    managedRoot,
    tombstonePath,
  })).groupCount, 0);

  clearMediaLibraryCache();
  const afterRestart = await queryMediaLibrary({
    root,
    managedRoot,
    tombstonePath,
    pageSize: 20,
  });
  assert.deepEqual(
    afterRestart.items.map((item) => item.id).sort(),
    afterDelete.items.map((item) => item.id).sort(),
  );
});

test("bulk duplicate cleanup atomically rejects deleting every copy in a group", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "fpi-media-duplicate-keep-"));
  const root = join(directory, "bundled");
  const managedRoot = join(directory, "managed");
  const tombstonePath = join(directory, "tombstones.json");
  const bundledPath = join(root, "Kampagne", "Original.png");
  await mkdir(join(root, "Kampagne"), { recursive: true });
  await writeFile(bundledPath, PNG_BYTES);
  context.after(async () => {
    clearMediaLibraryCache();
    await rm(directory, { recursive: true, force: true });
  });

  const managed = await saveMediaLibraryImage({
    filename: "Eigene Kopie.png",
    mimeType: "image/png",
    data: PNG_BYTES,
    kind: "location",
    group: "Kampagne",
  }, { managedRoot });
  const options = {
    root,
    managedRoot,
    tombstonePath,
  };
  const before = await findMediaLibraryDuplicates(options);
  assert.equal(before.groupCount, 1);
  const allIds = before.groups[0].items.map((item) => item.id);

  await assert.rejects(
    deleteMediaLibraryDuplicateItems(allIds, options),
    (error) => {
      assert.equal(error.httpStatus, 409);
      assert.match(error.message, /Exemplar|Original|behalten/i);
      return true;
    },
  );

  assert.deepEqual(await readFile(bundledPath), PNG_BYTES);
  assert.deepEqual(await readFile(managed.item.absolutePath), PNG_BYTES);
  await assert.rejects(readFile(tombstonePath), { code: "ENOENT" });
  const after = await findMediaLibraryDuplicates(options);
  assert.deepEqual(
    after.groups.map((group) => group.items.map((item) => item.id)),
    before.groups.map((group) => group.items.map((item) => item.id)),
  );
});

test("rejects traversal, unsupported formats and mismatched image declarations", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "fpi-managed-validation-"));
  const managedRoot = join(directory, "managed");
  context.after(async () => {
    clearMediaLibraryCache();
    await rm(directory, { recursive: true, force: true });
  });

  for (const filename of [
    "../außerhalb.png",
    "..\\außerhalb.png",
    "/tmp/außerhalb.png",
    "C:\\Temp\\außerhalb.png",
    "NUL.png",
  ]) {
    await assert.rejects(
      saveMediaLibraryImage({
        filename,
        mimeType: "image/png",
        data: PNG_BYTES,
        kind: "marketing",
      }, { managedRoot }),
      /Dateiname|Windows/,
    );
  }
  await assert.rejects(
    saveMediaLibraryImage({
      filename: "Bild.gif",
      mimeType: "image/gif",
      data: Buffer.from("GIF89a"),
      kind: "marketing",
    }, { managedRoot }),
    /JPEG-, PNG- und WebP/,
  );
  await assert.rejects(
    saveMediaLibraryImage({
      filename: "Bild.png",
      mimeType: "image/jpeg",
      data: PNG_BYTES,
      kind: "marketing",
    }, { managedRoot }),
    /Dateiendung und Content-Type/,
  );
  await assert.rejects(
    saveMediaLibraryImage({
      filename: "Bild.png",
      mimeType: "image/png",
      data: Buffer.from("kein bild"),
      kind: "marketing",
    }, { managedRoot }),
    /Dateiinhalt/,
  );
});

test("physically deletes only managed images", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "fpi-managed-delete-"));
  const root = join(directory, "bundled");
  const managedRoot = join(directory, "managed");
  const tombstonePath = join(directory, "tombstones.json");
  await mkdir(root);
  context.after(async () => {
    clearMediaLibraryCache();
    await rm(directory, { recursive: true, force: true });
  });

  const saved = await saveMediaLibraryImage({
    filename: "Löschbares Bild.webp",
    mimeType: "image/webp",
    data: WEBP_BYTES,
    kind: "marketing",
    group: "Eigene Bilder",
  }, { managedRoot });
  const result = await deleteMediaLibraryImage(saved.item.id, {
    root,
    managedRoot,
    tombstonePath,
  });
  assert.deepEqual(result, {
    deletedId: saved.item.id,
    managed: true,
    deletionMode: "deleted",
  });
  await assert.rejects(stat(saved.item.absolutePath), { code: "ENOENT" });
  assert.equal((await queryMediaLibrary({
    root,
    managedRoot,
    tombstonePath,
  })).libraryTotal, 0);
});

test("hides bundled images persistently without deleting their originals", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "fpi-bundled-hide-"));
  const root = join(directory, "bundled");
  const managedRoot = join(directory, "managed");
  const tombstonePath = join(directory, "tombstones.json");
  const originalPath = join(root, "Bestand.png");
  await mkdir(root);
  await writeFile(originalPath, PNG_BYTES);
  context.after(async () => {
    clearMediaLibraryCache();
    await rm(directory, { recursive: true, force: true });
  });

  const item = (await queryMediaLibrary({
    root,
    managedRoot,
    tombstonePath,
  })).items[0];
  const result = await deleteMediaLibraryImage(item.id, {
    root,
    managedRoot,
    tombstonePath,
  });
  assert.deepEqual(result, {
    deletedId: item.id,
    managed: false,
    deletionMode: "hidden",
  });
  assert.deepEqual(await readFile(originalPath), PNG_BYTES);
  assert.equal((await queryMediaLibrary({
    root,
    managedRoot,
    tombstonePath,
  })).libraryTotal, 0);

  clearMediaLibraryCache();
  assert.equal((await queryMediaLibrary({
    root,
    managedRoot,
    tombstonePath,
  })).libraryTotal, 0);
  const tombstones = JSON.parse(await readFile(tombstonePath, "utf8"));
  assert.deepEqual(tombstones.hiddenIds, [item.id]);
});

test("returns 404 for an unknown media id without touching any root", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "fpi-unknown-media-"));
  const root = join(directory, "bundled");
  const managedRoot = join(directory, "managed");
  const tombstonePath = join(directory, "tombstones.json");
  await mkdir(root);
  context.after(async () => {
    clearMediaLibraryCache();
    await rm(directory, { recursive: true, force: true });
  });

  await assert.rejects(
    deleteMediaLibraryImage("a".repeat(32), {
      root,
      managedRoot,
      tombstonePath,
    }),
    (error) => {
      assert.equal(error.httpStatus, 404);
      assert.match(error.message, /nicht gefunden/);
      return true;
    },
  );
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
