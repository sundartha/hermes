import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { makeBillingRoutes } from "../../src/routes/api-billing.ts";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { operatorAuthPassThrough } from "../operator-route-app.js";

const HTTP_SERVER_ERROR = 500;
const HTTP_OK = 200;

async function sweepStatus(costTruing, audits) {
  const app = express();
  app.use(
    makeBillingRoutes({
      config: withConfigNamespaces({ paymentEnabled: true, publicUrl: "https://agent.test" }),
      store: {},
      audit: (aktion) => audits.push(aktion),
      billing: {},
      costTruing,
      operatorAuth: operatorAuthPassThrough(),
      tenant: {},
    }),
  );
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    const res = await abrufMitFrist(`http://127.0.0.1:${server.address().port}/api/billing/cost-truing/sweep`, { method: "POST" });
    return { status: res.status, body: await res.text() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("cost-truing sweep: wirft der Sweep beim Lesen, antwortet die Route 500 und schreibt kein Audit", async () => {
  const audits = [];
  const costTruing = { runCostTruingSweep: () => Promise.reject(new Error("lesefehler")) };
  const antwort = await sweepStatus(costTruing, audits);
  assert.equal(antwort.status, HTTP_SERVER_ERROR);
  assert.deepEqual(audits, []);
});

test("cost-truing sweep: Erfolg bleibt 200 mit der Antwort des Sweeps", async () => {
  const audits = [];
  const costTruing = { runCostTruingSweep: () => Promise.resolve({ skipped: false, candidates: 3 }) };
  const antwort = await sweepStatus(costTruing, audits);
  assert.equal(antwort.status, HTTP_OK);
  assert.deepEqual(JSON.parse(antwort.body), { skipped: false, candidates: 3 });
  assert.deepEqual(audits, ["cost_truing_sweep"]);
});
