import { test } from "node:test";
import assert from "node:assert/strict";
import { createQueue } from "../../src/queue/registry.js";
import { makeProvisioningOrchestrator } from "../../src/worker/provisioning-orchestrator.js";
import { handleProvisionJob } from "../../src/worker/provisioning.js";
import { config } from "../../src/config.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";

const PLATTFORMLAND = "DE";
const KAUFLAND = "US";
const NUMMER = { ANGEFRAGT: "requested", AKTIV: "active" };
const JOB_ERLEDIGT = "done";
const ANGEFRAGTE_LAENDER = ["DE", "FR", "CA", "XX", undefined];

function attrappe() {
  const suchen = [];
  const bestellungen = [];
  return {
    suchen,
    bestellungen,
    async searchNumbers({ countryCode }) {
      suchen.push(countryCode);
      return [{ e164: "+12025550100" }];
    },
    async orderNumber({ e164 }) {
      bestellungen.push(e164);
      return { e164, providerNumberId: "num_ext_1" };
    },
  };
}

const findNumber = (state, id) => state.numbers.find((nummer) => nummer.id === id) ?? null;

function recordProvisioningJob(state, { numberId, tenantId, idempotencyKey }) {
  const job = { id: `job_${numberId}`, numberId, tenantId, idempotencyKey, status: "queued" };
  state.provisioningJobs.push(job);
  return job;
}

function markProvisioningJob(state, jobId, status) {
  state.provisioningJobs.find((job) => job.id === jobId).status = status;
}

function speicher(state) {
  return {
    load: () => state,
    save() {},
    withStoreLock: async (fn) => fn(),
  };
}

function orchestratorFuer(state, anbieter) {
  return makeProvisioningOrchestrator({
    store: speicher(state),
    config: withConfigNamespaces({ paymentEnabled: false }),
    queue: createQueue(),
    billing: {},
    metering: { recordNumberMonthMeter() {}, recordDueNumberMonthMeters: () => ({}) },
    numberProvisioning: () => anbieter,
    handleProvisionJob,
    resolveProvisionRetry: () => ({ ok: false }),
    audit: () => {},
    recordProvisioningJob,
    markProvisioningJob,
    classifyQueuedProvisioningJobs: () => ({ close: [], hold: [], redrive: [] }),
    findNumber,
  });
}

for (const land of ANGEFRAGTE_LAENDER) {
  test(`Hintergrundkauf sucht fuer Nummer mit Land ${land ?? "(leer)"} bei Plattformland DE nur in US`, async () => {
    const vorher = config.provisioning.provisioningCountry;
    config.provisioning.provisioningCountry = PLATTFORMLAND;
    try {
      const state = { numberAssignments: [], provisioningJobs: [] };
      state.numbers = [
        { id: "num1", tenantId: "t1", status: NUMMER.ANGEFRAGT, e164: null, country: land },
      ];
      const anbieter = attrappe();
      const orchestrator = orchestratorFuer(state, anbieter);

      await orchestrator.queueProvisioning("num1", "t1");
      await orchestrator.runProvisioningDrainExclusive();

      assert.deepEqual(anbieter.suchen, [KAUFLAND], "genau eine Suche, nur im Kaufland");
      assert.deepEqual(anbieter.bestellungen, ["+12025550100"]);
      assert.equal(findNumber(state, "num1").status, NUMMER.AKTIV);
      assert.equal(state.provisioningJobs[0].status, JOB_ERLEDIGT);
    } finally {
      config.provisioning.provisioningCountry = vorher;
    }
  });
}
