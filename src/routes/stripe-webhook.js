import { verifyStripeSignature, applyStripeWebhookSerialized } from "../billing/webhook.js";
import { requirePaymentEnabled } from "../billing/payment-gate.js";
import { sendBootstrapAlertSms } from "../telephony/alert-sms.js";
import { HTTP_BAD_REQUEST, antworteFehler } from "../utils/http.js";
import { MS_PER_SECOND } from "../utils/timer.js";

export function makeStripeWebhookRoute({
  config,
  store,
  audit,
  accounts,
  sessions,
  billing,
  provision,
  messaging,
  numberProvisioner,
  workos,
  auditStore,
  sipRegistrar,
}) {
  return async (req, res) => {
    if (!requirePaymentEnabled(res, config, "payment disabled")) return;
    const ok = verifyStripeSignature({
      rawBody: req.rawBody,
      signatureHeader: req.headers["stripe-signature"],
      secret: config.billing.stripeWebhookSecret,
      nowS: Math.floor(Date.now() / MS_PER_SECOND),
    });
    if (!ok) {
      audit("stripe_webhook_rejected", req, "signature");
      return antworteFehler(res, HTTP_BAD_REQUEST, "invalid signature");
    }
    let event;
    try {
      event = JSON.parse(req.rawBody.toString("utf8"));
    } catch {
      return antworteFehler(res, HTTP_BAD_REQUEST, "bad payload");
    }
    const outcome = await applyStripeWebhookSerialized(event, {
      store, accounts, sessions, audit, req, provision, billing,
      numberProvisioner, workos, auditStore, sipRegistrar,
    });
    if (outcome?.alarm)
      sendBootstrapAlertSms({
        messaging, config, store, prefix: outcome.alarm.prefix, detail: outcome.alarm.detail,
        logTag: "stripe-money-event",
      });
    res.json({ received: true });
  };
}
