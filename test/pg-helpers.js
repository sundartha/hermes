// Test-Helfer fuer das pg-Backend: pglite (Postgres-in-WASM, KEIN Netz, keine
// externe DB -> F.I.R.S.T. erfuellt) hinter dem Runner-Vertrag, den store/pg.js
// erwartet. pglite ist ein-verbindig: withClient reicht die pglite-Instanz als
// Client (query + exec) durch.
import fs from "node:fs";
import { makePgStore, BOOTSTRAP_TENANT_ID } from "../src/store/pg.js";
import { applySchema } from "../src/db/migrate.js";
import { aufraeumenVormerken, vorlage } from "./pglite-helfer.js";

const SCHEMA_DATEI = new URL("../src/db/schema.sql", import.meta.url);
const MIGRATE_DATEI = new URL("../src/db/migrate.js", import.meta.url);

let schemaVorlage = null;
function schemaVorlageHolen() {
  schemaVorlage ??= vorlage("schema", applySchema, [
    fs.readFileSync(SCHEMA_DATEI, "utf8"),
    fs.readFileSync(MIGRATE_DATEI, "utf8"),
  ]);
  return schemaVorlage;
}

export async function makePgTestStore() {
  let store = null;
  const anlegen = aufraeumenVormerken(() => store);
  const db = await anlegen(await schemaVorlageHolen());
  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
  store = makePgStore(runner);
  await store.init();
  return { store, db, runner };
}

export { BOOTSTRAP_TENANT_ID };
