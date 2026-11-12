import assert from "node:assert/strict";
import pg from "pg";
import test from "node:test";

import { abrufMitFrist } from "./antwortfrist.mjs";
import { POSTGRES_VARIABLE } from "./echtes-postgres.js";
import { pgStartUmgebung } from "./pg-start-umgebung.js";
import { echteDatenbankMitRolle } from "./test-rolle.js";
import { postgresVorhanden, seedeMandant, starteAttrappeMitGespraechsende, zeilenBis } from "../anrufe/hermes-mit-postgres.js";
import { startServer, waitForLog } from "../helpers.js";

const ZEITGRENZE_MS = 240_000;
const HTTP_OK = 200;
const HTTP_UNAVAILABLE = 503;
const WARTEGRENZE_MS = 5_000;
const WARTEGRENZE_PUFFER_MS = 3_000;
const ELEVENLABS_PLAETZE = 4;
const ZIEL_VORWAHL = "+49151123401";
const ZIEL_STELLEN = 3;
const EL_WEG = Object.freeze({
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_AGENT_ID: "agent_lp_pg",
  ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_lp_pg",
  ELEVENLABS_API_KEY: "el-lp-pg-schluessel",
});
const MANDANTEN = [0, 1, 2].map((index) => ({
  id: `tenant_lp_pg_${index}`,
  sub: `sub-lp-pg-${index}`,
  e164: `+4930555000${300 + index}`,
}));
const ALT_EINTRAG_SQL = `INSERT INTO leitungsplatz (call_id, anbieter, tenant_id, ablauf_um)
  VALUES ($1, 'elevenlabs', $2, now() + $3::interval)`;
const ALT_ZEILEN_SQL = "SELECT count(*)::int AS anzahl FROM leitungsplatz WHERE call_id LIKE 'alt_%'";
const KONVERSATION_SQL = "SELECT elevenlabs_conversation_id AS id FROM call WHERE elevenlabs_conversation_id IS NOT NULL ORDER BY seq LIMIT 1";
const konversationBis = async (sql) =>
  (await zeilenBis(async () => (await sql(KONVERSATION_SQL)).rows, (zeilen) => zeilen.length === 1))[0].id;
const PLATZ_ZEILEN_SQL = "SELECT count(*)::int AS anzahl FROM leitungsplatz WHERE anbieter = 'elevenlabs'";
const GESPRAECH_ENDE = [{ role: "agent", message: "Auf Wiederhoeren." }];
const SPERRE_NEHMEN_SQL = "SELECT pg_advisory_lock(2665, 1)";
const SPERRE_GEBEN_SQL = "SELECT pg_advisory_unlock(2665, 1)";
const WARTENDE_SPERREN_SQL = "SELECT count(*)::int AS anzahl FROM pg_locks WHERE locktype = 'advisory' AND NOT granted";
const FREIGABE_FRIST_MS = WARTEGRENZE_MS + WARTEGRENZE_PUFFER_MS;
const PLAETZE_SQL = "SELECT anbieter, count(*)::int AS anzahl FROM leitungsplatz GROUP BY anbieter ORDER BY anbieter";
const ANRUFE_SQL = "SELECT count(*)::int AS anzahl FROM call";

function adminAdresse(rollenAdresse) {
  const url = new URL(process.env[POSTGRES_VARIABLE]);
  url.pathname = new URL(rollenAdresse).pathname;
  return url.href;
}

async function mitZweiProzessen(t, lauf, { abholTaktMs = "60000" } = {}) {
  const db = await echteDatenbankMitRolle(t);
  const verwaltung = new pg.Client({ connectionString: adminAdresse(db.adresse) });
  await verwaltung.connect();
  const anbieter = await starteAttrappeMitGespraechsende();
  const gestartet = [];
  const starte = async () => {
    const instanz = await startServer({
      env: pgStartUmgebung(db.adresse, { ...EL_WEG, ELEVENLABS_RESULT_POLL_MS: abholTaktMs, ELEVENLABS_API_BASE: anbieter.url }),
    });
    gestartet.push(instanz);
    return instanz;
  };
  const sql = (text, parameter) => verwaltung.query(text, parameter);
  try {
    await (await starte()).stop();
    for (const mandant of MANDANTEN) await seedeMandant(sql, mandant);
    const a = await starte();
    const b = await starte();
    return await lauf({ a, b, anbieter, sql });
  } finally {
    await Promise.all(gestartet.map((instanz) => instanz.stop()));
    await anbieter.schliessen();
    await verwaltung.end();
  }
}

let zaehler = 0;
async function rufeAn(prozess, mandant) {
  zaehler += 1;
  const ziel = `${ZIEL_VORWAHL}${String(zaehler).padStart(ZIEL_STELLEN, "0")}`;
  const antwort = await abrufMitFrist(
    `${prozess.localUrl}/api/calls`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Identity": mandant.sub },
      body: JSON.stringify({ to: ziel, objective: `Auftrag ${ziel}` }),
    },
    { wartezeitMs: WARTEGRENZE_MS + WARTEGRENZE_PUFFER_MS },
  );
  return { status: antwort.status, body: await antwort.json() };
}

test(
  "S5: zwei Prozesse an derselben Datenbank teilen sich die vier ElevenLabs-Plaetze, sechs gleichzeitige Starts ergeben vier 200 und zwei 503",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitZweiProzessen(t, async ({ a, b, anbieter, sql }) => {
      const versuche = MANDANTEN.flatMap((mandant, index) =>
        [0, 1].map((nummer) => rufeAn((index + nummer) % 2 === 0 ? a : b, mandant)),
      );
      const antworten = await Promise.all(versuche);
      const angenommen = antworten.filter((antwort) => antwort.status === HTTP_OK);
      const abgelehnt = antworten.filter((antwort) => antwort.status === HTTP_UNAVAILABLE);
      assert.equal(angenommen.length, ELEVENLABS_PLAETZE);
      assert.equal(abgelehnt.length, 2);
      for (const antwort of abgelehnt) assert.equal(antwort.body.reason, "ausgelastet");
      assert.equal(anbieter.starts().length, ELEVENLABS_PLAETZE, "ElevenLabs sieht 4 Starts, nicht 6");
      const { rows } = await sql(PLAETZE_SQL);
      assert.deepEqual(rows, [
        { anbieter: "elevenlabs", anzahl: ELEVENLABS_PLAETZE },
        { anbieter: "telnyx", anzahl: ELEVENLABS_PLAETZE },
      ]);
      const anrufe = await zeilenBis(
        async () => (await sql(ANRUFE_SQL)).rows[0].anzahl,
        (anzahl) => anzahl >= ELEVENLABS_PLAETZE,
      );
      assert.equal(anrufe, ELEVENLABS_PLAETZE, "Ablehnungen hinterlassen keinen Anruf");
    });
  },
);

test(
  "SG-29 Datenbank antwortet nicht binnen 5 Sekunden: ausgehender Anruf wird abgelehnt und nichts gewählt",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitZweiProzessen(t, async ({ a, anbieter, sql }) => {
      await sql("BEGIN");
      await sql("LOCK TABLE leitungsplatz IN ACCESS EXCLUSIVE MODE");
      const beginn = Date.now();
      let blockiert;
      try {
        blockiert = await rufeAn(a, MANDANTEN[0]);
      } finally {
        await sql("COMMIT");
      }
      const dauerMs = Date.now() - beginn;
      assert.equal(blockiert.status, HTTP_UNAVAILABLE);
      assert.equal(blockiert.body.reason, "ausgelastet");
      assert.match(a.stdout, /\[leitungsplaetze\] Datenbank nicht erreichbar, ausgehend abgelehnt:/);
      assert.ok(dauerMs >= WARTEGRENZE_MS - 500, `wartet bis zur Grenze: ${dauerMs} ms`);
      assert.ok(dauerMs < WARTEGRENZE_MS + WARTEGRENZE_PUFFER_MS, `wartet nicht laenger: ${dauerMs} ms`);
      assert.equal(anbieter.starts().length, 0, "ElevenLabs wurde nie angerufen");
      assert.equal((await sql(ANRUFE_SQL)).rows[0].anzahl, 0);
      assert.equal((await rufeAn(a, MANDANTEN[0])).status, HTTP_OK);
    });
  },
);

async function fuelleMitAlten(sql, restzeit) {
  for (let index = 0; index < ELEVENLABS_PLAETZE; index += 1)
    await sql(ALT_EINTRAG_SQL, [`alt_${index}`, `tenant_alt_${index}`, restzeit]);
}

test("S5: abgelaufene Plaetze zaehlen nicht und werden entfernt, unabgelaufene Plaetze eines anderen Prozesses halten die Ablehnung", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitZweiProzessen(t, async ({ a, b, anbieter, sql }) => {
    await fuelleMitAlten(sql, "1 hour");
    const voll = await rufeAn(b, MANDANTEN[0]);
    assert.equal(voll.status, HTTP_UNAVAILABLE);
    assert.equal(voll.body.reason, "ausgelastet");
    assert.equal(anbieter.starts().length, 0);
    await sql("UPDATE leitungsplatz SET ablauf_um = now() - interval '1 minute'");
    assert.equal((await rufeAn(a, MANDANTEN[0])).status, HTTP_OK);
    assert.equal(anbieter.starts().length, 1);
    assert.equal((await sql(ALT_ZEILEN_SQL)).rows[0].anzahl, 0, "abgelaufene Zeilen sind geloescht");
  });
});

test("S5: ein beendetes ElevenLabs-Gespraech gibt seinen Platz in der Tabelle frei, die anderen bleiben", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitZweiProzessen(
    t,
    async ({ a, b, anbieter, sql }) => {
      for (const [index, mandant] of [MANDANTEN[0], MANDANTEN[0], MANDANTEN[1], MANDANTEN[1]].entries())
        assert.equal((await rufeAn(index % 2 === 0 ? a : b, mandant)).status, HTTP_OK);
      assert.equal((await rufeAn(a, MANDANTEN[2])).status, HTTP_UNAVAILABLE);
      const id = await konversationBis(sql);
      anbieter.beendeGespraech(id, GESPRAECH_ENDE);
      await zeilenBis(
        async () => (await sql(PLATZ_ZEILEN_SQL)).rows[0].anzahl,
        (anzahl) => anzahl === ELEVENLABS_PLAETZE - 1,
      );
      assert.equal((await rufeAn(b, MANDANTEN[2])).status, HTTP_OK);
      assert.equal((await rufeAn(a, MANDANTEN[2])).status, HTTP_UNAVAILABLE);
    },
    { abholTaktMs: "200" },
  );
});

test("S5: das Belegen wartet auf die Sperre eines anderen Prozesses und geht danach durch", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitZweiProzessen(t, async ({ a, sql }) => {
    await sql(SPERRE_NEHMEN_SQL);
    const wartend = rufeAn(a, MANDANTEN[0]);
    await zeilenBis(
      async () => (await sql(WARTENDE_SPERREN_SQL)).rows[0].anzahl,
      (anzahl) => anzahl === 1,
    );
    await sql(SPERRE_GEBEN_SQL);
    assert.equal((await wartend).status, HTTP_OK);
  });
});

test("S5: scheitert das Freigeben in der Datenbank, bleibt der Platz bis zum Ablauf belegt", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitZweiProzessen(
    t,
    async ({ a, anbieter, sql }) => {
      assert.equal((await rufeAn(a, MANDANTEN[0])).status, HTTP_OK);
      const id = await konversationBis(sql);
      await sql("BEGIN");
      await sql("LOCK TABLE leitungsplatz IN ACCESS EXCLUSIVE MODE");
      try {
        anbieter.beendeGespraech(id, GESPRAECH_ENDE);
        await waitForLog(a, /\[leitungsplaetze\] Platz nicht freigegeben, bleibt bis zum Ablauf belegt:/, FREIGABE_FRIST_MS);
      } finally {
        await sql("COMMIT");
      }
      assert.equal((await sql(PLATZ_ZEILEN_SQL)).rows[0].anzahl, 1);
    },
    { abholTaktMs: "200" },
  );
});
