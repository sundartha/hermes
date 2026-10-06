import { test } from "node:test";
import assert from "node:assert/strict";
import { MS_PER_SECOND, periodStartFromEnd } from "../src/billing/period.js";

const END_SEC = Date.UTC(2026, 6, 15) / 1000;
const EXPECTED_START_SEC = Date.UTC(2026, 5, 15) / 1000;

test("periodStartFromEnd: Ende minus ein Monat im UTC-Kalender (Mitte-Monat)", () => {
  const start = periodStartFromEnd(END_SEC);
  assert.equal(start.toISOString(), "2026-06-15T00:00:00.000Z");
});

test("MS_PER_SECOND ist die kanonische s<->ms-Bruecke", () => {
  assert.equal(MS_PER_SECOND, 1000);
});

test("beide Wrapper-Formate meinen denselben Zeitpunkt (ISO == Sekunden)", () => {
  const start = periodStartFromEnd(END_SEC);
  const iso = start.toISOString();
  const sec = Math.floor(start.getTime() / MS_PER_SECOND);
  assert.equal(sec, EXPECTED_START_SEC, "Sekunden-Form = Backfill-Erwartung");
  assert.equal(new Date(sec * MS_PER_SECOND).toISOString(), iso, "ISO und Sekunden konsistent");
});

test("Monatsletzten-Ueberlauf: dokumentiertes Roll-over (akzeptiert, kein Gate)", () => {
  const endMar31 = Date.UTC(2026, 2, 31) / 1000;
  assert.equal(periodStartFromEnd(endMar31).toISOString(), "2026-03-03T00:00:00.000Z");
});
