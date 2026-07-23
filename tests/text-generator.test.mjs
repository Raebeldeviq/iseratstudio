import assert from "node:assert/strict";
import test from "node:test";

import { buildListingHeadline } from "../listing-copy.mjs";
import { completeListingTexts } from "../app/lib/text-generator.ts";

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
  notes: "",
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

test("keeps the step-two headline when a stale helper returns another title", () => {
  const result = completeListingTexts(house, project, provider, {
    title: "Klare Räume für morgen",
    description: "Ein individuell erzeugter Hausbeschreibungstext.",
    location: "Mahlsdorf bietet einen passenden Rahmen für das neue Zuhause.",
  }, 2);

  assert.equal(result.title, buildListingHeadline(house, project));
  assert.notEqual(result.title, "Klare Räume für morgen");
  assert.match(result.description, /^Ein individuell erzeugter Hausbeschreibungstext\./);
  assert.equal(result.location, "Mahlsdorf bietet einen passenden Rahmen für das neue Zuhause.");
});
