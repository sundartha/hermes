import assert from "node:assert/strict";
import test from "node:test";

import { postgresVorhanden, zeilenBis } from "../anrufe/hermes-mit-postgres.js";
import { ZEITGRENZE_MS, mitInstanzB } from "./konsult-lesen-instanz-b.js";

const OFFENE_TRANSAKTIONEN_SQL = `SELECT count(*)::int AS anzahl FROM pg_stat_activity
  WHERE datname = current_database() AND pid <> pg_backend_pid() AND state LIKE 'idle in transaction%'
    AND (query LIKE '%SELECT status, consults FROM call WHERE id = $1%' OR query LIKE '%set_config(''statement_timeout''%' OR query = 'BEGIN')`;
const ENDE_EREIGNIS = Object.freeze({ event: "done", eventId: null, questions: [] });

test(
  "Nach einer gelungenen Lesung bleibt keine Transaktion offen",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitInstanzB(t, { anrufId: "call_klg_1", status: "completed" }, async ({ sql, hole }) => {
      assert.deepEqual(await hole(), ENDE_EREIGNIS);
      const offene = await zeilenBis(
        async () => (await sql(OFFENE_TRANSAKTIONEN_SQL)).rows[0].anzahl,
        (anzahl) => anzahl === 0,
      );
      assert.equal(offene, 0);
    });
  },
);

test(
  "Unmittelbar nach der Antwort ist die Lesetransaktion der Rueckfrage abgeschlossen",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitInstanzB(t, { anrufId: "call_klg_3", status: "completed" }, async ({ sql, hole }) => {
      assert.deepEqual(await hole(), ENDE_EREIGNIS);
      assert.equal((await sql(OFFENE_TRANSAKTIONEN_SQL)).rows[0].anzahl, 0);
    });
  },
);
