import { randomUUID } from "node:crypto";

import {
  CATALOG_V2_DIRECTORY,
  commitCatalogSnapshot,
  discardCatalogSnapshot,
  loadCatalogManifest,
  startCatalogSnapshot,
} from "./catalog-store.mjs";

export const CANARY_ENERGY_PASS_TARGET = Object.freeze({
  externalId: "FPI-E0B464-V1-A4810212",
  listingId: "a4810212-95d1-4850-99e6-1ce92056da43",
  templateId: "preset_house_sun113_v6",
  templateName: "SUN 113 V6",
  energyDemand: 18,
  energyClass: "A+",
  constructionYear: 2027,
});

const ENERGY_EVIDENCE_REFERENCE =
  "Vom Auftraggeber bestätigter Energiepass-Bestandswert des Canary FPI-E0B464-V1-A4810212 vom 2026-09-27";

function activeListings(state) {
  return (state.projects || []).flatMap((project) => (project.listings || []).filter((listing) => {
    const status = String(listing.status || "").toLocaleLowerCase("de-DE");
    return !listing.rotationArchivedAt && !new Set(["archived", "deleted"]).has(status);
  }));
}

function energyFact(key, value) {
  return {
    key,
    value: String(value),
    source: "project",
    scope: "house",
    status: "verified",
    verified: true,
    evidenceKind: "energy_certificate",
    evidenceReference: ENERGY_EVIDENCE_REFERENCE,
  };
}

function isTargetFact(fact, key) {
  return fact?.key === key && fact?.evidenceKind === "energy_certificate";
}

function assertExistingFact(facts, key, value) {
  const matches = facts.filter((fact) => isTargetFact(fact, key));
  if (!matches.length) return false;
  if (matches.length !== 1
    || String(matches[0].value) !== String(value)
    || matches[0].verified !== true
    || matches[0].status !== "verified") {
    throw new Error(`CANARY_ENERGY_CONFLICT: ${key} enthält einen abweichenden Energieausweis-Nachweis.`);
  }
  return true;
}

export function applyCanaryEnergyPassRemediation(state, options = {}) {
  const expected = { ...CANARY_ENERGY_PASS_TARGET, ...(options.expected || {}) };
  const nextState = structuredClone(state);
  const listings = activeListings(nextState);
  const targets = listings.filter((listing) => listing.externalId === expected.externalId);
  if (targets.length !== 1) {
    throw new Error(`CANARY_ENERGY_SCOPE: Erwartet genau ein aktives Inserat ${expected.externalId}, gefunden ${targets.length}.`);
  }
  const listing = targets[0];
  if (listing.id !== expected.listingId
    || listing.templateId !== expected.templateId
    || listing.templateName !== expected.templateName) {
    throw new Error("CANARY_ENERGY_IDENTITY: Die freigegebene Canary-Identität oder Hausvorlage hat sich geändert.");
  }

  const houses = (nextState.houses || []).filter((house) => house.id === expected.templateId);
  if (houses.length !== 1) throw new Error("CANARY_ENERGY_HOUSE: Die Canary-Hausvorlage ist nicht eindeutig vorhanden.");
  const house = houses[0];
  if (Number(house.energyDemand) !== expected.energyDemand
    || Number(house.constructionYear) !== expected.constructionYear) {
    throw new Error("CANARY_ENERGY_VALUES: Energiebedarf oder Baujahr der Hausvorlage weichen vom bestätigten Bestand ab.");
  }

  const peerClasses = new Set(listings
    .filter((candidate) => candidate.id !== listing.id && candidate.templateId === expected.templateId)
    .map((candidate) => String(candidate.projectingSettings?.energyCertificateClass || "").trim())
    .filter(Boolean));
  if (peerClasses.size !== 1 || !peerClasses.has(expected.energyClass)) {
    throw new Error("CANARY_ENERGY_PEERS: Die Energieklasse ist im Bestand der gleichen Hausvorlage nicht eindeutig bestätigt.");
  }

  const facts = Array.isArray(listing.listingFacts) ? listing.listingFacts : [];
  const hasDemand = assertExistingFact(facts, "energy_demand", expected.energyDemand);
  const hasClass = assertExistingFact(facts, "energy_class", expected.energyClass);
  if (hasDemand && hasClass) return { state, changed: false, idempotent: true, listingId: listing.id };

  listing.listingFacts = [
    ...facts,
    ...(!hasDemand ? [energyFact("energy_demand", expected.energyDemand)] : []),
    ...(!hasClass ? [energyFact("energy_class", expected.energyClass)] : []),
  ];
  return { state: nextState, changed: true, idempotent: false, listingId: listing.id };
}

function nextSavedAt(currentSavedAt, now) {
  return new Date(Math.max(Date.parse(currentSavedAt || "") + 1 || 0, Date.parse(now) || Date.now())).toISOString();
}

export async function runCanaryEnergyPassRemediation(options = {}) {
  const catalogDirectory = options.catalogDirectory || CATALOG_V2_DIRECTORY;
  const now = options.now || new Date().toISOString();
  const load = options.loadCatalogManifest || loadCatalogManifest;
  const start = options.startCatalogSnapshot || startCatalogSnapshot;
  const commit = options.commitCatalogSnapshot || commitCatalogSnapshot;
  const discard = options.discardCatalogSnapshot || discardCatalogSnapshot;
  const current = await load(catalogDirectory);
  if (!current?.stored || !current.state) throw new Error("Der aktive Inseratkatalog ist nicht verfügbar.");
  const preview = applyCanaryEnergyPassRemediation(current.state, options);
  if (!preview.changed) return { changed: false, idempotent: true, listingId: preview.listingId };

  const sessionId = `canary-energy-pass-${randomUUID()}`;
  try {
    await start({
      state: preview.state,
      sessionId,
      savedAt: nextSavedAt(current.savedAt, now),
      expectedSavedAt: current.savedAt,
    }, catalogDirectory);
    await commit(sessionId, catalogDirectory);
  } catch (error) {
    await discard(sessionId, catalogDirectory).catch(() => undefined);
    throw error;
  }
  const persisted = await load(catalogDirectory);
  const verification = applyCanaryEnergyPassRemediation(persisted.state, options);
  if (verification.changed || !verification.idempotent) {
    throw new Error("CANARY_ENERGY_PERSISTENCE: Der gespeicherte Zielzustand ist nicht idempotent.");
  }
  return { changed: true, idempotent: false, listingId: preview.listingId, persistedSavedAt: persisted.savedAt };
}
