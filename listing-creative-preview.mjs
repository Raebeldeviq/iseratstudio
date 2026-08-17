import { createUploadJobId } from "./batch-upload.mjs";
import { recordHouseRotation } from "./house-distribution.mjs";
import { prepareListingRotationInState } from "./listing-rotation-engine.mjs";
import { schedulerDueListings } from "./listing-scheduler.mjs";

function finiteLimit(value) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(20, parsed) : 10;
}

function simulatedCopyId(projectId, listingId, index) {
  return `creative-preview-${index + 1}-${projectId}-${listingId}`;
}

function roundRobinDueCandidates(due) {
  const queues = new Map();
  for (const candidate of due) {
    const queue = queues.get(candidate.projectId) || [];
    queue.push(candidate);
    queues.set(candidate.projectId, queue);
  }
  const orderedQueues = [...queues.entries()]
    .map(([projectId, candidates]) => ({ projectId, candidates }))
    .sort((left, right) =>
      Date.parse(left.candidates[0].dueAt) - Date.parse(right.candidates[0].dueAt)
      || left.projectId.localeCompare(right.projectId));
  const ordered = [];
  let added = true;
  while (added) {
    added = false;
    for (const queue of orderedQueues) {
      const candidate = queue.candidates.shift();
      if (!candidate) continue;
      ordered.push(candidate);
      added = true;
    }
  }
  return ordered;
}

/**
 * Reine In-Memory-Vorschau. Der übergebene Zustand wird geklont und weder ein
 * Store noch ein Upload-/Helperpfad angesprochen.
 */
export function previewListingCreativeRotation(stateValue, options = {}) {
  const at = String(options.at || new Date().toISOString());
  const limit = finiteLimit(options.limit);
  let simulatedState = structuredClone(stateValue);
  const due = schedulerDueListings(simulatedState, at)
    .sort((left, right) =>
      Date.parse(left.dueAt) - Date.parse(right.dueAt)
      || left.projectId.localeCompare(right.projectId)
      || left.listingId.localeCompare(right.listingId));
  const orderedDue = roundRobinDueCandidates(due);
  const items = [];
  const skipped = [];
  for (const candidate of orderedDue) {
    if (items.length >= limit) break;
    const project = simulatedState.projects.find((item) => item.id === candidate.projectId);
    const source = project?.listings.find((item) => item.id === candidate.listingId);
    if (!project || !source) continue;
    const result = prepareListingRotationInState(simulatedState, project.id, source.id, {
      now: at,
      mode: "prepare-only",
      copyId: simulatedCopyId(project.id, source.id, items.length),
      operationToken: `creative-preview-${items.length + 1}`,
      uploadJobIdFor: createUploadJobId,
    });
    if (!result.ok || !result.copy) {
      skipped.push({
        projectId: project.id,
        listingId: source.id,
        externalId: source.externalId,
        issues: result.issues || [result.message],
      });
      continue;
    }
    const copy = result.copy;
    const selection = copy.creativeSelection || {};
    const proposedHouse = simulatedState.houses.find((house) => house.id === copy.templateId);
    items.push({
      plotId: String(project.plotId || project.id),
      projectId: project.id,
      sourceListingId: source.id,
      sourceExternalId: source.externalId,
      dueAt: candidate.dueAt,
      currentHouseId: source.templateId,
      currentHouseName: source.templateName,
      proposedHouseId: copy.templateId,
      proposedHouseName: proposedHouse?.name || copy.templateName,
      heroType: selection.heroType || copy.heroCreativeType || "house",
      heroImageId: selection.heroImageId || copy.heroImageId || "",
      heroCreative: selection.heroType === "action"
        ? `Aktionsbild ${selection.heroImageId || copy.heroImageId || ""}`
        : `Hausbild ${selection.heroImageId || copy.heroImageId || ""}`,
      houseReason: selection.houseReason || "",
      heroReason: selection.heroReason || "",
      houseLastUsedAt: selection.houseLastUsedAt || "",
      heroLastUsedAt: selection.heroLastUsedAt || "",
      diagnostics: selection.diagnostics || [],
    });
    simulatedState = result.state;
    simulatedState = {
      ...simulatedState,
      houseDistribution: recordHouseRotation(
        simulatedState.houseDistribution,
        simulatedState.houses || [],
        simulatedState.projects || [],
        project.id,
        source.templateId,
        copy.templateId,
        { now: at },
      ),
    };
  }
  return {
    generatedAt: at,
    requestedLimit: limit,
    dueCount: due.length,
    previewCount: items.length,
    items,
    skipped,
    readOnly: true,
  };
}
