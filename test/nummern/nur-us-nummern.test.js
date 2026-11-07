import { test } from "node:test";
import assert from "node:assert/strict";
import { makePgTestStore } from "../pg-helpers.js";
import { createQueue } from "../../src/queue/registry.js";
import { makeProvisioningOrchestrator } from "../../src/worker/provisioning-orchestrator.js";
import { handleProvisionJob } from "../../src/worker/provisioning.js";
import { config } from "../../src/config.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";

const PLATTFORMLAND = "DE";
const KAUFLAND = "US";
const NUMMER = { ANGEFRAGT: "requested", AKTIV: "active" };
const TENANT = "t_nur_us";
const NUMMER_ID = "num_nur_us";
const AUFTRAGSART = "provision_number";
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

function orchestratorFuer(store, queue, anbieter) {
  return makeProvisioningOrchestrator({
    store,
    config: withConfigNamespaces({ paymentEnabled: false }),
    queue,
    billing: {},
    metering: { recordNumberMonthMeter() {}, recordDueNumberMonthMeters: () => ({}) },
    numberProvisioning: () => anbieter,
    handleProvisionJob,
    resolveProvisionRetry: () => ({ ok: false }),
    audit: () => {},
    recordProvisioningJob: () => null,
    markProvisioningJob: () => null,
    classifyQueuedProvisioningJobs: () => ({ close: [], hold: [], redrive: [] }),
    findNumber,
  });
}

for (const land of ANGEFRAGTE_LAENDER) {
  test(`Hintergrundkauf sucht fuer Nummer mit Land ${land ?? "(leer)"} bei Plattformland DE nur in US`, async () => {
    const vorher = config.provisioning.provisioningCountry;
    config.provisioning.provisioningCountry = PLATTFORMLAND;
    try {
      const { store } = await makePgTestStore();
      await store.ensureTenant(TENANT);
      const state = store.load();
      state.numbers.push({
        id: NUMMER_ID,
        tenantId: TENANT,
        status: NUMMER.ANGEFRAGT,
        e164: null,
        country: land,
      });
      const queue = createQueue();
      queue.enqueue({
        kind: AUFTRAGSART,
        payload: { numberId: NUMMER_ID },
        idempotencyKey: `provision_${NUMMER_ID}`,
      });
      const anbieter = attrappe();

      await orchestratorFuer(store, queue, anbieter).runProvisioningDrainExclusive();

      assert.deepEqual(anbieter.suchen, [KAUFLAND], "genau eine Suche, nur im Kaufland");
      assert.deepEqual(anbieter.bestellungen, ["+12025550100"]);
      assert.equal(findNumber(state, NUMMER_ID).status, NUMMER.AKTIV);
    } finally {
      config.provisioning.provisioningCountry = vorher;
    }
  });
}
