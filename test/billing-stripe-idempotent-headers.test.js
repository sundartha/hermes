import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { stripeBilling } from "../src/billing/stripe.js";
import { makeStripeStub } from "./helpers.js";

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
