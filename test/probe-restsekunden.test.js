import { test } from "node:test";
import assert from "node:assert/strict";

import { remainingCallSeconds } from "../src/call-duration.js";

test("Restsekunden eines Anrufs sind eine Zahl", () => {
  assert.equal(typeof remainingCallSeconds({ startedAtMs: 0 }, 0, 60), "number");
});
