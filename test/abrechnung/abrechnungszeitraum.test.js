import { test } from "node:test";
import assert from "node:assert/strict";
import { MS_PER_SECOND, periodStartFromEnd } from "../../src/billing/period.js";

const MS_PER_SECOND_EXPECTED = 1000;
const END_SEC = Date.parse("2026-07-15T00:00:00.000Z") / MS_PER_SECOND_EXPECTED;
const EXPECTED_START_SEC = Date.parse("2026-06-15T00:00:00.000Z") / MS_PER_SECOND_EXPECTED;
const END_MAR_31_SEC = Date.parse("2026-03-31T00:00:00.000Z") / MS_PER_SECOND_EXPECTED;

test("MS_PER_SECOND ist die kanonische s<->ms-Bruecke", () => {
  assert.equal(MS_PER_SECOND, MS_PER_SECOND_EXPECTED);
});

test("beide Wrapper-Formate meinen denselben Zeitpunkt (ISO == Sekunden)", () => {
  const start = periodStartFromEnd(END_SEC);
  const iso = start.toISOString();
  const sec = Math.floor(start.getTime() / MS_PER_SECOND);
  assert.equal(sec, EXPECTED_START_SEC, "Sekunden-Form = Backfill-Erwartung");
  assert.equal(new Date(sec * MS_PER_SECOND).toISOString(), iso, "ISO und Sekunden konsistent");
});

test("Monatsletzten-Ueberlauf: dokumentiertes Roll-over (akzeptiert, kein Gate)", () => {
  assert.equal(periodStartFromEnd(END_MAR_31_SEC).toISOString(), "2026-03-03T00:00:00.000Z");
});
