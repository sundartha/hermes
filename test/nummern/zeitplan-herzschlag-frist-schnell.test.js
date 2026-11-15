import { test } from "node:test";
import assert from "node:assert/strict";
import { haengendeWarteschlange } from "../gemeinsam/pgboss-umgebung.js";

const FRIST_MS = 2000;
const NAMEN = ["aufbewahrung", "abgleich"];

function aufrufeVon(spion) {
  return spion.mock.calls;
}

async function bisTimerSteht() {
  for (let i = 0; i < 20; i++) await new Promise((fertig) => setImmediate(fertig));
}

test("Herzschlag-Frist schnell: nach Ablauf der Frist ist die Antwort sofort da", async (t) => {
  const { queue, zustand } = await haengendeWarteschlange(t);
  for (const name of NAMEN) await queue.plane(name, 900_000, async () => undefined);
  zustand.haengt = true;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let ergebnis = null;
  queue.ueberfaellige().then((namen) => {
    ergebnis = namen;
  });
  await bisTimerSteht();
  t.mock.timers.tick(FRIST_MS);
  await bisTimerSteht();
  t.mock.timers.reset();
  zustand.haengt = false;
  assert.deepEqual(ergebnis, NAMEN);
});

test("Herzschlag-Frist schnell: antwortet die Datenbank, wird der Fristtimer geloescht", async (t) => {
  const { queue } = await haengendeWarteschlange(t);
  for (const name of NAMEN) await queue.plane(name, 900_000, async () => undefined);
  const gesetzt = t.mock.method(globalThis, "setTimeout");
  const geloescht = t.mock.method(globalThis, "clearTimeout");
  const namen = await queue.ueberfaellige();
  assert.deepEqual(namen, []);
  const fristTimer = aufrufeVon(gesetzt).filter((aufruf) => aufruf.arguments[1] === FRIST_MS).map((aufruf) => aufruf.result);
  assert.equal(fristTimer.length, 1);
  assert.ok(aufrufeVon(geloescht).some((aufruf) => aufruf.arguments[0] === fristTimer[0]));
});
