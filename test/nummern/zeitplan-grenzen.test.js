import { test } from "node:test";
import assert from "node:assert/strict";
import { neueUhr, pgBossUmgebung } from "../gemeinsam/pgboss-umgebung.js";

const NAME = "aufbewahrung";
const MINUTE_MS = 60_000;
const STUNDE_MS = 60 * MINUTE_MS;

test("Zeitplan-11: negative Takte und ein Takt von anderthalb Stunden werden abgelehnt", async (t) => {
  const { queue } = await pgBossUmgebung(t, { clock: neueUhr() });
  for (const takt of [-6 * STUNDE_MS, -15 * MINUTE_MS, 90 * MINUTE_MS])
    await assert.rejects(queue.plane(NAME, takt, async () => assert.fail("kein Lauf")), /Takt/, String(takt));
});

test("Zeitplan-12: der Lauf startet erst beim nächsten Abruf, der alle 30 Sekunden stattfindet", async (t) => {
  const clock = neueUhr();
  const { queue } = await pgBossUmgebung(t, { clock });
  let laeufe = 0;
  await clock.setTime(Date.UTC(2026, 10, 1, 8, 5));
  await queue.plane(NAME, 15 * MINUTE_MS, async () => {
    laeufe++;
  });
  await clock.tick(10 * MINUTE_MS);
  assert.equal(laeufe, 0);
  await clock.tick(30_000);
  assert.equal(laeufe, 1);
});
