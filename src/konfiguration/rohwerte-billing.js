import { leseBetterStackAlertUrl } from "./betterstack-alarm.js";
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from "../utils/timer.js";

const MAX_TIMER_DELAY_MS = 2_147_483_647;
const VOICE_TARIFF_DOMESTIC_PREFIXES = ["+49", "+33", "+44"];
const OUTAGE_ALERT_DEBOUNCE_HOURS_DEFAULT = 6;
const OUTAGE_ALERT_RETRY_MINUTES_DEFAULT = 15;
const INBOUND_OUTAGE_ALERT_WINDOW_HOURS_DEFAULT = 6;
const OUTAGE_ALERT_SELF_TEST_DAYS_DEFAULT = 30;
const PLATFORM_HOLD_ESCALATION_HOURS_DEFAULT = 24;
const PAID_WITHOUT_NUMBER_GRACE_HOURS_DEFAULT = 1;


function zahlungsRohwerte(env, { boolEnv, isoInstantEnv, numEnv, stripTrailingSlash }) {
  return {
    paymentEnabled: boolEnv("PAYMENT_ENABLED", env.PAYMENT_ENABLED, { fallback: false }),
    stripeSecretKey: env.STRIPE_SECRET_KEY || "",
    stripeApiBase: stripTrailingSlash(env.STRIPE_API_BASE || "https://api.stripe.com"),
    numberSetupFeeCents: numEnv("NUMBER_SETUP_FEE_CENTS", env.NUMBER_SETUP_FEE_CENTS, {
      fallback: 0,
      min: 0,
    }),
    flushEpochIso: isoInstantEnv("BILLING_FLUSH_EPOCH", env.BILLING_FLUSH_EPOCH),
    paymentCurrency: (env.PAYMENT_CURRENCY || "eur").toLowerCase(),
    providerCurrency: (env.PROVIDER_CURRENCY || "USD").toUpperCase(),
    providerToBucketRateMicro: numEnv("PROVIDER_TO_BUCKET_RATE_MICRO", env.PROVIDER_TO_BUCKET_RATE_MICRO, {
      fallback: 920000,
      min: 1,
    }),
  };
}

function abgleichRohwerte(env, { csvEnv, numEnv }) {
  return {
    costTruingDelayMinutes: numEnv("COST_TRUING_DELAY_MINUTES", env.COST_TRUING_DELAY_MINUTES, { fallback: 30, min: 0 }),
    costTruingSweepIntervalMs: numEnv("COST_TRUING_SWEEP_INTERVAL_MS", env.COST_TRUING_SWEEP_INTERVAL_MS, {
      fallback: MS_PER_HOUR,
      min: MS_PER_MINUTE,
      max: MAX_TIMER_DELAY_MS,
    }),
    costTruingMaxAttempts: numEnv("COST_TRUING_MAX_ATTEMPTS", env.COST_TRUING_MAX_ATTEMPTS, { fallback: 5, min: 1 }),
    costSettleDeadlineHours: numEnv("COST_SETTLE_DEADLINE_HOURS", env.COST_SETTLE_DEADLINE_HOURS, { fallback: 48, min: 1 }),
    elEvidenceMinAgeMinutes: numEnv("EL_EVIDENCE_MIN_AGE_MINUTES", env.EL_EVIDENCE_MIN_AGE_MINUTES, { fallback: 15, min: 0 }),
    costTruingRequiredRecordTypes: csvEnv(env.COST_TRUING_REQUIRED_RECORD_TYPES),
    costTruingMinCoveragePercent: numEnv("COST_TRUING_MIN_COVERAGE_PERCENT", env.COST_TRUING_MIN_COVERAGE_PERCENT, { fallback: 80, min: 0, max: 100 }),
    costTruingCoverageStallSweeps: numEnv("COST_TRUING_COVERAGE_STALL_SWEEPS", env.COST_TRUING_COVERAGE_STALL_SWEEPS, { fallback: 8, min: 1 }),
    kostenHeartbeatFensterH: numEnv("KOSTEN_HEARTBEAT_FENSTER_H", env.KOSTEN_HEARTBEAT_FENSTER_H, { fallback: 6, min: 0 }),
    costDriftWarnPercent: numEnv("COST_DRIFT_WARN_PERCENT", env.COST_DRIFT_WARN_PERCENT, { fallback: 50, min: 0 }),
    costAlertDebounceMs: numEnv("COST_ALERT_DEBOUNCE_MS", env.COST_ALERT_DEBOUNCE_MS, { fallback: MS_PER_DAY, min: 0 }),
    costCalibrationMinSamples: numEnv("COST_CALIBRATION_MIN_SAMPLES", env.COST_CALIBRATION_MIN_SAMPLES, {
      fallback: 20,
      min: 1,
    }),
  };
}

function tarifRohwerte(env, { numEnv, routeCentsEnv }, kostenprofile) {
  return {
    voiceTariffDomesticCents: numEnv("VOICE_TARIFF_DOMESTIC_CENTS", env.VOICE_TARIFF_DOMESTIC_CENTS, {
      fallback: 20,
      min: 0,
    }),
    voiceTariffDefaultCents: numEnv("VOICE_TARIFF_DEFAULT_CENTS", env.VOICE_TARIFF_DEFAULT_CENTS, {
      fallback: 30,
      min: 0,
    }),
    voiceTariffInboundCents: numEnv("VOICE_TARIFF_INBOUND_CENTS", env.VOICE_TARIFF_INBOUND_CENTS, {
      fallback: 6,
      min: 0,
    }),
    voiceTariffFullCostFloorCents: numEnv(
      "VOICE_TARIFF_FULL_COST_FLOOR_CENTS",
      env.VOICE_TARIFF_FULL_COST_FLOOR_CENTS,
      { fallback: 15, min: 0 },
    ),
    voiceTariffGrundbetragCentsJeRoute: routeCentsEnv(
      "VOICE_TARIFF_GRUNDBETRAG_CENTS",
      env.VOICE_TARIFF_GRUNDBETRAG_CENTS,
      kostenprofile,
    ),
    voiceTariffDomesticPrefixes: VOICE_TARIFF_DOMESTIC_PREFIXES,
    defaultTenantBudgetCents: numEnv("DEFAULT_TENANT_BUDGET_CENTS", env.DEFAULT_TENANT_BUDGET_CENTS, {
      fallback: 1500,
      min: 0,
    }),
    smsCostCents: numEnv("SMS_COST_CENTS", env.SMS_COST_CENTS, { fallback: 0, min: 0 }),
    platformSpendWarnPercent: numEnv(
      "PLATFORM_SPEND_WARN_PERCENT",
      env.PLATFORM_SPEND_WARN_PERCENT,
      { fallback: 80, min: 0, max: 100 },
    ),
    platformAlertSmsTo: env.PLATFORM_ALERT_SMS_TO || "",
    betterstackAlertUrl: leseBetterStackAlertUrl(env),
  };
}

function alarmRohwerte(env, { numEnv }) {
  return {
    outageAlertWindowMs: numEnv("OUTAGE_ALERT_WINDOW_MS", env.OUTAGE_ALERT_WINDOW_MS, {
      fallback: MS_PER_HOUR,
      min: 0,
    }),
    outageAlertMinFailures: numEnv("OUTAGE_ALERT_MIN_FAILURES", env.OUTAGE_ALERT_MIN_FAILURES, {
      fallback: 3,
      min: 1,
    }),
    outageAlertMinAttempts: numEnv("OUTAGE_ALERT_MIN_ATTEMPTS", env.OUTAGE_ALERT_MIN_ATTEMPTS, {
      fallback: 20,
      min: 1,
    }),
    outageAlertFailSharePercent: numEnv(
      "OUTAGE_ALERT_FAIL_SHARE_PERCENT",
      env.OUTAGE_ALERT_FAIL_SHARE_PERCENT,
      { fallback: 20, min: 0, max: 100 },
    ),
    outageAlertDebounceMs: numEnv("OUTAGE_ALERT_DEBOUNCE_MS", env.OUTAGE_ALERT_DEBOUNCE_MS, {
      fallback: OUTAGE_ALERT_DEBOUNCE_HOURS_DEFAULT * MS_PER_HOUR,
      min: 0,
    }),
    outageAlertRetryMs: numEnv("OUTAGE_ALERT_RETRY_MS", env.OUTAGE_ALERT_RETRY_MS, {
      fallback: OUTAGE_ALERT_RETRY_MINUTES_DEFAULT * MS_PER_MINUTE,
      min: 0,
    }),
    outageAlertSelfTestIntervalMs: numEnv(
      "OUTAGE_ALERT_SELF_TEST_INTERVAL_MS",
      env.OUTAGE_ALERT_SELF_TEST_INTERVAL_MS,
      { fallback: OUTAGE_ALERT_SELF_TEST_DAYS_DEFAULT * MS_PER_DAY, min: 0 },
    ),
    inboundOutageAlertWindowMs: numEnv(
      "INBOUND_OUTAGE_ALERT_WINDOW_MS",
      env.INBOUND_OUTAGE_ALERT_WINDOW_MS,
      { fallback: INBOUND_OUTAGE_ALERT_WINDOW_HOURS_DEFAULT * MS_PER_HOUR, min: 0 },
    ),
    inboundOutageAlertMinFailures: numEnv(
      "INBOUND_OUTAGE_ALERT_MIN_FAILURES",
      env.INBOUND_OUTAGE_ALERT_MIN_FAILURES,
      { fallback: 2, min: 1 },
    ),
    inboundOutageAlertMinAttempts: numEnv(
      "INBOUND_OUTAGE_ALERT_MIN_ATTEMPTS",
      env.INBOUND_OUTAGE_ALERT_MIN_ATTEMPTS,
      { fallback: 20, min: 1 },
    ),
    inboundOutageAlertFailSharePercent: numEnv(
      "INBOUND_OUTAGE_ALERT_FAIL_SHARE_PERCENT",
      env.INBOUND_OUTAGE_ALERT_FAIL_SHARE_PERCENT,
      { fallback: 10, min: 0, max: 100 },
    ),
    platformHoldEscalationMaxAgeMs: numEnv(
      "PLATFORM_HOLD_ESCALATION_MAX_AGE_MS",
      env.PLATFORM_HOLD_ESCALATION_MAX_AGE_MS,
      { fallback: PLATFORM_HOLD_ESCALATION_HOURS_DEFAULT * MS_PER_HOUR, min: 0 },
    ),
    paidWithoutNumberGraceMs: numEnv(
      "PAID_WITHOUT_NUMBER_GRACE_MS",
      env.PAID_WITHOUT_NUMBER_GRACE_MS,
      { fallback: PAID_WITHOUT_NUMBER_GRACE_HOURS_DEFAULT * MS_PER_HOUR, min: 0 },
    ),
  };
}

function kontingentRohwerte(env, { boolEnv, numEnv }) {
  return {
    budgetMonthEnabled: boolEnv("BUDGET_MONTH_ENABLED", env.BUDGET_MONTH_ENABLED, {
      fallback: false,
    }),
    ttsCharacterQuota: numEnv("TTS_CHARACTER_QUOTA", env.TTS_CHARACTER_QUOTA, {
      fallback: 39981,
      min: 1,
    }),
    ttsCharacterQuotaWarnPercent: numEnv(
      "TTS_CHARACTER_QUOTA_WARN_PERCENT",
      env.TTS_CHARACTER_QUOTA_WARN_PERCENT,
      { fallback: 75, min: 0, max: 100 },
    ),
    ttsQuotaCycleAnchorDay: numEnv("TTS_QUOTA_CYCLE_ANCHOR_DAY", env.TTS_QUOTA_CYCLE_ANCHOR_DAY, {
      fallback: 3,
      min: 1,
      max: 28,
    }),
    platformFixedCostUsdCentsPerMonth: numEnv(
      "PLATFORM_FIXED_COST_CENTS_PER_MONTH",
      env.PLATFORM_FIXED_COST_CENTS_PER_MONTH,
      { fallback: 600, min: 0 },
    ),
    numberMonthlyCostCents: numEnv("NUMBER_MONTHLY_COST_CENTS", env.NUMBER_MONTHLY_COST_CENTS, {
      fallback: 92,
      min: 0,
    }),
    stripeStarterPriceId: env.STRIPE_STARTER_PRICE_ID || "",
    stripeBusinessPriceId: env.STRIPE_BUSINESS_PRICE_ID || "",
    priceDriftMinIntervalMs: numEnv("PRICE_DRIFT_MIN_INTERVAL_MS", env.PRICE_DRIFT_MIN_INTERVAL_MS, {
      fallback: MS_PER_DAY,
      min: 0,
    }),
    priceDriftUnknownEscalateAfter: numEnv(
      "PRICE_DRIFT_UNKNOWN_ESCALATE_AFTER",
      env.PRICE_DRIFT_UNKNOWN_ESCALATE_AFTER,
      { fallback: 3, min: 0 },
    ),
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || "",
    stripeCustomerRetryDelayMs: numEnv(
      "STRIPE_CUSTOMER_RETRY_DELAY_MS",
      env.STRIPE_CUSTOMER_RETRY_DELAY_MS,
      { fallback: 2000, min: 0 },
    ),
  };
}

export function rohwerteBilling(env, umgebung, kostenprofile) {
  return {
    ...zahlungsRohwerte(env, umgebung),
    ...abgleichRohwerte(env, umgebung),
    ...tarifRohwerte(env, umgebung, kostenprofile),
    ...alarmRohwerte(env, umgebung),
    ...kontingentRohwerte(env, umgebung),
  };
}
