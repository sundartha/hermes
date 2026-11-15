import { test } from "node:test";
import assert from "node:assert/strict";
import { haengendeWarteschlange } from "../gemeinsam/pgboss-umgebung.js";

const FRIST_MS = 2000;
const NAMEN = ["aufbewahrung", "abgleich"];

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
  const fristTimer = [];
  const echtesSetTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", (funktion, ms, ...rest) => {
    const handle = echtesSetTimeout(funktion, ms, ...rest);
    if (ms === FRIST_MS) fristTimer.push(handle);
    return handle;
  });
  const geloescht = [];
  const echtesClearTimeout = globalThis.clearTimeout;
  t.mock.method(globalThis, "clearTimeout", (handle) => {
    geloescht.push(handle);
    return echtesClearTimeout(handle);
  });
  const namen = await queue.ueberfaellige();
  assert.deepEqual(namen, []);
  assert.equal(fristTimer.length, 1);
  assert.ok(geloescht.includes(fristTimer[0]));
});
