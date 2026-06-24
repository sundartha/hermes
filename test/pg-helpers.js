// Test-Helfer fuer das pg-Backend: pglite (Postgres-in-WASM, KEIN Netz, keine
// externe DB -> F.I.R.S.T. erfuellt) hinter dem Runner-Vertrag, den store/pg.js
// erwartet. pglite ist ein-verbindig: withClient reicht die pglite-Instanz als
// Client (query + exec) durch.
import { PGlite } from "@electric-sql/pglite";
import { makePgStore, BOOTSTRAP_TENANT_ID } from "../src/store/pg.js";

// Liefert {store, db, runner}. store ist bereits initialisiert (migriert +
// hydriert). db ist die rohe pglite-Instanz fuer Direktzugriffe im Test.
export async function makePgTestStore() {
  const db = new PGlite();
  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  return { store, db, runner };
}

export { BOOTSTRAP_TENANT_ID };
