import assert from "node:assert/strict";
import test from "node:test";

import {
  anrufeSql,
  mitHermesAufPostgresHartNeustartbar,
  neueAnrufe,
  postgresVorhanden,
} from "./hermes-mit-postgres.js";

const HTTP_OK = 200;
const HTTP_TOO_MANY = 429;
const STUNDENLIMIT_EIN_ANRUF = { MAX_CALLS_PER_HOUR: "1" };

test("PG-STUNDENLIMIT-NEUSTART: nach hartem Neustart gegen dieselbe Datenbank zaehlt das Stundenlimit den Anruf des ersten Laufs weiter", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  const { rufeAn } = neueAnrufe();
  await mitHermesAufPostgresHartNeustartbar(
    t,
    { env: STUNDENLIMIT_EIN_ANRUF },
    async ({ srv, anbieter, sql, neustartHart }) => {
      assert.equal((await rufeAn(srv)).status, HTTP_OK);
      assert.equal(anbieter.starts().length, 1);
      assert.equal((await anrufeSql(sql, 1)).length, 1);
      const zweiter = await neustartHart();
      const res = await rufeAn(zweiter.srv);
      assert.equal(res.status, HTTP_TOO_MANY);
      assert.equal((await res.json()).reason, "stundenlimit");
      assert.equal(zweiter.anbieter.starts().length, 0);
      assert.equal((await anrufeSql(sql, 1)).length, 1);
      assert.deepEqual(zweiter.srv.readStore().calls, []);
    },
  );
});

test("PG-GLEICHZEITIG: zwei gleichzeitige Anrufe an verschiedene Ziele ergeben am Stundenlimit genau einmal 200 und einmal 429", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  const { rufeAn } = neueAnrufe();
  await mitHermesAufPostgresHartNeustartbar(
    t,
    { env: STUNDENLIMIT_EIN_ANRUF },
    async ({ srv, anbieter, sql }) => {
      const antworten = await Promise.all([rufeAn(srv), rufeAn(srv)]);
      assert.deepEqual(antworten.map((res) => res.status).sort(), [HTTP_OK, HTTP_TOO_MANY]);
      const abgelehnt = antworten.find((res) => res.status === HTTP_TOO_MANY);
      assert.equal((await abgelehnt.json()).reason, "stundenlimit");
      assert.equal(anbieter.starts().length, 1);
      assert.equal((await anrufeSql(sql, 1)).length, 1);
      assert.deepEqual(srv.readStore().calls, []);
    },
  );
});
