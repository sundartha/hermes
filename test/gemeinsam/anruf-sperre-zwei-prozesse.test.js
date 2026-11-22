import assert from "node:assert/strict";
import pg from "pg";
import test from "node:test";

import { abrufMitFrist } from "./antwortfrist.mjs";
import { POSTGRES_VARIABLE } from "./echtes-postgres.js";
import { echteDatenbankMitRolle } from "./test-rolle.js";
import { postgresVorhanden, seedeMandant, starteAnAnbieter, starteAttrappeMitGespraechsende, zeilenBis } from "../anrufe/hermes-mit-postgres.js";
import { BASE_ENV, EL_OUTBOUND_BOOT_ENV, tempDataDir } from "../helpers.js";

const ZEITGRENZE_MS = 240_000;
const HTTP_OK = 200;
const ANTWORT_FRIST_MS = 20_000;
const MANDANT_IDS = [0, 1].map((index) => `tenant_as_pg_${index}`).join(",");
const EL_WEG = Object.freeze({
  ...EL_OUTBOUND_BOOT_ENV,
  ELEVENLABS_AGENT_ID: "agent_as_pg",
  ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_as_pg",
  ELEVENLABS_API_KEY: "el-as-pg-schluessel",
  ELEVENLABS_INBOUND_TENANT_IDS: MANDANT_IDS,
  ELEVENLABS_RESULT_POLL_MS: "60000",
});
const MANDANTEN = [0, 1].map((index) => ({
  id: `tenant_as_pg_${index}`,
  sub: `sub-as-pg-${index}`,
  e164: `+4930555000${400 + index}`,
}));
const ZIEL_A = "+4915112340101";
const ZIEL_B = "+4915112340102";
const ANRUFE_SQL = "SELECT tenant_id AS \"tenantId\", to_e164 AS ziel FROM call ORDER BY seq";
const TABELLE_SPERREN_SQL = "LOCK TABLE call IN SHARE ROW EXCLUSIVE MODE";
const WARTENDE_SQL = `SELECT locktype, count(*)::int AS anzahl FROM pg_locks WHERE NOT granted GROUP BY locktype`;

function adminAdresse(rollenAdresse) {
  const url = new URL(process.env[POSTGRES_VARIABLE]);
  url.pathname = new URL(rollenAdresse).pathname;
  return url.href;
}

async function mitZweiProzessen(t, lauf) {
  const db = await echteDatenbankMitRolle(t);
  const verwaltung = new pg.Client({ connectionString: adminAdresse(db.adresse) });
  await verwaltung.connect();
  const anbieter = await starteAttrappeMitGespraechsende();
  const gestartet = [];
  const starte = async () => {
    const instanz = await starteAnAnbieter(db, anbieter, EL_WEG);
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

async function rufeAn(prozess, mandant, ziel) {
  const antwort = await abrufMitFrist(
    `${prozess.localUrl}/api/calls`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Identity": mandant.sub },
      body: JSON.stringify({ to: ziel, objective: `Auftrag ${ziel}` }),
    },
    { wartezeitMs: ANTWORT_FRIST_MS },
  );
  return { status: antwort.status, body: await antwort.json() };
}

const wartendeNachArt = async (sql) =>
  Object.fromEntries((await sql(WARTENDE_SQL)).rows.map((zeile) => [zeile.locktype, zeile.anzahl]));

async function mitTabellensperre(sql, arbeit) {
  await sql("BEGIN");
  await sql(TABELLE_SPERREN_SQL);
  try {
    return await arbeit();
  } finally {
    await sql("COMMIT");
  }
}

async function gleichzeitig(sql, auftraege, bereit) {
  return mitTabellensperre(sql, async () => {
    const antworten = Promise.all(auftraege.map((auftrag) => auftrag()));
    await zeilenBis(() => wartendeNachArt(sql), bereit);
    return { antworten };
  }).then(({ antworten }) => antworten);
}

const summe = (wartende) => Object.values(wartende).reduce((a, b) => a + b, 0);

test(
  "zwei Prozesse, gleichzeitig dieselbe Nummer desselben Mandanten: eine call-Zeile, ein Waehlauftrag, die zweite Antwort ist deduplicated mit derselben callId",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitZweiProzessen(t, async ({ a, b, anbieter, sql }) => {
      const antworten = await gleichzeitig(
        sql,
        [() => rufeAn(a, MANDANTEN[0], ZIEL_A), () => rufeAn(b, MANDANTEN[0], ZIEL_A)],
        (wartende) => summe(wartende) >= 2,
      );
      assert.deepEqual(antworten.map((antwort) => antwort.status), [HTTP_OK, HTTP_OK]);
      assert.deepEqual(antworten.map((antwort) => antwort.body.deduplicated).sort(), [false, true]);
      assert.equal(antworten[0].body.callId, antworten[1].body.callId);
      const { rows } = await sql(ANRUFE_SQL);
      assert.deepEqual(rows, [{ tenantId: MANDANTEN[0].id, ziel: ZIEL_A }]);
      assert.equal(anbieter.starts().length, 1, "ElevenLabs bekommt genau einen Waehlauftrag");
    });
  },
);

test(
  "zwei Prozesse, gleichzeitig verschiedene Mandanten: die Sperre des einen blockiert den anderen nicht, jeder Anruf gehoert seinem Mandanten",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitZweiProzessen(t, async ({ a, b, anbieter, sql }) => {
      const antworten = await mitTabellensperre(sql, async () => {
        const erste = rufeAn(a, MANDANTEN[0], ZIEL_A);
        await zeilenBis(() => wartendeNachArt(sql), (wartende) => wartende.relation === 1);
        const zweite = rufeAn(b, MANDANTEN[1], ZIEL_A);
        const wartende = await zeilenBis(() => wartendeNachArt(sql), (gezaehlt) => summe(gezaehlt) >= 2);
        assert.equal(wartende.advisory, undefined, "der zweite Mandant wartet nicht auf die Sperre des ersten");
        return { antworten: Promise.all([erste, zweite]) };
      }).then(({ antworten: ergebnis }) => ergebnis);
      assert.deepEqual(antworten.map((antwort) => [antwort.status, antwort.body.deduplicated]), [
        [HTTP_OK, false],
        [HTTP_OK, false],
      ]);
      assert.notEqual(antworten[0].body.callId, antworten[1].body.callId);
      const { rows } = await sql(ANRUFE_SQL);
      assert.deepEqual(rows.map((zeile) => zeile.tenantId).sort(), MANDANTEN.map((mandant) => mandant.id));
      assert.equal(anbieter.starts().length, 2);
    });
  },
);

test(
  "zwei Prozesse, gleichzeitig zwei Nummern desselben Mandanten: beide Anrufe entstehen nacheinander",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitZweiProzessen(t, async ({ a, b, sql }) => {
      const antworten = await gleichzeitig(
        sql,
        [() => rufeAn(a, MANDANTEN[0], ZIEL_A), () => rufeAn(b, MANDANTEN[0], ZIEL_B)],
        (wartende) => summe(wartende) >= 2,
      );
      assert.deepEqual(antworten.map((antwort) => [antwort.status, antwort.body.deduplicated]), [
        [HTTP_OK, false],
        [HTTP_OK, false],
      ]);
      assert.deepEqual((await sql(ANRUFE_SQL)).rows.map((zeile) => zeile.ziel).sort(), [ZIEL_A, ZIEL_B]);
    });
  },
);

const SPERRE_FRIST_MS = 5_000;
const SPERRE_FRIST_PUFFER_MS = 4_000;
const ANRUF_SPERRE_NAMENSRAUM = 2667;
const MANDANT_SPERRE_NEHMEN_SQL = "SELECT pg_advisory_lock($1, hashtext($2))";
const MANDANT_SPERRE_GEBEN_SQL = "SELECT pg_advisory_unlock($1, hashtext($2))";
const SPERRE_HALTER_SQL = "SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND granted";
const HTTP_UNAVAILABLE = 503;
const UHR_SQL = "SELECT (extract(epoch FROM clock_timestamp()) * 1000)::float8 AS ms";
const datenbankUhr = async (sql) => (await sql(UHR_SQL)).rows[0].ms;

test(
  "zwei Prozesse: ist die Sperre des Mandanten nach 5 Sekunden nicht zu haben, antwortet place_call 503, legt nichts an und waehlt nicht; danach laeuft der naechste Anruf sofort",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitZweiProzessen(t, async ({ a, anbieter, sql }) => {
      await sql(MANDANT_SPERRE_NEHMEN_SQL, [ANRUF_SPERRE_NAMENSRAUM, MANDANTEN[0].id]);
      const beginn = await datenbankUhr(sql);
      let blockiert;
      try {
        blockiert = await rufeAn(a, MANDANTEN[0], ZIEL_A);
      } finally {
        await sql(MANDANT_SPERRE_GEBEN_SQL, [ANRUF_SPERRE_NAMENSRAUM, MANDANTEN[0].id]);
      }
      const dauerMs = (await datenbankUhr(sql)) - beginn;
      assert.equal(blockiert.status, HTTP_UNAVAILABLE);
      assert.match(blockiert.body.error, /nicht gewaehlt/);
      assert.ok(dauerMs >= SPERRE_FRIST_MS - 500, `wartet bis zur Frist: ${dauerMs} ms`);
      assert.ok(dauerMs < SPERRE_FRIST_MS + SPERRE_FRIST_PUFFER_MS, `wartet nicht laenger: ${dauerMs} ms`);
      assert.equal((await sql(ANRUFE_SQL)).rows.length, 0, "keine call-Zeile angelegt");
      assert.equal(anbieter.starts().length, 0, "nichts gewaehlt");
      assert.equal((await rufeAn(a, MANDANTEN[0], ZIEL_A)).status, HTTP_OK);
      assert.equal((await sql(WARTENDE_SQL)).rows.length, 0);
    });
  },
);

test(
  "zwei Prozesse: ein anderer Mandant wartet nicht auf die gehaltene Sperre eines Mandanten",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitZweiProzessen(t, async ({ a, sql }) => {
      await sql(MANDANT_SPERRE_NEHMEN_SQL, [ANRUF_SPERRE_NAMENSRAUM, MANDANTEN[0].id]);
      try {
        const antwort = await rufeAn(a, MANDANTEN[1], ZIEL_A);
        assert.equal(antwort.status, HTTP_OK);
      } finally {
        await sql(MANDANT_SPERRE_GEBEN_SQL, [ANRUF_SPERRE_NAMENSRAUM, MANDANTEN[0].id]);
      }
    });
  },
);

test(
  "zwei Prozesse: wartet ein Anruf des einen Mandanten auf dessen gehaltene Sperre, antwortet place_call eines anderen Mandanten auf derselben Instanz sofort",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitZweiProzessen(t, async ({ a, sql }) => {
      await sql(MANDANT_SPERRE_NEHMEN_SQL, [ANRUF_SPERRE_NAMENSRAUM, MANDANTEN[0].id]);
      let wartender;
      try {
        wartender = rufeAn(a, MANDANTEN[0], ZIEL_A);
        await zeilenBis(() => wartendeNachArt(sql), (wartende) => wartende.advisory === 1);
        const anderer = await rufeAn(a, MANDANTEN[1], ZIEL_B);
        assert.equal(anderer.status, HTTP_OK);
        assert.equal(anderer.body.deduplicated, false);
        assert.equal((await wartendeNachArt(sql)).advisory, 1, "der erste Mandant wartet noch, als der andere antwortet");
      } finally {
        await sql(MANDANT_SPERRE_GEBEN_SQL, [ANRUF_SPERRE_NAMENSRAUM, MANDANTEN[0].id]);
      }
      const erster = await wartender;
      assert.equal(erster.status, HTTP_OK);
      assert.equal(erster.body.deduplicated, false);
    });
  },
);

test(
  "zwei Prozesse: bricht die Verbindung mit der Sperre ab, antwortet place_call 503, legt nichts an und waehlt nicht, der Fehler wird gemeldet und der naechste Anruf laeuft",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitZweiProzessen(t, async ({ a, anbieter, sql }) => {
      const antwort = await mitTabellensperre(sql, async () => {
        const anruf = rufeAn(a, MANDANTEN[0], ZIEL_A);
        await zeilenBis(() => wartendeNachArt(sql), (wartende) => wartende.relation === 1);
        for (const { pid } of (await sql(SPERRE_HALTER_SQL)).rows) await sql("SELECT pg_terminate_backend($1)", [pid]);
        return { antwort: anruf };
      }).then(({ antwort: anruf }) => anruf);
      assert.equal(antwort.status, HTTP_UNAVAILABLE);
      assert.match(antwort.body.error, /nicht gewaehlt/);
      assert.equal((await sql(ANRUFE_SQL)).rows.length, 0, "keine call-Zeile angelegt");
      assert.equal(anbieter.starts().length, 0, "nichts gewaehlt");
      assert.match(a.stdout, /\[anruf-sperre\] Sperre nicht freigegeben, Verbindungssperren werden aufgehoben:/);
      assert.match(a.stdout, /\[anruf-sperre\] Sperren der Verbindung nicht aufgehoben, enden mit der Verbindung:/);
      assert.equal((await rufeAn(a, MANDANTEN[0], ZIEL_B)).status, HTTP_OK);
    });
  },
);

test("JSON-Speicher: die Sperre fuehrt die Arbeit ohne Datenbank aus und reicht ihr Ergebnis und ihren Fehler durch", async () => {
  Object.assign(process.env, BASE_ENV, { DATA_DIR: tempDataDir(), STORE_BACKEND: "json" });
  const store = await import("../../src/store.js?anruf-sperre-json");
  await store.oeffneSpeicher();
  assert.equal(await store.mitAnrufSperre(MANDANTEN[0].id, async () => "ergebnis"), "ergebnis");
  await assert.rejects(
    store.mitAnrufSperre(MANDANTEN[0].id, async () => {
      throw new Error("arbeit kaputt");
    }),
    /arbeit kaputt/,
  );
});
