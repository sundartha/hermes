// Runner fuer das pg-Backend ueber einen pg.Pool - die EINE Verdrahtung fuer die Store-Fassade
// (src/store.js, Server-Boot) und fuer Betreiber-Skripte, die den pg-Store ohne die Fassade
// oeffnen (scripts/seed-reviewer-demo.mjs: deren Import wuerde migrieren).
// Runner-Vertrag (siehe db/migrate.js + store/pg.js):
//   query(text, params) -> {rows}  : eine parametrisierte Anweisung
//   exec(sqlScript)                : Mehrfach-Anweisung (DDL); pg.Pool.query mit
//                                    reinem Text laeuft im Simple-Query-Modus
//   withClient(fn)                 : EINE Verbindung fuer Transaktion + GUC
//                                    (auf dem Pool waere sonst jede Anweisung
//                                    eine andere Session -> Transaktion/RLS-GUC
//                                    broeckeln)
// Lazy import: pg wird erst hier geladen, der json-Default zieht keine DB-Dependency.
// close() beendet den Pool (Skripte; der Server haelt ihn bis zum Prozessende).
export async function createPgPoolRunner(connectionString) {
  const pg = (await import("pg")).default;
  const pool = new pg.Pool({ connectionString });
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
  return { runner, close: () => pool.end() };
}
