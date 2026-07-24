import assert from "node:assert/strict";
import test from "node:test";

import {
  PRODUCTION_PIPELINE_PREPARED_CAPACITY,
  PRODUCTION_PIPELINE_PRODUCER_LIMIT,
  runBoundedProductionPipeline,
} from "../app/lib/production-pipeline.ts";

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

test("keeps two producers and one consumer bounded while preserving input order", async () => {
  const items = [0, 1, 2, 3, 4, 5];
  const consumed = [];
  let activeProducers = 0;
  let activeConsumers = 0;
  let producerPeak = 0;
  let consumerPeak = 0;
  let preparedBacklog = 0;
  let backlogPeak = 0;
  let producerConsumerOverlap = false;

  const result = await runBoundedProductionPipeline({
    items,
    async produce(item) {
      activeProducers += 1;
      producerPeak = Math.max(producerPeak, activeProducers);
      producerConsumerOverlap ||= activeConsumers > 0;
      await wait(item === 0 ? 8 : 2);
      producerConsumerOverlap ||= activeConsumers > 0;
      activeProducers -= 1;
      preparedBacklog += 1;
      backlogPeak = Math.max(backlogPeak, preparedBacklog);
      return `prepared-${item}`;
    },
    async consume(outcome) {
      activeConsumers += 1;
      consumerPeak = Math.max(consumerPeak, activeConsumers);
      preparedBacklog -= 1;
      producerConsumerOverlap ||= activeProducers > 0;
      consumed.push(outcome.index);
      await wait(10);
      activeConsumers -= 1;
    },
  });

  assert.deepEqual(consumed, items);
  assert.equal(producerPeak, PRODUCTION_PIPELINE_PRODUCER_LIMIT);
  assert.equal(consumerPeak, 1);
  assert.equal(producerConsumerOverlap, true);
  assert.ok(backlogPeak <= PRODUCTION_PIPELINE_PREPARED_CAPACITY);
  assert.equal(
    result.stats.producerActivePeak,
    PRODUCTION_PIPELINE_PRODUCER_LIMIT,
  );
  assert.equal(result.stats.consumerActivePeak, 1);
  assert.ok(
    result.stats.preparedPeak <= PRODUCTION_PIPELINE_PREPARED_CAPACITY,
  );
  assert.equal(result.stopped, false);
});

test("passes producer failures to the consumer and continues later items", async () => {
  const consumed = [];

  const result = await runBoundedProductionPipeline({
    items: ["first", "broken", "last"],
    async produce(item) {
      await wait(1);
      if (item === "broken") {
        throw new Error("generation failed");
      }
      return item.toUpperCase();
    },
    consume(outcome) {
      consumed.push(
        outcome.status === "prepared"
          ? `${outcome.item}:${outcome.value}`
          : `${outcome.item}:failed`,
      );
    },
  });

  assert.deepEqual(consumed, [
    "first:FIRST",
    "broken:failed",
    "last:LAST",
  ]);
  assert.equal(result.stats.producerFailed, 1);
  assert.equal(result.stats.consumerCompleted, 3);
  assert.equal(result.stopped, false);
});

test("continues after a consumer failure without overlapping consumers", async () => {
  const consumerStarts = [];

  const result = await runBoundedProductionPipeline({
    items: [0, 1, 2],
    produce: (item) => item,
    async consume(outcome) {
      consumerStarts.push(outcome.index);
      await wait(1);
      if (outcome.index === 1) {
        throw new Error("upload failed");
      }
    },
  });

  assert.deepEqual(consumerStarts, [0, 1, 2]);
  assert.equal(result.stats.consumerFailed, 1);
  assert.equal(result.stats.consumerActivePeak, 1);
  assert.equal(result.consumed[1].status, "consumer-failed");
});

test("observes stop before starting more producers or another consumer", async () => {
  const producerStarts = [];
  const consumerStarts = [];
  let stop = false;

  const result = await runBoundedProductionPipeline({
    items: [0, 1, 2, 3, 4],
    shouldStop: () => stop,
    async produce(item) {
      producerStarts.push(item);
      await wait(item === 0 ? 2 : 8);
      return item;
    },
    async consume(outcome) {
      consumerStarts.push(outcome.index);
      stop = true;
      await wait(2);
    },
  });

  assert.deepEqual(producerStarts, [0, 1]);
  assert.deepEqual(consumerStarts, [0]);
  assert.equal(result.stopped, true);
  assert.equal(result.stats.notStarted, 3);
  assert.deepEqual(
    result.unconsumed.map((outcome) => outcome.index),
    [1],
  );
  assert.equal(result.stats.producerStarted, result.stats.producerCompleted);
});

test("does not start any work when already stopped", async () => {
  let producerStarts = 0;
  let consumerStarts = 0;

  const result = await runBoundedProductionPipeline({
    items: [0, 1],
    shouldStop: () => true,
    produce() {
      producerStarts += 1;
    },
    consume() {
      consumerStarts += 1;
    },
  });

  assert.equal(producerStarts, 0);
  assert.equal(consumerStarts, 0);
  assert.equal(result.stopped, true);
  assert.equal(result.stats.notStarted, 2);
});
