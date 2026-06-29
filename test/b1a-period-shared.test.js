// B1a-Fix - geteilte Perioden-Ableitung (billing/period.js). Sichert ab, dass die
// Domaenen-Regel "Periodenstart = Periodenende minus ein Monat (UTC)" nach der
// Extraktion (frueher in meter.js + migrate.js dupliziert, G5/S2) an EINER Stelle
// lebt und beide Rueckgabeformate (ISO fuer die Anzeige, Unix-Sekunden fuer den
// Backfill) denselben Zeitpunkt meinen. Reiner Unit-Test, zeit-frei (F.I.R.S.T.).
import { test } from "node:test";
import assert from "node:assert/strict";
import { MS_PER_SECOND, periodStartFromEnd } from "../src/billing/period.js";

// Fixes Fenster: Ende 2026-07-15 -> Start 2026-06-15 (Mitte-Monat, kein Ueberlauf).
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
  // meter.js-Form (ISO) und migrate.js-Form (Unix-Sekunden) leiten aus DEMSELBEN Date ab.
  const iso = start.toISOString();
  const sec = Math.floor(start.getTime() / MS_PER_SECOND);
  assert.equal(sec, EXPECTED_START_SEC, "Sekunden-Form = Backfill-Erwartung");
  assert.equal(new Date(sec * MS_PER_SECOND).toISOString(), iso, "ISO und Sekunden konsistent");
});

test("Monatsletzten-Ueberlauf: dokumentiertes Roll-over (akzeptiert, kein Gate)", () => {
  // 2026-03-31 minus ein Monat -> Feb hat keinen 31. -> JS rollt auf 2026-03-03.
  const endMar31 = Date.UTC(2026, 2, 31) / 1000;
  assert.equal(periodStartFromEnd(endMar31).toISOString(), "2026-03-03T00:00:00.000Z");
});
