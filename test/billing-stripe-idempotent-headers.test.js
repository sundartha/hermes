// P7 (Cluster 1, G5): idempotentHeaders() in src/billing/stripe.js ersetzt vier identische
// Inline-Ternaries ("Idempotency-Key" nur wenn eine idempotencyKey uebergeben wird). Prueft
// direkt gegen den echten Adapter (gemocktes global fetch, F.I.R.S.T., kein Netz) an zwei
// Stellen (placeHold + reportMeter, Gegen-Fall zu den bereits bestehenden Tests in
// stripe-setup-checkout.test.js): mit Key -> Header gesetzt; ohne Key -> Header fehlt ganz
// (byte-identisch zum vorigen Inline-Ternary, kein leerer String/undefined-Header).
import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { stripeBilling } from "../src/billing/stripe.js";

const SECRET = "sk_test_idempotent-headers-probe";

function withStripeStub(impl, fn) {
  const originalFetch = global.fetch;
  const originalKey = config.stripeSecretKey;
  const originalBase = config.stripeApiBase;
  config.stripeSecretKey = SECRET;
  config.stripeApiBase = "https://api.stripe.test";
  global.fetch = impl;
  return Promise.resolve(fn()).finally(() => {
    global.fetch = originalFetch;
    config.stripeSecretKey = originalKey;
    config.stripeApiBase = originalBase;
  });
}

const okJson = (body) => ({ ok: true, status: 200, json: async () => body });

test("placeHold: idempotencyKey gesetzt -> Idempotency-Key-Header traegt genau diesen Wert", async () => {
  let captured;
  await withStripeStub(
    async (url, opts) => {
      captured = opts;
      return okJson({ id: "pi_1" });
    },
    () =>
      stripeBilling.placeHold({
        tenantRef: "tenant_a",
        amountCents: 100,
        currency: "eur",
        customerId: "cus_1",
        paymentMethodId: "pm_1",
        idempotencyKey: "hold_key_1",
      }),
  );
  assert.equal(captured.headers["Idempotency-Key"], "hold_key_1");
});

test("placeHold: KEIN idempotencyKey -> Idempotency-Key-Header komplett abwesend", async () => {
  let captured;
  await withStripeStub(
    async (url, opts) => {
      captured = opts;
      return okJson({ id: "pi_2" });
    },
    () =>
      stripeBilling.placeHold({
        tenantRef: "tenant_a",
        amountCents: 100,
        currency: "eur",
        customerId: "cus_1",
        paymentMethodId: "pm_1",
      }),
  );
  assert.equal("Idempotency-Key" in captured.headers, false);
});

test("reportMeter: idempotencyKey gesetzt -> Idempotency-Key-Header traegt genau diesen Wert", async () => {
  let captured;
  await withStripeStub(
    async (url, opts) => {
      captured = opts;
      return okJson({});
    },
    () =>
      stripeBilling.reportMeter({
        tenantRef: "tenant_a",
        kind: "voice_minute",
        quantity: 3,
        idempotencyKey: "meter_key_1",
      }),
  );
  assert.equal(captured.headers["Idempotency-Key"], "meter_key_1");
});

test("reportMeter: KEIN idempotencyKey -> Idempotency-Key-Header komplett abwesend (Gegen-Fall)", async () => {
  let captured;
  await withStripeStub(
    async (url, opts) => {
      captured = opts;
      return okJson({});
    },
    () =>
      stripeBilling.reportMeter({
        tenantRef: "tenant_a",
        kind: "voice_minute",
        quantity: 3,
      }),
  );
  assert.equal("Idempotency-Key" in captured.headers, false);
});
