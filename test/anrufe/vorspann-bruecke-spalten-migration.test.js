import assert from "node:assert/strict";
import { test } from "node:test";

import { mandantenAbruf, postgresVorhanden } from "./hermes-mit-postgres.js";
import {
  mitHermesMitMailUndNeustart,
  seedeAusgehendenAnruf,
} from "./hermes-mit-mail-neustart.js";

const HTTP_OK = 200;
const ZEITGRENZE_MS = 180_000;
const ANRUF_A = "call_bruecke_alt_a";
const ANRUF_B = "call_bruecke_alt_b";
const NEUE_VERSION = "11";
const NEUER_NAME = "0011_vorspann_bruecke_spalten";
const MANDANT = Object.freeze({
  id: "tenant_bruecke_alt",
  sub: "sub-bruecke-alt",
  e164: "+4930555000301",
});
const ANRUF_SPALTEN = "id, tenant_id, status, direction, goal, from_e164, to_e164, language, started_at";
const NEUE_SPALTEN_SQL = `SELECT column_name FROM information_schema.columns
  WHERE table_name = 'call' AND column_name IN ('bridged_at', 'el_call_control_id')`;

async function aufStand0010Bringen(sql) {
  await sql("ALTER TABLE call DROP COLUMN IF EXISTS bridged_at, DROP COLUMN IF EXISTS el_call_control_id");
  await sql("DELETE FROM schema_migrations WHERE version = $1", [Number(NEUE_VERSION)]);
  for (const id of [ANRUF_A, ANRUF_B]) await seedeAusgehendenAnruf(sql, { id, mandant: MANDANT });
}

const anrufZeilen = async (sql) =>
  (await sql(`SELECT ${ANRUF_SPALTEN} FROM call ORDER BY id`)).rows;

test(
  "Abnahme 4: Stand 0010 mit bestehenden Anrufzeilen startet, Version 11 ist eingetragen, Zeilen bleiben lesbar",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return t.skip("kein Postgres");
    await mitHermesMitMailUndNeustart(t, { mandanten: [MANDANT] }, async (hermes) => {
      await hermes.neustart(aufStand0010Bringen);
      const spalten = (await hermes.sql(NEUE_SPALTEN_SQL)).rows.map((zeile) => zeile.column_name);
      assert.deepEqual(spalten.sort(), ["bridged_at", "el_call_control_id"]);
      const { rows } = await hermes.sql(
        "SELECT version::text AS version, name FROM schema_migrations WHERE version = $1",
        [Number(NEUE_VERSION)],
      );
      assert.deepEqual(rows, [{ version: NEUE_VERSION, name: NEUER_NAME }]);
      const zeilen = await anrufZeilen(hermes.sql);
      assert.deepEqual(zeilen.map((zeile) => zeile.id), [ANRUF_A, ANRUF_B]);
      for (const id of [ANRUF_A, ANRUF_B]) {
        const antwort = await mandantenAbruf(hermes.srv, MANDANT.sub).hole(`/api/calls/${id}`);
        assert.equal(antwort.status, HTTP_OK);
        const anruf = await antwort.json();
        assert.equal(anruf.id, id);
        assert.equal(anruf.status, "active");
        assert.equal("bridgedAt" in anruf, false);
        assert.equal("elCallControlId" in anruf, false);
      }
      const roh = await hermes.sql("SELECT bridged_at, el_call_control_id FROM call");
      assert.deepEqual(roh.rows, [
        { bridged_at: null, el_call_control_id: null },
        { bridged_at: null, el_call_control_id: null },
      ]);
    });
  },
);
