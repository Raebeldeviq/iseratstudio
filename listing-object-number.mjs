export const HV_OBJECT_NUMBER_PREFIX = "30460";
export const HV_OBJECT_NUMBER_PATTERN = /^30460-\d{6}$/u;

const OBJECT_NUMBER_SPACE = 1_000_000;

function stableNumber(value) {
  let hash = 2_166_136_261;
  for (const character of String(value ?? "")) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash;
}

function validConfirmedUploadDate(value) {
  const timestamp = String(value ?? "").trim();
  return Boolean(timestamp) && Number.isFinite(Date.parse(timestamp));
}

export function isHvObjectNumber(value) {
  return HV_OBJECT_NUMBER_PATTERN.test(String(value ?? "").trim());
}

/**
 * Erzeugt eine reproduzierbare sechsstellige Objektnummer. Ein übergebener
 * Set wird zugleich reserviert, sodass ein gemeinsamer Erzeugungslauf keine
 * doppelte Nummer ausgeben kann.
 */
export function createHvObjectNumber(seed, reservedObjectNumbers = new Set()) {
  const reserved = reservedObjectNumbers instanceof Set
    ? reservedObjectNumbers
    : new Set(reservedObjectNumbers ?? []);
  const firstSuffix = stableNumber(seed) % OBJECT_NUMBER_SPACE;

  for (let offset = 0; offset < OBJECT_NUMBER_SPACE; offset += 1) {
    const suffix = String((firstSuffix + offset) % OBJECT_NUMBER_SPACE).padStart(6, "0");
    const objectNumber = `${HV_OBJECT_NUMBER_PREFIX}-${suffix}`;
    if (reserved.has(objectNumber)) continue;
    reserved.add(objectNumber);
    return objectNumber;
  }

  throw new Error("Der sechsstellige Objektnummernkreis ist vollständig belegt.");
}

/**
 * Korrekte HV-Nummern bleiben stabil. Bereits nachweislich hochgeladene
 * Alt-Nummern werden aus Kompatibilitätsgründen ebenfalls nicht verändert.
 * Nur neue beziehungsweise noch nicht hochgeladene Entwürfe erhalten das
 * aktuelle Schema 30460-XXXXXX.
 */
export function objectNumberForListing(listing, seed, reservedObjectNumbers = new Set()) {
  const current = String(listing?.externalId ?? "").trim();
  if (isHvObjectNumber(current) || (current && validConfirmedUploadDate(listing?.lastUploadedAt))) {
    reservedObjectNumbers.add?.(current);
    return current;
  }
  return createHvObjectNumber(seed || listing?.id, reservedObjectNumbers);
}
