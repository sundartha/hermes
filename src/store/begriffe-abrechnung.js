export const USAGE_EVENT_KIND = Object.freeze({
  VOICE_MINUTE: "voice_minute",
  AI_TOKEN: "ai_token",
  SMS: "sms",
  NUMBER_MONTH: "number_month",
});

export const COST_TRUING_SOURCE = Object.freeze({
  DETAIL_RECORDS: "telnyx_detail_records",
  KOSTENBUCH_VOLLBELEG: "kostenbuch_vollbeleg",
  KOSTENBUCH_TEILBELEG: "kostenbuch_teilbeleg",
  INCOMPLETE: "incomplete",
  NO_ESTIMATE: "no_estimate",
  UNAVAILABLE: "unavailable",
});

const BEWEISENDE_HERKUNFT = Object.freeze([
  COST_TRUING_SOURCE.DETAIL_RECORDS,
  COST_TRUING_SOURCE.KOSTENBUCH_VOLLBELEG,
]);

export function istBeweisendeHerkunft(source) {
  return BEWEISENDE_HERKUNFT.includes(source);
}

export const REIFE = Object.freeze({
  ERWARTET: "erwartet",
  VORLAEUFIG: "vorlaeufig",
  BELEGT: "belegt",
  STRUKTURELL_UNBESCHAFFBAR: "beleg_strukturell_unbeschaffbar",
});

export const REIFE_FORTSCHRITT = Object.freeze([REIFE.ERWARTET, REIFE.VORLAEUFIG, REIFE.BELEGT]);

export const REIFE_TERMINAL = Object.freeze([REIFE.STRUKTURELL_UNBESCHAFFBAR]);

export const REIFE_SUMMIERBAR = Object.freeze([REIFE.VORLAEUFIG, REIFE.BELEGT]);

export const CENTS_PER_EUR = 100;

export const EUR_DECIMALS = 2;

export function eurText(cents) {
  return (cents / CENTS_PER_EUR).toFixed(EUR_DECIMALS);
}

const ISO_DATE_LENGTH = 10;

export function spendMonthEndDate(nowMs) {
  const at = new Date(nowMs);
  const lastDayOfMonth = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0));
  return lastDayOfMonth.toISOString().slice(0, ISO_DATE_LENGTH);
}

export const MICRO_CENTS_PER_CENT = 1_000_000;

export const USAGE_CORRUPT_REASON = "usage_korrupt";

export function isBookableCents(cents) {
  return Number.isFinite(cents) && Number.isInteger(cents) && cents >= 0;
}

export const PROVIDER_RATE_SCALE = 1_000_000;

export function isCorrectionCents(cents) {
  return Number.isFinite(cents) && Number.isInteger(cents);
}

export function isProviderMicroCents(wert) {
  return Number.isSafeInteger(wert) && wert >= 0;
}

export const TOKENS_PER_M_TOK = 1_000_000;

export const MODEL_PRICE_RATE_FIELDS = Object.freeze([
  "inPerMTok",
  "cacheWritePerMTok",
  "cacheReadPerMTok",
  "outPerMTok",
]);

export function globalCapCents(cfg) {
  return cfg.platformSpendCapCents;
}

export const RESERVE_LEAD_MINUTES = 2;

export function outboundReserveCents(tariffCentsPerMin) {
  return tariffCentsPerMin * RESERVE_LEAD_MINUTES;
}
