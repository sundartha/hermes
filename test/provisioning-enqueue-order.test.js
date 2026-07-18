// PA-2 / S1-2 (Money-Path, PROV-01-Familie): queueProvisioning reiht einen Provisioning-Job
// NIEMALS in die Queue, bevor die Job-Spur (s.provisioningJobs) persistiert ist. Stand das
// enqueue davor, kaufte ein spaeterer Fremd-Drain (anderer Tenant) den verwaisten Queue-Job
// auch bei gescheiterter Persistenz -> aktivierte Nummer (echtes Geld) OHNE provisioningJobs-
// Spur, die reconcileOrphanedProvisioning nie klassifizieren kann.
//
// Reiner Unit-Test: makeProvisioningOrchestrator direkt instanziert, Fake-Store mit
// Transaktions-Semantik (ein gescheitertes save() rollt den provisioningJobs-Push zurueck -
// genau die Persist-Grenze, die der pg-Backend real durchsetzt: kein Record ohne Commit) +
// die REALE In-Memory-Queue (deterministisch, kein Timer). handleProvisionJob ist gefaked und
// simuliert den Kauf (Nummer -> active). Kein Netz, kein Server, kein pglite.
//
// ROT-VOR-FIX: OHNE den enqueue-nach-Persistenz-Fix kauft der Drain des zweiten (erfolgreichen)
// Tenants den verwaisten num1-Job mit -> num1.status === "active" UND keine num1-Job-Spur.
// MIT Fix bleibt num1 "requested" (nie enqueued).
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

// Fake-Store: load() liefert den geteilten State (wie der json-Backend). withStoreLock
// schnappschusst provisioningJobs VOR dem Body und rollt bei einem Body-Fehler (z.B. ein
// save-Wurf) zurueck -> Transaktions-Semantik: kein Teil-Record ohne erfolgreichen Commit.
// failSaveOnce laesst GENAU den ersten save() werfen (Persist-Fehler des ersten Tenants).
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
        state.provisioningJobs = snapshot; // Rollback: keine unpersistierte Job-Spur
        throw e;
      }
    },
  };
}

// Gefakter Kauf-Worker: markiert eine 'requested'-Nummer als 'active' (im Realbetrieb ein
// echter Telnyx-Kauf + Hold/Capture). Liefert { number } wie handleProvisionJob.
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

// Orchestrator mit den fuer den queueProvisioning/Drain-Pfad noetigen Deps. paymentEnabled:
// false -> billing/metering werden nie gerufen (die Enqueue-Order-Invariante ist zahlungs-
// unabhaengig). Der Rest der Factory-Deps (trigger/reconcile) wird auf diesem Pfad nicht
// gerufen; Minimal-Stubs dokumentieren nur den Seam.
function makeOrchestrator(store) {
  const queue = makeMemoryQueue();
  const orchestrator = makeProvisioningOrchestrator({
    store,
    config: withConfigNamespaces({ paymentEnabled: false }),
    queue,
    billing: {},
    metering: { recordNumberMonthMeter() {} },
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

  // Tenant 1: Persistenz scheitert (erster save wirft) -> {ok:false}. Der reale Aufrufer
  // (api-onboard) triggert bei {ok:false} KEINEN Drain.
  const res1 = await orchestrator.queueProvisioning("num1", "t1");
  assert.equal(res1.ok, false, "persist-Fehler -> {ok:false}");
  assert.equal(
    s.provisioningJobs.find((j) => j.numberId === "num1"),
    undefined,
    "keine persistierte Job-Spur fuer num1 (rollback)",
  );

  // Tenant 2: erfolgreiche Persistenz -> {ok:true}; der Aufrufer stoesst den Drain an.
  const res2 = await orchestrator.queueProvisioning("num2", "t2");
  assert.equal(res2.ok, true, "zweiter Tenant persistiert -> {ok:true}");
  await orchestrator.runProvisioningDrainExclusive();

  // Beweis, dass der Drain wirklich lief (sonst waere num1='requested' ein Fehl-Gruen):
  assert.equal(findNumber(s, "num2").status, NUMBER_STATUS.ACTIVE, "num2 wurde gekauft");
  assert.equal(
    s.provisioningJobs.find((j) => j.numberId === "num2").status,
    PROVISIONING_JOB_STATUS.DONE,
    "num2-Job 'done'",
  );

  // KERN-INVARIANTE (rot OHNE Fix: num1.status === 'active' UND keine Job-Spur):
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
