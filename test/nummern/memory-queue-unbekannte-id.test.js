import assert from "node:assert/strict";
import { test } from "node:test";

import { config } from "../../src/config.js";
import { createQueue } from "../../src/queue/registry.js";
import { makeConfigOverrides } from "../helpers.js";

const { withConfigOverrides } = makeConfigOverrides(config);

function neueQueue() {
  return withConfigOverrides({ queueBackend: "memory" }, () => createQueue());
}

test("memory-queue-unbekannte-id: leere Queue meldet null statt zu werfen", () => {
  assert.equal(neueQueue().jobStatus("job_gibt_es_nicht"), null);
});

test("memory-queue-unbekannte-id: unbekannte id neben bekanntem Job meldet null", async () => {
  const queue = neueQueue();
  const id = queue.enqueue({ kind: "k", payload: {}, idempotencyKey: "schluessel-1" });
  const vorher = queue.jobStatus(id);
  assert.equal(typeof vorher, "string");
  assert.equal(queue.jobStatus("job_gibt_es_nicht"), null);
  await queue.drain(() => undefined);
  assert.notEqual(queue.jobStatus(id), vorher);
});

test("memory-queue-unbekannte-id: leere Queue verarbeitet nichts", async () => {
  const aufrufe = [];
  assert.equal(await neueQueue().drain((job) => aufrufe.push(job)), 0);
  assert.deepEqual(aufrufe, []);
});
