import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  classifyBrokerContent,
  createPlotInquiryWorkflow,
  evaluatePortalControlFields,
  houseBuilderOfferEvidence,
  hasCompletePlotAddress,
  INQUIRY_STATUS,
  isEligibleInquiryPlot,
  isHouseBuilderOffer,
  isEligibleImmoScoutPlot,
  isPlotWithinSearchPrice,
  maximumPricePerSqmForBrw,
  mergeExposeFieldsIntoPlot,
  parseActivePostalCodes,
  parseExcludedHouseBuilders,
  PLOT_INQUIRY_QUEUE_POLICY,
  PLOT_SEARCH_POLICY,
  PORTAL_CONTROL_FIELD_POLICY,
  providerNameFromPlot,
} from "../plot-inquiry-workflow.mjs";

function catalogState() {
  return {
    version: 1,
    plots: [
      {
        id: "plot-immo-1",
        street: "Kirschallee",
        houseNumber: "12",
        postalCode: "14469",
        city: "Potsdam",
        plotSizeSqm: 700,
        purchasePrice: 300000,
        sourceInternalId: "IS24-100",
        sourceName: "ImmoScout24",
        listingUrl: "https://www.immobilienscout24.de/expose/100",
        sourceStatus: "Neu",
        createdAt: "2026-07-30T06:00:00.000Z",
        updatedAt: "2026-07-30T06:00:00.000Z",
        isActive: true,
      },
      {
        id: "plot-other-1",
        street: "Gartenstraße",
        houseNumber: "3",
        postalCode: "14542",
        city: "Werder",
        sourceName: "Maklerseite",
        listingUrl: "https://example.test/grundstueck/1",
        sourceStatus: "Neu",
        createdAt: "2026-07-30T06:00:00.000Z",
        updatedAt: "2026-07-30T06:00:00.000Z",
        isActive: true,
      },
      {
        id: "plot-immo-hidden-address",
        street: "Adresse nicht öffentlich angegeben",
        houseNumber: "",
        postalCode: "14542",
        city: "Werder (Havel)",
        plotSizeSqm: 797,
        purchasePrice: 143000,
        sourceInternalId: "IS24-200",
        sourceName: "ImmoScout24",
        sourceProviderName: "Muster Immobilien GmbH",
        listingUrl: "https://www.immobilienscout24.de/expose/200",
        sourceStatus: "Neu",
        createdAt: "2026-07-30T06:00:00.000Z",
        updatedAt: "2026-07-30T06:00:00.000Z",
        isActive: true,
      },
    ],
    projects: [],
    houses: [],
    provider: {},
  };
}

async function fixture(context, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "fpi-inquiry-"));
  const exposeInbox = join(root, "exposes");
  await mkdir(exposeInbox, { recursive: true });
  context.after(() => rm(root, { recursive: true, force: true }));
  let savedCatalog = null;
  const service = createPlotInquiryWorkflow({
    statePath: join(root, "state.json"),
    lockPath: join(root, "state.lock"),
    exposeInbox,
    expectedActivePostalCodeCount: 0,
    now: overrides.now || (() => "2026-07-30T07:15:00.000Z"),
    loadCatalog: overrides.loadCatalog || (async () => ({ stored: true, savedAt: "2026-07-30T07:00:00.000Z", state: catalogState() })),
    loadActivePostalCodes: overrides.loadActivePostalCodes || (async () => new Set(["14469", "14542"])),
    loadExcludedHouseBuilders: overrides.loadExcludedHouseBuilders || (async () => new Set()),
    startCatalog: async (input) => { savedCatalog = input.state; return { missingImageIds: [] }; },
    commitCatalog: async () => ({ savedAt: "2026-07-30T07:15:00.000Z" }),
    analyzeExpose: overrides.analyzeExpose || (async ({ filename }) => ({
      temporaryReference: ".pending/test.pdf",
      filename,
      pageCount: 1,
      fields: {
        street: "Musterstraße",
        houseNumber: "7",
        postalCode: "14542",
        city: "Werder (Havel)",
        plotSizeSqm: 797,
        purchasePrice: 143000,
      },
    })),
    commitExpose: async ({ filename }) => ({ reference: "plot-immo-1/expose.pdf", filename, uploadedAt: "2026-07-30T07:15:00.000Z" }),
    archiveExpose: async () => ({ archived: true }),
  });
  return { root, exposeInbox, service, savedCatalog: () => savedCatalog };
}

test("only in-range detail links without a complete address enter the commercial inquiry queue", async (context) => {
  const item = await fixture(context);
  const result = await item.service.sync();
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].plotId, "plot-immo-hidden-address");
  assert.equal(result.items[0].status, INQUIRY_STATUS.AWAITING_APPROVAL);
  assert.equal(result.items[0].providerReviewRequired, false);
  assert.equal(result.items[0].postalCode, "14542");
  assert.equal(result.items[0].city, "Werder (Havel)");
  assert.equal(result.items[0].plotSizeSqm, 797);
  assert.equal(result.items[0].purchasePrice, 143000);
  assert.equal(result.items[0].sourceProviderName, "Muster Immobilien GmbH");
  assert.match(result.items[0].inquiryMessage, /^Guten Tag liebes Team,/u);
  assert.match(result.items[0].inquiryMessage, /Ihr Immobilienangebot hat mein Interesse geweckt/u);
  assert.doesNotMatch(result.items[0].inquiryMessage, /Living Haus/u);
  assert.equal(isEligibleImmoScoutPlot(catalogState().plots[0]), false);
  assert.equal(isEligibleImmoScoutPlot(catalogState().plots[1]), false);
  assert.equal(isEligibleInquiryPlot(catalogState().plots[2]), true);

  const repeated = await item.service.sync();
  assert.equal(repeated.items.length, 1);
});

test("active postal codes are read only from rows marked Ja", () => {
  assert.deepEqual([...parseActivePostalCodes([
    ["Postleitzahl", "Region", "Aktiv"],
    ["14542", "Potsdam-Mittelmark", "Ja"],
    ["14929", "Potsdam-Mittelmark", "Nein"],
    [10115, "Berlin", "Ja"],
  ])], ["14542", "10115"]);
});

test("preview projects the inquiry queue without writing persistent state", async (context) => {
  const item = await fixture(context);
  const result = await item.service.preview();
  assert.equal(result.preview, true);
  assert.equal(result.mutationsPersisted, false);
  assert.equal(result.activePostalCodeCount, 2);
  assert.equal(result.current.openInNewArea, 0);
  assert.equal(result.projected.openInNewArea, 1);
  await assert.rejects(readFile(join(item.root, "state.json")), (error) => error.code === "ENOENT");
});

test("protected history outside the active area remains unchanged and does not consume queue capacity", async (context) => {
  const activePlots = Array.from({ length: 4 }, (_, index) => ({
    id: `active-candidate-${index + 1}`,
    street: "Adresse nicht öffentlich angegeben",
    houseNumber: "",
    postalCode: "14542",
    city: "Werder (Havel)",
    plotSizeSqm: 600,
    purchasePrice: 150000,
    sourceInternalId: `ACTIVE-${index + 1}`,
    sourceName: "Maklerseite",
    sourceProviderName: "Makler Kontor",
    listingUrl: `https://makler.example/objekt/active-${index + 1}`,
    sourceStatus: "Neu",
    sourceFirstSeenAt: `2026-07-30T06:0${index}:00.000Z`,
    createdAt: "2026-07-30T06:00:00.000Z",
    updatedAt: "2026-07-30T06:00:00.000Z",
    isActive: true,
  }));
  const historicalPlot = {
    ...activePlots[0],
    id: "historical-outside",
    postalCode: "14929",
    city: "Treuenbrietzen",
    sourceInternalId: "OLD-AREA",
    listingUrl: "https://makler.example/objekt/old-area",
    purchasePrice: 999999,
  };
  const item = await fixture(context, {
    loadCatalog: async () => ({
      stored: true,
      savedAt: "2026-07-30T07:00:00.000Z",
      state: { ...catalogState(), plots: [...activePlots, historicalPlot] },
    }),
    loadActivePostalCodes: async () => new Set(["14542"]),
  });
  await writeFile(join(item.root, "state.json"), JSON.stringify({
    version: 1,
    updatedAt: "2026-07-29T00:00:00.000Z",
    profile: {},
    items: [{
      id: "inquiry-historical-outside",
      plotId: "historical-outside",
      postalCode: "14929",
      city: "Historischer Ort",
      address: "Historische Straße 1 14929 Historischer Ort",
      sourceName: "Historische Quelle",
      purchasePrice: 123000,
      status: INQUIRY_STATUS.LEGAL_REVIEW_REQUIRED,
      discoveredAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-29T00:00:00.000Z",
      sentAt: "2026-07-02T00:00:00.000Z",
      legalReasons: ["Maklervertrag"],
    }],
    history: [],
  }));

  const result = await item.service.sync();
  const historical = result.items.find((entry) => entry.plotId === "historical-outside");
  assert.equal(historical.status, INQUIRY_STATUS.LEGAL_REVIEW_REQUIRED);
  assert.equal(historical.city, "Historischer Ort");
  assert.equal(historical.address, "Historische Straße 1 14929 Historischer Ort");
  assert.equal(historical.purchasePrice, 123000);
  assert.equal(historical.updatedAt, "2026-07-29T00:00:00.000Z");
  assert.equal(result.items.filter((entry) => entry.status === INQUIRY_STATUS.AWAITING_APPROVAL).length, 3);
});

test("direct broker sources become providers while portals remain unresolved", () => {
  assert.equal(providerNameFromPlot({ sourceName: "Oehmcke Immobilien", listingUrl: "https://www.oehmcke-immobilien.de/objekt/1" }), "Oehmcke Immobilien");
  assert.equal(providerNameFromPlot({ sourceName: "Sparkasse MBS", listingUrl: "https://immo.fio.de/webexposee/1" }), "Sparkasse MBS");
  assert.equal(providerNameFromPlot({ sourceName: "ImmoScout24", listingUrl: "https://www.immobilienscout24.de/expose/1" }), "");
  assert.equal(providerNameFromPlot({ sourceName: "Immowelt", listingUrl: "https://www.immowelt.de/expose/1" }), "");
});

test("an identified provider is persisted in inquiry and catalog before approval", async (context) => {
  const item = await fixture(context);
  await item.service.sync();
  const updated = await item.service.recordEvent({
    plotId: "plot-immo-hidden-address",
    event: "provider_identified",
    providerName: "VON POLL IMMOBILIEN Kleinmachnow - KAROS Objekt GmbH",
  });
  assert.equal(updated.items[0].sourceProviderName, "VON POLL IMMOBILIEN Kleinmachnow - KAROS Objekt GmbH");
  assert.equal(updated.items[0].providerReviewRequired, false);
  assert.equal(item.savedCatalog().plots.find((plot) => plot.id === "plot-immo-hidden-address").sourceProviderName, "VON POLL IMMOBILIEN Kleinmachnow - KAROS Objekt GmbH");
  await assert.rejects(
    item.service.recordEvent({ plotId: "plot-immo-hidden-address", event: "provider_identified", providerName: "ImmoScout24" }),
    /Portal ist nur die Quelle/u,
  );
});

test("an inquiry cannot be approved while the actual provider is unresolved", async (context) => {
  const state = catalogState();
  state.plots.find((plot) => plot.id === "plot-immo-hidden-address").sourceProviderName = "";
  const item = await fixture(context, {
    loadCatalog: async () => ({ stored: true, savedAt: "2026-07-30T07:00:00.000Z", state }),
  });
  await item.service.sync();
  await assert.rejects(
    item.service.approveInquiries(["plot-immo-hidden-address"]),
    /tatsächliche Inseratersteller/u,
  );
});

test("house-builder offers are excluded by provider, configured name and combined-offer title", () => {
  const configured = parseExcludedHouseBuilders([
    ["Name/Firma", "Aktiv", "Hinweis"],
    ["Beispiel Traumhaus", "Ja", "Hausbaufirma"],
    ["FingerHaus", "Ja", "Hausbaufirma"],
    ["Normaler Makler", "Nein", "nicht ausschließen"],
  ]);
  assert.deepEqual([...configured], ["Beispiel Traumhaus", "FingerHaus"]);
  assert.equal(isHouseBuilderOffer({ sourceProviderName: "Beispiel Traumhaus GmbH" }, configured), true);
  assert.equal(isHouseBuilderOffer({ sourceProviderName: "Living Haus GmbH" }, new Set()), true);
  assert.equal(isHouseBuilderOffer({ sourceProviderName: "Muster Fertighaus GmbH" }, configured), true);
  assert.equal(isHouseBuilderOffer({ sourceName: "ImmoScout24", sourceListingTitle: "Baugrundstück inklusive projektiertem Haus" }, configured), true);
  assert.equal(isHouseBuilderOffer({ sourceProviderName: "Makler Kontor", sourceListingTitle: "Baugrundstück ohne Bauträgerbindung" }, configured), false);
  assert.deepEqual(houseBuilderOfferEvidence({ sourceProviderName: "FingerHaus GmbH" }, configured), {
    excluded: true,
    reason: "configured_house_builder",
    match: "FingerHaus",
  });
  assert.equal(isEligibleInquiryPlot({
    ...catalogState().plots[2],
    sourceProviderName: "FingerHaus GmbH",
  }, { excludedHouseBuilders: configured }), false);
});

test("queue keeps at most twenty items and three per postal code", async (context) => {
  const postalCodes = ["10115", "10117", "10119", "14467", "14469", "14532", "14542", "14547"];
  const plots = Array.from({ length: 28 }, (_, index) => ({
    id: `candidate-${index + 1}`,
    street: "Adresse nicht öffentlich angegeben",
    houseNumber: "",
    postalCode: postalCodes[index % postalCodes.length],
    city: "Suchort",
    plotSizeSqm: 500,
    purchasePrice: 150000,
    sourceInternalId: `SOURCE-${index + 1}`,
    sourceName: "Maklerseite",
    listingUrl: `https://makler.example/objekt/${index + 1}`,
    sourceStatus: "Neu",
    sourceFirstSeenAt: new Date(Date.UTC(2026, 6, 30, 6, index)).toISOString(),
    createdAt: "2026-07-30T06:00:00.000Z",
    updatedAt: "2026-07-30T06:00:00.000Z",
    isActive: true,
  }));
  const item = await fixture(context, {
    loadCatalog: async () => ({ stored: true, savedAt: "2026-07-30T07:00:00.000Z", state: { ...catalogState(), plots } }),
    loadActivePostalCodes: async () => new Set(postalCodes),
  });
  const result = await item.service.sync();
  const active = result.items.filter((entry) => entry.status === INQUIRY_STATUS.AWAITING_APPROVAL);
  assert.equal(PLOT_INQUIRY_QUEUE_POLICY.maximumActiveItems, 20);
  assert.equal(active.length, 20);
  for (const postalCode of postalCodes) {
    assert.ok(active.filter((entry) => entry.postalCode === postalCode).length <= 3);
  }
});

test("manual dismissal is permanent and immediately makes room for a replacement", async (context) => {
  const plots = Array.from({ length: 4 }, (_, index) => ({
    id: `dismiss-candidate-${index + 1}`,
    street: "Adresse nicht öffentlich angegeben",
    houseNumber: "",
    postalCode: "14542",
    city: "Werder (Havel)",
    plotSizeSqm: 600,
    purchasePrice: 150000,
    sourceInternalId: `DISMISS-${index + 1}`,
    sourceName: "Maklerseite",
    sourceProviderName: "Makler Kontor",
    listingUrl: `https://makler.example/objekt/dismiss-${index + 1}`,
    sourceStatus: "Neu",
    sourceFirstSeenAt: `2026-07-30T06:0${index}:00.000Z`,
    createdAt: "2026-07-30T06:00:00.000Z",
    updatedAt: "2026-07-30T06:00:00.000Z",
    isActive: true,
  }));
  const item = await fixture(context, {
    loadCatalog: async () => ({ stored: true, savedAt: "2026-07-30T07:00:00.000Z", state: { ...catalogState(), plots } }),
    loadActivePostalCodes: async () => new Set(["14542"]),
  });
  const initial = await item.service.sync();
  assert.deepEqual(
    initial.items.filter((entry) => entry.status === INQUIRY_STATUS.AWAITING_APPROVAL).map((entry) => entry.plotId).sort(),
    ["dismiss-candidate-2", "dismiss-candidate-3", "dismiss-candidate-4"],
  );

  const dismissed = await item.service.dismissInquiries(["dismiss-candidate-4"]);
  const removed = dismissed.items.find((entry) => entry.plotId === "dismiss-candidate-4");
  assert.equal(removed.status, INQUIRY_STATUS.ARCHIVED);
  assert.equal(removed.archiveReason, "manual_dismissed");
  assert.deepEqual(
    dismissed.items.filter((entry) => entry.status === INQUIRY_STATUS.AWAITING_APPROVAL).map((entry) => entry.plotId).sort(),
    ["dismiss-candidate-1", "dismiss-candidate-2", "dismiss-candidate-3"],
  );

  const repeated = await item.service.sync();
  assert.equal(repeated.items.find((entry) => entry.plotId === "dismiss-candidate-4").archiveReason, "manual_dismissed");
  assert.ok(repeated.history.some((entry) => entry.event === "inquiry-dismissed" && entry.plotId === "dismiss-candidate-4"));
});

test("a sent inquiry remains traceable and cannot be manually removed", async (context) => {
  const item = await fixture(context);
  await item.service.sync();
  await item.service.approveInquiries(["plot-immo-hidden-address"]);
  const claimed = await item.service.claimDispatch("plot-immo-hidden-address");
  const dispatchAttemptId = claimed.items[0].dispatchAttemptId;
  await item.service.recordEvent({ plotId: "plot-immo-hidden-address", event: "inquiry_sent", dispatchAttemptId });
  await assert.rejects(
    item.service.dismissInquiries(["plot-immo-hidden-address"]),
    /nach dem Versand nicht mehr/u,
  );
  const status = await item.service.status();
  assert.equal(status.items[0].status, INQUIRY_STATUS.WAITING_FOR_BROKER);
});

test("approval and dispatch fail closed when the plot postal code leaves the active area", async (context) => {
  let activePostalCodes = new Set(["14542"]);
  const item = await fixture(context, {
    loadActivePostalCodes: async () => activePostalCodes,
  });
  await item.service.sync();
  activePostalCodes = new Set(["14469"]);
  await assert.rejects(
    item.service.approveInquiries(["plot-immo-hidden-address"]),
    /nicht mehr zum aktiven Suchgebiet/u,
  );

  activePostalCodes = new Set(["14542"]);
  await item.service.approveInquiries(["plot-immo-hidden-address"]);
  activePostalCodes = new Set(["14469"]);
  await assert.rejects(
    item.service.claimDispatch("plot-immo-hidden-address"),
    /nicht mehr zum aktiven Suchgebiet/u,
  );
});

test("the app approval authorizes the exact request and dispatch can only be claimed once", async (context) => {
  const item = await fixture(context);
  await item.service.sync();
  const approved = await item.service.approveInquiries(["plot-immo-hidden-address"]);
  assert.equal(approved.items[0].status, INQUIRY_STATUS.READY_TO_SEND);
  assert.match(approved.items[0].dispatchAuthorizationHash, /^[a-f0-9]{64}$/u);

  const claimed = await item.service.claimDispatch("plot-immo-hidden-address");
  assert.equal(claimed.items[0].status, INQUIRY_STATUS.DISPATCHING);
  assert.ok(claimed.items[0].dispatchAttemptId);
  assert.equal(claimed.actionable.dispatching, 1);
  await assert.rejects(
    item.service.claimDispatch("plot-immo-hidden-address"),
    /nicht zum automatischen Versand freigegeben/u,
  );
  await assert.rejects(
    item.service.recordEvent({
      plotId: "plot-immo-hidden-address",
      event: "inquiry_sent",
      dispatchAttemptId: "anderer-versuch",
    }),
    /nicht zum aktuellen Versandversuch/u,
  );
});

test("recipient changes after the final app approval are rejected", async (context) => {
  const item = await fixture(context);
  await item.service.sync();
  await item.service.approveInquiries(["plot-immo-hidden-address"]);
  await assert.rejects(
    item.service.recordEvent({
      plotId: "plot-immo-hidden-address",
      event: "recipient_identified",
      salutation: "Guten Tag Frau Mustermann,",
    }),
    /nach der Versandfreigabe nicht mehr verändert/u,
  );
});

test("an unprocessed item expires after two days and makes room for a new listing", async (context) => {
  let now = "2026-07-30T07:15:00.000Z";
  let plots = [catalogState().plots[2]];
  const item = await fixture(context, {
    now: () => now,
    loadCatalog: async () => ({ stored: true, savedAt: now, state: { ...catalogState(), plots } }),
  });
  const first = await item.service.sync();
  assert.equal(first.items[0].status, INQUIRY_STATUS.AWAITING_APPROVAL);

  now = "2026-08-01T07:15:00.000Z";
  plots = [...plots, {
    ...catalogState().plots[2],
    id: "plot-new-after-expiry",
    sourceInternalId: "IS24-NEW",
    listingUrl: "https://www.immobilienscout24.de/expose/300",
    sourceFirstSeenAt: now,
  }];
  const second = await item.service.sync();
  assert.equal(second.items.find((entry) => entry.plotId === "plot-immo-hidden-address").archiveReason, "expired_unprocessed");
  assert.equal(second.items.find((entry) => entry.plotId === "plot-new-after-expiry").status, INQUIRY_STATUS.AWAITING_APPROVAL);
});

test("search policy applies the confirmed size and BRW price corridors", () => {
  assert.deepEqual(PLOT_SEARCH_POLICY, {
    minimumSizeSqm: 350,
    maximumSizeSqm: 1400,
    minimumPricePerSqm: 30,
    maximumPricePerSqm: 1100,
    ruralBrwMultiplier: 2,
    urbanBrwMultiplier: 1.5,
  });
  assert.equal(maximumPricePerSqmForBrw(200, "rural"), 400);
  assert.equal(maximumPricePerSqmForBrw(200, "urban"), 300);
  assert.equal(maximumPricePerSqmForBrw(900, "rural"), 1100);
  assert.equal(isPlotWithinSearchPrice({ plotSizeSqm: 500, purchasePrice: 150000 }, { brw: 200, locationType: "urban" }), true);
  assert.equal(isPlotWithinSearchPrice({ plotSizeSqm: 500, purchasePrice: 175000 }, { brw: 200, locationType: "urban" }), false);
});

test("complete public addresses need no expose inquiry", () => {
  assert.equal(hasCompletePlotAddress({ street: "Mühlenstraße", houseNumber: "20", postalCode: "14532", city: "Stahnsdorf" }), true);
  assert.equal(hasCompletePlotAddress({ street: "Am Silbergraben 8B", postalCode: "14480", city: "Potsdam" }), true);
  assert.equal(hasCompletePlotAddress({ street: "Leester Straße 21 E", postalCode: "14542", city: "Werder" }), true);
  assert.equal(hasCompletePlotAddress({ street: "Adresse nicht öffentlich angegeben", postalCode: "14542", city: "Werder" }), false);
});

test("concrete KIP detail pages are eligible while portal homepages are not", () => {
  const base = {
    street: "Adresse nicht öffentlich angegeben",
    postalCode: "14822",
    city: "Borkheide",
    plotSizeSqm: 610,
    purchasePrice: 141000,
    sourceStatus: "Neu",
    isActive: true,
  };
  assert.equal(isEligibleInquiryPlot({
    ...base,
    sourceInternalId: "KIP-G1275967",
    listingUrl: "https://www.kip.net/brandenburg/potsdam-mittelmark/bauen/Grundst%C3%BCck_G1275967",
  }), true);
  assert.equal(isEligibleInquiryPlot({
    ...base,
    sourceInternalId: "IMMOBERLIN-T5721",
    listingUrl: "https://www.immoberlin.de/",
  }), false);
});

test("a named portal contact replaces the team salutation before sending", async (context) => {
  const item = await fixture(context);
  await item.service.sync();
  const updated = await item.service.recordEvent({
    plotId: "plot-immo-hidden-address",
    event: "recipient_identified",
    salutation: "Guten Tag Frau Mustermann,",
  });
  assert.match(updated.items[0].inquiryMessage, /^Guten Tag Frau Mustermann,/u);
  assert.equal(updated.items[0].recipientSalutation, "Guten Tag Frau Mustermann,");
});

test("broker contract language is routed to an explicit legal approval", async (context) => {
  const item = await fixture(context);
  await item.service.sync();
  await item.service.approveInquiries(["plot-immo-hidden-address"]);
  const claimed = await item.service.claimDispatch("plot-immo-hidden-address");
  await item.service.recordEvent({
    plotId: "plot-immo-hidden-address",
    event: "inquiry_sent",
    dispatchAttemptId: claimed.items[0].dispatchAttemptId,
  });
  const response = await item.service.recordEvent({
    plotId: "plot-immo-hidden-address",
    event: "broker_response",
    messageId: "gmail-message-1",
    summary: "Bitte bestätigen Sie Maklervertrag, Käuferprovision und sofortigen Beginn vor Ablauf des Widerrufsrechts.",
  });
  assert.equal(response.items[0].status, INQUIRY_STATUS.LEGAL_REVIEW_REQUIRED);
  assert.deepEqual(response.items[0].legalReasons, ["Maklervertrag", "Provision oder Courtage", "Widerrufsrecht", "sofortiger Leistungsbeginn"]);

  const rejected = await item.service.legalDecision("plot-immo-hidden-address", "rejected");
  assert.equal(rejected.items[0].status, INQUIRY_STATUS.BLOCKED);
});

test("legal approval before dispatch returns to the authorized send queue", async (context) => {
  const item = await fixture(context);
  await item.service.sync();
  await item.service.approveInquiries(["plot-immo-hidden-address"]);
  const claimed = await item.service.claimDispatch("plot-immo-hidden-address");
  await item.service.recordEvent({
    plotId: "plot-immo-hidden-address",
    event: "legal_review_required",
    dispatchAttemptId: claimed.items[0].dispatchAttemptId,
    summary: "Bitte bestätigen Sie Maklervertrag und Käuferprovision.",
  });
  const approved = await item.service.legalDecision("plot-immo-hidden-address", "approved");
  assert.equal(approved.items[0].status, INQUIRY_STATUS.READY_TO_SEND);
  assert.equal(approved.items[0].sentAt, "");
  assert.equal(approved.items[0].dispatchAttemptId, "");
  assert.equal(approved.actionable.toRequest, 1);
});

test("the exact ImmoScout profile visibility checkbox is permanently allowlisted only after dispatch approval", async (context) => {
  const item = await fixture(context);
  await item.service.sync();
  const approved = await item.service.approveInquiries(["plot-immo-hidden-address"]);
  const inquiry = approved.items[0];
  const decision = evaluatePortalControlFields(inquiry, [
    {
      type: "checkbox",
      name: "sendUserProfile",
      label: "Anbieter:in darf dein Profil sehen",
      checked: true,
    },
    {
      type: "checkbox",
      name: "followAnAgent",
      label: "Anbieter:in folgen für Inserate & Profi-Tipps",
      checked: false,
    },
    {
      type: "checkbox",
      name: "movingOffers",
      label: "Erhalte Angebote von Umzugsfirmen",
      checked: false,
    },
  ]);

  assert.equal(PORTAL_CONTROL_FIELD_POLICY.allowlisted.length, 1);
  assert.equal(approved.portalControlFieldPolicy.allowlisted[0].controlName, "sendUserProfile");
  assert.equal(decision.currentDispatchAuthorization, true);
  assert.equal(decision.allowlisted.length, 1);
  assert.equal(decision.allowlisted[0].mayBeEnabled, true);
  assert.equal(decision.legalReviewRequired, false);
  assert.deepEqual(decision.mustRemainDisabled.map((control) => control.name), ["followAnAgent", "movingOffers"]);
});

test("the portal allowlist fails closed for other, changed, or unauthorised controls", async (context) => {
  const item = await fixture(context);
  const synced = await item.service.sync();
  const unauthorised = evaluatePortalControlFields(synced.items[0], [{
    type: "checkbox",
    name: "sendUserProfile",
    label: "Anbieter:in darf dein Profil sehen",
    checked: true,
  }]);
  assert.equal(unauthorised.legalReviewRequired, true);

  const approved = await item.service.approveInquiries(["plot-immo-hidden-address"]);
  const changedLabel = evaluatePortalControlFields(approved.items[0], [{
    type: "checkbox",
    name: "sendUserProfile",
    label: "Anbieter:in darf dein Profil und Partnerangebote sehen",
    checked: true,
  }]);
  assert.equal(changedLabel.legalReviewRequired, true);

  const marketing = evaluatePortalControlFields(approved.items[0], [{
    type: "checkbox",
    name: "followAnAgent",
    label: "Anbieter:in folgen für Inserate & Profi-Tipps",
    checked: true,
  }]);
  assert.equal(marketing.legalReviewRequired, true);
  assert.equal(marketing.blockingControls[0].name, "followAnAgent");
});

test("applying the exact profile allowlist is persisted in workflow history", async (context) => {
  const item = await fixture(context);
  await item.service.sync();
  await item.service.approveInquiries(["plot-immo-hidden-address"]);
  const result = await item.service.recordEvent({
    plotId: "plot-immo-hidden-address",
    event: "portal_control_allowlisted",
    controlType: "checkbox",
    controlName: "sendUserProfile",
    label: "Anbieter:in darf dein Profil sehen",
    checked: true,
  });

  const event = result.history.at(-1);
  assert.equal(event.event, "portal-control-allowlisted");
  assert.equal(event.policyId, "immoscout-profile-visibility-v1");
  assert.equal(event.controlName, "sendUserProfile");
  assert.match(result.items[0].transferNote, /andere Kontrollfelder bleiben deaktiviert/u);

  await assert.rejects(item.service.recordEvent({
    plotId: "plot-immo-hidden-address",
    event: "portal_control_allowlisted",
    controlType: "checkbox",
    controlName: "followAnAgent",
    label: "Anbieter:in folgen für Inserate & Profi-Tipps",
    checked: true,
  }), /nicht durch die enge Profilfreigabe-Allowlist gedeckt/u);
});

test("legacy legal approvals are migrated out of document review before dispatch", async (context) => {
  const item = await fixture(context);
  await item.service.sync();
  await item.service.approveInquiries(["plot-immo-hidden-address"]);
  const statePath = join(item.root, "state.json");
  const legacyState = JSON.parse(await readFile(statePath, "utf8"));
  legacyState.items[0].status = INQUIRY_STATUS.READY_FOR_EXPOSE;
  legacyState.items[0].legalDecision = "approved";
  legacyState.items[0].legalDecisionAt = "2026-07-30T07:16:00.000Z";
  await writeFile(statePath, JSON.stringify(legacyState, null, 2));

  const migrated = await item.service.status();
  assert.equal(migrated.items[0].status, INQUIRY_STATUS.READY_TO_SEND);
  assert.match(migrated.items[0].transferNote, /wartet auf den Portalversand/u);
});

test("legal approval after a broker response continues with document review", async (context) => {
  const item = await fixture(context);
  await item.service.sync();
  await item.service.approveInquiries(["plot-immo-hidden-address"]);
  const claimed = await item.service.claimDispatch("plot-immo-hidden-address");
  await item.service.recordEvent({
    plotId: "plot-immo-hidden-address",
    event: "inquiry_sent",
    dispatchAttemptId: claimed.items[0].dispatchAttemptId,
  });
  await item.service.recordEvent({
    plotId: "plot-immo-hidden-address",
    event: "broker_response",
    summary: "Vor dem Exposé bestätigen Sie bitte den Maklervertrag.",
  });
  const approved = await item.service.legalDecision("plot-immo-hidden-address", "approved");
  assert.equal(approved.items[0].status, INQUIRY_STATUS.READY_FOR_EXPOSE);
  assert.ok(approved.items[0].sentAt);
  assert.equal(approved.actionable.documentReview, 1);
});

test("a validated PDF from the allowed inbox is attached to the matching plot", async (context) => {
  const item = await fixture(context);
  await item.service.sync();
  await item.service.approveInquiries(["plot-immo-hidden-address"]);
  const claimed = await item.service.claimDispatch("plot-immo-hidden-address");
  await item.service.recordEvent({
    plotId: "plot-immo-hidden-address",
    event: "inquiry_sent",
    dispatchAttemptId: claimed.items[0].dispatchAttemptId,
  });
  await item.service.recordEvent({ plotId: "plot-immo-hidden-address", event: "broker_response", summary: "Ihr Exposé finden Sie im Anhang." });
  const pdfPath = join(item.exposeInbox, "14469_Potsdam_IS24-100.pdf");
  await writeFile(pdfPath, Buffer.from("%PDF-1.7\nfixture"));

  const result = await item.service.attachExpose("plot-immo-hidden-address", pdfPath);
  assert.equal(result.items[0].status, INQUIRY_STATUS.COMPLETED);
  assert.equal(result.items[0].exposeFilename, "14469_Potsdam_IS24-100.pdf");
  assert.equal(item.savedCatalog().plots.find((plot) => plot.id === "plot-immo-hidden-address").exposeFileReference, "plot-immo-1/expose.pdf");
  assert.equal(item.savedCatalog().plots.find((plot) => plot.id === "plot-immo-hidden-address").street, "Musterstraße");
  assert.match(result.items[0].transferNote, /Grundstücksliste/u);
});

test("an expose without a complete address remains in document review", async (context) => {
  const item = await fixture(context, {
    analyzeExpose: async ({ filename }) => ({
      temporaryReference: ".pending/test.pdf",
      filename,
      pageCount: 1,
      fields: { street: "", houseNumber: "", postalCode: "14542", city: "Werder (Havel)" },
    }),
  });
  await item.service.sync();
  await item.service.approveInquiries(["plot-immo-hidden-address"]);
  const claimed = await item.service.claimDispatch("plot-immo-hidden-address");
  await item.service.recordEvent({ plotId: "plot-immo-hidden-address", event: "inquiry_sent", dispatchAttemptId: claimed.items[0].dispatchAttemptId });
  await item.service.recordEvent({ plotId: "plot-immo-hidden-address", event: "broker_response", summary: "Ihr Exposé ist angehängt." });
  const pdfPath = join(item.exposeInbox, "unvollstaendig.pdf");
  await writeFile(pdfPath, Buffer.from("%PDF-1.7\nfixture"));
  const result = await item.service.attachExpose("plot-immo-hidden-address", pdfPath);
  assert.equal(result.items[0].status, INQUIRY_STATUS.READY_FOR_EXPOSE);
  assert.match(result.items[0].transferNote, /vollständige Adresse/u);
});

test("expose fields never overwrite a conflicting saved postal code", () => {
  const result = mergeExposeFieldsIntoPlot(catalogState().plots[2], {
    street: "Musterstraße",
    houseNumber: "7",
    postalCode: "14469",
    city: "Potsdam",
  });
  assert.equal(result.readyForCatalog, false);
  assert.equal(result.appliedAddress, false);
  assert.match(result.note, /widerspricht/u);
});

test("legal classifier ignores a plain non-contractual expose delivery", () => {
  assert.deepEqual(classifyBrokerContent("Anbei erhalten Sie das Exposé als PDF."), {
    legalReviewRequired: false,
    reasons: [],
    exposeMentioned: true,
  });
});
