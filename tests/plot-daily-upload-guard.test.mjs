import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  berlinCalendarDay,
  collectPlotUploadEvidence,
  createPlotDailyUploadGuard,
  PLOT_DAILY_UPLOAD_LIMIT_CODE,
  PLOT_DAILY_UPLOAD_STATUS,
  plotUploadDayKey,
} from "../plot-daily-upload-guard.mjs";
import { WORKFLOW_STATUS } from "../workflow-status.mjs";

const DAY = "2026-08-13T10:00:00.000Z";
const TOMORROW = "2026-08-14T10:00:00.000Z";

function input(plotId, suffix = plotId) {
  return {
    plotId,
    projectId: `project-${plotId}`,
    listingId: `listing-${suffix}`,
    jobId: `job:${suffix}`,
  };
}

async function runtime(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "plot-daily-upload-guard-"));
  const path = join(directory, "guard.json");
  return {
    directory,
    path,
    guard: createPlotDailyUploadGuard(path, options),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

async function transfer(guard, value, at = DAY) {
  const claim = await guard.claim(value, { now: at });
  const context = { ...value, claimToken: claim.record.claimToken };
  await guard.markTransferStarted(context, at);
  return guard.complete(context, at);
}

test("1 first house on plot A is allowed and 2 second house on plot A is blocked", async () => {
  const active = await runtime();
  try {
    await transfer(active.guard, input("plot-a", "one"));
    await assert.rejects(
      active.guard.claim(input("plot-a", "two"), { now: DAY }),
      { code: PLOT_DAILY_UPLOAD_LIMIT_CODE },
    );
  } finally {
    await active.cleanup();
  }
});

test("3 another plot on the same day is allowed", async () => {
  const active = await runtime();
  try {
    await transfer(active.guard, input("plot-a"));
    const claim = await active.guard.claim(input("plot-b"), { now: DAY });
    assert.equal(claim.claimed, true);
  } finally {
    await active.cleanup();
  }
});

test("4 same plot on the following Berlin day is allowed", async () => {
  const active = await runtime();
  try {
    await transfer(active.guard, input("plot-a"), DAY);
    const claim = await active.guard.claim(input("plot-a", "tomorrow"), { now: TOMORROW });
    assert.equal(claim.claimed, true);
  } finally {
    await active.cleanup();
  }
});

test("5 Europe/Berlin day boundary handles daylight-saving offset", () => {
  assert.equal(berlinCalendarDay("2026-08-13T21:59:59.999Z"), "2026-08-13");
  assert.equal(berlinCalendarDay("2026-08-13T22:00:00.000Z"), "2026-08-14");
  assert.equal(berlinCalendarDay("2026-12-31T22:59:59.999Z"), "2026-12-31");
  assert.equal(berlinCalendarDay("2026-12-31T23:00:00.000Z"), "2027-01-01");
});

test("6 helper restart retains a transferred plot claim", async () => {
  const active = await runtime();
  try {
    await transfer(active.guard, input("plot-a"));
    const restarted = createPlotDailyUploadGuard(active.path);
    await assert.rejects(restarted.claim(input("plot-a", "restart"), { now: DAY }), { code: PLOT_DAILY_UPLOAD_LIMIT_CODE });
  } finally {
    await active.cleanup();
  }
});

test("7 scheduler restart retains a transferred plot claim and same job is idempotent", async () => {
  const active = await runtime();
  try {
    const original = input("plot-a", "scheduler");
    await transfer(active.guard, original);
    const restarted = createPlotDailyUploadGuard(active.path);
    const result = await restarted.claim(original, { now: DAY });
    assert.equal(result.alreadyCompleted, true);
  } finally {
    await active.cleanup();
  }
});

test("8 manual studio upload consumes the plot day", async () => {
  const active = await runtime();
  try {
    await transfer(active.guard, { ...input("plot-a", "manual"), jobType: "immoprofessional-upload" });
    await assert.rejects(active.guard.claim(input("plot-a", "scheduler"), { now: DAY }), { code: PLOT_DAILY_UPLOAD_LIMIT_CODE });
  } finally {
    await active.cleanup();
  }
});

test("9 canary upload consumes the plot day", async () => {
  const active = await runtime();
  try {
    await transfer(active.guard, { ...input("plot-a", "canary"), jobType: "live-canary" });
    const inspected = await active.guard.inspect({ plotId: "plot-a" }, { now: DAY });
    assert.equal(inspected.consumed, true);
    assert.equal(inspected.record.status, PLOT_DAILY_UPLOAD_STATUS.TRANSFERRED);
  } finally {
    await active.cleanup();
  }
});

test("10 transferred but import-pending evidence blocks another upload", async () => {
  const active = await runtime();
  try {
    const state = {
      projects: [{ id: "project-a", plotId: "plot-a", listings: [{ id: "copy", externalId: "30460-1" }] }],
      uploadHistory: [{ projectId: "project-a", listingId: "copy", status: WORKFLOW_STATUS.TRANSFERRED_PENDING_IMPORT, updatedAt: DAY, jobId: "upload:one" }],
    };
    const evidence = collectPlotUploadEvidence(state, { jobs: [] }, DAY);
    await assert.rejects(active.guard.claim(input("plot-a", "two"), { now: DAY, evidence }), { code: PLOT_DAILY_UPLOAD_LIMIT_CODE });
  } finally {
    await active.cleanup();
  }
});

test("11 locally prepared and definitely untransferred does not permanently consume the day", async () => {
  const active = await runtime();
  try {
    const first = input("plot-a", "prepared");
    const claim = await active.guard.claim(first, { now: DAY });
    await active.guard.fail({ ...first, claimToken: claim.record.claimToken, reason: "definitely-before-transfer" }, DAY);
    const second = await active.guard.claim(input("plot-a", "real"), { now: DAY });
    assert.equal(second.claimed, true);
  } finally {
    await active.cleanup();
  }
});

test("12 uncertain transfer state blocks fail-closed", async () => {
  const active = await runtime();
  try {
    const first = input("plot-a", "uncertain");
    const claim = await active.guard.claim(first, { now: DAY });
    const context = { ...first, claimToken: claim.record.claimToken };
    await active.guard.markTransferStarted(context, DAY);
    const failed = await active.guard.fail({ ...context, reason: "connection-lost" }, DAY);
    assert.equal(failed.status, PLOT_DAILY_UPLOAD_STATUS.UNCERTAIN);
    await assert.rejects(active.guard.claim(input("plot-a", "retry"), { now: DAY }), { code: PLOT_DAILY_UPLOAD_LIMIT_CODE });
  } finally {
    await active.cleanup();
  }
});

test("13 three listings on three plots are independently allowed", async () => {
  const active = await runtime();
  try {
    for (const plotId of ["plot-a", "plot-b", "plot-c"]) await transfer(active.guard, input(plotId), DAY);
    const ledger = await active.guard.read();
    assert.equal(ledger.records.filter((record) => record.status === PLOT_DAILY_UPLOAD_STATUS.TRANSFERRED).length, 3);
  } finally {
    await active.cleanup();
  }
});

test("14 three listings with two on the same plot allow only one per plot", async () => {
  const active = await runtime();
  try {
    await transfer(active.guard, input("plot-a", "one"), DAY);
    await transfer(active.guard, input("plot-b", "two"), DAY);
    await assert.rejects(active.guard.claim(input("plot-a", "three"), { now: DAY }), { code: PLOT_DAILY_UPLOAD_LIMIT_CODE });
  } finally {
    await active.cleanup();
  }
});

test("corrupt guard configuration blocks fail-closed", async () => {
  const active = await runtime();
  try {
    await import("node:fs/promises").then(({ writeFile }) => writeFile(active.path, "{broken", "utf8"));
    await assert.rejects(active.guard.claim(input("plot-a"), { now: DAY }), { code: "PLOT_DAILY_UPLOAD_GUARD_CORRUPT" });
  } finally {
    await active.cleanup();
  }
});

test("persisted records use the stable plotId plus Berlin day key without secrets", async () => {
  const active = await runtime();
  try {
    await transfer(active.guard, input("plot-a"), DAY);
    const raw = await readFile(active.path, "utf8");
    assert.equal(JSON.parse(raw).records[0].key, plotUploadDayKey("plot-a", DAY));
    assert.equal(raw.includes("password"), false);
  } finally {
    await active.cleanup();
  }
});

test("historical 13.08 transfer remains immutable while one 14.08 transfer gets a distinct daily key", async () => {
  const active = await runtime();
  try {
    const plotId = "plot-sync-1ykz0tc";
    const historical = input(plotId, "30460-578535");
    await transfer(active.guard, historical, "2026-08-13T18:33:31.656Z");
    const historicalSnapshot = structuredClone(await active.guard.read());

    const today = await active.guard.inspect({ plotId }, { now: "2026-08-14T07:00:00.000Z" });
    assert.equal(today.consumed, false);
    await transfer(active.guard, input(plotId, "future-canary"), "2026-08-14T07:00:00.000Z");

    const ledger = await active.guard.read();
    assert.deepEqual(ledger.records.find((record) => record.key === `${plotId}:2026-08-13`), historicalSnapshot.records[0]);
    assert.equal(ledger.records.filter((record) => record.key === `${plotId}:2026-08-14`).length, 1);
  } finally {
    await active.cleanup();
  }
});
