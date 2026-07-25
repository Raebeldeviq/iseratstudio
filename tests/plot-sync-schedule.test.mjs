import assert from "node:assert/strict";
import test from "node:test";
import { nextPlotSyncAt } from "../plot-sync-schedule.mjs";

test("three-day 07:00 schedule follows Europe/Berlin daylight-saving changes", () => {
  const options = { intervalDays: 3, hour: 7, minute: 0, timeZone: "Europe/Berlin" };
  assert.equal(nextPlotSyncAt("2026-03-27", options), "2026-03-30T05:00:00.000Z");
  assert.equal(nextPlotSyncAt("2026-10-23", options), "2026-10-26T06:00:00.000Z");
});
