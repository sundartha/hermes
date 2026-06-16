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
import { config } from "../config.js";

const PAYMENT_INTENTS_PATH = "/v1/payment_intents";

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
};
