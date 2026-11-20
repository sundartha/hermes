import * as pgSpeicher from "../src/store/pg.js";
import { makePgStore, BOOTSTRAP_TENANT_ID, anrufpauseSetzen } from "../src/store/pg.js";
import { macheSpeicherSperre } from "../src/store/pg.js";
import { applySchema, schemaDdl } from "../src/db/migrate.js";
import { aufraeumenVormerken, neuePglite, vorlage } from "./pglite-helfer.js";

const ROLLE_OHNE_SUPERUSER = "migrations_rolle";

const datenbankJeSpeicher = new WeakMap();

export async function legeMandantAn(store, tenantId) {
  const db = datenbankJeSpeicher.get(store);
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);
  await db.query(`INSERT INTO tenant (id, status) VALUES ($1, 'active')`, [tenantId]);
}

let schemaVorlage = null;
function schemaVorlageHolen() {
  schemaVorlage ??= vorlage("schema", applySchema, [schemaDdl(), String(applySchema)]);
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
  store.setzeAnrufpause = (an) => anrufpauseSetzen(store, an);
  store.withStoreLock = macheSpeicherSperre();
  const { zustandsFunktionen } = await import("../src/store.js");
  Object.assign(store, zustandsFunktionen(store));
  await store.init();
  datenbankJeSpeicher.set(store, db);
  return { store, db, runner };
}

export async function pgliteAlsRolleOhneSuperuser() {
  const db = await neuePglite();
  await db.exec(
    `CREATE ROLE ${ROLLE_OHNE_SUPERUSER} NOLOGIN NOSUPERUSER NOBYPASSRLS;
     GRANT CREATE ON SCHEMA public TO ${ROLLE_OHNE_SUPERUSER};
     SET ROLE ${ROLLE_OHNE_SUPERUSER};`,
  );
  return { query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) };
}

export const einstellungenNachladenVon = (zustand, tenantId) =>
  pgSpeicher.einstellungenNachladenVon(zustand, tenantId);

export const mandantSperreGelesenVon = (zustand, tenantId) =>
  pgSpeicher.mandantSperreGelesenVon(zustand, tenantId);

export const nutzungAuffrischenVon = (zustand, tenantId) =>
  pgSpeicher.nutzungAuffrischenVon(zustand, tenantId);
export const macheRueckfrageSql = (optionen) => pgSpeicher.macheRueckfrageSql(optionen);

export { BOOTSTRAP_TENANT_ID };
export { makePgStore };

export function makePgStoreMitSperre(runner, optionen) {
  const store = makePgStore(runner, optionen);
  store.withStoreLock = macheSpeicherSperre();
  return store;
}

export const schemaErneutAnwenden = (db) =>
  applySchema({ query: (text, werte) => db.query(text, werte), exec: (sql) => db.exec(sql) });
