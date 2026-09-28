import assert from "node:assert/strict";
import test from "node:test";

import { listingLocationLabel, resolveProjectLocation } from "../project-location.mjs";

test("separates verified districts while keeping a combined title location", () => {
  const cases = [
    [{ city: "Potsdam- Stern", zip: "14480" }, "Potsdam", "Stern", "Potsdam-Stern"],
    [{ city: "Potsdam- Bornstedt", zip: "14469" }, "Potsdam", "Bornstedt", "Potsdam-Bornstedt"],
    [{ city: "Potsdam- Drewitz", zip: "14480" }, "Potsdam", "Drewitz", "Potsdam-Drewitz"],
    [{ city: "Berlin-Rudow", zip: "12355" }, "Berlin", "Rudow", "Berlin-Rudow"],
    [{ city: "Berlin-Zehlendorf", zip: "14165" }, "Berlin", "Zehlendorf", "Berlin-Zehlendorf"],
    [{ city: "Werder (Havel), Phöben", zip: "14542" }, "Werder (Havel)", "Phöben", "Werder (Havel)-Phöben"],
    [{ city: "Werder (Havel), Töplitz", zip: "14542" }, "Werder (Havel)", "Töplitz", "Werder (Havel)-Töplitz"],
    [{ city: "Kloster Lehnin-Damsdorf", zip: "14797" }, "Kloster Lehnin", "Damsdorf", "Kloster Lehnin-Damsdorf"],
  ];
  for (const [project, city, district, titleLocation] of cases) {
    assert.deepEqual(resolveProjectLocation(project), { city, district, source: "verified_mapping" });
    assert.equal(listingLocationLabel(project), titleLocation);
  }
});

test("gives structured district priority and never splits unknown or official town names", () => {
  assert.deepEqual(resolveProjectLocation({ city: "Potsdam", district: "Stern", zip: "14480" }), {
    city: "Potsdam", district: "Stern", source: "structured",
  });
  assert.deepEqual(resolveProjectLocation({ city: "Potsdam Groß Glienicke", district: "Groß Glienicke", zip: "14476" }), {
    city: "Potsdam", district: "Groß Glienicke", source: "structured",
  });
  assert.deepEqual(resolveProjectLocation({ city: "Werder", district: "Glindow", zip: "14542" }), {
    city: "Werder (Havel)", district: "Glindow", source: "structured",
  });
  assert.equal(listingLocationLabel({ city: "Werder", district: "Töplitz", zip: "14542" }), "Werder (Havel)-Töplitz");
  for (const city of ["Dallgow-Döberitz", "Frankfurt (Oder)", "Werder (Havel)", "Unbekannt-Nord"]) {
    assert.deepEqual(resolveProjectLocation({ city }), { city, district: "", source: "unresolved" });
    assert.equal(listingLocationLabel({ city }), city);
  }
  assert.deepEqual(resolveProjectLocation({ city: "Potsdam-Stern", zip: "14542" }), {
    city: "Potsdam-Stern", district: "", source: "unresolved",
  });
  assert.deepEqual(resolveProjectLocation({ city: "Potsdam-Stern", zip: "14480", district: "Babelsberg" }), {
    city: "Potsdam-Stern", district: "Babelsberg", source: "conflict",
  });
});
