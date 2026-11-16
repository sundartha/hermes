import assert from "node:assert/strict";
import test from "node:test";

import { postgresVorhanden, zeilenBis } from "../anrufe/hermes-mit-postgres.js";
import { FREMDER, ZEITGRENZE_MS, mitInstanzB } from "./konsult-lesen-instanz-b.js";

const PLAETZE_SQL = "SELECT count(*)::int AS anzahl FROM konsult_platz WHERE call_id = $1";
const VERSTECKEN_SQL = "UPDATE call SET tenant_id = $2 WHERE id = $1";
const KEIN_EREIGNIS = Object.freeze({ event: "none", eventId: null, questions: [] });

test(
  "Verschwindet der Anruf waehrend des Haltens aus der Lesung, liefert der Abruf none statt des Endes",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    await mitInstanzB(t, { anrufId: "call_klg_2", status: "active" }, async ({ sql, hole }) => {
      const abruf = hole();
      await zeilenBis(
        async () => (await sql(PLAETZE_SQL, ["call_klg_2"])).rows[0].anzahl,
        (anzahl) => anzahl === 1,
      );
      await sql(VERSTECKEN_SQL, ["call_klg_2", FREMDER.id]);
      assert.deepEqual(await abruf, KEIN_EREIGNIS);
    });
  },
);
