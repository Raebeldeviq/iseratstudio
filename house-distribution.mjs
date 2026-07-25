import { ACTIVE_HOUSES_PER_PROJECT } from "./listing-rules.mjs";

export const HOUSE_DISTRIBUTION_SCHEMA_VERSION = 1;
export const HOUSES_PER_PROJECT = ACTIVE_HOUSES_PER_PROJECT;

export const HOUSE_DISTRIBUTION_DEFAULTS = Object.freeze({
  usageWindowDays: 90,
  candidateTrials: 72,
  weights: Object.freeze({
    base: 100,
    totalUsePenalty: 14,
    recentUsePenalty: 9,
    activeProjectPenalty: 12,
    neverUsedOnProjectBonus: 48,
    inactiveBonus: 18,
    agePerDayBonus: 0.35,
    ageBonusLimit: 120,
    lastRemovedPenalty: 85,
    combinationUsePenalty: 34,
    projectHistoryPenalty: 18,
    simultaneousOverlapPenalty: 22,
  }),
});

function nowIso() {
  return new Date().toISOString();
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean))];
}

function finitePositiveInteger(value, fallback) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function validIso(value) {
  const text = String(value || "");
  return Number.isFinite(Date.parse(text)) ? text : "";
}

function stableHash(value) {
  const text = String(value || "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  let state = stableHash(seed) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function daysSince(value, at) {
  const timestamp = Date.parse(value || "");
  const reference = Date.parse(at || "");
  if (!Number.isFinite(timestamp) || !Number.isFinite(reference)) return 365;
  return Math.max(0, (reference - timestamp) / 86400000);
}

function projectActiveHouseIds(project) {
  const groupIds = (project?.listingGroup?.variants || [])
    .filter((variant) => variant?.active && variant?.templateId)
    .map((variant) => variant.templateId);
  return uniqueStrings(groupIds.length ? groupIds : project?.selectedHouseIds || []).slice(0, HOUSES_PER_PROJECT);
}

export function houseCombinationKey(houseIds) {
  return uniqueStrings(houseIds).sort((left, right) => left.localeCompare(right)).join("|");
}

export function houseDataIssues(house) {
  const issues = [];
  if (!house?.id) issues.push("Haus-ID fehlt");
  if (house?.approved === false) issues.push("nicht freigegeben");
  if (!String(house?.name || "").trim()) issues.push("Name fehlt");
  if (!(Number(house?.housePrice) > 0)) issues.push("Preis fehlt");
  if (!(Number(house?.livingArea) > 0)) issues.push("Wohnfläche fehlt");
  if (!(Number(house?.rooms) > 0)) issues.push("Zimmerzahl fehlt");
  if (!Array.isArray(house?.images) || house.images.length < 4) issues.push("weniger als vier Bilder");
  return issues;
}

function normalizedProjectRecord(value, project) {
  const current = uniqueStrings(value?.activeHouseIds?.length
    ? value.activeHouseIds
    : projectActiveHouseIds(project)).slice(0, HOUSES_PER_PROJECT);
  const preview = uniqueStrings(value?.previewHouseIds?.length ? value.previewHouseIds : current).slice(0, HOUSES_PER_PROJECT);
  return {
    projectId: String(value?.projectId || project?.id || ""),
    activeHouseIds: current,
    previewHouseIds: preview,
    previousCombination: String(value?.previousCombination || ""),
    combinationHistory: uniqueStrings(value?.combinationHistory),
    lastRemovedHouseId: String(value?.lastRemovedHouseId || ""),
    lastAddedHouseId: String(value?.lastAddedHouseId || ""),
    pinnedHouseIds: uniqueStrings(value?.pinnedHouseIds).filter((id) => preview.includes(id)),
    excludedHouseIds: uniqueStrings(value?.excludedHouseIds).filter((id) => !preview.includes(id)),
    updatedAt: validIso(value?.updatedAt),
  };
}

export function normalizeHouseDistribution(value = {}, houses = [], projects = []) {
  const source = value && typeof value === "object" ? value : {};
  const houseIds = new Set(houses.map((house) => String(house.id)));
  const approvedIds = houses
    .filter((house) => house.approved !== false)
    .map((house) => String(house.id));
  const poolHouseIds = uniqueStrings(source.poolHouseIds?.length ? source.poolHouseIds : approvedIds)
    .filter((id) => houseIds.has(id));
  const projectById = new Map(projects.map((project) => [String(project.id), project]));
  const storedProjectRecords = Array.isArray(source.projects) ? source.projects : [];
  const allProjectIds = uniqueStrings([
    ...projects.map((project) => project.id),
    ...storedProjectRecords.map((record) => record?.projectId),
  ]);
  const projectRecords = allProjectIds.map((projectId) => {
    const stored = storedProjectRecords.find((record) => String(record?.projectId) === projectId);
    return normalizedProjectRecord(stored, projectById.get(projectId));
  });
  const activeProjectsByHouse = new Map();
  for (const record of projectRecords) {
    for (const houseId of record.activeHouseIds) {
      const current = activeProjectsByHouse.get(houseId) || [];
      current.push(record.projectId);
      activeProjectsByHouse.set(houseId, current);
    }
  }
  const storedHouseUsage = Array.isArray(source.houseUsage) ? source.houseUsage : [];
  const houseUsage = uniqueStrings([
    ...houses.map((house) => house.id),
    ...storedHouseUsage.map((usage) => usage?.houseId),
  ]).map((houseId) => {
    const stored = storedHouseUsage.find((usage) => String(usage?.houseId) === houseId) || {};
    const usedAt = (Array.isArray(stored.usedAt) ? stored.usedAt : []).map(validIso).filter(Boolean);
    return {
      houseId,
      totalUses: Math.max(usedAt.length, Math.max(0, Math.trunc(Number(stored.totalUses) || 0))),
      lastUsedAt: validIso(stored.lastUsedAt) || usedAt.at(-1) || "",
      projectIds: uniqueStrings(stored.projectIds),
      activeProjectIds: uniqueStrings(activeProjectsByHouse.get(houseId)),
      usedAt,
    };
  });
  const combinationUsage = (Array.isArray(source.combinationUsage) ? source.combinationUsage : [])
    .map((stored) => {
      const houseIdsForCombination = uniqueStrings(stored?.houseIds);
      const usedAt = (Array.isArray(stored?.usedAt) ? stored.usedAt : []).map(validIso).filter(Boolean);
      return {
        key: houseCombinationKey(houseIdsForCombination) || String(stored?.key || ""),
        houseIds: houseIdsForCombination,
        totalUses: Math.max(usedAt.length, Math.max(0, Math.trunc(Number(stored?.totalUses) || 0))),
        lastUsedAt: validIso(stored?.lastUsedAt) || usedAt.at(-1) || "",
        lastProjectId: String(stored?.lastProjectId || ""),
        usedAt,
      };
    })
    .filter((entry) => entry.key);
  const rawSettings = source.settings && typeof source.settings === "object" ? source.settings : {};
  return {
    schemaVersion: HOUSE_DISTRIBUTION_SCHEMA_VERSION,
    poolHouseIds,
    settings: {
      usageWindowDays: finitePositiveInteger(rawSettings.usageWindowDays, HOUSE_DISTRIBUTION_DEFAULTS.usageWindowDays),
      candidateTrials: finitePositiveInteger(rawSettings.candidateTrials, HOUSE_DISTRIBUTION_DEFAULTS.candidateTrials),
      weights: { ...HOUSE_DISTRIBUTION_DEFAULTS.weights, ...(rawSettings.weights || {}) },
    },
    houseUsage,
    combinationUsage,
    projects: projectRecords,
    updatedAt: validIso(source.updatedAt),
  };
}

export function validateHousePool(distributionValue, houses, options = {}) {
  const distribution = options.normalized === true
    ? distributionValue
    : normalizeHouseDistribution(distributionValue, houses, options.projects || []);
  const houseById = new Map(houses.map((house) => [String(house.id), house]));
  const eligible = distribution.poolHouseIds.filter((houseId) => {
    const house = houseById.get(houseId);
    return house && houseDataIssues(house).length === 0;
  });
  const rejected = distribution.poolHouseIds.flatMap((houseId) => {
    const house = houseById.get(houseId);
    const issues = house ? houseDataIssues(house) : ["nicht mehr im Katalog vorhanden"];
    return issues.length ? [{ houseId, name: house?.name || houseId, issues }] : [];
  });
  const issues = [];
  if (eligible.length < HOUSES_PER_PROJECT) {
    issues.push(`Der Hauspool benötigt mindestens ${HOUSES_PER_PROJECT} aktive, freigegebene und vollständige Häuser; verfügbar sind ${eligible.length}.`);
  }
  return { distribution, eligibleHouseIds: eligible, rejected, issues, ok: issues.length === 0 };
}

function usageFor(distribution, houseId) {
  return distribution.houseUsage.find((usage) => usage.houseId === houseId) || {
    houseId, totalUses: 0, lastUsedAt: "", projectIds: [], activeProjectIds: [], usedAt: [],
  };
}

function combinationFor(distribution, ids) {
  const key = houseCombinationKey(ids);
  return distribution.combinationUsage.find((usage) => usage.key === key) || {
    key, houseIds: uniqueStrings(ids), totalUses: 0, lastUsedAt: "", lastProjectId: "", usedAt: [],
  };
}

function recentUseCount(usage, at, windowDays) {
  const threshold = Date.parse(at) - windowDays * 86400000;
  return usage.usedAt.filter((value) => Date.parse(value) >= threshold).length;
}

function houseSelectionWeight(distribution, record, houseId, activeCounts, at) {
  const weights = distribution.settings.weights;
  const usage = usageFor(distribution, houseId);
  const recentUses = recentUseCount(usage, at, distribution.settings.usageWindowDays);
  const ageBonus = Math.min(weights.ageBonusLimit, daysSince(usage.lastUsedAt, at) * weights.agePerDayBonus);
  let score = weights.base
    - usage.totalUses * weights.totalUsePenalty
    - recentUses * weights.recentUsePenalty
    - (activeCounts.get(houseId) || 0) * weights.activeProjectPenalty
    + ageBonus;
  if (!usage.projectIds.includes(record.projectId)) score += weights.neverUsedOnProjectBonus;
  if (!(activeCounts.get(houseId) > 0)) score += weights.inactiveBonus;
  if (record.lastRemovedHouseId === houseId) score -= weights.lastRemovedPenalty;
  return Math.max(0.001, score);
}

function weightedPick(candidates, weightFor, random) {
  const weighted = candidates.map((candidate) => ({ candidate, weight: Math.max(0.001, Number(weightFor(candidate)) || 0.001) }));
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  let cursor = random() * total;
  for (const item of weighted) {
    cursor -= item.weight;
    if (cursor <= 0) return item.candidate;
  }
  return weighted.at(-1)?.candidate || null;
}

function overlapCount(left, right) {
  const rightSet = new Set(right);
  return left.filter((id) => rightSet.has(id)).length;
}

function combinationScore(distribution, record, houseIds, simultaneous, activeCounts, at) {
  const weights = distribution.settings.weights;
  const combination = combinationFor(distribution, houseIds);
  const key = houseCombinationKey(houseIds);
  const houseScore = houseIds.reduce((sum, houseId) => sum + houseSelectionWeight(distribution, record, houseId, activeCounts, at), 0);
  const historyPenalty = record.combinationHistory.includes(key) ? weights.projectHistoryPenalty : 0;
  const simultaneousPenalty = simultaneous.reduce((sum, other) =>
    sum + overlapCount(houseIds, other) * weights.simultaneousOverlapPenalty, 0);
  return houseScore
    - combination.totalUses * weights.combinationUsePenalty
    - historyPenalty
    - simultaneousPenalty;
}

function candidateCombination(distribution, record, eligible, activeCounts, random, at) {
  const pinned = record.pinnedHouseIds.filter((id) => eligible.includes(id) && !record.excludedHouseIds.includes(id));
  const selected = uniqueStrings(pinned).slice(0, HOUSES_PER_PROJECT);
  while (selected.length < HOUSES_PER_PROJECT) {
    const candidates = eligible.filter((id) => !selected.includes(id) && !record.excludedHouseIds.includes(id));
    if (!candidates.length) break;
    const picked = weightedPick(candidates, (houseId) =>
      houseSelectionWeight(distribution, record, houseId, activeCounts, at), random);
    if (!picked) break;
    selected.push(picked);
  }
  return selected;
}

function bestCombination(distribution, record, eligible, simultaneous, activeCounts, options = {}) {
  const at = String(options.now || nowIso());
  const available = eligible.filter((id) => !record.excludedHouseIds.includes(id));
  if (available.length < HOUSES_PER_PROJECT || record.pinnedHouseIds.length > HOUSES_PER_PROJECT) return null;
  const seed = `${record.projectId}:${record.combinationHistory.length}:${distribution.combinationUsage.length}:${options.seed || ""}`;
  const random = typeof options.random === "function" ? options.random : seededRandom(seed);
  const trials = Math.max(1, distribution.settings.candidateTrials);
  const previousKeys = new Set([record.previousCombination, houseCombinationKey(record.activeHouseIds)].filter(Boolean));
  const hasAlternative = available.length > HOUSES_PER_PROJECT || record.pinnedHouseIds.length < HOUSES_PER_PROJECT;
  let best = null;
  for (let trial = 0; trial < trials; trial += 1) {
    const candidate = candidateCombination(distribution, record, eligible, activeCounts, random, at);
    if (candidate.length !== HOUSES_PER_PROJECT) continue;
    const key = houseCombinationKey(candidate);
    if (hasAlternative && previousKeys.has(key)) continue;
    const score = combinationScore(distribution, record, candidate, simultaneous, activeCounts, at);
    if (!best || score > best.score) best = { houseIds: candidate, key, score };
  }
  if (best) return best;
  const fallback = candidateCombination(distribution, record, eligible, activeCounts, random, at);
  return fallback.length === HOUSES_PER_PROJECT
    ? { houseIds: fallback, key: houseCombinationKey(fallback), score: combinationScore(distribution, record, fallback, simultaneous, activeCounts, at), fallback: true }
    : null;
}

export function generateWeightedDistribution(distributionValue, houses, projectIds, options = {}) {
  const projectList = options.projects || [];
  const validation = validateHousePool(distributionValue, houses, { projects: projectList });
  if (!validation.ok) return { distribution: validation.distribution, assignments: {}, diagnostics: validation.issues, ok: false };
  const selectedProjectIds = uniqueStrings(projectIds);
  const selectedSet = new Set(selectedProjectIds);
  const activeCounts = new Map();
  for (const record of validation.distribution.projects) {
    if (selectedSet.has(record.projectId)) continue;
    for (const houseId of record.activeHouseIds) activeCounts.set(houseId, (activeCounts.get(houseId) || 0) + 1);
  }
  const assignments = {};
  const simultaneous = [];
  const diagnostics = [];
  let records = [...validation.distribution.projects];
  for (const projectId of selectedProjectIds) {
    const index = records.findIndex((record) => record.projectId === projectId);
    if (index < 0) {
      diagnostics.push(`${projectId}: Grundstück ist nicht mehr vorhanden.`);
      continue;
    }
    const allocation = bestCombination(validation.distribution, records[index], validation.eligibleHouseIds, simultaneous, activeCounts, {
      ...options,
      seed: `${options.seed || "distribution"}:${projectId}`,
    });
    if (!allocation) {
      diagnostics.push(`${projectId}: Nach Sperren und Fixierungen stehen keine vier unterschiedlichen Häuser zur Verfügung.`);
      continue;
    }
    assignments[projectId] = allocation.houseIds;
    simultaneous.push(allocation.houseIds);
    for (const houseId of allocation.houseIds) activeCounts.set(houseId, (activeCounts.get(houseId) || 0) + 1);
    records[index] = { ...records[index], previewHouseIds: allocation.houseIds, updatedAt: String(options.now || nowIso()) };
    if (allocation.fallback) diagnostics.push(`${projectId}: Die vorherige Kombination war wegen des kleinen Pools nicht vollständig vermeidbar.`);
  }
  return {
    distribution: { ...validation.distribution, projects: records, updatedAt: String(options.now || nowIso()) },
    assignments,
    diagnostics,
    ok: Object.keys(assignments).length === selectedProjectIds.length,
  };
}

export function generateWeightedProjectPreview(distributionValue, houses, projectId, options = {}) {
  return generateWeightedDistribution(distributionValue, houses, [projectId], options);
}

export function setHouseDistributionPool(distributionValue, houseIds, houses, projects = []) {
  const normalized = normalizeHouseDistribution(distributionValue, houses, projects);
  const allowed = new Set(houses.filter((house) => house.approved !== false).map((house) => String(house.id)));
  return { ...normalized, poolHouseIds: uniqueStrings(houseIds).filter((id) => allowed.has(id)), updatedAt: nowIso() };
}

export function updateProjectHouseRules(distributionValue, houses, projects, projectId, patch) {
  const normalized = normalizeHouseDistribution(distributionValue, houses, projects);
  return {
    ...normalized,
    projects: normalized.projects.map((record) => {
      if (record.projectId !== projectId) return record;
      const preview = patch.previewHouseIds === undefined ? record.previewHouseIds : uniqueStrings(patch.previewHouseIds).slice(0, HOUSES_PER_PROJECT);
      const pinned = patch.pinnedHouseIds === undefined ? record.pinnedHouseIds : uniqueStrings(patch.pinnedHouseIds).filter((id) => preview.includes(id));
      const excluded = patch.excludedHouseIds === undefined ? record.excludedHouseIds : uniqueStrings(patch.excludedHouseIds).filter((id) => !preview.includes(id));
      return { ...record, ...patch, previewHouseIds: preview, pinnedHouseIds: pinned, excludedHouseIds: excluded, updatedAt: nowIso() };
    }),
    updatedAt: nowIso(),
  };
}

function appendUsage(distribution, projectId, houseIds, at, combinationHouseIds = houseIds) {
  const activeByHouse = new Map();
  for (const record of distribution.projects) {
    for (const houseId of record.activeHouseIds) {
      const current = activeByHouse.get(houseId) || [];
      current.push(record.projectId);
      activeByHouse.set(houseId, current);
    }
  }
  const houseUsage = distribution.houseUsage.map((usage) => houseIds.includes(usage.houseId)
    ? {
        ...usage,
        totalUses: usage.totalUses + 1,
        lastUsedAt: at,
        projectIds: uniqueStrings([...usage.projectIds, projectId]),
        activeProjectIds: uniqueStrings(activeByHouse.get(usage.houseId)),
        usedAt: [...usage.usedAt, at],
      }
    : { ...usage, activeProjectIds: uniqueStrings(activeByHouse.get(usage.houseId)) });
  const key = houseCombinationKey(combinationHouseIds);
  const stored = distribution.combinationUsage.find((usage) => usage.key === key);
  const combination = stored
    ? { ...stored, totalUses: stored.totalUses + 1, lastUsedAt: at, lastProjectId: projectId, usedAt: [...stored.usedAt, at] }
    : { key, houseIds: uniqueStrings(combinationHouseIds), totalUses: 1, lastUsedAt: at, lastProjectId: projectId, usedAt: [at] };
  return {
    ...distribution,
    houseUsage,
    combinationUsage: [...distribution.combinationUsage.filter((usage) => usage.key !== key), combination],
    updatedAt: at,
  };
}

export function commitHouseDistributionPreviews(distributionValue, houses, projects, projectIds, options = {}) {
  const at = String(options.now || nowIso());
  let distribution = normalizeHouseDistribution(distributionValue, houses, projects);
  const selectedIds = uniqueStrings(projectIds);
  const issues = [];
  for (const projectId of selectedIds) {
    const record = distribution.projects.find((item) => item.projectId === projectId);
    if (!record || record.previewHouseIds.length !== HOUSES_PER_PROJECT || new Set(record.previewHouseIds).size !== HOUSES_PER_PROJECT) {
      issues.push(`${projectId}: Es müssen genau vier unterschiedliche Häuser ausgewählt sein.`);
      continue;
    }
    const pool = new Set(distribution.poolHouseIds);
    const invalid = record.previewHouseIds.find((houseId) => !pool.has(houseId) || houseDataIssues(houses.find((house) => house.id === houseId)).length);
    if (invalid) issues.push(`${projectId}: Ein Haus ist nicht freigegeben, unvollständig oder nicht Teil des Hauspools.`);
  }
  if (issues.length) return { distribution, issues, ok: false };
  for (const projectId of selectedIds) {
    distribution = {
      ...distribution,
      projects: distribution.projects.map((record) => {
        if (record.projectId !== projectId) return record;
        const previousKey = houseCombinationKey(record.activeHouseIds);
        const nextKey = houseCombinationKey(record.previewHouseIds);
        return {
          ...record,
          previousCombination: previousKey,
          activeHouseIds: [...record.previewHouseIds],
          combinationHistory: uniqueStrings([...record.combinationHistory, nextKey]),
          updatedAt: at,
        };
      }),
    };
    const active = distribution.projects.find((record) => record.projectId === projectId)?.activeHouseIds || [];
    distribution = appendUsage(distribution, projectId, active, at);
  }
  return { distribution, issues: [], ok: true };
}

export function planWeightedHouseRotation(distributionValue, houses, projects, projectId, removedHouseId, options = {}) {
  const at = String(options.now || nowIso());
  const validation = options.validation
    || validateHousePool(distributionValue, houses, { projects, normalized: options.normalized === true });
  const record = validation.distribution.projects.find((item) => item.projectId === projectId);
  if (!validation.ok || !record) return { ok: false, houseId: "", combination: [], issues: validation.issues.length ? validation.issues : ["Grundstück nicht gefunden."] };
  const remaining = record.activeHouseIds.filter((id) => id !== removedHouseId).slice(0, HOUSES_PER_PROJECT - 1);
  const candidates = validation.eligibleHouseIds.filter((id) =>
    !remaining.includes(id)
    && !record.excludedHouseIds.includes(id)
    && id !== removedHouseId);
  if (!candidates.length) return { ok: false, houseId: "", combination: remaining, issues: ["Im Hauspool ist kein zulässiges Ersatzhaus verfügbar."] };
  const activeCounts = new Map(validation.distribution.houseUsage.map((usage) => [usage.houseId, usage.activeProjectIds.length]));
  const random = typeof options.random === "function"
    ? options.random
    : seededRandom(`${projectId}:${removedHouseId}:${record.combinationHistory.length}:${options.seed || "rotation"}`);
  const previousKeys = new Set([record.previousCombination, houseCombinationKey(record.activeHouseIds)].filter(Boolean));
  const scored = candidates.map((houseId) => {
    const combination = [...remaining, houseId];
    const combinationUsage = combinationFor(validation.distribution, combination);
    let score = houseSelectionWeight(validation.distribution, record, houseId, activeCounts, at)
      - combinationUsage.totalUses * validation.distribution.settings.weights.combinationUsePenalty;
    if (previousKeys.has(houseCombinationKey(combination))) score = Number.NEGATIVE_INFINITY;
    if (record.lastRemovedHouseId === houseId) score -= validation.distribution.settings.weights.lastRemovedPenalty;
    score += random() * Math.max(1, Math.abs(score) * 0.05);
    return { houseId, combination, score };
  }).sort((left, right) => right.score - left.score || left.houseId.localeCompare(right.houseId));
  const selected = scored.find((candidate) => Number.isFinite(candidate.score)) || scored[0];
  return selected
    ? { ok: true, ...selected, issues: [] }
    : { ok: false, houseId: "", combination: remaining, issues: ["Es konnte keine neue Hauskombination gebildet werden."] };
}

export function recordHouseRotation(distributionValue, houses, projects, projectId, removedHouseId, addedHouseId, options = {}) {
  const at = String(options.now || nowIso());
  let distribution = normalizeHouseDistribution(distributionValue, houses, projects);
  const record = distribution.projects.find((item) => item.projectId === projectId);
  if (!record) return distribution;
  const activeHouseIds = uniqueStrings(record.activeHouseIds.map((id) => id === removedHouseId ? addedHouseId : id)).slice(0, HOUSES_PER_PROJECT);
  if (activeHouseIds.length !== HOUSES_PER_PROJECT) return distribution;
  const previousCombination = houseCombinationKey(record.activeHouseIds);
  const nextCombination = houseCombinationKey(activeHouseIds);
  distribution = {
    ...distribution,
    projects: distribution.projects.map((item) => item.projectId === projectId ? {
      ...item,
      activeHouseIds,
      previewHouseIds: activeHouseIds,
      previousCombination,
      combinationHistory: uniqueStrings([...item.combinationHistory, nextCombination]),
      lastRemovedHouseId: removedHouseId,
      lastAddedHouseId: addedHouseId,
      updatedAt: at,
    } : item),
  };
  return appendUsage(distribution, projectId, [addedHouseId], at, activeHouseIds);
}
