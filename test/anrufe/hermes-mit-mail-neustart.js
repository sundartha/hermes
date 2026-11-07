import assert from "node:assert/strict";
import pg from "pg";

import { echtWarten } from "../echt-warten.js";
import { startServer } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { pgStartUmgebung } from "../gemeinsam/pg-start-umgebung.js";
import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";
import { seedeMandant, zeilenBis } from "./hermes-mit-postgres.js";
import { starteMailAttrappe } from "./mail-attrappe.js";

const HTTP_OK = 200;
const SESSION_SECRET = "mail-neustart-session-secret-mindestens-32-zeichen";
const NACHLAUF_MS = 1_500;
const ABGELEHNTER_ANBIETER_CODE = "403";
const ANRUF_SPRACHE = "de";
const ANRUF_ZIEL = "+4915112340101";
const ANRUF_ZEIT_MS = 60_000;

const ANRUF_SQL = `INSERT INTO call (id, tenant_id, stream_token, direction, status, from_e164,
  to_e164, goal, language, started_at, max_duration_s, provider)
  VALUES ($1, $2, $3, 'outbound', 'active', (SELECT e164 FROM number WHERE tenant_id = $2),
  $4, 'Termin vereinbaren', $5, $6, 300, 'telnyx')`;

const BEENDETER_ANRUF_SQL = `INSERT INTO call (id, tenant_id, stream_token, direction, status,
  from_e164, to_e164, goal, language, started_at, ended_at, failure_reason, max_duration_s, provider)
  VALUES ($1, $2, $3, 'outbound', 'failed', (SELECT e164 FROM number WHERE tenant_id = $2),
  $4, 'Termin vereinbaren', $5, $6, $6, 'not-placed:invite-403', 300, 'telnyx')`;

function adminAdresse(rollenAdresse) {
  const url = new URL(process.env[POSTGRES_VARIABLE]);
  url.pathname = new URL(rollenAdresse).pathname;
  return url.href;
}

export const kontoAdresse = (mandant) => `${mandant.sub}@test.invalid`;

export async function mitHermesMitMailUndNeustart(t, { env = {}, mandanten }, lauf) {
  const db = await echteDatenbankMitRolle(t);
  const verwaltung = new pg.Client({ connectionString: adminAdresse(db.adresse) });
  await verwaltung.connect();
  const sql = (text, parameter) => verwaltung.query(text, parameter);
  const mail = await starteMailAttrappe();
  const starte = () =>
    startServer({
      env: pgStartUmgebung(db.adresse, { SESSION_SECRET, ...mail.umgebung, ...env }),
    });
  let srv = await starte();
  try {
    await srv.stop();
    for (const mandant of mandanten) await seedeMandant(sql, mandant);
    srv = await starte();
    const neustart = async (vorbereitung) => {
      await srv.stop();
      if (vorbereitung) await vorbereitung(sql);
      srv = await starte();
    };
    return await lauf({
      get srv() {
        return srv;
      },
      sql,
      mail,
      neustart,
    });
  } finally {
    await srv.stop();
    await mail.schliessen();
    await verwaltung.end();
  }
}

export function seedeAusgehendenAnruf(sql, { id, mandant, vorMs = ANRUF_ZEIT_MS }) {
  const beginn = new Date(Date.now() - vorMs).toISOString();
  return sql(ANRUF_SQL, [id, mandant.id, `tok_${id}`, ANRUF_ZIEL, ANRUF_SPRACHE, beginn]);
}

export function seedeNichtZustandeGekommenenAnruf(sql, { id, mandant, endedAt }) {
  return sql(BEENDETER_ANRUF_SQL, [
    id,
    mandant.id,
    `tok_${id}`,
    ANRUF_ZIEL,
    ANRUF_SPRACHE,
    endedAt,
  ]);
}

export async function meldeNichtZustandeGekommen(srv, callId) {
  const antwort = await abrufMitFrist(`${srv.localUrl}/voice/status?callId=${callId}`, {
    method: "POST",
    body: new URLSearchParams({
      CallStatus: "failed",
      SipHangupCause: ABGELEHNTER_ANBIETER_CODE,
    }),
  });
  assert.equal(antwort.status, HTTP_OK);
}

export function mailsBis(mail, adresse, anzahl) {
  return zeilenBis(
    async () => mail.an(adresse),
    (mails) => mails.length >= anzahl,
  );
}

export function benachrichtigungenBis(sql, callId, anzahl) {
  return zeilenBis(
    async () => (await sql("SELECT id FROM notification WHERE call_id = $1", [callId])).rows,
    (zeilen) => zeilen.length >= anzahl,
  );
}

export async function wartePruefendAufEnde(sql, callId, benachrichtigungen) {
  await benachrichtigungenBis(sql, callId, benachrichtigungen);
  await echtWarten(NACHLAUF_MS);
}
