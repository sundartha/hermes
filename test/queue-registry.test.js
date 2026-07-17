// S1-17: createQueue() waehlt das Queue-Backend config-getrieben (fail-closed).
// config.queueBackend wird pro Test gesetzt/wiederhergestellt (Muster wie
// config.geoEnabled in geo-registry.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { createQueue } from "../src/queue/registry.js";

function withQueueBackend(value, fn) {
  const original = config.queueBackend;
  config.queueBackend = value;
  try {
    return fn();
  } finally {
    config.queueBackend = original;
  }
}

test("S1-17a: QUEUE_BACKEND=memory -> QueuePort-Form (enqueue/drain/jobStatus als Funktionen)", () => {
  withQueueBackend("memory", () => {
    let queue;
    assert.doesNotThrow(() => {
      queue = createQueue();
    });
    assert.equal(typeof queue.enqueue, "function");
    assert.equal(typeof queue.drain, "function");
    assert.equal(typeof queue.jobStatus, "function");
  });
});

test("S1-17b: QUEUE_BACKEND=pgboss -> wirft (deferred, noch nicht implementiert)", () => {
  withQueueBackend("pgboss", () => {
    assert.throws(() => createQueue(), /noch nicht implementiert/);
  });
});

test("S1-17c: unbekanntes QUEUE_BACKEND -> wirft fail-closed", () => {
  withQueueBackend("was-anderes", () => {
    assert.throws(() => createQueue(), /Unbekanntes QUEUE_BACKEND/);
  });
});
