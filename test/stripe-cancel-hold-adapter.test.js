// S1-8: stripeBilling.cancelHold gegen ein gemocktes global fetch (kein echter Netz-
// Call, F.I.R.S.T.). Prueft Pfad/Methode/Header/Body (KEIN Body bei cancel) + Fehlerpfad
// + Key-Freiheit der Fehlermeldung (Secret im Text -> rot). Datei-lokaler Stub (repo-
// Konvention "lokale Single-Consumer-Test-Doubles", Muster stripe-setup-checkout.test.js) -
// config/fetch werden pro Test gespeichert/wiederhergestellt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { stripeBilling } from "../src/billing/stripe.js";

const SECRET = "sk_test_cancel_leak_probe";

// Stub: jeder Response traegt ok/status (der Adapter parst hier kein json() bei cancelHold).
function withStripeStub(impl, fn) {
  const originalFetch = global.fetch;
  const originalKey = config.billing.stripeSecretKey;
  const originalBase = config.billing.stripeApiBase;
  config.billing.stripeSecretKey = SECRET;
  config.billing.stripeApiBase = "https://api.stripe.test"; // NIE api.stripe.com im Test
  global.fetch = impl;
  return Promise.resolve(fn()).finally(() => {
    global.fetch = originalFetch;
    config.billing.stripeSecretKey = originalKey;
    config.billing.stripeApiBase = originalBase;
  });
}

test("cancelHold: POST /v1/payment_intents/<id>/cancel, Bearer + form-urlencoded, KEIN Body", async () => {
  let captured;
  await withStripeStub(
    async (url, opts) => {
      captured = { url, opts };
      return { ok: true, status: 200, json: async () => ({}) };
    },
    () => stripeBilling.cancelHold("pi_hold_9"),
  );
  assert.ok(captured.url.endsWith("/v1/payment_intents/pi_hold_9/cancel"), "URL traegt die PI-id");
  assert.equal(captured.opts.method, "POST");
  assert.equal(captured.opts.headers.Authorization, `Bearer ${SECRET}`);
  assert.equal(captured.opts.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.equal(captured.opts.body, undefined, "cancelHold schickt keinen Body");
});

test("cancelHold: Nicht-2xx -> wirft HTTP-Status", async () => {
  await withStripeStub(
    async () => ({ ok: false, status: 402, json: async () => ({}) }),
    () => assert.rejects(() => stripeBilling.cancelHold("pi_hold_9"), /HTTP 402/),
  );
});

test("cancelHold: Fehlermeldung leakt NIE den Secret-Key/Bearer (Key-Freiheit)", async () => {
  await withStripeStub(
    async () => ({ ok: false, status: 402, json: async () => ({}) }),
    () =>
      assert.rejects(
        () => stripeBilling.cancelHold("pi_hold_9"),
        (err) => {
          assert.match(err.message, /HTTP 402/);
          assert.doesNotMatch(err.message, /sk_test|Bearer/, "Secret-Key/Bearer darf nicht leaken");
          return true;
        },
      ),
  );
});
