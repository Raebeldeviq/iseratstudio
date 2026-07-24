import assert from "node:assert/strict";
import test from "node:test";
import {
  applyConfirmedHouseModelDetails,
  buildHouseTemplatePresets,
  HOUSE_TEMPLATE_PRESETS,
  isEmptyHousePlaceholder,
} from "../house-template-presets.mjs";
import { indexMediaLibrary } from "../media-library.mjs";

test("the approved starter catalog contains exactly 18 unique templates", () => {
  assert.equal(HOUSE_TEMPLATE_PRESETS.length, 18);
  assert.equal(new Set(HOUSE_TEMPLATE_PRESETS.map((item) => item.key)).size, 18);
  assert.deepEqual(
    HOUSE_TEMPLATE_PRESETS.slice(-4).map((item) => item.name),
    ["SOL 101 V2", "SOL 107 V2", "SOL 110 V2", "SUN 113 V6"],
  );
});

test("only the explicit empty starter houses qualify as replaceable placeholders", () => {
  assert.equal(isEmptyHousePlaceholder({ name: "Zweifamilienhaus – Muster", housePrice: 0, images: [] }), true);
  assert.equal(isEmptyHousePlaceholder({ name: "Haustyp 2", housePrice: 0, images: [] }), true);
  assert.equal(isEmptyHousePlaceholder({ name: "SUN 126 V2", housePrice: 365_073, images: [] }), false);
  assert.equal(isEmptyHousePlaceholder({ name: "Haustyp 2", housePrice: 0, images: [{ id: "image" }] }), false);
});

test("updates only the confirmed SUN 113 master data in a saved template", () => {
  const images = [{ id: "cover" }, { id: "floorplan" }];
  const house = {
    id: "saved-sun-113",
    name: "SUN 113 V9",
    livingArea: 113,
    rooms: 5,
    bedrooms: 2,
    bathrooms: 2,
    floors: 3,
    housePrice: 0,
    images,
    architecture: "Benutzerwert",
  };

  const updated = applyConfirmedHouseModelDetails(house);
  assert.equal(updated.housePrice, 355_122);
  assert.equal(updated.livingArea, 106.15);
  assert.equal(updated.rooms, 4);
  assert.equal(updated.bedrooms, 3);
  assert.equal(updated.bathrooms, 2);
  assert.equal(updated.floors, 3);
  assert.equal(updated.images, images);
  assert.equal(updated.architecture, "Benutzerwert");

  const otherHouse = { ...house, name: "SUN 126 V2" };
  assert.equal(applyConfirmedHouseModelDetails(otherHouse), otherHouse);
});

test("all 18 templates build from the configured media library when it is available", async (context) => {
  let mediaItems;
  try {
    mediaItems = await indexMediaLibrary();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      context.skip("Die integrierte Medienbibliothek ist auf diesem System nicht verfügbar.");
      return;
    }
    throw error;
  }
  const houses = buildHouseTemplatePresets(mediaItems, { constructionYear: 2027 });
  assert.equal(houses.length, 18);
  assert.equal(houses.filter((house) => house.floors === 1).length, 3);
  const sun113 = houses.find((house) => house.name === "SUN 113 V6");
  assert.equal(sun113.housePrice, 355_122);
  assert.equal(sun113.livingArea, 106.15);
  assert.equal(sun113.rooms, 4);
  assert.equal(sun113.bedrooms, 3);
  assert.equal(sun113.bathrooms, 1);
  assert.equal(sun113.floors, 2);
  assert.equal(houses.find((house) => house.name === "SUN 126 V2").housePrice, 365_073);
  assert.equal(houses.find((house) => house.name === "SUN 165 V2").housePrice, 426_931);
  for (const house of houses) {
    assert.equal(house.images.length, house.floors === 1 ? 12 : 13, house.name);
    assert.equal(house.images[0].role, "cover", house.name);
    assert.equal(house.images.at(-1).role, "qr", house.name);
  }
});
