import assert from "node:assert/strict";
import test from "node:test";

import {
  captionForImageRole,
  inferImageRole,
  isFixedCaptionRole,
  orderHouseImages,
} from "../image-sequence.mjs";

test("infers image roles from Windows filenames", () => {
  assert.equal(inferImageRole({ filename: "Kueche_final.jpg" }), "kitchen");
  assert.equal(inferImageRole({ filename: "Grundriss_EG.png" }), "floorplan_ground");
  assert.equal(inferImageRole({ filename: "Grundriss_DG.png" }), "floorplan_upper");
  assert.equal(inferImageRole({ filename: "Hausansicht_Titelbild.webp" }), "cover");
});

test("sorts fixed image roles while preserving interior order", () => {
  const images = [
    { id: "qr", role: "qr" },
    { id: "bath", role: "bathroom" },
    { id: "kitchen", role: "kitchen" },
    { id: "cover", role: "cover" },
    { id: "floorplan", role: "floorplan_ground" },
  ];

  assert.deepEqual(
    orderHouseImages(images).map((image) => image.id),
    ["cover", "bath", "kitchen", "floorplan", "qr"],
  );
});

test("uses Pascal image captions without locking the cover caption", () => {
  assert.equal(captionForImageRole("kitchen"), "Deine 5-Sterne-Küche");
  assert.equal(isFixedCaptionRole("kitchen"), true);
  assert.equal(captionForImageRole("cover"), "Dein wundervolles Zuhause");
  assert.equal(isFixedCaptionRole("cover"), false);
});
