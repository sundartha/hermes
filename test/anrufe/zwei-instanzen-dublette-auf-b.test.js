import assert from "node:assert/strict";
import { test } from "node:test";

import { mitZweiHermesAufPostgres, neueAnrufe, postgresVorhanden, rufeAnMit } from "./hermes-mit-postgres.js";

const HTTP_OK = 200;
const EINMAL = 1;

test("T6 B zuerst: ein auf Instanz B gestarteter Anruf wird auf Instanz A als Dublette abgelehnt wie auf B selbst, und der Anbieter wird einmal gerufen", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  const { ziel } = neueAnrufe();
  await mitZweiHermesAufPostgres(t, {}, async ({ a, b, anbieter }) => {
    const to = ziel();
    const erster = await rufeAnMit(b, { to });
    assert.equal(erster.status, HTTP_OK);
    const ersterAnruf = await erster.json();
    assert.equal(ersterAnruf.deduplicated, false);
    const aufB = await rufeAnMit(b, { to });
    const aufA = await rufeAnMit(a, { to });
    assert.equal(aufB.status, HTTP_OK);
    assert.equal(aufA.status, HTTP_OK);
    const dublette = await aufB.json();
    assert.equal(dublette.deduplicated, true);
    assert.equal(dublette.callId, ersterAnruf.callId);
    assert.deepEqual(await aufA.json(), dublette);
    assert.equal(anbieter.starts().length, EINMAL);
  });
});
