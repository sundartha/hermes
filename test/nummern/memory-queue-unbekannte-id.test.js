import assert from "node:assert/strict";
import { test } from "node:test";

import { makeMemoryQueue } from "../../src/queue/adapters/memory/queue.ts";
import { PROVISIONING_JOB_STATUS } from "../../src/begriffe/nummern.js";

test("memory-queue-unbekannte-id: leere Queue meldet null statt zu werfen", () => {
  const queue = makeMemoryQueue();
  assert.equal(queue.jobStatus("job_gibt_es_nicht"), null);
});

test("memory-queue-unbekannte-id: unbekannte id neben bekanntem Job meldet null", () => {
  const queue = makeMemoryQueue();
  const id = queue.enqueue({ kind: "k", payload: {}, idempotencyKey: "schluessel-1" });
  assert.equal(queue.jobStatus(id), PROVISIONING_JOB_STATUS.QUEUED);
  assert.equal(queue.jobStatus("job_gibt_es_nicht"), null);
});

test("memory-queue-unbekannte-id: leere Queue verarbeitet nichts", async () => {
  const queue = makeMemoryQueue();
  const aufrufe = [];
  assert.equal(await queue.drain((job) => aufrufe.push(job)), 0);
  assert.deepEqual(aufrufe, []);
});
