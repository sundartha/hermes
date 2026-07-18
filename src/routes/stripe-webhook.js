// ---- makeStripeWebhookRoute (Server-Slim P13) -----------------------------------
// Extrahierter Stripe-Webhook-Handler (Abo-Lifecycle nachziehen) als Factory mit
// Dependency-Injection - gleiches Muster wie die anderen makeXRoutes-Fabriken
// (z.B. makeSelfServiceRoutes). REINE Verschiebung aus server.js (byte-identische
// Pfade/Status/Bodies/Audit-Aufrufe). Kein Router: die EINE Route wird in
// wireWebLogin per app.post(stripeWebhookPath, ...) an den Store gehaengt.
//
// KEINE Basic-Auth (Stripe kann keine Credentials senden) - die Sicherung ist die
// HMAC-Signaturpruefung gegen STRIPE_WEBHOOK_SECRET, fail-closed: Signatur VOR dem
// JSON-Parse (rawBody). Ohne PAYMENT_ENABLED -> 404 (byte-identisch). accounts/
// sessions sind die in wireWebLogin ueber den portalRunner konstruierten Instanzen;
// billing = die EINE stripeBilling-Instanz; provision = provisioning.triggerTenant-
// Provisioning (die EINE P6-Orchestrator-Instanz aus server.js, INV-7). verify-
// StripeSignature/applyStripeWebhookSerialized sind reine Funktionen ohne eigenen
// State -> direkt importiert (G5, kein Wrapper-Zwischenschritt fuer reine
// Bibliotheksaufrufe; Serialisierung pro Stripe-Korrelationsschluessel liegt in
// billing/webhook.js).
import { verifyStripeSignature, applyStripeWebhookSerialized } from "../billing/webhook.js";
import { requirePaymentEnabled } from "../billing/payment-gate.js";

// deps: { config, store, audit, accounts, sessions, billing, provision }.
export function makeStripeWebhookRoute({ config, store, audit, accounts, sessions, billing, provision }) {
  return async (req, res) => {
    if (!requirePaymentEnabled(res, config, "payment disabled")) return;
    const ok = verifyStripeSignature({
      rawBody: req.rawBody,
      signatureHeader: req.headers["stripe-signature"],
      secret: config.billing.stripeWebhookSecret,
      nowS: Math.floor(Date.now() / 1000),
    });
    if (!ok) {
      audit("stripe_webhook_rejected", req, "signature");
      return res.status(400).json({ error: "invalid signature" });
    }
    // rawBody ist verifiziert -> jetzt erst parsen (kein Vertrauen vor der Signatur).
    let event;
    try {
      event = JSON.parse(req.rawBody.toString("utf8"));
    } catch {
      return res.status(400).json({ error: "bad payload" });
    }
    await applyStripeWebhookSerialized(event, { store, accounts, sessions, audit, req, provision, billing });
    res.json({ received: true });
  };
}
