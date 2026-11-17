import { test } from "node:test";
import assert from "node:assert/strict";
import { BENCH_MAX_OPENING_CHARS } from "../../scripts/convo-bench/checks.mjs";
import { SCENARIOS, SCENARIO_IDS } from "../../scripts/convo-bench/scenarios/index.mjs";

const OUTBOUND = "outbound";

test("AL-P5-3 jedes outbound-Bench-Szenario deklariert die Eroeffnungs-Schwelle, das inbound-Szenario nicht", () => {
  for (const id of SCENARIO_IDS) {
    const scenario = SCENARIOS[id];
    if (scenario.direction === OUTBOUND) {
      assert.equal(scenario.maxOpeningChars, BENCH_MAX_OPENING_CHARS, `${id}: Schwelle fehlt/abweichend`);
    } else {
      assert.ok(!("maxOpeningChars" in scenario), `${id}: inbound darf keine Eroeffnungs-Schwelle tragen`);
    }
  }
});
