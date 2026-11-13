import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONFIG_NAMESPACES,
  config,
  gatewayUrlForPort,
  isSelfServiceLive,
  resolveGatewayUrl,
} from "../../src/config.js";
import { makeConfigOverrides } from "../helpers.js";

const { withConfigOverrides } = makeConfigOverrides(config);

const PINNED_NAMES = `
auth.adminEmails
auth.dashboardPassword
auth.deployToken
auth.devLoginEnabled
auth.loginCookieTtlSeconds
auth.loginRateLimitPerMin
auth.mcpAuth
auth.mcpAuthToken
auth.oauthAudience
auth.oauthIssuerUrl
auth.oidcClientId
auth.oidcClientSecret
auth.ownerIdpSubject
auth.sessionSecret
auth.sessionTtlSeconds
auth.statusToken
auth.webhookZustellungSecret
auth.workosApiBase
auth.workosManagementApiKey
billing.budgetMonthEnabled
billing.costAlertDebounceMs
billing.costCalibrationMinSamples
billing.costDriftWarnPercent
billing.costSettleDeadlineHours
billing.costTruingCoverageStallSweeps
billing.costTruingDelayMinutes
billing.costTruingMaxAttempts
billing.costTruingMinCoveragePercent
billing.costTruingRequiredRecordTypes
billing.costTruingSweepIntervalMs
billing.defaultTenantBudgetCents
billing.elEvidenceMinAgeMinutes
billing.flushEpochIso
billing.inboundOutageAlertFailSharePercent
billing.inboundOutageAlertMinAttempts
billing.inboundOutageAlertMinFailures
billing.inboundOutageAlertWindowMs
billing.kostenHeartbeatFensterH
billing.numberMonthlyCostCents
billing.numberSetupFeeCents
billing.outageAlertDebounceMs
billing.outageAlertFailSharePercent
billing.outageAlertMinAttempts
billing.outageAlertMinFailures
billing.outageAlertRetryMs
billing.outageAlertSelfTestIntervalMs
billing.outageAlertWindowMs
billing.paidWithoutNumberGraceMs
billing.paymentCurrency
billing.paymentEnabled
billing.platformAlertSmsTo
billing.platformFixedCostUsdCentsPerMonth
billing.platformHoldEscalationMaxAgeMs
billing.platformSpendCapCents
billing.platformSpendWarnPercent
billing.priceDriftMinIntervalMs
billing.priceDriftUnknownEscalateAfter
billing.providerCurrency
billing.providerToBucketRateMicro
billing.smsCostCents
billing.stripeApiBase
billing.stripeBusinessPriceId
billing.stripeCustomerRetryDelayMs
billing.stripeSecretKey
billing.stripeStarterPriceId
billing.stripeWebhookSecret
billing.ttsCharacterQuota
billing.ttsCharacterQuotaWarnPercent
billing.ttsQuotaCycleAnchorDay
billing.voiceTariffDefaultCents
billing.voiceTariffDomesticCents
billing.voiceTariffDomesticPrefixes
billing.voiceTariffFullCostFloorCents
billing.voiceTariffGrundbetragCentsJeRoute
billing.voiceTariffInboundCents
llm.anthropicApiKey
llm.briefingModel
llm.briefingTimeoutMs
llm.claudeModel
llm.deepseekApiKey
llm.llmBackoffMs
llm.llmBillingLatchCooldownMs
llm.llmBreakerCooldownMs
llm.llmBreakerThreshold
llm.llmBreakerWindowMs
llm.llmMaxRetries
llm.llmProvider
llm.llmProviderFallback
llm.llmRequestTimeoutMs
llm.modelPricesUsd
llm.summaryTimeoutMs
llm.usdToEur
mail.brevoApiKey
mail.mailFrom
mail.platformAlertMailTo
mail.smtpHost
mail.smtpPassword
mail.smtpPort
mail.smtpUser
metrics.logRequestId
metrics.metricsEnabled
privacy.diagnosticRetentionDays
privacy.evidenceRetentionDays
privacy.retentionDays
provisioning.bootstrapE164
provisioning.bootstrapProvider
provisioning.geoDbPath
provisioning.geoEnabled
provisioning.maxNumbers
provisioning.maxNumbersPerTenant
provisioning.ownerNumberProvider
provisioning.ownerNumberSeed
provisioning.platformAniE164
provisioning.provisioningCountry
provisioning.provisioningEnabled
provisioning.provisioningRedriveMaxAgeMs
provisioning.provisioningRetryMaxAttempts
provisioning.provisioningRetryMinIntervalMs
provisioning.releaseGraceMs
provisioning.worldDefaultLanguageEnabled
research.exaApiBase
research.exaApiKey
research.lookupEnabled
research.lookupSearchFeeCents
research.researchEnabled
research.researchMaxUses
research.researchSearchFeeCents
safety.allowedCountryCodes
safety.budgetWatchdogIntervalMs
safety.capFarewellLeadMs
safety.csrfEnforce
safety.fakeOriginate
safety.fakeOriginateElevenlabs
safety.maxCallsPerHour
safety.mcpAllowedOrigins
safety.mcpOriginEnforce
safety.outboundAniGateEnabled
safety.outboundAniGateMaxAgeMs
safety.outboundFrozen
safety.perTargetCallCap
safety.perTargetWindowMs
safety.rateLimitPerMin
safety.serverInstanzen
safety.reserveReleaseGraceMs
safety.skipTwilioSignatureCheck
server.dataDir
server.deployedCommit
server.herzschlagFristMs
server.herzschlagTaktMs
server.herzschlagUrl
server.herzschlagVerzugGrenzeMs
server.isProduction
server.openaiAppsChallengeToken
server.port
server.publicDir
server.publicUrl
server.publicUrlExplicit
server.shutdownDrainTimeoutMs
server.webDistDir
store.databaseUrl
store.kennzahlenDatabaseUrl
store.queueBackend
store.storeBackend
store.webhookZustellungLoeschtaktMs
telemetry.telemetryInstanceId
telemetry.telemetryIntervalMs
telemetry.telemetryOtlpToken
telemetry.telemetryOtlpUrl
telemetry.telemetryOtlpUser
telephony.machineDetection
telephony.telnyxAccountSid
telephony.telnyxApiBase
telephony.telnyxApiKey
telephony.telnyxConnectionId
telephony.telnyxCallControlAppId
telephony.telnyxPublicKey
telephony.telnyxSipTrunkPassword
telephony.telnyxSipTrunkUsername
telnyx.telnyxElevenLabs
tenancy.assistantContextEnabled
tenancy.consultEnabled
tenancy.consultOpenMs
tenancy.consultWaitMs
tenancy.elConsultAckMs
tenancy.elConsultAnswerMs
tenancy.elConsultDeliveryMs
tenancy.inCallConsultEnabled
tenancy.mcpUiEnabled
tenancy.multiTenant
tenancy.precallBriefingEnabled
tenancy.profilesSeed
tenancy.selfServiceEnabled
voice.callerSubstanceMinLen
voice.dailySmsCap
voice.elevenLabsInbound
voice.elevenLabsOutbound
voice.elevenLabsPlayTts
voice.elevenLabsTenantTokenRequired
voice.elevenLabsToolToken
voice.inboundOwnerGreetingEnabled
voice.inboundOwnerGreetingTenantIds
voice.maxEmptyTurns
voice.ownerSelfCallEnabled
voice.ownerSelfCallTenantIds
voice.sendSmsSummary
voice.sttProfile
voice.sttSpeechTimeoutSec
voice.thinkingSignalEnabled
voice.toolFollowUpEnabled
voice.voiceEngine
werkzeug.renderApiKey
`;

const PINNED_NON_PRIMITIVE_NAMES = `
auth.adminEmails
billing.costTruingRequiredRecordTypes
billing.voiceTariffDomesticPrefixes
billing.voiceTariffGrundbetragCentsJeRoute
llm.modelPricesUsd
safety.allowedCountryCodes
safety.mcpAllowedOrigins
telephony.machineDetection
telnyx.telnyxElevenLabs
voice.elevenLabsInbound
voice.elevenLabsOutbound
voice.elevenLabsPlayTts
voice.inboundOwnerGreetingTenantIds
voice.ownerSelfCallTenantIds
`;

function nameLines(text) {
  return text.split("\n").filter(Boolean);
}

function pinnedNamesByNamespace() {
  const byNamespace = {};
  for (const name of nameLines(PINNED_NAMES)) {
    const [namespace, key] = name.split(".");
    (byNamespace[namespace] ??= []).push(key);
  }
  return byNamespace;
}

test("Struktur: CONFIG_NAMESPACES hat genau die gepinnten Counts und disjunkte Blaetter", () => {
  const pinned = pinnedNamesByNamespace();
  assert.deepEqual(Object.keys(CONFIG_NAMESPACES).sort(), Object.keys(pinned).sort());
  for (const [namespace, keys] of Object.entries(pinned)) {
    const actual = CONFIG_NAMESPACES[namespace];
    const unpinned = actual.filter((key) => !keys.includes(key));
    const missing = keys.filter((key) => !actual.includes(key));
    assert.deepEqual(
      [...actual].sort(),
      keys.sort(),
      `Namespace ${namespace}: nicht gepinnt: [${unpinned}], gepinnt aber nicht mehr da: [${missing}]`,
    );
  }
  const pinnedTotal = nameLines(PINNED_NAMES).length;
  const allNamespacedKeys = Object.values(CONFIG_NAMESPACES).flat();
  assert.equal(allNamespacedKeys.length, pinnedTotal, "Summe aller Namespace-Counts");
  assert.equal(
    new Set(allNamespacedKeys).size,
    pinnedTotal,
    "kein Key darf in zwei Namespaces gleichzeitig stehen",
  );
  assert.equal(new Set(nameLines(PINNED_NAMES)).size, pinnedTotal, "gepinnte Namen sind eindeutig");
});

test("Oberflaeche: config traegt GENAU die gepinnten Namespaces (enumerable UND ueber 'in' erreichbar), kein flacher Key mehr", () => {
  assert.equal(new Set(Object.keys(config)).size, Object.keys(CONFIG_NAMESPACES).length);
  assert.deepEqual(Object.keys(config).sort(), Object.keys(CONFIG_NAMESPACES).sort());
  for (const namespace of Object.keys(CONFIG_NAMESPACES)) {
    assert.ok(namespace in config, `${namespace} muss ueber 'in' erreichbar sein`);
  }
});

const NUMERIC_SENTINEL_OFFSET = 12345;

function sentinelFor(currentValue) {
  if (typeof currentValue === "boolean") return !currentValue;
  if (typeof currentValue === "number") return currentValue + NUMERIC_SENTINEL_OFFSET;
  return "__pa12_override_sentinel__";
}

test("Setter-Durchschlag: ein Override ueber config.<ns>.<key> trifft fuer JEDES primitive Blatt denselben Speicher-Slot", () => {
  let checked = 0;
  const skipped = [];
  for (const [namespace, keys] of Object.entries(CONFIG_NAMESPACES)) {
    for (const key of keys) {
      const currentValue = config[namespace][key];
      if (currentValue && typeof currentValue === "object") {
        skipped.push(`${namespace}.${key}`);
        continue;
      }
      checked += 1;
      const sentinel = sentinelFor(currentValue);
      withConfigOverrides({ [key]: sentinel }, () => {
        assert.strictEqual(
          config[namespace][key],
          sentinel,
          `${namespace}.${key} muss den Override live sehen (kein Wert-Kopie-Getter)`,
        );
      });
      assert.strictEqual(config[namespace][key], currentValue, `${namespace}.${key} restauriert`);
    }
  }
  assert.deepEqual(
    skipped.sort(),
    nameLines(PINNED_NON_PRIMITIVE_NAMES).sort(),
    "genau die gepinnten Arrays und Objekte sind keine primitiven Blaetter",
  );
  assert.equal(
    checked,
    nameLines(PINNED_NAMES).length - skipped.length,
    "alle primitiven Blaetter (alle gepinnten Namen ohne Arrays und Objekte) geprueft",
  );
});

test("No-double-eval: ein ungueltiger numerischer Env-Wert erzeugt genau EINEN Fatal-Befund, auch nach voller Namespace-Traversierung", async () => {
  const saved = process.env.MAX_CALLS_PER_HOUR;
  process.env.MAX_CALLS_PER_HOUR = "120abc";
  try {
    const fresh = await import("../../src/config.js?pa12-nodbl");
    const before = fresh.configFatalErrors().length;
    for (const [namespace, keys] of Object.entries(fresh.CONFIG_NAMESPACES)) {
      for (const key of keys) void fresh.config[namespace][key];
    }
    JSON.stringify(fresh.config);
    const after = fresh.configFatalErrors().length;
    assert.equal(after, before, "keine zusaetzlichen Fatal-Befunde durch den Namespace-Zugriff");
    assert.ok(
      fresh.configFatalErrors().some((msg) => msg.includes("MAX_CALLS_PER_HOUR")),
      "der urspruengliche Fatal-Befund muss weiter vorhanden sein",
    );
  } finally {
    if (saved === undefined) delete process.env.MAX_CALLS_PER_HOUR;
    else process.env.MAX_CALLS_PER_HOUR = saved;
  }
});

test("Duck-Typing + Guard: JSON.stringify/await funktionieren auf den Namespace-Gruppen, unbekannte Keys werfen weiter", async () => {
  assert.doesNotThrow(() => JSON.stringify(config.safety));
  assert.deepEqual(JSON.parse(JSON.stringify(config.safety)), config.safety);

  const awaited = await config.safety;
  assert.equal(awaited.maxCallsPerHour, config.safety.maxCallsPerHour);

  assert.throws(() => config.safety.nope, TypeError);

  assert.equal(typeof config.voice.elevenLabsPlayTts.model, "string");
  assert.throws(() => config.voice.elevenLabsPlayTts.nope, TypeError);
});

test("Flip-Regression: entfernte flache Keys werfen TypeError bei Read UND Write", () => {
  const removedFlatKeys = [
    "platformSpendCapCents",
    "maxCallsPerHour",
    "mcpAuth",
    "storeBackend",
    "telnyxElevenLabs",
    "telnyxAssistant",
    "elevenLabsPlayTts",
    "anthropicApiKey",
  ];
  for (const key of removedFlatKeys) {
    assert.throws(() => config[key], TypeError, `config.${key} (Read) sollte nicht mehr existieren`);
    assert.throws(
      () => {
        config[key] = "x";
      },
      TypeError,
      `config.${key} = ... (Write) sollte nicht mehr moeglich sein`,
    );
  }
});

const MONEY_CONFIG_KEYS = Object.freeze([
  "platformSpendCapCents",
  "numberSetupFeeCents",
  "voiceTariffDomesticCents",
  "voiceTariffDefaultCents",
  "voiceTariffInboundCents",
  "voiceTariffFullCostFloorCents",
  "defaultTenantBudgetCents",
  "smsCostCents",
  "usdToEur",
  "modelPricesUsd",
  "numberMonthlyCostCents",
  "platformFixedCostUsdCentsPerMonth",
  "voiceTariffGrundbetragCentsJeRoute",
  "researchSearchFeeCents",
  "lookupSearchFeeCents",
]);

const MONEY_NAME_PATTERN = /(Cents|Eur|Usd)$/;

test("Geld-Manifest: jedes Cents-/Eur-/Usd-Feld in config.js ist im Manifest erfasst", () => {
  const allNamespacedKeys = Object.values(CONFIG_NAMESPACES).flat();
  const moneyShapedKeys = allNamespacedKeys.filter((k) => MONEY_NAME_PATTERN.test(k));
  const unregistered = moneyShapedKeys.filter((k) => !MONEY_CONFIG_KEYS.includes(k));
  assert.deepEqual(
    unregistered,
    [],
    `Neues Geld-Feld in config.js nicht im Manifest eingetragen: ${unregistered.join(", ")}. ` +
      `Bewusst in MONEY_CONFIG_KEYS (test/gemeinsam/konfiguration-oberflaeche.test.js) aufnehmen.`,
  );
});

test("Geld-Manifest: kein gelistetes Feld wurde stillschweigend aus config.js entfernt", () => {
  const allNamespacedKeys = Object.values(CONFIG_NAMESPACES).flat();
  const missing = MONEY_CONFIG_KEYS.filter((k) => !allNamespacedKeys.includes(k));
  assert.deepEqual(
    missing,
    [],
    `Manifest-Feld existiert nicht mehr in config.js: ${missing.join(", ")}. Manifest nachziehen.`,
  );
});

const BEISPIEL_PORT = 3000;

test("gatewayUrlForPort baut die localhost-Fallback-URL", () => {
  assert.equal(gatewayUrlForPort(BEISPIEL_PORT), "http://localhost:3000");
  assert.equal(gatewayUrlForPort(0), "http://localhost:0");
});

test("resolveGatewayUrl: ohne GATEWAY_URL -> Fallback auf den config-Port", () => {
  const prev = process.env.GATEWAY_URL;
  try {
    delete process.env.GATEWAY_URL;
    assert.equal(resolveGatewayUrl(), gatewayUrlForPort(config.server.port));
  } finally {
    if (prev === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = prev;
  }
});

test("resolveGatewayUrl: mit GATEWAY_URL -> genau dieser Wert, Trailing-Slash gestrippt", () => {
  const prev = process.env.GATEWAY_URL;
  try {
    process.env.GATEWAY_URL = "https://hermes.example.test/";
    assert.equal(resolveGatewayUrl(), "https://hermes.example.test");
    process.env.GATEWAY_URL = "https://hermes.example.test";
    assert.equal(resolveGatewayUrl(), "https://hermes.example.test");
  } finally {
    if (prev === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = prev;
  }
});

test("isSelfServiceLive: beide Flags an -> true", () => {
  assert.equal(isSelfServiceLive({ tenancy: { selfServiceEnabled: true, multiTenant: true } }), true);
});

test("isSelfServiceLive: nur selfServiceEnabled an -> false", () => {
  assert.equal(isSelfServiceLive({ tenancy: { selfServiceEnabled: true, multiTenant: false } }), false);
});

test("isSelfServiceLive: nur multiTenant an -> false", () => {
  assert.equal(isSelfServiceLive({ tenancy: { selfServiceEnabled: false, multiTenant: true } }), false);
});

test("isSelfServiceLive: beide Flags aus -> false", () => {
  assert.equal(isSelfServiceLive({ tenancy: { selfServiceEnabled: false, multiTenant: false } }), false);
});

test("isSelfServiceLive: liefert immer einen echten Boolean (kein truthy-Objekt-Leak)", () => {
  assert.strictEqual(isSelfServiceLive({ tenancy: { selfServiceEnabled: true, multiTenant: true } }), true);
  assert.strictEqual(isSelfServiceLive({ tenancy: { selfServiceEnabled: false, multiTenant: false } }), false);
});
