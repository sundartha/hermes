import assert from "node:assert/strict";
import { test } from "node:test";

import { makeTransientClassifier } from "../../src/llm/transient-errors.ts";

const isTransient = makeTransientClassifier();

test("transient-errors-lesen: Funktion als Fehler wird über ihre Eigenschaften gelesen", () => {
  const mitStatus = Object.assign(() => {}, { status: 503 });
  const mitCode = Object.assign(() => {}, { code: "ECONNRESET" });
  const ohne = () => {};
  assert.equal(isTransient(mitStatus), true);
  assert.equal(isTransient(mitCode), true);
  assert.equal(isTransient(ohne), false);
});

test("transient-errors-lesen: Objekt wird gelesen, Nicht-Objekt liefert false ohne Ausnahme", () => {
  assert.equal(isTransient({ status: 429 }), true);
  assert.equal(isTransient({ status: 400 }), false);
  assert.equal(isTransient("ECONNRESET"), false);
  assert.equal(isTransient(503), false);
  assert.equal(isTransient({ cause: "x" }), false);
  assert.equal(isTransient({ cause: 503 }), false);
  assert.equal(isTransient({ cause: { status: 500 } }), true);
});
