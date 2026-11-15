import { test } from "node:test";
import assert from "node:assert/strict";
import { neueUhr, verzoegerteWarteschlange } from "../gemeinsam/pgboss-umgebung.js";

const MINUTE_MS = 60_000;
const TAKT_MS = 15 * MINUTE_MS;
const FRIST_MS = TAKT_MS + 15 * MINUTE_MS;
const START_MS = Date.UTC(2026, 10, 1, 8, 5);
const ABFRAGE_FRIST_MS = 2000;
const ABFRAGE_DAUER_MS = 1000;
const ZEITPLAENE = 16;

async function bisTimerSteht() {
  for (let i = 0; i < 50; i++) await new Promise((fertig) => setImmediate(fertig));
}

test("Herzschlag-Parallel: 16 Zeitplaene mit je 1 s Abfragedauer antworten vor der Frist und nennen nur die ueberfaelligen", async (t) => {
  const clock = neueUhr();
  const { queue, zustand } = await verzoegerteWarteschlange(t, { clock });
  await clock.setTime(START_MS);
  const namen = Array.from({ length: ZEITPLAENE }, (_, index) => `plan${index}`);
  const gescheitert = namen.filter((_name, index) => index % 4 === 0);
  for (const name of namen)
    await queue.plane(name, TAKT_MS, async () => {
      if (gescheitert.includes(name)) throw new Error("Lauf gescheitert");
    });
  await clock.tick(11 * MINUTE_MS);
  await clock.tick(MINUTE_MS);
  await clock.setTime(START_MS + FRIST_MS + 1);
  zustand.verzoegert = true;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let ergebnis = null;
  const antwort = queue.ueberfaellige().then((liste) => {
    ergebnis = liste;
  });
  try {
    await bisTimerSteht();
    t.mock.timers.tick(ABFRAGE_DAUER_MS);
    zustand.freigeben();
    await bisTimerSteht();
    t.mock.timers.tick(ABFRAGE_FRIST_MS - ABFRAGE_DAUER_MS - 1);
    await bisTimerSteht();
    assert.deepEqual(ergebnis, gescheitert);
  } finally {
    zustand.verzoegert = false;
    for (let i = 0; i < ZEITPLAENE * 3; i++) {
      zustand.freigeben();
      t.mock.timers.tick(ABFRAGE_DAUER_MS);
      await bisTimerSteht();
    }
    await antwort;
    t.mock.timers.reset();
  }
});
