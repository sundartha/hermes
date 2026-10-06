import { verifyStripeSignature, applyStripeWebhookSerialized } from "../billing/webhook.js";
import { requirePaymentEnabled } from "../billing/payment-gate.js";
import { sendBootstrapAlertSms } from "../telephony/alert-sms.js";

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
      nowS: Math.floor(Date.now() / 1000),
    });
    if (!ok) {
      audit("stripe_webhook_rejected", req, "signature");
      return res.status(400).json({ error: "invalid signature" });
    }
    let event;
    try {
      event = JSON.parse(req.rawBody.toString("utf8"));
    } catch {
      return res.status(400).json({ error: "bad payload" });
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
