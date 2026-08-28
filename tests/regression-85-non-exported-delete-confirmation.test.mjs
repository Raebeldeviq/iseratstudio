import assert from "node:assert/strict";
import test from "node:test";

import {
  IMMOPROFESSIONAL_EXCHANGE_DELETE_CONFIRMATION_TYPE,
  parseImmoprofessionalDeleteReport,
} from "../immoprofessional-delete-report-parser.mjs";
import {
  createRegression85NonExportedAttestation,
  createRegression85NonExportedConfirmationResolver,
  regression85ClassificationFingerprint,
  REGRESSION_85_NON_EXPORTED_CONFIRMATION_TYPE,
} from "../regression-85-non-exported-delete-confirmation.mjs";
import {
  hashRegression85Scope,
  REGRESSION_85_APPROVED_SCOPE_HASH,
} from "../regression-85-repair-scope.mjs";

const NOW = "2026-08-28T11:28:00.000Z";
const TARGET = "30460-423286";
const ORIGINAL = "30460-755080";

function fixture() {
  const items = Array.from({ length: 85 }, (_, index) => ({
    scopeItemId: `regression-85:rogue-${index}`,
    projectId: `project-${index}`,
    plotId: `plot-${index}`,
    originalSourceListingId: `original-${index}`,
    regressionListingId: `rogue-${index}`,
    regressionExternalId: index === 0 ? TARGET : `30460-${String(500_000 + index).padStart(6, "0")}`,
    rotationId: `rogue-${index}`,
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
    heroImageId: `image-${index}`,
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
    observedIsoEvidence: { createdFirst: NOW, createdLast: NOW, transferFirst: NOW, transferLast: NOW, note: "test" },
    houseDistribution: { "SOL 242 V4": 82, "SOL 204 V4": 2, "SOL 229 V3": 1 },
    items,
  };
  const progress = items.map((item, index) => ({
    scopeItemId: item.scopeItemId,
    stage: "identified",
    classification: "ROLLBACK_ELIGIBLE",
    classificationReason: "original_source_published_present_without_delete_transfer",
    evidenceHash: String(index + 1).padStart(64, "a").slice(-64),
    classifiedAt: NOW,
    repairStrategy: "delete_rogue_keep_original",
    repairState: "classified",
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
  }));
  const campaign = {
    format: 2,
    campaignId: "regression-85-test",
    scopeHash: REGRESSION_85_APPROVED_SCOPE_HASH,
    scopeEvidenceHash: hashRegression85Scope(scope),
    scope,
    mode: "paused",
    activeScopeItemId: "",
    createdAt: NOW,
    updatedAt: NOW,
    activatedAt: NOW,
    pausedAt: NOW,
    completedAt: "",
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
  const evidenceSnapshot = {
    format: 1,
    observedAt: NOW,
    channel: "immoprofessional-read-only-exact-reference",
    items: items.map((item, index) => ({
      scopeItemId: item.scopeItemId,
      sourceExternalId: index === 0 ? ORIGINAL : `30460-${String(600_000 + index).padStart(6, "0")}`,
      regressionExternalId: item.regressionExternalId,
      sourcePresence: "present",
      sourcePresenceChannel: "immoprofessional-read-only-exact-reference",
      observedAt: NOW,
      portalStatuses: { immowelt: "not_transferred", kleinanzeigen: "not_transferred", immoscout24: "not_transferred" },
    })),
  };
  const contract = {
    format: 1,
    contract: "regression-85-non-exported-delete-confirmation-v1",
    scopeHash: campaign.scopeHash,
    scopeEvidenceHash: campaign.scopeEvidenceHash,
    classificationFingerprint: regression85ClassificationFingerprint(campaign),
  };
  return { campaign, evidenceSnapshot, contract };
}

function rawReport(options = {}) {
  const target = options.target || TARGET;
  const exchanges = options.exchanges === false ? [] : [
    `Das Objekt "${target}" wurde aus der Börse "Immowelt" gelöscht.`,
  ];
  return [
    "Received: from server22.immoprofessional.eu by mail.example.invalid",
    "Authentication-Results: mail.example.invalid; spf=pass smtp.mailfrom=server22.immoprofessional.eu",
    "Message-ID: <delete-test@server22.immoprofessional.eu>",
    "Subject: Importbericht OpenImmo XML",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    "eine Importdatei wurde am 28.08.2026 um 13:28 Uhr verarbeitet.",
    "Sendersoftware: Fabian&Pascal Inseratestudio",
    "Anzahl Objekte: 1",
    "Anbieter-ID: 30460",
    `OK: Objekt-Nr.: "${target}"`,
    "Erfolgreich gelöscht -",
    ...exchanges,
    options.extra || "",
  ].join("\r\n");
}

async function validatedContext(input = {}) {
  const value = fixture();
  if (input.portalStatus) value.evidenceSnapshot.items[0].portalStatuses.immowelt = input.portalStatus;
  const portalLedger = input.portalLedger || { format: 1, jobs: [] };
  const portalEvents = input.portalEvents || [];
  const attestation = createRegression85NonExportedAttestation({
    campaign: value.campaign,
    evidenceSnapshot: value.evidenceSnapshot,
    portalLedger,
    portalEvents,
    createdAt: NOW,
  }, { contract: input.contract || value.contract });
  const resolver = createRegression85NonExportedConfirmationResolver({
    contract: input.contract || value.contract,
    campaignStore: { async load() { return { ...value.campaign, valid: true, fallbackReason: "" }; } },
    attestationStore: { async load() { return attestation; } },
    readPortalLedger: async () => portalLedger,
    readPortalEvents: async () => portalEvents,
  });
  return resolver({
    sourceListingId: "rogue-0",
    replacementListingId: "original-0",
    externalObjectNumber: TARGET,
    replacementExternalObjectNumber: ORIGINAL,
  });
}

test("A: regular exported object still requires and accepts exact exchange proof", () => {
  const report = parseImmoprofessionalDeleteReport(rawReport(), { expectedTarget: TARGET });
  assert.equal(report.confirmationType, IMMOPROFESSIONAL_EXCHANGE_DELETE_CONFIRMATION_TYPE);
  assert.equal(report.targetWasNeverPortalExported, false);
  assert.deepEqual(report.deletedFromExchanges, ["Immowelt"]);
});

test("B: regular exported object without exchange proof remains blocked", () => {
  assert.throws(
    () => parseImmoprofessionalDeleteReport(rawReport({ exchanges: false }), { expectedTarget: TARGET }),
    /keinen eindeutigen Börsen-Löschnachweis/u,
  );
  assert.throws(
    () => parseImmoprofessionalDeleteReport(rawReport({ exchanges: false }), {
      expectedTarget: TARGET,
      confirmationContext: {
        confirmationType: REGRESSION_85_NON_EXPORTED_CONFIRMATION_TYPE,
        targetWasNeverPortalExported: true,
        targetExternalObjectNumber: TARGET,
        attestationHash: "a".repeat(64),
        portalStatuses: { immowelt: "not_transferred", kleinanzeigen: "not_transferred", immoscout24: "not_transferred" },
      },
    }),
    /keinen eindeutigen Börsen-Löschnachweis/u,
  );
});

test("C: validated never-exported Rogue-B accepts the object-specific positive report with distinct provenance", async () => {
  const confirmationContext = await validatedContext();
  const report = parseImmoprofessionalDeleteReport(rawReport({ exchanges: false }), { expectedTarget: TARGET, confirmationContext });
  assert.equal(report.confirmationType, REGRESSION_85_NON_EXPORTED_CONFIRMATION_TYPE);
  assert.equal(report.targetWasNeverPortalExported, true);
  assert.deepEqual(report.deletedFromExchanges, []);
  assert.equal(report.confirmationEvidence.scopeItemId, "regression-85:rogue-0");
});

test("D: unknown portal status blocks attestation creation", async () => {
  await assert.rejects(validatedContext({ portalStatus: "unknown" }), { code: "DELETE_NON_EXPORTED_PORTAL_STATUS_NOT_PROVEN" });
});

test("E: any scoped portal job or historical portal event blocks the never-exported path", async () => {
  await assert.rejects(validatedContext({
    portalLedger: { format: 1, jobs: [{ jobId: "portal-1", listingId: "rogue-0", externalObjectNumber: TARGET, status: "provider_acknowledged" }] },
  }), { code: "DELETE_NON_EXPORTED_PORTAL_TRANSFER_PROVENANCE_PRESENT" });
  await assert.rejects(validatedContext({
    portalEvents: [{ event: "requested", listingId: "rogue-0", externalObjectNumber: TARGET }],
  }), { code: "DELETE_NON_EXPORTED_PORTAL_TRANSFER_PROVENANCE_PRESENT" });
});

test("F: a wrong object number is blocked even with a validated never-exported context", async () => {
  const confirmationContext = await validatedContext();
  assert.throws(
    () => parseImmoprofessionalDeleteReport(rawReport({ target: "30460-999999", exchanges: false }), { expectedTarget: TARGET, confirmationContext }),
    /nicht exklusiv/u,
  );
});

test("G: wrong scope, evidence hash or classification fingerprint blocks the scoped contract", async () => {
  const value = fixture();
  await assert.rejects(validatedContext({ contract: { ...value.contract, scopeHash: "e".repeat(64) } }), {
    code: "DELETE_NON_EXPORTED_SCOPE_OR_FINGERPRINT_MISMATCH",
  });
  await assert.rejects(validatedContext({ contract: { ...value.contract, scopeEvidenceHash: "d".repeat(64) } }), {
    code: "DELETE_NON_EXPORTED_SCOPE_OR_FINGERPRINT_MISMATCH",
  });
  const wrongContract = { ...value.contract, classificationFingerprint: "f".repeat(64) };
  await assert.rejects(validatedContext({ contract: wrongContract }), { code: "DELETE_NON_EXPORTED_SCOPE_OR_FINGERPRINT_MISMATCH" });
});

test("H: warnings and errors remain blocked before the never-exported exception is considered", async () => {
  const confirmationContext = await validatedContext();
  assert.throws(
    () => parseImmoprofessionalDeleteReport(rawReport({ exchanges: false, extra: "WARNUNG: synthetische Warnung" }), { expectedTarget: TARGET, confirmationContext }),
    /Fehler- oder Warnstatus/u,
  );
  assert.throws(
    () => parseImmoprofessionalDeleteReport(rawReport({ exchanges: false, extra: "Fehler: synthetischer Fehler" }), { expectedTarget: TARGET, confirmationContext }),
    /Fehler- oder Warnstatus/u,
  );
});

test("a portal job appearing after attestation creation blocks the runtime resolver", async () => {
  const value = fixture();
  const attestation = createRegression85NonExportedAttestation({
    campaign: value.campaign,
    evidenceSnapshot: value.evidenceSnapshot,
    portalLedger: { format: 1, jobs: [] },
    portalEvents: [],
    createdAt: NOW,
  }, { contract: value.contract });
  const resolver = createRegression85NonExportedConfirmationResolver({
    contract: value.contract,
    campaignStore: { async load() { return value.campaign; } },
    attestationStore: { async load() { return attestation; } },
    readPortalLedger: async () => ({ format: 1, jobs: [{ listingId: "rogue-0", externalObjectNumber: TARGET, status: "requested" }] }),
    readPortalEvents: async () => [],
  });
  await assert.rejects(resolver({
    sourceListingId: "rogue-0",
    replacementListingId: "original-0",
    externalObjectNumber: TARGET,
    replacementExternalObjectNumber: ORIGINAL,
  }), { code: "DELETE_NON_EXPORTED_PORTAL_TRANSFER_PROVENANCE_PRESENT" });
});
