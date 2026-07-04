// Stripe-Billing-Adapter (P6b1): BillingPort (placeHold/captureHold/cancelHold)
// ueber die Stripe-v1-REST-API. Loest ECHTES Geld aus (Hold + Capture) -> nur ueber
// die gegatete Onboarding-Route (PAYMENT_ENABLED) erreichbar. Kein SDK: fetch +
// Bearer. Stripe /v1 erwartet application/x-www-form-urlencoded (NICHT JSON).
// Secret-Key NIE in Fehlermeldungen leaken (Regel 4).
//
// Verifiziert gegen die Stripe-Doku (manual capture), live UNBESTAETIGT (mit dem
// Owner im Test-Mode live fixen, falls Felder abweichen): confirm=true +
// capture_method=manual setzt den PaymentIntent direkt auf 'requires_capture'.
// off_session=true + gespeicherter customer/payment_method belasten die hinterlegte
// Karte ohne Kunden-Interaktion (kein automatic_payment_methods/return_url noetig).
//   hold:    POST /v1/payment_intents  {amount, currency, capture_method=manual, confirm=true, customer, payment_method, off_session=true}
//   capture: POST /v1/payment_intents/{id}/capture  {amount_to_capture}
//   cancel:  POST /v1/payment_intents/{id}/cancel
//   meter:   POST /v1/billing/meter_events  {event_name, payload[value], ...}  (P6b3)
import { config } from "../config.js";

const PAYMENT_INTENTS_PATH = "/v1/payment_intents";
const METER_EVENTS_PATH = "/v1/billing/meter_events";
const CUSTOMERS_PATH = "/v1/customers";
const CHECKOUT_SESSIONS_PATH = "/v1/checkout/sessions";
const SUBSCRIPTIONS_PATH = "/v1/subscriptions"; // W4: monatliches Recurring
const CHECKOUT_SETUP_MODE = "setup"; // Karte speichern OHNE Abbuchung (kein Magic-String)
const CHECKOUT_SUBSCRIPTION_MODE = "subscription"; // Karte + Abo in EINEM gehosteten Schritt (kein Magic-String)
const OFF_SESSION = "true"; // Karte ohne Kunden-Interaktion belasten (kein 3DS-Redirect noetig)
// W4: Stripe legt bei fehlgeschlagener Erstzahlung KEIN incomplete-Abo an, sondern wirft
// (fail-closed, kein "Abo ohne Zahlung"). Kein Magic-String (G25).
const SUBSCRIPTION_FAILCLOSED_BEHAVIOR = "error_if_incomplete";

// PROV-01/F6: Stripe lehnt einen zweiten Capture desselben PaymentIntent mit diesem
// Fehlercode ab und meldet den PI-Status 'succeeded' (Geld bereits eingezogen). NUR diese
// Kombination gilt als idempotenter Erfolg (kein Magic-String, G25). Dokumentierte Stripe-
// Form, live im Owner-Smoke bestaetigen (wie der uebrige Adapter, live UNBESTAETIGT).
const PI_UNEXPECTED_STATE_CODE = "payment_intent_unexpected_state";
const PI_STATUS_SUCCEEDED = "succeeded";

// Logischer kind -> Stripe-Meter-event_name (Provider-Spezifik adapter-intern, G25).
// Live mit dem Owner gegen die echten Stripe-Meter abgleichen (geparkt, wie P6b1):
// die Customer-Bindung (stripe_customer_id pro Tenant) ist NICHT in P6b3-Scope ->
// der Meter meldet payload[value]=quantity + tenant_ref (Audit), kein erfundener
// stripe_customer_id. event_name muss zu den im Stripe-Dashboard angelegten Metern
// passen (Owner-Smoke).
const STRIPE_METER_EVENT_NAME = Object.freeze({
  voice_minute: "voice_minutes",
  ai_token: "ai_tokens",
  number_month: "number_months",
});

function authHeaders(extra = {}) {
  if (!config.stripeSecretKey) throw new Error("Stripe Billing: STRIPE_SECRET_KEY fehlt");
  return {
    Authorization: `Bearer ${config.stripeSecretKey}`,
    "Content-Type": "application/x-www-form-urlencoded",
    ...extra,
  };
}

function assertOk(res, op) {
  if (!res.ok) throw new Error(`Stripe ${op} fehlgeschlagen: HTTP ${res.status}`);
}

// Praezise Diskriminierung des idempotenten "bereits captured"-Falls (PROV-01/F6): NUR
// Fehlercode payment_intent_unexpected_state UND PI-Status 'succeeded' gelten als Erfolg
// (das Geld ist eingezogen). Jeder andere Fehler (anderer code, anderer PI-Status wie
// 'canceled') bleibt ein echter Fehler. Erwartet den geparsten Stripe-Fehlerkoerper.
function isAlreadyCapturedError(errorBody) {
  const err = errorBody && errorBody.error;
  return Boolean(
    err &&
      err.code === PI_UNEXPECTED_STATE_CODE &&
      err.payment_intent &&
      err.payment_intent.status === PI_STATUS_SUCCEEDED,
  );
}

// Wie assertOk, aber liest den Stripe-Fehlerbody mit (error.message/code) fuer
// bessere Diagnose bei den Geld-kritischen Subscription-Calls (Regel 4: Body
// enthaelt KEINE Secrets, nur Provider-Fehlertext - sk_/Bearer liegen nur im
// Request-Header). Body nicht lesbar -> nur Status melden (wie assertOk).
async function assertOkWithDetail(res, op) {
  if (res.ok) return;
  let detail = "";
  try {
    detail = await res.text();
  } catch {
    /* Body nicht lesbar -> nur Status melden */
  }
  throw new Error(`Stripe ${op} fehlgeschlagen: HTTP ${res.status} ${detail}`.trim());
}

const url = (path) => config.stripeApiBase + path;

// default_payment_method kommt expandiert als Objekt (id) oder unexpandiert als
// String - beide Formen auf die opake pm_-Referenz reduzieren; fehlt beides -> null
// (der Aufrufer wirft fail-closed, G26: kein null ungeprueft weiterreichen).
function paymentMethodIdOf(defaultPaymentMethod) {
  if (typeof defaultPaymentMethod === "string") return defaultPaymentMethod;
  return (defaultPaymentMethod && defaultPaymentMethod.id) || null;
}

// Die aktuelle Stripe-API liefert current_period_end/-start NICHT mehr top-level
// an der Subscription, sondern pro Item (items.data[0]). Fallback auf top-level
// fuer aeltere API-Versionen -> kein leeres Perioden-/Quota-Fenster. Gemeinsam
// fuer createSubscription UND getSubscriptionCheckoutResult (G5: eine Quelle,
// beide lesen dieselbe Subscription-Form).
function periodFieldsOf(subLike) {
  const item = subLike.items && subLike.items.data && subLike.items.data[0];
  return {
    currentPeriodStart: (item && item.current_period_start) ?? subLike.current_period_start,
    currentPeriodEnd: (item && item.current_period_end) ?? subLike.current_period_end,
  };
}

/** @type {import("./ports.js").BillingPort} */
export const stripeBilling = {
  async placeHold({
    tenantRef,
    amountCents,
    currency,
    customerId,
    paymentMethodId,
    idempotencyKey,
  }) {
    // Idempotency-Key (number-id-basiert): Retry haelt nie doppelt (Stripe-Header).
    const headers = authHeaders(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {});
    // off_session=true + gespeicherter customer/payment_method: Stripe belastet die am
    // Customer hinterlegte Karte ohne Redirect (kein return_url/automatic_payment_methods
    // noetig) - behebt den 400-Wurzel-Fehler des frueheren confirm-ohne-PM-Pfades.
    const body = new URLSearchParams({
      amount: String(amountCents),
      currency,
      capture_method: "manual",
      confirm: "true",
      customer: customerId,
      payment_method: paymentMethodId,
      off_session: OFF_SESSION,
    });
    body.set("metadata[tenant_ref]", tenantRef); // Audit, kein Geheimnis
    const res = await fetch(url(PAYMENT_INTENTS_PATH), { method: "POST", headers, body });
    assertOk(res, "placeHold");
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
    // Idempotenz (PROV-01/F6): ein zweiter Capture desselben PI (Boot-Sweep-Re-Drive nach
    // Crash zwischen Capture und store.save()) darf KEINE bezahlte Nummer freigeben. Stripe
    // lehnt ihn mit 'already captured' ab -> als Erfolg behandeln. Jeder andere Fehler wirft.
    const errorBody = await res.json().catch(() => ({}));
    if (isAlreadyCapturedError(errorBody)) return;
    assertOk(res, "captureHold"); // res.ok ist false -> wirft mit einheitlichem Stripe-Fehlertext
  },

  async cancelHold(paymentIntentId) {
    const res = await fetch(`${url(PAYMENT_INTENTS_PATH)}/${paymentIntentId}/cancel`, {
      method: "POST",
      headers: authHeaders(),
    });
    assertOk(res, "cancelHold");
  },

  // Meldet EIN aggregiertes Meter-Event (P6b3). Loest KEIN Geld aus (Stripe rechnet
  // ueber payload[value] x Meter-Preis). costCents reist im Aggregat fuers interne
  // Audit, geht NICHT an Stripe (value=quantity ist die abrechnungsrelevante Groesse;
  // costCents nie geloggt/geleakt). Idempotenz-Key als Stripe-Header (Retry-sicher).
  async reportMeter({ tenantRef, kind, quantity, idempotencyKey }) {
    const eventName = STRIPE_METER_EVENT_NAME[kind];
    if (!eventName) throw new Error(`Stripe reportMeter: unbekanntes kind '${kind}'`);
    const headers = authHeaders(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {});
    const body = new URLSearchParams({ event_name: eventName });
    body.set("payload[value]", String(quantity));
    body.set("payload[tenant_ref]", tenantRef); // Audit, kein Geheimnis
    const res = await fetch(url(METER_EVENTS_PATH), { method: "POST", headers, body });
    assertOk(res, "reportMeter");
  },

  // Legt einen Stripe-Customer fuer den Tenant an (POST /v1/customers). metadata
  // [tenant_ref] zur Zuordnung (Audit, kein Geheimnis). Loest KEIN Geld aus.
  async createCustomer({ tenantRef }) {
    const body = new URLSearchParams();
    body.set("metadata[tenant_ref]", tenantRef);
    const res = await fetch(url(CUSTOMERS_PATH), { method: "POST", headers: authHeaders(), body });
    assertOk(res, "createCustomer");
    const json = await res.json().catch(() => ({}));
    return { customerId: json.id };
  },

  // Checkout-Session im setup-Mode (Stripe-gehostete Seite): Karte am Customer
  // speichern OHNE Abbuchung. Nur opake url/sessionId verlassen den Adapter.
  async createSetupCheckoutSession({ tenantRef, customerId, successUrl, cancelUrl }) {
    const body = new URLSearchParams({
      mode: CHECKOUT_SETUP_MODE,
      customer: customerId,
      // Stripe verlangt im setup-Mode ein currency (sonst HTTP 400 parameter_missing).
      // app-weite config.paymentCurrency (default eur) - dieselbe Waehrung wie der
      // spaetere Abo-Price, damit Karte und Recurring nicht divergieren.
      currency: config.paymentCurrency,
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
    body.set("metadata[tenant_ref]", tenantRef); // Audit, kein Geheimnis
    const res = await fetch(url(CHECKOUT_SESSIONS_PATH), {
      method: "POST",
      headers: authHeaders(),
      body,
    });
    assertOk(res, "createSetupCheckoutSession");
    const json = await res.json().catch(() => ({}));
    return { url: json.url, sessionId: json.id };
  },

  // Liest customer + payment_method aus einer abgeschlossenen Setup-Session
  // (setup_intent expandiert). Fehlt das payment_method -> klarer Fehler (Karte
  // nicht gespeichert), KEIN stilles null (G26: kein null ungeprueft weiterreichen).
  async getCheckoutSessionResult(sessionId) {
    const res = await fetch(`${url(CHECKOUT_SESSIONS_PATH)}/${sessionId}?expand[]=setup_intent`, {
      method: "GET",
      headers: authHeaders(),
    });
    assertOk(res, "getCheckoutSessionResult");
    const json = await res.json().catch(() => ({}));
    const paymentMethodId = json.setup_intent && json.setup_intent.payment_method;
    if (!paymentMethodId)
      throw new Error(
        "Stripe getCheckoutSessionResult: kein payment_method (Karte nicht gespeichert)",
      );
    return { customerId: json.customer, paymentMethodId };
  },

  // Checkout-Session im subscription-Mode (Rabattcode-Feature): Stripe erfasst Karte
  // UND legt das Abo in EINEM gehosteten Schritt an, inkl. nativem Rabattcode-Feld
  // (allow_promotion_codes). KEIN currency-Parameter (der Price bestimmt die Waehrung).
  // subscription_data[metadata]: Session-Metadata reist NICHT in die Subscription ->
  // tenant_ref/plan_slug werden explizit gespiegelt, damit die Webhook-Tenant-Aufloesung
  // (webhook.js tenantRefOf/planSlugOf) und A3-Reconcile (retrieveSubscription) fuer
  // Checkout-erzeugte Abos genauso funktionieren wie fuer createSubscription-Abos.
  // Idempotency-Key (tenant+plan+price-basiert, subscribe.js checkoutSessionIdempotencyKey):
  // ein Doppelklick/zwei Tabs erhaelt DIESELBE Session zurueck statt einer zweiten -
  // schliesst die TOCTOU-Luecke zwischen dem already_subscribed-Vor-Check und dem
  // tatsaechlichen Checkout-Abschluss (Muster wie placeHold/createSubscription).
  // Nur opake url/sessionId verlassen den Adapter.
  async createSubscriptionCheckoutSession({
    tenantRef,
    customerId,
    priceId,
    planSlug,
    successUrl,
    cancelUrl,
    idempotencyKey,
  }) {
    const headers = authHeaders(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {});
    const body = new URLSearchParams({
      mode: CHECKOUT_SUBSCRIPTION_MODE,
      customer: customerId,
      success_url: successUrl,
      cancel_url: cancelUrl,
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      allow_promotion_codes: "true",
    });
    body.set("metadata[tenant_ref]", tenantRef); // Audit, kein Geheimnis
    body.set("subscription_data[metadata][tenant_ref]", tenantRef);
    body.set("subscription_data[metadata][plan_slug]", planSlug);
    const res = await fetch(url(CHECKOUT_SESSIONS_PATH), { method: "POST", headers, body });
    await assertOkWithDetail(res, "createSubscriptionCheckoutSession");
    const json = await res.json().catch(() => ({}));
    return { url: json.url, sessionId: json.id };
  },

  // Liest das Ergebnis einer abgeschlossenen subscription-Mode-Session (KEIN zweiter
  // Geld-Call: das Abo existiert schon). expand: subscription + deren payment_method.
  // Fehlt die Subscription (Session nicht abgeschlossen) oder das payment_method ->
  // klarer Fehler (fail-closed, Muster getCheckoutSessionResult). Periodenfelder wie
  // createSubscription: pro Item (aktuelle API) mit top-level-Fallback. planSlug aus
  // der Subscription-Metadata (createSubscriptionCheckoutSession spiegelt sie hinein);
  // fehlt sie -> null (Aufrufer entscheidet fail-closed, NIE raten).
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
      subscriptionId: sub.id,
      ...periodFieldsOf(sub),
      planSlug: (sub.metadata && sub.metadata.plan_slug) || null,
    };
  },

  // Erstellt ein echtes monatliches Recurring (POST /v1/subscriptions). off_session +
  // error_if_incomplete: Stripe belastet die hinterlegte Karte sofort; gelingt die
  // Erstzahlung nicht (3DS/Ablehnung), wirft Stripe statt ein incomplete-Abo anzulegen
  // (fail-closed, kein "Abo ohne Zahlung"). Idempotency-Key (tenant+plan): Retry legt
  // nie zwei Abos an. tenant_ref + plan_slug als metadata reisen in die Subscription-
  // Webhook-Events zurueck (Tenant-/Plan-Aufloesung; Audit, KEINE Secrets). Nur
  // subscriptionId + current_period_end + current_period_start (Unix-s) verlassen den
  // Adapter (KEIN Stripe-Objekt).
  async createSubscription({ tenantRef, customerId, priceId, paymentMethodId, idempotencyKey }) {
    const headers = authHeaders(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {});
    const body = new URLSearchParams({
      customer: customerId,
      "items[0][price]": priceId,
      // default_payment_method: die am Customer gespeicherte Karte wird die Zahlungsquelle
      // der Abo-Rechnungen. OHNE das kann Stripe die erste Rechnung off_session NICHT
      // belasten (am Customer attached != invoice-default) -> mit error_if_incomplete
      // -> HTTP 400 ("Abo passiert nichts"). Spiegelt placeHold (payment_method).
      default_payment_method: paymentMethodId,
      off_session: OFF_SESSION,
      payment_behavior: SUBSCRIPTION_FAILCLOSED_BEHAVIOR,
    });
    body.set("metadata[tenant_ref]", tenantRef);
    const res = await fetch(url(SUBSCRIPTIONS_PATH), { method: "POST", headers, body });
    await assertOkWithDetail(res, "createSubscription");
    const json = await res.json().catch(() => ({}));
    return { subscriptionId: json.id, ...periodFieldsOf(json) };
  },

  // A3-Reconcile: liest den Plan-Slug eines bestehenden Abos aus der Subscription-
  // Metadata (GET /v1/subscriptions/{id}). Heilt slug-lose Bestands-Abos (webhook.js
  // selektiver Patch). Fehlt der Slug -> null (Aufrufer SKIPt no_plan, NIE raten). Nur
  // opaker Slug verlaesst den Adapter; Secret nur im Header (nie geloggt). LIVE owner-
  // smoke (offline ungetestet wie der uebrige Adapter).
  async retrieveSubscription(subscriptionId) {
    const res = await fetch(`${url(SUBSCRIPTIONS_PATH)}/${subscriptionId}`, {
      method: "GET",
      headers: authHeaders(),
    });
    assertOk(res, "retrieveSubscription");
    const json = await res.json().catch(() => ({}));
    return { planSlug: (json.metadata && json.metadata.plan_slug) || null };
  },
};
