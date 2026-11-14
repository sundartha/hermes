import assert from "node:assert/strict";
import { test } from "node:test";

import { measuredCentsPerMinByPrefix } from "../../src/billing/cost-calibration.ts";
import { COST_TRUING_SOURCE } from "../../src/begriffe/abrechnung.js";

const MINUTE_MS = 60_000;
const ENDE_MS = Date.parse("2026-09-01T12:00:00Z");

function anruf(nr, overrides = {}) {
  return {
    to: "+4930111222333",
    from: "+4930999888777",
    answeredAt: new Date(ENDE_MS + nr * MINUTE_MS - MINUTE_MS).toISOString(),
    endedAt: new Date(ENDE_MS + nr * MINUTE_MS).toISOString(),
    actualCostMicroCents: 1_000_000,
    costTruedSource: COST_TRUING_SOURCE.DETAIL_RECORDS,
    ...overrides,
  };
}

test("kalibrierung-stichprobenfilter: nur Calls mit passender Vorwahl und beweisender Herkunft zaehlen als Stichprobe", () => {
  const calls = [
    anruf(1),
    anruf(2, { to: "+15551234567", actualCostMicroCents: 9_000_000 }),
    anruf(3, { from: "+15551234567", actualCostMicroCents: 9_000_000 }),
    anruf(4, { costTruedSource: "schaetzung", actualCostMicroCents: 9_000_000 }),
  ];
  assert.deepEqual(measuredCentsPerMinByPrefix(calls, "+49"), { samples: 1, p95ProviderMicroCentsPerMin: 1_000_000 });
});
