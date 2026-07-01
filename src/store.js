// Store-Fassade: waehlt das aktive Backend hinter STORE_BACKEND und re-exportiert
// dessen Funktionen. Die Datei MUSS als store.js bestehen bleiben - ESM
// resolved "./store.js" NICHT auf ein store/-Verzeichnis, die Caller
// (server/bridge/claude) und der Retention-Test importieren store.js unveraendert.
//
// "json" (Default) = Datei-Persistenz; in diesem Pfad wird KEINE DB-Verbindung
// erzeugt (kein DATABASE_URL noetig) -> heutiger Pfad bleibt laufzeit-bitidentisch.
// "pg" = Postgres: Pool-Konstruktion (Verdrahtung) lebt hier in createPgBackend,
// die Fachlogik in store/pg.js kennt keine Pool-Konstruktion (DIP, P15).
import { config } from "./config.js";
import * as jsonBackend from "./store/json.js";

async function createPgBackend() {
  // Lazy import: pg wird nur im pg-Pfad geladen, der json-Default zieht keine
  // DB-Dependency. ESM-top-level-await haelt das Backend bereit, bevor ein Caller
  // eine der synchronen Store-Funktionen aufruft (Spiegel ist dann hydriert).
  const pg = (await import("pg")).default;
  const { makePgStore } = await import("./store/pg.js");
  const pool = new pg.Pool({ connectionString: config.databaseUrl });
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
if (config.storeBackend === "pg") {
  try {
    backend = await createPgBackend();
  } catch (e) {
    console.error(
      "[store] FATAL: pg-Backend nicht initialisierbar (STORE_BACKEND=pg). " +
        "DB unerreichbar oder Init fehlgeschlagen. Ursache: " +
        (e && e.message ? e.message : String(e)),
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
  newId,
  createCall,
  getCall,
  addTranscript,
  purgeTranscript,
  markAnswered,
  endCallRecord,
  markSummarySmsSent,
  recordFailureReason,
  countOutboundCallsSince,
  findTenantByNumber,
  numberRecordByE164,
  resolveCallLanguage,
  addActionItem,
  toggleActionItem,
  getCalendar,
  addCalendarEvent,
  findConflict,
  trackUsage,
  budgetExceeded,
  globalBudgetExceeded,
  reserveExceedsBudget,
  addVoiceUsageCostCents,
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
  setTenantStripe,
  tenantStripe,
  // W4: Abo-Referenzen - Setter (Subscribe + Webhook) + Reader (Self-Service-View) +
  // Lookup (Webhook-Tenant-Aufloesung ueber subscriptionId). Muster wie setTenantStripe/
  // tenantStripe. OHNE diese Re-Exports sind sie auf der Fassade undefined -> subscribe.js
  // und der Webhook-Helper werfen zur Laufzeit einen TypeError.
  setTenantSubscription,
  tenantSubscription,
  findTenantBySubscription,
  // P1 (Stripe-Cancel-Nummer-Leak-Fix, PLAN-STRIPE-CANCEL-NUMBER-LEAK.md): Setter fuer
  // SUSPEND (Webhook) + dessen Kehrseite fuer ACTIVATE (Webhook + Self-Service-Subscribe,
  // activatePaidTenant). Muster wie setTenantSubscription. OHNE diese Re-Exports sind sie
  // auf der Fassade undefined -> applyStripeWebhook UND activatePaidTenant werfen zur
  // Laufzeit einen TypeError.
  markTenantNumbersCancelled,
  reactivateTenantCancelledNumbers,
  // F2: private Summary-Nummer - Setter (Onboard/Self-Service P4/P5) + Reader (finishCall
  // P7 via planSummarySms). Muster wie setTenantStripe/tenantStripe. OHNE diese Re-Exports
  // sind sie auf der Fassade undefined -> self-service-routes UND planSummarySms werfen zur
  // Laufzeit einen TypeError (die Backends json.js/pg.js exportieren beide; die Fassade ist
  // die EINE Quelle fuer server.js).
  setPrivateNumber,
  tenantPrivateNumber,
  setTenantGeo,
  seedBootstrapNumber,
  // P2b: Bootstrap-Tenant-Setup (CLI scripts/bootstrap-tenant.js). OHNE diesen Re-Export
  // ist store.bootstrapTenant undefined -> das CLI wuerfe einen TypeError.
  bootstrapTenant,
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
// HARD-RULE (Re-Entrancy): ein withStoreLock(fn)-Body darf NIE erneut withStoreLock
// aufrufen (die Kette wartet sonst auf sich selbst -> Deadlock). Kritische Abschnitte
// kurz halten: load() -> mutiere -> save(), kein fremdes await dazwischen.
let _writeChain = Promise.resolve();
export function withStoreLock(fn) {
  const run = () => fn();
  // .then(run, run): ein Fehler im Body bricht die Kette NICHT ab - ein fehlgeschlagener
  // Write darf nicht alle folgenden Writes blockieren.
  _writeChain = _writeChain.then(run, run);
  return _writeChain;
}
