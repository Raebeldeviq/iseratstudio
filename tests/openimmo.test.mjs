import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";

import { buildImportPackage, buildOpenImmoXml, OPENIMMO_STRUCTURED_FIELDS, validateImportPackage } from "../app/lib/openimmo.ts";
import { APP_VERSION } from "../app/lib/app-version.mjs";
import {
  FIXED_ANNOTATION_TEXT,
  FACTUAL_BUILDABILITY_NOTE,
  FIXED_PROVISION_TEXT,
  FIXED_RECOMMENDATION_TEXT,
  FIXED_TERMS_TEXT,
} from "../listing-copy.mjs";
import { QNG_GUARANTEE_SENTENCE } from "../listing-claim-policy.mjs";

function energyScenarioInput({ energyDemand = 18, listingFacts = [] } = {}) {
  return {
    project: {
      id: "energy-project", name: "Energie-Test", street: "Teststraße", houseNumber: "1", zip: "15732", city: "Schulzendorf", district: "",
      plotArea: 600, plotPrice: 0, additionalCosts: 0, locationFacts: "", transportFacts: "", familyFacts: "", natureFacts: "", selectedHouseIds: ["energy-house"], listings: [], createdAt: "2026-09-23T00:00:00.000Z",
    },
    listings: [{
      id: "energy-listing", externalId: "30460-199", templateId: "energy-house", templateName: "Energie-Testhaus", price: 500000, version: 1, listingFacts,
      texts: { title: "Energie-Testhaus", description: "Sachliche Objektbeschreibung.", equipment: "Sachliche Ausstattung.", location: "Sachliche Lage.", other: "Sachliche Hinweise." },
    }],
    houses: [{
      id: "energy-house", name: "Energie-Testhaus", houseType: "Einfamilienhaus", livingArea: 150, rooms: 5, bedrooms: 3, bathrooms: 2, floors: 2,
      housePrice: 400000, constructionYear: 2027, energyDemand, energyClass: "A++", heatingType: "", energySource: "", architecture: "", equipmentHighlights: "", useStandardPackage: true,
      images: Array.from({ length: 4 }, (_, index) => ({
        id: `energy-image-${index + 1}`, name: `energie-${index + 1}.jpg`, mimeType: "image/jpeg", dataUrl: "data:image/jpeg;base64,/9j/2Q==", caption: `Energie Bild ${index + 1}`, isFloorplan: false,
      })),
    }],
    provider: { providerNumber: "30435", company: "Testanbieter", firstName: "Max", lastName: "Mustermann", email: "test@example.com", phone: "0000" },
  };
}

test("historical listing exports its captured pool address after the project changes", () => {
  const input = energyScenarioInput();
  input.listings[0].addressSnapshot = {
    plotId: "GS-001", pool: "A", cycle: 1, housePosition: 1,
    address: { street: "Alte Straße", houseNumber: "12", postalCode: "15732", city: "Schulzendorf" },
    batchId: "delete-batch:1:1", plannedDeletionDate: "2026-10-01",
  };
  input.project.street = "Neue Straße";
  input.project.houseNumber = "14";
  const xml = buildOpenImmoXml(input);
  assert.match(xml, /<strasse>Alte Straße<\/strasse>[\s\S]*<hausnummer>12<\/hausnummer>/u);
  assert.doesNotMatch(xml, /<strasse>Neue Straße<\/strasse>/u);
});

test("exports planned energy values as planning data and a verified certificate through the final ZIP", async () => {
  const projectedXml = buildOpenImmoXml(energyScenarioInput());
  assert.doesNotMatch(projectedXml, /<energiepass>/);
  assert.match(projectedXml, /feldname="Projektierter Endenergiebedarf"><!\[CDATA\[18 kWh\/\(m²·a\) – Planungswert, kein individueller Energieausweis\]\]><\/user_defined_simplefield>/u);
  assert.match(projectedXml, /feldname="Projektierte Energieeffizienzklasse"><!\[CDATA\[A\+\+ – Planungswert, kein individueller Energieausweis\]\]><\/user_defined_simplefield>/u);

  const certificateFacts = [
    { key: "energy_demand", value: "18", source: "project", scope: "house", status: "verified", verified: true, evidenceKind: "energy_certificate", evidenceReference: "Energieausweis EA-2026-17" },
    { key: "energy_class", value: "A+", source: "project", scope: "house", status: "verified", verified: true, evidenceKind: "energy_certificate", evidenceReference: "Energieausweis EA-2026-17" },
  ];
  const certificateXml = buildOpenImmoXml(energyScenarioInput({ listingFacts: certificateFacts }));
  assert.match(certificateXml, /<energiepass>[\s\S]*<epart>BEDARF<\/epart>[\s\S]*<endenergiebedarf>18<\/endenergiebedarf>[\s\S]*<wertklasse>A\+<\/wertklasse>[\s\S]*<\/energiepass>/u);
  const packageResult = await buildImportPackage(energyScenarioInput({ listingFacts: certificateFacts }));
  const archive = await JSZip.loadAsync(await packageResult.blob.arrayBuffer());
  const packagedXml = await archive.file(packageResult.xmlFilename)?.async("string");
  assert.equal(packagedXml, packageResult.xmlText);
  assert.match(packagedXml, /<zustand_angaben>[\s\S]*<energiepass>[\s\S]*<epart>BEDARF<\/epart>[\s\S]*<endenergiebedarf>18<\/endenergiebedarf>[\s\S]*<wertklasse>A\+<\/wertklasse>[\s\S]*<\/energiepass>[\s\S]*<\/zustand_angaben>/u);
  assert.match(packagedXml, /<verkaufstatus stand="OFFEN" \/>/u);
  assert.doesNotMatch(packagedXml, /<verkaufstatus stand="NEU"/u);
  assert.doesNotMatch(packagedXml, /<user_defined_simplefield feldname="status"/u);
  assert.match(certificateXml, /feldname="Energieklasse gemäß Energieausweis"><!\[CDATA\[A\+\]\]><\/user_defined_simplefield>/u);
  assert.doesNotMatch(certificateXml, /Projektierter Endenergiebedarf/);

  const unknownXml = buildOpenImmoXml(energyScenarioInput({ energyDemand: 0 }));
  assert.doesNotMatch(unknownXml, /<energiepass>|Projektierter Endenergiebedarf/);
  assert.match(unknownXml, /Projektierte Energieeffizienzklasse/);
});

test("exports verified districts in geo without breaking official town names", async () => {
  const cases = [
    ["Potsdam- Stern", "14480", "Potsdam", "Stern"],
    ["Potsdam- Bornstedt", "14469", "Potsdam", "Bornstedt"],
    ["Potsdam- Drewitz", "14480", "Potsdam", "Drewitz"],
    ["Berlin-Rudow", "12355", "Berlin", "Rudow"],
    ["Berlin-Zehlendorf", "14165", "Berlin", "Zehlendorf"],
    ["Kloster Lehnin-Damsdorf", "14797", "Kloster Lehnin", "Damsdorf"],
    ["Dallgow-Döberitz", "14624", "Dallgow-Döberitz", ""],
    ["Werder (Havel)", "14542", "Werder (Havel)", ""],
  ];
  for (const [rawCity, zip, city, district] of cases) {
    const input = energyScenarioInput();
    input.project.city = rawCity;
    input.project.zip = zip;
    const packageResult = await buildImportPackage(input);
    const archive = await JSZip.loadAsync(await packageResult.blob.arrayBuffer());
    const packagedXml = await archive.file(packageResult.xmlFilename)?.async("string");
    const geo = packagedXml?.match(/<geo>[\s\S]*?<\/geo>/u)?.[0] || "";
    assert.match(geo, new RegExp(`<ort>${city.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}<\\/ort>`, "u"));
    if (district) assert.match(geo, new RegExp(`<regionaler_zusatz>${district}<\\/regionaler_zusatz>`, "u"));
    else assert.doesNotMatch(geo, /<regionaler_zusatz>/u);
  }
  const structured = energyScenarioInput();
  structured.project.city = "Potsdam Groß Glienicke";
  structured.project.zip = "14476";
  structured.project.district = "Groß Glienicke";
  assert.match(buildOpenImmoXml(structured), /<ort>Potsdam<\/ort>[\s\S]*<regionaler_zusatz>Groß Glienicke<\/regionaler_zusatz>/u);
  structured.project.city = "Werder";
  structured.project.zip = "14542";
  structured.project.district = "Glindow";
  assert.match(buildOpenImmoXml(structured), /<ort>Werder \(Havel\)<\/ort>[\s\S]*<regionaler_zusatz>Glindow<\/regionaler_zusatz>/u);
});

test("exports a QNG guarantee only as status-accurate free text, never as an individual certificate field", () => {
  const input = energyScenarioInput();
  input.listings[0].texts.description = QNG_GUARANTEE_SENTENCE;
  const xml = buildOpenImmoXml(input);
  assert.match(xml, new RegExp(`<objektbeschreibung><!\\[CDATA\\[${QNG_GUARANTEE_SENTENCE}\\]\\]><\\/objektbeschreibung>`, "u"));
  assert.doesNotMatch(xml, /feldname="[^"]*QNG[^"]*"/u);
  assert.doesNotMatch(xml, /QNG[-\s]?zertifiziert|QNG[-\s]?Zertifikat/iu);
});

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
      selectedHouseIds: ["house-1"],
      listings: [],
      createdAt: "2026-07-22T00:00:00.000Z",
    },
    listings: [{
      id: "listing-1",
      externalId: "30460-101",
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
      images: Array.from({ length: 4 }, (_, index) => ({
        id: `image-${index + 1}`,
        name: `bild-${index + 1}.jpg`,
        mimeType: "image/jpeg",
        dataUrl: "data:image/jpeg;base64,/9j/2Q==",
        caption: `Bild ${index + 1}`,
        isFloorplan: false,
      })),
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

  assert.ok(xml.includes(`senderversion="${APP_VERSION}"`));
  assert.match(xml, /<openimmo_anid>30435<\/openimmo_anid>/u);
  assert.match(xml, /<openimmo_obid>30460-101<\/openimmo_obid>/);
  assert.match(xml, /<objektnr_extern>30460-101<\/objektnr_extern>/);
  assert.match(xml, /<kennung_ursprung>30460-101<\/kennung_ursprung>/);
  assert.match(xml, /<aktion aktionart="CHANGE" \/>/);
  assert.match(xml, /<bad DUSCHE="true" WANNE="true" FENSTER="true" \/>/);
  assert.match(xml, /<kueche EBK="true" OFFEN="true" \/>/);
  assert.match(xml, /<user_defined_simplefield feldname="Umgebung"><!\[CDATA\[Bus, Einkaufsmöglichkeit\]\]><\/user_defined_simplefield>/);
  assert.match(xml, /<ausstatt_kategorie>GEHOBEN<\/ausstatt_kategorie>/);
  assert.doesNotMatch(xml, /<heizungsart\b/u);
  assert.match(xml, /<befeuerung ELEKTRO="false" LUFTWP="true" \/>/);
  assert.match(xml, /<gartennutzung>true<\/gartennutzung>/);
  assert.match(xml, /<barrierefrei>false<\/barrierefrei>/);
  assert.match(xml, /<energietyp KFW40="true" KFW55="false" \/>/);
  assert.match(xml, /<dachboden>true<\/dachboden>/);
  assert.match(xml, /<gaestewc>true<\/gaestewc>/);
  assert.match(xml, /<zustand zustand_art="PROJEKTIERT" \/>/);
  assert.match(xml, /<verkaufstatus stand="OFFEN" \/>/u);
  assert.doesNotMatch(xml, /<user_defined_simplefield feldname="status"/u);
  assert.deepEqual(OPENIMMO_STRUCTURED_FIELDS.objectStatus, {
    elementName: "verkaufstatus",
    attributeName: "stand",
    openValue: "OFFEN",
  });
  assert.match(xml, /<user_defined_simplefield feldname="data104"><!\[CDATA\[HausInPlanung\]\]><\/user_defined_simplefield>/u);
  assert.match(xml, /<baujahr>2027<\/baujahr>/);
  assert.match(xml, /<verfuegbar_ab>2027<\/verfuegbar_ab>/);
  assert.doesNotMatch(xml, /<energiepass>|<wertklasse>/);
  assert.match(xml, /<provisionspflichtig>false<\/provisionspflichtig>/);
  assert.match(xml, /<anzahl_etagen>2<\/anzahl_etagen>/);
  const geoXml = xml.match(/<geo>[\s\S]*?<\/geo>/u)?.[0] || "";
  const areasXml = xml.match(/<flaechen>[\s\S]*?<\/flaechen>/u)?.[0] || "";
  assert.match(geoXml, /<anzahl_etagen>2<\/anzahl_etagen>/u);
  assert.doesNotMatch(areasXml, /<anzahl_etagen>/u);
  assert.ok(xml.includes(`<courtage_hinweis><![CDATA[${FIXED_PROVISION_TEXT}]]></courtage_hinweis>`));
  assert.doesNotMatch(xml, /5,8\s*%/u);
  assert.match(xml, /feldname="Projektierte Energieeffizienzklasse"/);
  assert.ok(xml.includes("Ausstattung"));
  assert.ok(xml.includes("Sonstiges"));
  assert.ok(xml.includes(FACTUAL_BUILDABILITY_NOTE));
  assert.ok(xml.includes(FIXED_ANNOTATION_TEXT));
  assert.ok(xml.includes(FIXED_TERMS_TEXT));
  assert.ok(xml.includes(FIXED_RECOMMENDATION_TEXT));
  const propertyExtensions = xml.match(/<\/verwaltung_techn>\s*([\s\S]*?)<\/immobilie>/u)?.[1] || "";
  assert.ok(propertyExtensions.includes(`feldname="anklickbar"><![CDATA[${FIXED_PROVISION_TEXT}]]>`));
  assert.ok(propertyExtensions.includes(`feldname="allgemein2"><![CDATA[${FIXED_RECOMMENDATION_TEXT}]]>`));
  const freeTextXml = xml.match(/<freitexte>[\s\S]*?<\/freitexte>/u)?.[0] || "";
  assert.doesNotMatch(freeTextXml, /feldname="(?:anklickbar|allgemein2)"/u);
  assert.doesNotMatch(xml, /AUF WUNSCH empfehlen/u);
  assert.ok(xml.indexOf("<kaufpreis>") < xml.indexOf("<provisionspflichtig>"));
  assert.ok(xml.indexOf("<provisionspflichtig>") < xml.indexOf("<waehrung "));
  assert.ok(xml.indexOf("<bad ") < xml.indexOf("<kueche "));
  assert.ok(xml.indexOf("<gartennutzung>") < xml.indexOf("<energietyp "));
  assert.ok(xml.indexOf("</zustand_angaben>") < xml.indexOf("<infrastruktur>"));
  assert.ok(xml.indexOf("<infrastruktur>") < xml.indexOf("<freitexte>"));
  assert.ok(xml.indexOf("Aktuelles Angebot für dein neues Zuhause") < xml.indexOf("Bild 1"));
  const secondListing = {
    ...input.listings[0],
    id: "listing-2",
    externalId: "30460-102",
  };
  const perListingXml = buildOpenImmoXml({
    ...input,
    listings: [input.listings[0], secondListing],
    promotionImage: null,
    promotionImageEnabled: false,
    promotionImagesByListingId: { [input.listings[0].id]: input.promotionImage },
  });
  assert.equal(perListingXml.match(/Aktuelles Angebot für dein neues Zuhause/g)?.length, 1);
  assert.ok(perListingXml.indexOf("Aktuelles Angebot für dein neues Zuhause") < perListingXml.indexOf("30460-102"));
  const packageResult = await buildImportPackage(input);
  assert.match(packageResult.filename, /testprojekt-testhaus-30460-101-\d{4}-\d{2}-\d{2}\.zip/);
  assert.match(packageResult.xmlFilename, /\.xml$/u);
  assert.deepEqual(packageResult.creativePayloadManifest, [{
    listingId: "listing-1",
    externalId: "30460-101",
    houseId: "house-1",
    houseName: "Testhaus",
    houseVersion: "",
    houseType: "Einfamilienhaus",
    housePrice: 400000,
    listingPrice: 500000,
    livingArea: 150,
    rooms: 5,
    bedrooms: 3,
    bathrooms: 2,
    floors: 2,
    constructionYear: 2027,
    energyDemand: 18,
    energyClass: "A+",
    heatingType: "Wärmepumpe",
    energySource: "Strom",
    architecture: "",
    equipmentHighlights: "",
    heroType: "action",
    heroAssetId: "promotion-image-1",
    payloadImageAssetIds: ["promotion-image-1", "image-1", "image-2", "image-3", "image-4"],
    firstImageFilename: "30460-101-01-aktuelles-angebot-fur-dein-neues-zuhause.jpg",
    promotionImageEnabled: true,
  }]);
  assert.deepEqual(validateImportPackage(input), []);
});

test("exports floor count and barrier-free status in the actual OpenImmo fields for every approved bungalow", () => {
  for (const name of ["Sol 82", "Solution 101", "Solution 107", "Solution 110"]) {
    const input = energyScenarioInput();
    input.houses[0].name = name;
    input.listings[0].templateName = name;
    const xml = buildOpenImmoXml(input);
    const geoXml = xml.match(/<geo>[\s\S]*?<\/geo>/u)?.[0] || "";
    const areasXml = xml.match(/<flaechen>[\s\S]*?<\/flaechen>/u)?.[0] || "";
    assert.match(geoXml, /<anzahl_etagen>1<\/anzahl_etagen>/u, name);
    assert.doesNotMatch(areasXml, /<anzahl_etagen>/u, name);
    assert.match(xml, /<barrierefrei>true<\/barrierefrei>/u, name);
  }

  const nonBungalowXml = buildOpenImmoXml(energyScenarioInput());
  assert.match(nonBungalowXml.match(/<geo>[\s\S]*?<\/geo>/u)?.[0] || "", /<anzahl_etagen>2<\/anzahl_etagen>/u);
  assert.match(nonBungalowXml, /<barrierefrei>false<\/barrierefrei>/u);
});

test("overwrites legacy portal deviations with the global object targets during export", () => {
  const input = {
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
      externalId: "30460-103",
      templateId: "house-explicit-projecting-values",
      templateName: "Bestandshaus",
      price: 500000,
      version: 1,
      projectingSettings: {
        equipmentQuality: "LUXUS",
        constructionYear: 2031,
        constructionPhase: "ERSTBEZUG",
        availableFrom: "2031",
        attic: false,
        guestWc: false,
        gardenUse: false,
        underfloorHeating: false,
        electricFuel: false,
        airSourceHeatPump: false,
        kfw40: false,
        kfw55: false,
        energyClass: "B",
        commissionRequired: true,
        energyCertificateClass: "C",
        fittedKitchen: false,
        openKitchen: false,
        shower: false,
        bathtub: false,
        bathroomWindow: false,
        environmentBus: false,
        environmentShopping: true,
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
      constructionYear: 2031,
      energyDemand: 18,
      energyClass: "B",
      heatingType: "Radiatoren",
      energySource: "Gas",
      architecture: "",
      equipmentHighlights: "",
      useStandardPackage: true,
      images: Array.from({ length: 4 }, (_, index) => ({
        id: `explicit-image-${index + 1}`,
        name: `explicit-image-${index + 1}.jpg`,
        mimeType: "image/jpeg",
        dataUrl: "data:image/jpeg;base64,/9j/2Q==",
        caption: `Bild ${index + 1}`,
        isFloorplan: false,
      })),
    }],
    provider: {
      providerNumber: "30435",
      company: "Testfirma",
      firstName: "Max",
      lastName: "Mustermann",
      email: "test@example.com",
      phone: "0000",
    },
  };

  const xml = buildOpenImmoXml(input);
  assert.match(xml, /<ausstatt_kategorie>GEHOBEN<\/ausstatt_kategorie>/);
  assert.doesNotMatch(xml, /<heizungsart\b/u);
  assert.match(xml, /<befeuerung ELEKTRO="false" LUFTWP="true" \/>/);
  assert.match(xml, /<gartennutzung>false<\/gartennutzung>/);
  assert.match(xml, /<energietyp KFW40="true" KFW55="false" \/>/);
  assert.match(xml, /<zustand zustand_art="PROJEKTIERT" \/>/);
  assert.match(xml, /<baujahr>2027<\/baujahr>/);
  assert.match(xml, /<verfuegbar_ab>2027<\/verfuegbar_ab>/);
  assert.doesNotMatch(xml, /<wertklasse>/);
  assert.match(xml, /<provisionspflichtig>false<\/provisionspflichtig>/);
  assert.match(xml, /<courtage_hinweis><!\[CDATA\[Für den reinen Grundstückskauf fällt eine Provision an\./);
  assert.match(xml, /<bad DUSCHE="false" WANNE="false" FENSTER="false" \/>/);
  assert.match(xml, /<kueche EBK="false" OFFEN="false" \/>/);
  assert.match(xml, /<dachboden>false<\/dachboden>/);
  assert.match(xml, /<gaestewc>false<\/gaestewc>/);
  assert.match(xml, /<user_defined_simplefield feldname="Umgebung"><!\[CDATA\[Einkaufsmöglichkeit\]\]><\/user_defined_simplefield>/);
  assert.match(xml, /feldname="Projektierte Energieeffizienzklasse"/);
});

test("rejects malformed project and unsupported image data before packaging", () => {
  const errors = validateImportPackage({
    project: { street: "", zip: "123", city: "", plotArea: 0 },
    listings: [],
    houses: [],
    provider: { providerNumber: "", company: "", email: "invalid" },
  });
  assert.ok(errors.length >= 7);
  assert.match(errors.join(" "), /Postleitzahl|Grundstücksfläche|Anbieter-E-Mail/);
});

test("blocks XML and ZIP creation when a manual legacy text contains an unverified environmental claim", async () => {
  const input = {
    project: {
      id: "claim-block-project", name: "Claim block", street: "Teststraße", houseNumber: "1", zip: "15732", city: "Schulzendorf", district: "",
      plotArea: 600, plotPrice: 0, additionalCosts: 0, locationFacts: "", transportFacts: "", familyFacts: "", natureFacts: "", selectedHouseIds: ["claim-block-house"], listings: [], createdAt: "2026-09-23T00:00:00.000Z",
    },
    listings: [{
      id: "claim-block-listing", externalId: "30460-104", templateId: "claim-block-house", templateName: "Claim block house", price: 500000, version: 1,
      texts: { title: "Nachhaltiges Familienhaus", description: "Sachliche Beschreibung", equipment: "Sachliche Ausstattung", location: "Sachliche Lage", other: "Sachlicher Hinweis" },
    }],
    houses: [{
      id: "claim-block-house", name: "Claim block house", houseType: "Einfamilienhaus", livingArea: 150, rooms: 5, bedrooms: 3, bathrooms: 2, floors: 2,
      housePrice: 400000, constructionYear: 2027, energyDemand: 0, energyClass: "", heatingType: "", energySource: "", architecture: "", equipmentHighlights: "", useStandardPackage: false,
      images: Array.from({ length: 4 }, (_, index) => ({ id: `claim-image-${index}`, name: `claim-${index}.jpg`, mimeType: "image/jpeg", dataUrl: "data:image/jpeg;base64,/9j/2Q==", caption: `Bild ${index}`, isFloorplan: false })),
    }],
    provider: { providerNumber: "30435", company: "Test GmbH", firstName: "Max", lastName: "Mustermann", email: "test@example.com", phone: "0000" },
  };
  assert.throws(
    () => buildOpenImmoXml(input),
    (error) => error.code === "LISTING_CLAIM_VALIDATION_FAILED"
      && /Export blockiert.*GENERIC_ENVIRONMENTAL_CLAIM/iu.test(error.message),
  );
  await assert.rejects(
    buildImportPackage(input),
    (error) => error.code === "LISTING_CLAIM_VALIDATION_FAILED",
  );
});

test("exports the fixed role sequence and keeps the action image in front", () => {
  const roleImages = [
    ["qr", "Jetzt Starten!"],
    ["trust", "Bestens Beraten"],
    ["awards", "Ausgezeichnet gebaut"],
    ["floorplan_upper", "Dein Dachgeschoss"],
    ["floorplan_ground", "Dein Erdgeschoss"],
    ["emotion", "Hier beginnt dein Zuhause"],
    ["office", "Work-Life Balance"],
    ["living", "Setz dich und Ruh dich aus"],
    ["kids", "Der Entwicklungsraum"],
    ["bedroom", "Deine Ruhezone"],
    ["bathroom", "Dein Spa"],
    ["kitchen", "Deine 5* Küche"],
    ["cover", "Dein schönes Zuhause"],
  ].map(([role, caption], index) => ({
    id: `role-${index}`,
    name: `${role}.jpg`,
    mimeType: "image/jpeg",
    dataUrl: "data:image/jpeg;base64,/9j/2Q==",
    caption,
    isFloorplan: role.startsWith("floorplan"),
    role,
  }));
  const input = {
    project: {
      street: "Teststraße",
      zip: "15732",
      city: "Schulzendorf",
      plotArea: 600,
      name: "Testprojekt",
    },
    listings: [{
      id: "listing-role-order",
      externalId: "30460-105",
      templateId: "house-role-order",
      templateName: "SUN 130 V2",
      price: 500000,
      texts: {
        title: "Sicher ankommen und zuhause fühlen",
        description: "Objektbeschreibung",
        equipment: "Ausstattung",
        location: "Lage",
        other: "Sonstiges",
      },
    }],
    houses: [{
      id: "house-role-order",
      name: "SUN 130 V2",
      houseType: "Einfamilienhaus",
      livingArea: 130,
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
      images: roleImages,
    }],
    provider: {
      providerNumber: "30435",
      company: "Testanbieter",
      firstName: "Fabian",
      lastName: "Raebel",
      email: "test@example.com",
      phone: "0000",
    },
    promotionImage: {
      id: "promotion-role-order",
      name: "aktion.jpg",
      mimeType: "image/jpeg",
      dataUrl: "data:image/jpeg;base64,YWt0aW9u",
      caption: "Aktionsangebot",
      isFloorplan: false,
      role: "promotion",
    },
    promotionImageEnabled: true,
  };

  assert.deepEqual(validateImportPackage(input), []);
  const xml = buildOpenImmoXml(input);
  const captions = [
    "Aktionsangebot",
    "Dein schönes Zuhause",
    "Work-Life Balance",
    "Setz dich und Ruh dich aus",
    "Der Entwicklungsraum",
    "Deine Ruhezone",
    "Dein Spa",
    "Deine 5* Küche",
    "Hier beginnt dein Zuhause",
    "Dein Erdgeschoss",
    "Dein Dachgeschoss",
    "Ausgezeichnet gebaut",
    "Bestens Beraten",
    "Jetzt Starten!",
  ];
  for (let index = 1; index < captions.length; index += 1) {
    assert.ok(
      xml.indexOf(captions[index - 1]) < xml.indexOf(captions[index]),
      `${captions[index - 1]} muss vor ${captions[index]} stehen`,
    );
  }
});


test("exports a persisted global interior set into the final ZIP without mixing house interiors", async () => {
  const input = energyScenarioInput();
  const rooms = ["living", "kids", "bedroom", "kitchen", "bathroom", "office"];
  const roles = ["cover", "kitchen", "bathroom", "bedroom", "kids", "living", "office", "emotion", "floorplan_ground", "floorplan_upper", "awards", "trust", "qr"];
  const image = (id, role) => ({ id, role, name: `${id}.jpg`, mimeType: "image/jpeg", dataUrl: "data:image/jpeg;base64,/9j/2Q==", caption: id, isFloorplan: role.startsWith("floorplan") });
  input.houses[0].images = roles.map(role => image(`house-${role}`, role));
  input.interiorAssets = rooms.map(role => image(`B-${role}`, role));
  input.listings[0].interiorSet = "B";
  input.listings[0].interiorAssetIds = Object.fromEntries(rooms.map(role => [role, `B-${role}`]));
  assert.deepEqual(validateImportPackage(input), []);
  const result = await buildImportPackage(input);
  const ids = result.creativePayloadManifest[0].payloadImageAssetIds;
  assert.deepEqual(ids.slice(1, 7), rooms.map(role => `B-${role}`));
  assert.equal(ids.some(id => rooms.some(role => id === `house-${role}`)), false);
  const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
  assert.equal(Object.keys(zip.files).filter(path => path.endsWith(".jpg")).length, 13);
});
