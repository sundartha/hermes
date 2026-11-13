import dotenv from "dotenv";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { CENTS_PER_EUR, MODEL_PRICE_RATE_FIELDS } from "./begriffe/abrechnung.js";
import { setWorldDefaultLanguageEnabled } from "./konfiguration/standardsprache.js";
import {
  EXCHANGE_RATE_DEFAULTS,
  FX_MICRO_PER_UNIT,
  MODEL_PRICE_SCHEDULES,
  preiseMit,
  todayIsoDate,
} from "./konfiguration/preise.js";
import { gatewayUrlForPort, gatewayUrlMit } from "./konfiguration/gateway-url.js";
import {
  attachNamespaces,
  buildNamespaceSurface,
  guardedConfig,
} from "./konfiguration/oberflaeche.js";
import {
  isSelfServiceLive,
  pruefungenProduktionMit,
} from "./konfiguration/pruefungen-produktion.js";
import { pruefungenStartMit } from "./konfiguration/pruefungen-start.js";
import { umgebungMit } from "./konfiguration/umgebung.js";
import { rohwerteAuth } from "./konfiguration/rohwerte-auth.js";
import { rohwerteBilling } from "./konfiguration/rohwerte-billing.js";
import { rohwerteLlm } from "./konfiguration/rohwerte-llm.js";
import { rohwerteMail } from "./konfiguration/rohwerte-mail.js";
import { rohwerteMetrics } from "./konfiguration/rohwerte-metrics.js";
import { rohwertePrivacy } from "./konfiguration/rohwerte-privacy.js";
import { rohwerteResearch } from "./konfiguration/rohwerte-research.js";
import { rohwerteServer } from "./konfiguration/rohwerte-server.js";
import { rohwerteProvisioning } from "./konfiguration/rohwerte-provisioning.js";
import { rohwerteSafety } from "./konfiguration/rohwerte-safety.js";
import { rohwerteStore } from "./konfiguration/rohwerte-store.js";
import { rohwerteTelephony } from "./konfiguration/rohwerte-telephony.js";
import { rohwerteTelnyx } from "./konfiguration/rohwerte-telnyx.js";
import { rohwerteTenancy } from "./konfiguration/rohwerte-tenancy.js";
import { rohwerteVoice } from "./konfiguration/rohwerte-voice.js";
import { rohwerteWerkzeug } from "./konfiguration/rohwerte-werkzeug.js";
import {
  alertChannelFindings,
  alertChannelInputs,
  fuerAudienceVergleich,
  kanonischeAudience,
} from "./boot-guard.js";
import { DEFAULT_STT_PROFILE } from "./telephony/stt-profile.js";
import { KOSTENPROFIL } from "./billing/kostenarten.js";
import { DEFAULT_INBOUND_EL_SCOPE } from "./elevenlabs/inbound-scope.js";
import { EL_BEGRUESSUNGSLAUT_PFAD } from "./elevenlabs/inbound-rueckfall.js";
import { LLM_PROVIDER } from "./llm/provider.js";
import { MS_PER_MINUTE } from "./utils/timer.js";
import { merkeLogGeheimnisse } from "./log-maske.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (process.env.NODE_ENV !== "test") {
  dotenv.config({ path: path.join(__dirname, "..", ".env") });
}
merkeLogGeheimnisse(process.env);

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
const { detectProduction } = umgebung;

export { DEPLOYED_COMMIT_UNKNOWN } from "./konfiguration/rohwerte-server.js";

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
    numEnv("MAX_BUDGET_EUR", process.env.MAX_BUDGET_EUR, { fallback: 30, min: 0, integer: false }),
  ),

  ...rohwerteResearch(process.env, umgebung),

  ...rohwerteMetrics(process.env, umgebung),

  telemetryOtlpUrl: (process.env.METRIKEN_OTLP_URL || "").trim(),
  telemetryOtlpUser: (process.env.METRIKEN_OTLP_BENUTZER || "").trim(),
  telemetryOtlpToken: (process.env.METRIKEN_OTLP_TOKEN || "").trim(),
  telemetryInstanceId: (process.env.RENDER_INSTANCE_ID || os.hostname()).trim(),
  telemetryIntervalMs: numEnv("METRIKEN_INTERVALL_MS", process.env.METRIKEN_INTERVALL_MS, {
    fallback: MS_PER_MINUTE,
    min: 10,
  }),

  ...rohwerteTelephony(process.env, umgebung),
  ...rohwerteTelnyx(process.env),

  ...rohwerteVoice(process.env, umgebung, DEFAULT_STT_PROFILE),

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
    numEnv("PROVIDER_TO_BUCKET_RATE_MICRO", process.env.PROVIDER_TO_BUCKET_RATE_MICRO, {
      fallback: Math.round(EXCHANGE_RATE_DEFAULTS.usdToEur * FX_MICRO_PER_UNIT),
      min: 1,
    }) / FX_MICRO_PER_UNIT,
};

export const CONFIG_NAMESPACES = Object.freeze({
  safety: ["outboundFrozen", "allowedCountryCodes", "maxCallsPerHour", "perTargetCallCap", "perTargetWindowMs", "capFarewellLeadMs", "reserveReleaseGraceMs", "budgetWatchdogIntervalMs", "rateLimitPerMin", "serverInstanzen", "csrfEnforce", "mcpAllowedOrigins", "mcpOriginEnforce", "skipTwilioSignatureCheck", "fakeOriginate", "fakeOriginateElevenlabs", "outboundAniGateEnabled", "outboundAniGateMaxAgeMs"],
  billing: ["platformSpendCapCents", "paymentEnabled", "stripeSecretKey", "stripeApiBase", "numberSetupFeeCents", "paymentCurrency", "providerCurrency", "providerToBucketRateMicro", "costTruingDelayMinutes", "costTruingSweepIntervalMs", "costTruingMaxAttempts", "costSettleDeadlineHours", "elEvidenceMinAgeMinutes", "costTruingRequiredRecordTypes", "costTruingMinCoveragePercent", "costTruingCoverageStallSweeps", "kostenHeartbeatFensterH", "costDriftWarnPercent", "costAlertDebounceMs", "costCalibrationMinSamples", "voiceTariffDomesticCents", "voiceTariffDefaultCents", "voiceTariffInboundCents", "voiceTariffFullCostFloorCents", "voiceTariffGrundbetragCentsJeRoute", "voiceTariffDomesticPrefixes", "defaultTenantBudgetCents", "smsCostCents", "platformSpendWarnPercent", "platformAlertSmsTo", "outageAlertWindowMs", "outageAlertMinFailures", "outageAlertMinAttempts", "outageAlertFailSharePercent", "outageAlertDebounceMs", "outageAlertRetryMs", "outageAlertSelfTestIntervalMs", "inboundOutageAlertWindowMs", "inboundOutageAlertMinFailures", "inboundOutageAlertMinAttempts", "inboundOutageAlertFailSharePercent", "platformHoldEscalationMaxAgeMs", "paidWithoutNumberGraceMs", "budgetMonthEnabled", "ttsCharacterQuota", "ttsCharacterQuotaWarnPercent", "ttsQuotaCycleAnchorDay", "platformFixedCostUsdCentsPerMonth", "numberMonthlyCostCents", "stripeStarterPriceId", "stripeBusinessPriceId", "stripeWebhookSecret", "stripeCustomerRetryDelayMs", "flushEpochIso", "priceDriftMinIntervalMs", "priceDriftUnknownEscalateAfter"],
  provisioning: ["maxNumbers", "maxNumbersPerTenant", "provisioningEnabled", "provisioningRedriveMaxAgeMs", "provisioningRetryMaxAttempts", "provisioningRetryMinIntervalMs", "releaseGraceMs", "provisioningCountry", "geoEnabled", "geoDbPath", "worldDefaultLanguageEnabled", "ownerNumberSeed", "ownerNumberProvider", "bootstrapE164", "bootstrapProvider", "platformAniE164"],
  auth: ["mcpAuthToken", "mcpAuth", "oauthIssuerUrl", "oauthAudience", "sessionSecret", "oidcClientId", "oidcClientSecret", "workosApiBase", "workosManagementApiKey", "adminEmails", "loginRateLimitPerMin", "sessionTtlSeconds", "loginCookieTtlSeconds", "dashboardPassword", "ownerIdpSubject", "devLoginEnabled", "webhookZustellungSecret", "deployToken", "statusToken"],
  mail: ["brevoApiKey", "smtpHost", "smtpPort", "smtpUser", "smtpPassword", "mailFrom", "platformAlertMailTo"],
  llm: ["anthropicApiKey", "llmProvider", "deepseekApiKey", "claudeModel", "llmRequestTimeoutMs", "llmMaxRetries", "llmBackoffMs", "llmBreakerThreshold", "llmBreakerWindowMs", "llmBreakerCooldownMs", "llmProviderFallback", "llmBillingLatchCooldownMs", "modelPricesUsd", "usdToEur", "briefingModel", "briefingTimeoutMs", "summaryTimeoutMs"],
  telnyx: ["telnyxElevenLabs"],
  voice: ["voiceEngine", "elevenLabsPlayTts", "elevenLabsToolToken", "elevenLabsTenantTokenRequired", "elevenLabsOutbound", "elevenLabsInbound", "sttProfile", "sttSpeechTimeoutSec", "maxEmptyTurns", "callerSubstanceMinLen", "sendSmsSummary", "dailySmsCap", "thinkingSignalEnabled", "toolFollowUpEnabled", "ownerSelfCallEnabled", "ownerSelfCallTenantIds", "inboundOwnerGreetingEnabled", "inboundOwnerGreetingTenantIds"],
  telephony: ["telnyxApiKey", "telnyxPublicKey", "telnyxApiBase", "telnyxConnectionId", "telnyxCallControlAppId", "telnyxAccountSid", "machineDetection", "telnyxSipTrunkUsername", "telnyxSipTrunkPassword"],
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

setWorldDefaultLanguageEnabled(config.provisioning.worldDefaultLanguageEnabled);

const { setBoundGatewayPort, resolveGatewayUrl } = gatewayUrlMit({
  umgebung: process.env,
  stripTrailingSlash,
  standardPort: () => config.server.port,
});
export { gatewayUrlForPort, setBoundGatewayPort, resolveGatewayUrl };

export const { productionFootguns, productionAuthHints } = pruefungenProduktionMit({
  umgebung: process.env,
  standardConfig: () => config,
  erkenneProduktion: detectProduction,
  fuerAudienceVergleich,
  kanonischeAudience,
});

export const { assertConfig } = pruefungenStartMit({
  standardConfig: () => config,
  fehlerliste: configFatalErrors,
  erkenneProduktion: detectProduction,
  productionFootguns,
  productionAuthHints,
  alertChannelInputs,
  alertChannelFindings,
  llmProvider: LLM_PROVIDER,
  begruessungslautPfad: EL_BEGRUESSUNGSLAUT_PFAD,
});
