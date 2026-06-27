// Pay1: Stripe-Adapter createCustomer/createSetupCheckoutSession/getCheckoutSessionResult
// gegen ein gemocktes global fetch (kein echter Netz-Call, F.I.R.S.T.). Prueft URL,
// Methode, Bearer-Auth, form-urlencoded-Body + Response-Parsing. Fehlendes payment_method
// -> wirft (Karte nicht gespeichert). Leak-Guard: Fehler-Message nennt HTTP-Status, NIE
// den Secret-Key (Regel 4). config/fetch werden pro Test gespeichert/wiederhergestellt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { stripeBilling } from "../src/billing/stripe.js";

const SECRET = "sk_test_geheim_leak_probe";

// Stub: jeder Response traegt ok/status + ein .json() (der Adapter parst json()).
function withStripeStub(impl, fn) {
  const originalFetch = global.fetch;
  const originalKey = config.stripeSecretKey;
  const originalBase = config.stripeApiBase;
  config.stripeSecretKey = SECRET;
  config.stripeApiBase = "https://api.stripe.test"; // NIE api.stripe.com im Test
  global.fetch = impl;
  return Promise.resolve(fn()).finally(() => {
    global.fetch = originalFetch;
    config.stripeSecretKey = originalKey;
    config.stripeApiBase = originalBase;
  });
}

const okJson = (body) => ({ ok: true, status: 200, json: async () => body });

test("createCustomer: POST /v1/customers, Bearer + form-urlencoded, metadata[tenant_ref], parst customerId", async () => {
  let captured;
  const result = await withStripeStub(
    async (url, opts) => {
      captured = { url, opts };
      return okJson({ id: "cus_new1" });
    },
    () => stripeBilling.createCustomer({ tenantRef: "tenant_a" }),
  );
  assert.ok(captured.url.endsWith("/v1/customers"), "URL endet auf /v1/customers");
  assert.equal(captured.opts.method, "POST");
  assert.equal(captured.opts.headers.Authorization, `Bearer ${SECRET}`);
  assert.equal(captured.opts.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.equal(captured.opts.body.get("metadata[tenant_ref]"), "tenant_a");
  assert.deepEqual(result, { customerId: "cus_new1" });
});

test("createSetupCheckoutSession: POST /v1/checkout/sessions, mode=setup + customer + URLs, parst url/sessionId", async () => {
  let captured;
  const result = await withStripeStub(
    async (url, opts) => {
      captured = { url, opts };
      return okJson({ id: "cs_1", url: "https://stripe.test/c/cs_1" });
    },
    () =>
      stripeBilling.createSetupCheckoutSession({
        tenantRef: "tenant_a",
        customerId: "cus_new1",
        successUrl: "https://agent.test/ok",
        cancelUrl: "https://agent.test/no",
      }),
  );
  assert.ok(captured.url.endsWith("/v1/checkout/sessions"), "URL endet auf /v1/checkout/sessions");
  assert.equal(captured.opts.method, "POST");
  assert.equal(captured.opts.body.get("mode"), "setup");
  assert.equal(captured.opts.body.get("customer"), "cus_new1");
  assert.equal(captured.opts.body.get("success_url"), "https://agent.test/ok");
  assert.equal(captured.opts.body.get("cancel_url"), "https://agent.test/no");
  assert.equal(captured.opts.body.get("metadata[tenant_ref]"), "tenant_a");
  // Stripe verlangt im setup-Mode ein currency (sonst HTTP 400) - aus config.paymentCurrency.
  assert.equal(captured.opts.body.get("currency"), config.paymentCurrency);
  assert.deepEqual(result, { url: "https://stripe.test/c/cs_1", sessionId: "cs_1" });
});

test("getCheckoutSessionResult: GET /v1/checkout/sessions/<id>?expand[]=setup_intent, parst customer + payment_method", async () => {
  let captured;
  const result = await withStripeStub(
    async (url, opts) => {
      captured = { url, opts };
      return okJson({ customer: "cus_new1", setup_intent: { payment_method: "pm_1" } });
    },
    () => stripeBilling.getCheckoutSessionResult("cs_1"),
  );
  assert.ok(captured.url.includes("/v1/checkout/sessions/cs_1"), "URL traegt die session_id");
  assert.ok(captured.url.includes("expand[]=setup_intent"), "setup_intent wird expandiert");
  assert.equal(captured.opts.method, "GET");
  assert.equal(captured.opts.headers.Authorization, `Bearer ${SECRET}`);
  assert.deepEqual(result, { customerId: "cus_new1", paymentMethodId: "pm_1" });
});

test("getCheckoutSessionResult: fehlendes payment_method -> wirft (Karte nicht gespeichert), KEIN stilles null", async () => {
  await withStripeStub(
    async () => okJson({ customer: "cus_new1", setup_intent: {} }),
    () =>
      assert.rejects(
        () => stripeBilling.getCheckoutSessionResult("cs_1"),
        /Karte nicht gespeichert/,
      ),
  );
});

test("Leak-Guard: Nicht-2xx -> wirft mit HTTP-Status, OHNE Secret-Key (createCustomer)", async () => {
  await withStripeStub(
    async () => ({ ok: false, status: 402, json: async () => ({}) }),
    () =>
      assert.rejects(
        () => stripeBilling.createCustomer({ tenantRef: "tenant_a" }),
        (err) => {
          assert.match(err.message, /HTTP 402/);
          assert.doesNotMatch(err.message, /sk_test|Bearer/, "Secret-Key/Bearer darf nicht leaken");
          return true;
        },
      ),
  );
});

test("createSubscription: liest current_period_end aus items.data[0] (aktuelle Stripe-API)", async () => {
  let captured;
  const result = await withStripeStub(
    async (url, opts) => {
      captured = { url, opts };
      return okJson({ id: "sub_1", items: { data: [{ current_period_end: 1893456000 }] } });
    },
    () =>
      stripeBilling.createSubscription({
        tenantRef: "tenant_a",
        customerId: "cus_1",
        priceId: "price_starter",
        idempotencyKey: "sub_tenant_a_starter",
      }),
  );
  assert.ok(captured.url.endsWith("/v1/subscriptions"), "URL endet auf /v1/subscriptions");
  assert.equal(captured.opts.method, "POST");
  assert.equal(captured.opts.body.get("items[0][price]"), "price_starter");
  assert.equal(captured.opts.body.get("off_session"), "true");
  assert.equal(captured.opts.headers["Idempotency-Key"], "sub_tenant_a_starter");
  assert.deepEqual(result, { subscriptionId: "sub_1", currentPeriodEnd: 1893456000 });
});

test("createSubscription: Fallback auf top-level current_period_end (aeltere API)", async () => {
  const result = await withStripeStub(
    async () => okJson({ id: "sub_2", current_period_end: 1700000000 }),
    () =>
      stripeBilling.createSubscription({
        tenantRef: "tenant_a",
        customerId: "cus_1",
        priceId: "price_starter",
      }),
  );
  assert.deepEqual(result, { subscriptionId: "sub_2", currentPeriodEnd: 1700000000 });
});

test("placeHold: POST /v1/payment_intents mit customer + payment_method + off_session=true, manual capture", async () => {
  let captured;
  const result = await withStripeStub(
    async (url, opts) => {
      captured = { url, opts };
      return okJson({ id: "pi_held_1" });
    },
    () =>
      stripeBilling.placeHold({
        tenantRef: "tenant_a",
        amountCents: 500,
        currency: "eur",
        customerId: "cus_1",
        paymentMethodId: "pm_1",
        idempotencyKey: "hold_num_1",
      }),
  );
  assert.ok(captured.url.endsWith("/v1/payment_intents"), "URL endet auf /v1/payment_intents");
  assert.equal(captured.opts.method, "POST");
  assert.equal(captured.opts.headers["Idempotency-Key"], "hold_num_1");
  assert.equal(captured.opts.body.get("amount"), "500"); // GANZZAHL Cents
  assert.equal(captured.opts.body.get("currency"), "eur");
  assert.equal(captured.opts.body.get("capture_method"), "manual");
  assert.equal(captured.opts.body.get("confirm"), "true");
  assert.equal(captured.opts.body.get("customer"), "cus_1");
  assert.equal(captured.opts.body.get("payment_method"), "pm_1");
  assert.equal(captured.opts.body.get("off_session"), "true");
  assert.equal(captured.opts.body.get("metadata[tenant_ref]"), "tenant_a");
  assert.deepEqual(result, { paymentIntentId: "pi_held_1" });
});
