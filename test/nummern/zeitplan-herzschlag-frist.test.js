import { test } from "node:test";
import assert from "node:assert/strict";
import { haengendeWarteschlange } from "../gemeinsam/pgboss-umgebung.js";

const FRIST_MS = 2000;
const NAMEN = ["aufbewahrung", "abgleich"];

async function bisTimerSteht() {
  for (let i = 0; i < 20; i++) await new Promise((fertig) => setImmediate(fertig));
}

test("Herzschlag-Frist: haengt die Datenbank, gelten nach der Frist alle Zeitplaene als ueberfaellig", async (t) => {
  const { queue, zustand } = await haengendeWarteschlange(t);
  for (const name of NAMEN) await queue.plane(name, 900_000, async () => undefined);
  zustand.haengt = true;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let fertig = false;
  const antwort = queue.ueberfaellige().then((namen) => {
    fertig = true;
    return namen;
  });
  await bisTimerSteht();
  t.mock.timers.tick(FRIST_MS - 1);
  await bisTimerSteht();
  assert.equal(fertig, false);
  t.mock.timers.tick(1);
  assert.deepEqual(await antwort, NAMEN);
  t.mock.timers.reset();
  zustand.haengt = false;
});
