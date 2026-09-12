// ---- Boot-Sequenz (Server-Slim P15) ---------------------------------------------
// bootServer(deps) startet den fertig verdrahteten app: store.load, DSGVO-Retention,
// Fail-closed-Boot-Gates, listen+Banner, Audio-Bridge, Provisioning-Reconcile,
// Graceful-Shutdown. REINE Verschiebung aus server.js (byte-identische Reihenfolge,
// Log-Zeilen, exit-Codes). INV-5: rearmActiveCallTimers NACH allen exit1-Gates,
// unmittelbar VOR listen; kein Gate danach ruft process.exit(1). INV-6: die
// "Hermes Gateway laeuft auf ..."-Zeile erst im listen-Callback (nach vollem Boot).
import {
  assertConfig,
  gatewayUrlForPort,
  setBoundGatewayPort,
  todayIsoDate,
  VOICE_ENGINE,
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
  driftConfigFindings,
  llmFallbackFindings,
} from "./boot-guard.js";
import { hasActiveNumber } from "./store/views.js";
import { sendBootstrapAlertSms, resolveBootstrapAlertSender } from "./telephony/alert-sms.js";
// LCT-FIX-1: welche Belegtypen einem Call zugeordnet werden koennen, weiss der Adapter, der
// die Belege liest - der Boot-Guard bleibt eine reine, arg-injizierte Entscheidung.
// Provider-Konstante, kein Transport: dieselbe Richtung wie telnyx-call-control-ingest.js
// (assistantVoiceConfigured).
import { ASSIGNABLE_COST_RECORD_TYPES } from "./telephony/adapters/telnyx/voice.js";
import { attachMediaBridge, REALTIME_MID_CALL_BUDGET_CHECK } from "./bridge.js";
import {
  hatEinsammler,
  pflichtTraegerFuerProfil,
  KOSTENART,
  KOSTENPROFIL,
} from "./billing/kostenarten.js";
import {
  USAGE_EVENT_KIND,
  BOOTSTRAP_TENANT_ID,
  normNum,
  PLATFORM_NUMBER_PURPOSE,
  DEFAULT_PROVIDER,
  E164,
} from "./store/defaults.js";
import { STRIPE_METER_EVENT_NAME } from "./billing/stripe.js";
import {
  expireOrphanedConsults as expireOrphanedConsultsOp,
  hasPrunedSomething,
  tenantsOf,
  syncPlatformBindings,
} from "./store/state-ops.js";
// EL-NEUSTART-6: die Haltefrist der Rueckfrage, aus der EINEN Quelle (G5) - dieselbe Zahl,
// gegen die der Anbieter-Warter selbst laeuft. Kein Zyklus: consult/in-call.js importiert
// boot.js nicht.
import { CONSULT_OPEN_MS } from "./consult/in-call.js";
import { SWEEP_TRIGGER, costTruingCoveragePercent } from "./billing/cost-truing.js";
import { tariffDriftReportFromConfig, driftLine, tarifpaarReport, tarifpaarZeile } from "./billing/cost-calibration.js";
import { CATALOG_SLUGS } from "./plans.js";
// GP-P6 (a): die EINE Slug->Price-Quelle (G5) - das Gate vergleicht Config gegen Config,
// ohne eine zweite Zuordnung zu tippen. Kein Zyklus: subscribe.js importiert boot.js nicht.
import { priceIdForPlan } from "./billing/subscribe.js";
import { planCapCents } from "./billing/plan-caps.js";
import { audit } from "./util.js";
import { deadAirOverrun, turnBudgetOverrun } from "./turn-budget.js";
import { MS_PER_MINUTE, MS_PER_SECOND } from "./utils/timer.js";
// GAP-19: EIN Praedikat fuer beide Haelften - der Boot meldet genau die Konstellation, die
// in der Outbound-Kette das Herkunfts-Gate abschaltet (G5). Kein Zyklus: outbound-gates.js
// importiert boot.js nicht.
import { numberOriginDecoupled } from "./telephony/outbound-gates.js";
// AL-P16: der Aus-Zustand der Ergebnis-Zitate hat bereits eine Quelle - die Sonde
// wiederholt die Schwelle nicht, sie fragt dieselbe Entscheidung (G5).
import { evidenceRetentionEnabled } from "./call-result.js";
// GQ-P11: dieselbe Richtung fuer die Diagnose-Frist - die Sonde fragt die Entscheidung,
// die auch der Anlege- und der Purge-Pfad fragen (G5). Kein Zyklus: diagnostic-retention.js
// importiert nichts.
import { diagnosticRetentionEnabled } from "./diagnostic-retention.js";
// mail-boot-probe: der Versand ist fail-soft (brevo-mail.js/smtp-mail.js/billing/
// cancellation-mail.js) - ein Fehlschlag bleibt lautlos, bis sich ein Kunde beschwert.
// Import HIER statt in wiring/web-login.js (wo der Mailer selbst konstruiert wird): jener
// Block laeuft NUR bei STORE_BACKEND=pg (app.js), die Sonde soll den Mail-Zustand (Brevo/
// HTTP oder SMTP) aber unconditional melden, Muster PROV-01 (reconcileOrphanedProvisioning,
// s.u.).
import { probeMailBoot } from "./mail-boot-probe.js";

// G25: benannte Faktoren statt Literalen im Rumpf. Der Takt selbst ist unveraendert
// (sechs Stunden); MS_PER_MINUTE ist die bestehende Quelle der Zeit-Umrechnung
// (utils/timer.js), die Stunde bekommt hier ihren Namen.
const MINUTES_PER_HOUR = 60;
const RETENTION_SWEEP_INTERVAL_HOURS = 6;
const RETENTION_SWEEP_INTERVAL_MS = RETENTION_SWEEP_INTERVAL_HOURS * MINUTES_PER_HOUR * MS_PER_MINUTE;

// GAP-38: Praefix der Plattform-SMS, die eine In-Prozess-Heilung meldet (G25: benannte
// Konstante statt Literal im Rumpf; Muster TTS_QUOTA_SMS_PREFIX in src/server.js).
const BOOTSTRAP_HEAL_SMS_PREFIX = "[Hermes] Bootstrap: ";

// Retention (DSGVO): alte Transkripte/Notifications beim Start und periodisch loeschen
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

// P3: Kohaerenz der Budget-Achsen GEGENEINANDER (spendCapCoherence, src/boot-guard.js).
// Klausel B (Worst-Case-Reserve > Tenant-Decke) ist seit P7/GAP-32 FATAL - unter ihr faellt
// ein ganzer Zielbereich vor dem Dial ins Reserve-Gate. Nur A0 (Sentinel 0) bleibt WARN
// (siehe Klausel-Kommentar im Guard).
//
// LCT P6 haengt eine weitere Linie an (fatal): laesst sich fuer JEDEN Katalog-Slug
// ueberhaupt eine Decke ableiten - unabhaengig davon, ob schon ein Tenant diesen Plan
// gebucht hat (verhindert eine inkohaerente Konfiguration VOR dem ersten Kunden). Sie kann
// NOCH process.exit(1) ausloesen - deshalb bleibt assertSpendCapCoherence vor
// rearmActiveCallTimers() (INV-5).
//
// KS-P3a haengt eine dritte Linie an (fatal): traegt die KLEINSTE Plan-Decke die
// Worst-Case-Reserve eines Anrufs? spendCapCoherence Klausel B prueft das nur gegen
// DEFAULT_TENANT_BUDGET_CENTS - die Decke eines ZAHLENDEN Tenants kommt aber aus dem Plan
// (effectiveCapCents bevorzugt die tenant_budget-Zeile) und wurde bisher nie dagegen
// gehalten.
function assertSpendCapCoherence(config) {
  // Die Eingaben der Worst-Case-Reserve, EINMAL benannt: beide Guards, die eine Decke
  // dagegen halten, muessen dieselbe Reserve meinen (G5).
  // Worst Case, NICHT der Inlandstarif: gerechnet wird das teuerste Ziel. Eine Dauer geht
  // seit KS-P3 (a) NICHT mehr ein - die Reserve deckt ein festes Vorlauffenster
  // (RESERVE_LEAD_MINUTES, store/defaults.js), nicht das ganze Gespraech. Der teuerste
  // SATZ ueber dieses Fenster ist damit die laengstmoegliche Reserve.
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
  const all = [...findings, ...planCapFindings];
  const fatal = all.find((finding) => finding.fatal);
  if (fatal) {
    console.error(`[boot] Start abgebrochen: ${fatal.message}`);
    process.exit(1);
  }
  for (const finding of all) console.warn(`[boot] Konfig-Warnung: ${finding.message}`);
}

// B4a: ein konfiguriertes Modell OHNE Preisstaffel bricht den Start ab. Bis dahin war das
// eine WARN, mit der Begruendung "reine Ueber-Bepreisung (bis 3x), nie Ueber-Ausgabe".
// Diese Begruendung haengt an EINER Voraussetzung: dass die Fail-closed-Rate
// (worstCasePrice, state-ops.js) eine sinnvolle Obergrenze ist. Das gilt, solange genau
// EINE Preiswelt hinterlegt ist - mit einem zweiten Anbieter faellt die Praemisse, nicht
// durch Meinung, sondern durch Wegfall. Zweitens ist ein console.warn auf einem Dienst,
// den niemand liest, die stille Fehlkonfiguration auf einer Geld-Achse - dieselbe Klasse,
// gegen die LCT P4 den Kurs-Guard fatal gemacht hat (assertProviderRateInBand, unten -
// das Muster).
//
// Geprueft werden GENAU zwei Werte, unveraendert: claudeModel und briefingModel (letzterer
// UNABHAENGIG von precallBriefingEnabled). NICHT geprueft wird realtimeModel: der
// Realtime-Pfad bucht keine Token (kein bookTokenUsage-Aufrufer in bridge.js) - ein
// Abbruch dafuer waere ein Abbruch ohne Schutzwirkung.
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

// GP-P6 (a): ein buchbarer Tarif ohne Stripe-Price-Id ist bei aktivem Geldpfad keine
// Route-500 mehr, sondern ein Boot-Refusal (PLAN-GELDPFAD.md GP-P6). Rein lokal, Config
// gegen Config, KEIN Netz - deshalb darf er fatal sein (Muster assertPricedModels).
// PAYMENT_ENABLED=false laesst ihn vollstaendig aus: sonst stirbt jeder Entwickler- und
// Testboot (Muster isPositiveIntegerFee, "FATAL nur im Payment-Pfad").
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

// B4a: Veralterung der Preisliste (stalePriceFindings, boot-guard.js). WARN, kein exit(1)
// - Muster warnTariffDrift.
function warnStaleModelPrices(config) {
  for (const finding of stalePriceFindings(config.llm.modelPricesUsd, todayIsoDate()))
    console.warn(`[boot] Konfig-Warnung: ${finding.message}`);
}

// LCT P4: Umrechnungskurs gegen das Toleranzband - seit dieser Phase FATAL (in P2 war
// derselbe Befund eine WARN). UNKONDITIONAL: an kein Flag gekoppelt (Begruendung im
// Guard). Muster assertSpendCapCoherence.
function assertProviderRateInBand(config) {
  const fatal = providerRateOutOfBand(config.billing.providerToBucketRateMicro).find((finding) => finding.fatal);
  if (!fatal) return;
  console.error(`[boot] Start abgebrochen: ${fatal.message}`);
  process.exit(1);
}

// STT-A1: ungueltiges STT_PROFILE -> Boot-Refusal (sttProfileFindings, s. boot-guard.js).
// exit(1) statt WARN, weil der Renderer mit ungueltigem Profil erst IM laufenden Anruf
// wirft - der teuerstmoegliche Zeitpunkt fuer einen Konfigurations-Tippfehler.
function assertSttProfile(config) {
  const fatal = sttProfileFindings(config.voice.sttProfile).find((finding) => finding.fatal);
  if (!fatal) return;
  console.error(`[boot] Start abgebrochen: ${fatal.message}`);
  process.exit(1);
}

// LCT P4b (G5): die Deckungs-Eingabe beider Boot-Guards (P4 assertCostTruingBooking,
// P4b warnVoiceTariffBelowFullCost) an EINER Stelle - beide vergleichen dieselbe live
// aus dem Spiegel gerechnete Quote gegen dieselbe Schwelle. costTruingCoveragePercent
// (P3) ist die EINE Quelle der Quote (auch fuer die Sweep-Ausgabe). store.load() ist
// gecached, der Doppelaufruf beider Guards kostet kein zweites IO.
function currentCoverage(config, store) {
  return {
    coveragePercent: costTruingCoveragePercent(store.load()),
    minCoveragePercent: config.billing.costTruingMinCoveragePercent,
  };
}

// LCT P4: die Riegel des Flips. Deckungsquote + Schwelle liefert currentCoverage
// (die EINE Quelle, s.o.). Leere Pflicht-Menge = FATAL (ein Dienst, der Geld
// zurueckerstattet, ohne zu wissen, wogegen er Vollstaendigkeit prueft, darf nicht
// starten). Ebenso FATAL seit LCT-FIX-1: ein Pflicht-Typ ausserhalb der Allowlist der
// zuordenbaren Belegtypen - Begruendung s. ASSIGNABLE_COST_RECORD_TYPES
// (telephony/adapters/telnyx/voice.js). Quote unter der Schwelle = WARN, kein exit(1) -
// ein Boot-Refusal tauschte ein Kostenproblem gegen einen Telefonie-Totalausfall (Praezedenz
// warnTariffDrift); die laute Linie ist der Befund coverage_below_threshold aus dem Sweep.
// LCT P4 / KV2-2 (G5): EIN Umgang mit einer Befundmenge, in der fatale und warnende
// Befunde gemeinsam auftreten koennen (fatal zuerst, dann alle als WARN). Vorher stand
// dieser Block wortgleich zweimal (assertCostTruingBooking, und die neue fatale Variante
// von latentCostPathFindings haette einen dritten, byte-identischen Zwilling erzeugt) -
// genau die Doppelstruktur, die dieser Plan beendet.
function applyBootFindings(findings) {
  const fatal = findings.find((finding) => finding.fatal);
  if (fatal) {
    console.error(`[boot] Start abgebrochen: ${fatal.message}`);
    process.exit(1);
  }
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

// LCT P5: Alarmkanal-Guard (alertChannelFindings). Loggt NIE den Wert (der besetzte Fall
// liefert [] und meldet damit gar nichts). Der seit GAP-07 moegliche FATALE Befund ist hier
// per Konstruktion unerreichbar: assertConfig() faltet ihn in seine Fatal-Menge und hat den
// Prozess bei diesem Zustand laengst mit exit(1) beendet - hier bleibt nur die WARN.
// OUTBOUND-E3b: alertChannelFindings liest jetzt zusaetzlich platformAlertMailTo (Namespace
// mail) und elevenLabsOutboundEnabled (Namespace voice) - config.billing ALLEIN wuerfe hier
// (guardedConfig lehnt jeden Zugriff auf eine Property AUSSERHALB des eigenen Namespace
// fail-closed ab, Tippfehler-Riegel). Die Zusammenfuehrung selbst kommt aus
// boot-guard.alertChannelInputs (G5-Fix: EINE Quelle statt zweier byte-identischer Kopien,
// geteilt mit fatalConfigFindings in config.js).
function warnAlertChannelUnset(config) {
  const alertChannelConfig = alertChannelInputs({
    billing: config.billing,
    mail: config.mail,
    voice: config.voice,
  });
  for (const finding of alertChannelFindings(alertChannelConfig))
    console.warn(`[boot] Konfig-Warnung: ${finding.message}`);
}

// KV2-1 (Kriterium (d)): der Alarm-Empfaenger des KOSTENpfads als harte Vorbedingung.
// WARN wie warnAlertChannelUnset - PLUS ein DURABLER Eintrag: die ganze Phase existiert,
// weil eine Log-Zeile auf einem Free-Tier-Dyno keine Spur ist (AUFTRAG B3). Der Wert wird
// NIE geloggt; das Detail nennt nur die Kanal-Art.
function warnKostenAlarmZielUnset(config, durableAudit) {
  const [finding] = kostenAlarmFindings({ billing: config.billing, mail: config.mail });
  if (!finding) return;
  console.warn(`[boot] Konfig-Warnung: ${finding.message}`);
  durableAudit(finding.code, null, `kanaele=${ALARM_KANAL.KEINE}`);
}

// OUTBOUND-E1: reine Diagnose, NIE fatal (s. platformAniFindings). Loggt die Nummer nie.
function warnPlatformAniUnset(config) {
  for (const finding of platformAniFindings({
    platformAniE164: config.provisioning.platformAniE164,
    elevenLabsOutboundEnabled: config.voice.elevenLabsOutbound.enabled,
  }))
    console.warn(`[boot] ${finding.message}`);
}

// OUTBOUND-E4: reine Diagnose, NIE fatal (s. driftConfigFindings). Loggt keine ID.
function warnOutboundDriftConfigUnset(config) {
  for (const finding of driftConfigFindings({
    fqdnConnectionId: config.telephony.telnyxFqdnConnectionId,
    outboundVoiceProfileId: config.telephony.telnyxOutboundVoiceProfileId,
    elevenLabsOutboundEnabled: config.voice.elevenLabsOutbound.enabled,
  }))
    console.warn(`[boot] ${finding.message}`);
}

// LCT P5: Drift-Waechter, Ausloeser 1 von 2 (Boot). GENAU EINE Zeile fuer ALLE Praefixe -
// nicht eine je Praefix je Boot (Risiko-Abschnitt der Phase: WARN-Muedigkeit). WARN nur,
// wenn ueberhaupt ein Befund vorliegt; ein durchweg im Band liegender Zustand loggt ruhig.
// KEIN SMS-Alarm hier: der Boot feuert einmal je Prozessstart, der laufende Alarm haengt am
// Sweep (src/billing/cost-truing.js). KEIN Audit: der Befund aendert nichts daran, WAS der
// Dienst ablehnt - Muster warnAlertChannelUnset.
function warnTariffDrift(config, store) {
  const report = tariffDriftReportFromConfig(store.load().calls, config.billing);
  const line = `[boot] Tarif-Drift: ${report.map(driftLine).join(" | ")}`;
  if (report.some((entry) => entry.code !== null)) console.warn(line);
  else console.log(line);
}

// KV2-10: Tarifpaar-Waechter, Ausloeser Boot (Kriterium (e)). GENAU EINE Zeile fuer ALLE
// Routen (Muster warnTariffDrift: keine Zeile je Route je Boot - WARN-Muedigkeit). KEIN
// SMS/KEIN Mail hier - der laufende Alarm haengt am Sweep (cost-truing.js, derselbe Grund
// wie beim Drift-Waechter: der Boot feuert einmal je Prozessstart). KEIN Audit: der Befund
// aendert nichts daran, WAS der Dienst ablehnt. eigenCentJeAnruf bleibt null, solange keine
// je-Anruf-Quelle fuer die Eigen-Achsen existiert (benannter offener Punkt, s. Kopfkommentar
// der Tarifpaar-Sektion in cost-calibration.js) - der Waechter ist dann sichtbar-wartend
// (tarifpaar_zu_wenig_proben), nie scheinbar-messend.
function warnTarifpaar(config, store) {
  const report = tarifpaarReport({ state: store.load(), eigenCentJeAnruf: null, billing: config.billing });
  const line = `[boot] Tarifpaar: ${report.map(tarifpaarZeile).join(" | ")}`;
  if (report.some((entry) => entry.code !== null)) console.warn(line);
  else console.log(line);
}

// LCT P4b: Vollkosten-Boot-Guard (WARN). Haelt den konfigurierten Inlandstarif gegen die
// Vollkostenschwelle; die live aus dem Spiegel gerechnete Deckungsquote reist als Kontext
// mit (voiceTariffFloorFindings feuert seit KV2-10 auf belowFloor ALLEIN, nicht mehr in
// der Konjunktion mit duenner Deckung). Deckungsquote + Schwelle liefert currentCoverage
// (dieselbe EINE Quelle wie der P4-Guard). WARN, kein exit(1). An KEIN Flag gekoppelt: der
// Tarif ist auch ohne aktive Korrekturbuchung der Buchungswert jedes nicht abgeglichenen Calls.
function warnVoiceTariffBelowFullCost(config, store) {
  const findings = voiceTariffFloorFindings({
    domesticTariffCents: config.billing.voiceTariffDomesticCents,
    fullCostFloorCents: config.billing.voiceTariffFullCostFloorCents,
    ...currentCoverage(config, store),
  });
  for (const finding of findings) console.warn(`[boot] Konfig-Warnung: ${finding.message}`);
}

// GAP-22: Turn-Budget gegen den Provider-Hardcut. WARN, kein exit(1) - eine gesprengte
// Wanduhr ist kein Safety-Gate und kein Geldleck (Regel 1 unberuehrt); ein Boot-Refusal
// waere ein selbst verursachter Ausfall aus einem Env-Tippfehler. Feuert NUR im
// Verletzungsfall, damit die ausgelieferte Konfiguration keine Zeile erzeugt.
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

// AL-P6: der Bestands-Waechter oben misst EINE llm.complete-Kette gegen den Provider-
// Hardcut. Dieser hier misst den TURN als Ganzes (bis zu MAX_TOOL_ROUNDS_PER_TURN Runden,
// mit greifender Frist) gegen den Dead-Air-Watchdog des Assistant-Pfads: reisst der Turn
// ihn, beendet der Watchdog mitten im Satz. WARN, kein exit(1) - eine gesprengte Wanduhr
// ist kein Safety-Gate (Muster warnTurnBudgetOverrun). Nur bei aktivem Assistant-Pfad:
// ohne Flag wird der Dead-Air-Timer nie armiert, die Warnung waere irrefuehrend
// (Praezedenz warnMissingProvisioningConnection).
function warnTurnOutlivesDeadAir(config) {
  if (!config.telnyx.telnyxAssistant.enabled) return;
  const finding = deadAirOverrun({
    deadAirTimeoutMs: config.telnyx.telnyxAssistant.deadAirTimeoutS * MS_PER_SECOND,
    requestTimeoutMs: config.llm.llmRequestTimeoutMs,
    maxRetries: config.llm.llmMaxRetries,
    backoffMs: config.llm.llmBackoffMs,
    synthTimeoutMs: config.voice.elevenLabsPlayTts.synthTimeoutMs,
  });
  if (!finding) return;
  console.warn(
    `[boot] Konfig-Warnung: ein Turn kann ${finding.worstCaseMs} ms dauern und reisst den ` +
      `Dead-Air-Watchdog ${finding.limitMs} ms um ${finding.overrunMs} ms ` +
      "(TELNYX_DEAD_AIR_TIMEOUT_S/LLM_REQUEST_TIMEOUT_MS/LLM_MAX_RETRIES/LLM_BACKOFF_MS/" +
      "ELEVENLABS_SYNTH_TIMEOUT_MS).",
  );
}

// FW2: der Ausweich-Anbieter ist gesetzt, kann aber nicht ausweichen. WARN (s. Guard).
function warnLlmFallbackUnusable(config) {
  for (const finding of llmFallbackFindings({
    provider: config.llm.llmProvider,
    fallback: config.llm.llmProviderFallback,
  }))
    console.warn(`[boot] Konfig-Warnung: ${finding.message}`);
}

// GAP-19 (erste Haelfte): FORCE_NUMBER_COUNTRY entkoppelt das Kauf-Land vom Herkunftsland -
// jeder neue Tenant telefoniert dann unter auslaendischer Absenderkennung. WARN, kein exit(1):
// das IST der gewollte Live-Zustand (render.yaml), ein Boot-Refusal waere ein selbst
// verursachter Totalausfall der Telefonie (Praezedenz warnTariffDrift). Die Zeile ist der
// Betriebs-Ack, den GAP-19 verlangt: sie erscheint bei JEDEM Start, solange der Override
// steht - und genau derselbe Zustand schaltet in der Outbound-Kette das Herkunfts-Gate ab
// (numberOriginDecoupled, EINE Quelle). Landescodes sind kein Secret und kein PII.
function warnNumberOriginDecoupled(config) {
  if (!numberOriginDecoupled(config.provisioning)) return;
  console.warn(
    `[boot] Konfig-Warnung: FORCE_NUMBER_COUNTRY=${config.provisioning.forceNumberCountry} kauft JEDE neue ` +
      "Rufnummer in diesem Land, unabhaengig vom Herkunftsland des Kunden " +
      `(Plattform-Land PROVISIONING_COUNTRY=${config.provisioning.provisioningCountry}). Betroffene Tenants ` +
      "telefonieren unter auslaendischer Absenderkennung (Zustellrate/Reputation); das Herkunfts-Gate der " +
      "Outbound-Kette laesst diese Anrufe deshalb bewusst passieren.",
  );
}

// Restluecke im Nummern-Lebenszyklus (Owner-Entscheidung 2026-07-27): mit aktivem
// Provisioning geht die Telnyx-Bestellung ohne connection_id raus (numbers.js setzt das Feld
// nur, wenn es gesetzt ist) - die Nummer wird gekauft, kostet Miete und traegt trotzdem KEIN
// Voice-Routing, waehrend activateNumber sie auf 'active' hebt. Der Guard unterscheidet
// 'fehlt' von 'gesetzt' und feuert nur, wenn ueberhaupt gekauft werden kann. WARN, kein
// exit(1): der Fehlausgang trifft KUENFTIGE Kaeufe, ein Boot-Refusal legte den gesamten
// laufenden Telefoniebetrieb still - der teuerste Fehlausgang (Praezedenz warnTariffDrift).
function warnMissingProvisioningConnection(config) {
  if (!config.provisioning.provisioningEnabled || config.telephony.telnyxConnectionId) return;
  console.warn(
    "[boot] Konfig-Warnung: PROVISIONING_ENABLED=true ohne TELNYX_CONNECTION_ID - gekaufte Nummern " +
      "gehen ohne Voice-Routing raus und werden trotzdem aktiv geschaltet.",
  );
}

// OUTBOUND-E5 (F3): WARN statt Boot-Refusal (Muster warnMissingProvisioningConnection) -
// ein Boot-Refusal wegen einer fehlenden EL-Nummernregistrierungs-Angabe taeuschte einen
// Inbound-Totalausfall vor, obwohl NUR das Anlegen neuer Registrierungen betroffen ist
// (Praezedenz PLATFORM_ANI_E164, E1: ein Outbound-Problem wird nicht gegen einen
// Inbound-Totalausfall getauscht). Der Registrar WIRD injiziert (der Orchestrator prueft
// nur PROVISIONING_ENABLED/ELEVENLABS_OUTBOUND_ENABLED/numberRegistrationEnabled, nicht die
// SIP-Zugangsdaten) - die eigentliche Sicherung sitzt in makeElSipRegistrar#ensureRegistration
// (Review-Blocker Runde 1: wirft VOR jedem Netzzugriff, faengt jeder Aufrufer als benannten
// Fehlschlag ab, keine Registrierung mit leeren credentials). Diese Zeile macht die
// Fehlkonfiguration zusaetzlich schon beim Boot SICHTBAR, statt sie erst beim ersten
// Nummernkauf als Log-Zeile auffallen zu lassen.
function warnElRegistrationSipCredsMissing(config) {
  if (!config.voice.elevenLabsOutbound.numberRegistrationEnabled) return;
  if (config.telephony.telnyxSipTrunkUsername && config.telephony.telnyxSipTrunkPassword) return;
  console.warn(
    "[boot] Konfig-Warnung: ELEVENLABS_NUMBER_REGISTRATION_ENABLED=true ohne " +
      "TELNYX_SIP_TRUNK_USERNAME/TELNYX_SIP_TRUNK_PASSWORD - das Anlegen neuer " +
      "ElevenLabs-Nummernregistrierungen schlaegt fail-closed fehl (benannte Log-Zeile je " +
      "DID), bestehende DIDs bleiben nutzbar.",
  );
}

// KV-P7/KV2-2/IE3: vier latente Kosten-Pfade sichtbar machen (latentCostPathFindings, s.
// boot-guard.js fuer die Begruendung je Befund). realtimeMidCallBudgetCheck kommt aus
// GENAU EINER Quelle (REALTIME_MID_CALL_BUDGET_CHECK, src/bridge.js) - kein zweites Flag
// hier. KV2-2 (h): der dritte Befund (REALTIME_CARRIER_UNCOLLECTED) kann jetzt FATAL sein
// - Name deshalb "assert" statt "warn" (N7, kann den Prozess beenden), Umgang ueber
// applyBootFindings (G5) statt eines eigenen console.warn-Loops.
// realtimeCarrierHasCollector: EINE Quelle - die Profil-Registry (kostenarten.js), nicht
// ein zweites Flag hier.
function assertLatentCostPaths(config) {
  // IE3: EINE Quelle fuer "hat der neue Inbound-Weg einen belegten Kostenpfad" - die
  // Profil-Registry, nicht ein zweites Flag hier. Benanntes Zwischenergebnis (G19), weil
  // die Ableitung eine Aussage ist: leere Liste heisst "unbekanntes Profil ODER kein
  // Traeger mit Einsammler", und beides ist genau der Fall, den der Riegel faengt.
  const elInboundPflichtTraeger = pflichtTraegerFuerProfil(KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI);
  applyBootFindings(
    latentCostPathFindings({
      playTtsEnabled: config.voice.elevenLabsPlayTts.enabled,
      realtimeEngineSelected: config.voice.voiceEngine === VOICE_ENGINE.REALTIME,
      realtimeMidCallBudgetCheck: REALTIME_MID_CALL_BUDGET_CHECK,
      realtimeCarrierHasCollector: hatEinsammler(KOSTENART.OPENAI_REALTIME),
      elInboundEnabled: config.voice.elevenLabsInbound.enabled,
      elInboundCarrierHasCollector: elInboundPflichtTraeger.length > 0,
    }),
  );
}

// Alle fail-closed Boot-Gates gebuendelt (macht INV-5 "rearm NACH allen exit1-Gates"
// strukturell sichtbar - kein Code danach kann ein Gate vergessen). Die vier
// Bestands-Gates unten pruefen zuerst; assertSpendCapCoherence (P3, Klausel B) ist
// das fuenfte, assertProviderRateInBand (LCT P4) das sechste, assertCostTruingBooking
// (LCT P4) das siebte, assertSttProfile (STT-A1) das achte, assertPricedModels (B4a)
// das neunte, assertPricedPlans (GP-P6) das zehnte und assertLatentCostPaths (KV2-2 (h))
// das elfte, das noch process.exit(1)
// rufen kann - warnStaleModelPrices/warnAlertChannelUnset/warnTariffDrift/
// warnNumberOriginDecoupled/warnMissingProvisioningConnection/
// warnElRegistrationSipCredsMissing/warnLlmFallbackUnusable (FW2) sind reine Diagnose
// (nie fatal). warnKostenAlarmZielUnset
// (KV2-1) ist ebenfalls reine Diagnose, nie fatal - PLUS ein durabler Eintrag (s. dort).
function assertBootGates(config, store, durableAudit) {
  const ok = assertConfig();
  // Fail-closed (OT-4): bei ungueltiger Safety-/Pflicht-Konfiguration wird der Dienst
  // GAR NICHT gestartet - kein app.listen, kein /voice, kein /mcp, keine Audio-Bridge.
  // Lieber kein Dienst als ein Dienst mit lautlos abgeschaltetem Budget-/Kosten-Gate
  // (R4 Toll-Fraud). Die actionable Diagnose hat assertConfig() bereits ausgegeben.
  if (!ok) {
    console.error("[boot] Start abgebrochen: Safety-/Pflicht-Konfiguration ungueltig (siehe oben).");
    process.exit(1);
  }

  // Boot-Haertung (OUT-05, F2): FAKE_ORIGINATE nur mit geskippter Signaturpruefung zulaessig ->
  // in Prod (Signatur fail-closed AN, Regel 1) Boot-Refusal statt stillem Nicht-Waehlen.
  // OUT-05-EL (Owner-Auftrag 15.08.2026, Aufgabe 1): FAKE_ORIGINATE_ELEVENLABS (der EL-
  // Anrufstart-Gegenstueck, src/elevenlabs/outbound.js) teilt dieselbe Bedingung - ZWEI
  // Aufrufe derselben reinen Funktion auf zwei verschiedenen Flags (G5), keine zweite
  // Guard-Logik.
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

  // Boot-Guard (Pre-Mortem): jeder Tenant - auch der Bootstrap-Tenant - haelt seine
  // Absendernummer im Store, nicht in der Env. Tenant-agnostisch (P2b): der Dienst ist
  // "telefonbar", sobald IRGENDEIN Tenant eine aktive Nummer hat (kein OWNER/BOOTSTRAP-Pin
  // mehr). Nach lokalem Reset (data/store.json geloescht) oder frischem Postgres ohne Seed
  // waere keine aktive Nummer da -> Outbound + SMS still tot. Fail-closed wie die fruehere
  // Nummern-Boot-Pflicht aus der Env: leerer Store -> kein Start. Loggt KEINE Nummer (kein Leak),
  // verweist auf das Bootstrap-CLI.
  if (!hasActiveNumber(store.load())) {
    console.error(
      "[boot] Keine aktive Nummer im Store. Erst seeden: " +
        "npm run bootstrap-tenant -- <e164> <provider>",
    );
    process.exit(1);
  }

  // S1-7: Vollstaendigkeit der Stripe-Meter-Abbildung. Fehlt einer usage_event-Sorte ein
  // event_name, wirft reportMeter erst zur LAUFZEIT (beim ersten Flush dieser Sorte) - der
  // Umsatz dieser Sorte bliebe unbemerkt endlos pending. Boot-Zeit-Assertion statt spaeter
  // Ueberraschung (Muster der drei vorigen Gates).
  const meterGaps = meterMappingGaps(Object.values(USAGE_EVENT_KIND), STRIPE_METER_EVENT_NAME);
  if (meterGaps.length) {
    console.error(
      `[boot] Start abgebrochen: usage_event-Sorten ohne Stripe-Meter-Abbildung: ${meterGaps.join(",")}. ` +
        "STRIPE_METER_EVENT_NAME in src/billing/stripe.js vervollstaendigen.",
    );
    process.exit(1);
  }

  // P3: Boot-Guards Konfig-Kohaerenz (Budget-Achsen gegeneinander) + Modellpreise. NACH
  // allen vier obigen Gates, DAMIT assertConfig() bereits gelaufen ist (Zahlen validiert)
  // und die bestehenden Gates ihre exakte Ausgabe-Reihenfolge behalten. Beide koennen
  // NOCH process.exit(1) rufen (assertSpendCapCoherence bei Klausel B) - deshalb MUESSEN
  // sie vor rearmActiveCallTimers() stehen (INV-5, s.u. in bootServer).
  assertSpendCapCoherence(config);
  assertPricedModels(config); // B4a: FATAL, s. dort
  assertPricedPlans(config); // GP-P6: FATAL nur bei PAYMENT_ENABLED=true, s. dort
  warnStaleModelPrices(config); // B4a: WARN
  assertProviderRateInBand(config);
  assertCostTruingBooking(config, store);
  assertSttProfile(config);
  warnAlertChannelUnset(config);
  warnKostenAlarmZielUnset(config, durableAudit); // KV2-1, WARN + durabel
  warnPlatformAniUnset(config); // OUTBOUND-E1, WARN
  warnOutboundDriftConfigUnset(config); // OUTBOUND-E4, WARN
  warnTariffDrift(config, store);
  warnTarifpaar(config, store); // KV2-10, WARN: Tarifpaar-Waechter feuert beim Start
  warnVoiceTariffBelowFullCost(config, store); // NEU: LCT P4b, WARN
  warnTurnBudgetOverrun(config); // GAP-22, WARN
  warnTurnOutlivesDeadAir(config); // AL-P6, WARN
  warnLlmFallbackUnusable(config); // FW2, WARN
  warnNumberOriginDecoupled(config); // GAP-19, WARN
  warnMissingProvisioningConnection(config); // Nummern-Lebenszyklus, WARN
  assertLatentCostPaths(config); // KV-P7/KV2-2 (h): kann exit(1)
  warnElRegistrationSipCredsMissing(config); // OUTBOUND-E5, WARN
}

// Welche Budget-Achse die Gates messen (Budget-Achsen P7). Eigene Funktion, damit die
// Banner-Zeile eine Abstraktionsebene bleibt (G34) und die Bedingung einen Namen hat (G28).
//
// GAP-01 (P6) hat gateUsageCents (Tenant-Achse) und gatePlatformUsageCents (Plattform-
// Achse) bei Flag AUS auseinandergezogen: die Tenant-Achse misst seither das Stripe-
// Perioden-Fenster (budgetPeriodUsageCents), die Plattform-Achse bleibt beim Lebenszeit-
// Topf (globalUsageTotals; seit KS-P9 nur noch Beobachtung). Bei Flag AN messen BEIDE Achsen weiter
// denselben Spend-Monat (spendMonthUsageCents/platformSpendMonthCents) - dort gibt es
// keine Divergenz. axisLabelWhenFlagOff traegt daher NUR den Flag-AUS-Text der jeweiligen
// Achse (G5: der Flag-AN-Zweig ist fuer beide Achsen identisch und steht nur einmal hier).
export function budgetAxisLabel(budgetMonthEnabled, axisLabelWhenFlagOff) {
  return budgetMonthEnabled
    ? "Spend-Monat (BUDGET_MONTH_ENABLED=true)"
    : `${axisLabelWhenFlagOff} (BUDGET_MONTH_ENABLED=false)`;
}

// AL-P1 (O1-Sonde): welcher Pfad live laeuft, waren ZWEI unabhaengige Schalter -
// VOICE_ENGINE stand im Banner, das Assistant-Flag nirgends. Genau diese Blindheit hat den
// Plan eine Messrunde gekostet. Eigene Funktion, damit die Banner-Zeile eine
// Abstraktionsebene bleibt (G34) und die Bedingung einen Namen hat (G28).
export function assistantPathLabel(assistantEnabled) {
  return envFlagState("TELNYX_AI_ASSISTANT_ENABLED", assistantEnabled);
}

// GQ-P3: der Master-Schalter darueber meldete "AKTIV", waehrend INBOUND ueber die
// Budget-Engine lief - diese Luege darf nicht zurueckkehren. Beide Schalter getrennt,
// unkonditional (Muster capabilityProbeLines): eine im Aus-Zustand verschwindende Zeile
// waere im Live-Log nicht von einem Deploy ohne Sonde zu unterscheiden.
// Die Zeile faellt KEIN Gesamturteil - Provider und Body-Feld entscheiden je Anruf und
// stehen in der inbound_path-Zeile je Leg (telnyx-inbound.js).
export function inboundHandoffProbeLine(telnyxAssistant) {
  return probeLine(
    "Inbound-Handoff",
    envFlagState("TELNYX_INBOUND_HANDOFF_ENABLED", telnyxAssistant.inboundHandoffEnabled),
    `wirkt nur mit TELNYX_AI_ASSISTANT_ENABLED=${telnyxAssistant.enabled} und Telnyx als Inbound-Provider`,
  );
}

// Messschalter (transcriptionFields, adapters/telnyx/voice.js): welcher Wert live steht,
// war in diesem Projekt mehrfach nicht ablesbar - ein Schalter ohne Sonde ist eine neue
// blinde Stelle (Muster inboundHandoffProbeLine, unkonditional). Fuer EINEN begleiteten
// Testanruf gedacht, kein Dauerbetrieb.
export function perCallTranscriptionProbeLine(telnyxAssistant) {
  return probeLine(
    "Pro-Call-Transkription",
    envFlagState(
      "TELNYX_PER_CALL_TRANSCRIPTION_ENABLED",
      telnyxAssistant.perCallTranscriptionEnabled,
    ),
    "aus -> kein transcription-Feld im Call-Control-Body, Assistant-Config entscheidet allein",
  );
}

// AL-P14: der In-Call-Consult exportiert Inhalte aus einem LAUFENDEN Gespraech an den
// MCP-Host. Ein solcher Schalter darf nicht unbemerkt scharf sein (Muster
// assistantPathLabel). Aus -> keine Zeile, Banner byte-identisch.
export function inCallConsultBannerLine(tenancy) {
  return tenancy.inCallConsultEnabled ? "In-Call-Consult: AKTIV (IN_CALL_CONSULT_ENABLED=true)" : "";
}

// AL-P7: welcher Draht live laeuft, darf nicht wieder nur im Code stehen (die
// Assistant-Flag-Blindheit hat den Plan schon eine Messrunde gekostet). Aus -> keine
// Zeile, Banner byte-identisch (Muster inCallConsultBannerLine).
export function tokenStreamingBannerLine(telnyxAssistant) {
  return telnyxAssistant.shimTokenStreaming
    ? "Token-Streaming: AKTIV (TELNYX_SHIM_TOKEN_STREAMING=true)"
    : "";
}

// AL-P7b: das Denk-Signal aendert, WAS der Anrufer hoert. Ein solcher Schalter darf nicht
// unbemerkt scharf sein (Muster tokenStreamingBannerLine / inCallConsultBannerLine, und die
// Repo-Lehre "Deploy-Stand nie aus einer Notiz lesen"). Aus -> keine Zeile, Banner
// byte-identisch.
export function thinkingSignalBannerLine(voice) {
  return voice.thinkingSignalEnabled ? "Denk-Signal: AKTIV (THINKING_SIGNAL_ENABLED=true)" : "";
}

// ---- AL-P16: Boot-Sonden fuer die blinden Schalter -------------------------------
// Am 2026-08-01 waren Faehigkeiten scharf geschaltet, bei denen "gesetzt" nicht dasselbe
// ist wie "wirkt" - und der Unterschied war am laufenden Dienst nicht ablesbar. Zweimal
// an einem Tag war der Grund derselbe: das Plattform-Flag stand auf true, das
// Per-Tenant-Recht auf false.
//
// REGEL FUER ALLE SONDEN-ZEILEN: AKTIV/aus meldet AUSSCHLIESSLICH den Plattform-Schalter
// in der Klammer. Was nach dem Gedankenstrich steht, sind die UEBRIGEN Bedingungen - die
// Sonde faellt kein Gesamturteil. Das ist Absicht: die Schnittmenge entscheiden die Gates
// (consult/gate.js, research/registry.js, precall-briefing.js); ein zweites Urteil hier
// waere eine Kopie davon (G5) und das Per-Tenant-Recht ist zur Bootzeit ohnehin nicht
// bekannt (es haengt am Tenant, nicht an der Konfiguration).
//
// Die Sonden lesen die FERTIG GEPARSTE Konfiguration (Namespaces tenancy/research/
// privacy), nie process.env - eine Sonde auf der Rohumgebung beweist nichts ueber den
// Code-Pfad, den der Dienst wirklich faehrt.
//
// Anders als Token-Streaming/Denk-Signal/In-Call-Consult verschwinden diese Zeilen im
// Aus-Zustand NICHT: eine fehlende Zeile waere im Live-Log nicht von einem Deploy ohne
// die Sonde zu unterscheiden - genau diese Unterscheidung ist der Zweck der Phase.

// EIN Format fuer jeden Schalter-Zustand (G5). value getrennt von active, weil nicht jeder
// Schalter ein Bool ist (EVIDENCE_RETENTION_DAYS traegt eine Frist).
function envState(envKey, value, active) {
  return `${active ? "AKTIV" : "aus"} (${envKey}=${value})`;
}

// Bool-Schalter: der Wert IST der Zustand.
function envFlagState(envKey, on) {
  return envState(envKey, on, on);
}

function probeLine(label, state, remainingConditions) {
  return `${label}: ${state} - ${remainingConditions}`;
}

// Ohne den Kontext-Kanal hat das Briefing keinen Konsumenten (briefingActive()).
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

// Zweiteilig: Flag UND Anbieter-Schluessel. NIEMALS den Schluessel selbst (Regel 4) -
// nur, ob er da ist.
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

// Kein Bool, sondern eine Frist - die Zahl ist die Aussage. Der Aus-Zustand kommt aus
// evidenceRetentionEnabled: dieselbe Entscheidung, die auch bestimmt, ob ueberhaupt ein
// Zitat erhoben wird.
function evidenceProbeLine(privacy) {
  const days = privacy.evidenceRetentionDays;
  const collecting = evidenceRetentionEnabled(privacy);
  return probeLine(
    "Ergebnis-Zitate",
    envState("EVIDENCE_RETENTION_DAYS", days, collecting),
    collecting ? `Zitate werden erhoben und nach ${days} Tagen geloescht` : "0 = keine Zitate",
  );
}

// GQ-P11: ebenfalls kein Bool, sondern eine Frist (Muster evidenceProbeLine). Bis hierher
// war der Live-Wert nicht ablesbar - die einzige andere Zeile (runRetention) druckt NUR,
// wenn der Sweep etwas geloescht hat, ihre Abwesenheit beweist also nichts. Der
// Aus-Zustand kommt aus diagnosticRetentionEnabled, damit dieselbe Entscheidung die Sonde
// traegt wie den Code.
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

/**
 * Die AL-P16-Sonden in Banner-Reihenfolge (vor dem Anruf -> im Anruf -> nach dem Anruf).
 * Rein: Konfiguration rein, Zeilen raus - gedruckt wird ausschliesslich in logBootBanner.
 *
 * @param {{ tenancy: object, research: object, privacy: object }} config
 * @returns {string[]}
 */
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

// ---- KV-M0: Live-Konfiguration im Boot-Banner --------------------------------------
// Sieben Werte, die die Kosten-Vollstaendigkeits-Rechnung tragen, waren in Prod nicht
// lesbar (kein Render-Lesetool fuer Env-Werte) - jede Untersuchung musste aus
// Ledger-Zeilen rueckschliessen, was gesetzt ist. Reine Funktionen (Muster
// capabilityProbeLines): Konfiguration rein, Zeilen raus - gedruckt wird ausschliesslich
// in logBootBanner. NUR Zahlen/Booleans/Modell-IDs/Typenlisten - NIE ein Secret (Regel 4).

// Ein Literal fuer "strukturell nicht gesetzt" (G25/G5). Nur costTruingRequiredRecordTypes
// (leeres Array) und flushEpochIso (null) koennen diesen Zustand ueberhaupt einnehmen -
// die uebrigen fuenf Werte in dieser Gruppe loesen in config.js immer schon auf einen
// funktionierenden Fallback auf (PAYMENT_ENABLED=false, SMS_COST_CENTS=0, Modell-IDs,
// ELEVENLABS_PLAY_TTS_ENABLED=false); sie koennen "nicht gesetzt" nicht anzeigen, ohne
// ueber die tatsaechlich laufende Konfiguration zu luegen.
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

/**
 * KV-M0: die drei Konfigurations-Zeilen in Banner-Reihenfolge. Rein wie
 * capabilityProbeLines - gedruckt wird ausschliesslich in logBootBanner.
 *
 * @param {{ billing: object, llm: object, voice: object }} config
 * @returns {string[]}
 */
export function costConfigBannerLines({ billing, llm, voice }) {
  return [
    paymentConfigBannerLine(billing),
    costTruingTypesBannerLine(billing),
    modelConfigBannerLine(llm, voice),
  ];
}

// B4a: welche Preisstaffel faehrt dieser PROZESS? Ohne diese Zeile ist der einzige
// Restfall der Boot-Aufloesung unsichtbar: ein Prozess, der ueber einen validFrom-Termin
// hinweg laeuft, bucht bis zum Neustart die alte Staffel. Eigene reine Funktion statt
// einer Faltung in costConfigBannerLines (G30: eine Aufgabe je Funktion) - jene wird in
// den Bestandstests mit einer llm-Attrappe OHNE modelPricesUsd gefahren. Gegen die
// AUFGELOESTE Config, nicht process.env.
//
// Der Zugriff ist per Konstruktion sicher: assertPricedModels hat den Prozess vorher
// beendet, falls ein konfiguriertes Modell fehlt - kein defensiver Zweig (waere G9).
const NO_NEXT_SCHEDULE_LABEL = "keine";

export function modelPriceScheduleBannerLine(llm) {
  const label = (modelId) => {
    const price = llm.modelPricesUsd[modelId];
    return `${modelId} ab ${price.validFrom} (naechste: ${price.nextValidFrom || NO_NEXT_SCHEDULE_LABEL})`;
  };
  return `Preisstaffeln: ${label(llm.claudeModel)} | ${label(llm.briefingModel)}`;
}

// KV-P7: Deckungshinweis des ElevenLabs-Kontingents - PERMANENT im Banner, unabhaengig von
// jedem Flag (Play-TTS an/aus, Relay an/aus). Der Zaehler ist seit dieser Phase nicht mehr
// blind (Massnahme 3, recordRelayTtsCharacters), bleibt aber eine UNTERGRENZE: Zeichen
// kommen erst verzoegert an (Ist-Abgleich, nicht Echtzeit) und nur bei vollstaendigem
// Beleg-Pool (complete:true) - genau der Rest, aus dem sonst wieder falsche Sicherheit
// abgeleitet wuerde. Reine Funktion (Muster costConfigBannerLines) gegen die AUFGELOESTE
// Config, NICHT process.env.
export function ttsQuotaCoverageBannerLine(billing) {
  return (
    `ElevenLabs-Kontingent: TTS_CHARACTER_QUOTA=${billing.ttsCharacterQuota} Zeichen/Zyklus | ` +
    "Relay-Verbrauch: nachtraeglich ueber den Ist-Abgleich gezaehlt (UNTERGRENZE - nur belegte Anrufe)"
  );
}

// G5/G28: derselbe Fallback stand dreimal im Banner-Rumpf (MCP, Voice-Webhook,
// Status-Callback) - EIN Name dafuer, eine Stelle. Wortlaut unveraendert; die drei Zeilen
// bleiben Zeichen fuer Zeichen dieselben.
function publicUrlOrHint(server) {
  return server.publicUrl || "PUBLIC_URL fehlt!";
}

function logBootBanner(config, port) {
  // GAP-36 (Deploy-Wahrheit): deployter Commit + Konfigurations-Fingerabdruck. KEINE
  // TEMP-DIAGNOSE mehr - die Zeile ist der Log-seitige Zwilling von /healthz (derselbe
  // Wert aus derselben Quelle, G5) und wird von docs/RUNBOOK-RESTORE.md gelesen.
  // Wortlaut der commit-Zeile bewusst unveraendert (das Runbook greppt sie).
  console.log(`  [boot] deployed commit=${config.server.deployedCommit}`);
  console.log(`  [boot] configHash=${configFingerprint(config)}`);
  console.log(`\n  Hermes Gateway laeuft auf ${gatewayUrlForPort(port)}`);
  console.log(`  Dashboard:      ${gatewayUrlForPort(port)}`);
  console.log(
    `  Voice-Engine:   ${config.voice.voiceEngine}${config.voice.voiceEngine === VOICE_ENGINE.REALTIME && !config.voice.openaiApiKey ? "  (ACHTUNG: OPENAI_API_KEY fehlt!)" : ""}`,
  );
  console.log(`  Assistant-Pfad: ${assistantPathLabel(config.telnyx.telnyxAssistant.enabled)}`);
  console.log(`  ${inboundHandoffProbeLine(config.telnyx.telnyxAssistant)}`);
  console.log(`  ${perCallTranscriptionProbeLine(config.telnyx.telnyxAssistant)}`);
  const inCallConsult = inCallConsultBannerLine(config.tenancy);
  if (inCallConsult) console.log(`  ${inCallConsult}`);
  const tokenStreaming = tokenStreamingBannerLine(config.telnyx.telnyxAssistant);
  if (tokenStreaming) console.log(`  ${tokenStreaming}`);
  const thinkingSignal = thinkingSignalBannerLine(config.voice);
  if (thinkingSignal) console.log(`  ${thinkingSignal}`);
  // AL-P16: die Sonden stehen unkonditional, auch im Aus-Zustand (s. Kommentar bei
  // capabilityProbeLines).
  for (const line of capabilityProbeLines(config)) console.log(`  ${line}`);
  console.log(
    `  MCP (HTTP):     ${publicUrlOrHint(config.server)}/mcp  <- als Custom Connector in Claude eintragen`,
  );
  console.log(`  Voice-Webhook:  ${publicUrlOrHint(config.server)}/voice/incoming`);
  console.log(`  Status-Callback:${publicUrlOrHint(config.server)}/voice/status`);
  // Outbound-Freigabe (outbound-p3): keine statische ALLOWED_NUMBERS-Liste mehr - Permit ist
  // die per-Tenant-Verifikation (Abo+KYC, Pfad 2). OUTBOUND_FROZEN zeigt den globalen
  // Kill-Switch-Zustand. Kein PII (Nummern) mehr im Banner.
  console.log(
    `  Outbound:       ${config.safety.outboundFrozen ? "EINGEFROREN (OUTBOUND_FROZEN=true)" : "aktiv (Verifikation per Tenant: Abo+KYC)"}`,
  );
  console.log(
    `  Nummern-Gates:  Land ${config.safety.allowedCountryCodes.join(",")} | max ${config.safety.maxCallsPerHour} Calls/h pro Tenant | Notruf-/Premium-Denylist aktiv`,
  );
  // GAP-36-Zusatz: welche Achse das Budget-Gate misst, war bisher NUR per DB-Messung
  // ablesbar (der Flip hat keine Boot-Ausgabe) - genau die Blindheit, die diese Phase
  // schliesst. Ein Safety-Gate-Schalter gehoert in den Boot-Banner.
  // Zwei Zeilen statt einer (GAP-01-Review-Fix): Tenant- und Plattform-Achse messen bei
  // Flag AUS verschiedene Fenster (s. budgetAxisLabel oben) - EIN gemeinsames Label haette
  // hier zwangslaeufig eine der beiden Achsen falsch beschrieben.
  console.log(
    `  Budget-Achse:   Tenant ${budgetAxisLabel(config.billing.budgetMonthEnabled, "Perioden-Fenster")} | ` +
      `Plattform ${budgetAxisLabel(config.billing.budgetMonthEnabled, "Lebenszeit-Topf")} (nur Beobachtung/Warnschwelle, KS-P9)`,
  );
  // P7: WELCHE Decken das Gate misst, stand bisher nirgends im Log - nach einem Deploy war
  // nicht ablesbar, ob der Dienst die neuen Zahlen faehrt (der Betreiber muesste sie im
  // Dashboard nachschlagen). Reine Betreiber-Zahlen, kein Secret, kein PII; das Boot-Log
  // ist operator-only (NICHT /healthz, das den Hash statt der Rohwerte traegt).
  console.log(
    `  Kosten-Decken:  Tenant-Default ${config.billing.defaultTenantBudgetCents} ct | ` +
      `Plattform-Warnschwelle ${config.billing.platformSpendCapCents} ct | ` +
      `Worst-Case-Tarif ${config.billing.voiceTariffDefaultCents} ct/min`,
  );
  // KV-M0: sieben in Prod bisher nicht lesbare Werte - entsperrt jede Zahl der
  // Kosten-Vollstaendigkeits-Rechnung fuer kuenftige Untersuchungen (Muster capabilityProbeLines).
  for (const line of costConfigBannerLines(config)) console.log(`  ${line}`);
  // B4a: welche Preisstaffel dieser Prozess faehrt (gewaehlte + naechste validFrom).
  console.log(`  ${modelPriceScheduleBannerLine(config.llm)}`);
  // KV-P7: eigene Zeile, NICHT Teil der KV-M0-Dreiergruppe oben (die bleibt unangetastet) -
  // permanenter Deckungshinweis des ElevenLabs-Kontingents, unkonditional gedruckt.
  console.log(`  ${ttsQuotaCoverageBannerLine(config.billing)}`);
}

// GAP-38: heilt einen nachweislich frischen Store aus den Deploy-Parametern - der Ersatz
// fuer das Pre-Deploy-Kommando, das Render auf plan:free nie ausfuehrt. Laeuft NACH
// store.load() (ein Verbindungs-/Ladefehler hat den Prozess dort bereits beendet: pg-Init
// exitet in store.js, ein Ladefehler in bootServer) und VOR assertBootGates - der
// bestehende fail-closed Refusal bleibt die EINZIGE Stelle, die "keine Nummer -> kein
// Start" entscheidet (G5). Diese Funktion verweigert nie selbst, sie heilt oder schweigt.
// Idempotent: nach der Heilung liefert die Entscheidung NOT_NEEDED.
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
    // Gesetzt, aber unbrauchbar -> laut melden, NIE die Nummer loggen (Regel 4). Gar nicht
    // gesetzt ist der Normalfall (lokal, Tests) und bleibt still.
    if (config.provisioning.bootstrapE164)
      console.error(
        "[bootstrap-heal] BOOTSTRAP_E164/BOOTSTRAP_PROVIDER unbrauchbar " +
          "(E.164 + telnyx erwartet) - keine Heilung.",
      );
    return decision;
  }
  await store.bootstrapTenant(
    normNum(config.provisioning.bootstrapE164),
    BOOTSTRAP_TENANT_ID,
    config.provisioning.bootstrapProvider,
  );
  console.log("[bootstrap-heal] Leerer Store aus den Deploy-Parametern geheilt (in-prozess, idempotent).");
  audit("bootstrap_store_geheilt", null, `provider=${config.provisioning.bootstrapProvider}`); // KEINE E.164
  sendBootstrapAlertSms({
    messaging,
    config,
    store,
    prefix: BOOTSTRAP_HEAL_SMS_PREFIX,
    detail: "leerer Store beim Boot aus den Deploy-Parametern geheilt",
    logTag: "bootstrap-heal",
  });
  return decision;
}

// OUTBOUND-E1: die Plattform-Bindungen werden beim Boot ABGELEITET, nicht gepflegt.
// Ein Register, das jemand von Hand pflegen muss, ist leer, sobald es darauf ankommt -
// und ein leeres Register sieht aus wie ein gruenes.
// ZWEI Rollen, nicht eine: der Alarm-Absender haengt an genau demselben Mechanismus,
// der am 24.08. versagt hat (resolveBootstrapAlertSender waehlt zur Laufzeit die erste
// aktive Bootstrap-Nummer und liefert bei Verlust STILL null). Ohne die zweite Bindung
// schloesse dieser Umbau einen Fall und liesse die Klasse offen.
// Beide Bindungen tragen tenantId=null: sie sind PLATTFORM-Anlagen, egal auf welcher
// Tenant-Zeile die e164 zufaellig sitzt - genau diese Verwechslung war der Ausfall.
// Idempotent (zweimal booten = ein Zustand), store-lokal, KEIN Provider-IO. Laeuft NACH
// healBootstrapStore (die Alarm-Nummer soll die geheilte sein) und VOR assertBootGates.
// Kein Facade-Wrapper noetig (Abweichung vom ersten Entwurf, s. Report): store.load()
// und store.save() sind auf BEIDEN Backends bereits identisch - die Ableitung geht ueber
// die reine Funktion in state-ops.js, genau das Muster, das release-reconcile.js fuer
// dieselbe Bindung schon nutzt (dort: withStoreLock -> load -> ops.xxx -> save). Ein
// zusaetzlicher syncPlatformBindings/platformNumberBindings-Durchreicher auf json.js UND
// pg.js waere reine Weiterleitung ohne eigenen Wert gewesen - und auf pg.js zusaetzlich
// unerwuenscht: makePgStore traegt eine gepinnte Zeilenzahl (eslint-legacy-exceptions.json,
// Altlast-Ratsche in test/check-staged-suppressions.test.js), die kein Bau-Agent ohne
// Owner-Freigabe anheben darf - dieser Weg wächst sie nicht.
// Review-Befund E1-S1-1: aus einem formal ungueltigen PLATFORM_ANI_E164 (kein '+', nationale
// Schreibweise, Tippfehler) darf KEINE Bindung entstehen - sie saehe fuer numberBusyReason
// (strikte String-Gleichheit) ohnehin nie wie die echte number.e164 aus und war nur ein
// Riegel, der leise leerlief. Gleiche Pruef-Konstante wie platformAniFindings (boot-guard.js,
// EINE Quelle) und wie bootstrapHealDecision fuer die Schwester-Env BOOTSTRAP_E164.
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

// KV-M4: der periodische Sweep-Tick als benannte, exportierte Funktion (testbar ohne
// echten Timer/Spawn - Muster makeGracefulShutdown weiter unten: "injizierbare Fabrik,
// testbar mit Stub + Spy, ohne echten Prozess-Exit/Spawn"). DREI unabhaengige, SYNCHRON
// gestartete Zweige (kein await zwischen ihnen) - ein Wurf/Reject in einem Zweig darf die
// anderen NIE beruehren. Das ist keine neue Eigenschaft, die diese Funktion herstellen
// muss: ein throw in einer async-Funktion wird zu einer rejected Promise, nicht zu einer
// synchron propagierenden Exception, die die Zeilen davor abbricht (JS-Event-Loop). Jeder
// Zweig traegt zusaetzlich sein eigenes .catch() (zweite Linie, Muster der beiden
// Bestandszweige). test/kv-m4-monthly-cross-check.test.js (KV-M4-8) belegt die Isolation
// direkt gegen diese Funktion, nicht nur als Behauptung im Kommentar.
export function runSweepTick({ costTruing, provisioning, costCrossCheck, outageWatch, driftWatch, paidWithoutNumberWatch, provisionRetryWatch, priceDriftWatch }) {
  void costTruing
    .runCostTruingSweep({ trigger: SWEEP_TRIGGER.INTERVAL })
    .catch((err) => console.error("[cost-truing]", err.message));
  void provisioning
    .settleDueNumberMonthMeters()
    .catch((err) => console.error("[number-month]", err.message));
  // KV-M4: dritter, unabhaengiger Schritt im selben Stunden-Takt - kein zweiter Timer,
  // keine neue Ressource (TEIL 3 des Kickoffs). runMonthlyCrossCheck wirft intern nie
  // (Ergebnis-Objekt), das .catch() hier ist trotzdem die zweite Linie, wie bei den
  // beiden Zweigen darueber.
  void costCrossCheck
    .runMonthlyCrossCheck()
    .catch((err) => console.error("[cost-cross-check]", err.message));
  // OUTBOUND-E3b (D9): VIERTER, unabhaengiger Schritt im selben Stunden-Takt - schliesst
  // offene Ausfall-Marker, deren Fenster inzwischen gesund ist (der Ausloeser in
  // finishCall sieht nur not-placed-Anrufe und kann "erholt" nie selbst feststellen).
  void outageWatch
    .runRecoverySweep()
    .catch((err) => console.error("[outage-watch]", err.message));
  // C8b (Review-Blocker Runde 2): FUENFTER, unabhaengiger Schritt - der monatliche
  // Alarmkanal-Selbsttest. Teilt sich denselben Stunden-Takt (die Faelligkeits-Pruefung
  // selbst ist billig und intern gegated, kein zweiter Timer/keine neue Ressource).
  void outageWatch
    .runAlertChannelSelfTest()
    .catch((err) => console.error("[outage-watch]", err.message));
  // C8 (Nachbesserung, F-8): SECHSTER, unabhaengiger Schritt - die 24-h-Eskalation eines
  // haengenden Kuendigungs-Nummern-HOLD (platform_number_in_use). Teilt sich denselben
  // Stunden-Takt, kein zweiter Timer/keine neue Ressource.
  void outageWatch
    .runHoldEscalationSweep()
    .catch((err) => console.error("[outage-watch]", err.message));
  // OUTBOUND-E4 (F4): SIEBTER, unabhaengiger Schritt im selben Stunden-Takt - der
  // Drift-Waechter gegen die Anbieter-Wirklichkeit. Kein zweiter Timer, keine neue
  // Ressource. Mindestfrist + Claim sitzen IM Waechter (PM-26), nicht hier.
  void driftWatch
    .runDriftSweep()
    .catch((err) => console.error("[drift-watch]", err.message));
  // GP-P0 (PLAN-GELDPFAD.md 2): ACHTER, unabhaengiger Schritt im selben Stunden-Takt -
  // meldet einen aktiven, verifizierten Subscriber, der laenger als die Frist keine
  // Live-Nummer hat. Kein zweiter Timer, keine neue Ressource. Reine Beobachtung: dieser
  // Zweig kauft nichts und stoesst nichts an. Frist + Entprellung sitzen IM Waechter,
  // nicht hier.
  void paidWithoutNumberWatch
    .runPaidWithoutNumberSweep()
    .catch((err) => console.error("[paid-no-number]", err.message));
  // GP-P4 (PLAN-GELDPFAD.md 2): NEUNTER, unabhaengiger Schritt im selben Stunden-Takt -
  // stoesst einen zahlenden Mandanten ohne Live-Nummer erneut an, wenn die letzte
  // Ablehnung NICHT strukturell ist und der Versuchszaehler frei ist. Kein zweiter Timer,
  // keine neue Ressource. Anders als der achte Zweig beobachtet dieser nicht, er HANDELT:
  // Mindestfrist, Deckel und Eignungs-Gate sitzen IM Zweig (geteilter Kern
  // billing/provision-retry.js), nicht hier.
  void provisionRetryWatch
    .runProvisionRetrySweep()
    .catch((err) => console.error("[provision-retry-sweep]", err.message));
  // GP-P6 (PLAN-GELDPFAD.md 2): ZEHNTER, unabhaengiger Schritt im selben Stunden-Takt -
  // vergleicht den ANGEZEIGTEN Katalogpreis mit dem, was Stripe wirklich abbucht. Kein
  // zweiter Timer. Der Tages-Takt (PRICE_DRIFT_MIN_INTERVAL_MS) sitzt IM Waechter.
  void priceDriftWatch
    .runPriceDriftSweep()
    .catch((err) => console.error("[price-drift]", err.message));
}

// EL-NEUSTART-4: das Netz unter dem Drain. Eine offene Rueckfrage haengt an einem Warter
// IN DIESEM Prozess - dem Rueckfrage-Webhook des Laufwerks (conversation/consult-raised.js)
// oder dem Long-Poll des Auftraggebers (consult/delivery.js). Beide loest der Drain auf und
// schliesst dabei den Datensatz; ein harter Abbruch (Absturz, SIGKILL) laesst den Drain aber
// gar nicht erst laufen. Der DATENSATZ ueberlebt trotzdem - und der neu gestartete Dienst
// legte dieselbe Frage einem frischen Poll erneut vor, obwohl niemand mehr auf die Antwort
// wartet.
//
// DRITTE Stelle DESSELBEN Mechanismus (Call-Ende: setCallEndedAt; Drain: der Warter selbst),
// kein zweiter Status: expireOpenConsults heisst abgelaufen, NICHT beantwortet.
//
// EL-NEUSTART-6: geschlossen wird beides, GEZAEHLT nicht. Eine Rueckfrage, deren Haltefrist
// beim Start noch lief, kann ihre Antwort nur von einem Warter erwartet haben, den der
// Abbruch mitgenommen hat - sie hat KEINE Gespraechszeit gekostet und gibt ihren
// Kontingent-Platz frei (Marker orphanedAt, gelesen von consultQuotaUsed). Eine Rueckfrage,
// deren Frist bereits um war, hat der Anruf voll bezahlt: ihr Platz bleibt verbraucht -
// sonst waere der Kosten-Riegel umgehbar, indem man Rueckfragen ablaufen laesst (Regel 1).
// Im Zweifel gilt BEZAHLT (fail-closed, s. expireOrphanedConsults in store/state-ops.js).
//
// EL-NEUSTART-9: DIESELBE Naht ruft seither auch der Drain des geordneten Herunterfahrens
// (conversation/consult-raised.js, closeOrphaned) - auf demselben mutate-then-save()-Weg
// wie hier. Dieses Netz erreicht seinen Fall nicht: der Drain schliesst den Datensatz noch
// selbst, und pendingConsult unten sieht nur OFFENE. Zwei Ausloeser, EINE Naht - eine
// zweite Formulierung liesse den Kosten-Riegel auf einem Weg anders wirken als auf dem
// anderen.
//
// VORBEHALT: CONSULT_OPEN_MS ist Konfiguration und kann sich zwischen zwei Starts geaendert
// haben - dann misst diese Naht die Rueckfrage an einer Frist, unter der sie nie lief. Die
// Richtung des Fehlers ist die sichere: eine VERKUERZTE Frist laesst eine verwaiste
// Rueckfrage als bezahlt gelten (eine Rueckfrage zu wenig), nie umgekehrt einen bezahlten
// Platz frei werden. Der Fristablauf im laufenden Prozess (conversation/consult-raised.js)
// schreibt seinen Status ohnehin selbst; diese Ableitung deckt nur den Rest: der Abbruch
// faellt NACH dem Fristablauf, aber BEVOR der Warter ihn schreiben konnte.
//
// Nur laufende Anrufe - bei terminalen hat setCallEndedAt bereits geschlossen. Ein Warter
// aus dem Vorprozess kann per Definition nicht mehr leben, und ein Consult DIESES Laufs kann
// es noch nicht geben: die Naht sitzt vor app.listen, es ist noch keine Route erreichbar
// (Muster rearmActiveCallTimers/rearmActiveCalls, unmittelbar davor). Setzt keine Timer und
// ruft kein process.exit - INV-5 bleibt unberuehrt. pendingConsult ist der bestehende reine
// Leser fuer "an diesem Anruf ist noch etwas offen". Geschrieben wird nach dem bestehenden
// mutate-then-save()-Muster (store/pg.js; Vorbild applyTenantIdentity in wiring/web-login.js)
// - ohne Store-Lock, weil vor app.listen kein zweiter Schreiber existiert. Die Zeile traegt
// nur Anzahlen, nie eine Frage (Regel 4) und erscheint nur, wenn wirklich etwas geschlossen
// wurde.
function expireOrphanedConsults(store) {
  const state = store.load();
  const nowMs = Date.now();
  const orphaned = state.calls.filter(
    (call) => call.status === "active" && store.pendingConsult(call.id),
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
  // Boot-Re-Arm der Dead-Air-Wache (s. unten bei rearmActiveCallTimers). Dieselbe EINE
  // Instanz, die Shim und Call-Control-Ingest teilen (INV-7) - server.js reicht sie im
  // deps-Buendel bereits durch, hier wird sie nur ausgepackt.
  conversationWatchdog,
  callFinish,
  provisioning,
  costTruing,
  costCrossCheck,
  // KV2-1: die EINE Audit-Funktion des Kostenpfads (Konsole + durabel) - der Boot-Befund
  // warnKostenAlarmZielUnset schreibt ueber sie denselben durablen Marker wie der Sweep.
  durableAudit,
  // OUTBOUND-E3b: vierter, unabhaengiger Zweig desselben Stunden-Sweeps (runSweepTick) -
  // dieselbe EINE Instanz wie costTruing/costCrossCheck (INV-7), server.js reicht sie im
  // deps-Buendel durch.
  outageWatch,
  // OUTBOUND-E4: siebter, unabhaengiger Zweig desselben Stunden-Sweeps (runSweepTick) +
  // eigener Boot-Lauf. Dieselbe EINE Instanz (INV-7), server.js reicht sie durch.
  driftWatch,
  // GP-P0: achter, unabhaengiger Zweig desselben Stunden-Sweeps. Dieselbe EINE Instanz
  // (INV-7), server.js reicht sie durch. KEIN eigener Boot-Lauf: der Befund ist
  // zeit-basiert und verliert nichts, wenn er erst im ersten Tick faellt.
  paidWithoutNumberWatch,
  // GP-P4: neunter, unabhaengiger Zweig desselben Stunden-Sweeps. Dieselbe EINE Instanz
  // (INV-7), server.js reicht sie durch. KEIN eigener Boot-Lauf: ein Deploy-Sturm duerfte
  // sonst je Neustart einen Kaufanstoss ausloesen - die Mindestfrist faengt das zwar ab,
  // aber der Zweig braucht den Boot-Lauf gar nicht (der naechste Tick genuegt).
  provisionRetryWatch,
  // GP-P6: zehnter, unabhaengiger Zweig desselben Stunden-Sweeps + eigener Boot-Lauf.
  // Dieselbe EINE Instanz (INV-7), server.js reicht sie durch.
  priceDriftWatch,
  messaging,
  consultDelivery,
  // Boot-Re-Arm des EL-Ergebnisabrufs (s. unten bei rearmActiveConversationPolls). Dieselbe
  // EINE Instanz wie bei makeCallRoutes (INV-7) - server.js reicht sie im deps-Buendel
  // bereits durch, hier wird sie nur ausgepackt.
  elevenLabsOutbound,
}) {
  // S1-4: json.js wirft aus load(), wenn ein korrupter Store NICHT forensisch gesichert
  // werden konnte (statt ihn still mit Defaults zu ueberschreiben). Ohne dieses explizite
  // exit(1) faengt das globale uncaughtException-Netz (process-guards) den Boot-Throw ab und
  // der Prozess endet LAUTLOS mit Code 0 (empirisch bestaetigt) - kein sichtbarer Boot-Ausfall.
  try {
    store.load();
  } catch (err) {
    console.error(`[boot] Store nicht ladbar - fail-closed, kein Start: ${err.message}`);
    process.exit(1);
  }

  runRetention(store, config);
  setInterval(() => runRetention(store, config), RETENTION_SWEEP_INTERVAL_MS).unref();

  // GAP-38: VOR den Gates - die Heilung darf den Refusal nur VERMEIDEN, nie ersetzen.
  await healBootstrapStore({ config, store, messaging });
  // OUTBOUND-E1: VOR den Gates - die Bindungen sind die Datengrundlage des Riegels.
  // OUTBOUND-E3b (PM-17): das Ergebnis wurde bisher verworfen - jetzt haelt es
  // warnPlatformAlertSenderUnbound dagegen (NIE fatal, s. dort).
  const openPlatformBindings = derivePlatformNumberBindings({ config, store });
  for (const finding of platformAlertSenderFindings({ openBindings: openPlatformBindings }))
    console.warn(`[boot] ${finding.message}`);
  assertBootGates(config, store, durableAudit);

  // LCT P3: Kosten-Abgleich im Beobachtungsmodus. Muster der beiden bestehenden
  // periodischen Jobs (Retention hier, DID-Release-Reconciler in wiring/web-login.js):
  // setInterval(...).unref(), Intervall aus EINER Quelle (seit KE-P6B
  // config.billing.costTruingSweepIntervalMs, Default 1 h), kein Scheduler-Dependency,
  // kein Render-Cron (gibt es auf dem Free Tier nicht).
  //
  // BEWUSSTE ABWEICHUNG von beiden Vorbildern: KEIN Lauf beim Boot. Beide Vorbilder sind
  // store-lokal bzw. observe-only; dieser Sweep macht Provider-IO, und im Repo hat KEIN
  // Provider-Call einen Timeout/AbortController (dokumentiert in src/single-flight.js).
  // Ein haengender CDR-Abruf duerfte nie an der Boot-Sequenz haengen. Wer "jetzt" will,
  // nimmt den Endpunkt. NACH assertBootGates, damit die Konfiguration validiert ist.
  //
  // runCostTruingSweep wirft nicht (interner try/finally + per-Call-catch); zusaetzlich
  // .catch() am Aufruf, damit ein unerwarteter Wurf nie zum unhandled rejection wird.
  //
  // GAP-06: die DID-Monatsmiete faehrt als ZWEITER Schritt in DIESEM Intervall mit
  // (Owner-Vorgabe: kein Cron, kein neuer Endpunkt, keine neue Ressource - der Render
  // Free Tier hat weder preDeploy noch Jobs). Bewusst derselbe Stunden-Takt, KEIN zweiter
  // Timer und KEINE neue Env-Variable. Der Schritt ist store-lokal (kein Provider-IO) und
  // faengt Tenants ab, die in diesem Monat kein Abo-Ereignis hatten. Die beiden Schritte
  // sind voneinander unabhaengig: ein haengender CDR-Abruf blockiert die Miete nicht.
  // settleDueNumberMonthMeters wirft nicht (interner catch); das .catch() hier ist
  // derselbe Riegel gegen unhandled rejections wie beim Sweep darueber.
  //
  // KV-M4: costCrossCheck faehrt als DRITTER, unabhaengiger Schritt in DEMSELBEN Intervall
  // mit (runSweepTick oben, exportiert und direkt testbar) - kein zweiter Timer, keine
  // neue Ressource.
  setInterval(
    () => runSweepTick({ costTruing, provisioning, costCrossCheck, outageWatch, driftWatch, paidWithoutNumberWatch, provisionRetryWatch, priceDriftWatch }),
    config.billing.costTruingSweepIntervalMs,
  ).unref();

  // F10-ORD (Review-Blocker Runde 1): rearmActiveCallTimers() laeuft ERST HIER, NACH
  // allen Boot-Gates (assertConfig/fakeOriginateBootBlocked/hasActiveNumber), unmittelbar
  // VOR app.listen. Vorher (VOR assertConfig) haette ein Zombie-Call bereits
  // store.setCallEndedAt() + den synchronen Teil von finishCall (Buchung/markBilled)
  // ausgeloest, BEVOR ein scheiterndes assertConfig() im selben Tick process.exit(1)
  // feuert - der async-Rest von finishCall (releaseReserve/store.save/Notification/SMS)
  // liefe dann NIE mehr, der Call bliebe teilgebucht+Reserve-nie-freigegeben auf Platte
  // stehen. Das widerspraeche dem Boot-Gate-Versprechen "GAR NICHT gestartet" (Regel 1/
  // OT-4). Kein Gate danach darf mehr process.exit(1) rufen.
  lifecycle.rearmActiveCallTimers();

  // IE2: dieselbe Boot-Naht fuer die GELD-Achse. Der Cap-Re-Arm darueber deckt ein
  // ueberlebendes Leg gegen die ZEIT, dieser gegen das GUTHABEN - B8: ohne wiederkehrende
  // Frage wirkt die pro-Tenant-Decke mid-call nur, wenn ein Turn oder ein Werkzeug feuert.
  // UNMITTELBAR NACH dem Cap-Re-Arm und aus DESSEN Ergebnis: dessen Zombie-Zweig setzt den
  // Endstatus synchron (persistEnd laeuft vor dem ersten await in terminateAndBillCall), der
  // Schnappschuss traegt also nur noch Zeilen, die wirklich weiterlaufen. Setzt
  // ausschliesslich Timer - INV-5 (kein exit(1) nach dem Re-Arm) bleibt unberuehrt.
  lifecycle.rearmBudgetWatchdogs();

  // Zweite Achse desselben Boot-Problems: der Cap-Re-Arm darueber deckt ein ueberlebendes
  // Leg mit Groessenordnung MAX_CALL_DURATION_CAP_S, die Dead-Air-Frist des Gespraechs-
  // Waechters mit Groessenordnung 45 s - dessen Timer nimmt ein Deploy genauso mit, und
  // sein einziger Armierer (ai_assistant_start, Call-Control-Ingest) kommt fuer ein bereits
  // laufendes Gespraech nie wieder. UNMITTELBAR NACH dem Cap-Re-Arm und aus DESSEN
  // Ergebnis: der Zombie-Zweig dort setzt den Endstatus synchron (persistEnd laeuft vor dem
  // ersten await in terminateAndBillCall), der Schnappschuss traegt also nur noch Zeilen,
  // die wirklich weiterlaufen; welche davon ein Assistant-Leg sind, entscheidet der
  // Waechter an den Merkmalen AM CALL, nicht an einem Flag (isRunningAssistantLeg).
  // Setzt ausschliesslich Timer - INV-5 (kein exit(1) nach dem Re-Arm) bleibt unberuehrt,
  // der Max-Dauer-Cap und sein Re-Arm sind unveraendert.
  conversationWatchdog.rearmActiveCalls(store.load().calls);

  // Dritte Achse desselben Boot-Problems: die beiden Re-Arms darueber holen Timer zurueck,
  // die der Neustart genommen hat - diese Naht schliesst den Zustand, den kein Timer mehr
  // erreicht (s. expireOrphanedConsults). NACH dem Cap-Re-Arm, damit ein dort terminalisierter
  // Zombie hier gar nicht erst als laufender Anruf auftaucht.
  expireOrphanedConsults(store);

  // Vierte Achse desselben Boot-Problems (Owner-Auftrag 15.08.2026, Aufgabe 2): der
  // ziehende EL-Ergebnisabruf (elevenlabs/outbound.js#scheduleResultPoll) ist ein reiner
  // In-Prozess-setTimeout mit originateCall als einzigem Ausloeser - ein Neustart nimmt ihn
  // mit, ein aktiver EL-Call bleibt fuer immer "active". Setzt ausschliesslich Timer bzw.
  // terminiert ueber denselben EINEN Terminierungspfad wie jeder andere Zombie (INV-5: kein
  // exit(1) danach).
  elevenLabsOutbound.rearmActiveConversationPolls();

  const httpServer = app.listen(config.server.port, () => {
    // Tatsaechlichen Port verwenden: bei PORT=0 (Tests) vergibt das OS einen freien Port
    const port = httpServer.address().port;
    // Eigene REST-API fuer die MCP-Tools erreichbar machen (auch bei abweichendem PORT).
    // Der Wert geht in den Halter in config.js, NICHT nach process.env (G35): ein erst
    // nach listen() bekannter Wert ist keine Umgebungs-Konfiguration. Ein gesetztes
    // GATEWAY_URL bleibt vorrangig - genau wie beim frueheren ||=.
    setBoundGatewayPort(port);
    logBootBanner(config, port);
    // PROV-01/F5: Crash-verwaiste Provisioning-Jobs beim Boot reconcilen. Fire-and-forget NACH
    // den Boot-Logs - blockiert weder listen noch Healthcheck; der Boot-Guard (hasActiveNumber)
    // lief bereits davor. Gated auf PROVISIONING_ENABLED, Default Observe-Only (maxAge=0).
    void provisioning.reconcileOrphanedProvisioning();
    // mail-boot-probe: EINE Zeile, die den sonst lautlosen Fehlschlag des fail-soft
    // Mailversands meldet (falsche Zugangsdaten, beim Anbieter nicht verifizierte
    // Absenderadresse) - sonst merkt der Betreiber es erst, wenn sich ein Kunde
    // beschwert. Fire-and-forget NACH den Boot-Logs (Muster PROV-01 direkt darueber):
    // blockiert weder listen noch Healthcheck - ein nicht erreichbarer Mail-Anbieter darf
    // den Start nie verzoegern, der Dienst telefoniert live. probeMailBoot faengt bereits
    // selbst jeden Fehler (verschickt nie eine Mail); das .catch() hier ist die zweite
    // Linie (Muster runSweepTick oben) - NIE e.message loggen (Regel 4: eine Mail-
    // Fehlermeldung kann Zugangsdaten tragen).
    void probeMailBoot(config).catch((fehler) =>
      console.error("[mail] Sonde unerwartet gescheitert", fehler?.code ?? fehler?.name ?? "unbekannt"),
    );
    // OUTBOUND-E4: EIN Lauf beim Start - fire-and-forget NACH den Boot-Logs (Muster
    // PROV-01/mail-boot-probe direkt darueber): blockiert weder listen noch Healthcheck.
    // Anbieter-IO gehoert nie an die Boot-Sequenz. Der Waechter traegt seinen eigenen
    // Timeout je Abfrage und seine Mindestfrist (OUTBOUND_DRIFT_MIN_INTERVAL_MS) - ohne
    // sie liefe er bei einem externen 10-Minuten-Ping bis zu 144x/Tag statt einmal.
    void driftWatch.runBootProbe().catch((err) => console.error("[drift-watch] Boot-Sonde:", err.message));
    // GP-P6: EIN Lauf beim Start - fire-and-forget NACH den Boot-Logs (Muster
    // driftWatch.runBootProbe direkt darueber). Anbieter-IO gehoert nie an die
    // Boot-Sequenz; die Mindestfrist im Waechter macht daraus hoechstens EINEN Abruf/Tag.
    void priceDriftWatch.runBootProbe().catch((err) => console.error("[price-drift] Boot-Sonde:", err.message));
  });

  // Audio-Bridge (nur relevant bei VOICE_ENGINE=realtime)
  attachMediaBridge(httpServer, callFinish.finishCall);

  // AL-P13: offene Consult-Polls werden VOR httpServer.close() aufgeloest. Ohne das
  // haelt ein 22-s-Poll den Drain auf, der Watchdog kappt mit exit(0) - und der
  // finale Store-Flush faellt aus (Datenverlust bei jedem Deploy).
  const gracefulShutdown = makeGracefulShutdown({
    httpServer,
    store,
    config,
    releaseLongPolls: consultDelivery.releaseOpenPolls,
  });
  process.once("SIGTERM", gracefulShutdown);
  process.once("SIGINT", gracefulShutdown);
}

// A6/F11 + S1-2: Graceful-Shutdown-Handler als injizierbare Fabrik (testbar mit Stub-store +
// Exit-Spy, ohne echten Prozess-Exit/Spawn). Deploy/Restart -> SIGTERM (Render), Ctrl+C -> SIGINT.
// Der Drain laesst in-flight Requests fertig laufen (await close) und flusht ERST DANACH den
// Store; das Ordering ist entscheidend (kein Handler haengt nach dem finalen save() eine Mutation
// an). S1-A: closeIdleConnections() unmittelbar NEBEN close(resolve) (idle Keep-Alive-Sockets,
// sonst loest await close NIE auf). S1-B: drainFlushes() loopt bis die flushChain stabil ist
// (Hintergrund-Timer kann waehrend des Awaits einen Flush nachhaengen). shuttingDown schuetzt
// gegen Wiedereintritt (zweites Signal). Secret-frei (nur Signalname).
// S1-2: Ein FEHLGESCHLAGENER (rejectender) finaler Flush -> exit(1) statt lautlos exit(0)
// (pg.drainFlushes wirft lastFlushError; json.save wirft synchron) = sichtbarer Datenverlust-
// Alarm. Ein reiner Drain-HANG bleibt beim Watchdog-exit(0) (unveraendert).
export function makeGracefulShutdown({
  httpServer,
  store,
  config,
  // AL-P13: loest offene Consult-Long-Polls auf. Default No-op haelt jeden Bestands-
  // Aufrufer (u. a. test/graceful-shutdown.test.js) byte-identisch; die echte Freigabe
  // injiziert bootServer.
  releaseLongPolls = () => {},
  exit = process.exit,
  log = console.log,
  logError = console.error,
}) {
  let shuttingDown = false;
  return async function gracefulShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`[shutdown] Signal ${signal} - draine in-flight Requests, dann finaler Store-Flush`);
    const watchdog = setTimeout(() => exit(0), config.server.shutdownDrainTimeoutMs).unref();
    releaseLongPolls(); // VOR close(): sonst wartet close auf die Polls (AL-P13)
    const closed = new Promise((resolve) => httpServer.close(resolve));
    if (typeof httpServer.closeIdleConnections === "function") httpServer.closeIdleConnections();
    await closed;
    let flushError = null;
    try {
      await store.save();
      await store.drainFlushes();
    } catch (err) {
      flushError = err;
    }
    clearTimeout(watchdog);
    if (flushError) {
      logError(
        `[shutdown] Finaler Store-Flush FEHLGESCHLAGEN - Datenverlust moeglich: ${flushError.message}`,
      );
      exit(1);
      return;
    }
    exit(0);
  };
}
