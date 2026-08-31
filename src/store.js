// Store-Fassade: waehlt das aktive Backend hinter STORE_BACKEND und re-exportiert
// dessen Funktionen. Die Datei MUSS als store.js bestehen bleiben - ESM
// resolved "./store.js" NICHT auf ein store/-Verzeichnis, die Caller
// (server/bridge/claude) und der Retention-Test importieren store.js unveraendert.
//
// "json" (Default) = Datei-Persistenz; in diesem Pfad wird KEINE DB-Verbindung
// erzeugt (kein DATABASE_URL noetig) -> heutiger Pfad bleibt laufzeit-bitidentisch.
// "pg" = Postgres: Pool-Konstruktion (Verdrahtung) lebt hier in createPgBackend,
// die Fachlogik in store/pg.js kennt keine Pool-Konstruktion (DIP, P15).
import { AsyncLocalStorage } from "node:async_hooks";
import { config } from "./config.js";
import * as jsonBackend from "./store/json.js";
import { makeChainMutex } from "./chain-mutex.js";

async function createPgBackend() {
  // Lazy import: pg wird nur im pg-Pfad geladen, der json-Default zieht keine
  // DB-Dependency. ESM-top-level-await haelt das Backend bereit, bevor ein Caller
  // eine der synchronen Store-Funktionen aufruft (Spiegel ist dann hydriert).
  const pg = (await import("pg")).default;
  const { makePgStore } = await import("./store/pg.js");
  const pool = new pg.Pool({ connectionString: config.store.databaseUrl });
  // Runner-Vertrag (siehe db/migrate.js + store/pg.js):
  //   query(text, params) -> {rows}  : eine parametrisierte Anweisung
  //   exec(sqlScript)                : Mehrfach-Anweisung (DDL); pg.Pool.query mit
  //                                    reinem Text laeuft im Simple-Query-Modus
  //   withClient(fn)                 : EINE Verbindung fuer Transaktion + GUC
  //                                    (auf dem Pool waere sonst jede Anweisung
  //                                    eine andere Session -> Transaktion/RLS-GUC
  //                                    broeckeln)
  const runner = {
    async withClient(fn) {
      const client = await pool.connect();
      try {
        return await fn({
          query: (text, params) => client.query(text, params),
          exec: (sql) => client.query(sql),
        });
      } finally {
        client.release();
      }
    },
  };
  const store = makePgStore(runner);
  await store.init();
  return store;
}

// AC6: pg-Store ist eine HARTE Dependency (Persistenz auch fuer Telefonie). Ist die
// DB beim Boot unerreichbar / schlaegt die Init fehl, MUSS der Prozess mit klarer,
// secret-freier Diagnose sterben (exit 1) statt mit roher pg-Rejection (die einen
// Connection-String-Fragment im Stack leaken koennte) ODER - schlimmer - still auf
// json zurueckzufallen (Backend-Split-Brain / Daten-Inkonsistenz). Der globale
// uncaughtException-Guard (AC4) wuerde die Rejection sonst nur loggen und der Prozess
// liefe ohne Persistenz weiter - darum hier ein eigener, diagnostizierter Exit.
let backend;
if (config.store.storeBackend === "pg") {
  try {
    backend = await createPgBackend();
  } catch (err) {
    console.error(
      "[store] FATAL: pg-Backend nicht initialisierbar (STORE_BACKEND=pg). " +
        "DB unerreichbar oder Init fehlgeschlagen. Ursache: " +
        (err && err.message ? err.message : String(err)),
    );
    process.exit(1);
  }
} else {
  backend = jsonBackend;
}

// Namen explizit binden - ESM kann "export * from <Variable>" nicht.
export const {
  load,
  save,
  // F11 (Review-Blocker Runde 1, S1-B): siehe store/pg.js - draint die tatsaechlich
  // aktuelle Flush-Kette (nicht nur die frueh zurueckgegebene Referenz von save()).
  drainFlushes,
  newId,
  createCall,
  getCall,
  // Brain-Shim-Korrelation (E1): beide Backends exportieren die Query, Fassade = EINE
  // Quelle. Ohne diesen Re-Export waere store.getCallByControlId undefined -> der Shim
  // wuerfe zur Laufzeit einen TypeError.
  getCallByControlId,
  // F12 (A6): dem Prozess unbekannten, aber in der DB aktiven Call RLS-sauber nachladen
  // (Deploy-Instanzwechsel). pg = Tenant-Loop; json = getCall. OHNE diesen Re-Export waere
  // store.attachActiveCall undefined -> der /voice-Re-Attach-Pfad wuerfe zur Laufzeit einen
  // TypeError. Beide Backends exportieren die Methode -> die Fassade ist die EINE Quelle.
  attachActiveCall,
  // KS-P1b: dieselbe Nachladung ueber die call_control_id (Assistant-Shim, E1). OHNE
  // diesen Re-Export waere store.attachActiveCallByControlId undefined -> der Shim-Re-
  // Attach-Pfad wuerfe zur Laufzeit einen TypeError (Muster attachActiveCall/
  // getCallByControlId). Beide Backends exportieren die Methode.
  attachActiveCallByControlId,
  addTranscript,
  // GQ-H1-a: eine von Telnyx verworfene, nie gesprochene Antwort wieder aus dem Transkript
  // nehmen. Beide Backends exportieren die Methode -> die Fassade ist die EINE Quelle;
  // ohne diesen Re-Export waere store.dropLastAgentTranscript undefined und der Shim-Pfad
  // wuerfe zur Laufzeit einen TypeError.
  dropLastAgentTranscript,
  purgeTranscript,
  markAnswered,
  // KS-EL1: der Anker nachziehen (elevenlabs/outbound.js, answeredAnchorOutcome). OHNE
  // diesen Re-Export waere store.trueUpAnsweredAt auf der Fassade undefined -> der
  // Ergebnisweg wuerfe zur Laufzeit einen TypeError (Muster markAnswered).
  trueUpAnsweredAt,
  // KS-EL1: der Grund, wenn der Anker nicht ermittelbar war. OHNE diesen Re-Export waere
  // store.recordAnsweredUnclearReason auf der Fassade undefined -> derselbe Fehler (Muster
  // recordElevenlabsConversationId).
  recordAnsweredUnclearReason,
  endCallRecord,
  setCallEndedAt, // F9 (A6): Seam fuer F10/F12 (expliziter End-Anker)
  markSummarySmsSent,
  // F2-Mail: persistierter Dedup-Marker fuer die Call-Summary-Mail (Muster markSummarySmsSent).
  // OHNE diesen Re-Export waere store.markSummaryMailSent undefined -> finishCall wuerfe zur
  // Laufzeit einen TypeError.
  markSummaryMailSent,
  markBilled, // F9 (A6): Bucht-Idempotenz-Marker
  markInboxEntry, // INBOX-P1: Qualifikations-Marker
  // INBOX-P2: die EINE Konsum-Operation (Auswahl + Projektion + Markierung, synchron).
  // OHNE diesen Re-Export waere store.takeInboxEntries auf der Fassade undefined -> der
  // Poll-Endpunkt wuerfe zur Laufzeit einen TypeError (Muster markInboxEntry).
  takeInboxEntries,
  recordCallEstimatedCostCents, // LCT P2: gebuchter Schaetzbetrag am Call
  recordCallCostTruingResult, // LCT P3: Ergebnis des Kosten-Abgleichs am Call
  recordFailureReason,
  // AL-P1: Conversation-UUID (Latenz-Achse) + Anrufer-Turn-Zaehler (Abbruch-Achse).
  // OHNE diese Re-Exports waeren sie auf der Fassade undefined -> der Call-Control-Ingest
  // bzw. agentTurn wuerfen zur Laufzeit einen TypeError.
  recordTelnyxConversationId,
  // EL-BL1: das ElevenLabs-Handle (Bindungs-Kennung des Rueckfrage-Webhooks). OHNE
  // diesen Re-Export waere store.recordElevenlabsConversationId auf der Fassade
  // undefined -> der Schreibweg wuerfe zur Laufzeit einen TypeError (Muster
  // recordTelnyxConversationId).
  recordElevenlabsConversationId,
  // Phase-6-Voraussetzung: der Join-Schluessel zwischen ElevenLabs- und Telefonie-Kosten.
  // OHNE diesen Re-Export waere store.recordSipCallId auf der Fassade undefined -> der
  // ziehende Ergebnisweg wuerfe zur Laufzeit einen TypeError (Muster
  // recordElevenlabsConversationId).
  recordSipCallId,
  // KV2-2: das an der Engine-Weiche gesetzte Kostenprofil. OHNE diesen Re-Export waere
  // store.recordCostProfile auf der Fassade undefined -> beide Weichen wuerfen zur
  // Laufzeit einen TypeError (Muster recordSipCallId).
  recordCostProfile,
  // OUTBOUND-E5: Absender-Wahrheit + Registrierungs-Herkunft. OHNE diese Re-Exports waeren
  // store.recordActualSender / store.recordFromRegistrationSource auf der Fassade undefined
  // -> der EL-Anrufstart bzw. der Ergebnisweg wuerfen zur Laufzeit einen TypeError
  // (Muster recordSipCallId).
  recordActualSender,
  recordFromRegistrationSource,
  // EL-Anrufstart: Zusammenfassung + Befund eines vom Anbieter gefuehrten Gespraechs. OHNE
  // diesen Re-Export waere store.recordProviderCallResult auf der Fassade undefined -> der
  // ziehende Ergebnisweg wuerfe zur Laufzeit einen TypeError (Muster
  // recordElevenlabsConversationId).
  recordProviderCallResult,
  // ABNAHME-D1 (TEIL 2): die vier vom Agenten strukturiert gesammelten Angaben
  // (appointment_date/appointment_time/amount/currency). OHNE diesen Re-Export waere
  // store.recordProviderCollectedFields auf der Fassade undefined -> der ziehende
  // Ergebnisweg wuerfe zur Laufzeit einen TypeError (Muster recordProviderCallResult).
  recordProviderCollectedFields,
  // ABNAHME-D1 (TEIL 3): die im Gespraech bestaetigte Zeitzone des Angerufenen, mit
  // Herkunft und Zeitstempel. OHNE diesen Re-Export waere store.recordCalleeConfirmedTimezone
  // auf der Fassade undefined -> derselbe Fehler (Muster recordProviderCollectedFields).
  recordCalleeConfirmedTimezone,
  countCallerTurn,
  // AL-P13: Consult-Kette. OHNE diese Re-Exports waeren sie auf der Fassade undefined
  // -> die Consult-Routen wuerfen zur Laufzeit einen TypeError (Muster countCallerTurn).
  emitConsult,
  answerConsult,
  // GQ-P7: Zustell-Marker der eingetroffenen Rueckfrage-Antwort. OHNE diesen Re-Export
  // waere store.markConsultAnswerDelivered auf der Fassade undefined -> der Shim wuerfe
  // zur Laufzeit einen TypeError (Muster answerConsult).
  markConsultAnswerDelivered,
  expireOpenConsults,
  pendingConsult,
  // AL-P14: In-Call-Rueckfrage. OHNE diese Re-Exports waeren sie auf der Fassade
  // undefined -> agentTurn bzw. die Poll-Route wuerfen zur Laufzeit einen TypeError.
  advanceInCallConsult,
  noteConsultPoll,
  // AL-P10b: Suchtreffer + Kontingent-Zaehler des In-Call-Nachschlags. OHNE diese
  // Re-Exports waeren sie auf der Fassade undefined -> performLookupRequest wuerfe zur
  // Laufzeit einen TypeError (Muster advanceInCallConsult).
  addLookupFacts,
  countCallLookup,
  // Thema B (2026-08-19): Recherche-Protokoll des EL-Wegs. OHNE diese Re-Exports
  // waeren sie auf der Fassade undefined -> der Lookup-Webhook wuerfe zur Laufzeit
  // einen TypeError (Muster addLookupFacts).
  recordCallLookup,
  finishCallLookup,
  // P3.2: No-Speech-Staffel-Zaehler (ephemer). OHNE diese Re-Exports waeren sie auf der
  // Fassade undefined -> /voice/turn wuerfe zur Laufzeit einen TypeError.
  countNoSpeechTurn,
  clearNoSpeechStreak,
  countOutboundCallsSince,
  // AL-P12: Beziehungsgedaechtnis. OHNE diesen Re-Export waere store.counterpartyMemory
  // undefined -> systemPrompt wuerfe zur Laufzeit einen TypeError (Muster countCallerTurn).
  counterpartyMemory,
  findTenantByNumber,
  numberRecordByE164,
  resolveCallLanguage,
  // P15/T2: Sprache eines Tenants ohne laufenden Call (Anzeigetext der Gate-Ablehnung).
  // Beide Backends exportieren sie -> die Fassade ist die EINE Quelle; ohne diesen
  // Re-Export waere store.tenantLanguage undefined -> outbound-gates.js wuerfe zur
  // Laufzeit einen TypeError. Muster wie resolveCallLanguage.
  tenantLanguage,
  addActionItem,
  // GQ-P10: die bereits notierten Nachrichten DIESES Calls. OHNE diesen Re-Export waere
  // store.callActionItems auf der Fassade undefined -> systemPrompt wuerfe zur Laufzeit
  // einen TypeError (Muster counterpartyMemory).
  callActionItems,
  toggleActionItem,
  getCalendar,
  addCalendarEvent,
  findConflict,
  trackUsage,
  budgetExceeded,
  reserveExceedsBudget,
  // KS-P2: Live-Verbrauchs-Gate + seine Basis. OHNE diese Re-Exports waeren sie auf der
  // Fassade undefined -> blockingBudgetAxis (claude.js/telnyx-llm-shim.js) wuerfe zur
  // Laufzeit einen TypeError. Beide Backends exportieren sie -> die Fassade ist die EINE
  // Quelle. Muster wie reserveExceedsBudget.
  liveBudgetExceeded,
  activeCallsFor,
  // Diagnose-Snapshot der Tenant-Achse (P5a): OHNE diesen Re-Export waere
  // store.tenantBudgetSnapshot undefined -> makeReadRoutes/outbound-gates.js wuerfen zur
  // Laufzeit einen TypeError. Muster wie reserveExceedsBudget (reine Query).
  tenantBudgetSnapshot,
  addVoiceUsageCostCents,
  // AL-P10: Suchgebuehr der Vorab-Recherche. Beide Backends exportieren die Fn -> die
  // Fassade ist die EINE Quelle; ohne diesen Re-Export waere store.addResearchFeeCostCents
  // undefined -> src/llm-usage.js wuerfe zur Laufzeit einen TypeError.
  addResearchFeeCostCents,
  // LCT P4: Korrekturbuchung (Umrechnung + Fall-Entscheidung + Rest, ein Schritt). OHNE
  // diesen Re-Export waere die Methode auf der Fassade undefined -> der Sweep wuerfe zur
  // Laufzeit einen TypeError.
  applyCostCorrectionCents,
  // Reserve-Ledger (OUT-05): OHNE diese Re-Exports sind sie auf der Fassade undefined -> die
  // server.js-Verdrahtung (F2) wuerfe zur Laufzeit einen TypeError. Muster wie reserveExceedsBudget.
  tryReserveOutboundBudget,
  releaseOutboundReserve,
  reservationOf,
  // Plattform-Fruehwarnung (Budget-Achsen P6): OHNE diesen Re-Export waere
  // store.claimPlatformSpendWarning undefined -> outbound-gates.js wuerfe zur Laufzeit
  // einen TypeError. Muster wie tryReserveOutboundBudget.
  claimPlatformSpendWarning,
  // ElevenLabs-Kontingent-Zaehler (LCT P7): OHNE diese Re-Exports waeren
  // store.recordTtsCharacters/store.platformTtsUsageView undefined -> directive-synth.js
  // UND makeBillingRoutes wuerfen zur Laufzeit einen TypeError. Muster claimPlatformSpendWarning.
  recordTtsCharacters,
  platformTtsUsageView,
  // ElevenLabs-Zeichen pro Tenant (KE-P6): OHNE diesen Re-Export waere
  // store.recordTenantTtsCharacters undefined -> billing/cost-truing.js wuerfe zur Laufzeit
  // einen TypeError. Muster recordTtsCharacters.
  recordTenantTtsCharacters,
  // KV-P7 (Massnahme 3): Telnyx-Relay-Verbrauch des ElevenLabs-Kontingents. OHNE diesen
  // Re-Export waere store.recordRelayTtsCharacters undefined -> billing/cost-truing.js
  // wuerfe zur Laufzeit einen TypeError. Muster recordTenantTtsCharacters.
  recordRelayTtsCharacters,
  // KV-M4 (Riegel der monatlichen Gegenprobe): OHNE diesen Re-Export waere
  // store.markCostCrossCheckAttempted undefined -> billing/cost-cross-check.js wuerfe zur
  // Laufzeit einen TypeError. Muster recordTenantTtsCharacters.
  markCostCrossCheckAttempted,
  usageOf,
  addNotification,
  pruneOldData,
  eraseTenantData,
  exportTenantData,
  updateSettings,
  resolveProfile,
  listProfiles,
  setProfile,
  deleteProfile,
  tenantContext,
  resolveTenant,
  // tenant-prolif-b: Nach-Boot-Bindung eines (evtl. gemergten) sub in den Resolver-Index.
  // Beide Backends exportieren die Fn -> die Fassade ist die EINE Quelle; ohne diesen Re-Export
  // waere store.bindSubToTenant undefined -> mintSession (web-auth) wuerfe zur Laufzeit TypeError.
  bindSubToTenant,
  // Signup-Spiegel-Nachzug: pg zieht einen nach Boot per Web-Login angelegten Tenant in den
  // Spiegel (sonst werfen die WRITE-Setter auf dem Subscribe-Pfad fail-closed); json = No-Op.
  // OHNE diesen Re-Export waere store.ensureTenant undefined -> mintSession (web-auth) UND
  // triggerTenantProvisioning (server) wuerfen zur Laufzeit einen TypeError.
  ensureTenant,
  setTenantBudget,
  recordUsageEvent,
  dailySmsCount,
  planMinutesExceeded,
  pendingMeterEvents,
  markMeterEventsSent,
  setKycLevel,
  kycReached,
  // W5: Abo-gekoppeltes Outbound-Allowlist-Gate - Lockerungssignal (aktiver, KYC-
  // verifizierter Subscriber) + Defense-in-depth-Hard-Block (suspended/closed). OHNE
  // diese Re-Exports sind sie auf der Fassade undefined -> das Gate in server.js wuerfe
  // zur Laufzeit einen TypeError. Muster wie kycReached (reine Queries).
  tenantActiveSubscriber,
  tenantInactive,
  // tenant-prolif-c: Grace-Anker suspended_at (Webhook-Suspend stempelt set-if-absent,
  // activatePaidTenant loescht). Beide Backends exportieren die Fn -> die Fassade ist die EINE
  // Quelle; ohne diese Re-Exports waeren store.setSuspendedAtIfAbsent/clearSuspendedAt/
  // tenantSuspendedAt je nach Backend undefined -> Webhook/Activation wuerfen zur Laufzeit TypeError.
  setSuspendedAtIfAbsent,
  clearSuspendedAt,
  tenantSuspendedAt,
  // GAP-01: Perioden-Fenster des Budget-Gates (billing/activation.js stempelt es). Ohne
  // diesen Re-Export waere store.stampBudgetPeriod auf der Fassade undefined -> die
  // Aktivierung wuerfe zur Laufzeit einen TypeError. Muster wie clearSuspendedAt.
  stampBudgetPeriod,
  setTenantStripe,
  tenantStripe,
  // W4: Abo-Referenzen - Setter (Subscribe + Webhook) + Reader (Self-Service-View) +
  // Lookup (Webhook-Tenant-Aufloesung ueber subscriptionId). Muster wie setTenantStripe/
  // tenantStripe. OHNE diese Re-Exports sind sie auf der Fassade undefined -> subscribe.js
  // und der Webhook-Helper werfen zur Laufzeit einen TypeError.
  setTenantSubscription,
  tenantSubscription,
  findTenantBySubscription,
  // GAP-03 (O2): Tenant-Aufloesung ueber die Customer-Referenz + Outbound-Sperrgrund-Ledger.
  // OHNE diese Re-Exports sind sie auf der Fassade undefined -> billing/webhook.js UND
  // outbound-gates.js wuerfen zur Laufzeit einen TypeError. Muster wie findTenantBySubscription.
  findTenantByCustomer,
  setBillingHold,
  clearBillingHold,
  billingHoldActive,
  // 312k-Phase 4: Vertragsende-Aufraeumarbeiten nach KUENDIGUNG (Rufnummer freigeben +
  // WorkOS-Identitaet loeschen) - Fortschritts-Speicher + Retry-Selektor + Identitaets-
  // Leser. OHNE diese Re-Exports waeren sie auf der Fassade undefined -> billing/
  // contract-end-cleanup.js wuerfe zur Laufzeit einen TypeError. Beide Backends
  // exportieren sie -> die Fassade ist die EINE Quelle (Muster billingHoldActive).
  setContractEndCleanupPending,
  contractEndCleanupPending,
  tenantsPendingContractEndCleanup,
  tenantIdpSubject,
  // 312k-Phase 5: Kuendigungsbestaetigung per E-Mail - Fortschritts-Speicher + Retry-
  // Selektor (Muster setContractEndCleanupPending/Nachbarn). OHNE diese Re-Exports waeren
  // sie auf der Fassade undefined -> billing/cancellation-mail.js wuerfe zur Laufzeit
  // einen TypeError. Beide Backends exportieren sie -> die Fassade ist die EINE Quelle.
  setCancellationMailPending,
  cancellationMailPending,
  tenantsPendingCancellationMail,
  // F2: private Summary-Nummer - Setter (Onboard/Self-Service P4/P5) + Reader (finishCall
  // P7 via planSummarySms). Muster wie setTenantStripe/tenantStripe. OHNE diese Re-Exports
  // sind sie auf der Fassade undefined -> self-service-routes UND planSummarySms werfen zur
  // Laufzeit einen TypeError (die Backends json.js/pg.js exportieren beide; die Fassade ist
  // die EINE Quelle fuer server.js).
  setPrivateNumber,
  tenantPrivateNumber,
  setTenantGeo,
  // Leser derselben Achse (GAP-35, Denial-Metrik). Muster wie tenantStripe zu
  // setTenantStripe; ohne diesen Re-Export ist store.tenantGeo auf der Fassade undefined.
  tenantGeo,
  // P8/FMT-28: Leser der Tenant-Zeitzone (nur Anzeige, claude.js). Muster wie tenantGeo -
  // ohne diesen Re-Export ist store.tenantTimezone auf der Fassade undefined.
  tenantTimezone,
  seedBootstrapNumber,
  // P2b: Bootstrap-Tenant-Setup (CLI scripts/bootstrap-tenant.js). OHNE diesen Re-Export
  // ist store.bootstrapTenant undefined -> das CLI wuerfe einen TypeError.
  bootstrapTenant,
  // Newsletter-Einwilligung pro Tenant (Opt-in, DSGVO Art. 7 Abs. 1) - Setter (Self-Service-
  // Route) + Reader (Self-Service-State-View). Muster wie setPrivateNumber/tenantPrivateNumber.
  // OHNE diese Re-Exports sind sie auf der Fassade undefined -> self-service-routes wuerfe
  // zur Laufzeit einen TypeError (die Backends json.js/pg.js exportieren beide; die Fassade
  // ist die EINE Quelle fuer server.js).
  setNewsletterConsent,
  tenantNewsletterConsent,
  // Newsletter-Zusatzempfaenger (Double-Opt-in) - Queries + Mutationen + die beiden
  // oeffentlichen Token-Pfade (confirm/unsubscribe). Muster setPrivateNumber/tenantPrivateNumber.
  // OHNE diese Re-Exports sind sie auf der Fassade undefined -> self-service-routes wuerfe
  // zur Laufzeit einen TypeError (die Backends json.js/pg.js exportieren beide; die Fassade
  // ist die EINE Quelle fuer server.js).
  tenantNewsletterRecipients,
  confirmedNewsletterRecipients,
  dailyNewsletterConfirmMailCount,
  addNewsletterRecipient,
  removeNewsletterRecipient,
  confirmNewsletterRecipientByToken,
  unsubscribeNewsletterRecipientByToken,
} = backend;

// withStoreLock(fn) - prozess-lokaler Single-Writer-Guard (OT-3 AC2). Serialisiert
// read-modify-write-Sequenzen, die ein await zwischen load() und save() haben, damit
// kein Lost Update entsteht. BEWUSST auf Fassaden-Ebene (nicht im json-Backend): der
// Mutex ist eine JS-Nebenlaeufigkeits-Eigenschaft des EINEN Node-Prozesses und damit
// backend-unabhaengig - so ist store.withStoreLock auch im pg-Pfad definiert (sonst
// waere es undefined und die /api/onboard-Route wuerfe einen TypeError).
//
// Innerhalb EINES Node-Prozesses teilen sich alle Caller dasselbe Modul-`state` -> ein
// In-Process-Mutex genuegt. Ein Multi-Prozess-Deploy braeuchte einen File-Lock (heute
// n/a: Render free plan = 1 Instanz; bewusst akzeptiertes Prototyp-Risiko, siehe
// PLAN-SECURITY.md OT-3).
//
// HARD-RULE (Re-Entrancy, P2 strukturell erzwungen): ein withStoreLock(fn)-Body darf NIE
// erneut withStoreLock aufrufen (die Kette wartet sonst auf sich selbst -> prozessweiter
// Zirkel-Deadlock, der alle folgenden Call-/Budget-/Transkript-Writes still einfriert).
// Frueher nur per Konvention (dieser Kommentar) behauptet; jetzt strukturell gesichert:
// storeLockContext (AsyncLocalStorage) markiert den GERADE laufenden Lock-Body. Ein zweiter
// Aufruf, dessen Kontext den Marker schon traegt (direkt ODER transitiv ueber await-
// Schichten), wirft SYNCHRON - der Stack zeigt auf die schuldige Zeile, statt still zu
// haengen. Kritische Abschnitte trotzdem kurz halten: load() -> mutiere -> save(), kein
// fremdes await dazwischen.
//
// KEIN Modul-Flag: ein Boolean wuerde legitime NEBENLAEUFIGE (nicht verschachtelte) Aufrufe
// faelschlich abweisen. AsyncLocalStorage bindet den Marker an genau EINEN Ausfuehrungs-
// Kontext; ein nachrueckender Lauf erbt ihn nicht (der .then-Callback laeuft im Kontext
// seiner Registrierung, nicht dem des aufloesenden Laufs) -> normale Serialisierung bleibt.
// REENTRANCY_MARKER ist ein Sentinel; nur seine Anwesenheit zaehlt, nie sein Inhalt.
//
// Ketten-Mechanik ausgelagert nach chain-mutex.js (G5, geteilt mit makeSingleFlight in
// src/single-flight.js) - EIGENE Chain-Instanz hier (runStoreExclusive), der lange
// Provisioning-Drain-Await darf diese kurze Store-Schreib-Serialisierung nicht blockieren.
const runStoreExclusive = makeChainMutex();
const storeLockContext = new AsyncLocalStorage();
const REENTRANCY_MARKER = Symbol("store-lock-active");
export function withStoreLock(fn) {
  // Synchron werfen, BEVOR ein weiterer .then an die Kette gehaengt wird - sonst reiht sich
  // der innere Lauf HINTER dem aeusseren ein, auf den er wartet (Deadlock).
  if (storeLockContext.getStore()) {
    throw new Error(
      "withStoreLock reentrant: ein withStoreLock-Body darf NIE erneut withStoreLock aufrufen " +
        "(Deadlock-Schutz). Verschachtelten Store-Lock aufloesen; kritischen Abschnitt kurz halten.",
    );
  }
  // fn NICHT direkt an runStoreExclusive geben: der Marker wird erst gesetzt, wenn der Lauf
  // TATSAECHLICH startet (storeLockContext.run laeuft im .then-Callback der Kette), nicht schon
  // bei der Registrierung - so erbt ein legitimer nachrueckender Lauf den Marker nicht.
  return runStoreExclusive(() => storeLockContext.run(REENTRANCY_MARKER, fn));
}
