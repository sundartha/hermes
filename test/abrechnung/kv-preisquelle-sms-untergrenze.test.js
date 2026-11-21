import assert from "node:assert/strict";
import { test } from "node:test";

import { COST_LEDGER_MAP } from "../../src/billing/cost-ledger-map.ts";

test("kv-preisquelle-sms-untergrenze: Untergrenze der SMS-Kosten verweist auf rohwerte-billing", () => {
  const text = COST_LEDGER_MAP.sms.preisquelle;
  assert.ok(text.includes("min:0 in src/konfiguration/rohwerte-billing.ts (SMS_COST_CENTS)"));
  assert.ok(!text.includes("min:0 in config.ts"));
});
