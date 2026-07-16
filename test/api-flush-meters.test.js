// P0a - Charakterisierungs-Test fuer POST /api/billing/flush-meters (PLAN-SERVER-SLIM,
// Pre-Mortem h): der Endpunkt hatte KEINEN HTTP-Test -> sein Move nach routes/api-billing.js
// (P7) waere nicht byte-beweisbar. Dieser Test PINNT das IST-Verhalten gegen den
// UNVERAENDERTEN src/server.js (reine Test-Phase: server.js bleibt byte-identisch).
// Spawn (node:test), offline. Fake-Stripe lokal (Muster billing-setup-checkout-route.test.js;
// helpers.js bleibt unangetastet - harte Phasen-Abgrenzung). KEIN pglite in dieser Datei.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, seedState } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

// assertConfig verlangt bei PAYMENT_ENABLED zusaetzlich STRIPE_SECRET_KEY,
// STRIPE_WEBHOOK_SECRET und NUMBER_SETUP_FEE_CENTS>0 (sonst Boot-Refusal). MULTI_TENANT
// NICHT noetig: flush-meters ist nicht tenant-gescopt (Owner/localhost-Pfad).
const PAY_ENV = {
  PAYMENT_ENABLED: "true",
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_WEBHOOK_SECRET: "whsec_test_x",
  NUMBER_SETUP_FEE_CENTS: "500",
};

const flushMeters = (srv) =>
  fetch(`${srv.localUrl}/api/billing/flush-meters`, { method: "POST" });

// Minimale Fake-Stripe: quittiert das Meter-Event mit 200 und zaehlt die POSTs
// (Muster startFakeStripe in billing-setup-checkout-route.test.js). Nur der eine
// Endpunkt, den flushMeters -> stripeBilling.reportMeter trifft.
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

// (A) Fail-closed: ohne PAYMENT_ENABLED -> 404 mit exaktem Body.
test("ohne PAYMENT_ENABLED: POST /api/billing/flush-meters -> 404 (fail-closed)", async () => {
  const srv = await startServer(); // Default-Store; PAYMENT_ENABLED default false (BASE_ENV)
  try {
    const res = await flushMeters(srv);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "metering disabled (PAYMENT_ENABLED)" });
  } finally {
    await srv.stop();
  }
});

// (B) Aktiv, leerer Ledger: 200 {sent:0,failed:0}; Billing-Port NIE beruehrt (kein Stripe),
// Antwort traegt nur die Zaehler (kein Secret/Event-Inhalt).
test("mit PAYMENT_ENABLED, leerer Ledger: -> 200 {sent:0,failed:0} (kein Stripe-Kontakt)", async () => {
  const srv = await startServer({ env: PAY_ENV }); // Default-Store: usageEvents=[]
  try {
    const res = await flushMeters(srv);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { sent: 0, failed: 0 });
    assert.deepEqual(Object.keys(body).sort(), ["failed", "sent"]); // nur Zaehler
  } finally {
    await srv.stop();
  }
});

// (C) Aktiv, EIN pending usage_event + Fake-Stripe: 200 {sent:1,failed:0}; die Antwort
// bleibt {sent,failed} (KEIN Secret/Event-Inhalt) auch wenn real ein Meter gemeldet wurde;
// das Event ist im Store als gesendet markiert (store.save-Seiteneffekt gepinnt).
test("mit PAYMENT_ENABLED, EIN pending usage_event: -> 200 {sent:1,failed:0}, Event markiert, Antwort ohne Event-Inhalt", async () => {
  const stripe = await startFakeStripe();
  const seed = {
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
  const srv = await startServer({ env: { ...PAY_ENV, STRIPE_API_BASE: stripe.url }, seed });
  try {
    const res = await flushMeters(srv);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { sent: 1, failed: 0 });
    assert.deepEqual(Object.keys(body).sort(), ["failed", "sent"]); // kein Leak trotz Meldung
    assert.equal(stripe.meterPosts.length, 1, "genau ein Meter-POST an Stripe");
    const stored = srv.readStore().usageEvents.find((e) => e.id === "ue_test1");
    assert.equal(stored.stripeMeterSent, true, "Event nach Flush als gesendet markiert");
  } finally {
    await srv.stop();
    await stripe.close();
  }
});
