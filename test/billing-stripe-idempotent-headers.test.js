// P7 (Cluster 1, G5): idempotentHeaders() in src/billing/stripe.js ersetzt vier identische
// Inline-Ternaries ("Idempotency-Key" nur wenn eine idempotencyKey uebergeben wird). Prueft
// direkt gegen den echten Adapter (gemocktes global fetch, F.I.R.S.T., kein Netz) an zwei
// Stellen (placeHold + reportMeter, Gegen-Fall zu den bereits bestehenden Tests in
// stripe-setup-checkout.test.js): mit Key -> Header gesetzt; ohne Key -> Header fehlt ganz
// (byte-identisch zum vorigen Inline-Ternary, kein leerer String/undefined-Header).
//
// W2-B4: der Dateiname nennt "headers", der Harness inspiziert aber den GESAMTEN Request
// (opts inkl. body) - er ist damit die einzige Stelle im Repo, an der sich der reportMeter-
// KOERPER pruefen laesst. Der PAY-10-Test unten nutzt genau das, statt eine zweite
// Adapter-Testdatei anzulegen (G17 vor Dateiname).
import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { stripeBilling } from "../src/billing/stripe.js";
import { makeStripeStub } from "./helpers.js";

const SECRET = "sk_test_idempotent-headers-probe";

// pa20-fix1: geteilte Implementierung (G5) statt lokaler Kopie - makeStripeStub buendelt
// fetch-Stub + stripeSecretKey/stripeApiBase-Override (Muster wie makeConfigOverrides).
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

// PAY-10: flushMeters (src/billing/meter.js) reicht costCents an den Port durch - der
// Stripe-Adapter destrukturiert es gar nicht erst. Abgerechnet wird bei Stripe die MENGE;
// der interne Kostenbetrag ist unsere Innenkalkulation und darf den Prozess nicht verlassen.
const METER_QUANTITY = 3;
// Unverwechselbarer Betrag: taucht dieser String irgendwo im Body auf, leakt die Kalkulation.
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
  // opts.body ist ein URLSearchParams-Objekt (stripe.js) - der Rohtext ist die Form, die
  // wirklich ueber die Leitung geht, und damit die richtige Ebene fuer beide Assertions.
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
