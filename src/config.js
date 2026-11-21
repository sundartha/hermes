import dotenv from "dotenv";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { CENTS_PER_EUR, MODEL_PRICE_RATE_FIELDS } from "./begriffe/abrechnung.ts";
import { setWorldDefaultLanguageEnabled } from "./konfiguration/standardsprache.ts";
import {
  EXCHANGE_RATE_DEFAULTS,
  FX_MICRO_PER_UNIT,
  MODEL_PRICE_SCHEDULES,
  preiseMit,
  todayIsoDate,
} from "./konfiguration/preise.ts";
import { gatewayUrlForPort, gatewayUrlMit } from "./konfiguration/gateway-url.ts";
import {
  attachNamespaces,
  buildNamespaceSurface,
  guardedConfig,
} from "./konfiguration/oberflaeche.ts";
import {
  isSelfServiceLive,
  pruefungenProduktionMit,
} from "./konfiguration/pruefungen-produktion.ts";
import { pruefungenStartMit } from "./konfiguration/pruefungen-start.ts";
import { umgebungMit } from "./konfiguration/umgebung.ts";
import { rohwerteAuth } from "./konfiguration/rohwerte-auth.ts";
import { rohwerteBilling } from "./konfiguration/rohwerte-billing.ts";
import { rohwerteLlm } from "./konfiguration/rohwerte-llm.ts";
import { rohwerteMail } from "./konfiguration/rohwerte-mail.ts";
import { rohwerteMetrics } from "./konfiguration/rohwerte-metrics.ts";
import { rohwertePrivacy } from "./konfiguration/rohwerte-privacy.ts";
import { rohwerteResearch } from "./konfiguration/rohwerte-research.ts";
import { rohwerteServer } from "./konfiguration/rohwerte-server.ts";
import { rohwerteProvisioning } from "./konfiguration/rohwerte-provisioning.ts";
import { rohwerteFristen, rohwerteSafety } from "./konfiguration/rohwerte-safety.ts";
import { rohwerteStore } from "./konfiguration/rohwerte-store.ts";
import { rohwerteTelephony } from "./konfiguration/rohwerte-telephony.ts";
import { rohwerteTelnyx } from "./konfiguration/rohwerte-telnyx.ts";
import { rohwerteTenancy } from "./konfiguration/rohwerte-tenancy.ts";
import { rohwerteVoice } from "./konfiguration/rohwerte-voice.ts";
import { rohwerteWerkzeug } from "./konfiguration/rohwerte-werkzeug.ts";
import {
  alertChannelFindings,
  alertChannelInputs,
  fuerAudienceVergleich,
  kanonischeAudience,
} from "./boot-guard.js";
import { DEFAULT_STT_PROFILE } from "./telephony/stt-profile.ts";
import { KOSTENPROFIL } from "./billing/kostenarten.ts";
import { EL_BEGRUESSUNGSLAUT_PFAD } from "./elevenlabs/inbound-rueckfall.ts";
import { LLM_PROVIDER } from "./llm/provider.ts";
import { MS_PER_MINUTE } from "./utils/timer.ts";
import { merkeLogGeheimnisse } from "./log-maske.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (process.env.NODE_ENV !== "test") {
  dotenv.config({ path: path.join(__dirname, "..", ".env") });
}
merkeLogGeheimnisse(process.env);
const env = process.env;

const fatalConfigErrors = [];

const umgebung = umgebungMit(fatalConfigErrors, process.env);
export const {
  numEnv,
  boolEnv,
  enumEnv,
  isoInstantEnv,
  routeCentsEnv,
  csvEnv,
  stripTrailingSlash,
} = umgebung;
const { detectProduction, textEnv } = umgebung;

export const fristenEinstellungen = Object.freeze(rohwerteFristen(process.env, umgebung));
export { alarmEingangFindings } from "./konfiguration/alarm-eingang-pruefung.ts";
export { DEPLOYED_COMMIT_UNKNOWN } from "./konfiguration/rohwerte-server.ts";
export { TELNYX_API_BASE_STANDARD } from "./konfiguration/rohwerte-telephony.ts";
export { ELEVENLABS_API_BASE_STANDARD } from "./konfiguration/rohwerte-voice.ts";

export function configFatalErrors() {
  return fatalConfigErrors.slice();
}


export function eurToCents(eur) {
  return Math.round(eur * CENTS_PER_EUR);
}

export const VOICE_ENGINE = Object.freeze({ BUDGET: "budget" });


export const { resolveModelPrices } = preiseMit(MODEL_PRICE_RATE_FIELDS);
export { todayIsoDate };

const rawConfig = {
  ...rohwerteLlm(process.env, umgebung),
  platformSpendCapCents: eurToCents(
    numEnv("MAX_BUDGET_EUR", env.MAX_BUDGET_EUR, { fallback: 30, min: 0, integer: false }),
  ),

  ...rohwerteResearch(process.env, umgebung),

  ...rohwerteMetrics(process.env, umgebung),

  telemetryOtlpUrl: textEnv(env.METRIKEN_OTLP_URL, "").trim(),
  telemetryOtlpUser: textEnv(env.METRIKEN_OTLP_BENUTZER, "").trim(),
  telemetryOtlpToken: textEnv(env.METRIKEN_OTLP_TOKEN, "").trim(),
  telemetryInstanceId: textEnv(env.RENDER_INSTANCE_ID, os.hostname()).trim(),
  telemetryIntervalMs: numEnv("METRIKEN_INTERVALL_MS", env.METRIKEN_INTERVALL_MS, {
    fallback: MS_PER_MINUTE,
    min: 10,
  }),

  ...rohwerteTelephony(process.env, umgebung),
  ...rohwerteTelnyx(process.env),

  ...rohwerteVoice(process.env, umgebung, DEFAULT_STT_PROFILE),

  elevenLabsInbound: {
    begruessungslautEnabled: boolEnv(
      "ELEVENLABS_INBOUND_BEGRUESSUNGSLAUT_ENABLED",
      env.ELEVENLABS_INBOUND_BEGRUESSUNGSLAUT_ENABLED,
      { fallback: true },
    ),
    sipUser: textEnv(env.ELEVENLABS_INBOUND_SIP_USER, "").trim(),
    sipPassword: textEnv(env.ELEVENLABS_INBOUND_SIP_PASSWORD, "").trim(),
    initWebhookToken: textEnv(env.ELEVENLABS_INIT_WEBHOOK_TOKEN, "").trim(),
  },

  ...rohwerteWerkzeug(process.env),

  ...rohwerteBilling(process.env, umgebung, Object.values(KOSTENPROFIL)),

  ...rohwerteProvisioning(process.env, umgebung),

  ...rohwerteStore(process.env, umgebung),

  ...rohwerteServer(process.env, umgebung, __dirname),

  ...rohwerteSafety(process.env, umgebung),
  ...rohwerteTenancy(process.env, umgebung),
  ...rohwertePrivacy(process.env, umgebung),

  ...rohwerteAuth(process.env, umgebung),

  ...rohwerteMail(process.env, umgebung),

  voiceEngine: VOICE_ENGINE.BUDGET,


  modelPricesUsd: resolveModelPrices(MODEL_PRICE_SCHEDULES, todayIsoDate()),
  usdToEur:
    numEnv("PROVIDER_TO_BUCKET_RATE_MICRO", env.PROVIDER_TO_BUCKET_RATE_MICRO, {
      fallback: Math.round(EXCHANGE_RATE_DEFAULTS.usdToEur * FX_MICRO_PER_UNIT),
      min: 1,
    }) / FX_MICRO_PER_UNIT,
};

export const CONFIG_NAMESPACES = Object.freeze({
  safety: ["outboundFrozen", "allowedCountryCodes", "maxCallsPerHour", "perTargetCallCap", "perTargetWindowMs", "capFarewellLeadMs", "reserveReleaseGraceMs", "budgetWatchdogIntervalMs", "rateLimitPerMin", "serverInstanzen", "csrfEnforce", "mcpAllowedOrigins", "mcpOriginEnforce", "skipTwilioSignatureCheck", "fakeOriginate"],
  billing: ["platformSpendCapCents", "paymentEnabled", "stripeSecretKey", "stripeApiBase", "numberSetupFeeCents", "paymentCurrency", "providerCurrency", "providerToBucketRateMicro", "costTruingDelayMinutes", "costTruingSweepIntervalMs", "costTruingMaxAttempts", "costSettleDeadlineHours", "elEvidenceMinAgeMinutes", "costTruingRequiredRecordTypes", "costTruingMinCoveragePercent", "costTruingCoverageStallSweeps", "kostenHeartbeatFensterH", "costDriftWarnPercent", "costAlertDebounceMs", "costCalibrationMinSamples", "voiceTariffDomesticCents", "voiceTariffDefaultCents", "voiceTariffInboundCents", "voiceTariffFullCostFloorCents", "voiceTariffGrundbetragCentsJeRoute", "voiceTariffDomesticPrefixes", "defaultTenantBudgetCents", "smsCostCents", "platformSpendWarnPercent", "platformAlertSmsTo", "betterstackAlertUrl", "outageAlertWindowMs", "outageAlertMinFailures", "outageAlertMinAttempts", "outageAlertFailSharePercent", "outageAlertDebounceMs", "outageAlertRetryMs", "outageAlertSelfTestIntervalMs", "inboundOutageAlertWindowMs", "inboundOutageAlertMinFailures", "inboundOutageAlertMinAttempts", "inboundOutageAlertFailSharePercent", "platformHoldEscalationMaxAgeMs", "paidWithoutNumberGraceMs", "budgetMonthEnabled", "ttsCharacterQuota", "ttsCharacterQuotaWarnPercent", "ttsQuotaCycleAnchorDay", "platformFixedCostUsdCentsPerMonth", "numberMonthlyCostCents", "stripeStarterPriceId", "stripeBusinessPriceId", "stripeWebhookSecret", "stripeCustomerRetryDelayMs", "flushEpochIso", "priceDriftMinIntervalMs", "priceDriftUnknownEscalateAfter"],
  provisioning: ["maxNumbers", "maxNumbersPerTenant", "provisioningEnabled", "provisioningRedriveMaxAgeMs", "provisioningRetryMaxAttempts", "provisioningRetryMinIntervalMs", "releaseGraceMs", "provisioningCountry", "geoEnabled", "geoDbPath", "worldDefaultLanguageEnabled", "ownerNumberSeed", "ownerNumberProvider", "bootstrapE164", "bootstrapProvider"],
  auth: ["mcpAuthToken", "mcpAuth", "oauthIssuerUrl", "oauthAudience", "sessionSecret", "oidcClientId", "oidcClientSecret", "workosApiBase", "workosManagementApiKey", "adminEmails", "loginRateLimitPerMin", "sessionTtlSeconds", "loginCookieTtlSeconds", "dashboardPassword", "ownerIdpSubject", "devLoginEnabled", "webhookZustellungSecret", "deployToken", "statusToken"],
  mail: ["brevoApiKey", "smtpHost", "smtpPort", "smtpUser", "smtpPassword", "mailFrom", "platformAlertMailTo"],
  llm: ["anthropicApiKey", "llmProvider", "deepseekApiKey", "claudeModel", "llmRequestTimeoutMs", "llmMaxRetries", "llmBackoffMs", "llmBreakerThreshold", "llmBreakerWindowMs", "llmBreakerCooldownMs", "llmProviderFallback", "llmBillingLatchCooldownMs", "modelPricesUsd", "usdToEur", "briefingModel", "briefingTimeoutMs", "summaryTimeoutMs"],
  telnyx: ["telnyxElevenLabs"],
  voice: ["voiceEngine", "elevenLabsPlayTts", "elevenLabsToolToken", "elevenLabsTenantTokenRequired", "elevenLabsOutbound", "elevenLabsInbound", "sttProfile", "sttSpeechTimeoutSec", "callerSubstanceMinLen", "sendSmsSummary", "dailySmsCap", "thinkingSignalEnabled", "toolFollowUpEnabled", "ownerSelfCallEnabled", "ownerSelfCallTenantIds", "inboundOwnerGreetingEnabled", "inboundOwnerGreetingTenantIds"],
  telephony: ["telnyxApiKey", "telnyxPublicKey", "telnyxApiBase", "telnyxConnectionId", "telnyxCallControlAppId", "telnyxAccountSid"],
  tenancy: ["multiTenant", "mcpUiEnabled", "assistantContextEnabled", "selfServiceEnabled", "profilesSeed", "precallBriefingEnabled", "consultEnabled", "inCallConsultEnabled", "consultWaitMs", "consultOpenMs", "elConsultDeliveryMs", "elConsultAckMs", "elConsultAnswerMs"],
  server: ["port", "publicUrl", "publicUrlExplicit", "isProduction", "deployedCommit", "openaiAppsChallengeToken", "dataDir", "publicDir", "webDistDir", "shutdownDrainTimeoutMs", "herzschlagUrl", "herzschlagTaktMs", "herzschlagVerzugGrenzeMs", "herzschlagFristMs"],
  store: ["storeBackend", "databaseUrl", "kennzahlenDatabaseUrl", "queueBackend", "webhookZustellungLoeschtaktMs"],
  metrics: ["metricsEnabled", "logRequestId"],
  telemetry: ["telemetryOtlpUrl", "telemetryOtlpUser", "telemetryOtlpToken", "telemetryInstanceId", "telemetryIntervalMs"],
  privacy: ["retentionDays", "diagnosticRetentionDays", "evidenceRetentionDays"],
  research: ["researchEnabled", "researchMaxUses", "researchSearchFeeCents", "lookupEnabled", "lookupSearchFeeCents", "exaApiKey", "exaApiBase"],
  werkzeug: ["renderApiKey"],
});

export { attachNamespaces, isSelfServiceLive };

export const config = guardedConfig(buildNamespaceSurface(rawConfig, CONFIG_NAMESPACES));

setWorldDefaultLanguageEnabled(rawConfig.worldDefaultLanguageEnabled);

const { setBoundGatewayPort, resolveGatewayUrl } = gatewayUrlMit({
  umgebung: process.env,
  stripTrailingSlash,
  standardPort: () => rawConfig.port,
});
export { gatewayUrlForPort, setBoundGatewayPort, resolveGatewayUrl };

const pruefSicht = () => ({
  auth: rawConfig,
  safety: rawConfig,
  store: rawConfig,
  server: rawConfig,
  tenancy: rawConfig,
  llm: rawConfig,
  billing: rawConfig,
  voice: rawConfig,
  provisioning: rawConfig,
  mail: rawConfig,
});

export const { productionFootguns, productionAuthHints } = pruefungenProduktionMit({
  umgebung: process.env,
  standardConfig: pruefSicht,
  erkenneProduktion: detectProduction,
  fuerAudienceVergleich,
  kanonischeAudience,
});

export const { assertConfig } = pruefungenStartMit({
  standardConfig: pruefSicht,
  fehlerliste: configFatalErrors,
  erkenneProduktion: detectProduction,
  productionFootguns,
  productionAuthHints,
  alertChannelInputs,
  alertChannelFindings,
  llmProvider: LLM_PROVIDER,
  begruessungslautPfad: EL_BEGRUESSUNGSLAUT_PFAD,
});
