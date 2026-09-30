import assert from "node:assert/strict";
import { test } from "node:test";

const FALSE_EXPECTATION = "falsch";

test("Werkzeugtest mit falscher Erwartung", () => {
  assert.equal("richtig", FALSE_EXPECTATION);
});
