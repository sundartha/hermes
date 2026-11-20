import assert from "node:assert/strict";
import { test } from "node:test";

import { startRejectionReason } from "../../src/telephony/failure-reason.ts";

const TABELLE = [
  [399, "result-unknown:start-no-status"],
  [400, "not-placed:start-400"],
  [429, "at-capacity:start-429"],
  [499, "not-placed:start-499"],
  [500, "result-unknown:start-500"],
  [599, "result-unknown:start-599"],
  [600, "result-unknown:start-no-status"],
];

for (const [status, erwartet] of TABELLE) {
  test(`start-grenzen: Start-Status ${status} ergibt ${erwartet}`, () => {
    assert.equal(startRejectionReason(status), erwartet);
  });
}
