import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createUploadJobId } from "../batch-upload.mjs";
import { normalizeHouseDistribution } from "../house-distribution.mjs";
import {
  assignListingGroupVariant,
  createListingGroup,
  listingControl,
  updateListingControl,
} from "../listing-groups.mjs";
import { isHvObjectNumber } from "../listing-object-number.mjs";
import { createListingRotationSchedulerService } from "../listing-rotation-scheduler-service.mjs";
import {
  createListingScheduler,
  updateListingSchedulerSettings,
} from "../listing-scheduler.mjs";
import { createPersistentLease } from "../persistent-lease.mjs";
import { WORKFLOW_STATUS } from "../workflow-status.mjs";

function ids(prefix) {
  let value = 0;
  return () => `${prefix}-${++value}`;
}

function house(id) {
  return {
    id,
    name: `SUN ${id}`,
    approved: true,
    houseType: "Einfamilienhaus",
    livingArea: 130,
    rooms: 5,
    bedrooms: 3,
    bathrooms: 2,
    floors: 2,
    housePrice: 400_000,
    constructionYear: 2027,
    energyDemand: 18,
    energyClass: "A++",
    heatingType: "Fußbodenheizung mit Luft-Wasser-Wärmepumpe",
    energySource: "Umweltwärme und Strom",
    architecture: "Offener Grundriss",
    equipmentHighlights: "Hochwertige Ausstattung",
    useStandardPackage: true,
    images: Array.from({ length: 4 }, (_, index) => ({
      id: `${id}-image-${index}`,
      name: `${id}-${index}.jpg`,
      caption: `Bild ${index + 1}`,
      mimeType: "image/jpeg",
      dataUrl: "data:image/jpeg;base64,AA==",
      isFloorplan: index >= 2,
      role: index === 0 ? "cover" : index >= 2 ? "floorplan_ground" : "living",
    })),
  };
}

function listing(houseValue, id, externalId) {
  return {
    id,
    externalId,
    templateId: houseValue.id,
    templateName: houseValue.name,
    price: 500_000,
    version: 1,
    createdAt: "2026-07-29T08:00:00.000Z",
    status: WORKFLOW_STATUS.PUBLISHED,
    statusMessage: "Veröffentlicht",
    listingOrigin: "group-source",
    texts: {
      title: "Titel",
      description: "Beschreibung",
      equipment: "Ausstattung",
      location: "Lage",
      other: "Sonstiges",
    },
  };
}

function project(projectIndex, houses) {
  const projectId = `project-${projectIndex}`;
  const idFactory = ids(projectId);
  let group = createListingGroup(projectId, {
    idFactory,
    now: "2026-07-29T08:00:00.000Z",
  });
  for (let index = 0; index < 4; index += 1) {
    const source = listing(
      houses[index],
      `${projectId}-listing-${index + 1}`,
      `30460-${String(projectIndex * 100 + index).padStart(6, "0")}`,
    );
    group = assignListingGroupVariant(
      group,
      group.variants[index].id,
      houses[index],
      source,
      { idFactory, now: "2026-07-29T08:00:00.000Z" },
    );
    const assigned = group.variants[index].listing;
    group = updateListingControl(group, assigned, {
      automaticUpdateEnabled: true,
      automaticDeletionEnabled: false,
      status: WORKFLOW_STATUS.PUBLISHED,
      statusMessage: "Veröffentlicht",
      lastSuccessAt: "2026-07-29T08:00:00.000Z",
      lastUpdatedAt: "2026-07-29T08:00:00.000Z",
    }, { idFactory, now: "2026-07-29T08:00:00.000Z" });
  }
  return {
    id: projectId,
    plotId: `plot-${projectIndex}`,
    isActive: true,
    owner: "fabian",
    name: `Adresse ${projectIndex}`,
    street: "Teststraße",
    houseNumber: String(projectIndex),
    zip: "14542",
    city: "Werder",
    district: "",
    plotArea: 600,
    plotPrice: 120_000,
    additionalCosts: 20_000,
    locationFacts: "Ruhige Lage",
    transportFacts: "Gute Anbindung",
    familyFacts: "Familienfreundlich",
    natureFacts: "Naturnah",
    selectedHouseIds: houses.slice(0, 4).map((item) => item.id),
    listings: group.variants.filter((variant) => variant.listing).map((variant) => variant.listing),
    listingGroup: group,
    createdAt: "2026-07-29T08:00:00.000Z",
  };
}

function studioState(projectCount = 2) {
  const houses = Array.from({ length: 6 }, (_, index) => house(`house-${index + 1}`));
  const projects = Array.from({ length: projectCount }, (_, index) => project(index + 1, houses));
  let scheduler = createListingScheduler({ now: "2026-07-29T08:00:00.000Z" });
  scheduler = updateListingSchedulerSettings(scheduler, {
    enabled: true,
    paused: false,
    mode: "full-auto",
    maxUpdatesPerDay: 50,
    maxUpdatesPerAddressPerDay: 1,
    minimumSpacingHours: 1,
    initialWaitDays: 12,
    updateIntervalDays: 12,
    allowedWeekdays: [0, 1, 2, 3, 4, 5, 6],
    startTime: "08:00",
    endTime: "18:00",
  }, { now: "2026-07-29T08:00:00.000Z" });
  return {
    version: 1,
    selectedPlotIds: [],
    houses,
    projects,
    provider: {
      providerNumber: "provider-1",
      company: "Test GmbH",
      firstName: "Test",
      lastName: "Person",
      email: "test@example.invalid",
      phone: "0000",
    },
    promotionImage: null,
    promotionImageEnabled: false,
    uploadHistory: [],
    scheduler,
    houseDistribution: normalizeHouseDistribution({}, houses, projects),
  };
}

function memoryStore(initialState) {
  let state = structuredClone(initialState);
  let savedAtCounter = 0;
  const history = [structuredClone(state)];
  return {
    history,
    async load() {
      return { stored: true, savedAt: `memory-${savedAtCounter}`, state: structuredClone(state) };
    },
    async update(mutator) {
      const mutation = await mutator(structuredClone(state), { savedAt: `memory-${savedAtCounter}` });
      const nextState = mutation?.state || mutation;
      const result = mutation?.state ? mutation.result : undefined;
      state = structuredClone(nextState);
      savedAtCounter += 1;
      history.push(structuredClone(state));
      return { stored: true, savedAt: `memory-${savedAtCounter}`, state: structuredClone(state), result, changed: true };
    },
  };
}

function memoryLease() {
  let active = false;
  return {
    async acquire() {
      if (active) {
        const error = new Error("locked");
        error.code = "LISTING_SCHEDULER_LOCKED";
        throw error;
      }
      active = true;
      return { release: async () => { active = false; } };
    },
  };
}

function fixedOperatingMode(mode = "active", canaryListingIds = []) {
  return {
    async load() {
      return { format: 1, mode, canaryListingIds, valid: true, fallbackReason: "" };
    },
  };
}

function mutableOperatingMode(mode = "canary", canaryListingIds = []) {
  let config = { format: 1, mode, canaryListingIds, valid: true, fallbackReason: "" };
  return {
    async load() { return structuredClone(config); },
    set(nextMode, nextCanaryListingIds = []) {
      config = { format: 1, mode: nextMode, canaryListingIds: nextCanaryListingIds, valid: true, fallbackReason: "" };
    },
  };
}

function sourceControls(state) {
  return state.projects.flatMap((projectValue) => {
    const source = projectValue.listings.find((item) => item.listingOrigin === "group-source");
    return source ? [listingControl(projectValue.listingGroup, source)] : [];
  });
}

test("background catch-up ignores selectedPlotIds and works without a browser", async () => {
  const store = memoryStore(studioState(2));
  const uploads = [];
  const runLogs = [];
  const service = createListingRotationSchedulerService({
    store,
    lease: memoryLease(),
    operatingModeStore: fixedOperatingMode("active"),
    idFactory: ids("run"),
    upload: async ({ project: projectValue, listing: listingValue }) => {
      uploads.push({ projectId: projectValue.id, listingId: listingValue.id, externalId: listingValue.externalId });
      return { ok: true, jobId: createUploadJobId(projectValue, listingValue) };
    },
    writeRunLog: async (event, details) => runLogs.push({ event, ...details }),
  });

  const result = await service.run({
    trigger: "startup-catch-up",
    now: "2026-08-12T03:00:00.000Z",
    endNow: "2026-08-12T03:01:00.000Z",
    ignoreTimeWindow: true,
    stepNow: () => "2026-08-12T03:00:30.000Z",
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.dueCount, 8);
  assert.equal(result.selectedListingIds.length, 2);
  assert.equal(uploads.length, 2);

  const current = (await store.load()).state;
  assert.deepEqual(current.selectedPlotIds, []);
  const copies = current.projects.flatMap((projectValue) => projectValue.listings.filter((item) => item.listingOrigin === "rotation-copy"));
  assert.equal(copies.length, 2);
  assert.equal(new Set(copies.map((copy) => copy.externalId)).size, 2);
  assert.ok(copies.every((copy) => isHvObjectNumber(copy.externalId)));
  assert.ok(copies.every((copy) => copy.status === WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT));
  assert.ok(current.projects.flatMap((item) => item.listings).every((item) => !item.rotationArchivedAt));
  assert.ok(sourceControls(current).every((control) => control.status === WORKFLOW_STATUS.PUBLISHED));
  assert.ok(current.projects.flatMap((item) => item.listingGroup.listingControls).every((control) => control.automaticDeletionEnabled === false));

  const observedStatuses = new Set(store.history.flatMap((snapshot) => sourceControls(snapshot).map((control) => control.status)));
  assert.ok(observedStatuses.has(WORKFLOW_STATUS.SCHEDULED));
  assert.ok(observedStatuses.has(WORKFLOW_STATUS.PROCESSING));
  assert.ok(observedStatuses.has(WORKFLOW_STATUS.PUBLISHED));
  assert.ok(store.history.some((snapshot) => snapshot.projects.some((item) => item.listings.some((entry) => entry.status === WORKFLOW_STATUS.PREPARED))));
  assert.ok(runLogs.some((entry) => entry.event === "finished" && entry.dueCount === 8 && entry.completedCount === 2));
});

test("an identical repeated scheduler run does not recreate or re-upload copies", async () => {
  const store = memoryStore(studioState(1));
  let uploadCount = 0;
  const service = createListingRotationSchedulerService({
    store,
    lease: memoryLease(),
    operatingModeStore: fixedOperatingMode("active"),
    idFactory: ids("run"),
    upload: async ({ project: projectValue, listing: listingValue }) => {
      uploadCount += 1;
      return { ok: true, jobId: createUploadJobId(projectValue, listingValue) };
    },
  });
  await service.run({ now: "2026-08-12T09:00:00.000Z", endNow: "2026-08-12T09:01:00.000Z" });
  const repeated = await service.run({ now: "2026-08-12T11:00:00.000Z", endNow: "2026-08-12T11:00:05.000Z" });
  const current = (await store.load()).state;
  assert.equal(uploadCount, 1);
  assert.equal(current.projects[0].listings.filter((item) => item.listingOrigin === "rotation-copy").length, 1);
  assert.equal(repeated.completedListingIds.length, 0);
  assert.match(repeated.abortReason, /blockiert|Bearbeitung/iu);
});

test("helper restart during canary keeps the source published and resumes only the approved copy", async () => {
  const store = memoryStore(studioState(1));
  const operatingModeStore = fixedOperatingMode("canary", ["project-1-listing-1"]);
  const firstService = createListingRotationSchedulerService({
    store,
    lease: memoryLease(),
    operatingModeStore,
    idFactory: ids("first-run"),
    upload: async () => {
      const error = new Error("Helper wurde während des Upload-Jobs beendet.");
      error.code = "HELPER_ABORTED";
      throw error;
    },
  });
  const first = await firstService.run({ now: "2026-08-12T09:00:00.000Z", endNow: "2026-08-12T09:01:00.000Z" });
  assert.equal(first.ok, false);
  let current = (await store.load()).state;
  const sourceBeforeRestart = current.projects[0].listings.find((item) => item.listingOrigin === "group-source");
  const preparedCopy = current.projects[0].listings.find((item) => item.listingOrigin === "rotation-copy");
  assert.equal(sourceBeforeRestart.status, WORKFLOW_STATUS.PUBLISHED);
  assert.equal(sourceBeforeRestart.rotationArchivedAt, undefined);
  assert.equal(preparedCopy.status, WORKFLOW_STATUS.PREPARED);

  const resumedIds = [];
  const restartedService = createListingRotationSchedulerService({
    store,
    lease: memoryLease(),
    operatingModeStore,
    idFactory: ids("restart-run"),
    upload: async ({ project: projectValue, listing: listingValue }) => {
      resumedIds.push(listingValue.id);
      return { ok: true, jobId: createUploadJobId(projectValue, listingValue) };
    },
  });
  const restarted = await restartedService.run({
    trigger: "startup-catch-up",
    now: "2026-08-12T09:02:00.000Z",
    endNow: "2026-08-12T09:03:00.000Z",
    ignoreTimeWindow: true,
  });
  current = (await store.load()).state;
  const resumedCopy = current.projects[0].listings.find((item) => item.id === preparedCopy.id);
  assert.equal(restarted.ok, true);
  assert.deepEqual(resumedIds, [preparedCopy.id]);
  assert.equal(current.projects[0].listings.filter((item) => item.listingOrigin === "rotation-copy").length, 1);
  assert.equal(resumedCopy.status, WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT);
  assert.equal(current.projects[0].listings.find((item) => item.id === sourceBeforeRestart.id).status, WORKFLOW_STATUS.PUBLISHED);
});

test("startup catch-up defaults to off and performs no rotation or upload", async () => {
  const store = memoryStore(studioState(2));
  let uploadCount = 0;
  const service = createListingRotationSchedulerService({
    store,
    lease: memoryLease(),
    idFactory: ids("off-run"),
    upload: async () => { uploadCount += 1; return { ok: true, jobId: "unexpected" }; },
  });
  const result = await service.run({
    trigger: "startup-catch-up",
    now: "2026-08-12T03:00:00.000Z",
    endNow: "2026-08-12T03:00:10.000Z",
    ignoreTimeWindow: true,
  });
  const current = (await store.load()).state;
  assert.equal(result.operatingMode, "off");
  assert.equal(result.dueCount, 8);
  assert.equal(result.skippedCount, 8);
  assert.equal(uploadCount, 0);
  assert.equal(current.projects.flatMap((item) => item.listings).filter((item) => item.listingOrigin === "rotation-copy").length, 0);
  assert.match(result.abortReason, /fail-closed|Betriebsmodus/iu);
});

test("startup catch-up at off does not resume an already prepared rotation copy", async () => {
  const store = memoryStore(studioState(1));
  const preparingService = createListingRotationSchedulerService({
    store,
    lease: memoryLease(),
    operatingModeStore: fixedOperatingMode("active"),
    idFactory: ids("prepare-before-off"),
    upload: async () => { throw new Error("Vorbereiteter Test-Upload wurde unterbrochen."); },
  });
  await preparingService.run({
    now: "2026-08-12T09:00:00.000Z",
    endNow: "2026-08-12T09:01:00.000Z",
  });
  const beforeRestart = (await store.load()).state;
  const preparedCopy = beforeRestart.projects[0].listings.find((item) => item.listingOrigin === "rotation-copy");
  assert.equal(preparedCopy.status, WORKFLOW_STATUS.PREPARED);

  let resumedUploads = 0;
  const offService = createListingRotationSchedulerService({
    store,
    lease: memoryLease(),
    idFactory: ids("off-restart"),
    upload: async () => { resumedUploads += 1; return { ok: true, jobId: "unexpected" }; },
  });
  const result = await offService.run({
    trigger: "startup-catch-up",
    now: "2026-08-12T09:02:00.000Z",
    endNow: "2026-08-12T09:02:10.000Z",
    ignoreTimeWindow: true,
  });
  const afterRestart = (await store.load()).state;
  const copyAfterRestart = afterRestart.projects[0].listings.find((item) => item.id === preparedCopy.id);
  assert.equal(result.operatingMode, "off");
  assert.equal(resumedUploads, 0);
  assert.equal(copyAfterRestart.status, WORKFLOW_STATUS.PREPARED);
  assert.equal(afterRestart.projects[0].listings.filter((item) => item.listingOrigin === "rotation-copy").length, 1);
  assert.ok(result.skippedListings.some((item) => item.listingId === preparedCopy.id));
});

test("canary processes exactly one explicitly approved listing and skips all other due listings", async () => {
  const initial = studioState(2);
  const approvedListing = initial.projects[0].listings[0];
  const store = memoryStore(initial);
  const uploads = [];
  const service = createListingRotationSchedulerService({
    store,
    lease: memoryLease(),
    operatingModeStore: fixedOperatingMode("canary", [approvedListing.externalId]),
    idFactory: ids("canary-run"),
    upload: async ({ project: projectValue, listing: listingValue }) => {
      uploads.push(listingValue.rotationSourceListingId);
      return { ok: true, jobId: createUploadJobId(projectValue, listingValue) };
    },
  });
  const result = await service.run({
    trigger: "startup-catch-up",
    now: "2026-08-12T09:00:00.000Z",
    endNow: "2026-08-12T09:01:00.000Z",
    ignoreTimeWindow: true,
  });
  assert.equal(result.operatingMode, "canary");
  assert.deepEqual(result.selectedListingIds, [approvedListing.id]);
  assert.deepEqual(uploads, [approvedListing.id]);
  assert.equal(result.skippedListings.filter((item) => /nicht explizit freigegeben/iu.test(item.reason)).length, 7);
  const current = (await store.load()).state;
  assert.equal(current.projects.flatMap((item) => item.listings).filter((item) => item.listingOrigin === "rotation-copy").length, 1);
});

test("switching canary to active releases the remaining due scope without duplicating the canary", async () => {
  const initial = studioState(2);
  const approvedListing = initial.projects[0].listings[0];
  const store = memoryStore(initial);
  const operatingModeStore = mutableOperatingMode("canary", [approvedListing.id]);
  const uploads = [];
  const service = createListingRotationSchedulerService({
    store,
    lease: memoryLease(),
    operatingModeStore,
    idFactory: ids("mode-switch-run"),
    upload: async ({ project: projectValue, listing: listingValue }) => {
      uploads.push(listingValue.rotationSourceListingId);
      return { ok: true, jobId: createUploadJobId(projectValue, listingValue) };
    },
  });
  const canary = await service.run({ now: "2026-08-12T09:00:00.000Z", endNow: "2026-08-12T09:01:00.000Z" });
  operatingModeStore.set("active");
  const active = await service.run({ now: "2026-08-13T09:00:00.000Z", endNow: "2026-08-13T09:01:00.000Z" });
  assert.equal(canary.operatingMode, "canary");
  assert.equal(active.operatingMode, "active");
  assert.equal(uploads.filter((id) => id === approvedListing.id).length, 1);
  assert.ok(uploads.some((id) => id !== approvedListing.id));
});

test("persistent scheduler claim blocks parallel helpers and recovers an expired crash lock", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fpi-listing-scheduler-lock-"));
  const path = join(directory, "scheduler.lock");
  const first = createPersistentLease(path, { leaseMs: 60_000, idFactory: ids("lease") });
  const second = createPersistentLease(path, { leaseMs: 60_000, idFactory: ids("lease") });
  const held = await first.acquire({ now: "2026-08-12T10:00:00.000Z", ownerId: "helper-a" });
  await assert.rejects(
    second.acquire({ now: "2026-08-12T10:00:30.000Z", ownerId: "helper-b" }),
    (error) => error.code === "LISTING_SCHEDULER_LOCKED",
  );
  const recovered = await second.acquire({ now: "2026-08-12T10:01:01.000Z", ownerId: "helper-b" });
  assert.equal(recovered.record.ownerId, "helper-b");
  await recovered.release();
  await held.release();
});

test("a renewed scheduler claim cannot be taken over by a parallel long-running helper", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fpi-listing-scheduler-heartbeat-"));
  const path = join(directory, "scheduler.lock");
  const first = createPersistentLease(path, { leaseMs: 60_000, heartbeatMs: 60_000, idFactory: ids("lease") });
  const second = createPersistentLease(path, { leaseMs: 60_000, heartbeatMs: 60_000, idFactory: ids("lease") });
  const held = await first.acquire({ now: "2026-08-12T10:00:00.000Z", ownerId: "helper-a" });
  await held.refresh({ now: "2026-08-12T10:00:45.000Z" });
  await assert.rejects(
    second.acquire({ now: "2026-08-12T10:01:01.000Z", ownerId: "helper-b" }),
    (error) => error.code === "LISTING_SCHEDULER_LOCKED",
  );
  const recovered = await second.acquire({ now: "2026-08-12T10:01:46.000Z", ownerId: "helper-b" });
  assert.equal(recovered.record.ownerId, "helper-b");
  await recovered.release();
  await held.release();
});
