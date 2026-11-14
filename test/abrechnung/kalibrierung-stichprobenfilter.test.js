import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";

import { makeBillingRoutes } from "../../src/routes/api-billing.js";
import { operatorAuthPassThrough } from "../operator-route-app.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { COST_TRUING_SOURCE } from "../../src/begriffe/abrechnung.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const MS_PER_MINUTE = 60 * 1000;
const EIGENE_NUMMER = "+4915155512345";

const KONFIG = withConfigNamespaces({
  voiceTariffDomesticPrefixes: ["+49", "+33"],
  voiceTariffDomesticCents: 0,
  providerToBucketRateMicro: 920000,
  costCalibrationMinSamples: 20,
  costDriftWarnPercent: 50,
});

function abgerechneterAnruf(calls, { to, from = EIGENE_NUMMER, minutesAgo, source = COST_TRUING_SOURCE.DETAIL_RECORDS }) {
  calls.push({
    to,
    from,
    answeredAt: new Date(Date.now() - (minutesAgo + 1) * MS_PER_MINUTE).toISOString(),
    endedAt: new Date(Date.now() - minutesAgo * MS_PER_MINUTE).toISOString(),
    costTruedSource: source,
    actualCostMicroCents: 8_636_870,
  });
}

test("kalibrierung-stichprobenfilter: GET /api/billing/cost-drift zaehlt nur Calls mit passender Vorwahl und beweisender Herkunft", async () => {
  const state = { calls: [] };
  abgerechneterAnruf(state.calls, { to: "+4930111222333", minutesAgo: 10 });
  abgerechneterAnruf(state.calls, { to: "+4930111222444", minutesAgo: 11 });
  abgerechneterAnruf(state.calls, { to: "+4930111222555", minutesAgo: 12, source: "schaetzung" });
  abgerechneterAnruf(state.calls, { to: "+15551234567", minutesAgo: 13 });
  abgerechneterAnruf(state.calls, { to: "+4930111222666", from: "+15551234567", minutesAgo: 14 });
  const app = express();
  app.use(makeBillingRoutes({ config: KONFIG, store: { load: () => state }, audit: () => {}, billing: {}, tenant: {}, operatorAuth: operatorAuthPassThrough() }));
  const server = await new Promise((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  try {
    const body = await (await abrufMitFrist(`http://127.0.0.1:${server.address().port}/api/billing/cost-drift`)).json();
    assert.deepEqual(body.prefixes.map((e) => [e.prefix, e.samples]), [["+49", 2], ["+33", 0]]);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
