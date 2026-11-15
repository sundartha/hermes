import { test } from "node:test";
import assert from "node:assert/strict";
import * as ops from "../../src/store/state-ops.js";
import { KYC_OUTBOUND_MIN, TENANT_STATUS } from "../../src/begriffe/mandant.js";
import { PM_TYPE_OUTCOME, reconcilePaymentMethodTypes } from "../../src/billing/payment-method-type-reconcile.ts";
import { STALE_SUB_OUTCOME, reconcileStaleSubscriptions } from "../../src/billing/stale-subscription-reconcile.ts";

const TENANT = "t_fehlertext";
const SECOND_TENANT = "t_fehlertext_zwei";

function zahlartStore() {
  const state = ops.makeDefaultState();
  ops.registerTenant(state, TENANT);
  ops.setKycLevel(state, TENANT, KYC_OUTBOUND_MIN);
  ops.setTenantStripe(state, TENANT, { customerId: "cus_ft", paymentMethodId: "pm_ft", paymentMethodType: null });
  const { number } = ops.requestNumber(state, { tenantId: TENANT, maxNumbers: 9, maxNumbersPerTenant: 9 });
  ops.failNumber(state, number.id);
  return {
    load: () => state,
    save() {},
    async withStoreLock(fn) {
      return fn();
    },
    setTenantStripe: (tenantId, patch) => ops.setTenantStripe(state, tenantId, patch),
  };
}

function aboStore() {
  const tenants = [
    { id: TENANT, stripeSubscriptionId: "sub_ft", status: TENANT_STATUS.SUSPENDED },
    { id: SECOND_TENANT, stripeSubscriptionId: "sub_ft2", status: TENANT_STATUS.SUSPENDED },
  ];
  return {
    load: () => ({ tenants }),
    setTenantSubscription() {},
    tenantSubscription: () => ({ subscriptionId: null }),
  };
}

function sammler() {
  const lines = [];
  return { lines, warn: (message) => lines.push(String(message)) };
}

async function zahlartMitWurf(geworfen) {
  const logger = sammler();
  const report = await reconcilePaymentMethodTypes({
    store: zahlartStore(),
    billing: {
      retrievePaymentMethodType: async () => {
        throw geworfen;
      },
    },
    logger,
  });
  return { logger, report };
}

async function aboMitWurf(geworfen) {
  const logger = sammler();
  const calls = [];
  const report = await reconcileStaleSubscriptions({
    store: aboStore(),
    billing: {
      retrieveSubscription: async (id) => {
        calls.push(id);
        throw geworfen;
      },
    },
    logger,
  });
  return { logger, report, calls };
}

function pruefeZahlart({ logger, report }, text) {
  assert.deepEqual(logger.lines, [`[pm-type] Typ-Abfrage fehlgeschlagen tenant=${TENANT}: ${text}`]);
  assert.deepEqual(report.errors, [{ id: TENANT, reason: PM_TYPE_OUTCOME.LOOKUP_FAILED }]);
}

function pruefeAbo({ logger, report, calls }, text) {
  assert.deepEqual(logger.lines, [
    `[stale-subs] Statusabfrage fehlgeschlagen tenant=${TENANT}: ${text}`,
    `[stale-subs] Statusabfrage fehlgeschlagen tenant=${SECOND_TENANT}: ${text}`,
  ]);
  assert.deepEqual(calls, ["sub_ft", "sub_ft2"]);
  assert.deepEqual(report.errors, [
    { id: TENANT, reason: STALE_SUB_OUTCOME.LOOKUP_FAILED },
    { id: SECOND_TENANT, reason: STALE_SUB_OUTCOME.LOOKUP_FAILED },
  ]);
}

test("Zahlart-Abgleich: Error boom wird als boom geloggt", async () => {
  pruefeZahlart(await zahlartMitWurf(new Error("boom")), "boom");
});

test("Zahlart-Abgleich: geworfener Text kaputt wird als kaputt geloggt", async () => {
  pruefeZahlart(await zahlartMitWurf("kaputt"), "kaputt");
});

test("Zahlart-Abgleich: throw null wird als null geloggt und der Lauf geht weiter", async () => {
  pruefeZahlart(await zahlartMitWurf(null), "null");
});

test("Zahlart-Abgleich: throw undefined wird als undefined geloggt und der Lauf geht weiter", async () => {
  pruefeZahlart(await zahlartMitWurf(undefined), "undefined");
});

test("Abo-Abgleich: Error boom wird als boom geloggt, beide Mandanten laufen durch", async () => {
  pruefeAbo(await aboMitWurf(new Error("boom")), "boom");
});

test("Abo-Abgleich: geworfener Text kaputt wird als kaputt geloggt", async () => {
  pruefeAbo(await aboMitWurf("kaputt"), "kaputt");
});

test("Abo-Abgleich: throw null wird als null geloggt und die Schleife geht weiter", async () => {
  pruefeAbo(await aboMitWurf(null), "null");
});

test("Abo-Abgleich: throw undefined wird als undefined geloggt und die Schleife geht weiter", async () => {
  pruefeAbo(await aboMitWurf(undefined), "undefined");
});
