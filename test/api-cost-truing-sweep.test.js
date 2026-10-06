import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { startServer, externalIp } from "./helpers.js";
import { makeBillingRoutes } from "../src/routes/api-billing.js";
import { makeCostTruing } from "../src/billing/cost-truing.js";
import { voiceControl } from "../src/telephony/registry.js";
import { operatorAuthPassThrough } from "./operator-route-app.js";
import { makeStubStore, fakeConfig } from "./cost-truing-harness.js";
import { makeDefaultState, createCall } from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID, PROVIDER, COST_TRUING_SOURCE } from "../src/store/defaults.js";

const UNSUPPORTED_PROVIDER = "twilio";

const EXTERNAL_IP = externalIp();
const MS_PER_MINUTE = 60 * 1000;
const ENDED_MINUTES_AGO = 200;

const PII_PHONE = "+4915155512345";

async function startSweepApp(state) {
  const store = makeStubStore(state);
  const config = fakeConfig();
  const costTruing = makeCostTruing({ store, config, voiceControl, audit: () => {}, messaging: {} });
  const app = express();
  app.use(
    makeBillingRoutes({
      config,
      store,
      audit: () => {},
      billing: {},
      tenant: {},
      costTruing,
      operatorAuth: operatorAuthPassThrough(),
    }),
  );
  const server = await new Promise((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    store,
    close: () => new Promise((r) => server.close(r)),
  };
}

const SWEEP_RESPONSE_TIMEOUT_MS = 15000;

const sweep = (app) =>
  fetch(`${app.base}/api/billing/cost-truing/sweep`, {
    method: "POST",
    signal: AbortSignal.timeout(SWEEP_RESPONSE_TIMEOUT_MS),
  });

function endedOutboundCall(state, { minutesAgo = ENDED_MINUTES_AGO } = {}) {
  const call = createCall(state, {
    direction: "outbound",
    from: PII_PHONE,
    to: PII_PHONE,
    tenantId: BOOTSTRAP_TENANT_ID,
    provider: UNSUPPORTED_PROVIDER,
  });
  call.status = "completed";
  call.answeredAt = new Date(Date.now() - (minutesAgo + 1) * MS_PER_MINUTE).toISOString();
  call.endedAt = new Date(Date.now() - minutesAgo * MS_PER_MINUTE).toISOString();
  call.twilioSid = "CAtest1";
  return call;
}

test("POST /api/billing/cost-truing/sweep, leerer Store: 200 + volle Zaehler-Shape, Deckung 0 bei Nenner 0", async () => {
  const app = await startSweepApp(makeDefaultState());
  try {
    const res = await sweep(app);
    assert.equal(res.status, 200, "Endpunkt verdrahtet (kein 404 durch Pfad-Tippfehler)");
    const body = await res.json();
    assert.deepEqual(body, {
      skipped: false,
      candidates: 0,
      coveragePercent: 0,
      coverageNoEstimate: 0,
      coverageNeverAnswered: 0,
      coverageOutsideWindow: 0,
      measured: 0,
      incomplete: 0,
      noEstimate: 0,
      unavailable: 0,
      skippedCalls: 0,
      failed: 0,
    });
  } finally {
    await app.close();
  }
});

test("POST /api/billing/cost-truing/sweep mit Store-Daten: echter Sweep (Kandidat + Quote), Antwort PII-frei", async () => {
  const seed = makeDefaultState();
  const proven = endedOutboundCall(seed);
  proven.costTruedAt = new Date().toISOString();
  proven.costTruedSource = COST_TRUING_SOURCE.DETAIL_RECORDS;
  proven.actualCostMicroCents = 8636870;
  proven.estimatedCostCents = 20;
  const candidate = endedOutboundCall(seed);
  candidate.estimatedCostCents = 20;

  const app = await startSweepApp(seed);
  try {
    const res = await sweep(app);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, {
      skipped: false,
      candidates: 1,
      coveragePercent: 50,
      coverageNoEstimate: 0,
      coverageNeverAnswered: 0,
      coverageOutsideWindow: 0,
      measured: 0,
      incomplete: 0,
      noEstimate: 0,
      unavailable: 0,
      skippedCalls: 1,
      failed: 0,
    });
    const raw = JSON.stringify(body);
    assert.ok(!raw.includes(PII_PHONE), "keine Rufnummer in der Antwort");
    assert.ok(!raw.includes(candidate.id), "keine Call-ID in der Antwort");

    const stored = app.store.load().calls.find((c) => c.id === candidate.id);
    assert.equal(stored.costTruedAt, null);
    assert.equal(stored.costTruedSource, null);
    assert.equal(stored.costTruingAttempts, 0);
  } finally {
    await app.close();
  }
});

test(
  "POST /api/billing/cost-truing/sweep extern ohne Admin-Sitzung -> 404 (Route ohne operatorAuth nicht gemountet)",
  { skip: !EXTERNAL_IP && "keine externe Interface-IP" },
  async () => {
    const srv = await startServer({ env: { DASHBOARD_PASSWORD: "test-geheim" } });
    try {
      const res = await fetch(`${srv.externalUrl}/api/billing/cost-truing/sweep`, {
        method: "POST",
      });
      assert.equal(res.status, 404);
    } finally {
      await srv.stop();
    }
  },
);
