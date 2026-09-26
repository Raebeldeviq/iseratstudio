import { createHash, randomUUID } from "node:crypto";
import { constants as fileSystemConstants } from "node:fs";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { generateListingTexts } from "./app/lib/text-generator.ts";
import {
  CATALOG_V2_DIRECTORY,
  commitCatalogSnapshot,
  discardCatalogSnapshot,
  loadCatalogManifest,
  startCatalogSnapshot,
} from "./catalog-store.mjs";
import { cleanupStudioState } from "./data-integrity.mjs";
import {
  FIXED_DESCRIPTION_CTA,
  FIXED_DESCRIPTION_FINANCING,
  STATIC_COPY_SOURCE,
  STATIC_COPY_VERSION,
  createStandardStaticCopy,
} from "./listing-copy.mjs";
import {
  LISTING_FIXED_COPY_TREATMENT,
  planListingFixedCopyPreview,
} from "./listing-fixed-copy-preview.mjs";
import { APPLICATION_DATA_DIRECTORY } from "./platform-paths.mjs";
import { scanPhase2BClaims } from "./phase2b-claim-scan.mjs";
import { applyPhase2BSafeCleanup } from "./phase2b-safe-cleanup.mjs";

export const CURRENT_CATALOG_COPY_REMEDIATION_BACKUP_DIRECTORY = join(
  APPLICATION_DATA_DIRECTORY,
  "current-catalog-copy-remediation-backups",
);

export const CURRENT_CATALOG_COPY_REMEDIATION_TARGETS = Object.freeze([
  ["de488907-fae6-4474-9a09-e7327609198c", "8aba6df45bb6a98bb8d5042dfa90ec172d9302590f84244c07e4bcb005767acd", "a6adafb8425245dde1c18dc9a1de0ed63a0da573101aa499e0578b03dab852dc", false],
  ["988701e7-c34e-45ee-ac93-e513d797cad1", "b19c29cf0507d5a4954bfca26ec3a602992b26e48fa0bd71aedbaa7521cba6d9", "6098eb6c63a9f964d5f460be8d4b3684f513ed3101de58600c1e27db43d42bea", false],
  ["0bcf2630-bd49-4eb4-93a0-47bdba830b23", "84437348614c43d6fed25b00c6a2abcd9a80196dfee8d177f4f2289986567d5d", "d7c5e8e06e13cb2cb73f266f35da8a264f9e7354dcc9bc3677c6f3f32b58bef0", false],
  ["f9362236-f18a-479b-b4a8-69f591dde627", "023e8ffe76f2f92acea8928f8190b02bfeb63202801c39fdd228ae421feacadb", "3f9bc013c04e73c2c8674cd1531a6ea1428d8901d8f02e9c8ce1f9adfa171c80", false],
  ["5e8b1fba-38af-407c-b4f3-50c2482ea1c2", "59326fc3cf4cc149e010dcae9da7c781ffef2cffe478b4400d15573b6e5acb8a", "75406dce0ab31d81d68bf19b3f9af58c8f03bf9bb0bc9766efbcd757310298e5", true],
  ["ce522536-d43d-4f00-b2a5-597745c62c5f", "6d0956ecc9d88ee8434acf1cf09072982bd968dcfca04c1307ce3be4614d3965", "2f6182022c54dcbb7b6430930132b406b3523822da492a660d1b2f198eb01a46", false],
  ["0f9c81ad-dea3-4039-abfa-bb21785031dd", "ecfe4dba041d77f822c072dada4417a0763ae48a1cc85821ed8904e4e29b270d", "99fd2133dfd30aa44439c6699ecfcffd05f17412181cbfd41a642f59c1d30e0b", false],
  ["ec34b875-35d2-4fe3-bceb-e919a3bb2b5f", "25044d86ce0271de2ca01aaf85ec1efc6a995b276a8946d47eb3ddcd80dfa95e", "54e3fd84ba5edf327cf9599a69e5cf78cd002fd2f2fa97cfcff2411533f87b2f", false],
  ["78409d6d-4d86-4c21-a509-91a655f05f76", "ca08e88ec0003843b807672d42336c86b68aca0df5753422b0ee642a1b84ef96", "7864c4686e70a1835930321e4c7f49c6e92d48d54499f5288e8455ab4edc3b95", false],
  ["d37a9f5c-97a4-4b49-a4c9-a64c1f9bdb91", "670e8405a14ee32ab0c7353df369987de6f679331419e773327ab78963b2366e", "b1f4c08d128cfb51f4c6840af22e6ea6219c2adea1cff5c6a9bc242103d9b1c3", false],
  ["82e5ced9-e83e-4d63-90ea-bc986f0f2563", "dc75d88854874a6f98b4f7bb97faf335df37fe849e4b40f83c3e01b5f502a4ec", "7381d67c7246b3e5b74aff8a2030907b50fbca76005bd226f7038fef37504d92", true],
  ["50d6e98a-2c64-4fce-824f-f616f03d10e1", "0747fad41ecdf1d7bf1a8ae62841dfd775c94aa20357c940b1179b5b3e89a2ad", "85b1957a6b2ecac575797a997ebcd60202a4893b483a054ec1f3da6dbcc4bd1c", false],
  ["33c8f582-bbed-445b-aca3-df31ed7a0052", "1ec5cd005d0638f63677cf87aafc3f2829a95967396e749da6dbb95643371936", "021d62ea5cfcfe1ed619afb4366caf478e80fd43273aa9feb830b33ed8f138e9", false],
  ["03f661a6-3d12-449f-9b26-26b90af5014d", "c38406d78981a53f4c5799e984f657b4e23b7151481774ae50990ae1f29126ca", "46a290bcaab4ca4ea6f29f961a29a81868f7d126d39d76699852abba7aa76d3c", false],
  ["85ba29f8-7813-4341-9b48-38b65e09bbc6", "44ca5a87791c6b7ab22734b37608d51a16b3d2dbb19717513de7fc4355b2a5db", "b78a66329431cb81b7c41fa635a4b1453d540abea088fce9e132798f222fe51a", false],
  ["39162bc6-8c28-42df-9b74-669d20cddd0e", "a4b01005b35ffd733908c2e7d44aa8f5c718532657130b9a7f5ff1a706ca0a5b", "da8f5430ee68aecf86013e4f3b6ec9b5ee704ad62f6d772c79c5e6bb42c30379", true],
  ["54673569-5e5d-4937-bcf6-3b01d1468b35", "8c1478db5531f704c3d4a67bef9dcef1952ffcc0b021dc50f254bc87f9144903", "28613734ac5b1e3bbf1ce65e416257639b11a3870a84448a89660a70b9e27228", false],
  ["1ab29656-81c5-46bd-9144-91c18ffacb91", "f49a615d7eb8808fa9f431522951df062efc66a394aa8f3bddd612bce177ab07", "d0d7816c3066c1b9a9afd4560c1f0aa6f1dc4d6f93113b91674aa1ee3c213c49", true],
  ["b53fcf18-f037-4eab-bbe1-0e7a2e05cd7b", "0aaf67facd895c3e0f21ce9ad2166479326c3897ff143900546ef6d6c8b8c3b6", "e334835b187fbbe967ae7781fb9a9f8913d93e4f17158a85bec8e16880a38bbf", true],
  ["a3d0f194-8045-412f-acfe-9df33cf9ca42", "e761dd3c9a0205498f0f63dc530bd76ac8d6702216009006e3cd72e39652102f", "d9f8179d4af6f94536d6c8e441e5fcee63bc50b104eb41ee1c7038a0e7438456", false],
].map(([listingId, descriptionHash, titleHash, replaceTitle]) => Object.freeze({ listingId, descriptionHash, titleHash, replaceTitle })));

const EXPECTED_ACTIVE_LISTING_IDS = Object.freeze([
  "10cf6bad-d842-484b-9dc3-d1c434320878",
  "2b72cf5c-6d1c-4f3a-ae3e-37abc90d1767",
  "f451d1a8-8718-4227-8e5b-4ce3b31ca6df",
  "afd0beea-f465-4b22-99fc-83ee7f74c24d",
  ...CURRENT_CATALOG_COPY_REMEDIATION_TARGETS.map((target) => target.listingId),
].sort());

const DEFAULT_EXPECTED = Object.freeze({
  activeListings: 24,
  affectedListings: 20,
  blockClaims: 245,
  reviewClaims: 0,
  safeFields: 20,
  staticChanges: 100,
  descriptions: 20,
  titles: 5,
});

function sha256(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function wordCount(value) {
  return String(value ?? "").trim().split(/\s+/u).filter(Boolean).length;
}

function activeContexts(state) {
  const houses = new Map((state.houses || []).map((house) => [house.id, house]));
  return (state.projects || []).flatMap((project) => (project.listings || []).flatMap((listing) => {
    const status = String(listing.status || "").toLocaleLowerCase("de-DE");
    if (listing.rotationArchivedAt || new Set(["archived", "deleted"]).has(status)) return [];
    return [{ project, listing, house: houses.get(listing.templateId) }];
  }));
}

function normalizeTargets(targets) {
  return targets.map((target) => ({ ...target })).sort((left, right) => left.listingId.localeCompare(right.listingId));
}

function occurrences(value, part) {
  return String(value).split(part).length - 1;
}

function assertGeneratedDescription(description, listingId) {
  const words = wordCount(description);
  if (words < 220 || words > 300 || words > 350) throw new Error(`CURRENT_COPY_WORD_COUNT: ${listingId} enthält ${words} Wörter.`);
  if (occurrences(description, FIXED_DESCRIPTION_FINANCING) !== 1 || occurrences(description, FIXED_DESCRIPTION_CTA) !== 1) {
    throw new Error(`CURRENT_COPY_ENDING_COUNT: ${listingId} enthält Finanzierung oder CTA nicht exakt einmal.`);
  }
  if (/€|\b(?:Euro|Kaufpreis|Hauspreis|Grundstückspreis|Gesamtpreis|Angebotspreis)\b/iu.test(description)) {
    throw new Error(`CURRENT_COPY_PRICE: ${listingId} enthält einen Preisbezug.`);
  }
  if (/\bV\d+\b|\bV\d+\s+(?:Tag|Nacht)\b|\b(?:Tag|Nacht)\s+V\d+\b/iu.test(description)) {
    throw new Error(`CURRENT_COPY_VARIANT: ${listingId} enthält eine interne Variantenkennung.`);
  }
}

function applySafeStaticCopy(state, expectedChanges) {
  const preview = planListingFixedCopyPreview(state);
  const standards = createStandardStaticCopy();
  const contexts = new Map(activeContexts(state).map((context) => [context.listing.id, context]));
  let changed = 0;
  for (const row of preview.listings) {
    const context = contexts.get(row.listingId);
    for (const field of row.fields) {
      if (field.treatment !== LISTING_FIXED_COPY_TREATMENT.STANDARD_REPLACE_SAFE) continue;
      const target = new Set(["equipment", "other"]).has(field.field)
        ? (context.listing.texts ||= {})
        : (context.listing.staticTexts ||= {});
      target[field.field] = standards[field.field];
      (context.listing.staticCopySources ||= {})[field.field] = STATIC_COPY_SOURCE.STANDARD;
      context.listing.staticCopyVersion = STATIC_COPY_VERSION;
      changed += 1;
    }
  }
  if (changed !== expectedChanges || preview.counts.migrationCandidates !== expectedChanges) {
    throw new Error(`CURRENT_COPY_STATIC_SCOPE: Erwartet ${expectedChanges} sichere Standardfelder, gefunden ${changed}.`);
  }
  return { preview, changed };
}

function finalStateMatches(state, targets, expected) {
  const contexts = new Map(activeContexts(state).map((context) => [context.listing.id, context]));
  if (contexts.size !== expected.activeListings) return false;
  for (const target of targets) {
    const context = contexts.get(target.listingId);
    if (!context?.house) return false;
    const generated = generateListingTexts(context.house, context.project, state.provider || {}, context.listing.version || 1, context.listing.id);
    if (context.listing.texts?.description !== generated.description) return false;
    if (target.replaceTitle && context.listing.texts?.title !== generated.title) return false;
  }
  const preview = planListingFixedCopyPreview(state);
  const report = scanPhase2BClaims(state);
  return preview.counts.migrationCandidates === 0
    && report.severityCounts.BLOCK === 0
    && report.severityCounts.REVIEW === 0;
}

export function applyCurrentCatalogCopyRemediation(state, options = {}) {
  const targets = normalizeTargets(options.targets || CURRENT_CATALOG_COPY_REMEDIATION_TARGETS);
  const expected = { ...DEFAULT_EXPECTED, ...(options.expected || {}) };
  const expectedActiveIds = [...(options.expectedActiveListingIds || EXPECTED_ACTIVE_LISTING_IDS)].sort();
  if (finalStateMatches(state, targets, expected)) {
    return { state, changed: false, idempotent: true, targets, expected, finalReport: scanPhase2BClaims(state) };
  }

  const normalized = cleanupStudioState(state, { apply: true, now: options.now || new Date().toISOString() });
  if (normalized.report.actions && Object.values(normalized.report.actions).some((count) => count !== 0)) {
    throw new Error("CURRENT_COPY_NORMALIZATION_ACTIONS: Die Schema-Normalisierung würde zusätzliche Katalogbereinigungen ausführen.");
  }
  let nextState = normalized.state;
  const contexts = new Map(activeContexts(nextState).map((context) => [context.listing.id, context]));
  const activeIds = [...contexts.keys()].sort();
  if (!isDeepStrictEqual(activeIds, expectedActiveIds) || activeIds.length !== expected.activeListings) {
    throw new Error("CURRENT_COPY_ACTIVE_SCOPE: Der aktive 24er-Inseratumfang hat sich geändert.");
  }

  const initialReport = scanPhase2BClaims(nextState);
  if (initialReport.affectedListingCount !== expected.affectedListings
    || initialReport.severityCounts.BLOCK !== expected.blockClaims
    || initialReport.severityCounts.REVIEW !== expected.reviewClaims) {
    throw new Error("CURRENT_COPY_CLAIM_SCOPE: Der freigegebene Ausgangs-Claimscan hat sich geändert.");
  }
  const descriptionPlanIds = initialReport.fieldPlans
    .filter((plan) => plan.field === "Objektbeschreibung" && plan.severity === "BLOCK")
    .map((plan) => plan.listingId)
    .sort();
  const titlePlanIds = initialReport.fieldPlans
    .filter((plan) => plan.field === "Überschrift" && plan.severity === "BLOCK")
    .map((plan) => plan.listingId)
    .sort();
  const targetDescriptionIds = targets.map((target) => target.listingId).sort();
  const targetTitleIds = targets.filter((target) => target.replaceTitle).map((target) => target.listingId).sort();
  if (!isDeepStrictEqual(descriptionPlanIds, targetDescriptionIds)
    || !isDeepStrictEqual(titlePlanIds, targetTitleIds)) {
    throw new Error("CURRENT_COPY_FIELD_SCOPE: Die freigegebenen Beschreibungs- oder Überschriftenfelder haben sich geändert.");
  }
  for (const target of targets) {
    const context = contexts.get(target.listingId);
    if (!context?.house
      || sha256(context.listing.texts?.description) !== target.descriptionHash
      || sha256(context.listing.texts?.title) !== target.titleHash) {
      throw new Error(`CURRENT_COPY_HASH_SCOPE: ${target.listingId} wurde seit der Freigabe verändert.`);
    }
  }

  nextState = applyPhase2BSafeCleanup(nextState, { expectedSafeFieldCount: expected.safeFields }).state;
  const staticResult = applySafeStaticCopy(nextState, expected.staticChanges);
  let descriptions = 0;
  let titles = 0;
  const refreshed = new Map(activeContexts(nextState).map((context) => [context.listing.id, context]));
  for (const target of targets) {
    const context = refreshed.get(target.listingId);
    const generated = generateListingTexts(context.house, context.project, nextState.provider || {}, context.listing.version || 1, context.listing.id);
    assertGeneratedDescription(generated.description, target.listingId);
    context.listing.texts = { ...context.listing.texts, description: generated.description };
    descriptions += 1;
    if (target.replaceTitle) {
      context.listing.texts.title = generated.title;
      titles += 1;
    }
  }
  if (descriptions !== expected.descriptions || titles !== expected.titles) {
    throw new Error("CURRENT_COPY_DYNAMIC_SCOPE: Der freigegebene Textumfang wurde nicht exakt eingehalten.");
  }
  const finalReport = scanPhase2BClaims(nextState);
  if (finalReport.scannedListingCount !== expected.activeListings
    || finalReport.severityCounts.BLOCK !== 0
    || finalReport.severityCounts.REVIEW !== 0) {
    throw new Error(`CURRENT_COPY_FINAL_CLAIMS: ${finalReport.severityCounts.BLOCK} BLOCK / ${finalReport.severityCounts.REVIEW} REVIEW.`);
  }
  if (!finalStateMatches(nextState, targets, expected)) throw new Error("CURRENT_COPY_IDEMPOTENCE: Der Zielzustand ist nicht stabil.");
  return {
    state: nextState,
    changed: true,
    idempotent: false,
    targets,
    expected,
    initialReport,
    finalReport,
    normalizationReport: normalized.report,
    staticPreview: staticResult.preview,
    counts: { descriptions, titles, staticFields: staticResult.changed },
  };
}

function safeTimestamp(now) {
  const date = new Date(now);
  if (Number.isNaN(date.getTime())) throw new Error("Ungültiger Migrationszeitpunkt.");
  return date.toISOString().replaceAll(":", "-");
}

async function createBackup(catalogDirectory, backupDirectory, now) {
  const manifestPath = join(catalogDirectory, "manifest.json");
  const source = await readFile(manifestPath);
  const manifest = JSON.parse(source.toString("utf8"));
  if (manifest?.format !== 2 || !Array.isArray(manifest.state?.projects)) throw new Error("CURRENT_COPY_BACKUP_INVALID: Das Katalogmanifest ist ungültig.");
  await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
  const backupPath = join(backupDirectory, `manifest.pre-current-copy-remediation-${safeTimestamp(now)}.json`);
  await copyFile(manifestPath, backupPath, fileSystemConstants.COPYFILE_EXCL);
  const backup = await readFile(backupPath);
  if (sha256(source) !== sha256(backup)) throw new Error("CURRENT_COPY_BACKUP_HASH: Der Backup ist nicht bytegleich.");
  return { backupPath, bytes: source.length, hash: sha256(source), restorable: true };
}

function nextSavedAt(currentSavedAt, now) {
  return new Date(Math.max(Date.parse(currentSavedAt || "") + 1 || 0, Date.parse(now) || Date.now())).toISOString();
}

export async function runCurrentCatalogCopyRemediation(options = {}) {
  const catalogDirectory = options.catalogDirectory || CATALOG_V2_DIRECTORY;
  const now = options.now || new Date().toISOString();
  const load = options.loadCatalogManifest || loadCatalogManifest;
  const start = options.startCatalogSnapshot || startCatalogSnapshot;
  const commit = options.commitCatalogSnapshot || commitCatalogSnapshot;
  const discard = options.discardCatalogSnapshot || discardCatalogSnapshot;
  const current = await load(catalogDirectory);
  if (!current?.stored || !current.state) throw new Error("Der aktive Inseratkatalog ist nicht verfügbar.");
  const preview = applyCurrentCatalogCopyRemediation(current.state, { ...options, now });
  if (!preview.changed) return { changed: false, idempotent: true, finalReport: preview.finalReport };
  const backup = await createBackup(catalogDirectory, options.backupDirectory || CURRENT_CATALOG_COPY_REMEDIATION_BACKUP_DIRECTORY, now);
  const sessionId = `current-copy-remediation-${randomUUID()}`;
  try {
    const snapshot = await start({
      state: preview.state,
      sessionId,
      savedAt: nextSavedAt(current.savedAt, now),
      expectedSavedAt: current.savedAt,
    }, catalogDirectory);
    if (snapshot.missingImageIds.length) throw new Error(`CURRENT_COPY_IMAGES: ${snapshot.missingImageIds.length} Bilder fehlen.`);
    await commit(sessionId, catalogDirectory);
  } catch (error) {
    await discard(sessionId, catalogDirectory).catch(() => undefined);
    throw error;
  }
  const persisted = await load(catalogDirectory);
  const verification = applyCurrentCatalogCopyRemediation(persisted.state, { ...options, now });
  if (verification.changed || !verification.idempotent) throw new Error("CURRENT_COPY_PERSISTENCE: Der gespeicherte Zielzustand ist nicht idempotent.");
  return {
    changed: true,
    idempotent: false,
    backup,
    counts: preview.counts,
    initialSeverityCounts: preview.initialReport.severityCounts,
    finalSeverityCounts: verification.finalReport.severityCounts,
    persistedSavedAt: persisted.savedAt,
  };
}
