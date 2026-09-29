import { WORKFLOW_STATUS } from "./workflow-status.mjs";

const PREFIX = "30460";

export function calendarDate(value = new Date()) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value)) return addCalendarDays(value, 0);
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Ungültiges Kalenderdatum für den Lösch-Batch.");
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function addCalendarDays(day, amount) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(day)) throw new Error("Ungültiger Uploadtag.");
  const date = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day) throw new Error("Ungültiger Uploadtag.");
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function batches(state) {
  return Array.isArray(state?.deleteBatches) ? state.deleteBatches : [];
}

function protectedListingKeys(state) {
  return new Set((state?.projects || []).flatMap((project) =>
    (project.listingGroup?.listingControls || [])
      .filter((control) => control.premiumPlacement === true || control.manualLock === true)
      .map((control) => `${project.id}:${control.listingId}`)));
}

export function reconcileDeleteBatchProtections(state) {
  if (!Array.isArray(state?.deleteBatches)) return state;
  const protectedKeys = protectedListingKeys(state);
  let changed = false;
  const deleteBatches = batches(state).map((batch) => {
    let reopened = false;
    let entriesChanged = false;
    const entries = (batch.entries || []).map((entry) => {
      const isProtected = protectedKeys.has(`${entry.projectId}:${entry.listingId}`);
      if (isProtected && (entry.status === "planned" || entry.status === "active")) {
        changed = true;
        entriesChanged = true;
        return { ...entry, status: "paused", pausedFrom: entry.status };
      }
      if (!isProtected && entry.status === "paused") {
        changed = true;
        entriesChanged = true;
        reopened = true;
        const { pausedFrom, ...rest } = entry;
        return { ...rest, status: pausedFrom === "active" ? "active" : "planned" };
      }
      return entry;
    });
    return reopened && batch.completedAt
      ? { ...batch, entries, completedAt: "" }
      : entriesChanged ? { ...batch, entries } : batch;
  });
  return changed ? { ...state, deleteBatches } : state;
}

function activeExternalIds(state) {
  const listings = [
    ...(state?.projects || []).flatMap((project) => project.listings || []),
    ...(state?.listingResetHistory || []).flatMap((archive) => archive.listings || []),
  ];
  return new Set(listings
    .filter((listing) => listing.status !== WORKFLOW_STATUS.DELETED && (listing.status !== WORKFLOW_STATUS.ARCHIVED || listing.externalDeletionPending))
    .map((listing) => String(listing.externalId || "")));
}

function nextBatchIdentity(records) {
  const last = records.reduce((result, batch) => {
    const cycle = Number(batch.cycle) || 0;
    const number = Number(batch.number) || 0;
    return cycle > result.cycle || (cycle === result.cycle && number > result.number)
      ? { cycle, number } : result;
  }, { cycle: 1, number: 0 });
  return last.number === 999 ? { cycle: last.cycle + 1, number: 1 } : { cycle: last.cycle, number: last.number + 1 };
}

export function allocateDeleteBatchNumber(state, input) {
  const position = Number(input.housePosition);
  if (!Number.isInteger(position) || position < 1 || position > 4) throw new Error("Die Hausposition muss zwischen 1 und 4 liegen.");
  const uploadDate = input.uploadDate || calendarDate();
  const plannedDeletionDate = addCalendarDays(uploadDate, position + 8);
  const records = batches(state);
  const used = activeExternalIds(state);
  for (const batch of records) {
    for (const entry of batch.entries || []) if (entry.status !== "deleted" && entry.status !== "void") used.add(entry.externalId);
  }
  let target = [...records].reverse().find((batch) => batch.plannedDeletionDate === plannedDeletionDate && !batch.completedAt && (batch.entries || []).filter((entry) => entry.status !== "void").length < 999);
  const updated = records.map((batch) => ({ ...batch, entries: [...(batch.entries || [])] }));
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    if (!target) {
      const identity = nextBatchIdentity(updated);
      target = { id: `delete-batch:${identity.cycle}:${identity.number}`, ...identity, plannedDeletionDate, entries: [], completedAt: "" };
      updated.push(target);
    } else {
      target = updated.find((batch) => batch.id === target.id) || target;
    }
    const occupied = new Set(target.entries.map((entry) => Number(entry.index)));
    for (let index = 1; index <= 999; index += 1) {
      if (occupied.has(index)) continue;
      const externalId = `${PREFIX}-${String(target.number).padStart(3, "0")}${String(index).padStart(3, "0")}`;
      if (used.has(externalId)) continue;
      const isProtected = protectedListingKeys(state).has(`${input.projectId}:${input.listingId}`);
      target.entries.push({ batchId: target.id, listingId: String(input.listingId || ""), projectId: String(input.projectId || ""), externalId, index, housePosition: position, uploadDate, plannedDeletionDate, status: isProtected ? "paused" : "planned", ...(isProtected ? { pausedFrom: "planned" } : {}), deletedAt: "" });
      return { state: { ...state, deleteBatches: updated }, externalId, batchId: target.id, cycle: target.cycle, batchNumber: target.number };
    }
    target = null;
  }
  throw new Error("Im sichtbaren Nummernkreis ist derzeit keine kollisionsfreie Batchnummer verfügbar.");
}

export function linkDeleteBatchListings(state) {
  if (!Array.isArray(state?.deleteBatches)) return state;
  const listings = new Map((state.projects || []).flatMap((project) => (project.listings || []).map((listing) => [listing.externalId, { listing, projectId: project.id }])));
  const linked = { ...state, deleteBatches: batches(state).map((batch) => ({ ...batch, entries: (batch.entries || []).map((entry) => {
    const match = listings.get(entry.externalId);
    if (!match) return entry;
    const uploadedAt = match.listing.transferredAt || match.listing.lastUploadedAt || "";
    return { ...entry, listingId: match.listing.id, projectId: match.projectId, status: entry.status === "planned" && uploadedAt ? "active" : entry.status, uploadDate: uploadedAt ? calendarDate(uploadedAt) : entry.uploadDate };
  }) })) };
  return reconcileDeleteBatchProtections(linked);
}

export function replanDeleteBatchesForUpload(state, listingIds, uploadDate = calendarDate()) {
  let next = linkDeleteBatchListings(state);
  const ids = new Set(listingIds);
  for (const project of state.projects || []) {
    for (const listing of project.listings || []) {
      if (!ids.has(listing.id)) continue;
      const entry = batches(next).flatMap((batch) => batch.entries || []).find((item) => item.listingId === listing.id && item.externalId === listing.externalId);
      if (!entry || entry.status === "active" || entry.status === "paused" || entry.status === "deleted") continue;
      if (entry.status === "planned" && entry.uploadDate === uploadDate) continue;
      next = { ...next, deleteBatches: batches(next).map((batch) => ({ ...batch, entries: batch.entries.map((item) => item === entry ? { ...item, status: "void" } : item) })) };
      const allocated = allocateDeleteBatchNumber(next, { listingId: listing.id, projectId: project.id, housePosition: entry.housePosition, uploadDate });
      const allocatedEntry = allocated.state.deleteBatches.flatMap((batch) => batch.entries)
        .find((item) => item.listingId === listing.id && item.externalId === allocated.externalId);
      const updatedListing = (item) => ({ ...item, externalId: allocated.externalId,
        ...(item.addressSnapshot && allocatedEntry ? { addressSnapshot: { ...item.addressSnapshot,
          batchId: allocatedEntry.batchId, plannedDeletionDate: allocatedEntry.plannedDeletionDate } } : {}) });
      next = { ...allocated.state, projects: next.projects.map((candidate) => candidate.id !== project.id ? candidate : {
        ...candidate,
        listings: candidate.listings.map((item) => item.id === listing.id ? updatedListing(item) : item),
        listingGroup: { ...candidate.listingGroup, variants: (candidate.listingGroup?.variants || []).map((variant) => variant.listing?.id === listing.id ? { ...variant, listing: updatedListing(variant.listing) } : variant) },
      }) };
    }
  }
  return next;
}

export function assertDeleteBatchUploadReady(state, listing, uploadDate = calendarDate()) {
  const entry = batches(linkDeleteBatchListings(state)).flatMap((batch) => batch.entries || []).find((item) => item.listingId === listing?.id && item.externalId === listing?.externalId);
  if (!entry) return;
  if (entry.status === "paused") return;
  if (entry.status !== "planned" || entry.uploadDate !== uploadDate) {
    throw new Error("Der Lösch-Batch passt nicht zum heutigen Uploadtag. Bitte das Inserat in der App neu vorbereiten und den Upload erneut starten.");
  }
}

export function deleteBatchTrafficLight(state, today = calendarDate()) {
  return batches(linkDeleteBatchListings(state)).map((batch) => {
    const active = batch.entries.filter((entry) => entry.status === "active");
    const paused = batch.entries.filter((entry) => entry.status === "paused");
    const deleted = batch.entries.filter((entry) => entry.status === "deleted");
    if (!active.length && !deleted.length) return null;
    const days = Math.round((Date.parse(`${batch.plannedDeletionDate}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000);
    return { ...batch, active, paused, deleted, signal: active.length ? days <= 0 ? "red" : days === 1 ? "yellow" : "green" : "gray", days };
  }).filter(Boolean).sort((a, b) => Number(a.signal === "gray") - Number(b.signal === "gray") || a.plannedDeletionDate.localeCompare(b.plannedDeletionDate) || a.cycle - b.cycle || a.number - b.number);
}

export function confirmDeleteBatch(state, batchId, deletedAt = new Date().toISOString()) {
  const batch = batches(linkDeleteBatchListings(state)).find((item) => item.id === batchId);
  if (!batch) throw new Error("Lösch-Batch nicht gefunden.");
  const active = batch.entries.filter((entry) => entry.status === "active");
  if (!active.length) throw new Error("Dieser Batch enthält keine übertragenen, offenen Inserate.");
  const activeIds = new Set(active.map((entry) => entry.listingId));
  const reconciled = linkDeleteBatchListings(state);
  const next = { ...reconciled,
    deleteBatches: batches(reconciled).map((item) => item.id !== batchId ? item : { ...item, completedAt: deletedAt, entries: item.entries.map((entry) => entry.status === "active" && activeIds.has(entry.listingId) ? { ...entry, status: "deleted", deletedAt } : entry.status === "planned" ? { ...entry, status: "void" } : entry) }),
    projects: state.projects.map((project) => ({ ...project,
      listings: project.listings.map((listing) => activeIds.has(listing.id) ? { ...listing, status: WORKFLOW_STATUS.DELETED, statusMessage: "Manuell in Immoprofessional gelöscht", externalDeletionPending: false, deletedAt } : listing),
      listingGroup: project.listingGroup ? { ...project.listingGroup,
        variants: (project.listingGroup.variants || []).map((variant) => variant.listing && activeIds.has(variant.listing.id) ? { ...variant, listing: { ...variant.listing, status: WORKFLOW_STATUS.DELETED, statusMessage: "Manuell in Immoprofessional gelöscht", externalDeletionPending: false, deletedAt } } : variant),
        listingControls: (project.listingGroup.listingControls || []).map((control) => activeIds.has(control.listingId) ? { ...control, status: WORKFLOW_STATUS.DELETED, statusMessage: "Manuell in Immoprofessional gelöscht", automaticUpdateEnabled: false, automaticDeletionEnabled: false, manualLock: true, updateMode: "blocked" } : control),
      } : project.listingGroup,
    })),
  };
  return { state: next, deletedCount: active.length };
}
