import JSZip from "jszip";
import { APP_VERSION } from "./app-version.mjs";
import { imageSequenceIssues, orderHouseImages } from "../../image-sequence.mjs";
import {
  enforceListingCopy,
  fillMissingProjectingDefaults,
  FIXED_ANNOTATION_TEXT,
  FIXED_PROVISION_TEXT,
  FIXED_RECOMMENDATION_TEXT,
  FIXED_TERMS_TEXT,
} from "../../listing-copy.mjs";
import type {
  GeneratedListing,
  HouseImage,
  HouseTemplate,
  ProjectInput,
  ProviderSettings,
} from "../types";

export type PackageInput = {
  project: ProjectInput;
  listings: GeneratedListing[];
  houses: HouseTemplate[];
  provider: ProviderSettings;
  promotionImage?: HouseImage | null;
  promotionImageEnabled?: boolean;
};

const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_EXPORTED_IMAGES = 14;

function listingImages(input: PackageInput, house: HouseTemplate): HouseImage[] {
  const orderedImages = orderHouseImages(house.images);
  if (!input.promotionImageEnabled || !input.promotionImage) return orderedImages;
  return [
    { ...input.promotionImage, role: "promotion" },
    ...orderedImages.filter((image) => image.id !== input.promotionImage?.id),
  ];
}

export function validateImportPackage(input: PackageInput): string[] {
  const errors: string[] = [];
  if (!input.project.street.trim()) errors.push("Straße fehlt.");
  if (!/^\d{5}$/.test(input.project.zip.trim())) errors.push("Die Postleitzahl muss fünfstellig sein.");
  if (!input.project.city.trim()) errors.push("Ort fehlt.");
  if (!Number.isFinite(input.project.plotArea) || input.project.plotArea <= 0) errors.push("Grundstücksfläche muss größer als 0 sein.");
  if (!input.provider.providerNumber.trim()) errors.push("Anbieternummer fehlt.");
  if (!input.provider.company.trim()) errors.push("Firma fehlt.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.provider.email.trim())) errors.push("Anbieter-E-Mail ist ungültig.");
  if (!input.listings.length) errors.push("Mindestens ein Inserat muss ausgewählt sein.");

  const externalIds = new Set<string>();
  for (const listing of input.listings) {
    const label = listing.templateName || listing.externalId || "Inserat";
    if (!/^[a-zA-Z0-9._-]{1,100}$/.test(listing.externalId)) {
      errors.push(`${label}: externe Objekt-ID ist ungültig.`);
    } else if (externalIds.has(listing.externalId)) {
      errors.push(`${label}: externe Objekt-ID ist doppelt.`);
    }
    externalIds.add(listing.externalId);
    if (!Number.isFinite(listing.price) || listing.price <= 0) errors.push(`${label}: Kaufpreis muss größer als 0 sein.`);
    for (const [field, value] of Object.entries(listing.texts)) {
      if (!String(value).trim()) errors.push(`${label}: Textfeld ${field} ist leer.`);
    }

    const house = input.houses.find((item) => item.id === listing.templateId);
    if (!house) {
      errors.push(`${label}: zugehöriger Haustyp fehlt.`);
      continue;
    }
    const images = listingImages(input, house);
    if (images.length < 4 || images.length > MAX_EXPORTED_IMAGES) {
      errors.push(`${label}: benötigt 4 bis 14 Bilder.`);
    }
    for (const issue of imageSequenceIssues(images, {
      requiresUpperFloor: house.floors > 1,
      requiresThirdFloor: house.floors > 2,
      maximumImages: MAX_EXPORTED_IMAGES,
    })) {
      errors.push(`${label}: ${issue}`);
    }
    for (const image of images) {
      if (!SUPPORTED_IMAGE_TYPES.has(image.mimeType) || !/^data:image\/(?:jpeg|png|webp);base64,/i.test(image.dataUrl)) {
        errors.push(`${label}: Bild „${image.name}“ ist kein unterstütztes JPEG-, PNG- oder WebP-Bild.`);
      }
    }
  }
  return [...new Set(errors)];
}

function xml(value: string | number | undefined | null): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function cdata(value: string): string {
  return `<![CDATA[${value.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}

function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 48);
}

function houseType(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized.includes("zweifamil")) return "ZWEIFAMILIENHAUS";
  if (normalized.includes("doppel")) return "DOPPELHAUSHAELFTE";
  if (normalized.includes("reihen")) return "REIHENHAUS";
  if (normalized.includes("bungalow")) return "BUNGALOW";
  if (normalized.includes("stadt")) return "STADTHAUS";
  if (normalized.includes("fertig")) return "FERTIGHAUS";
  return "EINFAMILIENHAUS";
}

function extension(image: HouseImage): string {
  const fromName = image.name.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  if (image.mimeType.includes("png")) return "png";
  if (image.mimeType.includes("webp")) return "webp";
  return "jpg";
}

function imageFilename(
  listing: GeneratedListing,
  image: HouseImage,
  index: number,
): string {
  return `${slug(listing.externalId)}-${String(index + 1).padStart(2, "0")}-${slug(image.caption || image.name) || "bild"}.${extension(image)}`;
}

function imageXml(
  listing: GeneratedListing,
  images: HouseImage[],
): string {
  return images
    .map((image, index) => {
      const filename = imageFilename(listing, image, index);
      return `
          <anhang location="EXTERN" gruppe="${image.isFloorplan ? "GRUNDRISS" : "BILD"}">
            <anhangtitel>${cdata(image.caption || image.name)}</anhangtitel>
            <format>${xml(extension(image))}</format>
            <daten><pfad>${xml(filename)}</pfad></daten>
          </anhang>`;
    })
    .join("");
}

function listingXml(
  project: ProjectInput,
  listing: GeneratedListing,
  house: HouseTemplate,
  images: HouseImage[],
  provider: ProviderSettings,
  timestamp: string,
): string {
  const currency = new Intl.NumberFormat("de-DE", {
    useGrouping: false,
    maximumFractionDigits: 2,
  });
  const texts = enforceListingCopy(listing.texts, { house, project });
  const projecting = fillMissingProjectingDefaults(listing.projectingSettings);

  return `
      <immobilie>
        <objektkategorie>
          <nutzungsart WOHNEN="true" GEWERBE="false" ANLAGE="false" WAZ="false" />
          <vermarktungsart KAUF="true" MIETE_PACHT="false" ERBPACHT="false" LEASING="false" />
          <objektart><haus haustyp="${houseType(house.houseType)}" /></objektart>
        </objektkategorie>
        <geo>
          <plz>${xml(project.zip)}</plz>
          <ort>${xml(project.city)}</ort>
          <strasse>${xml(project.street)}</strasse>
          <hausnummer>${xml(project.houseNumber)}</hausnummer>
          <land iso_land="DEU" />
          <lage_gebiet gebiete="WOHN" />
          ${project.district ? `<regionaler_zusatz>${xml(project.district)}</regionaler_zusatz>` : ""}
        </geo>
        <kontaktperson>
          <email_zentrale>${xml(provider.email)}</email_zentrale>
          <email_direkt>${xml(provider.email)}</email_direkt>
          <tel_zentrale>${xml(provider.phone)}</tel_zentrale>
          <tel_durchw>${xml(provider.phone)}</tel_durchw>
          <name>${xml(provider.lastName)}</name>
          <vorname>${xml(provider.firstName)}</vorname>
          <firma>${xml(provider.company)}</firma>
          <personennummer>${xml(provider.providerNumber)}</personennummer>
        </kontaktperson>
        <preise>
          <kaufpreis>${currency.format(listing.price)}</kaufpreis>
          <provisionspflichtig>${projecting.commissionRequired}</provisionspflichtig>
          <courtage_hinweis>${cdata(FIXED_PROVISION_TEXT)}</courtage_hinweis>
          <waehrung iso_waehrung="EUR" />
        </preise>
        <flaechen>
          <wohnflaeche>${currency.format(house.livingArea)}</wohnflaeche>
          <nutzflaeche>${currency.format(house.livingArea)}</nutzflaeche>
          <grundstuecksflaeche>${currency.format(project.plotArea)}</grundstuecksflaeche>
          <anzahl_zimmer>${currency.format(house.rooms)}</anzahl_zimmer>
          <anzahl_schlafzimmer>${currency.format(house.bedrooms)}</anzahl_schlafzimmer>
          <anzahl_badezimmer>${currency.format(house.bathrooms)}</anzahl_badezimmer>
          <anzahl_etagen>${currency.format(house.floors)}</anzahl_etagen>
        </flaechen>
        <ausstattung>
          <ausstatt_kategorie WERTIGKEIT="${xml(projecting.equipmentQuality)}" />
          <bad dusche="true" wanne="true" fenster="true" />
          <kueche ebk="true" offen="true" />
          <heizungsart fussboden="${projecting.underfloorHeating}" />
          <befeuerung elektro="true" luftwp="${projecting.airSourceHeatPump}" />
          <gartennutzung>true</gartennutzung>
          <energietyp kfw40="${projecting.kfw40}" kfw55="${projecting.kfw55}" />
          <dachboden>true</dachboden>
          <gaestewc>true</gaestewc>
        </ausstattung>
        <zustand_angaben>
          <baujahr>${xml(house.constructionYear)}</baujahr>
          <zustand zustand_art="${xml(projecting.constructionPhase)}" />
          <energiepass>
            <epart>BEDARF</epart>
            <endenergiebedarf>${currency.format(house.energyDemand)}</endenergiebedarf>
            <wertklasse>${xml(projecting.energyCertificateClass)}</wertklasse>
            <baujahr>${xml(house.constructionYear)}</baujahr>
          </energiepass>
        </zustand_angaben>
        <freitexte>
          <objekttitel>${cdata(texts.title)}</objekttitel>
          <lage>${cdata(texts.location)}</lage>
          <ausstatt_beschr>${cdata(texts.equipment)}</ausstatt_beschr>
          <objektbeschreibung>${cdata(texts.description)}</objektbeschreibung>
          <sonstige_angaben>${cdata(texts.other)}</sonstige_angaben>
          <user_defined_simplefield feldname="Energieklasse">${cdata(projecting.energyClass)}</user_defined_simplefield>
          <user_defined_simplefield feldname="Anmerkung">${cdata(FIXED_ANNOTATION_TEXT)}</user_defined_simplefield>
          <user_defined_simplefield feldname="Allgemeine Geschäftsbedingungen">${cdata(FIXED_TERMS_TEXT)}</user_defined_simplefield>
          <user_defined_simplefield feldname="Freier Textblock für Empfehlungen">${cdata(FIXED_RECOMMENDATION_TEXT)}</user_defined_simplefield>
        </freitexte>
        <anhaenge>${imageXml(listing, images)}</anhaenge>
        <verwaltung_objekt>
          <objektadresse_freigeben>false</objektadresse_freigeben>
        </verwaltung_objekt>
        <verwaltung_techn>
          <aktion aktionart="CHANGE" timestamp="${xml(timestamp)}" />
          <openimmo_obid>${xml(listing.externalId)}</openimmo_obid>
          <kennung_ursprung>${xml(listing.externalId)}</kennung_ursprung>
          <stand_vom>${xml(timestamp)}</stand_vom>
          <weitergabe_generell>false</weitergabe_generell>
          <sprache>de</sprache>
        </verwaltung_techn>
      </immobilie>`;
}

export function buildOpenImmoXml(input: PackageInput): string {
  const { project, listings, houses, provider } = input;
  const validationErrors = validateImportPackage(input);
  if (validationErrors.length) {
    throw new Error(`OpenImmo-Prüfung fehlgeschlagen: ${validationErrors.join(" ")}`);
  }
  const timestamp = new Date().toISOString();
  const objects = listings
    .map((listing) => {
      const house = houses.find((item) => item.id === listing.templateId);
      if (!house) throw new Error(`Haustyp ${listing.templateName} fehlt.`);
      return listingXml(project, listing, house, listingImages(input, house), provider, timestamp);
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<openimmo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <uebertragung art="OFFLINE" umfang="VOLL" version="1.2.7" sendersoftware="Fabian&amp;Pascal Inseratestudio" senderversion="${APP_VERSION}" techn_email="${xml(provider.email)}" regi_id="${xml(provider.providerNumber)}" timestamp="${xml(timestamp)}" />
  <anbieter>
    <anbieternr>${xml(provider.providerNumber)}</anbieternr>
    <firma>${xml(provider.company)}</firma>${objects}
  </anbieter>
</openimmo>`;
}

function imageBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1] ?? "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export async function buildImportPackage(input: PackageInput): Promise<{
  blob: Blob;
  filename: string;
  xmlText: string;
}> {
  const zip = new JSZip();
  const xmlText = buildOpenImmoXml(input);
  const packageSlug = slug(input.project.name || `${input.project.city}-${Date.now()}`);
  const listingSuffix = input.listings.length === 1
    ? slug(`${input.listings[0].templateName}-${input.listings[0].externalId}`)
    : `${input.listings.length}-inserate`;
  const packageBaseName = `${packageSlug || "fabian-pascal-import"}-${listingSuffix}`;
  const xmlFilename = `${packageBaseName}.xml`;
  zip.file(xmlFilename, xmlText);

  input.listings.forEach((listing) => {
    const house = input.houses.find((item) => item.id === listing.templateId);
    if (!house) return;
    listingImages(input, house).forEach((image, index) => {
      zip.file(imageFilename(listing, image, index), imageBytes(image.dataUrl));
    });
  });

  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  return {
    blob,
    filename: `${packageBaseName}-${new Date().toISOString().slice(0, 10)}.zip`,
    xmlText,
  };
}
