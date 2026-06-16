// Stripe-Billing-Adapter (P6b1): BillingPort (placeHold/captureHold/cancelHold)
// ueber die Stripe-v1-REST-API. Loest ECHTES Geld aus (Hold + Capture) -> nur ueber
// die gegatete Onboarding-Route (PAYMENT_ENABLED) erreichbar. Kein SDK: fetch +
// Bearer. Stripe /v1 erwartet application/x-www-form-urlencoded (NICHT JSON).
// Secret-Key NIE in Fehlermeldungen leaken (Regel 4).
//
// Verifiziert gegen die Stripe-Doku (manual capture), live UNBESTAETIGT (mit dem
// Owner im Test-Mode live fixen, falls Felder abweichen): confirm=true +
// capture_method=manual setzt den PaymentIntent direkt auf 'requires_capture'.
// Beim Owner-Smoke evtl. payment_method/automatic_payment_methods nachziehen
// (geparkter Owner-Schritt).
//   hold:    POST /v1/payment_intents  {amount, currency, capture_method=manual, confirm=true}
//   capture: POST /v1/payment_intents/{id}/capture  {amount_to_capture}
//   cancel:  POST /v1/payment_intents/{id}/cancel
//   meter:   POST /v1/billing/meter_events  {event_name, payload[value], ...}  (P6b3)
import { config } from "../config.js";

const PAYMENT_INTENTS_PATH = "/v1/payment_intents";
const METER_EVENTS_PATH = "/v1/billing/meter_events";

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
  async placeHold({ tenantRef, amountCents, currency, idempotencyKey }) {
    // Idempotency-Key (number-id-basiert): Retry haelt nie doppelt (Stripe-Header).
    const headers = authHeaders(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {});
    const body = new URLSearchParams({
      amount: String(amountCents),
      currency,
      capture_method: "manual",
      confirm: "true",
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
};
