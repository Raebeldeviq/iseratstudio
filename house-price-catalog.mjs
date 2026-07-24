const PRICE_ENTRIES = [
  { key: "SOL82", label: "SOL 082", price: 325_931, houseType: "Bungalow" },
  { key: "SOL101", label: "SOL 101", price: 371_065, houseType: "Bungalow" },
  { key: "SOL107", label: "SOL 107", price: 388_878, houseType: "Bungalow" },
  { key: "SOL110", label: "SOL 110", price: 386_578, houseType: "Bungalow" },
  { key: "SOL117L", label: "SOL 117 L", price: 370_736, houseType: "Doppelhaushälfte" },
  { key: "SOL117XL", label: "SOL 117 XL", price: 470_310, houseType: "Doppelhaushälfte" },
  { key: "SOL124L", label: "SOL 124 L", price: 370_542, houseType: "Doppelhaushälfte" },
  { key: "SOL125L", label: "SOL 125 L", price: 378_568, houseType: "Doppelhaushälfte" },
  { key: "SOL125XL", label: "SOL 125 XL", price: 483_864, houseType: "Doppelhaushälfte" },
  { key: "SUN125", label: "SUN 125", price: 362_591, houseType: "Einfamilienhaus" },
  { key: "SUN126", label: "SUN 126", price: 365_073, houseType: "Einfamilienhaus" },
  { key: "SUN130", label: "SUN 130", price: 386_555, houseType: "Einfamilienhaus" },
  { key: "SUN136", label: "SUN 136", price: 380_360, houseType: "Einfamilienhaus" },
  { key: "SUN142", label: "SUN 142", price: 397_330, houseType: "Einfamilienhaus" },
  { key: "SUN143", label: "SUN 143", price: 389_533, houseType: "Einfamilienhaus" },
  { key: "SUN144", label: "SUN 144", price: 399_539, houseType: "Einfamilienhaus" },
  { key: "SUN151", label: "SUN 151", price: 409_437, houseType: "Einfamilienhaus" },
  { key: "SUN154", label: "SUN 154", price: 421_674, houseType: "Einfamilienhaus" },
  { key: "SUN157", label: "SUN 157", price: 407_521, houseType: "Einfamilienhaus" },
  { key: "SUN164", label: "SUN 164", price: 437_270, houseType: "Einfamilienhaus" },
  { key: "SUN165", label: "SUN 165", price: 426_931, houseType: "Einfamilienhaus" },
  { key: "SUN167", label: "SUN 167", price: 437_171, houseType: "Einfamilienhaus" },
  { key: "SUN168", label: "SUN 168", price: 437_065, houseType: "Einfamilienhaus" },
  { key: "SUN210", label: "SUN 210", price: 508_654, houseType: "Einfamilienhaus" },
  { key: "SOL194", label: "SOL 194", price: 581_836, houseType: "Zweifamilienhaus" },
  { key: "SOL204L", label: "SOL 204 L", price: 573_427, houseType: "Zweifamilienhaus" },
  { key: "SOL229", label: "SOL 229", price: 623_997, houseType: "Zweifamilienhaus" },
  { key: "SOL230", label: "SOL 230", price: 629_138, houseType: "Zweifamilienhaus" },
  { key: "SOL242", label: "SOL 242", price: 655_971, houseType: "Zweifamilienhaus" },
];

export const HOUSE_PRICE_CATALOG = Object.freeze(
  Object.fromEntries(
    PRICE_ENTRIES.map((entry) => [entry.key, Object.freeze({ ...entry })]),
  ),
);

function identifiers(value) {
  const source = String(value || "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleUpperCase("de-DE");
  const matches = [];
  const expression = /(?:SUN(?:SHINE)?|SOL(?:UTION)?)[\s_-]*0*(\d{2,3})(?!\d)(?:[\s_-]*(XL|L))?/g;
  for (const match of source.matchAll(expression)) {
    const family = match[0].startsWith("SUN") ? "SUN" : "SOL";
    const model = String(Number(match[1]));
    const size = match[2] || "";
    matches.push({ family, model, size, key: `${family}${model}${size}` });
  }
  return matches;
}

function matchDetails(entry) {
  return entry ? { ...entry } : null;
}

/**
 * Image versions such as V2 or V5 are ignored. L and XL remain separate models;
 * ambiguous identifiers are never guessed.
 */
export function resolveHousePrice(values) {
  const parsed = (Array.isArray(values) ? values : [values]).flatMap(identifiers);
  if (!parsed.length) return null;

  const exactKeys = [...new Set(
    parsed.map((identifier) => identifier.key).filter((key) => HOUSE_PRICE_CATALOG[key]),
  )];
  if (exactKeys.length === 1) return matchDetails(HOUSE_PRICE_CATALOG[exactKeys[0]]);
  if (exactKeys.length > 1) {
    const sizedKeys = exactKeys.filter((key) => /(?:XL|L)$/.test(key));
    if (sizedKeys.length === 1) return matchDetails(HOUSE_PRICE_CATALOG[sizedKeys[0]]);
    return null;
  }

  const modelKeys = [...new Set(parsed.map(({ family, model }) => `${family}${model}`))];
  if (modelKeys.length !== 1) return null;
  const entries = PRICE_ENTRIES.filter(
    (entry) => entry.key.replace(/(?:XL|L)$/, "") === modelKeys[0],
  );
  return entries.length === 1 ? matchDetails(entries[0]) : null;
}

export function housePriceCatalogEntries() {
  return PRICE_ENTRIES.map((entry) => ({ ...entry }));
}
