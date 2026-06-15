// Store-Fassade: waehlt das aktive Backend hinter STORE_BACKEND und re-exportiert
// dessen 26 Funktionen. Die Datei MUSS als store.js bestehen bleiben - ESM
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

const backend = config.storeBackend === "pg" ? await createPgBackend() : jsonBackend;

// 26 Namen explizit binden - ESM kann "export * from <Variable>" nicht.
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
  countOutboundCallsSince,
  findTenantByNumber,
  addActionItem,
  toggleActionItem,
  getCalendar,
  addCalendarEvent,
  findConflict,
  trackUsage,
  budgetExceeded,
  globalBudgetExceeded,
  addNotification,
  pruneOldData,
  updateSettings,
  resolveProfile,
  listProfiles,
  setProfile,
  deleteProfile,
} = backend;
