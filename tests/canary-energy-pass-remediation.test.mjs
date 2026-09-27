import assert from "node:assert/strict";
import test from "node:test";

import { buildOpenImmoXml } from "../app/lib/openimmo.ts";
import { applyCanaryEnergyPassRemediation } from "../canary-energy-pass-remediation.mjs";
import { cleanupStudioState } from "../data-integrity.mjs";
import {
  FIXED_ANNOTATION_TEXT,
  FIXED_PROVISION_TEXT,
  FIXED_RECOMMENDATION_TEXT,
  FIXED_TERMS_TEXT,
  initializeListingStaticCopy,
} from "../listing-copy.mjs";

function fixture() {
  const target = initializeListingStaticCopy({
    id: "a4810212-95d1-4850-99e6-1ce92056da43",
    externalId: "FPI-E0B464-V1-A4810212",
    templateId: "preset_house_sun113_v6",
    templateName: "SUN 113 V6",
    price: 500000,
    version: 2,
    status: "published",
    projectingSettings: { energyCertificateClass: "" },
    texts: { title: "Canary", description: "Objekt", equipment: "Ausstattung", location: "Lage", other: "Hinweise" },
  });
  const peer = {
    id: "peer-listing",
    externalId: "30460-53",
    templateId: "preset_house_sun113_v6",
    templateName: "SUN 113 V6",
    status: "published",
    projectingSettings: { energyCertificateClass: "A+" },
  };
  const project = {
    id: "project-1", name: "Canary-Projekt", street: "Teststraße", houseNumber: "1", zip: "15732", city: "Schulzendorf", district: "",
    plotArea: 600, plotPrice: 0, additionalCosts: 0, selectedHouseIds: ["preset_house_sun113_v6"], listings: [target, peer], createdAt: "2026-09-27T00:00:00.000Z",
  };
  const house = {
    id: "preset_house_sun113_v6", name: "SUN 113 V6", houseType: "Einfamilienhaus", livingArea: 113, rooms: 4, bedrooms: 3, bathrooms: 1, floors: 2,
    housePrice: 400000, constructionYear: 2027, energyDemand: 18, energyClass: "A++", heatingType: "", energySource: "", architecture: "", equipmentHighlights: "", useStandardPackage: true,
    images: Array.from({ length: 4 }, (_, index) => ({ id: `image-${index}`, name: `bild-${index}.jpg`, mimeType: "image/jpeg", dataUrl: "data:image/jpeg;base64,/9j/2Q==", caption: `Bild ${index}`, isFloorplan: false })),
  };
  return { version: 1, dataSchemaVersion: 5, houses: [house], projects: [project], provider: { providerNumber: "30435", company: "Test", firstName: "Max", lastName: "Mustermann", email: "test@example.com", phone: "0000" } };
}

test("restores the confirmed Canary energy pass through existing verified listing facts", () => {
  const input = fixture();
  const result = applyCanaryEnergyPassRemediation(input);
  assert.equal(result.changed, true);
  assert.equal(result.state.projects[0].listings[0].listingFacts.length, 2);

  const normalized = cleanupStudioState(result.state, { apply: true, now: "2026-09-27T12:00:00.000Z" }).state;
  const target = normalized.projects[0].listings.find((listing) => listing.externalId === "FPI-E0B464-V1-A4810212");
  assert.throws(
    () => buildOpenImmoXml({
      project: normalized.projects[0],
      listings: [target],
      houses: normalized.houses,
      provider: normalized.provider,
    }),
    /30460-N/u,
  );
  const transferableTarget = { ...target, externalId: "30460-70" };
  const xml = buildOpenImmoXml({
    project: normalized.projects[0],
    listings: [transferableTarget],
    houses: normalized.houses,
    provider: normalized.provider,
  });
  assert.match(xml, /<energiepass>[\s\S]*<epart>BEDARF<\/epart>[\s\S]*<endenergiebedarf>18<\/endenergiebedarf>[\s\S]*<wertklasse>A\+<\/wertklasse>[\s\S]*<baujahr>2027<\/baujahr>[\s\S]*<\/energiepass>/u);
  assert.ok(xml.includes(`feldname="anklickbar"><![CDATA[${FIXED_PROVISION_TEXT}]]>`));
  assert.ok(xml.includes(`feldname="allgemein2"><![CDATA[${FIXED_RECOMMENDATION_TEXT}]]>`));
  assert.ok(xml.includes(FIXED_ANNOTATION_TEXT));
  assert.ok(xml.includes(FIXED_TERMS_TEXT));
  assert.doesNotMatch(xml, /AUF WUNSCH empfehlen|5,8\s*%/u);

  const rerun = applyCanaryEnergyPassRemediation(result.state);
  assert.equal(rerun.changed, false);
  assert.equal(rerun.idempotent, true);
});

test("fails closed for a changed Canary identity, energy value, peer class, or conflicting fact", () => {
  const scenarios = [
    (state) => { state.projects[0].listings[0].id = "changed"; },
    (state) => { state.houses[0].energyDemand = 19; },
    (state) => { state.projects[0].listings[1].projectingSettings.energyCertificateClass = "A"; },
    (state) => { state.projects[0].listings[0].listingFacts = [{ key: "energy_class", value: "A", status: "verified", verified: true, evidenceKind: "energy_certificate" }]; },
  ];
  for (const mutate of scenarios) {
    const state = fixture();
    mutate(state);
    assert.throws(() => applyCanaryEnergyPassRemediation(state), /CANARY_ENERGY_/u);
  }
});
