import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { assignListingGroupVariant, createListingGroup, listingControl, updateListingControl } from "../listing-groups.mjs";
import {
  REGRESSION_85_APPROVED_SCOPE_HASH,
  hashRegression85Scope,
} from "../regression-85-repair-scope.mjs";
import { regression85ClassificationFingerprint } from "../regression-85-non-exported-delete-confirmation.mjs";
import {
  previewRegression85SchedulerOwnerReconciliation,
  reconcileRegression85SchedulerOwnersInState,
} from "../regression-85-scheduler-owner-reconciliation.mjs";
import { runRegression85SchedulerOwnerReconciliationCli } from "../regression-85-scheduler-owner-reconciliation-cli.mjs";

const NOW = "2026-09-03T10:00:00.000Z";

function house(id, name) {
  return {
    id,
    name,
    approved: true,
    houseType: "Einfamilienhaus",
    livingArea: 130,
    rooms: 5,
    bedrooms: 3,
    bathrooms: 2,
    floors: 2,
    housePrice: 400000,
    constructionYear: 2027,
    energyDemand: 18,
    energyClass: "A++",
    heatingType: "Wärmepumpe",
    energySource: "Strom",
    architecture: "Offener Grundriss",
    equipmentHighlights: "Ausstattung",
    useStandardPackage: true,
    images: Array.from({ length: 4 }, (_, index) => ({
      id: `${id}-image-${index}`,
      name: `${id}-${index}.jpg`,
      caption: "Bild",
      mimeType: "image/jpeg",
      isFloorplan: index > 1,
      role: index > 1 ? "floorplan_ground" : "cover",
    })),
  };
}

function listing(id, externalId, selectedHouse) {
  return {
    id,
    externalId,
    templateId: selectedHouse.id,
    templateName: selectedHouse.name,
    status: "published",
    price: 500000,
    version: 1,
    createdAt: "2026-08-01T08:00:00.000Z",
    texts: { title: "Titel", description: "Beschreibung", equipment: "Ausstattung", location: "Lage", other: "Sonstiges" },
  };
}

function fixture() {
  const originalHouse = house("house-original", "SOL 242 V4");
  const alternativeHouse = house("house-alternative", "SUN 157 V2");
  const original = listing("original-a", "30460-000001", originalHouse);
  const alternative = listing("active-owner", "30460-000002", alternativeHouse);
  const regression = {
    ...listing("rogue-0", "30460-900000", originalHouse),
    status: "deleted",
    rotationSourceListingId: original.id,
  };
  let group = createListingGroup("project-1", { now: NOW });
  group = assignListingGroupVariant(group, group.variants[0].id, originalHouse, original, { now: NOW });
  group = assignListingGroupVariant(group, group.variants[1].id, alternativeHouse, alternative, { now: NOW });
  group = updateListingControl(group, original, {
    status: "published",
    automaticUpdateEnabled: true,
    schedulerDate: "2026-08-01T08:00:00.000Z",
  }, { now: NOW });
  group = updateListingControl(group, alternative, {
    status: "published",
    automaticUpdateEnabled: true,
    schedulerDate: "2026-08-01T08:00:00.000Z",
  }, { now: NOW });
  group.variants[0].active = false;
  group.variants[0].listing = { ...regression, listingGroupVariantId: group.variants[0].id };
  original.listingGroupVariantId = group.variants[0].id;
  alternative.listingGroupVariantId = group.variants[1].id;
  const scopeItems = Array.from({ length: 85 }, (_, index) => ({
    scopeItemId: `regression-85:rogue-${index}`,
    projectId: index === 0 ? "project-1" : `absent-project-${index}`,
    plotId: `plot-${index}`,
    originalSourceListingId: index === 0 ? original.id : `absent-original-${index}`,
    regressionListingId: `rogue-${index}`,
    regressionExternalId: index === 0 ? regression.externalId : `30460-${String(index).padStart(6, "0")}`,
    houseId: `scope-house-${index}`,
    houseName: index < 82 ? "SOL 242 V4" : index < 84 ? "SOL 204 V4" : "SOL 229 V3",
  }));
  const scope = {
    format: 2,
    contract: "regression-85-exact-allowlist-v2",
    expectedCount: 85,
    rootProcessId: 4460,
    houseDistribution: { "SOL 242 V4": 82, "SOL 204 V4": 2, "SOL 229 V3": 1 },
    items: scopeItems,
  };
  const campaign = {
    format: 2,
    campaignId: "regression-85-test",
    scopeHash: REGRESSION_85_APPROVED_SCOPE_HASH,
    scopeEvidenceHash: hashRegression85Scope(scope),
    scope,
    mode: "completed",
    activeScopeItemId: "",
    progress: scopeItems.map((item, index) => ({
      scopeItemId: item.scopeItemId,
      stage: index === 84 ? "identified" : "repair_completed",
      classification: "ROLLBACK_ELIGIBLE",
      classificationReason: "test-evidence",
      evidenceHash: String(index + 1).padStart(64, "0"),
      classifiedAt: NOW,
      repairStrategy: "delete_rogue_keep_original",
      repairState: index === 84 ? "manual_reconciliation_exception_present" : "repair_completed",
    })),
    classificationSummary: { total: 85, counts: { ROLLBACK_ELIGIBLE: 85, REPLACEMENT_REQUIRED: 0, AMBIGUOUS: 0 } },
    manualReconciliationClosure: {
      finalStatus: "REGRESSION_85_CLOSED_MANUAL_RECONCILIATION",
      originalAPresent: 85,
      rogueBAbsent: 84,
      rogueBPresent: 1,
      historicalHashesPreserved: true,
      exception: { scopeItemId: scopeItems[84].scopeItemId },
    },
  };
  const contract = {
    scopeHash: campaign.scopeHash,
    scopeEvidenceHash: campaign.scopeEvidenceHash,
    classificationFingerprint: regression85ClassificationFingerprint(campaign),
    finalStatus: campaign.manualReconciliationClosure.finalStatus,
  };
  return {
    state: {
      projects: [{ id: "project-1", plotId: "plot-0", name: "Projekt 1", listings: [original, alternative, regression], listingGroup: group }],
      houses: [originalHouse, alternativeHouse],
    },
    campaign,
    contract,
    original,
  };
}

test("normal helper runtime contains no automatic REGRESSION_85 worker, timer, drain or campaign watcher", async () => {
  const source = await readFile(new URL("../local-upload-server.mjs", import.meta.url), "utf8");
  const runtime = source.slice(source.indexOf("async function startLocalHelper"));
  assert.doesNotMatch(source, /createRegression85RepairService/u);
  assert.doesNotMatch(runtime, /regression85RepairService|regression85Timer|Fast Serial Drain|regression85CampaignStore\.load/u);
  assert.match(source, /createRegression85DeleteMutationGuard\(regression85CampaignStore\)/u);
  assert.match(source, /mutationGuard: regression85DeleteMutationGuard/u);
});

test("closed 85er scheduler reconciliation disables only an exact inactive historical owner and is restart-idempotent", () => {
  const value = fixture();
  const preview = previewRegression85SchedulerOwnerReconciliation(value.state, value.campaign, { contract: value.contract });
  assert.equal(preview.eligible.length, 1);
  assert.equal(preview.eligible[0].listingId, value.original.id);
  const first = reconcileRegression85SchedulerOwnersInState(value.state, value.campaign, { contract: value.contract, now: NOW });
  assert.equal(first.result.reconciledCount, 1);
  assert.equal(first.state.projects[0].listings[0].status, "published");
  assert.equal(listingControl(first.state.projects[0].listingGroup, value.original).automaticUpdateEnabled, false);
  assert.equal(first.state.schedulerOwnerReconciliations.length, 1);
  const restarted = reconcileRegression85SchedulerOwnersInState(first.state, value.campaign, { contract: value.contract, now: "2026-09-04T10:00:00.000Z" });
  assert.equal(restarted.result.changed, false);
  assert.equal(restarted.result.reconciledCount, 0);
  assert.strictEqual(restarted.state, first.state);
});

test("closed 85er scheduler reconciliation fails closed on hash, closure or progress drift", () => {
  const value = fixture();
  assert.throws(
    () => previewRegression85SchedulerOwnerReconciliation(value.state, value.campaign, {
      contract: { ...value.contract, scopeEvidenceHash: "f".repeat(64) },
    }),
    (error) => error.code === "REGRESSION_85_SCHEDULER_RECONCILIATION_BLOCKED",
  );
  assert.throws(
    () => previewRegression85SchedulerOwnerReconciliation(value.state, {
      ...value.campaign,
      manualReconciliationClosure: { ...value.campaign.manualReconciliationClosure, finalStatus: "wrong" },
    }, { contract: value.contract }),
    (error) => error.code === "REGRESSION_85_SCHEDULER_RECONCILIATION_BLOCKED",
  );
  const changedProgress = structuredClone(value.campaign);
  changedProgress.progress[0].stage = "identified";
  assert.throws(
    () => previewRegression85SchedulerOwnerReconciliation(value.state, changedProgress, { contract: value.contract }),
    (error) => error.code === "REGRESSION_85_SCHEDULER_RECONCILIATION_BLOCKED",
  );
});

test("reconciliation CLI is read-only by default and requires the exact manual-closure confirmation to apply", async () => {
  const value = fixture();
  let updateCalls = 0;
  const store = {
    async load() {
      return { stored: true, savedAt: NOW, state: value.state };
    },
    async update(mutator) {
      updateCalls += 1;
      const mutation = await mutator(value.state);
      return { result: mutation.result };
    },
  };
  const options = { store, campaign: value.campaign, contract: value.contract, now: NOW };
  const preview = await runRegression85SchedulerOwnerReconciliationCli(["preview"], options);
  assert.equal(preview.eligible.length, 1);
  assert.equal(updateCalls, 0);
  await assert.rejects(
    runRegression85SchedulerOwnerReconciliationCli(["apply", "--confirm", "wrong"], options),
    /REGRESSION_85_CLOSED_MANUAL_RECONCILIATION/u,
  );
  assert.equal(updateCalls, 0);
  const applied = await runRegression85SchedulerOwnerReconciliationCli([
    "apply",
    "--confirm",
    "REGRESSION_85_CLOSED_MANUAL_RECONCILIATION",
  ], options);
  assert.equal(applied.reconciledCount, 1);
  assert.equal(updateCalls, 1);
});
