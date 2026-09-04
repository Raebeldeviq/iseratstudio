import assert from "node:assert/strict";
import test from "node:test";

import {
  assignListingGroupVariant,
  createListingGroup,
  listingControl,
  updateListingControl,
} from "../listing-groups.mjs";
import {
  NINE_DAY_ROTATION_START_RECONCILIATION_CONFIRMATION,
  NINE_DAY_ROTATION_START_RECONCILIATION_CONTRACT,
  previewNineDayRotationStartReconciliation,
  reconcileNineDayRotationStartInState,
} from "../listing-rotation-start-reconciliation.mjs";
import { runNineDayRotationStartReconciliationCli } from "../listing-rotation-start-reconciliation-cli.mjs";
import { PRODUCTION_DELETE_STATUS } from "../listing-rotation-production-delete.mjs";
import {
  hashRegression85Scope,
  REGRESSION_85_APPROVED_SCOPE_HASH,
} from "../regression-85-repair-scope.mjs";
import {
  regression85ClassificationFingerprint,
  REGRESSION_85_NON_EXPORTED_CONFIRMATION_TYPE,
} from "../regression-85-non-exported-delete-confirmation.mjs";
import { WORKFLOW_STATUS } from "../workflow-status.mjs";

const NOW = "2026-09-04T09:00:00.000Z";
const GUARD_ERROR = "Ein erhöhtes Uploadlimit ohne gültige One-Shot-Provenienz ist nicht zulässig.";

function house() {
  return {
    id: "house-sol-242",
    name: "SOL 242 V4",
    approved: true,
    houseType: "Einfamilienhaus",
    livingArea: 242,
    rooms: 6,
    bedrooms: 4,
    bathrooms: 2,
    floors: 2,
    housePrice: 500_000,
    constructionYear: 2027,
    energyDemand: 18,
    energyClass: "A++",
    heatingType: "Wärmepumpe",
    energySource: "Umweltwärme",
    architecture: "Modern",
    equipmentHighlights: "Komplett",
    useStandardPackage: true,
    images: Array.from({ length: 4 }, (_, index) => ({
      id: `image-${index}`,
      name: `image-${index}.jpg`,
      caption: `Bild ${index}`,
      mimeType: "image/jpeg",
      dataUrl: "data:image/jpeg;base64,AA==",
      role: index === 0 ? "cover" : "living",
      isFloorplan: false,
    })),
  };
}

function listing(id, externalId, status = WORKFLOW_STATUS.PUBLISHED) {
  return {
    id,
    externalId,
    templateId: "house-sol-242",
    templateName: "SOL 242 V4",
    price: 650_000,
    version: 1,
    createdAt: "2026-08-01T08:00:00.000Z",
    status,
    statusMessage: status === WORKFLOW_STATUS.PUBLISHED ? "Veröffentlicht" : "",
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

function fixture() {
  const contractBase = NINE_DAY_ROTATION_START_RECONCILIATION_CONTRACT;
  const sourceHouse = house();
  const sourceInput = listing(contractBase.sourceListingId, contractBase.sourceExternalId);
  let group = createListingGroup(contractBase.projectId, { now: NOW });
  group = assignListingGroupVariant(group, group.variants[0].id, sourceHouse, sourceInput, { now: NOW });
  const source = group.variants[0].listing;
  const historicalCopy = {
    ...listing(contractBase.historicalCopyListingId, contractBase.historicalCopyExternalId, WORKFLOW_STATUS.PREPARED),
    listingOrigin: "rotation-copy",
    rotationSourceListingId: source.id,
    statusMessage: "Upload fehlgeschlagen",
    uploadError: GUARD_ERROR,
    externalDeletionPending: false,
    productionDeleteState: "confirmed",
    deleteJobId: "production-delete:test-reconciliation",
    deleteReportHash: "d".repeat(64),
    deleteReportMessageId: "<test-reconciliation@example.invalid>",
    deleteConfirmationType: REGRESSION_85_NON_EXPORTED_CONFIRMATION_TYPE,
    deleteConfirmedAt: "2026-09-02T10:00:00.000Z",
    transferredAt: "2026-08-25T10:00:00.000Z",
    importConfirmedAt: "2026-08-25T10:05:00.000Z",
  };
  group = updateListingControl(group, source, {
    automaticUpdateEnabled: true,
    automaticDeletionEnabled: false,
    status: WORKFLOW_STATUS.PUBLISHED,
    statusMessage: source.statusMessage,
    pendingRotationListingId: historicalCopy.id,
    pendingRotationJobId: "",
    processLease: null,
    schedulerSelectionId: "",
  }, { now: NOW });
  group = updateListingControl(group, historicalCopy, {
    automaticUpdateEnabled: false,
    automaticDeletionEnabled: false,
    status: WORKFLOW_STATUS.FAILED,
    statusMessage: "Upload fehlgeschlagen",
    lastError: GUARD_ERROR,
    processLease: null,
    schedulerSelectionId: "",
  }, { now: NOW });
  const state = {
    version: 1,
    houses: [sourceHouse],
    projects: [{
      id: contractBase.projectId,
      isActive: true,
      listings: [source, historicalCopy],
      listingGroup: group,
    }],
    deleteReports: [{
      reportId: "delete-report-test-reconciliation",
      deleteJobId: historicalCopy.deleteJobId,
      sourceListingId: historicalCopy.id,
      replacementListingId: source.id,
      externalObjectNumber: historicalCopy.externalId,
      messageId: historicalCopy.deleteReportMessageId,
      rawHash: historicalCopy.deleteReportHash,
      providerProcessedAt: historicalCopy.deleteConfirmedAt,
      processedAt: historicalCopy.deleteConfirmedAt,
      result: "success",
      channel: "email",
      confirmationType: REGRESSION_85_NON_EXPORTED_CONFIRMATION_TYPE,
    }],
  };

  const scopeItems = Array.from({ length: 85 }, (_, index) => ({
    scopeItemId: `regression-85:item-${index}`,
    projectId: index === 0 ? contractBase.projectId : `project-${index}`,
    plotId: `plot-${index}`,
    originalSourceListingId: index === 0 ? source.id : `source-${index}`,
    regressionListingId: index === 0 ? historicalCopy.id : `copy-${index}`,
    regressionExternalId: index === 0 ? historicalCopy.externalId : `30460-${String(700_000 + index).padStart(6, "0")}`,
    rotationId: `rotation-${index}`,
    schedulerRunId: `run-${index}`,
    uploadJobId: `upload-${index}`,
    uploadTime: NOW,
    catalogTransferTime: NOW,
    createdAt: NOW,
    rootProcessId: 4460,
    runtimeCommit: "",
    runtimeRelease: "",
    runtimeProvenanceStatus: "missing_rogue_runtime_provenance",
    houseId: `house-${index}`,
    houseName: index < 82 ? "SOL 242 V4" : index < 84 ? "SOL 204 V4" : "SOL 229 V3",
    distributionRemovedHouseId: `removed-${index}`,
    heroType: "house",
    heroImageId: `hero-${index}`,
    importState: "published",
    importReportId: `import-${index}`,
    importConfirmedAt: NOW,
  }));
  const scope = {
    format: 2,
    contract: "regression-85-exact-allowlist-v2",
    expectedCount: 85,
    rootProcessId: 4460,
    declaredWindow: { start: NOW, end: NOW, timeZone: "Europe/Berlin" },
    observedIsoEvidence: {
      createdFirst: NOW,
      createdLast: NOW,
      transferFirst: NOW,
      transferLast: NOW,
      note: "synthetic test fixture",
    },
    houseDistribution: { "SOL 242 V4": 82, "SOL 204 V4": 2, "SOL 229 V3": 1 },
    items: scopeItems,
  };
  const progress = scopeItems.map((item, index) => ({
    scopeItemId: item.scopeItemId,
    stage: "repair_completed",
    classification: "ROLLBACK_ELIGIBLE",
    classificationReason: "original_source_published_present_without_delete_transfer",
    evidenceHash: String(index + 1).padStart(64, "a").slice(-64),
    classifiedAt: NOW,
    repairStrategy: "delete_rogue_keep_original",
    repairState: "repair_completed",
    updatedAt: NOW,
    completedAt: NOW,
    deleteJobId: index === 0 ? historicalCopy.deleteJobId : `delete-job-${index}`,
    deleteReportId: index === 0 ? state.deleteReports[0].reportId : `delete-report-${index}`,
  }));
  const campaign = {
    format: 2,
    campaignId: "regression-85-reconciliation-test",
    scopeHash: REGRESSION_85_APPROVED_SCOPE_HASH,
    scopeEvidenceHash: hashRegression85Scope(scope),
    scope,
    mode: "completed",
    activeScopeItemId: "",
    createdAt: NOW,
    updatedAt: NOW,
    activatedAt: NOW,
    pausedAt: "",
    completedAt: NOW,
    lastErrorCode: "",
    lastError: "",
    checkpointHistory: [],
    classificationSummary: {
      classifiedAt: NOW,
      snapshotObservedAt: NOW,
      counts: { ROLLBACK_ELIGIBLE: 85, REPLACEMENT_REQUIRED: 0, AMBIGUOUS: 0 },
      total: 85,
    },
    progress,
  };
  const contract = {
    ...contractBase,
    scopeEvidenceHash: campaign.scopeEvidenceHash,
    classificationFingerprint: regression85ClassificationFingerprint(campaign),
  };
  const deleteLedger = {
    format: 1,
    jobs: [{
      deleteJobId: historicalCopy.deleteJobId,
      projectId: contract.projectId,
      sourceListingId: historicalCopy.id,
      replacementListingId: source.id,
      externalObjectNumber: historicalCopy.externalId,
      status: PRODUCTION_DELETE_STATUS.CONFIRMED,
      reportHash: historicalCopy.deleteReportHash,
      confirmationType: REGRESSION_85_NON_EXPORTED_CONFIRMATION_TYPE,
      confirmedAt: historicalCopy.deleteConfirmedAt,
    }],
  };
  return { state, campaign, contract, deleteLedger, source, historicalCopy };
}

function memoryStore(initialState) {
  let state = structuredClone(initialState);
  return {
    async load() {
      return { stored: true, state: structuredClone(state), savedAt: NOW };
    },
    async update(mutator) {
      const mutation = await mutator(structuredClone(state), { savedAt: NOW });
      state = structuredClone(mutation.state);
      return { stored: true, state: structuredClone(state), result: mutation.result };
    },
  };
}

test("confirmed delete provenance deterministically restores only B to deleted and keeps A published", () => {
  const value = fixture();
  const preview = previewNineDayRotationStartReconciliation(
    value.state,
    value.campaign,
    value.deleteLedger,
    { contract: value.contract },
  );
  assert.equal(preview.status, "NINE_DAY_ROTATION_START_RECONCILIATION_REQUIRED");
  const mutation = reconcileNineDayRotationStartInState(
    value.state,
    value.campaign,
    value.deleteLedger,
    { contract: value.contract, now: NOW },
  );
  const project = mutation.state.projects[0];
  const source = project.listings.find((item) => item.id === value.source.id);
  const historicalCopy = project.listings.find((item) => item.id === value.historicalCopy.id);
  const sourceControl = listingControl(project.listingGroup, source);
  const copyControl = listingControl(project.listingGroup, historicalCopy);
  assert.equal(source.status, WORKFLOW_STATUS.PUBLISHED);
  assert.equal(sourceControl.status, WORKFLOW_STATUS.PUBLISHED);
  assert.equal(sourceControl.automaticUpdateEnabled, true);
  assert.equal(sourceControl.pendingRotationListingId, "");
  assert.equal(historicalCopy.status, WORKFLOW_STATUS.DELETED);
  assert.equal(historicalCopy.productionDeleteState, "confirmed");
  assert.equal(historicalCopy.deleteJobId, value.historicalCopy.deleteJobId);
  assert.equal(historicalCopy.deleteReportHash, value.historicalCopy.deleteReportHash);
  assert.equal(copyControl.status, WORKFLOW_STATUS.DELETED);
  assert.equal(mutation.result.externalTransfers, 0);
  const repeated = reconcileNineDayRotationStartInState(
    mutation.state,
    value.campaign,
    value.deleteLedger,
    { contract: value.contract, now: NOW },
  );
  assert.equal(repeated.result.changed, false);
});

test("reconciliation fails closed when the positive object-bound delete evidence is missing", () => {
  const value = fixture();
  value.deleteLedger.jobs = [];
  assert.throws(() => previewNineDayRotationStartReconciliation(
    value.state,
    value.campaign,
    value.deleteLedger,
    { contract: value.contract },
  ), (error) => error.code === "NINE_DAY_START_DELETE_EVIDENCE_INVALID");
});

test("the CLI mutation is mode-gated, explicit, local-only and idempotent", async () => {
  const value = fixture();
  const store = memoryStore(value.state);
  const shared = {
    store,
    campaign: value.campaign,
    contract: value.contract,
    deleteLedger: value.deleteLedger,
    uploadLedger: { format: 1, jobs: [] },
    rotationMode: { valid: true, mode: "off", canaryListingIds: [] },
    deleteMode: { valid: true, mode: "off" },
    portalMode: { mode: "off" },
    now: NOW,
  };
  await assert.rejects(
    runNineDayRotationStartReconciliationCli(["apply"], shared),
    /Mutation verlangt/iu,
  );
  const applied = await runNineDayRotationStartReconciliationCli([
    "apply",
    "--confirm",
    NINE_DAY_ROTATION_START_RECONCILIATION_CONFIRMATION,
  ], shared);
  assert.equal(applied.changed, true);
  assert.equal(applied.externalTransfers, 0);
  const preview = await runNineDayRotationStartReconciliationCli(["preview"], shared);
  assert.equal(preview.status, "NINE_DAY_ROTATION_START_RECONCILED");
  assert.equal(preview.historicalCopyStatus, WORKFLOW_STATUS.DELETED);
});
