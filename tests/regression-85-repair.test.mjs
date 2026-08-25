import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createUploadJobId } from "../batch-upload.mjs";
import { confirmImportReportInState } from "../immoprofessional-import-confirmation.mjs";
import { normalizeHouseDistribution } from "../house-distribution.mjs";
import {
  assignListingGroupVariant,
  createListingGroup,
  listingControl,
  normalizeListingGroup,
  updateListingControl,
} from "../listing-groups.mjs";
import {
  createProductionDeleteLedger,
  createProductionDeleteService,
  PRODUCTION_DELETE_STATUS,
} from "../listing-rotation-production-delete.mjs";
import {
  prepareRegressionRepairRotationInState,
  REGRESSION_REPAIR_SOURCE_STATUS,
} from "../listing-regression-repair.mjs";
import {
  createRegression85CampaignStore,
  deriveRegression85Scope,
  REGRESSION_85_EXPECTED_COUNT,
  REGRESSION_85_REPAIR_STAGES,
} from "../regression-85-repair-scope.mjs";
import { runRegression85RepairCli } from "../regression-85-repair-cli.mjs";
import {
  createRegression85DeleteMutationGuard,
  createRegression85RepairService,
  previewRegression85Repair,
} from "../regression-85-repair-service.mjs";
import { WORKFLOW_STATUS } from "../workflow-status.mjs";

const NOW = "2026-08-25T12:00:00.000Z";

function ids(prefix) {
  let value = 0;
  return () => `${prefix}-${++value}`;
}

function house(id, name, index) {
  const roles = ["cover", "living", "kitchen", "bathroom", "bedroom", "kids", "office", "emotion", "floorplan_ground", "floorplan_upper"];
  return {
    id,
    name,
    approved: true,
    houseType: "Einfamilienhaus",
    livingArea: 120 + index,
    rooms: 4 + (index % 3),
    bedrooms: 3,
    bathrooms: 2,
    floors: 2,
    housePrice: 300_000 + index * 5_000,
    constructionYear: 2027,
    energyDemand: 18,
    energyClass: "A++",
    heatingType: "Wärmepumpe",
    energySource: "Strom",
    architecture: `Architektur ${name}`,
    equipmentHighlights: `Ausstattung ${name}`,
    useStandardPackage: true,
    images: roles.map((role, imageIndex) => ({
      id: `${id}-image-${imageIndex + 1}`,
      name: `${id}-${imageIndex + 1}.jpg`,
      caption: `${name} ${role}`,
      mimeType: "image/jpeg",
      dataUrl: "data:image/jpeg;base64,AA==",
      isFloorplan: role.startsWith("floorplan"),
      role,
      eligibleForListingHero: !role.startsWith("floorplan"),
    })),
  };
}

function listing(houseValue, id, externalId, status = WORKFLOW_STATUS.PUBLISHED) {
  return {
    id,
    externalId,
    templateId: houseValue.id,
    templateName: houseValue.name,
    price: 500_000,
    version: status === REGRESSION_REPAIR_SOURCE_STATUS ? 2 : 1,
    createdAt: "2026-08-24T16:51:26.000Z",
    status,
    statusMessage: status,
    listingOrigin: status === REGRESSION_REPAIR_SOURCE_STATUS ? "rotation-copy" : "group-source",
    ...(status === REGRESSION_REPAIR_SOURCE_STATUS ? {
      rotationSourceListingId: `historical-${id}`,
      rotationRemovedHouseId: houseValue.id,
      rotationAddedHouseId: houseValue.id,
      transferredAt: "2026-08-24T16:51:32.000Z",
    } : {}),
    texts: {
      title: "Titel",
      description: "Beschreibung",
      equipment: "Ausstattung",
      location: "Lage",
      other: "Sonstiges",
    },
  };
}

function regressionHouseName(index) {
  if (index < 82) return "SOL 242 V4";
  if (index < 84) return "SOL 204 V4";
  return "SOL 229 V3";
}

function buildFixture() {
  const houses = Array.from({ length: 22 }, (_, index) => house(
    `house-${index + 1}`,
    index === 0 ? "SOL 242 V4" : index === 1 ? "SOL 204 V4" : index === 2 ? "SOL 229 V3" : `SUN ${100 + index}`,
    index,
  ));
  const projects = [];
  const events = [];
  const jobs = [];
  const portalStatuses = [];
  for (let index = 0; index < REGRESSION_85_EXPECTED_COUNT; index += 1) {
    const projectId = `project-${index + 1}`;
    const idFactory = ids(projectId);
    const regressionHouse = houses.find((candidate) => candidate.name === regressionHouseName(index));
    let group = createListingGroup(projectId, { idFactory, now: NOW });
    const listings = [];
    for (let variantIndex = 0; variantIndex < 4; variantIndex += 1) {
      const houseValue = variantIndex === 0 ? regressionHouse : houses[3 + ((index + variantIndex) % 19)];
      const source = listing(
        houseValue,
        variantIndex === 0 ? `regression-${index + 1}` : `${projectId}-listing-${variantIndex + 1}`,
        `30460-${String(100_000 + index * 4 + variantIndex).padStart(6, "0")}`,
        variantIndex === 0 ? REGRESSION_REPAIR_SOURCE_STATUS : WORKFLOW_STATUS.PUBLISHED,
      );
      group = assignListingGroupVariant(group, group.variants[variantIndex].id, houseValue, source, { idFactory, now: NOW });
      const assigned = group.variants[variantIndex].listing;
      group = updateListingControl(group, assigned, {
        automaticUpdateEnabled: variantIndex !== 0,
        automaticDeletionEnabled: false,
        status: assigned.status,
        statusMessage: assigned.statusMessage,
        updateMode: "full-auto",
        lastSuccessAt: variantIndex === 0 ? "" : "2026-08-01T08:00:00.000Z",
        lastUpdatedAt: variantIndex === 0 ? "" : "2026-08-01T08:00:00.000Z",
      }, { idFactory, now: NOW });
      listings.push(group.variants[variantIndex].listing);
    }
    const project = {
      id: projectId,
      plotId: `plot-${index + 1}`,
      isActive: true,
      owner: "fabian",
      name: `Adresse ${index + 1}`,
      street: "Teststraße",
      houseNumber: String(index + 1),
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
      selectedHouseIds: group.variants.map((variant) => variant.templateId),
      listings,
      listingGroup: group,
      createdAt: "2026-07-01T08:00:00.000Z",
    };
    const regression = listings[0];
    const jobId = createUploadJobId(project, regression);
    const timestamp = new Date(Date.parse("2026-08-24T16:51:32.000Z") + index * 8 * 60_000).toISOString();
    regression.createdAt = new Date(Date.parse(timestamp) - 6_000).toISOString();
    regression.transferredAt = timestamp;
    const variant = group.variants.find((candidate) => candidate.listing?.id === regression.id);
    variant.listing = regression;
    projects.push(project);
    events.push({
      processId: 4460,
      event: "transferred",
      jobType: "automatic-listing-rotation",
      status: WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT,
      jobId,
      projectId,
      listingId: regression.id,
      externalId: regression.externalId,
      runId: `rogue-run-${index + 1}`,
      timestamp,
    });
    jobs.push({ jobId, projectId, listingId: regression.id, status: WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT, transferredAt: timestamp });
    portalStatuses.push({ externalObjectNumber: regression.externalId, status: "not_transferred", observedAt: NOW });
  }
  const state = {
    version: 1,
    houses,
    projects,
    provider: {
      providerNumber: "30460",
      company: "Test GmbH",
      firstName: "Test",
      lastName: "Person",
      email: "test@example.invalid",
      phone: "0000",
    },
    promotionSettings: { enabled: true, automaticRotation: true },
    promotionImages: Array.from({ length: 6 }, (_, index) => ({
      id: `promotion-${index + 1}`,
      name: `Aktion ${index + 1}.jpg`,
      caption: `Aktion ${index + 1}`,
      mimeType: "image/jpeg",
      dataUrl: "data:image/jpeg;base64,AA==",
      role: "promotion",
      active: true,
      eligibleForListingHero: true,
      order: index + 1,
    })),
    promotionUsage: [],
    uploadHistory: jobs.map((job, index) => ({ id: `history-${index + 1}`, ...job })),
    houseDistribution: null,
    scheduler: { settings: { enabled: true, paused: false, mode: "full-auto", updateIntervalDays: 12, initialWaitDays: 12 }, runs: [] },
  };
  state.houseDistribution = normalizeHouseDistribution(null, houses, projects);
  return { state, events, ledger: { format: 1, jobs }, portalStatuses };
}

function derivedFixture() {
  const fixture = buildFixture();
  const derived = deriveRegression85Scope(fixture.state, fixture.events, fixture.ledger, { portalStatuses: fixture.portalStatuses });
  return { ...fixture, ...derived };
}

test("derives one immutable exact 85 allowlist with the proven 82/2/1 distribution", () => {
  const { scope, scopeHash } = derivedFixture();
  assert.equal(scope.items.length, 85);
  assert.equal(new Set(scope.items.map((item) => item.regressionListingId)).size, 85);
  assert.deepEqual(scope.houseDistribution, { "SOL 204 V4": 2, "SOL 229 V3": 1, "SOL 242 V4": 82 });
  assert.match(scopeHash, /^[a-f0-9]{64}$/u);
  assert.equal(scope.items.every((item) => item.rootProcessId === 4460), true);
  assert.equal(scope.items.every((item) => item.portalStatus === "not_transferred"), true);
});

test("84, 86, duplicate evidence and incomplete portal snapshots fail closed", () => {
  const fixture = buildFixture();
  assert.throws(
    () => deriveRegression85Scope(fixture.state, fixture.events.slice(0, 84), fixture.ledger, { portalStatuses: fixture.portalStatuses }),
    (error) => error.code === "REGRESSION_85_SCOPE_MISMATCH",
  );
  assert.throws(
    () => deriveRegression85Scope(fixture.state, [...fixture.events, fixture.events[0]], fixture.ledger, { portalStatuses: fixture.portalStatuses }),
    (error) => error.code === "REGRESSION_85_SCOPE_MISMATCH",
  );
  assert.throws(
    () => deriveRegression85Scope(fixture.state, [
      ...fixture.events,
      { ...fixture.events[0], jobId: "rogue-extra-job", listingId: "rogue-extra-listing", externalId: "30460-999999" },
    ], fixture.ledger, { portalStatuses: fixture.portalStatuses }),
    (error) => error.code === "REGRESSION_85_SCOPE_MISMATCH",
  );
  assert.throws(
    () => deriveRegression85Scope(fixture.state, fixture.events, fixture.ledger, { portalStatuses: fixture.portalStatuses.slice(0, 84) }),
    (error) => error.code === "REGRESSION_85_PORTAL_SNAPSHOT_INCOMPLETE",
  );
});

test("an inactive regression variant is reactivated only when the four-house slot is safely free", () => {
  const fixture = derivedFixture();
  const scopeItem = fixture.scope.items[0];
  const state = structuredClone(fixture.state);
  const project = state.projects.find((candidate) => candidate.id === scopeItem.projectId);
  project.listingGroup.variants = project.listingGroup.variants.map((variant) => variant.listing?.id === scopeItem.regressionListingId
    ? { ...variant, active: false }
    : variant);
  const result = prepareRegressionRepairRotationInState(state, scopeItem, {
    campaignId: "campaign-inactive-source",
    scopeHash: fixture.scopeHash,
    schedulerRunId: "repair-inactive-source",
    now: NOW,
  });
  const repairedProject = result.state.projects.find((candidate) => candidate.id === scopeItem.projectId);
  const repairedVariant = repairedProject.listingGroup.variants.find((variant) => variant.listing?.id === result.copy.id);
  assert.equal(repairedVariant.active, true);
  assert.equal(result.copy.rotationRemovedHouseId, scopeItem.distributionRemovedHouseId);
  assert.equal(repairedProject.listingGroup.variants.filter((variant) => variant.active).length, 4);
});

test("repair preparation keeps B pending, creates exactly one deterministic C and persists CreativeSelection", () => {
  const { state, scope, scopeHash } = derivedFixture();
  const scopeItem = scope.items[0];
  const first = prepareRegressionRepairRotationInState(state, scopeItem, {
    campaignId: "campaign-1",
    scopeHash,
    schedulerRunId: "repair-run-1",
    now: NOW,
  });
  const project = first.state.projects.find((candidate) => candidate.id === scopeItem.projectId);
  const source = project.listings.find((candidate) => candidate.id === scopeItem.regressionListingId);
  assert.equal(source.status, WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT);
  assert.equal(listingControl(normalizeListingGroup(project.listingGroup, project.id), source).status, WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT);
  assert.equal(first.copy.status, WORKFLOW_STATUS.PREPARED);
  assert.equal(first.copy.creativeSelection.format, 1);
  assert.notEqual(first.copy.templateId, source.templateId);
  assert.equal(first.copy.productionLifecycle.regressionRepair.scopeHash, scopeHash);
  const repeated = prepareRegressionRepairRotationInState(first.state, scopeItem, {
    campaignId: "campaign-1",
    scopeHash,
    schedulerRunId: "repair-run-1",
    now: NOW,
  });
  assert.equal(repeated.idempotent, true);
  assert.equal(repeated.copy.id, first.copy.id);
  assert.equal(project.listings.filter((listingValue) => listingValue.rotationSourceListingId === source.id).length, 1);
});

test("the complete 85 preview is read-only, varied and keeps unrelated SOL 242 untouched", () => {
  const { state, scope, scopeHash } = derivedFixture();
  const foreignSol242 = {
    ...structuredClone(state.projects[0].listings[1]),
    id: "foreign-legitimate-sol-242",
    externalId: "30460-777777",
    templateId: state.houses[0].id,
    templateName: "SOL 242 V4",
    status: WORKFLOW_STATUS.PUBLISHED,
    marker: "outside-regression-85-scope",
  };
  state.projects[0].listings.push(foreignSol242);
  const campaign = {
    format: 1,
    campaignId: "campaign-preview",
    scopeHash,
    scope,
    mode: "off",
    activeScopeItemId: "",
    createdAt: NOW,
    updatedAt: NOW,
    activatedAt: "",
    pausedAt: "",
    completedAt: "",
    lastErrorCode: "",
    lastError: "",
    checkpointHistory: [],
    progress: scope.items.map((item) => ({
      scopeItemId: item.scopeItemId,
      stage: REGRESSION_85_REPAIR_STAGES.IDENTIFIED,
      updatedAt: NOW,
      earliestEligibleAt: "",
      replacementListingId: "",
      replacementExternalId: "",
      uploadJobId: "",
      importReportId: "",
      deleteJobId: "",
      deleteReportId: "",
      lastErrorCode: "",
      lastError: "",
    })),
  };
  const original = structuredClone(state);
  const preview = previewRegression85Repair(state, campaign, { now: NOW });
  assert.equal(preview.items.length, 85);
  assert.equal(preview.summary.distinctHouseCount > 10, true);
  assert.equal(preview.summary.mostFrequentHouse.count < 20, true);
  assert.equal(preview.summary.longestIdenticalSeries <= 2, true);
  assert.equal(preview.summary.actionHeroCount > 0, true);
  assert.equal(preview.summary.fallbackCount, 0);
  assert.deepEqual(state, original);
  assert.deepEqual(
    state.projects[0].listings.find((item) => item.id === foreignSol242.id),
    original.projects[0].listings.find((item) => item.id === foreignSol242.id),
  );
});

test("campaign store is fail-closed, immutable and restart-stable", async () => {
  const { scope, scopeHash } = derivedFixture();
  const directory = await mkdtemp(join(tmpdir(), "regression-85-store-"));
  const path = join(directory, "campaign.json");
  const firstStore = createRegression85CampaignStore(path);
  assert.equal((await firstStore.load()).mode, "off");
  const initialized = await firstStore.initialize(scope, scopeHash, { now: NOW });
  assert.equal(initialized.mode, "off");
  const active = await firstStore.update((campaign) => ({ ...campaign, mode: "active", activeScopeItemId: campaign.scope.items[0].scopeItemId }), { now: NOW });
  const restartedStore = createRegression85CampaignStore(path);
  const restarted = await restartedStore.load();
  assert.equal(restarted.mode, "active");
  assert.equal(restarted.activeScopeItemId, active.activeScopeItemId);
  await assert.rejects(
    () => restartedStore.update((campaign) => ({ ...campaign, scope: { ...campaign.scope, items: campaign.scope.items.slice(1) } }), { now: NOW }),
    (error) => error.code === "REGRESSION_85_SCOPE_IMMUTABLE",
  );
});

test("scope preparation is blocked outside the exact approved release runtime", async () => {
  const fixture = buildFixture();
  const directory = await mkdtemp(join(tmpdir(), "regression-85-cli-runtime-"));
  const campaignStore = createRegression85CampaignStore(join(directory, "campaign.json"));
  await assert.rejects(
    () => runRegression85RepairCli(["prepare-scope", "--portal-snapshot", "unused.json"], {
      campaignStore,
      catalogStore: { async load() { return { state: fixture.state }; } },
      uploadLedger: { async read() { return fixture.ledger; } },
      readUploadEvents: async () => fixture.events,
      readPortalSnapshot: async () => fixture.portalStatuses,
      productionPolicyStore: {
        async load() { return { valid: true, expectedRuntimeCommit: "a".repeat(40) }; },
      },
      loadRuntimeProvenance: async () => ({
        valid: true,
        runtimeCommit: "b".repeat(40),
        runtimeRelease: "release-test",
        sourceTreeClean: true,
      }),
      now: () => NOW,
    }),
    (error) => error.code === "PRODUCTION_RUNTIME_COMMIT_MISMATCH",
  );
  assert.equal((await campaignStore.load()).valid, false);
});

test("DELETE guard permits only the current serial scope item and blocks foreign or inactive sources", async () => {
  const { scope, scopeHash } = derivedFixture();
  const directory = await mkdtemp(join(tmpdir(), "regression-85-delete-guard-"));
  const store = createRegression85CampaignStore(join(directory, "campaign.json"));
  await store.initialize(scope, scopeHash, { now: NOW });
  const current = scope.items[0];
  await store.update((campaign) => ({
    ...campaign,
    mode: "active",
    activeScopeItemId: current.scopeItemId,
    progress: campaign.progress.map((item) => item.scopeItemId === current.scopeItemId
      ? { ...item, stage: REGRESSION_85_REPAIR_STAGES.REPLACEMENT_PUBLISHED, replacementListingId: "replacement-1" }
      : item),
  }), { now: NOW });
  const guard = createRegression85DeleteMutationGuard(store);
  const allowed = await guard.assert({ sourceListingId: current.regressionListingId, replacementListingId: "replacement-1" });
  assert.equal(allowed.guarded, true);
  await assert.rejects(
    () => guard.assert({ sourceListingId: scope.items[1].regressionListingId, replacementListingId: "replacement-2" }),
    (error) => error.code === "REGRESSION_85_DELETE_SCOPE_BLOCKED",
  );
  await assert.rejects(
    () => guard.assert({ sourceListingId: "foreign-source", replacementListingId: "foreign-replacement" }),
    (error) => error.code === "REGRESSION_85_FOREIGN_DELETE_BLOCKED",
  );
});

test("serial worker survives restart, respects the daily guard and performs replacement-first exactly once", async () => {
  const { state: initialState, scope, scopeHash, ledger: rogueLedger } = derivedFixture();
  const directory = await mkdtemp(join(tmpdir(), "regression-85-worker-"));
  const campaignStore = createRegression85CampaignStore(join(directory, "campaign.json"));
  await campaignStore.initialize(scope, scopeHash, { now: NOW });
  await campaignStore.update((campaign) => ({ ...campaign, mode: "active", activatedAt: NOW }), { now: NOW });
  let catalogState = structuredClone(initialState);
  const catalogStore = {
    async load() { return { stored: true, savedAt: NOW, state: catalogState }; },
    async update(mutator) {
      const mutation = await mutator(catalogState);
      catalogState = mutation?.state || mutation;
      return { stored: true, state: catalogState, result: mutation?.result, changed: true };
    },
  };
  const uploadLedger = { format: 1, jobs: structuredClone(rogueLedger.jobs) };
  const uploadJobLedger = { async read() { return structuredClone(uploadLedger); } };
  const deleteLedger = createProductionDeleteLedger(join(directory, "delete-jobs.json"));
  let dailyConsumed = true;
  let uploadCount = 0;
  let importReportAvailable = false;
  let runtimeOwnershipAllowed = false;
  const runtimeOwnershipGuard = {
    async assert() {
      if (!runtimeOwnershipAllowed) {
        const error = new Error("synthetic runtime ownership mismatch");
        error.code = "PRODUCTION_RUNTIME_PORT_OWNER_MISMATCH";
        throw error;
      }
      return { valid: true, portOwnerPids: [process.pid] };
    },
  };
  const deleteMutationGuard = createRegression85DeleteMutationGuard(campaignStore);
  let deleteReportAvailable = false;
  const productionDeleteService = createProductionDeleteService({
    store: catalogStore,
    modeStore: { async load() { return { valid: true, mode: "active" }; } },
    ledger: deleteLedger,
    productionPolicyStore: { async load() { return { valid: true, maxRunItems: 3 }; } },
    runtimeOwnershipGuard,
    mutationGuard: deleteMutationGuard,
    upload: async () => { deleteReportAvailable = true; },
    mailAdapter: {
      readOnly: true,
      async findCandidates() { return deleteReportAvailable ? [{ mailboxName: "reports", transportId: "1" }] : []; },
      async readRawMessage() { return { rawSource: "synthetic delete report" }; },
    },
    parseReport: (_raw, input) => ({
      externalObjectNumber: input.expectedTarget,
      deleteResult: "success",
      messageId: `<delete-${input.expectedTarget}@example.invalid>`,
      rawHash: input.expectedTarget.replace(/\D/gu, "").padEnd(64, "a").slice(0, 64),
      providerProcessedAt: NOW,
    }),
    now: () => NOW,
  });
  const importReportService = {
    async runOnce(input) {
      if (!importReportAvailable) return { ran: true, pendingCount: 1, candidateCount: 0, processed: [] };
      const replacementExternalId = input.allowedExternalObjectNumbers[0];
      const ledger = await uploadJobLedger.read();
      await catalogStore.update((state) => confirmImportReportInState(state, {
        messageId: `<import-${replacementExternalId}@example.invalid>`,
        rawHash: replacementExternalId.replace(/\D/gu, "").padEnd(64, "b").slice(0, 64),
        providerImportAt: NOW,
        subject: "Importbericht OpenImmo XML",
        senderSoftware: "Test",
        objectCount: 1,
        providerId: "30460",
        providerCompany: "Test GmbH",
        providerEmail: "test@example.invalid",
        externalObjectNumber: replacementExternalId,
        importResult: "success",
        parserVersion: "1.0.0",
      }, {
        transportId: "1",
        accountName: "Livinghaus",
        accountId: "account-1",
        mailboxName: "Inseratestudio – Importberichte",
        receivedAt: NOW,
      }, ledger, { now: NOW }));
      return { ran: true, pendingCount: 1, candidateCount: 1, processed: [{ status: "confirmed" }] };
    },
  };
  const serviceOptions = {
    campaignStore,
    catalogStore,
    lease: { async acquire() { return { async release() {} }; } },
    rotationModeStore: { async load() { return { valid: true, mode: "off" }; } },
    portalModeStore: { async load() { return { valid: true, mode: "off" }; } },
    productionDeleteModeStore: { async load() { return { valid: true, mode: "active" }; } },
    productionPolicyStore: { async load() { return { valid: true, maxRunItems: 3 }; } },
    runtimeOwnershipGuard,
    uploadJobLedger,
    productionDeleteLedger: {
      async read() {
        if (serviceOptions.foreignDeleteOpen) {
          return {
            format: 1,
            jobs: [{
              deleteJobId: "foreign-delete-job",
              sourceListingId: "foreign-source",
              replacementListingId: "foreign-replacement",
              status: PRODUCTION_DELETE_STATUS.PENDING_CONFIRMATION,
            }],
          };
        }
        return deleteLedger.read();
      },
    },
    plotDailyUploadGuard: { async inspect() { return { consumed: dailyConsumed }; } },
    upload: async ({ project, listing }) => {
      uploadCount += 1;
      const jobId = createUploadJobId(project, listing);
      uploadLedger.jobs.push({ jobId, projectId: project.id, listingId: listing.id, status: WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT, transferredAt: NOW });
      return { ok: true, jobId };
    },
    importReportService,
    productionDeleteService,
    now: () => NOW,
    foreignDeleteOpen: false,
  };
  let worker = createRegression85RepairService(serviceOptions);
  await assert.rejects(
    () => worker.runOnce({ runId: "repair-runtime-owner-blocked" }),
    (error) => error.code === "PRODUCTION_RUNTIME_PORT_OWNER_MISMATCH",
  );
  assert.equal((await campaignStore.load()).mode, "paused");
  await campaignStore.update((campaign) => ({ ...campaign, mode: "active", pausedAt: "" }), { now: NOW });

  runtimeOwnershipAllowed = true;
  serviceOptions.foreignDeleteOpen = true;
  await assert.rejects(
    () => worker.runOnce({ runId: "repair-foreign-delete-blocked" }),
    (error) => error.code === "REGRESSION_85_FOREIGN_DELETE_OPEN",
  );
  assert.equal((await campaignStore.load()).mode, "paused");
  await campaignStore.update((campaign) => ({ ...campaign, mode: "active", pausedAt: "" }), { now: NOW });
  serviceOptions.foreignDeleteOpen = false;

  let result = await worker.runOnce({ runId: "repair-run-1" });
  assert.equal(result.reason, "waiting_daily_plot_window");
  assert.equal(uploadCount, 0);

  dailyConsumed = false;
  result = await worker.runOnce({ runId: "repair-run-2" });
  assert.equal(result.stage, REGRESSION_85_REPAIR_STAGES.REPLACEMENT_CREATED);
  const firstScopeItem = scope.items[0];
  let project = catalogState.projects.find((candidate) => candidate.id === firstScopeItem.projectId);
  let source = project.listings.find((candidate) => candidate.id === firstScopeItem.regressionListingId);
  assert.equal(source.status, WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT);

  worker = createRegression85RepairService(serviceOptions);
  result = await worker.runOnce({ runId: "repair-run-3" });
  assert.equal(result.stage, REGRESSION_85_REPAIR_STAGES.TRANSFERRED_PENDING_IMPORT);
  assert.equal(uploadCount, 1);

  worker = createRegression85RepairService(serviceOptions);
  result = await worker.runOnce({ runId: "repair-run-after-restart" });
  assert.equal(result.reason, "awaiting_import_confirmation");
  assert.equal(uploadCount, 1);

  importReportAvailable = true;
  result = await worker.runOnce({ runId: "repair-run-import" });
  assert.equal(result.stage, REGRESSION_85_REPAIR_STAGES.REPLACEMENT_PUBLISHED);
  project = catalogState.projects.find((candidate) => candidate.id === firstScopeItem.projectId);
  source = project.listings.find((candidate) => candidate.id === firstScopeItem.regressionListingId);
  const replacement = project.listings.find((candidate) => candidate.id === source.supersededByListingId);
  assert.equal(source.status, WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT);
  assert.equal(replacement.status, WORKFLOW_STATUS.PUBLISHED);
  assert.equal(source.productionDeleteState, "authorized");

  worker = createRegression85RepairService(serviceOptions);
  result = await worker.runOnce({ runId: "repair-run-delete" });
  assert.equal(result.stage, REGRESSION_85_REPAIR_STAGES.OLD_DELETE_PENDING);
  project = catalogState.projects.find((candidate) => candidate.id === firstScopeItem.projectId);
  source = project.listings.find((candidate) => candidate.id === firstScopeItem.regressionListingId);
  assert.equal(source.status, WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT);

  worker = createRegression85RepairService(serviceOptions);
  result = await worker.runOnce({ runId: "repair-run-confirm-delete" });
  assert.equal(result.stage, REGRESSION_85_REPAIR_STAGES.REPAIR_COMPLETED);
  project = catalogState.projects.find((candidate) => candidate.id === firstScopeItem.projectId);
  source = project.listings.find((candidate) => candidate.id === firstScopeItem.regressionListingId);
  const finalReplacement = project.listings.find((candidate) => candidate.id === replacement.id);
  assert.equal(source.status, WORKFLOW_STATUS.DELETED);
  assert.equal(finalReplacement.status, WORKFLOW_STATUS.PUBLISHED);
  assert.equal(uploadCount, 1);
  assert.equal((await deleteLedger.read()).jobs.length, 1);
  assert.equal((await campaignStore.load()).progress[0].stage, REGRESSION_85_REPAIR_STAGES.REPAIR_COMPLETED);
});
