import assert from "node:assert/strict";
import test from "node:test";

import {
  LIVING_HAUS_IKON_TECHNICAL_PACKAGE_ID,
  LIVING_HAUS_SERIES_ID,
  validateListingClaims,
} from "../listing-claim-policy.mjs";
import {
  FIXED_DESCRIPTION_CTA,
  initializeListingStaticCopy,
  STATIC_COPY_SOURCE,
} from "../listing-copy.mjs";
import { scanPhase2BClaims } from "../phase2b-claim-scan.mjs";
import { completeListingTexts, generateListingTexts } from "../app/lib/text-generator.ts";

const wordCount = (value) => String(value ?? "").match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu)?.length || 0;

const house = {
  id: "sun-136-v4",
  name: "SUN 136 V4",
  houseType: "Einfamilienhaus",
  livingArea: 135.21,
  rooms: 4,
  bedrooms: 3,
  bathrooms: 2,
  floors: 2,
  housePrice: 380360,
  constructionYear: 2027,
  energyDemand: 18,
  energyClass: "A++",
  heatingType: "Fußbodenheizung mit Luft-Wasser-Wärmepumpe",
  energySource: "Umweltwärme und Strom",
  architecture: "Offener Wohnbereich mit privaten Rückzugsräumen",
  equipmentHighlights: "Photovoltaik und Batteriespeicher",
  useStandardPackage: true,
  images: [],
};

const project = {
  id: "mahlstorf",
  owner: "pascal",
  name: "Mahlsdorf",
  street: "Beispielweg",
  houseNumber: "1",
  zip: "12621",
  city: "Berlin",
  district: "Mahlsdorf",
  plotArea: 514,
  plotPrice: 226720,
  additionalCosts: 0,
  locationFacts: "",
  transportFacts: "",
  familyFacts: "",
  natureFacts: "",
  selectedHouseIds: [house.id],
  listings: [],
  createdAt: "2026-07-23T00:00:00.000Z",
};

const provider = {
  providerNumber: "",
  company: "Living Haus",
  firstName: "Pascal",
  lastName: "Fröhlich",
  email: "",
  phone: "",
};

test("keeps an existing title when an explicit dynamic generation refreshes description and location", () => {
  const result = completeListingTexts(house, project, provider, {
    title: "Klare Räume für morgen",
    description: "Ein individuell erzeugter Hausbeschreibungstext.",
    location: "Mahlsdorf bietet einen passenden Rahmen für das neue Zuhause.",
  }, 2);

  assert.equal(result.title, "Klare Räume für morgen");
  assert.match(result.description, /^Ein individuell erzeugter Hausbeschreibungstext\./);
  assert.doesNotMatch(result.description, /QNG/u);
  assert.equal(result.location, "Mahlsdorf bietet einen passenden Rahmen für das neue Zuhause.");
});

test("does not silently refill an explicitly emptied static field during dynamic regeneration", () => {
  const result = completeListingTexts(house, project, provider, {
    title: "Manueller Titel",
    description: "Sachliche Objektbeschreibung.",
    equipment: "",
    location: "Sachliche Lage.",
    other: "",
  });
  assert.equal(result.equipment, "");
  assert.equal(result.other, "");
  assert.equal(result.title, "Manueller Titel");
});

test("creates five compliant, price-free object descriptions with the new editorial focus", () => {
  const samples = [
    { id: "sun-96", name: "SUN 96 V1 Tag", livingArea: 96, rooms: 3, bedrooms: 2, bathrooms: 1, floors: 2, city: "Berlin", district: "Pankow", plotArea: 286 },
    { id: "sun-118", name: "SUN 118 V2 Nacht", livingArea: 118, rooms: 4, bedrooms: 3, bathrooms: 2, floors: 2, city: "Potsdam", district: "Bornstedt", plotArea: 412 },
    { id: "sun-136", name: "SUN 136 V4 Tag", livingArea: 136, rooms: 5, bedrooms: 3, bathrooms: 2, floors: 2, city: "Oranienburg", district: "Lehnitz", plotArea: 538, technicalPackage: LIVING_HAUS_IKON_TECHNICAL_PACKAGE_ID },
    { id: "sun-148", name: "SUN 148 V3 Nacht", livingArea: 148, rooms: 5, bedrooms: 4, bathrooms: 2, floors: 2, city: "Falkensee", district: "Finkenkrug", plotArea: 610 },
    { id: "sun-166", name: "SUN 166 V5 Tag", livingArea: 166, rooms: 6, bedrooms: 4, bathrooms: 2, floors: 2, city: "Bernau", district: "Lobetal", plotArea: 702 },
  ].map((sample) => {
    const sampleHouse = {
      ...house,
      id: sample.id,
      name: sample.name,
      livingArea: sample.livingArea,
      rooms: sample.rooms,
      bedrooms: sample.bedrooms,
      bathrooms: sample.bathrooms,
      floors: sample.floors,
      technicalPackage: sample.technicalPackage,
      seriesId: LIVING_HAUS_SERIES_ID,
    };
    const sampleProject = {
      ...project,
      id: `project-${sample.id}`,
      city: sample.city,
      district: sample.district,
      plotArea: sample.plotArea,
      selectedHouseIds: [sample.id],
    };
    return { sample, house: sampleHouse, project: sampleProject, texts: generateListingTexts(sampleHouse, sampleProject, provider) };
  });

  for (const entry of samples) {
    const descriptionBody = entry.texts.description.replace(FIXED_DESCRIPTION_CTA, "").trim();
    assert.ok(wordCount(entry.texts.description) >= 220, entry.sample.id);
    assert.ok(wordCount(entry.texts.description) <= 300, entry.sample.id);
    assert.match(entry.texts.description, /^.{40,}/u, entry.sample.id);
    assert.match(entry.texts.description, /\+49 160 930 87 202/u, entry.sample.id);
    assert.match(entry.texts.description, /calendly\.com\/pascal-froehlich-livinghaus\/erstinfo-via-telefon/u, entry.sample.id);
    assert.match(descriptionBody, new RegExp(`SUN ${entry.sample.livingArea}`, "u"), entry.sample.id);
    assert.doesNotMatch(descriptionBody, /€|\b(?:Euro|Kaufpreis|Hauspreis|Grundstückspreis|Gesamtpreis|Angebotspreis)\b/iu, entry.sample.id);
    assert.doesNotMatch(descriptionBody, /\bV\d+\b|\bV\d+\s+(?:Tag|Nacht)\b|\b(?:Tag|Nacht)\s+V\d+\b/iu, entry.sample.id);
    assert.doesNotMatch(descriptionBody, /\b(?:DGNB|QNG|QDF)\b/iu, entry.sample.id);
    assert.doesNotMatch(descriptionBody, /\bFinanzierung\b/iu, entry.sample.id);
    assert.match(descriptionBody, /Grundriss|Wohnfläche|Zimmer/u, entry.sample.id);
    assert.equal(validateListingClaims({
      texts: { description: entry.texts.description, location: entry.texts.location },
      house: entry.house,
      project: entry.project,
      listingFacts: entry.house.listingFacts,
      houseSeries: LIVING_HAUS_SERIES_ID,
    }).ok, true, entry.sample.id);

    if (entry.sample.technicalPackage) {
      assert.match(descriptionBody, /Komfortlüftung mit Wärmerückgewinnung/u, entry.sample.id);
      assert.doesNotMatch(descriptionBody, /\b(?:Energie|Kosten|Klima|Umwelt)\b/iu, entry.sample.id);
    } else {
      assert.doesNotMatch(descriptionBody, /Komfortlüftung|Wärmerückgewinnung/u, entry.sample.id);
    }
  }

  const report = scanPhase2BClaims({
    houses: samples.map((entry) => entry.house),
    projects: samples.map((entry) => ({
      ...entry.project,
      listings: [(() => {
        const listing = initializeListingStaticCopy({
          id: `listing-${entry.sample.id}`,
          externalId: `test-${entry.sample.id}`,
          templateId: entry.house.id,
          templateName: entry.house.name,
          status: "published",
          texts: {
            ...entry.texts,
            equipment: "Sachliche Ausstattung.",
            other: "Sachliche Hinweise.",
          },
        });
        return {
          ...listing,
          staticCopySources: {
            ...listing.staticCopySources,
            equipment: STATIC_COPY_SOURCE.MANUAL,
            other: STATIC_COPY_SOURCE.MANUAL,
          },
        };
      })()],
    })),
  }, { now: "2026-09-26T12:00:00.000Z" });
  assert.equal(report.scannedListingCount, 5);
  assert.equal(report.severityCounts.BLOCK, 0);
  assert.equal(report.severityCounts.REVIEW, 0);
});
