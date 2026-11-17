import assert from "node:assert/strict";
import { test } from "node:test";

import request from "../gemeinsam/testserver-anfrage.mjs";
import { makePgTestStore } from "../pg-helpers.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { starteSelfServiceApp } from "../gemeinsam/self-service-app.js";

const SECRET = "wb1-checkout-secret-0123456789";
const SUB = "sub-wb1";
const TENANT = "t_sub-wb1";
const CUSTOMER = "cus_wb1";
const TEXT_VERSION = "widerruf-beginn-v1";
const TAG_MS = 24 * 60 * 60 * 1000;
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
  await store.ensureTenant(TENANT);
  if (withCustomer) await store.setTenantStripe(TENANT, { customerId: CUSTOMER });
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
    const [params] = s.spy.subCheckouts;
    assert.equal(params.widerrufBeginnAt, erwartet);
    assert.equal(params.widerrufBeginnText, TEXT_VERSION);
    assert.equal(params.planSlug, "starter");
    assert.equal(params.idempotencyKey, `subcs_${TENANT}_starter_price_starter_${CUSTOMER}_${erwartet}`);
  } finally {
    await s.close();
  }
});

test("Abo-Checkout: Doppelklick oder zweiter Tab behalten Zustimmungszeit und Idempotency-Key (keine zweite Abo-Session)", async (t) => {
  const s = await setup();
  try {
    const jetzt = Date.now();
    t.mock.timers.enable({ apis: ["Date"], now: jetzt });
    await checkout(s, { plan: "starter", widerrufBeginn: true });
    t.mock.timers.tick(1000);
    await checkout(s, { plan: "starter", widerrufBeginn: true });
    const [erster, zweiter] = s.spy.subCheckouts;
    assert.equal(erster.idempotencyKey, zweiter.idempotencyKey);
    assert.equal(zweiter.widerrufBeginnAt, new Date(jetzt).toISOString());
    assert.equal((await gespeicherteZustimmung(s)).widerruf_beginn_at, new Date(jetzt).toISOString());
  } finally {
    await s.close();
  }
});

const ALTE_ZUSTIMMUNG = [
  ["knapp unter 24 h alt wird weiterverwendet", TAG_MS - 1, TEXT_VERSION, true],
  ["genau 24 h alt wird ersetzt", TAG_MS, TEXT_VERSION, false],
  ["mit anderer Textversion wird ersetzt", 1000, "widerruf-beginn-v0", false],
];

for (const [fall, alterMs, textVersion, weiter] of ALTE_ZUSTIMMUNG) {
  test(`Abo-Checkout: gespeicherte Zustimmung ${fall} (Idempotency-Fenster von Stripe)`, async (t) => {
    const s = await setup();
    try {
      const jetzt = Date.now();
      const alt = new Date(jetzt - alterMs).toISOString();
      await s.store.setWiderrufBeginn(TENANT, { at: alt, text: textVersion });
      t.mock.timers.enable({ apis: ["Date"], now: jetzt });
      await checkout(s, { plan: "starter", widerrufBeginn: true });
      const erwartet = weiter ? alt : new Date(jetzt).toISOString();
      const [anfrage] = s.spy.subCheckouts;
      assert.equal(anfrage.widerrufBeginnAt, erwartet);
      assert.equal(anfrage.widerrufBeginnText, TEXT_VERSION);
      assert.deepEqual(await gespeicherteZustimmung(s), {
        widerruf_beginn_at: erwartet,
        widerruf_beginn_text: weiter ? textVersion : TEXT_VERSION,
      });
    } finally {
      await s.close();
    }
  });
}

test("Zustimmung übersteht das Neuladen des Postgres-Stores (Spalten werden gelesen)", async (t) => {
  const s = await setup();
  try {
    const jetzt = Date.now();
    t.mock.timers.enable({ apis: ["Date"], now: jetzt });
    await checkout(s, { plan: "starter", widerrufBeginn: true });
    await s.store.init();
    assert.deepEqual(s.store.tenantWiderrufBeginn(TENANT), {
      at: new Date(jetzt).toISOString(),
      text: TEXT_VERSION,
    });
  } finally {
    await s.close();
  }
});

test("setWiderrufBeginn: unbekannter Tenant wirft, statt still nichts zu speichern; ohne Eintrag liest man null", async () => {
  const s = await setup();
  try {
    assert.throws(
      () => s.store.setWiderrufBeginn("t_unbekannt", { at: "2026-11-17T10:00:00.000Z", text: TEXT_VERSION }),
      /t_unbekannt/,
    );
    assert.deepEqual(s.store.tenantWiderrufBeginn("t_unbekannt"), { at: null, text: null });
  } finally {
    await s.close();
  }
});
