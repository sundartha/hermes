import dotenv from "dotenv";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CENTS_PER_EUR, MODEL_PRICE_RATE_FIELDS, setWorldDefaultLanguageEnabled } from "./store/defaults.js";
import {
  alertChannelFindings,
  alertChannelInputs,
  fuerAudienceVergleich,
  kanonischeAudience,
} from "./boot-guard.js";
import { KOSTENPROFIL } from "./billing/kostenarten.js";
import { DEFAULT_STT_PROFILE } from "./telephony/stt-profile.js";
import { DEFAULT_INBOUND_EL_SCOPE } from "./elevenlabs/inbound-scope.js";
import { EL_BEGRUESSUNGSLAUT_PFAD } from "./elevenlabs/inbound-rueckfall.js";
import { DEFAULT_LLM_PROVIDER, LLM_PROVIDER, LLM_PROVIDER_VALUES } from "./llm/provider.js";
import { MS_PER_MINUTE } from "./utils/timer.js";
import { merkeLogGeheimnisse } from "./log-maske.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (process.env.NODE_ENV !== "test") {
  dotenv.config({ path: path.join(__dirname, "..", ".env") });
}
merkeLogGeheimnisse(process.env);

const fatalConfigErrors = [];

const NUM_ENV_INTEGER_PATTERN = /^[+-]?\d+$/;
const NUM_ENV_DECIMAL_PATTERN = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

const MAX_TIMER_DELAY_MS = 2_147_483_647;

const CONSULT_WAIT_MAX_MS = 60_000;
const CONSULT_OPEN_MAX_MS = 300_000;
const EL_CONSULT_STAGE_MAX_MS = 55_000;

export const DEPLOYED_COMMIT_UNKNOWN = "unbekannt";

function parseNumEnv(trimmed, integer) {
  const pattern = integer ? NUM_ENV_INTEGER_PATTERN : NUM_ENV_DECIMAL_PATTERN;
  const parsed = integer ? parseInt(trimmed, 10) : parseFloat(trimmed);
  return pattern.test(trimmed) && Number.isFinite(parsed) ? parsed : null;
}

function numEnvExpectation(integer, min) {
  const art = integer ? "Ganzzahl" : "Zahl";
  return min === undefined ? art : `${art}, >= ${min}`;
}

export function numEnv(name, raw, { fallback, min, max, integer = true } = {}) {
  if (raw === undefined || raw === "") return fallback;
  const parsed = parseNumEnv(raw.trim(), integer);
  if (parsed === null) {
    fatalConfigErrors.push(
      `${name}="${raw}" ist keine gueltige Zahl (erwartet: ${numEnvExpectation(integer, min)}).`,
    );
    return fallback;
  }
  if (min !== undefined && parsed < min) {
    fatalConfigErrors.push(`${name}=${parsed} unterschreitet das Minimum ${min}.`);
    return fallback;
  }
  if (max !== undefined && parsed > max) return max;
  return parsed;
}

export function configFatalErrors() {
  return fatalConfigErrors.slice();
}

export function boolEnv(name, raw, { fallback }) {
  if (raw === undefined || raw === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  fatalConfigErrors.push(
    `${name}="${raw}" ist kein gueltiger Boolean (erwartet: "true" oder "false").`,
  );
  return fallback;
}

export function enumEnv(name, raw, { allowed, fallback }) {
  if (raw === undefined || raw === "") return fallback;
  const trimmed = raw.trim();
  if (allowed.includes(trimmed)) return trimmed;
  fatalConfigErrors.push(`${name}="${raw}" ist unbekannt (gueltig: ${allowed.join("|")}).`);
  return fallback;
}

const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

export function isoInstantEnv(name, raw) {
  if (raw === undefined || raw === "") return null;
  const trimmed = raw.trim();
  const at = new Date(trimmed);
  if (!ISO_INSTANT_PATTERN.test(trimmed) || Number.isNaN(at.getTime())) {
    fatalConfigErrors.push(
      `${name}="${raw}" ist kein gueltiger ISO-8601-Zeitpunkt mit Zone (erwartet z.B. 2026-08-04T00:00:00Z).`,
    );
    return null;
  }
  return at.toISOString();
}

function detectProduction() {
  return !!process.env.RENDER_EXTERNAL_URL;
}

const VOICE_TARIFF_DOMESTIC_PREFIXES = ["+49", "+33", "+44"];

const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MS_PER_HOUR = MINUTES_PER_HOUR * MS_PER_MINUTE;
const MS_PER_DAY = HOURS_PER_DAY * MS_PER_HOUR;

const OUTAGE_ALERT_DEBOUNCE_HOURS_DEFAULT = 6;
const OUTAGE_ALERT_RETRY_MINUTES_DEFAULT = 15;
const INBOUND_OUTAGE_ALERT_WINDOW_HOURS_DEFAULT = 6;
const LLM_BILLING_LATCH_COOLDOWN_MINUTES_DEFAULT = 15;
const OUTAGE_ALERT_SELF_TEST_DAYS_DEFAULT = 30;
const PLATFORM_HOLD_ESCALATION_HOURS_DEFAULT = 24;
const PAID_WITHOUT_NUMBER_GRACE_HOURS_DEFAULT = 1;

export function eurToCents(eur) {
  return Math.round(eur * CENTS_PER_EUR);
}

export const VOICE_ENGINE = Object.freeze({ BUDGET: "budget" });

export function stripTrailingSlash(url) {
  return url.replace(/\/$/, "");
}

export function csvEnv(raw) {
  return (raw || "")
    .split(",")
    .map((eintrag) => eintrag.trim())
    .filter(Boolean);
}

function routeCentsEnv(name, raw, gueltigeRouten) {
  const karte = {};
  for (const eintrag of csvEnv(raw)) {
    const trennIndex = eintrag.lastIndexOf(":");
    const profil = trennIndex === -1 ? "" : eintrag.slice(0, trennIndex);
    const cents = trennIndex === -1 ? null : parseNumEnv(eintrag.slice(trennIndex + 1), true);
    if (!gueltigeRouten.includes(profil) || cents === null || cents < 0) {
      fatalConfigErrors.push(
        `${name}="${eintrag}" ist keine gueltige Karte profil:ganze-cent ` +
          `(gueltige Profile: ${gueltigeRouten.join("|")}).`,
      );
      continue;
    }
    karte[profil] = cents;
  }
  return karte;
}

function trimmedUpper(raw) {
  return (raw || "").trim().toUpperCase();
}

const FX_MICRO_PER_UNIT = 1_000_000;

const EXCHANGE_RATE_DEFAULTS = Object.freeze({
  usdToEur: 0.92,
});

const ANTHROPIC_PRICING_SOURCE = "https://platform.claude.com/docs/en/about-claude/pricing.md";
const DEEPSEEK_PRICING_SOURCE = "https://api-docs.deepseek.com/quick_start/pricing";

const MODEL_PRICE_SCHEDULES = Object.freeze({
  "claude-haiku-4-5": [
    {
      validFrom: "2026-08-08",
      inPerMTok: 1.0,
      cacheWritePerMTok: 1.25,
      cacheReadPerMTok: 0.1,
      outPerMTok: 5.0,
      asOf: "2026-08-08",
      source: ANTHROPIC_PRICING_SOURCE,
    },
  ],
  "claude-sonnet-5": [
    {
      validFrom: "2026-08-08",
      inPerMTok: 2.0,
      cacheWritePerMTok: 2.5,
      cacheReadPerMTok: 0.2,
      outPerMTok: 10.0,
      asOf: "2026-08-08",
      source: ANTHROPIC_PRICING_SOURCE,
    },
    {
      validFrom: "2026-09-01",
      inPerMTok: 3.0,
      cacheWritePerMTok: 3.75,
      cacheReadPerMTok: 0.3,
      outPerMTok: 15.0,
      asOf: "2026-08-08",
      source: ANTHROPIC_PRICING_SOURCE,
    },
  ],
  "deepseek-v4-pro": [
    {
      validFrom: "2026-08-07",
      inPerMTok: 0.435,
      cacheWritePerMTok: 0.435,
      cacheReadPerMTok: 0.003625,
      outPerMTok: 0.87,
      asOf: "2026-08-07",
      source: DEEPSEEK_PRICING_SOURCE,
    },
  ],
});

const ISO_DATE_LENGTH = 10;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function todayIsoDate() {
  return new Date().toISOString().slice(0, ISO_DATE_LENGTH);
}

function assertScheduleEntry(modelId, entry) {
  if (!ISO_DATE_PATTERN.test(entry?.validFrom ?? ""))
    throw new Error(`modelPricesUsd: Staffel '${modelId}' ohne gueltiges validFrom (YYYY-MM-DD)`);
  for (const field of MODEL_PRICE_RATE_FIELDS) {
    const rate = entry[field];
    if (!Number.isFinite(rate) || rate < 0)
      throw new Error(
        `modelPricesUsd: Staffel '${modelId}' ab ${entry.validFrom} hat keine gueltige Rate ` +
          `${field} (${rate}) - vier Raten sind Pflicht`,
      );
  }
}

function activeSchedule(entries, todayIso) {
  return entries
    .filter((entry) => entry.validFrom <= todayIso)
    .reduce((latest, entry) => (latest === null || entry.validFrom > latest.validFrom ? entry : latest), null);
}

function nextValidFrom(entries, todayIso) {
  const future = entries.filter((entry) => entry.validFrom > todayIso).map((entry) => entry.validFrom);
  return future.length ? future.reduce((min, date) => (date < min ? date : min)) : null;
}

export function resolveModelPrices(schedules, todayIso) {
  const modelIds = Object.keys(schedules);
  if (!modelIds.length)
    throw new Error(
      "modelPricesUsd: keine Preisstaffel hinterlegt - keine Preisquelle fuer den Budget-Guard (Regel 1)",
    );
  const resolved = {};
  for (const modelId of modelIds) {
    const entries = schedules[modelId];
    for (const entry of entries) assertScheduleEntry(modelId, entry);
    const active = activeSchedule(entries, todayIso);
    if (!active)
      throw new Error(
        `modelPricesUsd: Modell '${modelId}' hat am ${todayIso} keine gueltige Preisstaffel ` +
          "(kein validFrom liegt in der Vergangenheit)",
      );
    resolved[modelId] = { ...active, nextValidFrom: nextValidFrom(entries, todayIso) };
  }
  return resolved;
}

const ELEVENLABS_API_KEY = (process.env.ELEVENLABS_API_KEY || "").trim();
const ELEVENLABS_API_BASE = stripTrailingSlash(
  (process.env.ELEVENLABS_API_BASE || "https://api.elevenlabs.io").trim(),
);

const rawConfig = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  llmProvider: enumEnv("LLM_PROVIDER", process.env.LLM_PROVIDER, {
    allowed: LLM_PROVIDER_VALUES,
    fallback: DEFAULT_LLM_PROVIDER,
  }),
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || "",
  llmProviderFallback: enumEnv("LLM_PROVIDER_FALLBACK", process.env.LLM_PROVIDER_FALLBACK, {
    allowed: LLM_PROVIDER_VALUES,
    fallback: "",
  }),
  claudeModel: process.env.CLAUDE_MODEL || "claude-haiku-4-5",
  platformSpendCapCents: eurToCents(
    numEnv("MAX_BUDGET_EUR", process.env.MAX_BUDGET_EUR, { fallback: 30, min: 0, integer: false }),
  ),

  llmRequestTimeoutMs: numEnv("LLM_REQUEST_TIMEOUT_MS", process.env.LLM_REQUEST_TIMEOUT_MS, {
    fallback: 3500,
    min: 1,
  }),
  llmMaxRetries: numEnv("LLM_MAX_RETRIES", process.env.LLM_MAX_RETRIES, { fallback: 2, min: 0 }),
  llmBackoffMs: numEnv("LLM_BACKOFF_MS", process.env.LLM_BACKOFF_MS, { fallback: 250, min: 0 }),
  llmBreakerThreshold: numEnv("LLM_BREAKER_THRESHOLD", process.env.LLM_BREAKER_THRESHOLD, {
    fallback: 5,
    min: 1,
  }),
  llmBreakerWindowMs: numEnv("LLM_BREAKER_WINDOW_MS", process.env.LLM_BREAKER_WINDOW_MS, {
    fallback: 10000,
    min: 1,
  }),
  llmBreakerCooldownMs: numEnv("LLM_BREAKER_COOLDOWN_MS", process.env.LLM_BREAKER_COOLDOWN_MS, {
    fallback: 30000,
    min: 1,
  }),
  llmBillingLatchCooldownMs: numEnv("LLM_BILLING_LATCH_COOLDOWN_MS", process.env.LLM_BILLING_LATCH_COOLDOWN_MS, {
    fallback: LLM_BILLING_LATCH_COOLDOWN_MINUTES_DEFAULT * MS_PER_MINUTE,
    min: 1,
  }),

  briefingModel: process.env.PRECALL_BRIEFING_MODEL || "claude-sonnet-5",
  briefingTimeoutMs: numEnv("PRECALL_BRIEFING_TIMEOUT_MS", process.env.PRECALL_BRIEFING_TIMEOUT_MS, {
    fallback: 6000,
    min: 1,
  }),

  summaryTimeoutMs: numEnv("CALL_SUMMARY_TIMEOUT_MS", process.env.CALL_SUMMARY_TIMEOUT_MS, {
    fallback: 20000,
    min: 1,
  }),

  researchEnabled: boolEnv("RESEARCH_ENABLED", process.env.RESEARCH_ENABLED, { fallback: false }),
  researchMaxUses: 1,
  researchSearchFeeCents: numEnv("RESEARCH_SEARCH_FEE_CENTS", process.env.RESEARCH_SEARCH_FEE_CENTS, {
    fallback: 1,
    min: 0,
  }),

  lookupEnabled: boolEnv("LOOKUP_ENABLED", process.env.LOOKUP_ENABLED, { fallback: false }),
  lookupSearchFeeCents: numEnv("LOOKUP_SEARCH_FEE_CENTS", process.env.LOOKUP_SEARCH_FEE_CENTS, {
    fallback: 1,
    min: 0,
  }),
  exaApiKey: (process.env.EXA_API_KEY || "").trim(),
  exaApiBase: stripTrailingSlash((process.env.EXA_API_BASE || "https://api.exa.ai").trim()),

  metricsEnabled: boolEnv("METRICS_ENABLED", process.env.METRICS_ENABLED, { fallback: false }),

  telnyxApiKey: process.env.TELNYX_API_KEY || "",
  telnyxPublicKey: process.env.TELNYX_PUBLIC_KEY || "",
  telnyxApiBase: stripTrailingSlash(process.env.TELNYX_API_BASE || "https://api.telnyx.com"),
  telnyxConnectionId: process.env.TELNYX_CONNECTION_ID || "",
  telnyxAccountSid: process.env.TELNYX_ACCOUNT_SID || "",
  telnyxSipTrunkUsername: (process.env.TELNYX_SIP_TRUNK_USERNAME || "").trim(),
  telnyxSipTrunkPassword: process.env.TELNYX_SIP_TRUNK_PASSWORD || "",
  telnyxElevenLabs: {
    voiceId: process.env.TELNYX_ELEVENLABS_VOICE_ID || "",
  },

  elevenLabsPlayTts: {
    enabled: boolEnv("ELEVENLABS_PLAY_TTS_ENABLED", process.env.ELEVENLABS_PLAY_TTS_ENABLED, {
      fallback: false,
    }),
    apiKey: ELEVENLABS_API_KEY,
    voiceId: (process.env.ELEVENLABS_VOICE_ID || "").trim(),
    model: (process.env.ELEVENLABS_MODEL || "eleven_v3_conversational").trim(),
    apiBase: ELEVENLABS_API_BASE,
    outputFormat: (process.env.ELEVENLABS_OUTPUT_FORMAT || "mp3_44100_128").trim(),
    synthTimeoutMs: numEnv("ELEVENLABS_SYNTH_TIMEOUT_MS", process.env.ELEVENLABS_SYNTH_TIMEOUT_MS, {
      fallback: 2000,
      min: 500,
      max: 10000,
    }),
    synthTotalTimeoutMs: numEnv(
      "ELEVENLABS_SYNTH_TOTAL_TIMEOUT_MS",
      process.env.ELEVENLABS_SYNTH_TOTAL_TIMEOUT_MS,
      { fallback: 10000, min: 1000, max: 30000 },
    ),
    tokenTtlMs: numEnv("ELEVENLABS_TTS_TOKEN_TTL_MS", process.env.ELEVENLABS_TTS_TOKEN_TTL_MS, {
      fallback: 60000,
      min: 5000,
      max: 600000,
    }),
  },

  elevenLabsToolToken: (process.env.ELEVENLABS_TOOL_TOKEN || "").trim(),

  elevenLabsTenantTokenRequired: boolEnv(
    "ELEVENLABS_TENANT_TOKEN_REQUIRED",
    process.env.ELEVENLABS_TENANT_TOKEN_REQUIRED,
    { fallback: false },
  ),

  elevenLabsOutbound: {
    enabled: boolEnv("ELEVENLABS_OUTBOUND_ENABLED", process.env.ELEVENLABS_OUTBOUND_ENABLED, {
      fallback: false,
    }),
    agentId: (process.env.ELEVENLABS_AGENT_ID || "").trim(),
    agentPhoneNumberId: (process.env.ELEVENLABS_AGENT_PHONE_NUMBER_ID || "").trim(),
    numberRegistrationEnabled: boolEnv(
      "ELEVENLABS_NUMBER_REGISTRATION_ENABLED",
      process.env.ELEVENLABS_NUMBER_REGISTRATION_ENABLED,
      { fallback: false },
    ),
    resultPollMs: numEnv("ELEVENLABS_RESULT_POLL_MS", process.env.ELEVENLABS_RESULT_POLL_MS, {
      fallback: 5000,
      min: 100,
      max: 60000,
    }),
    apiKey: ELEVENLABS_API_KEY,
    apiBase: ELEVENLABS_API_BASE,
    openingLineLlm: boolEnv(
      "ELEVENLABS_OPENING_LINE_LLM_ENABLED",
      process.env.ELEVENLABS_OPENING_LINE_LLM_ENABLED,
      { fallback: true },
    ),
    environment: enumEnv("ELEVENLABS_ENVIRONMENT", process.env.ELEVENLABS_ENVIRONMENT, {
      allowed: ["production", "staging"],
      fallback: "production",
    }),
  },

  elevenLabsInbound: {
    enabled: boolEnv("ELEVENLABS_INBOUND_ENABLED", process.env.ELEVENLABS_INBOUND_ENABLED, {
      fallback: false,
    }),
    tenantIds: csvEnv(process.env.ELEVENLABS_INBOUND_TENANT_IDS),
    scope: (process.env.ELEVENLABS_INBOUND_SCOPE || DEFAULT_INBOUND_EL_SCOPE).trim(),
    begruessungslautEnabled: boolEnv(
      "ELEVENLABS_INBOUND_BEGRUESSUNGSLAUT_ENABLED",
      process.env.ELEVENLABS_INBOUND_BEGRUESSUNGSLAUT_ENABLED,
      { fallback: true },
    ),
    sipUser: (process.env.ELEVENLABS_INBOUND_SIP_USER || "").trim(),
    sipPassword: (process.env.ELEVENLABS_INBOUND_SIP_PASSWORD || "").trim(),
    initWebhookToken: (process.env.ELEVENLABS_INIT_WEBHOOK_TOKEN || "").trim(),
  },

  renderApiKey: (process.env.RENDER_API_KEY || "").trim(),

  paymentEnabled: boolEnv("PAYMENT_ENABLED", process.env.PAYMENT_ENABLED, { fallback: false }),
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || "",
  stripeApiBase: stripTrailingSlash(process.env.STRIPE_API_BASE || "https://api.stripe.com"),
  numberSetupFeeCents: numEnv("NUMBER_SETUP_FEE_CENTS", process.env.NUMBER_SETUP_FEE_CENTS, {
    fallback: 0,
    min: 0,
  }),
  flushEpochIso: isoInstantEnv("BILLING_FLUSH_EPOCH", process.env.BILLING_FLUSH_EPOCH),
  paymentCurrency: (process.env.PAYMENT_CURRENCY || "eur").toLowerCase(),
  providerCurrency: (process.env.PROVIDER_CURRENCY || "USD").toUpperCase(),
  providerToBucketRateMicro: numEnv("PROVIDER_TO_BUCKET_RATE_MICRO", process.env.PROVIDER_TO_BUCKET_RATE_MICRO, {
    fallback: 920000,
    min: 1,
  }),
  costTruingDelayMinutes: numEnv("COST_TRUING_DELAY_MINUTES", process.env.COST_TRUING_DELAY_MINUTES, { fallback: 30, min: 0 }),
  costTruingSweepIntervalMs: numEnv("COST_TRUING_SWEEP_INTERVAL_MS", process.env.COST_TRUING_SWEEP_INTERVAL_MS, {
    fallback: MS_PER_HOUR,
    min: MS_PER_MINUTE,
    max: MAX_TIMER_DELAY_MS,
  }),
  costTruingMaxAttempts: numEnv("COST_TRUING_MAX_ATTEMPTS", process.env.COST_TRUING_MAX_ATTEMPTS, { fallback: 5, min: 1 }),
  costSettleDeadlineHours: numEnv("COST_SETTLE_DEADLINE_HOURS", process.env.COST_SETTLE_DEADLINE_HOURS, { fallback: 48, min: 1 }),
  elEvidenceMinAgeMinutes: numEnv("EL_EVIDENCE_MIN_AGE_MINUTES", process.env.EL_EVIDENCE_MIN_AGE_MINUTES, { fallback: 15, min: 0 }),
  costTruingRequiredRecordTypes: csvEnv(process.env.COST_TRUING_REQUIRED_RECORD_TYPES),
  costTruingMinCoveragePercent: numEnv("COST_TRUING_MIN_COVERAGE_PERCENT", process.env.COST_TRUING_MIN_COVERAGE_PERCENT, { fallback: 80, min: 0, max: 100 }),
  costTruingCoverageStallSweeps: numEnv("COST_TRUING_COVERAGE_STALL_SWEEPS", process.env.COST_TRUING_COVERAGE_STALL_SWEEPS, { fallback: 8, min: 1 }),
  kostenHeartbeatFensterH: numEnv("KOSTEN_HEARTBEAT_FENSTER_H", process.env.KOSTEN_HEARTBEAT_FENSTER_H, { fallback: 6, min: 0 }),
  costDriftWarnPercent: numEnv("COST_DRIFT_WARN_PERCENT", process.env.COST_DRIFT_WARN_PERCENT, { fallback: 50, min: 0 }),
  costAlertDebounceMs: numEnv("COST_ALERT_DEBOUNCE_MS", process.env.COST_ALERT_DEBOUNCE_MS, { fallback: MS_PER_DAY, min: 0 }),
  costCalibrationMinSamples: numEnv("COST_CALIBRATION_MIN_SAMPLES", process.env.COST_CALIBRATION_MIN_SAMPLES, {
    fallback: 20,
    min: 1,
  }),
  voiceTariffDomesticCents: numEnv("VOICE_TARIFF_DOMESTIC_CENTS", process.env.VOICE_TARIFF_DOMESTIC_CENTS, {
    fallback: 20,
    min: 0,
  }),
  voiceTariffDefaultCents: numEnv("VOICE_TARIFF_DEFAULT_CENTS", process.env.VOICE_TARIFF_DEFAULT_CENTS, {
    fallback: 30,
    min: 0,
  }),
  voiceTariffInboundCents: numEnv("VOICE_TARIFF_INBOUND_CENTS", process.env.VOICE_TARIFF_INBOUND_CENTS, {
    fallback: 6,
    min: 0,
  }),
  voiceTariffFullCostFloorCents: numEnv(
    "VOICE_TARIFF_FULL_COST_FLOOR_CENTS",
    process.env.VOICE_TARIFF_FULL_COST_FLOOR_CENTS,
    { fallback: 15, min: 0 },
  ),
  voiceTariffGrundbetragCentsJeRoute: routeCentsEnv(
    "VOICE_TARIFF_GRUNDBETRAG_CENTS",
    process.env.VOICE_TARIFF_GRUNDBETRAG_CENTS,
    Object.values(KOSTENPROFIL),
  ),
  voiceTariffDomesticPrefixes: VOICE_TARIFF_DOMESTIC_PREFIXES,
  defaultTenantBudgetCents: numEnv("DEFAULT_TENANT_BUDGET_CENTS", process.env.DEFAULT_TENANT_BUDGET_CENTS, {
    fallback: 1500,
    min: 0,
  }),
  smsCostCents: numEnv("SMS_COST_CENTS", process.env.SMS_COST_CENTS, { fallback: 0, min: 0 }),
  platformSpendWarnPercent: numEnv(
    "PLATFORM_SPEND_WARN_PERCENT",
    process.env.PLATFORM_SPEND_WARN_PERCENT,
    { fallback: 80, min: 0, max: 100 },
  ),
  platformAlertSmsTo: process.env.PLATFORM_ALERT_SMS_TO || "",
  outageAlertWindowMs: numEnv("OUTAGE_ALERT_WINDOW_MS", process.env.OUTAGE_ALERT_WINDOW_MS, {
    fallback: MS_PER_HOUR,
    min: 0,
  }),
  outageAlertMinFailures: numEnv("OUTAGE_ALERT_MIN_FAILURES", process.env.OUTAGE_ALERT_MIN_FAILURES, {
    fallback: 3,
    min: 1,
  }),
  outageAlertMinAttempts: numEnv("OUTAGE_ALERT_MIN_ATTEMPTS", process.env.OUTAGE_ALERT_MIN_ATTEMPTS, {
    fallback: 20,
    min: 1,
  }),
  outageAlertFailSharePercent: numEnv(
    "OUTAGE_ALERT_FAIL_SHARE_PERCENT",
    process.env.OUTAGE_ALERT_FAIL_SHARE_PERCENT,
    { fallback: 20, min: 0, max: 100 },
  ),
  outageAlertDebounceMs: numEnv("OUTAGE_ALERT_DEBOUNCE_MS", process.env.OUTAGE_ALERT_DEBOUNCE_MS, {
    fallback: OUTAGE_ALERT_DEBOUNCE_HOURS_DEFAULT * MS_PER_HOUR,
    min: 0,
  }),
  outageAlertRetryMs: numEnv("OUTAGE_ALERT_RETRY_MS", process.env.OUTAGE_ALERT_RETRY_MS, {
    fallback: OUTAGE_ALERT_RETRY_MINUTES_DEFAULT * MS_PER_MINUTE,
    min: 0,
  }),
  outageAlertSelfTestIntervalMs: numEnv(
    "OUTAGE_ALERT_SELF_TEST_INTERVAL_MS",
    process.env.OUTAGE_ALERT_SELF_TEST_INTERVAL_MS,
    { fallback: OUTAGE_ALERT_SELF_TEST_DAYS_DEFAULT * MS_PER_DAY, min: 0 },
  ),
  inboundOutageAlertWindowMs: numEnv(
    "INBOUND_OUTAGE_ALERT_WINDOW_MS",
    process.env.INBOUND_OUTAGE_ALERT_WINDOW_MS,
    { fallback: INBOUND_OUTAGE_ALERT_WINDOW_HOURS_DEFAULT * MS_PER_HOUR, min: 0 },
  ),
  inboundOutageAlertMinFailures: numEnv(
    "INBOUND_OUTAGE_ALERT_MIN_FAILURES",
    process.env.INBOUND_OUTAGE_ALERT_MIN_FAILURES,
    { fallback: 2, min: 1 },
  ),
  inboundOutageAlertMinAttempts: numEnv(
    "INBOUND_OUTAGE_ALERT_MIN_ATTEMPTS",
    process.env.INBOUND_OUTAGE_ALERT_MIN_ATTEMPTS,
    { fallback: 20, min: 1 },
  ),
  inboundOutageAlertFailSharePercent: numEnv(
    "INBOUND_OUTAGE_ALERT_FAIL_SHARE_PERCENT",
    process.env.INBOUND_OUTAGE_ALERT_FAIL_SHARE_PERCENT,
    { fallback: 10, min: 0, max: 100 },
  ),
  platformHoldEscalationMaxAgeMs: numEnv(
    "PLATFORM_HOLD_ESCALATION_MAX_AGE_MS",
    process.env.PLATFORM_HOLD_ESCALATION_MAX_AGE_MS,
    { fallback: PLATFORM_HOLD_ESCALATION_HOURS_DEFAULT * MS_PER_HOUR, min: 0 },
  ),
  paidWithoutNumberGraceMs: numEnv(
    "PAID_WITHOUT_NUMBER_GRACE_MS",
    process.env.PAID_WITHOUT_NUMBER_GRACE_MS,
    { fallback: PAID_WITHOUT_NUMBER_GRACE_HOURS_DEFAULT * MS_PER_HOUR, min: 0 },
  ),
  budgetMonthEnabled: boolEnv("BUDGET_MONTH_ENABLED", process.env.BUDGET_MONTH_ENABLED, {
    fallback: false,
  }),
  ttsCharacterQuota: numEnv("TTS_CHARACTER_QUOTA", process.env.TTS_CHARACTER_QUOTA, {
    fallback: 39981,
    min: 1,
  }),
  ttsCharacterQuotaWarnPercent: numEnv(
    "TTS_CHARACTER_QUOTA_WARN_PERCENT",
    process.env.TTS_CHARACTER_QUOTA_WARN_PERCENT,
    { fallback: 75, min: 0, max: 100 },
  ),
  ttsQuotaCycleAnchorDay: numEnv("TTS_QUOTA_CYCLE_ANCHOR_DAY", process.env.TTS_QUOTA_CYCLE_ANCHOR_DAY, {
    fallback: 3,
    min: 1,
    max: 28,
  }),
  platformFixedCostUsdCentsPerMonth: numEnv(
    "PLATFORM_FIXED_COST_CENTS_PER_MONTH",
    process.env.PLATFORM_FIXED_COST_CENTS_PER_MONTH,
    { fallback: 600, min: 0 },
  ),
  numberMonthlyCostCents: numEnv("NUMBER_MONTHLY_COST_CENTS", process.env.NUMBER_MONTHLY_COST_CENTS, {
    fallback: 92,
    min: 0,
  }),
  stripeStarterPriceId: process.env.STRIPE_STARTER_PRICE_ID || "",
  stripeBusinessPriceId: process.env.STRIPE_BUSINESS_PRICE_ID || "",
  priceDriftMinIntervalMs: numEnv("PRICE_DRIFT_MIN_INTERVAL_MS", process.env.PRICE_DRIFT_MIN_INTERVAL_MS, {
    fallback: MS_PER_DAY,
    min: 0,
  }),
  priceDriftUnknownEscalateAfter: numEnv(
    "PRICE_DRIFT_UNKNOWN_ESCALATE_AFTER",
    process.env.PRICE_DRIFT_UNKNOWN_ESCALATE_AFTER,
    { fallback: 3, min: 0 },
  ),
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
  stripeCustomerRetryDelayMs: numEnv(
    "STRIPE_CUSTOMER_RETRY_DELAY_MS",
    process.env.STRIPE_CUSTOMER_RETRY_DELAY_MS,
    { fallback: 2000, min: 0 },
  ),

  ownerNumberSeed: process.env.OWNER_NUMBER_SEED || "",
  ownerNumberProvider: (process.env.OWNER_NUMBER_PROVIDER || "").toLowerCase(),

  bootstrapE164: process.env.BOOTSTRAP_E164 || "",
  bootstrapProvider: process.env.BOOTSTRAP_PROVIDER || "",

  platformAniE164: (process.env.PLATFORM_ANI_E164 || "").trim(),

  ownerIdpSubject: process.env.OWNER_IDP_SUBJECT || "",

  storeBackend: (process.env.STORE_BACKEND || "json").toLowerCase(),
  databaseUrl: process.env.DATABASE_URL || "",
  queueBackend: (process.env.QUEUE_BACKEND || "memory").toLowerCase(),

  port: numEnv("PORT", process.env.PORT, { fallback: 3000, min: 0 }),
  publicUrl: stripTrailingSlash(process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || ""),
  publicUrlExplicit: Boolean((process.env.PUBLIC_URL || "").trim()),
  isProduction: detectProduction(),
  deployedCommit: process.env.RENDER_GIT_COMMIT || DEPLOYED_COMMIT_UNKNOWN,
  openaiAppsChallengeToken: (process.env.OPENAI_APPS_CHALLENGE_TOKEN || "").trim(),
  dashboardPassword: process.env.DASHBOARD_PASSWORD || "",
  sendSmsSummary: boolEnv("SEND_SMS_SUMMARY", process.env.SEND_SMS_SUMMARY, { fallback: true }),
  dailySmsCap: numEnv("DAILY_SMS_CAP", process.env.DAILY_SMS_CAP, { fallback: 20, min: 0 }),

  outboundFrozen: boolEnv("OUTBOUND_FROZEN", process.env.OUTBOUND_FROZEN, { fallback: false }),
  allowedCountryCodes: csvEnv(process.env.ALLOWED_COUNTRY_CODES || "+49,+33,+44"),
  maxCallsPerHour: numEnv("MAX_CALLS_PER_HOUR", process.env.MAX_CALLS_PER_HOUR, {
    fallback: 6,
    min: 0,
  }),
  perTargetCallCap: numEnv("PER_TARGET_CALL_CAP", process.env.PER_TARGET_CALL_CAP, {
    fallback: 3,
    min: 0,
  }),
  perTargetWindowMs: numEnv("PER_TARGET_WINDOW_MS", process.env.PER_TARGET_WINDOW_MS, {
    fallback: MS_PER_DAY,
    min: 1,
  }),
  maxNumbers: numEnv("MAX_NUMBERS", process.env.MAX_NUMBERS, { fallback: 5, min: 0 }),
  maxNumbersPerTenant: numEnv("MAX_NUMBERS_PER_TENANT", process.env.MAX_NUMBERS_PER_TENANT, {
    fallback: 1,
    min: 0,
  }),
  provisioningEnabled: boolEnv("PROVISIONING_ENABLED", process.env.PROVISIONING_ENABLED, {
    fallback: false,
  }),
  provisioningRedriveMaxAgeMs: numEnv(
    "PROVISIONING_REDRIVE_MAX_AGE_MS",
    process.env.PROVISIONING_REDRIVE_MAX_AGE_MS,
    { fallback: 0, min: 0, max: MS_PER_DAY - 1 },
  ),
  provisioningRetryMaxAttempts: numEnv(
    "PROVISIONING_RETRY_MAX_ATTEMPTS",
    process.env.PROVISIONING_RETRY_MAX_ATTEMPTS,
    { fallback: 3, min: 0 },
  ),
  provisioningRetryMinIntervalMs: numEnv(
    "PROVISIONING_RETRY_MIN_INTERVAL_MS",
    process.env.PROVISIONING_RETRY_MIN_INTERVAL_MS,
    { fallback: MS_PER_DAY, min: 0 },
  ),
  releaseGraceMs:
    numEnv("RELEASE_GRACE_DAYS", process.env.RELEASE_GRACE_DAYS, { fallback: 0, min: 0 }) *
    MS_PER_DAY,
  multiTenant: boolEnv("MULTI_TENANT", process.env.MULTI_TENANT, { fallback: false }),
  mcpUiEnabled: boolEnv("MCP_UI_ENABLED", process.env.MCP_UI_ENABLED, { fallback: true }),
  assistantContextEnabled: boolEnv("ASSISTANT_CONTEXT_ENABLED", process.env.ASSISTANT_CONTEXT_ENABLED, {
    fallback: true,
  }),
  precallBriefingEnabled: boolEnv("PRECALL_BRIEFING_ENABLED", process.env.PRECALL_BRIEFING_ENABLED, {
    fallback: false,
  }),
  consultEnabled: boolEnv("CONSULT_ENABLED", process.env.CONSULT_ENABLED, { fallback: false }),
  inCallConsultEnabled: boolEnv("IN_CALL_CONSULT_ENABLED", process.env.IN_CALL_CONSULT_ENABLED, {
    fallback: false,
  }),
  consultWaitMs: numEnv("CONSULT_WAIT_MS", process.env.CONSULT_WAIT_MS, {
    fallback: 4000,
    min: 0,
    max: CONSULT_WAIT_MAX_MS,
  }),
  consultOpenMs: numEnv("CONSULT_OPEN_MS", process.env.CONSULT_OPEN_MS, {
    fallback: 47000,
    min: 0,
    max: CONSULT_OPEN_MAX_MS,
  }),
  elConsultDeliveryMs: numEnv("EL_CONSULT_DELIVERY_MS", process.env.EL_CONSULT_DELIVERY_MS, {
    fallback: 5000,
    min: 0,
    max: EL_CONSULT_STAGE_MAX_MS,
  }),
  elConsultAckMs: numEnv("EL_CONSULT_ACK_MS", process.env.EL_CONSULT_ACK_MS, {
    fallback: 5000,
    min: 0,
    max: EL_CONSULT_STAGE_MAX_MS,
  }),
  elConsultAnswerMs: numEnv("EL_CONSULT_ANSWER_MS", process.env.EL_CONSULT_ANSWER_MS, {
    fallback: 30000,
    min: 0,
    max: EL_CONSULT_STAGE_MAX_MS,
  }),
  selfServiceEnabled: boolEnv("SELF_SERVICE_ENABLED", process.env.SELF_SERVICE_ENABLED, {
    fallback: false,
  }),
  devLoginEnabled:
    boolEnv("DEV_LOGIN_ENABLED", process.env.DEV_LOGIN_ENABLED, { fallback: false }) &&
    !process.env.RENDER_EXTERNAL_URL,
  provisioningCountry: process.env.PROVISIONING_COUNTRY || "DE",
  forceNumberCountry: trimmedUpper(process.env.FORCE_NUMBER_COUNTRY),
  geoEnabled: boolEnv("GEO_ENABLED", process.env.GEO_ENABLED, { fallback: false }),
  geoDbPath: process.env.GEO_DB_PATH || "",
  worldDefaultLanguageEnabled: boolEnv(
    "WORLD_DEFAULT_LANGUAGE_ENABLED",
    process.env.WORLD_DEFAULT_LANGUAGE_ENABLED,
    { fallback: false },
  ),
  profilesSeed: process.env.PROFILES_JSON || "",
  capFarewellLeadMs: numEnv("CAP_FAREWELL_LEAD_MS", process.env.CAP_FAREWELL_LEAD_MS, {
    fallback: 20000,
    min: 0,
    max: 60000,
  }),
  reserveReleaseGraceMs: numEnv("RESERVE_RELEASE_GRACE_MS", process.env.RESERVE_RELEASE_GRACE_MS, {
    fallback: 15000,
    min: 0,
  }),
  budgetWatchdogIntervalMs: numEnv("BUDGET_WATCHDOG_INTERVAL_MS", process.env.BUDGET_WATCHDOG_INTERVAL_MS, {
    fallback: 15000,
    min: 0,
    max: 600000,
  }),
  shutdownDrainTimeoutMs: numEnv("SHUTDOWN_DRAIN_TIMEOUT_MS", process.env.SHUTDOWN_DRAIN_TIMEOUT_MS, {
    fallback: 8000,
    min: 0,
    max: 30000,
  }),
  sttSpeechTimeoutSec: numEnv("STT_SPEECH_TIMEOUT_SEC", process.env.STT_SPEECH_TIMEOUT_SEC, {
    fallback: 2,
    min: 1,
  }),
  maxEmptyTurns: numEnv("MAX_EMPTY_TURNS", process.env.MAX_EMPTY_TURNS, { fallback: 3, min: 2 }),
  callerSubstanceMinLen: numEnv("CALLER_SUBSTANCE_MIN_LEN", process.env.CALLER_SUBSTANCE_MIN_LEN, {
    fallback: 2,
    min: 1,
  }),
  thinkingSignalEnabled: boolEnv("THINKING_SIGNAL_ENABLED", process.env.THINKING_SIGNAL_ENABLED, {
    fallback: false,
  }),
  toolFollowUpEnabled: boolEnv("TOOL_FOLLOW_UP_ENABLED", process.env.TOOL_FOLLOW_UP_ENABLED, {
    fallback: false,
  }),
  ownerSelfCallEnabled: boolEnv(
    "OWNER_SELF_CALL_ENABLED",
    process.env.OWNER_SELF_CALL_ENABLED,
    { fallback: false },
  ),
  ownerSelfCallTenantIds: csvEnv(process.env.OWNER_SELF_CALL_TENANT_IDS),
  inboundOwnerGreetingEnabled: boolEnv(
    "INBOUND_OWNER_GREETING_ENABLED",
    process.env.INBOUND_OWNER_GREETING_ENABLED,
    { fallback: false },
  ),
  inboundOwnerGreetingTenantIds: csvEnv(process.env.INBOUND_OWNER_GREETING_TENANT_IDS),
  rateLimitPerMin: numEnv("RATE_LIMIT_PER_MIN", process.env.RATE_LIMIT_PER_MIN, {
    fallback: 120,
    min: 0,
  }),
  csrfEnforce: boolEnv("CSRF_ENFORCE", process.env.CSRF_ENFORCE, { fallback: true }),
  mcpAllowedOrigins: csvEnv(process.env.MCP_ALLOWED_ORIGINS),
  mcpOriginEnforce: boolEnv("MCP_ORIGIN_ENFORCE", process.env.MCP_ORIGIN_ENFORCE, {
    fallback: true,
  }),
  skipTwilioSignatureCheck: boolEnv(
    "SKIP_TWILIO_SIGNATURE_CHECK",
    process.env.SKIP_TWILIO_SIGNATURE_CHECK,
    { fallback: false },
  ),
  fakeOriginate: boolEnv("FAKE_ORIGINATE", process.env.FAKE_ORIGINATE, { fallback: false }),
  fakeOriginateElevenlabs: boolEnv(
    "FAKE_ORIGINATE_ELEVENLABS",
    process.env.FAKE_ORIGINATE_ELEVENLABS,
    { fallback: false },
  ),

  outboundAniGateEnabled: boolEnv("OUTBOUND_ANI_GATE_ENABLED", process.env.OUTBOUND_ANI_GATE_ENABLED, {
    fallback: false,
  }),
  outboundAniGateMaxAgeMs: numEnv("OUTBOUND_ANI_GATE_MAX_AGE_MS", process.env.OUTBOUND_ANI_GATE_MAX_AGE_MS, {
    fallback: 900000,
    min: 0,
  }),

  retentionDays: numEnv("RETENTION_DAYS", process.env.RETENTION_DAYS, { fallback: 30, min: 0 }),
  diagnosticRetentionDays: numEnv(
    "DIAGNOSTIC_RETENTION_DAYS",
    process.env.DIAGNOSTIC_RETENTION_DAYS,
    { fallback: 7, min: 0 },
  ),
  evidenceRetentionDays: numEnv("EVIDENCE_RETENTION_DAYS", process.env.EVIDENCE_RETENTION_DAYS, {
    fallback: 0,
    min: 0,
  }),

  mcpAuthToken: process.env.MCP_AUTH_TOKEN || "",
  mcpAuth: (process.env.MCP_AUTH || "").toLowerCase(),
  oauthIssuerUrl: stripTrailingSlash(process.env.OAUTH_ISSUER_URL || ""),
  oauthAudience: process.env.OAUTH_AUDIENCE || "",

  sessionSecret: process.env.SESSION_SECRET || "",
  oidcClientId: process.env.OIDC_CLIENT_ID || "",
  oidcClientSecret: process.env.OIDC_CLIENT_SECRET || "",
  callConfirmationSecret: process.env.CALL_CONFIRMATION_SECRET || "",
  deployToken: (process.env.HERMES_DEPLOY_TOKEN || "").trim(),
  workosApiBase: stripTrailingSlash(process.env.WORKOS_API_BASE || "https://api.workos.com"),
  workosManagementApiKey: process.env.WORKOS_MANAGEMENT_API_KEY || "",
  adminEmails: csvEnv(process.env.ADMIN_EMAILS).map((email) => email.toLowerCase()),
  loginRateLimitPerMin: numEnv("LOGIN_RATE_LIMIT_PER_MIN", process.env.LOGIN_RATE_LIMIT_PER_MIN, {
    fallback: 10,
    min: 0,
  }),
  sessionTtlSeconds: numEnv("SESSION_TTL_SECONDS", process.env.SESSION_TTL_SECONDS, {
    fallback: 3600,
    min: 0,
  }),
  loginCookieTtlSeconds: numEnv("LOGIN_COOKIE_TTL_SECONDS", process.env.LOGIN_COOKIE_TTL_SECONDS, {
    fallback: 1800,
    min: 0,
  }),

  brevoApiKey: process.env.BREVO_API_KEY || "",
  smtpHost: process.env.SMTP_HOST || "",
  smtpPort: numEnv("SMTP_PORT", process.env.SMTP_PORT, { fallback: 465, min: 1 }),
  smtpUser: process.env.SMTP_USER || "",
  smtpPassword: process.env.SMTP_PASSWORD || "",
  mailFrom: process.env.MAIL_FROM || "",
  platformAlertMailTo: process.env.PLATFORM_ALERT_MAIL_TO || "",

  voiceEngine: VOICE_ENGINE.BUDGET,

  sttProfile: (process.env.STT_PROFILE || DEFAULT_STT_PROFILE).trim(),

  machineDetection: {
    enabled: boolEnv("MACHINE_DETECTION_ENABLED", process.env.MACHINE_DETECTION_ENABLED, {
      fallback: false,
    }),
    timeoutS: numEnv("MACHINE_DETECTION_TIMEOUT_S", process.env.MACHINE_DETECTION_TIMEOUT_S, {
      fallback: 5,
      min: 3,
      max: 30,
    }),
  },

  modelPricesUsd: resolveModelPrices(MODEL_PRICE_SCHEDULES, todayIsoDate()),
  usdToEur:
    numEnv("PROVIDER_TO_BUCKET_RATE_MICRO", process.env.PROVIDER_TO_BUCKET_RATE_MICRO, {
      fallback: Math.round(EXCHANGE_RATE_DEFAULTS.usdToEur * FX_MICRO_PER_UNIT),
      min: 1,
    }) / FX_MICRO_PER_UNIT,

  dataDir: process.env.DATA_DIR || path.join(__dirname, "..", "data"),
  publicDir: path.join(__dirname, "..", "public"),
  webDistDir: process.env.WEB_DIST_DIR ? path.resolve(process.env.WEB_DIST_DIR) : "",
};

const SAFE_DUCK_TYPING_PROPS = new Set(["then", "toJSON"]);

function guardedConfig(target, path = "config") {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (typeof prop === "symbol" || prop in obj) {
        const value = Reflect.get(obj, prop, receiver);
        const isNestedGroup = value && typeof value === "object" && !Array.isArray(value);
        return isNestedGroup ? guardedConfig(value, `${path}.${String(prop)}`) : value;
      }
      if (SAFE_DUCK_TYPING_PROPS.has(prop)) return undefined;
      throw new TypeError(
        `${path}.${String(prop)} existiert nicht (verschobener/entfernter Config-Key? ` +
          "config.<namespace>.<key> nutzen - Gruppierung in src/config.js pruefen).",
      );
    },
    set(obj, prop, value) {
      if (typeof prop === "symbol" || prop in obj) return Reflect.set(obj, prop, value);
      throw new TypeError(
        `${path}.${String(prop)} kann nicht gesetzt werden (flache Oberflaeche entfernt; ` +
          "config.<namespace>.<key> nutzen).",
      );
    },
  });
}

export const CONFIG_NAMESPACES = Object.freeze({
  safety: ["outboundFrozen", "allowedCountryCodes", "maxCallsPerHour", "perTargetCallCap", "perTargetWindowMs", "capFarewellLeadMs", "reserveReleaseGraceMs", "budgetWatchdogIntervalMs", "rateLimitPerMin", "csrfEnforce", "mcpAllowedOrigins", "mcpOriginEnforce", "skipTwilioSignatureCheck", "fakeOriginate", "fakeOriginateElevenlabs", "outboundAniGateEnabled", "outboundAniGateMaxAgeMs"],
  billing: ["platformSpendCapCents", "paymentEnabled", "stripeSecretKey", "stripeApiBase", "numberSetupFeeCents", "paymentCurrency", "providerCurrency", "providerToBucketRateMicro", "costTruingDelayMinutes", "costTruingSweepIntervalMs", "costTruingMaxAttempts", "costSettleDeadlineHours", "elEvidenceMinAgeMinutes", "costTruingRequiredRecordTypes", "costTruingMinCoveragePercent", "costTruingCoverageStallSweeps", "kostenHeartbeatFensterH", "costDriftWarnPercent", "costAlertDebounceMs", "costCalibrationMinSamples", "voiceTariffDomesticCents", "voiceTariffDefaultCents", "voiceTariffInboundCents", "voiceTariffFullCostFloorCents", "voiceTariffGrundbetragCentsJeRoute", "voiceTariffDomesticPrefixes", "defaultTenantBudgetCents", "smsCostCents", "platformSpendWarnPercent", "platformAlertSmsTo", "outageAlertWindowMs", "outageAlertMinFailures", "outageAlertMinAttempts", "outageAlertFailSharePercent", "outageAlertDebounceMs", "outageAlertRetryMs", "outageAlertSelfTestIntervalMs", "inboundOutageAlertWindowMs", "inboundOutageAlertMinFailures", "inboundOutageAlertMinAttempts", "inboundOutageAlertFailSharePercent", "platformHoldEscalationMaxAgeMs", "paidWithoutNumberGraceMs", "budgetMonthEnabled", "ttsCharacterQuota", "ttsCharacterQuotaWarnPercent", "ttsQuotaCycleAnchorDay", "platformFixedCostUsdCentsPerMonth", "numberMonthlyCostCents", "stripeStarterPriceId", "stripeBusinessPriceId", "stripeWebhookSecret", "stripeCustomerRetryDelayMs", "flushEpochIso", "priceDriftMinIntervalMs", "priceDriftUnknownEscalateAfter"],
  provisioning: ["maxNumbers", "maxNumbersPerTenant", "provisioningEnabled", "provisioningRedriveMaxAgeMs", "provisioningRetryMaxAttempts", "provisioningRetryMinIntervalMs", "releaseGraceMs", "provisioningCountry", "forceNumberCountry", "geoEnabled", "geoDbPath", "worldDefaultLanguageEnabled", "ownerNumberSeed", "ownerNumberProvider", "bootstrapE164", "bootstrapProvider", "platformAniE164"],
  auth: ["mcpAuthToken", "mcpAuth", "oauthIssuerUrl", "oauthAudience", "sessionSecret", "oidcClientId", "oidcClientSecret", "workosApiBase", "workosManagementApiKey", "adminEmails", "loginRateLimitPerMin", "sessionTtlSeconds", "loginCookieTtlSeconds", "dashboardPassword", "ownerIdpSubject", "devLoginEnabled", "callConfirmationSecret", "deployToken"],
  mail: ["brevoApiKey", "smtpHost", "smtpPort", "smtpUser", "smtpPassword", "mailFrom", "platformAlertMailTo"],
  llm: ["anthropicApiKey", "llmProvider", "deepseekApiKey", "claudeModel", "llmRequestTimeoutMs", "llmMaxRetries", "llmBackoffMs", "llmBreakerThreshold", "llmBreakerWindowMs", "llmBreakerCooldownMs", "llmProviderFallback", "llmBillingLatchCooldownMs", "modelPricesUsd", "usdToEur", "briefingModel", "briefingTimeoutMs", "summaryTimeoutMs"],
  telnyx: ["telnyxElevenLabs"],
  voice: ["voiceEngine", "elevenLabsPlayTts", "elevenLabsToolToken", "elevenLabsTenantTokenRequired", "elevenLabsOutbound", "elevenLabsInbound", "sttProfile", "sttSpeechTimeoutSec", "maxEmptyTurns", "callerSubstanceMinLen", "sendSmsSummary", "dailySmsCap", "thinkingSignalEnabled", "toolFollowUpEnabled", "ownerSelfCallEnabled", "ownerSelfCallTenantIds", "inboundOwnerGreetingEnabled", "inboundOwnerGreetingTenantIds"],
  telephony: ["telnyxApiKey", "telnyxPublicKey", "telnyxApiBase", "telnyxConnectionId", "telnyxAccountSid", "machineDetection", "telnyxSipTrunkUsername", "telnyxSipTrunkPassword"],
  tenancy: ["multiTenant", "mcpUiEnabled", "assistantContextEnabled", "selfServiceEnabled", "profilesSeed", "precallBriefingEnabled", "consultEnabled", "inCallConsultEnabled", "consultWaitMs", "consultOpenMs", "elConsultDeliveryMs", "elConsultAckMs", "elConsultAnswerMs"],
  server: ["port", "publicUrl", "publicUrlExplicit", "isProduction", "deployedCommit", "openaiAppsChallengeToken", "dataDir", "publicDir", "webDistDir", "shutdownDrainTimeoutMs"],
  store: ["storeBackend", "databaseUrl", "queueBackend"],
  metrics: ["metricsEnabled"],
  privacy: ["retentionDays", "diagnosticRetentionDays", "evidenceRetentionDays"],
  research: ["researchEnabled", "researchMaxUses", "researchSearchFeeCents", "lookupEnabled", "lookupSearchFeeCents", "exaApiKey", "exaApiBase"],
  werkzeug: ["renderApiKey"],
});

function makeNamespaceGroup(keys, storage) {
  const group = {};
  for (const key of keys) {
    Object.defineProperty(group, key, {
      enumerable: true,
      get: () => storage[key],
      set: (value) => {
        Object.assign(storage, { [key]: value });
      },
    });
  }
  return group;
}

export function attachNamespaces(target, namespaces) {
  for (const [namespace, keys] of Object.entries(namespaces)) {
    Object.defineProperty(target, namespace, {
      enumerable: false,
      configurable: true,
      value: makeNamespaceGroup(keys, target),
    });
  }
}

function buildNamespaceSurface(storage, namespaces) {
  const surface = {};
  for (const [namespace, keys] of Object.entries(namespaces)) {
    Object.defineProperty(surface, namespace, {
      enumerable: true,
      configurable: true,
      value: makeNamespaceGroup(keys, storage),
    });
  }
  return surface;
}

export const config = guardedConfig(buildNamespaceSurface(rawConfig, CONFIG_NAMESPACES));

setWorldDefaultLanguageEnabled(config.provisioning.worldDefaultLanguageEnabled);

export function gatewayUrlForPort(port) {
  return `http://localhost:${port}`;
}

let boundGatewayUrl = null;

export function setBoundGatewayPort(port) {
  boundGatewayUrl = gatewayUrlForPort(port);
}

export function resolveGatewayUrl() {
  return stripTrailingSlash(
    process.env.GATEWAY_URL || boundGatewayUrl || gatewayUrlForPort(config.server.port),
  );
}

function isInsecureHttpIssuer(issuerUrl) {
  return (
    !!issuerUrl &&
    issuerUrl.startsWith("http://") &&
    !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(issuerUrl)
  );
}

const PRODUCTION_FOOTGUNS = Object.freeze([
  {
    trifftZu: (cfg) => !cfg.auth.dashboardPassword,
    befund:
      "DASHBOARD_PASSWORD fehlt - seit AUTH-P7 liest keine Route mehr diese Variable; " +
      "Boot-Pflicht bleibt bis AUTH-P8 ausschliesslich als Rollback-Sicherung (ein " +
      "Rollback auf einen Commit vor AUTH-P7 findet damit ein scharfes Gate vor).",
  },
  {
    trifftZu: (cfg) => cfg.auth.mcpAuth === "off",
    befund: "MCP_AUTH=off - /mcp ist ohne jede Pruefung offen (im Hosting unzulaessig).",
  },
  {
    trifftZu: (cfg) => cfg.safety.skipTwilioSignatureCheck,
    befund:
      "SKIP_TWILIO_SIGNATURE_CHECK=true - /voice-Webhooks bleiben ungeprueft (im Hosting unzulaessig).",
  },
  {
    trifftZu: (cfg) => isInsecureHttpIssuer(cfg.auth.oauthIssuerUrl),
    befund: "OAUTH_ISSUER_URL ist nicht https - SSRF/MITM-Footgun (im Hosting unzulaessig).",
  },
  {
    trifftZu: (cfg) => cfg.store.storeBackend !== "pg",
    befund:
      "STORE_BACKEND ist nicht 'pg' - der json-Store liegt auf Renders fluechtigem Dateisystem (Datenverlust bei jedem Deploy/Neustart). Im Hosting STORE_BACKEND=pg + DATABASE_URL Pflicht.",
  },
  {
    trifftZu: (cfg) =>
      Boolean(cfg.auth.oauthAudience) &&
      fuerAudienceVergleich(cfg.auth.oauthAudience) !== kanonischeAudience(cfg.server.publicUrl),
    befund:
      "OAUTH_AUDIENCE weicht von der kanonischen MCP-Audience (PUBLIC_URL + /mcp) ab - " +
      "Wert leeren (kanonischer Default) oder exakt darauf setzen.",
  },
  {
    trifftZu: (cfg) => !cfg.server.publicUrlExplicit,
    befund:
      "PUBLIC_URL fehlt - der angekuendigte Origin faellt sonst still auf den " +
      "Hosting-Host zurueck. Pflichtform: https://<host>[:<port>], ohne Pfad/Query/Slash " +
      "am Ende, und exakt der Origin der OpenAI-Einreichung (nicht der Hosting-Host): " +
      "ein Origin-Wechsel nach der Publikation verlangt ein neues Plugin.",
  },
  {
    trifftZu: () => process.env.DEV_LOGIN_ENABLED === "true",
    befund: "DEV_LOGIN_ENABLED=true - Login-Shim umgeht WorkOS (im Hosting unzulaessig).",
  },
]);

export function productionFootguns(cfg = config, isProduction = detectProduction()) {
  if (!isProduction) return [];
  return PRODUCTION_FOOTGUNS.filter((footgun) => footgun.trifftZu(cfg)).map(
    (footgun) => footgun.befund,
  );
}

export function productionAuthHints(cfg = config, isProduction = detectProduction()) {
  if (!isProduction) return [];
  if (cfg.auth.mcpAuth === "oauth" || cfg.auth.mcpAuth === "off") return [];
  return [
    "[Sicherheit] MCP_AUTH ist nicht 'oauth' - /mcp laeuft im Hosting mit statischem " +
      "Bearer statt OAuth 2.1; Claude-/ChatGPT-Connectoren erhalten 401 (T-5). Kein " +
      "Boot-Stopp (Hinweis).",
  ];
}

export function isSelfServiceLive(cfg) {
  return Boolean(cfg.tenancy.selfServiceEnabled && cfg.tenancy.multiTenant);
}

const REQUIRED_CONFIG = Object.freeze([
  { fehlt: () => !config.llm.anthropicApiKey, name: "ANTHROPIC_API_KEY" },
  {
    fehlt: () =>
      (config.llm.llmProvider === LLM_PROVIDER.DEEPSEEK ||
        config.llm.llmProviderFallback === LLM_PROVIDER.DEEPSEEK) &&
      !config.llm.deepseekApiKey,
    name: "DEEPSEEK_API_KEY (weil LLM_PROVIDER/LLM_PROVIDER_FALLBACK=deepseek)",
  },
  {
    fehlt: () => !config.server.publicUrl || config.server.publicUrl.includes("CHANGE-ME"),
    name: "PUBLIC_URL",
  },
  {
    fehlt: () => config.auth.mcpAuth === "oauth" && !config.auth.oauthIssuerUrl,
    name: "OAUTH_ISSUER_URL (weil MCP_AUTH=oauth)",
  },
  {
    fehlt: () => config.store.storeBackend === "pg" && !config.store.databaseUrl,
    name: "DATABASE_URL (weil STORE_BACKEND=pg)",
  },
  {
    fehlt: () => config.billing.paymentEnabled && !config.billing.stripeSecretKey,
    name: "STRIPE_SECRET_KEY (weil PAYMENT_ENABLED=true)",
  },
  {
    fehlt: () => config.billing.paymentEnabled && !config.billing.stripeWebhookSecret,
    name: "STRIPE_WEBHOOK_SECRET (weil PAYMENT_ENABLED=true)",
  },
  {
    fehlt: () => config.billing.paymentEnabled && !isPositiveIntegerFee(config.billing.numberSetupFeeCents),
    name: "NUMBER_SETUP_FEE_CENTS (weil PAYMENT_ENABLED=true, muss ganzzahlig > 0 sein)",
  },
  {
    fehlt: () =>
      Boolean(config.server.webDistDir) &&
      !existsSync(path.join(config.server.webDistDir, "index.html")),
    name: "WEB_DIST_DIR-Build (kein index.html im angegebenen Verzeichnis - 'astro build' in apps/web?)",
  },
  {
    fehlt: () =>
      config.voice.elevenLabsInbound.begruessungslautEnabled &&
      !existsSync(path.join(config.server.publicDir, EL_BEGRUESSUNGSLAUT_PFAD)),
    name: `Begruessungslaut-Asset (public${EL_BEGRUESSUNGSLAUT_PFAD} fehlt - node scripts/render-begruessungslaut.mjs)`,
  },
]);

const isPositiveIntegerFee = (cents) => Number.isInteger(cents) && cents > 0;

function fatalConfigFindings(isProduction) {
  const alertChannelConfig = alertChannelInputs({
    billing: config.billing,
    mail: config.mail,
    voice: config.voice,
  });
  return configFatalErrors()
    .concat(productionFootguns(config, isProduction))
    .concat(
      alertChannelFindings(alertChannelConfig)
        .filter((befund) => befund.fatal)
        .map((befund) => befund.message),
    );
}

function reportFatalConfig(missing, fatal) {
  console.error("\n[Konfiguration fatal] Boot wird verweigert:");
  for (const name of missing) console.error(`  - fehlt/ungueltig: ${name}`);
  for (const befund of fatal) console.error(`  - ${befund}`);
  console.error("(.env pruefen; .env.example kopieren: cp .env.example .env)\n");
}

function warnLocalOnlyFootguns() {
  if (config.safety.skipTwilioSignatureCheck)
    console.error(
      "[Sicherheit] SKIP_TWILIO_SIGNATURE_CHECK=true - /voice-Webhooks ungeprueft (nur lokal ok)!",
    );
  if (config.auth.mcpAuth === "off")
    console.error("[Sicherheit] MCP_AUTH=off - /mcp ohne jede Pruefung offen (nur lokale Demos)!");
}

function warnConfigurationHints() {
  if (config.billing.paymentEnabled && !config.provisioning.provisioningEnabled)
    console.error(
      "[Konfiguration] PAYMENT_ENABLED ohne PROVISIONING_ENABLED ist wirkungslos (kein echter Kauf -> kein Capture).",
    );
  if (config.store.storeBackend !== "pg" && config.auth.sessionSecret)
    console.error("[Hinweis] Web-Login braucht STORE_BACKEND=pg (Sessions in der DB).");
  if (isSelfServiceLive(config) && !webLoginInfraReady())
    console.error(
      "[Hinweis] SELF_SERVICE_ENABLED braucht den Web-Login (SESSION_SECRET + STORE_BACKEND=pg) - sonst sind die /api/self-service/*-Routen nicht erreichbar.",
    );
}

const webLoginInfraReady = () =>
  Boolean(config.auth.sessionSecret) && config.store.storeBackend === "pg";

export function assertConfig() {
  const isProduction = detectProduction();
  const missing = REQUIRED_CONFIG.filter((eintrag) => eintrag.fehlt()).map(
    (eintrag) => eintrag.name,
  );
  const fatal = fatalConfigFindings(isProduction);
  if (missing.length || fatal.length) reportFatalConfig(missing, fatal);
  if (!isProduction) warnLocalOnlyFootguns();
  warnConfigurationHints();
  if (!isProduction && isInsecureHttpIssuer(config.auth.oauthIssuerUrl))
    console.error(
      "[Sicherheit] OAUTH_ISSUER_URL ist nicht https - nur fuer lokale Tests zulaessig (SSRF/MITM-Risiko)!",
    );
  for (const hint of productionAuthHints(config, isProduction)) console.error(hint);
  return missing.length === 0 && fatal.length === 0;
}
