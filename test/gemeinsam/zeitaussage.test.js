import { test } from "node:test";
import assert from "node:assert/strict";
import { assertMindestdauer } from "./zeitaussage.mjs";

const UNTERGRENZE_MS = 150;

test("Mindestdauer: unter der Untergrenze ist rot, auf und über der Untergrenze grün, auch weit darüber", () => {
  assert.throws(() => assertMindestdauer(149.9, UNTERGRENZE_MS, "Probe"), /Probe.*149\.9 ms liegt unter der Untergrenze 150 ms/);
  assert.doesNotThrow(() => assertMindestdauer(UNTERGRENZE_MS, UNTERGRENZE_MS, "Probe"));
  assert.doesNotThrow(() => assertMindestdauer(UNTERGRENZE_MS * 1000, UNTERGRENZE_MS, "Probe"));
});

test("Mindestdauer: ein fehlender oder nicht endlicher Messwert ist rot", () => {
  for (const wert of [undefined, null, NaN, Infinity, "200"]) {
    assert.throws(() => assertMindestdauer(wert, UNTERGRENZE_MS, "Probe"), /Probe: Messwert fehlt/);
  }
});
