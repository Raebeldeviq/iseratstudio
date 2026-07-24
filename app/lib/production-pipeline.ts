export const PRODUCTION_PIPELINE_PRODUCER_LIMIT = 2;
export const PRODUCTION_PIPELINE_PREPARED_CAPACITY = 2;

type MaybePromise<T> = T | Promise<T>;

export type ProductionPipelinePrepared<TInput, TPrepared> = {
  status: "prepared";
  index: number;
  item: TInput;
  value: TPrepared;
};

export type ProductionPipelineProducerFailure<TInput> = {
  status: "producer-failed";
  index: number;
  item: TInput;
  error: unknown;
};

export type ProductionPipelineOutcome<TInput, TPrepared> =
  | ProductionPipelinePrepared<TInput, TPrepared>
  | ProductionPipelineProducerFailure<TInput>;

export type ProductionPipelineConsumption<TInput, TPrepared, TConsumed> =
  | {
      status: "consumed";
      outcome: ProductionPipelineOutcome<TInput, TPrepared>;
      value: TConsumed;
    }
  | {
      status: "consumer-failed";
      outcome: ProductionPipelineOutcome<TInput, TPrepared>;
      error: unknown;
    };

export type ProductionPipelineStats = {
  total: number;
  producerStarted: number;
  producerCompleted: number;
  producerFailed: number;
  consumerStarted: number;
  consumerCompleted: number;
  consumerFailed: number;
  producerActivePeak: number;
  consumerActivePeak: number;
  preparedPeak: number;
  notStarted: number;
};

export type ProductionPipelineResult<TInput, TPrepared, TConsumed> = {
  stopped: boolean;
  outcomes: ProductionPipelineOutcome<TInput, TPrepared>[];
  consumed: ProductionPipelineConsumption<TInput, TPrepared, TConsumed>[];
  unconsumed: ProductionPipelineOutcome<TInput, TPrepared>[];
  stats: ProductionPipelineStats;
};

export type ProductionPipelineOptions<TInput, TPrepared, TConsumed> = {
  items: readonly TInput[];
  produce: (item: TInput, index: number) => MaybePromise<TPrepared>;
  consume: (
    outcome: ProductionPipelineOutcome<TInput, TPrepared>,
  ) => MaybePromise<TConsumed>;
  shouldStop?: () => boolean;
};

/**
 * Runs an ordered, bounded producer/consumer pipeline.
 *
 * At most two producers are active and at most two produced items are held
 * ahead of the single consumer. Producer failures are converted to outcomes,
 * so the consumer can record the failure and processing can continue.
 *
 * `shouldStop` is checked before every producer and consumer start. Already
 * active work is allowed to settle, but no additional operation starts after
 * a stop has been observed.
 */
export async function runBoundedProductionPipeline<
  TInput,
  TPrepared,
  TConsumed = void,
>({
  items,
  produce,
  consume,
  shouldStop,
}: ProductionPipelineOptions<
  TInput,
  TPrepared,
  TConsumed
>): Promise<ProductionPipelineResult<TInput, TPrepared, TConsumed>> {
  const input = [...items];
  const stopRequested = () => Boolean(shouldStop?.());
  const slots = new Map<
    number,
    Promise<ProductionPipelineOutcome<TInput, TPrepared>>
  >();
  const outcomes = new Map<
    number,
    ProductionPipelineOutcome<TInput, TPrepared>
  >();
  const consumedIndexes = new Set<number>();
  const consumed: ProductionPipelineConsumption<
    TInput,
    TPrepared,
    TConsumed
  >[] = [];

  let nextProducerIndex = 0;
  let nextConsumerIndex = 0;
  let producerActive = 0;
  let consumerActive = 0;
  let prepared = 0;
  let producerStarted = 0;
  let producerCompleted = 0;
  let producerFailed = 0;
  let consumerStarted = 0;
  let consumerCompleted = 0;
  let consumerFailed = 0;
  let producerActivePeak = 0;
  let consumerActivePeak = 0;
  let preparedPeak = 0;
  let stopped = false;

  const startProducer = (index: number) => {
    const item = input[index];
    producerStarted += 1;
    producerActive += 1;
    producerActivePeak = Math.max(producerActivePeak, producerActive);

    const prepare = async (): Promise<
      ProductionPipelineOutcome<TInput, TPrepared>
    > => {
      try {
        const value = await produce(item, index);
        return {
          status: "prepared",
          index,
          item,
          value,
        };
      } catch (error) {
        return {
          status: "producer-failed",
          index,
          item,
          error,
        };
      }
    };

    const promise = prepare().then((outcome) => {
      producerActive -= 1;
      producerCompleted += 1;
      if (outcome.status === "producer-failed") {
        producerFailed += 1;
      }
      outcomes.set(index, outcome);
      prepared += 1;
      preparedPeak = Math.max(preparedPeak, prepared);
      return outcome;
    });

    slots.set(index, promise);
  };

  const fillProducerWindow = () => {
    while (
      nextProducerIndex < input.length &&
      slots.size < PRODUCTION_PIPELINE_PREPARED_CAPACITY &&
      producerActive < PRODUCTION_PIPELINE_PRODUCER_LIMIT
    ) {
      if (stopRequested()) {
        stopped = true;
        break;
      }
      const index = nextProducerIndex;
      nextProducerIndex += 1;
      startProducer(index);
    }
  };

  while (nextConsumerIndex < input.length) {
    if (stopRequested()) {
      stopped = true;
      break;
    }

    fillProducerWindow();
    const slot = slots.get(nextConsumerIndex);
    if (!slot) {
      stopped = nextConsumerIndex < input.length;
      break;
    }

    const outcome = await slot;
    if (stopRequested()) {
      stopped = true;
      break;
    }

    const index = nextConsumerIndex;
    nextConsumerIndex += 1;
    slots.delete(index);
    prepared -= 1;
    consumedIndexes.add(index);
    consumerStarted += 1;
    consumerActive += 1;
    consumerActivePeak = Math.max(consumerActivePeak, consumerActive);

    let consumerPromise: Promise<TConsumed>;
    try {
      consumerPromise = Promise.resolve(consume(outcome));
    } catch (error) {
      consumerPromise = Promise.reject(error);
    }

    fillProducerWindow();

    try {
      const value = await consumerPromise;
      consumerCompleted += 1;
      consumed.push({
        status: "consumed",
        outcome,
        value,
      });
    } catch (error) {
      consumerCompleted += 1;
      consumerFailed += 1;
      consumed.push({
        status: "consumer-failed",
        outcome,
        error,
      });
    } finally {
      consumerActive -= 1;
    }
  }

  await Promise.allSettled(slots.values());

  const orderedOutcomes = [...outcomes.values()].sort(
    (left, right) => left.index - right.index,
  );
  const unconsumed = orderedOutcomes.filter(
    (outcome) => !consumedIndexes.has(outcome.index),
  );

  return {
    stopped: stopped || nextConsumerIndex < input.length,
    outcomes: orderedOutcomes,
    consumed,
    unconsumed,
    stats: {
      total: input.length,
      producerStarted,
      producerCompleted,
      producerFailed,
      consumerStarted,
      consumerCompleted,
      consumerFailed,
      producerActivePeak,
      consumerActivePeak,
      preparedPeak,
      notStarted: input.length - producerStarted,
    },
  };
}
