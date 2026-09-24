import assert from "node:assert/strict";
import test from "node:test";

import { runPhase2BClaimScanCli } from "../phase2b-claim-scan-cli.mjs";
import {
  LEGACY_FIXED_DESCRIPTION_CTA,
  PHASE2B_SCAN_READ_ONLY_GUARANTEE,
  PHASE2B_TREATMENT,
  formatPhase2BScanMarkdown,
  scanPhase2BClaims,
} from "../phase2b-claim-scan.mjs";

function state() {
  const house = {
    id: "house-1",
    name: "Testhaus",
    energyDemand: 18,
    images: [],
  };
  const baseListing = (id, texts) => ({
    id,
    externalId: `30460-${id}`,
    templateId: house.id,
    templateName: house.name,
    status: "published",
    texts: {
      title: "Sachlicher Titel",
      description: "Sachliche Objektbeschreibung.",
      equipment: "Sachliche Ausstattung.",
      location: "Sachliche Lage.",
      other: "Sachliche Hinweise.",
      ...texts,
    },
  });
  return {
    houses: [house],
    projects: [{
      id: "project-1",
      name: "Testprojekt",
      city: "Berlin",
      listings: [
        baseListing("manual", {
          description: "Dieses nachhaltige und besonders energieeffiziente Eigenheim bietet dauerhaft niedrige Energiekosten.",
        }),
        baseListing("legacy", {
          description: `Individuell formulierter Einstieg.\n\n${LEGACY_FIXED_DESCRIPTION_CTA}`,
        }),
        baseListing("mixed", {
          description: `Nachhaltiges Haus mit niedrigeren Energiekosten.\n\n${LEGACY_FIXED_DESCRIPTION_CTA}`,
        }),
        baseListing("clean", {
          equipment: "Das projektierte Haus gehört zu einer Hausserie mit verifizierter DGNB-Serienzertifizierung. Für die zugehörige Hausserie ist ein verifiziertes QNG-Serienmerkmal hinterlegt.",
        }),
        { ...baseListing("archived", { description: "Nachhaltiges Haus." }), status: "archived" },
      ],
    }],
  };
}

test("classifies active listings without mutating the catalog state", () => {
  const input = state();
  const before = structuredClone(input);
  const report = scanPhase2BClaims(input, { now: "2026-09-24T10:00:00.000Z" });

  assert.deepEqual(input, before);
  assert.equal(report.readOnly, true);
  assert.equal(report.scannedListingCount, 4);
  assert.equal(report.affectedListingCount, 3);
  assert.equal(report.treatmentCounts[PHASE2B_TREATMENT.NO_ACTION], 1);
  assert.equal(report.findings.some((finding) => finding.listingId === "manual" && finding.proposedTreatment === PHASE2B_TREATMENT.MANUAL_REVIEW), true);
  assert.equal(report.findings.some((finding) => finding.listingId === "legacy" && finding.proposedTreatment === PHASE2B_TREATMENT.SAFE_DETERMINISTIC_REPLACEMENT), true);
  assert.equal(report.findings.some((finding) => finding.listingId === "mixed" && finding.proposedTreatment === PHASE2B_TREATMENT.MANUAL_REVIEW), true);
  assert.equal(report.fieldPlans.some((plan) => plan.listingId === "mixed" && plan.proposedTreatment === PHASE2B_TREATMENT.MANUAL_REVIEW), true);
  assert.equal(report.findings.some((finding) => finding.listingId === "clean"), false);
  assert.deepEqual(PHASE2B_SCAN_READ_ONLY_GUARANTEE, {
    writesCatalog: false,
    writesListings: false,
    triggersUploads: false,
    regeneratesTexts: false,
  });
  assert.match(formatPhase2BScanMarkdown(report), /Konkrete Feldmaßnahmen|SAFE_DETERMINISTIC_REPLACEMENT/u);
});

test("CLI reads a provided catalog snapshot once and only returns a report", async () => {
  const input = state();
  let loads = 0;
  const result = await runPhase2BClaimScanCli(["scan"], {
    now: "2026-09-24T10:00:00.000Z",
    loadCatalogManifest: async () => {
      loads += 1;
      return { stored: true, state: input };
    },
  });
  assert.equal(loads, 1);
  assert.equal(result.readOnly, true);
  assert.match(result.output, /Read-only Claim-Scan/u);
});
