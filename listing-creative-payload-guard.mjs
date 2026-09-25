import { createHash } from "node:crypto";

import JSZip from "jszip";

import { parseHouseVariant } from "./image-sequence.mjs";
import { isCurrentStaticCopyText, resolveListingStaticCopy } from "./listing-copy.mjs";
import { assertListingClaimsCompliant, LIVING_HAUS_SERIES_ID } from "./listing-claim-policy.mjs";

export const CREATIVE_PAYLOAD_MISMATCH = "CREATIVE_PAYLOAD_MISMATCH";
export const PRODUCTION_CREATIVE_SELECTION_MISSING = "PRODUCTION_CREATIVE_SELECTION_MISSING";

function text(value) {
  return String(value ?? "").trim();
}

function imageBytes(image) {
  const match = /^data:image\/(?:jpeg|png|webp);base64,(.+)$/iu.exec(text(image?.dataUrl));
  return match ? Buffer.from(match[1], "base64") : Buffer.alloc(0);
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function xmlValue(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function payloadNumber(value) {
  return new Intl.NumberFormat("de-DE", {
    useGrouping: false,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

function cdataValue(value) {
  return `<![CDATA[${String(value ?? "").replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}

export async function verifyCreativePayload(input) {
  const listing = input?.listing;
  const house = input?.house;
  const project = input?.project;
  const selection = listing?.creativeSelection;
  const packageResult = input?.packageResult;
  const archive = Buffer.isBuffer(input?.archive) ? input.archive : Buffer.from(input?.archive || []);
  const errors = [];
  const manifestEntries = Array.isArray(packageResult?.creativePayloadManifest)
    ? packageResult.creativePayloadManifest
    : [];
  const actual = manifestEntries.length === 1 ? manifestEntries[0] : null;
  const expectedHeroAssetId = text(selection?.heroAssetId || selection?.heroImageId);
  const expectedHero = selection?.heroType === "action"
    ? input?.promotionImage
    : (house?.images || []).find((image) => text(image.id) === expectedHeroAssetId);

  if (Number(selection?.format) !== 1) errors.push("Persistierte Creative-Auswahl fehlt oder besitzt ein unbekanntes Format.");
  if (text(selection?.rotationId) !== text(listing?.id)) errors.push("Creative-Rotation-ID stimmt nicht mit der Rotationskopie überein.");
  if (text(selection?.houseId) !== text(house?.id) || text(listing?.templateId) !== text(house?.id)) errors.push("Persistiertes Haus und Payload-Haus-ID unterscheiden sich.");
  if (text(selection?.houseName) !== text(house?.name) || text(listing?.templateName) !== text(house?.name)) errors.push("Persistierter Hausname und Payload-Hausname unterscheiden sich.");
  if (!expectedHeroAssetId || text(expectedHero?.id) !== expectedHeroAssetId) errors.push("Das persistierte Hero-Asset ist nicht eindeutig verfügbar.");
  if (!actual) errors.push("Das erzeugte OpenImmo-Paket besitzt keinen eindeutigen Creative-Payload-Nachweis.");

  if (actual) {
    if (text(actual.listingId) !== text(listing?.id) || text(actual.externalId) !== text(listing?.externalId)) errors.push("Payload-Inserat stimmt nicht mit der Rotationskopie überein.");
    if (text(actual.houseId) !== text(selection?.houseId) || text(actual.houseName) !== text(selection?.houseName)) errors.push("Creative-Haus wurde im Payload überschrieben.");
    if (text(actual.houseVersion) !== text(parseHouseVariant(house?.name)?.version)) errors.push("Die Hausversion im Payload stammt nicht aus dem ausgewählten Haus.");
    if (text(actual.heroType) !== text(selection?.heroType) || text(actual.heroAssetId) !== expectedHeroAssetId) errors.push("Creative-Hero wurde im Payload überschrieben.");
    if (selection?.heroType === "action" && actual.promotionImageEnabled !== true) errors.push("Das persistierte Aktionsbild ist im Background-Payload nicht aktiviert.");
    if (selection?.heroType === "house" && actual.promotionImageEnabled === true) errors.push("Der Haus-Hero wurde unerwartet als Aktionsbild exportiert.");
    for (const field of ["housePrice", "livingArea", "rooms", "bedrooms", "bathrooms", "floors", "constructionYear", "energyDemand"]) {
      if (Number(actual[field]) !== Number(house?.[field])) errors.push(`Hausdatenfeld ${field} stammt nicht aus dem ausgewählten Haus.`);
    }
    for (const field of ["houseType", "energyClass", "heatingType", "energySource", "architecture", "equipmentHighlights"]) {
      if (text(actual[field]) !== text(house?.[field])) errors.push(`Hausdatenfeld ${field} stammt nicht aus dem ausgewählten Haus.`);
    }
    if (Number(actual.listingPrice) !== Number(listing?.price)) errors.push("Der Payload-Kaufpreis stammt nicht aus der persistierten Rotationskopie.");
    const allowedImageIds = new Set((house?.images || []).map((image) => text(image.id)));
    if (selection?.heroType === "action") allowedImageIds.add(expectedHeroAssetId);
    if (!Array.isArray(actual.payloadImageAssetIds)
      || actual.payloadImageAssetIds.some((id) => !allowedImageIds.has(text(id)))) {
      errors.push("Der Payload-Bildsatz enthält ein Asset eines anderen Hauses oder einer nicht ausgewählten Aktion.");
    }
  }

  const expectedPrice = Number(house?.housePrice) + Number(project?.plotPrice) + Number(project?.additionalCosts);
  if (project && (!Number.isFinite(expectedPrice) || Number(listing?.price) !== Math.max(0, expectedPrice))) {
    errors.push("Der persistierte Kaufpreis stimmt nicht mit Haus-, Grundstücks- und Nebenkosten überein.");
  }

  let firstPayloadPath = "";
  let payloadHeroSha256 = "";
  try {
    const zip = await JSZip.loadAsync(archive);
    const xmlEntry = zip.file(text(packageResult?.xmlFilename));
    if (!xmlEntry) throw new Error("OpenImmo-XML fehlt im ZIP.");
    const zippedXml = await xmlEntry.async("string");
    if (zippedXml !== text(packageResult?.xmlText)) errors.push("OpenImmo-XML im ZIP weicht vom geprüften XML ab.");
    firstPayloadPath = /<pfad>([^<]+)<\/pfad>/u.exec(zippedXml)?.[1] || "";
    if (!actual?.firstImageFilename || firstPayloadPath !== actual.firstImageFilename) errors.push("Das führende Bild im OpenImmo-XML stimmt nicht mit dem Creative-Nachweis überein.");
    const heroEntry = actual?.firstImageFilename ? zip.file(actual.firstImageFilename) : null;
    if (!heroEntry) errors.push("Das führende Creative-Bild fehlt im ZIP.");
    else {
      const payloadHero = await heroEntry.async("nodebuffer");
      payloadHeroSha256 = sha256(payloadHero);
      const expectedBytes = imageBytes(expectedHero);
      if (!expectedBytes.length || payloadHeroSha256 !== sha256(expectedBytes)) errors.push("Die Bytes des führenden Payload-Bildes stimmen nicht mit dem persistierten Hero-Asset überein.");
    }
    if (!zippedXml.includes(`<user_defined_simplefield feldname="Living Haus Modell-ID">${cdataValue(house?.id)}</user_defined_simplefield>`)) errors.push("Payload enthält nicht die erwartete Haus-ID.");
    if (!zippedXml.includes(`<user_defined_simplefield feldname="Living Haus Modell">${cdataValue(house?.name)}</user_defined_simplefield>`)) errors.push("Payload enthält nicht den erwarteten Hausnamen.");
    if (!zippedXml.includes(`<wohnflaeche>${xmlValue(payloadNumber(house?.livingArea))}</wohnflaeche>`)) errors.push("Payload-Wohnfläche stimmt nicht mit dem ausgewählten Haus überein.");
    if (!zippedXml.includes(`<kaufpreis>${xmlValue(payloadNumber(listing?.price))}</kaufpreis>`)) errors.push("Payload-Kaufpreis stimmt nicht mit der persistierten Rotationskopie überein.");
    for (const [tag, field] of [["anzahl_zimmer", "rooms"], ["anzahl_schlafzimmer", "bedrooms"], ["anzahl_badezimmer", "bathrooms"], ["anzahl_etagen", "floors"]]) {
      if (!zippedXml.includes(`<${tag}>${xmlValue(payloadNumber(house?.[field]))}</${tag}>`)) {
        errors.push(`Payload-Hausdatenfeld ${field} stimmt nicht mit dem ausgewählten Haus überein.`);
      }
    }
    if (!zippedXml.includes(`<baujahr>${xmlValue(house?.constructionYear)}</baujahr>`)) errors.push("Payload-Baujahr stimmt nicht mit dem ausgewählten Haus überein.");
    if (project) {
      const staticCopy = resolveListingStaticCopy(listing);
      const expectedTexts = {
        ...listing?.texts,
        equipment: staticCopy.values.equipment,
        other: staticCopy.values.other,
      };
      assertListingClaimsCompliant({
        texts: expectedTexts,
        staticTexts: {
          provision: staticCopy.values.provision,
          annotation: staticCopy.values.annotation,
          terms: staticCopy.values.terms,
          recommendation: staticCopy.values.recommendation,
        },
        approvedMasterTextFields: isCurrentStaticCopyText("equipment", staticCopy.values.equipment)
          ? ["equipment"]
          : [],
        house,
        project,
        listingFacts: listing?.listingFacts,
        houseSeries: LIVING_HAUS_SERIES_ID,
        images: house.images,
      }, "Export blockiert");
      for (const [tag, field] of [["objekttitel", "title"], ["lage", "location"], ["ausstatt_beschr", "equipment"], ["objektbeschreibung", "description"], ["sonstige_angaben", "other"]]) {
        if (!zippedXml.includes(`<${tag}>${cdataValue(expectedTexts[field])}</${tag}>`)) {
          errors.push(`Payload-Textfeld ${field} stimmt nicht mit der ausgewählten Rotationskopie überein.`);
        }
      }
      const staticFieldChecks = [
        ["courtage_hinweis", staticCopy.values.provision],
        ["user_defined_simplefield feldname=\"Anmerkung\"", staticCopy.values.annotation],
        ["user_defined_simplefield feldname=\"Allgemeine Geschäftsbedingungen\"", staticCopy.values.terms],
        ["user_defined_simplefield feldname=\"Freier Textblock für Empfehlungen\"", staticCopy.values.recommendation],
      ];
      for (const [tag, value] of staticFieldChecks) {
        if (!zippedXml.includes(`<${tag}>${cdataValue(value)}`)) {
          errors.push(`Payload-statisches Textfeld ${tag} stimmt nicht mit der ausgewählten Rotationskopie überein.`);
        }
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "OpenImmo-ZIP konnte nicht geprüft werden.");
  }

  const diagnostics = {
    rotationId: text(selection?.rotationId),
    plotId: text(selection?.plotId),
    sourceListingId: text(selection?.sourceListingId),
    expectedHouseId: text(selection?.houseId),
    expectedHouseName: text(selection?.houseName),
    actualHouseId: text(actual?.houseId),
    actualHouseName: text(actual?.houseName),
    expectedHeroType: text(selection?.heroType),
    actualHeroType: text(actual?.heroType),
    expectedHeroAssetId,
    actualHeroAssetId: text(actual?.heroAssetId),
    firstPayloadPath,
    payloadHeroSha256,
    creativeSelectionReason: [text(selection?.houseReason), text(selection?.heroReason)].filter(Boolean).join(" · "),
  };
  if (!errors.length) return { ok: true, errors: [], diagnostics };
  return { ok: false, errors: [...new Set(errors)], diagnostics };
}

export async function assertCreativePayload(input) {
  if (Number(input?.listing?.creativeSelection?.format) !== 1) {
    const error = new Error("Produktiver Upload gesperrt: Eine gültige persistierte CreativeSelection fehlt.");
    error.code = PRODUCTION_CREATIVE_SELECTION_MISSING;
    error.diagnostics = {
      rotationId: text(input?.listing?.id),
      plotId: text(input?.project?.plotId),
      sourceListingId: text(input?.listing?.rotationSourceListingId),
    };
    throw error;
  }
  const result = await verifyCreativePayload(input);
  if (result.ok) return result;
  const error = new Error(`Creative-Payload-Prüfung fehlgeschlagen: ${result.errors.join(" ")}`);
  error.code = CREATIVE_PAYLOAD_MISMATCH;
  error.diagnostics = result.diagnostics;
  throw error;
}
