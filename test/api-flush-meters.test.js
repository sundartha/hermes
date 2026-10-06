import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { config } from "../src/config.js";
import { stripeBilling } from "../src/billing/stripe.js";
import { makeBillingRoutes } from "../src/routes/api-billing.js";
import { seedState } from "./helpers.js";
import { operatorAuthPassThrough } from "./operator-route-app.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

async function startFakeStripe() {
  const meterPosts = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.method === "POST" && req.url === "/v1/billing/meter_events") {
        meterPosts.push(body);
        return res.end(JSON.stringify({}));
      }
      res.statusCode = 404;
      res.end(JSON.stringify({}));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    meterPosts,
    close: () => new Promise((r) => server.close(r)),
  };
}

async function withStripeMock(url, fn) {
  const savedBase = config.billing.stripeApiBase;
  const savedKey = config.billing.stripeSecretKey;
  config.billing.stripeApiBase = url;
  config.billing.stripeSecretKey = "sk_test_x";
  try {
    return await fn();
  } finally {
    config.billing.stripeApiBase = savedBase;
    config.billing.stripeSecretKey = savedKey;
  }
}

const FLUSH_EPOCH_WEIT_VOR_FIXTURES = "2000-01-01T00:00:00.000Z";

async function startBillingApp({
  paymentEnabled,
  state,
  flushEpochIso = FLUSH_EPOCH_WEIT_VOR_FIXTURES,
}) {
  const app = express();
  app.use(express.json());
  app.use(
    makeBillingRoutes({
      config: withConfigNamespaces({ paymentEnabled, flushEpochIso }),
      store: { load: () => state, save: () => {} },
      audit: () => {},
      billing: stripeBilling,
      tenant: {},
      operatorAuth: operatorAuthPassThrough(),
    }),
  );
  const server = await new Promise((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

const flushMeters = (app) => fetch(`${app.base}/api/billing/flush-meters`, { method: "POST" });

test("ohne PAYMENT_ENABLED: POST /api/billing/flush-meters -> 404 (fail-closed)", async () => {
  const app = await startBillingApp({ paymentEnabled: false, state: seedState() });
  try {
    const res = await flushMeters(app);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "metering disabled (PAYMENT_ENABLED)" });
  } finally {
    await app.close();
  }
});

test("mit PAYMENT_ENABLED, leerer Ledger: -> 200 {sent:0,failed:0,skipped:0,skipReason:null} (kein Stripe-Kontakt)", async () => {
  const app = await startBillingApp({
    paymentEnabled: true,
    state: { ...seedState(), usageEvents: [] },
  });
  try {
    const res = await flushMeters(app);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { sent: 0, failed: 0, skipped: 0, skipReason: null });
    assert.deepEqual(Object.keys(body).sort(), ["failed", "sent", "skipReason", "skipped"]);
  } finally {
    await app.close();
  }
});

test("mit PAYMENT_ENABLED, EIN pending usage_event: -> 200 {sent:1,failed:0,skipped:0,skipReason:null}, Event markiert, Antwort ohne Event-Inhalt", async () => {
  const stripe = await startFakeStripe();
  const state = {
    ...seedState(),
    usageEvents: [
      {
        id: "ue_test1",
        tenantId: BOOTSTRAP_TENANT_ID,
        callId: null,
        kind: "voice_minute",
        quantity: 2,
        costCents: 0,
        occurredAt: new Date().toISOString(),
        stripeMeterSent: false,
      },
    ],
  };
  const app = await startBillingApp({ paymentEnabled: true, state });
  try {
    await withStripeMock(stripe.url, async () => {
      const res = await flushMeters(app);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(body, { sent: 1, failed: 0, skipped: 0, skipReason: null });
      assert.deepEqual(Object.keys(body).sort(), ["failed", "sent", "skipReason", "skipped"]);
      assert.equal(stripe.meterPosts.length, 1, "genau ein Meter-POST an Stripe");
      const stored = state.usageEvents.find((e) => e.id === "ue_test1");
      assert.equal(stored.stripeMeterSent, true, "Event nach Flush als gesendet markiert");
    });
  } finally {
    await app.close();
    await stripe.close();
  }
});

test("mit PAYMENT_ENABLED, EIN pending sms-usage_event: -> 200 {sent:1,failed:0,skipped:0,skipReason:null} (SMS-Meter-Mapping vorhanden)", async () => {
  const stripe = await startFakeStripe();
  const state = {
    ...seedState(),
    usageEvents: [
      {
        id: "ue_sms1",
        tenantId: BOOTSTRAP_TENANT_ID,
        callId: null,
        kind: "sms",
        quantity: 1,
        costCents: 3,
        occurredAt: new Date().toISOString(),
        stripeMeterSent: false,
      },
    ],
  };
  const app = await startBillingApp({ paymentEnabled: true, state });
  try {
    await withStripeMock(stripe.url, async () => {
      const res = await flushMeters(app);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(body, { sent: 1, failed: 0, skipped: 0, skipReason: null });
      assert.equal(stripe.meterPosts.length, 1, "genau ein Meter-POST an Stripe");
      const stored = state.usageEvents.find((e) => e.id === "ue_sms1");
      assert.equal(stored.stripeMeterSent, true, "sms-Event nach Flush als gesendet markiert");
    });
  } finally {
    await app.close();
    await stripe.close();
  }
});

test("mit PAYMENT_ENABLED, EIN pending usage_event, KEIN Flush-Stichtag: -> 200 {sent:0,failed:0,skipped:1,skipReason:'no_flush_epoch'}, kein Stripe-Kontakt", async () => {
  const stripe = await startFakeStripe();
  const state = {
    ...seedState(),
    usageEvents: [
      {
        id: "ue_kv_p0_1",
        tenantId: BOOTSTRAP_TENANT_ID,
        callId: null,
        kind: "voice_minute",
        quantity: 2,
        costCents: 0,
        occurredAt: new Date().toISOString(),
        stripeMeterSent: false,
      },
    ],
  };
  const app = await startBillingApp({ paymentEnabled: true, state, flushEpochIso: null });
  try {
    await withStripeMock(stripe.url, async () => {
      const res = await flushMeters(app);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(body, { sent: 0, failed: 0, skipped: 1, skipReason: "no_flush_epoch" });
      assert.equal(stripe.meterPosts.length, 0, "kein Meter-POST ohne Stichtag");
      const stored = state.usageEvents.find((e) => e.id === "ue_kv_p0_1");
      assert.equal(stored.stripeMeterSent, false, "Event bleibt unangetastet ohne Stichtag");
    });
  } finally {
    await app.close();
    await stripe.close();
  }
});
