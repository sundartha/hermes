import type { Accounts, MailPlan } from "./mail-summary.ts";
import { meldetAlsNichtGestartet } from "./telephony/failure-reason.ts";
import { MS_PER_MINUTE } from "./utils/timer.ts";

const MINUTES_PER_HOUR = 60;
const NOT_PLACED_MAIL_DEBOUNCE_MS = MINUTES_PER_HOUR * MS_PER_MINUTE;

interface NotPlacedCall {
  id: string;
  tenantId: string;
  direction?: string;
  failureReason?: string;
  endedAt?: string;
  notPlacedMailSentAt?: unknown;
}

function notPlacedMailDebounced(
  calls: NotPlacedCall[],
  call: NotPlacedCall,
  windowMs = NOT_PLACED_MAIL_DEBOUNCE_MS,
): boolean {
  const endedMs = Date.parse(call.endedAt ?? "");
  if (Number.isNaN(endedMs)) return false;
  return calls.some((other) => {
    if (other.id === call.id || other.tenantId !== call.tenantId) return false;
    if (other.direction !== "outbound") return false;
    if (!meldetAlsNichtGestartet(other.failureReason)) return false;
    const otherMs = Date.parse(other.endedAt ?? "");
    return !Number.isNaN(otherMs) && otherMs < endedMs && endedMs - otherMs <= windowMs;
  });
}

export async function planNotPlacedMail({
  store,
  call,
  mailer,
  accounts,
}: {
  store: { anrufeDesMandanten(tenantId: string, seit?: string): Promise<NotPlacedCall[]> };
  call: NotPlacedCall;
  mailer: unknown;
  accounts?: Accounts | null | undefined;
}): Promise<MailPlan> {
  if (call.direction !== "outbound") return { send: false, targets: [], reason: null };
  if (call.notPlacedMailSentAt) return { send: false, targets: [], reason: null };
  if (!meldetAlsNichtGestartet(call.failureReason))
    return { send: false, targets: [], reason: null };
  if (!mailer) return { send: false, targets: [], reason: "no_mailer" };
  const endedMs = Date.parse(call.endedAt ?? "");
  const seit = Number.isNaN(endedMs)
    ? undefined
    : new Date(endedMs - NOT_PLACED_MAIL_DEBOUNCE_MS).toISOString();
  const fruehere = await store.anrufeDesMandanten(call.tenantId, seit).catch((err: unknown) => {
    console.error(`[mail] not-placed Entprellung nicht lesbar (call=${call.id}):`, String(err));
    return null;
  });
  if (!fruehere) return { send: false, targets: [], reason: "lesefehler" };
  if (notPlacedMailDebounced(fruehere, call)) return { send: false, targets: [], reason: null };
  const account = accounts ? await accounts.accountByTenant(call.tenantId) : null;
  if (!account?.email) return { send: false, targets: [], reason: "no_account_email" };
  return { send: true, targets: [{ email: account.email, unsubToken: null }], reason: null };
}
