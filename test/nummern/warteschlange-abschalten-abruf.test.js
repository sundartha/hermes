import { test } from "node:test";
import assert from "node:assert/strict";
import { neueUhr, pgBossUmgebung } from "../gemeinsam/pgboss-umgebung.js";
import { fakeProvisioner } from "../helpers.js";
import { echtWarten } from "../echt-warten.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { makeGracefulShutdown } from "../../src/abschalten.js";
import { makeProvisioningOrchestrator } from "../../src/worker/provisioning-orchestrator.js";
import { handleProvisionJob } from "../../src/worker/provisioning.js";

const KIND = "provision_number";
const NUMBER = { REQUESTED: "requested", ACTIVE: "active" };
const JOB = { QUEUED: "queued", DONE: "done" };

const GESAMTFRIST_MS = 8000;
const KAUF_DAUER_MS = 1000;
const REDRIVE_MAX_ALTER_MS = 3_600_000;
const EXIT_OK = 0;
const EIN_KAUF = 1;
const TENANT = "t_abschalten_abruf";
const ANBIETER_NUMMER = { e164: "+4915799990002", providerNumberId: "num_ext_abruf" };
const NUMMER_A = "num_abruf_a";
const NUMMER_B = "num_abruf_b";

const state = {
  numberAssignments: [],
  numbers: [NUMMER_A, NUMMER_B].map((id) => ({
    id,
    tenantId: TENANT,
    status: NUMBER.REQUESTED,
    e164: null,
    country: "DE",
  })),
  provisioningJobs: [NUMMER_A, NUMMER_B].map((id) => ({
    id: `job_${id}`,
    numberId: id,
    tenantId: TENANT,
    kind: KIND,
    status: JOB.QUEUED,
    idempotencyKey: `provision_${id}`,
    attempts: 0,
    lastError: null,
  })),
};

const findNumber = (id) => state.numbers.find((number) => number.id === id);
const spur = (id) => state.provisioningJobs.find((job) => job.numberId === id);

const auftrag = (numberId) => ({
  kind: KIND,
  payload: { numberId },
  idempotencyKey: `provision_${numberId}`,
});

test("Abruf-Stopp: ein nach dem Stopp faelliger Auftrag wird nicht gekauft, sondern zurueckgestellt", async (t) => {
  const umgebung = await pgBossUmgebung(t, { clock: neueUhr() });
  const bestellt = [];
  let kaufBegonnen;
  const hatBegonnen = new Promise((fertig) => {
    kaufBegonnen = fertig;
  });
  const anbieter = fakeProvisioner({
    async orderNumber() {
      bestellt.push(1);
      kaufBegonnen();
      await echtWarten(KAUF_DAUER_MS);
      return ANBIETER_NUMMER;
    },
  });
  const orchestrator = makeProvisioningOrchestrator({
    store: { load: () => state, save() {} },
    config: withConfigNamespaces({
      paymentEnabled: false,
      provisioningEnabled: true,
      provisioningRedriveMaxAgeMs: REDRIVE_MAX_ALTER_MS,
    }),
    queue: umgebung.queue,
    billing: {},
    metering: {},
    numberProvisioning: () => anbieter,
    handleProvisionJob,
    resolveProvisionRetry: () => ({ ok: false }),
    audit: () => {},
    recordProvisioningJob: (_state, { numberId }) => ({ id: `job_${numberId}` }),
    markProvisioningJob: (s, jobId, status) => {
      const job = s.provisioningJobs.find((kandidat) => kandidat.id === jobId);
      job.status = status;
      return job;
    },
    classifyQueuedProvisioningJobs: () => ({ close: [], hold: [], redrive: [] }),
    findNumber: (s, id) => s.numbers.find((number) => number.id === id) ?? null,
  });
  await umgebung.queue.enqueue(auftrag(NUMMER_A));
  void orchestrator.runProvisioningDrainExclusive();
  await hatBegonnen;
  const idB = await umgebung.queue.enqueue(auftrag(NUMMER_B));
  const ausstiege = [];
  const gracefulShutdown = makeGracefulShutdown({
    httpServer: { close: (fertig) => fertig(), closeIdleConnections() {} },
    store: { save: async () => {}, drainFlushes: async () => {} },
    config: { server: { shutdownDrainTimeoutMs: GESAMTFRIST_MS } },
    stopQueue: orchestrator.stopQueue,
    exit: (code) => ausstiege.push(code),
    log: () => {},
    logError: () => {},
  });
  await gracefulShutdown("SIGTERM");
  assert.equal(bestellt.length, EIN_KAUF, "orderNumber nur fuer Nummer A");
  assert.equal(findNumber(NUMMER_A).status, NUMBER.ACTIVE);
  assert.equal(findNumber(NUMMER_B).status, NUMBER.REQUESTED);
  assert.equal(spur(NUMMER_B).status, JOB.QUEUED);
  assert.equal(await umgebung.queue.jobStatus(idB), JOB.QUEUED);
  assert.deepEqual(ausstiege, [EXIT_OK]);
});
