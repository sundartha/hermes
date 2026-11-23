import assert from "node:assert/strict";
import { test } from "node:test";

import {
  mitZweiHermesAufPostgres,
  neueAnrufe,
  postgresVorhanden,
  rufeAnMit,
} from "./hermes-mit-postgres.js";

const HTTP_OK = 200;
const HTTP_UNAVAILABLE = 503;
const EINMAL = 1;
const KEINMAL = 0;
const ZWEIMAL = 2;
const ANLEGEN_FEHLER =
  "Anruf konnte nicht angelegt werden. Es wurde nicht gewaehlt, es entstehen keine Kosten.";
const ROLLE_DER_ANWENDUNG_SQL = `SELECT DISTINCT usename FROM pg_stat_activity
  WHERE datname = current_database() AND usename <> current_user`;
const SPALTEN_SQL = `SELECT column_name FROM information_schema.columns WHERE table_name = 'call'`;
const BEENDET_SQL = `UPDATE call SET status = 'completed' WHERE id = $1`;

test("GATES-SQL-1: ein Anruf, den nur Instanz A gestartet hat, wird auf Instanz B als laufend erkannt und nicht doppelt gewaehlt", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  const { ziel } = neueAnrufe();
  await mitZweiHermesAufPostgres(t, {}, async ({ a, b, anbieter }) => {
    const to = ziel();
    const erster = await rufeAnMit(a, { to });
    assert.equal(erster.status, HTTP_OK);
    const ersterAnruf = await erster.json();
    assert.equal(ersterAnruf.deduplicated, false);
    const zweiter = await rufeAnMit(b, { to });
    assert.equal(zweiter.status, HTTP_OK);
    const zweiterAnruf = await zweiter.json();
    assert.equal(zweiterAnruf.deduplicated, true);
    assert.equal(zweiterAnruf.callId, ersterAnruf.callId);
    assert.equal(anbieter.starts().length, EINMAL);
  });
});

test("GATES-SQL-2: ist die Liste der laufenden Anrufe nicht lesbar, wird nicht gewaehlt und der Fehler lautet wie beim Anlegen", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  const { ziel } = neueAnrufe();
  await mitZweiHermesAufPostgres(t, {}, async ({ b, anbieter, sql }) => {
    const { rows } = await sql(ROLLE_DER_ANWENDUNG_SQL);
    const rolle = rows[0].usename;
    const { rows: spalten } = await sql(SPALTEN_SQL);
    await sql(`REVOKE SELECT ON call FROM ${rolle}`);
    const lesbar = spalten.map((zeile) => zeile.column_name).filter((name) => name !== "goal");
    await sql(`GRANT SELECT (${lesbar.join(", ")}) ON call TO ${rolle}`);
    const antwort = await rufeAnMit(b, { to: ziel() });
    assert.equal(antwort.status, HTTP_UNAVAILABLE);
    assert.equal((await antwort.json()).error, ANLEGEN_FEHLER);
    assert.equal(anbieter.starts().length, KEINMAL);
    assert.ok(b.stdout.includes("[pg] aktive anrufe lesen fehlgeschlagen:"));
  });
});

test("GATES-SQL-6: ein Anruf, den nur der Spiegel dieser Instanz noch als laufend kennt, waehrend die Datenbank ihn beendet fuehrt, wird neu gewaehlt", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  const { ziel } = neueAnrufe();
  await mitZweiHermesAufPostgres(t, {}, async ({ a, sql, anbieter }) => {
    const to = ziel();
    const erster = await (await rufeAnMit(a, { to })).json();
    await sql(BEENDET_SQL, [erster.callId]);
    const zweiter = await (await rufeAnMit(a, { to })).json();
    assert.equal(zweiter.deduplicated, false);
    assert.notEqual(zweiter.callId, erster.callId);
    assert.equal(anbieter.starts().length, ZWEIMAL);
  });
});
