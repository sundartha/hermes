import { findActiveNumber } from "./store/views.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function planSummarySms(store, config, call) {
  const to = store.tenantPrivateNumber(call.tenantId);
  const smsFrom = findActiveNumber(store.load(), call.tenantId, call.provider);
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
