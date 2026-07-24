import assert from "node:assert/strict";
import test from "node:test";

import {
  enforceListingCopy,
  fixedDescriptionCta,
  fixedEquipmentText,
  fixedOtherText,
} from "../listing-copy.mjs";

const provider = {
  firstName: "Fabian",
  lastName: "Raebel",
  phone: "+49 123 456789",
};

test("keeps the generated headline and adapts fixed texts to the Windows provider", () => {
  const texts = enforceListingCopy({
    title: "Mietvertrag kann einpacken",
    description: "Ein eigenständiger Objekttext mit mehreren guten Absätzen.",
    equipment: "Wird ersetzt",
    location: "Ein neutraler Text über den Ort.",
    other: "Wird ersetzt",
  }, { provider });

  assert.equal(texts.title, "Mietvertrag kann einpacken");
  assert.equal(texts.location, "Ein neutraler Text über den Ort.");
  assert.match(texts.description, /\+49 123 456789/);
  assert.match(texts.equipment, /Fabian Raebel/);
  assert.match(texts.other, /\+49 123 456789/);
  assert.doesNotMatch(texts.equipment, /Pascal Fröhlich/);
});

test("does not duplicate the fixed description call to action", () => {
  const cta = fixedDescriptionCta(provider);
  const first = enforceListingCopy({
    title: "Heute schon an morgen wohnen",
    description: `Individueller Haupttext.\n\n${cta}`,
    location: "Lagebeschreibung.",
  }, { provider });
  const second = enforceListingCopy(first, { provider });

  assert.equal(second.description, first.description);
});

test("fixed equipment and other texts contain no macOS-specific identity", () => {
  assert.doesNotMatch(fixedEquipmentText(provider), /\/Users\/|iCloud|Pascal Fröhlich/);
  assert.doesNotMatch(fixedOtherText(provider), /\/Users\/|iCloud|Pascal Fröhlich/);
});
