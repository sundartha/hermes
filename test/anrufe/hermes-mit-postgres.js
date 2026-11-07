import assert from "node:assert/strict";
import pg from "pg";

import { echtWarten } from "../echt-warten.js";
import { OWNER_TEST_FIRST_NAME, OWNER_TEST_LAST_NAME, startServer } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { pgStartUmgebung } from "../gemeinsam/pg-start-umgebung.js";
import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { starteAnrufstartAttrappe } from "./elevenlabs-anrufstart-attrappe.js";

const SQL_FRIST_MS = 5_000;
const SQL_TAKT_MS = 50;
const ZIEL_VORWAHL = "+49151123401";
const ZIEL_STELLEN = 3;
const ANRUFE_SQL = "SELECT id, status, failure_reason, to_e164 FROM call ORDER BY seq";
const REGISTRIERUNG = "phnum_pg_seed";

const EL_WEG = Object.freeze({
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_AGENT_ID: "agent_pg",
  ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_pg",
  ELEVENLABS_API_KEY: "el-pg-schluessel",
  ELEVENLABS_RESULT_POLL_MS: "60000",
});

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

export async function mitHermesAufPostgres(t, { env = {} }, lauf) {
  const db = await echteDatenbankMitRolle(t);
  const verwaltung = new pg.Client({ connectionString: adminAdresse(db.adresse) });
  await verwaltung.connect();
  const anbieter = await starteAnrufstartAttrappe();
  const starte = () =>
    startServer({
      env: pgStartUmgebung(db.adresse, { ...EL_WEG, ELEVENLABS_API_BASE: anbieter.url, ...env }),
    });
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

export async function zeilenBis(lies, genug) {
  const ende = Date.now() + SQL_FRIST_MS;
  let zeilen = await lies();
  while (!genug(zeilen)) {
    assert.ok(Date.now() < ende, `Zustand per SQL nicht erreicht: ${JSON.stringify(zeilen)}`);
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
