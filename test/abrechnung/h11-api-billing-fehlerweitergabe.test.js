import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import express from "express";
import { makeBillingRoutes } from "../../src/routes/api-billing.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { makeStripeWebhookRoute } from "../../src/routes/stripe-webhook.js";
import { CHECKOUT_RETURN } from "../../src/portal-paths.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { operatorAuthPassThrough } from "../operator-route-app.js";
import { STRIPE_ROUTEN_GEHEIMNIS } from "../gemeinsam/erfundene-geheimnisse.js";

const HTTP_SERVER_ERROR = 500;
const TENANT = "t-h11";

function stubStore() {
  return {
    tenantStripe: () => ({ customerId: "cus_h11" }),
    setTenantStripe: () => {},
  };
}

async function mitApp(billing, ablauf, { audit = () => {}, store = stubStore(), costTruing, flushEpochIso } = {}) {
  const app = express();
  app.use(
    makeBillingRoutes({
      config: withConfigNamespaces({ paymentEnabled: true, publicUrl: "https://agent.test", flushEpochIso }),
      store,
      audit,
      billing,
      costTruing,
      operatorAuth: operatorAuthPassThrough(),
      tenant: { requireTenant: () => TENANT },
    }),
  );
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    await ablauf(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("h11 setup-checkout: scheitert Stripe beim Anlegen der Sitzung, antwortet der Server 500 statt gar nicht", async () => {
  const billing = { createSetupCheckoutSession: () => Promise.reject(new Error("stripe down")) };
  await mitApp(billing, async (base) => {
    const res = await abrufMitFrist(`${base}/api/billing/setup-checkout`, { method: "POST" });
    assert.equal(res.status, HTTP_SERVER_ERROR);
  });
});

test("h11 checkout-return: scheitert Stripe beim Lesen der Sitzung, antwortet der Server 500 statt gar nicht", async () => {
  const billing = { getCheckoutSessionResult: () => Promise.reject(new Error("stripe down")) };
  await mitApp(billing, async (base) => {
    const res = await abrufMitFrist(`${base}/api/billing/checkout-return?session_id=cs_h11`);
    assert.equal(res.status, HTTP_SERVER_ERROR);
  });
});

test("h11 setup-checkout: Rueckkehr-Adressen und Antwort stammen aus der oeffentlichen Adresse, Audit nennt den Mandanten", async () => {
  const aufrufe = [];
  const audits = [];
  const billing = {
    createSetupCheckoutSession: (args) => {
      aufrufe.push(args);
      return Promise.resolve({ url: "https://stripe.test/c/1" });
    },
  };
  await mitApp(
    billing,
    async (base) => {
      const res = await abrufMitFrist(`${base}/api/billing/setup-checkout`, { method: "POST" });
      assert.deepEqual(await res.json(), { url: "https://stripe.test/c/1" });
    },
    { audit: (aktion, _req, detail) => audits.push([aktion, detail]) },
  );
  assert.deepEqual(aufrufe, [
    {
      tenantRef: TENANT,
      customerId: "cus_h11",
      successUrl: "https://agent.test/api/billing/checkout-return?session_id={CHECKOUT_SESSION_ID}",
      cancelUrl: `https://agent.test${CHECKOUT_RETURN.CARD_CANCELED}`,
    },
  ]);
  assert.deepEqual(audits, [["billing_setup_checkout", `tenant=${TENANT}`]]);
});

test("h11 flush-meters: Audit nennt die Zaehler und ohne Grund einen Strich", async () => {
  const audits = [];
  const store = { load: () => ({ usageEvents: [] }), save: () => {} };
  await mitApp(
    {},
    async (base) => {
      await abrufMitFrist(`${base}/api/billing/flush-meters`, { method: "POST" });
    },
    { audit: (aktion, _req, detail) => audits.push([aktion, detail]), store, flushEpochIso: "2000-01-01T00:00:00.000Z" },
  );
  assert.deepEqual(audits, [["meter_flush", "sent=0 failed=0 skipped=0 grund=-"]]);
});

test("h11 cost-truing sweep: Audit nennt uebersprungen und Deckung, ohne Deckung einen Strich", async () => {
  const audits = [];
  const ergebnisse = [{ skipped: false, coveragePercent: 75 }, { skipped: true }];
  const costTruing = { runCostTruingSweep: () => Promise.resolve(ergebnisse.shift()) };
  await mitApp(
    {},
    async (base) => {
      await abrufMitFrist(`${base}/api/billing/cost-truing/sweep`, { method: "POST" });
      await abrufMitFrist(`${base}/api/billing/cost-truing/sweep`, { method: "POST" });
    },
    { audit: (aktion, _req, detail) => audits.push([aktion, detail]), costTruing },
  );
  assert.deepEqual(audits, [
    ["cost_truing_sweep", "skipped=false deckung=75%"],
    ["cost_truing_sweep", "skipped=true deckung=-%"],
  ]);
});

function signiert(koerper) {
  const zeit = Math.floor(Date.now() / 1000);
  const mac = crypto.createHmac("sha256", STRIPE_ROUTEN_GEHEIMNIS).update(`${zeit}.${koerper}`).digest("hex");
  return { rawBody: Buffer.from(koerper), headers: { "stripe-signature": `t=${zeit},v1=${mac}` } };
}

function webhookMitWurf(wurf) {
  return makeStripeWebhookRoute({
    config: withConfigNamespaces({ paymentEnabled: true, stripeWebhookSecret: STRIPE_ROUTEN_GEHEIMNIS }),
    store: {
      tenantExists: () => {
        throw wurf;
      },
    },
    audit: () => {},
    accounts: {},
    sessions: {},
    billing: {},
    provision: async () => {},
  });
}

async function webhookAufrufen(t, wurf, ereignis) {
  const zeilen = [];
  t.mock.method(console, "error", (...args) => zeilen.push(args.join(" ")));
  const antwort = { codes: [], status(code) { this.codes.push(code); return this; }, json() { return this; } };
  await webhookMitWurf(wurf)(signiert(JSON.stringify(ereignis)), antwort);
  assert.deepEqual(antwort.codes, [503]);
  return zeilen;
}

const AENDERUNG = { type: "customer.subscription.updated", data: { object: { id: "sub_h11", status: "active", metadata: { tenant_ref: "t_h11", plan_slug: "starter" } } } };

test("h11 stripe-webhook: ein Fehler beim Anwenden steht mit Ereignis-Kennung und Meldung im Log", async (t) => {
  const zeilen = await webhookAufrufen(t, new Error("kaputt"), { id: "evt_h11", ...AENDERUNG });
  assert.deepEqual(zeilen, ["[stripe-webhook] Ereignis nicht angewendet event=evt_h11: kaputt"]);
});

test("h11 stripe-webhook: ein geworfener Text und ein Ereignis ohne Kennung stehen als Text im Log", async (t) => {
  const zeilen = await webhookAufrufen(t, "kein Error", AENDERUNG);
  assert.deepEqual(zeilen, ["[stripe-webhook] Ereignis nicht angewendet event=undefined: kein Error"]);
});
