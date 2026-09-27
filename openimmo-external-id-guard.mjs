import JSZip from "jszip";

import { HV_OBJECT_NUMBER_PATTERN } from "./object-number-sequence.mjs";

export const OPENIMMO_EXTERNAL_ID_GUARD_CODE = "OPENIMMO_EXTERNAL_ID_GUARD_BLOCKED";

function guardError(message, diagnostics = {}) {
  const error = new Error(message);
  error.code = OPENIMMO_EXTERNAL_ID_GUARD_CODE;
  error.diagnostics = diagnostics;
  return error;
}

function tagValues(xml, tag) {
  return [...String(xml).matchAll(new RegExp(`<${tag}>([^<]*)<\\/${tag}>`, "gu"))]
    .map((match) => String(match[1] || "").trim());
}

function listingBlocks(xml) {
  return [...String(xml).matchAll(/<immobilie>([\s\S]*?)<\/immobilie>/gu)].map((match) => match[1]);
}

export async function assertOpenImmoExternalIdsInArchive(archive) {
  let zip;
  try {
    zip = await JSZip.loadAsync(archive, { checkCRC32: true });
  } catch {
    throw guardError("Pre-FTPS-Prüfung blockiert: Das Importpaket ist kein gültiges ZIP-Archiv.");
  }
  const xmlEntries = Object.values(zip.files).filter((entry) => !entry.dir && /\.xml$/iu.test(entry.name));
  if (xmlEntries.length !== 1) {
    throw guardError(
      "Pre-FTPS-Prüfung blockiert: Das Importpaket benötigt genau eine OpenImmo-XML.",
      { xmlFileCount: xmlEntries.length },
    );
  }
  const xml = await xmlEntries[0].async("string");
  if (/FPI-/iu.test(xml)) {
    throw guardError(
      "Pre-FTPS-Prüfung blockiert: FPI-Objektnummer im finalen ZIP erkannt.",
      { fpiDetected: true },
    );
  }
  const blocks = listingBlocks(xml);
  if (!blocks.length) {
    throw guardError("Pre-FTPS-Prüfung blockiert: Die OpenImmo-XML enthält kein Immobilienobjekt.");
  }
  const objectNumbers = [];
  for (const block of blocks) {
    const external = tagValues(block, "objektnr_extern");
    const openImmo = tagValues(block, "openimmo_obid");
    const origin = tagValues(block, "kennung_ursprung");
    if (external.length !== 1 || openImmo.length !== 1 || origin.length !== 1) {
      throw guardError(
        "Pre-FTPS-Prüfung blockiert: Externe OpenImmo-ID-Felder sind unvollständig oder mehrfach vorhanden.",
        {
          objektNrExternCount: external.length,
          openImmoObidCount: openImmo.length,
          kennungUrsprungCount: origin.length,
        },
      );
    }
    const [externalId] = external;
    if (externalId !== openImmo[0] || externalId !== origin[0] || !HV_OBJECT_NUMBER_PATTERN.test(externalId)) {
      throw guardError(
        "Pre-FTPS-Prüfung blockiert: Die drei externen OpenImmo-ID-Felder müssen identisch und im Format 30460-N sein.",
        { externalId, openImmoObid: openImmo[0], kennungUrsprung: origin[0] },
      );
    }
    objectNumbers.push(externalId);
  }
  return {
    diagnostics: {
      externalIdGuardValid: true,
      xmlFilename: xmlEntries[0].name,
      listingCount: blocks.length,
      objectNumbers,
    },
  };
}
