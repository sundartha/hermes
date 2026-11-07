import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";

import {
  anrufeSql,
  mitHermesAufPostgres,
  neueAnrufe,
  postgresVorhanden,
} from "./hermes-mit-postgres.js";

const HTTP_OK = 200;
const HTTP_TOO_MANY = 429;

async function abgelehnt(res, grund) {
  assert.equal(res.status, HTTP_TOO_MANY);
  assert.equal((await res.json()).reason, grund);
}

test("PG-RAHMEN: Hermes laeuft unter einer RLS-Rolle ohne Superuser, der Anruf steht per SQL in call und nicht in store.json", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  const { rufeAn } = neueAnrufe();
  await mitHermesAufPostgres(t, {}, async ({ srv, anbieter, db, sql }) => {
    assert.equal((await rufeAn(srv)).status, HTTP_OK);
    assert.equal(anbieter.starts().length, 1);
    const [anruf] = await anrufeSql(sql, 1);
    assert.equal(anruf.status, "active");
    const rolle = await sql("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1", [
      db.rolle,
    ]);
    assert.deepEqual(rolle.rows, [{ rolsuper: false, rolbypassrls: false }]);
    const verbindungen = await sql(
      "SELECT count(*)::int AS anzahl FROM pg_stat_activity WHERE datname = current_database() AND usename = $1",
      [db.rolle],
    );
    assert.ok(verbindungen.rows[0].anzahl > 0, "Hermes verbindet sich unter der Rolle");
    const alsRolle = new pg.Client({ connectionString: db.adresse });
    await alsRolle.connect();
    try {
      const ohneMandant = await alsRolle.query("SELECT count(*)::int AS anzahl FROM call");
      assert.equal(
        ohneMandant.rows[0].anzahl,
        0,
        "ohne Mandant sieht die Rolle unter RLS keinen Anruf",
      );
    } finally {
      await alsRolle.end();
    }
    assert.deepEqual(srv.readStore().calls, [], "store.json enthaelt keinen Anruf");
  });
});

test("PG-STUNDENLIMIT: der Anruf ueber dem Stundenlimit erreicht den ElevenLabs-Start nie, per SQL steht ein Anruf", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  const { rufeAn } = neueAnrufe();
  await mitHermesAufPostgres(
    t,
    { env: { MAX_CALLS_PER_HOUR: "1" } },
    async ({ srv, anbieter, sql }) => {
      assert.equal((await rufeAn(srv)).status, HTTP_OK);
      await abgelehnt(await rufeAn(srv), "stundenlimit");
      assert.equal(anbieter.starts().length, 1);
      assert.equal((await anrufeSql(sql, 1)).length, 1);
      assert.deepEqual(srv.readStore().calls, []);
    },
  );
});

test("PG-ZIEL-LIMIT: der Anruf ueber dem Limit je Ziel erreicht den ElevenLabs-Start nie, ein drittes Ziel schon", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  const { ziel, rufeAn } = neueAnrufe();
  await mitHermesAufPostgres(
    t,
    { env: { PER_TARGET_CALL_CAP: "1" } },
    async ({ srv, anbieter, sql }) => {
      const erstes = ziel();
      assert.equal((await rufeAn(srv, { to: erstes })).status, HTTP_OK);
      await abgelehnt(await rufeAn(srv, { to: erstes }), "ziel_limit");
      assert.equal((await rufeAn(srv)).status, HTTP_OK);
      assert.equal(anbieter.starts().length, 2);
      const anrufe = await anrufeSql(sql, 2);
      assert.equal(anrufe.length, 2);
      assert.deepEqual(srv.readStore().calls, []);
    },
  );
});
