import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildOpenImmoXml } from "../app/lib/openimmo.ts";
import {
  FIXED_ANNOTATION_TEXT,
  FIXED_PROVISION_TEXT,
  FIXED_RECOMMENDATION_TEXT,
  FIXED_TERMS_TEXT,
  initializeListingStaticCopy,
} from "../listing-copy.mjs";

const FACTS = Object.freeze([
  { key: "energy_demand", value: "18", source: "project", scope: "house", status: "verified", verified: true, evidenceKind: "energy_certificate", evidenceReference: "Freigabe 2026-09-27" },
  { key: "energy_class", value: "A+", source: "project", scope: "house", status: "verified", verified: true, evidenceKind: "energy_certificate", evidenceReference: "Freigabe 2026-09-27" },
]);

function input() {
  const listing = initializeListingStaticCopy({
    id: "golden-listing",
    externalId: "30460-901",
    templateId: "golden-house",
    templateName: "Golden House",
    price: 500000,
    version: 1,
    listingFacts: structuredClone(FACTS),
    texts: { title: "Familienhaus", description: "Sachliche Beschreibung.", equipment: "Ausstattung.", location: "Lage.", other: "Hinweise." },
  });
  return {
    project: { id: "golden-project", name: "Golden", street: "Teststraße", houseNumber: "1", zip: "15732", city: "Schulzendorf", district: "", plotArea: 600, plotPrice: 0, additionalCosts: 0, locationFacts: "", transportFacts: "", familyFacts: "", natureFacts: "", selectedHouseIds: ["golden-house"], listings: [listing], createdAt: "2026-09-27T00:00:00.000Z" },
    listings: [listing],
    houses: [{
      id: "golden-house", name: "Golden House", houseType: "Einfamilienhaus", livingArea: 150, rooms: 5, bedrooms: 3, bathrooms: 2, floors: 2,
      housePrice: 400000, constructionYear: 2027, energyDemand: 18, energyClass: "A++", heatingType: "", energySource: "", architecture: "", equipmentHighlights: "", useStandardPackage: true,
      images: Array.from({ length: 4 }, (_, index) => ({ id: `golden-image-${index}`, name: `golden-${index}.jpg`, mimeType: "image/jpeg", dataUrl: "data:image/jpeg;base64,/9j/2Q==", caption: `Bild ${index}`, isFloorplan: false })),
    }],
    provider: { providerNumber: "30435", company: "Testanbieter", firstName: "Max", lastName: "Mustermann", email: "test@example.com", phone: "0000" },
  };
}

test("golden OpenImmo output keeps identity, verified energy facts, and provision mapping together", () => {
  const scenario = input();
  const beforeFacts = structuredClone(scenario.listings[0].listingFacts);
  const xml = buildOpenImmoXml(scenario);

  assert.equal(xml.match(/<objektnr_extern>30460-901<\/objektnr_extern>/gu)?.length, 1);
  assert.equal(xml.match(/<openimmo_obid>30460-901<\/openimmo_obid>/gu)?.length, 1);
  assert.equal(xml.match(/<kennung_ursprung>30460-901<\/kennung_ursprung>/gu)?.length, 1);
  assert.doesNotMatch(xml, /FPI-/u);
  assert.match(xml, /<energiepass>[\s\S]*<epart>BEDARF<\/epart>[\s\S]*<endenergiebedarf>18<\/endenergiebedarf>[\s\S]*<wertklasse>A\+<\/wertklasse>[\s\S]*<\/energiepass>/u);
  assert.ok(xml.includes(`<courtage_hinweis><![CDATA[${FIXED_PROVISION_TEXT}]]></courtage_hinweis>`));
  assert.ok(xml.includes(`feldname="anklickbar"><![CDATA[${FIXED_PROVISION_TEXT}]]>`));
  assert.ok(xml.includes(`feldname="allgemein2"><![CDATA[${FIXED_RECOMMENDATION_TEXT}]]>`));
  assert.ok(xml.includes(FIXED_ANNOTATION_TEXT));
  assert.ok(xml.includes(FIXED_TERMS_TEXT));
  assert.doesNotMatch(xml, /5,8\s*%|AUF WUNSCH empfehlen/u);
  assert.deepEqual(scenario.listings[0].listingFacts, beforeFacts);
});

test("golden UI and regeneration contracts retain reset access and listing evidence", async () => {
  const [plotUi, studio] = await Promise.all([
    readFile(new URL("../app/components/PlotManagement.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/InseratStudio.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(plotUi, />Inserate zurücksetzen<\/button>/u);
  assert.match(plotUi, /Es wird kein Portal, FTP-Transfer, Scheduler oder Excel-Abgleich gestartet\./u);
  assert.match(studio, /listingFacts: previous\?\.listingFacts/u);
  assert.match(studio, /const nextListing:[\s\S]*?\.\.\.previous,[\s\S]*?externalId: existingOrAllocatedExternalId/u);
});
