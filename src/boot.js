// ---- Boot-Sequenz (Server-Slim P15) ---------------------------------------------
// bootServer(deps) startet den fertig verdrahteten app: store.load, DSGVO-Retention,
// Fail-closed-Boot-Gates, listen+Banner, Audio-Bridge, Provisioning-Reconcile,
// Graceful-Shutdown. REINE Verschiebung aus server.js (byte-identische Reihenfolge,
// Log-Zeilen, exit-Codes). INV-5: rearmActiveCallTimers NACH allen exit1-Gates,
// unmittelbar VOR listen; kein Gate danach ruft process.exit(1). INV-6: die
// "Hermes Gateway laeuft auf ..."-Zeile erst im listen-Callback (nach vollem Boot).
import { assertConfig, gatewayUrlForPort, VOICE_ENGINE } from "./config.js";
import {
  fakeOriginateBootBlocked,
  meterMappingGaps,
  spendCapCoherence,
  unpricedModels,
  providerRateOutOfBand,
  alertChannelFindings,
  costTruingBookingFindings,
  voiceTariffFloorFindings,
  planCapInertFindings,
  tenantCapRowInertFindings,
  SPEND_CAP_FINDING,
} from "./boot-guard.js";
import { hasActiveNumber } from "./store/views.js";
// LCT-FIX-1: welche Belegtypen einem Call zugeordnet werden koennen, weiss der Adapter, der
// die Belege liest - der Boot-Guard bleibt eine reine, arg-injizierte Entscheidung.
// Provider-Konstante, kein Transport: dieselbe Richtung wie telnyx-call-control-ingest.js
// (assistantVoiceConfigured).
import { ASSIGNABLE_COST_RECORD_TYPES } from "./telephony/adapters/telnyx/voice.js";
import { attachMediaBridge } from "./bridge.js";
import { USAGE_EVENT_KIND, MAX_CALL_DURATION_CAP_S } from "./store/defaults.js";
import { STRIPE_METER_EVENT_NAME } from "./billing/stripe.js";
import { hasPrunedSomething } from "./store/state-ops.js";
import { SWEEP_TRIGGER, costTruingCoveragePercent } from "./billing/cost-truing.js";
import { tariffDriftReportFromConfig, driftLine } from "./billing/cost-calibration.js";
import { CATALOG_SLUGS } from "./plans.js";
import { planCapCents } from "./billing/plan-caps.js";
import { audit } from "./util.js";

const RETENTION_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

// Retention (DSGVO): alte Transkripte/Notifications beim Start und periodisch loeschen
function runRetention(store, config) {
  const removed = store.pruneOldData();
  if (!hasPrunedSomething(removed)) return;
  console.log(
    `[retention] geloescht: ${removed.calls} Calls, ${removed.notifications} Notifications, ` +
      `${removed.actionItems} erledigte Action Items (aelter als ${config.privacy.retentionDays} Tage), ` +
      `${removed.diagnosticTranscripts} Diagnose-Transkripte (aelter als ${config.privacy.diagnosticRetentionDays} Tage)`,
  );
}

// P3: Konfig-Warnungen, die der Audit-Trail mitschreibt: NUR Befunde, die aendern, WAS
// der Dienst ablehnen wird. Klausel B heisst "jedes Auslandsziel scheitert am
// Reserve-Gate" (D5) - eine Ablehnungs-Ursache und damit Forensik, wie jede andere
// Gate-Entscheidung. Der 0-Sentinel (A0) ist dokumentiertes Bestandsverhalten und ein
// unbepreistes Modell bewirkt reine Ueber-Bepreisung - beide aendern keine Ablehnung
// -> nur WARN, ohne Audit-Zeile.
const AUDITED_BOOT_FINDINGS = new Set([SPEND_CAP_FINDING.WORST_CASE_UNAFFORDABLE]);

// P3: Kohaerenz der Budget-Achsen GEGENEINANDER (spendCapCoherence, src/boot-guard.js).
// Klausel A (Tenant-Default >= Plattform-Cap) ist FATAL - eine inerte Tenant-Achse ist
// echter Schutzverlust (Regel 1). A0/B sind WARN (siehe Klausel-Kommentar im Guard).
//
// LCT P6 haengt zwei weitere Linien an (store.load() ist gecacht, kein Zweit-IO, Muster
// currentCoverage): erste Linie (fatal) prueft ALLE Katalog-Slugs' abgeleitete Decke gegen
// den Plattform-Cap - unabhaengig davon, ob schon ein Tenant diesen Plan gebucht hat
// (verhindert eine inkohaerente Konfiguration VOR dem ersten Kunden). Zweite Linie (WARN)
// liest die Nachlese ueber TATSAECHLICH gesetzte tenant_budget-Zeilen (nachtraeglich
// gesenkter Cap). Beide koennen NOCH process.exit(1) ausloesen (nur die erste) - deshalb
// bleibt assertSpendCapCoherence vor rearmActiveCallTimers() (INV-5).
function assertSpendCapCoherence(config, store) {
  const findings = spendCapCoherence({
    tenantDefaultCents: config.billing.defaultTenantBudgetCents,
    platformCapCents: config.billing.platformSpendCapCents,
    // Worst Case, NICHT der Inlandstarif: der Guard rechnet das teuerste Ziel.
    maxTariffCents: config.billing.voiceTariffDefaultCents,
    // Die HARTE Obergrenze, nicht die Default-Dauer: resolveMaxDurationS klemmt jeden
    // Body-Override hierauf - das ist die laengstmoegliche Reserve.
    maxCallDurationS: MAX_CALL_DURATION_CAP_S,
  });
  const planCapFindings = planCapInertFindings({
    slugs: CATALOG_SLUGS,
    platformCapCents: config.billing.platformSpendCapCents,
    capForSlug: (slug) => planCapCents(slug, config.billing),
  });
  const rowFindings = tenantCapRowInertFindings({
    budgetRows: store.load().tenantBudgets,
    platformCapCents: config.billing.platformSpendCapCents,
  });
  const all = [...findings, ...planCapFindings, ...rowFindings];
  const fatal = all.find((f) => f.fatal);
  if (fatal) {
    console.error(`[boot] Start abgebrochen: ${fatal.message}`);
    process.exit(1);
  }
  for (const finding of all) {
    console.warn(`[boot] Konfig-Warnung: ${finding.message}`);
    if (AUDITED_BOOT_FINDINGS.has(finding.code)) {
      audit("boot_konfig_warnung", null, `grund=${finding.code} ${finding.message}`);
    }
  }
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

// LCT P5: Alarmkanal-Guard (alertChannelFindings). WARN, kein exit(1) - Begruendung im
// Guard. Loggt NIE den Wert (der besetzte Fall liefert [] und meldet damit gar nichts).
function warnAlertChannelUnset(config) {
  for (const f of alertChannelFindings(config.billing.platformAlertSmsTo))
    console.warn(`[boot] Konfig-Warnung: ${f.message}`);
}

// LCT P5: Drift-Waechter, Ausloeser 1 von 2 (Boot). GENAU EINE Zeile fuer ALLE Praefixe -
// nicht eine je Praefix je Boot (Risiko-Abschnitt der Phase: WARN-Muedigkeit). WARN nur,
// wenn ueberhaupt ein Befund vorliegt; ein durchweg im Band liegender Zustand loggt ruhig.
// KEIN SMS-Alarm hier: der Boot feuert einmal je Prozessstart, der laufende Alarm haengt am
// Sweep (src/billing/cost-truing.js). KEIN Audit: der Befund aendert nichts daran, WAS der
// Dienst ablehnt (Kriterium von AUDITED_BOOT_FINDINGS) - Muster warnUnpricedModels.
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

// Alle fail-closed Boot-Gates gebuendelt (macht INV-5 "rearm NACH allen exit1-Gates"
// strukturell sichtbar - kein Code danach kann ein Gate vergessen). Die vier
// Bestands-Gates unten pruefen zuerst; assertSpendCapCoherence (P3, Klausel A) ist
// das fuenfte, assertProviderRateInBand (LCT P4) das sechste und assertCostTruingBooking
// (LCT P4) das siebte, das noch process.exit(1) rufen kann - warnUnpricedModels/
// warnAlertChannelUnset/warnTariffDrift sind reine Diagnose (nie fatal).
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
  // NOCH process.exit(1) rufen (assertSpendCapCoherence bei Klausel A) - deshalb MUESSEN
  // sie vor rearmActiveCallTimers() stehen (INV-5, s.u. in bootServer).
  assertSpendCapCoherence(config, store);
  warnUnpricedModels(config);
  assertProviderRateInBand(config);
  assertCostTruingBooking(config, store);
  warnAlertChannelUnset(config);
  warnTariffDrift(config, store);
  warnVoiceTariffBelowFullCost(config, store); // NEU: LCT P4b, WARN
}

function logBootBanner(config, port) {
  // TEMP-DIAGNOSE (STT-Live-Abschluss, siehe STATUS.md Abschnitt 2): deployten Commit ausgeben, damit im
  // Render-Log eindeutig sichtbar ist, WELCHE Version laeuft (Render setzt
  // RENDER_GIT_COMMIT). Phase 3: wieder entfernen.
  console.log(`  [boot] deployed commit=${process.env.RENDER_GIT_COMMIT || "unbekannt"}`);
  console.log(`\n  Hermes Gateway laeuft auf ${gatewayUrlForPort(port)}`);
  console.log(`  Dashboard:      ${gatewayUrlForPort(port)}`);
  console.log(
    `  Voice-Engine:   ${config.voice.voiceEngine}${config.voice.voiceEngine === VOICE_ENGINE.REALTIME && !config.voice.openaiApiKey ? "  (ACHTUNG: OPENAI_API_KEY fehlt!)" : ""}`,
  );
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
    `  Nummern-Gates:  Land ${config.safety.allowedCountryCodes.join(",")} | max ${config.safety.maxCallsPerHour} Calls/h | Notruf-/Premium-Denylist aktiv`,
  );
}

export async function bootServer({ app, config, store, lifecycle, callFinish, provisioning, costTruing }) {
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
  setInterval(
    () =>
      void costTruing
        .runCostTruingSweep({ trigger: SWEEP_TRIGGER.INTERVAL })
        .catch((e) => console.error("[cost-truing]", e.message)),
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

  const gracefulShutdown = makeGracefulShutdown({ httpServer, store, config });
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
