import assert from "node:assert/strict";
import test from "node:test";

import { makePgTestStore } from "../pg-helpers.js";
import { mitAnrufSperre } from "../../src/store/anruf-sperre-pg.js";

test("ein Speicher, dessen Zugang nur withClient kann, fuehrt die Arbeit unter der Sperre aus und gibt sie frei", async () => {
  const { db, runner } = await makePgTestStore();
  const innerhalb = [];
  const ergebnis = await mitAnrufSperre(runner, "tenant_ohne_halten", async () => {
    const { rows } = await db.query("SELECT count(*)::int AS anzahl FROM pg_locks WHERE locktype = 'advisory' AND granted");
    innerhalb.push(rows[0].anzahl);
    return "ergebnis";
  });
  assert.equal(ergebnis, "ergebnis");
  assert.deepEqual(innerhalb, [1]);
  const { rows } = await db.query("SELECT count(*)::int AS anzahl FROM pg_locks WHERE locktype = 'advisory' AND granted");
  assert.equal(rows[0].anzahl, 0);
});
