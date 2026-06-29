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
const OFF_SESSION = "true"; // Karte ohne Kunden-Interaktion belasten (kein 3DS-Redirect noetig)
// W4: Stripe legt bei fehlgeschlagener Erstzahlung KEIN incomplete-Abo an, sondern wirft
// (fail-closed, kein "Abo ohne Zahlung"). Kein Magic-String (G25).
const SUBSCRIPTION_FAILCLOSED_BEHAVIOR = "error_if_incomplete";

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

const url = (path) => config.stripeApiBase + path;

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
    assertOk(res, "captureHold");
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

  // Erstellt ein echtes monatliches Recurring (POST /v1/subscriptions). off_session +
  // error_if_incomplete: Stripe belastet die hinterlegte Karte sofort; gelingt die
  // Erstzahlung nicht (3DS/Ablehnung), wirft Stripe statt ein incomplete-Abo anzulegen
  // (fail-closed, kein "Abo ohne Zahlung"). Idempotency-Key (tenant+plan): Retry legt
  // nie zwei Abos an. tenant_ref + plan_slug als metadata reisen in die Subscription-
  // Webhook-Events zurueck (Tenant-/Plan-Aufloesung; Audit, KEINE Secrets). Nur
  // subscriptionId + current_period_end (Unix-s) verlassen den Adapter (KEIN Stripe-Objekt).
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
    // Diagnose: bei Fehler den Stripe-Fehlerbody (error.message/code) mitgeben. Der Body
    // enthaelt KEINE Secrets (sk_/Bearer liegen nur in den Request-Headern). Best-effort:
    // ist der Body nicht lesbar, bleibt es beim Status (wie assertOk).
    if (!res.ok) {
      let detail = "";
      try {
        detail = await res.text();
      } catch {
        /* Body nicht lesbar -> nur Status melden */
      }
      throw new Error(
        `Stripe createSubscription fehlgeschlagen: HTTP ${res.status} ${detail}`.trim(),
      );
    }
    const json = await res.json().catch(() => ({}));
    // Die aktuelle Stripe-API liefert current_period_end NICHT mehr top-level an der
    // Subscription, sondern pro Item (items.data[0].current_period_end). Fallback auf
    // top-level fuer aeltere API-Versionen -> kein leeres Perioden-/Quota-Fenster.
    const item = json.items && json.items.data && json.items.data[0];
    const currentPeriodEnd = (item && item.current_period_end) ?? json.current_period_end;
    return { subscriptionId: json.id, currentPeriodEnd };
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
