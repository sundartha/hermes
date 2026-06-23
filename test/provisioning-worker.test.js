// Provisioning-Worker (handleProvisionJob) + In-Memory-Queue-Adapter (P6b2): reine
// State-Machine + injizierte Fakes (DIP) - kein Netz, kein Server, kein pglite
// (eigene Datei gegen Worker-Stall, Lehre P6a). Prueft die Spec-Invarianten des
// async Pfads: enqueue+drain -> active; Worker nur fuer 'requested'; Idempotenz
// (kein Doppelkauf); Fehler -> Rollback im Worker; payment-off byte-identisch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeMemoryQueue } from "../src/queue/adapters/memory/queue.js";
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

// seedet einen Tenant MIT hinterlegter Karte (Pay2: der billing-Pfad ist ohne Karte
// fail-closed). Im payment-off-Pfad (kein billing) ist die Karte irrelevant.
function seedRequested() {
  const s = makeDefaultState();
  registerTenant(s, "t_user1");
  setTenantStripe(s, "t_user1", { customerId: "cus_1", paymentMethodId: "pm_1" });
  const { number } = requestNumber(s, { tenantId: "t_user1", ...CAPS });
  return { s, numberId: number.id };
}

// Reicht die enqueued Jobs an handleProvisionJob durch + markiert die persistente
// Job-Spur (wie runProvisioningDrain in server.js, ohne store.save). drain wirft
// NICHT (Adapter faengt handler-Fehler) -> der Test prueft den Fachzustand.
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
  // Number ist bereits active (nicht mehr 'requested') -> Worker darf NICHT kaufen.
  await handleProvisionJob(s, { payload: { numberId } }, { provisioner: prov }, ARGS); // erster Lauf -> active
  prov.log.length = 0; // Log fuer den zweiten Lauf leeren

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

  await drainWith(queue, s, { provisioner: prov }, ARGS); // kauft (requested -> active)
  const processedAgain = await drainWith(queue, s, { provisioner: prov }, ARGS); // re-drain

  assert.equal(processedAgain, 0, "Job ist 'done' -> drain verarbeitet ihn nicht erneut");
  assert.equal(prov.log.filter((l) => l.startsWith("order")).length, 1, "order GENAU einmal");
  assert.equal(s.provisioningJobs.length, 1, "nur ein persistenter Job-Record");
});

test("Fehler -> Rollback im Worker: configure wirft -> released, cancelHold, Job 'failed'", async () => {
  const { s, numberId } = seedRequested();
  const queue = makeMemoryQueue();
  const prov = fakeProvisioner({
    async configureNumber() {
      throw new Error("HTTP 500");
    },
  });
  const billing = fakeBilling();
  const { record } = enqueueProvision(queue, s, "t_user1", numberId);

  await drainWith(queue, s, { provisioner: prov, billing }, PAY_ARGS);

  // Hold-vor-Order + Rollback gelten jetzt im Worker (provisionNumber unveraendert).
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

  await drainWith(queue, s, { provisioner: prov }, ARGS); // deps ohne billing

  const num = findNumber(s, numberId);
  assert.equal(num.status, NUMBER_STATUS.ACTIVE);
  assert.equal(num.paymentIntentId, null, "kein PI ohne billing");
  assert.deepEqual(prov.log, [
    "search:DE",
    `order:+4915799990001:order_${numberId}`,
    "configure:num_ext_1:conn_1",
  ]);
});
