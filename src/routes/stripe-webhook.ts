import type { Response } from "express";
import { verifyStripeSignature, applyStripeWebhookSerialized } from "../billing/webhook.ts";
import { requirePaymentEnabled } from "../billing/payment-gate.ts";
import { sendBootstrapAlertSms } from "../telephony/alert-sms.js";
import { HTTP_BAD_REQUEST, HTTP_SERVICE_UNAVAILABLE, antworteFehler } from "../utils/http.ts";
import { MS_PER_SECOND } from "../utils/timer.js";

type Ereignis = Parameters<typeof applyStripeWebhookSerialized>[0];
type WebhookAbhaengigkeiten = Parameters<typeof applyStripeWebhookSerialized>[1];

interface Konfiguration {
  billing: { paymentEnabled: boolean; stripeWebhookSecret: string | null | undefined };
}

interface Abhaengigkeiten extends Omit<WebhookAbhaengigkeiten, "req"> {
  config: Konfiguration;
  messaging: unknown;
}

interface Anfrage {
  rawBody: Buffer;
  headers: { "stripe-signature"?: string | undefined };
}

const parseEreignis: (text: string) => Ereignis = JSON.parse;
const sendeAlarm: (args: {
  messaging: unknown;
  config: unknown;
  store: unknown;
  prefix: string;
  detail: string;
  logTag: string;
}) => void = sendBootstrapAlertSms;

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
}: Abhaengigkeiten): (req: Anfrage, res: Response) => Promise<void> {
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
      antworteFehler(res, HTTP_BAD_REQUEST, "invalid signature");
      return;
    }
    let event: Ereignis;
    try {
      event = parseEreignis(req.rawBody.toString("utf8"));
    } catch {
      antworteFehler(res, HTTP_BAD_REQUEST, "bad payload");
      return;
    }
    let outcome: Awaited<ReturnType<typeof applyStripeWebhookSerialized>>;
    try {
      outcome = await applyStripeWebhookSerialized(event, {
        store, accounts, sessions, audit, req, provision, billing,
        numberProvisioner, workos, auditStore, sipRegistrar,
      });
    } catch (err) {
      console.error(`[stripe-webhook] Ereignis nicht angewendet event=${String(event.id)}: ${err instanceof Error ? err.message : String(err)}`);
      antworteFehler(res, HTTP_SERVICE_UNAVAILABLE, "event not applied");
      return;
    }
    if (outcome?.alarm)
      sendeAlarm({
        messaging, config, store, prefix: outcome.alarm.prefix, detail: outcome.alarm.detail,
        logTag: "stripe-money-event",
      });
    res.json({ received: true });
  };
}
