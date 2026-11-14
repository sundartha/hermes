import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { pgBossUmgebung } from "../gemeinsam/pgboss-umgebung.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { makeConfigOverrides } from "../helpers.js";
import { config } from "../../src/config.js";
import { createQueue } from "../../src/queue/registry.js";
import { makeProvisioningOrchestrator } from "../../src/worker/provisioning-orchestrator.js";

const { withConfigOverrides } = makeConfigOverrides(config);

const PROVISION = "provision_number";
const ANRUFSTART = "anrufstart";
const ANRUFSTART_TAKT_MS = 2000;
const PROVISION_TAKT_MS = 30_000;
const TENANT = "t_k5b";
const NUMBER_ID = "num_k5b";

const naechsterZug = () => new Promise((fertig) => setImmediate(fertig));

const warteschlangenZeile = async (db, name) => {
  const { rows } = await db.abfragen(
    "SELECT retry_limit, retry_delay, retry_backoff, retry_delay_max, expire_seconds FROM pgboss.queue WHERE name = $1",
    [name],
  );
  return rows[0];
};

function provisionAuftrag() {
  return {
    kind: PROVISION,
    payload: { numberId: NUMBER_ID },
    idempotencyKey: `provision_${NUMBER_ID}`,
  };
}

function anrufAuftrag(callId = "call_k5b_1") {
  return { kind: ANRUFSTART, payload: { callId }, idempotencyKey: callId };
}

function baueOrchestrator({ queue, anrufstartHandler, provisioningEnabled = false, gesehen = [] }) {
  const state = {
    numbers: [{ id: NUMBER_ID, tenantId: TENANT, status: "requested", e164: null, country: "DE" }],
    provisioningJobs: [],
  };
  return makeProvisioningOrchestrator({
    store: { load: () => state, save() {} },
    config: withConfigNamespaces({
      paymentEnabled: false,
      provisioningEnabled,
      provisioningRedriveMaxAgeMs: 3_600_000,
    }),
    queue,
    billing: {},
    metering: {},
    numberProvisioning: () => ({}),
    handleProvisionJob: async (_state, job) => {
      gesehen.push(`${job.kind}:${job.idempotencyKey}`);
      return {};
    },
    resolveProvisionRetry: () => ({ ok: false }),
    audit: () => {},
    recordProvisioningJob: () => null,
    markProvisioningJob: () => null,
    classifyQueuedProvisioningJobs: () => ({ close: [], hold: [], redrive: [] }),
    findNumber: (s, id) => s.numbers.find((n) => n.id === id) ?? null,
    anrufstartHandler,
  });
}

function takteSimulieren(t) {
  mock.timers.enable({ apis: ["setInterval"] });
  t.after(() => mock.timers.reset());
}

test("K5b-1-a: pg-boss führt den Anrufstart ohne Wiederholung, der Nummernkauf behält 3 Wiederholungen", async (t) => {
  const umgebung = await pgBossUmgebung(t);
  await umgebung.queue.enqueue(anrufAuftrag());
  await umgebung.queue.enqueue(provisionAuftrag());
  const anruf = await warteschlangenZeile(umgebung.db, ANRUFSTART);
  const kauf = await warteschlangenZeile(umgebung.db, PROVISION);
  assert.equal(anruf.retry_limit, 0);
  assert.equal(kauf.retry_limit, 3);
  assert.equal(anruf.expire_seconds, kauf.expire_seconds);
  assert.equal(anruf.retry_delay, kauf.retry_delay);
});

test("K5b-1-b: ein Abruf je Art arbeitet nur Aufträge dieser Art ab (pg-boss)", async (t) => {
  const umgebung = await pgBossUmgebung(t);
  await umgebung.queue.enqueue(anrufAuftrag());
  await umgebung.queue.enqueue(provisionAuftrag());
  const gesehen = [];
  const verarbeitet = await umgebung.queue.drain((job) => gesehen.push(job.kind), PROVISION);
  assert.equal(verarbeitet, 1);
  assert.deepEqual(gesehen, [PROVISION]);
  const rest = await umgebung.queue.drain((job) => gesehen.push(job.kind), ANRUFSTART);
  assert.equal(rest, 1);
  assert.deepEqual(gesehen, [PROVISION, ANRUFSTART]);
});

test("K5b-1-c: ein Abruf je Art arbeitet nur Aufträge dieser Art ab (memory)", async () => {
  const queue = withConfigOverrides({ queueBackend: "memory" }, () => createQueue());
  queue.enqueue(anrufAuftrag());
  queue.enqueue(provisionAuftrag());
  const gesehen = [];
  assert.equal(await queue.drain((job) => gesehen.push(job.kind), ANRUFSTART), 1);
  assert.deepEqual(gesehen, [ANRUFSTART]);
  assert.equal(await queue.drain((job) => gesehen.push(job.kind)), 1);
  assert.deepEqual(gesehen, [ANRUFSTART, PROVISION]);
});

test("K5b-1-d: der Anrufstart-Takt startet den Auftrag nach 2 s, auch ohne Provisioning, und der Nummernkauf bekommt ihn nicht", async (t) => {
  const queue = withConfigOverrides({ queueBackend: "memory" }, () => createQueue());
  takteSimulieren(t);
  const anrufe = [];
  const kaeufe = [];
  const orchestrator = baueOrchestrator({
    queue,
    anrufstartHandler: (job) => anrufe.push(job.payload.callId),
    provisioningEnabled: false,
    gesehen: kaeufe,
  });
  await orchestrator.startQueue();
  queue.enqueue(anrufAuftrag());
  queue.enqueue(provisionAuftrag());
  mock.timers.tick(ANRUFSTART_TAKT_MS - 1);
  await naechsterZug();
  assert.deepEqual(anrufe, []);
  mock.timers.tick(1);
  await naechsterZug();
  assert.deepEqual(anrufe, ["call_k5b_1"]);
  assert.deepEqual(kaeufe, []);
  assert.equal(queue.jobStatus(queue.enqueue(provisionAuftrag())), "queued");
});

test("K5b-1-e: der Nummernkauf-Takt arbeitet nur Nummernaufträge ab, der Anrufauftrag bleibt für seinen Takt", async (t) => {
  const umgebung = await pgBossUmgebung(t);
  takteSimulieren(t);
  const anrufe = [];
  const kaeufe = [];
  const orchestrator = baueOrchestrator({
    queue: umgebung.queue,
    anrufstartHandler: (job) => anrufe.push(job.payload.callId),
    provisioningEnabled: true,
    gesehen: kaeufe,
  });
  await orchestrator.startQueue();
  await umgebung.queue.enqueue(provisionAuftrag());
  mock.timers.tick(PROVISION_TAKT_MS);
  await naechsterZug();
  await orchestrator.runProvisioningDrainExclusive();
  assert.deepEqual(kaeufe, [`${PROVISION}:provision_${NUMBER_ID}`]);
  assert.deepEqual(anrufe, []);
  await umgebung.queue.enqueue(anrufAuftrag());
  await orchestrator.runProvisioningDrainExclusive();
  assert.deepEqual(anrufe, []);
  await orchestrator.stopQueue();
  assert.deepEqual(anrufe, []);
});

test("K5b-1-f: Abschalten wartet auf einen laufenden Anrufstart und startet danach keinen mehr", async (t) => {
  const queue = withConfigOverrides({ queueBackend: "memory" }, () => createQueue());
  takteSimulieren(t);
  let freigeben;
  const blockiert = new Promise((fertig) => {
    freigeben = fertig;
  });
  let hatBegonnen = false;
  const anrufe = [];
  const orchestrator = baueOrchestrator({
    queue,
    anrufstartHandler: async (job) => {
      hatBegonnen = true;
      await blockiert;
      anrufe.push(job.payload.callId);
    },
  });
  await orchestrator.startQueue();
  queue.enqueue(anrufAuftrag());
  mock.timers.tick(ANRUFSTART_TAKT_MS);
  await naechsterZug();
  assert.equal(hatBegonnen, true);
  let abgeschaltet = false;
  const stopp = orchestrator.stopQueue().then(() => {
    abgeschaltet = true;
  });
  await naechsterZug();
  await naechsterZug();
  assert.equal(abgeschaltet, false);
  freigeben();
  await stopp;
  assert.deepEqual(anrufe, ["call_k5b_1"]);
  queue.enqueue(anrufAuftrag("call_k5b_2"));
  mock.timers.tick(ANRUFSTART_TAKT_MS);
  await naechsterZug();
  assert.deepEqual(anrufe, ["call_k5b_1"]);
});

test("K5b-1-g: ohne Anrufstart-Handler bleibt ein Anrufauftrag beim Abschalten unberührt", async () => {
  const queue = withConfigOverrides({ queueBackend: "memory" }, () => createQueue());
  const orchestrator = baueOrchestrator({ queue });
  await orchestrator.startQueue();
  const id = queue.enqueue(anrufAuftrag());
  await orchestrator.stopQueue();
  assert.equal(queue.jobStatus(id), "queued");
});
