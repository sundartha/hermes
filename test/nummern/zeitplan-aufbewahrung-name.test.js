import { test } from "node:test";
import assert from "node:assert/strict";
import { neueUhr, pgBossUmgebung } from "../gemeinsam/pgboss-umgebung.js";
import { starteAufbewahrung } from "../../src/boot.js";

test("Zeitplan-Aufbewahrung: der Boot legt genau einen Zeitplan namens aufbewahrung mit Takt alle 6 Stunden an", async (t) => {
  const { db, queue } = await pgBossUmgebung(t, { clock: neueUhr() });
  let aufraeumen = 0;
  await starteAufbewahrung(() => aufraeumen++, queue);
  const { rows } = await db.abfragen("SELECT name, cron FROM pgboss.schedule");
  assert.deepEqual(rows, [{ name: "zeitplan_aufbewahrung", cron: "0 */6 * * *" }]);
  assert.equal(aufraeumen, 1);
});
