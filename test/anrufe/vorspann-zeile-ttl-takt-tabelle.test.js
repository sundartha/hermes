import assert from "node:assert/strict";
import test from "node:test";

import { vorspannZeileTtlMs } from "../../src/elevenlabs/vorspann-pruefung.js";

const STANDARD = { klingelFristMs: 75_000, wiedergabeFristMs: 20_000, bridgeStartDeadlineMs: 30_000 };

const FAELLE = [
  { name: "Takt 15000 mit Standardfristen", fristen: STANDARD, fristenTaktMs: 15_000, erwartet: 165_000 },
  { name: "Takt 1000 waechst um 2000", fristen: STANDARD, fristenTaktMs: 1_000, erwartet: 137_000 },
  { name: "Takt 0 wie ohne Takt", fristen: STANDARD, fristenTaktMs: 0, erwartet: 135_000 },
  { name: "ohne Takt wie bisher", fristen: STANDARD, fristenTaktMs: undefined, erwartet: 135_000 },
  { name: "kurze Fristen bleiben bei der Audio-Ablage", fristen: { klingelFristMs: 1_000, wiedergabeFristMs: 1_000, bridgeStartDeadlineMs: 1_000 }, fristenTaktMs: 1_000, erwartet: 120_000 },
];

for (const { name, fristen, fristenTaktMs, erwartet } of FAELLE) {
  test(`Ablaufzeit der Vorspann-Zeile mit Takt: ${name}`, () => {
    assert.equal(vorspannZeileTtlMs({ ...fristen, fristenTaktMs }), erwartet);
  });
}
