import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildImportPackage } from "../app/lib/openimmo.ts";
import {
  assertCreativePayload,
  verifyCreativePayload,
} from "../listing-creative-payload-guard.mjs";

function fixture(heroType = "house") {
  const imageRoles = [
    "cover", "kitchen", "bathroom", "bedroom", "kids", "living", "office", "emotion",
    "floorplan_ground", "floorplan_upper", "awards", "trust", "qr",
  ];
  const house = {
    id: "house-creative-1",
    name: "SOL 107 V2",
    version: "V2",
    houseType: "Einfamilienhaus",
    livingArea: 107,
    rooms: 4,
    bedrooms: 3,
    bathrooms: 2,
    floors: 2,
    housePrice: 310000,
    constructionYear: 2027,
    energyDemand: 18,
    energyClass: "A+",
    heatingType: "Wärmepumpe",
    energySource: "Strom",
    architecture: "Offener Grundriss",
    equipmentHighlights: "Hochwertige Ausstattung",
    useStandardPackage: true,
    images: imageRoles.map((role, index) => ({
      id: `house-image-${index + 1}`,
      name: `house-image-${index + 1}.jpg`,
      caption: `Hausbild ${index + 1}`,
      mimeType: "image/jpeg",
      dataUrl: `data:image/jpeg;base64,${Buffer.from(`house-image-${index + 1}`).toString("base64")}`,
      isFloorplan: role.startsWith("floorplan"),
      role,
      eligibleForListingHero: index < 2,
    })),
  };
  const promotionImage = {
    id: "promotion-approved",
    name: "aktion.jpg",
    caption: "Aktionsmotiv",
    mimeType: "image/jpeg",
    dataUrl: `data:image/jpeg;base64,${Buffer.from("promotion-image").toString("base64")}`,
    isFloorplan: false,
    role: "promotion",
  };
  const heroAssetId = heroType === "action" ? promotionImage.id : house.images[1].id;
  const listing = {
    id: "rotation-copy-1",
    externalId: "30460-123456",
    templateId: house.id,
    templateName: house.name,
    price: 450000,
    version: 2,
    heroCreativeType: heroType,
    heroImageId: heroType === "house" ? heroAssetId : "",
    texts: {
      title: "Neues Zuhause",
      description: "Objektbeschreibung",
      equipment: "Ausstattung",
      location: "Lage",
      other: "Sonstiges",
    },
    creativeSelection: {
      format: 1,
      rotationId: "rotation-copy-1",
      plotId: "plot-1",
      sourceListingId: "source-1",
      houseId: house.id,
      houseName: house.name,
      heroType,
      heroImageId: heroAssetId,
      heroAssetId,
      promotionImageId: heroType === "action" ? promotionImage.id : "",
      selectedAt: "2026-08-21T08:00:00.000Z",
      houseReason: "Deterministische Hausrotation",
      heroReason: "Deterministische Hero-Rotation",
    },
  };
  const input = {
    project: {
      id: "project-1",
      plotId: "plot-1",
      name: "Testprojekt",
      street: "Teststraße",
      houseNumber: "1",
      zip: "14542",
      city: "Werder",
      district: "",
      plotArea: 600,
      plotPrice: 120000,
      additionalCosts: 20000,
      locationFacts: "Ruhige Lage",
      transportFacts: "Gute Anbindung",
      familyFacts: "Familienfreundlich",
      natureFacts: "Naturnah",
      selectedHouseIds: [house.id],
      listings: [listing],
      createdAt: "2026-08-01T08:00:00.000Z",
    },
    listings: [listing],
    houses: [house],
    provider: {
      providerNumber: "30435",
      company: "Test GmbH",
      firstName: "Test",
      lastName: "Person",
      email: "test@example.invalid",
      phone: "0000",
    },
    promotionImageEnabled: heroType === "action",
    promotionImagesByListingId: heroType === "action" ? { [listing.id]: promotionImage } : {},
    heroImageIdsByListingId: heroType === "house" ? { [listing.id]: heroAssetId } : {},
  };
  return { house, listing, promotionImage, input };
}

for (const heroType of ["house", "action"]) {
  test(`persisted ${heroType} Creative is the actual first image and house in the ZIP`, async () => {
    const value = fixture(heroType);
    const packageResult = await buildImportPackage(value.input);
    const archive = Buffer.from(await packageResult.blob.arrayBuffer());
    const result = await verifyCreativePayload({
      listing: value.listing,
      house: value.house,
      project: value.input.project,
      promotionImage: heroType === "action" ? value.promotionImage : null,
      packageResult,
      archive,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.diagnostics.actualHouseId, value.house.id);
    assert.equal(result.diagnostics.actualHeroType, heroType);
    assert.equal(result.diagnostics.actualHeroAssetId, value.listing.creativeSelection.heroAssetId);
    assert.match(result.diagnostics.payloadHeroSha256, /^[a-f0-9]{64}$/u);
  });
}

test("a payload house or hero mismatch fails closed before transfer", async () => {
  const value = fixture("action");
  const packageResult = await buildImportPackage(value.input);
  packageResult.creativePayloadManifest[0] = {
    ...packageResult.creativePayloadManifest[0],
    houseId: "house-overwritten",
    heroAssetId: "hero-overwritten",
  };
  const archive = Buffer.from(await packageResult.blob.arrayBuffer());
  await assert.rejects(
    assertCreativePayload({
      listing: value.listing,
      house: value.house,
      project: value.input.project,
      promotionImage: value.promotionImage,
      packageResult,
      archive,
    }),
    (error) => error.code === "CREATIVE_PAYLOAD_MISMATCH"
      && /überschrieben/iu.test(error.message),
  );
});

test("the production upload awaits the Creative guard before credentials and FTPS", async () => {
  const source = await readFile(new URL("../local-upload-server.mjs", import.meta.url), "utf8");
  const functionStart = source.indexOf("async function automaticRotationUpload");
  const functionEnd = source.indexOf("const listingRotationSchedulerService", functionStart);
  const productionUpload = source.slice(functionStart, functionEnd);
  const guardIndex = productionUpload.indexOf("await assertCreativePayload");
  const credentialIndex = productionUpload.indexOf("await credentialVault");
  const clientIndex = productionUpload.indexOf("new Client");
  const transferIndex = productionUpload.indexOf("uploadFrom");
  assert.ok(guardIndex > 0);
  assert.ok(credentialIndex > guardIndex);
  assert.ok(clientIndex > credentialIndex);
  assert.ok(transferIndex > clientIndex);
});
