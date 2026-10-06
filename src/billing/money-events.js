export const MONEY_EVENT = Object.freeze({
  DISPUTE_CREATED: "charge.dispute.created",
  REFUNDED: "charge.refunded",
  SUBSCRIPTION_PAUSED: "customer.subscription.paused",
  PAYMENT_ACTION_REQUIRED: "invoice.payment_action_required",
});

export const MONEY_ACTION = Object.freeze({
  WARN: "warn",
  REVOKE_PERIOD_CREDIT: "revoke_period_credit",
  HOLD_OUTBOUND: "hold_outbound",
  GRACE_THEN_HOLD: "grace_then_hold",
});

export const PAYMENT_ACTION_GRACE_HOURS = 72;
const MS_PER_HOUR = 60 * 60 * 1000;

const MONEY_EVENT_CONFIG = Object.freeze({
  [MONEY_EVENT.DISPUTE_CREATED]: Object.freeze({ action: MONEY_ACTION.WARN, alarm: true }),
  [MONEY_EVENT.REFUNDED]: Object.freeze({ action: MONEY_ACTION.REVOKE_PERIOD_CREDIT, alarm: false }),
  [MONEY_EVENT.SUBSCRIPTION_PAUSED]: Object.freeze({ action: MONEY_ACTION.HOLD_OUTBOUND, alarm: false }),
  [MONEY_EVENT.PAYMENT_ACTION_REQUIRED]: Object.freeze({ action: MONEY_ACTION.GRACE_THEN_HOLD, alarm: false }),
});

export function moneyActionFor(type) {
  return MONEY_EVENT_CONFIG[type] ?? null;
}

export function graceDueAtIso(nowIso) {
  return new Date(Date.parse(nowIso) + PAYMENT_ACTION_GRACE_HOURS * MS_PER_HOUR).toISOString();
}
