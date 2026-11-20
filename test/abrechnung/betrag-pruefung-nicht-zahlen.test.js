import assert from "node:assert/strict";
import { test } from "node:test";

import { isBookableCents, isProviderMicroCents } from "../../src/begriffe/abrechnung.ts";

const EINGABEN = [
  [null, false],
  [undefined, false],
  ["5", false],
  [Number.NaN, false],
  [1.5, false],
  [-1, false],
  [0, true],
  [7, true],
];

test("Buchbarer Betrag: Nicht-Zahlen, Bruchzahlen und negative Werte werden abgelehnt", () => {
  for (const [eingabe, erwartet] of EINGABEN) {
    assert.equal(isBookableCents(eingabe), erwartet, String(eingabe));
  }
});

test("Anbieter-Mikrocent: Nicht-Zahlen, Bruchzahlen und negative Werte werden abgelehnt", () => {
  for (const [eingabe, erwartet] of EINGABEN) {
    assert.equal(isProviderMicroCents(eingabe), erwartet, String(eingabe));
  }
});
