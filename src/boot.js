import {
  assertConfig,
  gatewayUrlForPort,
  setBoundGatewayPort,
  todayIsoDate,
} from "./config.js";
import { configFingerprint } from "./config-fingerprint.js";
import {
  fakeOriginateBootBlocked,
  meterMappingGaps,
  spendCapCoherence,
  unpricedModels,
  unpricedPlanSlugs,
  providerRateOutOfBand,
  alertChannelFindings,
  alertChannelInputs,
  kostenAlarmFindings,
  ALARM_KANAL,
  costTruingBookingFindings,
  voiceTariffFloorFindings,
  planCapUnderivableFindings,
  planCapReserveFindings,
  bootstrapHealDecision,
  BOOTSTRAP_HEAL,
  latentCostPathFindings,
  sttProfileFindings,
  stalePriceFindings,
  platformAniFindings,
  platformAlertSenderFindings,
  llmFallbackFindings,
  elInboundAccessFindings,
  elInboundScopeFindings,
  angekuendigterOriginFindings,
} from "./boot-guard.js";
import {
  inboundElAllowlistProbeLine,
  inboundElPinnedTenantCount,
} from "./elevenlabs/inbound-path-decision.ts";
import { sleep } from "./utils/timer.js";
import { hasActiveNumber } from "./store/views.js";
import { arbeitGehoertLebenderFremder } from "./store.js";
import { sendBootstrapAlertSms, resolveBootstrapAlertSender } from "./telephony/alert-sms.js";
import { armedInboundSprechpfad, SPRECHPFAD } from "./telephony/sprechpfad.ts";
import { ASSIGNABLE_COST_RECORD_TYPES } from "./telephony/adapters/telnyx/voice.js";
import { pflichtTraegerFuerProfil, KOSTENPROFIL } from "./billing/kostenarten.js";
import { USAGE_EVENT_KIND } from "./begriffe/abrechnung.js";
import { BOOTSTRAP_TENANT_ID } from "./begriffe/mandant.js";
import { normNum, E164 } from "./begriffe/rufnummern.js";
import { PLATFORM_NUMBER_PURPOSE, DEFAULT_PROVIDER } from "./begriffe/nummern-vergabe.js";
import { START_ROUTINE } from "./begriffe/speicher.js";
import { STRIPE_METER_EVENT_NAME } from "./billing/stripe.ts";
import {
  expireOrphanedConsults as expireOrphanedConsultsOp,
  hasPrunedSomething,
  tenantsOf,
  syncPlatformBindings,
} from "./store/state-ops.js";
import { CONSULT_OPEN_MS } from "./consult/in-call.js";
import { costTruingCoveragePercent } from "./billing/cost-truing.ts";
import { tariffDriftReportFromConfig, driftLine, tarifpaarReport, tarifpaarZeile } from "./billing/cost-calibration.ts";
import { CATALOG_SLUGS } from "./plans.ts";
import { priceIdForPlan } from "./billing/subscribe.ts";
import { planCapCents } from "./billing/plan-caps.ts";
import { audit } from "./util.ts";
import { turnBudgetOverrun } from "./turn-budget.ts";
import { evidenceRetentionEnabled } from "./call-result.js";
import { diagnosticRetentionEnabled } from "./diagnostic-retention.ts";
import { probeMailBoot } from "./mail-boot-probe.js";
import { sipRegistrarWennAktiv } from "./elevenlabs/nummern-registrierung.js";
import { starteNummerntausch } from "./worker/nummerntausch.js";
import { numberProvisioning } from "./telephony/registry.js";
import { makeGracefulShutdown } from "./abschalten.js";
import { starteAufbewahrung, starteSweepTakt } from "./zeitsteuerung.js";
import { starteLebenszeichen } from "./lebenszeichen.js";

export { makeGracefulShutdown } from "./abschalten.js";
export { runSweepTick, starteSweepTakt } from "./zeitsteuerung.js";

const BOOTSTRAP_HEAL_SMS_PREFIX = "[Hermes] Bootstrap: ";
const HEILUNG_WARTE_FRIST_MS = 30_000;
const HEILUNG_WARTE_TAKT_MS = 100;
const HEILUNG_UEBERSPRUNGEN_ZEILE = "[bootstrap-heal] uebersprungen: andere Instanz";

function runRetention(store, config) {
  const removed = store.pruneOldData();
  if (!hasPrunedSomething(removed)) return;
  console.log(
    `[retention] geloescht: ${removed.calls} Calls, ${removed.notifications} Notifications, ` +
      `${removed.actionItems} erledigte Action Items (aelter als ${config.privacy.retentionDays} Tage), ` +
      `${removed.diagnosticTranscripts} Diagnose-Transkripte (aelter als ${config.privacy.diagnosticRetentionDays} Tage), ` +
      `${removed.resultEvidence} Ergebnis-Zitate (aelter als ${config.privacy.evidenceRetentionDays} Tage)`,
  );
}

function assertSpendCapCoherence(config) {
  const worstCase = { maxTariffCents: config.billing.voiceTariffDefaultCents };
  const capForSlug = (slug) => planCapCents(slug, config.billing);
  const findings = spendCapCoherence({
    tenantDefaultCents: config.billing.defaultTenantBudgetCents,
    platformCapCents: config.billing.platformSpendCapCents,
    ...worstCase,
  });
  const planCapFindings = [
    ...planCapUnderivableFindings({ slugs: CATALOG_SLUGS, capForSlug }),
    ...planCapReserveFindings({ slugs: CATALOG_SLUGS, capForSlug, ...worstCase }),
  ];
  applyBootFindings([...findings, ...planCapFindings]);
}

function assertPricedModels(config) {
  const unpriced = unpricedModels([config.llm.claudeModel, config.llm.briefingModel], config.llm.modelPricesUsd);
  if (!unpriced.length) return;
  console.error(
    `[boot] Start abgebrochen: Modell(e) ohne Preis in modelPricesUsd: ${unpriced.join(",")} - ` +
      "jedes konfigurierte Modell braucht eine Staffel in MODEL_PRICE_SCHEDULES (src/config.js), " +
      "BEVOR CLAUDE_MODEL/PRECALL_BRIEFING_MODEL darauf gestellt wird. Eine DATIERTE " +
      "Snapshot-ID ist ein ANDERER Schluessel als der Alias.",
  );
  process.exit(1);
}

function assertPricedPlans(config) {
  if (!config.billing.paymentEnabled) return;
  const unpriced = unpricedPlanSlugs(CATALOG_SLUGS, (slug) => priceIdForPlan(slug, config));
  if (!unpriced.length) return;
  console.error(
    `[boot] Start abgebrochen: Katalog-Tarif(e) ohne Stripe-Price-Id: ${unpriced.join(",")} - ` +
      "bei PAYMENT_ENABLED=true braucht JEDER Slug aus PLAN_CATALOG (src/plans.js) eine " +
      "STRIPE_<TARIF>_PRICE_ID. Ein buchbarer Tarif ohne Price ist eine Preisseite, die nichts verkauft.",
  );
  process.exit(1);
}

function warnStaleModelPrices(config) {
  for (const finding of stalePriceFindings(config.llm.modelPricesUsd, todayIsoDate()))
    console.warn(`[boot] Konfig-Warnung: ${finding.message}`);
}

function assertProviderRateInBand(config) {
  abortOnFatal(providerRateOutOfBand(config.billing.providerToBucketRateMicro));
}

function assertSttProfile(config) {
  abortOnFatal(sttProfileFindings(config.voice.sttProfile));
}

function currentCoverage(config, store) {
  return {
    coveragePercent: costTruingCoveragePercent(store.load()),
    minCoveragePercent: config.billing.costTruingMinCoveragePercent,
  };
}

function abortOnFatal(findings) {
  const fatal = findings.find((finding) => finding.fatal);
  if (!fatal) return;
  console.error(`[boot] Start abgebrochen: ${fatal.message}`);
  process.exit(1);
}

function applyBootFindings(findings) {
  abortOnFatal(findings);
  for (const finding of findings) console.warn(`[boot] Konfig-Warnung: ${finding.message}`);
}

function assertCostTruingBooking(config, store) {
  applyBootFindings(
    costTruingBookingFindings({
      requiredRecordTypes: config.billing.costTruingRequiredRecordTypes,
      assignableRecordTypes: ASSIGNABLE_COST_RECORD_TYPES,
      ...currentCoverage(config, store),
    }),
  );
}

function warnAlertChannelUnset(config) {
  const alertChannelConfig = alertChannelInputs({
    billing: config.billing,
    mail: config.mail,
    voice: config.voice,
  });
  for (const finding of alertChannelFindings(alertChannelConfig))
    console.warn(`[boot] Konfig-Warnung: ${finding.message}`);
}

function warnKostenAlarmZielUnset(config, durableAudit) {
  const [finding] = kostenAlarmFindings({ billing: config.billing, mail: config.mail });
  if (!finding) return;
  console.warn(`[boot] Konfig-Warnung: ${finding.message}`);
  durableAudit(finding.code, null, `kanaele=${ALARM_KANAL.KEINE}`);
}

function warnPlatformAniUnset(config) {
  for (const finding of platformAniFindings({
    platformAniE164: config.provisioning.platformAniE164,
    elevenLabsOutboundEnabled: config.voice.elevenLabsOutbound.enabled,
  }))
    console.warn(`[boot] ${finding.message}`);
}

function warnTariffDrift(config, store) {
  const report = tariffDriftReportFromConfig(store.load().calls, config.billing);
  const line = `[boot] Tarif-Drift: ${report.map(driftLine).join(" | ")}`;
  if (report.some((entry) => entry.code !== null)) console.warn(line);
  else console.log(line);
}

function warnTarifpaar(config, store) {
  const report = tarifpaarReport({ state: store.load(), eigenCentJeAnruf: null, billing: config.billing });
  const line = `[boot] Tarifpaar: ${report.map(tarifpaarZeile).join(" | ")}`;
  if (report.some((entry) => entry.code !== null)) console.warn(line);
  else console.log(line);
}

function warnVoiceTariffBelowFullCost(config, store) {
  const findings = voiceTariffFloorFindings({
    domesticTariffCents: config.billing.voiceTariffDomesticCents,
    fullCostFloorCents: config.billing.voiceTariffFullCostFloorCents,
    ...currentCoverage(config, store),
  });
  for (const finding of findings) console.warn(`[boot] Konfig-Warnung: ${finding.message}`);
}

function warnTurnBudgetOverrun(config) {
  const finding = turnBudgetOverrun({
    requestTimeoutMs: config.llm.llmRequestTimeoutMs,
    maxRetries: config.llm.llmMaxRetries,
    backoffMs: config.llm.llmBackoffMs,
    synthTimeoutMs: config.voice.elevenLabsPlayTts.synthTimeoutMs,
  });
  if (!finding) return;
  console.warn(
    `[boot] Konfig-Warnung: Turn-Budget ${finding.budgetMs} ms ueberschreitet den ` +
      `Provider-Hardcut ${finding.hardcutMs} ms um ${finding.overrunMs} ms ` +
      "(LLM_REQUEST_TIMEOUT_MS/LLM_MAX_RETRIES/LLM_BACKOFF_MS/ELEVENLABS_SYNTH_TIMEOUT_MS).",
  );
}

function warnLlmFallbackUnusable(config) {
  for (const finding of llmFallbackFindings({
    provider: config.llm.llmProvider,
    fallback: config.llm.llmProviderFallback,
  }))
    console.warn(`[boot] Konfig-Warnung: ${finding.message}`);
}

function warnMissingProvisioningConnection(config) {
  if (!config.provisioning.provisioningEnabled || config.telephony.telnyxConnectionId) return;
  console.warn(
    "[boot] Konfig-Warnung: PROVISIONING_ENABLED=true ohne TELNYX_CONNECTION_ID - gekaufte Nummern " +
      "gehen ohne Voice-Routing raus und werden trotzdem aktiv geschaltet.",
  );
}

function meldeElNummernregistrierung(config) {
  if (!config.voice.elevenLabsOutbound.enabled) return;
  if (!sipRegistrarWennAktiv(config)) {
    console.warn(
      "[boot] Konfig-Warnung: ElevenLabs-Nummernregistrierung NICHT eingehaengt " +
        "(ELEVENLABS_OUTBOUND_ENABLED, PROVISIONING_ENABLED und " +
        "ELEVENLABS_NUMBER_REGISTRATION_ENABLED muessen alle true sein) - neue DIDs werden nicht " +
        "bei ElevenLabs registriert, ausgehende Anrufe von DIDs ohne Registrierung brechen ab.",
    );
    return;
  }
  const { telnyxSipTrunkUsername, telnyxSipTrunkPassword } = config.telephony;
  if (!telnyxSipTrunkUsername || !telnyxSipTrunkPassword) return;
  console.log("[boot] ElevenLabs-Nummernregistrierung: eingehaengt (neue DIDs werden registriert)");
}

function warnElRegistrationSipCredsMissing(config) {
  if (!config.voice.elevenLabsOutbound.numberRegistrationEnabled) return;
  if (config.telephony.telnyxSipTrunkUsername && config.telephony.telnyxSipTrunkPassword) return;
  console.warn(
    "[boot] Konfig-Warnung: ELEVENLABS_NUMBER_REGISTRATION_ENABLED=true ohne " +
      "TELNYX_SIP_TRUNK_USERNAME/TELNYX_SIP_TRUNK_PASSWORD - das Anlegen neuer " +
      "ElevenLabs-Nummernregistrierungen schlaegt fail-closed fehl (benannte Log-Zeile je " +
      "DID), ausgehende Anrufe von DIDs ohne Registrierung brechen ab.",
  );
}

function assertLatentCostPaths(config) {
  const elInboundPflichtTraeger = pflichtTraegerFuerProfil(KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI);
  applyBootFindings(
    latentCostPathFindings({
      playTtsEnabled: config.voice.elevenLabsPlayTts.enabled,
      elInboundEnabled: config.voice.elevenLabsInbound.enabled,
      elInboundCarrierHasCollector: elInboundPflichtTraeger.length > 0,
    }),
  );
}

function assertElInboundAccess(config) {
  applyBootFindings(elInboundAccessFindings(config.voice.elevenLabsInbound));
}

function assertElInboundScope(config) {
  applyBootFindings(elInboundScopeFindings(config.voice.elevenLabsInbound.scope));
}

function assertAngekuendigterOrigin(config) {
  applyBootFindings(
    angekuendigterOriginFindings({
      publicUrl: config.server.publicUrl,
      oauthAudience: config.auth.oauthAudience,
      allowedOrigins: config.safety.mcpAllowedOrigins,
      isProduction: config.server.isProduction,
    }),
  );
}

function assertBootGates(config, store, durableAudit) {
  const ok = assertConfig();
  if (!ok) {
    console.error("[boot] Start abgebrochen: Safety-/Pflicht-Konfiguration ungueltig (siehe oben).");
    process.exit(1);
  }

  const fakeOriginateFlags = [
    { envName: "FAKE_ORIGINATE", fakeOriginate: config.safety.fakeOriginate },
    { envName: "FAKE_ORIGINATE_ELEVENLABS", fakeOriginate: config.safety.fakeOriginateElevenlabs },
  ];
  for (const { envName, fakeOriginate } of fakeOriginateFlags) {
    if (fakeOriginateBootBlocked({ fakeOriginate, skipTwilioSignatureCheck: config.safety.skipTwilioSignatureCheck })) {
      console.error(
        `[boot] Start abgebrochen: ${envName}=true ist nur mit SKIP_TWILIO_SIGNATURE_CHECK=true ` +
          "zulaessig (Test-Seam, in Produktion unzulaessig).",
      );
      process.exit(1);
    }
  }

  if (!hasActiveNumber(store.load())) {
    console.error(
      "[boot] Keine aktive Nummer im Store. Erst seeden: " +
        "npm run bootstrap-tenant -- <e164> <provider>",
    );
    process.exit(1);
  }

  const meterGaps = meterMappingGaps(Object.values(USAGE_EVENT_KIND), STRIPE_METER_EVENT_NAME);
  if (meterGaps.length) {
    console.error(
      `[boot] Start abgebrochen: usage_event-Sorten ohne Stripe-Meter-Abbildung: ${meterGaps.join(",")}. ` +
        "STRIPE_METER_EVENT_NAME in src/billing/stripe.ts vervollstaendigen.",
    );
    process.exit(1);
  }

  assertSpendCapCoherence(config);
  assertPricedModels(config);
  assertPricedPlans(config);
  warnStaleModelPrices(config);
  assertProviderRateInBand(config);
  assertCostTruingBooking(config, store);
  assertSttProfile(config);
  assertAngekuendigterOrigin(config);
  warnAlertChannelUnset(config);
  warnKostenAlarmZielUnset(config, durableAudit);
  warnPlatformAniUnset(config);
  warnTariffDrift(config, store);
  warnTarifpaar(config, store);
  warnVoiceTariffBelowFullCost(config, store);
  warnTurnBudgetOverrun(config);
  warnLlmFallbackUnusable(config);
  warnMissingProvisioningConnection(config);
  assertLatentCostPaths(config);
  assertElInboundAccess(config);
  assertElInboundScope(config);
  warnElRegistrationSipCredsMissing(config);
  meldeElNummernregistrierung(config);
}

export function budgetAxisLabel(budgetMonthEnabled, axisLabelWhenFlagOff) {
  return budgetMonthEnabled
    ? "Spend-Monat (BUDGET_MONTH_ENABLED=true)"
    : `${axisLabelWhenFlagOff} (BUDGET_MONTH_ENABLED=false)`;
}

export function inboundSprechpfadBannerLine(voice) {
  return probeLine(
    "Inbound-Sprechpfad",
    `${armedInboundSprechpfad(voice.elevenLabsPlayTts)} (ELEVENLABS_PLAY_TTS_ENABLED=${voice.elevenLabsPlayTts.enabled})`,
    `${SPRECHPFAD.PLAY_TTS} faellt bei erschoepftem Kontingent, Synthese-Fehler oder ` +
      `Anbieter ohne Play-Audio fail-safe auf ${SPRECHPFAD.AZURE_SAY} zurueck`,
  );
}

export function inboundElBannerLine(elevenLabsInbound) {
  const zustand = elevenLabsInbound.enabled ? "an" : "aus";
  return `Inbound-EL: ${zustand}, ${inboundElPinnedTenantCount(elevenLabsInbound.tenantIds)} Tenants, scope=${elevenLabsInbound.scope}`;
}

export function inCallConsultBannerLine(tenancy) {
  return tenancy.inCallConsultEnabled ? "In-Call-Consult: AKTIV (IN_CALL_CONSULT_ENABLED=true)" : "";
}

export function thinkingSignalBannerLine(voice) {
  return voice.thinkingSignalEnabled ? "Denk-Signal: AKTIV (THINKING_SIGNAL_ENABLED=true)" : "";
}

export function inboundOwnerGreetingBannerLine(voice) {
  if (!voice.inboundOwnerGreetingEnabled) return "";
  return `Inbound-Owner-Ton: AKTIV (INBOUND_OWNER_GREETING_ENABLED=true, ${voice.inboundOwnerGreetingTenantIds.length} Tenants)`;
}

function envState(envKey, value, active) {
  return `${active ? "AKTIV" : "aus"} (${envKey}=${value})`;
}

function envFlagState(envKey, on) {
  return envState(envKey, on, on);
}

function probeLine(label, state, remainingConditions) {
  return `${label}: ${state} - ${remainingConditions}`;
}

function precallBriefingProbeLine(tenancy) {
  return probeLine(
    "Vorab-Briefing",
    envFlagState("PRECALL_BRIEFING_ENABLED", tenancy.precallBriefingEnabled),
    `wirkt nur mit ASSISTANT_CONTEXT_ENABLED=${tenancy.assistantContextEnabled}`,
  );
}

function researchProbeLine(research) {
  return probeLine(
    "Vorab-Recherche",
    envFlagState("RESEARCH_ENABLED", research.researchEnabled),
    "wirkt nur mit allowResearch am Tenant",
  );
}

function lookupProbeLine(research) {
  return probeLine(
    "In-Call-Nachschlag",
    envFlagState("LOOKUP_ENABLED", research.lookupEnabled),
    `EXA_API_KEY ${research.exaApiKey ? "gesetzt" : "fehlt"}, wirkt nur mit allowLookup am Tenant`,
  );
}

function consultProbeLine(tenancy) {
  return probeLine(
    "Consult-Kanal",
    envFlagState("CONSULT_ENABLED", tenancy.consultEnabled),
    `wirkt nur mit ASSISTANT_CONTEXT_ENABLED=${tenancy.assistantContextEnabled} und allowConsult am Tenant`,
  );
}

function evidenceProbeLine(privacy) {
  const days = privacy.evidenceRetentionDays;
  const collecting = evidenceRetentionEnabled(privacy);
  return probeLine(
    "Ergebnis-Zitate",
    envState("EVIDENCE_RETENTION_DAYS", days, collecting),
    collecting ? `Zitate werden erhoben und nach ${days} Tagen geloescht` : "0 = keine Zitate",
  );
}

function diagnosticRetentionProbeLine(privacy) {
  const days = privacy.diagnosticRetentionDays;
  const keeping = diagnosticRetentionEnabled(privacy);
  return probeLine(
    "Diagnose-Transkripte",
    envState("DIAGNOSTIC_RETENTION_DAYS", days, keeping),
    keeping
      ? `Rohtranskript ueberlebt die Summary bei Anrufen an die eigene Nummer, Loeschung nach ${days} Tagen`
      : "0 = kein Rohtranskript ueberlebt",
  );
}

export function capabilityProbeLines({ tenancy, research, privacy }) {
  return [
    precallBriefingProbeLine(tenancy),
    researchProbeLine(research),
    lookupProbeLine(research),
    consultProbeLine(tenancy),
    evidenceProbeLine(privacy),
    diagnosticRetentionProbeLine(privacy),
  ];
}

export const UNSET_LABEL = "nicht gesetzt";

function costTruingRecordTypesLabel(types) {
  return types.length > 0 ? types.join(",") : UNSET_LABEL;
}

function flushEpochLabel(flushEpochIso) {
  return flushEpochIso || UNSET_LABEL;
}

function paymentConfigBannerLine(billing) {
  return (
    `Zahlungsabwicklung: ${envFlagState("PAYMENT_ENABLED", billing.paymentEnabled)} | ` +
    `SMS_COST_CENTS=${billing.smsCostCents} ct | ` +
    `BILLING_FLUSH_EPOCH=${flushEpochLabel(billing.flushEpochIso)}`
  );
}

function costTruingTypesBannerLine(billing) {
  return `Cost-Truing-Typen: COST_TRUING_REQUIRED_RECORD_TYPES=${costTruingRecordTypesLabel(billing.costTruingRequiredRecordTypes)}`;
}

function modelConfigBannerLine(llm, voice) {
  return (
    `Modelle: CLAUDE_MODEL=${llm.claudeModel} | ` +
    `PRECALL_BRIEFING_MODEL=${llm.briefingModel} | ` +
    `${envFlagState("ELEVENLABS_PLAY_TTS_ENABLED", voice.elevenLabsPlayTts.enabled)}`
  );
}

export function costConfigBannerLines({ billing, llm, voice }) {
  return [
    paymentConfigBannerLine(billing),
    costTruingTypesBannerLine(billing),
    modelConfigBannerLine(llm, voice),
  ];
}

const NO_NEXT_SCHEDULE_LABEL = "keine";

export function modelPriceScheduleBannerLine(llm) {
  const label = (modelId) => {
    const price = llm.modelPricesUsd[modelId];
    return `${modelId} ab ${price.validFrom} (naechste: ${price.nextValidFrom || NO_NEXT_SCHEDULE_LABEL})`;
  };
  return `Preisstaffeln: ${label(llm.claudeModel)} | ${label(llm.briefingModel)}`;
}

export function ttsQuotaCoverageBannerLine(billing) {
  return (
    `ElevenLabs-Kontingent: TTS_CHARACTER_QUOTA=${billing.ttsCharacterQuota} Zeichen/Zyklus | ` +
    "Relay-Verbrauch: nachtraeglich ueber den Ist-Abgleich gezaehlt (UNTERGRENZE - nur belegte Anrufe)"
  );
}

function publicUrlOrHint(server) {
  return server.publicUrl || "PUBLIC_URL fehlt!";
}

function logBootBanner(config, port, state) {
  console.log(`  [boot] deployed commit=${config.server.deployedCommit}`);
  console.log(`  [boot] configHash=${configFingerprint(config)}`);
  console.log(`\n  Hermes Gateway laeuft auf ${gatewayUrlForPort(port)}`);
  console.log(`  Dashboard:      ${gatewayUrlForPort(port)}`);
  console.log(
    `  Voice-Engine:   ${config.voice.voiceEngine}`,
  );
  console.log(`  ${inboundSprechpfadBannerLine(config.voice)}`);
  console.log(`  ${inboundElBannerLine(config.voice.elevenLabsInbound)}`);
  console.log(`  ${inboundElAllowlistProbeLine({ state, tenantIds: config.voice.elevenLabsInbound.tenantIds })}`);
  const inCallConsult = inCallConsultBannerLine(config.tenancy);
  if (inCallConsult) console.log(`  ${inCallConsult}`);
  const thinkingSignal = thinkingSignalBannerLine(config.voice);
  if (thinkingSignal) console.log(`  ${thinkingSignal}`);
  const inboundOwnerGreeting = inboundOwnerGreetingBannerLine(config.voice);
  if (inboundOwnerGreeting) console.log(`  ${inboundOwnerGreeting}`);
  for (const line of capabilityProbeLines(config)) console.log(`  ${line}`);
  console.log(
    `  MCP (HTTP):     ${publicUrlOrHint(config.server)}/mcp  <- als Custom Connector in Claude eintragen`,
  );
  console.log(`  Voice-Webhook:  ${publicUrlOrHint(config.server)}/voice/incoming`);
  console.log(`  Status-Callback:${publicUrlOrHint(config.server)}/voice/status`);
  console.log(
    `  Outbound:       ${config.safety.outboundFrozen ? "EINGEFROREN (OUTBOUND_FROZEN=true)" : "aktiv (Verifikation per Tenant: Abo+KYC)"}`,
  );
  console.log(
    `  Nummern-Gates:  Land ${config.safety.allowedCountryCodes.join(",")} | max ${config.safety.maxCallsPerHour} Calls/h pro Tenant | Notruf-/Premium-Denylist aktiv`,
  );
  console.log(
    `  Budget-Achse:   Tenant ${budgetAxisLabel(config.billing.budgetMonthEnabled, "Perioden-Fenster")} | ` +
      `Plattform ${budgetAxisLabel(config.billing.budgetMonthEnabled, "Lebenszeit-Topf")} (nur Beobachtung/Warnschwelle, KS-P9)`,
  );
  console.log(
    `  Kosten-Decken:  Tenant-Default ${config.billing.defaultTenantBudgetCents} ct | ` +
      `Plattform-Warnschwelle ${config.billing.platformSpendCapCents} ct | ` +
      `Worst-Case-Tarif ${config.billing.voiceTariffDefaultCents} ct/min`,
  );
  for (const line of costConfigBannerLines(config)) console.log(`  ${line}`);
  console.log(`  ${modelPriceScheduleBannerLine(config.llm)}`);
  console.log(`  ${ttsQuotaCoverageBannerLine(config.billing)}`);
}

async function heileUnterSperre({ config, store, messaging }) {
  if (await store.nummernVorhanden()) return false;
  await store.bootstrapTenant(
    normNum(config.provisioning.bootstrapE164),
    BOOTSTRAP_TENANT_ID,
    config.provisioning.bootstrapProvider,
  );
  console.log("[bootstrap-heal] Leerer Store aus den Deploy-Parametern geheilt (in-prozess, idempotent).");
  audit("bootstrap_store_geheilt", null, `provider=${config.provisioning.bootstrapProvider}`);
  sendBootstrapAlertSms({
    messaging,
    config,
    store,
    prefix: BOOTSTRAP_HEAL_SMS_PREFIX,
    detail: "leerer Store beim Boot aus den Deploy-Parametern geheilt",
    logTag: "bootstrap-heal",
  });
  return true;
}

async function warteAufHeilungDerAnderenInstanz(store, sperreBelegt) {
  const frist = Date.now() + HEILUNG_WARTE_FRIST_MS;
  while (sperreBelegt && !(await store.nummernVorhanden()) && Date.now() < frist) await sleep(HEILUNG_WARTE_TAKT_MS);
  await store.zustandNachladen();
}

export async function healBootstrapStore({ config, store, messaging }) {
  const state = store.load();
  const decision = bootstrapHealDecision({
    activeNumberPresent: hasActiveNumber(state),
    numberCount: state.numbers.length,
    foreignTenantCount: tenantsOf(state).filter((tenant) => tenant.id !== BOOTSTRAP_TENANT_ID).length,
    callCount: state.calls.length,
    e164: config.provisioning.bootstrapE164,
    provider: config.provisioning.bootstrapProvider,
  });
  if (decision === BOOTSTRAP_HEAL.NOT_NEEDED) return decision;
  if (decision === BOOTSTRAP_HEAL.BLOCKED_STORE_NOT_FRESH) {
    console.warn(
      "[bootstrap-heal] Store ist nicht leer, aber ohne aktive Nummer - KEINE In-Prozess-Heilung " +
        "(Proliferations-Schutz). Manuell: npm run bootstrap-tenant.",
    );
    return decision;
  }
  if (decision === BOOTSTRAP_HEAL.BLOCKED_PARAMS) {
    if (config.provisioning.bootstrapE164)
      console.error(
        "[bootstrap-heal] BOOTSTRAP_E164/BOOTSTRAP_PROVIDER unbrauchbar " +
          "(E.164 + telnyx erwartet) - keine Heilung.",
      );
    return decision;
  }
  const lauf = await store.mitStartSperre(START_ROUTINE.HEILUNG, () =>
    heileUnterSperre({ config, store, messaging }),
  );
  if (lauf.uebersprungen || !lauf.ergebnis) {
    console.log(HEILUNG_UEBERSPRUNGEN_ZEILE);
    await warteAufHeilungDerAnderenInstanz(store, lauf.uebersprungen);
    return BOOTSTRAP_HEAL.NOT_NEEDED;
  }
  return decision;
}

function validPlatformAniE164(rawE164) {
  const normalized = normNum(rawE164);
  return E164.test(normalized) ? normalized : "";
}

export function derivePlatformNumberBindings({ config, store }) {
  const alertSender = resolveBootstrapAlertSender(store);
  const open = syncPlatformBindings(store.load(), [
    {
      purpose: PLATFORM_NUMBER_PURPOSE.OUTBOUND_ANI,
      e164: validPlatformAniE164(config.provisioning.platformAniE164),
      provider: DEFAULT_PROVIDER,
      note: "abgeleitet aus PLATFORM_ANI_E164",
    },
    {
      purpose: PLATFORM_NUMBER_PURPOSE.ALERT_SMS_SENDER,
      e164: alertSender?.e164 || "",
      provider: alertSender?.provider || DEFAULT_PROVIDER,
      note: "abgeleitet aus der aktiven Bootstrap-Nummer (alert-sms.js)",
    },
  ]);
  store.save();
  return open;
}

async function expireOrphanedConsults(store) {
  const state = store.load();
  const nowMs = Date.now();
  const lage = await store.besitzLage();
  const orphaned = state.calls.filter(
    (call) =>
      call.status === "active" &&
      store.pendingConsult(call.id) &&
      !arbeitGehoertLebenderFremder(call.instanz, lage),
  );
  if (!orphaned.length) return;
  let freed = 0;
  for (const call of orphaned)
    freed += expireOrphanedConsultsOp(state, call.id, { nowMs, openMs: CONSULT_OPEN_MS }).orphaned;
  store.save();
  console.log(
    `[boot] verwaiste Rueckfragen geschlossen: ${orphaned.length} Anrufe, ` +
      `${freed} mit freigegebenem Kontingent`,
  );
}

export async function bootServer({
  app,
  config,
  store,
  lifecycle,
  provisioning,
  costTruing,
  costCrossCheck,
  durableAudit,
  outageWatch,
  paidWithoutNumberWatch,
  provisionRetryWatch,
  priceDriftWatch,
  messaging,
  consultDelivery,
  elevenLabsOutbound,
  inboundBridges,
  inboundTrunkSweep,
  auditStore,
  abschaltweiche,
}) {
  try {
    store.load();
  } catch (err) {
    console.error(`[boot] Store nicht ladbar - fail-closed, kein Start: ${err.message}`);
    process.exit(1);
  }

  await healBootstrapStore({ config, store, messaging });
  const openPlatformBindings = derivePlatformNumberBindings({ config, store });
  for (const finding of platformAlertSenderFindings({ openBindings: openPlatformBindings }))
    console.warn(`[boot] ${finding.message}`);
  assertBootGates(config, store, durableAudit);

  try {
    await provisioning.startQueue();
  } catch (err) {
    console.error(`[boot] Warteschlange nicht erreichbar - fail-closed, kein Start: ${err.message}`);
    process.exit(1);
  }

  await store.starteZustellungsLoeschtakt(provisioning);
  await starteAufbewahrung(() => runRetention(store, config), provisioning);

  await starteSweepTakt(
    config,
    {
      costTruing,
      provisioning,
      costCrossCheck,
      outageWatch,
      paidWithoutNumberWatch,
      provisionRetryWatch,
      priceDriftWatch,
    },
    provisioning,
  );

  lifecycle.rearmActiveCallTimers();

  lifecycle.rearmBudgetWatchdogs();

  const instanzTakt = await store.starteInstanzTakt();

  if (config.store.kennzahlenDatabaseUrl) await store.starteKennzahlenLauf();

  await expireOrphanedConsults(store);

  elevenLabsOutbound.rearmActiveConversationPolls();

  inboundBridges.rearmDeadlines();

  void starteNummerntausch({ store, config, numberProvisioning, audit: auditStore });

  const httpServer = app.listen(config.server.port, () => {
    const port = httpServer.address().port;
    setBoundGatewayPort(port);
    logBootBanner(config, port, store.load());
    void inboundTrunkSweep.runBootSweep();
    void provisioning.reconcileOrphanedProvisioning();
    void probeMailBoot(config).catch((fehler) =>
      console.error("[mail] Sonde unerwartet gescheitert", fehler?.code ?? fehler?.name ?? "unbekannt"),
    );
    void priceDriftWatch.runBootProbe().catch((err) => console.error("[price-drift] Boot-Sonde:", err.message));
    starteLebenszeichen(config.server);
  });

  const gracefulShutdown = makeGracefulShutdown({
    httpServer,
    store,
    config,
    releaseLongPolls: consultDelivery.releaseOpenPolls,
    stopQueue: provisioning.stopQueue,
    abschaltweiche,
    instanzTakt,
  });
  process.once("SIGTERM", gracefulShutdown);
  process.once("SIGINT", gracefulShutdown);
}
