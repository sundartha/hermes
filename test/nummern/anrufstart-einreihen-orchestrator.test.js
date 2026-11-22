import assert from "node:assert/strict";
import { test } from "node:test";

import { OHNE_EL_ZUGANG, withConfigNamespaces } from "../config-namespaces-helper.js";
import { makeConfigOverrides } from "../helpers.js";
import { config } from "../../src/config.ts";
import { createQueue } from "../../src/queue/registry.ts";
import { makeProvisioningOrchestrator } from "../../src/worker/provisioning-orchestrator.ts";

const { withConfigOverrides } = makeConfigOverrides(config);

function baue(queue) {
  return makeProvisioningOrchestrator({
    store: { load: () => ({ numbers: [], provisioningJobs: [] }), save() {} },
    config: withConfigNamespaces({ ...OHNE_EL_ZUGANG, paymentEnabled: false, provisioningEnabled: false }),
    queue,
    billing: {},
    metering: {},
    numberProvisioning: () => ({}),
    handleProvisionJob: async () => ({}),
    resolveProvisionRetry: () => ({ ok: false }),
    audit: () => {},
    recordProvisioningJob: () => null,
    markProvisioningJob: () => null,
    classifyQueuedProvisioningJobs: () => ({ close: [], hold: [], redrive: [] }),
    findNumber: () => null,
  });
}

const neueQueue = () => withConfigOverrides({ queueBackend: "memory" }, () => createQueue());

test("Anrufstart einreihen: der Auftrag ist vom Typ anrufstart und traegt nur die Anruf-ID", async () => {
  const queue = neueQueue();
  const orchestrator = baue(queue);
  assert.ok(await orchestrator.reiheAnrufstartEin("call_a"));
  const gesehen = [];
  assert.equal(await queue.drain((job) => gesehen.push({ kind: job.kind, payload: job.payload }), "anrufstart"), 1);
  assert.deepEqual(gesehen, [{ kind: "anrufstart", payload: { callId: "call_a" } }]);
});

test("Anrufstart einreihen: dieselbe Anruf-ID wird nie zweimal eingereiht, eine andere schon", async () => {
  const queue = neueQueue();
  const orchestrator = baue(queue);
  const erste = await orchestrator.reiheAnrufstartEin("call_a");
  assert.equal(await orchestrator.reiheAnrufstartEin("call_a"), erste);
  const andere = await orchestrator.reiheAnrufstartEin("call_b");
  assert.notEqual(andere, erste);
  const gesehen = [];
  assert.equal(await queue.drain((job) => gesehen.push(job.payload.callId), "anrufstart"), 2);
  assert.deepEqual(gesehen, ["call_a", "call_b"]);
});

test("Anrufstart einreihen: nach dem Abschalten wird nichts mehr eingereiht", async () => {
  const queue = neueQueue();
  queue.start = async () => {};
  queue.stop = async () => {};
  const orchestrator = baue(queue);
  await orchestrator.stopQueue();
  assert.equal(await orchestrator.reiheAnrufstartEin("call_a"), null);
  assert.equal(await queue.drain(() => {}, "anrufstart"), 0);
});
