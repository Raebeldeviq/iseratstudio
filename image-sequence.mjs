export const IMAGE_ROLE_VALUES = [
  "promotion",
  "cover",
  "kitchen",
  "bathroom",
  "bedroom",
  "kids",
  "living",
  "office",
  "emotion",
  "floorplan_ground",
  "floorplan_upper",
  "floorplan_third",
  "awards",
  "trust",
  "qr",
  "other",
];

export const INTERIOR_IMAGE_ROLES = [
  "kitchen",
  "bathroom",
  "bedroom",
  "kids",
  "living",
  "office",
];

export const IMAGE_ROLE_LABELS = {
  promotion: "Aktionsbild",
  cover: "Titelbild Haus",
  kitchen: "Küche",
  bathroom: "Bad",
  bedroom: "Schlafzimmer",
  kids: "Kinderzimmer",
  living: "Wohnzimmer",
  office: "Büro",
  emotion: "Emotionaler Catch",
  floorplan_ground: "Grundriss Erdgeschoss",
  floorplan_upper: "Grundriss Ober-/Dachgeschoss",
  floorplan_third: "Grundriss dritte Etage",
  awards: "Auszeichnungen",
  trust: "Vertrauensbild",
  qr: "QR-Abschluss",
  other: "Sonstiges",
};

export const TITLE_IMAGE_CAPTIONS = [
  "Dein wundervolles Zuhause",
  "Dein schönes Zuhause",
  "Dein neues Zuhause",
];

const FIXED_CAPTIONS = {
  kitchen: "Deine 5* Küche",
  bathroom: "Dein Spa",
  bedroom: "Deine Ruhezone",
  kids: "Der Entwicklungsraum",
  living: "Setz dich und ruh dich aus",
  office: "Work-Life Balance",
  emotion: "Hier beginnt dein Zuhause",
  floorplan_ground: "Dein Erdgeschoss",
  floorplan_upper: "Dein Obergeschoss",
  floorplan_third: "Dein Dachgeschoss",
  awards: "Ausgezeichnet gebaut",
  trust: "Bestens beraten",
  qr: "Jetzt starten!",
};

const ROLE_RANK = {
  promotion: 0,
  cover: 10,
  kitchen: 20,
  bathroom: 20,
  bedroom: 20,
  kids: 20,
  living: 20,
  office: 20,
  emotion: 30,
  floorplan_ground: 40,
  floorplan_upper: 41,
  floorplan_third: 42,
  awards: 50,
  trust: 60,
  qr: 70,
  other: 80,
};

const REQUIRED_STANDARD_ROLES = [
  "cover",
  ...INTERIOR_IMAGE_ROLES,
  "emotion",
  "floorplan_ground",
  "awards",
  "trust",
  "qr",
];

const KNOWN_ROOF_BY_VARIANT = {
  "SUN112:V1": "FD",
  "SUN112:V2": "SD",
};

function normalized(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("de-DE")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function floorplanLevel(value) {
  const text = ` ${normalized(value)} `;
  if (/\b(?:eg|eg1|erdgeschoss)\b/.test(text)) return "ground";
  if (/\b(?:og|og1|obergeschoss)\b/.test(text)) return "upper";
  if (/\b(?:dg|dachgeschoss)\b/.test(text)) return "attic";
  return "";
}

export function inferImageRole({
  filename = "",
  relativePath = "",
  kind = "",
  role = "",
  isFloorplan = false,
} = {}) {
  if (IMAGE_ROLE_VALUES.includes(role)) return role;
  const text = normalized(`${filename} ${relativePath}`);
  if (kind === "floorplan" || isFloorplan || /grundriss/.test(text)) {
    const level = floorplanLevel(text);
    if (level === "upper" || level === "attic") return "floorplan_upper";
    return "floorplan_ground";
  }
  if (/hier beginnt dein zuhause/.test(text)) return "emotion";
  if (/ausgezeichnet gebaut|hausbau design award|musterhaus report|crefozert|zertifikat|zertifizierung/.test(text)) return "awards";
  if (/bestens beraten|beratung|vertrauen|familie/.test(text)) return "trust";
  if (/jetzt starten|qr code|qr/.test(text)) return "qr";
  if (/deine 5 kuche|kueche|kuche|kitchen/.test(text)) return "kitchen";
  if (/dein spa|badezimmer|bad |bathroom|dusche/.test(`${text} `)) return "bathroom";
  if (/deine ruhezone|schlafzimmer|schlaf|bedroom/.test(text)) return "bedroom";
  if (/entwicklungsraum|raum zum wachsen|kinderzimmer|kinder|kids|kizi/.test(text)) return "kids";
  if (/setz dich|wohnzimmer|wohnen|interieur|living|lounge/.test(text)) return "living";
  if (/work life balance|arbeitszimmer|buro|office/.test(text)) return "office";
  if (kind === "house" || /titelbild|hausansicht|aussenansicht/.test(text)) return "cover";
  return "other";
}

export function captionForImageRole(role, filename = "", fallback = "") {
  if (role === "cover") {
    return TITLE_IMAGE_CAPTIONS.includes(fallback) ? fallback : TITLE_IMAGE_CAPTIONS[0];
  }
  if (role === "floorplan_upper" && floorplanLevel(filename) === "attic") {
    return "Dein Dachgeschoss";
  }
  return FIXED_CAPTIONS[role] || fallback;
}

export function isFixedCaptionRole(role) {
  return Boolean(FIXED_CAPTIONS[role]);
}

export function imageRoleRank(image) {
  const role = inferImageRole(image);
  return ROLE_RANK[role] ?? ROLE_RANK.other;
}

export function orderHouseImages(images) {
  return images
    .map((image, index) => ({ image, index, rank: imageRoleRank(image) }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(({ image }) => image);
}

export function parseHouseVariant(value) {
  const source = String(value || "").toLocaleUpperCase("de-DE");
  const familyMatch = source.match(/(?:^|[^A-Z0-9])(SUN(?:SHINE)?|SOL(?:UTION)?)[^0-9]{0,40}0*(\d{2,3})(?=[^0-9]|$)/);
  if (!familyMatch) return null;
  const family = familyMatch[1].startsWith("SUN") ? "SUN" : "SOL";
  const model = String(Number(familyMatch[2]));
  const versionMatch = source.match(/(?:^|[^A-Z0-9])V(?:ERSION)?[\s_-]*0*(\d{1,2})(?=[^0-9]|$)/);
  const roofMatch = source.match(/(?:^|[^A-Z0-9])(SD2?|WD|FD|PD)(?=[^A-Z0-9]|$)/);
  return {
    family,
    model,
    modelKey: `${family}${model}`,
    version: versionMatch ? `V${Number(versionMatch[1])}` : "",
    roof: roofMatch?.[1] || "",
  };
}

function mediaPreference(left, right) {
  const copyPenalty = (item) => (/\(\d+\)/.test(item.filename || "") ? 10 : 0);
  const interiorPenalty = (item) => (item.collection === "Inneneinrichtung" ? 0 : 1);
  const difference = copyPenalty(left) - copyPenalty(right)
    || interiorPenalty(left) - interiorPenalty(right);
  if (difference) return difference;
  return String(left.relativePath || left.filename)
    .localeCompare(String(right.relativePath || right.filename), "de", { numeric: true });
}

function firstRoleItem(items, role) {
  return items
    .filter((item) => inferImageRole(item) === role)
    .sort(mediaPreference)[0] || null;
}

function matchingFloorplans(cover, items) {
  const coverVariant = parseHouseVariant(`${cover.filename} ${cover.relativePath || ""}`);
  if (!coverVariant) {
    return {
      items: [],
      warnings: ["Haustyp und Version konnten aus dem Titelbild nicht erkannt werden."],
    };
  }

  const matchingRoof = coverVariant.roof
    || KNOWN_ROOF_BY_VARIANT[`${coverVariant.modelKey}:${coverVariant.version}`]
    || "";
  let usedVersionlessFallback = false;
  let candidates = items
    .filter((item) => item.kind === "floorplan")
    .map((item) => ({
      item,
      variant: parseHouseVariant(`${item.filename} ${item.relativePath || ""}`),
    }))
    .filter(({ variant }) => variant?.modelKey === coverVariant.modelKey);

  if (coverVariant.version) {
    const exactVersion = candidates.filter(({ variant }) => variant.version === coverVariant.version);
    if (exactVersion.length) {
      candidates = exactVersion;
    } else {
      candidates = candidates.filter(({ variant }) => !variant.version);
      usedVersionlessFallback = true;
    }
  } else {
    const versionless = candidates.filter(({ variant }) => !variant.version);
    if (versionless.length) candidates = versionless;
  }

  if (matchingRoof) {
    const exactRoof = candidates.filter(({ variant }) => variant.roof === matchingRoof);
    if (exactRoof.length) candidates = exactRoof;
  }

  const roofTypes = new Set(candidates.map(({ variant }) => variant.roof).filter(Boolean));
  if (!matchingRoof && (!coverVariant.version || usedVersionlessFallback) && roofTypes.size > 1) {
    return {
      items: [],
      warnings: [
        `Für ${coverVariant.family} ${coverVariant.model} existieren mehrere Dachvarianten. Bitte eine eindeutig bezeichnete Hausansicht wählen.`,
      ],
    };
  }

  const byLevel = { ground: [], upper: [], attic: [] };
  for (const candidate of candidates) {
    const level = floorplanLevel(candidate.item.filename);
    if (level) byLevel[level].push(candidate.item);
  }
  for (const level of Object.keys(byLevel)) byLevel[level].sort(mediaPreference);

  const selected = [];
  if (byLevel.ground[0]) selected.push({ ...byLevel.ground[0], role: "floorplan_ground" });
  if (byLevel.upper[0]) selected.push({ ...byLevel.upper[0], role: "floorplan_upper" });
  if (byLevel.attic[0]) {
    selected.push({
      ...byLevel.attic[0],
      role: byLevel.upper[0] ? "floorplan_third" : "floorplan_upper",
    });
  }

  const warnings = [];
  if (!selected.some((item) => item.role === "floorplan_ground")) {
    warnings.push(`Kein eindeutiger Erdgeschoss-Grundriss für ${coverVariant.family} ${coverVariant.model} gefunden.`);
  }
  const isSolutionBungalow = coverVariant.family === "SOL"
    && ["82", "101", "107", "110"].includes(coverVariant.model);
  if (!isSolutionBungalow && !selected.some((item) => item.role === "floorplan_upper")) {
    warnings.push(`Kein eindeutiger Ober- oder Dachgeschoss-Grundriss für ${coverVariant.family} ${coverVariant.model} gefunden.`);
  }
  return { items: selected, warnings };
}

function preparedMediaItem(item, role, caption) {
  return {
    ...item,
    role,
    caption: captionForImageRole(role, item.filename, caption || item.caption),
    captionLocked: isFixedCaptionRole(role),
  };
}

export function buildRecommendedMediaSequence(coverId, items) {
  const cover = items.find((item) => item.id === String(coverId || ""));
  if (!cover || cover.kind !== "house") {
    return { items: [], warnings: ["Bitte genau eine Hausansicht als Titelbild auswählen."] };
  }
  if (cover.brandedCover === false) {
    return {
      items: [],
      warnings: ["Bitte die PNG-Hausansicht mit Logo und eindeutiger SUN-/SOL-Version auswählen."],
    };
  }

  const sequence = [preparedMediaItem(cover, "cover", TITLE_IMAGE_CAPTIONS[0])];
  const warnings = [];
  for (const role of INTERIOR_IMAGE_ROLES) {
    const item = firstRoleItem(items, role);
    if (item) sequence.push(preparedMediaItem(item, role));
    else warnings.push(`${IMAGE_ROLE_LABELS[role]} fehlt in der Medienbibliothek.`);
  }

  const emotion = firstRoleItem(items, "emotion");
  if (emotion) sequence.push(preparedMediaItem(emotion, "emotion"));
  else warnings.push("Das emotionale Abschlussbild fehlt.");

  const floorplans = matchingFloorplans(cover, items);
  sequence.push(...floorplans.items.map((item) => preparedMediaItem(item, item.role)));
  warnings.push(...floorplans.warnings);

  for (const role of ["awards", "trust", "qr"]) {
    const item = firstRoleItem(items, role);
    if (item) sequence.push(preparedMediaItem(item, role));
    else warnings.push(`${IMAGE_ROLE_LABELS[role]} fehlt in der Medienbibliothek.`);
  }

  return { items: sequence, warnings };
}

export function imageSequenceIssues(images, {
  requiresUpperFloor = false,
  requiresThirdFloor = false,
  maximumImages = 14,
} = {}) {
  const explicitlyClassified = images.some((image) => (
    IMAGE_ROLE_VALUES.includes(image.role) && !["promotion", "other"].includes(image.role)
  ));
  if (!explicitlyClassified) return [];

  const roles = images.map((image) => inferImageRole(image));
  const required = [
    ...REQUIRED_STANDARD_ROLES,
    ...(requiresUpperFloor ? ["floorplan_upper"] : []),
    ...(requiresThirdFloor ? ["floorplan_third"] : []),
  ];
  const issues = [];
  for (const role of required) {
    const count = roles.filter((value) => value === role).length;
    if (count === 0) issues.push(`${IMAGE_ROLE_LABELS[role]} fehlt.`);
    if (count > 1) issues.push(`${IMAGE_ROLE_LABELS[role]} ist ${count}-mal vorhanden.`);
  }
  if (images.length > maximumImages) {
    issues.push(`Die Bildfolge enthält ${images.length} statt maximal ${maximumImages} Bilder.`);
  }
  const ranks = images
    .map((image) => imageRoleRank(image))
    .filter((rank) => rank < ROLE_RANK.other);
  if (ranks.some((rank, index) => index > 0 && rank < ranks[index - 1])) {
    issues.push("Die Bildrollen stehen nicht in der vorgesehenen Reihenfolge.");
  }
  return issues;
}
