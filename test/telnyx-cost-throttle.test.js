// Unit-Tests der Drossel (KE-P4). Keine config, kein Netz, KEIN echter Timer - Uhr und
// Warten sind injiziert. Die Zahlen sind hier bewusst LITERALE (60_000, :00-Grenzen) und
// nicht die Produktionskonstanten: ein Test, der die eigene Konstante spiegelt, prueft nur
// sich selbst.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMinuteWindowThrottle } from "../src/telephony/adapters/telnyx/rate-limit.js";
import { jumpClock as createJumpClock } from "./fake-clock.js";

// GEMESSENER Burst-Zeitpunkt aus Plan F1 (16:18:30Z): 30 s vor der Fenstergrenze - damit
// ist "bis :00" (30 000 ms) von "eine volle Minute" (60 000 ms) unterscheidbar.
const BURST_AT_MS = Date.parse("2026-07-21T16:18:30.000Z");
const MINUTE_MS = 60_000;

// Sprung-Uhr mit dem in dieser Datei gemessenen Burst-Zeitpunkt als Default (Koerper in
// test/fake-clock.js, geteilt mit test/telnyx-cost-records.test.js, G5).
const jumpClock = (startMs = BURST_AT_MS) => createJumpClock(startMs);
const throttleWith = (clock, budget) =>
  createMinuteWindowThrottle({ budget, now: clock.now, sleep: clock.sleep });

test("(P4-T1) budget Anfragen laufen im selben Fenster ohne Warten durch", async () => {
  const clock = jumpClock();
  const throttle = throttleWith(clock, 3);
  await throttle.reserveSlot();
  await throttle.reserveSlot();
  await throttle.reserveSlot();
  assert.deepEqual(clock.sleeps, []);
  assert.equal(clock.elapsedMs(), 0);
});

test("(P4-T2) die Anfrage ueber dem Budget wartet bis zur naechsten vollen Minute (fixes Fenster, nicht gleitend)", async () => {
  const clock = jumpClock();
  const throttle = throttleWith(clock, 3);
  await throttle.reserveSlot();
  await throttle.reserveSlot();
  await throttle.reserveSlot();
  await throttle.reserveSlot(); // 4. Reservierung ueber dem Budget
  assert.deepEqual(clock.sleeps, [30_000]);
  // Beweis "fix, nicht gleitend": die Pause endet auf der naechsten :00-Grenze, nicht
  // einfach 60_000 ms nach dem Burst-Zeitpunkt.
  assert.equal(clock.now() % MINUTE_MS, 0);
});

test("(P4-T3) nach dem Fensterwechsel ist das Budget frisch", async () => {
  const clock = jumpClock();
  const throttle = throttleWith(clock, 3);
  await throttle.reserveSlot();
  await throttle.reserveSlot();
  await throttle.reserveSlot();
  await throttle.reserveSlot(); // erzwingt den Fensterwechsel (T2-Situation)
  await throttle.reserveSlot();
  await throttle.reserveSlot();
  assert.deepEqual(clock.sleeps, [30_000], "keine weiteren Wartezeiten im frischen Fenster");
});

test("(P4-T4) waitForWindowReset nimmt den Wartehinweis des Providers", async () => {
  const clock = jumpClock();
  const throttle = throttleWith(clock, 3);
  await throttle.waitForWindowReset(17_000); // gemessener Wert aus F1
  assert.deepEqual(clock.sleeps, [17_000]);
});

test("(P4-T5) ohne Hinweis rechnet die eigene Uhr bis zur naechsten vollen Minute", async () => {
  const clock = jumpClock(); // :30 -> 30 000 ms bis :00
  const throttle = throttleWith(clock, 3);
  await throttle.waitForWindowReset(null);
  assert.deepEqual(clock.sleeps, [30_000]);
});

test("(P4-T6) ein unplausibel grosser Hinweis wird auf EIN Fenster gedeckelt", async () => {
  const clock = jumpClock();
  const throttle = throttleWith(clock, 3);
  await throttle.waitForWindowReset(3_600_000); // Provider-Drift, duerfte den Sweep nie anhalten
  assert.deepEqual(clock.sleeps, [60_000]);
});

test("(P4-T7) budget 0 ist ein Konstruktionsfehler, keine abgeschaltete Sicherung", () => {
  assert.throws(() => createMinuteWindowThrottle({ budget: 0 }));
});
