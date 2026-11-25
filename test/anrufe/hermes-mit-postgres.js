import assert from "node:assert/strict";
import pg from "pg";

import { ANRUF_SPERRE_NAMENSRAUM } from "../../src/begriffe/speicher.js";
import { echtWarten } from "../echt-warten.js";
import { fristAblaufMeldung } from "../gemeinsam/instanz-ausgabe.js";
import { OWNER_TEST_FIRST_NAME, OWNER_TEST_LAST_NAME, startServer } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { mitVerbindung } from "../gemeinsam/echtes-postgres.js";
import { elInboundInitSpawnEnv } from "../_iel-inbound-harness.js";
import { pgStartUmgebung } from "../gemeinsam/pg-start-umgebung.js";
import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { starteAnrufstartAttrappe } from "./elevenlabs-anrufstart-attrappe.js";
import { starteAttrappe } from "./attrappen-server.js";

const SQL_FRIST_MS = 30_000;
const SQL_TAKT_MS = 50;
const ZIEL_VORWAHL = "+49151123401";
const ZIEL_STELLEN = 3;
const ANRUFE_SQL = "SELECT id, status, failure_reason, to_e164 FROM call ORDER BY seq";
const REGISTRIERUNG = "phnum_pg_seed";

const EL_WEG = Object.freeze({
  ...elInboundInitSpawnEnv("agent_pg"),
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  TELNYX_CALL_CONTROL_APP_ID: "cc_app_pg",
  TELNYX_API_KEY: "KEYtest-pg",
  TELNYX_CONNECTION_ID: "conn_pg",
  TELNYX_ACCOUNT_SID: "acct_pg",
  ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_pg",
  ELEVENLABS_API_KEY: "el-pg-schluessel",
  ELEVENLABS_RESULT_POLL_MS: "60000",
});

const anbieterUmgebung = (url) => ({ ELEVENLABS_API_BASE: url, TELNYX_API_BASE: url });
const ANRUF_TOKEN_SQL = "SELECT stream_token, from_e164 FROM call WHERE id = $1";

let instanzZaehler = 0;

const mitPinnung = (env, mandantGepinnt = true) =>
  mandantGepinnt ? env : { ELEVENLABS_INBOUND_TENANT_IDS: "", ...env };

export async function starteAnAnbieter(db, anbieter, env) {
  const host = `instanz-${(instanzZaehler += 1)}.agent.test`;
  const srv = await startServer({
    env: pgStartUmgebung(db.adresse, {
      ...EL_WEG,
      ...anbieterUmgebung(anbieter.url),
      PUBLIC_URL: `https://${host}`,
      ...env,
    }),
  });
  anbieter.verbinde({
    host,
    url: srv.localUrl,
    agentId: env.ELEVENLABS_AGENT_ID ?? EL_WEG.ELEVENLABS_AGENT_ID,
    leseAnruf: async (callId) => {
      const { rows } = await mitVerbindung(adminAdresse(db.adresse), (verwaltung) =>
        verwaltung.query(ANRUF_TOKEN_SQL, [callId]),
      );
      return rows[0] ? { streamToken: rows[0].stream_token, from: rows[0].from_e164 } : null;
    },
  });
  return srv;
}

export function postgresVorhanden() {
  if (process.env[POSTGRES_VARIABLE]) return true;
  assert.ok(
    !process.env.CI,
    `${POSTGRES_VARIABLE} fehlt unter CI: der Test darf nicht still entfallen`,
  );
  return false;
}

function adminAdresse(rollenAdresse) {
  const url = new URL(process.env[POSTGRES_VARIABLE]);
  url.pathname = new URL(rollenAdresse).pathname;
  return url.href;
}

async function seedeBootstrapMandant(sql) {
  await sql(`UPDATE tenant SET owner_name = $2, first_name = $3 WHERE id = $1`, [
    BOOTSTRAP_TENANT_ID,
    `${OWNER_TEST_FIRST_NAME} ${OWNER_TEST_LAST_NAME}`,
    OWNER_TEST_FIRST_NAME,
  ]);
  const { rowCount } = await sql(
    `UPDATE number SET provider_agent_phone_number_id = $2 WHERE tenant_id = $1`,
    [BOOTSTRAP_TENANT_ID, REGISTRIERUNG],
  );
  assert.equal(rowCount, 1, "der Bootstrap-Mandant hat genau eine Nummer zum Seeden");
}

export async function mitHermesAufPostgres(t, { env = {}, mandantGepinnt }, lauf) {
  const db = await echteDatenbankMitRolle(t);
  const verwaltung = new pg.Client({ connectionString: adminAdresse(db.adresse) });
  await verwaltung.connect();
  const anbieter = await starteAnrufstartAttrappe();
  const starte = () => starteAnAnbieter(db, anbieter, mitPinnung(env, mandantGepinnt));
  const sql = (text, parameter) => verwaltung.query(text, parameter);
  let srv = await starte();
  try {
    await srv.stop();
    await seedeBootstrapMandant(sql);
    srv = await starte();
    return await lauf({ srv, anbieter, db, sql });
  } finally {
    await srv.stop();
    await anbieter.schliessen();
    await verwaltung.end();
  }
}

export async function mitZweiHermesAufPostgres(t, { env = {}, mandantGepinnt }, lauf) {
  const db = await echteDatenbankMitRolle(t);
  const verwaltung = new pg.Client({ connectionString: adminAdresse(db.adresse) });
  await verwaltung.connect();
  const anbieter = await starteAnrufstartAttrappe();
  const sql = (text, parameter) => verwaltung.query(text, parameter);
  const gestartet = [];
  const starte = async () => {
    const instanz = await starteAnAnbieter(db, anbieter, mitPinnung(env, mandantGepinnt));
    gestartet.push(instanz);
    return instanz;
  };
  try {
    await (await starte()).stop();
    await seedeBootstrapMandant(sql);
    const a = await starte();
    const b = await starte();
    return await lauf({ a, b, starte, anbieter, db, sql });
  } catch (fehler) {
    gibInstanzAusgabeAus(gestartet);
    throw fehler;
  } finally {
    await Promise.all(gestartet.map((instanz) => instanz.stop()));
    await anbieter.schliessen();
    await verwaltung.end();
  }
}

export async function zeilenBis(lies, genug, fristMs = SQL_FRIST_MS) {
  const start = Date.now();
  const ende = start + fristMs;
  let zeilen = await lies();
  while (!genug(zeilen)) {
    if (Date.now() >= ende) throw new Error(fristAblaufMeldung(zeilen, Date.now() - start));
    await echtWarten(SQL_TAKT_MS);
    zeilen = await lies();
  }
  return zeilen;
}

export function anrufeSql(sql, anzahl) {
  return zeilenBis(
    async () => (await sql(ANRUFE_SQL)).rows,
    (zeilen) => zeilen.length >= anzahl,
  );
}

export function neueAnrufe() {
  let zaehler = 0;
  const ziel = () => `${ZIEL_VORWAHL}${String(++zaehler).padStart(ZIEL_STELLEN, "0")}`;
  const rufeAn = (srv, { to = ziel(), objective = `Auftrag ${to} (${++zaehler})` } = {}) =>
    abrufMitFrist(`${srv.localUrl}/api/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, objective }),
    });
  return { ziel, rufeAn };
}

async function starteLauf(db, env) {
  const anbieter = await starteAnrufstartAttrappe();
  const srv = await starteAnAnbieter(db, anbieter, env);
  return { srv, anbieter };
}

async function beendeLauf({ srv, anbieter }) {
  if (srv.child.exitCode === null && srv.child.signalCode === null) await srv.stop();
  await anbieter.schliessen();
}

async function beendeHart({ srv, anbieter }) {
  const beendet = new Promise((resolve) => srv.child.once("exit", resolve));
  srv.child.kill("SIGKILL");
  await beendet;
  await anbieter.schliessen();
}

export async function mitHermesAufPostgresHartNeustartbar(t, { env = {} }, lauf) {
  const db = await echteDatenbankMitRolle(t);
  const verwaltung = new pg.Client({ connectionString: adminAdresse(db.adresse) });
  await verwaltung.connect();
  const sql = (text, parameter) => verwaltung.query(text, parameter);
  let aktuell = await starteLauf(db, env);
  try {
    await beendeLauf(aktuell);
    await seedeBootstrapMandant(sql);
    aktuell = await starteLauf(db, env);
    const neustartHart = async () => {
      await beendeHart(aktuell);
      aktuell = await starteLauf(db, env);
      return aktuell;
    };
    return await lauf({ ...aktuell, db, sql, neustartHart });
  } finally {
    await beendeLauf(aktuell);
    await verwaltung.end();
  }
}

const CENT_JE_EURO = 100;
const ANRUF_AN_SQL =
  "SELECT id, status, failure_reason, elevenlabs_conversation_id AS konversation FROM call WHERE to_e164 = $1";
const VERBRAUCH_SQL = `INSERT INTO usage (tenant_id, cost_eur) VALUES ($1, $2)
  ON CONFLICT (tenant_id) DO UPDATE SET cost_eur = EXCLUDED.cost_eur`;
const LAUFENDER_ANRUF_SQL = `INSERT INTO call (id, tenant_id, stream_token, direction, status, from_e164,
  to_e164, goal, started_at, answered_at, max_duration_s)
  VALUES ($1, $2, $3, 'outbound', 'active', (SELECT e164 FROM number WHERE tenant_id = $2), $4, $5, $6, $6, $7)`;

export function rufeAnMit(srv, auftrag) {
  return abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ objective: `Auftrag ${auftrag.to}`, ...auftrag }),
  });
}

export async function anrufAnBis(sql, { ziel, genug, fristMs = SQL_FRIST_MS }) {
  const start = Date.now();
  const ende = start + fristMs;
  let [anruf] = (await sql(ANRUF_AN_SQL, [ziel])).rows;
  while (!anruf || !genug(anruf)) {
    assert.ok(
      Date.now() < ende,
      `Anruf an ${ziel} per SQL nach ${Date.now() - start} ms nicht erreicht: ${JSON.stringify(anruf)}`,
    );
    await echtWarten(SQL_TAKT_MS);
    [anruf] = (await sql(ANRUF_AN_SQL, [ziel])).rows;
  }
  return anruf;
}

export async function seedeVerbrauch(sql, cent) {
  await sql(VERBRAUCH_SQL, [BOOTSTRAP_TENANT_ID, cent / CENT_JE_EURO]);
}

export async function seedeLaufendenAnruf(sql, { ziel, laeuftSeitMs, maxDurationS }) {
  const beginn = new Date(Date.now() - laeuftSeitMs).toISOString();
  const parameter = ["call_pg_laufend", BOOTSTRAP_TENANT_ID, "tok_pg_laufend", ziel];
  await sql(LAUFENDER_ANRUF_SQL, [...parameter, `Laufender Anruf ${ziel}`, beginn, maxDurationS]);
}

export async function mitHermesAufPostgresGeseedet(t, { env = {}, seed }, lauf) {
  const db = await echteDatenbankMitRolle(t);
  const verwaltung = new pg.Client({ connectionString: adminAdresse(db.adresse) });
  await verwaltung.connect();
  const sql = (text, parameter) => verwaltung.query(text, parameter);
  let aktuell = await starteLauf(db, env);
  const starteNach = async (vorbereitung) => {
    await vorbereitung(sql);
    aktuell = await starteLauf(db, env);
    return aktuell;
  };
  try {
    await beendeLauf(aktuell);
    await seedeBootstrapMandant(sql);
    await starteNach(seed);
    const neustartHartNach = async (zwischendurch) => {
      await beendeHart(aktuell);
      return starteNach(zwischendurch);
    };
    return await lauf({ ...aktuell, sql, neustartHartNach });
  } finally {
    await beendeLauf(aktuell);
    await verwaltung.end();
  }
}

const GESPRAECH_DAUER_S = 30;
const MANDANT_PROFIL = JSON.stringify({ allowConsult: true, maxCallsPerHour: null });
const ZEILEN_SQL = "SELECT role, text FROM transcript_segment WHERE call_id = $1 ORDER BY id";

export async function starteAttrappeMitGespraechsende() {
  const anbieter = await starteAnrufstartAttrappe();
  const beendete = new Map();
  const vorgeschaltet = await starteAttrappe((req, res) => {
    let roh = "";
    req.on("data", (stueck) => (roh += stueck));
    req.on("end", async () => {
      const konversation = req.url.split("/").pop();
      const zeilen = req.method === "GET" ? beendete.get(konversation) : null;
      const antwort = zeilen
        ? Response.json({
            conversation_id: konversation,
            status: "done",
            transcript: zeilen,
            analysis: null,
            metadata: { call_duration_secs: GESPRAECH_DAUER_S, error: null },
          })
        : await abrufMitFrist(anbieter.url + req.url, {
            method: req.method,
            body: req.method === "POST" ? roh : undefined,
          });
      res.writeHead(antwort.status, { "content-type": "application/json" });
      res.end(await antwort.text());
    });
  });
  return {
    ...anbieter,
    url: vorgeschaltet.url,
    beendeGespraech: (konversation, zeilen) => {
      beendete.set(konversation, zeilen);
      return anbieter.legtAuf(konversation);
    },
    schliessen: async () => {
      await vorgeschaltet.close();
      await anbieter.schliessen();
    },
  };
}

export async function seedeMandant(sql, { id, sub, e164, privateNumber = null }) {
  await sql(
    `INSERT INTO tenant (id, status, owner_name, first_name, kyc_level, private_number)
     VALUES ($1, 'active', 'Mandant Test', 'Mandant', 'card', $2)`,
    [id, privateNumber],
  );
  await sql(
    `INSERT INTO number (id, tenant_id, e164, provider, status, provider_agent_phone_number_id)
     VALUES ($1 || '_nr', $1, $2, 'telnyx', 'active', $3)`,
    [id, e164, REGISTRIERUNG],
  );
  await sql(`INSERT INTO account (sub, email, tenant_id) VALUES ($2, $2 || '@test.invalid', $1)`, [
    id,
    sub,
  ]);
  await sql(`INSERT INTO profile (tenant_id, data) VALUES ($1, $2)`, [id, MANDANT_PROFIL]);
}

export function mandantenAbruf(srv, sub) {
  const abruf = (pfad, optionen = {}) =>
    abrufMitFrist(`${srv.localUrl}${pfad}`, {
      ...optionen,
      headers: { "Content-Type": "application/json", "X-Internal-Identity": sub },
    });
  return {
    rufeAn: (to) =>
      abruf("/api/calls", {
        method: "POST",
        body: JSON.stringify({ to, objective: `Auftrag ${to}` }),
      }),
    hole: (pfad) => abruf(pfad),
    sende: (pfad) => abruf(pfad, { method: "POST", body: "{}" }),
  };
}

export function transkriptSql(sql, anruf, anzahl) {
  return zeilenBis(
    async () => (await sql(ZEILEN_SQL, [anruf.id])).rows,
    (zeilen) => zeilen.length >= anzahl,
  );
}

async function starteLaufMitGespraechsende(db, env) {
  const anbieter = await starteAttrappeMitGespraechsende();
  const srv = await starteAnAnbieter(db, anbieter, env);
  return { srv, anbieter };
}

export async function mitHermesAufPostgresMitMandanten(t, { env: zusatz = {}, mandanten }, lauf) {
  const env = {
    ELEVENLABS_INBOUND_TENANT_IDS: [BOOTSTRAP_TENANT_ID, ...mandanten.map((mandant) => mandant.id)].join(","),
    ...zusatz,
  };
  const db = await echteDatenbankMitRolle(t);
  const verwaltung = new pg.Client({ connectionString: adminAdresse(db.adresse) });
  await verwaltung.connect();
  const sql = (text, parameter) => verwaltung.query(text, parameter);
  let aktuell = await starteLaufMitGespraechsende(db, env);
  try {
    await beendeLauf(aktuell);
    for (const mandant of mandanten) await seedeMandant(sql, mandant);
    aktuell = await starteLaufMitGespraechsende(db, env);
    const neustartHart = async () => {
      await beendeHart(aktuell);
      aktuell = await starteLaufMitGespraechsende(db, env);
      return aktuell;
    };
    return await lauf({ ...aktuell, sql, neustartHart });
  } finally {
    await beendeLauf(aktuell);
    await verwaltung.end();
  }
}

const FREMDE_VERBINDUNGEN_SQL = `SELECT pid FROM pg_stat_activity
  WHERE datname = current_database() AND pid <> pg_backend_pid()`;
const TRENNEN_SQL = `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
  WHERE datname = current_database() AND pid <> pg_backend_pid()`;

function setzeZugang(db, erlaubt) {
  const datenbank = new URL(db.adresse).pathname.slice(1);
  return mitVerbindung(process.env[POSTGRES_VARIABLE], (verwaltung) =>
    verwaltung.query(`ALTER DATABASE ${datenbank} ALLOW_CONNECTIONS ${erlaubt}`),
  );
}

async function rolleKommtNichtRein(db) {
  const versuch = new pg.Client({ connectionString: db.adresse });
  await assert.rejects(
    versuch.connect(),
    /not currently accepting connections/,
    "nach der Sperre kommt die Rolle nicht mehr in die Datenbank",
  );
}

export async function sperreDatenbank(sql, db) {
  await setzeZugang(db, false);
  await sql(TRENNEN_SQL);
  await zeilenBis(
    async () => (await sql(FREMDE_VERBINDUNGEN_SQL)).rows,
    (zeilen) => zeilen.length === 0,
  );
  await rolleKommtNichtRein(db);
}

export function gibDatenbankFrei(db) {
  return setzeZugang(db, true);
}

export const ANRUF_SPERREN_SQL = `SELECT count(*)::int AS anzahl FROM pg_locks
  WHERE locktype = 'advisory' AND classid = ${ANRUF_SPERRE_NAMENSRAUM}
  AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`;

function gibInstanzAusgabeAus(instanzen) {
  instanzen.forEach((instanz, index) => {
    console.log(`--- Ausgabe Instanz ${index + 1} ---`);
    console.log(instanz.stdout);
  });
}
