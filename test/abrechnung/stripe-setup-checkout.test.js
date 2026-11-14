import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../../src/config.js";
import { stripeBilling } from "../../src/billing/stripe.ts";
import { CustomerMissingError } from "../../src/billing/errors.ts";
import { makeStripeStub } from "../helpers.js";

const SECRET = "sk_test_geheim_leak_probe";

const withStripeStub = makeStripeStub(config, SECRET);

const okJson = (body) => ({ ok: true, status: 200, json: async () => body });

const errJson = (status, body) => ({
  ok: false,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

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
  assert.equal(captured.opts.body.get("currency"), config.billing.paymentCurrency);
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
  assert.deepEqual(result, {
    customerId: "cus_new1",
    paymentMethodId: "pm_1",
    paymentMethodType: null,
  });
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
      return okJson({
        id: "sub_1",
        items: { data: [{ current_period_end: 1893456000, current_period_start: 1890864000 }] },
      });
    },
    () =>
      stripeBilling.createSubscription({
        tenantRef: "tenant_a",
        customerId: "cus_1",
        priceId: "price_starter",
        paymentMethodId: "pm_1",
        idempotencyKey: "sub_tenant_a_starter",
      }),
  );
  assert.ok(captured.url.endsWith("/v1/subscriptions"), "URL endet auf /v1/subscriptions");
  assert.equal(captured.opts.method, "POST");
  assert.equal(captured.opts.body.get("items[0][price]"), "price_starter");
  assert.equal(captured.opts.body.get("default_payment_method"), "pm_1");
  assert.equal(captured.opts.body.get("off_session"), "true");
  assert.equal(captured.opts.headers["Idempotency-Key"], "sub_tenant_a_starter");
  assert.deepEqual(result, {
    subscriptionId: "sub_1",
    currentPeriodEnd: 1893456000,
    currentPeriodStart: 1890864000,
  });
});

test("createSubscription: Fallback auf top-level current_period_end/start (aeltere API)", async () => {
  const result = await withStripeStub(
    async () =>
      okJson({ id: "sub_2", current_period_end: 1700000000, current_period_start: 1697408000 }),
    () =>
      stripeBilling.createSubscription({
        tenantRef: "tenant_a",
        customerId: "cus_1",
        priceId: "price_starter",
      }),
  );
  assert.deepEqual(result, {
    subscriptionId: "sub_2",
    currentPeriodEnd: 1700000000,
    currentPeriodStart: 1697408000,
  });
});

test("createSubscriptionCheckoutSession: mode=subscription + line_items + allow_promotion_codes + subscription_data-Metadata + Idempotency-Key-Header", async () => {
  let captured;
  const result = await withStripeStub(
    async (url, opts) => {
      captured = { url, opts };
      return okJson({ id: "cs_sub_1", url: "https://stripe.test/c/cs_sub_1" });
    },
    () =>
      stripeBilling.createSubscriptionCheckoutSession({
        tenantRef: "tenant_a",
        customerId: "cus_new1",
        priceId: "price_starter",
        planSlug: "starter",
        successUrl: "https://agent.test/ok",
        cancelUrl: "https://agent.test/no",
        idempotencyKey: "subcs_tenant_a_starter_price_starter",
      }),
  );
  assert.ok(captured.url.endsWith("/v1/checkout/sessions"));
  assert.equal(captured.opts.method, "POST");
  assert.equal(captured.opts.headers.Authorization, `Bearer ${SECRET}`);
  assert.equal(captured.opts.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.equal(captured.opts.headers["Idempotency-Key"], "subcs_tenant_a_starter_price_starter");
  assert.equal(captured.opts.body.get("mode"), "subscription");
  assert.equal(captured.opts.body.get("customer"), "cus_new1");
  assert.equal(captured.opts.body.get("line_items[0][price]"), "price_starter");
  assert.equal(captured.opts.body.get("line_items[0][quantity]"), "1");
  assert.equal(captured.opts.body.get("allow_promotion_codes"), "true");
  assert.equal(captured.opts.body.get("success_url"), "https://agent.test/ok");
  assert.equal(captured.opts.body.get("cancel_url"), "https://agent.test/no");
  assert.equal(captured.opts.body.get("metadata[tenant_ref]"), "tenant_a");
  assert.equal(captured.opts.body.get("subscription_data[metadata][tenant_ref]"), "tenant_a");
  assert.equal(captured.opts.body.get("subscription_data[metadata][plan_slug]"), "starter");
  assert.equal(captured.opts.body.get("currency"), null, "subscription-Mode: Price bestimmt Waehrung");
  assert.deepEqual(result, { url: "https://stripe.test/c/cs_sub_1", sessionId: "cs_sub_1" });
});

test("createSubscriptionCheckoutSession: ohne idempotencyKey -> KEIN Idempotency-Key-Header (optionaler Param, Bestand)", async () => {
  let captured;
  await withStripeStub(
    async (url, opts) => {
      captured = { url, opts };
      return okJson({ id: "cs_sub_1", url: "https://stripe.test/c/cs_sub_1" });
    },
    () =>
      stripeBilling.createSubscriptionCheckoutSession({
        tenantRef: "tenant_a",
        customerId: "cus_new1",
        priceId: "price_starter",
        planSlug: "starter",
        successUrl: "https://agent.test/ok",
        cancelUrl: "https://agent.test/no",
      }),
  );
  assert.equal("Idempotency-Key" in captured.opts.headers, false);
});

test("createSubscriptionCheckoutSession: Nicht-2xx -> wirft HTTP-Status, OHNE Secret-Key", async () => {
  await withStripeStub(
    async () => ({ ok: false, status: 402, json: async () => ({}) }),
    () =>
      assert.rejects(
        () =>
          stripeBilling.createSubscriptionCheckoutSession({
            tenantRef: "tenant_a",
            customerId: "cus_new1",
            priceId: "price_starter",
            planSlug: "starter",
            successUrl: "https://agent.test/ok",
            cancelUrl: "https://agent.test/no",
          }),
        (err) => {
          assert.match(err.message, /HTTP 402/);
          assert.doesNotMatch(err.message, /sk_test|Bearer/);
          return true;
        },
      ),
  );
});

test("createSubscriptionCheckoutSession: Stripe resource_missing/customer -> CustomerMissingError, Message wie generisch, kein Secret-Leak", async () => {
  await withStripeStub(
    async () =>
      errJson(400, {
        error: { code: "resource_missing", param: "customer", message: "No such customer: 'cus_x'" },
      }),
    () =>
      assert.rejects(
        () =>
          stripeBilling.createSubscriptionCheckoutSession({
            tenantRef: "tenant_a",
            customerId: "cus_x",
            priceId: "price_starter",
            planSlug: "starter",
            successUrl: "https://agent.test/ok",
            cancelUrl: "https://agent.test/no",
          }),
        (err) => {
          assert.ok(err instanceof CustomerMissingError);
          assert.match(err.message, /HTTP 400/);
          assert.doesNotMatch(err.message, /sk_test|Bearer/, "Secret-Key/Bearer darf nicht leaken");
          return true;
        },
      ),
  );
});

test("createSetupCheckoutSession: Stripe resource_missing/customer -> ebenfalls CustomerMissingError (beweist den assertOk->assertOkWithDetail-Switch)", async () => {
  await withStripeStub(
    async () =>
      errJson(400, {
        error: { code: "resource_missing", param: "customer", message: "No such customer: 'cus_x'" },
      }),
    () =>
      assert.rejects(
        () =>
          stripeBilling.createSetupCheckoutSession({
            tenantRef: "tenant_a",
            customerId: "cus_x",
            successUrl: "https://agent.test/ok",
            cancelUrl: "https://agent.test/no",
          }),
        (err) => {
          assert.ok(err instanceof CustomerMissingError);
          return true;
        },
      ),
  );
});

test("createSubscriptionCheckoutSession: resource_missing auf einem ANDEREN param (price) -> generischer Error, NICHT CustomerMissingError (Praezisions-Guard)", async () => {
  await withStripeStub(
    async () => errJson(400, { error: { code: "resource_missing", param: "price" } }),
    () =>
      assert.rejects(
        () =>
          stripeBilling.createSubscriptionCheckoutSession({
            tenantRef: "tenant_a",
            customerId: "cus_x",
            priceId: "price_gone",
            planSlug: "starter",
            successUrl: "https://agent.test/ok",
            cancelUrl: "https://agent.test/no",
          }),
        (err) => {
          assert.equal(err instanceof CustomerMissingError, false, "nur code+param=customer heilt");
          assert.match(err.message, /HTTP 400/);
          return true;
        },
      ),
  );
});

test("getSubscriptionCheckoutResult: GET /v1/checkout/sessions/<id>?expand[]=subscription+default_payment_method, parst alle Felder", async () => {
  let captured;
  const result = await withStripeStub(
    async (url, opts) => {
      captured = { url, opts };
      return okJson({
        customer: "cus_new1",
        subscription: {
          id: "sub_new",
          default_payment_method: { id: "pm_b" },
          items: { data: [{ current_period_start: 1890864000, current_period_end: 1893456000 }] },
          metadata: { plan_slug: "starter" },
        },
      });
    },
    () => stripeBilling.getSubscriptionCheckoutResult("cs_sub_1"),
  );
  assert.ok(captured.url.includes("/v1/checkout/sessions/cs_sub_1"));
  assert.ok(captured.url.includes("expand[]=subscription"));
  assert.ok(captured.url.includes("expand[]=subscription.default_payment_method"));
  assert.equal(captured.opts.method, "GET");
  assert.deepEqual(result, {
    customerId: "cus_new1",
    paymentMethodId: "pm_b",
    paymentMethodType: null,
    subscriptionId: "sub_new",
    currentPeriodStart: 1890864000,
    currentPeriodEnd: 1893456000,
    planSlug: "starter",
  });
});

test("getSubscriptionCheckoutResult: fehlende Subscription -> wirft (Session nicht abgeschlossen)", async () => {
  await withStripeStub(
    async () => okJson({ customer: "cus_new1", subscription: null }),
    () =>
      assert.rejects(
        () => stripeBilling.getSubscriptionCheckoutResult("cs_sub_1"),
        /Session nicht abgeschlossen/,
      ),
  );
});

test("getSubscriptionCheckoutResult: fehlendes default_payment_method -> wirft (Karte nicht gespeichert)", async () => {
  await withStripeStub(
    async () =>
      okJson({
        customer: "cus_new1",
        subscription: { id: "sub_new", default_payment_method: null, items: { data: [] } },
      }),
    () =>
      assert.rejects(
        () => stripeBilling.getSubscriptionCheckoutResult("cs_sub_1"),
        /Karte nicht gespeichert/,
      ),
  );
});

test("getSubscriptionCheckoutResult: unexpandiertes pm-String + top-level-Perioden-Fallback + fehlender plan_slug -> null", async () => {
  const result = await withStripeStub(
    async () =>
      okJson({
        customer: "cus_new1",
        subscription: {
          id: "sub_new",
          default_payment_method: "pm_string",
          current_period_start: 1600000000,
          current_period_end: 1602592000,
          items: { data: [] },
        },
      }),
    () => stripeBilling.getSubscriptionCheckoutResult("cs_sub_1"),
  );
  assert.deepEqual(result, {
    customerId: "cus_new1",
    paymentMethodId: "pm_string",
    paymentMethodType: null,
    subscriptionId: "sub_new",
    currentPeriodStart: 1600000000,
    currentPeriodEnd: 1602592000,
    planSlug: null,
  });
});

test("retrieveSubscription: GET /v1/subscriptions/<id>?expand[]=latest_invoice, latest_invoice.total===0 -> numberSetupFeeExempt:true", async () => {
  let captured;
  const result = await withStripeStub(
    async (url, opts) => {
      captured = { url, opts };
      return okJson({
        metadata: { plan_slug: "starter" },
        latest_invoice: { total: 0 },
        status: "active",
      });
    },
    () => stripeBilling.retrieveSubscription("sub_1"),
  );
  assert.ok(captured.url.includes("/v1/subscriptions/sub_1"), "URL traegt die subscription_id");
  assert.ok(captured.url.includes("expand[]=latest_invoice"), "latest_invoice wird expandiert");
  assert.equal(captured.opts.method, "GET");
  assert.equal(captured.opts.headers.Authorization, `Bearer ${SECRET}`);
  assert.deepEqual(result, { planSlug: "starter", numberSetupFeeExempt: true, status: "active", cancelAtPeriodEnd: null });
});

test("retrieveSubscription: latest_invoice.total>0 -> numberSetupFeeExempt:false", async () => {
  const result = await withStripeStub(
    async () =>
      okJson({ metadata: { plan_slug: "business" }, latest_invoice: { total: 2900 } }),
    () => stripeBilling.retrieveSubscription("sub_2"),
  );
  assert.deepEqual(result, { planSlug: "business", numberSetupFeeExempt: false, status: null, cancelAtPeriodEnd: null });
});

test("retrieveSubscription: fehlendes latest_invoice -> numberSetupFeeExempt:false (fail-closed, nie raten)", async () => {
  const result = await withStripeStub(
    async () => okJson({ metadata: { plan_slug: "starter" } }),
    () => stripeBilling.retrieveSubscription("sub_3"),
  );
  assert.deepEqual(result, { planSlug: "starter", numberSetupFeeExempt: false, status: null, cancelAtPeriodEnd: null });
});

test("retrieveSubscription: fehlender plan_slug -> planSlug:null (Bestand unveraendert)", async () => {
  const result = await withStripeStub(
    async () => okJson({ latest_invoice: { total: 0 } }),
    () => stripeBilling.retrieveSubscription("sub_4"),
  );
  assert.deepEqual(result, { planSlug: null, numberSetupFeeExempt: true, status: null, cancelAtPeriodEnd: null });
});

test("retrieveSubscription: cancel_at_period_end true/false -> cancelAtPeriodEnd als Wahrheitswert", async () => {
  const gekuendigt = await withStripeStub(
    async () => okJson({ status: "active", cancel_at_period_end: true }),
    () => stripeBilling.retrieveSubscription("sub_5"),
  );
  assert.equal(gekuendigt.cancelAtPeriodEnd, true, "Kündigung zum Periodenende wird gemeldet");
  const laufend = await withStripeStub(
    async () => okJson({ status: "active", cancel_at_period_end: false }),
    () => stripeBilling.retrieveSubscription("sub_6"),
  );
  assert.equal(laufend.cancelAtPeriodEnd, false, "laufendes Abo meldet false, nicht null");
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
  assert.equal(captured.opts.body.get("amount"), "500");
  assert.equal(captured.opts.body.get("currency"), "eur");
  assert.equal(captured.opts.body.get("capture_method"), "manual");
  assert.equal(captured.opts.body.get("confirm"), "true");
  assert.equal(captured.opts.body.get("customer"), "cus_1");
  assert.equal(captured.opts.body.get("payment_method"), "pm_1");
  assert.equal(captured.opts.body.get("off_session"), "true");
  assert.equal(captured.opts.body.get("metadata[tenant_ref]"), "tenant_a");
  assert.deepEqual(result, { paymentIntentId: "pi_held_1" });
});

const RAENDER_HOLD_ARGS = {
  tenantRef: "t_raender",
  amountCents: 300,
  currency: "eur",
  customerId: "cus_raender",
  paymentMethodId: "pm_raender",
  idempotencyKey: "raender-hold",
};

function raenderCaptureFehler(body) {
  return withStripeStub(async () => errJson(500, body), () =>
    stripeBilling.captureHold("pi_raender", 300),
  );
}

test("captureHold: Fehlerkoerper null -> normaler HTTP-Fehler, kein TypeError", async () => {
  await assert.rejects(raenderCaptureFehler(null), (err) => {
    assert.ok(!(err instanceof TypeError));
    assert.equal(err.providerStatus, 500);
    return true;
  });
});

test("captureHold: Fehlerkoerper ohne error-Objekt -> HTTP-Fehler", async () => {
  await assert.rejects(raenderCaptureFehler({}), (err) => {
    assert.ok(!(err instanceof TypeError));
    assert.equal(err.providerStatus, 500);
    return true;
  });
});

test("captureHold: Code passt, aber ohne payment_intent -> HTTP-Fehler", async () => {
  await assert.rejects(raenderCaptureFehler({ error: { code: "payment_intent_unexpected_state" } }), (err) => {
    assert.ok(!(err instanceof TypeError));
    assert.equal(err.providerStatus, 500);
    return true;
  });
});

test("captureHold: anderer Code trotz Status succeeded -> weiterhin Fehler", async () => {
  await assert.rejects(
    raenderCaptureFehler({ error: { code: "card_declined", payment_intent: { status: "succeeded" } } }),
    (err) => err.providerStatus === 500,
  );
});

test("captureHold: bereits eingezogen (Code und Status passen) -> kein Fehler", async () => {
  await raenderCaptureFehler({
    error: { code: "payment_intent_unexpected_state", payment_intent: { status: "succeeded" } },
  });
});

test("placeHold: Fehlerkoerper null -> Fehler mit Status, kein TypeError", async () => {
  await assert.rejects(
    withStripeStub(async () => errJson(402, null), () =>
      stripeBilling.placeHold(RAENDER_HOLD_ARGS),
    ),
    (err) => {
      assert.ok(!(err instanceof TypeError));
      assert.equal(err.providerStatus, 402);
      return true;
    },
  );
});

test("createSetupCheckoutSession: Fehlerkoerper null -> Fehler mit Status, kein TypeError", async () => {
  await assert.rejects(
    withStripeStub(async () => errJson(400, null), () =>
      stripeBilling.createSetupCheckoutSession({
        tenantRef: "t_raender",
        customerId: "cus_raender",
        successUrl: "https://example.test/ok",
        cancelUrl: "https://example.test/no",
      }),
    ),
    (err) => {
      assert.ok(!(err instanceof TypeError));
      assert.equal(err.providerStatus, 400);
      return true;
    },
  );
});

test("getCheckoutSessionResult: Antwort ohne setup_intent -> Meldung kein payment_method", async () => {
  await assert.rejects(
    withStripeStub(async () => okJson({ customer: "cus_raender" }), () =>
      stripeBilling.getCheckoutSessionResult("cs_raender"),
    ),
    /kein payment_method/,
  );
});

test("scheduleCancellation: id der Antwort gilt vor der angefragten id", async () => {
  const result = await withStripeStub(
    async () => okJson({ id: "sub_antwort" }),
    () => stripeBilling.scheduleCancellation({ subscriptionId: "sub_angefragt", idempotencyKey: "k" }),
  );
  assert.equal(result.subscriptionId, "sub_antwort");
});

test("scheduleCancellation: Antwort ohne id -> angefragte id", async () => {
  const result = await withStripeStub(async () => okJson({}), () =>
    stripeBilling.scheduleCancellation({ subscriptionId: "sub_angefragt", idempotencyKey: "k" }),
  );
  assert.equal(result.subscriptionId, "sub_angefragt");
});

async function mitBillingWert(schluessel, wert, fn) {
  const gesichert = config.billing[schluessel];
  config.billing[schluessel] = wert;
  try {
    return await fn();
  } finally {
    config.billing[schluessel] = gesichert;
  }
}

function zaehlendeAnfrage() {
  const aufrufe = [];
  const fetchImpl = async (url, opts) => {
    aufrufe.push({ url, waehrung: opts.body?.get("currency"), auth: opts.headers.Authorization });
    return okJson({ id: "cus_1", url: "https://stripe.test/c" });
  };
  return { aufrufe, fetchImpl };
}

const SITZUNG_ARGUMENTE = {
  tenantRef: "tenant_a",
  customerId: "cus_1",
  successUrl: "https://agent.test/ok",
  cancelUrl: "https://agent.test/no",
};

test("Konfiguration: ein Schluessel ohne Zeichenkette gilt als fehlend und es geht keine Anfrage raus", async () => {
  const { aufrufe, fetchImpl } = zaehlendeAnfrage();
  await assert.rejects(
    withStripeStub(fetchImpl, () =>
      mitBillingWert("stripeSecretKey", undefined, () => stripeBilling.createCustomer({ tenantRef: "tenant_a" })),
    ),
    { message: "Stripe Billing: STRIPE_SECRET_KEY fehlt" },
  );
  assert.deepEqual(aufrufe, []);
});

test("Konfiguration: ein leerer Schluessel gilt als fehlend und es geht keine Anfrage raus", async () => {
  const { aufrufe, fetchImpl } = zaehlendeAnfrage();
  await assert.rejects(
    withStripeStub(fetchImpl, () =>
      mitBillingWert("stripeSecretKey", "", () => stripeBilling.createCustomer({ tenantRef: "tenant_a" })),
    ),
    { message: "Stripe Billing: STRIPE_SECRET_KEY fehlt" },
  );
  assert.deepEqual(aufrufe, []);
});

test("Konfiguration: ohne Stripe-Adresse geht keine Anfrage an eine Adresse 'undefined' raus", async () => {
  const { aufrufe, fetchImpl } = zaehlendeAnfrage();
  await assert.rejects(
    withStripeStub(fetchImpl, () =>
      mitBillingWert("stripeApiBase", undefined, () => stripeBilling.createCustomer({ tenantRef: "tenant_a" })),
    ),
    { name: "ZodError" },
  );
  assert.deepEqual(aufrufe, []);
});

test("Konfiguration: ohne Waehrung geht keine Checkout-Sitzung mit Waehrung 'undefined' raus", async () => {
  const { aufrufe, fetchImpl } = zaehlendeAnfrage();
  await assert.rejects(
    withStripeStub(fetchImpl, () =>
      mitBillingWert("paymentCurrency", undefined, () => stripeBilling.createSetupCheckoutSession(SITZUNG_ARGUMENTE)),
    ),
    { name: "ZodError" },
  );
  assert.deepEqual(aufrufe, []);
});

test("Konfiguration: mit gueltigen Werten geht die Anfrage mit Waehrung und Schluessel aus der Konfiguration raus", async () => {
  const { aufrufe, fetchImpl } = zaehlendeAnfrage();
  await withStripeStub(fetchImpl, () =>
    mitBillingWert("paymentCurrency", "usd", () => stripeBilling.createSetupCheckoutSession(SITZUNG_ARGUMENTE)),
  );
  assert.equal(aufrufe.length, 1);
  assert.ok(aufrufe[0].url.endsWith("/v1/checkout/sessions"));
  assert.equal(aufrufe[0].waehrung, "usd");
  assert.equal(aufrufe[0].auth, `Bearer ${SECRET}`);
});

const unlesbar = () => ({
  ok: true,
  status: 200,
  json: async () => {
    throw new SyntaxError("kein JSON");
  },
});

const MIT_UNLESBARER_ANTWORT = [
  ["placeHold", () =>
    stripeBilling.placeHold({
      tenantRef: "tenant_a",
      amountCents: 100,
      currency: "eur",
      customerId: "cus_1",
      paymentMethodId: "pm_1",
    }), { paymentIntentId: undefined }],
  ["createCustomer", () => stripeBilling.createCustomer({ tenantRef: "tenant_a" }), { customerId: undefined }],
  ["createSetupCheckoutSession", () => stripeBilling.createSetupCheckoutSession(SITZUNG_ARGUMENTE), {
    url: undefined,
    sessionId: undefined,
  }],
  ["retrievePriceAmount", () => stripeBilling.retrievePriceAmount("price_1"), { unitAmountCents: null, currency: null }],
  ["retrieveSubscription", () => stripeBilling.retrieveSubscription("sub_1"), {
    planSlug: null,
    numberSetupFeeExempt: false,
    status: null,
    cancelAtPeriodEnd: null,
  }],
];

for (const [name, aufruf, erwartet] of MIT_UNLESBARER_ANTWORT) {
  test(`Antwort ohne lesbaren Koerper: ${name} liefert leere Felder statt eines Absturzes`, async () => {
    const ergebnis = await withStripeStub(async () => unlesbar(), aufruf);
    assert.deepEqual(ergebnis, erwartet);
  });
}

test("Antwort ohne lesbaren Koerper: getCheckoutSessionResult meldet die fehlende Karte", async () => {
  await assert.rejects(
    withStripeStub(async () => unlesbar(), () => stripeBilling.getCheckoutSessionResult("cs_1")),
    { message: "Stripe getCheckoutSessionResult: kein payment_method (Karte nicht gespeichert)" },
  );
});

test("Antwort ohne lesbaren Koerper: getSubscriptionCheckoutResult meldet die fehlende Subscription", async () => {
  await assert.rejects(
    withStripeStub(async () => unlesbar(), () => stripeBilling.getSubscriptionCheckoutResult("cs_1")),
    { message: "Stripe getSubscriptionCheckoutResult: keine Subscription (Session nicht abgeschlossen)" },
  );
});

test("Fehlermeldung ohne Detail: HTTP-Status steht ohne Nachsatz und ohne Leerzeichen am Ende", async () => {
  await assert.rejects(
    withStripeStub(async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => "" }), () =>
      stripeBilling.cancelHold("pi_1"),
    ),
    { message: "Stripe cancelHold fehlgeschlagen: HTTP 503" },
  );
});

test("retrievePaymentMethodType: Karte liefert 'card', unlesbare Antwort liefert null", async () => {
  const karte = await withStripeStub(async () => okJson({ type: "card" }), () =>
    stripeBilling.retrievePaymentMethodType("pm_1"),
  );
  assert.equal(karte, "card");
  const unlesbarErgebnis = await withStripeStub(async () => unlesbar(), () =>
    stripeBilling.retrievePaymentMethodType("pm_1"),
  );
  assert.equal(unlesbarErgebnis, null);
});
