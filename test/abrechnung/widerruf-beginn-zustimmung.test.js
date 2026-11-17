import assert from "node:assert/strict";
import { test } from "node:test";

import request from "../gemeinsam/testserver-anfrage.mjs";
import { makePgTestStore } from "../pg-helpers.js";
import * as ops from "../../src/store/state-ops.js";
import { config } from "../../src/config.js";
import { stripeBilling } from "../../src/billing/stripe.ts";
import { checkoutSessionIdempotencyKey } from "../../src/billing/subscribe.ts";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { starteSelfServiceApp } from "../gemeinsam/self-service-app.js";
import { makeStripeStub } from "../helpers.js";

const SECRET = "wb1-checkout-secret-0123456789";
const SUB = "sub-wb1";
const TENANT = "t_sub-wb1";
const CUSTOMER = "cus_wb1";
const TEXT_VERSION = "widerruf-beginn-v1";
const CONFIG = {
  paymentEnabled: true,
  publicUrl: "https://test.local",
  stripeStarterPriceId: "price_starter",
  stripeBusinessPriceId: "price_business",
  stripeCustomerRetryDelayMs: 0,
};

function fakeBilling() {
  const spy = { customers: 0, setupCheckouts: [], subCheckouts: [] };
  const billing = {
    createCustomer: async () => {
      spy.customers += 1;
      return { customerId: "cus_fresh" };
    },
    createSetupCheckoutSession: async (p) => {
      spy.setupCheckouts.push(p);
      return { url: "https://stripe.test/c/cs_setup", sessionId: "cs_setup" };
    },
    createSubscriptionCheckoutSession: async (p) => {
      spy.subCheckouts.push(p);
      return { url: "https://stripe.test/c/cs_sub", sessionId: "cs_sub" };
    },
  };
  return { billing, spy };
}

async function setup({ withCustomer = true } = {}) {
  const { store, runner, db } = await makePgTestStore();
  const s = store.load();
  ops.registerTenant(s, TENANT, { firstName: "Kundin", lastName: "WB1", idpSubject: SUB });
  if (withCustomer) ops.setTenantStripe(s, TENANT, { customerId: CUSTOMER });
  const { billing, spy } = fakeBilling();
  const app = await starteSelfServiceApp({
    store,
    runner,
    secret: SECRET,
    sub: SUB,
    tenantId: TENANT,
    email: "wb1@kundin.de",
    audit: () => {},
    config: withConfigNamespaces(CONFIG),
    billing,
    provision: async () => ({ ok: true, reason: "queued" }),
  });
  return { ...app, store, db, spy };
}

const checkout = (s, body) =>
  request("POST", `${s.base}/api/self-service/billing/setup-checkout`, { cookie: s.cookie, body });

async function gespeicherteZustimmung(s) {
  const { rows } = await s.db.query(
    "SELECT widerruf_beginn_at, widerruf_beginn_text FROM tenant WHERE id = $1",
    [TENANT],
  );
  return rows[0];
}

const OHNE_GUELTIGE_ZUSTIMMUNG = [
  ["fehlt", { plan: "starter" }],
  ["false", { plan: "starter", widerrufBeginn: false }],
  ["Text statt true", { plan: "starter", widerrufBeginn: "true" }],
  ["Zahl statt true", { plan: "business", widerrufBeginn: 1 }],
];

for (const [fall, body] of OHNE_GUELTIGE_ZUSTIMMUNG) {
  test(`Abo-Checkout mit Plan und Zustimmung ${fall}: 400 consent_required, keine Stripe-Session, nichts gespeichert`, async () => {
    const s = await setup({ withCustomer: false });
    try {
      const res = await checkout(s, body);
      assert.equal(res.status, 400);
      assert.deepEqual(JSON.parse(res.body), { error: "consent_required" });
      assert.equal(s.spy.customers, 0, "kein Stripe-Kunde angelegt");
      assert.equal(s.spy.subCheckouts.length, 0, "keine Abo-Checkout-Session");
      assert.equal(s.spy.setupCheckouts.length, 0, "auch keine Karten-Session als Ersatz");
      assert.deepEqual(await gespeicherteZustimmung(s), {
        widerruf_beginn_at: null,
        widerruf_beginn_text: null,
      });
    } finally {
      await s.close();
    }
  });
}

test("Karten-Session ohne Plan braucht keine Zustimmung: 200 und Setup-Session", async () => {
  const s = await setup();
  try {
    const res = await checkout(s, {});
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.body).url, "https://stripe.test/c/cs_setup");
    assert.equal(s.spy.setupCheckouts.length, 1);
    assert.equal(s.spy.subCheckouts.length, 0);
    assert.equal((await gespeicherteZustimmung(s)).widerruf_beginn_at, null);
  } finally {
    await s.close();
  }
});

test("Abo-Checkout mit Zustimmung: Zeitpunkt der Serveruhr und Textversion am Tenant und in der Stripe-Anfrage", async (t) => {
  const s = await setup();
  try {
    const jetzt = Date.now();
    t.mock.timers.enable({ apis: ["Date"], now: jetzt });
    const erwartet = new Date(jetzt).toISOString();
    const res = await checkout(s, { plan: "starter", widerrufBeginn: true });
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.body).url, "https://stripe.test/c/cs_sub");
    assert.deepEqual(await gespeicherteZustimmung(s), {
      widerruf_beginn_at: erwartet,
      widerruf_beginn_text: TEXT_VERSION,
    });
    assert.equal(s.spy.subCheckouts.length, 1);
    const params = s.spy.subCheckouts[0];
    assert.equal(params.widerrufBeginnAt, erwartet);
    assert.equal(params.widerrufBeginnText, TEXT_VERSION);
    assert.equal(params.planSlug, "starter");
  } finally {
    await s.close();
  }
});

test("Abo-Checkout: eine neue Zustimmung zu anderer Zeit bekommt einen anderen Idempotency-Key (kein Stripe-Konflikt beim erneuten Versuch)", async (t) => {
  const s = await setup();
  try {
    const jetzt = Date.now();
    t.mock.timers.enable({ apis: ["Date"], now: jetzt });
    await checkout(s, { plan: "starter", widerrufBeginn: true });
    t.mock.timers.tick(1000);
    await checkout(s, { plan: "starter", widerrufBeginn: true });
    const [erster, zweiter] = s.spy.subCheckouts;
    assert.notEqual(erster.idempotencyKey, zweiter.idempotencyKey);
    assert.equal((await gespeicherteZustimmung(s)).widerruf_beginn_at, new Date(jetzt + 1000).toISOString());
  } finally {
    await s.close();
  }
});

test("checkoutSessionIdempotencyKey: ohne Zustimmungszeit unverändert, mit Zustimmungszeit eindeutig je Zeitpunkt", () => {
  const basis = { tenant: "t_x", planSlug: "starter", priceId: "price_a", customerId: "cus_a" };
  assert.equal(checkoutSessionIdempotencyKey(basis), "subcs_t_x_starter_price_a_cus_a");
  const frueh = checkoutSessionIdempotencyKey({ ...basis, widerrufBeginnAt: "2026-11-17T10:00:00.000Z" });
  const spaet = checkoutSessionIdempotencyKey({ ...basis, widerrufBeginnAt: "2026-11-17T10:00:01.000Z" });
  assert.equal(frueh, "subcs_t_x_starter_price_a_cus_a_2026-11-17T10:00:00.000Z");
  assert.notEqual(frueh, spaet);
});

const withStripeStub = makeStripeStub(config, "sk_test_wb1_stub");

test("createSubscriptionCheckoutSession: Zeitpunkt und Textversion der Zustimmung stehen in metadata der Checkout-Session", async () => {
  let body;
  await withStripeStub(
    async (_url, opts) => {
      body = opts.body;
      return { ok: true, status: 200, json: async () => ({ id: "cs_wb1", url: "https://stripe.test/c/cs_wb1" }) };
    },
    () =>
      stripeBilling.createSubscriptionCheckoutSession({
        tenantRef: TENANT,
        customerId: CUSTOMER,
        priceId: "price_starter",
        planSlug: "starter",
        successUrl: "https://agent.test/ok",
        cancelUrl: "https://agent.test/no",
        widerrufBeginnAt: "2026-11-17T10:00:00.000Z",
        widerrufBeginnText: TEXT_VERSION,
      }),
  );
  assert.equal(body.get("metadata[widerruf_beginn_at]"), "2026-11-17T10:00:00.000Z");
  assert.equal(body.get("metadata[widerruf_beginn_text]"), TEXT_VERSION);
  assert.equal(body.get("metadata[tenant_ref]"), TENANT);
});

test("createSubscriptionCheckoutSession: ohne Zustimmungsangaben keine widerruf-Metadaten (kein Text undefined)", async () => {
  let body;
  await withStripeStub(
    async (_url, opts) => {
      body = opts.body;
      return { ok: true, status: 200, json: async () => ({ id: "cs_wb2", url: "https://stripe.test/c/cs_wb2" }) };
    },
    () =>
      stripeBilling.createSubscriptionCheckoutSession({
        tenantRef: TENANT,
        customerId: CUSTOMER,
        priceId: "price_starter",
        planSlug: "starter",
        successUrl: "https://agent.test/ok",
        cancelUrl: "https://agent.test/no",
      }),
  );
  assert.equal(body.get("metadata[widerruf_beginn_at]"), null);
  assert.equal(body.get("metadata[widerruf_beginn_text]"), null);
});
