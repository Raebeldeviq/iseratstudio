export const HV_OBJECT_NUMBER_PREFIX = "30460";
export const HV_OBJECT_NUMBER_PATTERN = /^30460-(?:[1-9][0-9]{0,5}|0(?:0[1-9]|[1-9][0-9])(?:00[1-9]|0[1-9][0-9]|[1-9][0-9]{2}))$/u;
export const HV_OBJECT_NUMBER_MAX = 999_999;

function objectNumberValue(value) {
  const match = HV_OBJECT_NUMBER_PATTERN.exec(String(value ?? "").trim());
  return match ? Number(match[0].slice(`${HV_OBJECT_NUMBER_PREFIX}-`.length)) : 0;
}

function visit(value, seen, found) {
  if (typeof value === "string") {
    const number = objectNumberValue(value);
    if (number) found.add(number);
    return;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  for (const nested of Array.isArray(value) ? value : Object.values(value)) visit(nested, seen, found);
}

export function isHvObjectNumber(value) {
  return HV_OBJECT_NUMBER_PATTERN.test(String(value ?? "").trim());
}

export function highestPersistedObjectNumber(state) {
  const found = new Set();
  visit(state, new Set(), found);
  return found.size ? Math.max(...found) : 0;
}

export function normalizeObjectNumberSequence(state) {
  const stored = state?.objectNumberSequence;
  const storedNext = stored?.prefix === HV_OBJECT_NUMBER_PREFIX
    ? Math.trunc(Number(stored?.next))
    : 0;
  const next = Math.max(1, highestPersistedObjectNumber(state) + 1, storedNext || 0);
  if (next > HV_OBJECT_NUMBER_MAX + 1) {
    throw new Error("Der zulässige Objektnummernkreis 30460-1 bis 30460-999999 ist erschöpft.");
  }
  return { format: 1, prefix: HV_OBJECT_NUMBER_PREFIX, next };
}

export function allocateObjectNumbers(state, count = 1) {
  const requested = Math.trunc(Number(count));
  if (!Number.isInteger(requested) || requested < 1) {
    throw new Error("Mindestens eine externe Objektnummer muss angefordert werden.");
  }
  const sequence = normalizeObjectNumberSequence(state);
  const last = sequence.next + requested - 1;
  if (last > HV_OBJECT_NUMBER_MAX) {
    throw new Error("Der zulässige Objektnummernkreis 30460-1 bis 30460-999999 ist erschöpft.");
  }
  const objectNumbers = Array.from(
    { length: requested },
    (_, index) => `${HV_OBJECT_NUMBER_PREFIX}-${sequence.next + index}`,
  );
  return {
    objectNumbers,
    sequence: { ...sequence, next: last + 1 },
    state: { ...state, objectNumberSequence: { ...sequence, next: last + 1 } },
  };
}
