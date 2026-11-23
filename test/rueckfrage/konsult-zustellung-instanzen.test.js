import assert from "node:assert/strict";
import pg from "pg";
import test from "node:test";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { pgStartUmgebung } from "../gemeinsam/pg-start-umgebung.js";
import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";
import { postgresVorhanden, seedeMandant, zeilenBis } from "../anrufe/hermes-mit-postgres.js";
import { startServer, waitUntil } from "../helpers.js";

const ZEITGRENZE_MS = 240_000;
const ABRUF_FRIST_MS = 40_000;
const ZUSTELLFRIST_MS = 2_000;
const NACH_ZUSTELLFRIST_MS = 3_000;
const MANDANT = { id: "tenant_kz_0", sub: "sub-kz-0", e164: "+4930555000700" };
const FREMDER = { id: "tenant_kz_1", sub: "sub-kz-1", e164: "+4930555000701" };
const WERKZEUG_TOKEN = "el-tool-token-kz-testgeheim";
const UMGEBUNG = Object.freeze({
  CONSULT_ENABLED: "true",
  ASSISTANT_CONTEXT_ENABLED: "true",
  IN_CALL_CONSULT_ENABLED: "true",
  ELEVENLABS_TOOL_TOKEN: WERKZEUG_TOKEN,
});
const FRIST_UMGEBUNG = Object.freeze({
  EL_CONSULT_DELIVERY_MS: String(ZUSTELLFRIST_MS),
  EL_CONSULT_ACK_MS: "20000",
  EL_CONSULT_ANSWER_MS: "30000",
});
const abfrageMeldung = (anrufId) => `[el-outbound] Ergebnisabruf fehlgeschlagen (call=${anrufId})`;
const SCHNELLER_TAKT = Object.freeze({ FRISTEN_TAKT_MS: "40", ...FRIST_UMGEBUNG });
const FRAGE = "Darf ich zusagen?";
const ANRUF_SQL = `INSERT INTO call (id, tenant_id, stream_token, direction, status, from_e164, to_e164, goal, started_at,
    elevenlabs_conversation_id, max_duration_s, answered_at, frist_abfrage_at)
  VALUES ($1, $2, $1 || '_token', 'outbound', 'active', (SELECT e164 FROM number WHERE tenant_id = $2), '+4915112340000', 'Test', now()::text,
    'conv_' || $1, 300, now()::text, now() - interval '1 minute')`;
const FREMDER_ANRUF_SQL = `INSERT INTO call (id, tenant_id, stream_token, direction, status, from_e164, to_e164, goal, started_at,
    max_duration_s, consults)
  VALUES ($1, $2, $1 || '_token', 'outbound', 'active', (SELECT e164 FROM number WHERE tenant_id = $2), '+4915112340000', 'Test', now()::text,
    300, $3::jsonb)`;
const ABGELAUFEN_SQL = `SELECT consults->0 AS frage,
  now() - (consults->0->>'askedAt')::timestamptz > $2 * interval '1 millisecond' AS abgelaufen FROM call WHERE id = $1`;
const FRAGEN_SQL = "SELECT consults FROM call WHERE id = $1";
const MELDUNGSSPRACHE_SQL = `DO $$ BEGIN
  EXECUTE format('ALTER DATABASE %I SET lc_messages = ''C''', current_database());
END $$`;

function adminAdresse(rollenAdresse) {
  const url = new URL(process.env[POSTGRES_VARIABLE]);
  url.pathname = new URL(rollenAdresse).pathname;
  return url.href;
}

async function mitInstanzen(t, anrufId, lauf) {
  const db = await echteDatenbankMitRolle(t);
  const verwaltung = new pg.Client({ connectionString: adminAdresse(db.adresse) });
  await verwaltung.connect();
  await verwaltung.query(MELDUNGSSPRACHE_SQL);
  const gestartet = [];
  const starte = async (takt = {}) => {
    const instanz = await startServer({ env: pgStartUmgebung(db.adresse, { ...UMGEBUNG, ...takt }) });
    gestartet.push(instanz);
    return instanz;
  };
  const sql = (text, parameter) => verwaltung.query(text, parameter);
  const hole = async (instanz) =>
    (
      await abrufMitFrist(`${instanz.localUrl}/api/calls/${anrufId}/consult`, {
        headers: { "X-Internal-Identity": MANDANT.sub },
      }, { wartezeitMs: ABRUF_FRIST_MS })
    ).json();
  const offene = [];
  const frageAuf = (instanz) => {
    const abbruch = new AbortController();
    offene.push(abbruch);
    return abrufMitFrist(`${instanz.localUrl}/webhooks/elevenlabs/consult`, {
      method: "POST",
      signal: abbruch.signal,
      headers: { "Content-Type": "application/json", "x-hermes-tool-token": WERKZEUG_TOKEN },
      body: JSON.stringify({ conversation_id: `conv_${anrufId}`, question: FRAGE }),
    }, { wartezeitMs: ABRUF_FRIST_MS }).then((antwort) => antwort.json(), () => null);
  };
  const antworteAuf = (instanz, eventId) =>
    abrufMitFrist(`${instanz.localUrl}/api/calls/${anrufId}/consult/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Identity": MANDANT.sub },
      body: JSON.stringify({ event_id: eventId, status: "final", answers: ["Ja"] }),
    });
  try {
    await (await starte()).stop();
    await seedeMandant(sql, MANDANT);
    await seedeMandant(sql, FREMDER);
    const b = await starte();
    await sql(ANRUF_SQL, [anrufId, MANDANT.id]);
    const a = await starte(SCHNELLER_TAKT);
    await waitUntil(() => a.stdout.includes(abfrageMeldung(anrufId)), {
      timeoutMs: ABRUF_FRIST_MS,
    });
    const gestellt = async () => {
      const [frage] = await zeilenBis(
        async () => (await sql(FRAGEN_SQL, [anrufId])).rows[0].consults,
        (fragen) => Array.isArray(fragen) && fragen.length === 1,
      );
      return frage;
    };
    const nachZustellfrist = async () => {
      const zeile = await zeilenBis(
        async () => (await sql(ABGELAUFEN_SQL, [anrufId, ZUSTELLFRIST_MS + NACH_ZUSTELLFRIST_MS])).rows[0],
        (gelesen) => gelesen.abgelaufen,
      );
      return zeile.frage;
    };
    return await lauf({ a, b, sql, hole, frageAuf, antworteAuf, gestellt, nachZustellfrist });
  } finally {
    for (const abbruch of offene) abbruch.abort();
    await Promise.all(gestartet.map((instanz) => instanz.stop()));
    await verwaltung.end();
  }
}

test(
  "Holt der Agent die Rueckfrage von Instanz A ueber Instanz B ab, steht die Zustellzeit in der Datenbank und A bricht nicht mit not_delivered ab",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitInstanzen(t, "call_kz_1", async ({ a, b, sql, hole, frageAuf, antworteAuf, gestellt, nachZustellfrist }) => {
      const frage = frageAuf(a);
      const gestelltFrage = await gestellt();
      assert.equal((await hole(b)).event, "consult");
      const [danach] = (await sql(FRAGEN_SQL, ["call_kz_1"])).rows[0].consults;
      assert.match(danach.askDeliveredAt, /^\d{4}-\d{2}-\d{2}T/);
      assert.equal((await hole(b)).event, "consult");
      const [zweiter] = (await sql(FRAGEN_SQL, ["call_kz_1"])).rows[0].consults;
      assert.equal(zweiter.askDeliveredAt, danach.askDeliveredAt);
      const offen = await nachZustellfrist();
      assert.equal(offen.status, "open");
      assert.equal(offen.timeoutReason, undefined);
      assert.equal((await antworteAuf(a, gestelltFrage.id)).status, 200);
      assert.match(JSON.stringify(await frage), /Ja/);
    });
  },
);

test(
  "Holt niemand die Rueckfrage ab, bricht A sie nach der Zustellfrist mit not_delivered ab und die Zustellzeit bleibt leer",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitInstanzen(t, "call_kz_2", async ({ a, sql, frageAuf, gestellt }) => {
      const frage = frageAuf(a);
      const gestelltFrage = await gestellt();
      const [abgebrochen] = await zeilenBis(
        async () => (await sql(FRAGEN_SQL, ["call_kz_2"])).rows[0].consults,
        (fragen) => fragen[0].status !== "open",
      );
      assert.equal(abgebrochen.id, gestelltFrage.id);
      assert.equal(abgebrochen.status, "timed_out");
      assert.equal(abgebrochen.timeoutReason, "not_delivered");
      assert.equal(abgebrochen.askDeliveredAt, undefined);
      await frage;
    });
  },
);

test(
  "Die Zustellung ueber Instanz B aendert keine Zeile eines anderen Mandanten mit derselben eventId",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitInstanzen(t, "call_kz_3", async ({ a, b, sql, hole, frageAuf, antworteAuf, gestellt }) => {
      const frage = frageAuf(a);
      const gestelltFrage = await gestellt();
      await sql(FREMDER_ANRUF_SQL, ["call_kz_fremd", FREMDER.id, JSON.stringify([gestelltFrage])]);
      assert.equal((await hole(b)).event, "consult");
      const [eigene] = (await sql(FRAGEN_SQL, ["call_kz_3"])).rows[0].consults;
      assert.ok(eigene.askDeliveredAt);
      const [fremde] = (await sql(FRAGEN_SQL, ["call_kz_fremd"])).rows[0].consults;
      assert.equal(fremde.id, gestelltFrage.id);
      assert.equal(fremde.askDeliveredAt, undefined);
      assert.equal((await antworteAuf(a, gestelltFrage.id)).status, 200);
      await frage;
    });
  },
);

const ZUSTELLZEIT_FEHLER = "[consult-raised] Zustellzeit lesen fehlgeschlagen:";
const NICHT_ZUGESTELLT = /consult_timeout[^\n]*not_delivered/;
const UNLESBAR_SQL = `UPDATE call SET consults = '"kaputt"'::jsonb WHERE id = $1`;

test(
  "Laesst sich die Zustellzeit in der Datenbank nicht lesen, gilt die Rueckfrage nach der Zustellfrist als nicht zugestellt",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitInstanzen(t, "call_kz_4", async ({ a, sql, frageAuf, gestellt }) => {
      const frage = frageAuf(a);
      await gestellt();
      await sql(UNLESBAR_SQL, ["call_kz_4"]);
      await frage;
      assert.ok(a.stdout.includes(ZUSTELLZEIT_FEHLER), a.stdout);
      assert.match(a.stdout, NICHT_ZUGESTELLT, a.stdout);
    });
  },
);

const TORWAECHTER_SCHLUESSEL = 604401;
const TORWAECHTER_SQL = `CREATE FUNCTION zustellung_tor() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN PERFORM pg_advisory_lock(${TORWAECHTER_SCHLUESSEL}); PERFORM pg_advisory_unlock(${TORWAECHTER_SCHLUESSEL}); RETURN NULL; END $$;
  CREATE TRIGGER zustellung_tor BEFORE UPDATE OF consults ON call FOR EACH STATEMENT EXECUTE FUNCTION zustellung_tor()`;
const TOR_ZU_SQL = `SELECT pg_advisory_lock(${TORWAECHTER_SCHLUESSEL})`;
const TOR_AUF_SQL = `SELECT pg_advisory_unlock(${TORWAECHTER_SCHLUESSEL})`;
const WARTENDE_ZUSTELLUNG_SQL = `SELECT count(*)::int AS anzahl FROM pg_stat_activity
  WHERE wait_event_type = 'Lock' AND query LIKE 'UPDATE call SET consults = (%'`;
const STATUS_SETZEN_SQL = `UPDATE call SET consults = jsonb_set(consults, '{0,status}', to_jsonb($2::text)) WHERE id = $1`;

const ZUSTELLUNG_NACH_STATUSWECHSEL = [
  ["answered", "beantwortet"],
  ["expired", "abgelaufen"],
];

test(
  "Bleibt die Rueckfrage bis zur Zustellmarke offen, setzt der Abruf ueber Instanz B askDeliveredAt",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitInstanzen(t, "call_kz_offen", async ({ b, sql, hole, frageAuf, gestellt }) => {
      const frage = frageAuf(b);
      await gestellt();
      assert.equal((await hole(b)).event, "consult");
      const [danach] = (await sql(FRAGEN_SQL, ["call_kz_offen"])).rows[0].consults;
      assert.equal(danach.status, "open");
      assert.match(danach.askDeliveredAt, /^\d{4}-\d{2}-\d{2}T/);
      await frage;
    });
  },
);

for (const [status, bezeichnung] of ZUSTELLUNG_NACH_STATUSWECHSEL) {
  test(
    `Wird die Rueckfrage zwischen Lesen und Zustellmarke ${bezeichnung} (${status}), bleibt askDeliveredAt leer`,
    { timeout: ZEITGRENZE_MS },
    async (t) => {
      if (!postgresVorhanden()) return;
      const anrufId = `call_kz_${status}`;
      await mitInstanzen(t, anrufId, async ({ a, b, sql, hole, frageAuf, gestellt }) => {
        const frage = frageAuf(a);
        await gestellt();
        await sql(TORWAECHTER_SQL);
        await sql(TOR_ZU_SQL);
        const abruf = hole(b);
        await zeilenBis(
          async () => (await sql(WARTENDE_ZUSTELLUNG_SQL)).rows[0].anzahl,
          (anzahl) => anzahl > 0,
        );
        await sql(STATUS_SETZEN_SQL, [anrufId, status]);
        await sql(TOR_AUF_SQL);
        assert.equal((await abruf).event, "consult");
        const [danach] = (await sql(FRAGEN_SQL, [anrufId])).rows[0].consults;
        assert.equal(danach.status, status);
        assert.equal(danach.askDeliveredAt, undefined);
        await frage;
      });
    },
  );
}
