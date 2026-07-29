import assert from "node:assert/strict";
import test from "node:test";

import { APP_VERSION } from "../app/lib/app-version.mjs";
import {
  buildDeletePackage,
  buildImportPackage,
  buildOpenImmoDeleteXml,
  buildOpenImmoXml,
} from "../app/lib/openimmo.ts";

test("exports listings with the OpenImmo CHANGE upsert action", async () => {
  const input = {
    project: {
      id: "project-1",
      name: "Testprojekt",
      street: "Teststraße",
      houseNumber: "1",
      zip: "15732",
      city: "Schulzendorf",
      district: "",
      plotArea: 600,
      plotPrice: 100000,
      additionalCosts: 0,
      locationFacts: "",
      transportFacts: "",
      familyFacts: "",
      natureFacts: "",
      notes: "",
      selectedHouseIds: ["house-1"],
      listings: [],
      createdAt: "2026-07-22T00:00:00.000Z",
    },
    listings: [{
      id: "listing-1",
      externalId: "FPI-TEST-1",
      templateId: "house-1",
      templateName: "Testhaus",
      price: 500000,
      version: 1,
      texts: {
        title: "Neues Zuhause in Schulzendorf",
        description: "Objektbeschreibung",
        equipment: "Ausstattung",
        location: "Lage",
        other: "Sonstiges",
      },
    }],
    houses: [{
      id: "house-1",
      name: "Testhaus",
      houseType: "Einfamilienhaus",
      livingArea: 150,
      rooms: 5,
      bedrooms: 3,
      bathrooms: 2,
      floors: 2,
      housePrice: 400000,
      constructionYear: 2027,
      energyDemand: 18,
      energyClass: "A+",
      heatingType: "Wärmepumpe",
      energySource: "Strom",
      architecture: "",
      equipmentHighlights: "",
      useStandardPackage: true,
      images: [{
        id: "house-image-1",
        name: "haus.jpg",
        mimeType: "image/jpeg",
        dataUrl: "data:image/jpeg;base64,aGF1cw==",
        caption: "Eigenes Hausbild",
        isFloorplan: false,
      }],
    }],
    provider: {
      providerNumber: "30435",
      company: "Fabian Raebel - Freie Handelsvertretung der Living Fertighaus GmbH",
      firstName: "Fabian",
      lastName: "Raebel",
      email: "test@example.com",
      phone: "0000",
    },
    promotionImage: {
      id: "promotion-image-1",
      name: "aktion.jpg",
      mimeType: "image/jpeg",
      dataUrl: "data:image/jpeg;base64,YWt0aW9u",
      caption: "Aktuelles Angebot für dein neues Zuhause",
      isFloorplan: false,
    },
    promotionImageEnabled: true,
  };
  const xml = buildOpenImmoXml(input);

  assert.match(xml, new RegExp(`senderversion="${APP_VERSION.replaceAll(".", "\\.")}"`));
  assert.match(xml, /<openimmo_obid>FPI-TEST-1<\/openimmo_obid>/);
  assert.match(xml, /<aktion aktionart="CHANGE" \/>/);
  assert.match(xml, /<objektadresse_freigeben>false<\/objektadresse_freigeben>/);
  assert.match(xml, /<weitergabe_generell>false<\/weitergabe_generell>/);
  assert.match(xml, /<ausstatt_kategorie>GEHOBEN<\/ausstatt_kategorie>/);
  assert.match(xml, /<bad DUSCHE="true" WANNE="true" FENSTER="true" \/>/);
  assert.match(xml, /<kueche EBK="true" OFFEN="true" \/>/);
  assert.match(xml, /<heizungsart FUSSBODEN="true" \/>/);
  assert.match(xml, /<befeuerung ELEKTRO="true" LUFTWP="true" \/>/);
  assert.match(xml, /<energietyp KFW40="true" KFW55="true" \/>/);
  assert.match(xml, /<zustand zustand_art="PROJEKTIERT" \/>/);
  assert.match(xml, /<wertklasse>A\+<\/wertklasse>/);
  assert.match(xml, /<provisionspflichtig>false<\/provisionspflichtig>/);
  assert.match(xml, /<user_defined_simplefield feldname="Energieklasse"><!\[CDATA\[A\+\+\]\]><\/user_defined_simplefield>/);
  assert.ok(xml.indexOf("Aktuelles Angebot für dein neues Zuhause") < xml.indexOf("Eigenes Hausbild"));

  const publicationXml = buildOpenImmoXml({
    ...input,
    portalPublicationEnabled: true,
  });
  assert.match(publicationXml, /<weitergabe_generell>true<\/weitergabe_generell>/);
  assert.match(publicationXml, /<objektadresse_freigeben>false<\/objektadresse_freigeben>/);

  const assignedInput = {
    ...input,
    listings: [{
      ...input.listings[0],
      promotionImageId: "promotion-image-2",
    }],
    houses: [{
      ...input.houses[0],
      images: Array.from({ length: 14 }, (_, index) => ({
        ...input.houses[0].images[0],
        id: `house-image-${index + 1}`,
        name: `haus-${index + 1}.jpg`,
        caption: `Normales Hausbild ${index + 1}`,
      })),
    }],
    promotionImages: [{
      ...input.promotionImage,
      id: "promotion-image-2",
      caption: "Zufällig zugeordnetes Aktionsbild",
    }],
    promotionImage: null,
    promotionImageEnabled: false,
  };
  const assignedXml = buildOpenImmoXml(assignedInput);
  assert.equal((assignedXml.match(/<anhang location=/g) ?? []).length, 14);
  assert.ok(assignedXml.indexOf("Zufällig zugeordnetes Aktionsbild") < assignedXml.indexOf("Normales Hausbild 1"));
  assert.match(assignedXml, /Normales Hausbild 13/);
  assert.doesNotMatch(assignedXml, /Normales Hausbild 14/);

  const packageResult = await buildImportPackage(input);
  assert.match(packageResult.filename, /testprojekt-testhaus-fpi-test-1-\d{4}-\d{2}-\d{2}\.zip/);
});

test("preserves explicit per-listing projecting values during export", () => {
  const xml = buildOpenImmoXml({
    project: {
      street: "Teststraße",
      houseNumber: "1",
      zip: "15732",
      city: "Schulzendorf",
      district: "",
      plotArea: 600,
      name: "Bestehendes Projekt",
    },
    listings: [{
      id: "listing-explicit-projecting-values",
      externalId: "FPI-EXPLICIT-VALUES",
      templateId: "house-explicit-projecting-values",
      templateName: "Bestandshaus",
      price: 500000,
      version: 1,
      projectingSettings: {
        equipmentQuality: "LUXUS",
        constructionPhase: "ERSTBEZUG",
        underfloorHeating: false,
        airSourceHeatPump: false,
        kfw40: false,
        kfw55: false,
        energyClass: "B",
        commissionRequired: true,
        energyCertificateClass: "C",
      },
      texts: {
        title: "Vorhandener Titel",
        description: "Vorhandene Beschreibung",
        equipment: "Vorhandene Ausstattung",
        location: "Vorhandene Lage",
        other: "Vorhandenes Sonstiges",
      },
    }],
    houses: [{
      id: "house-explicit-projecting-values",
      name: "Bestandshaus",
      houseType: "Einfamilienhaus",
      livingArea: 150,
      rooms: 5,
      bedrooms: 3,
      bathrooms: 2,
      floors: 2,
      housePrice: 400000,
      constructionYear: 2027,
      energyDemand: 18,
      energyClass: "B",
      heatingType: "Radiatoren",
      energySource: "Gas",
      architecture: "",
      equipmentHighlights: "",
      useStandardPackage: true,
      images: [],
    }],
    provider: {
      providerNumber: "30435",
      company: "Testfirma",
      firstName: "Max",
      lastName: "Mustermann",
      email: "test@example.com",
      phone: "0000",
    },
  });

  assert.match(xml, /<ausstatt_kategorie>LUXUS<\/ausstatt_kategorie>/);
  assert.match(xml, /<heizungsart FUSSBODEN="false" \/>/);
  assert.match(xml, /<befeuerung ELEKTRO="true" LUFTWP="false" \/>/);
  assert.match(xml, /<energietyp KFW40="false" KFW55="false" \/>/);
  assert.match(xml, /<zustand zustand_art="ERSTBEZUG" \/>/);
  assert.match(xml, /<wertklasse>C<\/wertklasse>/);
  assert.match(xml, /<provisionspflichtig>true<\/provisionspflichtig>/);
  assert.match(xml, /<user_defined_simplefield feldname="Energieklasse"><!\[CDATA\[B\]\]><\/user_defined_simplefield>/);
});

test("exports direct apartment and land objects with their real OpenImmo categories", () => {
  const project = {
    id: "project-direct",
    name: "Direkte Objekte",
    street: "Testweg",
    houseNumber: "8",
    zip: "14552",
    city: "Michendorf",
    district: "",
    plotArea: 740,
    plotPrice: 0,
    additionalCosts: 0,
    locationFacts: "",
    transportFacts: "",
    familyFacts: "",
    natureFacts: "",
    notes: "",
    selectedHouseIds: ["direct-apartment", "direct-land"],
    listings: [],
    createdAt: "2026-07-29T00:00:00.000Z",
  };
  const template = {
    archived: true,
    name: "Freies Objekt",
    houseType: "Einfamilienhaus",
    livingArea: 90,
    rooms: 3,
    bedrooms: 2,
    bathrooms: 1,
    floors: 1,
    housePrice: 0,
    constructionYear: 2020,
    energyDemand: 70,
    energyClass: "B",
    heatingType: "",
    energySource: "",
    architecture: "",
    equipmentHighlights: "",
    useStandardPackage: false,
    images: [],
  };
  const management = (details) => ({
    lifecycle: "ready",
    released: true,
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
    details,
    media: [],
    appointments: [],
    portals: [],
  });
  const listings = [{
    id: "apartment",
    externalId: "30435-14001",
    templateId: "direct-apartment",
    templateName: "Wohnung Kauf",
    price: 330000,
    version: 1,
    texts: {
      title: "Eigentumswohnung",
      description: "",
      equipment: "",
      location: "",
      other: "",
    },
    management: management({
      objectCategory: "apartment-purchase",
      marketingType: "purchase",
      apartmentType: "Penthouse",
      purchasePrice: 330000,
      livingArea: 90,
      usableArea: 10,
      plotArea: 0,
      rooms: 3,
      bedrooms: 2,
      bathrooms: 1,
      floors: 4,
      floorNumber: 4,
      currency: "EUR",
      commissionRequired: false,
      energyCertificateType: "BEDARF",
      energyClass: "B",
      endEnergyDemand: 70,
      certificateYear: 2020,
      addressPublished: false,
    }),
  }, {
    id: "land",
    externalId: "30435-14002",
    templateId: "direct-land",
    templateName: "Grundstück",
    price: 12000,
    version: 1,
    texts: {
      title: "Grundstück zur Pacht",
      description: "",
      equipment: "",
      location: "",
      other: "",
    },
    management: management({
      objectCategory: "land",
      marketingType: "rent-lease",
      landUse: "WOHNEN",
      annualLeasePrice: 12000,
      purchasePrice: 0,
      plotArea: 740,
      divisibleFrom: 370,
      siteOccupancyRatio: 0.3,
      floorAreaRatio: 0.6,
      buildingLaw: "B_PLAN",
      developmentStatus: "VOLLERSCHLOSSEN",
      currency: "EUR",
      commissionRequired: false,
      addressPublished: false,
    }),
  }];
  const xml = buildOpenImmoXml({
    project,
    listings,
    houses: [
      { ...template, id: "direct-apartment" },
      { ...template, id: "direct-land" },
    ],
    provider: {
      providerNumber: "30435",
      company: "Testfirma",
      firstName: "Max",
      lastName: "Mustermann",
      email: "test@example.com",
      phone: "0000",
    },
  });

  assert.match(xml, /<wohnung wohnungtyp="PENTHOUSE" \/>/);
  assert.match(xml, /<grundstueck grundst_typ="WOHNEN" \/>/);
  assert.match(xml, /<vermarktungsart KAUF="false" MIETE_PACHT="true" ERBPACHT="false" LEASING="false" \/>/);
  assert.match(xml, /<pacht>12000<\/pacht>/);
  assert.match(xml, /<grz>0\.3<\/grz>/);
  assert.match(xml, /<gfz>0\.6<\/gfz>/);
  assert.match(xml, /<bebaubar_nach bebaubar_attr="B_PLAN" \/>/);
  assert.match(xml, /<erschliessung erschl_attr="VOLLERSCHLOSSEN" \/>/);
});

test("creates explicit OpenImmo DELETE packages without listing content", async () => {
  const provider = {
    providerNumber: "30435",
    company: "Testfirma",
    firstName: "Max",
    lastName: "Mustermann",
    email: "test@example.com",
    phone: "0000",
  };
  const xml = buildOpenImmoDeleteXml({
    externalIds: ["30435-13226", "30435-13227", "30435-13226"],
    provider,
    timestamp: "2026-07-29T12:00:00.000Z",
  });
  assert.equal((xml.match(/aktionart="DELETE"/g) ?? []).length, 2);
  assert.match(xml, /<objektkategorie>/);
  assert.match(xml, /<kontaktperson>/);
  assert.match(xml, /<stand_vom>2026-07-29<\/stand_vom>/);
  assert.match(xml, /<openimmo_obid>30435-13226<\/openimmo_obid>/);
  assert.doesNotMatch(xml, /<freitexte>/);

  const result = await buildDeletePackage({
    externalIds: ["30435-13226"],
    provider,
  });
  assert.match(result.filename, /^loeschauftrag-30435-13226-\d{4}-\d{2}-\d{2}\.zip$/);
  assert.match(result.xmlText, /aktionart="DELETE"/);
  assert.ok(result.blob.size > 0);
});
