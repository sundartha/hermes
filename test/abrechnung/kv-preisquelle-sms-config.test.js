import assert from "node:assert/strict";
import { test } from "node:test";

import { COST_LEDGER_MAP } from "../../src/billing/cost-ledger-map.ts";

test("kv-preisquelle-sms-config: Preisquelle der SMS nennt config.ts", () => {
  const text = COST_LEDGER_MAP.sms.preisquelle;
  assert.ok(text.includes("min:0 in config.ts"));
  assert.ok(!text.includes("config.js"));
});
