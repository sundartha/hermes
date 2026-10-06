import { config } from "../config.js";
import { paymentMethodIdOf, paymentMethodTypeOf, periodFieldsOf } from "./webhook.js";
import { CustomerMissingError, PaymentAuthenticationRequiredError } from "./errors.js";
import { declineOf, declineDetail, attachProviderDecline } from "./decline.js";

const PAYMENT_INTENTS_PATH = "/v1/payment_intents";
const METER_EVENTS_PATH = "/v1/billing/meter_events";
const CUSTOMERS_PATH = "/v1/customers";
const CHECKOUT_SESSIONS_PATH = "/v1/checkout/sessions";
const SUBSCRIPTIONS_PATH = "/v1/subscriptions";
const PAYMENT_METHODS_PATH = "/v1/payment_methods";
const PRICES_PATH = "/v1/prices";
const CHECKOUT_SETUP_MODE = "setup";
const CHECKOUT_SUBSCRIPTION_MODE = "subscription";
const PAYMENT_METHOD_COLLECTION_ALWAYS = "always";
const OFF_SESSION = "true";
const SUBSCRIPTION_FAILCLOSED_BEHAVIOR = "error_if_incomplete";

const PI_UNEXPECTED_STATE_CODE = "payment_intent_unexpected_state";
const PI_STATUS_SUCCEEDED = "succeeded";

const RESOURCE_MISSING_CODE = "resource_missing";
const CUSTOMER_PARAM = "customer";

const AUTHENTICATION_REQUIRED_CODE = "authentication_required";

export const STRIPE_METER_EVENT_NAME = Object.freeze({
  voice_minute: "voice_minutes",
  ai_token: "ai_tokens",
  sms: "sms_messages",
  number_month: "number_months",
});

function authHeaders(extra = {}) {
  if (!config.billing.stripeSecretKey) throw new Error("Stripe Billing: STRIPE_SECRET_KEY fehlt");
  return {
    Authorization: `Bearer ${config.billing.stripeSecretKey}`,
    "Content-Type": "application/x-www-form-urlencoded",
    ...extra,
  };
}

function idempotentHeaders(idempotencyKey) {
  return authHeaders(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {});
}

function failureMessage(op, status, detail = "") {
  return `Stripe ${op} fehlgeschlagen: HTTP ${status} ${detail}`.trimEnd();
}

function assertOk(res, op) {
  if (!res.ok) throw new Error(failureMessage(op, res.status));
}

function isAlreadyCapturedError(errorBody) {
  const err = errorBody && errorBody.error;
  return Boolean(
    err &&
      err.code === PI_UNEXPECTED_STATE_CODE &&
      err.payment_intent &&
      err.payment_intent.status === PI_STATUS_SUCCEEDED,
  );
}

async function readErrorBody(res) {
  let text = "";
  try {
    text = await res.text();
  } catch {
  }
  try {
    return { text, body: JSON.parse(text) };
  } catch {
    return { text, body: {} };
  }
}

function billingErrorFor(errorBody, message) {
  const err = (errorBody && errorBody.error) || {};
  if (err.code === AUTHENTICATION_REQUIRED_CODE)
    return new PaymentAuthenticationRequiredError(message);
  if (err.code === RESOURCE_MISSING_CODE && err.param === CUSTOMER_PARAM)
    return new CustomerMissingError(message);
  return new Error(message);
}

function classifiedError({ body, op, status, detail = "" }) {
  const decline = declineOf(body);
  const nachtrag = [declineDetail(decline), detail].filter(Boolean).join(" ");
  return attachProviderDecline(billingErrorFor(body, failureMessage(op, status, nachtrag)), decline);
}

async function assertOkClassified(res, op) {
  if (res.ok) return;
  const { body } = await readErrorBody(res);
  throw classifiedError({ body, op, status: res.status });
}

async function assertOkWithDetail(res, op) {
  if (res.ok) return;
  const { text, body } = await readErrorBody(res);
  throw classifiedError({ body, op, status: res.status, detail: text });
}

const url = (path) => config.billing.stripeApiBase + path;

export const stripeBilling = {
  async placeHold({
    tenantRef,
    amountCents,
    currency,
    customerId,
    paymentMethodId,
    idempotencyKey,
  }) {
    const headers = idempotentHeaders(idempotencyKey);
    const body = new URLSearchParams({
      amount: String(amountCents),
      currency,
      capture_method: "manual",
      confirm: "true",
      customer: customerId,
      payment_method: paymentMethodId,
      off_session: OFF_SESSION,
    });
    body.set("metadata[tenant_ref]", tenantRef);
    const res = await fetch(url(PAYMENT_INTENTS_PATH), { method: "POST", headers, body });
    await assertOkClassified(res, "placeHold");
    const json = await res.json().catch(() => ({}));
    return { paymentIntentId: json.id };
  },

  async captureHold(paymentIntentId, amountCents) {
    const body = new URLSearchParams({ amount_to_capture: String(amountCents) });
    const res = await fetch(`${url(PAYMENT_INTENTS_PATH)}/${paymentIntentId}/capture`, {
      method: "POST",
      headers: authHeaders(),
      body,
    });
    if (res.ok) return;
    const errorBody = await res.json().catch(() => ({}));
    if (isAlreadyCapturedError(errorBody)) return;
    assertOk(res, "captureHold");
  },

  async cancelHold(paymentIntentId) {
    const res = await fetch(`${url(PAYMENT_INTENTS_PATH)}/${paymentIntentId}/cancel`, {
      method: "POST",
      headers: authHeaders(),
    });
    assertOk(res, "cancelHold");
  },

  async reportMeter({ tenantRef, kind, quantity, idempotencyKey }) {
    const eventName = STRIPE_METER_EVENT_NAME[kind];
    if (!eventName) throw new Error(`Stripe reportMeter: unbekanntes kind '${kind}'`);
    const headers = idempotentHeaders(idempotencyKey);
    const body = new URLSearchParams({ event_name: eventName });
    body.set("payload[value]", String(quantity));
    body.set("payload[tenant_ref]", tenantRef);
    const res = await fetch(url(METER_EVENTS_PATH), { method: "POST", headers, body });
    assertOk(res, "reportMeter");
  },

  async createCustomer({ tenantRef }) {
    const body = new URLSearchParams();
    body.set("metadata[tenant_ref]", tenantRef);
    const res = await fetch(url(CUSTOMERS_PATH), { method: "POST", headers: authHeaders(), body });
    assertOk(res, "createCustomer");
    const json = await res.json().catch(() => ({}));
    return { customerId: json.id };
  },

  async createSetupCheckoutSession({ tenantRef, customerId, successUrl, cancelUrl }) {
    const body = new URLSearchParams({
      mode: CHECKOUT_SETUP_MODE,
      customer: customerId,
      currency: config.billing.paymentCurrency,
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
    body.set("metadata[tenant_ref]", tenantRef);
    const res = await fetch(url(CHECKOUT_SESSIONS_PATH), {
      method: "POST",
      headers: authHeaders(),
      body,
    });
    await assertOkWithDetail(res, "createSetupCheckoutSession");
    const json = await res.json().catch(() => ({}));
    return { url: json.url, sessionId: json.id };
  },

  async getCheckoutSessionResult(sessionId) {
    const expand = "expand[]=setup_intent&expand[]=setup_intent.payment_method";
    const res = await fetch(`${url(CHECKOUT_SESSIONS_PATH)}/${sessionId}?${expand}`, {
      method: "GET",
      headers: authHeaders(),
    });
    assertOk(res, "getCheckoutSessionResult");
    const json = await res.json().catch(() => ({}));
    const paymentMethod = json.setup_intent && json.setup_intent.payment_method;
    const paymentMethodId = paymentMethodIdOf(paymentMethod);
    if (!paymentMethodId)
      throw new Error(
        "Stripe getCheckoutSessionResult: kein payment_method (Karte nicht gespeichert)",
      );
    return {
      customerId: json.customer,
      paymentMethodId,
      paymentMethodType: paymentMethodTypeOf(paymentMethod),
    };
  },

  async createSubscriptionCheckoutSession({
    tenantRef,
    customerId,
    priceId,
    planSlug,
    successUrl,
    cancelUrl,
    idempotencyKey,
  }) {
    const headers = idempotentHeaders(idempotencyKey);
    const body = new URLSearchParams({
      mode: CHECKOUT_SUBSCRIPTION_MODE,
      customer: customerId,
      success_url: successUrl,
      cancel_url: cancelUrl,
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      allow_promotion_codes: "true",
      payment_method_collection: PAYMENT_METHOD_COLLECTION_ALWAYS,
    });
    body.set("metadata[tenant_ref]", tenantRef);
    body.set("subscription_data[metadata][tenant_ref]", tenantRef);
    body.set("subscription_data[metadata][plan_slug]", planSlug);
    const res = await fetch(url(CHECKOUT_SESSIONS_PATH), { method: "POST", headers, body });
    await assertOkWithDetail(res, "createSubscriptionCheckoutSession");
    const json = await res.json().catch(() => ({}));
    return { url: json.url, sessionId: json.id };
  },

  async getSubscriptionCheckoutResult(sessionId) {
    const expand = "expand[]=subscription&expand[]=subscription.default_payment_method";
    const res = await fetch(`${url(CHECKOUT_SESSIONS_PATH)}/${sessionId}?${expand}`, {
      method: "GET",
      headers: authHeaders(),
    });
    assertOk(res, "getSubscriptionCheckoutResult");
    const json = await res.json().catch(() => ({}));
    const sub = json.subscription;
    if (!sub || !sub.id)
      throw new Error(
        "Stripe getSubscriptionCheckoutResult: keine Subscription (Session nicht abgeschlossen)",
      );
    const paymentMethodId = paymentMethodIdOf(sub.default_payment_method);
    if (!paymentMethodId)
      throw new Error(
        "Stripe getSubscriptionCheckoutResult: kein payment_method (Karte nicht gespeichert)",
      );
    return {
      customerId: json.customer,
      paymentMethodId,
      paymentMethodType: paymentMethodTypeOf(sub.default_payment_method),
      subscriptionId: sub.id,
      ...periodFieldsOf(sub),
      planSlug: (sub.metadata && sub.metadata.plan_slug) || null,
    };
  },

  async retrievePaymentMethodType(paymentMethodId) {
    const res = await fetch(`${url(PAYMENT_METHODS_PATH)}/${paymentMethodId}`, {
      method: "GET",
      headers: authHeaders(),
    });
    assertOk(res, "retrievePaymentMethodType");
    const json = await res.json().catch(() => ({}));
    return paymentMethodTypeOf(json);
  },

  async retrievePriceAmount(priceId) {
    const res = await fetch(`${url(PRICES_PATH)}/${priceId}`, { method: "GET", headers: authHeaders() });
    assertOk(res, "retrievePriceAmount");
    const json = await res.json().catch(() => ({}));
    return {
      unitAmountCents: Number.isInteger(json.unit_amount) ? json.unit_amount : null,
      currency: typeof json.currency === "string" ? json.currency : null,
    };
  },

  async createSubscription({ tenantRef, customerId, priceId, paymentMethodId, idempotencyKey }) {
    const headers = idempotentHeaders(idempotencyKey);
    const body = new URLSearchParams({
      customer: customerId,
      "items[0][price]": priceId,
      default_payment_method: paymentMethodId,
      off_session: OFF_SESSION,
      payment_behavior: SUBSCRIPTION_FAILCLOSED_BEHAVIOR,
    });
    body.set("metadata[tenant_ref]", tenantRef);
    const res = await fetch(url(SUBSCRIPTIONS_PATH), { method: "POST", headers, body });
    await assertOkClassified(res, "createSubscription");
    const json = await res.json().catch(() => ({}));
    return { subscriptionId: json.id, ...periodFieldsOf(json) };
  },

  async retrieveSubscription(subscriptionId) {
    const res = await fetch(`${url(SUBSCRIPTIONS_PATH)}/${subscriptionId}?expand[]=latest_invoice`, {
      method: "GET",
      headers: authHeaders(),
    });
    assertOk(res, "retrieveSubscription");
    const json = await res.json().catch(() => ({}));
    const invoiceTotal = json.latest_invoice && json.latest_invoice.total;
    return {
      planSlug: (json.metadata && json.metadata.plan_slug) || null,
      numberSetupFeeExempt: typeof invoiceTotal === "number" ? invoiceTotal === 0 : false,
      status: typeof json.status === "string" ? json.status : null,
    };
  },

  async scheduleCancellation({ subscriptionId, idempotencyKey }) {
    return await patchCancelAtPeriodEnd(subscriptionId, true, idempotencyKey);
  },
  async unscheduleCancellation({ subscriptionId, idempotencyKey }) {
    return await patchCancelAtPeriodEnd(subscriptionId, false, idempotencyKey);
  },
};

async function patchCancelAtPeriodEnd(subscriptionId, cancelAtPeriodEnd, idempotencyKey) {
  const headers = idempotentHeaders(idempotencyKey);
  const body = new URLSearchParams({ cancel_at_period_end: String(cancelAtPeriodEnd) });
  const res = await fetch(`${url(SUBSCRIPTIONS_PATH)}/${subscriptionId}`, {
    method: "POST",
    headers,
    body,
  });
  assertOk(res, cancelAtPeriodEnd ? "scheduleCancellation" : "unscheduleCancellation");
  const json = await res.json().catch(() => ({}));
  return { subscriptionId: json.id ?? subscriptionId, cancelAtPeriodEnd, ...periodFieldsOf(json) };
}
