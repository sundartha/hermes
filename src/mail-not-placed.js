import { NOT_PLACED, failureReasonBase } from "./telephony/failure-reason.js";
import { MS_PER_MINUTE } from "./utils/timer.js";

const MINUTES_PER_HOUR = 60;
const NOT_PLACED_MAIL_DEBOUNCE_MS = MINUTES_PER_HOUR * MS_PER_MINUTE;

export function notPlacedMailDebounced(calls, call, windowMs = NOT_PLACED_MAIL_DEBOUNCE_MS) {
  const endedMs = Date.parse(call.endedAt || "");
  if (Number.isNaN(endedMs)) return false;
  return calls.some((other) => {
    if (other.id === call.id || other.tenantId !== call.tenantId) return false;
    if (failureReasonBase(other.failureReason) !== NOT_PLACED) return false;
    const otherMs = Date.parse(other.endedAt || "");
    return !Number.isNaN(otherMs) && otherMs < endedMs && endedMs - otherMs <= windowMs;
  });
}

export async function planNotPlacedMail({ store, call, mailer, accounts }) {
  if (call.direction !== "outbound") return { send: false, targets: [], reason: null };
  if (failureReasonBase(call.failureReason) !== NOT_PLACED)
    return { send: false, targets: [], reason: null };
  if (!mailer) return { send: false, targets: [], reason: "no_mailer" };
  if (notPlacedMailDebounced(store.load().calls, call))
    return { send: false, targets: [], reason: null };
  const account = accounts ? await accounts.accountByTenant(call.tenantId) : null;
  if (!account?.email) return { send: false, targets: [], reason: "no_account_email" };
  return { send: true, targets: [{ email: account.email, unsubToken: null }], reason: null };
}
