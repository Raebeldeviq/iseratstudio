// Standard API token prices published by OpenAI, captured on 2026-07-24.
// https://developers.openai.com/api/docs/models
export const PIPELINE_MODEL_PRICES_USD_PER_MILLION = {
  "gpt-5.6-luna": {
    input: 1,
    output: 6,
  },
  "gpt-5.6-terra": {
    input: 2.5,
    output: 15,
  },
  "gpt-5.6-sol": {
    input: 5,
    output: 30,
  },
} as const;

export const PIPELINE_PRICE_SNAPSHOT_DATE = "2026-07-24";
export const PIPELINE_MINIMUM_RELIABLE_SAMPLES = 3;

export type PipelineModel = keyof typeof PIPELINE_MODEL_PRICES_USD_PER_MILLION;

export const PIPELINE_CONCURRENCY = {
  generation: 2,
  upload: 1,
} as const;

export const CONSERVATIVE_PIPELINE_FALLBACKS = {
  inputTokensPerGeneration: 6_000,
  outputTokensPerGeneration: 4_000,
  generationDurationMs: 60_000,
  uploadDurationMs: 30_000,
} as const;

export type PipelineEstimateStatus =
  | "complete"
  | "measured"
  | "estimated"
  | "partial"
  | "unavailable";

export const PIPELINE_ESTIMATE_STATUS_LABELS: Record<
  PipelineEstimateStatus,
  string
> = {
  complete: "Fertig",
  measured: "Aus Laufdaten",
  estimated: "Konservative Schätzung",
  partial: "Teilweise berechnet",
  unavailable: "Nicht verfügbar",
};

export type StoredTokenUsage = {
  model?: unknown;
  inputTokens?: unknown;
  outputTokens?: unknown;
  input_tokens?: unknown;
  output_tokens?: unknown;
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  requestCount?: unknown;
  durationMs?: unknown;
  generationDurationMs?: unknown;
};

export type NormalizedTokenUsage = {
  model?: PipelineModel;
  inputTokens: number;
  outputTokens: number;
  requestCount: number;
  durationMs?: number;
};

export type StoredTokenCostSummary = {
  status: "measured" | "partial" | "unavailable";
  knownCostUsd: number;
  totalCostUsd: number | null;
  pricedUsageCount: number;
  unpricedUsageCount: number;
  inputTokens: number;
  outputTokens: number;
};

export type ProductionPipelineEstimateInput = {
  model?: unknown;
  tokenUsage?: readonly StoredTokenUsage[];
  generationDurationsMs?: readonly unknown[];
  uploadDurationsMs?: readonly unknown[];
  remainingGenerations?: unknown;
  remainingUploads?: unknown;
  batches?: readonly {
    remainingGenerations?: unknown;
    remainingUploads?: unknown;
  }[];
  activeGenerationElapsedMs?: unknown;
  activeUploadElapsedMs?: unknown;
};

export type ProductionPipelineEstimate = {
  status: PipelineEstimateStatus;
  model: PipelineModel | null;
  concurrency: typeof PIPELINE_CONCURRENCY;
  remaining: {
    generations: number;
    uploads: number;
  };
  averages: {
    inputTokensPerGeneration: number;
    outputTokensPerGeneration: number;
    generationDurationMs: number;
    uploadDurationMs: number;
    tokenSource: "measured" | "fallback";
    generationTimeSource: "measured" | "fallback";
    uploadTimeSource: "measured" | "fallback";
  };
  cost: {
    status: PipelineEstimateStatus;
    completedUsd: number | null;
    knownCompletedUsd: number;
    remainingUsd: number | null;
    projectedTotalUsd: number | null;
    formattedCompleted: string;
    formattedRemaining: string;
    formattedProjectedTotal: string;
  };
  time: {
    status: PipelineEstimateStatus;
    remainingMs: number;
    formattedRemaining: string;
  };
};

function finiteNonNegative(value: unknown): number | null {
  const numberValue = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(numberValue) && numberValue >= 0
    ? numberValue
    : null;
}

function finitePositive(value: unknown): number | null {
  const numberValue = finiteNonNegative(value);
  return numberValue !== null && numberValue > 0 ? numberValue : null;
}

function normalizedCount(value: unknown): number {
  const numberValue = finiteNonNegative(value);
  return numberValue === null ? 0 : Math.floor(numberValue);
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const numberValue = finiteNonNegative(value);
    if (numberValue !== null) return numberValue;
  }
  return null;
}

function arithmeticMean(values: readonly number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function roundedCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

export function normalizePipelineModel(value: unknown): PipelineModel | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLocaleLowerCase("en-US");
  return normalized in PIPELINE_MODEL_PRICES_USD_PER_MILLION
    ? normalized as PipelineModel
    : null;
}

export function normalizeStoredTokenUsage(
  value: StoredTokenUsage | null | undefined,
): NormalizedTokenUsage | null {
  if (!value || typeof value !== "object") return null;
  const inputTokens = firstNumber(
    value.inputTokens,
    value.input_tokens,
    value.prompt_tokens,
  );
  const outputTokens = firstNumber(
    value.outputTokens,
    value.output_tokens,
    value.completion_tokens,
  );
  if (inputTokens === null && outputTokens === null) return null;

  const durationMs = firstNumber(
    value.durationMs,
    value.generationDurationMs,
  );
  const model = normalizePipelineModel(value.model);
  return {
    ...(model ? { model } : {}),
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    requestCount: finiteNonNegative(value.requestCount) ?? 0,
    ...(durationMs !== null ? { durationMs } : {}),
  };
}

export function tokenUsageCostUsd(
  modelValue: unknown,
  usage: StoredTokenUsage | NormalizedTokenUsage,
): number | null {
  const model = normalizePipelineModel(modelValue);
  const normalized = normalizeStoredTokenUsage(usage);
  if (!model || !normalized) return null;
  const prices = PIPELINE_MODEL_PRICES_USD_PER_MILLION[model];
  return roundedCurrency(
    (
      normalized.inputTokens * prices.input
      + normalized.outputTokens * prices.output
    ) / 1_000_000,
  );
}

export function summarizeStoredTokenCost(
  usages: readonly StoredTokenUsage[],
  defaultModelValue?: unknown,
): StoredTokenCostSummary {
  const defaultModel = normalizePipelineModel(defaultModelValue);
  let knownCostUsd = 0;
  let pricedUsageCount = 0;
  let unpricedUsageCount = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  for (const usage of usages) {
    const normalized = normalizeStoredTokenUsage(usage);
    if (!normalized) continue;
    inputTokens += normalized.inputTokens;
    outputTokens += normalized.outputTokens;

    const explicitModel = usage.model === undefined
      || usage.model === null
      || usage.model === ""
      ? undefined
      : normalizePipelineModel(usage.model);
    const model = explicitModel ?? (
      usage.model === undefined || usage.model === null || usage.model === ""
        ? defaultModel
        : null
    );
    const cost = model ? tokenUsageCostUsd(model, normalized) : null;
    if (cost === null) {
      unpricedUsageCount += 1;
    } else {
      knownCostUsd += cost;
      pricedUsageCount += 1;
    }
  }

  knownCostUsd = roundedCurrency(knownCostUsd);
  if (!pricedUsageCount && unpricedUsageCount) {
    return {
      status: "unavailable",
      knownCostUsd,
      totalCostUsd: null,
      pricedUsageCount,
      unpricedUsageCount,
      inputTokens,
      outputTokens,
    };
  }
  return {
    status: unpricedUsageCount ? "partial" : "measured",
    knownCostUsd,
    totalCostUsd: unpricedUsageCount ? null : knownCostUsd,
    pricedUsageCount,
    unpricedUsageCount,
    inputTokens,
    outputTokens,
  };
}

export function estimatePipelineRemainingMs(input: {
  remainingGenerations?: unknown;
  remainingUploads?: unknown;
  generationDurationMs?: unknown;
  uploadDurationMs?: unknown;
}): number {
  const generationCount = normalizedCount(input.remainingGenerations);
  const uploadCount = normalizedCount(input.remainingUploads);
  if (!generationCount && !uploadCount) return 0;

  const generationDurationMs = finitePositive(input.generationDurationMs)
    ?? CONSERVATIVE_PIPELINE_FALLBACKS.generationDurationMs;
  const uploadDurationMs = finitePositive(input.uploadDurationMs)
    ?? CONSERVATIVE_PIPELINE_FALLBACKS.uploadDurationMs;
  const generatedUploads = Math.min(generationCount, uploadCount);
  const readyUploads = uploadCount - generatedUploads;
  const generationFinishMs = Math.ceil(
    generationCount / PIPELINE_CONCURRENCY.generation,
  ) * generationDurationMs;

  if (!generatedUploads) {
    return Math.round(Math.max(
      generationFinishMs,
      readyUploads * uploadDurationMs,
    ));
  }

  const readyWorkFinishMs = readyUploads * uploadDurationMs;
  const generatedUploadFinishIfQueueStaysBusy = (
    readyWorkFinishMs + generatedUploads * uploadDurationMs
  );
  const finalGenerationWave = Math.ceil(
    generatedUploads / PIPELINE_CONCURRENCY.generation,
  );
  const uploadFinishFromGenerationGaps = (
    generationDurationMs <= (
      PIPELINE_CONCURRENCY.generation * uploadDurationMs
    )
      ? generationDurationMs + generatedUploads * uploadDurationMs
      : finalGenerationWave * generationDurationMs
        + (generatedUploads % PIPELINE_CONCURRENCY.generation === 0
          ? PIPELINE_CONCURRENCY.generation * uploadDurationMs
          : uploadDurationMs)
  );
  const uploadFinishMs = Math.max(
    generatedUploadFinishIfQueueStaysBusy,
    uploadFinishFromGenerationGaps,
  );

  return Math.round(Math.max(generationFinishMs, uploadFinishMs));
}

export function formatUsdCost(value: unknown): string {
  const numberValue = finiteNonNegative(value);
  if (numberValue === null) return "–";
  if (numberValue > 0 && numberValue < 0.01) return "< 0,01 $";
  return `${numberValue.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} $`;
}

export function formatRemainingTime(value: unknown): string {
  const milliseconds = finiteNonNegative(value);
  if (milliseconds === null) return "–";
  if (milliseconds === 0) return "Fertig";

  const minutes = Math.max(1, Math.ceil(milliseconds / 60_000));
  if (minutes < 60) return `ca. ${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder
    ? `ca. ${hours} Std. ${remainder} Min.`
    : `ca. ${hours} Std.`;
}

export function estimateProductionPipeline(
  input: ProductionPipelineEstimateInput,
): ProductionPipelineEstimate {
  const model = normalizePipelineModel(input.model);
  const allTokenUsage = (input.tokenUsage ?? [])
    .map((usage) => normalizeStoredTokenUsage(usage))
    .filter((usage): usage is NormalizedTokenUsage => usage !== null);
  const tokenUsage = allTokenUsage.filter((usage) => (
    usage.requestCount > 0
    && usage.inputTokens + usage.outputTokens > 0
  ));
  const measuredInputAverage = arithmeticMean(
    tokenUsage.map((usage) => usage.inputTokens),
  );
  const measuredOutputAverage = arithmeticMean(
    tokenUsage.map((usage) => usage.outputTokens),
  );
  const explicitGenerationDurations = (input.generationDurationsMs ?? [])
    .map(finitePositive)
    .filter((value): value is number => value !== null);
  const storedGenerationDurations = tokenUsage
    .map((usage) => usage.durationMs)
    .filter((value): value is number => (
      typeof value === "number" && value > 0
    ));
  const generationDurations = explicitGenerationDurations.length
    ? explicitGenerationDurations
    : storedGenerationDurations;
  const uploadDurations = (input.uploadDurationsMs ?? [])
    .map(finitePositive)
    .filter((value): value is number => value !== null);

  const tokenSamplesAreReliable = tokenUsage.length
    >= PIPELINE_MINIMUM_RELIABLE_SAMPLES;
  const generationSamplesAreReliable = generationDurations.length
    >= PIPELINE_MINIMUM_RELIABLE_SAMPLES;
  const uploadSamplesAreReliable = uploadDurations.length
    >= PIPELINE_MINIMUM_RELIABLE_SAMPLES;
  const inputTokensPerGeneration = tokenSamplesAreReliable
    ? measuredInputAverage!
    : CONSERVATIVE_PIPELINE_FALLBACKS.inputTokensPerGeneration;
  const outputTokensPerGeneration = tokenSamplesAreReliable
    ? measuredOutputAverage!
    : CONSERVATIVE_PIPELINE_FALLBACKS.outputTokensPerGeneration;
  const generationDurationMs = generationSamplesAreReliable
    ? arithmeticMean(generationDurations)!
    : CONSERVATIVE_PIPELINE_FALLBACKS.generationDurationMs;
  const uploadDurationMs = uploadSamplesAreReliable
    ? arithmeticMean(uploadDurations)!
    : CONSERVATIVE_PIPELINE_FALLBACKS.uploadDurationMs;
  const remainingGenerations = normalizedCount(input.remainingGenerations);
  const remainingUploads = normalizedCount(input.remainingUploads);
  const completedCost = summarizeStoredTokenCost(
    input.tokenUsage ?? [],
    model,
  );

  const remainingCostUsd = remainingGenerations === 0
    ? 0
    : model
      ? tokenUsageCostUsd(model, {
          inputTokens: inputTokensPerGeneration * remainingGenerations,
          outputTokens: outputTokensPerGeneration * remainingGenerations,
        })
      : null;
  const projectedTotalUsd = (
    completedCost.totalCostUsd !== null && remainingCostUsd !== null
  )
    ? roundedCurrency(completedCost.totalCostUsd + remainingCostUsd)
    : null;
  const batches = (input.batches ?? []).map((batch) => ({
    remainingGenerations: normalizedCount(batch.remainingGenerations),
    remainingUploads: normalizedCount(batch.remainingUploads),
  })).filter((batch) => (
    batch.remainingGenerations > 0 || batch.remainingUploads > 0
  ));
  const baseRemainingMs = batches.length
    ? batches.reduce((sum, batch) => (
        sum + estimatePipelineRemainingMs({
          ...batch,
          generationDurationMs,
          uploadDurationMs,
        })
      ), 0)
    : estimatePipelineRemainingMs({
        remainingGenerations,
        remainingUploads,
        generationDurationMs,
        uploadDurationMs,
      });
  const generationProgressMs = Math.min(
    generationDurationMs,
    finiteNonNegative(input.activeGenerationElapsedMs) ?? 0,
  );
  const uploadProgressMs = Math.min(
    uploadDurationMs,
    finiteNonNegative(input.activeUploadElapsedMs) ?? 0,
  );
  const remainingMs = Math.max(
    0,
    Math.round(baseRemainingMs - Math.max(
      generationProgressMs,
      uploadProgressMs,
    )),
  );
  const complete = remainingGenerations === 0 && remainingUploads === 0;
  const tokenSource = tokenSamplesAreReliable ? "measured" : "fallback";
  const timeSourcesNeeded = [
    ...(remainingGenerations ? [
      generationSamplesAreReliable ? "measured" : "fallback",
    ] : []),
    ...(remainingUploads ? [
      uploadSamplesAreReliable ? "measured" : "fallback",
    ] : []),
  ];
  const timeStatus: PipelineEstimateStatus = complete
    ? "complete"
    : timeSourcesNeeded.every((source) => source === "measured")
      ? "measured"
      : "estimated";
  const costStatus: PipelineEstimateStatus = remainingGenerations === 0
    ? "complete"
    : !model
      ? "unavailable"
      : tokenSource === "measured"
        ? "measured"
        : "estimated";
  const status: PipelineEstimateStatus = complete
    ? "complete"
    : costStatus === "unavailable"
      ? "partial"
      : costStatus === "estimated" || timeStatus === "estimated"
        ? "estimated"
        : "measured";

  return {
    status,
    model,
    concurrency: PIPELINE_CONCURRENCY,
    remaining: {
      generations: remainingGenerations,
      uploads: remainingUploads,
    },
    averages: {
      inputTokensPerGeneration,
      outputTokensPerGeneration,
      generationDurationMs,
      uploadDurationMs,
      tokenSource,
      generationTimeSource: generationSamplesAreReliable
        ? "measured"
        : "fallback",
      uploadTimeSource: uploadSamplesAreReliable ? "measured" : "fallback",
    },
    cost: {
      status: costStatus,
      completedUsd: completedCost.totalCostUsd,
      knownCompletedUsd: completedCost.knownCostUsd,
      remainingUsd: remainingCostUsd,
      projectedTotalUsd,
      formattedCompleted: formatUsdCost(completedCost.totalCostUsd),
      formattedRemaining: formatUsdCost(remainingCostUsd),
      formattedProjectedTotal: formatUsdCost(projectedTotalUsd),
    },
    time: {
      status: timeStatus,
      remainingMs,
      formattedRemaining: formatRemainingTime(remainingMs),
    },
  };
}
