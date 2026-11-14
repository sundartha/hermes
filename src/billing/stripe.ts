import { z } from "zod";
import { config } from "../config.js";
import { paymentMethodIdOf, paymentMethodTypeOf, periodFieldsOf } from "./webhook.js";
import { CustomerMissingError, PaymentAuthenticationRequiredError } from "./errors.ts";
import { declineOf, declineDetail, attachProviderDecline } from "./decline.ts";
import { anfrage as anfrageJs } from "../utils/anfrage.js";
import { umhuelleAnbieter } from "../utils/anbieter-messung.js";

const paymentMethodIdVon: (paymentMethod: unknown) => string | null = paymentMethodIdOf;
const paymentMethodTypeVon: (paymentMethod: unknown) => string | null = paymentMethodTypeOf;
const periodFieldsVon: (sub: unknown) => { currentPeriodStart: unknown; currentPeriodEnd: unknown } = periodFieldsOf;
const umhuelleVon: <T extends object>(anbieter: string, objekt: T) => T = umhuelleAnbieter;
const anfrage: (
  url: string,
  optionen: { method: string; headers: Kopfzeilen; body?: URLSearchParams; fristMs: number },
) => Promise<Antwort> = anfrageJs;
const parseJson: (text: string) => FehlerKoerper = JSON.parse;
const STRIPE_KONFIG = z.object({
  billing: z.object({
    stripeSecretKey: z.string().catch(""),
    stripeApiBase: z.string(),
    paymentCurrency: z.string(),
  }),
});

interface StripeFehler {
  code?: unknown;
  param?: unknown;
  payment_intent?: { status?: unknown } | null;
  [feld: string]: unknown;
}

interface FehlerKoerper {
  error?: StripeFehler;
}

interface StripeAbo {
  id?: string;
  default_payment_method?: unknown;
  metadata?: { plan_slug?: string } | null;
}

interface StripeAntwort extends FehlerKoerper {
  id?: string;
  url?: string;
  customer?: string;
  setup_intent?: { payment_method?: unknown } | null;
  subscription?: StripeAbo | null;
  unit_amount?: unknown;
  currency?: unknown;
  metadata?: { plan_slug?: string } | null;
  latest_invoice?: { total?: unknown } | null;
  status?: unknown;
  cancel_at_period_end?: unknown;
}

interface Antwort {
  ok: boolean;
  status: number;
  json(): Promise<StripeAntwort>;
  text(): Promise<string>;
}

type Kopfzeilen = Record<string, string>;

interface CancellationArgs {
  subscriptionId: string;
  idempotencyKey?: string | undefined;
}

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

const STRIPE_LESEN_FRIST_MS = 10_000;
const STRIPE_SCHREIBEN_MIT_KEY_FRIST_MS = 15_000;
const STRIPE_ZAHLUNG_SCHREIBEN_FRIST_MS = 30_000;

export const STRIPE_METER_EVENT_NAME: Readonly<Record<string, string>> = Object.freeze({
  voice_minute: "voice_minutes",
  ai_token: "ai_tokens",
  sms: "sms_messages",
  number_month: "number_months",
});

function stripeKonfig(): z.infer<typeof STRIPE_KONFIG>["billing"] {
  return STRIPE_KONFIG.parse(config).billing;
}

function authHeaders(extra: Kopfzeilen = {}): Kopfzeilen {
  const { stripeSecretKey } = stripeKonfig();
  if (!stripeSecretKey) throw new Error("Stripe Billing: STRIPE_SECRET_KEY fehlt");
  return {
    Authorization: `Bearer ${stripeSecretKey}`,
    "Content-Type": "application/x-www-form-urlencoded",
    ...extra,
  };
}

function idempotentHeaders(idempotencyKey: string | undefined): Kopfzeilen {
  return authHeaders(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {});
}

function failureMessage(op: string, status: number, detail = ""): string {
  return `Stripe ${op} fehlgeschlagen: HTTP ${String(status)} ${detail}`.trimEnd();
}

function mitStatus<E extends Error>(err: E, status: number): E & { providerStatus: number } {
  return Object.assign(err, { providerStatus: status });
}

function assertOk(res: Antwort, op: string): void {
  if (!res.ok) throw mitStatus(new Error(failureMessage(op, res.status)), res.status);
}

function isAlreadyCapturedError(errorBody: FehlerKoerper | null | undefined): boolean {
  const err = errorBody?.error;
  return err?.code === PI_UNEXPECTED_STATE_CODE && err.payment_intent?.status === PI_STATUS_SUCCEEDED;
}

async function readErrorBody(res: Antwort): Promise<{ text: string; body: FehlerKoerper }> {
  let text = "";
  try {
    text = await res.text();
  } catch {
  }
  try {
    return { text, body: parseJson(text) };
  } catch {
    return { text, body: {} };
  }
}

async function leseJsonKoerper(res: Antwort): Promise<StripeAntwort> {
  try {
    return await res.json();
  } catch (err) {
    if (err instanceof SyntaxError) return {};
    throw err;
  }
}

function billingErrorFor(errorBody: FehlerKoerper | null | undefined, message: string): Error {
  const err: StripeFehler = errorBody?.error ?? {};
  if (err.code === AUTHENTICATION_REQUIRED_CODE)
    return new PaymentAuthenticationRequiredError(message);
  if (err.code === RESOURCE_MISSING_CODE && err.param === CUSTOMER_PARAM)
    return new CustomerMissingError(message);
  return new Error(message);
}

function classifiedError({
  body,
  op,
  status,
  detail = "",
}: {
  body: FehlerKoerper;
  op: string;
  status: number;
  detail?: string;
}) {
  const decline = declineOf(body);
  const nachtrag = [declineDetail(decline), detail].filter(Boolean).join(" ");
  const err = attachProviderDecline(billingErrorFor(body, failureMessage(op, status, nachtrag)), decline);
  return mitStatus(err, status);
}

async function assertOkClassified(res: Antwort, op: string): Promise<void> {
  if (res.ok) return;
  const { body } = await readErrorBody(res);
  throw classifiedError({ body, op, status: res.status });
}

async function assertOkWithDetail(res: Antwort, op: string): Promise<void> {
  if (res.ok) return;
  const { text, body } = await readErrorBody(res);
  throw classifiedError({ body, op, status: res.status, detail: text });
}

const url = (path: string): string => stripeKonfig().stripeApiBase + path;

export const stripeBilling = umhuelleVon("stripe", {
  async placeHold({
    tenantRef,
    amountCents,
    currency,
    customerId,
    paymentMethodId,
    idempotencyKey,
  }: {
    tenantRef: string;
    amountCents: number;
    currency: string;
    customerId: string;
    paymentMethodId: string;
    idempotencyKey?: string | undefined;
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
    const res = await anfrage(url(PAYMENT_INTENTS_PATH), {
      method: "POST",
      headers,
      body,
      fristMs: STRIPE_ZAHLUNG_SCHREIBEN_FRIST_MS,
    });
    await assertOkClassified(res, "placeHold");
    const json: StripeAntwort = await res.json().catch(() => ({}));
    return { paymentIntentId: json.id };
  },

  async captureHold(paymentIntentId: string, amountCents: number) {
    const body = new URLSearchParams({ amount_to_capture: String(amountCents) });
    const res = await anfrage(`${url(PAYMENT_INTENTS_PATH)}/${paymentIntentId}/capture`, {
      method: "POST",
      headers: authHeaders(),
      body,
      fristMs: STRIPE_ZAHLUNG_SCHREIBEN_FRIST_MS,
    });
    if (res.ok) return;
    const errorBody: FehlerKoerper = await res.json().catch(() => ({}));
    if (isAlreadyCapturedError(errorBody)) return;
    assertOk(res, "captureHold");
  },

  async cancelHold(paymentIntentId: string) {
    const res = await anfrage(`${url(PAYMENT_INTENTS_PATH)}/${paymentIntentId}/cancel`, {
      method: "POST",
      headers: authHeaders(),
      fristMs: STRIPE_ZAHLUNG_SCHREIBEN_FRIST_MS,
    });
    assertOk(res, "cancelHold");
  },

  async reportMeter({
    tenantRef,
    kind,
    quantity,
    idempotencyKey,
  }: {
    tenantRef: string;
    kind: string;
    quantity: number;
    idempotencyKey?: string | undefined;
  }) {
    const eventName = STRIPE_METER_EVENT_NAME[kind];
    if (!eventName) throw new Error(`Stripe reportMeter: unbekanntes kind '${kind}'`);
    const headers = idempotentHeaders(idempotencyKey);
    const body = new URLSearchParams({ event_name: eventName });
    body.set("payload[value]", String(quantity));
    body.set("payload[tenant_ref]", tenantRef);
    const res = await anfrage(url(METER_EVENTS_PATH), {
      method: "POST",
      headers,
      body,
      fristMs: STRIPE_ZAHLUNG_SCHREIBEN_FRIST_MS,
    });
    assertOk(res, "reportMeter");
  },

  async createCustomer({ tenantRef }: { tenantRef: string }) {
    const body = new URLSearchParams();
    body.set("metadata[tenant_ref]", tenantRef);
    const res = await anfrage(url(CUSTOMERS_PATH), {
      method: "POST",
      headers: authHeaders(),
      body,
      fristMs: STRIPE_ZAHLUNG_SCHREIBEN_FRIST_MS,
    });
    assertOk(res, "createCustomer");
    const json: StripeAntwort = await res.json().catch(() => ({}));
    return { customerId: json.id };
  },

  async createSetupCheckoutSession({
    tenantRef,
    customerId,
    successUrl,
    cancelUrl,
  }: {
    tenantRef: string;
    customerId: string;
    successUrl: string;
    cancelUrl: string;
  }) {
    const body = new URLSearchParams({
      mode: CHECKOUT_SETUP_MODE,
      customer: customerId,
      currency: stripeKonfig().paymentCurrency,
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
    body.set("metadata[tenant_ref]", tenantRef);
    const res = await anfrage(url(CHECKOUT_SESSIONS_PATH), {
      method: "POST",
      headers: authHeaders(),
      body,
      fristMs: STRIPE_ZAHLUNG_SCHREIBEN_FRIST_MS,
    });
    await assertOkWithDetail(res, "createSetupCheckoutSession");
    const json: StripeAntwort = await res.json().catch(() => ({}));
    return { url: json.url, sessionId: json.id };
  },

  async getCheckoutSessionResult(sessionId: string) {
    const expand = "expand[]=setup_intent&expand[]=setup_intent.payment_method";
    const res = await anfrage(`${url(CHECKOUT_SESSIONS_PATH)}/${sessionId}?${expand}`, {
      method: "GET",
      headers: authHeaders(),
      fristMs: STRIPE_LESEN_FRIST_MS,
    });
    assertOk(res, "getCheckoutSessionResult");
    const json: StripeAntwort = await res.json().catch(() => ({}));
    const paymentMethod = json.setup_intent?.payment_method;
    const paymentMethodId = paymentMethodIdVon(paymentMethod);
    if (!paymentMethodId)
      throw new Error(
        "Stripe getCheckoutSessionResult: kein payment_method (Karte nicht gespeichert)",
      );
    return {
      customerId: json.customer,
      paymentMethodId,
      paymentMethodType: paymentMethodTypeVon(paymentMethod),
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
  }: {
    tenantRef: string;
    customerId: string;
    priceId: string;
    planSlug: string;
    successUrl: string;
    cancelUrl: string;
    idempotencyKey?: string | undefined;
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
    const res = await anfrage(url(CHECKOUT_SESSIONS_PATH), {
      method: "POST",
      headers,
      body,
      fristMs: STRIPE_SCHREIBEN_MIT_KEY_FRIST_MS,
    });
    await assertOkWithDetail(res, "createSubscriptionCheckoutSession");
    const json = await leseJsonKoerper(res);
    return { url: json.url, sessionId: json.id };
  },

  async getSubscriptionCheckoutResult(sessionId: string) {
    const expand = "expand[]=subscription&expand[]=subscription.default_payment_method";
    const res = await anfrage(`${url(CHECKOUT_SESSIONS_PATH)}/${sessionId}?${expand}`, {
      method: "GET",
      headers: authHeaders(),
      fristMs: STRIPE_LESEN_FRIST_MS,
    });
    assertOk(res, "getSubscriptionCheckoutResult");
    const json: StripeAntwort = await res.json().catch(() => ({}));
    const sub = json.subscription;
    if (!sub?.id)
      throw new Error(
        "Stripe getSubscriptionCheckoutResult: keine Subscription (Session nicht abgeschlossen)",
      );
    const paymentMethodId = paymentMethodIdVon(sub.default_payment_method);
    if (!paymentMethodId)
      throw new Error(
        "Stripe getSubscriptionCheckoutResult: kein payment_method (Karte nicht gespeichert)",
      );
    return {
      customerId: json.customer,
      paymentMethodId,
      paymentMethodType: paymentMethodTypeVon(sub.default_payment_method),
      subscriptionId: sub.id,
      ...periodFieldsVon(sub),
      planSlug: sub.metadata?.plan_slug ?? null,
    };
  },

  async retrievePaymentMethodType(paymentMethodId: string) {
    const res = await anfrage(`${url(PAYMENT_METHODS_PATH)}/${paymentMethodId}`, {
      method: "GET",
      headers: authHeaders(),
      fristMs: STRIPE_LESEN_FRIST_MS,
    });
    assertOk(res, "retrievePaymentMethodType");
    return paymentMethodTypeVon(await res.json().catch(() => ({})));
  },

  async retrievePriceAmount(priceId: string) {
    const res = await anfrage(`${url(PRICES_PATH)}/${priceId}`, {
      method: "GET",
      headers: authHeaders(),
      fristMs: STRIPE_LESEN_FRIST_MS,
    });
    assertOk(res, "retrievePriceAmount");
    const json: StripeAntwort = await res.json().catch(() => ({}));
    return {
      unitAmountCents: Number.isInteger(json.unit_amount) ? json.unit_amount : null,
      currency: typeof json.currency === "string" ? json.currency : null,
    };
  },

  async createSubscription({
    tenantRef,
    planSlug,
    customerId,
    priceId,
    paymentMethodId,
    idempotencyKey,
  }: {
    tenantRef: string;
    planSlug: string;
    customerId: string;
    priceId: string;
    paymentMethodId: string;
    idempotencyKey?: string | undefined;
  }) {
    const headers = idempotentHeaders(idempotencyKey);
    const body = new URLSearchParams({
      customer: customerId,
      "items[0][price]": priceId,
      default_payment_method: paymentMethodId,
      off_session: OFF_SESSION,
      payment_behavior: SUBSCRIPTION_FAILCLOSED_BEHAVIOR,
    });
    body.set("metadata[tenant_ref]", tenantRef);
    body.set("metadata[plan_slug]", planSlug);
    const res = await anfrage(url(SUBSCRIPTIONS_PATH), {
      method: "POST",
      headers,
      body,
      fristMs: STRIPE_SCHREIBEN_MIT_KEY_FRIST_MS,
    });
    await assertOkClassified(res, "createSubscription");
    const json = await leseJsonKoerper(res);
    return { subscriptionId: json.id, ...periodFieldsVon(json) };
  },

  async retrieveSubscription(subscriptionId: string) {
    const res = await anfrage(`${url(SUBSCRIPTIONS_PATH)}/${subscriptionId}?expand[]=latest_invoice`, {
      method: "GET",
      headers: authHeaders(),
      fristMs: STRIPE_LESEN_FRIST_MS,
    });
    assertOk(res, "retrieveSubscription");
    const json: StripeAntwort = await res.json().catch(() => ({}));
    const invoiceTotal = json.latest_invoice?.total;
    return {
      planSlug: json.metadata?.plan_slug ?? null,
      numberSetupFeeExempt: typeof invoiceTotal === "number" ? invoiceTotal === 0 : false,
      status: typeof json.status === "string" ? json.status : null,
      cancelAtPeriodEnd: typeof json.cancel_at_period_end === "boolean" ? json.cancel_at_period_end : null,
    };
  },

  async scheduleCancellation({ subscriptionId, idempotencyKey }: CancellationArgs) {
    return await patchCancelAtPeriodEnd(subscriptionId, true, idempotencyKey);
  },
  async unscheduleCancellation({ subscriptionId, idempotencyKey }: CancellationArgs) {
    return await patchCancelAtPeriodEnd(subscriptionId, false, idempotencyKey);
  },
});

async function patchCancelAtPeriodEnd(
  subscriptionId: string,
  cancelAtPeriodEnd: boolean,
  idempotencyKey: string | undefined,
) {
  const headers = idempotentHeaders(idempotencyKey);
  const body = new URLSearchParams({ cancel_at_period_end: String(cancelAtPeriodEnd) });
  const res = await anfrage(`${url(SUBSCRIPTIONS_PATH)}/${subscriptionId}`, {
    method: "POST",
    headers,
    body,
    fristMs: STRIPE_SCHREIBEN_MIT_KEY_FRIST_MS,
  });
  assertOk(res, cancelAtPeriodEnd ? "scheduleCancellation" : "unscheduleCancellation");
  const json: StripeAntwort = await res.json().catch(() => ({}));
  return { subscriptionId: json.id ?? subscriptionId, cancelAtPeriodEnd, ...periodFieldsVon(json) };
}
