import assert from "node:assert/strict";
import test from "node:test";

import { buildOpenImmoXml } from "../app/lib/openimmo.ts";
import { completeListingTexts, generateListingTexts, totalPrice } from "../app/lib/text-generator.ts";
import { createUploadJobId } from "../batch-upload.mjs";
import { normalizeHouseDistribution } from "../house-distribution.mjs";
import {
  assignListingGroupVariant,
  createListingGroup,
  updateListingControl,
} from "../listing-groups.mjs";
import {
  CREATIVE_VARIATION_EXHAUSTED,
  planCreativeHeroSelection,
  planCreativeHouseSelection,
} from "../listing-creative-selection.mjs";
import { previewListingCreativeRotation } from "../listing-creative-preview.mjs";
import { runListingCreativePreviewCli } from "../listing-creative-preview-cli.mjs";
import { prepareListingRotationInState } from "../listing-rotation-engine.mjs";
import { createListingScheduler, updateListingSchedulerSettings } from "../listing-scheduler.mjs";
import { WORKFLOW_STATUS } from "../workflow-status.mjs";

const NOW = "2026-08-17T10:00:00.000Z";
const IMAGE_ROLES = [
  "cover", "kitchen", "bathroom", "bedroom", "kids", "living", "office", "emotion",
  "floorplan_ground", "floorplan_upper", "awards", "trust", "qr",
];

function ids(prefix) {
  let value = 0;
  return () => `${prefix}-${++value}`;
}

function house(id, index = 0) {
  return {
    id,
    name: `Haus ${id.toUpperCase()}`,
    approved: true,
    houseType: "Einfamilienhaus",
    livingArea: 120 + index,
    rooms: 4 + index,
    bedrooms: 3,
    bathrooms: 2,
    floors: 2,
    housePrice: 300_000 + index * 10_000,
    constructionYear: 2027,
    energyDemand: 18,
    energyClass: "A++",
    heatingType: "Wärmepumpe",
    energySource: "Strom",
    architecture: `Architektur ${id}`,
    equipmentHighlights: `Ausstattung ${id}`,
    useStandardPackage: true,
    images: IMAGE_ROLES.map((role, imageIndex) => ({
      id: `${id}-image-${imageIndex + 1}`,
      name: `${id}-${imageIndex + 1}.jpg`,
      caption: `${id} ${role}`,
      mimeType: "image/jpeg",
      dataUrl: "data:image/jpeg;base64,AA==",
      isFloorplan: role.startsWith("floorplan"),
      role,
    })),
  };
}

function historyCopy(id, projectId, houseId, selectedAt, heroImageId = `${houseId}-image-1`, promotionImageId = "") {
  return {
    id,
    externalId: `30460-${String(id.replace(/\D/gu, "") || 1).padStart(6, "0")}`,
    templateId: houseId,
    templateName: `Haus ${houseId.toUpperCase()}`,
    listingOrigin: "rotation-copy",
    rotationAddedHouseId: houseId,
    createdAt: selectedAt,
    promotionImageId,
    creativeSelection: {
      format: 1,
      projectId,
      houseId,
      heroImageId: promotionImageId || heroImageId,
      promotionImageId,
      selectedAt,
    },
  };
}

function selectionState(history = []) {
  return {
    houses: [house("a"), house("b", 1), house("c", 2)],
    projects: [{ id: "project-1", plotId: "plot-1", listings: history }],
    houseDistribution: { houseUsage: [] },
  };
}

function fullState() {
  const houses = [house("a"), house("b", 1), house("c", 2), house("d", 3), house("e", 4)];
  const project = {
    id: "project-1",
    plotId: "plot-1",
    isActive: true,
    owner: "fabian",
    name: "Testadresse",
    street: "Musterstraße",
    houseNumber: "1",
    zip: "14542",
    city: "Werder",
    district: "",
    plotArea: 600,
    plotPrice: 100_000,
    additionalCosts: 20_000,
    locationFacts: "Ruhige Lage",
    transportFacts: "Gute Anbindung",
    familyFacts: "Familienfreundlich",
    natureFacts: "Naturnah",
    selectedHouseIds: houses.slice(0, 4).map((item) => item.id),
    listings: [],
    createdAt: "2026-07-01T08:00:00.000Z",
  };
  const idFactory = ids("group");
  let group = createListingGroup(project.id, { idFactory, now: project.createdAt });
  for (let index = 0; index < 4; index += 1) {
    const houseValue = houses[index];
    const listing = {
      id: `source-${index + 1}`,
      externalId: `30460-${String(index + 1).padStart(6, "0")}`,
      templateId: houseValue.id,
      templateName: houseValue.name,
      price: totalPrice(houseValue, project),
      version: 1,
      createdAt: project.createdAt,
      lastUploadedAt: project.createdAt,
      status: WORKFLOW_STATUS.PUBLISHED,
      statusMessage: "Veröffentlicht",
      listingOrigin: "group-source",
      texts: {
        title: `Titel ${houseValue.id}`,
        description: `Beschreibung ${houseValue.id}`,
        equipment: "Ausstattung",
        location: "Lage",
        other: "Sonstiges",
      },
    };
    group = assignListingGroupVariant(group, group.variants[index].id, houseValue, listing, {
      idFactory,
      now: project.createdAt,
    });
    const assigned = group.variants[index].listing;
    group = updateListingControl(group, assigned, {
      automaticUpdateEnabled: true,
      status: WORKFLOW_STATUS.PUBLISHED,
      lastSuccessAt: project.createdAt,
      lastUpdatedAt: project.createdAt,
    }, { idFactory, now: project.createdAt });
  }
  project.listings = group.variants.map((variant) => variant.listing);
  project.listingGroup = group;
  let scheduler = createListingScheduler({ now: project.createdAt });
  scheduler = updateListingSchedulerSettings(scheduler, {
    enabled: true,
    paused: false,
    mode: "full-auto",
    maxUpdatesPerDay: 20,
    maxUpdatesPerAddressPerDay: 4,
    initialWaitDays: 12,
    updateIntervalDays: 12,
    allowedWeekdays: [0, 1, 2, 3, 4, 5, 6],
  }, { now: project.createdAt });
  const state = {
    version: 1,
    houses,
    projects: [project],
    provider: {
      providerNumber: "30460",
      company: "Test GmbH",
      firstName: "Test",
      lastName: "Person",
      email: "test@example.invalid",
      phone: "0000",
    },
    promotionImages: [],
    promotionSettings: { enabled: false, automaticRotation: true },
    promotionUsage: [],
    scheduler,
    uploadHistory: [],
  };
  state.houseDistribution = normalizeHouseDistribution({}, houses, [project]);
  return state;
}

test("house selection avoids the current house and prefers a never-used third house", () => {
  const noHistory = planCreativeHouseSelection(selectionState(), {
    projectId: "project-1",
    sourceHouseId: "a",
    candidateHouseIds: ["a", "b"],
  });
  assert.equal(noHistory.houseId, "b");

  const state = selectionState([
    historyCopy("copy-1", "project-1", "a", "2026-08-15T10:00:00.000Z"),
    historyCopy("copy-2", "project-1", "b", "2026-08-16T10:00:00.000Z"),
  ]);
  const result = planCreativeHouseSelection(state, {
    projectId: "project-1",
    sourceHouseId: "a",
    candidateHouseIds: ["a", "b", "c"],
  });
  assert.equal(result.houseId, "c");
});

test("single-house fallback stays productive and emits the exhaustion diagnostic", () => {
  const result = planCreativeHouseSelection(selectionState(), {
    projectId: "project-1",
    sourceHouseId: "a",
    candidateHouseIds: ["a"],
  });
  assert.equal(result.ok, true);
  assert.equal(result.houseId, "a");
  assert.deepEqual(result.diagnostics, [CREATIVE_VARIATION_EXHAUSTED]);
});

test("global history prevents an unnecessary same-house series across plots", () => {
  const state = selectionState([historyCopy("copy-1", "project-1", "b", "2026-08-16T10:00:00.000Z")]);
  state.projects.push({ id: "project-2", plotId: "plot-2", listings: [] });
  const result = planCreativeHouseSelection(state, {
    projectId: "project-2",
    sourceHouseId: "a",
    candidateHouseIds: ["b", "c"],
  });
  assert.equal(result.houseId, "c");
});

test("action heroes are used in the bounded cadence and unapproved assets are never selected", () => {
  const state = selectionState([
    historyCopy("copy-1", "project-1", "a", "2026-08-14T10:00:00.000Z"),
    historyCopy("copy-2", "project-1", "b", "2026-08-15T10:00:00.000Z"),
    historyCopy("copy-3", "project-1", "c", "2026-08-16T10:00:00.000Z"),
  ]);
  state.promotionImages = [{
    id: "promo-approved",
    name: "aktion.jpg",
    mimeType: "image/jpeg",
    active: true,
    role: "promotion",
    isFloorplan: false,
  }];
  state.promotionSettings = { enabled: true, automaticRotation: true };
  const action = planCreativeHeroSelection(state, { projectId: "project-1", house: state.houses[0] });
  assert.equal(action.heroType, "action");
  assert.equal(action.heroImageId, "promo-approved");

  state.promotionImages[0].eligibleForListingHero = false;
  const unapproved = planCreativeHeroSelection(state, { projectId: "project-1", house: state.houses[0] });
  assert.equal(unapproved.heroType, "house");
  assert.notEqual(unapproved.heroImageId, "promo-approved");
});

test("standard hero fallback and LRU alternate selection remain deterministic after restart", () => {
  const state = selectionState();
  const standard = planCreativeHeroSelection(state, { projectId: "project-1", house: state.houses[0] });
  assert.equal(standard.heroType, "house");
  assert.equal(standard.heroImageId, "a-image-1");

  state.houses[0].images[1].eligibleForListingHero = true;
  state.projects[0].listings.push(historyCopy(
    "copy-1",
    "project-1",
    "a",
    "2026-08-16T10:00:00.000Z",
    "a-image-1",
  ));
  const alternate = planCreativeHeroSelection(state, { projectId: "project-1", house: state.houses[0] });
  assert.equal(alternate.heroImageId, "a-image-2");
  const restarted = planCreativeHeroSelection(structuredClone(state), { projectId: "project-1", house: state.houses[0] });
  assert.equal(restarted.heroImageId, alternate.heroImageId);

  const exportState = fullState();
  const exportHouse = exportState.houses[0];
  exportHouse.images[1].eligibleForListingHero = true;
  const exportListing = exportState.projects[0].listings[0];
  const xml = buildOpenImmoXml({
    project: exportState.projects[0],
    listings: [exportListing],
    houses: [exportHouse],
    provider: exportState.provider,
    heroImageIdsByListingId: { [exportListing.id]: exportHouse.images[1].id },
  });
  assert.ok(xml.indexOf(exportHouse.images[1].caption) < xml.indexOf(exportHouse.images[0].caption));
});

test("unknown detail images never become an implicit hero", () => {
  const houseWithoutApproval = house("unknown");
  houseWithoutApproval.images = houseWithoutApproval.images.map((image) => ({
    ...image,
    role: image.role === "cover" ? "other" : image.role,
  }));
  const result = planCreativeHeroSelection(selectionState(), {
    projectId: "project-1",
    house: houseWithoutApproval,
  });
  assert.equal(result.ok, false);
  assert.equal(result.heroImageId, "");
});

test("prepared copy persists one coherent house, text, price, image and OpenImmo payload", () => {
  const state = fullState();
  const project = state.projects[0];
  const source = project.listings[0];
  const result = prepareListingRotationInState(state, project.id, source.id, {
    now: NOW,
    copyId: "copy-persisted",
    operationToken: "operation-1",
    uploadJobIdFor: createUploadJobId,
  });
  assert.equal(result.ok, true);
  const copy = result.copy;
  const selectedHouse = state.houses.find((item) => item.id === copy.templateId);
  assert.equal(copy.templateId, "e");
  assert.equal(copy.templateName, selectedHouse.name);
  assert.equal(copy.price, totalPrice(selectedHouse, project));
  assert.equal(selectedHouse.images.some((image) => image.id === copy.heroImageId), true);
  const variedTexts = generateListingTexts(selectedHouse, project, state.provider, copy.version);
  assert.deepEqual(copy.texts, completeListingTexts(
    selectedHouse,
    project,
    state.provider,
    { ...source.texts, title: variedTexts.title, description: variedTexts.description },
    copy.version,
  ));
  assert.match(copy.texts.equipment, /Endenergiebedarf von 18 kWh\/\(m²·a\) vorgesehen/u);
  assert.match(copy.texts.equipment, /DGNB-Serienzertifizierung/u);
  assert.doesNotMatch(copy.texts.equipment, /QNG/u);
  assert.equal(copy.creativeSelection.houseId, copy.templateId);
  assert.equal(copy.creativeSelection.houseName, copy.templateName);
  assert.equal(copy.creativeSelection.heroAssetId, copy.creativeSelection.heroImageId);
  assert.equal(createUploadJobId(project, copy).endsWith(":normal"), true);

  const xml = buildOpenImmoXml({
    project,
    listings: [copy],
    houses: [selectedHouse],
    provider: state.provider,
    promotionImageEnabled: false,
    promotionImagesByListingId: {},
  });
  assert.match(xml, new RegExp(`<kaufpreis>${copy.price}<\\/kaufpreis>`));
  assert.match(xml, new RegExp(`<wohnflaeche>${selectedHouse.livingArea}<\\/wohnflaeche>`));
  assert.match(xml, new RegExp(`<anzahl_zimmer>${selectedHouse.rooms}<\\/anzahl_zimmer>`));
  assert.match(xml, /feldname="Projektierter Endenergiebedarf"/u);
  assert.ok(xml.includes(selectedHouse.images[0].caption));

  const restartCopy = structuredClone(result.state).projects[0].listings.find((item) => item.id === copy.id);
  assert.deepEqual(restartCopy.creativeSelection, copy.creativeSelection);
  assert.equal(restartCopy.templateId, copy.templateId);
  assert.equal(restartCopy.heroImageId, copy.heroImageId);
});

test("persisted action hero participates in the deterministic upload job and OpenImmo package", () => {
  const state = fullState();
  state.projects[0].listings.push(
    { ...historyCopy("history-1", "project-1", "a", "2026-08-14T10:00:00.000Z"), rotationArchivedAt: NOW },
    { ...historyCopy("history-2", "project-1", "b", "2026-08-15T10:00:00.000Z"), rotationArchivedAt: NOW },
    { ...historyCopy("history-3", "project-1", "c", "2026-08-16T10:00:00.000Z"), rotationArchivedAt: NOW },
  );
  const promotion = {
    id: "promo-approved",
    name: "aktion.jpg",
    caption: "Freigegebene Aktion",
    mimeType: "image/jpeg",
    dataUrl: "data:image/jpeg;base64,AA==",
    isFloorplan: false,
    role: "promotion",
    active: true,
  };
  state.promotionImages = [promotion];
  state.promotionSettings = { enabled: true, automaticRotation: true };
  const project = state.projects[0];
  const source = project.listings.find((item) => item.id === "source-1");
  const result = prepareListingRotationInState(state, project.id, source.id, {
    now: NOW,
    copyId: "copy-with-action",
    operationToken: "operation-action",
    uploadJobIdFor: createUploadJobId,
  });
  assert.equal(result.ok, true);
  assert.equal(result.copy.heroCreativeType, "action");
  assert.equal(result.copy.promotionImageId, promotion.id);
  assert.equal(createUploadJobId(project, result.copy).endsWith(`:${promotion.id}`), true);
  const selectedHouse = state.houses.find((item) => item.id === result.copy.templateId);
  const xml = buildOpenImmoXml({
    project,
    listings: [result.copy],
    houses: [selectedHouse],
    provider: state.provider,
    promotionImageEnabled: false,
    promotionImagesByListingId: { [result.copy.id]: promotion },
  });
  assert.ok(xml.indexOf(promotion.caption) < xml.indexOf(selectedHouse.images[0].caption));
});

test("read-only preview simulates multiple selections without mutating the catalog", () => {
  const state = fullState();
  const before = structuredClone(state);
  const preview = previewListingCreativeRotation(state, { limit: 10, at: NOW });
  assert.equal(preview.readOnly, true);
  assert.ok(preview.previewCount > 0);
  assert.ok(preview.items.every((item) => item.currentHouseId && item.proposedHouseId && item.heroImageId));
  assert.deepEqual(state, before);
});

test("preview CLI loads once and has no catalog mutation path", async () => {
  const state = fullState();
  let loads = 0;
  const result = await runListingCreativePreviewCli(["preview", "--limit", "10", "--at", NOW], {
    store: {
      async load() {
        loads += 1;
        return { stored: true, state: structuredClone(state), savedAt: "memory-1" };
      },
      async update() {
        throw new Error("Preview darf update niemals aufrufen.");
      },
    },
  });
  assert.equal(loads, 1);
  assert.equal(result.readOnly, true);
  assert.ok(result.previewCount > 0);
});
