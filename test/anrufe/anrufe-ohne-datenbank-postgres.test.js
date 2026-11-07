import assert from "node:assert/strict";
import test from "node:test";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import {
  anrufeSql,
  gibDatenbankFrei,
  mitHermesAufPostgres,
  neueAnrufe,
  postgresVorhanden,
  sperreDatenbank,
} from "./hermes-mit-postgres.js";

const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;

async function mitBekanntemAnrufOhneDatenbank(t, lauf) {
  const anrufe = neueAnrufe();
  await mitHermesAufPostgres(
    t,
    { env: { MAX_CALLS_PER_HOUR: "1" } },
    async ({ srv, anbieter, db, sql }) => {
      assert.equal((await anrufe.rufeAn(srv)).status, HTTP_OK);
      const [anruf] = await anrufeSql(sql, 1);
      assert.equal(anbieter.starts().length, 1);
      await sperreDatenbank(sql, db);
      try {
        await lauf({ srv, anbieter, sql, anruf, anrufe });
      } finally {
        await gibDatenbankFrei(db);
      }
      assert.deepEqual(srv.readStore().calls, [], "store.json enthaelt keinen Anruf");
    },
  );
}

test("PG-OHNE-DB-LESEN: bei gesperrter Datenbank meldet das Lesen eines bekannten Anrufs nicht 404", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitBekanntemAnrufOhneDatenbank(t, async ({ srv, sql, anruf }) => {
    const res = await abrufMitFrist(`${srv.localUrl}/api/calls/${anruf.id}`);
    assert.notEqual(res.status, HTTP_NOT_FOUND);
    assert.equal((await anrufeSql(sql, 1)).length, 1);
  });
});

test("PG-OHNE-DB-LIMIT: bei gesperrter Datenbank wird der Anruf ueber dem Stundenlimit nicht gestartet", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitBekanntemAnrufOhneDatenbank(t, async ({ srv, anbieter, sql, anrufe }) => {
    const res = await anrufe.rufeAn(srv);
    assert.notEqual(res.status, HTTP_OK);
    assert.equal(anbieter.starts().length, 1, "die Attrappe zaehlt keinen neuen Start");
    assert.equal((await anrufeSql(sql, 1)).length, 1);
  });
});
