import {
  HV_OBJECT_NUMBER_MAX,
  HV_OBJECT_NUMBER_PATTERN,
  HV_OBJECT_NUMBER_PREFIX,
  isHvObjectNumber,
} from "./object-number-sequence.mjs";

export { HV_OBJECT_NUMBER_MAX, HV_OBJECT_NUMBER_PATTERN, HV_OBJECT_NUMBER_PREFIX, isHvObjectNumber };

export function createHvObjectNumber() {
  throw new Error("Neue externe Objektnummern müssen über die persistente globale 30460-Sequenz vergeben werden.");
}

export function objectNumberForListing(listing) {
  const current = String(listing?.externalId ?? "").trim();
  if (isHvObjectNumber(current)) return current;
  const error = new Error("Für dieses Inserat fehlt eine gültige externe Objektnummer 30460-N.");
  error.code = "EXTERNAL_OBJECT_NUMBER_REQUIRED";
  throw error;
}
