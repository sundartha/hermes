import assert from "node:assert/strict";
import pg from "pg";
import test from "node:test";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { pgStartUmgebung } from "../gemeinsam/pg-start-umgebung.js";
import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";
import { postgresVorhanden, seedeMandant, zeilenBis } from "../anrufe/hermes-mit-postgres.js";
import { echtWarten } from "../echt-warten.js";
import { startServer } from "../helpers.js";

const ZEITGRENZE_MS = 240_000;
const DB_FRIST_MS = 5_000;
const NACH_SPERRE_ABRUFE = 8;
const KEIN_EREIGNIS = Object.freeze({ event: "none", eventId: null, questions: [] });
const ENDE_EREIGNIS = Object.freeze({ event: "done", eventId: null, questions: [] });
const HALTEFRIST_UNTEN_S = 20;
const HALTEFRIST_OBEN_S = 25;
const MANDANTEN = [0, 1].map((index) => ({
  id: `tenant_kp_${index}`,
  sub: `sub-kp-${index}`,
  e164: `+4930555000${400 + index}`,
}));
const [M0, M1] = MANDANTEN;
const WERKZEUG_TOKEN = "el-tool-token-kp-testgeheim";
const UMGEBUNG = Object.freeze({
  CONSULT_ENABLED: "true",
  ASSISTANT_CONTEXT_ENABLED: "true",
  IN_CALL_CONSULT_ENABLED: "true",
  ELEVENLABS_TOOL_TOKEN: WERKZEUG_TOKEN,
});
const ANTWORTFRIST_OBEN_S = 33;
const ANTWORTFRIST_UNTEN_S = 30;
const ANRUF_SQL = `INSERT INTO call (id, tenant_id, stream_token, direction, status, from_e164, to_e164, goal, started_at,
    elevenlabs_conversation_id, max_duration_s, answered_at)
  VALUES ($1, $2, $1 || '_token', 'outbound', $3, (SELECT e164 FROM number WHERE tenant_id = $2), '+4915112340000', 'Test', now()::text,
    'conv_' || $1, 300, now()::text)`;
const ANZAHL_SQL = "SELECT count(*)::int AS anzahl FROM konsult_platz WHERE call_id = $1";
const GESAMT_SQL = "SELECT count(*)::int AS anzahl FROM konsult_platz";
const REST_SQL = "SELECT extract(epoch FROM min(ablauf_um) - now())::float AS rest FROM konsult_platz";
const ABLAUF_SQL = "UPDATE konsult_platz SET ablauf_um = now() - interval '1 minute'";
const IDS_SQL = "SELECT platz_id FROM konsult_platz WHERE call_id = $1";

function adminAdresse(rollenAdresse) {
  const url = new URL(process.env[POSTGRES_VARIABLE]);
  url.pathname = new URL(rollenAdresse).pathname;
  return url.href;
}

async function mitZweiInstanzen(t, anrufe, lauf) {
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
  const offene = [];
  const abruf = ({ instanz, mandant }, anrufId, optionen) =>
    abrufMitFrist(
      `${instanz.localUrl}/api/calls/${anrufId}/consult`,
      { signal: optionen.signal, headers: { "X-Internal-Identity": mandant.sub } },
      { wartezeitMs: optionen.wartezeitMs },
    );
  const halte = (instanz, mandant, anrufId) => {
    const abbruch = new AbortController();
    offene.push(abbruch);
    return abruf({ instanz, mandant }, anrufId, { signal: abbruch.signal }).catch(() => null);
  };
  const hole = async (instanz, mandant, anrufId) =>
    (await abruf({ instanz, mandant }, anrufId, { wartezeitMs: DB_FRIST_MS })).json();
  try {
    await (await starte()).stop();
    for (const mandant of MANDANTEN) await seedeMandant(sql, mandant);
    for (const [id, mandant, status] of anrufe) await sql(ANRUF_SQL, [id, mandant.id, status]);
    const a = await starte();
    const b = await starte();
    return await lauf({ a, b, sql, halte, hole });
  } finally {
    for (const abbruch of offene) abbruch.abort();
    await Promise.all(gestartet.map((instanz) => instanz.stop()));
    await verwaltung.end();
  }
}

const anzahlBis = (sql, anrufId, soll) =>
  zeilenBis(
    async () => (await sql(ANZAHL_SQL, [anrufId])).rows[0].anzahl,
    (anzahl) => anzahl === soll,
  );

test(
  "Zwei Abrufe desselben Anrufs auf zwei Instanzen sind offen, der dritte erhaelt sofort none und die Haltefrist laeuft ab der Belegung",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitZweiInstanzen(t, [["call_kp_1", M0, "active"]], async ({ a, b, sql, halte, hole }) => {
      halte(a, M0, "call_kp_1");
      halte(b, M0, "call_kp_1");
      await anzahlBis(sql, "call_kp_1", 2);
      const { rest } = (await sql(REST_SQL)).rows[0];
      assert.ok(rest > HALTEFRIST_UNTEN_S && rest <= HALTEFRIST_OBEN_S, `Haltefrist ${rest} s`);
      assert.deepEqual(await hole(a, M0, "call_kp_1"), KEIN_EREIGNIS);
      assert.deepEqual(await hole(b, M0, "call_kp_1"), KEIN_EREIGNIS);
      assert.equal((await sql(ANZAHL_SQL, ["call_kp_1"])).rows[0].anzahl, 2);
    });
  },
);

test(
  "Vier offene Abrufe eines Mandanten ueber zwei Instanzen: der fuenfte erhaelt none, ein anderer Mandant bekommt seinen Platz",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    const anrufe = [
      ["call_kp_2", M0, "active"],
      ["call_kp_3", M0, "active"],
      ["call_kp_4", M0, "active"],
      ["call_kp_5", M1, "active"],
    ];
    await mitZweiInstanzen(t, anrufe, async ({ a, b, sql, halte, hole }) => {
      for (const anrufId of ["call_kp_2", "call_kp_3"]) {
        halte(a, M0, anrufId);
        halte(b, M0, anrufId);
        await anzahlBis(sql, anrufId, 2);
      }
      assert.deepEqual(await hole(b, M0, "call_kp_4"), KEIN_EREIGNIS);
      assert.deepEqual(await hole(a, M0, "call_kp_4"), KEIN_EREIGNIS);
      assert.equal((await sql(GESAMT_SQL)).rows[0].anzahl, 4);
      halte(b, M1, "call_kp_5");
      await anzahlBis(sql, "call_kp_5", 1);
    });
  },
);

test(
  "Endet ein Abruf, ist sein Platz frei: fuenf Abrufe nacheinander auf beiden Instanzen liefern das Ende statt none",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitZweiInstanzen(t, [["call_kp_6", M0, "completed"]], async ({ a, b, sql, hole }) => {
      for (const instanz of [a, b, a, b, a]) assert.deepEqual(await hole(instanz, M0, "call_kp_6"), ENDE_EREIGNIS);
      assert.equal((await sql(GESAMT_SQL)).rows[0].anzahl, 0);
    });
  },
);

test(
  "Ein Platz ohne Freigabe verfaellt mit seiner Haltefrist: danach wird der naechste Abruf gehalten statt abgewiesen",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitZweiInstanzen(t, [["call_kp_7", M0, "active"]], async ({ a, b, sql, halte, hole }) => {
      halte(a, M0, "call_kp_7");
      halte(a, M0, "call_kp_7");
      await anzahlBis(sql, "call_kp_7", 2);
      const alt = (await sql(IDS_SQL, ["call_kp_7"])).rows.map((zeile) => zeile.platz_id);
      assert.deepEqual(await hole(b, M0, "call_kp_7"), KEIN_EREIGNIS);
      await sql(ABLAUF_SQL);
      halte(b, M0, "call_kp_7");
      await anzahlBis(sql, "call_kp_7", 1);
      const neu = (await sql(IDS_SQL, ["call_kp_7"])).rows.map((zeile) => zeile.platz_id);
      assert.equal(alt.includes(neu[0]), false);
    });
  },
);

test(
  "Antwortet die Datenbank beim Belegen nicht, erhaelt der Abruf none und es wird kein Platz belegt",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitZweiInstanzen(t, [["call_kp_8", M0, "active"]], async ({ a, sql, hole }) => {
      await sql("BEGIN");
      await sql("LOCK TABLE konsult_platz IN ACCESS EXCLUSIVE MODE");
      let antwort;
      try {
        antwort = await hole(a, M0, "call_kp_8");
      } finally {
        await sql("COMMIT");
      }
      assert.deepEqual(antwort, KEIN_EREIGNIS);
      assert.equal((await sql(GESAMT_SQL)).rows[0].anzahl, 0);
    });
  },
);

test(
  "Haelt eine andere Verbindung die Platzsperre, erhaelt der Abruf none und die Verbindung ist danach wieder brauchbar",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitZweiInstanzen(t, [["call_kp_9", M0, "completed"]], async ({ a, sql, hole }) => {
      await sql("SELECT pg_advisory_lock(2921, 1)");
      let antwort;
      try {
        antwort = await hole(a, M0, "call_kp_9");
      } finally {
        await sql("SELECT pg_advisory_unlock(2921, 1)");
      }
      assert.deepEqual(antwort, KEIN_EREIGNIS);
      assert.equal((await sql(GESAMT_SQL)).rows[0].anzahl, 0);
      for (let nr = 0; nr < NACH_SPERRE_ABRUFE; nr += 1) assert.deepEqual(await hole(a, M0, "call_kp_9"), ENDE_EREIGNIS);
    });
  },
);

test(
  "Ein Webhook-Platz haelt ueber die 25 s des Abrufs hinaus bis Antwortfrist plus Rand, solange der Webhook laeuft",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitZweiInstanzen(t, [["call_kp_10", M0, "active"]], async ({ a, sql }) => {
      const abbruch = new AbortController();
      const frage = abrufMitFrist(`${a.localUrl}/webhooks/elevenlabs/consult`, {
        method: "POST",
        signal: abbruch.signal,
        headers: { "Content-Type": "application/json", "x-hermes-tool-token": WERKZEUG_TOKEN },
        body: JSON.stringify({ conversation_id: "conv_call_kp_10", question: "Darf ich zusagen?" }),
      }).catch(() => null);
      try {
        await anzahlBis(sql, "call_kp_10", 1);
        const { rest } = (await sql(REST_SQL)).rows[0];
        assert.ok(rest > ANTWORTFRIST_UNTEN_S && rest <= ANTWORTFRIST_OBEN_S, `Haltefrist ${rest} s`);
      } finally {
        abbruch.abort();
        await frage;
      }
    });
  },
);

const FREIGABE_FRIST_MS = 45_000;
const PROTOKOLL_TAKT_MS = 100;
const MELDUNG_BELEGEN = "[konsult-plaetze] Datenbank nicht erreichbar, kein Platz gewaehrt:";
const MELDUNG_FREIGEBEN = "[konsult-plaetze] Platz nicht freigegeben, verfaellt mit seiner Haltefrist:";

test(
  "Antwortet die Datenbank beim Belegen nicht, steht der Grund im Protokoll der Instanz",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitZweiInstanzen(t, [["call_kp_11", M0, "active"]], async ({ a, sql, hole }) => {
      await sql("BEGIN");
      await sql("LOCK TABLE konsult_platz IN ACCESS EXCLUSIVE MODE");
      try {
        await hole(a, M0, "call_kp_11");
      } finally {
        await sql("COMMIT");
      }
      assert.ok(a.stdout.includes(MELDUNG_BELEGEN), a.stdout);
    });
  },
);

test(
  "Scheitert die Freigabe eines Platzes, steht der Grund im Protokoll und der Platz verfaellt mit seiner Haltefrist",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitZweiInstanzen(t, [["call_kp_12", M0, "active"]], async ({ a, sql }) => {
      const frage = abrufMitFrist(`${a.localUrl}/api/calls/call_kp_12/consult`, {
        headers: { "X-Internal-Identity": M0.sub },
      }).catch(() => null);
      await anzahlBis(sql, "call_kp_12", 1);
      await sql("BEGIN");
      await sql("LOCK TABLE konsult_platz IN ACCESS EXCLUSIVE MODE");
      try {
        const ende = Date.now() + FREIGABE_FRIST_MS;
        while (!a.stdout.includes(MELDUNG_FREIGEBEN) && Date.now() < ende) await echtWarten(PROTOKOLL_TAKT_MS);
        assert.ok(a.stdout.includes(MELDUNG_FREIGEBEN), a.stdout);
      } finally {
        await sql("COMMIT");
        await frage;
      }
      assert.equal((await sql(ANZAHL_SQL, ["call_kp_12"])).rows[0].anzahl, 1);
    });
  },
);
