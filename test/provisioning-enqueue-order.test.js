import { test } from "node:test";
import assert from "node:assert/strict";
import { makeMemoryQueue } from "../src/queue/adapters/memory/queue.js";
import { makeProvisioningOrchestrator } from "../src/worker/provisioning-orchestrator.js";
import {
  makeDefaultState,
  recordProvisioningJob,
  markProvisioningJob,
  findNumber,
} from "../src/store/state-ops.js";
import { NUMBER_STATUS, PROVISIONING_JOB_STATUS } from "../src/store/defaults.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

function makeFakeStore(state, { failSaveOnce = false } = {}) {
  let failNextSave = failSaveOnce;
  return {
    load: () => state,
    save() {
      if (failNextSave) {
        failNextSave = false;
        throw new Error("EACCES: save fehlgeschlagen");
      }
    },
    async withStoreLock(fn) {
      const snapshot = [...state.provisioningJobs];
      try {
        return await fn();
      } catch (e) {
        state.provisioningJobs = snapshot;
        throw e;
      }
    },
  };
}

function fakeHandleProvisionJob(s, queuedJob) {
  const number = findNumber(s, queuedJob.payload.numberId);
  if (number && number.status === NUMBER_STATUS.REQUESTED) {
    number.status = NUMBER_STATUS.ACTIVE;
    number.e164 = "+4915799990000";
  }
  return { number };
}

function makeNumber(id, tenantId) {
  return { id, tenantId, status: NUMBER_STATUS.REQUESTED, e164: null, country: "DE" };
}

function meteringStub() {
  const laeufe = [];
  return {
    laeufe,
    recordNumberMonthMeter() {},
    recordDueNumberMonthMeters(_s, opts) {
      laeufe.push(opts);
      return { faellig: 0, gebucht: 0, ohnePreis: 0, fehler: 0 };
    },
  };
}

function makeOrchestrator(store, { paymentEnabled = false, metering = meteringStub() } = {}) {
  const queue = makeMemoryQueue();
  const orchestrator = makeProvisioningOrchestrator({
    store,
    config: withConfigNamespaces({ paymentEnabled }),
    queue,
    billing: {},
    metering,
    numberProvisioning: () => ({}),
    handleProvisionJob: fakeHandleProvisionJob,
    resolveProvisionRetry: () => ({ ok: false }),
    audit: () => {},
    recordProvisioningJob,
    markProvisioningJob,
    classifyQueuedProvisioningJobs: () => ({ close: [], hold: [], redrive: [] }),
    findNumber,
  });
  return { orchestrator, queue };
}

test("PA-2: kein enqueue vor persistierter Job-Spur - persist-Fehler wird nicht verwaist gekauft", async () => {
  const s = makeDefaultState();
  s.numbers = [makeNumber("num1", "t1"), makeNumber("num2", "t2")];
  const store = makeFakeStore(s, { failSaveOnce: true });
  const { orchestrator } = makeOrchestrator(store);

  const res1 = await orchestrator.queueProvisioning("num1", "t1");
  assert.equal(res1.ok, false, "persist-Fehler -> {ok:false}");
  assert.equal(
    s.provisioningJobs.find((j) => j.numberId === "num1"),
    undefined,
    "keine persistierte Job-Spur fuer num1 (rollback)",
  );

  const res2 = await orchestrator.queueProvisioning("num2", "t2");
  assert.equal(res2.ok, true, "zweiter Tenant persistiert -> {ok:true}");
  await orchestrator.runProvisioningDrainExclusive();

  assert.equal(findNumber(s, "num2").status, NUMBER_STATUS.ACTIVE, "num2 wurde gekauft");
  assert.equal(
    s.provisioningJobs.find((j) => j.numberId === "num2").status,
    PROVISIONING_JOB_STATUS.DONE,
    "num2-Job 'done'",
  );

  assert.equal(
    findNumber(s, "num1").status,
    NUMBER_STATUS.REQUESTED,
    "verwaiste num1 NICHT gekauft (nie enqueued)",
  );
  assert.equal(
    s.provisioningJobs.find((j) => j.numberId === "num1"),
    undefined,
    "verwaiste num1 hat keine Job-Spur",
  );
});

test("settleDueNumberMonthMeters wirft NIE (ein Store-Fehler beendet den stuendlichen Sweep nicht)", async () => {
  const s = makeDefaultState();
  const store = makeFakeStore(s);
  store.withStoreLock = async () => {
    throw new Error("Store nicht schreibbar");
  };
  const { orchestrator } = makeOrchestrator(store, { paymentEnabled: true });

  const res = await orchestrator.settleDueNumberMonthMeters();

  assert.deepEqual(res, { gebucht: 0 }, "der Fehler wird verschluckt, nicht geworfen");
});

test("settleDueNumberMonthMeters ist ohne PAYMENT_ENABLED ein No-op (kein Ledger-Schreiben)", async () => {
  const s = makeDefaultState();
  const metering = meteringStub();
  const { orchestrator } = makeOrchestrator(makeFakeStore(s), { metering });

  const res = await orchestrator.settleDueNumberMonthMeters();

  assert.deepEqual(res, { gebucht: 0 });
  assert.equal(metering.laeufe.length, 0, "das Metering-Modul wird gar nicht erst gerufen");
});

test("settleDueNumberMonthMeters reicht die tenantId des Abo-Ereignisses durch (null = alle)", async () => {
  const s = makeDefaultState();
  const metering = meteringStub();
  const { orchestrator } = makeOrchestrator(makeFakeStore(s), { paymentEnabled: true, metering });

  await orchestrator.settleDueNumberMonthMeters({ tenantId: "t1" });
  await orchestrator.settleDueNumberMonthMeters();

  assert.deepEqual(
    metering.laeufe.map((o) => o.tenantId),
    ["t1", null],
  );
  assert.ok(
    metering.laeufe.every((o) => typeof o.nowIso === "string"),
    "die Uhr wird vom Aufrufer gestellt und durchgereicht",
  );
});
