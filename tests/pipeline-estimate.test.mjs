import assert from "node:assert/strict";
import test from "node:test";

const {
  CONSERVATIVE_PIPELINE_FALLBACKS,
  estimatePipelineRemainingMs,
  estimateProductionPipeline,
  formatRemainingTime,
  formatUsdCost,
  normalizePipelineModel,
  normalizeStoredTokenUsage,
  PIPELINE_CONCURRENCY,
  PIPELINE_ESTIMATE_STATUS_LABELS,
  PIPELINE_MINIMUM_RELIABLE_SAMPLES,
  PIPELINE_MODEL_PRICES_USD_PER_MILLION,
  PIPELINE_PRICE_SNAPSHOT_DATE,
  summarizeStoredTokenCost,
  tokenUsageCostUsd,
} = await import("../app/lib/pipeline-estimate.ts");

test("contains the official standard GPT-5.6 model prices", () => {
  assert.deepEqual(PIPELINE_MODEL_PRICES_USD_PER_MILLION, {
    "gpt-5.6-luna": { input: 1, output: 6 },
    "gpt-5.6-terra": { input: 2.5, output: 15 },
    "gpt-5.6-sol": { input: 5, output: 30 },
  });
  assert.deepEqual(PIPELINE_CONCURRENCY, {
    generation: 2,
    upload: 1,
  });
  assert.equal(PIPELINE_MINIMUM_RELIABLE_SAMPLES, 3);
  assert.equal(PIPELINE_PRICE_SNAPSHOT_DATE, "2026-07-24");
});

test("normalizes stored token usage from camelCase and API-style fields", () => {
  assert.deepEqual(
    normalizeStoredTokenUsage({
      model: " GPT-5.6-LUNA ",
      input_tokens: 1_200,
      output_tokens: 800,
      requestCount: 1,
      generationDurationMs: 42_000,
    }),
    {
      model: "gpt-5.6-luna",
      inputTokens: 1_200,
      outputTokens: 800,
      requestCount: 1,
      durationMs: 42_000,
    },
  );
  assert.deepEqual(
    normalizeStoredTokenUsage({
      prompt_tokens: "900",
      completion_tokens: 300,
    }),
    {
      inputTokens: 900,
      outputTokens: 300,
      requestCount: 0,
    },
  );
  assert.equal(normalizeStoredTokenUsage({ input_tokens: -1 }), null);
  assert.equal(normalizePipelineModel("gpt-5.6-unknown"), null);
});

test("calculates actual costs from stored input and output tokens", () => {
  assert.equal(
    tokenUsageCostUsd("gpt-5.6-luna", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    }),
    7,
  );
  assert.equal(
    tokenUsageCostUsd("gpt-5.6-terra", {
      input_tokens: 2_000,
      output_tokens: 1_000,
    }),
    0.02,
  );
  assert.equal(
    tokenUsageCostUsd("gpt-5.6-sol", {
      inputTokens: 3_000,
      outputTokens: 2_000,
    }),
    0.075,
  );
  assert.equal(
    tokenUsageCostUsd("not-a-model", {
      inputTokens: 3_000,
      outputTokens: 2_000,
    }),
    null,
  );
});

test("summarizes mixed stored usage without hiding unpriced records", () => {
  const summary = summarizeStoredTokenCost([
    {
      model: "gpt-5.6-luna",
      inputTokens: 1_000,
      outputTokens: 500,
    },
    {
      input_tokens: 3_000,
      output_tokens: 1_500,
    },
    {
      model: "unknown-model",
      inputTokens: 500,
      outputTokens: 200,
    },
  ], "gpt-5.6-luna");

  assert.equal(summary.status, "partial");
  assert.equal(summary.knownCostUsd, 0.016);
  assert.equal(summary.totalCostUsd, null);
  assert.equal(summary.pricedUsageCount, 2);
  assert.equal(summary.unpricedUsageCount, 1);
  assert.equal(summary.inputTokens, 4_500);
  assert.equal(summary.outputTokens, 2_200);
});

test("models two parallel generations and one strictly sequential upload", () => {
  assert.equal(
    estimatePipelineRemainingMs({
      remainingGenerations: 4,
      remainingUploads: 4,
      generationDurationMs: 60_000,
      uploadDurationMs: 30_000,
    }),
    180_000,
  );
  assert.equal(
    estimatePipelineRemainingMs({
      remainingGenerations: 4,
      remainingUploads: 4,
      generationDurationMs: 100_000,
      uploadDurationMs: 20_000,
    }),
    240_000,
  );
  assert.equal(
    estimatePipelineRemainingMs({
      remainingGenerations: 2,
      remainingUploads: 4,
      generationDurationMs: 60_000,
      uploadDurationMs: 30_000,
    }),
    120_000,
    "two already generated listings keep the serial uploader busy immediately",
  );
  assert.equal(
    estimatePipelineRemainingMs({
      remainingGenerations: 0,
      remainingUploads: 4,
      uploadDurationMs: 30_000,
    }),
    120_000,
  );
});

test("uses current run averages for remaining cost and time", () => {
  const estimate = estimateProductionPipeline({
    model: "gpt-5.6-luna",
    tokenUsage: [
      {
        inputTokens: 1_000,
        outputTokens: 500,
        requestCount: 1,
        durationMs: 40_000,
      },
      {
        inputTokens: 3_000,
        outputTokens: 1_500,
        requestCount: 1,
        durationMs: 60_000,
      },
      {
        inputTokens: 2_000,
        outputTokens: 1_000,
        requestCount: 1,
        durationMs: 50_000,
      },
    ],
    uploadDurationsMs: [20_000, 30_000, 25_000],
    remainingGenerations: 3,
    remainingUploads: 4,
  });

  assert.equal(estimate.status, "measured");
  assert.equal(estimate.averages.inputTokensPerGeneration, 2_000);
  assert.equal(estimate.averages.outputTokensPerGeneration, 1_000);
  assert.equal(estimate.averages.generationDurationMs, 50_000);
  assert.equal(estimate.averages.uploadDurationMs, 25_000);
  assert.equal(estimate.cost.completedUsd, 0.024);
  assert.equal(estimate.cost.remainingUsd, 0.024);
  assert.equal(estimate.cost.projectedTotalUsd, 0.048);
  assert.equal(estimate.time.remainingMs, 125_000);
  assert.equal(estimate.time.formattedRemaining, "ca. 3 Min.");
});

test("uses conservative fallbacks when the current run has no samples", () => {
  const estimate = estimateProductionPipeline({
    model: "gpt-5.6-luna",
    remainingGenerations: 3,
    remainingUploads: 3,
  });

  assert.equal(estimate.status, "estimated");
  assert.equal(estimate.averages.tokenSource, "fallback");
  assert.equal(
    estimate.averages.inputTokensPerGeneration,
    CONSERVATIVE_PIPELINE_FALLBACKS.inputTokensPerGeneration,
  );
  assert.equal(
    estimate.averages.outputTokensPerGeneration,
    CONSERVATIVE_PIPELINE_FALLBACKS.outputTokensPerGeneration,
  );
  assert.equal(estimate.cost.remainingUsd, 0.09);
  assert.equal(estimate.time.remainingMs, 150_000);
});

test("does not treat zero-token API errors as predictive cost samples", () => {
  const estimate = estimateProductionPipeline({
    model: "gpt-5.6-luna",
    tokenUsage: [1, 2, 3].map(() => ({
      inputTokens: 0,
      outputTokens: 0,
      requestCount: 1,
    })),
    remainingGenerations: 2,
    remainingUploads: 2,
  });

  assert.equal(estimate.averages.tokenSource, "fallback");
  assert.equal(estimate.cost.remainingUsd, 0.06);
});

test("adds address batches and credits elapsed active work", () => {
  const estimate = estimateProductionPipeline({
    model: "gpt-5.6-luna",
    remainingGenerations: 8,
    remainingUploads: 8,
    batches: [
      { remainingGenerations: 4, remainingUploads: 4 },
      { remainingGenerations: 4, remainingUploads: 4 },
    ],
    activeGenerationElapsedMs: 20_000,
    activeUploadElapsedMs: 10_000,
  });

  assert.equal(estimate.time.remainingMs, 340_000);
});

test("returns stable complete and unavailable statuses for edge cases", () => {
  const complete = estimateProductionPipeline({
    model: "invalid",
    remainingGenerations: 0,
    remainingUploads: 0,
  });
  assert.equal(complete.status, "complete");
  assert.equal(complete.cost.status, "complete");
  assert.equal(complete.cost.remainingUsd, 0);
  assert.equal(complete.time.remainingMs, 0);
  assert.equal(complete.time.formattedRemaining, "Fertig");

  const invalid = estimateProductionPipeline({
    model: "invalid",
    remainingGenerations: 2.9,
    remainingUploads: -4,
  });
  assert.equal(invalid.status, "partial");
  assert.equal(invalid.remaining.generations, 2);
  assert.equal(invalid.remaining.uploads, 0);
  assert.equal(invalid.cost.status, "unavailable");
  assert.equal(invalid.cost.remainingUsd, null);
  assert.equal(invalid.cost.formattedRemaining, "–");
  assert.ok(Number.isFinite(invalid.time.remainingMs));
});

test("formats cost, time and status labels for the German interface", () => {
  assert.equal(formatUsdCost(0), "0,00 $");
  assert.equal(formatUsdCost(0.004), "< 0,01 $");
  assert.equal(formatUsdCost(12.5), "12,50 $");
  assert.equal(formatUsdCost(Number.NaN), "–");
  assert.equal(formatRemainingTime(1), "ca. 1 Min.");
  assert.equal(formatRemainingTime(60 * 60_000), "ca. 1 Std.");
  assert.equal(
    formatRemainingTime(70 * 60_000),
    "ca. 1 Std. 10 Min.",
  );
  assert.equal(PIPELINE_ESTIMATE_STATUS_LABELS.measured, "Aus Laufdaten");
  assert.equal(
    PIPELINE_ESTIMATE_STATUS_LABELS.estimated,
    "Konservative Schätzung",
  );
});
