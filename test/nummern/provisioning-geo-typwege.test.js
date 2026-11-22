import assert from "node:assert/strict";
import { test } from "node:test";

import { config } from "../../src/config.ts";
import { createQueue } from "../../src/queue/registry.js";
import { makeProvisioningOrchestrator } from "../../src/worker/provisioning-orchestrator.js";
import { handleProvisionJob } from "../../src/worker/provisioning.ts";
import { fakeProvisioner } from "../helpers.js";
import { makePgTestStore } from "../pg-helpers.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";

const TENANT_ID = "t_geo_typwege";
const SETUP_FEE_CENTS = 50;
const ONE_UNIT_MICRO_CENTS = 100_000_000;
const MICRO_PRO_CENT = 1_000_000;
const RATE_SCALE = 1_000_000;

function mitKonfig({ gruppe, schluessel, wert }, lauf) {
  const vorher = config[gruppe][schluessel];
  config[gruppe][schluessel] = wert;
  return Promise.resolve(lauf()).finally(() => {
    config[gruppe][schluessel] = vorher;
  });
}

function preis(zusatz = {}) {
  return {
    currency: config.billing.providerCurrency,
    upfrontMicroCents: ONE_UNIT_MICRO_CENTS,
    monthlyMicroCents: ONE_UNIT_MICRO_CENTS,
    ...zusatz,
  };
}

function erwarteterBetrag() {
  return Math.ceil(
    (ONE_UNIT_MICRO_CENTS * config.billing.providerToBucketRateMicro) /
      (MICRO_PRO_CENT * RATE_SCALE),
  );
}

const NUMMER_ID = "num_geo_typwege";

function seedZustand(state) {
  state.tenants.push({
    id: TENANT_ID,
    status: "active",
    stripeCustomerId: "cus_geo",
    stripePaymentMethodId: "pm_geo",
    stripePaymentMethodType: "card",
  });
  state.numbers.push({
    id: NUMMER_ID,
    tenantId: TENANT_ID,
    e164: null,
    provider: "telnyx",
    country: "US",
    language: "en",
    status: "requested",
    providerNumberId: null,
    paymentIntentId: null,
  });
}

function buchungsKasse(holds) {
  return {
    async placeHold({ amountCents }) {
      holds.push(amountCents);
      return { paymentIntentId: "pi_geo" };
    },
    async captureHold() {},
    async cancelHold() {},
  };
}

async function kaufe(price) {
  const { store } = await makePgTestStore();
  const state = store.load();
  seedZustand(state);
  const holds = [];
  const provisioner = fakeProvisioner({
    async searchNumbers() {
      return [price ? { e164: "+12025550101", price } : { e164: "+12025550101" }];
    },
  });
  const orchestrator = makeProvisioningOrchestrator({
    store,
    config: withConfigNamespaces({
      paymentEnabled: true,
      numberSetupFeeCents: SETUP_FEE_CENTS,
      paymentCurrency: "eur",
      provisioningEnabled: false,
    }),
    queue: createQueue(),
    billing: buchungsKasse(holds),
    metering: { recordNumberMonthMeter() {}, recordDueNumberMonthMeters: () => ({}) },
    numberProvisioning: () => provisioner,
    handleProvisionJob,
    resolveProvisionRetry: () => ({ ok: false }),
    audit: () => {},
    recordProvisioningJob: (zustand, { numberId, tenantId, idempotencyKey }) => {
      const job = {
        id: `job_${numberId}`,
        numberId,
        tenantId,
        kind: "provision-number",
        status: "queued",
        idempotencyKey,
        attempts: 0,
        lastError: null,
      };
      zustand.provisioningJobs.push(job);
      return job;
    },
    markProvisioningJob: (zustand, jobId, status) => {
      const job = zustand.provisioningJobs.find((kandidat) => kandidat.id === jobId);
      Object.assign(job, { status });
      return job;
    },
    classifyQueuedProvisioningJobs: () => ({ close: [], hold: [], redrive: [] }),
    findNumber: (zustand, id) => zustand.numbers.find((number) => number.id === id) ?? null,
  });
  await orchestrator.queueProvisioning(NUMMER_ID, TENANT_ID);
  await orchestrator.runProvisioningDrainExclusive().catch(() => undefined);
  return {
    holds,
    job: state.provisioningJobs.find((j) => j.numberId === NUMMER_ID),
    number: state.numbers.find((n) => n.id === NUMMER_ID),
  };
}

test("Nummernkauf: der Hold traegt den umgerechneten Provider-Preis aus gueltiger Konfiguration", async () => {
  const { holds, job, number } = await kaufe(preis());
  assert.ok(erwarteterBetrag() > 0 && erwarteterBetrag() !== SETUP_FEE_CENTS);
  assert.deepEqual(holds, [erwarteterBetrag()]);
  assert.equal(job.status, "done");
  assert.equal(number.monthlyCostCents, erwarteterBetrag());
});

test("Nummernkauf: ohne Vorab-Preis der Antwort gilt die Setup-Pauschale", async () => {
  const { holds } = await kaufe(preis({ upfrontMicroCents: undefined }));
  assert.deepEqual(holds, [SETUP_FEE_CENTS]);
});

test("Nummernkauf: ein nicht ganzzahliger Vorab-Preis der Antwort fällt auf die Setup-Pauschale zurück", async () => {
  const { holds, job } = await mitKonfig(
    { gruppe: "billing", schluessel: "providerToBucketRateMicro", wert: 2_000_000 },
    () =>
      kaufe(
        preis({
          upfrontMicroCents: ONE_UNIT_MICRO_CENTS + 0.5,
          monthlyMicroCents: ONE_UNIT_MICRO_CENTS + 0.5,
        }),
      ),
  );
  assert.deepEqual(holds, [SETUP_FEE_CENTS]);
  assert.equal(job.status, "done");
});

test("Nummernkauf: ein nicht-numerischer Umrechnungskurs in der Konfiguration stoppt den Kauf ohne Hold", async () => {
  const ergebnis = await mitKonfig(
    { gruppe: "billing", schluessel: "providerToBucketRateMicro", wert: "kaputt" },
    () => kaufe(preis()),
  );
  assert.deepEqual(ergebnis.holds, []);
  assert.notEqual(ergebnis.job.status, "done");
});

test("Nummernkauf: eine nicht-textuelle Provider-Waehrung in der Konfiguration stoppt den Kauf ohne Hold", async () => {
  const ergebnis = await mitKonfig(
    { gruppe: "billing", schluessel: "providerCurrency", wert: 5 },
    () => kaufe(preis()),
  );
  assert.deepEqual(ergebnis.holds, []);
  assert.notEqual(ergebnis.job.status, "done");
});

test("Nummernkauf: eine nicht-textuelle Verbindungs-Kennung in der Konfiguration stoppt den Kauf ohne Hold", async () => {
  const ergebnis = await mitKonfig(
    { gruppe: "telephony", schluessel: "telnyxConnectionId", wert: 12345 },
    () => kaufe(preis()),
  );
  assert.deepEqual(ergebnis.holds, []);
  assert.notEqual(ergebnis.job?.status, "done");
});
