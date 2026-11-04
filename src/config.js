import dotenv from "dotenv";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CENTS_PER_EUR, MODEL_PRICE_RATE_FIELDS, setWorldDefaultLanguageEnabled } from "./store/defaults.js";
import { DEFAULT_INBOUND_EL_SCOPE } from "./elevenlabs/inbound-scope.js";
import { EL_BEGRUESSUNGSLAUT_PFAD } from "./elevenlabs/inbound-rueckfall.js";
import { merkeLogGeheimnisse } from "./log-maske.js";
import { csvEnv, stripTrailingSlash, umgebungMit } from "./konfiguration/umgebung.js";
import { modellpreiseAufloesen, todayIsoDate } from "./konfiguration/preise.js";
import { gatewayUrlMit } from "./konfiguration/gateway-url.js";
import { buildNamespaceSurface, guardedConfig } from "./konfiguration/oberflaeche.js";
import { baueRohwerte } from "./konfiguration/rohwerte.js";
import { isSelfServiceLive, pruefungenMit } from "./konfiguration/pruefungen.js";

export { csvEnv, stripTrailingSlash, todayIsoDate };
export { gatewayUrlForPort } from "./konfiguration/gateway-url.js";
export { attachNamespaces } from "./konfiguration/oberflaeche.js";
export { DEPLOYED_COMMIT_UNKNOWN } from "./konfiguration/rohwerte-server.js";
export { VOICE_ENGINE } from "./konfiguration/rohwerte-voice.js";
export { isSelfServiceLive };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
if (process.env.NODE_ENV !== "test") {
  dotenv.config({ path: path.join(__dirname, "..", ".env") });
}
merkeLogGeheimnisse(process.env);

const fatalConfigErrors = [];
const umgebung = umgebungMit(fatalConfigErrors, process.env);
export const { numEnv, boolEnv, enumEnv, isoInstantEnv } = umgebung;

export function configFatalErrors() {
  return fatalConfigErrors.slice();
}

export function eurToCents(eur) {
  return Math.round(eur * CENTS_PER_EUR);
}

export function resolveModelPrices(schedules, todayIso) {
  return modellpreiseAufloesen(MODEL_PRICE_RATE_FIELDS, schedules, todayIso);
}

const rawConfig = {
  ...baueRohwerte(umgebung, {
    eurToCents,
    resolveModelPrices,
    dataDir: process.env.DATA_DIR || path.join(__dirname, "..", "data"),
    publicDir: path.join(__dirname, "..", "public"),
    webDistDir: process.env.WEB_DIST_DIR ? path.resolve(process.env.WEB_DIST_DIR) : "",
  }),
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
};

export const CONFIG_NAMESPACES = Object.freeze({
  safety: ["outboundFrozen", "allowedCountryCodes", "maxCallsPerHour", "perTargetCallCap", "perTargetWindowMs", "capFarewellLeadMs", "reserveReleaseGraceMs", "budgetWatchdogIntervalMs", "rateLimitPerMin", "csrfEnforce", "mcpAllowedOrigins", "mcpOriginEnforce", "skipTwilioSignatureCheck", "fakeOriginate", "fakeOriginateElevenlabs", "outboundAniGateEnabled", "outboundAniGateMaxAgeMs"],
  billing: ["platformSpendCapCents", "paymentEnabled", "stripeSecretKey", "stripeApiBase", "numberSetupFeeCents", "paymentCurrency", "providerCurrency", "providerToBucketRateMicro", "costTruingDelayMinutes", "costTruingSweepIntervalMs", "costTruingMaxAttempts", "costSettleDeadlineHours", "elEvidenceMinAgeMinutes", "costTruingRequiredRecordTypes", "costTruingMinCoveragePercent", "costTruingCoverageStallSweeps", "kostenHeartbeatFensterH", "costDriftWarnPercent", "costAlertDebounceMs", "costCalibrationMinSamples", "voiceTariffDomesticCents", "voiceTariffDefaultCents", "voiceTariffInboundCents", "voiceTariffFullCostFloorCents", "voiceTariffGrundbetragCentsJeRoute", "voiceTariffDomesticPrefixes", "defaultTenantBudgetCents", "smsCostCents", "platformSpendWarnPercent", "platformAlertSmsTo", "outageAlertWindowMs", "outageAlertMinFailures", "outageAlertMinAttempts", "outageAlertFailSharePercent", "outageAlertDebounceMs", "outageAlertRetryMs", "outageAlertSelfTestIntervalMs", "inboundOutageAlertWindowMs", "inboundOutageAlertMinFailures", "inboundOutageAlertMinAttempts", "inboundOutageAlertFailSharePercent", "platformHoldEscalationMaxAgeMs", "paidWithoutNumberGraceMs", "budgetMonthEnabled", "ttsCharacterQuota", "ttsCharacterQuotaWarnPercent", "ttsQuotaCycleAnchorDay", "platformFixedCostUsdCentsPerMonth", "numberMonthlyCostCents", "stripeStarterPriceId", "stripeBusinessPriceId", "stripeWebhookSecret", "stripeCustomerRetryDelayMs", "flushEpochIso", "priceDriftMinIntervalMs", "priceDriftUnknownEscalateAfter"],
  provisioning: ["maxNumbers", "maxNumbersPerTenant", "provisioningEnabled", "provisioningRedriveMaxAgeMs", "provisioningRetryMaxAttempts", "provisioningRetryMinIntervalMs", "releaseGraceMs", "provisioningCountry", "forceNumberCountry", "geoEnabled", "geoDbPath", "worldDefaultLanguageEnabled", "ownerNumberSeed", "ownerNumberProvider", "bootstrapE164", "bootstrapProvider", "platformAniE164"],
  auth: ["mcpAuthToken", "mcpAuth", "oauthIssuerUrl", "oauthAudience", "sessionSecret", "oidcClientId", "oidcClientSecret", "workosApiBase", "workosManagementApiKey", "adminEmails", "loginRateLimitPerMin", "sessionTtlSeconds", "loginCookieTtlSeconds", "dashboardPassword", "ownerIdpSubject", "devLoginEnabled", "callConfirmationSecret", "deployToken", "statusToken"],
  mail: ["brevoApiKey", "smtpHost", "smtpPort", "smtpUser", "smtpPassword", "mailFrom", "platformAlertMailTo"],
  llm: ["anthropicApiKey", "llmProvider", "deepseekApiKey", "claudeModel", "llmRequestTimeoutMs", "llmMaxRetries", "llmBackoffMs", "llmBreakerThreshold", "llmBreakerWindowMs", "llmBreakerCooldownMs", "llmProviderFallback", "llmBillingLatchCooldownMs", "modelPricesUsd", "usdToEur", "briefingModel", "briefingTimeoutMs", "summaryTimeoutMs"],
  telnyx: ["telnyxElevenLabs"],
  voice: ["voiceEngine", "elevenLabsPlayTts", "elevenLabsToolToken", "elevenLabsTenantTokenRequired", "elevenLabsOutbound", "elevenLabsInbound", "sttProfile", "sttSpeechTimeoutSec", "maxEmptyTurns", "callerSubstanceMinLen", "sendSmsSummary", "dailySmsCap", "thinkingSignalEnabled", "toolFollowUpEnabled", "ownerSelfCallEnabled", "ownerSelfCallTenantIds", "inboundOwnerGreetingEnabled", "inboundOwnerGreetingTenantIds"],
  telephony: ["telnyxApiKey", "telnyxPublicKey", "telnyxApiBase", "telnyxConnectionId", "telnyxAccountSid", "machineDetection", "telnyxSipTrunkUsername", "telnyxSipTrunkPassword"],
  tenancy: ["multiTenant", "mcpUiEnabled", "assistantContextEnabled", "selfServiceEnabled", "profilesSeed", "precallBriefingEnabled", "consultEnabled", "inCallConsultEnabled", "consultWaitMs", "consultOpenMs", "elConsultDeliveryMs", "elConsultAckMs", "elConsultAnswerMs"],
  server: ["port", "publicUrl", "publicUrlExplicit", "isProduction", "deployedCommit", "openaiAppsChallengeToken", "dataDir", "publicDir", "webDistDir", "shutdownDrainTimeoutMs"],
  store: ["storeBackend", "databaseUrl", "queueBackend"],
  metrics: ["metricsEnabled", "logRequestId"],
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

const PFAD_PRUEFUNGEN = Object.freeze([
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

const pruefungen = pruefungenMit(
  config,
  { fehlerliste: fatalConfigErrors, pfadPruefungen: PFAD_PRUEFUNGEN },
  process.env,
);
export const { productionFootguns, productionAuthHints, assertConfig } = pruefungen;
