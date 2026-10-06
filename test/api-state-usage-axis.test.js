import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { makeReadRoutes } from "../src/routes/api-read.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const PLATFORM_CAP_EUR_TEXT = "7.79";

function makeMockStore(bucket = { inputTokens: 5, outputTokens: 7, costCents: 350, calls: 3 }) {
  return {
    load: () => ({ calls: [], actionItems: [], notifications: [], numbers: [], usageEvents: [] }),
    tenantContext: () => ({ settings: {}, ownerName: "Jonas" }),
    exportTenantData: () => ({ calls: [], actionItems: [], notifications: [] }),
    usageOf: () => bucket,
    tenantSubscription: () => ({
      planSlug: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      periodCreditRevoked: false,
    }),
    getCalendar: () => [],
  };
}

function makeConfig() {
  return withConfigNamespaces({
    multiTenant: false,
    claudeModel: "claude-haiku-4-5",
    voiceEngine: "budget",
    platformSpendCapCents: 779,
  });
}

function makeTenant() {
  return {
    requestTenant: () => BOOTSTRAP_TENANT_ID,
    requireTenant: () => BOOTSTRAP_TENANT_ID,
    tenantOwnsCall: () => true,
  };
}

async function mount(store = makeMockStore()) {
  const app = express();
  app.use(express.json());
  app.use(makeReadRoutes({ store, config: makeConfig(), audit: () => {}, tenant: makeTenant() }));
  const server = await new Promise((res) => {
    const s = app.listen(0, () => res(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, stop: () => new Promise((r) => server.close(r)) };
}

test("GET /api/state usage: planUsagePercent ersetzt alle Geldfelder ersatzlos, kein Plattform-Leck", async () => {
  const srv = await mount();
  try {
    const res = await fetch(`${srv.base}/api/state`);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.usage.planUsagePercent, null, "kein Abo hinterlegt -> null, nie 0 %");
    assert.ok(!("maxBudgetEur" in body.usage), "maxBudgetEur entfaellt ersatzlos (harte Migration)");
    assert.deepEqual(
      Object.keys(body.usage).sort(),
      ["calls", "inputTokens", "outputTokens", "planUsagePercent"],
      "Whitelist beweist: keine Plattform-Groesse, kein Geldfeld in der Usage-Projektion",
    );
    assert.ok(
      !JSON.stringify(body.usage).includes(PLATFORM_CAP_EUR_TEXT),
      "der Plattform-Cap (7.79 EUR) taucht nirgends in der Tenant-Usage-Projektion auf",
    );
    assert.ok(!("costCents" in body.usage), "costCents ist intern, kein API-Leak");
    assert.ok(!("spendMonthCostCents" in body.usage), "spendMonthCostCents ist intern, kein API-Leak");
  } finally {
    await srv.stop();
  }
});

test("GET /api/state usage: reine Leseprojektion - Bucket bleibt byte-identisch, kein save()", async () => {
  const bucket = {
    inputTokens: 5,
    outputTokens: 7,
    costCents: 350,
    calls: 3,
    spendMonthKey: "2020-01",
    spendMonthCostCents: 500,
    costMicroCentsRem: 999,
  };
  let saveCalls = 0;
  const store = { ...makeMockStore(bucket), save: () => { saveCalls++; } };
  const srv = await mount(store);
  try {
    const before = JSON.stringify(bucket);
    await fetch(`${srv.base}/api/state`);
    await fetch(`${srv.base}/api/state`);
    assert.equal(
      JSON.stringify(bucket),
      before,
      "/api/state laesst den Bucket byte-identisch: kein Stempeln, kein Inkrementieren",
    );
    assert.equal(saveCalls, 0, "die Leseprojektion persistiert nichts");
  } finally {
    await srv.stop();
  }
});
