import assert from "node:assert/strict";
import test from "node:test";

import { vorspannZeileTtlMs } from "../../src/elevenlabs/vorspann-pruefung.js";

const FAELLE = [
  { name: "Standardfristen", klingelFristMs: 75_000, wiedergabeFristMs: 20_000, bridgeStartDeadlineMs: 30_000, erwartet: 135_000 },
  { name: "beide Fristen 120 s", klingelFristMs: 75_000, wiedergabeFristMs: 120_000, bridgeStartDeadlineMs: 120_000, erwartet: 225_000 },
  { name: "Wiedergabefrist ist die groessere", klingelFristMs: 75_000, wiedergabeFristMs: 100_000, bridgeStartDeadlineMs: 30_000, erwartet: 205_000 },
  { name: "EL-Bein-Frist ist die groessere", klingelFristMs: 75_000, wiedergabeFristMs: 30_000, bridgeStartDeadlineMs: 100_000, erwartet: 205_000 },
  { name: "kurze Fristen bleiben bei der Audio-Ablage", klingelFristMs: 1_000, wiedergabeFristMs: 1_000, bridgeStartDeadlineMs: 1_000, erwartet: 120_000 },
];

for (const { name, erwartet, ...fristen } of FAELLE) {
  test(`Ablaufzeit der Vorspann-Zeile: ${name}`, () => {
    assert.equal(vorspannZeileTtlMs(fristen), erwartet);
  });
}
