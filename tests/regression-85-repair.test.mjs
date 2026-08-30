import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createUploadJobId } from "../batch-upload.mjs";
import { confirmImportReportInState } from "../immoprofessional-import-confirmation.mjs";
import { IMMOPROFESSIONAL_EXCHANGE_DELETE_CONFIRMATION_TYPE } from "../immoprofessional-delete-report-parser.mjs";
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
  REGRESSION_85_APPROVED_SCOPE_HASH,
  REGRESSION_85_CLASSIFICATIONS,
  REGRESSION_85_EXPECTED_COUNT,
  REGRESSION_85_REPAIR_STAGES,
  REGRESSION_85_REPAIR_STRATEGIES,
} from "../regression-85-repair-scope.mjs";
import {
  applyRegression85Classifications,
  classifyRegression85Scope,
  inspectRegression85OperationalGate,
} from "../regression-85-classification.mjs";
import { regression85ClassificationFingerprint } from "../regression-85-non-exported-delete-confirmation.mjs";
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
  const derived = deriveRegression85Scope(fixture.state, fixture.events, fixture.ledger);
  return { ...fixture, ...derived };
}

function classifiedProgress(item, classification = REGRESSION_85_CLASSIFICATIONS.REPLACEMENT_REQUIRED) {
  const ambiguous = classification === REGRESSION_85_CLASSIFICATIONS.AMBIGUOUS;
  return {
    scopeItemId: item.scopeItemId,
    stage: ambiguous ? REGRESSION_85_REPAIR_STAGES.AMBIGUOUS_BLOCKED : REGRESSION_85_REPAIR_STAGES.IDENTIFIED,
    classification,
    classificationReason: ambiguous ? "synthetic_ambiguous" : "synthetic_exact_positive_evidence",
    evidenceHash: item.scopeItemId.replace(/[^a-f0-9]/gu, "a").padEnd(64, "b").slice(0, 64),
    classifiedAt: NOW,
    repairStrategy: ambiguous
      ? REGRESSION_85_REPAIR_STRATEGIES.NONE
      : classification === REGRESSION_85_CLASSIFICATIONS.ROLLBACK_ELIGIBLE
        ? REGRESSION_85_REPAIR_STRATEGIES.ROLLBACK
        : REGRESSION_85_REPAIR_STRATEGIES.REPLACEMENT,
    repairState: ambiguous ? "blocked_ambiguous" : "classified",
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
  };
}

function campaignFor(fixture, classifications = fixture.scope.items.map(() => REGRESSION_85_CLASSIFICATIONS.REPLACEMENT_REQUIRED)) {
  const progress = fixture.scope.items.map((item, index) => classifiedProgress(item, classifications[index]));
  return {
    format: 2,
    campaignId: "campaign-test",
    scopeHash: fixture.scopeHash,
    scopeEvidenceHash: fixture.scopeEvidenceHash,
    scope: fixture.scope,
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
    classificationSummary: {
      classifiedAt: NOW,
      snapshotObservedAt: NOW,
      total: 85,
      counts: Object.fromEntries(Object.values(REGRESSION_85_CLASSIFICATIONS).map((value) => [value, classifications.filter((item) => item === value).length])),
    },
    progress,
  };
}

function completeRollbackEntries(fixture, count) {
  const state = structuredClone(fixture.state);
  const classifications = fixture.scope.items.map(() => REGRESSION_85_CLASSIFICATIONS.ROLLBACK_ELIGIBLE);
  const campaign = campaignFor(fixture, classifications);
  campaign.mode = "paused";
  const deleteLedger = { format: 1, jobs: [] };
  state.deleteReports = [];
  for (let index = 0; index < count; index += 1) {
    const scopeItem = fixture.scope.items[index];
    const progress = campaign.progress[index];
    const project = state.projects.find((candidate) => candidate.id === scopeItem.projectId);
    const source = project.listings.find((candidate) => candidate.id === scopeItem.originalSourceListingId);
    const regression = project.listings.find((candidate) => candidate.id === scopeItem.regressionListingId);
    const rawHash = String(index + 1).padStart(64, "d").slice(-64);
    const deleteJobId = `production-delete:${String(index + 1).padStart(64, "e").slice(-64)}`;
    const deleteReportId = `delete-report-${rawHash.slice(0, 32)}`;
    const messageId = `<resume-delete-${index + 1}@example.invalid>`;
    const confirmationType = IMMOPROFESSIONAL_EXCHANGE_DELETE_CONFIRMATION_TYPE;
    Object.assign(source, {
      status: WORKFLOW_STATUS.PUBLISHED,
      statusMessage: `Rollback abgeschlossen ${source.externalId}`,
      externalDeletionPending: false,
      productionDeleteState: "",
      supersededByListingId: "",
    });
    Object.assign(regression, {
      status: WORKFLOW_STATUS.DELETED,
      statusMessage: `Extern gelöscht ${regression.externalId}`,
      externalDeletionPending: false,
      productionDeleteState: "confirmed",
      deleteJobId,
      deleteReportHash: rawHash,
      deleteReportMessageId: messageId,
      deleteConfirmationType: confirmationType,
    });
    let group = normalizeListingGroup(project.listingGroup, project.id, { now: NOW });
    const variant = group.variants.find((candidate) => candidate.listing?.id === regression.id);
    const sourceHouse = state.houses.find((candidate) => candidate.id === source.templateId);
    group = assignListingGroupVariant(group, variant.id, sourceHouse, source, { now: NOW });
    const assignedSource = group.variants.find((candidate) => candidate.id === variant.id).listing;
    Object.assign(source, assignedSource);
    group = updateListingControl(group, source, {
      automaticUpdateEnabled: true,
      automaticDeletionEnabled: false,
      status: WORKFLOW_STATUS.PUBLISHED,
      statusMessage: source.statusMessage,
      schedulerSelectionId: "",
      schedulerSelectedAt: "",
      pendingRotationListingId: "",
      pendingRotationJobId: "",
      processLease: null,
      manualLock: false,
    }, { now: NOW });
    group = updateListingControl(group, regression, {
      automaticUpdateEnabled: false,
      automaticDeletionEnabled: false,
      status: WORKFLOW_STATUS.DELETED,
      statusMessage: regression.statusMessage,
      schedulerSelectionId: "",
      schedulerSelectedAt: "",
      pendingRotationListingId: "",
      pendingRotationJobId: "",
      processLease: null,
    }, { now: NOW });
    project.listingGroup = group;
    project.selectedHouseIds = group.variants.filter((candidate) => candidate.active && candidate.templateId).map((candidate) => candidate.templateId);
    Object.assign(progress, {
      stage: REGRESSION_85_REPAIR_STAGES.REPAIR_COMPLETED,
      repairState: "repair_completed",
      replacementListingId: source.id,
      replacementExternalId: source.externalId,
      deleteJobId,
      deleteReportId,
      completedAt: NOW,
      updatedAt: NOW,
    });
    state.deleteReports.push({
      reportId: deleteReportId,
      deleteJobId,
      sourceListingId: regression.id,
      replacementListingId: source.id,
      externalObjectNumber: regression.externalId,
      messageId,
      rawHash,
      providerProcessedAt: NOW,
      processedAt: NOW,
      result: "success",
      channel: "email",
      confirmationType,
    });
    deleteLedger.jobs.push({
      deleteJobId,
      projectId: project.id,
      sourceListingId: regression.id,
      replacementListingId: source.id,
      externalObjectNumber: regression.externalId,
      replacementExternalObjectNumber: source.externalId,
      status: PRODUCTION_DELETE_STATUS.CONFIRMED,
      attempt: 1,
      reportMessageId: messageId,
      reportHash: rawHash,
      providerProcessedAt: NOW,
      confirmationType,
      confirmedAt: NOW,
    });
  }
  return { ...fixture, state, campaign, deleteLedger, uploadLedger: fixture.ledger };
}

function activationHarness(fixture, options = {}) {
  let campaign = structuredClone(fixture.campaign);
  const runtimeCommit = "a".repeat(40);
  return {
    options: {
      campaignStore: {
        async load() { return { ...campaign, valid: true }; },
        async update(mutator) {
          campaign = await mutator(campaign);
          return { ...campaign, valid: true };
        },
      },
      catalogStore: { async load() { return { stored: true, state: fixture.state }; } },
      rotationModeStore: { async load() { return { valid: true, mode: "off" }; } },
      portalModeReader: async () => ({ valid: true, mode: "off" }),
      deleteModeStore: { async load() { return { valid: true, mode: "active" }; } },
      productionPolicyStore: { async load() { return { valid: true, expectedRuntimeCommit: runtimeCommit }; } },
      deleteLedger: { async read() { return fixture.deleteLedger; } },
      uploadLedger: { async read() { return fixture.uploadLedger; } },
      loadRuntimeProvenance: async () => ({
        valid: true,
        runtimeCommit,
        runtimeRelease: "release-test",
        sourceTreeClean: true,
      }),
      expectedClassificationFingerprint: options.expectedClassificationFingerprint
        || regression85ClassificationFingerprint(fixture.campaign),
      now: () => NOW,
    },
    campaign: () => campaign,
  };
}

test("derives one immutable exact 85 allowlist with the proven 82/2/1 distribution", () => {
  const { scope, scopeHash, scopeEvidenceHash } = derivedFixture();
  assert.equal(scope.items.length, 85);
  assert.equal(new Set(scope.items.map((item) => item.regressionListingId)).size, 85);
  assert.deepEqual(scope.houseDistribution, { "SOL 204 V4": 2, "SOL 229 V3": 1, "SOL 242 V4": 82 });
  assert.equal(scopeHash, REGRESSION_85_APPROVED_SCOPE_HASH);
  assert.match(scopeEvidenceHash, /^[a-f0-9]{64}$/u);
  assert.equal(scope.items.every((item) => item.rootProcessId === 4460), true);
  assert.equal(scope.items.every((item) => item.importState === WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT), true);
});

test("84, 86 and duplicate transfer evidence fail closed", () => {
  const fixture = buildFixture();
  assert.throws(
    () => deriveRegression85Scope(fixture.state, fixture.events.slice(0, 84), fixture.ledger),
    (error) => error.code === "REGRESSION_85_SCOPE_MISMATCH",
  );
  assert.throws(
    () => deriveRegression85Scope(fixture.state, [...fixture.events, fixture.events[0]], fixture.ledger),
    (error) => error.code === "REGRESSION_85_SCOPE_MISMATCH",
  );
  assert.throws(
    () => deriveRegression85Scope(fixture.state, [
      ...fixture.events,
      { ...fixture.events[0], jobId: "rogue-extra-job", listingId: "rogue-extra-listing", externalId: "30460-999999" },
    ], fixture.ledger),
    (error) => error.code === "REGRESSION_85_SCOPE_MISMATCH",
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
  const fixture = derivedFixture();
  const { state } = fixture;
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
  const campaign = { ...campaignFor(fixture), campaignId: "campaign-preview" };
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
  const fixture = derivedFixture();
  const { scope, scopeHash, scopeEvidenceHash } = fixture;
  const directory = await mkdtemp(join(tmpdir(), "regression-85-store-"));
  const path = join(directory, "campaign.json");
  const firstStore = createRegression85CampaignStore(path);
  assert.equal((await firstStore.load()).mode, "off");
  const initialized = await firstStore.initialize(scope, scopeHash, scopeEvidenceHash, { now: NOW });
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
  await assert.rejects(
    () => restartedStore.update(() => {
      const classified = campaignFor(fixture);
      return {
        ...classified,
        progress: classified.progress.map((item, index) => index === 0
          ? { ...item, repairStrategy: REGRESSION_85_REPAIR_STRATEGIES.ROLLBACK }
          : item),
      };
    }, { now: NOW }),
    (error) => error.code === "REGRESSION_85_CAMPAIGN_CORRUPT",
  );
});

test("scope preparation is blocked outside the exact approved release runtime", async () => {
  const fixture = buildFixture();
  const directory = await mkdtemp(join(tmpdir(), "regression-85-cli-runtime-"));
  const campaignStore = createRegression85CampaignStore(join(directory, "campaign.json"));
  await assert.rejects(
    () => runRegression85RepairCli(["prepare-scope"], {
      campaignStore,
      catalogStore: { async load() { return { state: fixture.state }; } },
      uploadLedger: { async read() { return fixture.ledger; } },
      readUploadEvents: async () => fixture.events,
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
  const fixture = derivedFixture();
  const { scope, scopeHash, scopeEvidenceHash } = fixture;
  const directory = await mkdtemp(join(tmpdir(), "regression-85-delete-guard-"));
  const store = createRegression85CampaignStore(join(directory, "campaign.json"));
  await store.initialize(scope, scopeHash, scopeEvidenceHash, { now: NOW });
  await store.update(() => campaignFor(fixture), { now: NOW });
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
  const fixture = derivedFixture();
  const { state: initialState, scope, scopeHash, scopeEvidenceHash, ledger: rogueLedger } = fixture;
  for (let index = 0; index < scope.items.length; index += 1) {
    const scopeItem = scope.items[index];
    const project = initialState.projects.find((candidate) => candidate.id === scopeItem.projectId);
    const regression = project.listings.find((candidate) => candidate.id === scopeItem.regressionListingId);
    project.listings.push({
      ...structuredClone(regression),
      id: scopeItem.originalSourceListingId,
      externalId: `30460-${String(600_000 + index).padStart(6, "0")}`,
      status: WORKFLOW_STATUS.DELETED,
      externalDeletionPending: false,
      productionDeleteState: "confirmed",
      listingOrigin: "group-source",
      rotationSourceListingId: "",
    });
  }
  const directory = await mkdtemp(join(tmpdir(), "regression-85-worker-"));
  const campaignStore = createRegression85CampaignStore(join(directory, "campaign.json"));
  await campaignStore.initialize(scope, scopeHash, scopeEvidenceHash, { now: NOW });
  await campaignStore.update(() => ({ ...campaignFor(fixture), mode: "active", activatedAt: NOW }), { now: NOW });
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
      confirmationType: IMMOPROFESSIONAL_EXCHANGE_DELETE_CONFIRMATION_TYPE,
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

function buildPublishedClassificationFixture() {
  const fixture = buildFixture();
  fixture.state.importReports = [];
  for (let index = 0; index < fixture.state.projects.length; index += 1) {
    const project = fixture.state.projects[index];
    const regression = project.listings[0];
    const originalHouse = fixture.state.houses[3 + (index % 19)];
    const original = listing(
      originalHouse,
      regression.rotationSourceListingId,
      `30460-${String(700_000 + index).padStart(6, "0")}`,
      WORKFLOW_STATUS.PUBLISHED,
    );
    original.externalDeletionPending = true;
    original.productionDeleteState = "";
    original.supersededByListingId = regression.id;
    original.replacementConfirmedAt = NOW;
    regression.status = WORKFLOW_STATUS.PUBLISHED;
    regression.statusMessage = "Import bestätigt";
    regression.version = 2;
    regression.importConfirmedAt = NOW;
    regression.lastUploadedAt = NOW;
    regression.importReportId = `import-report-${index + 1}`;
    const importReport = {
      reportId: regression.importReportId,
      importResult: "success",
      sourceListingId: original.id,
      matchedListingId: regression.id,
      externalObjectNumber: regression.externalId,
      rawHash: String(index + 1).padStart(64, "a").slice(-64),
    };
    fixture.state.importReports.push(importReport);
    project.listings.push(original);
    let group = normalizeListingGroup(project.listingGroup, project.id, { now: NOW });
    group = updateListingControl(group, regression, {
      automaticUpdateEnabled: true,
      status: WORKFLOW_STATUS.PUBLISHED,
      statusMessage: regression.statusMessage,
    }, { now: NOW });
    group = updateListingControl(group, original, {
      automaticUpdateEnabled: false,
      status: WORKFLOW_STATUS.PUBLISHED,
      statusMessage: "Ersetzt · externe Löschung ausstehend",
    }, { now: NOW });
    group = {
      ...group,
      variants: group.variants.map((variant) => variant.listing?.id === regression.id
        ? { ...variant, listing: regression }
        : variant),
    };
    project.listingGroup = group;
  }
  const derived = deriveRegression85Scope(fixture.state, fixture.events, fixture.ledger);
  const evidenceSnapshot = {
    format: 1,
    observedAt: NOW,
    channel: "synthetic-read-only",
    items: derived.scope.items.map((item) => {
      const project = fixture.state.projects.find((candidate) => candidate.id === item.projectId);
      const source = project.listings.find((candidate) => candidate.id === item.originalSourceListingId);
      return {
        scopeItemId: item.scopeItemId,
        sourceExternalId: source.externalId,
        regressionExternalId: item.regressionExternalId,
        sourcePresence: "present",
        portalStatuses: {
          immowelt: "not_transferred",
          kleinanzeigen: "not_transferred",
          immoscout24: "not_transferred",
        },
      };
    }),
  };
  return { ...fixture, ...derived, evidenceSnapshot, deleteLedger: { format: 1, jobs: [] } };
}

test("classifies all exact published A→B pairs as rollback eligible and persists immutable provenance", () => {
  const fixture = buildPublishedClassificationFixture();
  const classification = classifyRegression85Scope(
    fixture.state,
    fixture.scope,
    fixture.ledger,
    fixture.deleteLedger,
    fixture.evidenceSnapshot,
    { now: NOW },
  );
  assert.deepEqual(classification.counts, {
    ROLLBACK_ELIGIBLE: 85,
    REPLACEMENT_REQUIRED: 0,
    AMBIGUOUS: 0,
  });
  assert.equal(classification.items.every((item) => item.evidenceHash.match(/^[a-f0-9]{64}$/u)), true);
  const campaign = campaignFor(fixture);
  delete campaign.classificationSummary;
  campaign.progress = campaign.progress.map((progress) => ({
    ...progress,
    classification: "",
    classificationReason: "",
    evidenceHash: "",
    classifiedAt: "",
    repairStrategy: "",
    repairState: "unclassified",
  }));
  const applied = applyRegression85Classifications(campaign, classification);
  assert.equal(applied.progress.every((item) => item.repairStrategy === REGRESSION_85_REPAIR_STRATEGIES.ROLLBACK), true);
  const changed = structuredClone(classification);
  changed.items[0].evidenceHash = "f".repeat(64);
  assert.throws(
    () => applyRegression85Classifications(applied, changed),
    (error) => error.code === "REGRESSION_85_CLASSIFICATION_IMMUTABLE",
  );
});

test("activation accepts an exact 85-item rollback campaign without synthetic Creative candidates", async () => {
  const fixture = buildPublishedClassificationFixture();
  const classifications = fixture.scope.items.map(() => REGRESSION_85_CLASSIFICATIONS.ROLLBACK_ELIGIBLE);
  const directory = await mkdtemp(join(tmpdir(), "regression-85-rollback-activation-"));
  const campaignStore = createRegression85CampaignStore(join(directory, "campaign.json"));
  await campaignStore.initialize(fixture.scope, fixture.scopeHash, fixture.scopeEvidenceHash, { now: NOW });
  await campaignStore.update(() => campaignFor(fixture, classifications), { now: NOW });
  const persistedCampaign = await campaignStore.load();
  const runtimeCommit = "a".repeat(40);

  const result = await runRegression85RepairCli(["activate"], {
    campaignStore,
    catalogStore: { async load() { return { stored: true, state: fixture.state }; } },
    rotationModeStore: { async load() { return { valid: true, mode: "off" }; } },
    portalModeReader: async () => ({ valid: true, mode: "off" }),
    deleteModeStore: { async load() { return { valid: true, mode: "active" }; } },
    productionPolicyStore: {
      async load() { return { valid: true, expectedRuntimeCommit: runtimeCommit }; },
    },
    deleteLedger: { async read() { return fixture.deleteLedger; } },
    uploadLedger: { async read() { return fixture.ledger; } },
    loadRuntimeProvenance: async () => ({
      valid: true,
      runtimeCommit,
      runtimeRelease: "release-test",
      sourceTreeClean: true,
    }),
    expectedClassificationFingerprint: regression85ClassificationFingerprint(persistedCampaign),
    now: () => NOW,
  });

  assert.equal(result.mode, "active");
  assert.equal(result.previewSummary.candidateCount, 0);
  assert.equal(result.previewSummary.distinctHouseCount, 0);
  assert.equal((await campaignStore.load()).mode, "active");
});

test("resume gate accepts strict completed rollback evidence at 1/85, 2/85 and 84/85", () => {
  for (const completedCount of [1, 2, 84]) {
    const fixture = completeRollbackEntries(buildPublishedClassificationFixture(), completedCount);
    const result = inspectRegression85OperationalGate(fixture.state, fixture.scope, {
      classifications: fixture.campaign.progress,
      deleteLedger: fixture.deleteLedger,
      uploadLedger: fixture.uploadLedger,
    });
    assert.equal(result.allowed, true, JSON.stringify(result.invalidCompletedRepairEntries));
    assert.equal(result.activeRepairEntryCount, 85 - completedCount);
    assert.equal(result.completedRepairEntryCount, completedCount);
    assert.equal(result.validScopeEntryCount, 85);
  }
});

test("resume activation keeps 1/85, selects only a pending item and is restart-idempotent", async () => {
  const fixture = completeRollbackEntries(buildPublishedClassificationFixture(), 1);
  const completed = fixture.campaign.progress[0];
  const expectedNext = fixture.campaign.progress[1].scopeItemId;
  const completedRegression = fixture.state.projects
    .flatMap((project) => project.listings)
    .find((listingValue) => listingValue.id === fixture.scope.items[0].regressionListingId);
  const before = structuredClone(completedRegression);
  const harness = activationHarness(fixture);
  const first = await runRegression85RepairCli(["activate"], harness.options);
  const second = await runRegression85RepairCli(["activate"], harness.options);
  assert.equal(first.mode, "active");
  assert.equal(first.completed, 1);
  assert.equal(first.pending, 84);
  assert.equal(first.nextScopeItemId, expectedNext);
  assert.equal(second.nextScopeItemId, expectedNext);
  assert.equal(harness.campaign().progress[0].scopeItemId, completed.scopeItemId);
  assert.equal(harness.campaign().progress[0].stage, REGRESSION_85_REPAIR_STAGES.REPAIR_COMPLETED);
  assert.deepEqual(completedRegression, before);
  assert.equal(fixture.deleteLedger.jobs.length, 1);
});

test("resume activation recognizes 85/85 as terminal and starts no new lifecycle", async () => {
  const fixture = completeRollbackEntries(buildPublishedClassificationFixture(), 85);
  const harness = activationHarness(fixture);
  const result = await runRegression85RepairCli(["activate"], harness.options);
  assert.equal(result.mode, "completed");
  assert.equal(result.completed, 85);
  assert.equal(result.pending, 0);
  assert.equal(result.alreadyCompleted, true);
  assert.equal(result.nextScopeItemId, null);
  assert.equal(harness.campaign().activeScopeItemId, "");
  assert.equal(fixture.deleteLedger.jobs.length, 85);
});

test("resume gate blocks every incomplete or contradictory completed rollback", () => {
  const missingMarker = completeRollbackEntries(buildPublishedClassificationFixture(), 0);
  const firstScope = missingMarker.scope.items[0];
  const missingMarkerProject = missingMarker.state.projects.find((item) => item.id === firstScope.projectId);
  missingMarkerProject.listings.find((item) => item.id === firstScope.originalSourceListingId).externalDeletionPending = false;
  let result = inspectRegression85OperationalGate(missingMarker.state, missingMarker.scope, {
    classifications: missingMarker.campaign.progress,
    deleteLedger: missingMarker.deleteLedger,
    uploadLedger: missingMarker.uploadLedger,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.validScopeEntryCount, 84);

  const missingReport = completeRollbackEntries(buildPublishedClassificationFixture(), 1);
  missingReport.state.deleteReports = [];
  result = inspectRegression85OperationalGate(missingReport.state, missingReport.scope, {
    classifications: missingReport.campaign.progress,
    deleteLedger: missingReport.deleteLedger,
    uploadLedger: missingReport.uploadLedger,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.invalidCompletedRepairEntryCount, 1);

  const wrongRegression = completeRollbackEntries(buildPublishedClassificationFixture(), 1);
  wrongRegression.state.deleteReports[0].sourceListingId = wrongRegression.scope.items[1].regressionListingId;
  result = inspectRegression85OperationalGate(wrongRegression.state, wrongRegression.scope, {
    classifications: wrongRegression.campaign.progress,
    deleteLedger: wrongRegression.deleteLedger,
    uploadLedger: wrongRegression.uploadLedger,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.invalidCompletedRepairEntryCount, 1);

  const foreignMarker = completeRollbackEntries(buildPublishedClassificationFixture(), 1);
  foreignMarker.state.projects[0].listings.push({
    ...foreignMarker.state.projects[0].listings.at(-1),
    id: "foreign-resume-marker",
    externalId: "30460-999996",
    externalDeletionPending: true,
  });
  result = inspectRegression85OperationalGate(foreignMarker.state, foreignMarker.scope, {
    classifications: foreignMarker.campaign.progress,
    deleteLedger: foreignMarker.deleteLedger,
    uploadLedger: foreignMarker.uploadLedger,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.foreignMarkerCount, 1);
});

test("resume gate blocks inconsistent scheduler ownership, active pair jobs and duplicate DELETE evidence", () => {
  const ownership = completeRollbackEntries(buildPublishedClassificationFixture(), 1);
  const scopeItem = ownership.scope.items[0];
  const project = ownership.state.projects.find((item) => item.id === scopeItem.projectId);
  const source = project.listings.find((item) => item.id === scopeItem.originalSourceListingId);
  project.listingGroup = updateListingControl(project.listingGroup, source, {
    automaticUpdateEnabled: false,
  }, { now: NOW });
  let result = inspectRegression85OperationalGate(ownership.state, ownership.scope, {
    classifications: ownership.campaign.progress,
    deleteLedger: ownership.deleteLedger,
    uploadLedger: ownership.uploadLedger,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.invalidCompletedRepairEntries[0].reasons.includes("completed_source_scheduler_ownership_invalid"), true);

  const activeUpload = completeRollbackEntries(buildPublishedClassificationFixture(), 1);
  activeUpload.uploadLedger.jobs.push({
    jobId: "active-resume-upload",
    projectId: activeUpload.scope.items[0].projectId,
    listingId: activeUpload.scope.items[0].regressionListingId,
    status: WORKFLOW_STATUS.PROCESSING,
  });
  result = inspectRegression85OperationalGate(activeUpload.state, activeUpload.scope, {
    classifications: activeUpload.campaign.progress,
    deleteLedger: activeUpload.deleteLedger,
    uploadLedger: activeUpload.uploadLedger,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.invalidCompletedRepairEntries[0].reasons.includes("completed_pair_upload_job_open"), true);

  const duplicateDelete = completeRollbackEntries(buildPublishedClassificationFixture(), 1);
  duplicateDelete.deleteLedger.jobs.push({
    ...duplicateDelete.deleteLedger.jobs[0],
    deleteJobId: `production-delete:${"f".repeat(64)}`,
  });
  result = inspectRegression85OperationalGate(duplicateDelete.state, duplicateDelete.scope, {
    classifications: duplicateDelete.campaign.progress,
    deleteLedger: duplicateDelete.deleteLedger,
    uploadLedger: duplicateDelete.uploadLedger,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.invalidCompletedRepairEntries[0].reasons.includes("completed_delete_job_evidence_invalid"), true);
});

test("resume activation blocks divergent scope, evidence and classification fingerprints", async () => {
  const fixture = completeRollbackEntries(buildPublishedClassificationFixture(), 1);
  const approvedFingerprint = regression85ClassificationFingerprint(fixture.campaign);
  for (const mutation of [
    (campaign) => { campaign.scopeHash = "f".repeat(64); },
    (campaign) => { campaign.scopeEvidenceHash = "f".repeat(64); },
  ]) {
    const changed = structuredClone(fixture);
    mutation(changed.campaign);
    const harness = activationHarness(changed, { expectedClassificationFingerprint: approvedFingerprint });
    await assert.rejects(() => runRegression85RepairCli(["activate"], harness.options));
  }
  const harness = activationHarness(fixture, { expectedClassificationFingerprint: "f".repeat(64) });
  await assert.rejects(
    () => runRegression85RepairCli(["activate"], harness.options),
    /Classification-Fingerprint/u,
  );
});

test("operational gate accepts exactly 85 in-scope markers and blocks every foreign or incomplete marker set", () => {
  const fixture = buildPublishedClassificationFixture();
  assert.equal(inspectRegression85OperationalGate(fixture.state, fixture.scope, { deleteLedger: fixture.deleteLedger }).allowed, true);
  const foreign = structuredClone(fixture.state);
  foreign.projects[0].listings.push({ ...foreign.projects[0].listings.at(-1), id: "foreign-marker", externalId: "30460-999998", externalDeletionPending: true });
  let result = inspectRegression85OperationalGate(foreign, fixture.scope, { deleteLedger: fixture.deleteLedger });
  assert.equal(result.allowed, false);
  assert.equal(result.foreignMarkerCount, 1);
  const incomplete = structuredClone(fixture.state);
  const firstSourceId = fixture.scope.items[0].originalSourceListingId;
  incomplete.projects[0].listings.find((item) => item.id === firstSourceId).externalDeletionPending = false;
  incomplete.projects[0].listings.push({ ...incomplete.projects[0].listings.at(-1), id: "foreign-marker", externalId: "30460-999997", externalDeletionPending: true });
  result = inspectRegression85OperationalGate(incomplete, fixture.scope, { deleteLedger: fixture.deleteLedger });
  assert.equal(result.allowed, false);
  assert.equal(result.scopeMarkerCount, 84);
  assert.equal(result.foreignMarkerCount, 1);
});

test("a deleted A with exact positive delete evidence requires replacement while absence without that evidence stays ambiguous", () => {
  const fixture = buildPublishedClassificationFixture();
  const scopeItem = fixture.scope.items[0];
  const project = fixture.state.projects.find((candidate) => candidate.id === scopeItem.projectId);
  const source = project.listings.find((candidate) => candidate.id === scopeItem.originalSourceListingId);
  const reportHash = "d".repeat(64);
  const deleteJobId = "production-delete:confirmed-source-a";
  source.status = WORKFLOW_STATUS.DELETED;
  source.externalDeletionPending = false;
  source.productionDeleteState = "confirmed";
  source.deleteReportHash = reportHash;
  source.deleteJobId = deleteJobId;
  fixture.state.deleteReports = [{
    reportId: "delete-report-source-a",
    sourceListingId: source.id,
    replacementListingId: scopeItem.regressionListingId,
    externalObjectNumber: source.externalId,
    rawHash: reportHash,
    result: "success",
  }];
  fixture.deleteLedger.jobs.push({
    deleteJobId,
    sourceListingId: source.id,
    replacementListingId: scopeItem.regressionListingId,
    externalObjectNumber: source.externalId,
    reportHash,
    status: PRODUCTION_DELETE_STATUS.CONFIRMED,
  });
  fixture.evidenceSnapshot.items[0].sourcePresence = "absent";
  let classification = classifyRegression85Scope(fixture.state, fixture.scope, fixture.ledger, fixture.deleteLedger, fixture.evidenceSnapshot, { now: NOW });
  assert.equal(classification.items[0].classification, REGRESSION_85_CLASSIFICATIONS.REPLACEMENT_REQUIRED);
  assert.deepEqual(classification.counts, { ROLLBACK_ELIGIBLE: 84, REPLACEMENT_REQUIRED: 1, AMBIGUOUS: 0 });

  source.status = WORKFLOW_STATUS.PUBLISHED;
  source.productionDeleteState = "authorized";
  delete fixture.state.deleteReports;
  fixture.deleteLedger.jobs = [];
  classification = classifyRegression85Scope(fixture.state, fixture.scope, fixture.ledger, fixture.deleteLedger, fixture.evidenceSnapshot, { now: NOW });
  assert.equal(classification.items[0].classification, REGRESSION_85_CLASSIFICATIONS.AMBIGUOUS);
  assert.equal(classification.items[0].classificationReason, "original_source_absent_without_exact_positive_delete_confirmation");
});

test("rollback deletes only B, keeps A published, clears A marker only after confirmation and never uploads C", async () => {
  const fixture = buildPublishedClassificationFixture();
  const classification = classifyRegression85Scope(fixture.state, fixture.scope, fixture.ledger, fixture.deleteLedger, fixture.evidenceSnapshot, { now: NOW });
  const directory = await mkdtemp(join(tmpdir(), "regression-85-rollback-worker-"));
  const campaignStore = createRegression85CampaignStore(join(directory, "campaign.json"));
  await campaignStore.initialize(fixture.scope, fixture.scopeHash, fixture.scopeEvidenceHash, { now: NOW });
  await campaignStore.update((campaign) => ({
    ...applyRegression85Classifications(campaign, classification),
    mode: "active",
    activatedAt: NOW,
  }), { now: NOW });
  let catalogState = structuredClone(fixture.state);
  const catalogStore = {
    async load() { return { stored: true, savedAt: NOW, state: catalogState }; },
    async update(mutator) {
      const mutation = await mutator(catalogState);
      catalogState = mutation?.state || mutation;
      return { stored: true, state: catalogState, result: mutation?.result, changed: true };
    },
  };
  const deleteLedger = createProductionDeleteLedger(join(directory, "delete-jobs.json"));
  const runtimeOwnershipGuard = { async assert() { return { valid: true, portOwnerPids: [process.pid] }; } };
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
      async findCandidates() { return deleteReportAvailable ? [{ mailboxName: "reports", transportId: "rollback-1" }] : []; },
      async readRawMessage() { return { rawSource: "synthetic rollback delete report" }; },
    },
    parseReport: (_raw, input) => ({
      externalObjectNumber: input.expectedTarget,
      deleteResult: "success",
      messageId: `<rollback-delete-${input.expectedTarget}@example.invalid>`,
      rawHash: input.expectedTarget.replace(/\D/gu, "").padEnd(64, "c").slice(0, 64),
      providerProcessedAt: NOW,
      confirmationType: IMMOPROFESSIONAL_EXCHANGE_DELETE_CONFIRMATION_TYPE,
    }),
    now: () => NOW,
  });
  let uploadCount = 0;
  const serviceOptions = {
    campaignStore,
    catalogStore,
    lease: { async acquire() { return { async release() {} }; } },
    rotationModeStore: { async load() { return { valid: true, mode: "off" }; } },
    portalModeStore: { async load() { return { valid: true, mode: "off" }; } },
    productionDeleteModeStore: { async load() { return { valid: true, mode: "active" }; } },
    productionPolicyStore: { async load() { return { valid: true, maxRunItems: 3 }; } },
    runtimeOwnershipGuard,
    uploadJobLedger: { async read() { return fixture.ledger; } },
    productionDeleteLedger: deleteLedger,
    plotDailyUploadGuard: { async inspect() { throw new Error("Rollback must not consume daily upload guard"); } },
    upload: async () => { uploadCount += 1; throw new Error("Rollback must not upload"); },
    importReportService: { async runOnce() { throw new Error("Rollback must not wait for import report"); } },
    productionDeleteService,
    now: () => NOW,
  };
  let worker = createRegression85RepairService(serviceOptions);
  let result = await worker.runOnce({ runId: "rollback-authorize" });
  assert.equal(result.stage, REGRESSION_85_REPAIR_STAGES.ROLLBACK_DELETE_AUTHORIZED);
  const scopeItem = fixture.scope.items[0];
  let project = catalogState.projects.find((candidate) => candidate.id === scopeItem.projectId);
  let original = project.listings.find((candidate) => candidate.id === scopeItem.originalSourceListingId);
  let regression = project.listings.find((candidate) => candidate.id === scopeItem.regressionListingId);
  assert.equal(original.status, WORKFLOW_STATUS.PUBLISHED);
  assert.equal(original.externalDeletionPending, true);
  assert.equal(regression.productionDeleteState, "authorized");

  worker = createRegression85RepairService(serviceOptions);
  result = await worker.runOnce({ runId: "rollback-delete-transfer" });
  assert.equal(result.stage, REGRESSION_85_REPAIR_STAGES.ROLLBACK_DELETE_PENDING);
  worker = createRegression85RepairService(serviceOptions);
  result = await worker.runOnce({ runId: "rollback-delete-confirm" });
  assert.equal(result.stage, REGRESSION_85_REPAIR_STAGES.ROLLBACK_ROGUE_DELETED);
  worker = createRegression85RepairService(serviceOptions);
  result = await worker.runOnce({ runId: "rollback-finalize" });
  assert.equal(result.stage, REGRESSION_85_REPAIR_STAGES.REPAIR_COMPLETED);
  project = catalogState.projects.find((candidate) => candidate.id === scopeItem.projectId);
  original = project.listings.find((candidate) => candidate.id === scopeItem.originalSourceListingId);
  regression = project.listings.find((candidate) => candidate.id === scopeItem.regressionListingId);
  assert.equal(original.status, WORKFLOW_STATUS.PUBLISHED);
  assert.equal(original.externalDeletionPending, false);
  assert.equal(original.productionDeleteState, "");
  assert.equal(listingControl(normalizeListingGroup(project.listingGroup, project.id), original).automaticUpdateEnabled, true);
  assert.equal(project.listingGroup.variants.some((variant) => variant.listing?.id === original.id && variant.active), true);
  assert.equal(project.selectedHouseIds.includes(original.templateId), true);
  assert.equal(regression.status, WORKFLOW_STATUS.DELETED);
  assert.equal(uploadCount, 0);
  assert.equal((await deleteLedger.read()).jobs.length, 1);
});
