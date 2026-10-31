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
import { DEFAULT_INBOUND_EL_SCOPE } from "./elevenlabs/inbound-scope.js";
import { EL_BEGRUESSUNGSLAUT_PFAD } from "./elevenlabs/inbound-rueckfall.js";
import { LLM_PROVIDER } from "./llm/provider.js";
import { MS_PER_HOUR, MS_PER_MINUTE } from "./utils/timer.js";
import { merkeLogGeheimnisse } from "./log-maske.js";
import {
  csvEnv,
  detectProduction,
  stripTrailingSlash,
  umgebungMit,
} from "./konfiguration/umgebung.js";
import { MS_PER_DAY } from "./konfiguration/zeitspannen.js";
import { modellpreiseAufloesen, todayIsoDate } from "./konfiguration/preise.js";
import { gatewayUrlMit } from "./konfiguration/gateway-url.js";
import { buildNamespaceSurface, guardedConfig } from "./konfiguration/oberflaeche.js";
import { researchRohwerte } from "./konfiguration/rohwerte-research.js";
import { metricsRohwerte } from "./konfiguration/rohwerte-metrics.js";
import { telnyxRohwerte } from "./konfiguration/rohwerte-telnyx.js";
import { werkzeugRohwerte } from "./konfiguration/rohwerte-werkzeug.js";
import { storeRohwerte } from "./konfiguration/rohwerte-store.js";
import { privacyRohwerte } from "./konfiguration/rohwerte-privacy.js";
import { mailRohwerte } from "./konfiguration/rohwerte-mail.js";
import { serverRohwerte } from "./konfiguration/rohwerte-server.js";
import { telephonyRohwerte } from "./konfiguration/rohwerte-telephony.js";
import { tenancyRohwerte } from "./konfiguration/rohwerte-tenancy.js";
import { provisioningRohwerte } from "./konfiguration/rohwerte-provisioning.js";
import { authRohwerte } from "./konfiguration/rohwerte-auth.js";
import { llmRohwerte } from "./konfiguration/rohwerte-llm.js";
import { safetyRohwerte } from "./konfiguration/rohwerte-safety.js";
import { voiceRohwerte } from "./konfiguration/rohwerte-voice.js";

export { csvEnv, stripTrailingSlash, todayIsoDate };
export { gatewayUrlForPort } from "./konfiguration/gateway-url.js";
export { attachNamespaces } from "./konfiguration/oberflaeche.js";
export { DEPLOYED_COMMIT_UNKNOWN } from "./konfiguration/rohwerte-server.js";
export { VOICE_ENGINE } from "./konfiguration/rohwerte-voice.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (process.env.NODE_ENV !== "test") {
  dotenv.config({ path: path.join(__dirname, "..", ".env") });
}
merkeLogGeheimnisse(process.env);

const fatalConfigErrors = [];
const umgebung = umgebungMit(fatalConfigErrors, process.env);
export const { numEnv, boolEnv, enumEnv, isoInstantEnv } = umgebung;
const { routeCentsEnv } = umgebung;

const MAX_TIMER_DELAY_MS = 2_147_483_647;

export function configFatalErrors() {
  return fatalConfigErrors.slice();
}

const VOICE_TARIFF_DOMESTIC_PREFIXES = ["+49", "+33", "+44"];

const OUTAGE_ALERT_DEBOUNCE_HOURS_DEFAULT = 6;
const OUTAGE_ALERT_RETRY_MINUTES_DEFAULT = 15;
const INBOUND_OUTAGE_ALERT_WINDOW_HOURS_DEFAULT = 6;
const OUTAGE_ALERT_SELF_TEST_DAYS_DEFAULT = 30;
const PLATFORM_HOLD_ESCALATION_HOURS_DEFAULT = 24;
const PAID_WITHOUT_NUMBER_GRACE_HOURS_DEFAULT = 1;

export function eurToCents(eur) {
  return Math.round(eur * CENTS_PER_EUR);
}

export function resolveModelPrices(schedules, todayIso) {
  return modellpreiseAufloesen(MODEL_PRICE_RATE_FIELDS, schedules, todayIso);
}

const rawConfig = {
  ...llmRohwerte(umgebung, { resolveModelPrices }),
  platformSpendCapCents: eurToCents(
    numEnv("MAX_BUDGET_EUR", process.env.MAX_BUDGET_EUR, { fallback: 30, min: 0, integer: false }),
  ),

  ...researchRohwerte(umgebung),

  ...metricsRohwerte(umgebung),

  ...telnyxRohwerte(umgebung),

  ...voiceRohwerte(umgebung),

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

  ...werkzeugRohwerte(umgebung),

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

  ...provisioningRohwerte(umgebung),

  ...storeRohwerte(umgebung),

  ...serverRohwerte(umgebung, {
    dataDir: process.env.DATA_DIR || path.join(__dirname, "..", "data"),
    publicDir: path.join(__dirname, "..", "public"),
    webDistDir: process.env.WEB_DIST_DIR ? path.resolve(process.env.WEB_DIST_DIR) : "",
  }),

  ...safetyRohwerte(umgebung),

  ...tenancyRohwerte(umgebung),

  ...privacyRohwerte(umgebung),

  ...authRohwerte(umgebung),

  ...mailRohwerte(umgebung),

  ...telephonyRohwerte(umgebung),
};

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

export const config = guardedConfig(buildNamespaceSurface(rawConfig, CONFIG_NAMESPACES));

export const { setBoundGatewayPort, resolveGatewayUrl } = gatewayUrlMit(
  process.env,
  () => config.server.port,
);

setWorldDefaultLanguageEnabled(config.provisioning.worldDefaultLanguageEnabled);

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

export function productionFootguns(cfg = config, isProduction = detectProduction(process.env)) {
  if (!isProduction) return [];
  return PRODUCTION_FOOTGUNS.filter((footgun) => footgun.trifftZu(cfg)).map(
    (footgun) => footgun.befund,
  );
}

export function productionAuthHints(cfg = config, isProduction = detectProduction(process.env)) {
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
  const isProduction = detectProduction(process.env);
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
