// GAP-03 (O2, Owner-Entscheidung bindend): vier Stripe-Geld-Ereignisse ausserhalb der
// Subscription-Lifecycle-Allowlist (billing/webhook.js SUBSCRIPTION_EVENT), die heute
// wirkungslos verpuffen (action=ignore). Rein, kein IO - die Wirkung selbst (Store-Writes)
// liegt bei der Aufrufer-Schicht (webhook.js), hier nur die Entscheidungstabelle + reine
// Zeitrechnung.
export const MONEY_EVENT = Object.freeze({
  DISPUTE_CREATED: "charge.dispute.created",
  REFUNDED: "charge.refunded",
  SUBSCRIPTION_PAUSED: "customer.subscription.paused",
  PAYMENT_ACTION_REQUIRED: "invoice.payment_action_required",
});

// Wirkung je Ereignis (O2, bindend). KEINE Wirkung loescht Daten oder gibt eine DID frei;
// jede ist ueber ein bestaetigtes Abo-Event (ACTIVATE) reversibel (webhook.js).
export const MONEY_ACTION = Object.freeze({
  WARN: "warn", // nur Audit + Plattform-Alarm, KEIN Store-Write
  REVOKE_PERIOD_CREDIT: "revoke_period_credit", // Periodenguthaben auf 0
  HOLD_OUTBOUND: "hold_outbound", // Outbound zu, Inbound bleibt offen
  GRACE_THEN_HOLD: "grace_then_hold", // Warnung mit Frist, Sperre erst danach
});

// "Kein Scheduler" (O2): die Frist wird AM AUSGABEPUNKT durchgesetzt (outbound-gates.js
// liest dueAtIso gegen die Uhr), kein zweiter Sweep mit eigener Fehlerquelle. 72h ist ein
// Vorschlag (O2 nennt "Frist" ohne Zahl) - Code-Konstante, KEINE Env (keine neue
// Config-Variable fuer diese Phase).
export const PAYMENT_ACTION_GRACE_HOURS = 72;
const MS_PER_HOUR = 60 * 60 * 1000;

// type -> {action, alarm}. DISPUTE_CREATED alarmiert zusaetzlich die Plattform (O2: "Warnung
// + Plattform-Alarm + Audit" - die einzige der vier Wirkungen mit einer SMS-Eskalation).
const MONEY_EVENT_CONFIG = Object.freeze({
  [MONEY_EVENT.DISPUTE_CREATED]: Object.freeze({ action: MONEY_ACTION.WARN, alarm: true }),
  [MONEY_EVENT.REFUNDED]: Object.freeze({ action: MONEY_ACTION.REVOKE_PERIOD_CREDIT, alarm: false }),
  [MONEY_EVENT.SUBSCRIPTION_PAUSED]: Object.freeze({ action: MONEY_ACTION.HOLD_OUTBOUND, alarm: false }),
  [MONEY_EVENT.PAYMENT_ACTION_REQUIRED]: Object.freeze({ action: MONEY_ACTION.GRACE_THEN_HOLD, alarm: false }),
});

// Unbekannter Typ -> null (der Aufrufer faellt auf das bestehende IGNORE zurueck,
// unveraendert - webhook.js interpretStripeEvent default-Zweig).
export function moneyActionFor(type) {
  return MONEY_EVENT_CONFIG[type] ?? null;
}

// Reine Zeitrechnung (Uhr injiziert, P12/R): nowIso + PAYMENT_ACTION_GRACE_HOURS.
export function graceDueAtIso(nowIso) {
  return new Date(Date.parse(nowIso) + PAYMENT_ACTION_GRACE_HOURS * MS_PER_HOUR).toISOString();
}
