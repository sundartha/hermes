// ---- Boot-Sequenz (Server-Slim P15) ---------------------------------------------
// bootServer(deps) startet den fertig verdrahteten app: store.load, DSGVO-Retention,
// Fail-closed-Boot-Gates, listen+Banner, Audio-Bridge, Provisioning-Reconcile,
// Graceful-Shutdown. REINE Verschiebung aus server.js (byte-identische Reihenfolge,
// Log-Zeilen, exit-Codes). INV-5: rearmActiveCallTimers NACH allen exit1-Gates,
// unmittelbar VOR listen; kein Gate danach ruft process.exit(1). INV-6: die
// "Hermes Gateway laeuft auf ..."-Zeile erst im listen-Callback (nach vollem Boot).
import { assertConfig, gatewayUrlForPort, VOICE_ENGINE } from "./config.js";
import { configFingerprint } from "./config-fingerprint.js";
import {
  fakeOriginateBootBlocked,
  meterMappingGaps,
  spendCapCoherence,
  unpricedModels,
  providerRateOutOfBand,
  alertChannelFindings,
  costTruingBookingFindings,
  voiceTariffFloorFindings,
  planCapUnderivableFindings,
  planCapReserveFindings,
  bootstrapHealDecision,
  BOOTSTRAP_HEAL,
} from "./boot-guard.js";
import { hasActiveNumber } from "./store/views.js";
import { sendBootstrapAlertSms } from "./telephony/alert-sms.js";
// LCT-FIX-1: welche Belegtypen einem Call zugeordnet werden koennen, weiss der Adapter, der
// die Belege liest - der Boot-Guard bleibt eine reine, arg-injizierte Entscheidung.
// Provider-Konstante, kein Transport: dieselbe Richtung wie telnyx-call-control-ingest.js
// (assistantVoiceConfigured).
import { ASSIGNABLE_COST_RECORD_TYPES } from "./telephony/adapters/telnyx/voice.js";
import { attachMediaBridge } from "./bridge.js";
import {
  USAGE_EVENT_KIND,
  BOOTSTRAP_TENANT_ID,
  normNum,
} from "./store/defaults.js";
import { STRIPE_METER_EVENT_NAME } from "./billing/stripe.js";
import { hasPrunedSomething, tenantsOf } from "./store/state-ops.js";
import { SWEEP_TRIGGER, costTruingCoveragePercent } from "./billing/cost-truing.js";
import { tariffDriftReportFromConfig, driftLine } from "./billing/cost-calibration.js";
import { CATALOG_SLUGS } from "./plans.js";
import { planCapCents } from "./billing/plan-caps.js";
import { audit } from "./util.js";
import { deadAirOverrun, turnBudgetOverrun } from "./turn-budget.js";
import { MS_PER_SECOND } from "./utils/timer.js";
// GAP-19: EIN Praedikat fuer beide Haelften - der Boot meldet genau die Konstellation, die
// in der Outbound-Kette das Herkunfts-Gate abschaltet (G5). Kein Zyklus: outbound-gates.js
// importiert boot.js nicht.
import { numberOriginDecoupled } from "./telephony/outbound-gates.js";

const RETENTION_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

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
  const fatal = all.find((f) => f.fatal);
  if (fatal) {
    console.error(`[boot] Start abgebrochen: ${fatal.message}`);
    process.exit(1);
  }
  for (const finding of all) console.warn(`[boot] Konfig-Warnung: ${finding.message}`);
}

// P3: Modelle ohne Preistabellen-Eintrag (unpricedModels, src/boot-guard.js) buchen
// fail-closed zur TEUERSTEN Rate (priceForModel, state-ops.js) - Folge ist reine
// Ueber-Bepreisung (bis 3x), nie Ueber-Ausgabe. NUR WARN, kein exit(1): ein Boot-
// Refusal tauschte hier ein Kostenproblem gegen einen Totalausfall der Telefonie.
function warnUnpricedModels(config) {
  const unpriced = unpricedModels([config.llm.claudeModel, config.llm.briefingModel], config.llm.modelPricesUsd);
  if (!unpriced.length) return;
  console.warn(
    `[boot] Konfig-Warnung: Modell(e) ohne Preis in modelPricesUsd: ${unpriced.join(",")} - ` +
      "bucht fail-closed zur teuersten hinterlegten Rate (Ueber-Bepreisung, priceForModel).",
  );
}

// LCT P4: Umrechnungskurs gegen das Toleranzband - seit dieser Phase FATAL (in P2 war
// derselbe Befund eine WARN). UNKONDITIONAL: an kein Flag gekoppelt (Begruendung im
// Guard). Muster assertSpendCapCoherence.
function assertProviderRateInBand(config) {
  const fatal = providerRateOutOfBand(config.billing.providerToBucketRateMicro).find((f) => f.fatal);
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
// warnUnpricedModels); die laute Linie ist der Befund coverage_below_threshold aus dem Sweep.
function assertCostTruingBooking(config, store) {
  const findings = costTruingBookingFindings({
    requiredRecordTypes: config.billing.costTruingRequiredRecordTypes,
    assignableRecordTypes: ASSIGNABLE_COST_RECORD_TYPES,
    ...currentCoverage(config, store),
  });
  const fatal = findings.find((f) => f.fatal);
  if (fatal) {
    console.error(`[boot] Start abgebrochen: ${fatal.message}`);
    process.exit(1);
  }
  for (const f of findings) console.warn(`[boot] Konfig-Warnung: ${f.message}`);
}

// LCT P5: Alarmkanal-Guard (alertChannelFindings). Loggt NIE den Wert (der besetzte Fall
// liefert [] und meldet damit gar nichts). Der seit GAP-07 moegliche FATALE Befund ist hier
// per Konstruktion unerreichbar: assertConfig() faltet ihn in seine Fatal-Menge und hat den
// Prozess bei diesem Zustand laengst mit exit(1) beendet - hier bleibt nur die WARN.
function warnAlertChannelUnset(config) {
  for (const f of alertChannelFindings(config.billing))
    console.warn(`[boot] Konfig-Warnung: ${f.message}`);
}

// LCT P5: Drift-Waechter, Ausloeser 1 von 2 (Boot). GENAU EINE Zeile fuer ALLE Praefixe -
// nicht eine je Praefix je Boot (Risiko-Abschnitt der Phase: WARN-Muedigkeit). WARN nur,
// wenn ueberhaupt ein Befund vorliegt; ein durchweg im Band liegender Zustand loggt ruhig.
// KEIN SMS-Alarm hier: der Boot feuert einmal je Prozessstart, der laufende Alarm haengt am
// Sweep (src/billing/cost-truing.js). KEIN Audit: der Befund aendert nichts daran, WAS der
// Dienst ablehnt - Muster warnUnpricedModels.
function warnTariffDrift(config, store) {
  const report = tariffDriftReportFromConfig(store.load().calls, config.billing);
  const line = `[boot] Tarif-Drift: ${report.map(driftLine).join(" | ")}`;
  if (report.some((e) => e.code !== null)) console.warn(line);
  else console.log(line);
}

// LCT P4b: Vollkosten-Boot-Guard (WARN). Haelt den konfigurierten Inlandstarif gegen die
// Vollkostenschwelle UND die live aus dem Spiegel gerechnete Deckungsquote. Feuert nur in
// der Konjunktion (voiceTariffFloorFindings). Deckungsquote + Schwelle liefert currentCoverage
// (dieselbe EINE Quelle wie der P4-Guard). WARN, kein exit(1). An KEIN Flag gekoppelt: der
// Tarif ist auch ohne aktive Korrekturbuchung der Buchungswert jedes nicht abgeglichenen Calls.
function warnVoiceTariffBelowFullCost(config, store) {
  const findings = voiceTariffFloorFindings({
    domesticTariffCents: config.billing.voiceTariffDomesticCents,
    fullCostFloorCents: config.billing.voiceTariffFullCostFloorCents,
    ...currentCoverage(config, store),
  });
  for (const f of findings) console.warn(`[boot] Konfig-Warnung: ${f.message}`);
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
      "(TELNYX_DEAD_AIR_TIMEOUT_S/LLM_REQUEST_TIMEOUT_MS/LLM_MAX_RETRIES/LLM_BACKOFF_MS/ELEVENLABS_SYNTH_TIMEOUT_MS).",
  );
}

// GAP-19 (erste Haelfte): FORCE_NUMBER_COUNTRY entkoppelt das Kauf-Land vom Herkunftsland -
// jeder neue Tenant telefoniert dann unter auslaendischer Absenderkennung. WARN, kein exit(1):
// das IST der gewollte Live-Zustand (render.yaml), ein Boot-Refusal waere ein selbst
// verursachter Totalausfall der Telefonie (Praezedenz warnUnpricedModels). Die Zeile ist der
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
// laufenden Telefoniebetrieb still - der teuerste Fehlausgang (Praezedenz warnUnpricedModels).
function warnMissingProvisioningConnection(config) {
  if (!config.provisioning.provisioningEnabled || config.telephony.telnyxConnectionId) return;
  console.warn(
    "[boot] Konfig-Warnung: PROVISIONING_ENABLED=true ohne TELNYX_CONNECTION_ID - gekaufte Nummern " +
      "gehen ohne Voice-Routing raus und werden trotzdem aktiv geschaltet.",
  );
}

// Alle fail-closed Boot-Gates gebuendelt (macht INV-5 "rearm NACH allen exit1-Gates"
// strukturell sichtbar - kein Code danach kann ein Gate vergessen). Die vier
// Bestands-Gates unten pruefen zuerst; assertSpendCapCoherence (P3, Klausel B) ist
// das fuenfte, assertProviderRateInBand (LCT P4) das sechste und assertCostTruingBooking
// (LCT P4) das siebte, das noch process.exit(1) rufen kann - warnUnpricedModels/
// warnAlertChannelUnset/warnTariffDrift/warnNumberOriginDecoupled/
// warnMissingProvisioningConnection sind reine Diagnose (nie fatal).
function assertBootGates(config, store) {
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
  if (fakeOriginateBootBlocked(config.safety)) {
    console.error(
      "[boot] Start abgebrochen: FAKE_ORIGINATE=true ist nur mit SKIP_TWILIO_SIGNATURE_CHECK=true " +
        "zulaessig (Test-Seam, in Produktion unzulaessig).",
    );
    process.exit(1);
  }

  // Boot-Guard (Pre-Mortem): jeder Tenant - auch der Bootstrap-Tenant - haelt seine
  // Absendernummer im Store, nicht in der Env. Tenant-agnostisch (P2b): der Dienst ist
  // "telefonbar", sobald IRGENDEIN Tenant eine aktive Nummer hat (kein OWNER/BOOTSTRAP-Pin
  // mehr). Nach lokalem Reset (data/store.json geloescht) oder frischem Postgres ohne Seed
  // waere keine aktive Nummer da -> Outbound + SMS still tot. Fail-closed wie die fruehere
  // TWILIO_NUMBER-Boot-Pflicht: leerer Store -> kein Start. Loggt KEINE Nummer (kein Leak),
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
  warnUnpricedModels(config);
  assertProviderRateInBand(config);
  assertCostTruingBooking(config, store);
  warnAlertChannelUnset(config);
  warnTariffDrift(config, store);
  warnVoiceTariffBelowFullCost(config, store); // NEU: LCT P4b, WARN
  warnTurnBudgetOverrun(config); // GAP-22, WARN
  warnTurnOutlivesDeadAir(config); // AL-P6, WARN
  warnNumberOriginDecoupled(config); // GAP-19, WARN
  warnMissingProvisioningConnection(config); // Nummern-Lebenszyklus, WARN
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
  return assistantEnabled
    ? "AKTIV (TELNYX_AI_ASSISTANT_ENABLED=true)"
    : "aus (TELNYX_AI_ASSISTANT_ENABLED=false)";
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
  console.log(
    `  MCP (HTTP):     ${config.server.publicUrl || "PUBLIC_URL fehlt!"}/mcp  <- als Custom Connector in Claude eintragen`,
  );
  console.log(`  Twilio-Webhook: ${config.server.publicUrl || "PUBLIC_URL fehlt!"}/voice/incoming`);
  console.log(`  Status-Callback:${config.server.publicUrl || "PUBLIC_URL fehlt!"}/voice/status`);
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
}

// GAP-38: heilt einen nachweislich frischen Store aus den Deploy-Parametern - der Ersatz
// fuer das Pre-Deploy-Kommando, das Render auf plan:free nie ausfuehrt. Laeuft NACH
// store.load() (ein Verbindungs-/Ladefehler hat den Prozess dort bereits beendet: pg-Init
// exitet in store.js, ein Ladefehler in bootServer) und VOR assertBootGates - der
// bestehende fail-closed Refusal bleibt die EINZIGE Stelle, die "keine Nummer -> kein
// Start" entscheidet (G5). Diese Funktion verweigert nie selbst, sie heilt oder schweigt.
// Idempotent: nach der Heilung liefert die Entscheidung NOT_NEEDED.
export async function healBootstrapStore({ config, store, messaging }) {
  const s = store.load();
  const decision = bootstrapHealDecision({
    activeNumberPresent: hasActiveNumber(s),
    numberCount: s.numbers.length,
    foreignTenantCount: tenantsOf(s).filter((t) => t.id !== BOOTSTRAP_TENANT_ID).length,
    callCount: s.calls.length,
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
          "(E.164 + twilio|telnyx erwartet) - keine Heilung.",
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

export async function bootServer({
  app,
  config,
  store,
  lifecycle,
  callFinish,
  provisioning,
  costTruing,
  messaging,
  consultDelivery,
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
  assertBootGates(config, store);

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
  setInterval(() => {
    void costTruing
      .runCostTruingSweep({ trigger: SWEEP_TRIGGER.INTERVAL })
      .catch((e) => console.error("[cost-truing]", e.message));
    void provisioning
      .settleDueNumberMonthMeters()
      .catch((e) => console.error("[number-month]", e.message));
  }, config.billing.costTruingSweepIntervalMs).unref();

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

  const httpServer = app.listen(config.server.port, () => {
    // Tatsaechlichen Port verwenden: bei PORT=0 (Tests) vergibt das OS einen freien Port
    const port = httpServer.address().port;
    // Eigene REST-API fuer die MCP-Tools erreichbar machen (auch bei abweichendem PORT)
    process.env.GATEWAY_URL ||= gatewayUrlForPort(port);
    logBootBanner(config, port);
    // PROV-01/F5: Crash-verwaiste Provisioning-Jobs beim Boot reconcilen. Fire-and-forget NACH
    // den Boot-Logs - blockiert weder listen noch Healthcheck; der Boot-Guard (hasActiveNumber)
    // lief bereits davor. Gated auf PROVISIONING_ENABLED, Default Observe-Only (maxAge=0).
    void provisioning.reconcileOrphanedProvisioning();
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
