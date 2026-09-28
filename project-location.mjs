/**
 * Verified place/district pairs. Unknown composite names remain untouched.
 * A ZIP, when supplied, must agree with the documented pair.
 */
const VERIFIED_DISTRICTS = Object.freeze([
  Object.freeze({ label: /^Potsdam\s*-\s*Stern$/iu, zip: "14480", city: "Potsdam", district: "Stern" }),
  Object.freeze({ label: /^Potsdam\s*-\s*Bornstedt$/iu, zip: "14469", city: "Potsdam", district: "Bornstedt" }),
  Object.freeze({ label: /^Potsdam\s*-\s*Drewitz$/iu, zip: "14480", city: "Potsdam", district: "Drewitz" }),
  Object.freeze({ label: /^Potsdam(?:\s*-\s*|\s+)Groß Glienicke$/iu, zip: "14476", city: "Potsdam", district: "Groß Glienicke" }),
  Object.freeze({ label: /^Berlin\s*-\s*Rudow$/iu, zip: "12355", city: "Berlin", district: "Rudow" }),
  Object.freeze({ label: /^Berlin\s*-\s*Zehlendorf$/iu, zip: "14165", city: "Berlin", district: "Zehlendorf" }),
  Object.freeze({ label: /^Werder\s*\(Havel\)\s*,\s*Phöben$/iu, zip: "14542", city: "Werder (Havel)", district: "Phöben" }),
  Object.freeze({ label: /^Werder\s*\(Havel\)\s*,\s*Töplitz$/iu, zip: "14542", city: "Werder (Havel)", district: "Töplitz" }),
  Object.freeze({ label: /^Kloster Lehnin\s*-\s*Damsdorf$/iu, zip: "14797", city: "Kloster Lehnin", district: "Damsdorf" }),
]);

const VERIFIED_CITY_ALIASES = Object.freeze([
  Object.freeze({ label: /^Werder$/iu, zip: "14542", city: "Werder (Havel)" }),
]);

function clean(value) {
  return String(value ?? "").trim();
}

export function resolveProjectLocation(project = {}) {
  const rawCity = clean(project.city);
  const explicitDistrict = clean(project.district);
  const zip = clean(project.zip ?? project.postalCode);
  const known = VERIFIED_DISTRICTS.find((entry) =>
    entry.label.test(rawCity) && (!zip || zip === entry.zip));
  if (!known) {
    const alias = VERIFIED_CITY_ALIASES.find((entry) =>
      entry.label.test(rawCity) && (!zip || zip === entry.zip));
    return {
      city: alias?.city || rawCity,
      district: explicitDistrict,
      source: explicitDistrict ? "structured" : alias ? "verified_mapping" : "unresolved",
    };
  }
  if (explicitDistrict && explicitDistrict.toLocaleLowerCase("de-DE") !== known.district.toLocaleLowerCase("de-DE")) {
    return { city: rawCity, district: explicitDistrict, source: "conflict" };
  }
  return { city: known.city, district: explicitDistrict || known.district, source: explicitDistrict ? "structured" : "verified_mapping" };
}

export function listingLocationLabel(project = {}) {
  const { city, district } = resolveProjectLocation(project);
  if (!city) return district || "deinem Wunschort";
  if (!district) return city;
  if (district.toLocaleLowerCase("de-DE").startsWith(city.toLocaleLowerCase("de-DE"))) return district;
  return `${city}-${district}`;
}
