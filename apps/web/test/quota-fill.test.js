// Tests der Anzeige-Fuellbreite des Minuten-Balkens (lib/quota-fill.js) --
// Nachfolger der quotaUsedPercent-Faelle in subscribe.test.js, erweitert um die
// Nachkommastellen- und Sichtbarkeitsboden-Invarianten (Owner-Feedback
// 2026-08-26: Balken muss jeder Minute der Kontingent-Zeile folgen).
import { test } from "node:test";
import assert from "node:assert/strict";

import { quotaFillPercent } from "../src/lib/quota-fill.js";

// Erwartungswerte als benannte Konstanten (G25).
const EXPECTED_QUARTERISH_PERCENT = 22.5;
const FULL_PERCENT = 100;
const MIN_VISIBLE_PERCENT = 2;
const EXPECTED_THREE_OF_120_PERCENT = 2.5;
const EXPECTED_ONE_OF_30_PERCENT = 3.3;

test("quotaFillPercent: verbrauchter Anteil mit einer Nachkommastelle", () => {
  assert.equal(quotaFillPercent({ remainingMinutes: 93, includedMinutes: 120 }), EXPECTED_QUARTERISH_PERCENT);
  assert.equal(quotaFillPercent({ remainingMinutes: 120, includedMinutes: 120 }), 0);
  assert.equal(quotaFillPercent({ remainingMinutes: 0, includedMinutes: 120 }), FULL_PERCENT);
});

// Kleine Nutzung war mit Ganzzahl-Rundung unsichtbar (< 0,5 % -> 0 %), obwohl
// die Minuten-Zeile herunterzaehlte. Jede angebrochene Nutzung zeigt jetzt
// mindestens den Sichtbarkeitsboden; ohne Verbrauch bleibt der Balken leer.
test("quotaFillPercent: kleine Nutzung wird sichtbar (Sichtbarkeitsboden)", () => {
  assert.equal(quotaFillPercent({ remainingMinutes: 119, includedMinutes: 120 }), MIN_VISIBLE_PERCENT);
  assert.equal(quotaFillPercent({ remainingMinutes: 118, includedMinutes: 120 }), MIN_VISIBLE_PERCENT);
  assert.equal(quotaFillPercent({ remainingMinutes: 117, includedMinutes: 120 }), EXPECTED_THREE_OF_120_PERCENT);
  assert.equal(quotaFillPercent({ remainingMinutes: 29, includedMinutes: 30 }), EXPECTED_ONE_OF_30_PERCENT);
});

test("quotaFillPercent: kein Kontingent -> 0 (Aufrufer rendert den Balken dann nicht)", () => {
  assert.equal(quotaFillPercent(null), 0);
  assert.equal(quotaFillPercent(undefined), 0);
  assert.equal(quotaFillPercent({ remainingMinutes: 0, includedMinutes: 0 }), 0);
});

test("quotaFillPercent: geklemmt auf [0,100] gegen inkonsistente Server-Werte", () => {
  assert.equal(quotaFillPercent({ remainingMinutes: 150, includedMinutes: 120 }), 0);
  assert.equal(quotaFillPercent({ remainingMinutes: -10, includedMinutes: 120 }), FULL_PERCENT);
});
