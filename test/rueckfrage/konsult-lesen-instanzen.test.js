import assert from "node:assert/strict";
import pg from "pg";
import test from "node:test";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { pgStartUmgebung } from "../gemeinsam/pg-start-umgebung.js";
import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";
import { postgresVorhanden, seedeMandant, zeilenBis } from "../anrufe/hermes-mit-postgres.js";
import { startServer } from "../helpers.js";

const ZEITGRENZE_MS = 240_000;
const ABRUF_FRIST_MS = 40_000;
const MANDANT = { id: "tenant_kl_0", sub: "sub-kl-0", e164: "+4930555000500" };
const FREMDER = { id: "tenant_kl_1", sub: "sub-kl-1", e164: "+4930555000501" };
const WERKZEUG_TOKEN = "el-tool-token-kl-testgeheim";
const UMGEBUNG = Object.freeze({
  CONSULT_ENABLED: "true",
  ASSISTANT_CONTEXT_ENABLED: "true",
  IN_CALL_CONSULT_ENABLED: "true",
  ELEVENLABS_TOOL_TOKEN: WERKZEUG_TOKEN,
});
const FRAGE = "Darf ich zusagen?";
const ANRUF_SQL = `INSERT INTO call (id, tenant_id, stream_token, direction, status, from_e164, to_e164, goal, started_at,
    elevenlabs_conversation_id, max_duration_s, answered_at)
  VALUES ($1, $2, $1 || '_token', 'outbound', 'active', (SELECT e164 FROM number WHERE tenant_id = $2), '+4915112340000', 'Test', now()::text,
    'conv_' || $1, 300, now()::text)`;
const OFFENE_TRANSAKTIONEN_SQL = `SELECT count(*)::int AS anzahl FROM pg_stat_activity
  WHERE datname = current_database() AND pid <> pg_backend_pid() AND state LIKE 'idle in transaction%'`;
const FRAGEN_SQL = "SELECT consults FROM call WHERE id = $1";
const BEENDEN_SQL = "UPDATE call SET status = 'completed' WHERE id = $1";
const ENDE_EREIGNIS = Object.freeze({ event: "done", eventId: null, questions: [] });
const KEIN_EREIGNIS = Object.freeze({ event: "none", eventId: null, questions: [] });

function adminAdresse(rollenAdresse) {
  const url = new URL(process.env[POSTGRES_VARIABLE]);
  url.pathname = new URL(rollenAdresse).pathname;
  return url.href;
}

async function mitInstanzen(t, { anrufId, mitA }, lauf) {
  const db = await echteDatenbankMitRolle(t);
  const verwaltung = new pg.Client({ connectionString: adminAdresse(db.adresse) });
  await verwaltung.connect();
  const gestartet = [];
  const starte = async () => {
    const instanz = await startServer({ env: pgStartUmgebung(db.adresse, UMGEBUNG) });
    gestartet.push(instanz);
    return instanz;
  };
  const sql = (text, parameter) => verwaltung.query(text, parameter);
  const holeVon = (sub) => async (instanz, kennung = anrufId) =>
    abrufMitFrist(`${instanz.localUrl}/api/calls/${kennung}/consult`, {
      headers: { "X-Internal-Identity": sub },
    }, { wartezeitMs: ABRUF_FRIST_MS });
  const hole = async (instanz) => (await holeVon(MANDANT.sub)(instanz)).json();
  const holeRoh = holeVon(MANDANT.sub);
  const holeAlsFremder = holeVon(FREMDER.sub);
  const holeOhneMandant = async (instanz) =>
    abrufMitFrist(`${instanz.localUrl}/api/calls/${anrufId}/consult`, {}, { wartezeitMs: ABRUF_FRIST_MS });
  const offene = [];
  const frageAuf = (instanz) => {
    const abbruch = new AbortController();
    offene.push(abbruch);
    return abrufMitFrist(`${instanz.localUrl}/webhooks/elevenlabs/consult`, {
      method: "POST",
      signal: abbruch.signal,
      headers: { "Content-Type": "application/json", "x-hermes-tool-token": WERKZEUG_TOKEN },
      body: JSON.stringify({ conversation_id: `conv_${anrufId}`, question: FRAGE }),
    }).catch(() => null);
  };
  try {
    await (await starte()).stop();
    await seedeMandant(sql, MANDANT);
    await seedeMandant(sql, FREMDER);
    const b = await starte();
    await sql(ANRUF_SQL, [anrufId, MANDANT.id]);
    const a = mitA ? await starte() : null;
    return await lauf({ a, b, sql, hole, holeRoh, holeAlsFremder, holeOhneMandant, frageAuf });
  } finally {
    for (const abbruch of offene) abbruch.abort();
    await Promise.all(gestartet.map((instanz) => instanz.stop()));
    await verwaltung.end();
  }
}

const mitZweiInstanzen = (t, anrufId, lauf) => mitInstanzen(t, { anrufId, mitA: true }, lauf);
const mitInstanzB = (t, anrufId, lauf) => mitInstanzen(t, { anrufId, mitA: false }, lauf);

const unterSperre = async (sql, arbeit) => {
  await sql("BEGIN");
  await sql("LOCK TABLE call IN ACCESS EXCLUSIVE MODE");
  try {
    return await arbeit();
  } finally {
    await sql("COMMIT");
  }
};

const keineOffenenTransaktionen = (sql) =>
  zeilenBis(
    async () => (await sql(OFFENE_TRANSAKTIONEN_SQL)).rows[0].anzahl,
    (anzahl) => anzahl === 0,
  );

const fragenBis = (sql, anrufId) =>
  zeilenBis(
    async () => (await sql(FRAGEN_SQL, [anrufId])).rows[0].consults,
    (fragen) => Array.isArray(fragen) && fragen.length === 1,
  );

test(
  "Eine Rueckfrage von Instanz A liefert der Abruf auf Instanz B mit gleicher eventId und gleichen Fragen, nach der Antwort auf A kein zweites Mal",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitZweiInstanzen(t, "call_kl_1", async ({ a, b, sql, hole, frageAuf }) => {
      const frage = frageAuf(a);
      const [gestellt] = await fragenBis(sql, "call_kl_1");
      const ereignis = await hole(b);
      assert.equal(ereignis.event, "consult");
      assert.equal(ereignis.eventId, gestellt.id);
      assert.deepEqual(ereignis.questions, gestellt.questions);
      assert.ok(ereignis.questions.length > 0);
      const antwort = await abrufMitFrist(`${a.localUrl}/api/calls/call_kl_1/consult/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Internal-Identity": MANDANT.sub },
        body: JSON.stringify({ event_id: gestellt.id, status: "final", answers: ["Ja"] }),
      });
      assert.equal(antwort.status, 200);
      await frage;
      await zeilenBis(
        async () => (await sql(FRAGEN_SQL, ["call_kl_1"])).rows[0].consults,
        (fragen) => fragen[0].status !== "open",
      );
      assert.deepEqual(await hole(b), KEIN_EREIGNIS);
    });
  },
);

test(
  "Endet der Anruf auf Instanz A, liefert der Abruf auf Instanz B das Ende",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitInstanzB(t, "call_kl_2", async ({ b, sql, hole }) => {
      await sql(BEENDEN_SQL, ["call_kl_2"]);
      assert.deepEqual(await hole(b), ENDE_EREIGNIS);
    });
  },
);

test(
  "Antwortet die Datenbank beim Lesen nicht, liefert der Abruf none statt des Endes und der Grund steht im Protokoll",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitInstanzB(t, "call_kl_3", async ({ b, sql, hole }) => {
      await sql(BEENDEN_SQL, ["call_kl_3"]);
      assert.deepEqual(await hole(b), ENDE_EREIGNIS);
      const ereignis = await unterSperre(sql, async () => {
        const antwort = await hole(b);
        await keineOffenenTransaktionen(sql);
        return antwort;
      });
      assert.deepEqual(ereignis, KEIN_EREIGNIS);
      assert.ok(b.stdout.includes("[consult] Rueckfrage nicht gelesen, kein Ereignis:"), b.stdout);
      assert.match(b.stdout, /lock timeout|statement timeout/);
    });
  },
);

test(
  "Faellt die Lesung auf der Instanz aus, die den Anruf kennt, liefert der Abruf none und der Grund steht im Protokoll",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitZweiInstanzen(t, "call_kl_5", async ({ a, sql, hole }) => {
      await sql(BEENDEN_SQL, ["call_kl_5"]);
      const ereignis = await unterSperre(sql, () => hole(a));
      assert.deepEqual(ereignis, KEIN_EREIGNIS);
      assert.ok(a.stdout.includes("[consult] Rueckfrage nicht gelesen, kein Ereignis:"), a.stdout);
      assert.match(a.stdout, /lock timeout|statement timeout/);
    });
  },
);

test(
  "Ein Anruf eines anderen Mandanten und eine unbekannte Anruf-ID liefern auf Instanz B 404",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitInstanzB(t, "call_kl_4", async ({ b, sql, holeRoh, holeAlsFremder, holeOhneMandant }) => {
      assert.equal((await holeAlsFremder(b)).status, 404);
      assert.equal((await holeOhneMandant(b)).status, 404);
      assert.equal((await holeRoh(b, "call_kl_unbekannt")).status, 404);
      await keineOffenenTransaktionen(sql);
      assert.equal((await holeRoh(b)).status, 200);
    });
  },
);
