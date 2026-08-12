import assert from "node:assert/strict";
import test from "node:test";

import {
  createHvObjectNumber,
  HV_OBJECT_NUMBER_PREFIX,
  isHvObjectNumber,
  objectNumberForListing,
} from "../listing-object-number.mjs";

test("creates deterministic object numbers in the 30460-XXXXXX format", () => {
  const first = createHvObjectNumber("listing-1");
  const repeated = createHvObjectNumber("listing-1");

  assert.equal(HV_OBJECT_NUMBER_PREFIX, "30460");
  assert.match(first, /^30460-\d{6}$/u);
  assert.equal(repeated, first);
  assert.equal(isHvObjectNumber(first), true);
  assert.equal(isHvObjectNumber("30460-12345"), false);
  assert.equal(isHvObjectNumber("FPI-123456"), false);
});

test("avoids duplicate object numbers inside one allocation run", () => {
  const reserved = new Set();
  const first = createHvObjectNumber("same-seed", reserved);
  const second = createHvObjectNumber("same-seed", reserved);

  assert.notEqual(second, first);
  assert.equal(reserved.has(first), true);
  assert.equal(reserved.has(second), true);
});

test("renumbers drafts but preserves correct and confirmed existing identifiers", () => {
  assert.match(
    objectNumberForListing({ id: "draft", externalId: "FPI-DRAFT" }, "draft"),
    /^30460-\d{6}$/u,
  );
  assert.equal(
    objectNumberForListing({ id: "current", externalId: "30460-123456" }, "current"),
    "30460-123456",
  );
  assert.equal(
    objectNumberForListing({
      id: "uploaded",
      externalId: "FPI-LEGACY-UPLOADED",
      lastUploadedAt: "2026-07-27T12:00:00.000Z",
    }, "uploaded"),
    "FPI-LEGACY-UPLOADED",
  );
});
