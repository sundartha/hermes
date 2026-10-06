import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { startServer, externalIp } from "./helpers.js";
import { makeBillingRoutes } from "../src/routes/api-billing.js";
import { operatorAuthPassThrough } from "./operator-route-app.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { makeDefaultState, createCall } from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID, PROVIDER, COST_TRUING_SOURCE } from "../src/store/defaults.js";
import { TARIFF_DRIFT_FINDING } from "../src/billing/cost-calibration.js";

const EXTERNAL_IP = externalIp();
const MS_PER_MINUTE = 60 * 1000;
const DOMESTIC_PREFIXES = ["+49", "+33", "+44"];
const PII_PHONE = "+4915155512345";
const PII_TENANT_NAME = "Klarname-Musterfirma-GmbH";

const DRIFT_CONFIG = withConfigNamespaces({
  voiceTariffDomesticPrefixes: DOMESTIC_PREFIXES,
  voiceTariffDomesticCents: 0,
  providerToBucketRateMicro: 920000,
  costCalibrationMinSamples: 20,
  costDriftWarnPercent: 50,
});

async function startCostDriftApp(state) {
  const app = express();
  app.use(
    makeBillingRoutes({
      config: DRIFT_CONFIG,
      store: { load: () => state },
      audit: () => {},
      billing: {},
      tenant: {},
      operatorAuth: operatorAuthPassThrough(),
    }),
  );
  const server = await new Promise((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

const fetchDrift = (app) => fetch(`${app.base}/api/billing/cost-drift`);

function truedOutboundCall(state, { to, actualCostMicroCents, minutesAgo }) {
  const call = createCall(state, {
    direction: "outbound",
    from: PII_PHONE,
    to,
    tenantId: BOOTSTRAP_TENANT_ID,
    provider: PROVIDER.TELNYX,
  });
  call.status = "completed";
  call.answeredAt = new Date(Date.now() - (minutesAgo + 1) * MS_PER_MINUTE).toISOString();
  call.endedAt = new Date(Date.now() - minutesAgo * MS_PER_MINUTE).toISOString();
  call.costTruedAt = new Date().toISOString();
  call.costTruedSource = COST_TRUING_SOURCE.DETAIL_RECORDS;
  call.actualCostMicroCents = actualCostMicroCents;
  return call;
}

test("GET /api/billing/cost-drift, leerer Store: insufficient_samples je Praefix, samples sichtbar", async () => {
  const app = await startCostDriftApp(makeDefaultState());
  try {
    const res = await fetchDrift(app);
    assert.equal(res.status, 200, "Endpunkt verdrahtet (kein 404 durch Pfad-Tippfehler)");
    const body = await res.json();
    assert.deepEqual(
      body.prefixes.map((e) => e.prefix),
      DOMESTIC_PREFIXES,
      "alle konfigurierten Praefixe werden bewertet",
    );
    for (const entry of body.prefixes) {
      assert.equal(entry.code, TARIFF_DRIFT_FINDING.INSUFFICIENT_SAMPLES);
      assert.equal(entry.samples, 0, "Stichprobenzahl ist sichtbar, nicht weggelassen");
      assert.equal(entry.measuredCentsPerMin, null, "keine Tarif-Aussage ohne Datenlage");
    }
  } finally {
    await app.close();
  }
});

test("GET /api/billing/cost-drift unter der Mindeststichprobe: insufficient_samples, aber samples zaehlt mit", async () => {
  const seed = makeDefaultState();
  const SAMPLE_COUNT = 3;
  for (let i = 0; i < SAMPLE_COUNT; i++)
    truedOutboundCall(seed, {
      to: `${DOMESTIC_PREFIXES[0]}15155512345`,
      actualCostMicroCents: 8636870,
      minutesAgo: 10 + i,
    });

  const app = await startCostDriftApp(seed);
  try {
    const res = await fetchDrift(app);
    const body = await res.json();
    const de = body.prefixes.find((e) => e.prefix === DOMESTIC_PREFIXES[0]);
    assert.equal(de.code, TARIFF_DRIFT_FINDING.INSUFFICIENT_SAMPLES);
    assert.equal(de.samples, SAMPLE_COUNT, "gezaehlte Stichproben sind sichtbar");
    assert.equal(de.measuredCentsPerMin, null);
  } finally {
    await app.close();
  }
});

test("GET /api/billing/cost-drift: Antwort ist PII-frei", async () => {
  const seed = makeDefaultState();
  seed.settings[BOOTSTRAP_TENANT_ID].agentName = PII_TENANT_NAME;
  const call = truedOutboundCall(seed, {
    to: `${DOMESTIC_PREFIXES[0]}15155512345`,
    actualCostMicroCents: 8636870,
    minutesAgo: 10,
  });

  const app = await startCostDriftApp(seed);
  try {
    const res = await fetchDrift(app);
    const raw = JSON.stringify(await res.json());
    assert.ok(!raw.includes(PII_PHONE), "keine Rufnummer in der Antwort");
    assert.ok(!raw.includes(call.id), "keine Call-ID in der Antwort");
    assert.ok(!raw.includes(PII_TENANT_NAME), "kein Tenant-Klarname in der Antwort");
    assert.ok(!raw.includes(BOOTSTRAP_TENANT_ID), "keine Tenant-Kennung in der Antwort");
    assert.ok(raw.includes(DOMESTIC_PREFIXES[0]), "der Praefix selbst ist keine PII und bleibt");
  } finally {
    await app.close();
  }
});

test(
  "GET /api/billing/cost-drift extern ohne Admin-Sitzung -> 404 (Route ohne operatorAuth nicht gemountet)",
  { skip: !EXTERNAL_IP && "keine externe Interface-IP" },
  async () => {
    const srv = await startServer({ env: { DASHBOARD_PASSWORD: "test-geheim" } });
    try {
      const res = await fetch(`${srv.externalUrl}/api/billing/cost-drift`);
      assert.equal(res.status, 404);
    } finally {
      await srv.stop();
    }
  },
);
