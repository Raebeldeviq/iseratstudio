import assert from "node:assert/strict";
import test from "node:test";

import { createUploadJobId } from "../batch-upload.mjs";
import {
  confirmImportReportInState,
  matchPendingImportReport,
} from "../immoprofessional-import-confirmation.mjs";
import { listingControl, normalizeListingGroup } from "../listing-groups.mjs";
import { schedulerDueListings } from "../listing-scheduler.mjs";
import { WORKFLOW_STATUS } from "../workflow-status.mjs";

const importedAt = "2026-08-13T09:16:00.000Z";

function parsed(overrides = {}) {
  return {
    messageId: "<synthetic@server22.immoprofessional.eu>",
    rawHash: "a".repeat(64),
    providerImportAt: importedAt,
    subject: "Importbericht OpenImmo XML",
    senderSoftware: "Fabian&Pascal Inseratstudio",
    objectCount: 1,
    providerId: "30460",
    providerCompany: "Synthetische Testfirma",
    providerEmail: "test@example.invalid",
    externalObjectNumber: "30460-810978",
    importResult: "success",
    parserVersion: "1.0.0",
    ...overrides,
  };
}

function fixtureState(options = {}) {
  const source = {
    id: "source-1", externalId: "30460-100001", templateId: "house-a", templateName: "Haus A",
    listingGroupVariantId: "variant-1", listingOrigin: "group-source", version: 1,
    createdAt: "2026-07-01T08:00:00.000Z", status: WORKFLOW_STATUS.PUBLISHED,
  };
  const copy = {
    id: "copy-1", externalId: "30460-810978", templateId: "house-b", templateName: "Haus B",
    listingGroupVariantId: "variant-1", listingOrigin: "rotation-copy", rotationSourceListingId: source.id,
    version: 2, createdAt: "2026-08-13T09:14:00.000Z", transferredAt: "2026-08-13T09:15:00.000Z",
    status: options.copyStatus || WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT,
    ...(options.productionLifecycle ? {
      productionLifecycle: {
        format: 1,
        schedulerRunId: "production-run-1",
        sourceListingId: source.id,
        automaticDeleteAuthorized: true,
        preparedAt: "2026-08-13T09:14:00.000Z",
      },
    } : {}),
  };
  const project = {
    id: "project-1", createdAt: "2026-06-01T08:00:00.000Z", isActive: true,
    listings: [source, copy],
    listingGroup: {
      projectId: "project-1",
      automation: { rotationEnabled: true, updateIntervalDays: 12 },
      variants: [{
        id: "variant-1", projectId: "project-1", role: "variant", order: 1,
        templateId: "house-b", templateName: "Haus B", active: true, approved: true,
        houseSnapshot: {}, listing: copy, createdAt: copy.createdAt, updatedAt: copy.createdAt,
      }],
      listingControls: [
        {
          projectId: "project-1", listingId: source.id, externalId: source.externalId,
          status: WORKFLOW_STATUS.PUBLISHED, automaticUpdateEnabled: true, updateMode: "full-auto",
          pendingRotationListingId: copy.id,
        },
        {
          projectId: "project-1", listingId: copy.id, externalId: copy.externalId,
          status: options.copyStatus || WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT,
          automaticUpdateEnabled: false, updateMode: "full-auto",
        },
      ],
      logs: [], rotationCounter: 0,
    },
  };
  const jobId = createUploadJobId(project, copy);
  project.listingGroup.listingControls[0].pendingRotationJobId = options.pendingJobId || jobId;
  const state = {
    version: 1,
    houses: [],
    projects: [project],
    provider: { providerNumber: "30460" },
    promotionImage: null,
    promotionImageEnabled: false,
    uploadHistory: [{ id: "upload-log-1", jobId, projectId: project.id, listingId: copy.id, status: WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT }],
    scheduler: {
      settings: { enabled: true, paused: false, mode: "full-auto", updateIntervalDays: 12, initialWaitDays: 12 },
      runs: [],
    },
  };
  const ledger = { format: 1, jobs: [{ jobId, projectId: project.id, listingId: copy.id, status: WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT }] };
  return { state, project, source, copy, jobId, ledger };
}

const mail = {
  transportId: "42",
  accountName: "Livinghaus",
  accountId: "synthetic-account-id",
  mailboxName: "Inseratestudio – Importberichte",
  receivedAt: "2026-08-13T09:16:30.000Z",
};

test("matches exactly one pending copy through source reference and completed upload ledger", () => {
  const { state, ledger, jobId } = fixtureState();
  const match = matchPendingImportReport(state, parsed(), ledger);
  assert.equal(match.status, "matched");
  assert.equal(match.listing.id, "copy-1");
  assert.equal(match.source.id, "source-1");
  assert.equal(match.uploadJobId, jobId);
});

test("fails closed for unmatched, ambiguous, non-pending, missing object number and wrong upload job", () => {
  const base = fixtureState();
  assert.equal(matchPendingImportReport(base.state, parsed({ externalObjectNumber: "30460-000000" }), base.ledger).status, "unmatched");
  assert.equal(matchPendingImportReport(base.state, parsed({ externalObjectNumber: "" }), base.ledger).status, "unmatched");
  const published = fixtureState({ copyStatus: WORKFLOW_STATUS.PUBLISHED });
  assert.equal(matchPendingImportReport(published.state, parsed(), published.ledger).status, "unmatched");
  const failed = fixtureState({ copyStatus: WORKFLOW_STATUS.FAILED });
  assert.equal(matchPendingImportReport(failed.state, parsed(), failed.ledger).status, "unmatched");
  const wrongJob = fixtureState({ pendingJobId: "upload:wrong" });
  assert.equal(matchPendingImportReport(wrongJob.state, parsed(), wrongJob.ledger).status, "unmatched");

  const second = fixtureState();
  const project2 = structuredClone(second.project);
  project2.id = "project-2";
  project2.listings = project2.listings.map((listing) => ({ ...listing, id: `${listing.id}-2`, rotationSourceListingId: listing.rotationSourceListingId ? "source-1-2" : undefined }));
  project2.listingGroup.projectId = project2.id;
  project2.listingGroup.listingControls = project2.listingGroup.listingControls.map((control) => ({
    ...control,
    projectId: project2.id,
    listingId: `${control.listingId}-2`,
    pendingRotationListingId: control.pendingRotationListingId ? "copy-1-2" : "",
  }));
  const ambiguousState = { ...base.state, projects: [...base.state.projects, project2] };
  assert.equal(matchPendingImportReport(ambiguousState, parsed(), base.ledger).status, "ambiguous");
});

test("atomically publishes the copy, hands over scheduling and leaves the source externally published", () => {
  const { state, ledger, jobId } = fixtureState();
  const confirmation = confirmImportReportInState(state, parsed(), mail, ledger, { now: "2026-08-13T09:17:00.000Z" });
  assert.equal(confirmation.result.status, "confirmed");
  assert.equal(confirmation.result.matchedUploadJobId, jobId);
  assert.equal(confirmation.result.nextUpdateAt, "2026-08-25T09:16:00.000Z");
  assert.equal(confirmation.state.importReports.length, 1);
  assert.equal(confirmation.result.report.processingStatus, "confirmed");
  assert.equal(confirmation.result.report.mailSourceFolder, "Inseratestudio – Importberichte");
  assert.equal("mailMovedAt" in confirmation.result.report, false);
  assert.equal(confirmation.state.mailImportReportStatus.status, "confirmed");

  const project = confirmation.state.projects[0];
  const source = project.listings.find((listing) => listing.id === "source-1");
  const copy = project.listings.find((listing) => listing.id === "copy-1");
  const group = normalizeListingGroup(project.listingGroup, project.id, { now: "2026-08-13T09:17:00.000Z" });
  assert.equal(copy.status, WORKFLOW_STATUS.PUBLISHED);
  assert.equal(copy.lastUploadedAt, importedAt);
  assert.equal(copy.nextUpdateAt, "2026-08-25T09:16:00.000Z");
  assert.equal(copy.importReportId, confirmation.result.report.reportId);
  assert.equal(listingControl(group, copy).automaticUpdateEnabled, true);
  assert.equal(listingControl(group, copy).nextUpdatedAt, "2026-08-25T09:16:00.000Z");

  assert.equal(source.status, WORKFLOW_STATUS.PUBLISHED);
  assert.equal(source.supersededByListingId, copy.id);
  assert.equal(source.replacementConfirmedAt, importedAt);
  assert.equal(source.externalDeletionPending, true);
  assert.equal(listingControl(group, source).automaticUpdateEnabled, false);
  assert.equal(listingControl(group, source).pendingRotationListingId, "");
  assert.equal(listingControl(group, source).pendingRotationJobId, "");
  assert.equal(project.listings.length, 2);
  assert.equal(project.listings.some((listing) => listing.status === WORKFLOW_STATUS.DELETED || listing.status === WORKFLOW_STATUS.ARCHIVED), false);

  const due = schedulerDueListings(confirmation.state, "2026-08-26T10:00:00.000Z");
  assert.deepEqual(due.map((item) => item.listingId), [copy.id]);
});

test("deduplicates by Message-ID and raw hash without a second business mutation", () => {
  const { state, ledger } = fixtureState();
  const first = confirmImportReportInState(state, parsed(), mail, ledger, { now: "2026-08-13T09:17:00.000Z" });
  const sameMessage = confirmImportReportInState(first.state, parsed(), mail, ledger, { now: "2026-08-13T09:18:00.000Z" });
  assert.equal(sameMessage.result.status, "idempotent");
  assert.equal(sameMessage.state, first.state);
  const sameHash = confirmImportReportInState(first.state, parsed({ messageId: "<duplicate@server22.immoprofessional.eu>" }), mail, ledger);
  assert.equal(sameHash.result.status, "idempotent");
  const changedBody = confirmImportReportInState(first.state, parsed({ rawHash: "b".repeat(64) }), mail, ledger);
  assert.equal(changedBody.result.status, "rejected");
  assert.equal(changedBody.state, first.state);
});

test("only an active production lifecycle authorizes the confirmed source for automatic delete", () => {
  const production = fixtureState({ productionLifecycle: true });
  const confirmed = confirmImportReportInState(production.state, parsed(), mail, production.ledger, { now: "2026-08-13T09:17:00.000Z" });
  const source = confirmed.state.projects[0].listings.find((listing) => listing.id === production.source.id);
  const copy = confirmed.state.projects[0].listings.find((listing) => listing.id === production.copy.id);
  assert.equal(source.productionDeleteState, "authorized");
  assert.equal(source.productionRotationRunId, "production-run-1");
  assert.equal(copy.productionLifecycle.importReportId, confirmed.result.report.reportId);

  const historical = fixtureState();
  const historicalConfirmation = confirmImportReportInState(historical.state, parsed(), mail, historical.ledger, { now: "2026-08-13T09:17:00.000Z" });
  const historicalSource = historicalConfirmation.state.projects[0].listings.find((listing) => listing.id === historical.source.id);
  assert.equal(historicalSource.productionDeleteState, undefined);
});
