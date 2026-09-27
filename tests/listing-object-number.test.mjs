import assert from "node:assert/strict";
import test from "node:test";

import {
  allocateObjectNumbers,
  HV_OBJECT_NUMBER_PREFIX,
  isHvObjectNumber,
  normalizeObjectNumberSequence,
} from "../object-number-sequence.mjs";
import { objectNumberForListing } from "../listing-object-number.mjs";

test("allocates the next globally persisted 30460-N number without leading zeroes", () => {
  const state = {
    projects: [{ listings: [{ externalId: "30460-41" }] }],
    listingResetHistory: [{ listings: [{ externalId: "30460-45" }] }],
    objectNumberSequence: { format: 1, prefix: "30460", next: 42 },
  };
  const allocation = allocateObjectNumbers(state, 2);

  assert.equal(HV_OBJECT_NUMBER_PREFIX, "30460");
  assert.deepEqual(allocation.objectNumbers, ["30460-46", "30460-47"]);
  assert.equal(allocation.state.objectNumberSequence.next, 48);
  assert.equal(isHvObjectNumber("30460-1"), true);
  assert.equal(isHvObjectNumber("30460-999999"), true);
  assert.equal(isHvObjectNumber("30460-000001"), false);
  assert.equal(isHvObjectNumber("FPI-123456"), false);
});

test("never moves the persisted sequence backwards", () => {
  const state = {
    projects: [{ listings: [{ externalId: "30460-2" }] }],
    objectNumberSequence: { format: 1, prefix: "30460", next: 120 },
  };
  assert.deepEqual(normalizeObjectNumberSequence(state), { format: 1, prefix: "30460", next: 120 });
});

test("fails closed instead of retaining or generating an FPI fallback", () => {
  assert.throws(
    () => objectNumberForListing({ id: "draft", externalId: "FPI-DRAFT" }),
    { code: "EXTERNAL_OBJECT_NUMBER_REQUIRED" },
  );
  assert.equal(objectNumberForListing({ id: "current", externalId: "30460-123456" }), "30460-123456");
});
