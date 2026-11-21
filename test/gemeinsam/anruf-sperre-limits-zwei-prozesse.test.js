import assert from "node:assert/strict";
import test from "node:test";

import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { ANRUF_SPERREN_SQL, mitZweiHermesAufPostgres, postgresVorhanden, rufeAnMit, zeilenBis } from "../anrufe/hermes-mit-postgres.js";

const ZEITGRENZE_MS = 240_000;
const HTTP_OK = 200;
const HTTP_TOO_MANY = 429;
const HTTP_UNAVAILABLE = 503;
const ZIEL_A = "+4915112340201";
const ZIEL_B = "+4915112340202";
const NICHT_GEWAEHLT = "Anruf konnte nicht angelegt werden. Es wurde nicht gewaehlt, es entstehen keine Kosten.";
const ANRUFE_SQL = "SELECT to_e164 AS ziel FROM call ORDER BY seq";
const SPERRE_ART = Object.freeze({
  schreiben: "LOCK TABLE call IN SHARE ROW EXCLUSIVE MODE",
  lesen: "LOCK TABLE call IN ACCESS EXCLUSIVE MODE",
});
const WARTENDE_SQL = "SELECT count(*)::int AS anzahl FROM pg_locks WHERE NOT granted";
const EIGENE_DATENBANK_SQL = "database = (SELECT oid FROM pg_database WHERE datname = current_database())";
const EIGENE_SPERREN_SQL = `SELECT count(*)::int AS anzahl FROM pg_locks WHERE locktype = 'advisory' AND ${EIGENE_DATENBANK_SQL}`;
const SPERRE_WARTET_SQL = `SELECT count(*)::int AS anzahl FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND ${EIGENE_DATENBANK_SQL}`;
const ANRUF_SPERRE_NAMENSRAUM = 2667;
const ROLLE_SQL = `SELECT DISTINCT usename FROM pg_stat_activity
  WHERE datname = current_database() AND usename <> current_user`;
const SPALTEN_SQL = "SELECT column_name FROM information_schema.columns WHERE table_name = 'call'";
const ALTANRUF_SQL = `INSERT INTO call (id, tenant_id, stream_token, direction, status, from_e164, to_e164, goal, started_at)
  VALUES ('call_asl_alt', $1, 'tok_asl_alt', 'outbound', 'completed', (SELECT e164 FROM number WHERE tenant_id = $1), $2, 'Altauftrag', now() - interval '10 minutes')`;

const antwort = async (aufruf) => {
  const res = await aufruf;
  return { status: res.status, body: await res.json() };
};

async function gleichzeitig(sql, auftraege, art = "schreiben") {
  await sql("BEGIN");
  await sql(SPERRE_ART[art]);
  try {
    const antworten = Promise.all(auftraege.map((auftrag) => antwort(auftrag())));
    await zeilenBis(
      async () => (await sql(WARTENDE_SQL)).rows[0].anzahl,
      (wartende) => wartende >= auftraege.length,
    );
    await sql("COMMIT");
    return await antworten;
  } catch (fehler) {
    await sql("ROLLBACK");
    throw fehler;
  }
}

const rolleDerAnwendung = async (sql) => (await sql(ROLLE_SQL)).rows[0].usename;
const keineSperre = async (sql) => assert.equal((await sql(ANRUF_SPERREN_SQL)).rows[0].anzahl, 0);
const keineEigeneSperre = async (sql) => assert.equal((await sql(EIGENE_SPERREN_SQL)).rows[0].anzahl, 0);

test(
  "zwei Prozesse, Stundenlimit 1: zwei gleichzeitige Anrufe an verschiedene Nummern ergeben einen Anruf und 429 stundenlimit",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitZweiHermesAufPostgres(t, { env: { MAX_CALLS_PER_HOUR: "1" } }, async ({ a, b, anbieter, sql }) => {
      const antworten = await gleichzeitig(sql, [() => rufeAnMit(a, { to: ZIEL_A }), () => rufeAnMit(b, { to: ZIEL_B })]);
      assert.deepEqual(antworten.map((a1) => a1.status).sort(), [HTTP_OK, HTTP_TOO_MANY]);
      assert.equal(antworten.find((a1) => a1.status === HTTP_TOO_MANY).body.reason, "stundenlimit");
      assert.equal((await sql(ANRUFE_SQL)).rows.length, 1);
      assert.equal(anbieter.starts().length, 1);
      await keineSperre(sql);
    });
  },
);

test(
  "zwei Prozesse, Ziel-Limit 1 mit einem frueheren Anruf: zwei gleichzeitige Anrufe an dieselbe Nummer ergeben zweimal 429 ziel_limit und keine neue Zeile",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    const env = { MAX_CALLS_PER_HOUR: "50", PER_TARGET_CALL_CAP: "1" };
    await mitZweiHermesAufPostgres(t, { env }, async ({ a, b, anbieter, sql }) => {
      await sql(ALTANRUF_SQL, [BOOTSTRAP_TENANT_ID, ZIEL_A]);
      const antworten = await gleichzeitig(sql, [() => rufeAnMit(a, { to: ZIEL_A }), () => rufeAnMit(b, { to: ZIEL_A })], "lesen");
      assert.deepEqual(antworten.map((a1) => [a1.status, a1.body.reason]), [
        [HTTP_TOO_MANY, "ziel_limit"],
        [HTTP_TOO_MANY, "ziel_limit"],
      ]);
      assert.equal((await sql(ANRUFE_SQL)).rows.length, 1);
      assert.equal(anbieter.starts().length, 0);
      await keineSperre(sql);
      assert.equal((await antwort(rufeAnMit(a, { to: ZIEL_B }))).status, HTTP_OK);
    });
  },
);

test(
  "zwei Prozesse: ist die Liste der laufenden Anrufe nicht lesbar, antwortet place_call 503, legt nichts an und waehlt nicht; die Sperre ist frei und der naechste Anruf laeuft sofort",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitZweiHermesAufPostgres(t, {}, async ({ a, b, anbieter, sql }) => {
      const rolle = await rolleDerAnwendung(sql);
      const spalten = (await sql(SPALTEN_SQL)).rows.map((zeile) => zeile.column_name);
      await sql(`REVOKE SELECT ON call FROM ${rolle}`);
      await sql(`GRANT SELECT (${spalten.filter((name) => name !== "goal").join(", ")}) ON call TO ${rolle}`);
      const fehlgeschlagen = await antwort(rufeAnMit(a, { to: ZIEL_A }));
      assert.deepEqual([fehlgeschlagen.status, fehlgeschlagen.body.error], [HTTP_UNAVAILABLE, NICHT_GEWAEHLT]);
      assert.equal((await sql(ANRUFE_SQL)).rows.length, 0);
      assert.equal(anbieter.starts().length, 0);
      await keineSperre(sql);
      await sql(`GRANT SELECT ON call TO ${rolle}`);
      const folgend = await antwort(rufeAnMit(b, { to: ZIEL_A }));
      assert.equal(folgend.status, HTTP_OK);
      assert.equal(anbieter.starts().length, 1);
    });
  },
);

test(
  "zwei Prozesse: ist die call-Zeile nicht schreibbar, antwortet place_call 503 und waehlt nicht; die Sperre ist frei und der naechste Anruf desselben Mandanten laeuft sofort",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitZweiHermesAufPostgres(t, {}, async ({ a, b, anbieter, sql }) => {
      const rolle = await rolleDerAnwendung(sql);
      await sql(`REVOKE INSERT ON call FROM ${rolle}`);
      const fehlgeschlagen = await antwort(rufeAnMit(a, { to: ZIEL_A }));
      assert.deepEqual([fehlgeschlagen.status, fehlgeschlagen.body.error], [HTTP_UNAVAILABLE, NICHT_GEWAEHLT]);
      assert.equal((await sql(ANRUFE_SQL)).rows.length, 0);
      assert.equal(anbieter.starts().length, 0);
      await keineSperre(sql);
      await sql(`GRANT INSERT ON call TO ${rolle}`);
      const folgend = await antwort(rufeAnMit(b, { to: ZIEL_B }));
      assert.equal(folgend.status, HTTP_OK);
      assert.deepEqual((await sql(ANRUFE_SQL)).rows, [{ ziel: ZIEL_B }]);
      assert.equal(anbieter.starts().length, 1);
    });
  },
);

test(
  "zwei Prozesse: faellt das Lesen der laufenden Anrufe erst unter der gehaltenen Sperre aus, antwortet place_call 503, legt nichts an und waehlt nicht; die Sperre ist frei und der naechste Anruf laeuft sofort",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitZweiHermesAufPostgres(t, {}, async ({ a, b, anbieter, sql }) => {
      const rolle = await rolleDerAnwendung(sql);
      const spalten = (await sql(SPALTEN_SQL)).rows.map((zeile) => zeile.column_name);
      const schluessel = [ANRUF_SPERRE_NAMENSRAUM, BOOTSTRAP_TENANT_ID];
      await sql("SELECT pg_advisory_lock($1, hashtext($2))", schluessel);
      const antwortet = antwort(rufeAnMit(a, { to: ZIEL_A }));
      try {
        await zeilenBis(
          async () => (await sql(SPERRE_WARTET_SQL)).rows[0].anzahl,
          (wartende) => wartende >= 1,
        );
        await sql(`REVOKE SELECT ON call FROM ${rolle}`);
        await sql(`GRANT SELECT (${spalten.filter((name) => name !== "goal").join(", ")}) ON call TO ${rolle}`);
      } finally {
        await sql("SELECT pg_advisory_unlock($1, hashtext($2))", schluessel);
      }
      const fehlgeschlagen = await antwortet;
      assert.deepEqual([fehlgeschlagen.status, fehlgeschlagen.body.error], [HTTP_UNAVAILABLE, NICHT_GEWAEHLT]);
      assert.equal((await sql(ANRUFE_SQL)).rows.length, 0);
      assert.equal(anbieter.starts().length, 0);
      await keineEigeneSperre(sql);
      await sql(`GRANT SELECT ON call TO ${rolle}`);
      const folgend = await antwort(rufeAnMit(b, { to: ZIEL_A }));
      assert.equal(folgend.status, HTTP_OK);
      assert.equal(anbieter.starts().length, 1);
    });
  },
);
