import JSZip from "jszip";
import { orderHouseImages } from "../../image-sequence.mjs";
import {
  fillMissingProjectingDefaults,
  FIXED_PROVISION_TEXT,
  IMMOPROFESSIONAL_DEFAULTS,
} from "../../listing-copy.mjs";
import { APP_VERSION } from "./app-version.mjs";
import type {
  GeneratedListing,
  HouseImage,
  HouseTemplate,
  ListingMediaItem,
  ProjectInput,
  ProviderSettings,
} from "../types";

type PackageInput = {
  project: ProjectInput;
  listings: GeneratedListing[];
  houses: HouseTemplate[];
  provider: ProviderSettings;
  promotionImages?: HouseImage[];
  portalPublicationEnabled?: boolean;
  // Legacy fields keep older local backups importable.
  promotionImage?: HouseImage | null;
  promotionImageEnabled?: boolean;
};

const MAX_EXPORTED_IMAGES = 14;
const OPENIMMO_CONDITIONS = new Set([
  "ERSTBEZUG",
  "TEIL_VOLLRENOVIERUNGSBED",
  "NEUWERTIG",
  "TEIL_VOLLSANIERT",
  "TEIL_VOLLRENOVIERT",
  "TEIL_SANIERT",
  "VOLL_SANIERT",
  "SANIERUNGSBEDUERFTIG",
  "BAUFAELLIG",
  "NACH_VEREINBARUNG",
  "MODERNISIERT",
  "GEPFLEGT",
  "ROHBAU",
  "ENTKERNT",
  "ABRISSOBJEKT",
  "PROJEKTIERT",
]);
const OPENIMMO_EQUIPMENT_QUALITIES = new Set(["STANDARD", "GEHOBEN", "LUXUS"]);
const OPENIMMO_ENERGY_CERTIFICATE_TYPES = new Set(["BEDARF", "VERBRAUCH"]);

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

function openImmoValue(
  value: string | undefined,
  allowed: Set<string>,
  fallback: string,
): string {
  const normalized = value?.trim().toUpperCase() ?? "";
  return allowed.has(normalized) ? normalized : fallback;
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

function mediaFilename(
  listing: GeneratedListing,
  media: ListingMediaItem,
  index: number,
): string {
  const nameExtension = media.name.split(".").pop()?.toLowerCase();
  const fileExtension = nameExtension && /^[a-z0-9]{2,5}$/.test(nameExtension)
    ? nameExtension
    : media.mimeType?.includes("pdf")
      ? "pdf"
      : "bin";
  return `${slug(listing.externalId)}-anlage-${String(index + 1).padStart(2, "0")}-${slug(media.caption || media.name) || "dokument"}.${fileExtension}`;
}

function additionalMediaXml(listing: GeneratedListing): string {
  return (listing.management?.media ?? [])
    .filter((media) => (
      media.released
      && ["document", "video", "link", "tour"].includes(media.kind)
      && Boolean(media.dataUrl || media.url)
    ))
    .map((media, index) => {
      const path = media.dataUrl ? mediaFilename(listing, media, index) : media.url!;
      const group = media.kind === "document"
        ? "DOKUMENTE"
        : media.kind === "video"
          ? media.dataUrl ? "FILM" : "FILMLINK"
          : media.kind === "tour"
            ? "PANORAMA"
            : "LINKS";
      const format = media.kind === "document"
        ? media.name.split(".").pop()?.toLowerCase() || "pdf"
        : "url";
      return `
          <anhang location="${media.dataUrl ? "EXTERN" : "REMOTE"}" gruppe="${group}">
            <anhangtitel>${cdata(media.caption || media.name)}</anhangtitel>
            <format>${xml(format)}</format>
            <daten><pfad>${xml(path)}</pfad></daten>
          </anhang>`;
    })
    .join("");
}

function managedListingImages(
  input: PackageInput,
  listing: GeneratedListing,
): HouseImage[] {
  const media = listing.management?.media;
  if (!media?.length) return [];
  const sourceImages = [
    ...input.houses.flatMap((house) => house.images),
    ...(input.promotionImages ?? []),
    ...(input.promotionImage ? [input.promotionImage] : []),
  ];
  return media
    .filter((item) => (
      item.released
      && (item.kind === "image" || item.kind === "floorplan")
    ))
    .sort((left, right) => left.order - right.order)
    .map((item) => {
      const source = item.sourceImageId
        ? sourceImages.find((image) => image.id === item.sourceImageId)
        : undefined;
      return {
        id: item.id,
        sourceId: item.sourceImageId,
        name: item.name,
        mimeType: item.mimeType || source?.mimeType || "image/jpeg",
        dataUrl: item.dataUrl || source?.dataUrl || "",
        caption: item.caption,
        isFloorplan: item.kind === "floorplan",
      };
    })
    .filter((image) => Boolean(image.dataUrl))
    .slice(0, MAX_EXPORTED_IMAGES);
}

function listingImages(
  input: PackageInput,
  house: HouseTemplate,
  listing: GeneratedListing,
): HouseImage[] {
  if (listing.management?.media?.length) {
    return managedListingImages(input, listing);
  }
  const usesImageRoles = house.images.some((image) => (
    image.role && !["promotion", "other"].includes(image.role)
  ));
  const images = usesImageRoles
    ? orderHouseImages(house.images) as HouseImage[]
    : house.images;
  const assignedPromotionImage = listing.promotionImageId
    ? input.promotionImages?.find((image) => image.id === listing.promotionImageId)
    : undefined;
  const promotionImage = assignedPromotionImage
    ?? (input.promotionImageEnabled ? input.promotionImage : undefined);
  if (!promotionImage) return images;
  return [
    { ...promotionImage, role: "promotion" as const },
    ...images.filter((image) => image.id !== promotionImage.id),
  ].slice(0, MAX_EXPORTED_IMAGES);
}

function listingXml(
  project: ProjectInput,
  listing: GeneratedListing,
  house: HouseTemplate,
  images: HouseImage[],
  provider: ProviderSettings,
  timestamp: string,
  portalPublicationEnabled: boolean,
): string {
  const currency = new Intl.NumberFormat("de-DE", {
    useGrouping: false,
    maximumFractionDigits: 2,
  });
  const projecting = fillMissingProjectingDefaults(listing.projectingSettings);
  const details = listing.management?.details;
  const addressStreet = details?.street ?? project.street;
  const addressHouseNumber = details?.houseNumber ?? project.houseNumber;
  const addressZip = details?.zip ?? project.zip;
  const addressCity = details?.city ?? project.city;
  const addressDistrict = details?.district ?? project.district;
  const purchasePrice = details?.purchasePrice ?? listing.price;
  const livingArea = details?.livingArea ?? house.livingArea;
  const usableArea = details?.usableArea ?? house.livingArea;
  const plotArea = details?.plotArea ?? project.plotArea;
  const rooms = details?.rooms ?? house.rooms;
  const bedrooms = details?.bedrooms ?? house.bedrooms;
  const bathrooms = details?.bathrooms ?? house.bathrooms;
  const floors = details?.floors ?? house.floors;
  const constructionYear = details?.constructionYear ?? house.constructionYear;
  const energyDemand = details?.endEnergyDemand ?? house.energyDemand;
  const standDate = timestamp.slice(0, 10);
  const condition = openImmoValue(
    details?.condition || details?.constructionPhase || projecting.constructionPhase,
    OPENIMMO_CONDITIONS,
    "ERSTBEZUG",
  );
  const equipmentQuality = openImmoValue(
    details?.equipmentQuality ?? projecting.equipmentQuality,
    OPENIMMO_EQUIPMENT_QUALITIES,
    "STANDARD",
  );
  const energyCertificateType = openImmoValue(
    details?.energyCertificateType,
    OPENIMMO_ENERGY_CERTIFICATE_TYPES,
    "BEDARF",
  );

  return `
      <immobilie>
        <objektkategorie>
          <nutzungsart WOHNEN="true" GEWERBE="false" ANLAGE="false" WAZ="false" />
          <vermarktungsart KAUF="true" MIETE_PACHT="false" ERBPACHT="false" LEASING="false" />
          <objektart><haus haustyp="${houseType(details?.houseType ?? house.houseType)}" /></objektart>
        </objektkategorie>
        <geo>
          <plz>${xml(addressZip)}</plz>
          <ort>${xml(addressCity)}</ort>
          <strasse>${xml(addressStreet)}</strasse>
          <hausnummer>${xml(addressHouseNumber)}</hausnummer>
          <land iso_land="DEU" />
          <anzahl_etagen>${currency.format(floors)}</anzahl_etagen>
          <lage_gebiet gebiete="WOHN" />
          ${addressDistrict ? `<regionaler_zusatz>${xml(addressDistrict)}</regionaler_zusatz>` : ""}
        </geo>
        <kontaktperson>
          <email_zentrale>${xml(details?.contactEmail ?? provider.email)}</email_zentrale>
          <email_direkt>${xml(details?.contactEmail ?? provider.email)}</email_direkt>
          <tel_zentrale>${xml(details?.contactPhone ?? provider.phone)}</tel_zentrale>
          <tel_durchw>${xml(details?.contactPhone ?? provider.phone)}</tel_durchw>
          <name>${xml(details?.contactLastName ?? provider.lastName)}</name>
          <vorname>${xml(details?.contactFirstName ?? provider.firstName)}</vorname>
          <firma>${xml(details?.contactCompany ?? provider.company)}</firma>
          <personennummer>${xml(provider.providerNumber)}</personennummer>
        </kontaktperson>
        <preise>
          <kaufpreis>${currency.format(purchasePrice)}</kaufpreis>
          <provisionspflichtig>${details?.commissionRequired ?? projecting.commissionRequired}</provisionspflichtig>
          <courtage_hinweis>${cdata(details?.commissionText || FIXED_PROVISION_TEXT)}</courtage_hinweis>
          <waehrung iso_waehrung="${xml(details?.currency ?? "EUR")}" />
        </preise>
        <flaechen>
          <wohnflaeche>${currency.format(livingArea)}</wohnflaeche>
          <nutzflaeche>${currency.format(usableArea)}</nutzflaeche>
          <grundstuecksflaeche>${currency.format(plotArea)}</grundstuecksflaeche>
          <anzahl_zimmer>${currency.format(rooms)}</anzahl_zimmer>
          <anzahl_schlafzimmer>${currency.format(bedrooms)}</anzahl_schlafzimmer>
          <anzahl_badezimmer>${currency.format(bathrooms)}</anzahl_badezimmer>
          ${details?.balconies ? `<anzahl_balkone>${currency.format(details.balconies)}</anzahl_balkone>` : ""}
          ${details?.terraces ? `<anzahl_terrassen>${currency.format(details.terraces)}</anzahl_terrassen>` : ""}
        </flaechen>
        <ausstattung>
          <ausstatt_kategorie>${xml(equipmentQuality)}</ausstatt_kategorie>
          <bad DUSCHE="${IMMOPROFESSIONAL_DEFAULTS.shower}" WANNE="${IMMOPROFESSIONAL_DEFAULTS.bathtub}" FENSTER="${IMMOPROFESSIONAL_DEFAULTS.bathroomWindow}" />
          <kueche EBK="${IMMOPROFESSIONAL_DEFAULTS.fittedKitchen}" OFFEN="${IMMOPROFESSIONAL_DEFAULTS.openKitchen}" />
          ${details?.fireplace ? "<kamin>true</kamin>" : ""}
          <heizungsart FUSSBODEN="${projecting.underfloorHeating}" />
          <befeuerung ELEKTRO="${IMMOPROFESSIONAL_DEFAULTS.electricFuel}" LUFTWP="${projecting.airSourceHeatPump}" />
          ${details?.airConditioning ? "<klimatisiert>true</klimatisiert>" : ""}
          ${details?.elevator ? '<fahrstuhl PERSONEN="true" />' : ""}
          <gartennutzung>${details?.garden ?? IMMOPROFESSIONAL_DEFAULTS.gardenUse}</gartennutzung>
          ${details?.barrierFree ? "<barrierefrei>true</barrierefrei>" : ""}
          ${details?.sauna ? "<sauna>true</sauna>" : ""}
          ${details?.pool ? "<swimmingpool>true</swimmingpool>" : ""}
          ${details?.conservatory ? "<wintergarten>true</wintergarten>" : ""}
          ${details?.alarmSystem ? '<sicherheitstechnik ALARMANLAGE="true" />' : ""}
          ${details?.basement ? '<unterkellert keller="JA" />' : ""}
          <energietyp KFW40="${projecting.kfw40}" KFW55="${projecting.kfw55}" />
          <dachboden>${details?.attic ?? IMMOPROFESSIONAL_DEFAULTS.attic}</dachboden>
          <gaestewc>${details?.guestWc ?? IMMOPROFESSIONAL_DEFAULTS.guestWc}</gaestewc>
          ${details?.seniorFriendly ? "<seniorengerecht>true</seniorengerecht>" : ""}
        </ausstattung>
        <zustand_angaben>
          <baujahr>${xml(constructionYear)}</baujahr>
          <zustand zustand_art="${xml(condition)}" />
          <energiepass>
            <epart>${xml(energyCertificateType)}</epart>
            ${details?.energyCertificateValidUntil ? `<gueltig_bis>${xml(details.energyCertificateValidUntil)}</gueltig_bis>` : ""}
            <mitwarmwasser>${details?.warmWaterIncluded ?? true}</mitwarmwasser>
            <endenergiebedarf>${currency.format(energyDemand)}</endenergiebedarf>
            <wertklasse>${xml(details?.energyClass || projecting.energyCertificateClass)}</wertklasse>
            <baujahr>${xml(details?.certificateYear || constructionYear)}</baujahr>
          </energiepass>
        </zustand_angaben>
        <freitexte>
          <objekttitel>${cdata(listing.texts.title)}</objekttitel>
          <lage>${cdata(listing.texts.location)}</lage>
          <ausstatt_beschr>${cdata(listing.texts.equipment)}</ausstatt_beschr>
          <objektbeschreibung>${cdata(listing.texts.description)}</objektbeschreibung>
          <sonstige_angaben>${cdata(listing.texts.other)}</sonstige_angaben>
          <user_defined_simplefield feldname="Energieklasse">${cdata(projecting.energyClass)}</user_defined_simplefield>
        </freitexte>
        <anhaenge>${imageXml(listing, images)}${additionalMediaXml(listing)}</anhaenge>
        <verwaltung_objekt>
          <objektadresse_freigeben>${details?.addressPublished ?? false}</objektadresse_freigeben>
          ${details?.availableFrom ? `<verfuegbar_ab>${xml(details.availableFrom)}</verfuegbar_ab>` : ""}
          ${details?.rented ? "<vermietet>true</vermietet>" : ""}
          ${details?.monument ? "<denkmalgeschuetzt>true</denkmalgeschuetzt>" : ""}
          ${details?.internalNotes ? `<user_defined_simplefield feldname="Interne Hinweise">${cdata(details.internalNotes)}</user_defined_simplefield>` : ""}
          ${(listing.management?.media ?? [])
            .filter((media) => media.released && media.url)
            .map((media) => `<user_defined_simplefield feldname="${xml(`Medium ${media.kind}`)}">${cdata(media.url!)}</user_defined_simplefield>`)
            .join("")}
        </verwaltung_objekt>
        <verwaltung_techn>
          <objektnr_extern>${xml(listing.externalId)}</objektnr_extern>
          <aktion aktionart="CHANGE" />
          <openimmo_obid>${xml(listing.externalId)}</openimmo_obid>
          <kennung_ursprung>${xml(listing.externalId)}</kennung_ursprung>
          <stand_vom>${xml(standDate)}</stand_vom>
          <weitergabe_generell>${portalPublicationEnabled}</weitergabe_generell>
          ${details?.groupId ? `<gruppen_kennung>${xml(details.groupId)}</gruppen_kennung>` : ""}
          <sprache>de</sprache>
        </verwaltung_techn>
      </immobilie>`;
}

export function buildOpenImmoDeleteXml(input: {
  externalIds: string[];
  provider: ProviderSettings;
  timestamp?: string;
}): string {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const standDate = timestamp.slice(0, 10);
  const contactEmail = input.provider.email;
  const contactName = input.provider.lastName || input.provider.company || "Ansprechpartner";
  const objects = [...new Set(input.externalIds.map((value) => value.trim()).filter(Boolean))]
    .map((externalId) => `
      <immobilie>
        <objektkategorie>
          <nutzungsart WOHNEN="true" GEWERBE="false" ANLAGE="false" WAZ="false" />
          <vermarktungsart KAUF="true" MIETE_PACHT="false" ERBPACHT="false" LEASING="false" />
          <objektart><haus haustyp="EINFAMILIENHAUS" /></objektart>
        </objektkategorie>
        <geo>
          <plz></plz>
          <land iso_land="DEU" />
        </geo>
        <kontaktperson>
          <email_zentrale>${xml(contactEmail)}</email_zentrale>
          <name>${xml(contactName)}</name>
          ${input.provider.firstName ? `<vorname>${xml(input.provider.firstName)}</vorname>` : ""}
          ${input.provider.company ? `<firma>${xml(input.provider.company)}</firma>` : ""}
          <personennummer>${xml(input.provider.providerNumber)}</personennummer>
        </kontaktperson>
        <verwaltung_techn>
          <objektnr_extern>${xml(externalId)}</objektnr_extern>
          <aktion aktionart="DELETE" />
          <openimmo_obid>${xml(externalId)}</openimmo_obid>
          <kennung_ursprung>${xml(externalId)}</kennung_ursprung>
          <stand_vom>${xml(standDate)}</stand_vom>
          <sprache>de</sprache>
        </verwaltung_techn>
      </immobilie>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<openimmo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <uebertragung art="OFFLINE" umfang="TEIL" modus="DELETE" version="1.2.7" sendersoftware="Fabian&amp;Pascal Inseratestudio" senderversion="${xml(APP_VERSION)}" techn_email="${xml(input.provider.email)}" regi_id="${xml(input.provider.providerNumber)}" timestamp="${xml(timestamp)}" />
  <anbieter>
    <anbieternr>${xml(input.provider.providerNumber)}</anbieternr>
    <firma>${xml(input.provider.company)}</firma>
    <openimmo_anid>${xml(`O${input.provider.providerNumber}`)}</openimmo_anid>${objects}
  </anbieter>
</openimmo>`;
}

export function buildOpenImmoXml(input: PackageInput): string {
  const { project, listings, houses, provider } = input;
  const portalPublicationEnabled = input.portalPublicationEnabled === true;
  const timestamp = new Date().toISOString();
  const objects = listings
    .map((listing) => {
      const house = houses.find((item) => item.id === listing.templateId);
      if (!house) throw new Error(`Haustyp ${listing.templateName} fehlt.`);
      return listingXml(
        project,
        listing,
        house,
        listingImages(input, house, listing),
        provider,
        timestamp,
        portalPublicationEnabled,
      );
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<openimmo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <uebertragung art="OFFLINE" umfang="TEIL" modus="CHANGE" version="1.2.7" sendersoftware="Fabian&amp;Pascal Inseratestudio" senderversion="${xml(APP_VERSION)}" techn_email="${xml(provider.email)}" regi_id="${xml(provider.providerNumber)}" timestamp="${xml(timestamp)}" />
  <anbieter>
    <anbieternr>${xml(provider.providerNumber)}</anbieternr>
    <firma>${xml(provider.company)}</firma>
    <openimmo_anid>${xml(`O${provider.providerNumber}`)}</openimmo_anid>${objects}
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
    listingImages(input, house, listing).forEach((image, index) => {
      zip.file(imageFilename(listing, image, index), imageBytes(image.dataUrl));
    });
    (listing.management?.media ?? [])
      .filter((media) => media.released && media.kind === "document" && media.dataUrl)
      .forEach((media, index) => {
        zip.file(mediaFilename(listing, media, index), imageBytes(media.dataUrl!));
      });
  });

  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  return {
    blob,
    filename: `${packageBaseName}-${new Date().toISOString().slice(0, 10)}.zip`,
    xmlText,
  };
}

export async function buildDeletePackage(input: {
  externalIds: string[];
  provider: ProviderSettings;
}): Promise<{ blob: Blob; filename: string; xmlText: string }> {
  if (!input.externalIds.length) throw new Error("Keine Objekt-ID für den Löschauftrag ausgewählt.");
  const zip = new JSZip();
  const xmlText = buildOpenImmoDeleteXml(input);
  const stamp = new Date().toISOString().slice(0, 10);
  const filenameBase = `loeschauftrag-${slug(input.externalIds.join("-")) || "objekte"}-${stamp}`;
  zip.file(`${filenameBase}.xml`, xmlText);
  return {
    blob: await zip.generateAsync({ type: "blob", compression: "DEFLATE" }),
    filename: `${filenameBase}.zip`,
    xmlText,
  };
}
