import assert from "node:assert/strict";
import { test } from "node:test";

import { COST_LEDGER_MAP } from "../../src/billing/cost-ledger-map.ts";

test("kv-preisquelle-sms-config: Preisquelle der SMS nennt rohwerte-billing.ts", () => {
  const text = COST_LEDGER_MAP.sms.preisquelle;
  assert.ok(text.includes("min:0 in src/konfiguration/rohwerte-billing.ts (SMS_COST_CENTS)"));
  assert.ok(!text.includes("config.js"));
});
