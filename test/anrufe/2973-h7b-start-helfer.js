import { BASE_ENV, tempDataDir } from "../helpers.js";
import { aufraeumenVormerken, vorlage } from "../pglite-helfer.js";
import { poolAufPglite, serverImportieren } from "../abrechnung/server-mit-testdatenbank.js";

export const MANDANT = "t_start_h7b";
const ANRUFE_LESEN = "SELECT * FROM call WHERE tenant_id = $1";
const ZAEHLER = { gelesen: 0 };
export const GELESENE_ANFRAGEN = [];

export const BEENDETER_ANRUF = "call_h7b_beendet";
export const BEANTWORTETER_ANRUF = "call_h7b_beantwortet";
export const FREMDER_ANRUF = "call_h7b_nur_datenbank";
const TOTE_INSTANZ = "tote-instanz:00000000-0000-4000-8000-000000000042";
const OFFENE_FRAGE = { id: "c0", seq: 0, questions: ["Passt Donnerstag?"], status: "open", askedAt: new Date().toISOString(), answeredAt: null, answeredFacts: 0 };
const ANRUF_EINFUEGEN = `INSERT INTO call (id, tenant_id, stream_token, direction, status, started_at, max_duration_s, consults, instanz)
  VALUES ($1, $2, 'token', 'outbound', $6, $3, 3600, $4::jsonb, $5)`;

function zaehlendeDatenbank(db, scheiterndAb, nachNeuemAnruf) {
  return new Proxy(db, {
    get(ziel, name) {
      if (name !== "query") return Reflect.get(ziel, name).bind(ziel);
      return async (text, params) => {
        if (String(text).startsWith(ANRUFE_LESEN)) {
          ZAEHLER.gelesen += 1;
          GELESENE_ANFRAGEN.push(String(text));
          if (ZAEHLER.gelesen === nachNeuemAnruf) await anrufNurInDerDatenbank(ziel);
          if (ZAEHLER.gelesen > scheiterndAb) throw new Error(LESEFEHLER);
        }
        return ziel.query(text, params);
      };
    },
  });
}

async function anrufNurInDerDatenbank(db) {
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [MANDANT]);
  const fragen = (status) => JSON.stringify([{ ...OFFENE_FRAGE, status }]);
  const jetzt = new Date().toISOString();
  await db.query(ANRUF_EINFUEGEN, [FREMDER_ANRUF, MANDANT, jetzt, fragen("open"), TOTE_INSTANZ, "active"]);
  await db.query(ANRUF_EINFUEGEN, [BEENDETER_ANRUF, MANDANT, jetzt, fragen("open"), TOTE_INSTANZ, "completed"]);
  await db.query(ANRUF_EINFUEGEN, [BEANTWORTETER_ANRUF, MANDANT, jetzt, fragen("answered"), TOTE_INSTANZ, "active"]);
}

export async function startMitDatenbank(scheiterndAb, nachNeuemAnruf = -1) {
  Object.assign(process.env, BASE_ENV, {
    DATA_DIR: tempDataDir(),
    STORE_BACKEND: "pg",
    DATABASE_URL: "postgres://start-h7b-attrappe.invalid/hermes",
    SESSION_SECRET: "start-h7b-signierwert",
  });
  ZAEHLER.gelesen = 0;
  let store = null;
  const anlegen = aufraeumenVormerken(() => store);
  const db = await anlegen(await vorlage("leer", async () => {}, []));
  await db.exec(`CREATE ROLE start_h7b_app NOSUPERUSER NOBYPASSRLS;
    GRANT CREATE, USAGE ON SCHEMA public TO start_h7b_app;
    SET ROLE start_h7b_app;`);
  poolAufPglite(zaehlendeDatenbank(db, scheiterndAb, nachNeuemAnruf));
  store = await import("../../src/store.js");
  await store.oeffneSpeicher();
  const state = store.load();
  state.tenants.push({ id: MANDANT, status: "active", kycLevel: "card", ownerName: "Start H7b" });
  state.numbers.push({
    id: "num_start_h7b",
    tenantId: MANDANT,
    e164: "+4915799990042",
    provider: "telnyx",
    status: "active",
    providerNumberId: "pnum_start_h7b",
    country: "DE",
    language: "de",
    paymentIntentId: null,
  });
  store.save();
  await store.drainFlushes();
  const meldungen = [];
  const log = console.log;
  console.log = (...teile) => meldungen.push(String(teile[0]));
  const ergebnis = await serverImportieren().then(
    (server) => ({ server }),
    (fehler) => ({ fehler }),
  );
  console.log = log;
  ergebnis.server?.close();
  await store.drainFlushes();
  return { ...ergebnis, db, meldungen };
}

export const LESEN_VOR_DEN_RUECKFRAGEN = 5;
export const LESEFEHLER = "Start ohne Datenbank (h7b-test)";
