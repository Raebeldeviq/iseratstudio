import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parseImmoprofessionalDeleteReport } from "../immoprofessional-delete-report-parser.mjs";
import { runLiveCanaryDeleteCli } from "../listing-rotation-live-canary-delete-cli.mjs";
import {
  buildLiveCanaryDeletePayload,
  createLiveCanaryDeleteLedger,
  createLiveCanaryDeleteModeStore,
  finalizeLiveCanaryDeleteInState,
  LIVE_CANARY_DELETE_STATUS,
  LIVE_CANARY_DELETE_TARGETS,
  liveCanaryDeleteIdentity,
  prepareLiveCanaryDelete,
  resolveLiveCanaryDeleteEligibility,
} from "../listing-rotation-live-canary-delete.mjs";
import { WORKFLOW_STATUS } from "../workflow-status.mjs";

const NOW = "2026-08-13T18:10:00.000Z";
const TARGET = "30460-930980";
const CONTRACT = LIVE_CANARY_DELETE_TARGETS[TARGET];

function fixture(overrides = {}) {
  const source = {
    id: CONTRACT.sourceListingId,
    externalId: TARGET,
    templateId: "house-a",
    templateName: "House A",
    listingGroupVariantId: "variant-a",
    status: WORKFLOW_STATUS.PUBLISHED,
    listingOrigin: "group-source",
    supersededByListingId: CONTRACT.expectedReplacementListingId,
    replacementConfirmedAt: NOW,
    externalDeletionPending: true,
  };
  const replacement = {
    id: CONTRACT.expectedReplacementListingId,
    externalId: CONTRACT.expectedReplacementExternalId,
    templateId: "house-b",
    templateName: "House B",
    listingGroupVariantId: "variant-a",
    status: overrides.replacementStatus || WORKFLOW_STATUS.PUBLISHED,
    listingOrigin: "rotation-copy",
    rotationSourceListingId: source.id,
    importConfirmedAt: overrides.importConfirmedAt === false ? "" : NOW,
    importReportId: "report-1",
    nextUpdateAt: "2026-08-25T18:10:00.000Z",
  };
  const project = {
    id: "project-a",
    plotId: CONTRACT.plotId,
    street: "Testweg",
    houseNumber: "1",
    zip: "14797",
    city: "Teststadt",
    isActive: true,
    listings: [source, replacement, { id: "other", externalId: "30460-999999", status: WORKFLOW_STATUS.PUBLISHED }],
    listingGroup: {
      projectId: "project-a",
      automation: { rotationEnabled: true },
      variants: [{ id: "variant-a", active: true, templateId: "house-b", listing: replacement }],
      listingControls: [
        { projectId: "project-a", listingId: source.id, externalId: source.externalId, status: WORKFLOW_STATUS.PUBLISHED, automaticUpdateEnabled: false },
        { projectId: "project-a", listingId: replacement.id, externalId: replacement.externalId, status: replacement.status, automaticUpdateEnabled: true },
      ],
      logs: [],
    },
  };
  const state = {
    provider: { providerNumber: "30460", company: "Test GmbH", email: "test@example.invalid", lastName: "Test" },
    houses: [{ id: "house-a", houseType: "Einfamilienhaus" }, { id: "house-b", houseType: "Einfamilienhaus" }],
    projects: [project, { id: "other-project", plotId: "other-plot", listings: [{ id: "untouched", externalId: "30460-888888", status: WORKFLOW_STATUS.PUBLISHED }] }],
    importReports: overrides.importReport === false ? [] : [{
      reportId: "report-1",
      externalObjectNumber: replacement.externalId,
      importResult: overrides.importFailed ? "failed" : "success",
      sourceListingId: source.id,
      matchedListingId: replacement.id,
    }],
  };
  return { state, project, source, replacement };
}

function rawDeleteReport(target = TARGET, overrides = {}) {
  return Buffer.from([
    "Received: from server22.immoprofessional.eu by mail.example.invalid",
    "Authentication-Results: mail.example.invalid; spf=pass smtp.mailfrom=server22.immoprofessional.eu",
    `Message-ID: ${overrides.messageId || `<${target}@server22.immoprofessional.eu>`}`,
    "Subject: Importbericht OpenImmo XML",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "eine Importdatei wurde am 13.08.2026 um 20:10 Uhr verarbeitet.",
    "Sendersoftware: Fabian&Pascal Inseratestudio",
    "Anzahl Objekte: 1",
    "Anbieter-ID: 30460",
    `OK: Objekt-Nr.: "${target}"`,
    overrides.status || "Erfolgreich gelöscht -",
    `Das Objekt "${target}" wurde aus der Börse "Immowelt" gelöscht.`,
  ].join("\r\n"), "utf8");
}

async function runtime() {
  const directory = await mkdtemp(join(tmpdir(), "live-canary-delete-"));
  const ledger = createLiveCanaryDeleteLedger(join(directory, "jobs.json"));
  const modeStore = createLiveCanaryDeleteModeStore(join(directory, "mode.json"), { now: () => NOW });
  await modeStore.save({ mode: "off", externalObjectNumbers: [] });
  return { directory, ledger, modeStore, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

async function pendingDelete(active, state = fixture().state) {
  await active.modeStore.save({ mode: "canary", externalObjectNumbers: [TARGET] });
  const prepared = await prepareLiveCanaryDelete({
    target: TARGET,
    state,
    modeStore: active.modeStore,
    ledger: active.ledger,
    schemaPath: "synthetic.xsd",
    schemaValidator: async () => ({ ok: true }),
    now: () => NOW,
  });
  const claimed = await active.ledger.claim(prepared.job.deleteJobId, "2026-08-13T18:10:01.000Z");
  const job = await active.ledger.transferred(prepared.job.deleteJobId, claimed.claimToken, "2026-08-13T18:10:02.000Z");
  await active.modeStore.save({ mode: "off", externalObjectNumbers: [] });
  return { prepared, job };
}

test("15 replacement import-confirmed is required before delete", () => {
  const valid = fixture();
  assert.equal(resolveLiveCanaryDeleteEligibility(valid.state, TARGET).replacement.id, CONTRACT.expectedReplacementListingId);
});

test("16 import pending blocks delete", () => {
  const pending = fixture({ importConfirmedAt: false, importReport: false, replacementStatus: WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT });
  assert.throws(() => resolveLiveCanaryDeleteEligibility(pending.state, TARGET), { code: "LIVE_CANARY_DELETE_NOT_ELIGIBLE" });
});

test("17 failed import blocks delete", () => {
  const failed = fixture({ importFailed: true });
  assert.throws(() => resolveLiveCanaryDeleteEligibility(failed.state, TARGET), { code: "LIVE_CANARY_DELETE_NOT_ELIGIBLE" });
});

test("18 delete target equals source and 19 replacement target hard-stops", async () => {
  const { state, source, replacement } = fixture();
  const eligibility = resolveLiveCanaryDeleteEligibility(state, TARGET);
  const payload = await buildLiveCanaryDeletePayload(state, eligibility, { preparedAt: NOW });
  assert.match(payload.xmlText, new RegExp(`<openimmo_obid>${source.externalId}</openimmo_obid>`));
  assert.equal(payload.xmlText.includes(replacement.externalId), false);
  assert.throws(() => liveCanaryDeleteIdentity(replacement, source), { code: "LIVE_CANARY_DELETE_TARGET_NOT_AUTHORIZED" });
});

test("20 delete job is idempotent and 21 restart after transfer never creates a second transfer", async () => {
  const active = await runtime();
  try {
    const pending = await pendingDelete(active);
    const restarted = createLiveCanaryDeleteLedger(join(active.directory, "jobs.json"));
    const again = await restarted.prepare({ ...pending.prepared.identity, projectId: "project-a", sourceListingId: CONTRACT.sourceListingId, replacementListingId: CONTRACT.expectedReplacementListingId, externalObjectNumber: TARGET, replacementExternalObjectNumber: CONTRACT.expectedReplacementExternalId, payloadFilename: pending.prepared.payload.payloadFilename, payloadSha256: pending.prepared.payload.payloadSha256, payloadSize: pending.prepared.payload.payloadSize }, NOW);
    assert.equal(again.deleteJobId, pending.job.deleteJobId);
    await assert.rejects(restarted.claim(again.deleteJobId), { code: "LIVE_CANARY_DELETE_ALREADY_ATTEMPTED" });
    assert.equal((await restarted.read()).jobs[0].attempt, 1);
  } finally { await active.cleanup(); }
});

test("a persisted prepared preflight job is the only resumable job and pre-transfer failure restores off", async () => {
  const active = await runtime();
  try {
    const state = fixture().state;
    await active.modeStore.save({ mode: "canary", externalObjectNumbers: [TARGET] });
    const first = await prepareLiveCanaryDelete({
      target: TARGET,
      state,
      modeStore: active.modeStore,
      ledger: active.ledger,
      schemaPath: "synthetic.xsd",
      schemaValidator: async () => ({ ok: true }),
      now: () => NOW,
    });
    const second = await prepareLiveCanaryDelete({
      target: TARGET,
      state,
      modeStore: active.modeStore,
      ledger: active.ledger,
      schemaPath: "synthetic.xsd",
      schemaValidator: async () => ({ ok: true }),
      now: () => "2026-08-13T18:10:30.000Z",
    });
    assert.equal(second.job.deleteJobId, first.job.deleteJobId);
    assert.equal(second.payload.preparedAt, first.payload.preparedAt);
    assert.equal(second.payload.payloadFilename, first.payload.payloadFilename);
    assert.equal(second.payload.payloadSha256, first.payload.payloadSha256);
    assert.equal(second.payload.payloadSize, first.payload.payloadSize);
    await assert.rejects(
      runLiveCanaryDeleteCli(["transfer", "--external-id", TARGET, "--schema", "synthetic.xsd"], {
        modeStore: active.modeStore,
        ledger: active.ledger,
        store: { load: async () => ({ stored: true, state }) },
        schemaValidator: async () => ({ ok: true }),
        vault: { credentials: {} },
        writeLog: async () => undefined,
        now: () => NOW,
      }),
      /FTPS-Zugang ist unvollständig/u,
    );
    assert.equal((await active.modeStore.load()).mode, "off");
    assert.equal((await active.ledger.read()).jobs[0].status, LIVE_CANARY_DELETE_STATUS.PREPARED);
  } finally { await active.cleanup(); }
});

test("22 exact positive source delete mail confirms", async () => {
  const active = await runtime();
  try {
    const pending = await pendingDelete(active);
    const report = parseImmoprofessionalDeleteReport(rawDeleteReport(), { expectedTarget: TARGET });
    const confirmed = await active.ledger.confirm(pending.job.deleteJobId, report, NOW);
    assert.equal(confirmed.status, LIVE_CANARY_DELETE_STATUS.CONFIRMED);
  } finally { await active.cleanup(); }
});

test("23 replacement number mail is rejected and 24 other number is unmatched", () => {
  assert.throws(() => parseImmoprofessionalDeleteReport(rawDeleteReport(CONTRACT.expectedReplacementExternalId), { expectedTarget: TARGET }), /exklusiv/u);
  assert.throws(() => parseImmoprofessionalDeleteReport(rawDeleteReport("30460-111111"), { expectedTarget: TARGET }), /exklusiv/u);
});

test("25 unknown delete status remains pending and requires review", async () => {
  const active = await runtime();
  try {
    const pending = await pendingDelete(active);
    assert.throws(() => parseImmoprofessionalDeleteReport(rawDeleteReport(TARGET, { status: "Verarbeitung abgeschlossen" }), { expectedTarget: TARGET }));
    assert.equal((await active.ledger.read()).jobs.find((job) => job.deleteJobId === pending.job.deleteJobId).status, LIVE_CANARY_DELETE_STATUS.PENDING_CONFIRMATION);
  } finally { await active.cleanup(); }
});

test("26 one exact delete report is sufficient", async () => {
  const active = await runtime();
  try {
    const pending = await pendingDelete(active);
    const report = parseImmoprofessionalDeleteReport(rawDeleteReport(), { expectedTarget: TARGET });
    const job = await active.ledger.confirm(pending.job.deleteJobId, report, NOW);
    const final = finalizeLiveCanaryDeleteInState(fixture().state, job, report, { now: NOW });
    assert.equal(final.source.status, WORKFLOW_STATUS.DELETED);
  } finally { await active.cleanup(); }
});

test("27 second positive portal evidence creates no second catalog mutation", async () => {
  const active = await runtime();
  try {
    const pending = await pendingDelete(active);
    const first = parseImmoprofessionalDeleteReport(rawDeleteReport(), { expectedTarget: TARGET });
    const confirmed = await active.ledger.confirm(pending.job.deleteJobId, first, NOW);
    const final = finalizeLiveCanaryDeleteInState(fixture().state, confirmed, first, { now: NOW });
    const second = parseImmoprofessionalDeleteReport(rawDeleteReport(TARGET, { messageId: "<second@server22.immoprofessional.eu>" }), { expectedTarget: TARGET });
    const evidence = await active.ledger.confirm(confirmed.deleteJobId, second, "2026-08-13T18:11:00.000Z");
    assert.equal(evidence.additionalReports.length, 1);
    assert.equal(finalizeLiveCanaryDeleteInState(final.state, evidence, first, { now: NOW }).idempotent, true);
  } finally { await active.cleanup(); }
});

test("28 source final deleted leaves replacement unchanged, 29 nextUpdateAt unchanged, 30 other listings unchanged", async () => {
  const active = await runtime();
  try {
    const before = fixture();
    const pending = await pendingDelete(active, before.state);
    const report = parseImmoprofessionalDeleteReport(rawDeleteReport(), { expectedTarget: TARGET });
    const confirmed = await active.ledger.confirm(pending.job.deleteJobId, report, NOW);
    const replacementBefore = structuredClone(before.replacement);
    const otherBefore = structuredClone(before.state.projects[1]);
    const final = finalizeLiveCanaryDeleteInState(before.state, confirmed, report, { now: NOW });
    const project = final.state.projects[0];
    assert.equal(project.listings.find((listing) => listing.id === before.source.id).status, WORKFLOW_STATUS.DELETED);
    assert.deepEqual(project.listings.find((listing) => listing.id === before.replacement.id), replacementBefore);
    assert.equal(project.listings.find((listing) => listing.id === before.replacement.id).nextUpdateAt, replacementBefore.nextUpdateAt);
    assert.deepEqual(final.state.projects[1], otherBefore);
  } finally { await active.cleanup(); }
});

test("mode is fail-closed and canary accepts exactly one of the three fixed targets", async () => {
  const active = await runtime();
  try {
    assert.equal((await active.modeStore.load()).mode, "off");
    const canary = await active.modeStore.save({ mode: "canary", externalObjectNumbers: [TARGET] });
    assert.deepEqual(canary.externalObjectNumbers, [TARGET]);
    await assert.rejects(active.modeStore.save({ mode: "canary", externalObjectNumbers: [TARGET, "30460-142086"] }), { code: "LIVE_CANARY_DELETE_TARGET_COUNT_INVALID" });
    await assert.rejects(active.modeStore.save({ mode: "canary", externalObjectNumbers: ["30460-999999"] }), { code: "LIVE_CANARY_DELETE_TARGET_NOT_AUTHORIZED" });
  } finally { await active.cleanup(); }
});
