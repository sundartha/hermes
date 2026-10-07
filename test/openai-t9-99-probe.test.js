import { test } from "node:test";
import assert from "node:assert/strict";

test("probe: zwei plus zwei ergibt vier", () => {
  assert.equal([2, 2].reduce((summe, zahl) => summe + zahl, 0), 4);
});
