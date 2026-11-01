import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { stripeBilling } from "../src/billing/stripe.js";
import { makeStripeStub } from "./helpers.js";
import { antwortetNie, mitKurzerFrist } from "./gemeinsam/kurze-antwortfrist.mjs";

const SECRET = "sk_test_idempotent-headers-probe";

const withStripeStub = makeStripeStub(config, SECRET);

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

const METER_QUANTITY = 3;
const INTERNAL_COST_CENTS = 4711;

test("PAY-10: reportMeter sendet payload[value]=quantity - costCents verlaesst den Prozess NIE", async () => {
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
        quantity: METER_QUANTITY,
        costCents: INTERNAL_COST_CENTS,
      }),
  );
  const bodyText = String(captured.body);
  assert.equal(
    new URLSearchParams(bodyText).get("payload[value]"),
    String(METER_QUANTITY),
    "abgerechnet wird die Menge",
  );
  assert.equal(
    bodyText.includes(String(INTERNAL_COST_CENTS)),
    false,
    "der interne Kostenbetrag steht in KEINEM Feld des Stripe-Requests",
  );
});

const LESEN_FRIST_MS = 10_000;
const SCHREIBEN_MIT_KEY_FRIST_MS = 15_000;

async function fristenBeiSchweigendemStripe(aufruf) {
  let fristen;
  await withStripeStub(antwortetNie, async () => {
    fristen = await mitKurzerFrist(() => assert.rejects(aufruf(), { name: "TimeoutError" }));
  });
  return fristen;
}

test("Stripe-Fristen: antwortet Stripe auf getCheckoutSessionResult nicht, bricht der Aufruf nach 10 Sekunden ab", async () => {
  const fristen = await fristenBeiSchweigendemStripe(() => stripeBilling.getCheckoutSessionResult("cs_1"));
  assert.deepEqual(fristen, [LESEN_FRIST_MS]);
});

test("Stripe-Fristen: antwortet Stripe auf getSubscriptionCheckoutResult nicht, bricht der Aufruf nach 10 Sekunden ab", async () => {
  const fristen = await fristenBeiSchweigendemStripe(() => stripeBilling.getSubscriptionCheckoutResult("cs_1"));
  assert.deepEqual(fristen, [LESEN_FRIST_MS]);
});

test("Stripe-Fristen: antwortet Stripe auf retrievePaymentMethodType nicht, bricht der Aufruf nach 10 Sekunden ab", async () => {
  const fristen = await fristenBeiSchweigendemStripe(() => stripeBilling.retrievePaymentMethodType("pm_1"));
  assert.deepEqual(fristen, [LESEN_FRIST_MS]);
});

test("Stripe-Fristen: antwortet Stripe auf retrievePriceAmount nicht, bricht der Aufruf nach 10 Sekunden ab", async () => {
  const fristen = await fristenBeiSchweigendemStripe(() => stripeBilling.retrievePriceAmount("price_1"));
  assert.deepEqual(fristen, [LESEN_FRIST_MS]);
});

test("Stripe-Fristen: antwortet Stripe auf retrieveSubscription nicht, bricht der Aufruf nach 10 Sekunden ab", async () => {
  const fristen = await fristenBeiSchweigendemStripe(() => stripeBilling.retrieveSubscription("sub_1"));
  assert.deepEqual(fristen, [LESEN_FRIST_MS]);
});

test("Stripe-Fristen: antwortet Stripe auf createSubscriptionCheckoutSession nicht, bricht der Aufruf nach 15 Sekunden ab", async () => {
  const fristen = await fristenBeiSchweigendemStripe(() =>
    stripeBilling.createSubscriptionCheckoutSession({
      tenantRef: "tenant_a",
      customerId: "cus_1",
      priceId: "price_1",
      planSlug: "starter",
      successUrl: "https://example.test/ok",
      cancelUrl: "https://example.test/abbruch",
      idempotencyKey: "subcs_key_1",
    }),
  );
  assert.deepEqual(fristen, [SCHREIBEN_MIT_KEY_FRIST_MS]);
});

test("Stripe-Fristen: antwortet Stripe auf createSubscription nicht, bricht der Aufruf nach 15 Sekunden ab", async () => {
  const fristen = await fristenBeiSchweigendemStripe(() =>
    stripeBilling.createSubscription({
      tenantRef: "tenant_a",
      customerId: "cus_1",
      priceId: "price_1",
      paymentMethodId: "pm_1",
      idempotencyKey: "sub_key_1",
    }),
  );
  assert.deepEqual(fristen, [SCHREIBEN_MIT_KEY_FRIST_MS]);
});

test("Stripe-Fristen: antwortet Stripe auf scheduleCancellation nicht, bricht der Aufruf nach 15 Sekunden ab", async () => {
  const fristen = await fristenBeiSchweigendemStripe(() =>
    stripeBilling.scheduleCancellation({ subscriptionId: "sub_1", idempotencyKey: "cancel_key_1" }),
  );
  assert.deepEqual(fristen, [SCHREIBEN_MIT_KEY_FRIST_MS]);
});

test("Stripe-Fristen: antwortet Stripe auf unscheduleCancellation nicht, bricht der Aufruf nach 15 Sekunden ab", async () => {
  const fristen = await fristenBeiSchweigendemStripe(() =>
    stripeBilling.unscheduleCancellation({ subscriptionId: "sub_1", idempotencyKey: "cancel_key_2" }),
  );
  assert.deepEqual(fristen, [SCHREIBEN_MIT_KEY_FRIST_MS]);
});
