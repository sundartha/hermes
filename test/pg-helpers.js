import * as pgSpeicher from "../src/store/pg.js";
import { makePgStore, BOOTSTRAP_TENANT_ID, anrufpauseSetzen } from "../src/store/pg.js";
import { macheSpeicherSperre } from "../src/store/pg.js";
import { applySchema, schemaDdl } from "../src/db/migrate.js";
import { aufraeumenVormerken, neuePglite, vorlage } from "./pglite-helfer.js";

const ROLLE_OHNE_SUPERUSER = "migrations_rolle";

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

export { BOOTSTRAP_TENANT_ID };
export { makePgStore };

export const mandantSperreGelesenVon = (zustand, tenantId) =>
  pgSpeicher.mandantSperreGelesenVon(zustand, tenantId);

export const anrufpauseGelesenVon = (zustand) => pgSpeicher.anrufpauseGelesenVon(zustand);

export { anrufpauseSetzen };
