import JSZip from "jszip";
import type {
  GeneratedListing,
  HouseImage,
  HouseTemplate,
  ProjectInput,
  ProviderSettings,
} from "../types";

type PackageInput = {
  project: ProjectInput;
  listings: GeneratedListing[];
  houses: HouseTemplate[];
  provider: ProviderSettings;
  promotionImage?: HouseImage | null;
  promotionImageEnabled?: boolean;
};

const MAX_EXPORTED_IMAGES = 14;

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

function listingImages(input: PackageInput, house: HouseTemplate): HouseImage[] {
  if (!input.promotionImageEnabled || !input.promotionImage) return house.images;
  return [
    input.promotionImage,
    ...house.images.filter((image) => image.id !== input.promotionImage?.id),
  ].slice(0, MAX_EXPORTED_IMAGES);
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
          <heizungsart ZENTRAL="true" FUSSBODEN="true" />
          <befeuerung WAERMEPUMPE="true" />
          <gaestewc>true</gaestewc>
        </ausstattung>
        <zustand_angaben>
          <baujahr>${xml(house.constructionYear)}</baujahr>
          <zustand zustand_art="PROJEKTIERT" />
          <energiepass>
            <epart>BEDARF</epart>
            <endenergiebedarf>${currency.format(house.energyDemand)}</endenergiebedarf>
            <wertklasse>${xml(house.energyClass)}</wertklasse>
            <baujahr>${xml(house.constructionYear)}</baujahr>
          </energiepass>
        </zustand_angaben>
        <freitexte>
          <objekttitel>${cdata(listing.texts.title)}</objekttitel>
          <lage>${cdata(listing.texts.location)}</lage>
          <ausstatt_beschr>${cdata(listing.texts.equipment)}</ausstatt_beschr>
          <objektbeschreibung>${cdata(listing.texts.description)}</objektbeschreibung>
          <sonstige_angaben>${cdata(listing.texts.other)}</sonstige_angaben>
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
  <uebertragung art="OFFLINE" umfang="VOLL" version="1.2.7" sendersoftware="Fabian&amp;Pascal Inseratestudio" senderversion="0.3.18" techn_email="${xml(provider.email)}" regi_id="${xml(provider.providerNumber)}" timestamp="${xml(timestamp)}" />
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
