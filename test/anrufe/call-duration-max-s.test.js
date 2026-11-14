import { test } from "node:test";
import assert from "node:assert/strict";
import { maxDurationSOf } from "../../src/call-duration.ts";

test("maxDurationSOf: eigenes maxDurationS wird in Sekunden zurueckgegeben", () => {
  assert.equal(maxDurationSOf({ maxDurationS: 90 }), 90);
});

test("maxDurationSOf: ohne eigenes maxDurationS gilt die Obergrenze von 1800 Sekunden", () => {
  assert.equal(maxDurationSOf({}), 1800);
  assert.equal(maxDurationSOf({ maxDurationS: 0 }), 1800);
});
