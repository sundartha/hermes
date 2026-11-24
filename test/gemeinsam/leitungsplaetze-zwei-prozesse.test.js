import assert from "node:assert/strict";
import pg from "pg";
import test from "node:test";

import { abrufMitFrist } from "./antwortfrist.mjs";
import { POSTGRES_VARIABLE } from "./echtes-postgres.js";
import { echteDatenbankMitRolle } from "./test-rolle.js";
import { postgresVorhanden, seedeMandant, starteAnAnbieter, starteAttrappeMitGespraechsende, zeilenBis } from "../anrufe/hermes-mit-postgres.js";
import { waitForLog, EL_OUTBOUND_BOOT_ENV } from "../helpers.js";

const ZEITGRENZE_MS = 240_000;
const HTTP_OK = 200;
const HTTP_UNAVAILABLE = 503;
const WARTEGRENZE_MS = 5_000;
const WARTEGRENZE_PUFFER_MS = 3_000;
const ABWEISUNG_FRIST_MS = 2 * WARTEGRENZE_MS + WARTEGRENZE_PUFFER_MS;
const ELEVENLABS_PLAETZE = 4;
const ZIEL_VORWAHL = "+49151123401";
const ZIEL_STELLEN = 3;
const MANDANT_IDS = [0, 1, 2].map((index) => `tenant_lp_pg_${index}`).join(",");
const EL_WEG = Object.freeze({
  ...EL_OUTBOUND_BOOT_ENV,
  ELEVENLABS_AGENT_ID: "agent_lp_pg",
  ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_lp_pg",
  ELEVENLABS_API_KEY: "el-lp-pg-schluessel",
  ELEVENLABS_INBOUND_TENANT_IDS: MANDANT_IDS,
});
const MANDANTEN = [0, 1, 2].map((index) => ({
  id: `tenant_lp_pg_${index}`,
  sub: `sub-lp-pg-${index}`,
  e164: `+4930555000${300 + index}`,
}));
const ALT_EINTRAG_SQL = `INSERT INTO leitungsplatz (call_id, anbieter, tenant_id, ablauf_um)
  VALUES ($1, 'elevenlabs', $2, now() + $3::interval)`;
const ALT_ZEILEN_SQL = "SELECT count(*)::int AS anzahl FROM leitungsplatz WHERE call_id LIKE 'alt_%'";
const KONVERSATION_SQL = "SELECT elevenlabs_conversation_id AS id FROM call ORDER BY seq";
const konversationBis = async (sql, fristMs) =>
  (
    await zeilenBis(
      async () => (await sql(KONVERSATION_SQL)).rows,
      (zeilen) => zeilen.some((zeile) => zeile.id !== null),
      fristMs,
    )
  ).find((zeile) => zeile.id !== null).id;
const PLATZ_ZEILEN_SQL = "SELECT count(*)::int AS anzahl FROM leitungsplatz WHERE anbieter = 'elevenlabs'";
const GESPRAECH_ENDE = [{ role: "agent", message: "Auf Wiederhoeren." }];
const SPERRE_NEHMEN_SQL = "SELECT pg_advisory_lock(2665, 1)";
const SPERRE_GEBEN_SQL = "SELECT pg_advisory_unlock(2665, 1)";
const WARTENDE_SPERREN_SQL = "SELECT count(*)::int AS anzahl FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND pid IN (SELECT pid FROM pg_stat_activity WHERE datname = current_database())";
const FREIGABE_FRIST_MS = WARTEGRENZE_MS + WARTEGRENZE_PUFFER_MS;
const PLAETZE_SQL = "SELECT anbieter, count(*)::int AS anzahl FROM leitungsplatz GROUP BY anbieter ORDER BY anbieter";
const ANRUFE_SQL = "SELECT count(*)::int AS anzahl FROM call";
const GEWAEHLT_SQL = "SELECT call_control_id FROM call WHERE id = $1";
const ANRUFE_GEWAEHLT_SQL = "SELECT count(*)::int AS gesamt, count(call_control_id)::int AS gewaehlt FROM call";

const gewaehltSeit = async (sql, callId) => (await sql(GEWAEHLT_SQL, [callId])).rows[0].call_control_id;
const gewaehltBis = (sql, callId) =>
  zeilenBis(
    () => gewaehltSeit(sql, callId),
    (kennung) => kennung !== null,
  );
const startsBis = (anbieter, anzahl) =>
  zeilenBis(
    async () => anbieter.starts().length,
    (gezaehlt) => gezaehlt === anzahl,
  );

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
    const instanz = await starteAnAnbieter(db, anbieter, { ...EL_WEG, ELEVENLABS_RESULT_POLL_MS: abholTaktMs });
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
    { wartezeitMs: ABWEISUNG_FRIST_MS },
  );
  return { status: antwort.status, body: await antwort.json() };
}

test(
  "S5: zwei Prozesse an derselben Datenbank teilen sich die vier ElevenLabs-Plaetze, sechs gleichzeitige Starts ergeben sechsmal 200 dialing, aber nur vier Wahlen",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitZweiProzessen(t, async ({ a, b, anbieter, sql }) => {
      const versuche = MANDANTEN.flatMap((mandant, index) =>
        [0, 1].map((nummer) => rufeAn((index + nummer) % 2 === 0 ? a : b, mandant)),
      );
      const antworten = await Promise.all(versuche);
      assert.deepEqual(antworten.map((antwort) => [antwort.status, antwort.body.status]), Array(6).fill([HTTP_OK, "dialing"]));
      assert.equal(anbieter.starts().length, ELEVENLABS_PLAETZE, "ElevenLabs sieht 4 Starts, nicht 6");
      const { rows } = await sql(PLAETZE_SQL);
      assert.deepEqual(rows, [
        { anbieter: "elevenlabs", anzahl: ELEVENLABS_PLAETZE },
        { anbieter: "telnyx", anzahl: ELEVENLABS_PLAETZE },
        { anbieter: "warteschlange", anzahl: 6 - ELEVENLABS_PLAETZE },
      ]);
      const anrufe = await zeilenBis(
        async () => (await sql(ANRUFE_GEWAEHLT_SQL)).rows[0],
        (zeile) => zeile.gesamt === 6 && zeile.gewaehlt === ELEVENLABS_PLAETZE,
      );
      assert.deepEqual(anrufe, { gesamt: 6, gewaehlt: ELEVENLABS_PLAETZE }, "die zwei Wartenden sind angelegt und nie gewaehlt");
    });
  },
);

test(
  "SG-29 Datenbank antwortet nicht binnen 5 Sekunden: ausgehender Anruf wird abgewiesen, nicht eingereiht und nichts wird gewählt",
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
        const dauerMs = Date.now() - beginn;
        assert.equal(blockiert.status, HTTP_UNAVAILABLE);
        assert.equal(blockiert.body.reason, "ausgelastet");
        assert.match(a.stdout, /\[leitungsplaetze\] Datenbank nicht erreichbar, ausgehend abgelehnt:/);
        assert.ok(dauerMs >= 2 * WARTEGRENZE_MS - 500, `wartet zweimal bis zur Grenze: ${dauerMs} ms`);
        assert.ok(dauerMs < ABWEISUNG_FRIST_MS, `wartet nicht laenger: ${dauerMs} ms`);
        assert.equal(anbieter.starts().length, 0, "ElevenLabs wurde nie angerufen");
        assert.equal((await sql(ANRUFE_SQL)).rows[0].anzahl, 0, "kein Anruf angelegt, nichts eingereiht");
      } finally {
        await sql("COMMIT");
      }
      assert.equal((await rufeAn(a, MANDANTEN[0])).status, HTTP_OK);
    });
  },
);

async function fuelleMitAlten(sql, restzeit) {
  for (let index = 0; index < ELEVENLABS_PLAETZE; index += 1)
    await sql(ALT_EINTRAG_SQL, [`alt_${index}`, `tenant_alt_${index}`, restzeit]);
}

test("S5: abgelaufene Plaetze zaehlen nicht und werden entfernt, unabgelaufene Plaetze eines anderen Prozesses halten den Anruf in der Warteschlange", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitZweiProzessen(t, async ({ a, b, anbieter, sql }) => {
    await fuelleMitAlten(sql, "1 hour");
    const voll = await rufeAn(b, MANDANTEN[0]);
    assert.equal(voll.status, HTTP_OK);
    assert.equal(voll.body.status, "dialing");
    assert.equal(await gewaehltSeit(sql, voll.body.callId), null);
    assert.equal(anbieter.starts().length, 0);
    await sql("UPDATE leitungsplatz SET ablauf_um = now() - interval '1 minute'");
    await gewaehltBis(sql, voll.body.callId);
    assert.equal((await rufeAn(a, MANDANTEN[0])).status, HTTP_OK);
    await startsBis(anbieter, 2);
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
      const wartend = await rufeAn(a, MANDANTEN[2]);
      assert.equal(wartend.status, HTTP_OK);
      assert.equal(await gewaehltSeit(sql, wartend.body.callId), null);
      assert.equal(anbieter.starts().length, ELEVENLABS_PLAETZE);
      const id = await konversationBis(sql);
      anbieter.beendeGespraech(id, GESPRAECH_ENDE);
      await gewaehltBis(sql, wartend.body.callId);
      assert.equal((await sql(PLATZ_ZEILEN_SQL)).rows[0].anzahl, ELEVENLABS_PLAETZE, "der frei gewordene Platz gehoert dem Wartenden");
      const zweiterWartender = await rufeAn(b, MANDANTEN[2]);
      assert.equal(zweiterWartender.status, HTTP_OK);
      assert.equal(await gewaehltSeit(sql, zweiterWartender.body.callId), null, "die anderen Plaetze bleiben belegt");
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
      await startsBis(anbieter, 1);
      const id = await konversationBis(sql, FREIGABE_FRIST_MS);
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
