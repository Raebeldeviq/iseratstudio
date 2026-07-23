const STOP_WORDS = new Set([
  "am",
  "an",
  "auf",
  "aus",
  "bei",
  "das",
  "dein",
  "deine",
  "der",
  "die",
  "ein",
  "eine",
  "euer",
  "eure",
  "für",
  "im",
  "in",
  "ist",
  "mit",
  "und",
  "vom",
  "von",
  "zu",
  "zum",
  "zur",
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizedHeadline(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("de-DE")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function removePrivateAddressFromHeadline(value, project = {}) {
  let result = String(value ?? "");
  for (const privateValue of [project.street, project.zip, project.houseNumber]) {
    const text = String(privateValue ?? "").trim();
    if (!text) continue;
    result = result.replace(
      new RegExp(`(^|\\W)${escapeRegExp(text)}(?=$|\\W)`, "giu"),
      "$1",
    );
  }
  return result.replace(/\s{2,}/g, " ").trim();
}

function meaningfulWords(value) {
  return normalizedHeadline(value)
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
}

function jaccardSimilarity(leftWords, rightWords) {
  const left = new Set(leftWords);
  const right = new Set(rightWords);
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const word of left) if (right.has(word)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

export function headlineSimilarity(left, right) {
  const normalizedLeft = normalizedHeadline(left);
  const normalizedRight = normalizedHeadline(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;

  const leftWords = meaningfulWords(left);
  const rightWords = meaningfulWords(right);
  const wordScore = jaccardSimilarity(leftWords, rightWords);
  const shorter = leftWords.length <= rightWords.length ? leftWords : rightWords;
  const longer = leftWords.length <= rightWords.length ? rightWords : leftWords;
  const containedWords = shorter.length
    ? shorter.filter((word) => longer.includes(word)).length / shorter.length
    : 0;
  return Math.max(wordScore, containedWords >= 0.75 && shorter.length >= 2 ? containedWords : 0);
}

export function headlinesAreTooSimilar(left, right) {
  return headlineSimilarity(left, right) >= 0.6;
}
