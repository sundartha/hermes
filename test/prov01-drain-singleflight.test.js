// F3 (PROV-01): Single-Flight um den Provisioning-Drain. Kein Spawn, kein pglite - testet
// den generischen Serialisierungs-Baustein makeSingleFlight gegen den ECHTEN Memory-Queue-
// Adapter (der 'done' erst nach dem await markiert = das reale Race-Fenster). Diskriminierend:
// die Kontrolle (ohne Guard) verdoppelt den Kauf, mit Guard ist es genau einer. Zusaetzlich
// (P16 Review-Fix): der Watchdog meldet einen auffaellig langen Lauf statt still zu bleiben.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeSingleFlight } from "../src/single-flight.js";
import { makeMemoryQueue } from "../src/queue/adapters/memory/queue.js";
import { PROVISION_NUMBER_JOB } from "../src/store/defaults.js";

const ORDER_DELAY_MS = 20; // haelt den Job im 'queued'-Fenster offen (Provider-await simuliert)
const NUMBER_IDS = ["num_a", "num_b"];

// Fake-Provisioner: orderNumber verzoegert + zaehlt effektive Kaeufe pro numberId.
function makeCountingProvisioner() {
  const orders = new Map(); // numberId -> count
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

// Race-relevante Kernschleife des Drains (server.runProvisioningDrain): je QUEUED-Job den
// verzoegerten Kauf ausfuehren. store/save/handleProvisionJob sind hier unerheblich - getestet
// wird die Serialisierung, nicht die Kauf-State-Machine (die deckt provisioning-worker.test.js).
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

  await assert.rejects(runExclusive()); // Aufruf #1 wirft
  await runExclusive(); // Aufruf #2 laeuft trotzdem
  assert.equal(calls, 2, "zweiter Drain nach Fehler des ersten ausgefuehrt");
});

// P16 Review-Fix (PROV-01/F3): Watchdog meldet einen auffaellig langen Lauf, OHNE ihn
// abzubrechen (das Kappen selbst passiert am Provider-Call ueber fetchWithTimeout,
// src/fetch-with-timeout.js) - onStall ist injizierbar, damit der Test nicht auf die
// echte Default-Frist warten muss.
const WATCHDOG_MS = 15;

test("Watchdog: meldet einen Lauf, der laenger als watchdogMs braucht", async () => {
  let stalledWith;
  const runExclusive = makeSingleFlight(
    () => new Promise((resolve) => setTimeout(resolve, WATCHDOG_MS * 3)),
    { watchdogMs: WATCHDOG_MS, onStall: (ms) => (stalledWith = ms) },
  );
  await runExclusive();
  assert.equal(stalledWith, WATCHDOG_MS, "onStall wurde mit der konfigurierten Frist aufgerufen");
});

test("Watchdog: meldet NICHTS, wenn der Lauf vor watchdogMs fertig ist", async () => {
  let stalled = false;
  const runExclusive = makeSingleFlight(() => Promise.resolve("schnell"), {
    watchdogMs: WATCHDOG_MS,
    onStall: () => (stalled = true),
  });
  await runExclusive();
  // Etwas laenger als watchdogMs warten, um sicherzugehen, dass der (bereits
  // geclearte) Timer nicht doch noch verspaetet feuert.
  await new Promise((resolve) => setTimeout(resolve, WATCHDOG_MS * 2));
  assert.equal(stalled, false, "kein Stall-Alarm fuer einen rechtzeitig fertigen Lauf");
});
