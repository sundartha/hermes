import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

import { neuePglite } from "../pglite-helfer.js";
import { echtWarten } from "../echt-warten.js";
import { poolAufPglite } from "../abrechnung/server-mit-testdatenbank.js";

const ERSTER_MANDANT = "t_erste_ausleihe";
const ZWEITER_MANDANT = "t_zweite_ausleihe";
const EINSCHWINGZEIT_MS = 50;
const MANDANT_SETZEN = "SELECT set_config('app.current_tenant', $1, false)";
const MANDANT_LESEN = "SELECT current_setting('app.current_tenant') AS mandant";

async function mandantVon(client) {
  const { rows } = await client.query(MANDANT_LESEN);
  return rows[0].mandant;
}

test("pglite-Pool: die zweite Ausleihe wartet auf die Freigabe der ersten, deren Mandant bleibt unverfaelscht", async () => {
  poolAufPglite(await neuePglite());
  const pool = new pg.Pool({});

  const erste = await pool.connect();
  await erste.query(MANDANT_SETZEN, [ERSTER_MANDANT]);

  let zweiteEingerichtet = false;
  const zweite = pool.connect().then(async (client) => {
    await client.query(MANDANT_SETZEN, [ZWEITER_MANDANT]);
    zweiteEingerichtet = true;
    return client;
  });
  await echtWarten(EINSCHWINGZEIT_MS);

  assert.equal(zweiteEingerichtet, false, "die zweite Ausleihe darf den Mandanten nicht setzen, solange die erste nicht freigegeben ist");
  assert.equal(await mandantVon(erste), ERSTER_MANDANT);

  erste.release();
  const zweiteAusleihe = await zweite;
  assert.equal(await mandantVon(zweiteAusleihe), ZWEITER_MANDANT);
  zweiteAusleihe.release();
});
