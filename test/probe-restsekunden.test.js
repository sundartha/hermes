import { test } from "node:test";
import assert from "node:assert/strict";

import { remainingCallSeconds } from "../src/call-duration.js";

const STANDARD_HOECHSTDAUER_S = 60;
const FAELLE = [
  { name: "eigene Hoechstdauer, 30 s vergangen", anruf: { startedAtMs: 0, maxDurationS: 120 }, jetztMs: 30_000, rest: 90 },
  { name: "angebrochene Sekunde zaehlt nicht", anruf: { startedAtMs: 0, maxDurationS: 120 }, jetztMs: 1_500, rest: 119 },
  { name: "ohne eigene Hoechstdauer gilt der Standard", anruf: { startedAtMs: 10_000 }, jetztMs: 25_000, rest: 45 },
  { name: "nach Ablauf bleibt der Rest bei null", anruf: { startedAtMs: 0, maxDurationS: 120 }, jetztMs: 500_000, rest: 0 },
];

for (const { name, anruf, jetztMs, rest } of FAELLE) {
  test(`Restsekunden eines Anrufs: ${name}`, () => {
    assert.equal(remainingCallSeconds(anruf, jetztMs, STANDARD_HOECHSTDAUER_S), rest);
  });
}
