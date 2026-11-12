import { findActiveNumber } from "./store/views.js";
import { MS_PER_DAY } from "./utils/timer.js";

interface Speicher {
  tenantPrivateNumber: (tenantId: string) => string | null;
  load: () => unknown;
  tenantContext: (tenantId: string) => { settings: { smsSummaryOptIn?: boolean } };
  dailySmsCount: (tenantId: string, since: string) => number;
}

interface Konfig {
  voice: { sendSmsSummary: boolean; dailySmsCap: number };
}

interface Anruf {
  tenantId: string;
  provider?: string;
  summarySmsSentAt?: string | null;
}

interface Plan {
  to: string | null;
  smsFrom: unknown;
  send: boolean;
  reason: string | null;
}

export function planSummarySms(store: Speicher, config: Konfig, call: Anruf): Plan {
  const to = store.tenantPrivateNumber(call.tenantId);
  const smsFrom: unknown = findActiveNumber(store.load(), call.tenantId, call.provider);
  const optIn = store.tenantContext(call.tenantId).settings.smsSummaryOptIn;
  if (call.summarySmsSentAt) return { to, smsFrom, send: false, reason: null };
  if (!config.voice.sendSmsSummary) return { to, smsFrom, send: false, reason: null };
  if (!to) return { to, smsFrom, send: false, reason: "no_private_number" };
  if (!smsFrom || !optIn) return { to, smsFrom, send: false, reason: null };
  if (!Number.isFinite(config.voice.dailySmsCap))
    throw new Error(
      "planSummarySms: config.voice.dailySmsCap fehlt oder ist nicht numerisch - SMS-Tageskappe (Toll-Fraud-Schutz) ist fail-closed",
    );
  const since = new Date(Date.now() - MS_PER_DAY).toISOString();
  if (store.dailySmsCount(call.tenantId, since) >= config.voice.dailySmsCap)
    return { to, smsFrom, send: false, reason: "daily_cap" };
  return { to, smsFrom, send: true, reason: null };
}
