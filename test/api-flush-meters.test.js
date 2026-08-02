// P0a - Charakterisierungs-Test fuer POST /api/billing/flush-meters (PLAN-SERVER-SLIM,
// Pre-Mortem h): der Endpunkt hatte KEINEN HTTP-Test -> sein Move nach routes/api-billing.js
// (P7) waere nicht byte-beweisbar. AUTH-P6: flush-meters ist seither eine Betreiber-Route
// (webAuthMw+adminMw, nur MIT operatorAuth gemountet) - ein echter Spawn-Server (Muster
// vor AUTH-P6) faehrt json/kein SESSION_SECRET und mountet sie darum gar nicht mehr (404
// ohne JSON-Body, W6). Migriert auf In-Process-Mount von makeBillingRoutes (Muster
// prov01-capture-idempotent.test.js: reale stripeBilling-Logik gegen einen HTTP-Mock,
// config.billing.stripeApiBase/stripeSecretKey-Override) + Store-Double aus seedState().
// operatorAuth = Durchreiche-Attrappe (test/operator-route-app.js) - dieser Test misst
// weiterhin flushMeters, nicht die Admin-Sitzung (die pruefen die AUTH-P6-Tests).
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

// Minimale Fake-Stripe: quittiert das Meter-Event mit 200 und zaehlt die POSTs
// (Muster startFakeStripe/startFixedServer in billing-setup-checkout-route.test.js /
// prov01-capture-idempotent.test.js). Nur der eine Endpunkt, den flushMeters ->
// stripeBilling.reportMeter trifft.
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

// Setzt Base-URL + Secret des STRIPE-SINGLETON auf den Mock, ruft fn, stellt danach
// wieder her (Independent/R; Muster withStripeMock, prov01-capture-idempotent.test.js).
// stripeBilling liest config.billing IMMER vom echten Singleton (src/config.js), NICHT
// vom config-Objekt, das makeBillingRoutes erhaelt - beide muessen darum unabhaengig
// gesetzt werden.
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

// In-Process-App: EIN state-Objekt (seedState-Form) als store-Double, das flushMeters
// per markMeterEventsSent mutiert (save() ist ein No-Op - kein IO in diesem Test).
async function startBillingApp({ paymentEnabled, state }) {
  const app = express();
  app.use(express.json());
  app.use(
    makeBillingRoutes({
      config: withConfigNamespaces({ paymentEnabled }),
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

// (A) Fail-closed: ohne PAYMENT_ENABLED -> 404 mit exaktem Body.
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

// (B) Aktiv, leerer Ledger: 200 {sent:0,failed:0}; Billing-Port NIE beruehrt (kein Stripe),
// Antwort traegt nur die Zaehler (kein Secret/Event-Inhalt). seedState() traegt KEIN
// usageEvents-Feld (nur der json-Store-Reader fuellt es beim Laden nach) - dieses
// Store-Double mountet direkt, darum hier EXPLIZIT.
test("mit PAYMENT_ENABLED, leerer Ledger: -> 200 {sent:0,failed:0} (kein Stripe-Kontakt)", async () => {
  const app = await startBillingApp({
    paymentEnabled: true,
    state: { ...seedState(), usageEvents: [] },
  });
  try {
    const res = await flushMeters(app);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { sent: 0, failed: 0 });
    assert.deepEqual(Object.keys(body).sort(), ["failed", "sent"]); // nur Zaehler
  } finally {
    await app.close();
  }
});

// (C) Aktiv, EIN pending usage_event + Fake-Stripe: 200 {sent:1,failed:0}; die Antwort
// bleibt {sent,failed} (KEIN Secret/Event-Inhalt) auch wenn real ein Meter gemeldet wurde;
// das Event ist im state als gesendet markiert (markMeterEventsSent-Seiteneffekt gepinnt).
test("mit PAYMENT_ENABLED, EIN pending usage_event: -> 200 {sent:1,failed:0}, Event markiert, Antwort ohne Event-Inhalt", async () => {
  const stripe = await startFakeStripe();
  const state = {
    ...seedState(),
    // Rohform wie recordUsageEvent (state-ops): kind=voice_minute -> Stripe-Meter voice_minutes.
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
      assert.deepEqual(body, { sent: 1, failed: 0 });
      assert.deepEqual(Object.keys(body).sort(), ["failed", "sent"]); // kein Leak trotz Meldung
      assert.equal(stripe.meterPosts.length, 1, "genau ein Meter-POST an Stripe");
      const stored = state.usageEvents.find((e) => e.id === "ue_test1");
      assert.equal(stored.stripeMeterSent, true, "Event nach Flush als gesendet markiert");
    });
  } finally {
    await app.close();
    await stripe.close();
  }
});

// (D) P1/S1-7: EIN pending "sms"-usage_event -> 200 {sent:1,failed:0}. Beweist, dass das
// SMS-Mapping (STRIPE_METER_EVENT_NAME.sms) existiert - vor dem Fix warf reportMeter
// 'unbekanntes kind' und flushMeters zaehlte failed:1 (Event bleibt pending, Umsatz nie
// gemeldet).
test("mit PAYMENT_ENABLED, EIN pending sms-usage_event: -> 200 {sent:1,failed:0} (SMS-Meter-Mapping vorhanden)", async () => {
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
      assert.deepEqual(body, { sent: 1, failed: 0 });
      assert.equal(stripe.meterPosts.length, 1, "genau ein Meter-POST an Stripe");
      const stored = state.usageEvents.find((e) => e.id === "ue_sms1");
      assert.equal(stored.stripeMeterSent, true, "sms-Event nach Flush als gesendet markiert");
    });
  } finally {
    await app.close();
    await stripe.close();
  }
});
