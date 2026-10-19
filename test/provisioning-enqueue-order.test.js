import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { makeMemoryQueue } from "../src/queue/adapters/memory/queue.js";
import { makeProvisioningOrchestrator } from "../src/worker/provisioning-orchestrator.js";
import {
  makeDefaultState,
  recordProvisioningJob,
  markProvisioningJob,
  findNumber,
} from "../src/store/state-ops.js";
import {
  NUMBER_STATUS,
  PROVIDER,
  PROVISION_NUMBER_JOB,
  PROVISIONING_JOB_STATUS,
} from "../src/store/defaults.js";
import { config } from "../src/config.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

function makeFakeStore(state, { failSaveOnce = false } = {}) {
  let failNextSave = failSaveOnce;
  const saves = [];
  return {
    saves,
    load: () => state,
    save() {
      saves.push(state.provisioningJobs.map((job) => job.status));
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
  const belege = [];
  return {
    laeufe,
    belege,
    recordNumberMonthMeter(number, nowIso) {
      belege.push([number, nowIso]);
    },
    recordDueNumberMonthMeters(_s, opts) {
      laeufe.push(opts);
      return { faellig: 0, gebucht: 0, ohnePreis: 0, fehler: 0 };
    },
  };
}

const SETUP_FEE_CENTS = 1500;

function localNumberSearch(countryCode) {
  return { countryCode, connectionId: config.telephony.telnyxConnectionId, type: "local" };
}

function recordedCalls(handler) {
  return handler.mock.calls.map(({ arguments: [, queuedJob, deps, opts] }) => ({
    numberId: queuedJob.payload.numberId,
    deps,
    opts,
  }));
}

function withNumbers(...numbers) {
  const s = makeDefaultState();
  s.numbers = numbers;
  return s;
}

function silenceErrors(t) {
  return t.mock.method(console, "error", () => {}).mock;
}

function loggedErrors(errorMock) {
  return errorMock.calls.map((call) => call.arguments.join(" "));
}

function jobOf(s, numberId) {
  return s.provisioningJobs.find((j) => j.numberId === numberId);
}

function makeOrchestrator(
  store,
  {
    paymentEnabled = false,
    metering = meteringStub(),
    handleProvisionJob = fakeHandleProvisionJob,
    billing = {},
    numberProvisioning = () => ({}),
  } = {},
) {
  const queue = makeMemoryQueue();
  const orchestrator = makeProvisioningOrchestrator({
    store,
    config: withConfigNamespaces({
      paymentEnabled,
      numberSetupFeeCents: SETUP_FEE_CENTS,
      paymentCurrency: "usd",
    }),
    queue,
    billing,
    metering,
    numberProvisioning,
    handleProvisionJob,
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

test("Drain mit PAYMENT_ENABLED reicht Billing, den Hold des Landes und die Waehrung an den Kauf", async () => {
  const s = withNumbers(
    { ...makeNumber("num-fr", "t1"), country: "FR" },
    { ...makeNumber("num-us", "t2"), country: "US" },
  );
  const handler = mock.fn(fakeHandleProvisionJob);
  const billing = { name: "billing" };
  const provisioner = { name: "telnyx" };
  const providers = [];
  const { orchestrator } = makeOrchestrator(makeFakeStore(s), {
    paymentEnabled: true,
    billing,
    handleProvisionJob: handler,
    numberProvisioning: (provider) => {
      providers.push(provider);
      return provisioner;
    },
  });

  await orchestrator.queueProvisioning("num-fr", "t1");
  await orchestrator.queueProvisioning("num-us", "t2");
  await orchestrator.runProvisioningDrainExclusive();

  assert.deepEqual(providers, [PROVIDER.TELNYX]);
  const calls = recordedCalls(handler);
  assert.deepEqual(
    calls.map(({ numberId, opts }) => [numberId, opts]),
    [
      [
        "num-fr",
        { ...localNumberSearch("FR"), holdAmountCents: SETUP_FEE_CENTS, currency: "usd" },
      ],
      [
        "num-us",
        { ...localNumberSearch("US"), holdAmountCents: SETUP_FEE_CENTS, currency: "usd" },
      ],
    ],
  );
  for (const { deps } of calls) {
    assert.equal(deps.billing, billing, "der Kauf haelt den Betrag ueber das Billing");
    assert.equal(deps.provisioner, provisioner);
  }
});

test("Drain ohne PAYMENT_ENABLED kauft ohne Billing, ohne Hold und ohne Waehrung", async () => {
  const s = withNumbers({ ...makeNumber("num-fr", "t1"), country: "FR" });
  const handler = mock.fn(fakeHandleProvisionJob);
  const { orchestrator } = makeOrchestrator(makeFakeStore(s), { handleProvisionJob: handler });

  await orchestrator.queueProvisioning("num-fr", "t1");
  await orchestrator.runProvisioningDrainExclusive();

  const calls = recordedCalls(handler);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].opts, localNumberSearch("FR"));
  assert.equal("billing" in calls[0].deps, false, "ohne Zahlpflicht wird kein Betrag gehalten");
  assert.equal(findNumber(s, "num-fr").status, NUMBER_STATUS.ACTIVE);
});

test("Monatsbeleg nur fuer die neu aktivierte Nummer und nur mit PAYMENT_ENABLED", async () => {
  const bezahlt = withNumbers(makeNumber("num1", "t1"));
  const meteringBezahlt = meteringStub();
  const vorher = Date.now();
  const bezahlter = makeOrchestrator(makeFakeStore(bezahlt), {
    paymentEnabled: true,
    metering: meteringBezahlt,
  });
  await bezahlter.orchestrator.queueProvisioning("num1", "t1");
  await bezahlter.orchestrator.runProvisioningDrainExclusive();

  assert.equal(meteringBezahlt.belege.length, 1);
  const [nummer, nowIso] = meteringBezahlt.belege[0];
  assert.equal(nummer, findNumber(bezahlt, "num1"));
  assert.equal(nummer.status, NUMBER_STATUS.ACTIVE);
  assert.ok(
    Date.parse(nowIso) >= vorher && Date.parse(nowIso) <= Date.now(),
    "Beleg traegt die Kaufzeit",
  );
  assert.equal(jobOf(bezahlt, "num1").status, PROVISIONING_JOB_STATUS.DONE);

  const frei = withNumbers(makeNumber("num1", "t1"));
  const meteringFrei = meteringStub();
  const freier = makeOrchestrator(makeFakeStore(frei), { metering: meteringFrei });
  await freier.orchestrator.queueProvisioning("num1", "t1");
  await freier.orchestrator.runProvisioningDrainExclusive();

  assert.deepEqual(meteringFrei.belege, [], "ohne Zahlpflicht kein Monatsbeleg");
  assert.equal(findNumber(frei, "num1").status, NUMBER_STATUS.ACTIVE);
});

test("Uebersprungener Job (Nummer schon aktiv oder weg) bucht keinen Monatsbeleg und wird done", async () => {
  const s = withNumbers({
    ...makeNumber("num-aktiv", "t1"),
    status: NUMBER_STATUS.ACTIVE,
    e164: "+4915700000001",
  });
  const metering = meteringStub();
  const store = makeFakeStore(s);
  const { orchestrator } = makeOrchestrator(store, {
    paymentEnabled: true,
    metering,
    handleProvisionJob: async () => ({ skipped: true }),
  });

  await orchestrator.queueProvisioning("num-aktiv", "t1");
  await orchestrator.queueProvisioning("num-weg", "t1");
  await orchestrator.runProvisioningDrainExclusive();

  assert.deepEqual(metering.belege, [], "der Monatsbeleg wird gar nicht erst aufgerufen");
  assert.equal(jobOf(s, "num-aktiv").status, PROVISIONING_JOB_STATUS.DONE);
  assert.equal(jobOf(s, "num-weg").status, PROVISIONING_JOB_STATUS.DONE);
  assert.deepEqual(store.saves.at(-1), [
    PROVISIONING_JOB_STATUS.DONE,
    PROVISIONING_JOB_STATUS.DONE,
  ]);
  assert.equal(findNumber(s, "num-aktiv").e164, "+4915700000001");
});

test("Fehlerpfad des Kaufs: Job failed mit Grund, gespeichert, Queue-Job failed, kein Monatsbeleg", async (t) => {
  const errors = silenceErrors(t);
  const s = withNumbers(makeNumber("num1", "t1"));
  const metering = meteringStub();
  const store = makeFakeStore(s);
  const { orchestrator, queue } = makeOrchestrator(store, {
    paymentEnabled: true,
    metering,
    handleProvisionJob: () => {
      throw new Error("Telnyx 402: Guthaben leer");
    },
  });

  await orchestrator.queueProvisioning("num1", "t1");
  await orchestrator.runProvisioningDrainExclusive();

  const job = jobOf(s, "num1");
  assert.equal(job.status, PROVISIONING_JOB_STATUS.FAILED);
  assert.equal(job.lastError, "Telnyx 402: Guthaben leer");
  assert.deepEqual(
    store.saves.at(-1),
    [PROVISIONING_JOB_STATUS.FAILED],
    "der Fehlschlag wird gespeichert",
  );
  const queueId = queue.enqueue({
    kind: PROVISION_NUMBER_JOB,
    payload: {},
    idempotencyKey: job.idempotencyKey,
  });
  assert.equal(
    queue.jobStatus(queueId),
    PROVISIONING_JOB_STATUS.FAILED,
    "der Fehler erreicht die Queue",
  );
  assert.deepEqual(metering.belege, []);
  assert.deepEqual(loggedErrors(errors), ["[provision-worker] Telnyx 402: Guthaben leer"]);
});

test("Queue-Job ohne Job-Spur: Kauf laeuft durch, ein Kauffehler wird mit seinem Grund gemeldet", async (t) => {
  const errors = silenceErrors(t);
  const s = withNumbers(makeNumber("num1", "t1"), makeNumber("num2", "t1"));
  const { orchestrator, queue } = makeOrchestrator(makeFakeStore(s), {
    handleProvisionJob: (state, queuedJob) => {
      if (queuedJob.payload.numberId === "num2") throw new Error("Telnyx 500");
      return fakeHandleProvisionJob(state, queuedJob);
    },
  });

  const ok = queue.enqueue({
    kind: PROVISION_NUMBER_JOB,
    payload: { numberId: "num1" },
    idempotencyKey: "ohne_spur_1",
  });
  const kaputt = queue.enqueue({
    kind: PROVISION_NUMBER_JOB,
    payload: { numberId: "num2" },
    idempotencyKey: "ohne_spur_2",
  });
  await orchestrator.runProvisioningDrainExclusive();

  assert.equal(queue.jobStatus(ok), PROVISIONING_JOB_STATUS.DONE);
  assert.equal(findNumber(s, "num1").status, NUMBER_STATUS.ACTIVE);
  assert.equal(queue.jobStatus(kaputt), PROVISIONING_JOB_STATUS.FAILED);
  assert.deepEqual(loggedErrors(errors), ["[provision-worker] Telnyx 500"]);
});

test("Wurf im Monatsbeleg laesst den Job der gekauften Nummer done", async (t) => {
  const errors = silenceErrors(t);
  const s = withNumbers(makeNumber("num1", "t1"));
  const store = makeFakeStore(s);
  const metering = meteringStub();
  metering.recordNumberMonthMeter = () => {
    throw new Error("Ledger nicht schreibbar");
  };
  const { orchestrator, queue } = makeOrchestrator(store, { paymentEnabled: true, metering });

  await orchestrator.queueProvisioning("num1", "t1");
  await orchestrator.runProvisioningDrainExclusive();

  const job = jobOf(s, "num1");
  assert.equal(findNumber(s, "num1").status, NUMBER_STATUS.ACTIVE, "die Nummer ist gekauft");
  assert.equal(job.status, PROVISIONING_JOB_STATUS.DONE);
  assert.equal(job.lastError, null, "der Kauf traegt keinen Fehlergrund");
  assert.deepEqual(store.saves.at(-1), [PROVISIONING_JOB_STATUS.DONE]);
  const queueId = queue.enqueue({
    kind: PROVISION_NUMBER_JOB,
    payload: {},
    idempotencyKey: job.idempotencyKey,
  });
  assert.equal(queue.jobStatus(queueId), PROVISIONING_JOB_STATUS.DONE);
  assert.deepEqual(loggedErrors(errors), [
    "[provision-worker] Monatsbeleg fehlgeschlagen: Ledger nicht schreibbar",
  ]);
});
