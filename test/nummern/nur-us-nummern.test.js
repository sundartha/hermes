import { test } from "node:test";
import assert from "node:assert/strict";
import { makePgTestStore } from "../pg-helpers.js";
import { createQueue } from "../../src/queue/registry.js";
import { makeProvisioningOrchestrator } from "../../src/worker/provisioning-orchestrator.js";
import { handleProvisionJob } from "../../src/worker/provisioning.js";
import { numberProvisioning } from "../../src/telephony/registry.js";
import { PAYMENT_METHOD_TYPE_CARD } from "../../src/billing/payment-method-eligibility.ts";
import { config } from "../../src/config.js";
import { withFetch } from "../helpers.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";

const PLATTFORMLAND = "DE";
const KAUFLAND = "US";
const NUMMER = { ANGEFRAGT: "requested", AKTIV: "active" };
const NUMMER_FEHLGESCHLAGEN = "failed";
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

const NICHT_KAUFBAR = { land: "DE", nummer: "+4915799990001" };
const SPERR_TENANT = "t_sperre";
const KAUF_ARGUMENTE = { connectionId: "conn_sperre", holdAmountCents: 500, currency: "eur" };

async function ohneHttp(run) {
  const anfragen = [];
  const vorher = { ...config.telephony };
  config.telephony.telnyxApiKey = "KEYtest-nur-us-sperre";
  config.telephony.telnyxApiBase = "https://telnyx.test";
  try {
    await withFetch((url) => {
      anfragen.push(String(url));
      return Promise.reject(new Error("unerwartete HTTP-Anfrage an Telnyx"));
    }, run);
  } finally {
    Object.assign(config.telephony, vorher);
  }
  return anfragen;
}

async function zahlenderMandantMitNummer() {
  const { store } = await makePgTestStore();
  const state = store.load();
  state.tenants.push({
    id: SPERR_TENANT,
    stripeCustomerId: "cus_sperre",
    stripePaymentMethodId: "pm_sperre",
    stripePaymentMethodType: PAYMENT_METHOD_TYPE_CARD,
  });
  state.numbers.push({
    id: NUMMER_ID,
    tenantId: SPERR_TENANT,
    status: NUMMER.ANGEFRAGT,
    e164: null,
    country: KAUFLAND,
  });
  return { state, numberId: NUMMER_ID };
}

function abrechnungsAttrappe() {
  const holds = [];
  return {
    holds,
    async placeHold(auftrag) {
      holds.push(auftrag);
      return { paymentIntentId: "pi_sperre" };
    },
    async cancelHold() {},
    async captureHold() {},
  };
}

test("Nummernkauf direkt mit Land DE: searchNumbers scheitert mit dem Land und ohne HTTP-Anfrage", async () => {
  const anfragen = await ohneHttp(() =>
    assert.rejects(numberProvisioning().searchNumbers({ countryCode: NICHT_KAUFBAR.land }), /DE/),
  );
  assert.deepEqual(anfragen, []);
});

test("Nummernkauf direkt mit +49-Nummer: orderNumber scheitert mit dem Land und ohne HTTP-Anfrage", async () => {
  const anfragen = await ohneHttp(() =>
    assert.rejects(numberProvisioning().orderNumber({ e164: NICHT_KAUFBAR.nummer }), /DE/),
  );
  assert.deepEqual(anfragen, []);
});

test("Kaufauftrag ueber den Worker mit countryCode DE: Meldung nennt das Land, kein Hold, keine Suche, Nummer failed", async () => {
  const { state, numberId } = await zahlenderMandantMitNummer();
  const anbieter = attrappe();
  const abrechnung = abrechnungsAttrappe();

  await assert.rejects(
    handleProvisionJob(
      state,
      { payload: { numberId } },
      { provisioner: anbieter, billing: abrechnung },
      { ...KAUF_ARGUMENTE, countryCode: NICHT_KAUFBAR.land },
    ),
    /DE/,
  );

  assert.equal(abrechnung.holds.length, 0, "placeHold 0-mal");
  assert.deepEqual(anbieter.suchen, []);
  assert.deepEqual(anbieter.bestellungen, []);
  assert.equal(findNumber(state, numberId).status, NUMMER_FEHLGESCHLAGEN);
});

test("US-Suche liefert +49-Treffer: nichts wird bestellt, kein Hold, Nummer failed", async () => {
  const { state, numberId } = await zahlenderMandantMitNummer();
  const anbieter = attrappe();
  anbieter.searchNumbers = async ({ countryCode }) => {
    anbieter.suchen.push(countryCode);
    return [{ e164: NICHT_KAUFBAR.nummer }];
  };
  const abrechnung = abrechnungsAttrappe();

  await assert.rejects(
    handleProvisionJob(
      state,
      { payload: { numberId } },
      { provisioner: anbieter, billing: abrechnung },
      { ...KAUF_ARGUMENTE, countryCode: KAUFLAND },
    ),
    /DE/,
  );

  assert.deepEqual(anbieter.suchen, [KAUFLAND]);
  assert.deepEqual(anbieter.bestellungen, []);
  assert.equal(abrechnung.holds.length, 0, "placeHold 0-mal");
  assert.equal(findNumber(state, numberId).status, NUMMER_FEHLGESCHLAGEN);
});
