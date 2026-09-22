import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  commitCatalogSnapshot,
  loadCatalogImage,
  loadCatalogManifest,
  saveCatalogImage,
  startCatalogSnapshot,
} from "../catalog-store.mjs";
import {
  GLOBAL_IMAGE_ROLES,
  isGlobalImageRole,
  propagateGlobalImageRole,
} from "../global-image-role-propagation.mjs";

function image(id, role, overrides = {}) {
  return {
    id,
    name: `${id}.jpg`,
    mimeType: "image/jpeg",
    dataUrl: `data:image/jpeg;base64,${Buffer.from(id).toString("base64")}`,
    caption: `Beschriftung ${id}`,
    isFloorplan: false,
    role,
    ...overrides,
  };
}

function house(id, images) {
  return { id, name: `Haustyp ${id}`, images };
}

test("limits global propagation to the four approved image roles", () => {
  assert.deepEqual(GLOBAL_IMAGE_ROLES, ["emotion", "awards", "trust", "qr"]);
  assert.equal(isGlobalImageRole("emotion"), true);
  assert.equal(isGlobalImageRole("awards"), true);
  assert.equal(isGlobalImageRole("trust"), true);
  assert.equal(isGlobalImageRole("qr"), true);
  assert.equal(isGlobalImageRole("office"), false);
  assert.equal(isGlobalImageRole("floorplan_ground"), false);
});

test("replaces and adds a global card without touching cards of other roles", () => {
  const source = image("shared-awards", "awards", {
    sourceId: "media-awards-2026",
    captionLocked: true,
    eligibleForListingHero: false,
  });
  const houses = [
    house("source", [image("source-cover", "cover"), source, image("source-office", "office")]),
    house("existing", [image("existing-cover", "cover"), image("old-awards", "awards"), image("existing-office", "office")]),
    house("missing", [image("missing-cover", "cover"), image("missing-office", "office")]),
  ];

  const result = propagateGlobalImageRole(houses, {
    sourceHouseId: "source",
    sourceImageId: "shared-awards",
  });

  assert.equal(result.role, "awards");
  assert.equal(result.targetHouseCount, 3);
  for (const targetHouse of result.houses) {
    const awards = targetHouse.images.filter((item) => item.role === "awards");
    assert.equal(awards.length, 1);
    assert.deepEqual(awards[0], source);
    assert.deepEqual(
      targetHouse.images.filter((item) => item.role !== "awards").map((item) => item.id).sort(),
      houses.find((item) => item.id === targetHouse.id).images
        .filter((item) => item.role !== "awards")
        .map((item) => item.id)
        .sort(),
    );
  }
  assert.equal(result.houses[1].images.some((item) => item.id === "old-awards"), false);
});

test("uses the source asset reference once across every house and removes old duplicates", () => {
  const source = image("shared-trust", "trust", { sourceId: "media-trust" });
  const result = propagateGlobalImageRole([
    house("source", [image("source-cover", "cover"), source]),
    house("duplicates", [
      image("duplicate-cover", "cover"),
      image("old-trust-a", "trust"),
      image("old-trust-b", "trust"),
      image("duplicate-office", "office"),
    ]),
  ], { sourceHouseId: "source", sourceImageId: "shared-trust" });

  const appliedTrustCards = result.houses.flatMap((item) => item.images.filter((image) => image.role === "trust"));
  assert.equal(appliedTrustCards.length, 2);
  assert.deepEqual(appliedTrustCards.map((item) => item.id), ["shared-trust", "shared-trust"]);
  assert.deepEqual(appliedTrustCards.map((item) => item.sourceId), ["media-trust", "media-trust"]);
  assert.equal(result.houses[1].images.some((item) => item.id === "old-trust-a" || item.id === "old-trust-b"), false);
});

test("persists a propagated source card as one reusable catalog asset", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "global-image-propagation-catalog-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const source = image("shared-qr", "qr", { sourceId: "media-qr" });
  const propagation = propagateGlobalImageRole([
    house("source", [image("source-cover", "cover"), source]),
    house("target", [image("target-cover", "cover")]),
  ], { sourceHouseId: "source", sourceImageId: "shared-qr" });
  const state = { version: 1, houses: propagation.houses, projects: [], provider: {} };

  const session = await startCatalogSnapshot({
    state,
    savedAt: "2026-09-22T10:00:00.000Z",
    expectedSavedAt: "",
    sessionId: "global-image-propagation",
  }, directory);
  assert.equal(session.missingImageIds.filter((id) => id === "shared-qr").length, 1);
  for (const imageId of session.missingImageIds) {
    await saveCatalogImage({ sessionId: "global-image-propagation", imageId, data: Buffer.from(imageId) }, directory);
  }
  await commitCatalogSnapshot("global-image-propagation", directory);

  const manifest = await loadCatalogManifest(directory);
  assert.deepEqual(
    manifest.state.houses.map((targetHouse) => targetHouse.images.find((item) => item.role === "qr")?.id),
    ["shared-qr", "shared-qr"],
  );
  assert.equal((await loadCatalogImage("shared-qr", directory)).data.toString(), "shared-qr");
});

test("restores the fixed image-role order when applying a global card", () => {
  const source = image("shared-emotion", "emotion");
  const result = propagateGlobalImageRole([
    house("source", [image("source-qr", "qr"), source, image("source-cover", "cover")]),
    house("target", [image("target-qr", "qr"), image("target-office", "office"), image("target-cover", "cover")]),
  ], { sourceHouseId: "source", sourceImageId: "shared-emotion" });

  assert.deepEqual(result.houses[1].images.map((item) => item.role), ["cover", "office", "emotion", "qr"]);
});

test("rejects a non-global source role", () => {
  assert.throws(
    () => propagateGlobalImageRole([
      house("source", [image("office", "office")]),
      house("target", [image("target-cover", "cover")]),
    ], { sourceHouseId: "source", sourceImageId: "office" }),
    /darf nicht auf alle Haustypen angewendet/,
  );
});
