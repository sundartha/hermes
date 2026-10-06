import { test } from "node:test";
import assert from "node:assert/strict";
import { makeSingleFlight } from "../src/single-flight.js";
import { makeMemoryQueue } from "../src/queue/adapters/memory/queue.js";
import { PROVISION_NUMBER_JOB } from "../src/store/defaults.js";

const ORDER_DELAY_MS = 20;
const NUMBER_IDS = ["num_a", "num_b"];

function makeCountingProvisioner() {
  const orders = new Map();
  async function orderNumber(numberId) {
    await new Promise((r) => setTimeout(r, ORDER_DELAY_MS));
    orders.set(numberId, (orders.get(numberId) || 0) + 1);
  }
  return { orders, orderNumber };
}

function seedQueue(numberIds) {
  const queue = makeMemoryQueue();
  for (const numberId of numberIds)
    queue.enqueue({
      kind: PROVISION_NUMBER_JOB,
      payload: { numberId },
      idempotencyKey: `provision_${numberId}`,
    });
  return queue;
}

function drainOnce(queue, prov) {
  return queue.drain((job) => prov.orderNumber(job.payload.numberId));
}

test("Single-Flight: zwei parallele Drains kaufen jeden Job GENAU einmal", async () => {
  const queue = seedQueue(NUMBER_IDS);
  const prov = makeCountingProvisioner();
  const runExclusive = makeSingleFlight(() => drainOnce(queue, prov));

  await Promise.all([runExclusive(), runExclusive()]);

  for (const numberId of NUMBER_IDS)
    assert.equal(prov.orders.get(numberId), 1, `orderNumber genau einmal fuer ${numberId}`);
});

test("Kontrolle: ohne Guard verdoppelt der parallele Drain den Kauf (Race real)", async () => {
  const queue = seedQueue(NUMBER_IDS);
  const prov = makeCountingProvisioner();

  await Promise.all([drainOnce(queue, prov), drainOnce(queue, prov)]);

  for (const numberId of NUMBER_IDS)
    assert.equal(prov.orders.get(numberId), 2, `ungeguarded: doppelter Kauf fuer ${numberId}`);
});

test("Fehler bricht die Kette nicht ab: Folge-Drain laeuft weiter", async () => {
  let calls = 0;
  const runExclusive = makeSingleFlight(async () => {
    calls++;
    if (calls === 1) throw new Error("erster Drain scheitert");
  });

  await assert.rejects(runExclusive());
  await runExclusive();
  assert.equal(calls, 2, "zweiter Drain nach Fehler des ersten ausgefuehrt");
});
