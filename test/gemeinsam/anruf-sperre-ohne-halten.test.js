import assert from "node:assert/strict";
import test from "node:test";

import { makePgTestStore } from "../pg-helpers.js";

test("ein Speicher, dessen Zugang nur withClient kann, fuehrt die Arbeit unter der Sperre aus und gibt sie frei", async () => {
  const { store, db } = await makePgTestStore();
  const innerhalb = [];
  const ergebnis = await store.mitAnrufSperre("tenant_ohne_halten", async () => {
    const { rows } = await db.query("SELECT count(*)::int AS anzahl FROM pg_locks WHERE locktype = 'advisory' AND granted");
    innerhalb.push(rows[0].anzahl);
    return "ergebnis";
  });
  assert.equal(ergebnis, "ergebnis");
  assert.deepEqual(innerhalb, [1]);
  const { rows } = await db.query("SELECT count(*)::int AS anzahl FROM pg_locks WHERE locktype = 'advisory' AND granted");
  assert.equal(rows[0].anzahl, 0);
});
