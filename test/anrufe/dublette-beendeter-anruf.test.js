import assert from "node:assert/strict";
import { test } from "node:test";

import {
  mitZweiHermesAufPostgres,
  neueAnrufe,
  postgresVorhanden,
  rufeAnMit,
} from "./hermes-mit-postgres.js";
import { makePgStore, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const HTTP_OK = 200;
const ZWEIMAL = 2;
const BEENDET_SQL = `UPDATE call SET status = 'completed' WHERE id = $1`;
const ABGEHOBEN_SQL = `UPDATE call SET answered_at = '2026-11-22T18:50:00.000Z' WHERE id = $1`;
const ZEILE_WEG_SQL = `DELETE FROM call WHERE id = $1`;

test("DUBLETTE-1: ein Anruf, den eine andere Instanz beendet hat, blockiert keinen neuen Anruf an dieselbe Nummer", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  const { ziel } = neueAnrufe();
  await mitZweiHermesAufPostgres(t, {}, async ({ a, sql, anbieter }) => {
    const to = ziel();
    const erster = await (await rufeAnMit(a, { to })).json();
    await sql(BEENDET_SQL, [erster.callId]);
    const antwort = await rufeAnMit(a, { to });
    assert.equal(antwort.status, HTTP_OK);
    const zweiter = await antwort.json();
    assert.equal(zweiter.deduplicated, false);
    assert.notEqual(zweiter.callId, erster.callId);
    assert.equal(zweiter.status, "dialing");
    assert.equal(anbieter.starts().length, ZWEIMAL);
  });
});

test("DUBLETTE-2: fehlt die Zeile des Anrufs in der Datenbank, bleibt er eine Dublette", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  const { ziel } = neueAnrufe();
  await mitZweiHermesAufPostgres(t, {}, async ({ a, sql }) => {
    const to = ziel();
    const erster = await (await rufeAnMit(a, { to })).json();
    await sql(ZEILE_WEG_SQL, [erster.callId]);
    const zweiter = await (await rufeAnMit(a, { to })).json();
    assert.equal(zweiter.deduplicated, true);
    assert.equal(zweiter.callId, erster.callId);
  });
});

test("DUBLETTE-3: eine echte Dublette nennt den echten Stand des laufenden Anrufs statt dialing", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  const { ziel } = neueAnrufe();
  await mitZweiHermesAufPostgres(t, {}, async ({ a, b, sql }) => {
    const to = ziel();
    const erster = await (await rufeAnMit(a, { to })).json();
    assert.equal(erster.status, "dialing");
    await sql(ABGEHOBEN_SQL, [erster.callId]);
    const zweiter = await (await rufeAnMit(b, { to })).json();
    assert.equal(zweiter.deduplicated, true);
    assert.equal(zweiter.callId, erster.callId);
    assert.equal(zweiter.status, "in_progress");
  });
});

const KUNDE = "t_dublette_beendet";
const FEHLER_PRAEFIX = "[pg] aktive anrufe lesen fehlgeschlagen:";

const runnerFuer = (db, vorQuery = () => {}) => ({
  withClient: (fn) =>
    fn({
      query: (text, params) => {
        vorQuery(text);
        return db.query(text, params);
      },
      exec: (sql) => db.exec(sql),
    }),
});

async function zweiInstanzen(vorQueryA) {
  const db = await pgliteAlsRolleOhneSuperuser();
  await makePgStore(runnerFuer(db)).init();
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [KUNDE]);
  await db.query(`INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)`, [KUNDE]);
  const a = makePgStore(runnerFuer(db, vorQueryA));
  const b = makePgStore(runnerFuer(db));
  await a.init();
  await b.init();
  return { a, db };
}

const neuerAnruf = (store) =>
  store.createCall({ direction: "outbound", from: "+4930555000312", to: "+4915112349966", goal: "Test", tenantId: KUNDE });

test("DUBLETTE-4: beendet eine andere Instanz den Anruf, fehlt er in der Liste der laufenden Anrufe der anlegenden Instanz", async () => {
  const { a, db } = await zweiInstanzen();
  const call = neuerAnruf(a);
  await a.persistCall(call.id);
  assert.deepEqual((await a.activeCallsForSql(KUNDE)).map((c) => c.id), [call.id]);
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [KUNDE]);
  await db.query(BEENDET_SQL, [call.id]);
  assert.deepEqual(await a.activeCallsForSql(KUNDE), []);
});

test("DUBLETTE-5: ein Anruf, den die Datenbank noch nicht kennt, bleibt in der Liste der laufenden Anrufe", async () => {
  const { a } = await zweiInstanzen();
  const call = neuerAnruf(a);
  assert.deepEqual((await a.activeCallsForSql(KUNDE)).map((c) => c.id), [call.id]);
});

test("DUBLETTE-6: scheitert die Prüfung auf beendete Anrufe, wird der Fehler geworfen und im Log genannt", async () => {
  const { a } = await zweiInstanzen((text) => {
    if (text.includes("ANY($2)")) throw new Error("Lesefehler erfunden");
  });
  neuerAnruf(a);
  const meldungen = [];
  const original = console.error;
  console.error = (...teile) => meldungen.push(teile.join(" "));
  try {
    await assert.rejects(a.activeCallsForSql(KUNDE), /Lesefehler erfunden/);
  } finally {
    console.error = original;
  }
  assert.ok(meldungen.some((m) => m.startsWith(FEHLER_PRAEFIX) && m.includes("Lesefehler erfunden")));
});
