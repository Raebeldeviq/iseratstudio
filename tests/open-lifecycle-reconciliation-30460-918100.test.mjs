import assert from "node:assert/strict";
import test from "node:test";

import { createUploadJobId } from "../batch-upload.mjs";
import {
  createListingGroup,
  updateListingControl,
} from "../listing-groups.mjs";
import {
  inspectOpenLifecycle30460918100,
  OPEN_LIFECYCLE_30460_918100,
  reconcileCompletedOpenLifecycle30460918100,
} from "../open-lifecycle-reconciliation-30460-918100.mjs";
import {
  productionDeleteIdentity,
  PRODUCTION_DELETE_STATUS,
} from "../listing-rotation-production-delete.mjs";
import { ROTATION_LIFECYCLE_STAGE } from "../listing-rotation-lifecycle-coordinator.mjs";
import { WORKFLOW_STATUS } from "../workflow-status.mjs";

const IMPORTED_AT = "2026-08-22T15:32:00.000Z";
const DELETED_AT = "2026-08-23T08:00:00.000Z";

function ids() {
  let value = 0;
  return () => `test-id-${++value}`;
}

function exactFixture() {
  const contract = OPEN_LIFECYCLE_30460_918100;
  const source = {
    id: contract.sourceListingId,
    externalId: contract.sourceExternalObjectNumber,
    templateId: "preset_house_sun154_v3",
    templateName: "SUN 154 V3",
    status: WORKFLOW_STATUS.PUBLISHED,
    listingOrigin: "group-source",
    supersededByListingId: contract.replacementListingId,
    replacementConfirmedAt: IMPORTED_AT,
    externalDeletionPending: true,
    productionDeleteState: "authorized",
    productionDeleteAuthorizedAt: IMPORTED_AT,
    productionRotationRunId: contract.schedulerRunId,
  };
  const replacement = {
    id: contract.replacementListingId,
    externalId: contract.replacementExternalObjectNumber,
    templateId: source.templateId,
    templateName: source.templateName,
    version: 2,
    status: WORKFLOW_STATUS.PUBLISHED,
    listingOrigin: "rotation-copy",
    rotationSourceListingId: source.id,
    transferredAt: "2026-08-22T15:31:57.625Z",
    importConfirmedAt: IMPORTED_AT,
    importReportId: "import-report-exact",
    lastUploadedAt: IMPORTED_AT,
    nextUpdateAt: "2026-09-03T15:32:00.000Z",
    productionLifecycle: {
      format: 1,
      schedulerRunId: contract.schedulerRunId,
      sourceListingId: source.id,
      automaticDeleteAuthorized: true,
      lifecycleStage: ROTATION_LIFECYCLE_STAGE.POST_IMPORT_PRE_DELETE,
      lifecycleIndex: 7,
      lifecycleStartedAt: "2026-08-22T15:31:51.822Z",
      preparedAt: "2026-08-22T15:31:52.000Z",
      importConfirmedAt: IMPORTED_AT,
      importReportId: "import-report-exact",
      batchOverrideId: contract.batchOverrideId,
      batchOverrideMaxRunItems: 25,
      runtimeCommit: contract.runtimeCommit,
    },
  };
  let group = createListingGroup(contract.projectId, { idFactory: ids(), now: "2026-07-01T00:00:00.000Z" });
  group = updateListingControl(group, source, {
    automaticUpdateEnabled: false,
    automaticDeletionEnabled: false,
    status: WORKFLOW_STATUS.PUBLISHED,
  }, { idFactory: ids(), now: IMPORTED_AT });
  group = updateListingControl(group, replacement, {
    automaticUpdateEnabled: true,
    automaticDeletionEnabled: false,
    status: WORKFLOW_STATUS.PUBLISHED,
    lastSuccessAt: IMPORTED_AT,
  }, { idFactory: ids(), now: IMPORTED_AT });
  const project = {
    id: contract.projectId,
    plotId: contract.plotId,
    zip: "14542",
    city: "Werder",
    listings: [source, replacement],
    listingGroup: group,
  };
  const importReport = {
    reportId: replacement.importReportId,
    processingStatus: "confirmed",
    importResult: "success",
    projectId: project.id,
    sourceListingId: source.id,
    matchedListingId: replacement.id,
    externalObjectNumber: replacement.externalId,
  };
  const uploadJob = {
    jobId: createUploadJobId(project, replacement),
    projectId: project.id,
    listingId: replacement.id,
    externalObjectNumber: replacement.externalId,
    status: WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT,
    transferredAt: replacement.transferredAt,
  };
  assert.equal(uploadJob.jobId, contract.uploadJobId);
  return {
    state: {
      version: 1,
      provider: { providerNumber: "30460", company: "Test GmbH", lastName: "Test", email: "test@example.invalid" },
      houses: [{ id: source.templateId, name: source.templateName, houseType: "Einfamilienhaus" }],
      projects: [project],
      importReports: [importReport],
      deleteReports: [],
      uploadHistory: [{
        id: "upload-history-exact",
        jobId: uploadJob.jobId,
        projectId: project.id,
        listingId: replacement.id,
        status: WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT,
        error: "",
      }],
    },
    uploadLedger: { format: 1, jobs: [uploadJob] },
    deleteLedger: { format: 1, jobs: [] },
    transferEvents: [{
      event: "transferred",
      jobId: uploadJob.jobId,
      externalId: replacement.externalId,
    }],
  };
}

test("the exact open lifecycle accepts one upload transfer and rejects duplicate evidence", () => {
  const fixture = exactFixture();
  const assessment = inspectOpenLifecycle30460918100(
    fixture.state,
    fixture.uploadLedger,
    fixture.deleteLedger,
    fixture.transferEvents,
  );
  assert.equal(assessment.upload.confirmedTransferCount, 1);
  assert.equal(assessment.source.externalObjectNumber, "30460-261429");
  assert.equal(assessment.replacement.externalObjectNumber, "30460-918100");
  assert.throws(
    () => inspectOpenLifecycle30460918100(
      fixture.state,
      fixture.uploadLedger,
      fixture.deleteLedger,
      [...fixture.transferEvents, ...fixture.transferEvents],
    ),
    (error) => error.code === "OPEN_LIFECYCLE_DUPLICATE_UPLOAD_EVIDENCE",
  );
});

test("the exact lifecycle contract fails closed on any source or replacement mismatch", () => {
  const fixture = exactFixture();
  fixture.state.projects[0].listings[1].externalId = "30460-000000";
  assert.throws(
    () => inspectOpenLifecycle30460918100(fixture.state, fixture.uploadLedger, fixture.deleteLedger),
    (error) => error.code === "OPEN_LIFECYCLE_EXACT_RELATION_MISMATCH",
  );
});

test("a positively confirmed exact DELETE completes the lifecycle once and is idempotent", () => {
  const fixture = exactFixture();
  const project = fixture.state.projects[0];
  const source = project.listings[0];
  const replacement = project.listings[1];
  const identity = productionDeleteIdentity(source, replacement);
  const reportHash = "b".repeat(64);
  const deleteJob = {
    ...identity,
    projectId: project.id,
    sourceListingId: source.id,
    replacementListingId: replacement.id,
    externalObjectNumber: source.externalId,
    replacementExternalObjectNumber: replacement.externalId,
    status: PRODUCTION_DELETE_STATUS.CONFIRMED,
    attempt: 1,
    transferStartedAt: "2026-08-23T07:59:58.000Z",
    transferCompletedAt: "2026-08-23T07:59:59.000Z",
    confirmedAt: DELETED_AT,
    reportMessageId: "delete-message-exact",
    reportHash,
  };
  Object.assign(source, {
    status: WORKFLOW_STATUS.DELETED,
    externalDeletionPending: false,
    productionDeleteState: "confirmed",
    productionDeleteJobId: deleteJob.deleteJobId,
    deleteJobId: deleteJob.deleteJobId,
    deleteConfirmedAt: DELETED_AT,
    deleteReportHash: reportHash,
  });
  project.listingGroup = updateListingControl(project.listingGroup, source, {
    automaticUpdateEnabled: false,
    automaticDeletionEnabled: false,
    status: WORKFLOW_STATUS.DELETED,
    processLease: null,
  }, { idFactory: ids(), now: DELETED_AT });
  fixture.state.deleteReports = [{
    reportId: "delete-report-exact",
    deleteJobId: deleteJob.deleteJobId,
    sourceListingId: source.id,
    replacementListingId: replacement.id,
    externalObjectNumber: source.externalId,
    result: "success",
    messageId: deleteJob.reportMessageId,
    rawHash: reportHash,
  }];
  fixture.deleteLedger.jobs = [deleteJob];

  const first = reconcileCompletedOpenLifecycle30460918100(
    fixture.state,
    fixture.uploadLedger,
    fixture.deleteLedger,
    { now: DELETED_AT },
  );
  assert.equal(first.result.status, "reconciled");
  const lifecycle = first.state.projects[0].listings[1].productionLifecycle;
  assert.equal(lifecycle.lifecycleStage, ROTATION_LIFECYCLE_STAGE.COMPLETED);

  const second = reconcileCompletedOpenLifecycle30460918100(
    first.state,
    fixture.uploadLedger,
    fixture.deleteLedger,
    { now: DELETED_AT },
  );
  assert.equal(second.result.status, "idempotent");
});
