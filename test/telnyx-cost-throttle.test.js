import { test } from "node:test";
import assert from "node:assert/strict";
import { createMinuteWindowThrottle } from "../src/telephony/adapters/telnyx/rate-limit.js";
import { jumpClock as createJumpClock } from "./fake-clock.js";

const BURST_AT_MS = Date.parse("2026-07-21T16:18:30.000Z");
const MINUTE_MS = 60_000;

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
  await throttle.reserveSlot();
  assert.deepEqual(clock.sleeps, [30_000]);
  assert.equal(clock.now() % MINUTE_MS, 0);
});

test("(P4-T3) nach dem Fensterwechsel ist das Budget frisch", async () => {
  const clock = jumpClock();
  const throttle = throttleWith(clock, 3);
  await throttle.reserveSlot();
  await throttle.reserveSlot();
  await throttle.reserveSlot();
  await throttle.reserveSlot();
  await throttle.reserveSlot();
  await throttle.reserveSlot();
  assert.deepEqual(clock.sleeps, [30_000], "keine weiteren Wartezeiten im frischen Fenster");
});

test("(P4-T4) waitForWindowReset nimmt den Wartehinweis des Providers", async () => {
  const clock = jumpClock();
  const throttle = throttleWith(clock, 3);
  await throttle.waitForWindowReset(17_000);
  assert.deepEqual(clock.sleeps, [17_000]);
});

test("(P4-T5) ohne Hinweis rechnet die eigene Uhr bis zur naechsten vollen Minute", async () => {
  const clock = jumpClock();
  const throttle = throttleWith(clock, 3);
  await throttle.waitForWindowReset(null);
  assert.deepEqual(clock.sleeps, [30_000]);
});

test("(P4-T6) ein unplausibel grosser Hinweis wird auf EIN Fenster gedeckelt", async () => {
  const clock = jumpClock();
  const throttle = throttleWith(clock, 3);
  await throttle.waitForWindowReset(3_600_000);
  assert.deepEqual(clock.sleeps, [60_000]);
});

test("(P4-T7) budget 0 ist ein Konstruktionsfehler, keine abgeschaltete Sicherung", () => {
  assert.throws(() => createMinuteWindowThrottle({ budget: 0 }));
});
