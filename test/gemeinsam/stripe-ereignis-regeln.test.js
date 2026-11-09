import assert from "node:assert/strict";
import { test } from "node:test";

import { istAbgelaufen } from "../../src/store/stripe-ereignis-regeln.js";

const ENDE = 35_000;

test("Stripe-Register-Frist: eine Millisekunde vor dem Ende wartet die Sperre weiter", () => {
  assert.equal(istAbgelaufen(ENDE, ENDE - 1), false);
});

test("Stripe-Register-Frist: genau zum Ende gibt die Sperre auf", () => {
  assert.equal(istAbgelaufen(ENDE, ENDE), true);
});

test("Stripe-Register-Frist: eine Millisekunde nach dem Ende gibt die Sperre auf", () => {
  assert.equal(istAbgelaufen(ENDE, ENDE + 1), true);
});
