import { test } from "node:test";
import assert from "node:assert/strict";
import { makeMemoryQueue } from "../src/queue/adapters/memory/queue.js";
import { neueUhr, pgBossUmgebung } from "./gemeinsam/pgboss-umgebung.js";
import { handleProvisionJob } from "../src/worker/provisioning.js";
import { fakeProvisioner, fakeBilling } from "./helpers.js";
import {
  makeDefaultState,
  registerTenant,
  requestNumber,
  findNumber,
  recordProvisioningJob,
  setTenantStripe,
} from "../src/store/state-ops.js";
import {
  NUMBER_STATUS,
  PROVISION_NUMBER_JOB,
  PROVISIONING_JOB_STATUS,
} from "../src/store/defaults.js";

const CAPS = { maxNumbers: 5, maxNumbersPerTenant: 1 };
const ARGS = { countryCode: "DE", connectionId: "conn_1" };
const PAY_ARGS = { ...ARGS, holdAmountCents: 500, currency: "eur" };

function seedRequested() {
  const s = makeDefaultState();
  registerTenant(s, "t_user1");
  setTenantStripe(s, "t_user1", {
    customerId: "cus_1",
    paymentMethodId: "pm_1",
    paymentMethodType: "card",
  });
  const { number } = requestNumber(s, { tenantId: "t_user1", ...CAPS });
  return { s, numberId: number.id };
}

function drainWith(queue, s, deps, opts) {
  return queue.drain(async (queuedJob) => {
    const record = s.provisioningJobs.find((j) => j.idempotencyKey === queuedJob.idempotencyKey);
    try {
      await handleProvisionJob(s, queuedJob, deps, opts);
      if (record) record.status = PROVISIONING_JOB_STATUS.DONE;
    } catch (err) {
      if (record) record.status = PROVISIONING_JOB_STATUS.FAILED;
      throw err;
    }
  });
}

function enqueueProvision(queue, s, tenantId, numberId) {
  const idempotencyKey = `provision_${numberId}`;
  const queueJobId = queue.enqueue({
    kind: PROVISION_NUMBER_JOB,
    payload: { numberId },
    idempotencyKey,
  });
  const record = recordProvisioningJob(s, { numberId, tenantId, idempotencyKey });
  return { record, queueJobId };
}

test("enqueue -> drain -> active: Number aktiv, e164 gesetzt, assignment + Job 'done'", async () => {
  const { s, numberId } = seedRequested();
  const queue = makeMemoryQueue();
  const prov = fakeProvisioner();
  const billing = fakeBilling();
  const { record, queueJobId } = enqueueProvision(queue, s, "t_user1", numberId);

  const processed = await drainWith(queue, s, { provisioner: prov, billing }, PAY_ARGS);

  assert.equal(processed, 1);
  const num = findNumber(s, numberId);
  assert.equal(num.status, NUMBER_STATUS.ACTIVE);
  assert.equal(num.e164, "+4915799990001");
  assert.ok(
    s.numberAssignments.find((a) => a.numberId === numberId && !a.releasedAt),
    "assignment angelegt",
  );
  assert.equal(
    s.provisioningJobs.find((j) => j.id === record.id).status,
    PROVISIONING_JOB_STATUS.DONE,
  );
  assert.equal(queue.jobStatus(queueJobId), PROVISIONING_JOB_STATUS.DONE, "Adapter-Job 'done'");
});

test("Worker nur fuer 'requested': andere Zustaende -> skipped, KEIN Provider-Call", async () => {
  const { s, numberId } = seedRequested();
  const prov = fakeProvisioner();
  await handleProvisionJob(s, { payload: { numberId } }, { provisioner: prov }, ARGS);
  prov.log.length = 0;

  const result = await handleProvisionJob(
    s,
    { payload: { numberId } },
    { provisioner: prov },
    ARGS,
  );

  assert.deepEqual(result, { skipped: true, status: NUMBER_STATUS.ACTIVE });
  assert.deepEqual(prov.log, [], "kein Provider-Call fuer eine nicht-requested Number");
});

test("Idempotenz: doppeltes enqueue = ein Job; zweiter drain ist No-op (kein Doppelkauf)", async () => {
  const { s, numberId } = seedRequested();
  const queue = makeMemoryQueue();
  const prov = fakeProvisioner();
  const idempotencyKey = `provision_${numberId}`;
  const id1 = queue.enqueue({ kind: PROVISION_NUMBER_JOB, payload: { numberId }, idempotencyKey });
  const id2 = queue.enqueue({ kind: PROVISION_NUMBER_JOB, payload: { numberId }, idempotencyKey });
  assert.equal(id1, id2, "gleicher idempotencyKey -> derselbe Job (kein Duplikat)");
  recordProvisioningJob(s, { numberId, tenantId: "t_user1", idempotencyKey });

  await drainWith(queue, s, { provisioner: prov }, ARGS);
  const processedAgain = await drainWith(queue, s, { provisioner: prov }, ARGS);

  assert.equal(processedAgain, 0, "Job ist 'done' -> drain verarbeitet ihn nicht erneut");
  assert.equal(prov.log.filter((l) => l.startsWith("order")).length, 1, "order GENAU einmal");
  assert.equal(s.provisioningJobs.length, 1, "nur ein persistenter Job-Record");
});

const KEIN_TEXT = 7;

test("Queue: enqueue ohne, mit leerem oder mit nicht-textlichem idempotencyKey wird abgewiesen statt still verworfen", async () => {
  const queue = makeMemoryQueue();
  const ohneSchluessel = { kind: PROVISION_NUMBER_JOB, payload: { numberId: "num_a" } };
  const abgewiesen = { name: "TypeError", message: /idempotencyKey/ };
  assert.throws(() => queue.enqueue(ohneSchluessel), abgewiesen);
  assert.throws(() => queue.enqueue({ ...ohneSchluessel, idempotencyKey: "" }), abgewiesen);
  assert.throws(() => queue.enqueue({ ...ohneSchluessel, idempotencyKey: KEIN_TEXT }), abgewiesen);

  const jobId = queue.enqueue({ ...ohneSchluessel, idempotencyKey: "provision_num_a" });
  const verarbeitet = [];
  await queue.drain((job) => verarbeitet.push(job.id));
  assert.deepEqual(verarbeitet, [jobId], "nur der Job mit Schluessel liegt in der Queue");
  assert.match(jobId, /^job_[0-9a-z]+$/, "Kennung: Praefix job_ und Suffix ohne Punkt");
});

test("Fehler -> Rollback im Worker: captureHold wirft -> released, cancelHold, Job 'failed'", async () => {
  const { s, numberId } = seedRequested();
  const queue = makeMemoryQueue();
  const prov = fakeProvisioner();
  const billing = fakeBilling({
    async captureHold() {
      throw new Error("HTTP 500");
    },
  });
  const { record } = enqueueProvision(queue, s, "t_user1", numberId);

  await drainWith(queue, s, { provisioner: prov, billing }, PAY_ARGS);

  assert.equal(
    findNumber(s, numberId).status,
    NUMBER_STATUS.RELEASED,
    "gekaufte Nummer freigegeben",
  );
  assert.ok(prov.log.includes("release:num_ext_1"), "Provider-Release");
  assert.ok(
    billing.log.some((e) => e[0] === "cancelHold"),
    "Hold freigegeben",
  );
  assert.equal(
    s.provisioningJobs.find((j) => j.id === record.id).status,
    PROVISIONING_JOB_STATUS.FAILED,
  );
});

test("payment-off byte-identisch: ohne billing -> active, kein Hold/Capture", async () => {
  const { s, numberId } = seedRequested();
  const queue = makeMemoryQueue();
  const prov = fakeProvisioner();
  enqueueProvision(queue, s, "t_user1", numberId);

  await drainWith(queue, s, { provisioner: prov }, ARGS);

  const num = findNumber(s, numberId);
  assert.equal(num.status, NUMBER_STATUS.ACTIVE);
  assert.equal(num.paymentIntentId, null, "kein PI ohne billing");
  assert.deepEqual(prov.log, ["search:DE", `order:+4915799990001:order_${numberId}`]);
});

test("K1-7: nach Absturz nach dem Kauf stellt pg-boss den Auftrag erneut zu, der Marker verhindert den zweiten Kauf", async (t) => {
  const clock = neueUhr();
  const umgebung = await pgBossUmgebung(t, { clock });
  const { db, queue } = umgebung;
  const { s, numberId } = seedRequested();
  const prov = fakeProvisioner();
  const idempotencyKey = `provision_${numberId}`;
  const queueId = await queue.enqueue({
    kind: PROVISION_NUMBER_JOB,
    payload: { numberId },
    idempotencyKey,
  });
  recordProvisioningJob(s, { numberId, tenantId: "t_user1", idempotencyKey });
  const kaufen = (job) =>
    handleProvisionJob(s, job, { provisioner: prov, billing: fakeBilling() }, PAY_ARGS);

  await queue.drain(kaufen);
  assert.equal(findNumber(s, numberId).status, NUMBER_STATUS.ACTIVE);
  await db.abfragen(
    "UPDATE pgboss.job SET state = 'active', completed_on = NULL, started_on = to_timestamp($1 / 1000.0) WHERE name = $2",
    [clock.now(), PROVISION_NUMBER_JOB],
  );
  await clock.tick(30 * 60 * 1000);
  const ergebnisse = [];
  const verarbeitet = await queue.drain(async (job) => ergebnisse.push(await kaufen(job)));

  assert.equal(verarbeitet, 1, "der Auftrag wird nach dem Absturz erneut zugestellt");
  assert.deepEqual(ergebnisse, [{ skipped: true, status: NUMBER_STATUS.ACTIVE }]);
  assert.equal(prov.orderCalls.length, 1, "Nummernkauf genau einmal");
  assert.equal(await queue.jobStatus(queueId), PROVISIONING_JOB_STATUS.DONE);
});

test("K1-8: ein erneutes enqueue nach erledigtem Auftrag kauft keine zweite Nummer", async (t) => {
  const umgebung = await pgBossUmgebung(t);
  const { queue } = umgebung;
  const { s, numberId } = seedRequested();
  const prov = fakeProvisioner();
  const idempotencyKey = `provision_${numberId}`;
  recordProvisioningJob(s, { numberId, tenantId: "t_user1", idempotencyKey });
  const auftrag = { kind: PROVISION_NUMBER_JOB, payload: { numberId }, idempotencyKey };
  const kaufen = (job) =>
    handleProvisionJob(s, job, { provisioner: prov, billing: fakeBilling() }, PAY_ARGS);

  await queue.enqueue(auftrag);
  await queue.drain(kaufen);
  await queue.enqueue(auftrag);
  await queue.drain(kaufen);

  assert.equal(prov.orderCalls.length, 1, "Nummernkauf genau einmal");
});
