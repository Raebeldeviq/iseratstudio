import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadCatalogImage, loadCatalogManifest } from "../catalog-store.mjs";
import { persistBundledStarterCatalog } from "../scripts/bootstrap-bundled-catalog.mjs";

test("installs a neutral bundled starter catalog only when no local catalog exists", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "fpi-bundled-catalog-"));
  const catalogDirectory = join(root, "catalog");
  const imagePath = join(root, "cover.jpg");
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(imagePath, "bundled-image-bytes");

  const image = {
    id: "preset_media_cover",
    sourceId: "source-cover",
    name: "cover.jpg",
    mimeType: "image/jpeg",
    dataUrl: "",
    caption: "Dein Zuhause",
    isFloorplan: false,
    role: "cover",
  };
  const house = {
    id: "preset_house_test",
    name: "SUN Test",
    houseType: "Einfamilienhaus",
    livingArea: 100,
    rooms: 4,
    bedrooms: 3,
    bathrooms: 1,
    floors: 2,
    housePrice: 300_000,
    constructionYear: 2027,
    energyDemand: 18,
    energyClass: "A++",
    heatingType: "Fußbodenheizung mit Luft-Wasser-Wärmepumpe",
    energySource: "Umweltwärme und Strom",
    architecture: "Test",
    equipmentHighlights: "Test",
    useStandardPackage: true,
    images: [image],
  };
  const mediaItems = [{ id: "source-cover", filename: "cover.jpg", absolutePath: imagePath }];

  const first = await persistBundledStarterCatalog({ catalogDirectory, houses: [house], mediaItems });
  assert.equal(first.created, true);
  assert.equal(first.houses, 1);
  assert.equal(first.copiedImages, 1);

  const manifest = await loadCatalogManifest(catalogDirectory);
  assert.equal(manifest.state.houses[0].name, "SUN Test");
  assert.equal(manifest.state.projects.length, 1);
  assert.equal(manifest.state.provider.email, "");
  assert.equal((await loadCatalogImage("preset_media_cover", catalogDirectory)).data.toString(), "bundled-image-bytes");

  const second = await persistBundledStarterCatalog({ catalogDirectory, houses: [], mediaItems: [] });
  assert.equal(second.created, false);
  assert.equal(second.houses, 1);
});
